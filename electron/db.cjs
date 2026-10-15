// Local SQLite database: schema migrations and a small whitelisted CRUD layer.
const { DatabaseSync } = require('node:sqlite');
const buchhaltung = require('./buchhaltung.cjs');
const abrechnung = require('./abrechnung.cjs');
const verwaltung = require('./verwaltung.cjs');
const archiv = require('./archiv.cjs');
const automatik = require('./automatik.cjs');
const projekte = require('./projekte.cjs');
const auswertung = require('./auswertung.cjs');
const akten = require('./akten.cjs');
const darlehen = require('./darlehen.cjs');

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
  `
  -- Phase 8: tenancy extras.
  CREATE TABLE kautionen (
    id INTEGER PRIMARY KEY,
    vertrag_id INTEGER NOT NULL UNIQUE REFERENCES mietverhaeltnisse(id) ON DELETE CASCADE,
    art TEXT NOT NULL DEFAULT 'konto',
    bank TEXT, iban TEXT, zinssatz REAL,
    notiz TEXT
  );
  CREATE TABLE kautionsbewegungen (
    id INTEGER PRIMARY KEY,
    kaution_id INTEGER NOT NULL REFERENCES kautionen(id) ON DELETE CASCADE,
    datum TEXT NOT NULL,
    art TEXT NOT NULL,
    betrag_ct INTEGER NOT NULL,
    text TEXT
  );
  CREATE TABLE indexwerte (monat TEXT PRIMARY KEY, wert REAL NOT NULL);
  CREATE TABLE mietmodelle (
    vertrag_id INTEGER PRIMARY KEY REFERENCES mietverhaeltnisse(id) ON DELETE CASCADE,
    art TEXT NOT NULL CHECK (art IN ('index','staffel')),
    basis_monat TEXT,
    mindestabstand_monate INTEGER NOT NULL DEFAULT 12
  );
  CREATE TABLE schluessel (
    id INTEGER PRIMARY KEY,
    objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
    bezeichnung TEXT NOT NULL,
    nummer TEXT,
    anzahl INTEGER NOT NULL DEFAULT 1,
    notiz TEXT
  );
  CREATE TABLE schluesselausgaben (
    id INTEGER PRIMARY KEY,
    schluessel_id INTEGER NOT NULL REFERENCES schluessel(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES personen(id),
    anzahl INTEGER NOT NULL DEFAULT 1,
    ausgabe TEXT NOT NULL,
    rueckgabe TEXT,
    notiz TEXT
  );
  CREATE TABLE versicherungen (
    id INTEGER PRIMARY KEY,
    objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
    art TEXT NOT NULL,
    gesellschaft TEXT, police TEXT,
    beitrag_ct INTEGER, faellig TEXT, kuendbar_bis TEXT, ablauf TEXT,
    notiz TEXT
  );

  -- Phase 9: owners' association.
  CREATE TABLE versammlungen (
    id INTEGER PRIMARY KEY,
    objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
    datum TEXT NOT NULL, uhrzeit TEXT, ort TEXT,
    art TEXT NOT NULL DEFAULT 'ordentlich',
    einladung_am TEXT,
    leitung TEXT, protokoll TEXT,
    notiz TEXT
  );
  CREATE TABLE tops (
    id INTEGER PRIMARY KEY,
    versammlung_id INTEGER NOT NULL REFERENCES versammlungen(id) ON DELETE CASCADE,
    nr INTEGER NOT NULL,
    titel TEXT NOT NULL,
    erlaeuterung TEXT,
    beschlussvorschlag TEXT,
    abstimmungsart TEXT NOT NULL DEFAULT 'kopf',
    ja REAL, nein REAL, enthaltung REAL,
    ergebnis TEXT,
    beschluss_id INTEGER REFERENCES beschluesse(id) ON DELETE SET NULL
  );
  CREATE TABLE beschluesse (
    id INTEGER PRIMARY KEY,
    objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
    nr INTEGER NOT NULL,
    datum TEXT NOT NULL,
    art TEXT NOT NULL DEFAULT 'versammlung',
    titel TEXT NOT NULL,
    text TEXT,
    ergebnis TEXT,
    status TEXT NOT NULL DEFAULT 'gueltig',
    vermerk TEXT,
    UNIQUE (objekt_id, nr)
  );
  CREATE TABLE rollen (
    id INTEGER PRIMARY KEY,
    objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES personen(id),
    rolle TEXT NOT NULL,
    von TEXT, bis TEXT,
    notiz TEXT
  );

  -- Phase 10/11: documents, templates, cases and appointments.
  CREATE TABLE vorlagen (
    id INTEGER PRIMARY KEY,
    titel TEXT NOT NULL,
    kategorie TEXT,
    betreff TEXT,
    text TEXT
  );
  CREATE TABLE dokumente (
    id INTEGER PRIMARY KEY,
    objekt_id INTEGER REFERENCES objekte(id) ON DELETE CASCADE,
    person_id INTEGER REFERENCES personen(id) ON DELETE SET NULL,
    einheit_id INTEGER REFERENCES einheiten(id) ON DELETE SET NULL,
    titel TEXT NOT NULL,
    kategorie TEXT,
    datum TEXT,
    datei TEXT NOT NULL,
    name TEXT,
    groesse INTEGER,
    notiz TEXT
  );
  CREATE TABLE vorgaenge (
    id INTEGER PRIMARY KEY,
    objekt_id INTEGER REFERENCES objekte(id) ON DELETE CASCADE,
    person_id INTEGER REFERENCES personen(id) ON DELETE SET NULL,
    einheit_id INTEGER REFERENCES einheiten(id) ON DELETE SET NULL,
    titel TEXT NOT NULL,
    kategorie TEXT,
    status TEXT NOT NULL DEFAULT 'offen',
    prioritaet INTEGER NOT NULL DEFAULT 2,
    faellig TEXT,
    beschreibung TEXT,
    erstellt TEXT NOT NULL DEFAULT (date('now'))
  );
  CREATE TABLE vorgangseintraege (
    id INTEGER PRIMARY KEY,
    vorgang_id INTEGER NOT NULL REFERENCES vorgaenge(id) ON DELETE CASCADE,
    datum TEXT NOT NULL,
    art TEXT NOT NULL DEFAULT 'notiz',
    text TEXT NOT NULL
  );
  CREATE TABLE termine (
    id INTEGER PRIMARY KEY,
    objekt_id INTEGER REFERENCES objekte(id) ON DELETE CASCADE,
    person_id INTEGER REFERENCES personen(id) ON DELETE SET NULL,
    vorgang_id INTEGER REFERENCES vorgaenge(id) ON DELETE SET NULL,
    titel TEXT NOT NULL,
    datum TEXT NOT NULL,
    uhrzeit TEXT, dauer_min INTEGER,
    ort TEXT,
    erledigt INTEGER NOT NULL DEFAULT 0,
    notiz TEXT
  );
  `,
  `
  -- Document archive: inbox status, recognised text and extracted fields.
  ALTER TABLE dokumente ADD COLUMN status TEXT NOT NULL DEFAULT 'abgelegt';
  ALTER TABLE dokumente ADD COLUMN typ TEXT;
  ALTER TABLE dokumente ADD COLUMN text TEXT;
  ALTER TABLE dokumente ADD COLUMN sha256 TEXT;
  ALTER TABLE dokumente ADD COLUMN seiten INTEGER;
  ALTER TABLE dokumente ADD COLUMN ocr INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE dokumente ADD COLUMN betrag_ct INTEGER;
  ALTER TABLE dokumente ADD COLUMN absender TEXT;
  ALTER TABLE dokumente ADD COLUMN rechnungsnr TEXT;
  ALTER TABLE dokumente ADD COLUMN iban TEXT;
  ALTER TABLE dokumente ADD COLUMN faellig TEXT;
  ALTER TABLE dokumente ADD COLUMN zusammenfassung TEXT;
  ALTER TABLE dokumente ADD COLUMN buchung_id INTEGER REFERENCES buchungen(id) ON DELETE SET NULL;
  ALTER TABLE dokumente ADD COLUMN quelle TEXT;
  ALTER TABLE dokumente ADD COLUMN erfasst TEXT;
  ALTER TABLE dokumente ADD COLUMN analyse TEXT NOT NULL DEFAULT 'offen';
  UPDATE dokumente SET erfasst = coalesce(datum, date('now'));
  CREATE INDEX dokumente_status ON dokumente (status);
  CREATE INDEX dokumente_sha ON dokumente (sha256);
  -- Search index over normalised text (umlauts folded), rowid = dokumente.id.
  CREATE VIRTUAL TABLE dokumente_fts USING fts5(titel, inhalt, tokenize = 'unicode61 remove_diacritics 2');
  `,
  `
  -- Hints the user snoozed (bis = date) or marked as done.
  CREATE TABLE hinweis_status (schluessel TEXT PRIMARY KEY, status TEXT NOT NULL, bis TEXT, gesetzt TEXT NOT NULL DEFAULT (datetime('now')));
  `,
  `
  -- Projects: standalone or linked to an object (then invoices can be booked in its ledger).
  CREATE TABLE projekte (
    id INTEGER PRIMARY KEY,
    titel TEXT NOT NULL,
    beschreibung TEXT,
    status TEXT NOT NULL DEFAULT 'planung',
    objekt_id INTEGER REFERENCES objekte(id) ON DELETE SET NULL,
    einheit_id INTEGER REFERENCES einheiten(id) ON DELETE SET NULL,
    kosten_konto_id INTEGER REFERENCES konten(id) ON DELETE SET NULL,
    budget_ct INTEGER,
    beginn TEXT, ende TEXT,
    notiz TEXT,
    erstellt TEXT NOT NULL DEFAULT (date('now'))
  );
  CREATE TABLE projektaufgaben (
    id INTEGER PRIMARY KEY,
    projekt_id INTEGER NOT NULL REFERENCES projekte(id) ON DELETE CASCADE,
    titel TEXT NOT NULL,
    gewerk TEXT,
    beginn TEXT NOT NULL,
    ende TEXT NOT NULL,
    fortschritt INTEGER NOT NULL DEFAULT 0,
    nach_id INTEGER REFERENCES projektaufgaben(id) ON DELETE SET NULL,
    person_id INTEGER REFERENCES personen(id) ON DELETE SET NULL,
    meilenstein INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    notiz TEXT
  );
  CREATE TABLE projektposten (
    id INTEGER PRIMARY KEY,
    projekt_id INTEGER NOT NULL REFERENCES projekte(id) ON DELETE CASCADE,
    art TEXT NOT NULL CHECK (art IN ('angebot','auftrag','rechnung','sonstiges')),
    datum TEXT,
    firma TEXT,
    person_id INTEGER REFERENCES personen(id) ON DELETE SET NULL,
    titel TEXT NOT NULL,
    betrag_ct INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'offen',
    bezahlt_am TEXT,
    faellig TEXT,
    aufgabe_id INTEGER REFERENCES projektaufgaben(id) ON DELETE SET NULL,
    dokument_id INTEGER REFERENCES dokumente(id) ON DELETE SET NULL,
    buchung_id INTEGER REFERENCES buchungen(id) ON DELETE SET NULL,
    notiz TEXT
  );
  ALTER TABLE dokumente ADD COLUMN projekt_id INTEGER REFERENCES projekte(id) ON DELETE SET NULL;
  ALTER TABLE vorgaenge ADD COLUMN projekt_id INTEGER REFERENCES projekte(id) ON DELETE CASCADE;
  ALTER TABLE termine ADD COLUMN projekt_id INTEGER REFERENCES projekte(id) ON DELETE CASCADE;
  `,
  `
  -- Purchase data for yield and depreciation, and manual tax inputs per object and year.
  ALTER TABLE objekte ADD COLUMN kaufpreis_ct INTEGER;
  ALTER TABLE objekte ADD COLUMN kaufnebenkosten_ct INTEGER;
  ALTER TABLE objekte ADD COLUMN kaufdatum TEXT;
  ALTER TABLE objekte ADD COLUMN gebaeudeanteil REAL;
  ALTER TABLE objekte ADD COLUMN afa_satz REAL;
  CREATE TABLE steuerangaben (
    objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
    jahr INTEGER NOT NULL,
    schuldzinsen_ct INTEGER, geldbeschaffung_ct INTEGER, fahrtkosten_ct INTEGER, sonstige_ct INTEGER,
    ruecklage_hausgeld_ct INTEGER,
    notiz TEXT,
    PRIMARY KEY (objekt_id, jahr)
  );
  `,
  `
  ALTER TABLE objekte ADD COLUMN titelbild_id INTEGER REFERENCES dokumente(id) ON DELETE SET NULL;
  `,
  `
  -- Loans: a new account class 'darlehen' (liability) and the loan master data.
  CREATE TABLE konten_neu (
    id INTEGER PRIMARY KEY,
    objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
    nr INTEGER NOT NULL,
    bezeichnung TEXT NOT NULL,
    klasse TEXT NOT NULL CHECK (klasse IN ('geld','kosten','einnahme','ruecklage','person','darlehen')),
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
  INSERT INTO konten_neu SELECT id, objekt_id, nr, bezeichnung, klasse, kategorie, umlagefaehig, heizkosten, schluessel_id, weg_schluessel_id,
    aus_ruecklage, p35a, iban, vertrag_typ, vertrag_id, inaktiv FROM konten;
  DROP TABLE konten;
  ALTER TABLE konten_neu RENAME TO konten;
  CREATE UNIQUE INDEX konten_vertrag ON konten (vertrag_typ, vertrag_id) WHERE vertrag_id IS NOT NULL;

  CREATE TABLE darlehen (
    id INTEGER PRIMARY KEY,
    objekt_id INTEGER NOT NULL REFERENCES objekte(id) ON DELETE CASCADE,
    bank TEXT NOT NULL,
    vertragsnr TEXT,
    betrag_ct INTEGER NOT NULL,
    auszahlung TEXT,
    zinssatz REAL NOT NULL,
    tilgung_satz REAL,
    rate_ct INTEGER,
    erste_rate TEXT NOT NULL,
    zinsbindung_bis TEXT,
    sondertilgung_ct INTEGER,
    konto_id INTEGER REFERENCES konten(id) ON DELETE SET NULL,
    notiz TEXT
  );
  `,
];

