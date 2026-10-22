// Tests that start the real launcher and click through it like a person would.
// Each test gets its own pretend games and library, so nothing real is touched.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeGames, makeStores, launch, tileNames, tempDir } = require('./helpers');

const GB = 1024 ** 3;

// Starts the launcher with a folder of pretend games already added.
async function launchWith(games) {
  const root = makeGames(games);
  const launched = await launch({ library: { folders: [root] } });
  return { ...launched, root };
}

test('shows the games it finds, sorted by name', async () => {
  const { app, page } = await launchWith({ Zelda: 0, Alpha: 0, Mario: 0 });
  try {
    assert.deepStrictEqual(await tileNames(page), ['Alpha', 'Mario', 'Zelda']);
  } finally {
    await app.close();
  }
});

test('favourites: star a game, it shows in Favourites, and stays after a restart', async () => {
  const { app, page, dataDir } = await launchWith({ Alpha: 0, Beta: 0 });
  try {
    await page.click('#grid .tile >> nth=1');
    await page.click('#game-fav');
    await page.waitForFunction(() => document.getElementById('game-fav').textContent.includes('★'));
    await page.click('#back');
    await page.click('[data-view=favourites]');
    assert.deepStrictEqual(await tileNames(page, '#grid-favourites'), ['Beta']);
    assert.strictEqual(await page.isVisible('#grid-favourites .tile .star'), true, 'gold star on the tile');
  } finally {
    await app.close();
  }

  const again = await launch({ dataDir, library: null });
  try {
    await again.page.click('[data-view=favourites]');
    assert.deepStrictEqual(await tileNames(again.page, '#grid-favourites'), ['Beta']);
    // Un-star from the right-click menu.
    await again.page.click('#grid-favourites .tile', { button: 'right' });
    assert.strictEqual(await again.page.textContent('[data-action=favourite]'), 'Remove from favourites');
    await again.page.click('[data-action=favourite]');
    await again.page.waitForSelector('#empty-favourites:not([hidden])');
  } finally {
    await again.app.close();
  }
});

test('groups: make one, drag a game in, tick another in, rename and delete it', async () => {
  const { app, page } = await launchWith({ Alpha: 0, Beta: 0, Gamma: 0 });
  // The library often refreshes by itself (playtime, art, game status), even while a pop-up is open.
  const refresh = () => page.evaluate(async () => update(await window.launcher.getLibrary()));
  try {
    await page.click('#new-group');
    await page.keyboard.type('Shooters');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#group-list a');
    assert.strictEqual(await page.textContent('#group-name'), 'Shooters');

    await page.click('[data-view=all]');
    await refresh();
    await page.dragAndDrop('#grid .tile >> nth=0', '#group-list a');
    await page.click('#grid .tile >> nth=2', { button: 'right' });
    await page.click('[data-action=groups]');
    await page.check('.group-picker input[type=checkbox]');
    await page.click('#modal-ok');

    await page.click('#group-list a');
    await page.waitForFunction(() => document.querySelectorAll('#grid-group .tile').length === 2);
    assert.deepStrictEqual(await tileNames(page, '#grid-group'), ['Alpha', 'Gamma']);

    await page.click('#group-rename');
    await refresh();
    await page.keyboard.type('Favourite shooters');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('group-name').textContent === 'Favourite shooters');

    await page.click('#group-delete');
    await refresh();
    await page.click('#modal-ok');
    await page.waitForFunction(() => document.querySelectorAll('#group-list a').length === 0);
    assert.strictEqual(await page.isVisible('#view-all'), true);
    assert.strictEqual((await tileNames(page)).length, 3, 'deleting a group keeps its games');
  } finally {
    await app.close();
  }
});

