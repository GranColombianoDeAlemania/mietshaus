// Renders the built app with sample data and saves screenshots: electron scripts/screenshot.cjs <outdir>
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { open, api } = require('../electron/db.cjs');
const analyse = require('../electron/analyse.cjs');
const { protocol } = require('electron');
const { pathToFileURL } = require('node:url');
protocol.registerSchemesAsPrivileged([analyse.SCHEMA]);

const out = process.argv[process.argv.length - 1];
const db = api(open(':memory:'));
const o = db.neuesObjekt({ bezeichnung: 'Lindenstraße 5', art: 'gemischt', strasse: 'Lindenstraße 5', plz: '10115', ort: 'Berlin' });
db.neuesObjekt({ bezeichnung: 'Am Park 12', art: 'miete', plz: '10117', ort: 'Berlin' });
const e = [['EG links', 72.5, 3, 250], ['EG rechts', 64, 2, 220], ['1. OG', 88, 4, 300], ['Garage 1', 18, 0, 30]]
  .map(([b, f, z, m], i) => db.save('einheiten', { objekt_id: o, nr: i + 1, bezeichnung: b, art: i === 3 ? 'Garage' : 'Wohnung', wohnflaeche: f, zimmer: z, mea: m }));
const p = [['Anna', 'Meier'], ['Jonas', 'Becker'], ['Petra', 'Schulz'], ['Karl', 'Wagner']].map(([v, n], i) => db.save('personen', { anrede: i % 2 ? 'Herr' : 'Frau', vorname: v, nachname: n, strasse: 'Lindenstraße 5', plz: '10115', ort: 'Berlin' }));
db.save('mietverhaeltnisse', { einheit_id: e[0], person_id: p[0], beginn: '2022-03-01', kaltmiete_ct: 81000, bk_vz_ct: 16000, hk_vz_ct: 9000, personen_anzahl: 2 });
db.save('mietverhaeltnisse', { einheit_id: e[1], person_id: p[1], beginn: '2024-08-01', kaltmiete_ct: 69000, bk_vz_ct: 14000, hk_vz_ct: 8000 });
db.save('eigentum', { einheit_id: e[0], person_id: p[2], beginn: '2019-01-01', hausgeld_ct: 32000, ruecklage_ct: 6000 });
db.save('eigentum', { einheit_id: e[1], person_id: p[2], beginn: '2019-01-01', hausgeld_ct: 28000, ruecklage_ct: 5000 });
db.setzeEinstellungen({ verwalter_name: 'Hausverwaltung Muster', verwalter_strasse: 'Hauptstr. 1', verwalter_plz: '10115', verwalter_ort: 'Berlin', verwalter_telefon: '030 123456', verwalter_email: 'info@example.de' });
db.save('eigentum', { einheit_id: e[2], person_id: p[3], beginn: '2021-06-01', hausgeld_ct: 39000, ruecklage_ct: 7000, selbstnutzer: 1 });
for (const k of db.schluessel(o)) db.werteAusStammdaten(k.id);
db.setzeEinstellungen({ auto_soll_ab: `${new Date().getFullYear()}-01` });
const jahr = new Date().getFullYear();
db.sollstellung(o, `${jahr}-01`, `${jahr}-03`);
const kt = Object.fromEntries(db.konten(o).map((k) => [k.nr, k.id]));
db.buchen({ objekt_id: o, datum: `${jahr}-01-04`, text: 'Miete Januar', art: 'bank', positionen: [{ soll_id: kt[1200], haben_id: kt[100100], betrag_ct: 106000 }] });
db.buchen({ objekt_id: o, datum: `${jahr}-02-10`, beleg: 'R-001', text: 'Stadtwerke Abschlag', positionen: [
  { soll_id: kt[40200], haben_id: kt[1200], betrag_ct: 12000, text: 'Wasser' }, { soll_id: kt[40900], haben_id: kt[1200], betrag_ct: 4500, text: 'Allgemeinstrom' }] });
