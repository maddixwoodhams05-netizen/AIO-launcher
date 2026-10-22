// Finds games installed through the Epic Games Launcher, GOG Galaxy,
// the EA app, Ubisoft Connect and the Xbox app, the same way steam.js finds Steam games:
// by reading each store's own list of what it installed.
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { findExes, pickMainExe } = require('./scanner');

const exists = (file) => fs.access(file).then(() => true, () => false);

// ---------- Windows registry ----------

// Turns the text from "reg query <key> /s" into { 'KEY\\PATH': { name: value } }.
function parseRegistry(text) {
  const keys = {};
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) {
      current = keys[line.trim()] = {};
      continue;
    }
    const match = current && line.match(/^\s{4}(.+?)\s{4}(REG_\w+)(?:\s{4}(.*))?$/);
    if (match) current[match[1]] = (match[3] || '').trim();
  }
  return keys;
}

// Reads a registry key and everything under it. Gives {} if it isn't there.
function readRegistry(key) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({});
    execFile('reg', ['query', key, '/s'], { windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (err, out) =>
      resolve(err ? {} : parseRegistry(out))
    );
  });
}

// Reads several registry keys into one list of { key, values }.
async function readKeys(registry, keys) {
  const all = await Promise.all(keys.map((k) => registry(k)));
  return all.flatMap((found) => Object.entries(found).map(([key, values]) => ({ key, values })));
}

// Windows' list of installed programs (what "Add or remove programs" shows).
const UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

const cleanDir = (dir) => (dir ? path.normalize(dir.replace(/^"|"$/g, '').replace(/[\\/]+$/, '')) : null);

// Picks the game's main EXE: the one the store names if it is there,
// otherwise the best guess from the folder.
async function mainExe(gameDir, name, named) {
  if (named && (await exists(named))) return named;
  return pickMainExe(await findExes(gameDir), name)?.path || null;
}

// ---------- Epic Games Launcher ----------

// Epic keeps one small JSON file per installed game.
async function findEpicGames({ manifests } = {}) {
  if (!manifests) {
    if (process.platform !== 'win32') return [];
    manifests = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  }
  let files;
  try {
    files = (await fs.readdir(manifests)).filter((f) => f.toLowerCase().endsWith('.item'));
  } catch {
    return []; // Epic isn't installed.
  }

  const games = [];
  for (const file of files) {
    let item;
    try {
      item = JSON.parse(await fs.readFile(path.join(manifests, file), 'utf8'));
    } catch {
      continue;
    }
    // Skip add-ons, half-finished downloads and things like Unreal Engine.
    if (item.bIsIncompleteInstall) continue;
    if (item.MainGameAppName && item.MainGameAppName !== item.AppName) continue;
    if (Array.isArray(item.AppCategories) && !item.AppCategories.includes('games')) continue;
    const gameDir = cleanDir(item.InstallLocation);
    if (!gameDir || !(await exists(gameDir))) continue;

    const named = item.LaunchExecutable ? path.join(gameDir, item.LaunchExecutable) : null;
    const exePath = await mainExe(gameDir, item.DisplayName, named);
    if (!exePath) continue;
    const id = [item.CatalogNamespace, item.CatalogItemId, item.AppName].map(encodeURIComponent).join('%3A');
    games.push({
      name: item.DisplayName || path.basename(gameDir),
      exePath,
      gameDir,
      store: 'Epic',
      storeId: item.AppName,
      // Starting through Epic keeps things like cloud saves and achievements working.
      launchUrl: `com.epicgames.launcher://apps/${id}?action=launch&silent=true`,
      size: Number(item.InstallSize) || null,
    });
  }
  return games;
}

// ---------- GOG Galaxy ----------

