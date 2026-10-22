// Everything you see in the window: the game grid, game pages, the folder list and menus.
const $ = (id) => document.getElementById(id);

let library = { folders: [], games: [], groups: [] };
let menuGame = null;
let currentGame = null; // exePath of the game whose page is open
let period = 'week';
let listView = 'all'; // the list a game page was opened from, for the Back button
let currentGroup = null; // id of the group being shown
let currentStore = null; // which store's tab is being shown, e.g. 'Epic'
let currentView = 'all'; // the page being shown
let status = { launching: [], running: [], closing: [] }; // which games are starting, running or closing

// ---------- Views ----------

// id: which group or store, for those views.
function showView(name, id) {
  if (name === 'group') currentGroup = id ?? currentGroup;
  if (name === 'store') currentStore = id ?? currentStore;
  currentView = name;
  const isShown = (a) =>
    a.dataset.view === name &&
    (name === 'group' ? a.dataset.group === currentGroup : name === 'store' ? a.dataset.store === currentStore : true);
  document.querySelectorAll('[data-view]').forEach((a) => a.classList.toggle('active', isShown(a)));
  document.querySelectorAll('main > section').forEach((s) => (s.hidden = s.id !== `view-${name}`));
  if (name !== 'game') currentGame = null;
  if (['all', 'favourites', 'recent', 'group', 'store'].includes(name)) listView = name;
  if (name === 'group') renderGroupPage();
  if (name === 'store') renderStorePage();
  if (name === 'storage') scanStorage(false);
  document.querySelector('main').scrollTop = 0;
}

document.querySelector('.sidebar').addEventListener('click', (e) => {
  const link = e.target.closest('[data-view]');
  if (link) showView(link.dataset.view, link.dataset.group || link.dataset.store);
});

// ---------- Art ----------

// Images are fetched from the main process once and remembered here.
const imageCache = new Map();
async function loadImage(source) {
  if (!source) return null;
  if (!imageCache.has(source)) imageCache.set(source, window.launcher.getImage(source));
  return imageCache.get(source);
}
async function loadIcon(exePath) {
  const key = `icon:${exePath}`;
  if (!imageCache.has(key)) imageCache.set(key, window.launcher.getIcon(exePath));
  return imageCache.get(key);
}

// Fills a box with the best art we have for a game.
// Tall Steam cover art fills the whole box. Anything else (a wide Steam
// header or the EXE icon) is shown big over a blurred copy of itself.
async function setArt(box, game) {
  const art = game.art || {};
  const cover = await loadImage(art.cover);
  const other = cover ? null : (await loadImage(art.header)) || (await loadIcon(game.exePath));
  const src = cover || other;
  const key = `${src}`;
  if (box.dataset.src === key) return;
  box.dataset.src = key;
  // The store logo in the corner stays put when the art changes.
  box.replaceChildren(...box.querySelectorAll(':scope > .store-badge'));
  box.className = box.className.replace(/\s*(fill|fit|no-art)/g, '');

  if (!src) return box.classList.add('no-art');
  if (cover) {
    box.classList.add('fill');
    box.append(img(cover));
  } else {
    box.classList.add('fit');
    box.append(img(src, 'blur'), img(src, 'front'));
  }
}

function img(src, className = '') {
  const el = document.createElement('img');
  el.src = src;
  el.alt = '';
  el.className = className;
  el.draggable = false;
  return el;
}

// ---------- Stores ----------

// Where each game came from. Games from folders the user added are "Other".
const STORES = {
  Steam: { name: 'Steam', ring: '#66c0f4' },
  Epic: { name: 'Epic Games', ring: '#a3a3a3' },
  GOG: { name: 'GOG', ring: '#a855f7' },
  EA: { name: 'EA app', ring: '#ef4444' },
  Ubisoft: { name: 'Ubisoft Connect', ring: '#2563eb' },
  Xbox: { name: 'Xbox', ring: '#22c55e' },
  Other: { name: 'Other', ring: '#eab308' },
};
const storeOf = (game) => (STORE_LOGOS[game.folder] ? game.folder : 'Other');
const setting = (name) => library.settings?.[name] !== false; // on unless switched off

// The store's logo, as a small round badge.
function storeLogo(store) {
  const logo = STORE_LOGOS[store];
  const badge = document.createElement('span');
  badge.className = 'store-badge';
  badge.title = STORES[store].name;
  badge.style.background = logo.color;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const shape = document.createElementNS(ns, 'path');
  shape.setAttribute('d', logo.path);
  svg.append(shape);
  badge.append(svg);
  return badge;
}

// Puts the store's logo in the corner of a game's art (if switched on).
function setBadge(box, game) {
  const store = storeOf(game);
  const old = box.querySelector(':scope > .store-badge');
  const wanted = setting('storeLogos') && store !== 'Other' ? store : null;
  if ((old?.dataset.store || null) === wanted) return;
  old?.remove();
  if (!wanted) return;
  const badge = storeLogo(wanted);
  badge.dataset.store = wanted;
  box.append(badge);
}

// ---------- Game grid ----------

// Each grid keeps its own tiles (exePath → tile), so redraws don't reload art.
const gridTiles = new Map();

