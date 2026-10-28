// Test of the Mietshaus server over real HTTP: first user and login, two users whose changes carry their names, refused
// requests, live events, upload and analysis of an e-invoice, documents only for logged-in users, backup and restore in
// two steps, and the local mode with its token.
// Run: ELECTRON_RUN_AS_NODE=1 npx electron scripts/servertest.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { starten } = require('../server/server.cjs');

let richtig = 0, falsch = 0;
const pruefe = (name, ok, info = '') => { if (ok) richtig++; else { falsch++; console.log('FALSCH', name, info); } };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

// A small client: keeps its cookie like a browser does.
function client(url) {
  let keks = '';
  const anfrage = async (pfad, { methode = 'GET', json, roh, kopf = {} } = {}) => {
    const r = await fetch(url + pfad, { method: methode, redirect: 'manual',
      headers: { ...(keks ? { Cookie: keks } : {}), ...(methode === 'POST' ? { 'X-Mietshaus': '1' } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}), ...kopf },
      body: json ? JSON.stringify(json) : roh });
    const neu = r.headers.get('set-cookie');
    if (neu) keks = neu.split(';')[0];
    return r;
  };
  return {
    anfrage,
    call: async (fn, ...args) => {
      const r = await anfrage('/api/call', { methode: 'POST', json: { fn, args } });
      const j = await r.json();
      if (!r.ok) throw Object.assign(new Error(j.fehler), { status: r.status });
      return j.wert;
    },
    keks: () => keks,
  };
}

