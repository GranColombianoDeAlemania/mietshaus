// Mietshaus server: the one place that holds the database and the documents. It serves the user interface to browsers
// and to the Mac app, answers its calls over HTTP and runs the background work (monthly charges, daily backup, inbox
// folder, mail, document analysis). Runs in a container on the NAS (modus 'server', users log in) or embedded in the Mac
// app on 127.0.0.1 (modus 'lokal', a random token instead of a login). Only node:http, no framework.
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { open, api, datenStand, sicherungsOrdner, kontextSetzen } = require('../electron/db.cjs');
const analyse = require('../electron/analyse.cjs');
const eingang = require('../electron/eingang.cjs');
const sicherung = require('../electron/sicherung.cjs');
const { zip } = require('../electron/zip.cjs');
const ortszeit = require('../electron/zeit.cjs');
const authModul = require('./auth.cjs');
const geheim = require('./geheim.cjs');

const { VERSION, DESKTOP_SCHNITTSTELLE, vergleichen, neuesteVersion } = require('../electron/version.cjs');
const TYPEN = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.xml': 'application/xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.tif': 'image/tiff', '.tiff': 'image/tiff' };
const SICHERHEIT = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN', 'Cross-Origin-Opener-Policy': 'same-origin' };
const MAX_UPLOAD = 300 * 1024 * 1024;
// Functions answered by the server itself, not by the database API.
const NUR_SERVER = new Set(['benutzerListe', 'benutzerAnlegen', 'benutzerAendern', 'claudeToken']);

class Fehler extends Error { constructor(status, text) { super(text); this.status = status; } }

/**
 * @param {object} o
 * @param {'server'|'lokal'} o.modus
 * @param {string} o.daten        folder for database, documents, backups, key file
 * @param {string} [o.dbFile]     database file (default <daten>/mietshaus.sqlite)
 * @param {string} [o.dist]       built user interface (default ../dist)
 * @param {number} [o.port]       0 = any free port
 * @param {string} [o.host]
 * @param {string} [o.token]      lokal: the token the Mac app uses instead of a login
 * @param {{id:string,name:string}} o.geraet
 * @param {string} [o.tessdata]   OCR language files
 * @param {string} [o.eingang]    server: fixed inbox folder (e.g. /eingang in the container)
 * @param {{lesen:Function,setzen:Function,verschluesselt:boolean}} [o.passwort] mail password store (default: key file)
 * @param {Function} [o.mcp]      (req, res, db, { dokumente, aktualisiert }) handler for /mcp (server/mcp-http.cjs)
 */