// Columns the renderer may write, per table. Everything else is rejected.
const TABLES = {
  objekte: ['bezeichnung', 'art', 'strasse', 'plz', 'ort', 'baujahr', 'wj_beginn', 'iban', 'bic', 'bank',
    'ruecklage_iban', 'sepa_glaeubiger_id', 'hausmeister', 'notiz', 'kaufpreis_ct', 'kaufnebenkosten_ct', 'kaufdatum', 'gebaeudeanteil', 'afa_satz', 'titelbild_id'],
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
  kautionen: ['vertrag_id', 'art', 'bank', 'iban', 'zinssatz', 'notiz'],
  kautionsbewegungen: ['kaution_id', 'datum', 'art', 'betrag_ct', 'text'],
  indexwerte: [],
  mietmodelle: [],
  schluessel: ['objekt_id', 'bezeichnung', 'nummer', 'anzahl', 'notiz'],
  schluesselausgaben: ['schluessel_id', 'person_id', 'anzahl', 'ausgabe', 'rueckgabe', 'notiz'],
  versicherungen: ['objekt_id', 'art', 'gesellschaft', 'police', 'beitrag_ct', 'faellig', 'kuendbar_bis', 'ablauf', 'notiz'],
  versammlungen: ['objekt_id', 'datum', 'uhrzeit', 'ort', 'art', 'einladung_am', 'leitung', 'protokoll', 'notiz'],
  tops: ['versammlung_id', 'nr', 'titel', 'erlaeuterung', 'beschlussvorschlag', 'abstimmungsart', 'ja', 'nein', 'enthaltung', 'ergebnis', 'beschluss_id'],
  beschluesse: ['objekt_id', 'nr', 'datum', 'art', 'titel', 'text', 'ergebnis', 'status', 'vermerk'],
  rollen: ['objekt_id', 'person_id', 'rolle', 'von', 'bis', 'notiz'],
  vorlagen: ['titel', 'kategorie', 'betreff', 'text'],
  dokumente: ['objekt_id', 'person_id', 'einheit_id', 'titel', 'kategorie', 'datum', 'datei', 'name', 'groesse', 'notiz',
    'status', 'typ', 'betrag_ct', 'absender', 'rechnungsnr', 'iban', 'faellig', 'zusammenfassung', 'buchung_id', 'quelle'],
  vorgaenge: ['objekt_id', 'person_id', 'einheit_id', 'titel', 'kategorie', 'status', 'prioritaet', 'faellig', 'beschreibung', 'projekt_id'],
  vorgangseintraege: ['vorgang_id', 'datum', 'art', 'text'],
  termine: ['objekt_id', 'person_id', 'vorgang_id', 'titel', 'datum', 'uhrzeit', 'dauer_min', 'ort', 'erledigt', 'notiz', 'projekt_id'],
  projekte: ['titel', 'beschreibung', 'status', 'objekt_id', 'einheit_id', 'kosten_konto_id', 'budget_ct', 'beginn', 'ende', 'notiz'],
  projektaufgaben: ['projekt_id', 'titel', 'gewerk', 'beginn', 'ende', 'fortschritt', 'nach_id', 'person_id', 'meilenstein', 'sort', 'notiz'],
  darlehen: ['objekt_id', 'bank', 'vertragsnr', 'betrag_ct', 'auszahlung', 'zinssatz', 'tilgung_satz', 'rate_ct', 'erste_rate', 'zinsbindung_bis', 'sondertilgung_ct', 'notiz'],
  projektposten: ['projekt_id', 'art', 'datum', 'firma', 'person_id', 'titel', 'betrag_ct', 'status', 'bezahlt_am', 'faellig', 'aufgabe_id', 'dokument_id', 'notiz'],
};

