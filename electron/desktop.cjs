// What only the Mac app can do for the user interface (window.hvDesktop, see preload.cjs and src/bruecke.ts): PDF files,
// save dialogs, opening documents with their program, native menus, choosing a folder, Claude Desktop and the
// connection (local or server). Data never goes this way – that is HTTP to the Mietshaus server.
// Tests replace single handlers through `ueberschreiben` (e.g. saving into a folder instead of asking).
const { BrowserWindow, Menu, dialog, shell, app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

// Renders HTML to PDF bytes in a hidden window without JavaScript.
async function htmlZuPdf(html) {
  const tmp = path.join(os.tmpdir(), `hv-${crypto.randomUUID()}.html`);
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

/**
 * @param {object} o
 * @param {Electron.IpcMain} o.ipcMain
 * @param {() => {id:string,name:string}} o.geraet
 * @param {() => boolean} o.lokal            local mode (embedded server)?
 * @param {() => string|null} o.lokalOrdner  data folder in local mode (folders may only be shown inside it)
 * @param {() => object} o.verbindung        { art, adresse }
 * @param {(art:string, adresse?:string) => void} o.verbindungSetzen
 * @param {() => object} o.claudeStatus
 * @param {(token?:string) => object} o.claudeVerbinden
 * @param {object} [o.ueberschreiben]        handlers replaced by tests
 */
function einrichten(o) {
  const h = {
    start: () => ({ plattform: process.platform, geraet: o.geraet(), lokal: o.lokal() }),
    pdfBytes: (_e, html) => htmlZuPdf(String(html)),
    speichern: async (e, inhalt, name, filter, oeffnen) => {
      const ziel = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
        defaultPath: path.join(app.getPath('documents'), path.basename(String(name))), filters: filter ? [filter] : [] });
      if (ziel.canceled || !ziel.filePath) return null;
      fs.writeFileSync(ziel.filePath, typeof inhalt === 'string' ? inhalt : Buffer.from(inhalt));
      if (oeffnen) shell.openPath(ziel.filePath); else shell.showItemInFolder(ziel.filePath);
      return ziel.filePath;
    },
    // A stored document opened with its program: fetched from the server with this window's login, kept in a temp folder.
    dateiOeffnen: async (e, url, name) => {
      const basis = new URL(e.sender.getURL());
      const ziel = new URL(String(url), basis);
      if (ziel.origin !== basis.origin || !ziel.pathname.startsWith('/dateien/')) throw new Error('Nur Dokumente des Mietshaus-Servers.');
      const r = await e.sender.session.fetch(ziel.href);
      if (!r.ok) throw new Error(`Dokument nicht abrufbar (${r.status}).`);
      const ordner = path.join(os.tmpdir(), 'mietshaus-dokumente');
      fs.mkdirSync(ordner, { recursive: true });
      const datei = path.join(ordner, path.basename(String(name)));
      fs.writeFileSync(datei, Buffer.from(await r.arrayBuffer()));
      await shell.openPath(datei);
      return datei;
    },
    extern: (_e, url) => { if (/^(mailto:|https:)/.test(String(url))) return shell.openExternal(String(url)); },
    kontextmenue: (e, eintraege) => new Promise((resolve) => {
      let gewaehlt = null;
      const menu = Menu.buildFromTemplate(eintraege.map((x) => (x === '-' ? { type: 'separator' }
        : { label: x.label, enabled: x.enabled !== false, click: () => { gewaehlt = x.id; resolve(x.id); } })));
      menu.popup({ window: BrowserWindow.fromWebContents(e.sender), callback: () => setTimeout(() => resolve(gewaehlt), 30) });
    }),
    ordnerWaehlen: async (e) => {
      const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0] ?? null;
    },
    ordnerZeigen: (_e, pfad) => {
      const erlaubt = o.lokalOrdner();
      if (!erlaubt || !path.resolve(String(pfad)).startsWith(path.resolve(erlaubt))) throw new Error('Nur Ordner von Mietshaus auf diesem Mac.');
      fs.mkdirSync(String(pfad), { recursive: true });
      return shell.openPath(String(pfad));
    },
    claudeStatus: () => o.claudeStatus(),
    claudeVerbinden: (_e, token) => o.claudeVerbinden(token),
    verbindung: () => o.verbindung(),
    verbindungSetzen: (_e, art, adresse) => o.verbindungSetzen(art, adresse),
    ...o.ueberschreiben,
  };
  o.ipcMain.on('hv:start', (e) => { e.returnValue = h.start(); });
  for (const [name, fn] of Object.entries(h)) if (name !== 'start') o.ipcMain.handle(`hv:${name}`, fn);
}

module.exports = { einrichten, htmlZuPdf };
