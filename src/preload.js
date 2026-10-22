// Safely shares features from the main process with the window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  rescan: () => ipcRenderer.invoke('library:rescan'),
  onUpdate: (callback) => ipcRenderer.on('library:updated', (_event, library) => callback(library)),
  addFolder: () => ipcRenderer.invoke('folders:add'),
  removeFolder: (folder) => ipcRenderer.invoke('folders:remove', folder),
  getIcon: (exePath) => ipcRenderer.invoke('game:icon', exePath),
  getImage: (source) => ipcRenderer.invoke('game:image', source),
  getStatus: () => ipcRenderer.invoke('games:status'),
  onStatus: (callback) => ipcRenderer.on('games:status', (_event, status) => callback(status)),
  close: (exePath) => ipcRenderer.invoke('game:close', exePath),
  launch: (exePath) => ipcRenderer.invoke('game:launch', exePath),
  rename: (exePath, name) => ipcRenderer.invoke('game:rename', exePath, name),
  refreshArt: (exePath) => ipcRenderer.invoke('game:refresh-art', exePath),
  saveColors: (colors) => ipcRenderer.invoke('settings:colors', colors),
  saveThemes: (themes) => ipcRenderer.invoke('settings:themes', themes),
  scanStorage: (recalculate) => ipcRenderer.invoke('storage:scan', recalculate),
  uninstallInfo: (exePath) => ipcRenderer.invoke('game:uninstall-info', exePath),
  uninstall: (exePath) => ipcRenderer.invoke('game:uninstall', exePath),
  toggleFavourite: (exePath) => ipcRenderer.invoke('game:favourite', exePath),
  saveGroups: (groups) => ipcRenderer.invoke('groups:save', groups),
  hide: (exePath) => ipcRenderer.invoke('game:hide', exePath),
  showInFolder: (exePath) => ipcRenderer.invoke('game:show-in-folder', exePath),
});
