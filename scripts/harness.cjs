// Shared setup of the Electron test scripts (klicktest, screenshot, blick): the app's window with its preload onto an
// embedded server holding the sample data – the same path the Mac app takes in local mode. Save dialogs, native menus
// and opening files are replaced by `ueberschreiben` (see electron/desktop.cjs).
const { BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const { starten } = require('../server/server.cjs');
const desktop = require('../electron/desktop.cjs');

async function harness({ db, raw, out, ueberschreiben = {}, breite = 1300, hoehe = 860 }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const geraet = { id: 'test', name: 'Test' };
  const server = await starten({ modus: 'lokal', daten: out, token, geraet, port: 0, verbindung: { raw, api: db } });
  desktop.einrichten({
    ipcMain, geraet: () => geraet, lokal: () => true, lokalOrdner: () => out,
    verbindung: () => ({ art: 'lokal', adresse: null }), verbindungSetzen: () => {},
    claudeStatus: () => ({ datei: '-', installiert: true, verbunden: false }), claudeVerbinden: () => ({ datei: '-', installiert: true, verbunden: true }),
    ueberschreiben: Object.fromEntries(Object.entries(ueberschreiben).map(([k, fn]) => [k, (_e, ...a) => fn(...a)])),
  });
  const win = new BrowserWindow({ width: breite, height: hoehe, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'electron', 'preload.cjs'), contextIsolation: true, sandbox: true, offscreen: true } });
  await win.loadURL(`${server.url}/lokal?token=${token}`);
  return { win, server };
}

module.exports = { harness };
