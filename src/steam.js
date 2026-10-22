// Finds every game installed through Steam, on every drive Steam uses,
// by reading Steam's own list of installed games.
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { findExes, pickMainExe } = require('./scanner');

// Steam tools that show up as "installed games" but aren't games.
const NOT_GAMES = new Set([
  228980, // Steamworks Common Redistributables
  1070560, 1391110, 1628350, // Steam Linux Runtime
  1493710, 2180100, // Proton
  250820, // SteamVR
]);

// Where Steam is installed, read from the Windows registry.
let steamRootPromise;
function steamRoot() {
  if (!steamRootPromise) {
    steamRootPromise = new Promise((resolve) => {
      if (process.platform !== 'win32') return resolve(null);
      execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], (err, out) => {
        const match = !err && out.match(/SteamPath\s+REG_SZ\s+(.+)/);
        resolve(match ? path.normalize(match[1].trim()) : 'C:\\Program Files (x86)\\Steam');
      });
    });
  }
  return steamRootPromise;
}

// Steam can keep games on several drives. libraryfolders.vdf lists them all.
async function libraryFolders(root) {
  const folders = [root];
  try {
    const text = await fs.readFile(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const match of text.matchAll(/"path"\s+"([^"]+)"/gi)) {
      folders.push(path.normalize(match[1].replace(/\\\\/g, '\\')));
    }
  } catch {
    // No extra libraries.
  }
  // Remove duplicates (the main Steam folder is usually listed too).
  const seen = new Set();
  return folders.filter((f) => {
    const key = f.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Reads one appmanifest_*.acf file, which describes one installed game.
function readManifest(text) {
  const field = (name) => text.match(new RegExp(`"${name}"\\s+"([^"]*)"`, 'i'))?.[1];
  return {
    appId: Number(field('appid')),
    name: field('name'),
    installDir: field('installdir'),
    size: Number(field('SizeOnDisk')) || null,
  };
}

// Returns a list of { name, exePath, appId, gameDir, size } for every installed Steam game.
async function findSteamGames(root) {
  root = root || (await steamRoot());
  if (!root) return [];

  const games = [];
  for (const library of await libraryFolders(root)) {
    const steamapps = path.join(library, 'steamapps');
    let files;
    try {
      files = await fs.readdir(steamapps);
    } catch {
      continue; // Drive unplugged or library removed.
    }

    for (const file of files.filter((f) => /^appmanifest_\d+\.acf$/i.test(f))) {
      let manifest;
      try {
        manifest = readManifest(await fs.readFile(path.join(steamapps, file), 'utf8'));
      } catch {
        continue;
      }
      if (!manifest.appId || !manifest.installDir || NOT_GAMES.has(manifest.appId)) continue;

      const gameDir = path.join(steamapps, 'common', manifest.installDir);
      const main = pickMainExe(await findExes(gameDir), manifest.installDir);
      if (!main) continue; // Not fully installed, or not a Windows game.

      games.push({
        name: manifest.name || manifest.installDir,
        exePath: main.path,
        appId: manifest.appId,
        gameDir,
        size: manifest.size,
      });
    }
  }
  return games;
}

module.exports = { steamRoot, findSteamGames };
