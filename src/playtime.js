// Watches which games are running, checking every few seconds.
// This counts playtime, and tells the window when a game starts or stops so
// the Play button can change. It also counts games started from Steam or a
// desktop shortcut, as long as the launcher is open.
const path = require('path');
const { execFile } = require('child_process');

const CHECK_EVERY_MS = 5 * 1000;

// Returns the lower-case names of every running program, e.g. "witcher3.exe".
function runningPrograms() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(new Set());
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve(new Set());
      const names = out.split(/\r?\n/).map((line) => line.split('","')[0].replace(/^"/, '').toLowerCase());
      resolve(new Set(names.filter(Boolean)));
    });
  });
}

// Steam writes the id of the game it is running into the registry.
// This catches Steam games whose real EXE isn't the one we guessed.
function steamRunningAppId() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(0);
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'RunningAppID'], { windowsHide: true }, (err, out) => {
      const match = !err && out.match(/RunningAppID\s+REG_DWORD\s+0x([0-9a-f]+)/i);
      resolve(match ? parseInt(match[1], 16) : 0);
    });
  });
}

// getLibrary: returns the current library
// onPlaytime: called after playtime changes, so it can be saved and shown
// onCheck: called after every check, with the set of running EXE paths
function startTracking(getLibrary, { onPlaytime, onCheck }) {
  // Games running right now, mapped to their open session.
  const active = new Map();

  let checking = null;
  async function check() {
    const library = getLibrary();
    const [running, steamAppId] = await Promise.all([runningPrograms(), steamRunningAppId()]);
    const now = Date.now();
    let changed = false;

    for (const game of library.games) {
      const isRunning =
        running.has(path.basename(game.exePath).toLowerCase()) || (!!game.appId && game.appId === steamAppId);
      const session = active.get(game.exePath);

      if (isRunning && session) {
        session[1] = now;
        changed = true;
      } else if (isRunning) {
        // Each session is saved as [start time, end time].
        const newSession = [now, now];
        game.sessions = game.sessions || [];
        game.sessions.push(newSession);
        active.set(game.exePath, newSession);
        changed = true;
      } else if (session) {
        active.delete(game.exePath);
      }
      if (isRunning) game.lastPlayed = now;
    }

    if (changed) onPlaytime();
    onCheck(new Set(active.keys()));
  }

  // Never runs two checks at once.
  function checkNow() {
    if (!checking) checking = check().finally(() => (checking = null));
    return checking;
  }

  checkNow();
  const timer = setInterval(checkNow, CHECK_EVERY_MS);
  return { checkNow, isRunning: (exePath) => active.has(exePath), stop: () => clearInterval(timer) };
}

module.exports = { startTracking };
