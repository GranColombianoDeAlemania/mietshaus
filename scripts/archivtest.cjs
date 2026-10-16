// End-to-end test of document intake: text PDF, scanned PDF and photo → text, fields, search.
// Run: npm run build && electron scripts/archivtest.cjs <outdir>
const { app, BrowserWindow, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { open, api } = require('../electron/db.cjs');
const analyse = require('../electron/analyse.cjs');

const out = path.resolve(process.argv[process.argv.length - 1]);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
protocol.registerSchemesAsPrivileged([analyse.SCHEMA]);
app.commandLine.appendSwitch('lang', 'de-DE');
// Keep running while helper windows open and close.
app.on('window-all-closed', () => {});

const RECHNUNG = `<html><body style="font:16px Arial;padding:40px">
<b>Stadtwerke Musterstadt GmbH</b><br>Werkstraße 1, 10115 Berlin<br><br><br>
Hausverwaltung Muster · Lindenstraße 5 · 10115 Berlin<br><br>
<h2>Rechnung</h2>Rechnungsnummer: SW-2026-0815<br>Rechnungsdatum: 12.03.2026<br>Objekt: Lindenstraße 5<br><br>
<table border=1 cellpadding=6><tr><td>Wasser 2025</td><td>812,40 €</td></tr><tr><td>Abwasser 2025</td><td>420,00 €</td></tr></table><br>
Gesamtbetrag: 1.232,40 €<br>Zahlbar bis 31.03.2026 auf IBAN DE89 3704 0044 0532 0130 00</body></html>`;

app.whenReady().then(async () => {
  const docs = path.join(out, 'dokumente');
  analyse.protokollRegistrieren(() => docs, () => path.join(docs, 'vorschau'));
  const db = api(open(path.join(out, 'test.sqlite')));
  db.neuesObjekt({ bezeichnung: 'Lindenstraße 5', art: 'miete', strasse: 'Lindenstraße 5', plz: '10115', ort: 'Berlin' });

  // Test files: text PDF, image-only PDF (scan) and a PNG photo of the same invoice.
  const w = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { offscreen: true } });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(RECHNUNG));
  // Offscreen windows paint asynchronously; capture before printing.
  await new Promise((r) => setTimeout(r, 500));
  const png = (await w.webContents.capturePage()).toPNG();
  fs.writeFileSync(path.join(out, 'rechnung.pdf'), await w.webContents.printToPDF({}));
  fs.writeFileSync(path.join(out, 'foto.png'), png);
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body style="margin:0"><img style="width:100%" src="data:image/png;base64,${png.toString('base64')}"></body>`));
  fs.writeFileSync(path.join(out, 'scan.pdf'), await w.webContents.printToPDF({ printBackground: true }));
  w.destroy();

  const ana = analyse({ db, dokumentOrdner: () => docs, vorschauOrdner: () => path.join(docs, 'vorschau'),
    analyseUrl: () => pathToFileURL(path.join(__dirname, '..', 'dist', 'analyse.html')).href });
  const t0 = Date.now();
  // E-invoices: a ZUGFeRD PDF (XML embedded) and a plain XRechnung (UBL XML).
  const { zugferdPdf } = require('./testdaten/zugferd-pdf.cjs');
  fs.writeFileSync(path.join(out, 'zugferd.pdf'), zugferdPdf(fs.readFileSync(path.join(__dirname, 'testdaten', 'erechnung-cii.xml'), 'utf8'),
    ['Sanitaer Krueger GmbH - Gleimstrasse 12 - 10437 Berlin', 'Rechnung RE-2026-0815 vom 14.09.2026', 'Austausch Eckventile Bad und Kueche 4 Std. 260,00 EUR',
      'Material 58,40 EUR', 'Summe netto 318,40 EUR, USt 19 % 60,50 EUR, Gesamt 378,90 EUR', 'Zahlbar bis 28.09.2026']));
  fs.copyFileSync(path.join(__dirname, 'testdaten', 'erechnung-ubl.xml'), path.join(out, 'xrechnung.xml'));
  console.log('import', ana.importieren(['rechnung.pdf', 'scan.pdf', 'foto.png', 'rechnung.pdf', 'zugferd.pdf', 'xrechnung.xml'].map((f) => path.join(out, f))));
  await new Promise((r) => setTimeout(r, 500));
  await ana.warteschlange();
  for (let i = 0; i < 120 && db.zuAnalysieren().length; i++) await new Promise((r) => setTimeout(r, 500));
  console.log('dauer', ((Date.now() - t0) / 1000).toFixed(1), 's');
  for (const d of db.dokumentListe({})) {
    const x = db.dokument(d.id);
    console.log(JSON.stringify({ name: x.name, analyse: x.analyse, ocr: x.ocr, seiten: x.seiten, typ: x.typ, betrag: x.betrag_ct, datum: x.datum,
      faellig: x.faellig, rnr: x.rechnungsnr, iban: x.iban, absender: x.absender, objekt: x.objekt, zeichen: (x.text ?? '').length,
      netto: x.netto_ct, ust: x.ust_ct, erechnung: x.erechnung ? JSON.parse(x.erechnung).syntax : null, titel: x.titel }));
  }
  for (const q of ['stadtwerke abwasser', 'SW-2026', 'musterstadt', 'gibtsnicht'])
    console.log('suche', q, '→', db.dokumentListe({ q }).map((d) => `${d.name}: ${d.treffer}`));
  console.log('globale suche', JSON.stringify(db.suche('linden')).slice(0, 300));
  await ana.beenden();
  app.quit();
});
