// Backups: writing them with their state, checking a file before it replaces the database, listing backups by the
// newest change they contain, the daily automatic backup and the restore itself. No Electron here, so the steps can
// be tested on their own (scripts/sicherungstest.cjs).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { open, datenStand, SCHEMA_VERSION } = require('./db.cjs');
const ortszeit = require('./zeit.cjs');

const stempel = () => ortszeit.lokalZeit().replace(/:/g, '-').replace('T', '_');
const AUTO = /^Mietshaus-auto-.*\.sqlite$/;

// Consistent copy of the open database (VACUUM INTO works while it is in use), marked with time and device.
function schreiben(rawDb, ziel, geraet) {
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  fs.rmSync(ziel, { force: true });
  rawDb.prepare('VACUUM INTO ?').run(ziel);
  const k = new DatabaseSync(ziel);
  try {
    const st = k.prepare(`INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?) ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert`);
    st.run('sicherung_erstellt', new Date().toISOString());
    st.run('sicherung_geraet', geraet?.name ?? null);
  } finally {
    k.close();
  }
  return ziel;
}

// Reads a backup without changing it. With gruendlich, the whole file is checked for damage (takes a moment).
// Throws an error the user can read when the file is no Mietshaus database.
function pruefen(datei, { gruendlich = true } = {}) {
  let k;
  try {
    k = new DatabaseSync(datei, { readOnly: true });
    k.prepare('SELECT count(*) FROM sqlite_master').get();
  } catch {
    k?.close();
    throw new Error(`„${path.basename(datei)}“ ist keine Datenbank-Datei.`);
  }
  try {
    if (gruendlich) {
      const r = k.prepare('PRAGMA quick_check').all().map((x) => Object.values(x)[0]);
      if (r[0] !== 'ok') throw new Error(`„${path.basename(datei)}“ ist beschädigt (${r.slice(0, 3).join('; ')}).`);
    }
    const tabellen = new Set(k.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((t) => t.name));
    if (!['objekte', 'einheiten', 'personen', 'buchungen', 'einstellungen'].every((t) => tabellen.has(t)))
      throw new Error(`„${path.basename(datei)}“ ist keine Mietshaus-Sicherung.`);
    const stand = datenStand(k);
    if (stand.version > SCHEMA_VERSION)
      throw new Error(`„${path.basename(datei)}“ stammt aus einer neueren Mietshaus-Version. Bitte zuerst Mietshaus aktualisieren.`);
    // Old backups without any recorded change: the time the backup was made, or the file's date.
    if (!stand.zeit) stand.zeit = stand.sicherung_erstellt ?? fs.statSync(datei).mtime.toISOString();
    return { datei, ...stand };
  } finally {
    k.close();
  }
}

const pruefenOhneFehler = (datei) => { try { return pruefen(datei, { gruendlich: false }); } catch { return null; } };

// Backups in the given folders, newest state first; unreadable files and the database in use (ohne) are left out.
function liste(ordner, { ohne = [] } = {}) {
  const gesehen = new Set(ohne.map((d) => path.resolve(d)));
  const r = [];
  for (const o of ordner) {
    let namen = [];
    try { namen = fs.readdirSync(o); } catch { continue; }
    for (const n of namen) {
      const datei = path.resolve(o, n);
      if (!/\.sqlite$/i.test(n) || gesehen.has(datei)) continue;
      gesehen.add(datei);
      try { r.push(pruefen(datei, { gruendlich: false })); } catch {}
    }
  }
  return r.sort((a, b) => (b.zeit ?? '').localeCompare(a.zeit ?? ''));
}

// Daily backup into the backup folder: the last 14 days, then one per month for a year.
function automatisch(rawDb, ordner, geraet, jetzt = new Date()) {
  let namen = [];
  try { namen = fs.readdirSync(ordner).filter((n) => AUTO.test(n)).sort(); } catch {}
  const letzte = namen.length ? fs.statSync(path.join(ordner, namen[namen.length - 1])).mtimeMs : 0;
  if (jetzt.getTime() - letzte < 20 * 3600_000) return null;
  const ziel = schreiben(rawDb, path.join(ordner, `Mietshaus-auto-${stempel()}.sqlite`), geraet);
  aufraeumen(ordner, jetzt);
  return ziel;
}

function aufraeumen(ordner, jetzt = new Date()) {
  const namen = fs.readdirSync(ordner).filter((n) => AUTO.test(n)).sort().reverse();
  const behalten = new Set(namen.slice(0, 14));
  const monate = new Set();
  const grenze = new Date(jetzt);
  grenze.setFullYear(grenze.getFullYear() - 1);
  for (const n of namen.slice(14)) {
    const monat = n.slice('Mietshaus-auto-'.length, 'Mietshaus-auto-'.length + 7);
    if (!monate.has(monat) && monat >= ortszeit.lokalDatum(grenze).slice(0, 7)) {
      monate.add(monat);
      behalten.add(n);
    }
  }
  for (const n of namen) if (!behalten.has(n)) fs.rmSync(path.join(ordner, n), { force: true });
}

// Replaces the database file by a backup. The current state is saved first; the backup is copied and brought to the
// current schema beside the database, so a file that cannot be opened never replaces it. If anything fails after the
// old file was removed, the saved state is put back. schliessen/oeffnen close and reopen the app's connection.
function einspielen({ quelle, dbFile, rawDb, geraet, schliessen, oeffnen }) {
  const vorher = schreiben(rawDb, path.join(path.dirname(path.resolve(dbFile)), 'sicherungen', `Mietshaus-vor-Wiederherstellung-${stempel()}.sqlite`), geraet);
  const neu = `${dbFile}.neu`;
  const weg = (basis) => { for (const s of ['', '-wal', '-shm']) fs.rmSync(basis + s, { force: true }); };
  const datenbankId = datenStand(rawDb).datenbank_id;
  weg(neu);
  fs.copyFileSync(quelle, neu);
  try {
    const k = open(neu, 'app', geraet, { ohneUpdateSicherung: true });
    // A backup from before 0.9.1 gets an id of its own while being migrated; it belongs to this data set.
    if (datenbankId && pruefenOhneFehler(quelle)?.datenbank_id == null)
      k.prepare(`UPDATE einstellungen SET wert = ? WHERE schluessel = 'datenbank_id'`).run(datenbankId);
    k.close();
  } catch (e) {
    weg(neu);
    throw new Error(`Die Sicherung lässt sich nicht öffnen: ${e?.message ?? e}. Der bisherige Datenbestand bleibt unverändert.`);
  }
  schliessen();
  try {
    weg(dbFile);
    fs.renameSync(neu, dbFile);
    weg(neu);
    oeffnen();
  } catch (e) {
    weg(dbFile);
    fs.copyFileSync(vorher, dbFile);
    oeffnen();
    throw new Error(`Wiederherstellen fehlgeschlagen (${e?.message ?? e}). Der vorherige Stand wurde zurückgeholt.`);
  }
  return { vorher };
}

module.exports = { schreiben, pruefen, liste, automatisch, aufraeumen, einspielen };
