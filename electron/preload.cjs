const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wintouch', {
  listApps: () => ipcRenderer.invoke('launcher:list-apps'),
  launchApp: (targetPath) => ipcRenderer.invoke('launcher:launch-app', targetPath),
  getScanConfig: () => ipcRenderer.invoke('launcher:get-scan-config'),
  saveScanConfig: (config) => ipcRenderer.invoke('launcher:save-scan-config', config),
  getSuggestedFolders: () => ipcRenderer.invoke('launcher:get-suggested-folders'),
  pickFolder: () => ipcRenderer.invoke('launcher:pick-folder'),
});