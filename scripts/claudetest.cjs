// Test of Claude's proposals and of undoing changes: talks to the real MCP server (electron/mcp.cjs) over stdio like
// Claude Desktop does, accepts and rejects proposals through the app's API and undoes entries of the change log.
// Run: ELECTRON_RUN_AS_NODE=1 npx electron scripts/claudetest.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { open, api } = require('../electron/db.cjs');

let richtig = 0, falsch = 0;
const pruefe = (name, ok, info = '') => { if (ok) richtig++; else { falsch++; console.log('FALSCH', name, info); } };
const wirft = (name, fn, muster) => {
  try { fn(); pruefe(name, false, 'kein Fehler'); } catch (e) { pruefe(name, muster.test(String(e.message)), e.message); }
};

(async () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mietshaus-claude-'));
  const dbFile = path.join(ordner, 'mietshaus.sqlite');
  const raw = open(dbFile, 'app', { id: 'pc', name: 'test@mac' });
  const db = api(raw);
  const o = db.neuesObjekt({ bezeichnung: 'Teststraße 1', art: 'miete', plz: '10115', ort: 'Berlin' });
  const e = db.save('einheiten', { objekt_id: o, nr: 1, bezeichnung: 'EG', wohnflaeche: 60 });
  const p = db.save('personen', { vorname: 'Eva', nachname: 'Muster', iban: 'DE02120300000000202051' });
  const kt = Object.fromEntries(db.konten(o).map((k) => [k.nr, k.id]));

  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'electron', 'mcp.cjs')],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MIETSHAUS_DB: dbFile, MIETSHAUS_DATEN: ordner }, stderr: 'pipe' }));
  const rufe = async (name, args) => (await client.callTool({ name, arguments: args })).content[0].text;

  // ---------- 1. proposals instead of direct changes ----------
  const t1 = await rufe('buchen', { objekt_id: o, datum: '2026-10-01', text: 'Hausmeister Oktober',
    positionen: [{ soll_konto_id: kt[45100] ?? db.konten(o, 'kosten')[0].id, haben_konto_id: kt[1200], betrag_eur: 120.5 }] });
  pruefe('Buchung wird Vorschlag', /^Vorschlag \d+ angelegt/.test(t1), t1);
  pruefe('… noch nicht gebucht', !db.buchungen(o, '2026-01-01', '2026-12-31').some((b) => b.text === 'Hausmeister Oktober'));
  const t2 = await rufe('person_aendern', { id: p, iban: 'DE89370400440532013000' });
  pruefe('IBAN-Änderung wird Vorschlag', /Vorschlag \d+ angelegt.*DE02120300000000202051 → DE89370400440532013000/.test(t2), t2);
  pruefe('… IBAN unverändert', db.get('personen', p).iban === 'DE02120300000000202051');
  const t3 = await rufe('person_anlegen', { vorname: 'Kai', nachname: 'Neu' });
  pruefe('Person anlegen bleibt direkt', /^Person angelegt/.test(t3), t3);

  const offen = db.vorschlaege('offen');
  pruefe('Zwei offene Vorschläge', offen.length === 2, offen.length);
  pruefe('Beschreibung nennt Konten und Betrag', /120,50\s€/.test(offen.find((v) => v.werkzeug === 'buchen')?.beschreibung ?? ''), offen[1]?.beschreibung);
  pruefe('Hinweis im Cockpit', db.hinweise().some((h) => h.schluessel === 'claude:vorschlaege'));

  const vBuchung = offen.find((v) => v.werkzeug === 'buchen').id;
  const vIban = offen.find((v) => v.werkzeug === 'person_aendern').id;
  const erg = db.vorschlagUebernehmen(vBuchung);
  pruefe('Übernehmen bucht', /^Gebucht \(Buchung \d+\)/.test(erg) && db.buchungen(o, '2026-01-01', '2026-12-31').some((b) => b.text === 'Hausmeister Oktober'), erg);
  wirft('Nicht zweimal übernehmen', () => db.vorschlagUebernehmen(vBuchung), /nicht mehr offen/);
  db.vorschlagVerwerfen(vIban);
  pruefe('Verwerfen ändert nichts', db.get('personen', p).iban === 'DE02120300000000202051' && db.vorschlaege('verworfen').length === 1);

  db.setzeEinstellungen({ claude_freigabe: '0' });
  const t4 = await rufe('person_aendern', { id: p, telefon: '030 1234' });
  pruefe('Ohne Freigabe direkt', /aktualisiert/.test(t4) && db.get('personen', p).telefon === '030 1234', t4);
  db.setzeEinstellungen({ claude_freigabe: '1' });
  const claudeEintrag = raw.prepare(`SELECT * FROM protokoll WHERE quelle = 'claude' AND tabelle = 'personen' AND aktion = 'geändert' ORDER BY id DESC LIMIT 1`).get();
  pruefe('Claude-Änderung im Protokoll mit Gerät', claudeEintrag?.geraet === (JSON.parse(fs.readFileSync(path.join(ordner, 'geraet.json'), 'utf8')).id));
  await client.close();

  // ---------- 2. undo ----------
  db.protokollRueckgaengig(claudeEintrag.id);
  pruefe('Claude-Änderung rückgängig', db.get('personen', p).telefon == null);
  const buchungAngelegt = raw.prepare(`SELECT * FROM protokoll WHERE tabelle = 'buchungen' AND aktion = 'angelegt' ORDER BY id DESC LIMIT 1`).get();
  pruefe('Buchung wird storniert statt gelöscht', db.protokollRueckgaengig(buchungAngelegt.id) === 'storniert'
    && !!raw.prepare('SELECT 1 FROM buchungen WHERE storno_von = ?').get(buchungAngelegt.datensatz));
  wirft('Nicht zweimal stornieren', () => db.protokollRueckgaengig(buchungAngelegt.id), /bereits storniert/);

  const kai = db.personen().find((x) => x.nachname === 'Neu').id;
  const kaiAngelegt = raw.prepare(`SELECT id FROM protokoll WHERE tabelle = 'personen' AND datensatz = ? AND aktion = 'angelegt'`).get(kai).id;
  db.save('personen', { id: kai, ort: 'Hamburg' });
  wirft('Anlage nach späterer Änderung nicht zurücknehmen', () => db.protokollRueckgaengig(kaiAngelegt), /danach noch geändert/);
  const kaiGeaendert = raw.prepare(`SELECT id FROM protokoll WHERE tabelle = 'personen' AND datensatz = ? AND aktion = 'geändert' ORDER BY id DESC LIMIT 1`).get(kai).id;
  db.protokollRueckgaengig(kaiGeaendert);
  pruefe('Änderung zurückgenommen', db.get('personen', kai).ort == null);
  db.remove('personen', kai);
  const kaiGeloescht = raw.prepare(`SELECT id FROM protokoll WHERE tabelle = 'personen' AND datensatz = ? AND aktion = 'gelöscht'`).get(kai).id;
  pruefe('Gelöschte Person zurück', db.protokollRueckgaengig(kaiGeloescht) === 'wiederhergestellt' && db.get('personen', kai)?.nachname === 'Neu');

  // A contract undone after its change brings its charges back in line.
  db.setzeEinstellungen({ auto_soll_ab: '2026-01' });
  const v = db.save('mietverhaeltnisse', { einheit_id: e, person_id: p, beginn: '2026-01-01', kaltmiete_ct: 50000 });
  db.save('mietverhaeltnisse', { id: v, kaltmiete_ct: 60000 });
  const soll = () => raw.prepare(`SELECT betrag_ct FROM buchungen WHERE art = 'soll' AND monat = '2026-02' AND soll_id = ?`).all(db.kontoVon('miete', v).id)
    .reduce((s, b) => s + b.betrag_ct, 0);
  const vorher = soll();
  const vGeaendert = raw.prepare(`SELECT id FROM protokoll WHERE tabelle = 'mietverhaeltnisse' AND datensatz = ? AND aktion = 'geändert' ORDER BY id DESC LIMIT 1`).get(v).id;
  db.protokollRueckgaengig(vGeaendert);
  pruefe('Vertrag zurück, Forderungen folgen', db.get('mietverhaeltnisse', v).kaltmiete_ct === 50000 && soll() === vorher - 10000, `${vorher} → ${soll()}`);

  // The text of a booking is in the log now (it used to be left out like the text of a document).
  const b = raw.prepare(`SELECT neu FROM protokoll WHERE tabelle = 'buchungen' AND aktion = 'angelegt' ORDER BY id LIMIT 1`).get();
  pruefe('Buchungstext im Protokoll', 'text' in JSON.parse(b.neu));

  raw.close();

  // ---------- 3. through the Mietshaus server (forwarding with a Claude token) ----------
  {
    const { starten } = require('../server/server.cjs');
    const srv = await starten({ modus: 'server', daten: path.join(ordner, 'server'), port: 0, geraet: { id: 'nas', name: 'NAS' }, mcp: require('../server/mcp-http.cjs').bearbeiten });
    const kopf = { 'Content-Type': 'application/json', 'X-Mietshaus': '1' };
    const r = await fetch(`${srv.url}/api/einrichten`, { method: 'POST', headers: kopf, body: JSON.stringify({ login: 'eva', name: 'Eva', passwort: 'geheim-genug-1' }) });
    const keks = r.headers.get('set-cookie').split(';')[0];
    const ruf = async (fn, ...args) => (await (await fetch(`${srv.url}/api/call`, { method: 'POST', headers: { ...kopf, Cookie: keks }, body: JSON.stringify({ fn, args }) })).json()).wert;
    const so = await ruf('neuesObjekt', { bezeichnung: 'Serverstraße 2', art: 'miete' });
    const token = await ruf('claudeToken');
    pruefe('Claude-Token erzeugt', /^mh_/.test(token ?? ''));
    pruefe('Ohne Token kein /mcp', (await fetch(`${srv.url}/mcp`, { method: 'POST', headers: kopf, body: '{}' })).status === 401);
    pruefe('Token nicht für die übrige API', (await fetch(`${srv.url}/api/call`, { method: 'POST', headers: { ...kopf, Authorization: `Bearer ${token}` }, body: JSON.stringify({ fn: 'objekte', args: ['miete'] }) })).status === 403);
    const c2 = new Client({ name: 'test', version: '1.0.0' });
    await c2.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, '..', 'electron', 'mcp.cjs')],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MIETSHAUS_SERVER: srv.url, MIETSHAUS_TOKEN: token }, stderr: 'pipe' }));
    const werkzeuge = (await c2.listTools()).tools.map((t) => t.name);
    pruefe('Weiterleitung kennt die Werkzeuge', werkzeuge.includes('postfach_liste') && werkzeuge.includes('rechnung_buchen'), werkzeuge.length);
    const liste = JSON.parse((await c2.callTool({ name: 'objekte_liste', arguments: {} })).content[0].text);
    pruefe('Claude liest über den Server', liste.some((x) => x.bezeichnung === 'Serverstraße 2'));
    const t5 = (await c2.callTool({ name: 'person_anlegen', arguments: { vorname: 'Lea', nachname: 'Server' } })).content[0].text;
    pruefe('Claude schreibt über den Server', /^Person angelegt/.test(t5), t5);
    const sraw = srv.raw();
    const eintrag = sraw.prepare(`SELECT quelle, benutzer FROM protokoll WHERE tabelle = 'personen' ORDER BY id DESC LIMIT 1`).get();
    pruefe('… als Claude für Eva protokolliert', eintrag?.quelle === 'claude' && eintrag?.benutzer === 1, JSON.stringify(eintrag));
    const kt2 = Object.fromEntries((await ruf('konten', so)).map((k) => [k.nr, k.id]));
    const t6 = (await c2.callTool({ name: 'buchen', arguments: { objekt_id: so, datum: '2026-10-02', text: 'Test über Server',
      positionen: [{ soll_konto_id: (await ruf('konten', so, 'kosten'))[0].id, haben_konto_id: kt2[1200], betrag_eur: 10 }] } })).content[0].text;
    pruefe('Buchung über den Server wird Vorschlag', /^Vorschlag \d+ angelegt/.test(t6) && (await ruf('vorschlaege', 'offen')).length === 1, t6);
    await c2.close();
    await srv.beenden();
  }

  fs.rmSync(ordner, { recursive: true, force: true });
  console.log(`Claude- und Rückgängig-Test: ${richtig} Prüfungen richtig, ${falsch} falsch.`);
  process.exit(falsch ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
