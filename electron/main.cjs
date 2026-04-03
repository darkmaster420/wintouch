const { app, BrowserWindow, Menu, Tray, ipcMain, shell, dialog, screen, nativeImage, protocol } = require('electron');
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

const SCHEME = 'app';

if (!isDev) {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

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

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff',
    '.woff2': 'font/woff2', '.txt': 'text/plain',
  };
  return types[ext] || 'application/octet-stream';
}

/* ---------- icon extraction ---------- */

function getIconCacheDir() {
  const dir = path.join(app.getPath('userData'), 'icon-cache');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function extractIcon(exePath) {
  const id = hashPath(exePath);
  const cachePath = path.join(getIconCacheDir(), `${id}.png`);
  if (fs.existsSync(cachePath)) return cachePath;

  try {
    const icon = await app.getFileIcon(exePath, { size: 'large' });
    const png = icon.toPNG();
    if (png.length > 0) {
      fs.writeFileSync(cachePath, png);
      return cachePath;
    }
  } catch {
    // icon extraction failed — no icon
  }
  return null;
}

async function attachIcons(entries) {
  const results = [];
  for (const entry of entries) {
    const iconPath = await extractIcon(entry.path);
    if (iconPath) {
      const filename = path.basename(iconPath);
      results.push({ ...entry, icon: isDev ? `file://${iconPath.replace(/\\/g, '/')}` : `${SCHEME}://icon/${filename}` });
    } else {
      results.push(entry);
    }
  }
  return results;
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

    const name = path.basename(dirent.name, path.extname(dirent.name)).replace(/[-_]+/g, ' ').trim();
    if (!name) {
      continue;
    }

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
  const config = readScanConfig();
  const approved = new Set(config?.approvedApps || []);

  return getScanLocations()
    .flatMap((location) => collectLaunchables(location))
    .filter((entry) => {
      if (seenPaths.has(entry.path)) return false;
      seenPaths.add(entry.path);
      return approved.has(entry.path);
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function listPendingApps() {
  const seenPaths = new Set();
  const config = readScanConfig();
  const approved = new Set(config?.approvedApps || []);
  const rejected = new Set(config?.rejectedApps || []);

  return getScanLocations()
    .flatMap((location) => collectLaunchables(location))
    .filter((entry) => {
      if (seenPaths.has(entry.path)) return false;
      seenPaths.add(entry.path);
      return !approved.has(entry.path) && !rejected.has(entry.path);
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function listRejectedApps() {
  const seenPaths = new Set();
  const config = readScanConfig();
  const rejected = new Set(config?.rejectedApps || []);

  return getScanLocations()
    .flatMap((location) => collectLaunchables(location))
    .filter((entry) => {
      if (seenPaths.has(entry.path)) return false;
      seenPaths.add(entry.path);
      return rejected.has(entry.path);
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function startNextDevServer() {
  return new Promise((resolve, reject) => {
    nextServer = spawn('npm', ['run', 'dev:next'], {
      shell: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        ELECTRON: 'true',
      },
    });
    nextServer.on('error', reject);
    setTimeout(resolve, 5000);
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
      sandbox: false,
    },
  });

  gestureWindow.setAlwaysOnTop(true, 'screen-saver');
  gestureWindow.setIgnoreMouseEvents(true, { forward: true });

  const gestureHtmlPath = path.join(app.getPath('userData'), 'gesture.html');
  const gestureHtml = `<!DOCTYPE html>
<html><head><style>
*{margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;background:transparent;-webkit-app-region:no-drag}
#indicator{position:fixed;top:0;left:0;width:4px;height:100%;background:linear-gradient(180deg,rgba(120,240,208,0.8),rgba(120,240,208,0.2));opacity:0;transition:opacity 0.15s}
</style></head><body>
<div id="indicator"></div>
<script>
const {ipcRenderer}=require('electron');
let tracking=false,startX=0,startY=0,swiping=false;
const THRESHOLD=80;
const MIN_DX_TO_TRACK=10;
const ind=document.getElementById('indicator');

document.addEventListener('pointerenter',()=>{
  ipcRenderer.send('gesture:set-clickthrough',false);
});
document.addEventListener('pointerleave',()=>{
  if(!swiping){ipcRenderer.send('gesture:set-clickthrough',true);}
});
document.addEventListener('pointerdown',e=>{
  tracking=true;swiping=false;startX=e.screenX;startY=e.screenY;
});
document.addEventListener('pointermove',e=>{
  if(!tracking)return;
  const dx=e.screenX-startX;
  const dy=Math.abs(e.screenY-startY);
  if(!swiping&&dx>MIN_DX_TO_TRACK&&dx>dy){
    swiping=true;
    e.target.setPointerCapture(e.pointerId);
    ind.style.opacity='0.6';
  }
  if(swiping&&dx>THRESHOLD){
    tracking=false;swiping=false;ind.style.opacity='0';
    ipcRenderer.send('gesture:back');
    ipcRenderer.send('gesture:set-clickthrough',true);
  }
});
document.addEventListener('pointerup',e=>{
  if(!swiping){
    ipcRenderer.send('gesture:set-clickthrough',true);
  }
  tracking=false;swiping=false;ind.style.opacity='0';
});
document.addEventListener('pointercancel',()=>{tracking=false;swiping=false;ind.style.opacity='0';});
</script></body></html>`;

  fs.writeFileSync(gestureHtmlPath, gestureHtml, 'utf-8');
  gestureWindow.loadFile(gestureHtmlPath);
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
    mainWindow.loadURL(`${SCHEME}://./index.html`);
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

  return attachIcons(listInstalledApps());
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

ipcMain.handle('launcher:list-pending-apps', async () => {
  if (process.platform !== 'win32') return [];
  return attachIcons(listPendingApps());
});

ipcMain.handle('launcher:list-rejected-apps', async () => {
  if (process.platform !== 'win32') return [];
  return attachIcons(listRejectedApps());
});

ipcMain.handle('launcher:approve-apps', async (_event, paths) => {
  const config = readScanConfig() || { scanFolders: [], setupComplete: true, approvedApps: [], rejectedApps: [] };
  const approved = new Set(config.approvedApps || []);
  for (const p of paths) approved.add(p);
  config.approvedApps = [...approved];
  writeScanConfig(config);
});

ipcMain.handle('launcher:reject-apps', async (_event, paths) => {
  const config = readScanConfig() || { scanFolders: [], setupComplete: true, approvedApps: [], rejectedApps: [] };
  const rejected = new Set(config.rejectedApps || []);
  for (const p of paths) rejected.add(p);
  config.rejectedApps = [...rejected];
  writeScanConfig(config);
});

ipcMain.handle('launcher:remove-app', async (_event, appPath) => {
  const config = readScanConfig();
  if (!config) return;
  config.approvedApps = (config.approvedApps || []).filter((p) => p !== appPath);
  if (!config.rejectedApps) config.rejectedApps = [];
  config.rejectedApps.push(appPath);
  writeScanConfig(config);
});

ipcMain.handle('launcher:unreject-app', async (_event, appPath) => {
  const config = readScanConfig();
  if (!config) return;
  config.rejectedApps = (config.rejectedApps || []).filter((p) => p !== appPath);
  writeScanConfig(config);
});

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

ipcMain.on('gesture:set-clickthrough', (_event, enabled) => {
  if (gestureWindow && !gestureWindow.isDestroyed()) {
    gestureWindow.setIgnoreMouseEvents(enabled, { forward: true });
  }
});

app.whenReady().then(async () => {
  if (isDev) {
    await startNextDevServer();
  } else {
    const exportDir = path.join(app.getAppPath(), 'out');

    protocol.handle(SCHEME, (request) => {
      const url = new URL(request.url);
      const pathname = decodeURIComponent(url.pathname);

      // Serve icons from userData cache
      if (url.host === 'icon') {
        const iconFile = path.join(getIconCacheDir(), path.basename(pathname));
        if (fs.existsSync(iconFile)) {
          return new Response(fs.readFileSync(iconFile), {
            headers: { 'Content-Type': 'image/png' },
          });
        }
        return new Response('Not found', { status: 404 });
      }

      let filePath = path.join(exportDir, pathname);

      // Serve index.html for directory requests
      if (!path.extname(filePath)) {
        filePath = path.join(filePath, 'index.html');
      }

      return new Response(fs.readFileSync(filePath), {
        headers: { 'Content-Type': mimeType(filePath) },
      });
    });
  }

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