async function starten(o) {
  const daten = path.resolve(o.daten);
  fs.mkdirSync(daten, { recursive: true });
  const dbFile = o.dbFile ?? path.join(daten, 'mietshaus.sqlite');
  const dist = o.dist ?? path.join(__dirname, '..', 'dist');
  const dokumentOrdner = () => path.join(daten, 'dokumente');
  const vorschauOrdner = () => path.join(dokumentOrdner(), 'vorschau');
  const SYSTEM = { quelle: 'app', geraet: o.geraet?.id ?? null, benutzer: null };

  let raw = null, roh = null;
  // Tests hand over a prepared database (o.verbindung = { raw, api }); restoring a backup then is not possible.
  const oeffneDb = () => {
    if (o.verbindung) ({ raw, api: roh } = o.verbindung);
    else { raw = open(dbFile, 'app', o.geraet); roh = api(raw); }
  };
  oeffneDb();
  // Background work goes through this proxy: it marks its changes as the server's own (no user).
  const dbSystem = new Proxy({}, { get: (_t, k) => { kontextSetzen(raw, SYSTEM); return roh[k]; } });
  const auth = authModul(() => raw);
  const passwort = o.passwort ?? geheim(daten, () => dbSystem);

  // ---------- events (Server-Sent Events) ----------
  const hoerer = new Set();
  const senden = (kanal, wert, ausser = null) => {
    const zeile = `event: ${kanal}\ndata: ${JSON.stringify(wert ?? null)}\n\n`;
    for (const h of hoerer) if (h.id !== ausser) h.res.write(zeile);
  };
  // Sign of life every 15 seconds with what the traffic light in the app shows: documents still being read, the
  // newest change and who made it.
  const puls = () => {
    const letzte = raw.prepare(`SELECT p.zeit, p.quelle, b.name FROM protokoll p LEFT JOIN benutzer b ON b.id = p.benutzer ORDER BY p.id DESC LIMIT 1`).get();
    return { zeit: new Date().toISOString(), version: VERSION, analyse: roh.zuAnalysieren().length,
      letzte: letzte ? { zeit: letzte.zeit, wer: letzte.quelle === 'claude' ? `Claude${letzte.name ? ` für ${letzte.name}` : ''}` : letzte.name } : null };
  };
  const pulsSenden = () => { if (hoerer.size) senden('puls', puls()); };
  setInterval(pulsSenden, 15_000).unref();
  // Changes written by another process (Claude's MCP server in local mode) reach every window.
  let version = null;
  setInterval(() => {
    const v = raw.prepare('PRAGMA data_version').get().data_version;
    if (version != null && v !== version) senden('aktualisiert');
    version = v;
  }, 2000).unref();
  const aenderungen = () => raw.prepare('SELECT total_changes() AS n').get().n;

  // ---------- background work ----------
  const ana = analyse({ db: dbSystem, dokumentOrdner, vorschauOrdner, tessdata: o.tessdata, cacheOrdner: path.join(daten, 'ocr-cache'),
    onFertig: (id) => { senden('dokumentAnalysiert', id); pulsSenden(); } });
  ana.warteschlange();
  const ein = eingang({
    db: dbSystem,
    importieren: (pfade, opt) => { const r = ana.importieren(pfade, opt); senden('aktualisiert'); return r; },
    melden: (text) => senden('meldung', text),
    passwort,
  });
  const eingangsordner = () => o.eingang ?? dbSystem.einstellungen().eingangsordner ?? null;
  ein.ordnerSetzen(eingangsordner());
  ein.mailPlanen();
  if (dbSystem.einstellungen().mail_aktiv === '1') setTimeout(() => ein.mailAbrufen().catch(() => {}), 20_000).unref();
  const automatik = () => { try { if (dbSystem.automatikLauf().erzeugt) senden('aktualisiert'); } catch (e) { console.error('Automatik', e); } };
  const autoSicherung = () => {
    try {
      if (dbSystem.einstellungen().auto_sicherung === '0') return;
      if (sicherung.automatisch(raw, sicherungsOrdner(dbFile), o.geraet)) dbSystem.setzeEinstellungen({ letzte_auto_sicherung: new Date().toISOString() });
    } catch (e) {
      console.error('Automatische Sicherung', e);
      senden('meldung', `Automatische Sicherung fehlgeschlagen: ${e?.message ?? e}`);
    }
  };
  // Is there a newer release? Asked once a day (server mode; the Mac app asks for itself). MIETSHAUS_UPDATE_PRUEFEN=0 stops it.
  let neueste = null;
  const updatePruefen = async () => {
    if (o.modus !== 'server' || process.env.MIETSHAUS_UPDATE_PRUEFEN === '0') return;
    const n = await neuesteVersion();
    if (n) neueste = vergleichen(n.version, VERSION) > 0 ? n : null;
  };
  automatik();
  const t1 = setTimeout(() => { autoSicherung(); updatePruefen(); }, 60_000);
  const t2 = setInterval(() => { automatik(); autoSicherung(); }, 3600_000);
  const t3 = setInterval(updatePruefen, 24 * 3600_000);

  // ---------- helpers ----------
  const json = (res, status, wert, kopf = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SICHERHEIT, ...kopf });
    res.end(JSON.stringify(wert ?? null));
  };
  const lesen = (req, max = MAX_UPLOAD) => new Promise((ok, nein) => {
    const teile = [];
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > max) { nein(new Fehler(413, 'Die Datei ist zu groß.')); req.destroy(); } else teile.push(c); });
    req.on('end', () => ok(Buffer.concat(teile)));
    req.on('error', nein);
  });
  const jsonLesen = async (req) => { const b = await lesen(req, 20 * 1024 * 1024); return b.length ? JSON.parse(b.toString('utf8')) : {}; };
  const cookies = (req) => Object.fromEntries((req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
  const sicher = (req) => req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
  const cookie = (req, name, wert, tage) => `${name}=${encodeURIComponent(wert)}; Path=/; HttpOnly; SameSite=Strict${sicher(req) ? '; Secure' : ''}; Max-Age=${tage * 86400}`;
  const ip = (req) => req.socket.remoteAddress ?? '?';
  const tokenGleich = (a, b) => !!a && !!b && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

  // Who is asking: { benutzer } for a session, { lokal: true } for the Mac app's token, { claude } for a Claude token.
  function wer(req) {
    const c = cookies(req);
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (o.modus === 'lokal' && (tokenGleich(c.mietshaus_lokal, o.token) || tokenGleich(bearer, o.token))) return { lokal: true, benutzer: null };
    if (o.modus === 'server') {
      const b = auth.sitzung(c.mietshaus);
      if (b) return { benutzer: b, token: c.mietshaus };
      const cb = bearer?.startsWith('mh_') ? auth.claudeBenutzer(bearer) : null;
      if (cb) return { benutzer: cb, claude: true };
    }
    return null;
  }
  const kontext = (req, w, quelle = 'app') => kontextSetzen(raw, { quelle: w.claude ? 'claude' : quelle, geraet: String(req.headers['x-geraet'] ?? '').slice(0, 80) || o.geraet?.id || null, benutzer: w.benutzer?.id ?? null });

  function statisch(req, res, pfad) {
    let datei = path.join(dist, path.normalize(decodeURIComponent(pfad)).replace(/^(\.\.[/\\])+/, ''));
    if (!datei.startsWith(dist) || !fs.existsSync(datei) || fs.statSync(datei).isDirectory()) datei = path.join(dist, 'index.html');
    if (!fs.existsSync(datei)) return json(res, 503, { fehler: 'Die Oberfläche ist nicht gebaut (npm run build).' });
    const ext = path.extname(datei).toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPEN[ext] ?? 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable', ...SICHERHEIT });
    fs.createReadStream(datei).pipe(res);
  }

  function datei(res, ordner, name, herunterladen = null) {
    const p = path.join(ordner, path.basename(name));
    if (!fs.existsSync(p)) return json(res, 404, { fehler: 'Datei nicht gefunden.' });
    const kopf = { 'Content-Type': TYPEN[path.extname(p).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': fs.statSync(p).size, 'Cache-Control': 'private, max-age=3600', ...SICHERHEIT };
    if (herunterladen) kopf['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(herunterladen)}`;
    res.writeHead(200, kopf);
    fs.createReadStream(p).pipe(res);
  }

  // Uploaded bytes into a temporary file that keeps the original name (the archive shows it).
  const temporaer = (name, inhalt) => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mietshaus-up-'));
    const p = path.join(ordner, path.basename(String(name || 'Datei')).replace(/[/\\:*?"<>|]/g, '_'));
    fs.writeFileSync(p, inhalt);
    return { p, weg: () => fs.rmSync(ordner, { recursive: true, force: true }) };
  };

  // Backups uploaded for restoring wait here until the user decides (two steps: pruefen, einspielen).
  const wartend = new Map();
  const standText = (s) => ({ zeit: s.zeit, geraet: s.geraet_name ?? null });
  function sicherungPruefen(dateiPfad) {
    const gewaehlt = sicherung.pruefen(dateiPfad);
    const jetzt = datenStand(raw);
    const gleich = (s) => !s.datenbank_id || !jetzt.datenbank_id || s.datenbank_id === jetzt.datenbank_id;
    const neueste = sicherung.liste([sicherungsOrdner(dbFile), path.dirname(dateiPfad)], { ohne: [dbFile, dateiPfad] }).filter(gleich)[0];
    const kennung = crypto.randomUUID();
    wartend.set(kennung, dateiPfad);
    const neuere = neueste && neueste.zeit > gewaehlt.zeit ? neueste : null;
    if (neuere) wartend.set(`${kennung}:neueste`, neuere.datei);
    return { kennung, gewaehlt: { name: path.basename(dateiPfad), ...standText(gewaehlt) }, jetzt: standText(jetzt), anderer_bestand: !gleich(gewaehlt),
      aelter: !!(jetzt.zeit && gewaehlt.zeit < jetzt.zeit), neuere: neuere ? { name: path.basename(neuere.datei), ...standText(neuere) } : null };
  }

  // Errors of the business logic (e.g. "Diese Person ist noch … zugeordnet") are answers for the user, not server faults.
  // Network errors (e.g. mail server not reachable) come as AggregateError without a message of their own.
  const alsFehler = (e) => (e instanceof Fehler ? e : new Fehler(400, e?.message || e?.errors?.[0]?.message || e?.code || String(e)));
  const fachlich = (fn) => {
    try {
      const r = fn();
      return r instanceof Promise ? r.catch((e) => { throw alsFehler(e); }) : r;
    } catch (e) { throw alsFehler(e); }
  };

  // ---------- routes ----------
  async function bearbeiten(req, res) {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const post = req.method === 'POST';
    // Calls that change something must carry this header: a foreign web page cannot send it without CORS, which is off.
    if (post && req.headers['x-mietshaus'] !== '1') throw new Fehler(403, 'Anfrage ohne Kennung abgelehnt.');

    if (p === '/api/status') {
      const w = wer(req);
      return json(res, 200, { modus: o.modus, version: VERSION, desktop_schnittstelle: DESKTOP_SCHNITTSTELLE, angemeldet: !!w, benutzer: w?.benutzer ?? null,
        einrichtung: o.modus === 'server' && auth.anzahl() === 0 });
    }
    if (o.modus === 'lokal' && p === '/lokal') {
      // The Mac app opens /lokal?token=…: the token becomes a cookie and is gone from the address.
      if (!tokenGleich(u.searchParams.get('token') ?? '', o.token)) throw new Fehler(401, 'Falscher Schlüssel.');
      res.writeHead(302, { Location: '/', 'Set-Cookie': cookie(req, 'mietshaus_lokal', o.token, 3650), ...SICHERHEIT });
      return res.end();
    }
    if (o.modus === 'server' && post && p === '/api/einrichten') {
      if (auth.anzahl() > 0) throw new Fehler(409, 'Es gibt schon einen Benutzer.');
      const { login, name, passwort: pw } = await jsonLesen(req);
      const id = fachlich(() => auth.anlegen({ login, name, passwort: pw }));
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, 'mietshaus', auth.sitzungAnlegen(id, req.headers['user-agent']), 30) });
    }
    if (o.modus === 'server' && post && p === '/api/anmelden') {
      const { login, passwort: pw } = await jsonLesen(req);
      // Wrong passwords slow down this login from this address only.
      const schluessel = `${ip(req)}|${String(login ?? '').toLowerCase()}`;
      const warten = auth.bremse.gesperrt(schluessel);
      if (warten) throw new Fehler(429, `Zu viele Versuche. Bitte in ${warten} Sekunden noch einmal.`);
      const b = auth.anmelden(login, pw);
      if (!b) { auth.bremse.fehler(schluessel); throw new Fehler(401, 'Login oder Passwort falsch.'); }
      auth.bremse.erfolg(schluessel);
      return json(res, 200, { benutzer: b }, { 'Set-Cookie': cookie(req, 'mietshaus', auth.sitzungAnlegen(b.id, req.headers['user-agent']), 30) });
    }
    if (!p.startsWith('/api/') && !p.startsWith('/dateien/') && p !== '/mcp') return statisch(req, res, p);

    const w = wer(req);
    if (!w) throw new Fehler(401, 'Bitte anmelden.');
    if (p === '/mcp') {
      if (!o.mcp) throw new Fehler(404, 'Claude ist auf diesem Server nicht eingerichtet.');
      // Claude's tools run asynchronously: every access to the database marks the change as Claude's, for this user.
      const k = { quelle: 'claude', geraet: o.geraet?.id ?? null, benutzer: w.benutzer?.id ?? null };
      const dbClaude = new Proxy({}, { get: (_t, n) => { kontextSetzen(raw, k); return roh[n]; } });
      return o.mcp(req, res, dbClaude, { dokumente: dokumentOrdner(), aktualisiert: () => senden('aktualisiert') });
    }
    if (w.claude) throw new Fehler(403, 'Ein Claude-Schlüssel gilt nur für /mcp.');

    if (post && p === '/api/abmelden') {
      if (w.token) auth.sitzungBeenden(w.token);
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, 'mietshaus', '', 0) });
    }
    if (p === '/api/ereignisse') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...SICHERHEIT });
      res.write(`event: puls\ndata: ${JSON.stringify(puls())}\n\n`);
      const h = { res, id: u.searchParams.get('client') };
      hoerer.add(h);
      req.on('close', () => hoerer.delete(h));
      return;
    }
    if (post && p === '/api/call') {
      const { fn, args = [] } = await jsonLesen(req);
      if (NUR_SERVER.has(fn)) return json(res, 200, { wert: fachlich(() => serverFunktion(fn, args, w)) });
      if (typeof fn !== 'string' || typeof roh[fn] !== 'function') throw new Fehler(400, `Unbekannte Funktion: ${fn}`);
      const vorher = aenderungen();
      kontext(req, w);
      let wert = await fachlich(() => roh[fn](...args));
      // Stored mail passwords (encrypted) stay on the server; the page only learns that one is set.
      if (fn === 'einstellungen') wert = Object.fromEntries(Object.entries(wert).map(([k, v]) => [k, /^mail_passwort/.test(k) && v ? 'gesetzt' : v]));
      if (aenderungen() !== vorher) { senden('aktualisiert', null, req.headers['x-client'] ?? null); pulsSenden(); }
      return json(res, 200, { wert: wert === undefined ? null : wert });
    }
    if (p === '/api/info') {
      const e = dbSystem.einstellungen();
      return json(res, 200, { modus: o.modus, dbFile: o.modus === 'lokal' ? dbFile : 'mietshaus.sqlite (Server)', dokumente: o.modus === 'lokal' ? dokumentOrdner() : 'dokumente (Server)',
        version: VERSION, sicherungen: o.modus === 'lokal' ? sicherungsOrdner(dbFile) : 'sicherungen (Server)', geraet: o.geraet?.name ?? null, stand: datenStand(raw),
        letzte_auto_sicherung: e.letzte_auto_sicherung ?? null, benutzer: w.benutzer, eingangsordner_fest: !!o.eingang, eingangsordner: eingangsordner(),
        mail_verschluesselt: passwort.verschluesselt, update: neueste && { version: neueste.version, url: neueste.url } });
    }
    if (p.startsWith('/dateien/dokument/')) return datei(res, dokumentOrdner(), p.slice('/dateien/dokument/'.length), u.searchParams.get('name'));
    if (p.startsWith('/dateien/vorschau/')) return datei(res, vorschauOrdner(), p.slice('/dateien/vorschau/'.length));
    if (post && p === '/api/hochladen') {
      const opt = JSON.parse(u.searchParams.get('opt') ?? '{}');
      const t = temporaer(u.searchParams.get('name'), await lesen(req));
      try {
        kontext(req, w);
        const r = ana.importieren([t.p], { ...opt, quelle: opt.quelle ?? 'upload' });
        senden('aktualisiert', null, req.headers['x-client'] ?? null);
        pulsSenden();
        return json(res, 200, r);
      } finally { t.weg(); }
    }
    if (post && p === '/api/dokument-loeschen') {
      const { id } = await jsonLesen(req);
      kontext(req, w);
      const d = roh.dokumentLoeschen(id);
      if (d) fs.rmSync(path.join(dokumentOrdner(), path.basename(d)), { force: true });
      return json(res, 200, { ok: true });
    }
    // Moving a Mac's data to the server: stored files under their archive names, never overwriting one.
    if (post && p === '/api/dokument-datei') {
      const name = String(u.searchParams.get('name') ?? '');
      const vorschau = u.searchParams.get('ordner') === 'vorschau';
      if (!/^[0-9a-f-]{36}(-\d+)?\.[a-z0-9]{1,5}$/i.test(name)) throw new Fehler(400, 'Ungültiger Dateiname.');
      const ziel = path.join(vorschau ? vorschauOrdner() : dokumentOrdner(), name);
      const inhalt = await lesen(req);
      if (fs.existsSync(ziel)) return json(res, 200, { vorhanden: true });
      fs.mkdirSync(path.dirname(ziel), { recursive: true });
      fs.writeFileSync(ziel, inhalt);
      return json(res, 200, { gespeichert: true });
    }
    if (post && p === '/api/neu-analysieren') {
      const { id } = await jsonLesen(req);
      ana.neuAnalysieren(id);
      return json(res, 200, { ok: true });
    }
    // A finished letter or protocol (PDF from the Mac app, HTML from a browser) filed in the archive.
    if (post && p === '/api/ablegen') {
      const meta = JSON.parse(u.searchParams.get('meta') ?? '{}');
      const name = u.searchParams.get('name') ?? 'Dokument.pdf';
      const t = temporaer(name, await lesen(req));
      try {
        kontext(req, w);
        const [r] = ana.importieren([t.p], { objekt_id: meta.objekt_id ?? null, einheit_id: meta.einheit_id ?? null, projekt_id: meta.projekt_id ?? null,
          typ: meta.typ ?? null, status: 'abgelegt', quelle: 'programm' });
        roh.dokumentSpeichern({ id: r.id, titel: meta.titel ?? name.replace(/\.(pdf|html?)$/i, ''), person_id: meta.person_id ?? null, datum: meta.datum ?? null });
        senden('aktualisiert');
        return json(res, 200, { id: r.id, datei: roh.dokument(r.id).datei });
      } finally { t.weg(); }
    }
    if (post && p === '/api/steuerpaket') {
      const objektId = Number(u.searchParams.get('objekt')), jahr = Number(u.searchParams.get('jahr'));
      const anlage = await lesen(req);
      const html = /^text\/html/.test(req.headers['content-type'] ?? '');
      const d = roh.steuerpaketDaten(objektId, jahr);
      const dateien = [
        { name: `Anlage V ${jahr}.${html ? 'html' : 'pdf'}`, daten: anlage },
        { name: `Journal ${jahr}.csv`, daten: d.journal }, { name: `Saldenliste ${jahr}.csv`, daten: d.salden }, { name: `Kontenblätter ${jahr}.csv`, daten: d.kontenblaetter },
      ];
      let fehlend = 0;
      for (const b of d.belege) {
        const q = path.join(dokumentOrdner(), path.basename(b.datei));
        if (fs.existsSync(q)) dateien.push({ name: b.name, daten: fs.readFileSync(q) }); else fehlend++;
      }
      dateien.push({ name: 'Liesmich.txt', daten: [`Steuerunterlagen ${d.objekt} – ${jahr}`, '',
        `Anlage V ${jahr}: Aufstellung der Einnahmen und Werbungskosten (Zufluss-/Abflussprinzip).`,
        'Journal: alle Buchungen des Jahres. Saldenliste: Stand aller Konten. Kontenblätter: jede Buchung je Konto.',
        `Belege: ${d.belege.length - fehlend} Dokumente (Rechnungen, Bescheide, Kontoauszüge und mit Buchungen verknüpfte Belege).`,
        'CSV-Dateien: Semikolon getrennt, Beträge mit Komma, UTF-8 – öffnen mit Excel oder Numbers.', '',
        `Erstellt am ${new Date().toLocaleDateString('de-DE')} mit Mietshaus.`].join('\r\n') });
      const inhalt = zip(dateien);
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': inhalt.length, 'X-Belege': String(d.belege.length - fehlend), 'X-Buchungen': String(d.anzahl_buchungen),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`Steuerunterlagen ${d.objekt} ${jahr}.zip`)}`, ...SICHERHEIT });
      return res.end(inhalt);
    }
    // ---------- backups ----------
    if (p === '/api/sicherung') {
      const name = `Mietshaus-Sicherung-${ortszeit.heute()}.sqlite`;
      const ziel = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mietshaus-sich-')), name);
      sicherung.schreiben(raw, ziel, o.geraet);
      kontext(req, w);
      roh.setzeEinstellungen({ letzte_sicherung: new Date().toISOString() });
      res.on('close', () => fs.rmSync(path.dirname(ziel), { recursive: true, force: true }));
      return datei(res, path.dirname(ziel), name, name);
    }
    if (p === '/api/sicherungen') {
      return json(res, 200, sicherung.liste([sicherungsOrdner(dbFile)], { ohne: [dbFile] }).slice(0, 60)
        .map((s) => ({ name: path.basename(s.datei), ...standText(s), groesse: fs.statSync(s.datei).size })));
    }
    if (post && p === '/api/sicherung/pruefen') {
      // Either an uploaded file or one of the server's own backups (?name=).
      const vorhanden = u.searchParams.get('name');
      if (vorhanden) {
        const q = path.join(sicherungsOrdner(dbFile), path.basename(vorhanden));
        if (!fs.existsSync(q)) throw new Fehler(404, 'Diese Sicherung gibt es nicht.');
        return json(res, 200, sicherungPruefen(q));
      }
      const ordner = path.join(sicherungsOrdner(dbFile), 'hochgeladen');
      fs.mkdirSync(ordner, { recursive: true });
      const q = path.join(ordner, `Hochgeladen-${ortszeit.lokalZeit().replace(/:/g, '-').replace('T', '_')}-${crypto.randomBytes(3).toString('hex')}.sqlite`);
      fs.writeFileSync(q, await lesen(req));
      try { return json(res, 200, sicherungPruefen(q)); } catch (e) { fs.rmSync(q, { force: true }); throw new Fehler(400, e.message); }
    }
    if (post && p === '/api/sicherung/einspielen') {
      const { kennung, neueste } = await jsonLesen(req);
      const q = wartend.get(neueste ? `${kennung}:neueste` : kennung);
      if (!q) throw new Fehler(410, 'Die Prüfung ist abgelaufen. Bitte die Sicherung noch einmal wählen.');
      sicherung.pruefen(q);
      const r = sicherung.einspielen({ quelle: q, dbFile, rawDb: raw, geraet: o.geraet, schliessen: () => raw.close(), oeffnen: oeffneDb });
      wartend.clear();
      senden('aktualisiert');
      return json(res, 200, { vorher: path.basename(r.vorher) });
    }
    // ---------- inbox: folder and mail ----------
    if (post && p === '/api/eingangsordner') {
      if (o.eingang) throw new Fehler(409, `Der Eingangsordner ist auf dem Server fest eingestellt (${o.eingang}).`);
      const { pfad } = await jsonLesen(req);
      if (pfad && !fs.existsSync(pfad)) throw new Fehler(400, `Den Ordner ${pfad} gibt es nicht.`);
      kontext(req, w);
      roh.setzeEinstellungen({ eingangsordner: pfad || null });
      ein.ordnerSetzen(pfad || null);
      return json(res, 200, { pfad: pfad || null });
    }
    if (post && p === '/api/mail/speichern') {
      const { cfg, pw } = await jsonLesen(req);
      kontext(req, w);
      roh.setzeEinstellungen(cfg ?? {});
      if (pw) passwort.setzen(pw);
      ein.mailPlanen();
      return json(res, 200, { verschluesselt: passwort.verschluesselt });
    }
    if (post && p === '/api/mail/testen') return json(res, 200, { text: await fachlich(() => ein.mailTesten()) });
    if (post && p === '/api/mail/abrufen') return json(res, 200, await fachlich(() => ein.mailAbrufen()));
    throw new Fehler(404, 'Unbekannte Adresse.');
  }

  // User management: every user may manage users (same rights for all). Not possible in local mode.
  function serverFunktion(fn, args, w) {
    if (o.modus !== 'server') throw new Fehler(400, 'Benutzer gibt es nur auf dem Server.');
    if (fn === 'benutzerListe') return auth.liste();
    if (fn === 'benutzerAnlegen') return auth.anlegen(args[0] ?? {});
    if (fn === 'benutzerAendern') return auth.aendern(Number(args[0]), args[1] ?? {});
    if (fn === 'claudeToken') return auth.claudeToken(w.benutzer.id);
    throw new Fehler(400, `Unbekannte Funktion: ${fn}`);
  }

  const server = http.createServer((req, res) => {
    bearbeiten(req, res).catch((e) => {
      const status = e instanceof Fehler ? e.status : 500;
      if (status === 500) console.error(req.method, req.url, e);
      if (!res.headersSent) json(res, status, { fehler: String(e?.message ?? e) });
      else res.end();
    });
  });
  server.requestTimeout = 0; // large uploads and the event stream
  await new Promise((ok) => server.listen(o.port ?? 0, o.host ?? '127.0.0.1', ok));
  const adresse = server.address();
  return {
    url: `http://${adresse.address.includes(':') ? `[${adresse.address}]` : adresse.address}:${adresse.port}`,
    port: adresse.port,
    db: () => roh,
    raw: () => raw,
    dbSystem,
    auth,
    senden,
    dokumentOrdner,
    importieren: (pfade, opt) => { const r = ana.importieren(pfade, opt); senden('aktualisiert'); return r; },
    eingangsordnerSetzen: (pfad) => { dbSystem.setzeEinstellungen({ eingangsordner: pfad || null }); ein.ordnerSetzen(pfad || null); },
    beenden: async () => {
      clearTimeout(t1); clearInterval(t2); clearInterval(t3);
      ein.ordnerSetzen(null);
      for (const h of hoerer) h.res.end();
      await new Promise((ok) => server.close(ok));
      server.closeAllConnections?.();
      await ana.beenden();
      raw.close();
    },
  };
}

module.exports = { starten, VERSION };

// Started directly (container): node server/server.cjs  – settings from the environment.
if (require.main === module) {
  const { geraet } = require('../electron/geraet.cjs');
  const daten = process.env.MIETSHAUS_DATEN ?? '/daten';
  starten({
    modus: 'server', daten, port: Number(process.env.PORT ?? 8080), host: process.env.HOST ?? '0.0.0.0',
    geraet: geraet(daten), eingang: process.env.MIETSHAUS_EINGANG || undefined,
    mcp: require('./mcp-http.cjs').bearbeiten,
  }).then((s) => {
    console.log(`Mietshaus ${VERSION} läuft auf Port ${s.port}, Daten in ${daten}.`);
    const ende = () => s.beenden().finally(() => process.exit(0));
    process.on('SIGTERM', ende);
    process.on('SIGINT', ende);
  }).catch((e) => { console.error(e); process.exit(1); });
}
