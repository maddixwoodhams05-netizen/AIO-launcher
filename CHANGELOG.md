# Changelog

Every version of the launcher and what changed in it, newest first.
Each release on GitHub shows its own part of this list.

## 1.1.2

### Changed
- The launcher is now called **Maio Launcher** everywhere: the window, the
  installer, shortcuts, downloads and the GitHub page (now MAIO-launcher; old
  links still work). The project's name wasn't updated in the earlier
  releases, so now they all match.
- New icon: a purple M, in the same style as before.
- Fresh screenshots on the GitHub page.

Your library, playtime and settings carry over as they are.

## 1.1.1

### New
- Uninstall Ubisoft Connect and Xbox games from the launcher. Ubisoft Connect
  asks you to confirm; Xbox games are removed by Windows, like in the Xbox app.

### Fixed
- Xbox app games that aren't on Steam (like Minecraft Launcher or Roblox) now
  get artwork: a cover and banner from the Microsoft Store, or the game's own
  logo if the store has none. Games that got no art before look again by
  themselves.
- Playtime didn't show on Xbox game pages. Windows keeps Xbox games in a locked
  folder, and not being able to read the game's icon stopped the page loading.

## 1.1.0

### New
- **Finds games from more stores by itself**: Epic Games, GOG, EA app, Ubisoft
  Connect and Xbox (PC Game Pass), as well as Steam. Epic, EA, Ubisoft and Xbox
  games start through their own app, so cloud saves and sign-in still work.
- **A tab for each store** in the sidebar, plus "Other" for games from your own
  folders. Switch the tabs off in Settings if you'd rather not have them.
- **Store logos** in the corner of each game's art, so you can see where every
  game came from. These can be switched off in Settings too.
- **Storage by store**: the ring now goes from your drives, to Games split by
  store, to the games in one store. The list of games with Uninstall buttons is
  there at every step.
- **Updates in one click**: the launcher checks for a new version when it starts
  (or when you press Check for updates in Settings). The installed launcher
  downloads and installs it with one click and keeps your library. The portable
  version tells you and opens the download page.
- This changelog. Every release now lists what changed.

### Changed
- The downloads are now called `Game-Launcher-Setup-<version>.exe` and
  `Game-Launcher-<version>-portable.zip`.
- Games from a store are never sent to the Recycle Bin. If the launcher can't
  uninstall one itself, it tells you how to do it in that store's app.

### Fixed
- Game names on tiles were invisible with the Light theme.

### Note
Version 1.0.0 can't update itself, so install 1.1.0 by hand once. From then
on, updates take one click.

## 1.0.0

The first version.

- Finds your Steam games by itself, plus games in any folders you add
- Steam artwork for every game, including non-Steam games you rename
- Play button that shows Launching..., then Close game while it runs
- Playtime tracking with week / month / year charts
- Favourites, Last played and your own groups
- Storage page showing how much space each game uses, with uninstall
- Colour themes, including your own saved themes
- Search from anywhere with Ctrl+F
