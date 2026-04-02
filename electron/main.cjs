const { app, BrowserWindow, Menu, Tray, ipcMain, shell, dialog, screen, nativeImage } = require('electron');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, exec } = require('node:child_process');

const isDev = process.env.NODE_ENV === 'development';
const port = Number(process.env.PORT || 3020);
let mainWindow;
let nextServer;
let tray = null;
let gestureWindow = null;
let isQuitting = false;

const EXCLUDED_SEGMENTS = new Set([
  'Administrative Tools',
  'Accessibility',
  'Startup',
  'StartUp',
  'Windows PowerShell',
  'Windows System',
  'WindowsApps',
  'Windows Defender',
  'Windows Defender Advanced Threat Protection',
]);

function hashPath(filePath) {
  return createHash('sha1').update(filePath).digest('hex');
}

function getNodeCommand() {
  return process.platform === 'win32' ? 'node.exe' : 'node';
}

/* ---------- scan-config persistence ---------- */

function getConfigPath() {
  return path.join(app.getPath('userData'), 'scan-config.json');
}

function readScanConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeScanConfig(config) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

/* ---------- suggested folders ---------- */

function getSuggestedScanFolders() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const candidates = [
    { path: pf, label: 'Program Files' },
    { path: pf86, label: 'Program Files (x86)' },
    { path: path.join(pf86, 'Steam', 'steamapps', 'common'), label: 'Steam Games' },
    { path: 'C:\\Program Files\\Epic Games', label: 'Epic Games' },
    { path: path.join(pf86, 'GOG Galaxy', 'Games'), label: 'GOG Galaxy Games' },
    { path: path.join(pf86, 'Origin Games'), label: 'EA / Origin Games' },
    { path: path.join(pf86, 'Ubisoft', 'Ubisoft Game Launcher', 'games'), label: 'Ubisoft Games' },
    { path: path.join(process.env.LOCALAPPDATA || '', 'Programs'), label: 'User Programs' },
  ];

  return candidates.map((c) => ({ ...c, exists: fs.existsSync(c.path) }));
}

/* ---------- scan locations ---------- */

function getScanLocations() {
  const config = readScanConfig();
  if (config && config.setupComplete && Array.isArray(config.scanFolders)) {
    return config.scanFolders;
  }

  // Fallback: nothing until setup is complete
  return [];
}

function shouldSkipDirectory(entryName) {
  return EXCLUDED_SEGMENTS.has(entryName);
}

function isLaunchableFile(entryName) {
  const extension = path.extname(entryName).toLowerCase();
  return extension === '.exe';
}

