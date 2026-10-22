// Finds artwork for a game.
// Steam installs are matched exactly through Steam's own files; other games
// are looked up on the Steam store by name. Xbox app games get their art from
// the Microsoft Store first, and the pictures inside the game's own files last.
const fs = require('fs/promises');
const path = require('path');
const { steamRoot } = require('./steam');

const CDN = [
  'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps',
  'https://cdn.cloudflare.steamstatic.com/steam/apps',
];

// Kinds of art we look for, and Steam's file name for each.
// cover: tall box art for tiles. hero: wide banner for the game page.
// logo: the game's title logo, drawn over the banner.
const ART_FILES = {
  cover: 'library_600x900_2x.jpg',
  hero: 'library_hero.jpg',
  logo: 'logo.png',
};
const LOCAL_FILES = {
  cover: ['library_600x900.jpg', 'library_600x900_2x.jpg'],
  hero: ['library_hero.jpg'],
  logo: ['logo.png'],
};

// Makes names comparable: "FINAL FANTASY VII™" and "Final Fantasy 7" both become "finalfantasy7".
const ROMAN = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
const simplify = (text) =>
  text
    .toLowerCase()
    .replace(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b/g, (numeral) => ROMAN[numeral])
    .replace(/[^a-z0-9]+/g, '');

// If the game lives in a Steam library, reads its app id from Steam's manifest files.
async function steamAppIdFromInstall(exePath) {
  const match = exePath.match(/^(.*[\\/]steamapps)[\\/]common[\\/]([^\\/]+)/i);
  if (!match) return null;
  const [, steamapps, installDir] = match;
  let files;
  try {
    files = await fs.readdir(steamapps);
  } catch {
    return null;
  }
  for (const file of files.filter((f) => /^appmanifest_\d+\.acf$/i.test(f))) {
    try {
      const text = await fs.readFile(path.join(steamapps, file), 'utf8');
      const dir = text.match(/"installdir"\s+"([^"]+)"/i);
      const id = text.match(/"appid"\s+"(\d+)"/i);
      if (dir && id && dir[1].toLowerCase() === installDir.toLowerCase()) return Number(id[1]);
    } catch {
      // Skip unreadable manifests.
    }
  }
  return null;
}

// Searches the Steam store for a game by name and returns its app id
// only if the name is a close match.
async function steamAppIdFromName(name) {
  try {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=english&cc=US`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const { items = [] } = await res.json();
    const wanted = simplify(name);
    if (!wanted) return null;
    const exact = items.find((item) => simplify(item.name) === wanted);
    if (exact) return exact.id;
    // Otherwise the closest name that starts the same, shortest first, so
    // "Silent Hill 2" picks the game rather than its "Deluxe Edition".
    const close = items
      .map((item) => ({ id: item.id, simple: simplify(item.name) }))
      .filter(({ simple }) => simple.length >= 4 && (simple.startsWith(wanted) || wanted.startsWith(simple)))
      .sort((a, b) => a.simple.length - b.simple.length);
    return close.length ? close[0].id : null;
  } catch {
    return null; // Offline or Steam is down.
  }
}

async function urlExists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

// Looks in Steam's local image cache, which has art for every game in your Steam library.
async function localSteamArt(appId, kind) {
  const root = await steamRoot();
  if (!root) return null;
  const cache = path.join(root, 'appcache', 'librarycache');
  for (const name of LOCAL_FILES[kind]) {
    for (const candidate of [path.join(cache, String(appId), name), path.join(cache, `${appId}_${name}`)]) {
      if (await fileExists(candidate)) return candidate;
    }
  }
  // Newer Steam versions keep some images one folder deeper.
  try {
    const appDir = path.join(cache, String(appId));
    for (const entry of await fs.readdir(appDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const name of LOCAL_FILES[kind]) {
        const candidate = path.join(appDir, entry.name, name);
        if (await fileExists(candidate)) return candidate;
      }
    }
  } catch {
    // No cache folder for this game.
  }
  return null;
}

async function onlineSteamArt(appId, kind) {
  for (const base of CDN) {
    const url = `${base}/${appId}/${ART_FILES[kind]}`;
    if (await urlExists(url)) return url;
  }
  return null;
}

// Newer games keep their art at addresses with a code in them, which can't
// be guessed. Steam's store service lists the real file names
// (for covers and banners only; logos are found by guessing).
const ASSET_FIELDS = {
  cover: ['library_capsule_2x', 'library_capsule'],
  hero: ['library_hero_2x', 'library_hero'],
};
async function storeAssets(appId) {
  try {
    const input = {
      ids: [{ appid: appId }],
      context: { language: 'english', country_code: 'US' },
      data_request: { include_assets: true },
    };
    const res = await fetch(
      `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`
    );
    if (!res.ok) return {};
    const assets = (await res.json())?.response?.store_items?.[0]?.assets;
    if (!assets?.asset_url_format) return {};
    const found = {};
    for (const [kind, fields] of Object.entries(ASSET_FIELDS)) {
      const file = fields.map((f) => assets[f]).find(Boolean);
      if (file) found[kind] = `https://shared.akamai.steamstatic.com/store_item_assets/${assets.asset_url_format.replace('${FILENAME}', file)}`;
    }
    return found;
  } catch {
    return {};
  }
}

