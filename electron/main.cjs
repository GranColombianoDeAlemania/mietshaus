// The Mac app: a window onto a Mietshaus server. Locally the server runs embedded in this app on 127.0.0.1 (the data
// stay on this Mac); with a server address it is the one on the NAS, reached through Tailscale. The window loads the
// user interface from that server; the app adds only what a desktop can do (desktop.cjs).
const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const desktop = require('./desktop.cjs');
const { geraet: geraetLesen } = require('./geraet.cjs');
const update = require('./update.cjs');

let hauptfenster = null;
let lokal = null; // the embedded server in local mode
let geraet = null;
let neueVersion = null; // a newer release (update.pruefen), shown in the window

// One running copy per computer: a second start brings the window to the front instead of running the embedded
// server twice (same inbox folder, same mails, same monthly charges).
const ersteInstanz = !!process.env.MIETSHAUS_MEHRFACH || app.requestSingleInstanceLock();
if (!ersteInstanz) app.exit(0);
app.on('second-instance', (_e, argv) => {
  const link = argv.find((a) => a.startsWith('mietshaus://'));
  if (link) return linkOeffnen(link);
  if (!hauptfenster || hauptfenster.isDestroyed()) return;
  if (hauptfenster.isMinimized()) hauptfenster.restore();
  hauptfenster.focus();
});

// Links mietshaus://verbinden?adresse=https://…&einladung=… (from the guide of an invitation package): after a question,
// the app connects to that server and opens the invitation there. Asking first matters – a link could name any server.
let fruehLink = null;
app.on('open-url', (e, url) => { e.preventDefault(); if (app.isReady()) linkOeffnen(url); else fruehLink = url; });
async function linkOeffnen(url) {
  let adresse, einladung;
  try {
    const u = new URL(url);
    adresse = new URL(u.searchParams.get('adresse') ?? '').origin;
    einladung = u.searchParams.get('einladung');
    if (u.protocol !== 'mietshaus:' || !/^https?:$/.test(new URL(adresse).protocol)) throw new Error();
  } catch {
    return require('electron').dialog.showErrorBox('Mietshaus', 'Dieser Link ist ungültig.');
  }
  const jetzt = verbindung();
  if (jetzt.art === 'server' && jetzt.adresse === adresse) {
    if (einladung && hauptfenster && !hauptfenster.isDestroyed()) hauptfenster.loadURL(`${adresse}/?einladung=${encodeURIComponent(einladung)}`);
    hauptfenster?.focus();
    return;
  }
  const { response } = await require('electron').dialog.showMessageBox(hauptfenster ?? undefined, {
    type: 'question', message: 'Mit diesem Mietshaus-Server verbinden?', detail: `${adresse}\n\nMietshaus startet danach neu.${jetzt.art === 'lokal' ? ' Die Daten auf diesem Mac bleiben erhalten („Lokal arbeiten“ in den Einstellungen).' : ''}`,
    buttons: ['Verbinden', 'Abbrechen'], defaultId: 0, cancelId: 1,
  });
  if (response === 0) verbindungSetzen('server', adresse, einladung);
}

// German date inputs and number formats regardless of the system language.
app.commandLine.appendSwitch('lang', 'de-DE');

// The app was called Hausverwalter until 0.8.1: its data folder is copied over once, the old one stays as a backup.
function alteDatenUebernehmen() {
  const alt = path.join(app.getPath('appData'), 'Hausverwalter');
  const neu = app.getPath('userData');
  if (process.env.MIETSHAUS_DB || fs.existsSync(path.join(neu, 'mietshaus.sqlite')) || !fs.existsSync(path.join(alt, 'hausverwalter.sqlite'))) return;
  fs.cpSync(alt, neu, { recursive: true, force: false, filter: (q) => !path.basename(q).startsWith('Singleton') });
  for (const endung of ['', '-wal', '-shm']) {
    const q = path.join(neu, `hausverwalter.sqlite${endung}`);
    if (fs.existsSync(q)) fs.renameSync(q, path.join(neu, `mietshaus.sqlite${endung}`));
  }
}
if (ersteInstanz) alteDatenUebernehmen();

const dbFile = () => process.env.MIETSHAUS_DB || path.join(app.getPath('userData'), 'mietshaus.sqlite');