function collectLaunchables(rootPath, depth = 0) {
  if (!rootPath || !fs.existsSync(rootPath) || depth > 3) {
    return [];
  }

  let dirents;
  try {
    dirents = fs.readdirSync(rootPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    // EPERM / EACCES — skip directories we can't read
    return [];
  }

  const entries = [];
  let hasExecutableInDirectory = false;

  for (const dirent of dirents) {
    const fullPath = path.join(rootPath, dirent.name);

    if (dirent.isDirectory()) {
      if (shouldSkipDirectory(dirent.name)) {
        continue;
      }

      entries.push(...collectLaunchables(fullPath, depth + 1));
      continue;
    }

    if (!isLaunchableFile(dirent.name)) {
      continue;
    }

    if (hasExecutableInDirectory) {
      continue;
    }

    const name = path.basename(dirent.name, path.extname(dirent.name)).replace(/[-_]+/g, ' ').trim();
    if (!name) {
      continue;
    }

    hasExecutableInDirectory = true;

    entries.push({
      id: hashPath(fullPath),
      name,
      path: fullPath,
      source: rootPath,
      type: path.extname(dirent.name).slice(1).toLowerCase(),
    });
  }

  return entries;
}

function listInstalledApps() {
  const seenPaths = new Set();

  return getScanLocations()
    .flatMap((location) => collectLaunchables(location))
    .filter((entry) => {
      if (seenPaths.has(entry.path)) {
        return false;
      }

      seenPaths.add(entry.path);
      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function startNextServer() {
  return new Promise((resolve, reject) => {
    if (isDev) {
      nextServer = spawn('npm', ['run', 'dev:next'], {
        shell: true,
        stdio: 'inherit',
        env: {
          ...process.env,
          ELECTRON: 'true',
        },
      });
    } else {
      const serverPath = path.join(app.getAppPath(), '.next', 'standalone', 'server.js');

      nextServer = spawn(getNodeCommand(), [serverPath], {
        stdio: 'inherit',
        env: {
          ...process.env,
          ELECTRON: 'true',
          HOSTNAME: '127.0.0.1',
          PORT: String(port),
        },
      });
    }

    nextServer.on('error', reject);
    setTimeout(resolve, isDev ? 5000 : 2000);
  });
}

function stopNextServer() {
  if (nextServer && !nextServer.killed) {
    nextServer.kill();
  }
}

/* ---------- system tray ---------- */

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('Wintouch');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Wintouch', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow?.show());
}

/* ---------- left-edge swipe gesture ---------- */

function sendBackKey() {
  if (process.platform !== 'win32') return;
  const script = [
    "Add-Type -MemberDefinition '",
    '[DllImport(\"user32.dll\")]public static extern void keybd_event(byte bVk,byte bScan,uint dwFlags,UIntPtr dwExtraInfo);',
    "' -Name U -Namespace W;",
    '[W.U]::keybd_event(0x12,0,0,[UIntPtr]::Zero);',
    '[W.U]::keybd_event(0x25,0,0,[UIntPtr]::Zero);',
    '[W.U]::keybd_event(0x25,0,2,[UIntPtr]::Zero);',
    '[W.U]::keybd_event(0x12,0,2,[UIntPtr]::Zero)',
  ].join('');
  exec(`powershell -NoProfile -Command "${script}"`, { windowsHide: true });
}

function createGestureWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { height } = primaryDisplay.workAreaSize;

  gestureWindow = new BrowserWindow({
    x: 0,
    y: 0,
    width: 20,
    height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  gestureWindow.setAlwaysOnTop(true, 'screen-saver');

  const gestureHtml = `<!DOCTYPE html>
<html><head><style>
*{margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;background:transparent}
#indicator{position:fixed;top:0;left:0;width:4px;height:100%;background:linear-gradient(180deg,rgba(120,240,208,0.8),rgba(120,240,208,0.2));opacity:0;transition:opacity 0.15s}
</style></head><body>
<div id="indicator"></div>
<script>
const {ipcRenderer}=require('electron');
let tracking=false,startX=0;
const THRESHOLD=60;
const ind=document.getElementById('indicator');
document.addEventListener('pointerdown',e=>{
  tracking=true;startX=e.screenX;
  ind.style.opacity='0.6';
  e.target.setPointerCapture(e.pointerId);
});
document.addEventListener('pointermove',e=>{
  if(!tracking)return;
  if(e.screenX-startX>THRESHOLD){
    tracking=false;ind.style.opacity='0';
    ipcRenderer.send('gesture:back');
  }
});
document.addEventListener('pointerup',()=>{tracking=false;ind.style.opacity='0';});
document.addEventListener('pointercancel',()=>{tracking=false;ind.style.opacity='0';});
</script></body></html>`;

  gestureWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(gestureHtml)}`);
}

/* ---------- main window ---------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: '#0a1020',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  Menu.setApplicationMenu(null);

  if (isDev) {
    mainWindow.loadURL(`http://localhost:${port}`);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL(`http://localhost:${port}`);
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('launcher:list-apps', async () => {
  if (process.platform !== 'win32') {
    return [];
  }

  return listInstalledApps();
});

ipcMain.handle('launcher:launch-app', async (_event, targetPath) => {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return { ok: false, error: 'Launch target not found.' };
  }

  const errorMessage = await shell.openPath(targetPath);

  if (errorMessage) {
    return { ok: false, error: errorMessage };
  }

  return { ok: true };
});

ipcMain.handle('launcher:get-scan-config', async () => readScanConfig());

ipcMain.handle('launcher:save-scan-config', async (_event, config) => {
  writeScanConfig(config);
});

ipcMain.handle('launcher:get-suggested-folders', async () => getSuggestedScanFolders());

ipcMain.handle('launcher:pick-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Choose a folder to scan for apps',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.on('gesture:back', () => {
  sendBackKey();
});

app.whenReady().then(async () => {
  await startNextServer();

  createWindow();
  createTray();
  createGestureWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (isQuitting) {
    stopNextServer();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopNextServer();

  if (gestureWindow && !gestureWindow.isDestroyed()) {
    gestureWindow.destroy();
    gestureWindow = null;
  }
});