test('rename: new name sticks, Steam art is fetched, empty name goes back', async () => {
  const { app, page, readLibrary } = await launchWith({ SH2Proto: 0, Other: 0 });
  try {
    await page.click('#grid .tile >> nth=1'); // SH2Proto (sorted after "Other")
    await page.click('#game-rename');
    await page.keyboard.type('Silent Hill 2');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Updated the artwork'));
    assert.strictEqual(await page.textContent('#game-name'), 'Silent Hill 2');
    const cover = await page.$eval('#game-cover img', (img) => img.src);
    assert.match(cover, /2124490\/abc123\/library_600x900_2x\.jpg$/);

    const game = readLibrary().games.find((g) => g.name === 'Silent Hill 2');
    assert.strictEqual(game.originalName, 'SH2Proto');

    await page.click('#game-rename');
    await page.fill('.modal input', '');
    await page.click('#modal-ok');
    await page.waitForFunction(() => document.getElementById('game-name').textContent === 'SH2Proto');
  } finally {
    await app.close();
  }
});

test('rename: no Steam match leaves the art alone and says so', async () => {
  const { app, page } = await launchWith({ Alpha: 0 });
  try {
    await page.click('#grid .tile');
    await page.click('#game-rename');
    await page.keyboard.type('Made Up Game Name');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('no match'));
  } finally {
    await app.close();
  }
});

test('play button: Launching... blocks extra clicks, then Close game while running', async () => {
  const { app, page } = await launchWith({ Alpha: 0 });
  try {
    await page.click('#grid .tile');
    // Stand-ins for the parts that need Windows: count launches, fake the running list.
    await page.evaluate(() => {
      window.launches = 0;
      window.launcher = {
        ...window.launcher,
        launch: async () => {
          window.launches++;
        },
      };
    });
    const exe = await page.evaluate(() => document.querySelector('#grid .tile').game.exePath);
    await app.evaluate(({ BrowserWindow }, exePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('games:status', { launching: [exePath], running: [], closing: [] });
    }, exe);
    await page.waitForFunction(() => document.getElementById('play').disabled);
    assert.strictEqual(await page.textContent('#play'), 'Launching...');

    await app.evaluate(({ BrowserWindow }, exePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('games:status', { launching: [], running: [exePath], closing: [] });
    }, exe);
    await page.waitForFunction(() => document.getElementById('play').textContent.includes('Close game'));
    await page.click('#play');
    assert.match(await page.textContent('#modal-title'), /^Close Alpha\?/);
    await page.click('#modal-cancel');
    assert.strictEqual(await page.$eval('#grid .tile', (t) => t.classList.contains('is-running')), true);
  } finally {
    await app.close();
  }
});

test('colours: a theme and a custom colour apply and are saved', async () => {
  const { app, page, readLibrary } = await launchWith({ Alpha: 0 });
  try {
    await page.click('[data-view=settings]');
    // The colour box and its words open the picker; the empty space after them doesn't.
    await page.$eval('input[data-color=accent]', (el) => {
      window.pickerOpens = 0;
      el.addEventListener('click', (e) => {
        window.pickerOpens++;
        e.preventDefault(); // don't actually open it during the test
      });
    });
    await page.click('.color-row span >> nth=0');
    assert.strictEqual(await page.evaluate(() => window.pickerOpens), 1, 'clicking the words opens it');
    const list = await page.locator('#color-list').boundingBox();
    const row = await page.locator('.color-row').first().boundingBox();
    await page.mouse.click(list.x + list.width - 5, row.y + row.height / 2);
    await page.mouse.click(row.x + row.width + 40, row.y + row.height / 2);
    assert.strictEqual(await page.evaluate(() => window.pickerOpens), 1, 'empty space does nothing');
    await page.click('.theme[title=Midnight]');
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(14, 11, 24)');
    await page.$eval('input[data-color=accent]', (el) => {
      el.value = '#ff00aa';
      el.dispatchEvent(new Event('input'));
      el.dispatchEvent(new Event('change'));
    });
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--accent') === '#ff00aa');
    assert.strictEqual(readLibrary().settings.colors.accent, '#ff00aa');

    await page.click('#reset-colors');
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(20, 22, 26)');
  } finally {
    await app.close();
  }
});

