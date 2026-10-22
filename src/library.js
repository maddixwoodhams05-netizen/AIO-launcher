// Saves and loads the game library as a JSON file in the app's data folder.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { scanFolder } = require('./scanner');
const { findSteamGames } = require('./steam');

const libraryFile = () => path.join(app.getPath('userData'), 'library.json');

// folders: the folders the user picked to scan
// games: every game found, keyed by its EXE path
// hidden: EXE paths the user removed, so rescans don't bring them back
// groups: the user's groups, each { id, name, games: [EXE paths] }
// settings: the user's choices, e.g. { colors: { accent: '#3b82f6' } }
const EMPTY = { folders: [], games: [], hidden: [], groups: [], settings: {} };

function load() {
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(libraryFile(), 'utf8')) };
  } catch {
    return { ...EMPTY };
  }
}

function save(library) {
  fs.mkdirSync(path.dirname(libraryFile()), { recursive: true });
  fs.writeFileSync(libraryFile(), JSON.stringify(library, null, 2));
}

const key = (exePath) => exePath.toLowerCase();

// Marks games that came from Steam rather than a picked folder.
const STEAM = 'Steam';

// Rescans every saved folder. New games are added, games whose EXE is gone
// are dropped, and games already in the library keep all their saved info.
async function rescan(library) {
  const existing = new Map(library.games.map((g) => [key(g.exePath), g]));
  const hidden = new Set(library.hidden.map(key));
  const found = new Map();

  // Steam games are found automatically, without picking a folder.
  // Steam's own names and app ids are kept even if a picked folder has the game too.
  for (const game of await findSteamGames()) {
    const k = key(game.exePath);
    if (hidden.has(k)) continue;
    const old = existing.get(k);
    if (!old) {
      found.set(k, { ...game, folder: STEAM, addedAt: Date.now() });
      continue;
    }
    const updated = { ...old, name: game.name, appId: game.appId, gameDir: game.gameDir, folder: STEAM };
    // Steam's own size is exact and always up to date.
    if (game.size) updated.size = game.size;
    // A name the user picked wins over Steam's.
    if (old.originalName) Object.assign(updated, { name: old.name, originalName: game.name });
    // Art found earlier by name search may be for the wrong game, so look again.
    if (old.appId !== game.appId) delete updated.art;
    found.set(k, updated);
  }

  for (const folder of library.folders) {
    const scanned = await scanFolder(folder);
    // If the folder can't be reached, keep its games instead of wiping them.
    const games = scanned ?? library.games.filter((g) => g.folder === folder);
    for (const game of games) {
      const k = key(game.exePath);
      if (hidden.has(k) || found.has(k)) continue;
      const old = existing.get(k);
      found.set(k, old ? { ...old, gameDir: game.gameDir || old.gameDir } : { ...game, folder, addedAt: Date.now() });
    }
  }

  library.games = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  save(library);
  return library;
}

module.exports = { load, save, rescan, STEAM };
