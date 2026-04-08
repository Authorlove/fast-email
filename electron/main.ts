import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { startServer } = require('./server-electron.cjs');

let mainWindow: BrowserWindow | null = null;
let serverPort = 3001;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    frame: true,
    titleBarStyle: 'default',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  mainWindow.setTitle('投标邮件极速发送系统');

  if (!app.isPackaged) {
    mainWindow.loadURL(`http://localhost:5173`);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    serverPort = await startServer();
    console.log(`Server started on port ${serverPort}`);
  } catch (error) {
    console.error('Failed to start server:', error);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('get-server-port', () => {
  return serverPort;
});