test('storage: drives → Games by store → one store, with the uninstall list at every step', async () => {
  const stores = makeStores({ Epic: ['Fortnite', 'Alan Wake 2'], GOG: ['The Witcher'] }, { Fortnite: 3 * GB, 'Alan Wake 2': 9 * GB, 'The Witcher': 2 * GB });
  const root = makeGames({ Small: 1 * GB, Middle: 4 * GB });
  const { app, page } = await launch({ library: { folders: [root] }, stores });
  const rows = () => page.$$eval('.storage-row .link', (els) => els.map((e) => e.textContent));
  const legend = () => page.$$eval('.legend-label', (els) => els.map((e) => e.textContent.replace(/\s+›$/, '')));
  try {
    await page.click('[data-view=storage]');
    await page.waitForFunction(() => document.querySelector('.legend-row.clickable'));
    assert.match(await page.textContent('.legend-row.clickable'), /^Games/);
    // Every game, biggest first, with an Uninstall button, even on the first step.
    assert.deepStrictEqual(await rows(), ['Alan Wake 2', 'Middle', 'Fortnite', 'The Witcher', 'Small']);
    assert.strictEqual(await page.locator('.storage-row button.danger').count(), 5);

    // Games: one slice per store, biggest first. Folder games are "Other".
    await page.click('.legend-row.clickable');
    assert.deepStrictEqual(await legend(), ['Epic Games (2)', 'Other (2)', 'GOG (1)']);
    assert.strictEqual(await page.textContent('#ring-title'), 'Games (5)');
    assert.strictEqual((await rows()).length, 5);
    assert.strictEqual(await page.locator('.legend-row .store-badge').count(), 2, 'Epic and GOG logos, none for Other');

    // One store: just its games.
    await page.click('.legend-row >> text=Epic Games');
    assert.strictEqual(await page.textContent('#ring-title'), 'Epic Games (2)');
    assert.deepStrictEqual(await legend(), ['Alan Wake 2', 'Fortnite']);
    assert.deepStrictEqual(await rows(), ['Alan Wake 2', 'Fortnite']);
    assert.match(await page.textContent('.storage-row'), /9\.0 GB/);

    // ‹ goes back up one step at a time.
    await page.click('#ring-back');
    assert.strictEqual(await page.textContent('#ring-title'), 'Games (5)');
    await page.click('.legend-row >> text=Other');
    assert.deepStrictEqual(await rows(), ['Middle', 'Small']);
    await page.click('#ring-back');
    await page.click('#ring-back');
    assert.match(await page.textContent('.legend-row.clickable'), /^Games/);
    assert.strictEqual(await page.isHidden('#ring-back'), true);
    assert.strictEqual((await rows()).length, 5);
  } finally {
    await app.close();
  }
});

test('uninstall: a game with no uninstaller goes to the Recycle Bin after confirming', { skip: process.platform === 'linux' && !process.env.DISPLAY && 'needs a desktop' }, async () => {
  const { app, page, root } = await launchWith({ Keep: 1 * GB, Bin: 1 * GB });
  try {
    await page.click('#grid .tile >> nth=0'); // Bin
    assert.match(await page.textContent('#game-uninstall'), /Uninstall/);
    await page.click('#game-uninstall');
    await page.waitForSelector('#modal:not([hidden])');
    assert.strictEqual(await page.textContent('#modal-title'), 'Uninstall Bin?');
    assert.match(await page.textContent('#modal-body'), /Recycle Bin/);

    // Cancel first: nothing happens.
    await page.click('#modal-cancel');
    assert.ok(fs.existsSync(path.join(root, 'Bin')));

    await page.click('#game-uninstall');
    await page.click('#modal-ok');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Recycle Bin'));
    assert.ok(!fs.existsSync(path.join(root, 'Bin')), 'folder moved away');
    assert.ok(fs.existsSync(path.join(root, 'Keep')), 'other game untouched');
    assert.deepStrictEqual(await tileNames(page), ['Keep']);
  } finally {
    await app.close();
  }
});

test('rescan: finds a newly added game without restarting', async () => {
  const { app, page, root } = await launchWith({ Alpha: 0 });
  try {
    fs.mkdirSync(path.join(root, 'Newcomer'));
    fs.writeFileSync(path.join(root, 'Newcomer', 'newcomer.exe'), Buffer.alloc(300000, 1));
    await page.click('#rescan-all');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('found 1 new game'));
    assert.deepStrictEqual(await tileNames(page), ['Alpha', 'Newcomer']);
  } finally {
    await app.close();
  }
});