// Draws a list of games as tiles in a grid.
// note: optional function that gives a small line of text under the name.
function renderGrid(grid, allGames, note) {
  const games = allGames.filter(matchesSearch);
  // Says so when a search hides every game in this list.
  let noMatch = grid.nextElementSibling;
  if (!noMatch?.classList.contains('no-match')) {
    noMatch = document.createElement('p');
    noMatch.className = 'no-match muted';
    grid.after(noMatch);
  }
  noMatch.hidden = !(allGames.length > 0 && games.length === 0);
  noMatch.textContent = `No games here match "${$('search').value.trim()}".`;

  if (!gridTiles.has(grid)) gridTiles.set(grid, new Map());
  const tiles = gridTiles.get(grid);

  const shown = [];
  for (const game of games) {
    let tile = tiles.get(game.exePath);
    if (!tile) {
      tile = document.createElement('button');
      tile.className = 'tile';
      const art = document.createElement('div');
      art.className = 'art';
      const star = document.createElement('span');
      star.className = 'star';
      star.textContent = '★';
      const name = document.createElement('span');
      name.className = 'name';
      const sub = document.createElement('span');
      sub.className = 'sub muted';
      tile.append(art, star, name, sub);
      tile.addEventListener('click', () => openGame(tile.game));
      tile.addEventListener('contextmenu', (e) => openMenu(e, tile.game));
      // Tiles can be dragged onto a group in the sidebar.
      tile.draggable = true;
      tile.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/x-game', tile.game.exePath));
      tiles.set(game.exePath, tile);
    }
    tile.game = game;
    tile.title = game.name;
    tile.classList.toggle('is-favourite', !!game.favourite);
    tile.classList.toggle('is-running', status.running.includes(game.exePath));
    tile.querySelector('.name').textContent = game.name;
    const sub = tile.querySelector('.sub');
    sub.textContent = note ? note(game) : '';
    sub.hidden = !note;
    setArt(tile.querySelector('.art'), game);
    setBadge(tile.querySelector('.art'), game);
    shown.push(tile);
  }
  grid.replaceChildren(...shown);
}

function renderGames() {
  renderGrid($('grid'), library.games);
  $('empty').hidden = library.games.length > 0;

  const favourites = library.games.filter((g) => g.favourite);
  renderGrid($('grid-favourites'), favourites);
  $('empty-favourites').hidden = favourites.length > 0;

  const recent = library.games.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed);
  renderGrid($('grid-recent'), recent, (g) => timeAgo(g.lastPlayed));
  $('empty-recent').hidden = recent.length > 0;

  renderGroupList();
  renderGroupPage();
  renderStoreList();
  renderStorePage();
}

// ---------- Store tabs ----------

// Stores that have games, in a fixed order. "Other" only shows next to a real store.
function storesWithGames() {
  const stores = Object.keys(STORES).filter((store) => library.games.some((g) => storeOf(g) === store));
  return stores.some((s) => s !== 'Other') ? stores : [];
}

function renderStoreList() {
  const stores = setting('storeTabs') ? storesWithGames() : [];
  $('stores-heading').hidden = stores.length === 0;
  $('store-list').replaceChildren(
    ...stores.map((store) => {
      const link = document.createElement('a');
      link.dataset.view = 'store';
      link.dataset.store = store;
      link.classList.toggle('active', currentView === 'store' && currentStore === store);
      const name = document.createElement('span');
      name.className = 'store-link';
      if (store !== 'Other') name.append(storeLogo(store));
      name.append(STORES[store].name);
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = library.games.filter((g) => storeOf(g) === store).length;
      link.append(name, count);
      return link;
    })
  );
}

function renderStorePage() {
  if (listView !== 'store' || $('view-store').hidden) return;
  // The tab went away (switched off in Settings, or its last game was removed).
  if (!setting('storeTabs') || !storesWithGames().includes(currentStore)) return showView('all');
  $('store-name').textContent = STORES[currentStore].name;
  renderGrid($('grid-store'), library.games.filter((g) => storeOf(g) === currentStore));
}

// "just now", "5 minutes ago", "yesterday", "3 days ago", or a date.
function timeAgo(time) {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(time).toLocaleDateString();
}

async function renameGame(game) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = game.name;
  input.maxLength = 100;
  input.placeholder = game.originalName || game.name;
  const body = document.createElement('div');
  body.append(input);
  if (game.originalName) body.append(textBlock(`Found as "${game.originalName}". Leave the box empty to go back to that.`));
  if (!(await openModal('Rename game', body, 'Save'))) return;
  update(await window.launcher.rename(game.exePath, input.value));
  if (game.appId) return; // Steam games already have Steam's art.
  const renamed = library.games.find((g) => g.exePath === game.exePath);
  toast(`Searching Steam for "${renamed.name}" artwork...`);
  const found = await window.launcher.refreshArt(game.exePath);
  toast(found ? 'Updated the artwork from Steam.' : `Steam has no match for "${renamed.name}", so the art stays the same.`, 4000);
}

// A short message at the bottom of the window.
let toastTimer;
function toast(text, ms) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => (el.hidden = true), ms);
}

async function toggleFavourite(game) {
  update(await window.launcher.toggleFavourite(game.exePath));
}

// ---------- Search ----------

// Ignores capitals, spaces and punctuation, so "halfli" finds "Half-Life".
const squash = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');
function matchesSearch(game) {
  const words = $('search').value.toLowerCase().split(/\s+/).map(squash).filter(Boolean);
  const name = squash(game.name);
  return words.every((word) => name.includes(word));
}

$('search').addEventListener('input', () => {
  // Searching from a page without a game list jumps to All games.
  if (!['all', 'favourites', 'recent', 'group'].includes(visibleView())) showView('all');
  renderGames();
});

$('search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('search').value = '';
    renderGames();
    $('search').blur();
  }
  // Enter opens the first game found.
  if (e.key === 'Enter') {
    const first = document.querySelector('main > section:not([hidden]) .grid .tile');
    if (first) openGame(first.game);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    $('search').focus();
    $('search').select();
  }
});

const visibleView = () => document.querySelector('main > section:not([hidden])')?.id.replace('view-', '');

