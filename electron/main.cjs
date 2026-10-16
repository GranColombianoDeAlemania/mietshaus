const { app, BrowserWindow, ipcMain, dialog, shell, protocol, safeStorage, Menu } = require('electron');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { open, api } = require('./db.cjs');
const analyse = require('./analyse.cjs');
const eingang = require('./eingang.cjs');
const { zip } = require('./zip.cjs');

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
    // The traffic lights sit on the charcoal sidebar; the same colour avoids a white flash while loading.
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#1c2324',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      plugins: true, // built-in PDF viewer for document previews
    },
  });
  hauptfenster = win;
  win.loadURL(seite('index.html'));
  // Back/forward: three-finger swipe (macOS) and the mouse's side buttons (Windows/Linux).
  win.on('swipe', (_e, richtung) => melden('navigation', richtung === 'right' ? 'zurueck' : richtung === 'left' ? 'vor' : null));
  win.on('app-command', (_e, cmd) => melden('navigation', cmd === 'browser-backward' ? 'zurueck' : cmd === 'browser-forward' ? 'vor' : null));
}

// Native right-click menu built from the renderer's entries.
ipcMain.handle('kontextmenue', (e, eintraege) => new Promise((resolve) => {
  let gewaehlt = null;
  const menu = Menu.buildFromTemplate(eintraege.map((x) => (x === '-' ? { type: 'separator' }
    : { label: x.label, enabled: x.enabled !== false, click: () => { gewaehlt = x.id; resolve(x.id); } })));
  menu.popup({ window: BrowserWindow.fromWebContents(e.sender), callback: () => setTimeout(() => resolve(gewaehlt), 30) });
}));

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

// Renders HTML to PDF bytes.
async function htmlZuPdf(html) {
  const tmp = path.join(app.getPath('temp'), `hv-${crypto.randomUUID()}.html`);
  fs.writeFileSync(tmp, html);
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await win.loadFile(tmp);
    return await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    win.destroy();
    fs.rmSync(tmp, { force: true });
  }
}

// Tax adviser package: Anlage V as PDF, journal, balances and account sheets as CSV, receipts of the year – one ZIP file.
async function steuerpaket(objektId, jahr, anlageVHtml) {
  const d = db.steuerpaketDaten(objektId, jahr);
  const dateien = [
    { name: `Anlage V ${jahr}.pdf`, daten: await htmlZuPdf(anlageVHtml) },
    { name: `Journal ${jahr}.csv`, daten: d.journal },
    { name: `Saldenliste ${jahr}.csv`, daten: d.salden },
    { name: `Kontenblätter ${jahr}.csv`, daten: d.kontenblaetter },
  ];
  let fehlend = 0;
  for (const b of d.belege) {
    const p = path.join(dokumentOrdner(), b.datei);
    if (fs.existsSync(p)) dateien.push({ name: b.name, daten: fs.readFileSync(p) });
    else fehlend++;
  }
  dateien.push({ name: 'Liesmich.txt', daten: [`Steuerunterlagen ${d.objekt} – ${jahr}`, '',
    `Anlage V ${jahr}.pdf: Aufstellung der Einnahmen und Werbungskosten (Zufluss-/Abflussprinzip).`,
    'Journal: alle Buchungen des Jahres. Saldenliste: Stand aller Konten. Kontenblätter: jede Buchung je Konto.',
    `Belege: ${d.belege.length - fehlend} Dokumente (Rechnungen, Bescheide, Kontoauszüge und mit Buchungen verknüpfte Belege).`,
    'CSV-Dateien: Semikolon getrennt, Beträge mit Komma, UTF-8 – öffnen mit Excel oder Numbers.', '',
    `Erstellt am ${new Date().toLocaleDateString('de-DE')} mit Hausverwalter.`].join('\r\n') });
  const ziel = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('documents'), `Steuerunterlagen ${d.objekt} ${jahr}.zip`), filters: [{ name: 'ZIP-Archiv', extensions: ['zip'] }] });
  if (ziel.canceled || !ziel.filePath) return null;
  fs.writeFileSync(ziel.filePath, zip(dateien));
  shell.showItemInFolder(ziel.filePath);
  return { datei: ziel.filePath, belege: d.belege.length - fehlend, buchungen: d.anzahl_buchungen };
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

