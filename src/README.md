# src: the launcher itself

| File | What it does |
| --- | --- |
| `main.js` | Starts the app and does everything the window asks for: launching, closing, renaming, uninstalling, saving |
| `preload.js` | The safe bridge between the window and `main.js` |
| `index.html`, `styles.css`, `renderer.js` | The window: pages, tiles, buttons, themes, search |
| `library.js` | Loads and saves your library (games, groups, settings) |
| `scanner.js` | Finds games inside folders you add and picks each game's main EXE |
| `steam.js` | Finds installed Steam games on every drive |
| `stores.js` | Finds games from Epic Games, GOG, EA app, Ubisoft Connect and Xbox |
| `store-logos.js` | The little store logos shown on game art, store tabs and the Storage page |
| `updater.js` | Checks GitHub for a new version and installs it (or opens the download page for the portable zip) |
| `art.js` | Fetches covers, banners and logos from Steam |
| `exeicon.js` | Gets a game's icon from its EXE |
| `playtime.js` | Checks every few seconds which games are running and counts playtime |
| `playtime-stats.js` | Turns playtime into the week, month and year charts |
| `closegame.js` | Closes a running game for the Close game button |
| `storage.js` | Drive sizes, game folder sizes and uninstalling |
| `icon.png` | The Maio icon (a purple M) on the window |