// 'launching', 'running', 'closing' or 'idle'
function gameState(exePath) {
  if (status.closing.includes(exePath)) return 'closing';
  if (status.running.includes(exePath)) return 'running';
  if (status.launching.includes(exePath)) return 'launching';
  return 'idle';
}

async function launch(game) {
  if (gameState(game.exePath) !== 'idle') return;
  await window.launcher.launch(game.exePath);
}

async function closeRunningGame(game) {
  const ok = await openModal(
    `Close ${game.name}?`,
    textBlock('Anything you haven\'t saved in the game may be lost.'),
    'Close game'
  );
  if (ok) window.launcher.close(game.exePath);
}

// The Play button changes to Launching..., then Close game while the game runs.
function renderPlayButton() {
  const game = pageGame();
  if (!game) return;
  const button = $('play');
  const state = gameState(game.exePath);
  button.textContent = { idle: '▶ Play', launching: 'Launching...', running: '■ Close game', closing: 'Closing...' }[state];
  button.disabled = state === 'launching' || state === 'closing';
  button.classList.toggle('running', state === 'running');
}

function setStatus(text) {
  $('status').textContent = text;
}

// ---------- Game page ----------

function openGame(game) {
  currentGame = game.exePath;
  showView('game');
  renderGamePage();
}

async function renderGamePage() {
  const game = library.games.find((g) => g.exePath === currentGame);
  if (!game) return showView('all');
  const art = game.art || {};

  $('game-name').textContent = game.name;
  $('game-fav').textContent = game.favourite ? '★ Favourite' : '☆ Favourite';
  $('game-fav').classList.toggle('on', !!game.favourite);
  $('game-last').textContent = game.lastPlayed ? new Date(game.lastPlayed).toLocaleString() : 'Never';
  $('game-total').textContent = formatDuration(totalPlaytime(game.sessions));
  $('game-size').textContent = game.size ? formatSize(game.size) : 'Not worked out yet';
  $('game-uninstall').textContent = game.size ? `Uninstall (${formatSize(game.size)})` : 'Uninstall';
  setArt($('game-cover'), game);
  setBadge($('game-cover'), game);

  // Banner: Steam's wide hero art, or the best art we have, blurred.
  const heroArt = document.querySelector('.hero-art');
  const hero = await loadImage(art.hero);
  if (hero) {
    if (heroArt.dataset.src !== hero) {
      heroArt.className = 'hero-art';
      heroArt.replaceChildren(img(hero));
      heroArt.dataset.src = hero;
    }
  } else {
    heroArt.className = 'hero-art';
    await setArt(heroArt, game);
    heroArt.classList.add('hero-fallback');
  }

  // Steam's title logo sits over the banner when there is one.
  const logo = hero && (await loadImage(art.logo));
  $('hero-logo').hidden = !logo;
  if (logo) $('hero-logo').src = logo;

  renderPlayButton();
  renderPlaytime(game);
}

function renderPlaytime(game) {
  const buckets = playtimeByPeriod(game.sessions, period);
  const total = buckets.reduce((sum, b) => sum + b.ms, 0);
  const max = Math.max(...buckets.map((b) => b.ms), 1);
  const labels = { week: 'in the last 7 days', month: 'in the last 30 days', year: 'in the last 12 months' };

  $('period-total').textContent = formatDuration(total);
  $('period-label').textContent = labels[period];

  const chart = $('chart');
  chart.className = `chart ${period}`;
  chart.replaceChildren(
    ...buckets.map((b, i) => {
      const col = document.createElement('div');
      col.className = 'col';
      col.title = `${b.start.toLocaleDateString()}: ${formatDuration(b.ms)}`;
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.height = `${(b.ms / max) * 100}%`;
      const label = document.createElement('span');
      // On the month view only every 5th day is labelled so they don't overlap.
      label.textContent = period === 'month' && (buckets.length - 1 - i) % 5 !== 0 ? '' : b.label;
      col.append(bar, label);
      return col;
    })
  );
}

$('period-tabs').addEventListener('click', (e) => {
  if (!e.target.dataset.period) return;
  period = e.target.dataset.period;
  document.querySelectorAll('#period-tabs button').forEach((b) => b.classList.toggle('active', b === e.target));
  const game = library.games.find((g) => g.exePath === currentGame);
  if (game) renderPlaytime(game);
});

const pageGame = () => library.games.find((g) => g.exePath === currentGame);
$('back').addEventListener('click', () => showView(listView));
$('play').addEventListener('click', () => {
  const game = pageGame();
  if (!game) return;
  if (gameState(game.exePath) === 'running') closeRunningGame(game);
  else launch(game);
});
$('game-fav').addEventListener('click', () => pageGame() && toggleFavourite(pageGame()));
$('game-uninstall').addEventListener('click', () => pageGame() && uninstallGame(pageGame()));
$('game-rename').addEventListener('click', () => pageGame() && renameGame(pageGame()));
$('game-groups').addEventListener('click', () => pageGame() && pickGroups(pageGame()));
$('game-folder').addEventListener('click', () => pageGame() && window.launcher.showInFolder(currentGame));
$('game-hide').addEventListener('click', async () => {
  if (!pageGame()) return;
  update(await window.launcher.hide(currentGame));
  showView(listView);
});

// ---------- Right-click menu ----------

function openMenu(event, game) {
  event.preventDefault();
  menuGame = game;
  const menu = $('menu');
  const state = gameState(game.exePath);
  const play = menu.querySelector('[data-action="launch"]');
  play.textContent = { idle: 'Play', launching: 'Launching...', running: 'Close game', closing: 'Closing...' }[state];
  play.disabled = state === 'launching' || state === 'closing';
  menu.querySelector('[data-action="favourite"]').textContent = game.favourite ? 'Remove from favourites' : 'Add to favourites';
  menu.hidden = false;
  menu.style.left = `${Math.min(event.clientX, innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${Math.min(event.clientY, innerHeight - menu.offsetHeight - 8)}px`;
}

