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
db.save('objekte', { id: o, kaufpreis_ct: 85000000, kaufnebenkosten_ct: 8000000, kaufdatum: '2019-05-01', gebaeudeanteil: 70, afa_satz: 2 });
const pr = db.save('projekte', { titel: 'Dachsanierung', status: 'laufend', objekt_id: o, kosten_konto_id: kt[45400], budget_ct: 4000000, beginn: `${jahr}-09-01` });
const g1 = db.save('projektaufgaben', { projekt_id: pr, titel: 'Gerüst stellen', gewerk: 'Gerüstbau Krause', beginn: `${jahr}-09-14`, ende: `${jahr}-09-18`, fortschritt: 100 });
const g2 = db.save('projektaufgaben', { projekt_id: pr, titel: 'Alte Eindeckung entfernen', gewerk: 'Dach GmbH', beginn: `${jahr}-09-21`, ende: `${jahr}-10-02`, fortschritt: 100, nach_id: g1 });
const g3 = db.save('projektaufgaben', { projekt_id: pr, titel: 'Dämmung & Neueindeckung', gewerk: 'Dach GmbH', beginn: `${jahr}-10-05`, ende: `${jahr}-11-06`, fortschritt: 35, nach_id: g2 });
const g4 = db.save('projektaufgaben', { projekt_id: pr, titel: 'Dachrinnen & Klempner', gewerk: 'Klempnerei Lutz', beginn: `${jahr}-11-02`, ende: `${jahr}-11-13`, fortschritt: 0, nach_id: g3 });
db.save('projektaufgaben', { projekt_id: pr, titel: 'Abnahme', beginn: `${jahr}-11-17`, ende: `${jahr}-11-17`, meilenstein: 1, nach_id: g4 });
db.save('projektposten', { projekt_id: pr, art: 'angebot', firma: 'Dach GmbH', titel: 'Angebot Dachsanierung', betrag_ct: 3480000, status: 'angenommen', datum: `${jahr}-07-10` });
db.save('projektposten', { projekt_id: pr, art: 'auftrag', firma: 'Dach GmbH', titel: 'Auftrag Dachsanierung', betrag_ct: 3480000, datum: `${jahr}-08-01`, aufgabe_id: g3 });
db.save('projektposten', { projekt_id: pr, art: 'auftrag', firma: 'Gerüstbau Krause', titel: 'Gerüst', betrag_ct: 420000, datum: `${jahr}-08-03`, aufgabe_id: g1 });
db.save('projektposten', { projekt_id: pr, art: 'rechnung', firma: 'Gerüstbau Krause', titel: 'Rechnung Gerüst', betrag_ct: 465000, datum: `${jahr}-09-30`, aufgabe_id: g1, status: 'bezahlt' });
db.save('projektposten', { projekt_id: pr, art: 'rechnung', firma: 'Dach GmbH', titel: '1. Abschlag', betrag_ct: 1200000, datum: `${jahr}-10-08`, faellig: `${jahr}-10-22`, aufgabe_id: g3 });
db.save('projekte', { titel: 'Renovierung Ferienwohnung', status: 'planung', budget_ct: 1500000 });
db.save('interessenten', { einheit_id: e[3], name: 'Lena Neumann', email: 'lena@example.de', personen: 2, einkommen_ct: 420000, beruf: 'Ärztin', bewertung: 5, status: 'auskunft' });
db.save('interessenten', { einheit_id: e[3], name: 'Max Huber', personen: 1, einkommen_ct: 260000, beruf: 'Student', bewertung: 3, status: 'besichtigung' });
db.save('interessenten', { einheit_id: e[3], name: 'Familie Yilmaz', personen: 4, einkommen_ct: 510000, bewertung: 4, status: 'neu' });
db.save('schluessel', { objekt_id: o, bezeichnung: 'Haustür / Wohnung', nummer: 'A-12', anzahl: 8 });
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
ipcMain.handle('mailTesten', () => 'ok');
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
  // A few photos filed directly with the house, a unit and the project for the galleries.
  const fotoQuelle = testDocs.find((f) => f.endsWith('.png'));
  if (fotoQuelle) {
    for (const [n, opt] of [['Fassade.png', { objekt_id: o }], ['Bad EG links.png', { objekt_id: o, einheit_id: e[0] }], ['Dach Baustelle.png', { projekt_id: pr }]]) {
      const kopie = path.join(out, n);
      fs.writeFileSync(kopie, Buffer.concat([fs.readFileSync(fotoQuelle), Buffer.from(n)]));
      for (const r of ana.importieren([kopie], { ...opt, status: 'abgelegt', typ: 'Foto' })) void r;
    }
  }
  await ana.warteschlange();
  for (let i = 0; i < 60 && db.zuAnalysieren().length; i++) await wait(500);
  const fassade = db.dokumentListe({ q: '' }).find((d) => d.name === 'Fassade.png');
  if (fassade) db.save('objekte', { id: o, titelbild_id: fassade.id });
  db.darlehenSpeichern({ objekt_id: o, bank: 'Sparkasse Berlin', vertragsnr: '4711', betrag_ct: 60000000, zinssatz: 3.2, tilgung_satz: 2, erste_rate: '2022-03-30', zinsbindung_bis: '2027-03-30' });
  ipcMain.handle('neuAnalysieren', (_e, id) => ana.neuAnalysieren(id));
  ipcMain.handle('pdfAblegen', async (_e, html, name, meta) => {
    const tmp = path.join(out, 'ablage.html'); fs.writeFileSync(tmp, html);
    const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true } }); await w.loadFile(tmp);
    const pdfPfad = path.join(out, name.replace(/[^\w.-]+/g, '_')); fs.writeFileSync(pdfPfad, await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true })); w.destroy();
    const [r] = ana.importieren([pdfPfad], { ...meta, status: 'abgelegt' }); return { id: r.id, datei: db.dokument(r.id).datei };
  });
  ipcMain.handle('dokumentOeffnen', () => '');
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
  await js(`localStorage.clear(); localStorage.setItem('thema', 'hell')`);
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
    const labels = await js(`[...document.querySelectorAll('nav .navgruppe .eintrag')].map(b => b.textContent.trim())`);
    for (const l of labels) { await click(l); await wait(250); const h = await js(`document.querySelector('main h1')?.textContent ?? '(kein Titel)'`); console.log('SEITE', m, '|', l, '→', h); }
  }
  win.setSize(1300, 1100);
  await click('Mietverwaltung'); await click('Cockpit'); await wait(700); await shot('60-cockpit-kacheln');
  await click('Steckbrief'); await wait(700); await shot('61-steckbrief');
  await click('Adressbuch'); await wait(300); await js(`document.querySelector('tbody tr')?.click()`); await wait(700); await shot('62-akte'); await click('Schließen');
  await click('Darlehen'); await wait(400); await shot('63-darlehen');
  await click('Übergaben & Mieterwechsel'); await wait(400);
  const uid = db.uebergabeNeu({ einheit_id: e[0], vertrag_id: db.vertraege('mietverhaeltnisse', o).find((v) => v.einheit_id === e[0]).id, art: 'auszug', datum: new Date().toISOString().slice(0, 10) });
  await js(`window.dispatchEvent(new Event('hv-daten'))`); await wait(500);
  await js(`[...document.querySelectorAll('tbody tr')].find(t => t.textContent.includes('Auszug'))?.click()`); await wait(700);
  await js(`document.querySelectorAll('.zustand')[4]?.querySelectorAll('button')[2]?.click()`); await wait(300);
  await js(`(() => { const t = document.querySelector('.raum textarea'); if (!t) return; const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, 'Wasserfleck an der Decke, Silikonfuge erneuern'); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await js(`(() => { const c = document.querySelectorAll('canvas.unterschrift-feld')[0]; const r = c.getBoundingClientRect(); const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { clientX: r.left + x, clientY: r.top + y, bubbles: true, pointerId: 1 }));
    ev('pointerdown', 20, 90); for (let i = 0; i < 40; i++) ev('pointermove', 20 + i * 8, 90 - Math.sin(i / 3) * 30); ev('pointerup', 340, 90); })()`);
  await wait(300); await shot('67-uebergabe');
  await click('Abschließen & Protokoll erstellen'); await wait(3000);
  const proto = db.dokumentListe({ q: '' }).find((d) => d.typ === 'Protokoll'); console.log('PROTOKOLL', proto?.titel, proto?.datei);
  await js(`document.querySelector('.toolbar select')?.dispatchEvent(new Event('change'))`);
  await js(`(() => { const s = document.querySelector('section .toolbar select'); s.value = s.options[1].value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`); await wait(600);
  await shot('68-mieterwechsel'); await click('Schließen');
  await click('Vermietung'); await wait(600); await shot('69-vermietung');
  await js(`(() => { const i = document.querySelector('.globalsuche input'); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'neu'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(600); await shot('70-befehlspalette');
  await js(`document.querySelector('.globalsuche input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`); await wait(800);
  console.log('PALETTE →', await js(`document.querySelector('main h1')?.textContent + ' | dialog: ' + (document.querySelector('.dialog h2, .panel .tabs')?.textContent ?? '-')`));
  await js(`document.documentElement.dataset.thema = 'dunkel'`);
  await click('Cockpit'); await wait(700); await shot('64-dunkel-cockpit');
  await click('WEG-Verwaltung'); await click('Konten'); await wait(500); await shot('65-dunkel-weg-konten');
  await click('Projekte'); await click('Zeitplan'); await wait(500); await shot('66-dunkel-gantt');
  await js(`document.documentElement.dataset.thema = 'hell'`); win.setSize(1300, 760);
  await click('Mietverwaltung'); await click('Postfach'); await wait(500);
  await js(`document.querySelectorAll('.dokliste li input[type=checkbox]')[1]?.click(); document.querySelectorAll('.dokliste li input[type=checkbox]')[2]?.click()`);
  await wait(400); await shot('50-postfach-stapel');
  await click('Einheiten'); await wait(400); win.setSize(1300, 1000); await shot('51-einheiten-galerie');
  await click('Fotos & Dokumente'); await wait(600); await shot('52-einheit-fotos'); await click('Schließen'); win.setSize(1300, 760);
  await click('Mietverwaltung'); await click('Rendite & Steuer'); await wait(500); await shot('40-rendite');
  await click('Anlage V (Steuer)'); await wait(400); await shot('41-anlagev');
  await click('Einstellungen & Sicherung'); await wait(300); await js(`window.scrollTo(0, 99999); document.querySelector('main').scrollTo(0, 99999)`); await wait(300); await shot('42-einstellungen');
  await click('Mietverwaltung'); await click('Postfach'); await wait(800); await shot('20-postfach');
  await click('Archiv & Suche'); await wait(300);
  await js(`(() => { const i = document.querySelector('.suche.gross'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'abwasser'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(500); await shot('21-archiv-suche');
  await click('Rechnungen'); await wait(300); await shot('22-rechnungen');
  await js(`(() => { const i = document.querySelector('.globalsuche input'); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'meier'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(600); await shot('23-globalsuche');
  await js(`document.activeElement?.blur()`); await click('Projekte'); await wait(500); win.setSize(1300, 1100); await click('Cockpit'); await wait(500); await shot('30-projekt-cockpit');
  await click('Zeitplan'); await wait(500); await shot('31-zeitplan');
  await click('Kosten & Budget'); await wait(400); await shot('32-kosten');
  await click('Fotos & Dokumente'); await wait(500); await shot('33-projekt-fotos'); win.setSize(1300, 760);
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
