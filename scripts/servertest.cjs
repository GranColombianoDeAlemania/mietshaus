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
function client(adresse) {
  let url = adresse;
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
    url: (neu) => { url = neu; },
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

  // ---------- 1a. static files: logo and icons are there, a missing file is no page ----------
  {
    const logo = await fremd.anfrage('/logo.svg');
    pruefe('Logo wird ausgeliefert', logo.ok && logo.headers.get('content-type') === 'image/svg+xml' && (await logo.text()).includes('<svg'));
    const sym = await fremd.anfrage('/symbole/postfach.svg');
    pruefe('Symbole werden ausgeliefert', sym.ok && sym.headers.get('content-type') === 'image/svg+xml' && (await sym.text()).includes('<svg'));
    pruefe('Manifest und Service-Worker da', (await fremd.anfrage('/manifest.webmanifest')).ok && (await fremd.anfrage('/sw.js')).ok);
    pruefe('Fehlende Datei 404', (await fremd.anfrage('/gibt-es-nicht.png')).status === 404);
    pruefe('Seitenadresse liefert die App', (await (await fremd.anfrage('/objekte')).text()).includes('<div id="root">'));
  }

  // ---------- 1c. calendar and its subscription ----------
  {
    const heute = new Date().toISOString().slice(0, 10);
    const morgen = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const oid = await anna.call('save', 'objekte', { bezeichnung: 'Kalenderhaus', art: 'miete' });
    await anna.call('save', 'termine', { titel: 'Heizungswartung', datum: morgen, uhrzeit: '9:30', dauer_min: 90, objekt_id: oid, ort: 'Keller' });
    await anna.call('save', 'vorgaenge', { titel: 'Dachrinne reinigen', objekt_id: oid, faellig: morgen, zustaendig: 1 });
    const k = await anna.call('kalender', heute, morgen);
    pruefe('Kalender mit Termin und Vorgang', k.some((x) => x.art === 'termin' && x.titel === 'Heizungswartung') && k.some((x) => x.art === 'vorgang' && x.meins), JSON.stringify(k));
    pruefe('Vorgang nicht bei Ben als seiner', (await ben.call('kalender', heute, morgen)).some((x) => x.art === 'vorgang' && !x.meins));
    pruefe('Ohne Abo-Link kein Kalender', (await fremd.anfrage('/kalender/abcdefghijklmnopqrstuvwxyz012345.ics')).status === 404);
    const { token } = await anna.call('kalenderAbo');
    const r = await fremd.anfrage(`/kalender/${token}.ics`);
    const text = await r.text();
    pruefe('Abo liefert iCalendar', r.ok && r.headers.get('content-type').startsWith('text/calendar') && text.startsWith('BEGIN:VCALENDAR') && text.includes('SUMMARY:Heizungswartung')
      && text.includes(`DTSTART;TZID=Europe/Berlin:${morgen.replaceAll('-', '')}T093000`) && text.includes('T110000') && text.includes('LOCATION:Keller\\, Kalenderhaus'), text.slice(0, 900));
    pruefe('Zeilen mit CRLF und höchstens 75 Bytes', text.split('\r\n').every((z) => Buffer.byteLength(z) <= 75));
    const { token: neu } = await anna.call('kalenderAbo');
    pruefe('Neuer Link sperrt den alten', (await fremd.anfrage(`/kalender/${token}.ics`)).status === 404 && (await fremd.anfrage(`/kalender/${neu}.ics`)).ok);
    const namen = await anna.call('aenderungsNamen');
    const t = (await anna.call('kalender', heute, morgen)).find((x) => x.termin_id);
    const termin = await anna.call('get', 'termine', t.termin_id);
    pruefe('Änderung mit Benutzername', namen.benutzer[termin.geaendert_benutzer] === 'Anna Meier', JSON.stringify([termin.geaendert_benutzer, namen]));
    await anna.call('remove', 'objekte', oid);
  }

  // ---------- 1b. invitations ----------
  {
    const e1 = await anna.call('personEinladen', { login: 'clara', name: 'Clara Neu' });
    pruefe('Einladung erstellt', e1.id > 0 && e1.token.length > 20 && new Date(e1.bis) > new Date());
    pruefe('Eingeladene kann sich noch nicht anmelden', (await fremd.anfrage('/api/anmelden', { methode: 'POST', json: { login: 'clara', passwort: '!' } })).status === 401);
    const info = await (await fremd.anfrage(`/api/einladung?token=${e1.token}`)).json();
    pruefe('Einladung zeigt Name und Benutzername', info.name === 'Clara Neu' && info.login === 'clara' && info.neu === true, JSON.stringify(info));
    const clara = client(s.url);
    const an = await clara.anfrage('/api/einladung', { methode: 'POST', json: { token: e1.token, passwort: 'claras-passwort-1' } });
    pruefe('Passwort festgelegt und angemeldet', an.ok && Array.isArray(await clara.call('objekte', 'miete')));
    pruefe('Einladung nur einmal', (await fremd.anfrage(`/api/einladung?token=${e1.token}`)).status === 404);
    pruefe('Danach normale Anmeldung', (await client(s.url).anfrage('/api/anmelden', { methode: 'POST', json: { login: 'clara', passwort: 'claras-passwort-1' } })).ok);
    const e2 = await anna.call('einladungErneuern', e1.id);
    const e3 = await anna.call('einladungErneuern', e1.id);
    pruefe('Neuer Link ersetzt den alten', (await fremd.anfrage(`/api/einladung?token=${e2.token}`)).status === 404 && (await (await fremd.anfrage(`/api/einladung?token=${e3.token}`)).json()).neu === false);
    pruefe('Zurückgesetzt: alte Sitzung beendet', (await clara.anfrage('/api/einladung', { methode: 'POST', json: { token: e3.token, passwort: 'neues-passwort-22' } })).ok);
    pruefe('Zu kurzes Passwort abgelehnt', (await fremd.anfrage('/api/einladung', { methode: 'POST', json: { token: 'x', passwort: 'kurz' } })).status === 400);
    await anna.call('benutzerAendern', e1.id, { aktiv: false });
  }

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

  // ---------- 4a. photographed receipt: OCR finds the amount ----------
  {
    const foto = await (await anna.anfrage('/api/hochladen?name=beleg.png&opt=%7B%7D', { methode: 'POST', roh: fs.readFileSync(path.join(__dirname, 'testdaten', 'beleg.png')) })).json();
    let d;
    for (let i = 0; i < 240 && (d = await anna.call('dokument', foto[0].id))?.analyse !== 'fertig'; i++) await warte(250);
    pruefe('Beleg-Foto gelesen', d.analyse === 'fertig' && d.betrag_ct === 4890 && d.ocr === 1, `${d.analyse} ${d.betrag_ct} ${d.ocr}`);
  }

  // ---------- 4a''. invoice photo: sender with imprint, VAT, line items, labour share; then into the recycle bin ----------
  {
    const foto = await (await anna.anfrage('/api/hochladen?name=rechnung.png&opt=%7B%7D', { methode: 'POST', roh: fs.readFileSync(path.join(__dirname, 'testdaten', 'rechnung.png')) })).json();
    let d;
    for (let i = 0; i < 240 && (d = await anna.call('dokument', foto[0].id))?.analyse !== 'fertig'; i++) await warte(250);
    pruefe('Rechnung: Absender und Impressum', d.absender === 'Müller Haustechnik GmbH' && d.steller?.ust_id === 'DE123456789' && d.steller?.plz === '80939'
      && /HRB 123456/.test(d.steller?.register ?? ''), JSON.stringify(d.steller));
    pruefe('Rechnung: Betrag und MwSt', d.betrag_ct === 25466 && d.ust_ct === 4066 && d.netto_ct === 21400, `${d.betrag_ct} ${d.netto_ct} ${d.ust_ct}`);
    pruefe('Rechnung: Positionen mit Arbeitszeit', d.positionen?.length === 4 && d.positionen.some((p) => p.art === 'arbeit' && p.betrag_ct === 8700), JSON.stringify(d.positionen));
    pruefe('Rechnung: Arbeits- und Fahrtkosten brutto', d.lohn_ct === 13328, String(d.lohn_ct));
    pruefe('Rechnung: Positionen in der Suche', (await anna.call('suche', 'Dichtungssatz')).dokumente.some((x) => x.id === d.id));
    const datei = path.join(ordner, 'dokumente', d.datei);
    await anna.anfrage('/api/dokument-loeschen', { methode: 'POST', json: { id: d.id } });
    pruefe('Papierkorb: aus dem Postfach, Datei bleibt', !(await anna.call('dokumentListe', { status: 'postfach' })).some((x) => x.id === d.id) && fs.existsSync(datei)
      && (await anna.call('papierkorb')).some((x) => x.id === d.id));
    await anna.call('dokumentWiederherstellen', [d.id]);
    pruefe('Papierkorb: wiederhergestellt', (await anna.call('dokument', d.id)).status === 'postfach');
    await anna.anfrage('/api/dokument-loeschen', { methode: 'POST', json: { id: [d.id] } });
    pruefe('Papierkorb: endgültig gelöscht samt Datei', await anna.call('dokumentEndgueltig', [d.id]) === 1 && !fs.existsSync(datei) && !(await anna.call('dokument', d.id)));
  }

  // ---------- 4a'. meter photo: digits proposed, photo kept with the reading ----------
  {
    const oid = await anna.call('save', 'objekte', { bezeichnung: 'Zählerhaus', art: 'miete' });
    const zid = await anna.call('save', 'zaehler', { objekt_id: oid, art: 'kaltwasser', nummer: '19-445566' });
    await anna.call('ablesung', '2025-12-31', { [zid]: 4790.4 });
    const r = await (await anna.anfrage(`/api/zaehlerfoto?zaehler=${zid}&name=zaehler.png`, { methode: 'POST', roh: fs.readFileSync(path.join(__dirname, 'testdaten', 'zaehler.png')) })).json();
    pruefe('Zählerfoto: Stand vorgeschlagen', r.kandidaten?.[0] === 4821.7 && r.letzter === 4790.4, JSON.stringify(r));
    const d = await anna.call('dokument', r.dokument_id);
    pruefe('Zählerfoto im Archiv beim Objekt', d.objekt_id === oid && d.typ === 'Foto' && d.status === 'abgelegt', JSON.stringify(d).slice(0, 200));
    await anna.call('ablesung', '2026-11-01', { [zid]: 4821.7 }, { [zid]: r.dokument_id });
    pruefe('Foto hängt am Stand', (await anna.call('zaehlerstaende', zid)).find((s) => s.datum === '2026-11-01')?.dokument_id === r.dokument_id);
    pruefe('Fremder Zähler 404', (await anna.anfrage('/api/zaehlerfoto?zaehler=999999&name=x.png', { methode: 'POST', roh: Buffer.from('x') })).status === 404);
    await anna.call('remove', 'objekte', oid);
  }

  // ---------- 4a'''. 0.17: plausibility question (409 → confirmed), the bell, photos filed at once ----------
  {
    const oid = await anna.call('save', 'objekte', { bezeichnung: 'Prüfhaus', art: 'miete', breite: 52.52, laenge: 13.405 });
    const pid = await anna.call('save', 'personen', { nachname: 'Konto', iban: 'DE02120300000000202051' });
    const r = await anna.anfrage('/api/call', { methode: 'POST', json: { fn: 'save', args: ['personen', { id: pid, iban: 'DE89370400440532013000' }] } });
    const j = await r.json();
    pruefe('IBAN-Änderung: 409 mit Rückfrage', r.status === 409 && /Bankverbindung/.test(j.bestaetigen ?? '') && (await anna.call('get', 'personen', pid)).iban === 'DE02120300000000202051', JSON.stringify(j));
    const r2 = await anna.anfrage('/api/call', { methode: 'POST', json: { fn: 'save', args: ['personen', { id: pid, iban: 'DE89370400440532013000' }] }, kopf: { 'X-Bestaetigt': '1' } });
    pruefe('Bestätigt: gespeichert', r2.ok && (await anna.call('get', 'personen', pid)).iban === 'DE89370400440532013000');
    const vorher = await anna.call('mitteilungenUngelesen');
    pruefe('Glocke: Mitteilungen anlegen nur der Server', await anna.call('mitteilungAnlegen', { art: 'server', titel: 'x' }).then(() => false, (e) => e.status === 403));
    pruefe('Glocke: eigener Zähler', typeof vorher === 'number' && Array.isArray(await anna.call('mitteilungen')));
    const bild = fs.readFileSync(path.join(__dirname, 'testdaten', 'zaehler.png'));
    const f1 = await (await anna.anfrage(`/api/hochladen?name=keller.png&opt=${encodeURIComponent(JSON.stringify({ objekt_id: oid }))}`, { methode: 'POST', roh: bild })).json();
    const d1 = await anna.call('dokument', f1[0].id);
    pruefe('Foto beim Objekt: sofort abgelegt', d1.status === 'abgelegt' && d1.typ === 'Foto' && d1.objekt_id === oid, JSON.stringify(d1).slice(0, 160));
    const f2 = await (await anna.anfrage(`/api/hochladen?name=hof.png&opt=${encodeURIComponent(JSON.stringify({ standort: { lat: 52.5201, lon: 13.4049 } }))}`, { methode: 'POST', roh: Buffer.concat([bild, Buffer.from('2')]) })).json();
    pruefe('Foto mit Standort: beim nahen Objekt abgelegt', f2[0].objekt === 'Prüfhaus' && (await anna.call('dokument', f2[0].id)).status === 'abgelegt', JSON.stringify(f2));
    const f3 = await (await anna.anfrage(`/api/hochladen?name=weit.png&opt=${encodeURIComponent(JSON.stringify({ standort: { lat: 48.1, lon: 11.5 } }))}`, { methode: 'POST', roh: Buffer.concat([bild, Buffer.from('3')]) })).json();
    pruefe('Foto weit weg: Postfach', !f3[0].objekt && (await anna.call('dokument', f3[0].id)).status === 'postfach');
    for (const f of [f1, f2, f3]) await anna.anfrage('/api/dokument-loeschen', { methode: 'POST', json: { id: f[0].id } });
    await anna.call('dokumentEndgueltig', [f1[0].id, f2[0].id, f3[0].id]);
    await anna.call('remove', 'objekte', oid);
    await anna.call('remove', 'personen', pid);
  }

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

  // ---------- 5a2. notifications (Web Push to a stand-in push service over HTTPS) ----------
  {
    const crypto = require('node:crypto');
    const { execFileSync } = require('node:child_process');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mh-push-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tmp, 'k.pem'), '-out', path.join(tmp, 'c.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    const pushes = [];
    const dienst = require('node:https').createServer({ key: fs.readFileSync(path.join(tmp, 'k.pem')), cert: fs.readFileSync(path.join(tmp, 'c.pem')) }, (req, res) => {
      const t = []; req.on('data', (c) => t.push(c)); req.on('end', () => { pushes.push({ pfad: req.url, kodierung: req.headers['content-encoding'], vapid: /^vapid /.test(req.headers.authorization ?? '') }); res.writeHead(201); res.end(); });
    });
    await new Promise((ok) => dienst.listen(0, '127.0.0.1', ok));
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    const abo = (name) => ({ endpoint: `https://127.0.0.1:${dienst.address().port}/push/${name}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } });
    pruefe('VAPID-Schlüssel', (await (await ben.anfrage('/api/push/schluessel')).json()).schluessel?.length > 80);
    await ben.anfrage('/api/push/abo', { methode: 'POST', json: { abo: abo('ben'), arten: ['aufgaben'] } });
    await anna.anfrage('/api/push/abo', { methode: 'POST', json: { abo: abo('anna'), arten: ['postfach'] } });
    await anna.call('save', 'vorgaenge', { objekt_id: o, titel: 'Dachrinne reinigen', status: 'offen', prioritaet: 2, zustaendig: benId });
    await warte(400);
    pruefe('Zuweisung: Push an Ben', pushes.some((x) => x.pfad === '/push/ben' && x.kodierung === 'aes128gcm' && x.vapid), JSON.stringify(pushes));
    pruefe('… nicht an Anna', !pushes.some((x) => x.pfad === '/push/anna'));
    pruefe('… und als Ereignis für offene Fenster', ereignisse.join('').includes('event: benachrichtigung'));
    const vorher = pushes.length;
    pruefe('Test-Push', (await (await anna.anfrage('/api/push/test', { methode: 'POST', json: {} })).json()).gesendet === 1 && pushes.length === vorher + 1);
    await anna.anfrage('/api/push/abmelden', { methode: 'POST', json: { endpoint: abo('anna').endpoint } });
    pruefe('Abgemeldet: kein Push mehr', (await (await anna.anfrage('/api/push/test', { methode: 'POST', json: {} })).json()).gesendet === 0);
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    dienst.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ---------- 5a3. passkeys (software authenticator) ----------
  {
    const { authenticator } = require('./authenticator.cjs');
    const geraet = authenticator();
    const optReg = await (await anna.anfrage('/api/passkey/registrieren/optionen', { methode: 'POST', json: {} })).json();
    pruefe('Passkey: Optionen', optReg.rp?.id === '127.0.0.1' && optReg.authenticatorSelection?.residentKey === 'required', JSON.stringify(optReg.rp));
    const reg = await anna.anfrage('/api/passkey/registrieren', { methode: 'POST', json: { antwort: geraet.registrieren(optReg, s.url), name: 'Testgerät' } });
    pruefe('Passkey registriert', reg.ok && (await anna.call('passkeyListe')).length === 1, await reg.text());
    const fremdGeraet = client(s.url);
    const optAnm = await (await fremdGeraet.anfrage('/api/passkey/anmelden/optionen', { methode: 'POST', json: {} })).json();
    const anm = await fremdGeraet.anfrage('/api/passkey/anmelden', { methode: 'POST', json: { vorgang: optAnm.vorgang, antwort: geraet.anmelden(optAnm.optionen, s.url) } });
    pruefe('Mit Passkey angemeldet', anm.ok && (await anm.json()).benutzer?.login === 'anna' && Array.isArray(await fremdGeraet.call('objekte', 'miete')));
    const optAlt = await (await fremd.anfrage('/api/passkey/anmelden/optionen', { methode: 'POST', json: {} })).json();
    const falsch = geraet.anmelden({ ...optAlt.optionen, challenge: 'ZmFsc2NoZXMtcmFldHNlbA' }, s.url);
    pruefe('Falsche Challenge abgelehnt', (await fremd.anfrage('/api/passkey/anmelden', { methode: 'POST', json: { vorgang: optAlt.vorgang, antwort: falsch } })).status === 401);
    pruefe('Vorgang nur einmal', (await fremd.anfrage('/api/passkey/anmelden', { methode: 'POST', json: { vorgang: optAnm.vorgang, antwort: geraet.anmelden(optAnm.optionen, s.url) } })).status === 401);
    await anna.call('passkeyLoeschen', (await anna.call('passkeyListe'))[0].id);
    const opt3 = await (await fremd.anfrage('/api/passkey/anmelden/optionen', { methode: 'POST', json: {} })).json();
    pruefe('Entfernter Passkey gilt nicht mehr', (await fremd.anfrage('/api/passkey/anmelden', { methode: 'POST', json: { vorgang: opt3.vorgang, antwort: geraet.anmelden(opt3.optionen, s.url) } })).status === 401);
  }

  // ---------- 5'. answers kept for reading without a connection ----------
  {
    const lesend = await anna.anfrage('/api/call', { methode: 'POST', json: { fn: 'objekte', args: ['miete'] } });
    const schreibend = await anna.anfrage('/api/call', { methode: 'POST', json: { fn: 'save', args: ['objekte', { id: o, notiz: 'offline-test' }] } });
    pruefe('Lesender Aufruf als lesend markiert', lesend.headers.get('x-lesend') === '1' && schreibend.ok && schreibend.headers.get('x-lesend') === null);
    // Reading sends no "aktualisiert" to the other windows (they would reload each other without end).
    await warte(300);
    const vorherZahl = ereignisse.join('').split('event: aktualisiert').length;
    await anna.call('objekte', 'miete');
    await warte(200);
    pruefe('Lesen löst kein Aktualisieren aus', ereignisse.join('').split('event: aktualisiert').length === vorherZahl);
  }

  // ---------- 5''. a change sent twice with the same key is done once ----------
  {
    const senden = (schluessel, nutzer = anna) => nutzer.anfrage('/api/call', { methode: 'POST', kopf: { 'X-Vorgang': schluessel },
      json: { fn: 'save', args: ['termine', { titel: 'Doppelt?', datum: '2026-12-01', objekt_id: o }] } });
    const zaehlen = async () => (await anna.call('liste', 'termine')).filter((x) => x.titel === 'Doppelt?').length;
    const [a, b] = await Promise.all([senden('schluessel-eins-123'), senden('schluessel-eins-123')]);
    const c = await senden('schluessel-eins-123');
    const ids = [(await a.json()).wert, (await b.json()).wert, (await c.json()).wert];
    pruefe('Gleicher Schlüssel: einmal angelegt', await zaehlen() === 1 && ids.every((x) => x === ids[0]), JSON.stringify(ids));
    pruefe('Gleicher Schlüssel: Wiederholung markiert', c.headers.get('x-wiederholt') === '1');
    await senden('schluessel-zwei-456');
    pruefe('Neuer Schlüssel: neu angelegt', await zaehlen() === 2);
    // Keys belong to the user: another user's key never returns this answer.
    const vonBen = await senden('schluessel-eins-123', ben);
    pruefe('Schlüssel je Benutzer', vonBen.headers.get('x-wiederholt') === null && await zaehlen() === 3);
    const r1 = await anna.anfrage('/api/call', { methode: 'POST', kopf: { 'X-Vorgang': 'lesen-schluessel-1' }, json: { fn: 'objekte', args: ['miete'] } });
    const r2 = await anna.anfrage('/api/call', { methode: 'POST', kopf: { 'X-Vorgang': 'lesen-schluessel-1' }, json: { fn: 'objekte', args: ['miete'] } });
    pruefe('Lesen wird nicht aufbewahrt', r1.ok && r2.headers.get('x-wiederholt') === null);
  }

  // ---------- one user on two devices: a stale change from the other device is a conflict ----------
  {
    const auf = (geraet, row) => anna.anfrage('/api/call', { methode: 'POST', kopf: { 'X-Geraet': geraet }, json: { fn: 'save', args: ['objekte', row] } });
    await auf('geraet-mac', { id: o, notiz: 'vom Mac' });
    const alt = await anna.call('get', 'objekte', o);
    await warte(5);
    await auf('geraet-mac', { id: o, notiz: 'noch einmal vom Mac', geaendert_am: alt.geaendert_am });
    const vomHandy = await auf('geraet-handy', { id: o, notiz: 'vom Handy (alter Stand)', geaendert_am: alt.geaendert_am });
    pruefe('Zwei Geräte: alter Stand vom anderen Gerät ist ein Konflikt', vomHandy.status === 409 && /anderen Gerät|Du hast/.test((await vomHandy.json()).fehler));
    const gleich = await auf('geraet-mac', { id: o, notiz: 'Mac überschreibt sich selbst', geaendert_am: alt.geaendert_am });
    pruefe('Zwei Geräte: dasselbe Gerät überschreibt sich ohne Rückfrage', gleich.ok);
  }

  // ---------- 5''''. a broken photo does not stop the server ----------
  {
    const kaputt = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 255, 217]);
    const r = await anna.anfrage('/api/hochladen?name=kaputt.jpg&opt=%7B%7D', { methode: 'POST', roh: kaputt });
    const [d] = await r.json();
    let analyse = null;
    const fertig = (a) => a === 'fertig' || /^fehler/.test(a ?? '');
    for (let i = 0; i < 40 && !fertig(analyse); i++) { await warte(250); analyse = (await anna.call('dokument', d.id)).analyse; }
    pruefe('Kaputtes Foto: Server läuft weiter, Dokument als fehlerhaft markiert', Array.isArray(await anna.call('objekte', 'miete')) && fertig(analyse), analyse);
  }

  // ---------- 5'''. duties, inventory and workflows over the server ----------
  {
    const heute = new Date().toISOString().slice(0, 10);
    const [pid] = await anna.call('pflichtenAnlegen', o, [{ art: 'rauchmelder', naechste: heute }]);
    await anna.call('automatikLauf');
    await anna.call('automatikLauf');
    const offen = (await anna.call('aufgabenListe', {})).filter((v) => v.pflicht_id === pid && v.status !== 'erledigt');
    pruefe('Pflicht: ein Vorgang, auch nach zwei Automatik-Läufen', offen.length === 1);
    const up = await anna.anfrage(`/api/hochladen?name=rauchmelder.txt&opt=${encodeURIComponent(JSON.stringify({ objekt_id: o, status: 'abgelegt', typ: 'Protokoll' }))}`, { methode: 'POST', roh: Buffer.from('Protokoll Rauchmelder') });
    const dok = up.ok ? (await up.json())?.[0] : null;
    const r = await anna.call('pflichtErledigen', pid, { datum: heute, dokument_id: dok?.id ?? null });
    const verlauf = await anna.call('pflichtVerlauf', pid);
    pruefe('Pflicht erledigt: nächster Termin, Vorgang zu, Nachweis im Verlauf', r.naechste > heute && verlauf.length === 1 && (!dok || verlauf[0].dokument_id === dok.id)
      && (await anna.call('aufgabenListe', {})).find((v) => v.id === offen[0].id).status === 'erledigt', JSON.stringify({ r, verlauf, up: up.status }));
    const mw = (await anna.call('ablaeufe')).find((x) => x.art === 'schaden');
    const haupt = await anna.call('ablaufStarten', mw.id, { objekt_id: o, stichtag: heute });
    pruefe('Ablauf über den Server: Schritte als Unteraufgaben', (await anna.call('ablaufSchritte', haupt)).length === mw.schritte.length);
    await anna.call('save', 'inventar', { objekt_id: o, bezeichnung: 'Heizungspumpe', kaufdatum: heute, preis_ct: 45000 });
    pruefe('Inventar über den Server', (await anna.call('inventar', o)).some((x) => x.bezeichnung === 'Heizungspumpe' && x.gwg));
  }

  // ---------- 5a. warnings about the server ----------
  {
    const w1 = await s.serverWarnungen({ frei: 1.5 * 1024 ** 3, gesamt: 1000 * 1024 ** 3 });
    pruefe('Warnung bei wenig Speicher', w1.some((w) => w.art === 'platz' && /1,5 GB/.test(w.text)), JSON.stringify(w1));
    pruefe('Nur einmal am Tag', !(await s.serverWarnungen({ frei: 1, gesamt: 100 })).some((w) => w.art === 'platz'));
    pruefe('Genug Platz: keine Warnung', !(await s.serverWarnungen({ frei: 500 * 1024 ** 3, gesamt: 1000 * 1024 ** 3 })).length);
    s.dbSystem.setzeEinstellungen({ letzte_version: '0.0.1', server_warnungen: '{}' });
    pruefe('Neue Version gemeldet', (await s.serverWarnungen({ frei: 500 * 1024 ** 3, gesamt: 1000 * 1024 ** 3 })).some((w) => w.art === 'version' && w.text.includes('0.0.1')));
  }

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

  // The key of a change outlives a restart of the server: a device that worked offline may send its changes days later.
  {
    const s2 = await starten({ modus: 'server', daten: ordner, port: 0, geraet: { id: 'nas', name: 'NAS' } });
    anna.url(s2.url);
    const nach = await anna.anfrage('/api/call', { methode: 'POST', kopf: { 'X-Vorgang': 'schluessel-eins-123' },
      json: { fn: 'save', args: ['termine', { titel: 'Doppelt?', datum: '2026-12-01', objekt_id: o }] } });
    pruefe('Nach dem Neustart: gleicher Schlüssel legt nichts doppelt an', nach.ok && nach.headers.get('x-wiederholt') === '1'
      && (await anna.call('liste', 'termine')).filter((x) => x.titel === 'Doppelt?').length === 3, nach.status);
    await s2.beenden();
  }

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
