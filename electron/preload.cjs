const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wintouch', {
  listApps: () => ipcRenderer.invoke('launcher:list-apps'),
  launchApp: (targetPath) => ipcRenderer.invoke('launcher:launch-app', targetPath),
  getScanConfig: () => ipcRenderer.invoke('launcher:get-scan-config'),
  saveScanConfig: (config) => ipcRenderer.invoke('launcher:save-scan-config', config),
  getSuggestedFolders: () => ipcRenderer.invoke('launcher:get-suggested-folders'),
  pickFolder: () => ipcRenderer.invoke('launcher:pick-folder'),
  listPendingApps: () => ipcRenderer.invoke('launcher:list-pending-apps'),
  listRejectedApps: () => ipcRenderer.invoke('launcher:list-rejected-apps'),
  approveApps: (paths) => ipcRenderer.invoke('launcher:approve-apps', paths),
  rejectApps: (paths) => ipcRenderer.invoke('launcher:reject-apps', paths),
  removeApp: (appPath) => ipcRenderer.invoke('launcher:remove-app', appPath),
  unrejectApp: (appPath) => ipcRenderer.invoke('launcher:unreject-app', appPath),
});