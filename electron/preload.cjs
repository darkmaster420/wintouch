const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wintouch', {
  listApps: () => ipcRenderer.invoke('launcher:list-apps'),
  launchApp: (targetPath) => ipcRenderer.invoke('launcher:launch-app', targetPath),
  getPlatform: () => ipcRenderer.invoke('launcher:get-platform'),
});