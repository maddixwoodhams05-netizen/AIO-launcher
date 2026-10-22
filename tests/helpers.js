// Shared bits for the tests: pretend game folders, a pretend Steam,
// and starting the real launcher with its own throwaway library.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron } = require('playwright-core');

// Makes a temporary folder that is deleted when the tests finish.
const made = [];
process.on('exit', () => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function tempDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `launcher-${name}-`));
  made.push(dir);
  return dir;
}

// Makes one folder per game, each with an EXE and an optional big file.
// games: { "Game Name": sizeInBytes }
function makeGames(games) {
  const root = tempDir('games');
  for (const [name, size] of Object.entries(games)) {
    const dir = path.join(root, name);
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    // Real EXEs are bigger than tiny helper programs, so give it some size.
    fs.writeFileSync(path.join(dir, `${name.replace(/\s+/g, '')}.exe`), Buffer.alloc(300000, 1));
    if (size) {
      // An empty "sparse" file that reports this size without using the space.
      const file = path.join(dir, 'data', 'pak.bin');
      fs.writeFileSync(file, '');
      fs.truncateSync(file, size);
    }
  }
  return root;
}

// Pretend Steam replies, so art tests don't need the internet.
// Only "silent hill 2" (and close spellings) is found.
const FAKE_STEAM = `
globalThis.fetch = async (url) => {
  const u = new URL(url);
  const json = (body) => ({ ok: true, json: async () => body });
  if (u.pathname.includes('storesearch')) {
    const found = /silent\\s*hill\\s*(2|ii)/i.test(u.searchParams.get('term'));
    return json({ items: found ? [{ id: 999, name: 'SILENT HILL 2 Deluxe Edition' }, { id: 2124490, name: 'SILENT HILL 2' }] : [] });
  }
  if (u.pathname.includes('GetItems')) {
    return json({ response: { store_items: [{ assets: {
      asset_url_format: 'steam/apps/2124490/abc123/\${FILENAME}',
      library_capsule_2x: 'library_600x900_2x.jpg',
      library_hero: 'library_hero.jpg',
    } }] } });
  }
  if (u.pathname.includes('appdetails')) return json({});
  return { ok: false };
};
`;

