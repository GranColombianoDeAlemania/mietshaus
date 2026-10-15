const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { open, api } = require('./db.cjs');

let db;
let rawDb;
let dbFile;

// German date inputs and number formats regardless of the system language.
app.commandLine.appendSwitch('lang', 'de-DE');

const dokumentOrdner = () => path.join(app.getPath('userData'), 'dokumente');

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

function oeffneDb() {
  rawDb = open(dbFile);
  db = api(rawDb);
}

// Renders an HTML document to a PDF file the user picks, then opens it.
async function pdf(html, name) {
  const tmp = path.join(app.getPath('temp'), `hv-${crypto.randomUUID()}.html`);
  fs.writeFileSync(tmp, html);
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await win.loadFile(tmp);
    const data = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
    const ziel = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (ziel.canceled || !ziel.filePath) return null;
    fs.writeFileSync(ziel.filePath, data);
    shell.openPath(ziel.filePath);
    return ziel.filePath;
  } finally {
    win.destroy();
    fs.rmSync(tmp, { force: true });
  }
}

async function speichern(inhalt, name, filter) {
  const ziel = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('documents'), name), filters: filter ? [filter] : [] });
  if (ziel.canceled || !ziel.filePath) return null;
  fs.writeFileSync(ziel.filePath, inhalt);
  return ziel.filePath;
}

async function oeffnen(filter) {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: filter ? [filter] : [] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  return { name: path.basename(p), base64: fs.readFileSync(p).toString('base64') };
}

async function sicherung() {
  const name = `Hausverwalter-Sicherung-${new Date().toISOString().slice(0, 10)}.sqlite`;
  const ziel = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'Sicherung', extensions: ['sqlite'] }] });
  if (ziel.canceled || !ziel.filePath) return null;
  fs.rmSync(ziel.filePath, { force: true });
  // VACUUM INTO writes a consistent copy even while the database is open.
  rawDb.prepare('VACUUM INTO ?').run(ziel.filePath);
  return ziel.filePath;
}

async function wiederherstellen() {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Sicherung', extensions: ['sqlite'] }] });
  if (r.canceled || !r.filePaths[0]) return false;
  const quelle = r.filePaths[0];
  // Keep the current state next to the database in case the restore was a mistake.
  const vorher = `${dbFile}.vor-wiederherstellung-${Date.now()}`;
  rawDb.prepare('VACUUM INTO ?').run(vorher);
  rawDb.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(dbFile + s, { force: true });
  fs.copyFileSync(quelle, dbFile);
  oeffneDb();
  return true;
}

// Copies a file into the app's document folder; the database stores only the relative name.
async function dokumentAblegen() {
  const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return [];
  fs.mkdirSync(dokumentOrdner(), { recursive: true });
  return r.filePaths.map((p) => {
    const datei = `${crypto.randomUUID()}${path.extname(p)}`;
    fs.copyFileSync(p, path.join(dokumentOrdner(), datei));
    return { name: path.basename(p), datei, groesse: fs.statSync(p).size };
  });
}

// Only plain file names inside the document folder are accepted.
const sichererDokPfad = (datei) => path.join(dokumentOrdner(), path.basename(datei));

app.whenReady().then(() => {
  dbFile = process.env.HAUSVERWALTER_DB || path.join(app.getPath('userData'), 'hausverwalter.sqlite');
  oeffneDb();
  // One channel for the database API; errors reach the renderer as rejected promises.
  ipcMain.handle('db', (_e, fn, args) => {
    if (typeof db[fn] !== 'function') throw new Error(`Unbekannte Funktion: ${fn}`);
    return db[fn](...args);
  });
  ipcMain.handle('pdf', (_e, html, name) => pdf(html, name));
  ipcMain.handle('speichern', (_e, inhalt, name, filter) => speichern(inhalt, name, filter));
  ipcMain.handle('oeffnen', (_e, filter) => oeffnen(filter));
  ipcMain.handle('sicherung', () => sicherung());
  ipcMain.handle('wiederherstellen', () => wiederherstellen());
  ipcMain.handle('dokumentAblegen', () => dokumentAblegen());
  ipcMain.handle('dokumentOeffnen', (_e, datei) => shell.openPath(sichererDokPfad(datei)));
  ipcMain.handle('dokumentLoeschen', (_e, datei) => fs.rmSync(sichererDokPfad(datei), { force: true }));
  ipcMain.handle('extern', (_e, url) => {
    if (/^(mailto:|https:)/.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('info', () => ({ dbFile, dokumente: dokumentOrdner(), version: app.getVersion() }));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
