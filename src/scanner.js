// Finds games inside the folders the user picked.
// Each subfolder of a picked folder is treated as one game, and we pick the
// EXE in it that most looks like the game itself.
const fs = require('fs/promises');
const path = require('path');

// How many folders deep to look inside each game folder.
const MAX_DEPTH = 4;

// EXE names that are almost never the game itself.
const JUNK_EXE = [
  'unins', 'uninstall', 'setup', 'install', 'redist', 'vcredist', 'vc_redist',
  'dxsetup', 'dxwebsetup', 'dotnet', 'crashhandler', 'crashreport', 'crashpad',
  'unitycrashhandler', 'ue4prereq', 'ueprereq', 'prereq', 'easyanticheat',
  'beservice', 'battleye', 'update', 'patcher', 'helper', 'cefprocess',
  'webhelper', 'errorreporter', 'bugreport', 'touchup', 'cleanup', 'quicksfv',
];

// Folders that only hold installers, tools or engine files.
const JUNK_DIRS = [
  '_commonredist', 'commonredist', 'redist', 'redistributables', 'directx',
  '__installer', 'installer', '_installer', 'support', 'thirdparty',
  'easyanticheat', 'battleye', 'prereqs', 'prerequisites', 'vcredist',
  'dotnet', 'tools', 'crashreportclient',
];

function isJunkExe(fileName) {
  const name = fileName.toLowerCase().replace(/\.exe$/, '').replace(/[\s_-]/g, '');
  return JUNK_EXE.some((junk) => name.includes(junk));
}

function isJunkDir(dirName) {
  return JUNK_DIRS.includes(dirName.toLowerCase());
}

// Turns "the_witcher-3" into "the witcher 3" so names can be compared.
function simplify(text) {
  return text.toLowerCase().replace(/\.exe$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Turns a folder name into a nicer game title.
function prettyName(folderName) {
  return folderName.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Lists every non-junk EXE inside a folder, up to MAX_DEPTH levels down.
async function findExes(dir, depth = 0) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return []; // No permission or folder vanished, so skip it.
  }

  const exes = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe') && !isJunkExe(entry.name)) {
      try {
        const { size } = await fs.stat(fullPath);
        exes.push({ path: fullPath, name: entry.name, size, depth });
      } catch {
        // Skip files we can't read.
      }
    } else if (entry.isDirectory() && depth < MAX_DEPTH && !isJunkDir(entry.name)) {
      exes.push(...(await findExes(fullPath, depth + 1)));
    }
  }
  return exes;
}

// Scores how likely an EXE is to be the main game EXE.
function score(exe, gameName) {
  const exeName = simplify(exe.name);
  const folder = simplify(gameName);
  const folderNoSpaces = folder.replace(/ /g, '');
  let points = 0;

  if (exeName === folder || exeName.replace(/ /g, '') === folderNoSpaces) points += 100;
  else if (folderNoSpaces.includes(exeName.replace(/ /g, '')) || exeName.includes(folder)) points += 50;
  else if (folder.split(' ').some((word) => word.length > 2 && exeName.includes(word))) points += 20;

  // Files closer to the top of the game folder are more likely the real game.
  points -= exe.depth * 10;
  // Bigger EXEs are usually the game rather than a small tool.
  points += Math.min(exe.size / (1024 * 1024), 30);
  return points;
}

function pickMainExe(exes, gameName) {
  if (exes.length === 0) return null;
  return exes.reduce((best, exe) => (score(exe, gameName) > score(best, gameName) ? exe : best));
}

// Scans one picked folder and returns a list of { name, exePath, gameDir },
// or null if the folder can't be opened.
async function scanFolder(folder) {
  let entries;
  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch {
    return null; // Folder can't be reached right now (e.g. a USB drive is unplugged).
  }

  // If a Steam folder was picked, the games are inside steamapps\common.
  const names = entries.map((e) => e.name.toLowerCase());
  if (names.includes('steamapps')) return scanFolder(path.join(folder, 'steamapps', 'common'));
  if (path.basename(folder).toLowerCase() === 'steamapps' && names.includes('common')) {
    return scanFolder(path.join(folder, 'common'));
  }

  const games = [];

  // EXEs sitting directly in the picked folder mean it is a single game's folder.
  const topLevelExes = entries.filter(
    (e) => e.isFile() && e.name.toLowerCase().endsWith('.exe') && !isJunkExe(e.name)
  );
  if (topLevelExes.length > 0) {
    const name = path.basename(folder);
    const main = pickMainExe(await findExes(folder, MAX_DEPTH), name);
    if (main) games.push({ name: prettyName(name), exePath: main.path, gameDir: folder });
    return games;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || isJunkDir(entry.name)) continue;
    const gameDir = path.join(folder, entry.name);
    const main = pickMainExe(await findExes(gameDir), entry.name);
    if (main) games.push({ name: prettyName(entry.name), exePath: main.path, gameDir });
  }
  return games;
}

module.exports = { scanFolder, findExes, pickMainExe };