document.addEventListener('click', () => ($('menu').hidden = true));

$('menu').addEventListener('click', async (e) => {
  const action = e.target.dataset.action;
  if (!action || !menuGame) return;
  if (action === 'open') openGame(menuGame);
  if (action === 'launch') gameState(menuGame.exePath) === 'running' ? closeRunningGame(menuGame) : launch(menuGame);
  if (action === 'favourite') toggleFavourite(menuGame);
  if (action === 'groups') pickGroups(menuGame);
  if (action === 'rename') renameGame(menuGame);
  if (action === 'uninstall') uninstallGame(menuGame);
  if (action === 'folder') window.launcher.showInFolder(menuGame.exePath);
  if (action === 'hide') update(await window.launcher.hide(menuGame.exePath));
});

// ---------- Groups ----------

// The library is replaced every time it refreshes, so always look a group up
// again by its id after waiting on anything, never keep hold of an old copy.
const groupById = (id) => library.groups.find((g) => g.id === id);
const gamesInGroup = (group) => library.games.filter((g) => group.games.includes(g.exePath));

async function saveGroups() {
  update(await window.launcher.saveGroups(library.groups));
}

function renderGroupList() {
  const list = $('group-list');
  list.replaceChildren(
    ...library.groups.map((group) => {
      const link = document.createElement('a');
      link.dataset.view = 'group';
      link.dataset.group = group.id;
      link.classList.toggle('active', currentView === 'group' && currentGroup === group.id);
      const name = document.createElement('span');
      name.textContent = group.name;
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = gamesInGroup(group).length;
      link.append(name, count);
      // Dropping a dragged game tile here adds it to the group.
      link.addEventListener('dragover', (e) => {
        if (!e.dataTransfer.types.includes('text/x-game')) return;
        e.preventDefault();
        link.classList.add('drop');
      });
      link.addEventListener('dragleave', () => link.classList.remove('drop'));
      link.addEventListener('drop', (e) => {
        e.preventDefault();
        link.classList.remove('drop');
        const exePath = e.dataTransfer.getData('text/x-game');
        const target = groupById(link.dataset.group);
        if (exePath && target && !target.games.includes(exePath)) {
          target.games.push(exePath);
          saveGroups();
        }
      });
      return link;
    })
  );
}

function renderGroupPage() {
  if (listView !== 'group') return;
  const group = groupById(currentGroup);
  if (!group) return showView('all');
  $('group-name').textContent = group.name;
  const games = gamesInGroup(group);
  renderGrid($('grid-group'), games);
  $('empty-group').hidden = games.length > 0;
}

async function newGroup() {
  const name = await askName('New group', '');
  if (!name) return null;
  const group = { id: `g${Date.now()}`, name, games: [] };
  library.groups.push(group);
  await saveGroups();
  return group;
}

$('new-group').addEventListener('click', async () => {
  const group = await newGroup();
  if (group) showView('group', group.id);
});

$('group-rename').addEventListener('click', async () => {
  const id = currentGroup;
  const name = groupById(id) && (await askName('Rename group', groupById(id).name));
  if (!name || !groupById(id)) return;
  groupById(id).name = name;
  saveGroups();
});

$('group-delete').addEventListener('click', async () => {
  const id = currentGroup;
  const group = groupById(id);
  if (!group) return;
  const ok = await openModal('Delete group?', textBlock(`"${group.name}" will be deleted. The games in it stay in your library.`), 'Delete');
  if (!ok) return;
  library.groups = library.groups.filter((g) => g.id !== id);
  showView('all');
  saveGroups();
});

// Lets you tick which groups a game is in, or make a new group for it.
async function pickGroups(game) {
  const body = document.createElement('div');
  body.className = 'group-picker';
  const boxes = new Map(); // group id → its tick box
  library.groups.forEach((group) => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = group.games.includes(game.exePath);
    label.append(box, group.name);
    body.append(label);
    boxes.set(group.id, box);
  });
  if (library.groups.length === 0) body.append(textBlock('You have no groups yet. Make one below.'));
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'New group name (optional)';
  input.maxLength = 60;
  body.append(input);

  if (!(await openModal(`Groups for ${game.name}`, body, 'Save'))) return;
  for (const group of library.groups) {
    const box = boxes.get(group.id);
    if (!box) continue; // made while the pop-up was open
    const has = group.games.includes(game.exePath);
    if (box.checked && !has) group.games.push(game.exePath);
    if (!box.checked && has) group.games = group.games.filter((p) => p !== game.exePath);
  }
  const name = input.value.trim();
  if (name) library.groups.push({ id: `g${Date.now()}`, name, games: [game.exePath] });
  saveGroups();
}

// ---------- Pop-up boxes ----------

function textBlock(text) {
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = text;
  return p;
}

// Shows a pop-up. Resolves true for OK, false for Cancel.
// With onlyOk, there is no Cancel button (for messages that just need reading).
function openModal(title, body, okText = 'OK', onlyOk = false) {
  $('modal-cancel').hidden = onlyOk;
  $('modal-title').textContent = title;
  $('modal-body').replaceChildren(body);
  $('modal-ok').textContent = okText;
  $('modal').hidden = false;
  const first = body.matches('input') ? body : body.querySelector('input[type=text]');
  if (first) first.select();
  else $('modal-ok').focus();
  return new Promise((resolve) => {
    const close = (result) => {
      $('modal').hidden = true;
      $('modal-box').onsubmit = $('modal-cancel').onclick = $('modal').onkeydown = null;
      resolve(result);
    };
    $('modal-box').onsubmit = (e) => {
      e.preventDefault();
      close(true);
    };
    $('modal-cancel').onclick = () => close(false);
    $('modal').onkeydown = (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter' && e.target.type === 'text') {
        e.preventDefault();
        close(true);
      }
    };
  });
}

