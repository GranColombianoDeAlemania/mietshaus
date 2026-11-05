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
const { ics } = require('./ics.cjs');
const { kandidaten: zaehlerKandidaten } = require('../electron/zaehlerfoto.cjs');
const fintsModul = require('../electron/fints.cjs');
const authModul = require('./auth.cjs');
const geheim = require('./geheim.cjs');
const versandModul = require('./versand.cjs');
const pushModul = require('./push.cjs');
const passkeyModul = require('./passkey.cjs');

const { VERSION, DESKTOP_SCHNITTSTELLE, vergleichen, neuesteVersion } = require('../electron/version.cjs');
const TYPEN = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.xml': 'application/xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.tif': 'image/tiff', '.tiff': 'image/tiff' };
const SICHERHEIT = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN', 'Cross-Origin-Opener-Policy': 'same-origin' };
const MAX_UPLOAD = 300 * 1024 * 1024;
// Functions answered by the server itself, not by the database API.
const MEINE = new Set(['mitteilungen', 'mitteilungenUngelesen', 'mitteilungGelesen', 'alleMitteilungenGelesen', 'aufgabenListe', 'vorgangStatus', 'vorgangKommentieren']);
const NUR_SERVER = new Set(['benutzerListe', 'benutzerAnlegen', 'benutzerAendern', 'claudeToken', 'meineAufgaben', 'passkeyListe', 'passkeyLoeschen', 'personEinladen', 'einladungErneuern', 'kalenderAbo']);

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
  const SYSTEM = { quelle: 'app', geraet: o.geraet?.id ?? null, benutzer: null, ueberschreiben: null, rueckfrage: null };

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
  const passkeys = passkeyModul(() => raw);
  const passwort = o.passwort ?? geheim(daten, () => dbSystem);
  const bank = fintsModul({ db: () => dbSystem, geheim: passwort });

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
  // The database is closed for a moment while a backup is restored, and for good when the server stops: the timers
  // then skip a beat instead of bringing the process down.
  const tPuls = setInterval(() => { try { pulsSenden(); } catch {} }, 15_000).unref();
  // Changes written by another process (Claude's MCP server in local mode) reach every window.
  let version = null;
  const tVersion = setInterval(() => {
    try {
      const v = raw.prepare('PRAGMA data_version').get().data_version;
      if (version != null && v !== version) senden('aktualisiert');
      version = v;
    } catch {}
  }, 2000).unref();
  const aenderungen = () => raw.prepare('SELECT total_changes() AS n').get().n;

  // ---------- background work ----------
  const ana = analyse({ db: dbSystem, dokumentOrdner, vorschauOrdner, tessdata: o.tessdata, cacheOrdner: path.join(daten, 'ocr-cache'),
    onFertig: (id) => { senden('dokumentAnalysiert', id); pulsSenden(); } });
  ana.warteschlange();
  const push = pushModul({ daten, raw: () => raw, senden });
  // Every notification also goes to the bell (db: mitteilungAnlegen), then out as push / desktop notification.
  const benachrichtigen = (n) => {
    try { dbSystem.mitteilungAnlegen(n); } catch (e) { console.error('Glocke', e); }
    return push.benachrichtigen(n).catch((e) => console.error('Benachrichtigung', e));
  };
  const ein = eingang({
    db: dbSystem,
    importieren: (pfade, opt) => {
      const r = ana.importieren(pfade, opt);
      senden('aktualisiert');
      const neu = r.filter((x) => !x.doppelt).length;
      if (neu) benachrichtigen({ art: 'postfach', ziel: { seite: 'postfach' }, titel: 'Neue Dokumente im Postfach', text: `${neu} ${neu === 1 ? 'neues Dokument' : 'neue Dokumente'} von ${opt?.quelle === 'email' ? 'E-Mail' : 'Eingangsordner'}.` });
      return r;
    },
    melden: (text) => senden('meldung', text),
    passwort,
  });
  const eingangsordner = () => o.eingang ?? dbSystem.einstellungen().eingangsordner ?? null;
  const versand = versandModul({ db: () => roh, passwort, dokumentOrdner, importieren: (p2, opt) => ana.importieren(p2, { ...opt, alsBenutzer: roh }) });
  ein.ordnerSetzen(eingangsordner());
  ein.mailPlanen();
  if (dbSystem.einstellungen().mail_aktiv === '1') setTimeout(() => ein.mailAbrufen().catch(() => {}), 20_000).unref();
  const automatik = () => { try { if (dbSystem.automatikLauf().erzeugt) senden('aktualisiert'); } catch (e) { console.error('Automatik', e); } };
  // Files of documents removed for good (recycle bin), with their page previews.
  const dateienEntfernen = (dateien) => {
    for (const d of dateien ?? []) {
      fs.rmSync(path.join(dokumentOrdner(), path.basename(d)), { force: true });
      const stamm = path.parse(path.basename(d)).name;
      try { for (const v of fs.readdirSync(vorschauOrdner())) if (v.startsWith(`${stamm}-`)) fs.rmSync(path.join(vorschauOrdner(), v), { force: true }); } catch {}
    }
  };
  // Documents in the recycle bin for more than 30 days go for good.
  // Tasks due tomorrow or overdue: a reminder to the person in charge, once a day each (from 7 o'clock).
  const erinnern = () => {
    if (new Date().getHours() < 7) return;
    try { for (const n of dbSystem.faelligeErinnerungen()) benachrichtigen(n); } catch (e) { console.error('Erinnerungen', e); }
  };
  const papierkorbLeeren = () => { try { const d = dbSystem.papierkorbLeeren(); dateienEntfernen(d); if (d.length) senden('aktualisiert'); } catch (e) { console.error('Papierkorb', e); } };
  const autoSicherung = () => {
    try {
      if (dbSystem.einstellungen().auto_sicherung === '0') return;
      if (sicherung.automatisch(raw, sicherungsOrdner(dbFile), o.geraet)) dbSystem.setzeEinstellungen({ letzte_auto_sicherung: new Date().toISOString() });
    } catch (e) {
      console.error('Automatische Sicherung', e);
      dbSystem.setzeEinstellungen({ letzter_sicherungsfehler: JSON.stringify({ zeit: new Date().toISOString(), fehler: String(e?.message ?? e) }) });
      senden('meldung', `Automatische Sicherung fehlgeschlagen: ${e?.message ?? e}`);
      benachrichtigen({ art: 'sicherung', ziel: { seite: 'status' }, titel: 'Sicherung fehlgeschlagen', text: String(e?.message ?? e).slice(0, 200) });
      return;
    }
    // Once a month the newest backup is restored on trial (into a temporary copy).
    try {
      const letzter = JSON.parse(dbSystem.einstellungen().sicherungstest ?? 'null');
      if (!letzter || Date.now() - new Date(letzter.zeit).getTime() > 30 * 864e5) sicherungTesten();
    } catch (e) { console.error('Sicherungstest', e); }
  };
  const sicherungTesten = () => {
    const r = sicherung.testen(sicherungsOrdner(dbFile));
    dbSystem.setzeEinstellungen({ sicherungstest: JSON.stringify(r) });
    if (!r.ok) {
      senden('meldung', `Sicherungstest fehlgeschlagen: ${r.fehler}`);
      benachrichtigen({ art: 'sicherung', ziel: { seite: 'status' }, titel: 'Sicherungstest fehlgeschlagen', text: String(r.fehler).slice(0, 200) });
    }
    return r;
  };
  // Folder sizes for the status page (documents can be many; this runs only when the page asks).
  const ordnerGroesse = (o2) => {
    let n = 0, b = 0;
    const gehe = (d) => { let e = []; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const x of e) { const p2 = path.join(d, x.name); if (x.isDirectory()) gehe(p2); else { n++; try { b += fs.statSync(p2).size; } catch {} } } };
    gehe(o2);
    return { anzahl: n, bytes: b };
  };
  // Is there a newer release? Asked once a day (server mode; the Mac app asks for itself). MIETSHAUS_UPDATE_PRUEFEN=0 stops it.
  let neueste = null;
  const updatePruefen = async () => {
    if (o.modus !== 'server' || process.env.MIETSHAUS_UPDATE_PRUEFEN === '0') return;
    const n = await neuesteVersion();
    if (n) neueste = vergleichen(n.version, VERSION) > 0 ? n : null;
  };
  // Morning overview from 7 o'clock, once a day, to every user who wants it: urgent points, today's appointments, own
  // cases due. Nothing is sent when there is nothing to do.
  const morgenUebersicht = async () => {
    if (o.modus !== 'server' || new Date().getHours() < 7) return;
    const heute = ortszeit.heute();
    if (dbSystem.einstellungen().push_morgen === heute) return;
    dbSystem.setzeEinstellungen({ push_morgen: heute });
    const dringend = dbSystem.hinweise().filter((h) => h.stufe === 'rot').length;
    const termine = dbSystem.termineListe(heute, heute).filter((t) => !t.erledigt).length;
    for (const b of raw.prepare(`SELECT DISTINCT b.id FROM benutzer b JOIN push_abos a ON a.benutzer_id = b.id WHERE b.aktiv = 1`).all()) {
      const faellig = dbSystem.meineAufgaben(b.id).filter((v) => v.faellig && v.faellig <= heute).length;
      const teile = [dringend && `${dringend} dringend`, termine && `${termine} ${termine === 1 ? 'Termin' : 'Termine'} heute`, faellig && `${faellig} ${faellig === 1 ? 'Aufgabe' : 'Aufgaben'} fällig`].filter(Boolean);
      if (teile.length) await benachrichtigen({ art: 'morgen', benutzer: b.id, titel: 'Guten Morgen – Mietshaus', text: `${teile.join(', ')}.` });
    }
  };
  // Warnings about the server itself, at most once a day each: little space left, no backup for two days, and after a
  // start with a new version that it was installed. Returns the warnings sent (for the test).
  const serverWarnungen = async (platz = null) => {
    if (o.modus !== 'server') return [];
    const e = dbSystem.einstellungen();
    const heute = ortszeit.heute();
    const gesendet = JSON.parse(e.server_warnungen ?? '{}');
    const warnungen = [];
    const warnen = (art, titel, text) => { if (gesendet[art] !== heute) { gesendet[art] = heute; warnungen.push({ art, titel, text }); } };
    try {
      const p = platz ?? (() => { const s = fs.statfsSync(daten); return { frei: s.bavail * s.bsize, gesamt: s.blocks * s.bsize }; })();
      if (p.frei < 2 * 1024 ** 3 || p.frei < p.gesamt * 0.1)
        warnen('platz', 'Speicher auf der Synology wird knapp', `Noch ${(p.frei / 1024 ** 3).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB frei (${Math.round(p.frei / p.gesamt * 100)} %). Sicherungen und Dokumente brauchen Platz.`);
    } catch {}
    const letzte = e.letzte_auto_sicherung ? Date.parse(e.letzte_auto_sicherung) : null;
    if (e.auto_sicherung !== '0' && letzte && Date.now() - letzte > 2 * 864e5)
      warnen('sicherung', 'Keine Sicherung seit zwei Tagen', `Die letzte automatische Sicherung war am ${new Date(letzte).toLocaleString('de-DE')}. Bitte unter Einstellungen → Status nachsehen.`);
    if (e.letzte_version !== VERSION) {
      if (e.letzte_version) warnungen.push({ art: 'version', titel: `Mietshaus ${VERSION} wurde installiert`, text: `Vorher lief ${e.letzte_version}. Was neu ist, steht auf GitHub unter Releases.` });
      dbSystem.setzeEinstellungen({ letzte_version: VERSION });
    }
    dbSystem.setzeEinstellungen({ server_warnungen: JSON.stringify(gesendet) });
    for (const w of warnungen) await benachrichtigen({ art: 'server', ziel: { seite: 'status' }, titel: w.titel, text: w.text });
    return warnungen;
  };
  automatik();
  papierkorbLeeren();
  const t1 = setTimeout(() => { autoSicherung(); updatePruefen(); morgenUebersicht(); erinnern(); serverWarnungen().catch((e) => console.error('Serverwarnungen', e)); }, 60_000);
  const t2 = setInterval(() => { automatik(); papierkorbLeeren(); erinnern(); autoSicherung(); morgenUebersicht(); serverWarnungen().catch((e) => console.error('Serverwarnungen', e)); }, 3600_000);
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
  const kontext = (req, w, quelle = 'app') => kontextSetzen(raw, { quelle: w.claude ? 'claude' : quelle, geraet: String(req.headers['x-geraet'] ?? '').slice(0, 80) || o.geraet?.id || null,
    benutzer: w.benutzer?.id ?? null, ueberschreiben: req.headers['x-ueberschreiben'] === '1' ? '1' : null,
    // Plausibility questions for the app's own requests, unless just confirmed.
    rueckfrage: req.headers['x-bestaetigt'] === '1' ? null : '1' });

  function statisch(req, res, pfad) {
    let datei = path.join(dist, path.normalize(decodeURIComponent(pfad)).replace(/^(\.\.[/\\])+/, ''));
    if (!datei.startsWith(dist) || !fs.existsSync(datei) || fs.statSync(datei).isDirectory()) {
      // A missing file (logo, script) is a 404 – the page itself only for addresses inside the app.
      if (path.extname(pfad)) return json(res, 404, { fehler: 'Datei nicht gefunden.' });
      datei = path.join(dist, 'index.html');
    }
    if (!fs.existsSync(datei)) return json(res, 503, { fehler: 'Die Oberfläche ist nicht gebaut (npm run build).' });
    const ext = path.extname(datei).toLowerCase();
    // Only the built files with a hash in their name (assets/) may be kept for long; sw.js, icons and the page are checked each time.
    const lange = datei.startsWith(path.join(dist, 'assets') + path.sep);
    res.writeHead(200, { 'Content-Type': TYPEN[ext] ?? 'application/octet-stream', 'Cache-Control': lange ? 'public, max-age=31536000, immutable' : 'no-cache', ...SICHERHEIT });
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
  const alsFehler = (e) => (e instanceof Fehler ? e
    : e?.code === 'KONFLIKT' ? Object.assign(new Fehler(409, e.message), { konflikt: e.konflikt })
      : e?.code === 'RUECKFRAGE' ? Object.assign(new Fehler(409, e.message), { bestaetigen: e.bestaetigen })
      : new Fehler(400, e?.message || e?.errors?.[0]?.message || e?.code || String(e)));
  const fachlich = (fn) => {
    try {
      const r = fn();
      return r instanceof Promise ? r.catch((e) => { throw alsFehler(e); }) : r;
    } catch (e) { throw alsFehler(e); }
  };

  // One call of the business logic for /api/call: returns the value and the extra response headers.
  async function aufrufen({ fn, args: argumente = [] }, req, w) {
    // The calendar marks the cases of the signed-in user (filter "nur meine").
    const args = fn === 'kalender' ? [argumente[0], argumente[1], w.benutzer?.id ?? null]
      // The bell shows only the signed-in user's notifications, and creating them is the server's business.
      : MEINE.has(fn) ? [w.benutzer?.id ?? null, ...argumente] : argumente;
    if (fn === 'mitteilungAnlegen') throw new Fehler(403, 'Nicht erlaubt.');
    if (NUR_SERVER.has(fn)) return [await fachlich(() => serverFunktion(fn, args, w)), {}];
    if (typeof fn !== 'string' || typeof roh[fn] !== 'function') throw new Fehler(400, `Unbekannte Funktion: ${fn}`);
    // Setting the context writes to temp.kontext: counted before, every read would look like a change (and
    // other windows would reload, which made them reload each other).
    kontext(req, w);
    const vorher = aenderungen();
    // A case assigned to someone else: that user gets a notification.
    const zuweisung = fn === 'save' && args[0] === 'vorgaenge' && args[1]?.zustaendig && Number(args[1].zustaendig) !== w.benutzer?.id
      ? { neu: Number(args[1].zustaendig), alt: args[1].id ? raw.prepare('SELECT zustaendig FROM vorgaenge WHERE id = ?').get(args[1].id)?.zustaendig : null } : null;
    let wert = await fachlich(() => roh[fn](...args));
    // A comment notifies the person in charge.
    if (fn === 'vorgangKommentieren' && wert?.benachrichtigen) { benachrichtigen(wert.benachrichtigen); wert = true; }
    // Removed for good: the records are gone, their files go too.
    if (fn === 'dokumentEndgueltig' || fn === 'papierkorbLeeren') { dateienEntfernen(wert); wert = wert.length; }
    if (zuweisung && zuweisung.neu !== zuweisung.alt) {
      const v = raw.prepare('SELECT v.titel, v.faellig, v.objekt_id, o.bezeichnung AS objekt FROM vorgaenge v LEFT JOIN objekte o ON o.id = v.objekt_id WHERE v.id = ?').get(args[1].id ?? wert);
      if (v) benachrichtigen({ art: 'aufgaben', benutzer: zuweisung.neu, ziel: { vorgang: args[1].id ?? wert, objektId: v.objekt_id ?? null }, titel: `${w.benutzer?.name ?? 'Jemand'} hat dir einen Vorgang zugewiesen`,
        text: `${v.titel}${v.objekt ? ` · ${v.objekt}` : ''}${v.faellig ? ` · fällig ${v.faellig.split('-').reverse().join('.')}` : ''}` });
      // The history of the task says who handed it to whom.
      const an = raw.prepare('SELECT name FROM benutzer WHERE id = ?').get(zuweisung.neu)?.name;
      if (v && an) raw.prepare(`INSERT INTO vorgangseintraege (vorgang_id, datum, art, text, von) VALUES (?, ?, 'status', ?, ?)`)
        .run(args[1].id ?? wert, ortszeit.heute(), `Zugewiesen an ${an}`, w.benutzer?.name ?? null);
    }
    // Stored mail passwords (encrypted) stay on the server; the page only learns that one is set.
    if (fn === 'einstellungen') wert = Object.fromEntries(Object.entries(wert).map(([k, v]) => [k, /_passwort_(server|enc|klar)$/.test(k) && v ? 'gesetzt' : v]));
    const geaendert = aenderungen() !== vorher;
    if (geaendert) { senden('aktualisiert', null, req.headers['x-client'] ?? null); pulsSenden(); }
    // A call that changed nothing may be kept by the browser for reading without a connection.
    return [wert === undefined ? null : wert, geaendert ? {} : { 'X-Lesend': '1' }];
  }

  // A change sent again with the same key (the page retries after a broken connection, or the user saves the same
  // thing again) is not done twice: the second request waits for the first or gets its stored answer. Kept 15 minutes.
  const erledigt = new Map();
  async function einmal(schluessel, benutzer, ausfuehren) {
    if (typeof schluessel !== 'string' || !/^[\w-]{8,80}$/.test(schluessel)) return ausfuehren();
    const jetzt = Date.now();
    for (const [k, e] of erledigt) if (jetzt - e.zeit > 15 * 60_000 || erledigt.size > 2000) erledigt.delete(k); else break;
    const k = `${benutzer ?? ''}:${schluessel}`;
    const alt = erledigt.get(k);
    if (alt) { const [wert, kopf] = await alt.antwort; return [wert, { ...kopf, 'X-Wiederholt': '1' }]; }
    const antwort = ausfuehren();
    erledigt.set(k, { zeit: jetzt, antwort });
    try {
      const [wert, kopf] = await antwort;
      // Only changes are kept: a read sent again should see the current data.
      if (kopf['X-Lesend']) erledigt.delete(k);
      return [wert, kopf];
    } catch (e) { erledigt.delete(k); throw e; }
  }

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
    // Calendar subscription: the secret link is the key (calendar apps send no cookie).
    const abo = /^\/kalender\/([A-Za-z0-9_-]{20,64})\.ics$/.exec(p);
    if (o.modus === 'server' && req.method === 'GET' && abo) {
      const b = auth.kalenderBenutzer(abo[1]);
      if (!b) throw new Fehler(404, 'Unbekannter Kalender.');
      const t = ortszeit.heute();
      const plus = (n) => new Date(Date.parse(`${t}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
      const inhalt = ics(dbSystem.kalender(plus(-90), plus(365), b.id), { name: 'Mietshaus' });
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="mietshaus.ics"', ...SICHERHEIT });
      return res.end(inhalt);
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
    // Invitation: who is invited (shown on the page), then the password the person chooses.
    if (o.modus === 'server' && p === '/api/einladung') {
      const schluessel = `${ip(req)}|einladung`;
      const warten = auth.bremse.gesperrt(schluessel);
      if (warten) throw new Fehler(429, `Zu viele Versuche. Bitte in ${warten} Sekunden noch einmal.`);
      if (!post) {
        const info = auth.einladungPruefen(u.searchParams.get('token'));
        if (!info) { auth.bremse.fehler(schluessel); throw new Fehler(404, 'Diese Einladung ist abgelaufen oder wurde schon benutzt. Bitte eine neue anfordern.'); }
        return json(res, 200, info);
      }
      const { token, passwort: pw } = await jsonLesen(req);
      let b;
      try { b = auth.einladungEinloesen(token, pw); } catch (e) { if (/abgelaufen/.test(e.message)) auth.bremse.fehler(schluessel); throw new Fehler(400, e.message); }
      auth.bremse.erfolg(schluessel);
      return json(res, 200, { benutzer: b }, { 'Set-Cookie': cookie(req, 'mietshaus', auth.sitzungAnlegen(b.id, req.headers['user-agent']), 30) });
    }
    // Login with a passkey: options (challenge), then the signed answer of the device.
    if (o.modus === 'server' && post && p === '/api/passkey/anmelden/optionen') return json(res, 200, await passkeys.anmeldenOptionen(req));
    if (o.modus === 'server' && post && p === '/api/passkey/anmelden') {
      const { vorgang, antwort } = await jsonLesen(req);
      const schluessel = `${ip(req)}|passkey`;
      const warten = auth.bremse.gesperrt(schluessel);
      if (warten) throw new Fehler(429, `Zu viele Versuche. Bitte in ${warten} Sekunden noch einmal.`);
      let id;
      try { id = await passkeys.anmelden(req, vorgang, antwort); } catch (e) { auth.bremse.fehler(schluessel); throw new Fehler(401, e.message); }
      auth.bremse.erfolg(schluessel);
      const b = auth.benutzer(id);
      return json(res, 200, { benutzer: b }, { 'Set-Cookie': cookie(req, 'mietshaus', auth.sitzungAnlegen(id, req.headers['user-agent']), 30) });
    }
    if (!p.startsWith('/api/') && !p.startsWith('/dateien/') && p !== '/mcp') return statisch(req, res, p);

    const w = wer(req);
    if (!w) throw new Fehler(401, 'Bitte anmelden.');
    if (p === '/mcp') {
      if (!o.mcp) throw new Fehler(404, 'Claude ist auf diesem Server nicht eingerichtet.');
      // Claude's tools run asynchronously: every access to the database marks the change as Claude's, for this user.
      const k = { quelle: 'claude', geraet: o.geraet?.id ?? null, benutzer: w.benutzer?.id ?? null, ueberschreiben: null, rueckfrage: null };
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
      const anfrage = await jsonLesen(req);
      const [wert, kopf] = await einmal(req.headers['x-vorgang'], w.benutzer?.id ?? null, () => aufrufen(anfrage, req, w));
      return json(res, 200, { wert }, kopf);
    }
    if (p === '/api/info') {
      const e = dbSystem.einstellungen();
      return json(res, 200, { modus: o.modus, dbFile: o.modus === 'lokal' ? dbFile : 'mietshaus.sqlite (Server)', dokumente: o.modus === 'lokal' ? dokumentOrdner() : 'dokumente (Server)',
        version: VERSION, sicherungen: o.modus === 'lokal' ? sicherungsOrdner(dbFile) : 'sicherungen (Server)', geraet: o.geraet?.name ?? null, stand: datenStand(raw),
        letzte_auto_sicherung: e.letzte_auto_sicherung ?? null, benutzer: w.benutzer, eingangsordner_fest: !!o.eingang, eingangsordner: eingangsordner(),
        mail_verschluesselt: passwort.verschluesselt, update: neueste && { version: neueste.version, url: neueste.url } });
    }
    // Status page: version and update, space, backups and their test, devices signed in.
    if (p === '/api/systemstatus') {
      const e = dbSystem.einstellungen();
      const groesse = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
      let platz = null;
      try { const s = fs.statfsSync(daten); platz = { frei: s.bavail * s.bsize, gesamt: s.blocks * s.bsize }; } catch {}
      const sich = sicherung.liste([sicherungsOrdner(dbFile)], { ohne: [dbFile] });
      return json(res, 200, {
        modus: o.modus, version: VERSION, update: neueste && { version: neueste.version, url: neueste.url },
        datenbank: { bytes: groesse(dbFile) + groesse(`${dbFile}-wal`), stand: datenStand(raw) },
        dokumente: ordnerGroesse(dokumentOrdner()), analyse: roh.zuAnalysieren().length, platz,
        sicherung: { automatisch: e.auto_sicherung !== '0', letzte_auto: e.letzte_auto_sicherung ?? null, letzte_manuell: e.letzte_sicherung ?? null,
          anzahl: sich.length, bytes: sich.reduce((s2, x) => s2 + groesse(x.datei), 0), neueste: sich[0] ? { name: path.basename(sich[0].datei), zeit: sich[0].zeit } : null,
          test: JSON.parse(e.sicherungstest ?? 'null'), fehler: JSON.parse(e.letzter_sicherungsfehler ?? 'null') },
        sitzungen: o.modus === 'server' ? auth.sitzungen(w.token) : [],
      });
    }
    if (post && p === '/api/sicherungstest') return json(res, 200, sicherungTesten());
    if (post && p === '/api/passkey/registrieren/optionen') {
      if (!w.token) throw new Fehler(400, 'Passkeys gibt es nur auf dem Server.');
      return json(res, 200, await passkeys.registrierenOptionen(req, w.benutzer, w.token));
    }
    if (post && p === '/api/passkey/registrieren') {
      const { antwort, name } = await jsonLesen(req);
      return json(res, 200, await fachlich(() => passkeys.registrieren(req, w.benutzer, w.token, antwort, name)));
    }
    // ---------- notifications ----------
    if (p === '/api/push/schluessel') return json(res, 200, { schluessel: push.oeffentlich() });
    if (post && p === '/api/push/abo') {
      const { abo, arten } = await jsonLesen(req);
      fachlich(() => push.abonnieren(w.benutzer?.id ?? null, abo, arten, req.headers['user-agent']));
      return json(res, 200, { ok: true });
    }
    if (post && p === '/api/push/abmelden') { push.abbestellen((await jsonLesen(req)).endpoint); return json(res, 200, { ok: true }); }
    if (post && p === '/api/push/status') return json(res, 200, push.abo((await jsonLesen(req)).endpoint));
    if (post && p === '/api/push/test') {
      const n = await push.benachrichtigen({ art: 'test', benutzer: w.benutzer?.id ?? null, titel: 'Mietshaus', text: 'Benachrichtigungen funktionieren.' });
      return json(res, 200, { gesendet: n });
    }
    if (post && p === '/api/jetzt-sichern') {
      sicherung.automatisch(raw, sicherungsOrdner(dbFile), o.geraet, new Date(), true);
      dbSystem.setzeEinstellungen({ letzte_auto_sicherung: new Date().toISOString(), letzter_sicherungsfehler: null });
      return json(res, 200, { ok: true });
    }
    if (post && p === '/api/sitzung-beenden') {
      const { id } = await jsonLesen(req);
      auth.sitzungBeendenId(id);
      return json(res, 200, { ok: true });
    }
    if (p.startsWith('/dateien/dokument/')) return datei(res, dokumentOrdner(), p.slice('/dateien/dokument/'.length), u.searchParams.get('name'));
    if (p.startsWith('/dateien/vorschau/')) return datei(res, vorschauOrdner(), p.slice('/dateien/vorschau/'.length));
    if (post && p === '/api/hochladen') {
      const { standort, ...opt } = JSON.parse(u.searchParams.get('opt') ?? '{}');
      const t = temporaer(u.searchParams.get('name'), await lesen(req));
      try {
        kontext(req, w);
        // A photo from the phone's camera button: the house nearby (if its location is saved), else the inbox.
        const o = !opt.objekt_id && standort && Number.isFinite(standort.lat) && Number.isFinite(standort.lon) ? roh.objektBeiStandort(standort.lat, standort.lon) : null;
        const r = ana.importieren([t.p], { ...opt, ...(o ? { objekt_id: o.id } : {}), quelle: opt.quelle ?? 'upload', alsBenutzer: roh });
        if (o) r.forEach((x) => { x.objekt = o.bezeichnung; });
        senden('aktualisiert', null, req.headers['x-client'] ?? null);
        pulsSenden();
        return json(res, 200, r);
      } finally { t.weg(); }
    }
    // Bank access (FinTS): set up, fetch transactions, continue with TAN or approval. The PIN only passes through.
    if (post && p === '/api/fints') {
      const a = await jsonLesen(req);
      kontext(req, w);
      const objektId = Number(a.objektId);
      if (a.aktion === 'status') return json(res, 200, bank.status(objektId));
      if (a.aktion === 'einrichten') return json(res, 200, await fachlich(() => bank.einrichten({ ...a, objektId, objektIban: roh.get('objekte', objektId)?.iban })));
      if (a.aktion === 'abrufen') return json(res, 200, await fachlich(() => bank.abrufen({ ...a, objektId })));
      if (a.aktion === 'weiter') return json(res, 200, await fachlich(() => bank.weiter(a)));
      if (a.aktion === 'abbrechen') { bank.abbrechen(a.vorgang); return json(res, 200, { ok: true }); }
      if (a.aktion === 'entfernen') { bank.entfernen(objektId); return json(res, 200, { ok: true }); }
      throw new Fehler(400, 'Unbekannte Aktion.');
    }
    // Meter photo: filed with the meter's house and unit, then its digits are read; the reading dialog proposes them.
    if (post && p === '/api/zaehlerfoto') {
      const z = roh.get('zaehler', Number(u.searchParams.get('zaehler')));
      if (!z) throw new Fehler(404, 'Zähler nicht gefunden.');
      const t = temporaer(u.searchParams.get('name') || 'Zaehler.jpg', await lesen(req));
      try {
        kontext(req, w);
        const [r] = ana.importieren([t.p], { objekt_id: z.objekt_id, einheit_id: z.einheit_id, status: 'abgelegt', typ: 'Foto', alsBenutzer: roh });
        roh.dokumentSpeichern({ id: r.id, titel: `Zählerfoto ${z.nummer ?? z.art} ${ortszeit.heute().split('-').reverse().join('.')}`, typ: 'Foto', datum: ortszeit.heute() });
        const d = roh.dokument(r.id);
        const letzter = raw.prepare('SELECT stand FROM zaehlerstaende WHERE zaehler_id = ? ORDER BY datum DESC LIMIT 1').get(z.id)?.stand ?? null;
        let kandidaten = [];
        try { kandidaten = zaehlerKandidaten(await ana.ziffernLesen(fs.readFileSync(path.join(dokumentOrdner(), d.datei))), letzter); } catch (e) { console.error('Zählerfoto', e); }
        senden('aktualisiert', null, req.headers['x-client'] ?? null);
        return json(res, 200, { dokument_id: r.id, datei: d.datei, kandidaten, letzter });
      } finally { t.weg(); }
    }
    if (post && p === '/api/dokument-loeschen') {
      const { id } = await jsonLesen(req);
      kontext(req, w);
      // Into the recycle bin: the file stays for 30 days (Postfach → Papierkorb).
      roh.dokumentLoeschen(id);
      senden('aktualisiert', null, req.headers['x-client'] ?? null);
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
          typ: meta.typ ?? null, status: 'abgelegt', quelle: 'programm', alsBenutzer: roh });
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
    if (post && p === '/api/smtp/speichern') {
      const { cfg, pw } = await jsonLesen(req);
      kontext(req, w);
      roh.setzeEinstellungen(cfg ?? {});
      if (pw) passwort.setzen(pw, 'smtp');
      return json(res, 200, { ok: true });
    }
    if (post && p === '/api/smtp/testen') return json(res, 200, { text: await fachlich(() => versand.testen()) });
    if (post && p === '/api/mail/senden') {
      const m = await jsonLesen(req);
      kontext(req, w);
      const r = await fachlich(() => versand.senden(m));
      senden('aktualisiert');
      return json(res, 200, r);
    }
    if (post && p === '/api/mail/abrufen') return json(res, 200, await fachlich(() => ein.mailAbrufen()));
    throw new Fehler(404, 'Unbekannte Adresse.');
  }

  // User management: every user may manage users (same rights for all). Not possible in local mode.
  function serverFunktion(fn, args, w) {
    if (fn === 'meineAufgaben') return o.modus === 'server' ? roh.meineAufgaben(w.benutzer.id) : [];
    if (o.modus !== 'server') throw new Fehler(400, 'Benutzer gibt es nur auf dem Server.');
    if (fn === 'benutzerListe') return auth.liste();
    if (fn === 'benutzerAnlegen') return auth.anlegen(args[0] ?? {});
    if (fn === 'benutzerAendern') return auth.aendern(Number(args[0]), args[1] ?? {});
    if (fn === 'claudeToken') return auth.claudeToken(w.benutzer.id);
    if (fn === 'passkeyListe') return passkeys.liste(w.benutzer.id);
    if (fn === 'personEinladen') return auth.einladen(args[0] ?? {});
    if (fn === 'einladungErneuern') return auth.einladungErneuern(Number(args[0]));
    if (fn === 'passkeyLoeschen') return passkeys.loeschen(w.benutzer.id, args[0]);
    if (fn === 'kalenderAbo') return { token: auth.kalenderToken(w.benutzer.id) };
    throw new Fehler(400, `Unbekannte Funktion: ${fn}`);
  }

  const server = http.createServer((req, res) => {
    bearbeiten(req, res).catch((e) => {
      const status = e instanceof Fehler ? e.status : 500;
      if (status === 500) console.error(req.method, req.url, e);
      if (!res.headersSent) json(res, status, { fehler: String(e?.message ?? e), ...(e?.konflikt ? { konflikt: e.konflikt } : {}), ...(e?.bestaetigen ? { bestaetigen: e.bestaetigen } : {}) });
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
    serverWarnungen,
    dokumentOrdner,
    importieren: (pfade, opt) => { const r = ana.importieren(pfade, opt); senden('aktualisiert'); return r; },
    eingangsordnerSetzen: (pfad) => { dbSystem.setzeEinstellungen({ eingangsordner: pfad || null }); ein.ordnerSetzen(pfad || null); },
    beenden: async () => {
      clearTimeout(t1); clearInterval(t2); clearInterval(t3); clearInterval(tPuls); clearInterval(tVersion);
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
