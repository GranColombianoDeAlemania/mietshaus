const ortszeit = require('./zeit.cjs');
// Document archive: inbox, recognised fields, full-text index and the global search.
// Used by the app and by the Claude Desktop connection (MCP), so it only touches the database.

// Folds umlauts and case so "Müller", "Mueller" and "muller" find each other.
const norm = (s) => String(s ?? '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '');

// Every search word must occur, each as a prefix: "heiz wart" finds "Heizungswartung" only if both are present.
const ftsAbfrage = (q) => norm(q).split(/[^a-z0-9@.]+/).filter((w) => w.length > 1).map((w) => `"${w.replace(/"/g, '')}"*`).join(' AND ');

const TYPEN = ['Rechnung', 'Gutschrift', 'Mahnung', 'Mietvertrag', 'Vertrag', 'Bescheid', 'Abrechnung', 'Kontoauszug', 'Angebot',
  'Protokoll', 'Schriftverkehr', 'Zählerablesung', 'Versicherung', 'Plan / Grundriss', 'Foto', 'Sonstiges'];

const betragAus = (s) => Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100);
const isoAus = (d, m, y) => `${y.length === 2 ? '20' + y : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;

// Rule-based field extraction for when no AI is involved: amounts, dates, IBAN, invoice number, type.
function felderErkennen(text) {
  const t = text.replace(/ /g, ' ');
  const f = {};
  const iban = /\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?)\b/.exec(t);
  if (iban) f.iban = iban[1].replace(/\s/g, '');
  const rn = /(?:Rechnungs?[- ]?(?:nummer|nr\.?)|Rg\.?-?Nr\.?|Invoice\s?(?:No|Nr)\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i.exec(t);
  if (rn) f.rechnungsnr = rn[1];
  // Total: prefer lines labelled as the amount due, otherwise the largest amount in the document.
  const summen = [...t.matchAll(/(?:Gesamtbetrag|Rechnungsbetrag|Endbetrag|zu zahlen|Gesamtsumme|Summe brutto|Bruttobetrag|Gesamt|Betrag)[^\d\n]{0,30}(\d{1,3}(?:\.\d{3})*,\d{2})/gi)].map((m) => betragAus(m[1]));
  const alle = [...t.matchAll(/(?<![\d,])(\d{1,3}(?:\.\d{3})*,\d{2})\s?(?:€|EUR)?/g)].map((m) => betragAus(m[1])).filter((n) => n > 0 && n < 1e9);
  if (summen.length) f.betrag_ct = summen[summen.length - 1];
  else if (alle.length) f.betrag_ct = Math.max(...alle);
  const daten = [...t.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/g)].map((m) => isoAus(m[1], m[2], m[3])).filter((d) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d));
  const rd = /(?:Rechnungsdatum|Datum|Bescheiddatum)[^\d\n]{0,15}(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i.exec(t);
  if (rd) f.datum = isoAus(rd[1], rd[2], rd[3]);
  else if (daten.length) f.datum = daten[0];
  const fl = /(?:zahlbar bis|fällig am|Fälligkeit|bis zum)[^\d\n]{0,15}(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i.exec(t);
  if (fl) f.faellig = isoAus(fl[1], fl[2], fl[3]);
  const n = norm(t);
  f.typ = /mietvertrag/.test(n) ? 'Mietvertrag'
    : /mahnung|zahlungserinnerung/.test(n) ? 'Mahnung'
      : /gutschrift/.test(n) ? 'Gutschrift'
        : /bescheid|finanzamt|grundsteuer/.test(n) ? 'Bescheid'
          : /rechnung|invoice|rechnungsbetrag/.test(n) ? 'Rechnung'
            : /angebot|kostenvoranschlag/.test(n) ? 'Angebot'
              : /abrechnung/.test(n) ? 'Abrechnung'
                : /kontoauszug/.test(n) ? 'Kontoauszug'
                  : /protokoll|niederschrift/.test(n) ? 'Protokoll'
                    : /police|versicherungsschein/.test(n) ? 'Versicherung'
                      : null;
  // The sender is usually in the first non-empty lines.
  const zeilen = t.split(/\n/).map((z) => z.trim()).filter((z) => z.length > 2 && !/^\d+$/.test(z));
  if (zeilen.length) f.absender = zeilen.find((z) => /gmbh|ag\b|kg\b|e\.k\.|stadtwerke|werke|amt|versicherung|bank|gbr|ohg|ug\b/i.test(z)) ?? zeilen[0];
  if (f.absender) f.absender = f.absender.slice(0, 80);
  return f;
}

module.exports = function archiv({ db, all, get, tx, PERSON_NAME }) {
  function indexieren(id) {
    const d = get('SELECT * FROM dokumente WHERE id = ?', id);
    db.prepare('DELETE FROM dokumente_fts WHERE rowid = ?').run(id);
    if (!d) return;
    const objekt = d.objekt_id ? get('SELECT bezeichnung, strasse, ort FROM objekte WHERE id = ?', d.objekt_id) : null;
    const person = d.person_id ? get(`SELECT ${PERSON_NAME} AS n FROM personen p WHERE p.id = ?`, d.person_id)?.n : '';
    const meta = [d.typ, d.kategorie, d.absender, d.rechnungsnr, d.iban, d.name, d.notiz, d.zusammenfassung, person,
      objekt && `${objekt.bezeichnung} ${objekt.strasse ?? ''} ${objekt.ort ?? ''}`, d.betrag_ct != null ? (d.betrag_ct / 100).toFixed(2).replace('.', ',') : ''].filter(Boolean).join(' ');
    db.prepare('INSERT INTO dokumente_fts (rowid, titel, inhalt) VALUES (?, ?, ?)').run(id, norm(d.titel), norm(`${meta}\n${d.text ?? ''}`));
  }

  // Guesses object, unit and person by looking for their names and addresses in the recognised text.
  function zuordnungVorschlagen(text) {
    const n = norm(text);
    const v = {};
    const objekt = all('SELECT id, bezeichnung, strasse FROM objekte').find((o) =>
      [o.strasse, o.bezeichnung].some((s) => s && norm(s).length > 4 && n.includes(norm(s).replace(/str\.?\b/, 'str'))));
    if (objekt) v.objekt_id = objekt.id;
    const personen = all('SELECT id, vorname, nachname, firma, iban FROM personen');
    const p = personen.find((x) => x.iban && n.includes(norm(x.iban).replace(/\s/g, ''))) ??
      personen.find((x) => x.nachname && x.nachname.length > 2 && new RegExp(`\\b${norm(x.nachname)}\\b`).test(n) && (!x.vorname || n.includes(norm(x.vorname)))) ??
      personen.find((x) => x.firma && x.firma.length > 3 && n.includes(norm(x.firma)));
    if (p) v.person_id = p.id;
    return v;
  }

  // Suggests the expense account from earlier invoices of the same sender.
  function kontoVorschlag(objektId, absender) {
    if (!objektId || !absender) return null;
    const r = get(`SELECT b.soll_id FROM dokumente d JOIN buchungen b ON b.id = d.buchung_id
      WHERE d.objekt_id = ? AND d.absender = ? ORDER BY d.id DESC LIMIT 1`, objektId, absender);
    return r?.soll_id ?? null;
  }

  return {
    norm,
    felderErkennen,
    dokumentTypen: () => TYPEN,

    // Stores recognised text and fills empty fields from the rule-based extraction.
    analyseSpeichern: (id, text, seiten, ocr, er = null) => tx(() => {
      const d = get('SELECT * FROM dokumente WHERE id = ?', id);
      const f = felderErkennen(text ?? '');
      const z = zuordnungVorschlagen(text ?? '');
      // E-invoice data is exact: it replaces what was guessed from the text.
      if (er) {
        db.prepare(`UPDATE dokumente SET erechnung = ?, typ = ?, betrag_ct = ?, netto_ct = ?, ust_ct = ?, datum = coalesce(?, datum), faellig = coalesce(?, faellig),
          absender = coalesce(?, absender), rechnungsnr = coalesce(?, rechnungsnr), iban = coalesce(?, iban) WHERE id = ?`)
          .run(JSON.stringify(er), er.gutschrift ? 'Gutschrift' : 'Rechnung', er.zahlbetrag_ct ?? er.brutto_ct ?? null, er.netto_ct ?? null, er.ust_ct ?? null,
            er.datum ?? null, er.faellig ?? null, er.verkaeufer?.name ?? null, er.nummer ?? null, er.iban ?? null, id);
        if (d && (!d.titel || d.titel === d.name?.replace(/\.[^.]+$/, ''))) db.prepare('UPDATE dokumente SET titel = ? WHERE id = ?')
          .run(`${er.gutschrift ? 'Gutschrift' : 'Rechnung'} ${er.verkaeufer?.name ?? ''} ${er.nummer ?? ''}`.replace(/\s+/g, ' ').trim(), id);
      }
      db.prepare(`UPDATE dokumente SET text = ?, seiten = ?, ocr = ?, analyse = 'fertig',
        typ = coalesce(typ, ?), betrag_ct = coalesce(betrag_ct, ?), datum = coalesce(datum, ?), faellig = coalesce(faellig, ?),
        absender = coalesce(absender, ?), rechnungsnr = coalesce(rechnungsnr, ?), iban = coalesce(iban, ?),
        objekt_id = coalesce(objekt_id, ?), person_id = coalesce(person_id, ?) WHERE id = ?`)
        .run(text ?? '', seiten ?? null, ocr ? 1 : 0, f.typ ?? null, f.betrag_ct ?? null, f.datum ?? null, f.faellig ?? null,
          f.absender ?? null, f.rechnungsnr ?? null, f.iban ?? null, z.objekt_id ?? null, z.person_id ?? null, id);
      if (d && !d.titel) db.prepare('UPDATE dokumente SET titel = ? WHERE id = ?').run(d.name ?? 'Dokument', id);
      indexieren(id);
    }),
    analyseFehler: (id, meldung) => db.prepare(`UPDATE dokumente SET analyse = ? WHERE id = ?`).run(`fehler: ${meldung}`.slice(0, 300), id),
    analyseZuruecksetzen: (id) => db.prepare(`UPDATE dokumente SET analyse = 'offen' WHERE id = ?`).run(id),
    zuAnalysieren: () => all(`SELECT id, datei, name FROM dokumente WHERE analyse = 'offen' ORDER BY id`),

    dokumentNeu: (row) => {
      const vorhanden = row.sha256 ? get('SELECT id, titel, status FROM dokumente WHERE sha256 = ?', row.sha256) : null;
      if (vorhanden) return { id: vorhanden.id, doppelt: true, titel: vorhanden.titel };
      const id = Number(db.prepare(`INSERT INTO dokumente (objekt_id, einheit_id, projekt_id, person_id, buchung_id, typ, titel, datei, name, groesse, sha256, status, quelle, erfasst, analyse)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, date('now', 'localtime'), 'offen')`).run(row.objekt_id ?? null, row.einheit_id ?? null, row.projekt_id ?? null,
        row.person_id ?? null, row.buchung_id ?? null, row.typ ?? null, row.titel, row.datei, row.name, row.groesse, row.sha256 ?? null, row.status ?? 'postfach', row.quelle ?? 'upload').lastInsertRowid);
      indexieren(id);
      return { id, doppelt: false };
    },

    dokumentSpeichern: (row) => {
      const cols = ['objekt_id', 'projekt_id', 'person_id', 'einheit_id', 'titel', 'kategorie', 'datum', 'notiz', 'status', 'typ', 'betrag_ct',
        'absender', 'rechnungsnr', 'iban', 'faellig', 'zusammenfassung', 'buchung_id', 'netto_ct', 'ust_ct'];
      const keys = cols.filter((c) => c in row);
      if (keys.length) db.prepare(`UPDATE dokumente SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => (row[k] === '' || row[k] === undefined ? null : row[k])), row.id);
      indexieren(row.id);
      return row.id;
    },

    // Drag & drop of a filed or inbox document onto a person, unit, contract or posting.
    dokumentZuordnen: (id, ziel) => {
      const erlaubt = ['objekt_id', 'einheit_id', 'person_id', 'buchung_id', 'projekt_id'];
      const werte = Object.fromEntries(Object.entries(ziel).filter(([k, v]) => erlaubt.includes(k) && v != null));
      const keys = Object.keys(werte);
      if (keys.length) db.prepare(`UPDATE dokumente SET ${keys.map((k) => `${k} = ?`).join(', ')}, status = 'abgelegt' WHERE id = ?`).run(...keys.map((k) => werte[k]), id);
      indexieren(id);
    },

    dokument: (id) => get(`SELECT d.*, o.bezeichnung AS objekt, e.bezeichnung AS einheit, ${PERSON_NAME} AS person,
        (SELECT b.soll_id FROM buchungen b WHERE b.id = d.buchung_id) AS buchung_konto_id, (SELECT b.datum FROM buchungen b WHERE b.id = d.buchung_id) AS buchung_datum
      FROM dokumente d LEFT JOIN objekte o ON o.id = d.objekt_id LEFT JOIN einheiten e ON e.id = d.einheit_id
      LEFT JOIN personen p ON p.id = d.person_id WHERE d.id = ?`, id),

    // Archive listing with optional full-text search; matches come with a highlighted snippet.
    dokumentListe: ({ q = '', status = null, objekt_id = null, projekt_id = null, typ = null, jahr = null, limit = 300 } = {}) => {
      const fts = ftsAbfrage(q);
      const sql = `SELECT d.id, d.titel, d.typ, d.kategorie, d.datum, d.erfasst, d.status, d.analyse, d.name, d.datei, d.groesse, d.betrag_ct,
          d.absender, d.objekt_id, d.einheit_id, d.person_id, d.buchung_id, d.ocr, d.seiten, o.bezeichnung AS objekt, e.bezeichnung AS einheit, ${PERSON_NAME} AS person,
          (SELECT min(x.id) FROM dokumente x WHERE x.id <> d.id AND x.rechnungsnr IS NOT NULL AND x.rechnungsnr = d.rechnungsnr
          AND coalesce(x.betrag_ct, -1) = coalesce(d.betrag_ct, -1) AND coalesce(x.absender, '') = coalesce(d.absender, '')) AS duplikat_von
          ${fts ? ", snippet(dokumente_fts, 1, '[', ']', ' … ', 12) AS treffer" : ''}
        FROM dokumente d ${fts ? 'JOIN dokumente_fts f ON f.rowid = d.id' : ''}
        LEFT JOIN objekte o ON o.id = d.objekt_id LEFT JOIN einheiten e ON e.id = d.einheit_id LEFT JOIN personen p ON p.id = d.person_id
        WHERE 1 = 1 ${fts ? 'AND dokumente_fts MATCH ?' : ''} ${status ? 'AND d.status = ?' : ''} ${objekt_id ? 'AND d.objekt_id = ?' : ''} ${projekt_id ? 'AND d.projekt_id = ?' : ''}
          ${typ ? 'AND d.typ = ?' : ''} ${jahr ? "AND substr(coalesce(d.datum, d.erfasst), 1, 4) = ?" : ''}
        ORDER BY ${fts ? 'rank' : "coalesce(d.datum, d.erfasst) DESC, d.id DESC"} LIMIT ?`;
      return all(sql, ...[fts || null, status, objekt_id, projekt_id, typ, jahr ? String(jahr) : null].filter((x) => x != null), limit);
    },

    // Applies the same fields to several documents and optionally files them.
    stapelAblegen: (ids, felder, ablegen) => tx(() => {
      const erlaubt = ['objekt_id', 'einheit_id', 'projekt_id', 'person_id', 'typ', 'kategorie'];
      const keys = erlaubt.filter((k) => k in felder);
      for (const id of ids) {
        if (keys.length) db.prepare(`UPDATE dokumente SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
          .run(...keys.map((k) => (felder[k] === '' ? null : felder[k])), id);
        if (ablegen) db.prepare(`UPDATE dokumente SET status = 'abgelegt' WHERE id = ?`).run(id);
        indexieren(id);
      }
      return ids.length;
    }),

    // Photos and documents linked to an object, a unit or a project (for the galleries).
    galerie: ({ objekt_id = null, einheit_id = null, projekt_id = null, person_id = null, nur_bilder = false } = {}) => all(`SELECT d.id, d.titel, d.typ, d.datum, d.erfasst,
        d.datei, d.name, d.einheit_id, d.status, e.bezeichnung AS einheit FROM dokumente d LEFT JOIN einheiten e ON e.id = d.einheit_id
      WHERE d.status <> 'postfach' AND (?1 IS NULL OR d.objekt_id = ?1) AND (?2 IS NULL OR d.einheit_id = ?2) AND (?3 IS NULL OR d.projekt_id = ?3)
        AND (?5 IS NULL OR d.person_id = ?5)
        AND (?4 = 0 OR lower(d.datei) GLOB '*.png' OR lower(d.datei) GLOB '*.jp*g' OR lower(d.datei) GLOB '*.webp' OR lower(d.datei) GLOB '*.gif')
      ORDER BY coalesce(d.datum, d.erfasst) DESC, d.id DESC`, objekt_id, einheit_id, projekt_id, nur_bilder ? 1 : 0, person_id),

    postfachAnzahl: () => get(`SELECT count(*) AS n FROM dokumente WHERE status = 'postfach'`).n,

    kontoVorschlag,

    // Invoices with their booking and payment state.
    rechnungen: ({ objekt_id = null, jahr = null } = {}) => all(`SELECT d.id, d.titel, d.datum, d.faellig, d.betrag_ct, d.absender, d.rechnungsnr,
        d.iban, d.buchung_id, d.datei, d.status, d.objekt_id, o.bezeichnung AS objekt, b.datum AS gebucht_am, k.id AS konto_id, k.bezeichnung AS konto, g.klasse AS gegen_klasse,
        (SELECT min(x.id) FROM dokumente x WHERE x.id <> d.id AND x.rechnungsnr IS NOT NULL AND x.rechnungsnr = d.rechnungsnr
          AND coalesce(x.betrag_ct, -1) = coalesce(d.betrag_ct, -1) AND coalesce(x.absender, '') = coalesce(d.absender, '')) AS duplikat_von
      FROM dokumente d LEFT JOIN objekte o ON o.id = d.objekt_id LEFT JOIN buchungen b ON b.id = d.buchung_id
      LEFT JOIN konten k ON k.id = b.soll_id LEFT JOIN konten g ON g.id = b.haben_id
      WHERE d.typ IN ('Rechnung', 'Gutschrift', 'Mahnung') AND (?1 IS NULL OR d.objekt_id = ?1)
        AND (?2 IS NULL OR substr(coalesce(d.datum, d.erfasst), 1, 4) = ?2)
      ORDER BY coalesce(d.datum, d.erfasst) DESC`, objekt_id, jahr ? String(jahr) : null),

    // One search over everything: documents (full text), people, objects, units, postings.
    suche: (q) => {
      const n = `%${norm(q)}%`;
      if (norm(q).length < 2) return { dokumente: [], personen: [], objekte: [], einheiten: [], buchungen: [] };
      const lower = (col) => `lower(replace(replace(replace(replace(coalesce(${col},''),'ä','ae'),'ö','oe'),'ü','ue'),'ß','ss'))`;
      const fts = ftsAbfrage(q);
      return {
        dokumente: fts ? all(`SELECT d.id, d.titel, d.typ, d.datum, d.datei, d.objekt_id, o.bezeichnung AS objekt,
            snippet(dokumente_fts, 1, '[', ']', ' … ', 10) AS treffer FROM dokumente_fts f JOIN dokumente d ON d.id = f.rowid
            LEFT JOIN objekte o ON o.id = d.objekt_id WHERE dokumente_fts MATCH ? ORDER BY rank LIMIT 20`, fts) : [],
        personen: all(`SELECT p.id, ${PERSON_NAME} AS name, p.ort, p.telefon, p.email FROM personen p
          WHERE ${lower("p.vorname || ' ' || p.nachname || ' ' || coalesce(p.firma,'') || ' ' || coalesce(p.email,'') || ' ' || coalesce(p.iban,'')")} LIKE ? LIMIT 10`, n),
        objekte: all(`SELECT id, bezeichnung, art, ort FROM objekte WHERE ${lower("bezeichnung || ' ' || coalesce(strasse,'') || ' ' || coalesce(ort,'')")} LIKE ? LIMIT 10`, n),
        einheiten: all(`SELECT e.id, e.bezeichnung, e.objekt_id, o.bezeichnung AS objekt, o.art FROM einheiten e JOIN objekte o ON o.id = e.objekt_id
          WHERE ${lower("e.bezeichnung || ' ' || coalesce(e.lage,'')")} LIKE ? LIMIT 10`, n),
        buchungen: all(`SELECT b.id, b.datum, b.text, b.beleg, b.betrag_ct, b.objekt_id, o.bezeichnung AS objekt FROM buchungen b
          JOIN objekte o ON o.id = b.objekt_id WHERE ${lower("coalesce(b.text,'') || ' ' || coalesce(b.beleg,'')")} LIKE ?
          ORDER BY b.datum DESC LIMIT 15`, n),
      };
    },

    indexNeuAufbauen: () => tx(() => {
      db.exec('DELETE FROM dokumente_fts');
      for (const { id } of all('SELECT id FROM dokumente')) indexieren(id);
    }),
  };
};

module.exports.norm = norm;
module.exports.felderErkennen = felderErkennen;
