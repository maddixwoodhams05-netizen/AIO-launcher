# Maio Launcher

One place for every game on your Windows PC. It finds your games from Steam,
Epic Games, GOG, EA app, Ubisoft Connect and Xbox by itself, plus games in any
folders you choose, and gives them proper artwork, playtime stats and a tidy
library.

![All games](docs/all-games.png)

## Download

Get the latest version from the [Releases page](../../releases/latest):

- **Maio-Launcher-Setup.exe**: installs the launcher with desktop and Start
  menu shortcuts. It updates itself in one click when a new version is out,
  and your library is kept.
- **Maio-Launcher-portable.zip**: no install. Unzip anywhere (even a USB stick)
  and run `Maio Launcher.exe`. It keeps its library in a `Maio Launcher data`
  folder next to itself, and tells you when a new version is out.

### Requirements

- Windows 10 or 11, 64-bit
- That's it. Everything the launcher needs is built in, so there's nothing
  else to install. Steam, Epic Games, GOG, EA app, Ubisoft Connect and the
  Xbox app are all optional: any you have, their games are found automatically.

Windows may say "Windows protected your PC" because the app isn't signed.
Click **More info**, then **Run anyway**.

## Features

- Finds installed games from Steam, Epic Games, GOG, EA app, Ubisoft Connect
  and Xbox automatically, plus games in folders you add
- A tab for each store, and the store's logo on each game (both can be
  switched off in Settings)
- Steam artwork (covers, banners, logos), even for non-Steam games: rename a
  game to its proper name and the art is fetched
- Play button shows Launching..., then Close game while the game runs
- Playtime tracking with week, month and year charts
- Favourites, Last played, and your own groups (drag games onto them)
- Storage page: how much space your games take, split by store, and uninstall
  from the launcher (through Steam, the game's own uninstaller, or the Recycle Bin)
- Colour themes, plus your own saved themes
- Search from anywhere with Ctrl+F
- Updates itself in one click. See what changed in each version in the
  [changelog](CHANGELOG.md)

![Storage page](docs/storage-page.png)

![Settings and themes](docs/settings.png)

## For developers

Needs [Node.js](https://nodejs.org) (LTS). The code is in [`src`](src) and the
automatic tests in [`tests`](tests); each folder has a short guide to its files.

| What | How |
| --- | --- |
| Run from the code | `npm install` once, then `npm start` |
| Run the tests | `npm test` or double-click `Run tests.bat` |
| Build installer + zip | `npm run dist` or double-click `Build launcher.bat` (output in `dist`) |
| Publish a release | bump `version` in package.json, add what changed to [CHANGELOG.md](CHANGELOG.md), then Actions → Release → Run workflow; it builds on Windows, attaches the downloads and uses that version's changelog as the release notes |

The tests start the real launcher with pretend games and a throwaway library,
so your own library is never touched.
