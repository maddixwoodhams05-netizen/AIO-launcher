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

// ---------- Other stores ----------

const { parseRegistry, findStoreGames, findEpicGames, findXboxGames } = require('../src/stores');
const { isNewer, createUpdater } = require('../src/updater');
const { makeStores } = require('./helpers');

test('reads the registry the way Windows prints it', () => {
  const text = [
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1207658924',
    '    gameID    REG_SZ    1207658924',
    '    gameName    REG_SZ    The Witcher: Enhanced Edition',
    '    path    REG_SZ    D:\\GOG Games\\The Witcher',
    '    dependsOn    REG_SZ    ',
    '',
  ].join('\r\n');
  assert.deepStrictEqual(parseRegistry(text), {
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1207658924': {
      gameID: '1207658924',
      gameName: 'The Witcher: Enhanced Edition',
      path: 'D:\\GOG Games\\The Witcher',
      dependsOn: '',
    },
  });
});

test('finds games from Epic, GOG, EA, Ubisoft and Xbox, each started through its store', async () => {
  const file = makeStores({ Epic: ['Fortnite'], GOG: ['The Witcher'], EA: ['Apex Legends'], Ubisoft: ['Far Cry 6'], Xbox: ['Sea of Thieves'] });
  process.env.LAUNCHER_TEST_STORES = file;
  try {
    const games = await findStoreGames();
    const byStore = Object.fromEntries(games.map((g) => [g.store, g]));
    assert.deepStrictEqual(Object.keys(byStore).sort(), ['EA', 'Epic', 'GOG', 'Ubisoft', 'Xbox']);
    assert.strictEqual(byStore.Epic.name, 'Fortnite');
    assert.strictEqual(path.basename(byStore.Epic.exePath), 'Fortnite.exe');
    assert.strictEqual(byStore.Epic.launchUrl, 'com.epicgames.launcher://apps/ns%3Aitem0%3Aapp0?action=launch&silent=true');
    assert.strictEqual(byStore.GOG.name, 'The Witcher');
    assert.strictEqual(byStore.GOG.launchUrl, undefined, 'GOG games start from their EXE');
    assert.strictEqual(byStore.EA.launchUrl, 'origin2://game/launch?offerIds=300&autoDownload=1');
    assert.strictEqual(byStore.Ubisoft.name, 'Far Cry 6', 'name comes from the installed programs list');
    assert.strictEqual(byStore.Ubisoft.launchUrl, 'uplay://launch/200/0');
    assert.strictEqual(byStore.Xbox.launchUrl, 'shell:AppsFolder\\Publisher.Game0_8wekyb3d8bbwe!Game');
  } finally {
    delete process.env.LAUNCHER_TEST_STORES;
  }
});

test('Epic: skips add-ons, half-downloaded games and non-games', async () => {
  const root = tempDir('epic');
  const dir = path.join(root, 'Game');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'Game.exe'), Buffer.alloc(300000, 1));
  const item = { DisplayName: 'Game', InstallLocation: dir, LaunchExecutable: 'Game.exe', AppName: 'a', MainGameAppName: 'a', AppCategories: ['games'] };
  const write = (name, extra) => fs.writeFileSync(path.join(root, `${name}.item`), JSON.stringify({ ...item, ...extra }));
  write('game', {});
  write('dlc', { AppName: 'dlc', DisplayName: 'DLC' });
  write('half', { AppName: 'half', MainGameAppName: 'half', DisplayName: 'Half', bIsIncompleteInstall: true });
  write('engine', { AppName: 'ue', MainGameAppName: 'ue', DisplayName: 'Unreal Engine', AppCategories: ['engines'] });
  write('gone', { AppName: 'gone', MainGameAppName: 'gone', DisplayName: 'Gone', InstallLocation: path.join(root, 'nope') });
  fs.writeFileSync(path.join(root, 'broken.item'), '{ not json');
  assert.deepStrictEqual((await findEpicGames({ manifests: root })).map((g) => g.name), ['Game']);
});

test('GOG: add-ons (DLC) are not listed as games', async () => {
  const file = makeStores({ GOG: ['Cyberpunk 2077'] });
  const fake = JSON.parse(fs.readFileSync(file, 'utf8'));
  const key = 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games';
  fake.registry[key] += fake.registry[key].replace(/\\100/, '\\101').replace('gameID    REG_SZ    100', 'gameID    REG_SZ    101\r\n    dependsOn    REG_SZ    100');
  fs.writeFileSync(file, JSON.stringify(fake));
  process.env.LAUNCHER_TEST_STORES = file;
  try {
    assert.deepStrictEqual((await findStoreGames()).map((g) => g.storeId), ['100']);
  } finally {
    delete process.env.LAUNCHER_TEST_STORES;
  }
});

