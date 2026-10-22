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

// Starts the launcher. library: what to put in its library.json first.
// Pass library: null to keep the library already saved in dataDir (for restart tests).
async function launch({ library = {}, dataDir = tempDir('data'), fakeSteam = true } = {}) {
  if (library) {
    fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({ folders: [], games: [], hidden: [], ...library }));
  }
  const app = await _electron.launch({
    executablePath: require('electron'),
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), path.join(__dirname, '..')],
    // LAUNCHER_TEST_STATUS stops the real running-games check from overwriting the pretend one.
    env: { ...process.env, LAUNCHER_DATA_DIR: dataDir, LAUNCHER_TEST_STATUS: '1' },
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

module.exports = { tempDir, makeGames, launch, tileNames };