(async () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mietshaus-server-'));
  const s = await starten({ modus: 'server', daten: ordner, port: 0, geraet: { id: 'nas', name: 'NAS' } });
  const anna = client(s.url), ben = client(s.url), fremd = client(s.url);

  // ---------- 1. first user, login, refusals ----------
  pruefe('Einrichtung nötig', (await (await anna.anfrage('/api/status')).json()).einrichtung === true);
  pruefe('Ohne Anmeldung 401', (await fremd.anfrage('/api/call', { methode: 'POST', json: { fn: 'objekte', args: ['miete'] } })).status === 401);
  pruefe('Ohne Kennung 403', (await fetch(`${s.url}/api/call`, { method: 'POST', body: '{}' })).status === 403);
  pruefe('Zu kurzes Passwort abgelehnt', (await anna.anfrage('/api/einrichten', { methode: 'POST', json: { login: 'anna', passwort: 'kurz' } })).status === 400);
  const r1 = await anna.anfrage('/api/einrichten', { methode: 'POST', json: { login: 'anna', name: 'Anna Meier', passwort: 'geheim-genug-1' } });
  pruefe('Erster Benutzer angelegt', r1.ok && /mietshaus=/.test(anna.keks()), r1.status);
  pruefe('Cookie ist HttpOnly und SameSite', /HttpOnly; SameSite=Strict/.test(r1.headers.get('set-cookie') ?? ''));
  pruefe('Keine zweite Einrichtung', (await fremd.anfrage('/api/einrichten', { methode: 'POST', json: { login: 'x', passwort: 'geheim-genug-1' } })).status === 409);
  const benId = await anna.call('benutzerAnlegen', { login: 'ben', name: 'Ben Becker', passwort: 'auch-geheim-22' });
  pruefe('Zweiter Benutzer', benId > 0 && (await anna.call('benutzerListe')).length === 2);
  pruefe('Liste ohne Passwort-Hash', !JSON.stringify(await anna.call('benutzerListe')).includes('scrypt'));
  pruefe('Benutzer nicht über save/get erreichbar', await anna.call('get', 'benutzer', 1).then(() => false, (e) => /Unbekannte Tabelle/.test(e.message)));
  pruefe('Ben meldet sich an', (await ben.anfrage('/api/anmelden', { methode: 'POST', json: { login: 'BEN', passwort: 'auch-geheim-22' } })).ok);
  for (let i = 0; i < 5; i++) await fremd.anfrage('/api/anmelden', { methode: 'POST', json: { login: 'anna', passwort: 'falsch' } });
  pruefe('Nach 5 Fehlversuchen gesperrt', (await fremd.anfrage('/api/anmelden', { methode: 'POST', json: { login: 'anna', passwort: 'geheim-genug-1' } })).status === 429);
  pruefe('Andere Logins nicht gesperrt', (await client(s.url).anfrage('/api/anmelden', { methode: 'POST', json: { login: 'ben', passwort: 'auch-geheim-22' } })).ok);

  // ---------- 2. changes carry the user ----------
  const o = await anna.call('neuesObjekt', { bezeichnung: 'Teststraße 1', art: 'miete', plz: '10115', ort: 'Berlin' });
  await ben.call('save', 'objekte', { id: o, notiz: 'von Ben' });
  const raw = s.raw();
  const zeile = raw.prepare('SELECT geaendert_benutzer, geaendert_von FROM objekte WHERE id = ?').get(o);
  pruefe('Datensatz nennt Ben', zeile.geaendert_benutzer === benId, JSON.stringify(zeile));
  const prot = raw.prepare(`SELECT benutzer, aktion FROM protokoll WHERE tabelle = 'objekte' AND datensatz = ? ORDER BY id`).all(o);
  pruefe('Protokoll: Anna legt an, Ben ändert', prot[0]?.benutzer === 1 && prot.at(-1)?.benutzer === benId && prot.at(-1)?.aktion === 'geändert', JSON.stringify(prot));
  // ---------- 2b. both edit the same record ----------
  const geladen = await anna.call('get', 'objekte', o);
  await ben.call('save', 'objekte', { ...(await ben.call('get', 'objekte', o)), notiz: 'Ben war schneller' });
  const konflikt = await anna.anfrage('/api/call', { methode: 'POST', json: { fn: 'save', args: ['objekte', { ...geladen, notiz: 'Anna alt' }] } });
  const kj = await konflikt.json();
  pruefe('Gleichzeitig geändert: 409 mit Namen', konflikt.status === 409 && kj.konflikt?.wer === 'Ben Becker' && /Ben Becker hat diesen Eintrag/.test(kj.fehler), JSON.stringify(kj));
  pruefe('… nichts überschrieben', (await anna.call('get', 'objekte', o)).notiz === 'Ben war schneller');
  const ueber = await anna.anfrage('/api/call', { methode: 'POST', json: { fn: 'save', args: ['objekte', { ...geladen, notiz: 'Anna bewusst' }] }, kopf: { 'X-Ueberschreiben': '1' } });
  pruefe('Bewusst überschreiben geht', ueber.ok && (await anna.call('get', 'objekte', o)).notiz === 'Anna bewusst');
  const alt = await anna.call('get', 'objekte', o);
  await anna.call('save', 'objekte', { ...alt, notiz: 'Anna 1' });
  pruefe('Eigene spätere Änderung ist kein Konflikt', await anna.call('save', 'objekte', { ...alt, notiz: 'Anna 2' }).then(() => true, () => false));
  pruefe('Teilweise Speicherung ohne Stand prüft nicht', await ben.call('save', 'objekte', { id: o, notiz: 'von Ben' }).then(() => true, () => false));

  pruefe('Unbekannte Funktion abgelehnt', await anna.call('gibtEsNicht').then(() => false, (e) => e.status === 400));

  // ---------- 3. events ----------
  const ereignisse = [];
  const strom = await fetch(`${s.url}/api/ereignisse?client=ben-1`, { headers: { Cookie: ben.keks() } });
  (async () => { const d = new TextDecoder(); for await (const c of strom.body) ereignisse.push(d.decode(c)); })().catch(() => {});
  await warte(100);
  await anna.call('save', 'objekte', { id: o, notiz: 'von Anna' });
  await warte(200);
  pruefe('Ben erfährt von Annas Änderung', ereignisse.join('').includes('event: aktualisiert'), ereignisse.join('|'));

  // ---------- 4. upload, analysis, documents ----------
  const { zugferdPdf } = require('./testdaten/zugferd-pdf.cjs');
  const pdf = zugferdPdf(fs.readFileSync(path.join(__dirname, 'testdaten', 'erechnung-cii.xml'), 'utf8'), ['Sanitaer Krueger GmbH', 'Rechnung RE-2026-0815', 'Gesamt 378,90 EUR']);
  const up = await (await anna.anfrage(`/api/hochladen?name=${encodeURIComponent('Rechnung Krüger.pdf')}&opt=${encodeURIComponent('{}')}`, { methode: 'POST', roh: pdf })).json();
  pruefe('Hochgeladen', up[0]?.id > 0 && up[0].name === 'Rechnung Krüger.pdf', JSON.stringify(up));
  let dok;
  for (let i = 0; i < 60 && (dok = await anna.call('dokument', up[0].id))?.analyse !== 'fertig'; i++) await warte(250);
  pruefe('E-Rechnung gelesen', dok.analyse === 'fertig' && dok.betrag_ct === 37890, `${dok.analyse} ${dok.betrag_ct}`);
  pruefe('Ereignis dokumentAnalysiert', ereignisse.join('').includes('event: dokumentAnalysiert'));
  pruefe('Dokument für Angemeldete', (await anna.anfrage(`/dateien/dokument/${dok.datei}`)).headers.get('content-type') === 'application/pdf');
  pruefe('Dokument nicht für Fremde', (await fremd.anfrage(`/dateien/dokument/${dok.datei}`)).status === 401);
  pruefe('Kein Pfad aus dem Ordner heraus', (await anna.anfrage('/dateien/dokument/..%2F..%2Fmietshaus.sqlite')).status === 404);

  // ---------- 4b. moving files of a Mac ----------
  const name = '0123abcd-0000-4000-8000-000000000001.pdf';
  pruefe('Dokumentdatei übertragen', (await (await anna.anfrage(`/api/dokument-datei?name=${name}`, { methode: 'POST', roh: Buffer.from('%PDF-1') })).json()).gespeichert === true);
  pruefe('… wird nicht überschrieben', (await (await anna.anfrage(`/api/dokument-datei?name=${name}`, { methode: 'POST', roh: Buffer.from('anders') })).json()).vorhanden === true);
  pruefe('… kein fremder Dateiname', (await anna.anfrage('/api/dokument-datei?name=..%2Fmietshaus.sqlite', { methode: 'POST', roh: Buffer.from('x') })).status === 400);

  // ---------- 4c. sending a mail ----------
  // A tiny SMTP server that accepts everything and keeps the message.
  const empfangen = [];
  const smtp = require('node:net').createServer((sock) => {
    let daten = false, puffer = '';
    sock.write('220 test ESMTP\r\n');
    sock.on('data', (c) => {
      puffer += c.toString('utf8');
      if (daten) { if (puffer.includes('\r\n.\r\n')) { empfangen.push(puffer); puffer = ''; daten = false; sock.write('250 OK\r\n'); } return; }
      for (;;) {
        const i = puffer.indexOf('\r\n'); if (i < 0) break;
        const z = puffer.slice(0, i); puffer = puffer.slice(i + 2);
        if (/^(EHLO|HELO)/i.test(z)) sock.write('250-test\r\n250 OK\r\n');
        else if (/^DATA/i.test(z)) { daten = true; sock.write('354 weiter\r\n'); }
        else if (/^QUIT/i.test(z)) { sock.end('221 tschuess\r\n'); }
        else sock.write('250 OK\r\n');
      }
    });
  });
  await new Promise((ok) => smtp.listen(0, '127.0.0.1', ok));
  const kunde = await anna.call('save', 'personen', { vorname: 'Mia', nachname: 'Mieterin', email: 'mia@example.org' });
  await anna.anfrage('/api/smtp/speichern', { methode: 'POST', json: { cfg: { smtp_server: '127.0.0.1', smtp_port: String(smtp.address().port), smtp_ssl: 'kein', smtp_absender: 'Verwaltung <info@example.org>' } } });
  const gesendet = await (await anna.anfrage('/api/mail/senden', { methode: 'POST', json: { an: 'mia@example.org', betreff: 'Ihre Rechnung', text: 'Guten Tag,\nanbei die Rechnung.',
    dokumente: [up[0].id], ablage: { person_id: kunde } } })).json();
  pruefe('E-Mail gesendet', gesendet.gesendet === true && empfangen.length === 1, JSON.stringify(gesendet));
  pruefe('… mit Betreff und Anhang', /Subject: Ihre Rechnung/.test(empfangen[0] ?? '') && /filename\*?[0-9]*\*?=[^\n]*pdf/i.test(empfangen[0] ?? ''), (empfangen[0] ?? '').match(/.*filename.*/gi)?.join(' | '));
  const abgelegt = await anna.call('dokument', gesendet.dokument_id);
  pruefe('… im Archiv bei der Person', abgelegt?.typ === 'E-Mail' && abgelegt.person_id === kunde && /\.eml$/.test(abgelegt.datei), JSON.stringify(abgelegt && { typ: abgelegt.typ, person: abgelegt.person_id, datei: abgelegt.datei }));
  pruefe('Ungültige Adresse abgelehnt', (await anna.anfrage('/api/mail/senden', { methode: 'POST', json: { an: 'kein-mail', betreff: 'x' } })).status === 400);
  smtp.close();

  // ---------- 5. backup and restore ----------
  const sich = Buffer.from(await (await anna.anfrage('/api/sicherung')).arrayBuffer());
  pruefe('Sicherung heruntergeladen', sich.subarray(0, 15).toString() === 'SQLite format 3', sich.length);
  await warte(5);
  await anna.call('save', 'objekte', { id: o, notiz: 'nach der Sicherung' });
  const pr = await (await anna.anfrage('/api/sicherung/pruefen', { methode: 'POST', roh: sich })).json();
  pruefe('Prüfung: älter als der Bestand', pr.aelter === true && !pr.anderer_bestand && !!pr.kennung, JSON.stringify(pr));
  pruefe('Kaputte Sicherung abgelehnt', (await anna.anfrage('/api/sicherung/pruefen', { methode: 'POST', roh: Buffer.from('kein sqlite') })).status === 400);
  const ein = await anna.anfrage('/api/sicherung/einspielen', { methode: 'POST', json: { kennung: pr.kennung } });
  pruefe('Eingespielt', ein.ok && (await anna.call('get', 'objekte', o)).notiz === 'von Anna', await ein.text());
  pruefe('Sitzung bleibt nach Wiederherstellung gültig', (await ben.call('objekte', 'miete')).length === 1);
  pruefe('Server-Sicherungen auflisten', (await (await anna.anfrage('/api/sicherungen')).json()).some((x) => /vor-Wiederherstellung/.test(x.name)));

  // ---------- 5a. assigned cases ----------
  await anna.call('save', 'vorgaenge', { objekt_id: o, titel: 'Heizung prüfen', status: 'offen', prioritaet: 1, zustaendig: benId });
  await anna.call('save', 'vorgaenge', { objekt_id: o, titel: 'Für Anna', status: 'offen', prioritaet: 2, zustaendig: 1 });
  const bensAufgaben = await ben.call('meineAufgaben');
  pruefe('Meine Aufgaben: nur die eigenen', bensAufgaben.length === 1 && bensAufgaben[0].titel === 'Heizung prüfen', JSON.stringify(bensAufgaben));
  pruefe('Liste nennt den Zuständigen', (await anna.call('vorgaengeListe', o, true)).find((v) => v.titel === 'Heizung prüfen')?.zustaendig_name === 'Ben Becker');

  // ---------- 5b. status page ----------
  pruefe('Jetzt sichern', (await anna.anfrage('/api/jetzt-sichern', { methode: 'POST', json: {} })).ok);
  const test = await (await anna.anfrage('/api/sicherungstest', { methode: 'POST', json: {} })).json();
  pruefe('Sicherungstest: wiederherstellbar', test.ok === true && test.zahlen?.objekte === 1, JSON.stringify(test));
  const st = await (await anna.anfrage('/api/systemstatus')).json();
  pruefe('Status: Version, Platz, Sicherung', st.version && st.platz?.frei > 0 && st.sicherung.anzahl >= 1 && st.sicherung.test?.ok, JSON.stringify(st).slice(0, 300));
  pruefe('Status: Geräte mit eigenem markiert', st.sitzungen.length >= 2 && st.sitzungen.filter((x) => x.eigene).length === 1);
  const benSitzung = st.sitzungen.find((x) => !x.eigene && x.name === 'Ben Becker');
  await anna.anfrage('/api/sitzung-beenden', { methode: 'POST', json: { id: benSitzung.id } });
  pruefe('Gerät abgemeldet', await ben.call('objekte', 'miete').then(() => false, (e) => e.status === 401));
  await ben.anfrage('/api/anmelden', { methode: 'POST', json: { login: 'ben', passwort: 'auch-geheim-22' } });

  // ---------- 6. logout, password change ----------
  await ben.anfrage('/api/abmelden', { methode: 'POST' });
  pruefe('Nach Abmelden 401', await ben.call('objekte', 'miete').then(() => false, (e) => e.status === 401));
  await anna.call('benutzerAendern', benId, { aktiv: false });
  pruefe('Deaktivierter Benutzer kann sich nicht anmelden', (await ben.anfrage('/api/anmelden', { methode: 'POST', json: { login: 'ben', passwort: 'auch-geheim-22' } })).status === 401);
  pruefe('Letzter aktiver Benutzer bleibt', await anna.call('benutzerAendern', 1, { aktiv: false }).then(() => false, (e) => /Mindestens ein Benutzer/.test(e.message)));
  await s.beenden();

  // ---------- 7. local mode ----------
  const lokal = await starten({ modus: 'lokal', daten: path.join(ordner, 'lokal'), port: 0, token: 'x'.repeat(43), geraet: { id: 'mac', name: 'mac' } });
  const mac = client(lokal.url);
  pruefe('Lokal: falscher Schlüssel', (await mac.anfrage(`/lokal?token=${'y'.repeat(43)}`)).status === 401);
  const weiter = await mac.anfrage(`/lokal?token=${'x'.repeat(43)}`);
  pruefe('Lokal: Schlüssel wird Cookie', weiter.status === 302 && weiter.headers.get('location') === '/');
  pruefe('Lokal: Aufruf klappt', Array.isArray(await mac.call('objekte', 'miete')));
  pruefe('Lokal: keine Benutzerverwaltung', await mac.call('benutzerListe').then(() => false, (e) => e.status === 400));
  await lokal.beenden();

  fs.rmSync(ordner, { recursive: true, force: true });
  console.log(`Servertest: ${richtig} Prüfungen richtig, ${falsch} falsch.`);
  process.exit(falsch ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
