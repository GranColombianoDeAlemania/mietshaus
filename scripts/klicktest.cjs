// Click test with the sample house of the calculation test: opens every page in every mode, clicks the buttons there,
// opens and closes dialogs, writes the important letters and files and checks their content
// (PDF text, SEPA XML against the ISO 20022 schemas, ZIP, CSV).
// Run: npm run build && npx electron scripts/klicktest.cjs <outdir>   (XSD=<folder with pain.*.xsd> for the schema check)
const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const analyse = require('../electron/analyse.cjs');
protocol.registerSchemesAsPrivileged([analyse.SCHEMA]);

const out = path.resolve(process.argv[process.argv.length - 1]);
const { db, o, w, V } = require('./rechentest.cjs');
const DATEIEN = path.join(out, 'dateien');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(DATEIEN, { recursive: true });

// Sample data for SEPA and letters.
db.save('objekte', { id: o, iban: 'DE02120300000000202051', bic: 'BYLADEM1001', sepa_glaeubiger_id: 'DE98ZZZ09999999999', bank: 'Testbank' });
db.save('personen', { id: db.get('mietverhaeltnisse', V.v1.id).person_id, iban: 'DE89370400440532013000' });
db.save('mietverhaeltnisse', { id: V.v1.id, lastschrift: 1, sepa_mandat: 'M-001' });
db.save('mietverhaeltnisse', { id: V.v2.id, person2_id: db.save('personen', { anrede: 'Frau', vorname: 'Mia', nachname: 'Becker' }) });

let fehlerZahl = 0;
const meldeFehler = (...t) => { fehlerZahl++; console.log('FEHLER', ...t); };
let menueAntwort = null; // answer of the next native menu

async function pdfDrucken(html, datei) {
  const tmp = path.join(out, `tmp-${Date.now()}.html`);
  fs.writeFileSync(tmp, html);
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await w.loadFile(tmp);
  fs.writeFileSync(datei, await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true }));
  w.destroy();
  fs.rmSync(tmp, { force: true });
}
const sauber = (n) => n.replace(/[^\wäöüÄÖÜß.-]+/g, '_');

