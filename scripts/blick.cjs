// Quick look at selected pages with the harness sample data: electron scripts/blick.cjs <outdir>
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { open, api } = require('../electron/db.cjs');
const { harness } = require('./harness.cjs');
const out = process.argv[process.argv.length - 1];
const raw = open(':memory:');
const db = api(raw);
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

app.commandLine.appendSwitch('lang', 'de-DE');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  db.automatikLauf();
  const breite = Number(process.env.BREITE) || 1400, hoehe = Number(process.env.HOEHE) || 900;
  const { win } = await harness({ db, raw, out, breite, hoehe, ueberschreiben: { kontextmenue: () => null } });
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) console.log('RENDERER-FEHLER:', e.message, e.sourceId?.split('/').pop(), e.lineNumber); });
  const js = (s) => win.webContents.executeJavaScript(s).catch((e) => { console.log('SCRIPT-FEHLER:', s.slice(0, 120), e.message); });
  await js(`localStorage.clear(); localStorage.setItem('thema', '${process.env.THEMA || 'hell'}')`);
  await win.reload(); await wait(700);
  const klick = (text) => js(`(() => { const t = ${JSON.stringify(text)}; const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t || b.querySelector('.text')?.textContent.trim() === t); if (b) b.click(); return !!b; })()`);
  const shot = async (n) => { await wait(500); fs.writeFileSync(path.join(out, n + '.png'), (await win.webContents.capturePage()).toPNG()); console.log('BILD', n, await js(`document.querySelector('.pfad')?.textContent`)); };
  const schritte = (process.env.SCHRITTE || 'cockpit,mieter,person,einheit,vertrag,buchungen,steckbrief').split(',');
  await js(`document.querySelector('.objektwahl select').value='${o}'; document.querySelector('.objektwahl select').dispatchEvent(new Event('change',{bubbles:true}))`);
  await wait(300);
  for (const s of schritte) {
    if (s === 'cockpit') { await klick('Cockpit'); await shot('cockpit'); }
    if (s === 'mieter') { await klick('Mieter'); await shot('mieter'); }
    if (s === 'person') { await klick('Mieter'); await wait(300); await js(`document.querySelector('main [data-person]')?.click()`); await shot('person'); }
    if (s === 'einheit') { await klick('Mieter'); await wait(300); await js(`document.querySelector('main button[data-ziel^="einheit:"]')?.click()`); await shot('einheit'); }
    if (s === 'vertrag') { await klick('Mieter'); await wait(300); await js(`document.querySelector('main tr.klickbar')?.click()`); await shot('vertrag'); }
    if (s === 'buchungen') { await klick('Buchungen'); await shot('buchungen'); }
    if (s === 'steckbrief') { await klick('Steckbrief'); await shot('steckbrief'); }
    if (s === 'op') { await klick('Offene Posten'); await shot('op'); }
    if (s === 'weg') { await js(`document.querySelector('.modus-weg').click()`); await wait(500); await shot('weg-cockpit'); }
    if (s === 'hover') { await klick('Mieter'); await wait(300); await js(`(() => { const l = document.querySelector('main [data-person]'); l.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); })()`); await wait(900); await shot('hover'); }
  }
  app.quit();
});