// Asks for a name. Resolves the name, or null if cancelled or left empty.
async function askName(title, initial) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = initial;
  input.maxLength = 60;
  input.placeholder = 'Group name';
  const ok = await openModal(title, input, 'Save');
  return (ok && input.value.trim()) || null;
}

// ---------- Storage ----------

let driveList = [];

// 1536000000 → "1.4 GB"
function formatSize(bytes) {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${i === 0 ? bytes : bytes.toFixed(bytes < 10 ? 1 : 0)} ${units[i]}`;
}

// "C:\\Games\\Foo" → "C:\\"
const driveOf = (dir) => (/^[a-z]:\\/i.test(dir) ? dir.slice(0, 3).toUpperCase() : '/');

async function scanStorage(recalculate) {
  $('storage-status').textContent = 'Working out sizes... big games can take a moment.';
  $('storage-recalc').disabled = true;
  driveList = await window.launcher.scanStorage(recalculate);
  $('storage-status').textContent = '';
  $('storage-recalc').disabled = false;
  renderStorage();
}

$('storage-recalc').addEventListener('click', () => scanStorage(true));

// The ring has three levels: whole drives → Games split by store → one store's games.
let ringMode = 'overview'; // 'overview', 'games' or 'store'
let ringStore = null; // the store shown in 'store' mode

// Colours for game slices; anything past these is grouped as "Other games".
const SLICE_COLORS = ['#3b82f6', '#a855f7', '#ec4899', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#6366f1'];

// ‹ goes up one level.
$('ring-back').addEventListener('click', () => {
  ringMode = ringMode === 'store' ? 'games' : 'overview';
  renderStorage();
});

function renderStorage() {
  const bySize = (a, b) => (b.size || 0) - (a.size || 0);
  const sizeOf = (list) => list.reduce((sum, g) => sum + (g.size || 0), 0);
  const games = [...library.games].sort(bySize);
  const gamesSize = sizeOf(games);
  const total = driveList.reduce((sum, d) => sum + d.total, 0);
  const free = driveList.reduce((sum, d) => sum + d.free, 0);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (ringMode === 'store' && !games.some((g) => storeOf(g) === ringStore)) ringMode = 'games';

  let slices;
  let listed = games; // the games in the list under the ring
  let ringTotal = gamesSize;
  if (ringMode === 'overview') {
    slices = [
      { label: 'Games', size: Math.min(gamesSize, total - free), color: css('--accent'), open: 'games' },
      { label: 'Everything else', size: Math.max(total - free - gamesSize, 0), color: css('--muted') },
      { label: 'Free space', size: free, color: css('--raised-2') },
    ];
    ringTotal = total;
    $('ring-title').textContent = driveList.length > 1 ? `All drives (${driveList.map((d) => d.root).join(' ')})` : `Drive ${driveList[0]?.root || ''}`;
    $('ring-hint').textContent = 'Click Games on the ring or in the list to see each store.';
    setRingCentre(formatSize(slices[0].size), `used by games, of ${formatSize(total)}`);
  } else if (ringMode === 'games') {
    // One slice per store, biggest first. Games from your own folders are "Other".
    slices = Object.keys(STORES)
      .map((store) => {
        const inStore = games.filter((g) => storeOf(g) === store);
        return { label: `${STORES[store].name} (${inStore.length})`, size: sizeOf(inStore), color: STORES[store].ring, store, count: inStore.length };
      })
      .filter((slice) => slice.count > 0)
      .sort((a, b) => b.size - a.size);
    slices.forEach((slice) => (slice.open = 'store'));
    $('ring-title').textContent = `Games (${games.length})`;
    $('ring-hint').textContent = 'Click a store to see its games.';
    setRingCentre(formatSize(gamesSize), 'used by games');
  } else {
    listed = games.filter((g) => storeOf(g) === ringStore);
    const top = listed.filter((g) => g.size).slice(0, SLICE_COLORS.length);
    const rest = sizeOf(listed.slice(top.length));
    slices = top.map((g, i) => ({ label: g.name, size: g.size, color: SLICE_COLORS[i], game: g }));
    if (rest) slices.push({ label: 'Other games', size: rest, color: css('--muted') });
    ringTotal = sizeOf(listed);
    $('ring-title').textContent = `${STORES[ringStore].name} (${listed.length})`;
    $('ring-hint').textContent = 'Click a game to find it in the list below.';
    setRingCentre(formatSize(ringTotal), `used by ${STORES[ringStore].name} games`);
  }
  $('ring-back').hidden = ringMode === 'overview';
  $('ring-back').textContent = ringMode === 'store' ? '‹ All games' : '‹ All storage';
  drawRing(slices, ringTotal);

  $('ring-legend').replaceChildren(
    ...slices.map((slice) => {
      const row = document.createElement('button');
      row.className = 'legend-row';
      row.classList.toggle('clickable', !!(slice.open || slice.game));
      const dot = document.createElement('span');
      dot.className = 'legend-dot';
      dot.style.background = slice.color;
      const label = document.createElement('span');
      label.className = 'legend-label';
      label.textContent = slice.label + (slice.open ? '  ›' : '');
      const size = document.createElement('span');
      size.className = 'muted';
      size.textContent = formatSize(slice.size);
      row.append(dot);
      if (slice.store && slice.store !== 'Other') row.append(storeLogo(slice.store));
      row.append(label, size);
      row.addEventListener('click', () => clickSlice(slice));
      return row;
    })
  );

  $('drive-notes').replaceChildren(
    ...driveList.map((d) => {
      const line = document.createElement('div');
      line.textContent = `${d.root}  ${formatSize(d.free)} free of ${formatSize(d.total)}`;
      return line;
    })
  );

  // The list of games, with Uninstall buttons, is there at every level.
  $('storage-list').hidden = false;
  renderStorageList(listed);
}

function setRingCentre(big, small) {
  $('ring-big').textContent = big;
  $('ring-small').textContent = small;
}

// Draws the ring as circles whose outlines are cut into lengths.
function drawRing(slices, total) {
  const svg = $('ring');
  const r = 80;
  const around = 2 * Math.PI * r;
  const gap = slices.filter((sl) => sl.size > 0).length > 1 ? 2 : 0;
  const parts = [];
  let offset = 0;
  const ns = 'http://www.w3.org/2000/svg';
  const track = document.createElementNS(ns, 'circle');
  Object.entries({ cx: 100, cy: 100, r, class: 'ring-track' }).forEach(([k, v]) => track.setAttribute(k, v));
  parts.push(track);
  for (const slice of slices) {
    const length = total ? (slice.size / total) * around : 0;
    if (length > 0) {
      const arc = document.createElementNS(ns, 'circle');
      Object.entries({
        cx: 100,
        cy: 100,
        r,
        class: `ring-slice${slice.open || slice.game ? ' clickable' : ''}`,
        stroke: slice.color,
        'stroke-dasharray': `${Math.max(length - gap, 0.5)} ${around}`,
        'stroke-dashoffset': -offset,
      }).forEach(([k, v]) => arc.setAttribute(k, v));
      const title = document.createElementNS(ns, 'title');
      title.textContent = `${slice.label}: ${formatSize(slice.size)}`;
      arc.append(title);
      arc.addEventListener('click', () => clickSlice(slice));
      arc.addEventListener('mouseenter', () => setRingCentre(formatSize(slice.size), slice.label));
      arc.addEventListener('mouseleave', () => renderStorage());
      parts.push(arc);
    }
    offset += length;
  }
  svg.replaceChildren(...parts);
}

function clickSlice(slice) {
  if (slice.open) {
    ringMode = slice.open;
    ringStore = slice.store || null;
    renderStorage();
  } else if (slice.game) {
    // Scroll to the game in the list below and make it flash.
    const row = document.querySelector(`.storage-row[data-exe="${CSS.escape(slice.game.exePath)}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
  }
}