app.commandLine.appendSwitch('lang', 'de-DE');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const docs = path.join(out, 'dokumente');
  analyse.protokollRegistrieren(() => docs, () => path.join(docs, 'vorschau'));
  const ana = analyse({ db, dokumentOrdner: () => docs, vorschauOrdner: () => path.join(docs, 'vorschau'),
    analyseUrl: () => pathToFileURL(path.join(__dirname, '..', 'dist', 'analyse.html')).href });

  ipcMain.handle('db', (_e, fn, args) => {
    if (typeof db[fn] !== 'function') { meldeFehler('Unbekannte Funktion', fn); throw new Error(`db.${fn} fehlt`); }
    return db[fn](...args);
  });
  ipcMain.handle('pdf', async (_e, html, name) => { await pdfDrucken(html, path.join(DATEIEN, sauber(name))); return name; });
  ipcMain.handle('pdfAblegen', async (_e, html, name, meta) => {
    const datei = path.join(DATEIEN, sauber(name));
    await pdfDrucken(html, datei);
    const [r] = ana.importieren([datei], { ...meta, status: 'abgelegt' });
    return { id: r.id, datei: db.dokument(r.id).datei };
  });
  ipcMain.handle('speichern', (_e, inhalt, name) => { fs.writeFileSync(path.join(DATEIEN, sauber(name)), inhalt); return name; });
  ipcMain.handle('steuerpaket', (_e, objektId, jahr) => {
    const d = db.steuerpaketDaten(objektId, jahr);
    const { zip } = require('../electron/zip.cjs');
    fs.writeFileSync(path.join(DATEIEN, `Steuerpaket ${jahr}.zip`), zip([{ name: 'Journal.csv', daten: d.journal }, { name: 'Salden.csv', daten: d.salden }, { name: 'Kontenblätter.csv', daten: d.kontenblaetter }]));
    return 'ok';
  });
  ipcMain.handle('kontextmenue', (_e, eintraege) => { const a = menueAntwort; menueAntwort = null; return a && eintraege.some((x) => x.id === a) ? a : null; });
  for (const k of ['oeffnen', 'sicherung', 'wiederherstellen', 'dokumentOeffnen', 'extern', 'eingangsordnerWaehlen', 'eingangsordnerAus', 'mailSpeichern', 'claudeVerbinden', 'neuAnalysieren'])
    ipcMain.handle(k, () => null);
  for (const k of ['dokumentAblegen', 'importieren', 'dateienImportieren']) ipcMain.handle(k, () => []);
  ipcMain.handle('dokumentLoeschen', (_e, id) => db.dokumentLoeschen(id));
  ipcMain.handle('mailTesten', () => 'ok');
  ipcMain.handle('mailAbrufen', () => ({ neu: 0 }));
  ipcMain.handle('claudeStatus', () => ({ datei: '-', installiert: true, verbunden: false, eintrag: {} }));
  ipcMain.handle('info', () => ({ dbFile: ':memory:', dokumente: docs, version: app.getVersion(), sicherungen: '-', geraet: 'Test', stand: { zeit: null, geraet_name: null }, letzte_auto_sicherung: null }));

  const win = new BrowserWindow({ width: 1300, height: 860, show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'electron', 'preload.cjs'), contextIsolation: true, sandbox: true, offscreen: true } });
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 3) meldeFehler('Renderer:', e.message, e.sourceId?.split('/').pop(), e.lineNumber);
    else if (/^ALERT:/.test(e.message)) console.log('  Meldung:', e.message.slice(7, 220));
  });
  win.webContents.on('render-process-gone', (_e, d) => meldeFehler('Renderer abgestürzt:', d.reason));
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (s) => win.webContents.executeJavaScript(s).catch((e) => { meldeFehler('Skript:', s.slice(0, 120), e.message); return null; });
  const stubs = `window.confirm = () => true; window.alert = (m) => console.log('ALERT: ' + m); window.prompt = () => null;
    window.hvTest = { bestaetigen: () => true, hinweis: (m) => console.log('ALERT: ' + m) }; true`;
  await js(`localStorage.clear(); localStorage.setItem('thema', 'hell')`);
  await win.reload(); await wait(800); await js(stubs);
  const zu = async (ziel) => { await js(`window.dispatchEvent(new CustomEvent('hv-zu', { detail: ${JSON.stringify(ziel)} }))`); await wait(500); };
  const titel = () => js(`document.querySelector('main h1')?.textContent ?? ''`);
  const klick = (text, im = 'document') => js(`(() => { const r = ${im}; if (!r) return false; const b = [...r.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled); b?.click(); return !!b; })()`);
  const dialogZu = () => js(`(() => { const o = document.querySelector('.overlay'); if (!o) return false;
    const b = [...o.querySelectorAll('button')].reverse().find((b) => /^(Schließen|Abbrechen)$/.test(b.textContent.trim())); if (b) b.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
  const eingabe = (sel, wert) => js(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); if (!i) return false;
    const proto = i.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : i.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(i, ${JSON.stringify(wert)}); i.dispatchEvent(new Event(i.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`);
  // Screenshots are only for looking at: a failed capture (a GPU hiccup) is tried once more, then noted and skipped.
  const shot = async (name) => {
    await wait(300);
    for (let i = 0; i < 2; i++) {
      try { fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG()); return; } catch (e) {
        if (i) console.log(`Bildschirmfoto ${name} fehlgeschlagen: ${e.message}`); else await wait(1500);
      }
    }
  };

  // ---------- 1. Every page, every button ----------
  // Buttons that would remove the sample data needed later are left out.
  const NICHT = /löschen|entfernen|storn|zurücksetzen|wiederherstellen|sicherung|festschreib|ausblenden|verbinden|abrufen|eingangsordner|beenden|kündigung|abschließen/i;
  let seitenZahl = 0, knopfZahl = 0, dialogZahl = 0;
  for (const [modus, objektId] of process.env.KLICK === '0' ? [] : [['miete', o], ['weg', w], ['projekt', null]]) {
    await zu({ seite: modus === 'projekt' ? 'pcockpit' : 'uebersicht', modus, ...(objektId ? { objektId } : {}) });
    const eintraege = await js(`[...document.querySelectorAll('nav .eintrag:not(.kind)')].map((b) => b.textContent.trim())`);
    for (const [ei, eintrag] of (eintraege ?? []).entries()) {
      const hin = async () => { await js(`document.querySelectorAll('nav .eintrag:not(.kind)')[${ei}]?.click()`); await wait(450); await js(stubs); };
      await hin();
      const h1 = await titel();
      seitenZahl++;
      if (!h1 && !(await js(`!!document.querySelector('main .leerzustand')`))) meldeFehler(`Seite ohne Überschrift: ${modus} / ${eintrag}`);
      await shot(`seite-${modus}-${String(ei).padStart(2, '0')}`);
      const knoepfe = await js(`[...document.querySelectorAll('main button')].filter((b) => !b.closest('.overlay')).map((b) => b.textContent.trim() || b.title || '')`);
      for (let i = 0; i < Math.min(knoepfe?.length ?? 0, 45); i++) {
        const t = knoepfe[i];
        if (NICHT.test(t)) continue;
        const ok = await js(`(() => { const b = [...document.querySelectorAll('main button')].filter((b) => !b.closest('.overlay'))[${i}];
          if (!b || b.disabled || (b.textContent.trim() || b.title || '') !== ${JSON.stringify(t)}) return false; b.click(); return true; })()`);
        if (!ok) continue;
        knopfZahl++;
        await wait(350);
        const d = await js(`document.querySelector('.overlay h2')?.textContent ?? null`);
        if (d) { dialogZahl++; await dialogZu(); await wait(250); await dialogZu(); await wait(150); }
        if ((await titel()) !== h1) await hin();
      }
    }
  }
  console.log(`Klickrunde: ${seitenZahl} Seiten, ${knopfZahl} Knöpfe, ${dialogZahl} Dialoge.`);

  // ---------- 2. Detail pages ----------
  for (const z of [{ person: db.get('mietverhaeltnisse', V.v1.id).person_id }, { einheit: db.get('mietverhaeltnisse', V.v3b.id).einheit_id }, { vertrag: V.v2.id, typ: 'miete' },
    { vertrag: db.vertraege('eigentum', w)[0].id, typ: 'weg' }, { konto: db.kontoVon('miete', V.v1.id).id }]) {
    await zu(z);
    const h1 = await titel();
    if (!h1) meldeFehler('Detailseite ohne Überschrift', JSON.stringify(z));
    const reiter = await js(`document.querySelectorAll('main .reiter button').length`);
    for (let i = 0; i < reiter; i++) { await js(`document.querySelectorAll('main .reiter button')[${i}].click()`); await wait(300); }
    await shot(`detail-${Object.keys(z)[0]}`);
  }

  // ---------- 3. Letters and files ----------
  // Model letters: add the built-in templates, write each one to all tenants.
  await zu({ seite: 'briefe', modus: 'miete', objektId: o });
  await js(`[...document.querySelectorAll('main .tabs button, main .reiter button')].find((b) => b.textContent.trim() === 'Vorlagen')?.click()`); await wait(400);
  await js(`[...document.querySelectorAll('main button')].find((b) => /Musterbriefe ergänzen$/.test(b.textContent.trim()))?.click()`); await wait(800);
  const vorlagen = db.liste('vorlagen', {}, 'titel');
  for (const v of vorlagen) {
    await zu({ seite: 'briefe', modus: v.kategorie === 'WEG' ? 'weg' : 'miete', objektId: v.kategorie === 'WEG' ? w : o });
    await eingabe('main .maske select', String(v.id)); await wait(200);
    await js(`(() => { const i = [...document.querySelectorAll('main label.check')].find((l) => /Alle (Mieter|Eigentümer)/.test(l.textContent))?.querySelector('input'); if (i && !i.checked) i.click(); })()`); await wait(200);
    await js(`[...document.querySelectorAll('main button')].find((b) => /als PDF$/.test(b.textContent.trim()) && !b.disabled)?.click()`); await wait(1800);
  }
  // Certificates from the contract page (native menu answered by the test).
  for (const t of ['Mietbescheinigung', 'Mietschuldenfreiheitsbescheinigung', 'Wohnungsgeberbestätigung (§ 19 BMG)']) {
    await zu({ vertrag: V.v2.id, typ: 'miete' });
    menueAntwort = t;
    await js(`[...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Brief')?.click()`); await wait(1800);
  }
  // Rent adjustment letters (increase, graduated, indexed).
  for (const k of ['v1', 'v2', 'v4']) {
    await zu({ seite: 'anpassung', modus: 'miete', objektId: o });
    await js(`[...document.querySelectorAll('main tr')].find((t) => t.textContent.includes(${JSON.stringify(db.get('personen', db.get('mietverhaeltnisse', V[k].id).person_id).nachname)}))?.querySelector('td.aktionen button')?.click()`); await wait(600);
    await js(`[...document.querySelectorAll('.overlay tbody tr')].pop()?.querySelector('td.aktionen button')?.click()`); await wait(800);
    if (!(await js(`!!document.querySelector('.overlay .pruefliste, .overlay .maske')`))) meldeFehler(`Briefdialog ${k} nicht geöffnet`);
    if (k === 'v1') {
      await eingabe('.overlay input[placeholder^="z. B. Mietspiegel"]', 'Berliner Mietspiegel 2026');
      await eingabe('.overlay input[placeholder^="z. B. Baujahr"]', 'Feld H 3: Altbau bis 1918, 60–90 m², mittlere Lage');
      const felder = await js(`[...document.querySelectorAll('.overlay label')].map((l) => l.textContent)`);
      for (const [label, wert] of [['Spanne von', '7,10'], ['Mittelwert', '9,80'], ['Spanne bis', '12,10']]) {
        const i = felder?.findIndex((x) => x.startsWith(label));
        if (i >= 0) await js(`(() => { const inp = document.querySelectorAll('.overlay label')[${i}].querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, ${JSON.stringify(wert)}); inp.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      }
      await wait(300);
    }
    // With today's receipt the dates of the older adjustments are too early: the letter must be blocked, then the real receipt date is set.
    const zugang = { v1: '2025-04-20', v4: '2026-08-20' }[k];
    if (zugang) {
      await wait(400);
      if (!(await js(`[...document.querySelectorAll('.overlay button')].find((b) => b.textContent.trim() === 'Brief erstellen und ablegen')?.disabled`)))
        meldeFehler(`Brief ${k}: zu frühes Datum wird nicht blockiert`);
      await eingabe('.overlay input[type=date]', zugang); await wait(600);
    }
    const pruef = await js(`[...document.querySelectorAll('.overlay .pruefliste li')].map((l) => l.className + ': ' + l.textContent)`);
    console.log(`Brief ${k}:`, (pruef ?? []).map((x) => x.slice(0, 110)).join('\n   '));
    await shot(`brief-anpassung-${k}`);
    await klick('Brief erstellen und ablegen', "document.querySelector('.overlay')"); await wait(2000);
    await dialogZu(); await wait(200); await dialogZu();
  }
  // Service-charge statement 2025, owners' statement, budget plan.
  await zu({ seite: 'nk', modus: 'miete', objektId: o });
  const nkFelder = await js(`[...document.querySelectorAll('main .maske label')].map((l) => l.textContent)`);
  for (const [label, wert] of [['CO₂-Ausstoß', '18000'], ['CO₂-Kosten', '990,00']]) {
    const i = nkFelder?.findIndex((x) => x.startsWith(label));
    if (i >= 0) await js(`(() => { const inp = document.querySelectorAll('main .maske label')[${i}].querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, ${JSON.stringify(wert)}); inp.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  }
  await klick('Berechnen'); await wait(800); await shot('nk-2025');
  await klick('Abrechnungen als PDF'); await wait(3500);
  await zu({ seite: 'wegabr', modus: 'weg', objektId: w });
  await klick('Berechnen'); await wait(800);
  await klick('Abrechnung als PDF'); await wait(3000);
  // Dunning run.
  await zu({ seite: 'op', modus: 'miete', objektId: o });
  await js(`[...document.querySelectorAll('main button')].find((b) => /^Mahnlauf/.test(b.textContent.trim()))?.click()`); await wait(600);
  await js(`[...document.querySelectorAll('.overlay button')].find((b) => /erstellen/i.test(b.textContent) && !b.disabled)?.click()`); await wait(3000);
  await dialogZu();
  // SEPA direct debit.
  await zu({ seite: 'bank', modus: 'miete', objektId: o });
  await klick('SEPA-Lastschrift'); await wait(500);
  await js(`[...document.querySelectorAll('main button')].find((b) => /^SEPA-Datei erstellen/.test(b.textContent.trim()) && !b.disabled)?.click()`); await wait(800);
  // Tax adviser package (ZIP) from the tax guard.
  await zu({ seite: 'auswertung', modus: 'miete', objektId: o });
  await js(`[...document.querySelectorAll('main .tabs button')].find((b) => b.textContent.trim() === 'Steuer-Wächter')?.click()`); await wait(500);
  await klick('Paket erstellen …'); await wait(1500);
  // DATEV and tax adviser package.
  await zu({ seite: 'export', modus: 'miete', objektId: o });
  const exporte = await js(`document.querySelectorAll('main td.aktionen button').length`);
  for (let i = 0; i < exporte; i++) { await js(`document.querySelectorAll('main td.aktionen button')[${i}].click()`); await wait(1200); }

  // ---------- 4. Dark mode, narrow window ----------
  await js(`document.documentElement.dataset.thema = 'dunkel'`);
  for (const z of [{ seite: 'uebersicht', modus: 'miete' }, { vertrag: V.v1.id, typ: 'miete' }, { seite: 'buchen', modus: 'miete', objektId: o }]) { await zu(z); await shot(`dunkel-${z.seite ?? 'vertrag'}`); }
  await js(`document.documentElement.dataset.thema = 'hell'`);
  win.setSize(900, 800); await wait(400);
  for (const z of [{ seite: 'uebersicht', modus: 'miete' }, { seite: 'op', modus: 'miete', objektId: o }, { person: db.get('mietverhaeltnisse', V.v1.id).person_id }]) {
    await zu(z);
    const breit = await js(`document.querySelector('main').scrollWidth > document.querySelector('main').clientWidth + 2`);
    if (breit) console.log('  Hinweis: waagerechtes Scrollen bei schmalem Fenster auf', z.seite ?? Object.keys(z)[0]);
    await shot(`schmal-${z.seite ?? Object.keys(z)[0]}`);
  }

  // ---------- 5. Content of the generated files ----------
  const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const text = async (datei) => {
    const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(datei)), verbosity: 0 });
    const doc = await task.promise;
    let t = '';
    for (let i = 1; i <= doc.numPages; i++) t += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ') + '\n';
    await task.destroy();
    return t;
  };
  const dateien = fs.readdirSync(DATEIEN);
  const pdfs = dateien.filter((f) => f.endsWith('.pdf'));
  console.log(`Dateien: ${dateien.length} (${pdfs.length} PDF)`);
  const inhalt = {};
  for (const f of pdfs) {
    let t = '';
    try { t = await text(path.join(DATEIEN, f)); } catch (e) { meldeFehler(`PDF ${f} nicht lesbar:`, e.message); continue; }
    inhalt[f] = t;
    const kaputt = t.match(/undefined|NaN|\[object|Invalid Date|null\b|\{[a-z_]+\}/);
    if (kaputt) meldeFehler(`PDF ${f}: enthält „${kaputt[0]}“ – …${t.slice(Math.max(0, kaputt.index - 60), kaputt.index + 40).replace(/\s+/g, ' ')}…`);
    if (t.replace(/\s/g, '').length < 80) meldeFehler(`PDF ${f}: fast leer`);
  }
  const finde = (re) => Object.entries(inhalt).find(([f]) => re.test(f));
  const erwarte = (re, muster, name) => {
    const d = finde(re);
    if (!d) return meldeFehler(`PDF fehlt: ${name}`);
    for (const m of muster) if (!m.test(d[1].replace(/\s+/g, ' '))) meldeFehler(`PDF ${d[0]}: „${m.source}“ fehlt`);
  };
  erwarte(/Mieterhöhungsverlangen/i, [/§ 558 BGB/, /Berliner Mietspiegel 2026/, /Kappungsgrenze/, /Zustimmung zur Mieterhöhung/, /§ 561 BGB/], 'Mieterhöhungsverlangen');
  erwarte(/Indexmiete/i, [/§ 557b/, /VPI/, /121,7/, /124,5/], 'Indexanpassung');
  erwarte(/Mietstaffel/i, [/§ 557a/, /630,00/], 'Staffel');
  erwarte(/Mietbescheinigung/i, [/Jonas Becker und Mia Becker/, /Unterschrift/], 'Mietbescheinigung');
  erwarte(/Wohnungsgeber/i, [/§ 19/, /Einzug/, /50\.000/], 'Wohnungsgeberbestätigung');
  erwarte(/Betriebskostenabrechnung/i, [/Grundsteuer/, /CO₂|CO2/], 'Betriebskostenabrechnung');
  // SEPA XML against the ISO 20022 schema.
  for (const f of dateien.filter((x) => x.endsWith('.xml'))) {
    const art = /<Document xmlns="urn:iso:std:iso:20022:tech:xsd:(pain\.\d{3}\.\d{3}\.\d{2})"/.exec(fs.readFileSync(path.join(DATEIEN, f), 'utf8'))?.[1];
    const xsd = process.env.XSD && art && path.join(process.env.XSD, `${art}.xsd`);
    if (!xsd || !fs.existsSync(xsd)) { console.log(`  ${f}: ${art ?? 'kein SEPA'} – Schema nicht vorhanden, nicht geprüft`); continue; }
    try { execFileSync('xmllint', ['--noout', '--schema', xsd, path.join(DATEIEN, f)], { stdio: 'pipe' }); console.log(`  ${f}: gültig nach ${art}`); }
    catch (e) { meldeFehler(`${f}: ungültig nach ${art}`, String(e.stderr).slice(0, 400)); }
  }
  if (!dateien.some((f) => f.endsWith('.xml'))) meldeFehler('Keine SEPA-Datei erzeugt');
  for (const f of dateien.filter((x) => x.endsWith('.zip'))) {
    try { console.log(`  ${f}:`, execFileSync('python3', ['-I', '-c', 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip() or "ok", len(z.namelist()))', path.join(DATEIEN, f)]).toString().trim()); }
    catch (e) { meldeFehler(`${f}: ZIP kaputt`); }
  }
  for (const f of dateien.filter((x) => /\.(csv|txt)$/i.test(x))) {
    const t = fs.readFileSync(path.join(DATEIEN, f), 'latin1');
    if (/undefined|NaN/.test(t)) meldeFehler(`${f}: enthält undefined/NaN`);
    console.log(`  ${f}: ${t.split(/\r?\n/).length} Zeilen`);
  }

  console.log(`\nKlicktest: ${fehlerZahl} Fehler.`);
  app.exit(fehlerZahl ? 1 : 0);
});
