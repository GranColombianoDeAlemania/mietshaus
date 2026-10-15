// Local SQLite database: schema migrations and a small whitelisted CRUD layer.
const { DatabaseSync } = require('node:sqlite');
const buchhaltung = require('./buchhaltung.cjs');
const abrechnung = require('./abrechnung.cjs');

const MIGRATIONS = [
  `
  CREATE TABLE objekte (
    id INTEGER PRIMARY KEY,
    bezeichnung TEXT NOT NULL,
    art TEXT NOT NULL CHECK (art IN ('miete','weg','gemischt')),
    strasse TEXT, plz TEXT, ort TEXT,
    baujahr INTEGER,
    wj_beginn TEXT NOT NULL DEFAULT '01-01',
    iban TEXT, bic TEXT, bank TEXT,
    ruecklage_iban TEXT,
    sepa_glaeubiger_id TEXT,
    hausmeister TEXT,
    notiz TEXT,
    erstellt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE einheiten (
    id INTEGER PRIMARY KEY,
    objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
    nr INTEGER NOT NULL,
    bezeichnung TEXT NOT NULL,
    art TEXT NOT NULL DEFAULT 'Wohnung',
    lage TEXT,
    wohnflaeche REAL,
    zimmer REAL,
    mea REAL,
    notiz TEXT,
    UNIQUE (objekt_id, nr)
  );
  CREATE TABLE personen (
    id INTEGER PRIMARY KEY,
    anrede TEXT, titel TEXT, vorname TEXT, nachname TEXT, firma TEXT,
    strasse TEXT, plz TEXT, ort TEXT, land TEXT DEFAULT 'Deutschland',
    telefon TEXT, mobil TEXT, email TEXT,
    iban TEXT, bic TEXT, kontoinhaber TEXT,
    geburtsdatum TEXT,
    notiz TEXT
  );
  CREATE TABLE mietverhaeltnisse (
    id INTEGER PRIMARY KEY,
    einheit_id INTEGER NOT NULL REFERENCES einheiten(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES personen(id),
    person2_id INTEGER REFERENCES personen(id),
    beginn TEXT NOT NULL,
    ende TEXT,
    kaltmiete_ct INTEGER NOT NULL DEFAULT 0,
    bk_vz_ct INTEGER NOT NULL DEFAULT 0,
    hk_vz_ct INTEGER NOT NULL DEFAULT 0,
    sonstiges_ct INTEGER NOT NULL DEFAULT 0,
    kaution_ct INTEGER NOT NULL DEFAULT 0,
    personen_anzahl REAL NOT NULL DEFAULT 1,
    faelligkeitstag INTEGER NOT NULL DEFAULT 3,
    lastschrift INTEGER NOT NULL DEFAULT 0,
    sepa_mandat TEXT,
    notiz TEXT
  );
  CREATE TABLE eigentum (
    id INTEGER PRIMARY KEY,
    einheit_id INTEGER NOT NULL REFERENCES einheiten(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES personen(id),
    person2_id INTEGER REFERENCES personen(id),
    beginn TEXT NOT NULL,
    ende TEXT,
    hausgeld_ct INTEGER NOT NULL DEFAULT 0,
    ruecklage_ct INTEGER NOT NULL DEFAULT 0,
    selbstnutzer INTEGER NOT NULL DEFAULT 0,
    faelligkeitstag INTEGER NOT NULL DEFAULT 1,
    lastschrift INTEGER NOT NULL DEFAULT 0,
    sepa_mandat TEXT,
    notiz TEXT
  );
  CREATE TABLE umlageschluessel (
    id INTEGER PRIMARY KEY,
    objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
    bezeichnung TEXT NOT NULL,
    einheit TEXT,
    typ TEXT NOT NULL CHECK (typ IN ('flaeche','mea','einheiten','personen','manuell'))
  );
  CREATE TABLE schluesselwerte (
    schluessel_id INTEGER NOT NULL REFERENCES umlageschluessel(id) ON DELETE CASCADE,
    einheit_id INTEGER NOT NULL REFERENCES einheiten(id) ON DELETE CASCADE,
    wert REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (schluessel_id, einheit_id)
  );
  `,
  `
  CREATE TABLE konten (
    id INTEGER PRIMARY KEY,
    objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
    nr INTEGER NOT NULL,
    bezeichnung TEXT NOT NULL,
    klasse TEXT NOT NULL CHECK (klasse IN ('geld','kosten','einnahme','ruecklage','person')),
    kategorie TEXT,
    umlagefaehig INTEGER NOT NULL DEFAULT 0,
    heizkosten INTEGER NOT NULL DEFAULT 0,
    schluessel_id INTEGER REFERENCES umlageschluessel(id) ON DELETE SET NULL,
    weg_schluessel_id INTEGER REFERENCES umlageschluessel(id) ON DELETE SET NULL,
    aus_ruecklage INTEGER NOT NULL DEFAULT 0,
    p35a TEXT,
    iban TEXT,
    vertrag_typ TEXT CHECK (vertrag_typ IN ('miete','weg')),
    vertrag_id INTEGER,
    inaktiv INTEGER NOT NULL DEFAULT 0,
    UNIQUE (objekt_id, nr)
  );
  CREATE UNIQUE INDEX konten_vertrag ON konten (vertrag_typ, vertrag_id) WHERE vertrag_id IS NOT NULL;

  CREATE TABLE buchungen (
    id INTEGER PRIMARY KEY,
    objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
    datum TEXT NOT NULL,
    beleg TEXT,
    text TEXT,
    betrag_ct INTEGER NOT NULL CHECK (betrag_ct > 0),
    soll_id INTEGER NOT NULL REFERENCES konten(id),
    haben_id INTEGER NOT NULL REFERENCES konten(id),
    art TEXT NOT NULL DEFAULT 'manuell',
    monat TEXT,
    gruppe INTEGER,
    import_ref TEXT UNIQUE,
    erfasst TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (soll_id <> haben_id)
  );
  CREATE INDEX buchungen_datum ON buchungen (objekt_id, datum);
  CREATE INDEX buchungen_soll ON buchungen (soll_id);
  CREATE INDEX buchungen_haben ON buchungen (haben_id);

  -- Amount changes over time (stepped/indexed rent, new advance payments, new house money).
  CREATE TABLE anpassungen (
    id INTEGER PRIMARY KEY,
    vertrag_typ TEXT NOT NULL CHECK (vertrag_typ IN ('miete','weg')),
    vertrag_id INTEGER NOT NULL,
    gueltig_ab TEXT NOT NULL,
    grund TEXT NOT NULL DEFAULT 'manuell',
    kaltmiete_ct INTEGER, bk_vz_ct INTEGER, hk_vz_ct INTEGER, sonstiges_ct INTEGER,
    hausgeld_ct INTEGER, ruecklage_ct INTEGER,
    notiz TEXT,
    UNIQUE (vertrag_typ, vertrag_id, gueltig_ab)
  );

  CREATE TABLE zaehler (
    id INTEGER PRIMARY KEY,
    objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
    einheit_id INTEGER REFERENCES einheiten(id) ON DELETE CASCADE,
    art TEXT NOT NULL,
    nummer TEXT,
    ort TEXT,
    einheit TEXT,
    faktor REAL NOT NULL DEFAULT 1,
    einbau TEXT, ausbau TEXT, eichung_bis TEXT,
    notiz TEXT
  );
  CREATE TABLE zaehlerstaende (
    id INTEGER PRIMARY KEY,
    zaehler_id INTEGER NOT NULL REFERENCES zaehler(id) ON DELETE CASCADE,
    datum TEXT NOT NULL,
    stand REAL NOT NULL,
    notiz TEXT,
    UNIQUE (zaehler_id, datum)
  );

  CREATE TABLE mahnungen (
    id INTEGER PRIMARY KEY,
    konto_id INTEGER NOT NULL REFERENCES konten(id) ON DELETE CASCADE,
    datum TEXT NOT NULL,
    stufe INTEGER NOT NULL,
    offen_ct INTEGER NOT NULL,
    gebuehr_ct INTEGER NOT NULL DEFAULT 0,
    frist TEXT
  );

  CREATE TABLE bankregeln (
    id INTEGER PRIMARY KEY,
    objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
    muster TEXT NOT NULL,
    konto_id INTEGER NOT NULL REFERENCES konten(id) ON DELETE CASCADE,
    UNIQUE (objekt_id, muster)
  );

  -- Allocation keys may now come from meter consumption.
  CREATE TABLE umlageschluessel_neu (
    id INTEGER PRIMARY KEY,
    objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
    bezeichnung TEXT NOT NULL,
    einheit TEXT,
    typ TEXT NOT NULL CHECK (typ IN ('flaeche','mea','einheiten','personen','manuell','zaehler')),
    zaehler_art TEXT
  );
  INSERT INTO umlageschluessel_neu (id, objekt_id, bezeichnung, einheit, typ)
    SELECT id, objekt_id, bezeichnung, einheit, typ FROM umlageschluessel;
  DROP TABLE umlageschluessel;
  ALTER TABLE umlageschluessel_neu RENAME TO umlageschluessel;

  -- Which standard account groups ('miete', 'weg') were already created for the object.
  ALTER TABLE objekte ADD COLUMN kontenplan TEXT NOT NULL DEFAULT '';

  CREATE TABLE einstellungen (schluessel TEXT PRIMARY KEY, wert TEXT);
  `,
  `
  -- Saved statements and budget plans, kept as a snapshot for reprinting.
  CREATE TABLE abrechnungen (
    id INTEGER PRIMARY KEY,
    objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
    typ TEXT NOT NULL,
    von TEXT, bis TEXT,
    titel TEXT,
    daten TEXT NOT NULL,
    gebucht INTEGER NOT NULL DEFAULT 0,
    erstellt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];

// Columns the renderer may write, per table. Everything else is rejected.
const TABLES = {
  objekte: ['bezeichnung', 'art', 'strasse', 'plz', 'ort', 'baujahr', 'wj_beginn', 'iban', 'bic', 'bank',
    'ruecklage_iban', 'sepa_glaeubiger_id', 'hausmeister', 'notiz'],
  einheiten: ['objekt_id', 'nr', 'bezeichnung', 'art', 'lage', 'wohnflaeche', 'zimmer', 'mea', 'notiz'],
  personen: ['anrede', 'titel', 'vorname', 'nachname', 'firma', 'strasse', 'plz', 'ort', 'land', 'telefon',
    'mobil', 'email', 'iban', 'bic', 'kontoinhaber', 'geburtsdatum', 'notiz'],
  mietverhaeltnisse: ['einheit_id', 'person_id', 'person2_id', 'beginn', 'ende', 'kaltmiete_ct', 'bk_vz_ct',
    'hk_vz_ct', 'sonstiges_ct', 'kaution_ct', 'personen_anzahl', 'faelligkeitstag', 'lastschrift', 'sepa_mandat', 'notiz'],
  eigentum: ['einheit_id', 'person_id', 'person2_id', 'beginn', 'ende', 'hausgeld_ct', 'ruecklage_ct',
    'selbstnutzer', 'faelligkeitstag', 'lastschrift', 'sepa_mandat', 'notiz'],
  umlageschluessel: ['objekt_id', 'bezeichnung', 'einheit', 'typ', 'zaehler_art'],
  konten: ['objekt_id', 'nr', 'bezeichnung', 'klasse', 'kategorie', 'umlagefaehig', 'heizkosten', 'schluessel_id',
    'weg_schluessel_id', 'aus_ruecklage', 'p35a', 'iban', 'inaktiv'],
  anpassungen: ['vertrag_typ', 'vertrag_id', 'gueltig_ab', 'grund', 'kaltmiete_ct', 'bk_vz_ct', 'hk_vz_ct',
    'sonstiges_ct', 'hausgeld_ct', 'ruecklage_ct', 'notiz'],
  zaehler: ['objekt_id', 'einheit_id', 'art', 'nummer', 'ort', 'einheit', 'faktor', 'einbau', 'ausbau', 'eichung_bis', 'notiz'],
  zaehlerstaende: ['zaehler_id', 'datum', 'stand', 'notiz'],
  bankregeln: ['objekt_id', 'muster', 'konto_id'],
};

const PERSON_NAME = `trim(coalesce(p.nachname,'') || coalesce(', ' || p.vorname,'') ||
  CASE WHEN p.firma IS NOT NULL AND p.firma <> '' THEN ' (' || p.firma || ')' ELSE '' END)`;

// A contract is current when it has started and not yet ended.
const aktuell = (a) => `${a}.beginn <= date('now') AND (${a}.ende IS NULL OR ${a}.ende = '' OR ${a}.ende >= date('now'))`;

function open(file) {
  const db = new DatabaseSync(file);
  // Foreign keys stay off while migrations rebuild tables, so cascades cannot fire.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function api(db) {
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const tx = (fn) => {
    db.exec('BEGIN');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  function save(table, row) {
    const cols = TABLES[table];
    if (!cols) throw new Error(`Unbekannte Tabelle: ${table}`);
    const keys = cols.filter((c) => c in row);
    const vals = keys.map((k) => (row[k] === '' || row[k] === undefined ? null : row[k]));
    if (row.id) {
      if (keys.length) db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...vals, row.id);
      return row.id;
    }
    const r = db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...vals);
    return Number(r.lastInsertRowid);
  }

  function remove(table, id) {
    if (!TABLES[table]) throw new Error(`Unbekannte Tabelle: ${table}`);
    if (table === 'personen') {
      const used = get(`SELECT
        (SELECT count(*) FROM mietverhaeltnisse WHERE person_id = ?1 OR person2_id = ?1) +
        (SELECT count(*) FROM eigentum WHERE person_id = ?1 OR person2_id = ?1) AS n`, id).n;
      if (used) throw new Error('Diese Person ist noch einem Miet- oder Eigentumsverhältnis zugeordnet.');
    }
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  }

  // Object types visible in each mode: mixed houses appear in both.
  const artenFuer = (modus) => (modus === 'weg' ? ['weg', 'gemischt'] : ['miete', 'gemischt']);

  const bh = buchhaltung({ db, all, get, tx, save, aktuell, PERSON_NAME });
  bh.syncKonten();
  const ab = abrechnung({ db, all, get, tx, PERSON_NAME, bh });

  // Master data changes can create or rename accounts.
  const SYNC = new Set(['objekte', 'einheiten', 'personen', 'mietverhaeltnisse', 'eigentum']);

  const basis = {
    einstellungen: () => Object.fromEntries(all('SELECT schluessel, wert FROM einstellungen').map((r) => [r.schluessel, r.wert])),
    setzeEinstellungen: (werte) => tx(() => {
      const st = db.prepare(`INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?)
        ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert`);
      for (const [k, v] of Object.entries(werte)) st.run(k, v == null ? null : String(v));
    }),
    save: (table, row) => {
      const id = save(table, row);
      if (SYNC.has(table)) bh.syncKonten();
      return id;
    },
    remove: (table, id) => {
      if (table === 'mietverhaeltnisse' || table === 'eigentum') {
        const typ = table === 'eigentum' ? 'weg' : 'miete';
        if (get(`SELECT count(*) AS n FROM buchungen b JOIN konten k ON k.id IN (b.soll_id, b.haben_id)
          WHERE k.vertrag_typ = ? AND k.vertrag_id = ?`, typ, id).n)
          throw new Error('Zu diesem Vertrag gibt es Buchungen. Trage stattdessen ein Vertragsende ein.');
      }
      if (table === 'einheiten' && get(`SELECT count(*) AS n FROM buchungen b JOIN konten k ON k.id IN (b.soll_id, b.haben_id)
          WHERE (k.vertrag_typ = 'miete' AND k.vertrag_id IN (SELECT id FROM mietverhaeltnisse WHERE einheit_id = ?1))
             OR (k.vertrag_typ = 'weg' AND k.vertrag_id IN (SELECT id FROM eigentum WHERE einheit_id = ?1))`, id).n)
        throw new Error('Für Verträge dieser Einheit gibt es Buchungen; die Einheit kann nicht gelöscht werden.');
      remove(table, id);
      if (SYNC.has(table)) bh.syncKonten();
    },
    get: (table, id) => {
      if (!TABLES[table]) throw new Error(`Unbekannte Tabelle: ${table}`);
      return get(`SELECT * FROM ${table} WHERE id = ?`, id);
    },

    objekte: (modus) => {
      const [a, b] = artenFuer(modus);
      return all(`SELECT o.*,
          (SELECT count(*) FROM einheiten e WHERE e.objekt_id = o.id) AS anzahl_einheiten,
          (SELECT round(sum(wohnflaeche), 2) FROM einheiten e WHERE e.objekt_id = o.id) AS flaeche
        FROM objekte o WHERE o.art IN (?, ?) ORDER BY o.bezeichnung`, a, b);
    },

    // Units with their current tenant and owner, so both modes can show the other side.
    einheiten: (objektId) => all(`SELECT e.*,
        (SELECT ${PERSON_NAME} FROM mietverhaeltnisse m JOIN personen p ON p.id = m.person_id
          WHERE m.einheit_id = e.id AND ${aktuell('m')} ORDER BY m.beginn DESC LIMIT 1) AS mieter,
        (SELECT ${PERSON_NAME} FROM eigentum g JOIN personen p ON p.id = g.person_id
          WHERE g.einheit_id = e.id AND ${aktuell('g')} ORDER BY g.beginn DESC LIMIT 1) AS eigentuemer,
        (SELECT max(g.selbstnutzer) FROM eigentum g WHERE g.einheit_id = e.id AND ${aktuell('g')}) AS selbstgenutzt
      FROM einheiten e WHERE e.objekt_id = ? ORDER BY e.nr`, objektId),

    personen: () => all(`SELECT p.*, ${PERSON_NAME} AS name,
        (SELECT count(*) FROM mietverhaeltnisse m WHERE m.person_id = p.id OR m.person2_id = p.id) AS anz_miete,
        (SELECT count(*) FROM eigentum g WHERE g.person_id = p.id OR g.person2_id = p.id) AS anz_eigentum
      FROM personen p ORDER BY p.nachname, p.vorname, p.firma`),

    vertraege: (table, objektId) => {
      if (table !== 'mietverhaeltnisse' && table !== 'eigentum') throw new Error('Ungültige Vertragsart');
      return all(`SELECT v.*, e.nr AS einheit_nr, e.bezeichnung AS einheit, ${PERSON_NAME} AS name,
          CASE WHEN ${aktuell('v')} THEN 1 ELSE 0 END AS aktuell
        FROM ${table} v JOIN einheiten e ON e.id = v.einheit_id JOIN personen p ON p.id = v.person_id
        WHERE e.objekt_id = ? ORDER BY e.nr, v.beginn DESC`, objektId);
    },

    schluessel: (objektId) => {
      const keys = all('SELECT * FROM umlageschluessel WHERE objekt_id = ? ORDER BY id', objektId);
      const werte = all(`SELECT w.* FROM schluesselwerte w JOIN umlageschluessel s ON s.id = w.schluessel_id
        WHERE s.objekt_id = ?`, objektId);
      return keys.map((k) => ({
        ...k,
        werte: Object.fromEntries(werte.filter((w) => w.schluessel_id === k.id).map((w) => [w.einheit_id, w.wert])),
      }));
    },

    setzeWerte: (schluesselId, werte) => tx(() => {
      const st = db.prepare(`INSERT INTO schluesselwerte (schluessel_id, einheit_id, wert) VALUES (?, ?, ?)
        ON CONFLICT (schluessel_id, einheit_id) DO UPDATE SET wert = excluded.wert`);
      for (const [einheitId, wert] of Object.entries(werte)) st.run(schluesselId, Number(einheitId), Number(wert) || 0);
    }),

    // Fills a key's shares from master data according to its type.
    werteAusStammdaten: (schluesselId) => tx(() => {
      const k = get('SELECT * FROM umlageschluessel WHERE id = ?', schluesselId);
      if (!k || k.typ === 'manuell') return;
      const expr = {
        flaeche: 'coalesce(e.wohnflaeche, 0)',
        mea: 'coalesce(e.mea, 0)',
        einheiten: '1',
        personen: `coalesce((SELECT sum(m.personen_anzahl) FROM mietverhaeltnisse m
          WHERE m.einheit_id = e.id AND ${aktuell('m')}), 0)`,
      }[k.typ];
      // Meter-based keys are computed per statement period, not stored.
      if (!expr) return;
      db.prepare(`INSERT INTO schluesselwerte (schluessel_id, einheit_id, wert)
        SELECT ?, e.id, ${expr} FROM einheiten e WHERE e.objekt_id = ?
        ON CONFLICT (schluessel_id, einheit_id) DO UPDATE SET wert = excluded.wert`).run(k.id, k.objekt_id);
    }),

    // New objects get the standard keys every statement needs.
    neuesObjekt: (row) => tx(() => {
      const id = save('objekte', row);
      const st = db.prepare('INSERT INTO umlageschluessel (objekt_id, bezeichnung, einheit, typ) VALUES (?, ?, ?, ?)');
      st.run(id, 'Wohnfläche', 'm²', 'flaeche');
      st.run(id, 'Einheiten', 'Stk.', 'einheiten');
      if (row.art !== 'weg') st.run(id, 'Personen', 'Pers.', 'personen');
      if (row.art !== 'miete') st.run(id, 'Miteigentumsanteile', 'MEA', 'mea');
      bh.syncKonten();
      return id;
    }),

    uebersicht: (modus) => {
      const [a, b] = artenFuer(modus);
      const vt = modus === 'weg' ? 'eigentum' : 'mietverhaeltnisse';
      const summe = modus === 'weg' ? 'hausgeld_ct' : 'kaltmiete_ct + bk_vz_ct + hk_vz_ct + sonstiges_ct';
      return get(`SELECT
        (SELECT count(*) FROM objekte WHERE art IN (?1, ?2)) AS objekte,
        (SELECT count(*) FROM einheiten e JOIN objekte o ON o.id = e.objekt_id WHERE o.art IN (?1, ?2)) AS einheiten,
        (SELECT count(*) FROM ${vt} v JOIN einheiten e ON e.id = v.einheit_id JOIN objekte o ON o.id = e.objekt_id
          WHERE o.art IN (?1, ?2) AND ${aktuell('v')}) AS vertraege,
        (SELECT coalesce(sum(${summe}), 0) FROM ${vt} v JOIN einheiten e ON e.id = v.einheit_id
          JOIN objekte o ON o.id = e.objekt_id WHERE o.art IN (?1, ?2) AND ${aktuell('v')}) AS soll_monat_ct,
        (SELECT count(*) FROM einheiten e JOIN objekte o ON o.id = e.objekt_id WHERE o.art IN (?1, ?2)
          AND NOT EXISTS (SELECT 1 FROM ${vt} v WHERE v.einheit_id = e.id AND ${aktuell('v')})) AS leer`, a, b);
    },
  };
  return { ...bh, ...ab, ...basis };
}

module.exports = { open, api };