// GOG lists every game it installed in the registry. GOG games don't need
// GOG Galaxy to run, so they start straight from their EXE.
async function findGogGames({ registry = readRegistry } = {}) {
  const entries = await readKeys(registry, ['HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', 'HKLM\\SOFTWARE\\GOG.com\\Games']);
  const games = [];
  const seen = new Set();
  for (const { values } of entries) {
    const gameDir = cleanDir(values.path);
    // dependsOn is set on add-ons (DLC), which aren't games of their own.
    if (!values.gameID || !gameDir || values.dependsOn || seen.has(values.gameID)) continue;
    seen.add(values.gameID);
    if (!(await exists(gameDir))) continue;
    const name = values.gameName || values.GAMENAME || path.basename(gameDir);
    const exePath = await mainExe(gameDir, name, values.exe && cleanDir(values.exe));
    if (!exePath) continue;
    games.push({ name, exePath, gameDir, store: 'GOG', storeId: values.gameID });
  }
  return games;
}

// ---------- Ubisoft Connect ----------

// Ubisoft lists install folders by game id. The names come from Windows'
// list of installed programs, where each one is called "Uplay Install <id>".
async function findUbisoftGames({ registry = readRegistry } = {}) {
  const installs = await readKeys(registry, [
    'HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs',
    'HKLM\\SOFTWARE\\Ubisoft\\Launcher\\Installs',
  ]);
  if (!installs.length) return [];
  const uninstall = await readKeys(registry, UNINSTALL_KEYS);

  const games = [];
  const seen = new Set();
  for (const { key, values } of installs) {
    const id = key.match(/\\Installs\\(\d+)$/i)?.[1];
    const gameDir = cleanDir(values.InstallDir);
    if (!id || !gameDir || seen.has(id)) continue;
    seen.add(id);
    if (!(await exists(gameDir))) continue;
    const listed = uninstall.find((u) => u.key.toLowerCase().endsWith(`\\uplay install ${id}`));
    const name = listed?.values.DisplayName || path.basename(gameDir);
    const exePath = await mainExe(gameDir, name);
    if (!exePath) continue;
    games.push({ name, exePath, gameDir, store: 'Ubisoft', storeId: id, launchUrl: `uplay://launch/${id}/0` });
  }
  return games;
}

// ---------- EA app ----------

// EA games show up in Windows' list of installed programs with EA's
// uninstaller. Each one keeps its EA ids in __Installer\installerdata.xml.
async function findEaGames({ registry = readRegistry } = {}) {
  const uninstall = await readKeys(registry, UNINSTALL_KEYS);
  const games = [];
  const seen = new Set();
  for (const { values } of uninstall) {
    const how = `${values.UninstallString || ''} ${values.QuietUninstallString || ''}`;
    // Games bought on Steam have EA files too, but Steam finds those.
    if (!/EAInstaller|EA Desktop|[\\/]Origin[\\/]/i.test(how) || /steam:/i.test(how)) continue;
    const gameDir = cleanDir(values.InstallLocation);
    if (!gameDir || seen.has(gameDir.toLowerCase())) continue;
    seen.add(gameDir.toLowerCase());
    if (!(await exists(gameDir))) continue;

    let ids = [];
    try {
      const xml = await fs.readFile(path.join(gameDir, '__Installer', 'installerdata.xml'), 'utf8');
      ids = [...xml.matchAll(/<contentID>\s*([^<\s]+)\s*<\/contentID>/gi)].map((m) => m[1]);
    } catch {
      // No EA id file: the game starts straight from its EXE.
    }
    const name = values.DisplayName || path.basename(gameDir);
    const exePath = await mainExe(gameDir, name);
    if (!exePath) continue;
    games.push({
      name,
      exePath,
      gameDir,
      store: 'EA',
      storeId: ids[0] || null,
      launchUrl: ids.length ? `origin2://game/launch?offerIds=${ids.map(encodeURIComponent).join(',')}&autoDownload=1` : null,
    });
  }
  return games;
}

// ---------- Xbox app (PC Game Pass and Microsoft Store games) ----------