function renderStorageList(games) {
  const biggest = Math.max(1, ...games.map((g) => g.size || 0));
  $('storage-list').replaceChildren(
    ...games.map((game) => {
      const row = document.createElement('div');
      row.className = 'storage-row';
      row.dataset.exe = game.exePath;
      const icon = document.createElement('div');
      icon.className = 'art mini';
      setArt(icon, game);
      const info = document.createElement('div');
      info.className = 'storage-info';
      const top = document.createElement('div');
      top.className = 'storage-top';
      const name = document.createElement('button');
      name.className = 'link';
      name.textContent = game.name;
      name.addEventListener('click', () => openGame(game));
      const size = document.createElement('span');
      size.textContent = game.size ? formatSize(game.size) : '...';
      const nameWrap = document.createElement('span');
      nameWrap.className = 'name-wrap';
      if (storeOf(game) !== 'Other') nameWrap.append(storeLogo(storeOf(game)));
      nameWrap.append(name);
      top.append(nameWrap, size);
      const bar = document.createElement('div');
      bar.className = 'size-bar';
      const fill = document.createElement('div');
      fill.style.width = `${((game.size || 0) / biggest) * 100}%`;
      bar.append(fill);
      const where = document.createElement('span');
      where.className = 'muted small';
      where.textContent = game.gameDir || game.exePath;
      info.append(top, bar, where);
      const actions = document.createElement('div');
      actions.className = 'storage-actions';
      const folder = document.createElement('button');
      folder.className = 'secondary';
      folder.textContent = 'Show in folder';
      folder.addEventListener('click', () => window.launcher.showInFolder(game.exePath));
      const remove = document.createElement('button');
      remove.className = 'secondary danger';
      remove.textContent = 'Uninstall';
      remove.addEventListener('click', () => uninstallGame(game));
      actions.append(folder, remove);
      row.append(icon, info, actions);
      return row;
    })
  );
}

// Explains what will happen, asks to confirm, then uninstalls.
async function uninstallGame(game) {
  if (gameState(game.exePath) === 'running') {
    return openModal('Close the game first', textBlock(`${game.name} is running. Close it, then try again.`), 'OK', true);
  }
  toast(`Checking how to uninstall ${game.name}...`);
  const info = await window.launcher.uninstallInfo(game.exePath);
  $('toast').hidden = true;
  if (!info) return;

  const size = game.size ? ` This frees up about ${formatSize(game.size)}.` : '';
  const messages = {
    steam: `Steam will open and ask you to confirm.${size}`,
    uninstaller: `The game's own uninstaller will open. Follow its steps to finish.${size}`,
    trash: `This game has no uninstaller, so its folder will be moved to the Recycle Bin:\n${info.folder}\n\nYou can get it back from the Recycle Bin if you change your mind.${size}`,
  };
  if (info.how === 'store') {
    return openModal(`Uninstall ${game.name} from its store`, textBlock(info.reason), 'OK', true);
  }
  if (info.how === 'none') {
    return openModal(
      `Can't uninstall ${game.name} from here`,
      textBlock(`${info.reason} To be safe, the launcher won't delete it. Use "Show in folder" to remove it yourself.`),
      'OK',
      true
    );
  }
  const body = textBlock(messages[info.how]);
  body.style.whiteSpace = 'pre-line';
  if (!(await openModal(`Uninstall ${game.name}?`, body, 'Uninstall'))) return;

  const result = await window.launcher.uninstall(game.exePath);
  if (!result.ok) return openModal("Couldn't uninstall", textBlock(result.message), 'OK', true);
  if (info.how === 'trash') toast(`${game.name} was moved to the Recycle Bin.`, 4000);
  else toast(`Once ${game.name} is uninstalled it will disappear from the launcher by itself.`, 6000);
}