test('search: works from any page, ignores spaces and capitals, Enter opens the first match', async () => {
  const { app, page } = await launchWith({ Cyberpunk: 0, 'Half Life': 0, Portal: 0 });
  const visible = () => page.$$eval('#grid .tile', (els) => els.map((e) => e.querySelector('.name').textContent));
  try {
    await page.click('[data-view=settings]');
    await page.keyboard.press('Control+f');
    await page.keyboard.type('HALFLI');
    assert.strictEqual(await page.isVisible('#view-all'), true);
    assert.deepStrictEqual(await visible(), ['Half Life']);

    await page.fill('#search', 'zzz');
    assert.strictEqual(await page.isVisible('#view-all .no-match'), true);

    await page.fill('#search', 'port');
    await page.press('#search', 'Enter');
    await page.waitForFunction(() => document.getElementById('game-name').textContent === 'Portal');

    await page.click('#back');
    await page.press('#search', 'Escape');
    assert.strictEqual((await visible()).length, 3);
  } finally {
    await app.close();
  }
});

test('last played: newest first, with how long ago', async () => {
  const root = makeGames({ Alpha: 0, Beta: 0, Gamma: 0 });
  const exe = (name) => path.join(root, name, `${name}.exe`);
  const hour = 3600000;
  const { app, page } = await launch({
    library: {
      folders: [root],
      games: [
        { name: 'Alpha', exePath: exe('Alpha'), folder: root, lastPlayed: Date.now() - 3 * hour },
        { name: 'Beta', exePath: exe('Beta'), folder: root, lastPlayed: Date.now() - 26 * hour },
        { name: 'Gamma', exePath: exe('Gamma'), folder: root },
      ],
    },
  });
  try {
    await page.click('[data-view=recent]');
    const rows = await page.$$eval('#grid-recent .tile', (els) => els.map((e) => e.innerText.replace(/\n/g, ' | ')));
    assert.deepStrictEqual(rows, ['Alpha | 3 hours ago', 'Beta | yesterday']);
  } finally {
    await app.close();
  }
});

test('colours: create a named theme from your colours, use it after a restart, delete it', async () => {
  const { app, page, dataDir } = await launchWith({ Alpha: 0 });
  const pickAccent = (color) =>
    page.$eval('input[data-color=accent]', (el, c) => {
      el.value = c;
      el.dispatchEvent(new Event('input'));
      el.dispatchEvent(new Event('change'));
    }, color);
  try {
    await page.click('[data-view=settings]');
    await page.click('.theme[title=Forest]');
    await pickAccent('#ff00aa');
    await page.click('#create-theme');
    await page.keyboard.type('Pink Forest');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.theme[title="Pink Forest"]');
    assert.strictEqual(await page.$eval('.theme[title="Pink Forest"]', (b) => b.classList.contains('active')), true);

    // A built-in name can't be taken.
    await page.click('#create-theme');
    await page.keyboard.type('Midnight');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('modal-title').textContent === 'Pick another name');
    await page.click('#modal-ok');

    await page.click('#reset-colors');
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--accent') === '#3b82f6');
  } finally {
    await app.close();
  }

  const again = await launch({ dataDir, library: null });
  const p = again.page;
  try {
    await p.click('[data-view=settings]');
    await p.click('.theme[title="Pink Forest"]');
    await p.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--accent') === '#ff00aa');
    assert.strictEqual(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(14, 21, 17)'); // Forest background

    await p.hover('.theme-wrap');
    await p.click('.theme-delete');
    await p.click('#modal-ok');
    await p.waitForFunction(() => !document.querySelector('.theme[title="Pink Forest"]'));
    assert.strictEqual(
      await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent')),
      '#ff00aa',
      'deleting a theme keeps the colours you have on'
    );
  } finally {
    await again.app.close();
  }
});

