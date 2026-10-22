// Tests for the parts that work things out without the window:
// finding games, matching Steam art, storage safety rules and playtime maths.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { tempDir, makeGames } = require('./helpers');

// These files expect to run inside Electron; give them a stand-in.
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === 'electron' ? { app: { getPath: () => os.tmpdir() } } : realLoad.call(this, request, ...rest);
};

const { scanFolder } = require('../src/scanner');
const { findSteamGames } = require('../src/steam');
const { findArt } = require('../src/art');
const storage = require('../src/storage');
const { playtimeByPeriod, totalPlaytime, formatDuration } = require('../src/playtime-stats');

test('finds one game per folder and skips installers', async () => {
  const root = makeGames({ 'Hollow Knight': 0, Celeste: 0 });
  fs.writeFileSync(path.join(root, 'Celeste', 'unins000.exe'), Buffer.alloc(400000, 1));
  fs.mkdirSync(path.join(root, '_CommonRedist'));
  fs.writeFileSync(path.join(root, '_CommonRedist', 'vcredist.exe'), Buffer.alloc(400000, 1));

  const games = await scanFolder(root);
  assert.deepStrictEqual(games.map((g) => g.name).sort(), ['Celeste', 'Hollow Knight']);
  const celeste = games.find((g) => g.name === 'Celeste');
  assert.strictEqual(path.basename(celeste.exePath), 'Celeste.exe');
  assert.strictEqual(celeste.gameDir, path.join(root, 'Celeste'));
});

test('a folder that cannot be opened gives null, not an empty list', async () => {
  assert.strictEqual(await scanFolder(path.join(os.tmpdir(), 'does-not-exist-12345')), null);
});

test('reads installed Steam games, with their app id and size', async () => {
  const root = tempDir('steam');
  const steamapps = path.join(root, 'steamapps');
  fs.mkdirSync(path.join(steamapps, 'common', 'Portal 2'), { recursive: true });
  fs.writeFileSync(path.join(steamapps, 'common', 'Portal 2', 'portal2.exe'), Buffer.alloc(300000, 1));
  fs.writeFileSync(
    path.join(steamapps, 'appmanifest_620.acf'),
    '"AppState"\n{\n\t"appid"\t\t"620"\n\t"name"\t\t"Portal 2"\n\t"installdir"\t\t"Portal 2"\n\t"SizeOnDisk"\t\t"12345678"\n}\n'
  );
  // Steam tools like Proton are not games.
  fs.writeFileSync(path.join(steamapps, 'appmanifest_1493710.acf'), '"appid" "1493710"\n"name" "Proton"\n"installdir" "Proton"\n');

  const games = await findSteamGames(root);
  assert.strictEqual(games.length, 1);
  assert.deepStrictEqual(
    { name: games[0].name, appId: games[0].appId, size: games[0].size, exe: path.basename(games[0].exePath) },
    { name: 'Portal 2', appId: 620, size: 12345678, exe: 'portal2.exe' }
  );
});

// Pretend Steam store: answers searches from this list.
function fakeSteam(results) {
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const json = (body) => ({ ok: true, json: async () => body });
    if (u.pathname.includes('storesearch')) return json({ items: results[u.searchParams.get('term').toLowerCase()] || [] });
    if (u.pathname.includes('GetItems')) {
      return json({ response: { store_items: [{ assets: { asset_url_format: 'steam/apps/1/x/${FILENAME}', library_capsule_2x: 'c.jpg', library_hero: 'h.jpg' } }] } });
    }
    return { ok: false, json: async () => ({}) };
  };
}

test('Steam art: exact names win, editions lose, numerals match digits', async () => {
  fakeSteam({
    'silent hill 2': [{ id: 999, name: 'SILENT HILL 2 Deluxe Edition' }, { id: 2124490, name: 'SILENT HILL 2' }],
    'final fantasy 7': [{ id: 39140, name: 'FINAL FANTASY VII' }],
    'the witcher 3': [{ id: 5, name: 'The Witcher 3: Wild Hunt - Soundtrack Edition' }, { id: 292030, name: 'The Witcher 3: Wild Hunt' }],
    'nothing like it': [{ id: 7, name: 'Totally Different' }],
  });
  const appId = async (name) => (await findArt({ name, exePath: 'C:\\Games\\x\\x.exe' })).appId;
  assert.strictEqual(await appId('silent hill 2'), 2124490);
  assert.strictEqual(await appId('final fantasy 7'), 39140);
  assert.strictEqual(await appId('the witcher 3'), 292030);
  assert.strictEqual(await appId('nothing like it'), null);
});

test('Steam art: uses the real art addresses from the store service', async () => {
  fakeSteam({ 'silent hill 2': [{ id: 2124490, name: 'SILENT HILL 2' }] });
  const art = await findArt({ name: 'silent hill 2', exePath: 'C:\\Games\\x\\x.exe' });
  assert.strictEqual(art.cover, 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/x/c.jpg');
  assert.strictEqual(art.hero, 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/x/h.jpg');
});

test('Steam art: being offline finds nothing instead of crashing', async () => {
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  const art = await findArt({ name: 'silent hill 2', exePath: 'C:\\Games\\x\\x.exe' });
  assert.strictEqual(art.appId, null);
});

test('never offers to bin a folder that might hold more than the game', () => {
  const games = (dir) => ({ gameDir: dir, exePath: path.join(dir, 'a.exe') });
  const picked = path.resolve('/games');
  const inner = games(path.join(picked, 'Foo'));
  const nested = games(path.join(picked, 'Foo', 'Bar'));
  const library = { folders: [picked], games: [inner, nested] };

  assert.ok(storage.whyNotTrash(games(picked), library), 'the folder the user added');
  assert.ok(storage.whyNotTrash(games(path.parse(picked).root), library), 'the top of a drive');
  assert.ok(storage.whyNotTrash(games(os.homedir()), library), 'the user folder');
  assert.ok(storage.whyNotTrash(games(path.resolve('/s/steamapps/common')), library), 'Steam common folder');
  assert.ok(storage.whyNotTrash(inner, library), 'holds another game');
  assert.ok(storage.whyNotTrash({ exePath: '/x.exe' }, library), 'folder unknown');
  assert.strictEqual(storage.whyNotTrash(nested, library), null, 'an ordinary game folder is fine');
});

test('adds up folder sizes', async () => {
  const root = makeGames({ Big: 5 * 1024 * 1024 });
  const size = await storage.folderSize(path.join(root, 'Big'));
  assert.strictEqual(size, 5 * 1024 * 1024 + 300000);
});

test('playtime maths', () => {
  const now = new Date(2026, 9, 22, 20, 0);
  const hour = 3600000;
  const today = new Date(2026, 9, 22, 18, 0).getTime();
  const yesterday = new Date(2026, 9, 21, 23, 30).getTime(); // crosses midnight
  const sessions = [[today, today + hour], [yesterday, yesterday + hour]];

  const week = playtimeByPeriod(sessions, 'week', now);
  assert.strictEqual(week.length, 7);
  assert.strictEqual(week[6].ms, hour + 30 * 60000); // today: 1 hr + the 30 min after midnight
  assert.strictEqual(week[5].ms, 30 * 60000);
  assert.strictEqual(playtimeByPeriod(sessions, 'month', now).length, 30);
  assert.strictEqual(playtimeByPeriod(sessions, 'year', now).length, 12);
  assert.strictEqual(totalPlaytime(sessions), 2 * hour);
  assert.strictEqual(formatDuration(45 * 60000), '45 min');
  assert.strictEqual(formatDuration(90 * 60000), '1.5 hrs');
});