const vs = db.save('versammlungen', { objekt_id: o, datum: `${jahr}-11-20`, uhrzeit: '18:00', ort: 'Gemeinschaftsraum', art: 'ordentlich' });
db.save('tops', { versammlung_id: vs, nr: 1, titel: 'Jahresabrechnung', beschlussvorschlag: 'Die Nachschüsse werden genehmigt.', abstimmungsart: 'kopf' });
db.save('tops', { versammlung_id: vs, nr: 2, titel: 'Wirtschaftsplan', beschlussvorschlag: 'Der Wirtschaftsplan wird beschlossen.', abstimmungsart: 'mea' });
db.save('vorlagen', { titel: 'Mietbescheinigung', betreff: 'Mietbescheinigung', text: 'hiermit bestätigen wir, dass {name} seit dem {beginn} die Wohnung {einheit} ({flaeche} m²) gemietet hat. Gesamtmiete: {gesamtmiete}.' });
const z1 = db.save('zaehler', { objekt_id: o, einheit_id: e[0], art: 'kaltwasser', nummer: 'KW-1001', einheit: 'm³', faktor: 1, eichung_bis: `${jahr}-12-31` });
db.ablesung(`${jahr - 1}-12-31`, { [z1]: 120.5 });
// Some bank movements over the last months for the cash-flow chart.
for (let i = 1; i <= 9; i++) {
  const m = new Date(Date.UTC(jahr, new Date().getMonth() - 9 + i, 5)).toISOString().slice(0, 10);
  db.buchen({ objekt_id: o, datum: m, text: 'Mieteingang', positionen: [{ soll_id: kt[1200], haben_id: kt[100200], betrag_ct: 91000 + i * 1000 }] });
  db.buchen({ objekt_id: o, datum: m, text: 'Ausgaben', positionen: [{ soll_id: kt[45100], haben_id: kt[1200], betrag_ct: 30000 + (i % 3) * 25000 }] });
}
db.save('termine', { titel: 'Wohnungsübergabe EG rechts', datum: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), uhrzeit: '10:00', objekt_id: o });
ipcMain.handle('db', (_e, fn, args) => db[fn](...args));
// PDFs are printed straight into the output folder instead of asking for a file name.
ipcMain.handle('pdf', async (_e, html, name) => {
  const tmp = path.join(out, 'tmp.html');
  fs.writeFileSync(tmp, html);
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await w.loadFile(tmp);
  const data = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
  w.destroy();
  fs.writeFileSync(path.join(out, name.replace(/[^\w.-]+/g, '_')), data);
  return name;
});
ipcMain.handle('claudeStatus', () => ({ datei: '-', installiert: true, verbunden: false, eintrag: {} }));
ipcMain.handle('info', () => ({ dbFile: ':memory:', dokumente: '-', version: app.getVersion() }));
app.commandLine.appendSwitch('lang', 'de-DE');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  // Documents from the archive test (scripts/archivtest.cjs) go into the inbox.
  const docs = path.join(out, 'dokumente');
  analyse.protokollRegistrieren(() => docs, () => path.join(docs, 'vorschau'));
  const ana = analyse({ db, dokumentOrdner: () => docs, vorschauOrdner: () => path.join(docs, 'vorschau'),
    analyseUrl: () => pathToFileURL(path.join(__dirname, '..', 'dist', 'analyse.html')).href });
  const testDocs = process.env.TESTDOKS ? fs.readdirSync(process.env.TESTDOKS).filter((f) => /\.(pdf|png)$/.test(f)).map((f) => path.join(process.env.TESTDOKS, f)) : [];
  ana.importieren(testDocs);
  await ana.warteschlange();
  for (let i = 0; i < 60 && db.zuAnalysieren().length; i++) await wait(500);
  ipcMain.handle('neuAnalysieren', (_e, id) => ana.neuAnalysieren(id));
  ipcMain.handle('dokumentLoeschen', (_e, id) => db.dokumentLoeschen(id));
  const win = new BrowserWindow({ width: 1300, height: 760, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'electron', 'preload.cjs'), contextIsolation: true, sandbox: true, offscreen: true } });
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  const js = (s) => win.webContents.executeJavaScript(s);
  // Renderer errors are printed so a test run shows broken pages.
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) console.log('RENDERER-FEHLER:', e.message); });
  win.webContents.on('render-process-gone', (_e, d) => console.log('RENDERER-ABSTURZ:', d.reason));
  const click = (text) => js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} || b.firstChild?.textContent?.trim() === ${JSON.stringify(text)})?.click()`);
  const shot = async (name) => { await wait(400); fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  await js(`localStorage.clear()`);
  await win.reload(); await wait(500);
  console.log('AUTOMATIK', JSON.stringify(db.automatikLauf()), db.kennzahlen().soll_ct, db.einstellungen().auto_soll_ab);
  win.setSize(1300, 1250); await click('Cockpit'); await wait(800); await shot('1-miete-uebersicht');
  await click('WEG-Verwaltung'); await wait(800); await shot('1b-weg-cockpit'); await click('Mietverwaltung'); win.setSize(1300, 760);
  await click('Mietverwaltung'); await wait(200);
  await js(`document.querySelector('.objektwahl select').value='${o}'; document.querySelector('.objektwahl select').dispatchEvent(new Event('change',{bubbles:true}))`);
  await click('Buchungen'); await shot('2-buchungen');
  await click('Neue Buchung'); await shot('3-buchungsmaske');
  await click('Konten'); await shot('4-konten');
  await click('Sollstellung'); await shot('5-sollstellung');
  await click('Offene Posten & Mahnungen'); await shot('6-op');
  await click('Bank & SEPA'); await click('SEPA-Lastschrift'); await shot('7-lastschrift');
  await click('Zähler'); await shot('8-zaehler');
  await click('Einstellungen & Sicherung'); await shot('9-einstellungen');
  await click('Mietverwaltung'); await click('Betriebskosten'); await wait(300);
  await js(`document.querySelectorAll('.maske input[type=date]')[0].value`); 
  await js(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; const [a, b] = document.querySelectorAll('.maske input[type=date]');
    set.call(a, '${new Date().getFullYear()}-01-01'); a.dispatchEvent(new Event('input', { bubbles: true }));
    set.call(b, '${new Date().getFullYear()}-12-31'); b.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click('Berechnen'); await wait(500); await shot('11-nk');
  await click('Abrechnungen als PDF'); await wait(2500);
  await click('WEG-Verwaltung'); await click('Konten'); await shot('10-weg-konten');
  await click('Jahresabrechnung'); await wait(300);
  await js(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; const [a, b] = document.querySelectorAll('.maske input[type=date]');
    set.call(a, '${new Date().getFullYear()}-01-01'); a.dispatchEvent(new Event('input', { bubbles: true }));
    set.call(b, '${new Date().getFullYear()}-12-31'); b.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click('Berechnen'); await wait(500); await shot('12-weg-abrechnung');
  await click('Abrechnung als PDF'); await wait(2500);
  await click('Wirtschaftsplan'); await wait(300); await click('Auf Eigentümer verteilen'); await wait(400); await shot('13-wipl');
  await click('Rücklagen & Sonderumlagen'); await shot('14-ruecklagen');
  // Visit every page in both modes once.
  for (const m of ['Mietverwaltung', 'WEG-Verwaltung']) {
    await click(m); await wait(300);
    const labels = await js(`[...document.querySelectorAll('nav .navgruppe button')].map(b => b.textContent.trim())`);
    for (const l of labels) { await click(l); await wait(250); const h = await js(`document.querySelector('main h1')?.textContent ?? '(kein Titel)'`); console.log('SEITE', m, '|', l, '→', h); }
  }
  await click('Mietverwaltung'); await click('Postfach'); await wait(800); await shot('20-postfach');
  await click('Archiv & Suche'); await wait(300);
  await js(`(() => { const i = document.querySelector('.suche.gross'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'abwasser'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(500); await shot('21-archiv-suche');
  await click('Rechnungen'); await wait(300); await shot('22-rechnungen');
  await js(`(() => { const i = document.querySelector('.globalsuche input'); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'meier'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(600); await shot('23-globalsuche');
  await click('WEG-Verwaltung'); await click('Versammlungen'); await wait(200); await click('Neue Versammlung'); await shot('15-versammlung-dialog'); await click('Abbrechen');
  await click('Versammlungen'); await wait(200); await click('Tagesordnung & Beschlüsse'); await wait(300); await click('Einladungen (PDF)'); await wait(2500); await click('Schließen');
  await click('Mietverwaltung'); await click('Briefe & Serienbriefe'); await wait(200);
  await js(`(() => { const sel = document.querySelector('.maske select'); sel.value = sel.options[1].value; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait(200); await click('Alle Mieter'); 
  await js(`[...document.querySelectorAll('label.check')].find(l => l.textContent.includes('Alle Mieter'))?.querySelector('input').click()`); await wait(200);
  await shot('16-briefe');
  await js(`[...document.querySelectorAll('button')].find(b => /als PDF$/.test(b.textContent.trim()) && !b.disabled)?.click()`); await wait(2500);
  await click('Mietanpassungen'); await wait(200); await click('Anpassungen'); await wait(300); await shot('17-anpassungen');
  app.quit();
});