test('stores: a tab and a logo for each store, both can be switched off, and that is remembered', async () => {
  const stores = makeStores({ Steam: ['Portal 2'], Epic: ['Fortnite'], GOG: ['The Witcher'], EA: ['Apex Legends'], Ubisoft: ['Far Cry 6'], Xbox: ['Sea of Thieves'] });
  const root = makeGames({ Celeste: 0 });
  const { app, page, dataDir } = await launch({ library: { folders: [root] }, stores });
  const tabs = () => page.$$eval('#store-list a', (els) => els.map((e) => e.textContent));
  try {
    assert.deepStrictEqual(await tabs(), ['Steam1', 'Epic Games1', 'GOG1', 'EA app1', 'Ubisoft Connect1', 'Xbox1', 'Other1']);
    // A logo on every store game, none on the game from a folder.
    const badges = await page.$$eval('#grid .tile', (tiles) => tiles.map((t) => t.querySelector('.store-badge')?.title || '-'));
    assert.deepStrictEqual(badges, ['EA app', '-', 'Ubisoft Connect', 'Epic Games', 'Steam', 'Xbox', 'GOG']);

    // A store's tab shows just its games, and Back from a game returns to it.
    await page.click('#store-list a[data-store=Epic]');
    assert.strictEqual(await page.textContent('#store-name'), 'Epic Games');
    assert.deepStrictEqual(await tileNames(page, '#grid-store'), ['Fortnite']);
    await page.click('#grid-store .tile');
    assert.strictEqual(await page.isVisible('#game-cover .store-badge'), true, 'logo on the game page too');
    assert.strictEqual(await page.locator('#store-list a.active').count(), 0, 'no tab lit up on a game page');
    await page.click('#back');
    assert.deepStrictEqual(await tileNames(page, '#grid-store'), ['Fortnite']);
    await page.click('#store-list a[data-store=Other]');
    assert.deepStrictEqual(await tileNames(page, '#grid-store'), ['Celeste']);

    // Switching the tabs off while one is open goes back to All games.
    await page.click('[data-view=settings]');
    await page.click('#store-list a[data-store=Xbox]');
    await page.click('[data-view=settings]');
    assert.strictEqual(await page.locator('#store-list a.active').count(), 0, 'no tab lit up on Settings');
    await page.uncheck('#set-storeTabs');
    await page.waitForFunction(() => !document.querySelector('#store-list a'));
    assert.strictEqual(await page.isHidden('#stores-heading'), true);
    await page.uncheck('#set-storeLogos');
    await page.waitForFunction(() => !document.querySelector('#grid .store-badge'));
  } finally {
    await app.close();
  }

  const again = await launch({ dataDir, library: null, stores });
  try {
    assert.deepStrictEqual(await again.page.$$eval('#store-list a', (els) => els.length), 0);
    assert.strictEqual(await again.page.locator('#grid .store-badge').count(), 0);
    await again.page.click('[data-view=settings]');
    assert.strictEqual(await again.page.isChecked('#set-storeTabs'), false);
    await again.page.check('#set-storeTabs');
    await again.page.check('#set-storeLogos');
    await again.page.waitForSelector('#store-list a');
    await again.page.waitForSelector('#grid .store-badge', { state: 'attached' });
  } finally {
    await again.app.close();
  }
});

test('stores: a store game is never binned; it says how to uninstall it in the store', async () => {
  const stores = makeStores({ Epic: ['Fortnite'] });
  const { app, page } = await launch({ stores });
  try {
    await page.click('#grid .tile');
    await page.click('#game-uninstall');
    await page.waitForSelector('#modal:not([hidden])');
    assert.strictEqual(await page.textContent('#modal-title'), 'Uninstall Fortnite from its store');
    assert.match(await page.textContent('#modal-body'), /Epic Games Launcher/);
    await page.click('#modal-ok');
    const result = await page.evaluate(() => window.launcher.uninstall(currentGame));
    assert.strictEqual(result.ok, false);
    assert.ok(fs.existsSync(JSON.parse(fs.readFileSync(stores, 'utf8')).manifests), 'nothing removed');
    assert.deepStrictEqual(await tileNames(page), ['Fortnite']);
  } finally {
    await app.close();
  }
});