// ---------- Colours ----------

const COLORS = [
  { name: 'accent', label: 'Accent (buttons and highlights)' },
  { name: 'play', label: 'Play button' },
  { name: 'bg', label: 'Background' },
  { name: 'panel', label: 'Sidebar and cards' },
  { name: 'text', label: 'Text' },
];

const THEMES = {
  Default: { bg: '#14161a', panel: '#1c1f25', accent: '#3b82f6', text: '#e8e8ea', play: '#22c55e' },
  Midnight: { bg: '#0e0b18', panel: '#1a1530', accent: '#a855f7', text: '#ece8f5', play: '#22c55e' },
  Forest: { bg: '#0e1511', panel: '#16211a', accent: '#10b981', text: '#e4ede7', play: '#84cc16' },
  Crimson: { bg: '#150e0f', panel: '#221719', accent: '#ef4444', text: '#f1e7e8', play: '#f97316' },
  Ocean: { bg: '#0b1419', panel: '#122029', accent: '#06b6d4', text: '#e3eff3', play: '#22c55e' },
  Light: { bg: '#eef0f4', panel: '#ffffff', accent: '#2563eb', text: '#1f2328', play: '#16a34a' },
};

const currentColors = () => ({ ...THEMES.Default, ...library.settings?.colors });

// Puts colours on the page. They feed the CSS variables in styles.css.
function applyColors(colors) {
  for (const { name } of COLORS) document.documentElement.style.setProperty(`--${name}`, colors[name]);
}

function renderSettings() {
  const colors = currentColors();
  applyColors(colors);

  const sameColors = (theme) => COLORS.every((c) => theme[c.name] === colors[c.name]);
  const customThemes = library.settings?.themes || [];
  $('themes').replaceChildren(
    ...Object.entries(THEMES).map(([name, theme]) => themeButton(name, theme, sameColors(theme))),
    ...customThemes.map(({ name, colors: theme }) => {
      // The user's own themes can be deleted with the little ×.
      const wrap = document.createElement('div');
      wrap.className = 'theme-wrap';
      const remove = document.createElement('button');
      remove.className = 'theme-delete';
      remove.title = `Delete ${name}`;
      remove.textContent = '×';
      remove.addEventListener('click', () => deleteTheme(name));
      wrap.append(themeButton(name, { ...THEMES.Default, ...theme }, sameColors({ ...THEMES.Default, ...theme })), remove);
      return wrap;
    }),
    createThemeButton()
  );

  // The colour boxes are made once, so dragging inside the colour picker isn't interrupted.
  const list = $('color-list');
  if (!list.children.length) {
    for (const { name, label } of COLORS) {
      // Clicking the box or its words opens the picker. The row is only as wide
      // as those two, so the empty space after it doesn't.
      const row = document.createElement('label');
      row.className = 'color-row';
      const input = document.createElement('input');
      input.type = 'color';
      input.dataset.color = name;
      input.setAttribute('aria-label', label);
      // Shows the change straight away while picking, and saves when the picker closes.
      input.addEventListener('input', () => applyColors({ ...currentColors(), [name]: input.value }));
      input.addEventListener('change', () => saveColors({ ...currentColors(), [name]: input.value }));
      const text = document.createElement('span');
      text.textContent = label;
      row.append(input, text);
      list.append(row);
    }
  }
  list.querySelectorAll('input').forEach((input) => {
    if (document.activeElement !== input) input.value = colors[input.dataset.color];
  });
}

function themeButton(name, theme, active) {
  const button = document.createElement('button');
  button.className = 'theme';
  button.title = name;
  button.classList.toggle('active', active);
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = `linear-gradient(135deg, ${theme.bg} 50%, ${theme.panel} 50%)`;
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = theme.accent;
  swatch.append(dot);
  const label = document.createElement('span');
  label.className = 'theme-name';
  label.textContent = name;
  button.append(swatch, label);
  button.addEventListener('click', () => saveColors(theme));
  return button;
}

// "+ Create" saves the colours you have now as a theme with your own name.
function createThemeButton() {
  const button = document.createElement('button');
  button.className = 'theme create';
  button.id = 'create-theme';
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.textContent = '+';
  button.append(swatch, 'Create');
  button.addEventListener('click', createTheme);
  return button;
}

async function createTheme() {
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 30;
  input.placeholder = 'Theme name';
  const body = document.createElement('div');
  body.append(input, textBlock('Saves the colours you have picked right now.'));
  if (!(await openModal('Save your colours as a theme', body, 'Save'))) return;
  const name = input.value.trim();
  if (!name) return;
  if (THEMES[name]) {
    return openModal('Pick another name', textBlock(`"${name}" is one of the built-in themes.`), 'OK', true);
  }
  const colors = currentColors();
  const others = (library.settings?.themes || []).filter((t) => t.name.toLowerCase() !== name.toLowerCase());
  update(await window.launcher.saveThemes([...others, { name, colors }]));
  toast(`Saved your theme "${name}".`, 3000);
}

async function deleteTheme(name) {
  if (!(await openModal(`Delete "${name}"?`, textBlock('Your current colours stay as they are.'), 'Delete'))) return;
  update(await window.launcher.saveThemes((library.settings?.themes || []).filter((t) => t.name !== name)));
}

