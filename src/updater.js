// Checks GitHub for a newer version of the launcher.
// The installed launcher downloads and installs it in one click (with
// electron-updater). The portable zip can't replace itself while it runs, so
// it says a new version is out and opens the download page instead.
const REPO = 'maddixwoodhams05-netizen/MAIO-launcher';
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

// "1.10.0" is newer than "1.9.2". Anything after a "-" (like "-beta") is ignored.
function isNewer(latest, current) {
  const parts = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const [a, b] = [parts(latest), parts(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

// Asks GitHub for the newest release: { version, url }. GitHub's "latest
// release" page forwards to the page of that version, e.g. .../tag/v1.1.0.
// (This avoids GitHub's API, which only allows 60 checks an hour.)
async function latestRelease() {
  const res = await fetch(RELEASES_PAGE, { method: 'HEAD', headers: { 'User-Agent': 'Maio-Launcher' } });
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  const tag = decodeURIComponent(res.url.match(/\/releases\/tag\/([^/?#]+)/)?.[1] || '');
  if (!tag) throw new Error('GitHub has no releases yet');
  return { version: tag.replace(/^v/, ''), url: res.url };
}

// current: this launcher's version.
// autoUpdater: electron-updater's updater for the installed launcher, or
// null for the portable one (and when run from the code).
// send: passes every change on to the window.
// openUrl: opens a web page in the normal browser.
function createUpdater({ current, autoUpdater, send, openUrl }) {
  let info = { state: 'idle', current, canInstall: !!autoUpdater };
  let pageUrl = RELEASES_PAGE;
  const set = (change) => {
    info = { ...info, ...change };
    send(info);
  };

  if (autoUpdater) {
    autoUpdater.autoDownload = false; // only when the user says so
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on('update-available', (u) => set({ state: 'available', version: u.version }));
    autoUpdater.on('update-not-available', () => set({ state: 'none' }));
    autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: p.percent }));
    autoUpdater.on('update-downloaded', () => {
      set({ state: 'installing' });
      // Installs quietly, then opens the new version.
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 1500);
    });
    autoUpdater.on('error', (err) => {
      // A failed download goes back to "available" so it can be tried again.
      if (info.state === 'downloading') set({ state: 'available', percent: 0, message: err?.message });
      else set({ state: 'error', message: shortError(err) });
    });
  }

  let checking = null;
  function check() {
    if (checking || ['downloading', 'installing'].includes(info.state)) return checking;
    set({ state: 'checking', message: null });
    checking = (async () => {
      try {
        if (autoUpdater) {
          await autoUpdater.checkForUpdates();
        } else {
          const latest = await latestRelease();
          pageUrl = latest.url;
          if (isNewer(latest.version, current)) set({ state: 'available', version: latest.version });
          else set({ state: 'none' });
        }
      } catch (err) {
        set({ state: 'error', message: shortError(err) });
      }
    })().finally(() => (checking = null));
    return checking;
  }

  function install() {
    if (info.state !== 'available') return;
    if (!autoUpdater) return openUrl(pageUrl);
    set({ state: 'downloading', percent: 0 });
    autoUpdater.downloadUpdate().catch(() => {}); // errors arrive through 'error' above
  }

  return { check, install, openPage: () => openUrl(pageUrl), status: () => info };
}

// The first line of an error, without the long technical part.
function shortError(err) {
  const text = String(err?.message || err || 'unknown problem').split('\n')[0];
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

module.exports = { createUpdater, isNewer, RELEASES_PAGE };
