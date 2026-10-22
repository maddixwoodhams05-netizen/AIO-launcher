// The "main" process: starts the app, opens the window, and does the work
// the window isn't allowed to do itself (reading folders, launching games).
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const library = require('./library');
const { findArt, ART_VERSION, noArt } = require('./art');
const { extractIcon } = require('./exeicon');
const { startTracking } = require('./playtime');
const { STORES } = require('./stores');
const { createUpdater } = require('./updater');

// Where the library is saved:
// - the portable (zip) version keeps it in a folder next to itself, so it
//   can live on a USB stick. It's portable unless it was put there by the installer.
// - npm start and the installed app share one folder, so updates keep everything.
// - the automatic tests point it at a pretend library instead.
const appFolder = path.dirname(process.execPath);
// (Before 1.1.2 the launcher was called "Game Launcher".)
const installed =
  ['Uninstall Maio Launcher.exe', 'Uninstall Game Launcher.exe'].some((f) => require('fs').existsSync(path.join(appFolder, f))) ||
  /[\\/]AppData[\\/]Local[\\/]Programs[\\/]/i.test(appFolder);
const portable = app.isPackaged && !installed;
// A portable copy from before the rename keeps using its old data folder.
const portableData = ['Maio Launcher data', 'Game Launcher data']
  .map((f) => path.join(appFolder, f))
  .find((f) => require('fs').existsSync(f)) || path.join(appFolder, 'Maio Launcher data');
// The installed launcher's data folder keeps its old name, so libraries carry over.
app.setPath(
  'userData',
  process.env.LAUNCHER_DATA_DIR || (portable ? portableData : path.join(app.getPath('appData'), 'game-launcher'))
);
const { closeGame } = require('./closegame');
const storage = require('./storage');

let win;
let lib;
let tracker;
let updater;

// What each game's Play button should show.
const LAUNCH_TIMEOUT_MS = 2 * 60 * 1000; // give up on "Launching..." after this
const launching = new Map(); // exePath → when Play was pressed
const closing = new Set();
let running = new Set();

const status = () => ({ launching: [...launching.keys()], running: [...running], closing: [...closing] });

function sendStatus() {
  if (win && !win.isDestroyed()) win.webContents.send('games:status', status());
}

// Called after every running-games check.
function onCheck(nowRunning) {
  // The automatic tests set which games are "running" themselves.
  if (process.env.LAUNCHER_TEST_STATUS) return;
  running = nowRunning;
  for (const [exePath, startedAt] of launching) {
    if (running.has(exePath) || Date.now() - startedAt > LAUNCH_TIMEOUT_MS) launching.delete(exePath);
  }
  sendStatus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: lib.settings?.colors?.bg || '#14161a',
    title: 'Maio Launcher',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.removeMenu();
  // F12 opens the developer tools, which show errors if something breaks.
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

// Tells the window the library changed so it can redraw.
function sendUpdate() {
  if (win && !win.isDestroyed()) win.webContents.send('library:updated', lib);
}

// Looks up Steam art for any game that hasn't been checked yet.
// If asked again while it is busy, it goes round once more when done.
let findingArt = false;
let findArtAgain = false;
async function findMissingArt() {
  if (findingArt) {
    findArtAgain = true;
    return;
  }
  findingArt = true;
  try {
    do {
      findArtAgain = false;
      for (const game of [...lib.games]) {
        // Games where nothing was found are tried again when the launcher
        // learns a new place to look (ART_VERSION).
        if (game.art && !(noArt(game.art) && (game.art.v || 1) < ART_VERSION)) continue;
        game.art = await findArt(game);
        library.save(lib);
        sendUpdate();
      }
    } while (findArtAgain);
  } finally {
    findingArt = false;
  }
}

// Icons are pulled out of each EXE once and then kept in memory.
const iconCache = new Map();
async function getIcon(exePath) {
  if (!iconCache.has(exePath)) {
    // Some EXEs can't be opened (Xbox games live in a locked folder).
    let icon = await extractIcon(exePath).catch(() => null);
    if (!icon) {
      try {
        icon = (await app.getFileIcon(exePath, { size: 'large' })).toDataURL();
      } catch {
        icon = null;
      }
    }
    iconCache.set(exePath, icon);
  }
  return iconCache.get(exePath);
}

// Turns a saved art location into something the window can show.
// Web addresses are used as they are; local files are read in.
const imageCache = new Map();
async function getImage(source) {
  if (!source) return null;
  if (/^https:\/\//.test(source)) return source;
  // Only open files that the art finder picked, never any other path.
  const known = lib.games.some((g) => g.art && Object.values(g.art).includes(source));
  if (!known) return null;
  if (!imageCache.has(source)) {
    try {
      const type = source.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
      imageCache.set(source, `data:${type};base64,${(await fs.readFile(source)).toString('base64')}`);
    } catch {
      imageCache.set(source, null);
    }
  }
  return imageCache.get(source);
}

async function rescan() {
  lib = await library.rescan(lib);
  findMissingArt();
  return lib;
}

ipcMain.handle('library:get', () => lib);
ipcMain.handle('library:rescan', rescan);

ipcMain.handle('folders:add', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose a folder with games in it',
    properties: ['openDirectory', 'multiSelections'],
  });
  if (result.canceled) return lib;
  for (const folder of result.filePaths) {
    if (!lib.folders.some((f) => f.toLowerCase() === folder.toLowerCase())) lib.folders.push(folder);
  }
  return rescan();
});

