// Test of backups and restore: change time and device per record, the state of a database and of a backup, refusing
// files that are no (or a damaged, or a newer) Mietshaus database, restoring including an old 0.9.0 backup, and the
// rotation of the automatic backups.
// Run: ELECTRON_RUN_AS_NODE=1 npx electron scripts/sicherungstest.cjs
//   The old database is scripts/testdaten/mietshaus-0.9.0.sqlite, made with version 0.9.0 (object „Altbau 3“).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { open, api, datenStand, sicherungsOrdner, SCHEMA_VERSION } = require('../electron/db.cjs');
const sicherung = require('../electron/sicherung.cjs');

let richtig = 0, falsch = 0;
const pruefe = (name, ok, info = '') => { if (ok) richtig++; else { falsch++; console.log('FALSCH', name, info); } };
const wirft = (name, fn, muster) => {
  try { fn(); pruefe(name, false, 'kein Fehler'); } catch (e) { pruefe(name, muster.test(String(e.message)), e.message); }
};

const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mietshaus-sicherung-'));
const dbFile = path.join(ordner, 'mietshaus.sqlite');
const pc1 = { id: 'geraet-1', name: 'anna@mac' };
const pc2 = { id: 'geraet-2', name: 'ben@imac' };

// ---------- 1. change time and device ----------
let raw = open(dbFile, 'app', pc1);
let db = api(raw);
const o = db.neuesObjekt({ bezeichnung: 'Teststraße 1', art: 'miete', plz: '10115', ort: 'Berlin' });
const obj = () => raw.prepare('SELECT * FROM objekte WHERE id = ?').get(o);
pruefe('Anlage trägt Zeit', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(obj().geaendert_am ?? ''), obj().geaendert_am);
pruefe('Anlage trägt Gerät', obj().geaendert_von === 'geraet-1');
const p0 = raw.prepare(`SELECT count(*) AS n FROM protokoll WHERE tabelle = 'objekte' AND datensatz = ?`).get(o).n;
const vorher = obj().geaendert_am;
while (new Date().toISOString() <= vorher) {} // the next change gets a later millisecond
raw.close();
raw = open(dbFile, 'app', pc2);
db = api(raw);
db.save('objekte', { id: o, notiz: 'geändert auf PC 2' });
pruefe('Änderung setzt neue Zeit', obj().geaendert_am > vorher, `${vorher} → ${obj().geaendert_am}`);
pruefe('Änderung setzt Gerät', obj().geaendert_von === 'geraet-2');
pruefe('Stempel erzeugt keinen zweiten Protokolleintrag',
  raw.prepare(`SELECT count(*) AS n FROM protokoll WHERE tabelle = 'objekte' AND datensatz = ?`).get(o).n === p0 + 1);
pruefe('Protokoll nennt Gerät', raw.prepare(`SELECT geraet FROM protokoll ORDER BY id DESC LIMIT 1`).get().geraet === 'geraet-2');
const st = datenStand(raw);
pruefe('Stand = letzte Änderung', st.zeit === obj().geaendert_am && st.geraet_name === 'ben@imac', JSON.stringify(st));
pruefe('Datenbestand hat eine Id', /^[0-9a-f]{32}$/.test(st.datenbank_id ?? ''));

