// Tests that start the real launcher and click through it like a person would.
// Each test gets its own pretend games and library, so nothing real is touched.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeGames, launch, tileNames, tempDir } = require('./helpers');

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

test('storage: ring shows games, clicking Games lists each game biggest first', async () => {
  const { app, page } = await launchWith({ Small: 1 * GB, Huge: 9 * GB, Middle: 4 * GB });
  try {
    await page.click('[data-view=storage]');
    await page.waitForFunction(() => document.querySelector('.legend-row.clickable'));
    assert.match(await page.textContent('.legend-row.clickable'), /^Games/);
    assert.strictEqual(await page.isHidden('#storage-list'), true);

    await page.click('.legend-row.clickable');
    await page.waitForSelector('.storage-row');
    const rows = await page.$$eval('.storage-row .link', (els) => els.map((e) => e.textContent));
    assert.deepStrictEqual(rows, ['Huge', 'Middle', 'Small']);
    assert.match(await page.textContent('.storage-row'), /9\.0 GB/);

    await page.click('#ring-back');
    assert.strictEqual(await page.isHidden('#storage-list'), true);
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