const PERSON_NAME = `trim(coalesce(p.nachname,'') || coalesce(', ' || p.vorname,'') ||
  CASE WHEN p.firma IS NOT NULL AND p.firma <> '' THEN ' (' || p.firma || ')' ELSE '' END)`;

// A contract is current when it has started and not yet ended.
const aktuell = (a) => `${a}.beginn <= date('now') AND (${a}.ende IS NULL OR ${a}.ende = '' OR ${a}.ende >= date('now'))`;

function open(file) {
  const db = new DatabaseSync(file);
  // Foreign keys stay off while migrations rebuild tables, so cascades cannot fire.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000;');
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
      if (get('SELECT (SELECT count(*) FROM rollen WHERE person_id = ?1) + (SELECT count(*) FROM schluesselausgaben WHERE person_id = ?1) AS n', id).n)
        throw new Error('Diese Person hat noch eine Rolle im Objekt oder ausgegebene Schlüssel.');
    }
    try {
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    } catch (e) {
      if (/FOREIGN KEY/.test(String(e.message))) throw new Error('Der Eintrag wird an anderer Stelle noch verwendet und kann nicht gelöscht werden.');
      throw e;
    }
  }

  // Object types visible in each mode: mixed houses appear in both.
  const artenFuer = (modus) => (modus === 'weg' ? ['weg', 'gemischt'] : ['miete', 'gemischt']);

  const bh = buchhaltung({ db, all, get, tx, save, aktuell, PERSON_NAME });
  bh.syncKonten();
  const ab = abrechnung({ db, all, get, tx, PERSON_NAME, bh });
  const vw = verwaltung({ db, all, get, tx, PERSON_NAME, bh });
  const ar = archiv({ db, all, get, tx, PERSON_NAME });

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
    // Lists a table, optionally filtered by whitelisted columns, e.g. liste('versicherungen', { objekt_id: 3 }).
    liste: (table, filter = {}, order = 'id') => {
      const cols = TABLES[table];
      if (!cols) throw new Error(`Unbekannte Tabelle: ${table}`);
      const keys = Object.keys(filter).filter((k) => cols.includes(k) || k === 'id');
      if (!/^[a-z_]+( DESC)?(, [a-z_]+( DESC)?)*$/.test(order)) throw new Error('Ungültige Sortierung');
      return all(`SELECT * FROM ${table} ${keys.length ? 'WHERE ' + keys.map((k) => `${k} = ?`).join(' AND ') : ''} ORDER BY ${order}`,
        ...keys.map((k) => filter[k]));
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
  const pj = projekte({ db, all, get, tx, bh });
  const aw = auswertung({ db, all, get, tx, bh });
  const ak = akten({ db, all, get, PERSON_NAME, bh });
  const dl = darlehen({ db, all, get, tx, bh });
  const au = automatik({ db, all, get, tx, PERSON_NAME, bh, ab, vw, einstellungen: basis.einstellungen });
  return {
    ...bh, ...ab, ...vw, ...ar, ...au, ...pj, ...aw, ...ak, ...dl, ...basis,
    // Bank lines paid to a loan account are booked as instalments (interest + repayment).
    bankBuchen: (objektId, geldKontoId, zeilen, lernen) => {
      const istDarlehen = (z) => z.konto_id && z.betrag_ct < 0 && dl.darlehenZuKonto(z.konto_id);
      let n = 0;
      for (const z of zeilen.filter(istDarlehen)) {
        if (get('SELECT 1 FROM buchungen WHERE import_ref = ?', z.ref)) continue;
        dl.darlehenRateBuchen(dl.darlehenZuKonto(z.konto_id).id, geldKontoId, z.datum, -z.betrag_ct, z.ref);
        n++;
      }
      return n + bh.bankBuchen(objektId, geldKontoId, zeilen.filter((z) => !istDarlehen(z)), lernen);
    },
    // Removes the record and its index entry; the caller deletes the file.
    dokumentLoeschen: (id) => {
      const d = get('SELECT datei FROM dokumente WHERE id = ?', id);
      db.prepare('DELETE FROM dokumente_fts WHERE rowid = ?').run(id);
      db.prepare('DELETE FROM dokumente WHERE id = ?').run(id);
      return d?.datei ?? null;
    },
    // Changes made elsewhere (e.g. by Claude through the MCP connection) bump this number.
    datenVersion: () => db.prepare('PRAGMA data_version').get().data_version,
  };
}

module.exports = { open, api };
