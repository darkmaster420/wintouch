const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const isDev = process.env.NODE_ENV === 'development';
const port = Number(process.env.PORT || 3020);
let mainWindow;
let nextServer;

const EXCLUDED_SEGMENTS = new Set([
  'Administrative Tools',
  'Accessibility',
  'Startup',
  'StartUp',
  'Windows PowerShell',
  'Windows System',
]);

function hashPath(filePath) {
  return createHash('sha1').update(filePath).digest('hex');
}

function getNodeCommand() {
  return process.platform === 'win32' ? 'node.exe' : 'node';
}

function getStartLocations() {
  const homeDir = app.getPath('home');

  return [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop'),
    app.getPath('desktop'),
  ];
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

  const entries = [];
  let hasExecutableInDirectory = false;

  for (const dirent of fs.readdirSync(rootPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
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

  return getStartLocations()
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

ipcMain.handle('launcher:get-platform', async () => process.platform);

app.whenReady().then(async () => {
  await startNextServer();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopNextServer();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', stopNextServer);