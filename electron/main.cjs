const { app, BrowserWindow, ipcMain, dialog, shell, protocol } = require('electron');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { open, api } = require('./db.cjs');
const analyse = require('./analyse.cjs');

let db;
let rawDb;
let dbFile;
let ana;
let hauptfenster;

// Stored documents and previews are served to the windows under hvdok:// (also for the built-in PDF viewer).
protocol.registerSchemesAsPrivileged([analyse.SCHEMA]);

// German date inputs and number formats regardless of the system language.
app.commandLine.appendSwitch('lang', 'de-DE');

const dokumentOrdner = () => path.join(app.getPath('userData'), 'dokumente');
const vorschauOrdner = () => path.join(dokumentOrdner(), 'vorschau');
const seite = (name) => (process.env.VITE_DEV_SERVER_URL ? new URL(name, process.env.VITE_DEV_SERVER_URL).href : pathToFileURL(path.join(__dirname, '..', 'dist', name)).href);
const melden = (kanal, ...args) => { if (hauptfenster && !hauptfenster.isDestroyed()) hauptfenster.webContents.send(kanal, ...args); };

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
      plugins: true, // built-in PDF viewer for document previews
    },
  });
  hauptfenster = win;
  win.loadURL(seite('index.html'));
}

function oeffneDb() {
  rawDb = open(dbFile);
  db = api(rawDb);
}

// Notices changes written by another process (Claude Desktop via MCP) and tells the window to reload its data.
let letzteVersion = null;
setInterval(() => {
  if (!db) return;
  const v = db.datenVersion();
  if (letzteVersion != null && v !== letzteVersion) melden('aktualisiert');
  letzteVersion = v;
}, 2000);

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
  analyse.protokollRegistrieren(dokumentOrdner, vorschauOrdner);
  ana = analyse({ db: new Proxy({}, { get: (_t, k) => db[k] }), dokumentOrdner, vorschauOrdner, analyseUrl: () => seite('analyse.html'),
    onFertig: (id) => melden('dokumentAnalysiert', id) });
  ana.warteschlange();
  ipcMain.handle('importieren', (_e, pfade, opt) => ana.importieren(pfade, opt));
  ipcMain.handle('dateienImportieren', async (_e, opt) => {
    const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : ana.importieren(r.filePaths, opt);
  });
  ipcMain.handle('neuAnalysieren', (_e, id) => ana.neuAnalysieren(id));
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
  ipcMain.handle('dokumentLoeschen', (_e, id) => {
    const datei = db.dokumentLoeschen(id);
    if (datei) fs.rmSync(sichererDokPfad(datei), { force: true });
  });
  ipcMain.handle('extern', (_e, url) => {
    if (/^(mailto:|https:)/.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('info', () => ({ dbFile, dokumente: dokumentOrdner(), version: app.getVersion() }));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => ana?.beenden());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