// Renders HTML to PDF and files it in the archive (e.g. a signed hand-over protocol); returns the document.
async function pdfAblegen(html, name, meta) {
  const tmpHtml = path.join(app.getPath('temp'), `hv-${crypto.randomUUID()}.html`);
  const tmpPdf = path.join(app.getPath('temp'), name.replace(/[/\\:*?"<>|]/g, '_'));
  fs.writeFileSync(tmpHtml, html);
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await win.loadFile(tmpHtml);
    fs.writeFileSync(tmpPdf, await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true }));
    const [r] = ana.importieren([tmpPdf], { objekt_id: meta.objekt_id ?? null, einheit_id: meta.einheit_id ?? null, projekt_id: meta.projekt_id ?? null, typ: meta.typ ?? null, status: 'abgelegt', quelle: 'programm' });
    db.dokumentSpeichern({ id: r.id, titel: meta.titel ?? name.replace(/\.pdf$/i, ''), person_id: meta.person_id ?? null, datum: meta.datum ?? null });
    return { id: r.id, datei: db.dokument(r.id).datei };
  } finally {
    win.destroy();
    fs.rmSync(tmpHtml, { force: true });
    fs.rmSync(tmpPdf, { force: true });
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
  db.setzeEinstellungen({ letzte_sicherung: new Date().toISOString() });
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

// Claude Desktop starts Hausverwalter's MCP server from this entry in its configuration file.
const claudeKonfig = () => (process.platform === 'darwin'
  ? path.join(app.getPath('home'), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  : process.platform === 'win32' ? path.join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json')
    : path.join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json'));
const mcpEintrag = () => ({
  command: process.execPath,
  args: [path.join(app.getAppPath(), 'electron', 'mcp.cjs')],
  env: { ELECTRON_RUN_AS_NODE: '1', HAUSVERWALTER_DATEN: app.getPath('userData'), HAUSVERWALTER_DB: dbFile },
});
function claudeStatus() {
  const datei = claudeKonfig();
  let k = null;
  try { k = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch {}
  return { datei, installiert: fs.existsSync(path.dirname(datei)), verbunden: !!k?.mcpServers?.hausverwalter, eintrag: mcpEintrag() };
}
function claudeVerbinden() {
  const datei = claudeKonfig();
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  let k = {};
  if (fs.existsSync(datei)) {
    fs.copyFileSync(datei, `${datei}.vor-hausverwalter`);
    k = JSON.parse(fs.readFileSync(datei, 'utf8'));
  }
  k.mcpServers = { ...(k.mcpServers ?? {}), hausverwalter: mcpEintrag() };
  fs.writeFileSync(datei, JSON.stringify(k, null, 2));
  return claudeStatus();
}

app.whenReady().then(() => {
  dbFile = process.env.HAUSVERWALTER_DB || path.join(app.getPath('userData'), 'hausverwalter.sqlite');
  oeffneDb();
  analyse.protokollRegistrieren(dokumentOrdner, vorschauOrdner);
  ana = analyse({ db: new Proxy({}, { get: (_t, k) => db[k] }), dokumentOrdner, vorschauOrdner, analyseUrl: () => seite('analyse.html'),
    onFertig: (id) => melden('dokumentAnalysiert', id) });
  ana.warteschlange();
  // Routine work (monthly charges) at start and then hourly.
  const automatik = () => { try { if (db.automatikLauf().erzeugt) melden('aktualisiert'); } catch (e) { console.error('Automatik', e); } };
  automatik();
  setInterval(automatik, 3600_000);
  ipcMain.handle('importieren', (_e, pfade, opt) => ana.importieren(pfade, opt));
  ipcMain.handle('dateienImportieren', async (_e, opt) => {
    const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : ana.importieren(r.filePaths, opt);
  });
  ipcMain.handle('neuAnalysieren', (_e, id) => ana.neuAnalysieren(id));

  // The mail password is encrypted with the system keychain where available (always on macOS).
  const passwort = {
    lesen: () => {
      const e = db.einstellungen();
      if (e.mail_passwort_enc && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(e.mail_passwort_enc, 'base64'));
      return e.mail_passwort_klar ? Buffer.from(e.mail_passwort_klar, 'base64').toString('utf8') : '';
    },
    setzen: (pw) => {
      if (safeStorage.isEncryptionAvailable()) db.setzeEinstellungen({ mail_passwort_enc: safeStorage.encryptString(pw).toString('base64'), mail_passwort_klar: null });
      else db.setzeEinstellungen({ mail_passwort_klar: Buffer.from(pw, 'utf8').toString('base64'), mail_passwort_enc: null });
    },
  };
  const ein = eingang({
    db: new Proxy({}, { get: (_t, k) => db[k] }),
    importieren: (pfade, opt) => { const r = ana.importieren(pfade, opt); melden('aktualisiert'); return r; },
    melden: (text) => melden('meldung', text),
    passwort,
  });
  ein.ordnerSetzen(db.einstellungen().eingangsordner);
  ein.mailPlanen();
  if (db.einstellungen().mail_aktiv === '1') setTimeout(() => ein.mailAbrufen().catch(() => {}), 20_000);
  ipcMain.handle('eingangsordnerWaehlen', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    db.setzeEinstellungen({ eingangsordner: r.filePaths[0] });
    ein.ordnerSetzen(r.filePaths[0]);
    return r.filePaths[0];
  });
  ipcMain.handle('eingangsordnerAus', () => { db.setzeEinstellungen({ eingangsordner: null }); ein.ordnerSetzen(null); });
  ipcMain.handle('mailSpeichern', (_e, cfg, pw) => {
    db.setzeEinstellungen(cfg);
    if (pw) passwort.setzen(pw);
    ein.mailPlanen();
    return { verschluesselt: safeStorage.isEncryptionAvailable() };
  });
  ipcMain.handle('mailTesten', () => ein.mailTesten());
  ipcMain.handle('mailAbrufen', () => ein.mailAbrufen());
  // One channel for the database API; errors reach the renderer as rejected promises.
  ipcMain.handle('db', (_e, fn, args) => {
    if (typeof db[fn] !== 'function') throw new Error(`Unbekannte Funktion: ${fn}`);
    return db[fn](...args);
  });
  ipcMain.handle('pdf', (_e, html, name) => pdf(html, name));
  ipcMain.handle('steuerpaket', (_e, objektId, jahr, html) => steuerpaket(objektId, jahr, html));
  ipcMain.handle('pdfAblegen', (_e, html, name, meta) => pdfAblegen(html, name, meta));
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
  ipcMain.handle('claudeStatus', () => claudeStatus());
  ipcMain.handle('claudeVerbinden', () => claudeVerbinden());
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