async function saveColors(colors) {
  applyColors(colors);
  update(await window.launcher.saveColors(colors));
}

$('reset-colors').addEventListener('click', () => saveColors(THEMES.Default));

// ---------- On/off settings ----------

// Tick boxes in Settings with id "set-<name>". They are all on unless switched off.
for (const box of document.querySelectorAll('input[id^="set-"]')) {
  box.addEventListener('change', async () => update(await window.launcher.saveSetting(box.id.slice(4), box.checked)));
}
function renderSwitches() {
  for (const box of document.querySelectorAll('input[id^="set-"]')) box.checked = setting(box.id.slice(4));
}

// ---------- Updates ----------

let updateInfo = { state: 'idle' };
let updateHidden = false; // "Later" hides the bar until the next start

function renderUpdate(info = updateInfo) {
  updateInfo = info;
  $('app-version').textContent = info.current || '';
  const pct = info.percent ? ` ${Math.floor(info.percent)}%` : '';
  $('update-status').textContent = {
    checking: 'Checking for updates...',
    none: "You're up to date.",
    available: `Version ${info.version} is out.`,
    downloading: `Downloading version ${info.version}...${pct}`,
    installing: 'Restarting to update...',
    error: `Couldn't check for updates: ${info.message || 'no internet?'}`,
  }[info.state] || '';
  $('update-check').disabled = ['checking', 'downloading', 'installing'].includes(info.state);

  const bar = $('update-bar');
  bar.hidden = updateHidden || !['available', 'downloading', 'installing'].includes(info.state);
  if (info.state === 'available') {
    $('update-text').textContent = info.canInstall
      ? `Version ${info.version} of the launcher is out. Update in one click; your library is kept.`
      : `Version ${info.version} of the launcher is out. Download it from GitHub; your library is kept.`;
  } else {
    $('update-text').textContent = $('update-status').textContent;
  }
  $('update-go').textContent = info.canInstall ? 'Update now' : 'Download';
  $('update-go').disabled = info.state !== 'available';
  $('update-later').hidden = info.state !== 'available';
}

$('update-check').addEventListener('click', () => window.launcher.checkForUpdate());
$('update-go').addEventListener('click', () => window.launcher.installUpdate());
$('update-notes').addEventListener('click', () => window.launcher.openReleasePage());
$('update-later').addEventListener('click', () => {
  updateHidden = true;
  renderUpdate();
});
window.launcher.onUpdateStatus(renderUpdate);

// ---------- Folders ----------

function renderFolders() {
  const list = $('folder-list');
  list.replaceChildren();
  let storeCount = 0;
  for (const store of Object.keys(STORE_LOGOS)) {
    const count = library.games.filter((g) => g.folder === store).length;
    if (!count) continue;
    storeCount += count;
    const li = document.createElement('li');
    li.textContent = `${STORES[store].name}, found automatically  (${count} game${count === 1 ? '' : 's'})`;
    list.append(li);
  }
  if (library.folders.length === 0 && storeCount === 0) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'No folders yet.';
    list.append(li);
  }
  for (const folder of library.folders) {
    const count = library.games.filter((g) => g.folder === folder).length;
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${folder}  (${count} game${count === 1 ? '' : 's'})`;
    const remove = document.createElement('button');
    remove.className = 'secondary';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => update(await window.launcher.removeFolder(folder)));
    li.append(label, remove);
    list.append(li);
  }
}

async function addFolder() {
  setStatus('Scanning...');
  update(await window.launcher.addFolder());
  setStatus('');
}

// Looks for new or removed games. Says what changed when asked by a button.
async function rescan(event) {
  const fromButton = !!event;
  const before = new Set(library.games.map((g) => g.exePath));
  setStatus('Checking for new games...');
  $('rescan-all').disabled = $('rescan').disabled = true;
  update(await window.launcher.rescan());
  $('rescan-all').disabled = $('rescan').disabled = false;
  setStatus('');
  if (!fromButton) return;
  const added = library.games.filter((g) => !before.has(g.exePath)).length;
  const removed = [...before].filter((p) => !library.games.some((g) => g.exePath === p)).length;
  const parts = [];
  if (added) parts.push(`found ${added} new game${added === 1 ? '' : 's'}`);
  if (removed) parts.push(`removed ${removed} that ${removed === 1 ? 'is' : 'are'} no longer installed`);
  toast(parts.length ? `Rescan done: ${parts.join(', ')}.` : 'Rescan done: no changes.', 4000);
}

$('add-folder').addEventListener('click', addFolder);
$('empty-add').addEventListener('click', addFolder);
$('rescan').addEventListener('click', rescan);
$('rescan-all').addEventListener('click', rescan);

// ---------- Start up ----------

function update(newLibrary) {
  library = { groups: [], settings: {}, ...newLibrary };
  renderGames();
  renderFolders();
  renderSettings();
  renderSwitches();
  if (!$('view-storage').hidden) renderStorage();
  if (currentGame) renderGamePage();
}

window.launcher.onUpdate(update);

function updateStatus(newStatus) {
  status = newStatus;
  renderPlayButton();
  document.querySelectorAll('.tile').forEach((tile) => tile.classList.toggle('is-running', status.running.includes(tile.game?.exePath)));
}
window.launcher.onStatus(updateStatus);

(async () => {
  // Show the saved library straight away, then check the folders for new games.
  update(await window.launcher.getLibrary());
  updateStatus(await window.launcher.getStatus());
  renderUpdate(await window.launcher.getUpdateStatus());
  await rescan();
  document.body.dataset.ready = '1'; // lets the automatic tests know start-up is done
})();
