const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { open, api } = require('./db.cjs');

let db;

// German date inputs and number formats regardless of the system language.
app.commandLine.appendSwitch('lang', 'de-DE');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'Hausverwalter',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  const file = process.env.HAUSVERWALTER_DB || path.join(app.getPath('userData'), 'hausverwalter.sqlite');
  db = api(open(file));
  // One channel for the whole API; errors reach the renderer as rejected promises.
  ipcMain.handle('db', (_e, fn, args) => {
    if (typeof db[fn] !== 'function') throw new Error(`Unbekannte Funktion: ${fn}`);
    return db[fn](...args);
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
