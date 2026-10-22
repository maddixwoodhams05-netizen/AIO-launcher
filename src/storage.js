// Works out how much space games use, how full each drive is, and how a
// game can be uninstalled.
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// Adds up the size of every file in a folder and the folders inside it.
async function folderSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await folderSize(full);
    else if (entry.isFile()) {
      try {
        total += (await fs.stat(full)).size;
      } catch {
        // File vanished or is locked.
      }
    }
  }
  return total;
}

// Free and total space on the drive a folder is on, e.g. C:\.
async function driveInfo(dir) {
  const root = path.parse(path.resolve(dir)).root;
  try {
    const stats = await fs.statfs(root);
    return { root, free: stats.bavail * stats.bsize, total: stats.blocks * stats.bsize };
  } catch {
    return null;
  }
}

const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const inside = (child, parent) => path.resolve(child).toLowerCase().startsWith(path.resolve(parent).toLowerCase() + path.sep);

// Folders that must never be thrown away, however a game was found.
function protectedFolders() {
  const home = os.homedir();
  const list = [home, ...['Desktop', 'Documents', 'Downloads', 'Games'].map((f) => path.join(home, f))];
  if (process.platform === 'win32') {
    const drive = path.parse(home).root;
    for (const f of ['Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', 'Users', 'Games']) list.push(path.join(drive, f));
  }
  return list;
}

// Says whether a game's folder can safely go to the Recycle Bin.
// Returns null if it can, or the reason it can't.
function whyNotTrash(game, library) {
  const dir = game.gameDir;
  if (!dir) return "The launcher doesn't know which folder this game is in.";
  const resolved = path.resolve(dir);
  if (resolved === path.parse(resolved).root) return 'The game is in the top of a drive.';
  if (protectedFolders().some((f) => same(f, resolved))) return 'The game is in a folder that holds more than games.';
  if (path.basename(resolved).toLowerCase() === 'common') return 'The game is in a folder that holds other games.';
  if (library.folders.some((f) => same(f, resolved))) return 'The game is the whole folder you added, which might hold other things.';
  if (library.games.some((g) => g !== game && (inside(g.exePath, resolved)))) return 'Another game in the launcher is inside the same folder.';
  if (inside(__dirname, resolved)) return 'The launcher itself is inside this folder.';
  return null;
}

// Looks in Windows' list of installed programs for the game's uninstaller.
const FIND_UNINSTALLER = `
$dir = $env:GAME_DIR.TrimEnd('\\')
$keys = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
foreach ($p in Get-ItemProperty $keys -ErrorAction SilentlyContinue) {
  $loc = "$($p.InstallLocation)".Trim('"').TrimEnd('\\')
  if ($loc.Length -gt 3 -and $p.UninstallString -and $loc -ieq $dir) { $p.UninstallString; exit }
}
`;

function findUninstaller(gameDir) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !gameDir) return resolve(null);
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', FIND_UNINSTALLER],
      { windowsHide: true, timeout: 20000, env: { ...process.env, GAME_DIR: gameDir } },
      async (err, out) => {
        const command = !err && out.trim().split(/\r?\n/)[0];
        if (command) return resolve(command);
        // Many installers (e.g. GOG's) leave an unins000.exe in the game folder.
        try {
          const file = (await fs.readdir(gameDir)).find((f) => /^unins\d*\.exe$/i.test(f));
          resolve(file ? `"${path.join(gameDir, file)}"` : null);
        } catch {
          resolve(null);
        }
      }
    );
  });
}

// Uninstalls an Xbox app game the way Windows' own Apps settings do.
// family: the game's package family name, e.g. "Microsoft.Minecraft_8wekyb3d8bbwe".
const REMOVE_PACKAGE = `
$ErrorActionPreference = 'Stop'
$found = @(Get-AppxPackage | Where-Object { $_.PackageFamilyName -eq $env:PACKAGE_FAMILY })
if (-not $found.Count) { Write-Output 'not found'; exit 2 }
$found | Remove-AppxPackage
`;

function removeAppPackage(family) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ ok: false, message: 'Only works on Windows.' });
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', REMOVE_PACKAGE],
      { windowsHide: true, timeout: 10 * 60 * 1000, env: { ...process.env, PACKAGE_FAMILY: family } },
      (err, out, errText) => {
        if (!err) return resolve({ ok: true });
        if (/not found/.test(out)) return resolve({ ok: false, message: 'Windows says this game is no longer installed.' });
        const reason = String(errText || err.message).split(/\r?\n/).find((line) => line.trim()) || 'unknown problem';
        resolve({ ok: false, message: `Windows couldn't uninstall it: ${reason.trim()}` });
      }
    );
  });
}

module.exports = { folderSize, driveInfo, whyNotTrash, findUninstaller, removeAppPackage };