// ---------- connection: local or server ----------
const verbindungsDatei = () => path.join(app.getPath('userData'), 'verbindung.json');
function verbindung() {
  try {
    const v = JSON.parse(fs.readFileSync(verbindungsDatei(), 'utf8'));
    if (v.art === 'server' && /^https?:\/\//.test(v.adresse ?? '')) return { art: 'server', adresse: v.adresse.replace(/\/+$/, ''), einladung: v.einladung ?? null };
  } catch {}
  return { art: 'lokal', adresse: null };
}
function verbindungSetzen(art, adresse, einladung = null) {
  fs.writeFileSync(verbindungsDatei(), JSON.stringify(art === 'server' ? { art, adresse, einladung } : { art: 'lokal', adresse: verbindung().adresse }, null, 2));
  // Simplest and safest switch: start again with the new connection.
  app.relaunch();
  app.exit(0);
}

// The mail password of the embedded server is encrypted with the system keychain (always available on macOS).
const passwortLokal = (db) => ({
  lesen: (name = 'mail') => {
    const e = db().einstellungen();
    // A password encrypted under an older signature of the app (ad-hoc builds) cannot be decrypted any more.
    if (e[`${name}_passwort_enc`] && safeStorage.isEncryptionAvailable()) {
      try { return safeStorage.decryptString(Buffer.from(e[`${name}_passwort_enc`], 'base64')); } catch {
        throw new Error('Das gespeicherte E-Mail-Passwort lässt sich nicht mehr entschlüsseln (z. B. nach einem Programm-Update). Bitte unter Einstellungen → Dokumenteneingang neu eingeben.');
      }
    }
    return e[`${name}_passwort_klar`] ? Buffer.from(e[`${name}_passwort_klar`], 'base64').toString('utf8') : '';
  },
  setzen: (pw, name = 'mail') => {
    if (safeStorage.isEncryptionAvailable()) db().setzeEinstellungen({ [`${name}_passwort_enc`]: safeStorage.encryptString(pw).toString('base64'), [`${name}_passwort_klar`]: null });
    else db().setzeEinstellungen({ [`${name}_passwort_klar`]: Buffer.from(pw, 'utf8').toString('base64'), [`${name}_passwort_enc`]: null });
  },
  verschluesselt: safeStorage.isEncryptionAvailable(),
});

async function lokalStarten() {
  const { starten } = require('../server/server.cjs');
  const token = crypto.randomBytes(32).toString('base64url');
  let server;
  server = await starten({
    modus: 'lokal', daten: app.getPath('userData'), dbFile: dbFile(), token, geraet,
    // In development (npm run dev) the Vite server forwards /api and /dateien to this fixed port.
    port: Number(process.env.MIETSHAUS_PORT ?? 0),
    dist: path.join(__dirname, '..', 'dist'),
    tessdata: app.isPackaged ? path.join(process.resourcesPath, 'tessdata') : path.join(__dirname, '..', 'resources', 'tessdata'),
    passwort: passwortLokal(() => server.dbSystem),
  });
  return { ...server, token };
}

// ---------- Claude Desktop ----------
// Claude Desktop starts Mietshaus's MCP server from this entry in its configuration file: locally it opens the database
// of this Mac, with a server it forwards to the server's /mcp with the user's Claude token.
const claudeKonfig = () => (process.platform === 'darwin'
  ? path.join(app.getPath('home'), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  : path.join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json'));
const mcpEintrag = (token) => {
  const v = verbindung();
  return {
    command: process.execPath,
    args: [path.join(app.getAppPath(), 'electron', 'mcp.cjs')],
    env: v.art === 'server' && token
      ? { ELECTRON_RUN_AS_NODE: '1', MIETSHAUS_SERVER: v.adresse, MIETSHAUS_TOKEN: token }
      : { ELECTRON_RUN_AS_NODE: '1', MIETSHAUS_DATEN: app.getPath('userData'), MIETSHAUS_DB: dbFile() },
  };
};
function claudeStatus() {
  const datei = claudeKonfig();
  let k = null;
  try { k = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch {}
  const eintrag = k?.mcpServers?.mietshaus;
  return { datei, installiert: fs.existsSync(path.dirname(datei)), verbunden: !!eintrag, server: eintrag?.env?.MIETSHAUS_SERVER ?? null };
}
function claudeVerbinden(token) {
  const datei = claudeKonfig();
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  let k = {};
  if (fs.existsSync(datei)) {
    fs.copyFileSync(datei, `${datei}.vor-mietshaus`);
    k = JSON.parse(fs.readFileSync(datei, 'utf8'));
  }
  // The entry from the Hausverwalter days points at the old app and database, so it is replaced.
  const { hausverwalter: _alt, ...andere } = k.mcpServers ?? {};
  k.mcpServers = { ...andere, mietshaus: mcpEintrag(token) };
  fs.writeFileSync(datei, JSON.stringify(k, null, 2), { mode: 0o600 });
  return claudeStatus();
}
// A connection set up under the old name, or pointing at the database of this Mac, follows the app.
function claudeUmziehen() {
  try {
    const m = JSON.parse(fs.readFileSync(claudeKonfig(), 'utf8')).mcpServers ?? {};
    if (m.hausverwalter || (m.mietshaus?.env?.MIETSHAUS_DB && verbindung().art === 'lokal')) claudeVerbinden();
  } catch {}
}

// ---------- moving this Mac's data to the server ----------
// Only into an empty server: the database goes up as a backup and replaces the empty one, then every stored document
// and preview follows under its archive name. Progress reaches the window as hv:fortschritt.
async function datenUebertragen(e) {
  const v = verbindung();
  if (v.art !== 'server') throw new Error('Erst mit dem Server verbinden.');
  if (!fs.existsSync(dbFile())) throw new Error('Auf diesem Mac gibt es keine Mietshaus-Daten.');
  const ses = e.sender.session;
  const melde = (text) => e.sender.send('hv:fortschritt', text);
  const anfrage = async (pfad, body, json = false) => {
    const r = await ses.fetch(new URL(pfad, v.adresse).href, { method: 'POST', headers: { 'X-Mietshaus': '1', ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(body) : body });
    const t = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(t.fehler ?? `Server antwortet mit ${r.status}`);
    return t;
  };
  const leer = async (modus) => (await anfrage('/api/call', { fn: 'objekte', args: [modus] }, true)).wert.length === 0;
  if (!(await leer('miete')) || !(await leer('weg'))) throw new Error('Auf dem Server gibt es schon Objekte. Übertragen geht nur in einen leeren Server.');
  melde('Datenbank wird gesichert …');
  const { DatabaseSync } = require('node:sqlite');
  const tmp = path.join(app.getPath('temp'), `mietshaus-uebertragung-${crypto.randomUUID()}.sqlite`);
  const quelle = new DatabaseSync(dbFile(), { readOnly: true });
  try { quelle.prepare('VACUUM INTO ?').run(tmp); } finally { quelle.close(); }
  try {
    melde('Datenbank wird hochgeladen …');
    const p = await anfrage('/api/sicherung/pruefen', fs.readFileSync(tmp));
    await anfrage('/api/sicherung/einspielen', { kennung: p.kennung }, true);
  } finally { fs.rmSync(tmp, { force: true }); }
  const ordner = path.join(path.dirname(dbFile()), 'dokumente');
  const dateien = [
    ...(fs.existsSync(ordner) ? fs.readdirSync(ordner).filter((n) => fs.statSync(path.join(ordner, n)).isFile()).map((n) => ({ n, o: '' })) : []),
    ...(fs.existsSync(path.join(ordner, 'vorschau')) ? fs.readdirSync(path.join(ordner, 'vorschau')).map((n) => ({ n, o: 'vorschau' })) : []),
  ];
  let i = 0;
  for (const d of dateien) {
    melde(`Dokumente: ${++i} von ${dateien.length} …`);
    await anfrage(`/api/dokument-datei?name=${encodeURIComponent(d.n)}${d.o ? '&ordner=vorschau' : ''}`, fs.readFileSync(path.join(ordner, d.o, d.n)));
  }
  melde(`Fertig: Datenbank und ${dateien.length} Dateien übertragen.`);
  return { dateien: dateien.length };
}

// ---------- invitation package ----------
// A folder for a new person, zipped: Mietshaus.app (this very app), the personal guide, the logo and a double-click
// link that connects the app to the server with the invitation.
async function paketErstellen(e, { titel, anleitung, link }) {
  if (!app.isPackaged || process.platform !== 'darwin') throw new Error('Das Paket mit der Mac-App lässt sich nur aus der installierten Mac-App erstellen.');
  const name = `Mietshaus für ${String(titel).replace(/[/\\:*?"<>|]/g, '_')}`;
  const ziel = await require('electron').dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
    defaultPath: path.join(app.getPath('desktop'), `${name}.zip`), filters: [{ name: 'ZIP-Archiv', extensions: ['zip'] }] });
  if (ziel.canceled || !ziel.filePath) return null;
  const melde = (t) => e.sender.send('hv:fortschritt', t);
  const { execFileSync } = require('node:child_process');
  const tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'mietshaus-paket-'));
  const ordner = path.join(tmp, name);
  try {
    fs.mkdirSync(ordner);
    melde('Mac-App wird kopiert …');
    execFileSync('/usr/bin/ditto', [path.resolve(process.execPath, '..', '..', '..'), path.join(ordner, 'Mietshaus.app')]);
    fs.writeFileSync(path.join(ordner, 'Anleitung – bitte zuerst öffnen.html'), String(anleitung));
    const logo = path.join(__dirname, '..', 'dist', 'icon-512.png');
    if (fs.existsSync(logo)) fs.copyFileSync(logo, path.join(ordner, 'logo.png'));
    fs.writeFileSync(path.join(ordner, 'Mit Mietshaus verbinden.webloc'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>URL</key><string>${String(link).replace(/&/g, '&amp;')}</string></dict></plist>
`);
    melde('Paket wird gepackt …');
    fs.rmSync(ziel.filePath, { force: true });
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', ordner, ziel.filePath]);
    melde('');
    shell.showItemInFolder(ziel.filePath);
    return ziel.filePath;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------- window ----------
function fehlerSeite(win, adresse, text) {
  const html = `<!doctype html><meta charset="utf-8"><body style="font:15px -apple-system,sans-serif;background:#1c2324;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
    <div style="max-width:460px"><h2>Mietshaus-Server nicht erreichbar</h2><p>${text}</p><p style="opacity:.7">${adresse}</p>
    <p>Läuft der Server auf der Synology, und ist Tailscale auf diesem Mac verbunden?</p>
    <button onclick="location.reload()">Erneut versuchen</button> <button onclick="window.hvDesktop.verbindungSetzen('lokal')">Lokal arbeiten</button></div>`;
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

async function createWindow() {
  const v = verbindung();
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1000, minHeight: 640, title: 'Mietshaus',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // The traffic lights sit on the charcoal sidebar; the same colour avoids a white flash while loading.
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#1c2324',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, plugins: true },
  });
  hauptfenster = win;
  const basis = v.art === 'server' ? v.adresse : (process.env.VITE_DEV_SERVER_URL?.replace(/\/$/, '') ?? lokal.url);
  const herkunft = new URL(basis).origin;
  // The window stays on its server: other pages never get the desktop functions; links open in the browser.
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(herkunft) && !url.startsWith('data:')) { e.preventDefault(); if (/^https:/.test(url)) shell.openExternal(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^(https:|mailto:)/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('did-fail-load', (_e, code, text, url, istHaupt) => { if (istHaupt && code !== -3 && !url.startsWith('data:')) fehlerSeite(win, basis, text); });
  // Back/forward: three-finger swipe (macOS) and the mouse's side buttons (Windows/Linux).
  const melden = (richtung) => { if (richtung) win.webContents.send('hv:navigation', richtung); };
  win.on('swipe', (_e, r) => melden(r === 'right' ? 'zurueck' : r === 'left' ? 'vor' : null));
  win.on('app-command', (_e, c) => melden(c === 'browser-backward' ? 'zurueck' : c === 'browser-forward' ? 'vor' : null));
  // An invitation from a link opens once, right after connecting.
  win.loadURL(v.art === 'server' ? (v.einladung ? `${basis}/?einladung=${encodeURIComponent(v.einladung)}` : basis) : `${basis}/lokal?token=${lokal.token}`);
  if (v.einladung) fs.writeFileSync(verbindungsDatei(), JSON.stringify({ art: 'server', adresse: v.adresse }, null, 2));
}

app.whenReady().then(async () => {
  if (!ersteInstanz) return;
  geraet = geraetLesen(app.getPath('userData'));
  if (verbindung().art === 'lokal') lokal = await lokalStarten();
  desktop.einrichten({
    ipcMain, geraet: () => geraet, lokal: () => !!lokal, lokalOrdner: () => (lokal ? path.dirname(dbFile()) : null),
    verbindung, verbindungSetzen, claudeStatus, claudeVerbinden,
    ueberschreiben: {
      datenUebertragen,
      paketErstellen,
      updateStatus: () => neueVersion,
      updateInstallieren: (e) => {
        if (!neueVersion) throw new Error('Kein Update verfügbar.');
        return update.installieren(neueVersion, (text) => e.sender.send('hv:fortschritt', text));
      },
    },
  });
  claudeUmziehen();
  if (process.platform !== 'darwin' || !app.isPackaged) app.setAsDefaultProtocolClient('mietshaus');
  await createWindow();
  const startLink = fruehLink ?? process.argv.find((a) => a.startsWith('mietshaus://'));
  if (startLink) linkOeffnen(startLink);
  // Newer version on GitHub? Checked shortly after the start and then every six hours; the window offers the update.
  const updateSuchen = async () => {
    neueVersion = await update.pruefen().catch(() => null);
    if (neueVersion && hauptfenster && !hauptfenster.isDestroyed()) hauptfenster.webContents.send('hv:update', neueVersion);
    // Test of the self-update (scripts/updatetest.sh): install at once without the button.
    if (neueVersion && process.env.MIETSHAUS_UPDATE_SOFORT === '1') update.installieren(neueVersion, (t) => console.log('Update:', t)).catch((e) => console.error('Update:', e.message));
  };
  setTimeout(updateSuchen, 10_000);
  setInterval(updateSuchen, 6 * 3600_000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((e) => {
  console.error(e);
  require('electron').dialog.showErrorBox('Mietshaus konnte nicht starten', String(e?.message ?? e));
  app.exit(1);
});

let beendet = false;
app.on('before-quit', (e) => {
  if (beendet || !lokal) return;
  e.preventDefault();
  beendet = true;
  lokal.beenden().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