// Steam's store page always lists a wide header image, even when the
// other art has moved to a different address.
async function headerImage(appId) {
  try {
    const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic`);
    const json = await res.json();
    return json[appId]?.data?.header_image || null;
  } catch {
    return null;
  }
}

// ---------- Microsoft Store (for Xbox app games) ----------

// The Microsoft Store's catalogue, looked up by the game's package name.
// It lists a tall "Poster" (like Steam's covers), a wide "SuperHeroArt"
// banner and a square "BoxArt".
async function microsoftStoreArt(packageFamily) {
  try {
    const url = `https://displaycatalog.mp.microsoft.com/v7.0/products/lookup?alternateId=PackageFamilyName&value=${encodeURIComponent(packageFamily)}&market=US&languages=en-US&fieldsTemplate=details`;
    const res = await fetch(url);
    if (!res.ok) return {};
    const json = await res.json();
    const images = json?.Products?.[0]?.LocalizedProperties?.[0]?.Images || [];
    // The biggest picture of a kind. Addresses start with "//", so add https:.
    const pick = (purpose) => {
      const best = images
        .filter((i) => i.ImagePurpose === purpose && i.Uri)
        .sort((a, b) => (b.Width || 0) * (b.Height || 0) - (a.Width || 0) * (a.Height || 0))[0];
      return best ? (best.Uri.startsWith('//') ? `https:${best.Uri}` : best.Uri) : null;
    };
    return { cover: pick('Poster'), hero: pick('SuperHeroArt'), header: pick('BoxArt') || pick('Tile') };
  } catch {
    return {}; // Offline or the store is down.
  }
}

// Bump this to look again for art for games where nothing was found before.
const ART_VERSION = 2;
const noArt = (art) => !art?.cover && !art?.hero && !art?.header;

// Works out the art for one game. Each value is a local file path, a web
// address, or null when nothing was found.
async function findArt(game) {
  if (game.folder === 'Xbox' && game.storeId) {
    const store = await microsoftStoreArt(game.storeId);
    if (store.cover || store.hero || store.header) {
      return { appId: null, cover: store.cover || null, hero: store.hero || null, logo: null, header: store.header || null, v: ART_VERSION };
    }
  }

  const art = { ...(await findSteamArt(game)), v: ART_VERSION };
  // Last resort for Xbox games: the pictures inside the game's own files.
  if (noArt(art) && game.localArt) {
    art.header = game.localArt.square || null;
    art.hero = game.localArt.splash || null;
  }
  return art;
}

async function findSteamArt(game) {
  const appId = game.appId
    || (await steamAppIdFromInstall(game.exePath))
    || (await steamAppIdFromName(game.name));
  const art = { appId, cover: null, hero: null, logo: null, header: null };
  if (!appId) return art;

  let store;
  for (const kind of Object.keys(ART_FILES)) {
    art[kind] = await localSteamArt(appId, kind);
    if (art[kind]) continue;
    store = store || (await storeAssets(appId));
    art[kind] = store[kind] || (await onlineSteamArt(appId, kind));
  }
  if (!art.cover || !art.hero) art.header = await headerImage(appId);
  return art;
}

module.exports = { findArt, ART_VERSION, noArt };