// Pretend game stores (see testStores in src/stores.js). Each game gets a
// folder with an EXE. games: { Epic: ['Fortnite'], GOG: [...], EA: [...], Ubisoft: [...], Xbox: [...] }
// sizes: optional { 'Game name': bytes }.
function makeStores(games, sizes = {}) {
  const root = tempDir('stores');
  const gameDir = (store, name) => {
    const dir = path.join(root, store, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name.replace(/\W+/g, '')}.exe`), Buffer.alloc(300000, 1));
    if (sizes[name]) {
      fs.writeFileSync(path.join(dir, 'pak.bin'), '');
      fs.truncateSync(path.join(dir, 'pak.bin'), sizes[name]);
    }
    return dir;
  };
  const fake = { manifests: path.join(root, 'epic-manifests'), registry: {}, xboxPackages: [] };
  fs.mkdirSync(fake.manifests);
  (games.Epic || []).forEach((name, i) => {
    const dir = gameDir('Epic', name);
    fs.writeFileSync(path.join(fake.manifests, `${i}.item`), JSON.stringify({
      DisplayName: name, InstallLocation: dir, LaunchExecutable: `${name.replace(/\W+/g, '')}.exe`,
      AppName: `app${i}`, MainGameAppName: `app${i}`, CatalogNamespace: 'ns', CatalogItemId: `item${i}`, AppCategories: ['public', 'games'],
    }));
  });
  const reg = (key, entries) => (fake.registry[key] = entries.map(([sub, values]) =>
    `\r\n${key.replace('HKLM', 'HKEY_LOCAL_MACHINE')}\\${sub}\r\n${Object.entries(values).map(([k, v]) => `    ${k}    REG_SZ    ${v}`).join('\r\n')}`).join('\r\n') + '\r\n');
  reg('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', (games.GOG || []).map((name, i) => [`${100 + i}`, { gameID: `${100 + i}`, gameName: name, path: gameDir('GOG', name) }]));
  reg('HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs', (games.Ubisoft || []).map((name, i) => [`${200 + i}`, { InstallDir: gameDir('Ubisoft', name) }]));
  reg('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', [
    ...(games.Ubisoft || []).map((name, i) => [`Uplay Install ${200 + i}`, { DisplayName: name, UninstallString: `"C:\\Uplay.exe" uplay://uninstall/${200 + i}` }]),
    ...(games.EA || []).map((name, i) => {
      const dir = gameDir('EA', name);
      fs.mkdirSync(path.join(dir, '__Installer'));
      fs.writeFileSync(path.join(dir, '__Installer', 'installerdata.xml'), `<game><contentIDs><contentID>${300 + i}</contentID></contentIDs></game>`);
      return [`{EA-${i}}`, { DisplayName: name, InstallLocation: dir, UninstallString: `"C:\\Program Files\\Common Files\\EAInstaller\\${name}\\Cleanup.exe" uninstall_game` }];
    }),
  ]);
  fake.xboxPackages = (games.Xbox || []).map((name, i) => ({
    name: `Publisher.${name.replace(/\W+/g, '')}`,
    family: `Publisher.Game${i}_8wekyb3d8bbwe`,
    dir: gameDir('Xbox', name),
    appId: 'Game',
    config: `<Game><ShellVisuals DefaultDisplayName="${name}" /><ExecutableList><Executable Name="${name.replace(/\W+/g, '')}.exe" /></ExecutableList></Game>`,
  }));
  // Steam: a pretend Steam folder with one manifest per game.
  const steamapps = path.join(root, 'Steam', 'steamapps');
  (games.Steam || []).forEach((name, i) => {
    fs.mkdirSync(path.join(steamapps, 'common'), { recursive: true });
    fs.renameSync(gameDir('Steam', name), path.join(steamapps, 'common', name));
    fs.writeFileSync(path.join(steamapps, `appmanifest_${400 + i}.acf`), `"appid" "${400 + i}"\n"name" "${name}"\n"installdir" "${name}"\n`);
  });
  if (games.Steam) fake.steamRoot = path.join(root, 'Steam');
  const file = path.join(root, 'stores.json');
  fs.writeFileSync(file, JSON.stringify(fake));
  return file;
}

// Starts the launcher. library: what to put in its library.json first.
// Pass library: null to keep the library already saved in dataDir (for restart tests).
// stores: a file from makeStores, for games from pretend Epic, GOG, EA, Ubisoft and Xbox.
// With no stores, it gets empty pretend ones, so the real PC's stores are never read.
async function launch({ library = {}, dataDir = tempDir('data'), fakeSteam = true, stores = makeStores({}) } = {}) {
  if (library) {
    fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({ folders: [], games: [], hidden: [], ...library }));
  }
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), path.join(__dirname, '..')],
    // LAUNCHER_TEST_STATUS stops the real running-games check from overwriting the pretend one.
    // LAUNCHER_NO_UPDATE_CHECK: the tests check for updates themselves, against a pretend GitHub.
    env: {
      ...process.env,
      LAUNCHER_DATA_DIR: dataDir,
      LAUNCHER_TEST_STATUS: '1',
      LAUNCHER_NO_UPDATE_CHECK: '1',
      LAUNCHER_TEST_STORES: stores,
      LAUNCHER_TEST_STEAM: JSON.parse(fs.readFileSync(stores, 'utf8')).steamRoot || '',
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  if (fakeSteam) await app.evaluate((_electron, code) => (0, eval)(code), FAKE_STEAM);
  // Wait for the first scan to finish.
  await page.waitForSelector('body[data-ready]', { state: 'attached' });
  return { app, page, dataDir, readLibrary: () => JSON.parse(fs.readFileSync(path.join(dataDir, 'library.json'), 'utf8')) };
}

// Names of the game tiles shown in a grid.
const tileNames = (page, grid = '#grid') => page.$$eval(`${grid} .tile .name`, (els) => els.map((e) => e.textContent));

module.exports = { tempDir, makeGames, makeStores, launch, tileNames };