// Asks Windows for its installed app packages. Games are the ones with a
// MicrosoftGame.config file, which the Xbox app's games all have.
const LIST_XBOX_GAMES = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$games = foreach ($p in Get-AppxPackage) {
  if (-not $p.InstallLocation -or $p.IsFramework) { continue }
  $config = Join-Path $p.InstallLocation 'MicrosoftGame.config'
  if (-not (Test-Path -LiteralPath $config)) { continue }
  $manifest = Get-AppxPackageManifest $p
  [pscustomobject]@{
    name = $p.Name
    family = $p.PackageFamilyName
    dir = $p.InstallLocation
    appId = @($manifest.Package.Applications.Application)[0].Id
    displayName = $manifest.Package.Properties.DisplayName
    config = Get-Content -LiteralPath $config -Raw
  }
}
ConvertTo-Json @($games) -Depth 3 -Compress
`;

function listXboxPackages() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', LIST_XBOX_GAMES],
      { windowsHide: true, timeout: 60000, maxBuffer: 20 * 1024 * 1024 },
      (err, out) => {
        try {
          resolve(err ? [] : [].concat(JSON.parse(out.trim() || '[]')));
        } catch {
          resolve([]);
        }
      }
    );
  });
}

// "Microsoft.SeaofThieves" → "Seaof Thieves" is the last resort when the
// package only has a name Windows has to look up.
const plainName = (text) => (text && !/^ms-resource:/i.test(text) ? text.trim() : null);
const packageName = (name) => name.replace(/^[^.]+\./, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2');

async function findXboxGames({ xboxPackages = listXboxPackages } = {}) {
  const games = [];
  for (const pkg of await xboxPackages()) {
    if (!pkg?.family || !pkg.dir || !pkg.appId) continue;
    const config = String(pkg.config || '');
    const name =
      plainName(config.match(/DefaultDisplayName\s*=\s*"([^"]+)"/i)?.[1]) ||
      plainName(pkg.displayName) ||
      packageName(pkg.name || pkg.family);
    // The game's own EXE, so playtime can be counted while it runs.
    const exe = config.match(/<Executable\b[^>]*\bName\s*=\s*"([^"]+)"/i)?.[1];
    const exePath = exe ? path.join(pkg.dir, exe) : await mainExe(pkg.dir, name);
    if (!exePath) continue;
    games.push({
      name,
      exePath,
      gameDir: pkg.dir,
      store: 'Xbox',
      storeId: pkg.family,
      // Xbox games can only be started through Windows, not from their EXE.
      launchUrl: `shell:AppsFolder\\${pkg.family}!${pkg.appId}`,
    });
  }
  return games;
}

// The automatic tests use pretend stores, described in a JSON file:
// { manifests: Epic's folder, registry: { key: "reg query" text }, xboxPackages: [...] }
function testStores() {
  const file = process.env.LAUNCHER_TEST_STORES;
  if (!file) return {};
  const fake = JSON.parse(require('fs').readFileSync(file, 'utf8'));
  return {
    manifests: fake.manifests || path.join(file, 'no-epic'),
    registry: async (key) => parseRegistry(fake.registry?.[key] || ''),
    xboxPackages: async () => fake.xboxPackages || [],
  };
}

// Every game from every store above. One store failing never stops the others.
async function findStoreGames(options = testStores()) {
  const lists = await Promise.all(
    [findEpicGames, findGogGames, findEaGames, findUbisoftGames, findXboxGames].map((find) => find(options).catch(() => []))
  );
  return lists.flat();
}

// What each store is called, and how to uninstall when the launcher can't.
const STORES = {
  Steam: { name: 'Steam' },
  Epic: { name: 'Epic Games', uninstallHelp: 'Open the Epic Games Launcher, go to Library, click the three dots on the game, then Uninstall.' },
  GOG: { name: 'GOG', uninstallHelp: 'Open GOG Galaxy, click the game, then the settings button next to Play, then Manage installation, then Uninstall.' },
  EA: { name: 'EA app', uninstallHelp: 'Open the EA app, go to Library, click the three dots on the game, then Uninstall.' },
  Ubisoft: { name: 'Ubisoft Connect', uninstallHelp: 'Open Ubisoft Connect, go to Games, right-click the game, then Uninstall.' },
  Xbox: { name: 'Xbox', uninstallHelp: 'Open the Xbox app, right-click the game in My Library, then Uninstall.' },
};

module.exports = { parseRegistry, findEpicGames, findGogGames, findEaGames, findUbisoftGames, findXboxGames, findStoreGames, STORES };