test('Xbox: names Windows has to look up fall back to a readable name', async () => {
  const dir = tempDir('xbox');
  fs.writeFileSync(path.join(dir, 'Game.exe'), Buffer.alloc(300000, 1));
  const games = await findXboxGames({
    xboxPackages: async () => [
      { name: 'Microsoft.SeaofThieves', family: 'f_1', dir, appId: 'App', displayName: 'ms-resource:Title', config: '<Executable Name="Game.exe" />' },
      { name: 'Broken', family: 'f_2', dir }, // no app id: can't be started
    ],
  });
  assert.deepStrictEqual(games.map((g) => g.name), ['Seaof Thieves']);
});

// ---------- Updates ----------

test('works out which version is newer', () => {
  assert.strictEqual(isNewer('1.1.0', '1.0.0'), true);
  assert.strictEqual(isNewer('v1.10.0', '1.9.2'), true);
  assert.strictEqual(isNewer('1.0.0', '1.0.0'), false);
  assert.strictEqual(isNewer('1.0.9', '1.1.0'), false);
  assert.strictEqual(isNewer('2.0.0-beta', '1.9.0'), true);
});

test('portable launcher: says a new version is out and opens the download page', async () => {
  const release = (tag) => async () => ({ ok: true, url: `https://github.com/x/releases/tag/${tag}` });
  globalThis.fetch = release('v9.0.0');
  const sent = [];
  const opened = [];
  const updater = createUpdater({ current: '1.1.0', autoUpdater: null, send: (i) => sent.push(i.state), openUrl: (u) => opened.push(u) });
  await updater.check();
  assert.deepStrictEqual(sent, ['checking', 'available']);
  assert.strictEqual(updater.status().version, '9.0.0');
  assert.strictEqual(updater.status().canInstall, false);
  updater.install();
  assert.deepStrictEqual(opened, ['https://github.com/x/releases/tag/v9.0.0']);

  globalThis.fetch = release('v1.1.0');
  await updater.check();
  assert.strictEqual(updater.status().state, 'none');

  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  await updater.check();
  assert.strictEqual(updater.status().state, 'error');
});

test('installed launcher: Update now downloads, then installs and restarts', async () => {
  const EventEmitter = require('events');
  const auto = new EventEmitter();
  const calls = [];
  auto.checkForUpdates = async () => auto.emit('update-available', { version: '1.2.0' });
  auto.downloadUpdate = async () => {
    auto.emit('download-progress', { percent: 50 });
    auto.emit('update-downloaded', { version: '1.2.0' });
  };
  auto.quitAndInstall = (...args) => calls.push(args);
  const states = [];
  const updater = createUpdater({ current: '1.1.0', autoUpdater: auto, send: (i) => states.push(i.state), openUrl: () => {} });
  assert.strictEqual(auto.autoDownload, false, 'never downloads without asking');
  await updater.check();
  assert.strictEqual(updater.status().state, 'available');
  assert.strictEqual(updater.status().canInstall, true);
  updater.install();
  await new Promise((r) => setTimeout(r, 1700));
  assert.deepStrictEqual(states, ['checking', 'available', 'downloading', 'downloading', 'installing']);
  assert.deepStrictEqual(calls, [[true, true]], 'installs quietly and starts the new version');
});

test('installed launcher: a failed download can be tried again', async () => {
  const EventEmitter = require('events');
  const auto = new EventEmitter();
  auto.checkForUpdates = async () => auto.emit('update-available', { version: '1.2.0' });
  auto.downloadUpdate = async () => auto.emit('error', new Error('connection lost'));
  const updater = createUpdater({ current: '1.1.0', autoUpdater: auto, send: () => {}, openUrl: () => {} });
  await updater.check();
  updater.install();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(updater.status().state, 'available');
});

// ---------- Releases ----------

test('the changelog has an entry for this version', () => {
  const { version } = require('../package.json');
  const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, new RegExp(`^## \\[?${version.replace(/\./g, '\\.')}\\]?`, 'm'), `add a "## ${version}" section to CHANGELOG.md`);
});