test('stores: a game already in the library keeps its playtime when a store finds it', async () => {
  const stores = makeStores({ GOG: ['The Witcher'] });
  const exePath = path.join(path.dirname(stores), 'GOG', 'The Witcher', 'TheWitcher.exe');
  const sessions = [[Date.now() - 3600000, Date.now()]];
  const { app, page, readLibrary } = await launch({
    library: { folders: [path.join(path.dirname(stores), 'GOG')], games: [{ name: 'The Witcher', exePath, folder: 'x', sessions, favourite: true }] },
    stores,
  });
  try {
    const games = readLibrary().games;
    assert.strictEqual(games.length, 1, 'not listed twice');
    assert.strictEqual(games[0].folder, 'GOG');
    assert.deepStrictEqual(games[0].sessions, sessions);
    assert.strictEqual(games[0].favourite, true);
  } finally {
    await app.close();
  }
});

// Pretend GitHub: says the newest launcher is version 9.0.0.
const FAKE_GITHUB = `globalThis.fetch = async () => ({ ok: true, url: 'https://github.com/x/releases/tag/v9.0.0' });`;

test('updates: says when a new version is out, Later hides it, Download opens the page', async () => {
  const { app, page } = await launch();
  try {
    await page.click('[data-view=settings]');
    assert.strictEqual(await page.textContent('#app-version'), require('../package.json').version);
    assert.strictEqual(await page.isChecked('#set-autoUpdateCheck'), true);
    assert.strictEqual(await page.isHidden('#update-bar'), true);

    await app.evaluate((_electron, code) => (0, eval)(code), FAKE_GITHUB);
    // Remember web pages the launcher asks to open, instead of opening them.
    await app.evaluate(({ shell }) => {
      globalThis.opened = [];
      shell.openExternal = async (url) => globalThis.opened.push(url);
    });
    await page.click('#update-check');
    await page.waitForSelector('#update-bar:not([hidden])');
    assert.match(await page.textContent('#update-text'), /Version 9\.0\.0/);
    assert.match(await page.textContent('#update-status'), /9\.0\.0 is out/);
    // Run from the code (like the portable zip), so it can't install itself.
    assert.strictEqual(await page.textContent('#update-go'), 'Download');

    await page.click('#update-go');
    await page.click('#update-notes');
    assert.deepStrictEqual(await app.evaluate(() => globalThis.opened), ['https://github.com/x/releases/tag/v9.0.0', 'https://github.com/x/releases/tag/v9.0.0']);

    await page.click('#update-later');
    assert.strictEqual(await page.isHidden('#update-bar'), true);

    // Up to date: no bar.
    await app.evaluate(() => (globalThis.fetch = async () => ({ ok: true, url: 'https://github.com/x/releases/tag/v1.0.0' })));
    await page.click('#update-check');
    await page.waitForFunction(() => document.getElementById('update-status').textContent.includes('up to date'));

    // Offline: says so, doesn't crash.
    await app.evaluate(() => (globalThis.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com'); }));
    await page.click('#update-check');
    await page.waitForFunction(() => document.getElementById('update-status').textContent.includes("Couldn't check"));

    await page.uncheck('#set-autoUpdateCheck');
    await page.waitForFunction(async () => (await window.launcher.getLibrary()).settings.autoUpdateCheck === false);
  } finally {
    await app.close();
  }
});

test('light theme: game names on tiles can be read', async () => {
  const { app, page } = await launchWith({ Alpha: 0 });
  try {
    await page.click('[data-view=settings]');
    await page.click('.theme[title=Light]');
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(238, 240, 244)');
    const colours = await page.$eval('#grid .tile', (tile) => [getComputedStyle(tile.querySelector('.name')).color, getComputedStyle(tile).backgroundColor]);
    assert.deepStrictEqual(colours, ['rgb(31, 35, 40)', 'rgb(255, 255, 255)'], 'dark text on a white tile');
  } finally {
    await app.close();
  }
});

test("xbox: a game with no art from 1.1.0 gets the logo from its own files", async () => {
  const stores = makeStores({ Xbox: ['Roblox'] });
  const fake = JSON.parse(fs.readFileSync(stores, 'utf8')).xboxPackages[0];
  const exePath = path.join(fake.dir, 'Roblox.exe');
  // Saved by 1.1.0, which found nothing for it.
  const art = { appId: null, cover: null, hero: null, logo: null, header: null };
  const { app, page, readLibrary } = await launch({ library: { games: [{ name: 'Roblox', exePath, folder: 'Xbox', art }] }, stores });
  try {
    await page.waitForFunction(() => document.querySelector('#grid .tile .art img'));
    const saved = readLibrary().games[0].art;
    assert.strictEqual(saved.header, path.join(fake.dir, 'Logo.scale-200.png'));
    assert.match(await page.getAttribute('#grid .tile .art img', 'src'), /^data:image\/png;base64,/);
  } finally {
    await app.close();
  }
});

test("xbox: the game page shows playtime even when Windows won't let the launcher read the game's EXE", async () => {
  const stores = makeStores({ Xbox: ['Roblox'] });
  // Xbox games live in a locked folder (WindowsApps), so the EXE can't be opened.
  const fake = JSON.parse(fs.readFileSync(stores, 'utf8'));
  fake.xboxPackages[0].config = fake.xboxPackages[0].config.replace('Roblox.exe', 'Locked.exe');
  fs.writeFileSync(stores, JSON.stringify(fake));
  const exePath = path.join(fake.xboxPackages[0].dir, 'Locked.exe');
  const sessions = [[Date.now() - 2 * 3600000, Date.now() - 3600000]];
  const { app, page } = await launch({ library: { games: [{ name: 'Roblox', exePath, folder: 'Xbox', sessions, art: { v: 2 } }] }, stores });
  try {
    await page.click('#grid .tile');
    await page.waitForFunction(() => document.getElementById('period-total').textContent !== '', null, { timeout: 5000 });
    assert.strictEqual(await page.textContent('#period-total'), await page.evaluate(() => formatDuration(3600000)));
    assert.strictEqual(await page.textContent('#game-total'), await page.evaluate(() => formatDuration(3600000)));
    assert.strictEqual(await page.locator('#chart .col').count(), 7);
  } finally {
    await app.close();
  }
});

test('uninstall: Ubisoft games uninstall through Ubisoft Connect after confirming', async () => {
  const stores = makeStores({ Ubisoft: ['Star Wars Outlaws'] });
  const { app, page } = await launch({ stores });
  try {
    await app.evaluate(({ shell }) => {
      globalThis.opened = [];
      shell.openExternal = async (url) => globalThis.opened.push(url);
    });
    await page.click('#grid .tile');
    await page.click('#game-uninstall');
    await page.waitForSelector('#modal:not([hidden])');
    assert.strictEqual(await page.textContent('#modal-title'), 'Uninstall Star Wars Outlaws?');
    assert.match(await page.textContent('#modal-body'), /Ubisoft Connect will open/);
    await page.click('#modal-cancel');
    assert.deepStrictEqual(await app.evaluate(() => globalThis.opened), [], 'Cancel does nothing');

    await page.click('#game-uninstall');
    await page.click('#modal-ok');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('disappear from the launcher'));
    assert.deepStrictEqual(await app.evaluate(() => globalThis.opened), ['uplay://uninstall/200']);
  } finally {
    await app.close();
  }
});

test('uninstall: Xbox games are removed by Windows after confirming, and a failure is explained', async () => {
  const stores = makeStores({ Xbox: ['Roblox'] });
  const { app, page } = await launch({ stores });
  try {
    await page.click('#grid .tile');
    await page.click('#game-uninstall');
    await page.waitForSelector('#modal:not([hidden])');
    assert.strictEqual(await page.textContent('#modal-title'), 'Uninstall Roblox?');
    assert.match(await page.textContent('#modal-body'), /Windows will uninstall it/);
    await page.click('#modal-ok');
    // This test machine isn't Windows, so removing it fails: that must be said plainly.
    await page.waitForFunction(() => document.getElementById('modal-title').textContent === "Couldn't uninstall");
    assert.match(await page.textContent('#modal-body'), process.platform === 'win32' ? /Windows/ : /Only works on Windows/);
    await page.click('#modal-ok');
    assert.deepStrictEqual(await tileNames(page), ['Roblox']);
  } finally {
    await app.close();
  }
});