// ---------- 2. backup and check ----------
const s1 = sicherung.schreiben(raw, path.join(ordner, 'export', 'S1.sqlite'), pc2);
const p1 = sicherung.pruefen(s1);
pruefe('Sicherung kennt Stand und Gerät', p1.zeit === st.zeit && p1.sicherung_geraet === 'ben@imac' && !!p1.sicherung_erstellt);
pruefe('Sicherung gehört zum Datenbestand', p1.datenbank_id === st.datenbank_id);
const kaputt = path.join(ordner, 'kaputt.sqlite');
fs.writeFileSync(kaputt, 'kein sqlite');
wirft('Textdatei abgelehnt', () => sicherung.pruefen(kaputt), /keine Datenbank/);
const fremd = path.join(ordner, 'fremd.sqlite');
new DatabaseSync(fremd).exec('CREATE TABLE x (a); INSERT INTO x VALUES (1);');
wirft('Fremde Datenbank abgelehnt', () => sicherung.pruefen(fremd), /keine Mietshaus-Sicherung/);
const zukunft = path.join(ordner, 'zukunft.sqlite');
fs.copyFileSync(s1, zukunft);
{ const k = new DatabaseSync(zukunft); k.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`); k.close(); }
wirft('Neuere Version abgelehnt', () => sicherung.pruefen(zukunft), /neueren Mietshaus-Version/);
wirft('Neuere Version wird nicht geöffnet', () => open(zukunft), /neueren Mietshaus-Version/);

// Newest backups first, so the newest state can be offered.
db.save('objekte', { id: o, notiz: 'nach Sicherung 1' });
const s2 = sicherung.schreiben(raw, path.join(ordner, 'export', 'S2.sqlite'), pc2);
const l = sicherung.liste([path.join(ordner, 'export'), ordner], { ohne: [dbFile] });
pruefe('Liste: neueste zuerst', l[0].datei === s2 && l[1].datei === s1, l.map((x) => path.basename(x.datei)).join(', '));
pruefe('Liste: Unlesbares und die laufende Datenbank fehlen', l.length === 2 && !l.some((x) => [kaputt, fremd, dbFile].includes(x.datei)));

// ---------- 3. restore ----------
let geschlossen = 0;
const einspielen = (quelle) => sicherung.einspielen({ quelle, dbFile, rawDb: raw, geraet: pc1,
  schliessen: () => { raw.close(); geschlossen++; }, oeffnen: () => { raw = open(dbFile, 'app', pc1); db = api(raw); } });
const vorStand = datenStand(raw).zeit;
wirft('Kaputte Datei ersetzt nichts', () => einspielen(kaputt), /lässt sich nicht öffnen/);
pruefe('… Verbindung bleibt offen', geschlossen === 0 && db.get('objekte', o).notiz === 'nach Sicherung 1');
const r = einspielen(s1);
pruefe('Wiederhergestellt', db.get('objekte', o).notiz === 'geändert auf PC 2');
pruefe('Vorheriger Stand gesichert', fs.existsSync(r.vorher) && sicherung.pruefen(r.vorher).zeit === vorStand);
pruefe('Vorher-Sicherung liegt im Sicherungsordner', path.dirname(r.vorher) === sicherungsOrdner(dbFile));
pruefe('Keine Reste neben der Datenbank', !fs.existsSync(`${dbFile}.neu`));
db.save('objekte', { id: o, notiz: 'nach Wiederherstellung' });
pruefe('Danach wird weiter gestempelt', raw.prepare('SELECT geaendert_von FROM objekte WHERE id = ?').get(o).geaendert_von === 'geraet-1');

// ---------- 4. an old database (0.9.0) ----------
{
  const alt = path.join(ordner, 'alt', 'mietshaus.sqlite');
  fs.mkdirSync(path.dirname(alt), { recursive: true });
  const sAlt = path.join(ordner, 'alt', 'Sicherung-0.9.0.sqlite');
  fs.copyFileSync(path.join(__dirname, 'testdaten', 'mietshaus-0.9.0.sqlite'), sAlt);
  fs.copyFileSync(sAlt, alt);
  const pAlt = sicherung.pruefen(sAlt);
  pruefe('0.9.0-Sicherung lesbar, Stand aus dem Protokoll', !!pAlt.zeit && pAlt.datenbank_id == null && pAlt.version === 19, JSON.stringify(pAlt));
  const idVorher = datenStand(raw).datenbank_id;
  einspielen(sAlt);
  pruefe('0.9.0-Sicherung eingespielt und umgestellt', db.objekte('miete').some((x) => x.bezeichnung === 'Altbau 3')
    && raw.prepare('PRAGMA user_version').get().user_version === SCHEMA_VERSION);
  pruefe('… übernimmt die Id des Datenbestands', datenStand(raw).datenbank_id === idVorher);
  // Opening an old file directly keeps a copy from before the update.
  open(alt, 'app', pc1).close();
  pruefe('Kopie vor dem Update', fs.readdirSync(sicherungsOrdner(alt)).some((n) => /^Mietshaus-vor-Update-Schema\d+-/.test(n)));
}

// ---------- 5. automatic backups ----------
const auto = path.join(ordner, 'auto');
const erste = sicherung.automatisch(raw, auto, pc1);
pruefe('Automatische Sicherung angelegt', !!erste && fs.existsSync(erste));
pruefe('Nicht zweimal am Tag', sicherung.automatisch(raw, auto, pc1) === null);
fs.rmSync(erste);
for (let i = 0; i < 60; i++) {
  const d = new Date(2026, 9, 27 - i * 3);
  const n = `Mietshaus-auto-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_03-00-00.sqlite`;
  fs.writeFileSync(path.join(auto, n), '');
}
sicherung.aufraeumen(auto, new Date(2026, 9, 27));
const rest = fs.readdirSync(auto).sort();
const monate = new Set(rest.slice(0, -14).map((n) => n.slice(15, 22)));
pruefe('Rotation: 14 neueste + je Monat eine', rest.length === 14 + monate.size && monate.size === rest.length - 14, rest.length);
pruefe('Rotation: nichts älter als ein Jahr', rest.every((n) => n.slice(15, 22) >= '2025-10'), rest[0]);

raw.close();
fs.rmSync(ordner, { recursive: true, force: true });
console.log(`Sicherungstest: ${richtig} Prüfungen richtig, ${falsch} falsch.`);
process.exit(falsch ? 1 : 0);