ipcMain.handle('folders:remove', (_event, folder) => {
  lib.folders = lib.folders.filter((f) => f !== folder);
  return rescan();
});

ipcMain.handle('game:icon', (_event, exePath) => getIcon(exePath));
ipcMain.handle('game:image', (_event, source) => getImage(source));

ipcMain.handle('game:launch', (_event, exePath) => {
  const game = lib.games.find((g) => g.exePath === exePath);
  if (!game) return false;
  // Pressing Play again while it is starting or running does nothing.
  if (launching.has(exePath) || running.has(exePath)) return false;
  launching.set(exePath, Date.now());
  sendStatus();
  // Counts as played straight away, so it jumps to the top of Last played.
  game.lastPlayed = Date.now();
  library.save(lib);
  sendUpdate();
  if (game.folder === library.STEAM && game.appId) {
    // Steam games start through Steam, so things like the overlay and cloud saves work.
    shell.openExternal(`steam://rungameid/${game.appId}`);
    return true;
  }
  if (game.launchUrl?.startsWith('shell:')) {
    // Xbox app games are started by Windows itself.
    spawn('explorer.exe', [game.launchUrl], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  if (game.launchUrl) {
    // Games from Epic, EA and Ubisoft start through their store, which some
    // of them need. If the store isn't there any more, start the EXE instead.
    shell.openExternal(game.launchUrl).catch(() => startExe(game));
    return true;
  }
  startExe(game);
  return true;
});

// Start the game from its own folder so it can find its files,
// and let it keep running if the launcher is closed.
function startExe(game) {
  const child = spawn(game.exePath, [], {
    cwd: path.dirname(game.exePath),
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', (err) => {
    launching.delete(game.exePath);
    sendStatus();
    dialog.showErrorBox('Could not start game', err.message);
  });
  child.unref();
}

ipcMain.handle('games:status', status);

ipcMain.handle('game:close', async (_event, exePath) => {
  const game = lib.games.find((g) => g.exePath === exePath);
  if (!game || closing.has(exePath)) return;
  closing.add(exePath);
  sendStatus();
  try {
    await closeGame(game.gameDir || path.dirname(game.exePath));
    await tracker.checkNow();
  } finally {
    closing.delete(exePath);
    sendStatus();
  }
});

// Renames a game. An empty name puts back the name it was found with.
ipcMain.handle('game:rename', (_event, exePath, newName) => {
  const game = lib.games.find((g) => g.exePath === exePath);
  if (!game || typeof newName !== 'string') return lib;
  const original = game.originalName || game.name;
  const name = newName.trim().slice(0, 100) || original;
  if (name === game.name) return lib;
  game.name = name;
  if (name === original) delete game.originalName;
  else game.originalName = original;
  lib.games.sort((a, b) => a.name.localeCompare(b.name));
  library.save(lib);
  return lib;
});

// Games not from Steam find their art by searching Steam for their name.
// After a rename this searches again, and says whether Steam had a match.
ipcMain.handle('game:refresh-art', async (_event, exePath) => {
  const game = lib.games.find((g) => g.exePath === exePath);
  if (!game || game.appId) return false;
  const art = await findArt(game);
  if (!art.appId) return false;
  game.art = art;
  library.save(lib);
  sendUpdate();
  return true;
});

// ---------- Storage and uninstalling ----------

// Works out the size of every game that doesn't have one yet (or all of
// them with recalculate), then returns the drives the games are on.
const SIZE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let sizing = null;
ipcMain.handle('storage:scan', (_event, recalculate) => {
  if (!sizing) {
    sizing = (async () => {
      for (const game of [...lib.games]) {
        const fresh = game.size && (game.appId || Date.now() - (game.sizeAt || 0) < SIZE_MAX_AGE_MS);
        if (fresh && !recalculate) continue;
        if (game.appId && game.size) continue; // Steam keeps its own size up to date.
        game.size = await storage.folderSize(game.gameDir || path.dirname(game.exePath));
        game.sizeAt = Date.now();
        sendUpdate();
      }
      library.save(lib);
    })().finally(() => (sizing = null));
  }
  return sizing.then(drives);
});

async function drives() {
  const seen = new Map();
  for (const game of lib.games) {
    const dir = game.gameDir || path.dirname(game.exePath);
    const root = path.parse(dir).root.toUpperCase();
    if (!seen.has(root)) seen.set(root, storage.driveInfo(dir));
  }
  return (await Promise.all(seen.values())).filter(Boolean);
}

// Says how a game would be uninstalled, so the window can explain it first.
ipcMain.handle('game:uninstall-info', async (_event, exePath) => {
  const game = lib.games.find((g) => g.exePath === exePath);
  if (!game) return null;
  if (game.folder === library.STEAM && game.appId) return { how: 'steam' };
  if (game.folder === 'Ubisoft' && game.storeId) return { how: 'ubisoft' };
  if (game.folder === 'Xbox' && game.storeId) return { how: 'xbox' };
  const uninstaller = await storage.findUninstaller(game.gameDir);
  if (uninstaller) return { how: 'uninstaller' };
  // A store's games are never binned, or the store would think they are still there.
  if (STORES[game.folder]) return { how: 'store', reason: `This game is from ${STORES[game.folder].name}. ${STORES[game.folder].uninstallHelp}` };
  const reason = storage.whyNotTrash(game, lib);
  if (reason) return { how: 'none', reason };
  return { how: 'trash', folder: game.gameDir };
});

ipcMain.handle('game:uninstall', async (_event, exePath) => {
  const game = lib.games.find((g) => g.exePath === exePath);
  if (!game) return { ok: false, message: 'Game not found.' };
  if (running.has(exePath)) return { ok: false, message: 'Close the game first.' };

  // Steam games: Steam asks to confirm and does the rest.
  if (game.folder === library.STEAM && game.appId) {
    shell.openExternal(`steam://uninstall/${game.appId}`);
    watchForRemoval(game);
    return { ok: true };
  }

  // Ubisoft Connect opens its own "Uninstall?" box.
  if (game.folder === 'Ubisoft' && game.storeId) {
    shell.openExternal(`uplay://uninstall/${game.storeId}`);
    watchForRemoval(game);
    return { ok: true };
  }

  // Xbox app games: Windows removes them, like uninstalling from Settings.
  if (game.folder === 'Xbox' && game.storeId) {
    const result = await storage.removeAppPackage(game.storeId);
    if (result.ok) {
      await rescan();
      sendUpdate();
    }
    return result;
  }

  // The game's own uninstaller, from Windows' list of installed programs.
  const uninstaller = await storage.findUninstaller(game.gameDir);
  if (uninstaller) {
    const child = spawn(uninstaller, [], { shell: true, detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', (err) => dialog.showErrorBox('Could not start the uninstaller', err.message));
    child.unref();
    watchForRemoval(game);
    return { ok: true };
  }

  // No uninstaller: move the folder to the Recycle Bin, so it can be put back.
  if (STORES[game.folder] || storage.whyNotTrash(game, lib)) return { ok: false, message: "This game can't be removed from the launcher." };
  try {
    await shell.trashItem(game.gameDir);
  } catch (err) {
    return { ok: false, message: `Couldn't move the folder to the Recycle Bin: ${err.message}` };
  }
  await rescan();
  sendUpdate();
  return { ok: true };
});

// Uninstallers run on their own, so check every 10 seconds (for up to
// 10 minutes) whether the game is gone, then update the library.
function watchForRemoval(game) {
  const started = Date.now();
  const timer = setInterval(async () => {
    const gone = !(await fs.access(game.exePath).then(() => true, () => false));
    if (gone || Date.now() - started > 10 * 60 * 1000) clearInterval(timer);
    if (gone) {
      await rescan();
      sendUpdate();
    }
  }, 10000);
}

// Saves the user's colour choices. Only proper colour codes are kept.
const COLOR_NAMES = ['bg', 'panel', 'accent', 'text', 'play'];
function cleanColors(colors) {
  const clean = {};
  for (const name of COLOR_NAMES) {
    if (typeof colors?.[name] === 'string' && /^#[0-9a-f]{6}$/i.test(colors[name])) clean[name] = colors[name];
  }
  return clean;
}

ipcMain.handle('settings:colors', (_event, colors) => {
  lib.settings = { ...lib.settings, colors: cleanColors(colors) };
  library.save(lib);
  return lib;
});

// The user's own named themes: [{ name, colors }].
ipcMain.handle('settings:themes', (_event, themes) => {
  if (!Array.isArray(themes)) return lib;
  lib.settings = {
    ...lib.settings,
    themes: themes
      .filter((t) => t && typeof t.name === 'string' && t.name.trim())
      .map((t) => ({ name: t.name.trim().slice(0, 30), colors: cleanColors(t.colors) })),
  };
  library.save(lib);
  return lib;
});

// Simple on/off choices from Settings.
const SWITCHES = ['storeTabs', 'storeLogos', 'autoUpdateCheck'];
ipcMain.handle('settings:switch', (_event, name, on) => {
  if (!SWITCHES.includes(name)) return lib;
  lib.settings = { ...lib.settings, [name]: !!on };
  library.save(lib);
  return lib;
});

// ---------- Updates ----------

ipcMain.handle('update:status', () => updater.status());
ipcMain.handle('update:check', () => updater.check());
ipcMain.handle('update:install', () => updater.install());
ipcMain.handle('update:page', () => updater.openPage());

function startUpdater() {
  // Only the installed launcher can update itself. The portable one and
  // "npm start" just say when there is a new version.
  let autoUpdater = null;
  if (app.isPackaged && installed) {
    try {
      autoUpdater = require('electron-updater').autoUpdater;
    } catch {
      autoUpdater = null;
    }
  }
  updater = createUpdater({
    current: app.getVersion(),
    autoUpdater,
    send: (info) => win && !win.isDestroyed() && win.webContents.send('update:status', info),
    openUrl: (url) => shell.openExternal(url),
  });
  // Looks a few seconds after starting, so it doesn't slow the start down.
  // The automatic tests start the check themselves.
  if (lib.settings?.autoUpdateCheck !== false && !process.env.LAUNCHER_NO_UPDATE_CHECK) {
    setTimeout(() => updater.check(), 5000);
  }
}

ipcMain.handle('game:favourite', (_event, exePath) => {
  const game = lib.games.find((g) => g.exePath === exePath);
  if (game) {
    game.favourite = !game.favourite;
    library.save(lib);
  }
  return lib;
});

// The window sends the whole list of groups whenever one changes.
ipcMain.handle('groups:save', (_event, groups) => {
  if (!Array.isArray(groups)) return lib;
  lib.groups = groups
    .filter((g) => g && typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.games))
    .map((g) => ({ id: g.id, name: g.name.trim().slice(0, 60) || 'Untitled', games: g.games.filter((p) => typeof p === 'string') }));
  library.save(lib);
  return lib;
});

ipcMain.handle('game:hide', (_event, exePath) => {
  lib.hidden.push(exePath);
  lib.games = lib.games.filter((g) => g.exePath !== exePath);
  library.save(lib);
  return lib;
});

ipcMain.handle('game:show-in-folder', (_event, exePath) => shell.showItemInFolder(exePath));

app.whenReady().then(() => {
  lib = library.load();
  createWindow();
  startUpdater();
  tracker = startTracking(() => lib, {
    onPlaytime: () => {
      library.save(lib);
      sendUpdate();
    },
    onCheck,
  });
});

app.on('window-all-closed', () => app.quit());
