// Renders the built app with sample data and saves screenshots: electron scripts/screenshot.cjs <outdir>
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { open, api } = require('../electron/db.cjs');

const out = process.argv[process.argv.length - 1];
const db = api(open(':memory:'));
const o = db.neuesObjekt({ bezeichnung: 'Lindenstraße 5', art: 'gemischt', strasse: 'Lindenstraße 5', plz: '10115', ort: 'Berlin' });
db.neuesObjekt({ bezeichnung: 'Am Park 12', art: 'miete', plz: '10117', ort: 'Berlin' });
const e = [['EG links', 72.5, 3, 250], ['EG rechts', 64, 2, 220], ['1. OG', 88, 4, 300], ['Garage 1', 18, 0, 30]]
  .map(([b, f, z, m], i) => db.save('einheiten', { objekt_id: o, nr: i + 1, bezeichnung: b, art: i === 3 ? 'Garage' : 'Wohnung', wohnflaeche: f, zimmer: z, mea: m }));
const p = [['Anna', 'Meier'], ['Jonas', 'Becker'], ['Petra', 'Schulz'], ['Karl', 'Wagner']].map(([v, n]) => db.save('personen', { vorname: v, nachname: n, ort: 'Berlin' }));
db.save('mietverhaeltnisse', { einheit_id: e[0], person_id: p[0], beginn: '2022-03-01', kaltmiete_ct: 81000, bk_vz_ct: 16000, hk_vz_ct: 9000, personen_anzahl: 2 });
db.save('mietverhaeltnisse', { einheit_id: e[1], person_id: p[1], beginn: '2024-08-01', kaltmiete_ct: 69000, bk_vz_ct: 14000, hk_vz_ct: 8000 });
db.save('eigentum', { einheit_id: e[0], person_id: p[2], beginn: '2019-01-01', hausgeld_ct: 32000, ruecklage_ct: 6000 });
db.save('eigentum', { einheit_id: e[1], person_id: p[2], beginn: '2019-01-01', hausgeld_ct: 28000, ruecklage_ct: 5000 });
db.save('eigentum', { einheit_id: e[2], person_id: p[3], beginn: '2021-06-01', hausgeld_ct: 39000, ruecklage_ct: 7000, selbstnutzer: 1 });
for (const k of db.schluessel(o)) db.werteAusStammdaten(k.id);
ipcMain.handle('db', (_e, fn, args) => db[fn](...args));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ width: 1300, height: 760, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'electron', 'preload.cjs'), contextIsolation: true, sandbox: true, offscreen: true } });
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  const js = (s) => win.webContents.executeJavaScript(s);
  const click = (text) => js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)})?.click()`);
  const shot = async (name) => { await wait(400); fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  await js(`localStorage.clear()`);
  await win.reload(); await wait(500);
  await shot('1-miete-uebersicht');
  await click('Einheiten'); await shot('2-miete-einheiten');
  await click('Mieter'); await shot('3-miete-mieter');
  await click('WEG-Verwaltung'); await click('Einheiten'); await shot('4-weg-einheiten');
  await click('Eigentümer'); await shot('5-weg-eigentuemer');
  await click('Umlageschlüssel'); await shot('6-weg-schluessel');
  await click('Eigentümer'); await wait(300); await click('Neuer Eigentümer'); await shot('7-weg-dialog');
  await click('Abbrechen'); await click('Mietverwaltung'); await click('Mieter'); await shot('8-miete-mieter');
  await click('Objekte'); await wait(200);
  await js(`document.querySelectorAll('tbody tr')[1].dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))`); await shot('9-miete-objekt-dialog');
  app.quit();
});
