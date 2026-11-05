const ortszeit = require('./zeit.cjs');
const belege = require('./belege.cjs');
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
  // Lines about VAT or the net amount ("MwSt-Betrag", "Gesamt netto") are not the total.
  const summen = t.split(/\n/).filter((z) => !/mwst|mw\.?-?st|mehrwertsteuer|\bust\b|umsatzsteuer|netto|steuerbetrag/i.test(z))
    .flatMap((z) => [...z.matchAll(/(?:Gesamtbetrag|Rechnungsbetrag|Endbetrag|zu zahlen|Gesamtsumme|Summe brutto|Bruttobetrag|Gesamt|Betrag)[^\d\n]{0,30}(\d{1,3}(?:\.\d{3})*,\d{2})/gi)])
    .map((m) => betragAus(m[1]));
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

const json = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const RECHNUNGSTYPEN = ['Rechnung', 'Gutschrift', 'Mahnung', 'Angebot'];
// A company name without legal form and punctuation, for finding the same contact again ("Müller GmbH" = "Müller").
const kern = (s) => norm(s).replace(/\b(?:gmbh(?:\s*&\s*co\.?\s*kg)?|ug|ag|kg|ohg|gbr|e\.?\s?k\.?|e\.?\s?kfm\.?|e\.?\s?v\.?|mbh|partg(?:mbb)?|ltd\.?|se|haftungsbeschraenkt)(?![a-z])/g, '').replace(/[^a-z0-9]/g, '');
// SQL: document x is the same invoice as document d.
const GLEICHE_RECHNUNG = (x, d) => `${x}.id <> ${d}.id AND ${x}.status <> 'papierkorb' AND ${x}.rechnungsnr IS NOT NULL AND ${d}.rechnungsnr IS NOT NULL
  AND lower(replace(${x}.rechnungsnr, ' ', '')) = lower(replace(${d}.rechnungsnr, ' ', '')) AND coalesce(${x}.betrag_ct, -1) = coalesce(${d}.betrag_ct, -1)
  AND (${x}.datum IS NULL OR ${d}.datum IS NULL OR ${x}.datum = ${d}.datum)
  AND (coalesce(${x}.absender, '') = coalesce(${d}.absender, '') OR (${x}.person_id IS NOT NULL AND ${x}.person_id = ${d}.person_id)
    OR (json_extract(${x}.steller, '$.ust_id') IS NOT NULL AND json_extract(${x}.steller, '$.ust_id') = json_extract(${d}.steller, '$.ust_id')))`;
const PAPIERKORB_TAGE = 30;
const mitJson = (d) => d && { ...d, steller: json(d.steller), steuer: json(d.steuer), positionen: json(d.positionen) };

module.exports = function archiv({ db, all, get, tx, PERSON_NAME }) {
  // Our own names and addresses (manager, objects, tenants and owners): never taken for the sender of a letter.
  function eigene() {
    const e = Object.fromEntries(all(`SELECT schluessel, wert FROM einstellungen WHERE schluessel LIKE 'verwalter_%'`).map((r) => [r.schluessel, r.wert]));
    const leute = all(`SELECT DISTINCT p.vorname, p.nachname, p.firma, p.strasse, p.plz, p.ort, p.email, p.iban FROM personen p
      WHERE p.id IN (SELECT person_id FROM mietverhaeltnisse UNION SELECT person2_id FROM mietverhaeltnisse UNION SELECT person_id FROM rollen)`);
    const objekte = all('SELECT bezeichnung, strasse, plz, ort, iban FROM objekte');
    return {
      namen: [e.verwalter_name, ...leute.flatMap((p) => [`${p.vorname ?? ''} ${p.nachname ?? ''}`.trim(), p.firma])].filter((x) => x && x.length > 3),
      adressen: [[e.verwalter_strasse, e.verwalter_plz, e.verwalter_ort], ...objekte.map((o) => [o.strasse, o.plz, o.ort]), ...leute.map((p) => [p.strasse, p.plz, p.ort])]
        .filter((a) => a[0]).map((a) => a.filter(Boolean).join(' ')),
      emails: [e.verwalter_email, ...leute.map((p) => p.email)].filter(Boolean),
      ibans: [e.verwalter_iban, ...objekte.map((o) => o.iban)].filter(Boolean),
      ust_ids: [e.verwalter_ustid].filter(Boolean),
      steuernummern: [e.verwalter_steuernr].filter(Boolean),
    };
  }

  // What was learnt about a sender before beats the guess from the text: the company name of the matching contact, else
  // the name on the newest filed document with the same VAT id, IBAN or e-mail (as corrected there).
  function gelernt(st, dokId) {
    if (!st) return st;
    const kontakt = kontaktFinden(st);
    const p = kontakt ? get('SELECT firma, strasse, plz, ort FROM personen WHERE id = ?', kontakt) : null;
    if (p?.firma) {
      const { name_unsicher, ...rest } = st;
      return { ...rest, name: p.firma, ...(!st.plz && p.plz ? { strasse: p.strasse, plz: p.plz, ort: p.ort } : {}) };
    }
    for (const [k, v] of [['ust_id', st.ust_id], ['iban', st.iban], ['email', st.email]]) {
      if (!v) continue;
      const frueher = get(`SELECT json_extract(steller, '$.name') AS name FROM dokumente WHERE id <> ? AND status = 'abgelegt' AND steller IS NOT NULL
        AND json_extract(steller, '$.${k}') = ? AND json_extract(steller, '$.name') IS NOT NULL ORDER BY coalesce(geaendert_am, '') DESC, id DESC LIMIT 1`, dokId, v);
      if (frueher?.name) {
        const { name_unsicher, ...rest } = st;
        return { ...rest, name: frueher.name };
      }
    }
    return st;
  }

  // The house within maxM metres of a position (its location saved once on the spot, "Standort hier speichern").
  function objektBeiStandort(lat, lon, maxM = 150) {
    const r = (x) => (x * Math.PI) / 180;
    const abstand = (o) => 2 * 6371000 * Math.asin(Math.sqrt(Math.sin(r(o.breite - lat) / 2) ** 2 + Math.cos(r(lat)) * Math.cos(r(o.breite)) * Math.sin(r(o.laenge - lon) / 2) ** 2));
    return all('SELECT id, bezeichnung, breite, laenge FROM objekte WHERE breite IS NOT NULL AND laenge IS NOT NULL')
      .map((o) => ({ ...o, m: abstand(o) })).filter((o) => o.m <= maxM).sort((a, b) => a.m - b.m)[0] ?? null;
  }

  // The contact behind a sender: by VAT id, IBAN, e-mail, then company name.
  function kontaktFinden(st) {
    if (!st) return null;
    const ohne = (x) => String(x ?? '').replace(/\s/g, '').toUpperCase();
    const p = (st.ust_id && get(`SELECT id FROM personen WHERE upper(replace(ust_id, ' ', '')) = ?`, ohne(st.ust_id)))
      || (st.iban && get(`SELECT id FROM personen WHERE upper(replace(iban, ' ', '')) = ?`, ohne(st.iban)))
      || (st.email && get('SELECT id FROM personen WHERE lower(email) = ?', String(st.email).toLowerCase()))
      || (st.name && kern(st.name).length >= 4 && all(`SELECT id, firma FROM personen WHERE firma IS NOT NULL AND firma <> ''`).find((x) => kern(x.firma) === kern(st.name)));
    return p?.id ?? null;
  }

  // A contact for the sender, found or created (never twice: VAT id, IBAN, e-mail and name are checked first).
  function kontaktAnlegen(dokId, st) {
    const id = kontaktFinden(st) ?? Number(db.prepare(`INSERT INTO personen (firma, nachname, strasse, plz, ort, telefon, email, iban, bic, ust_id, steuernr, web, notiz)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(st.name, st.strasse ?? null, st.plz ?? null, st.ort ?? null, st.telefon ?? null, st.email ?? null,
      st.iban ?? null, st.bic ?? null, st.ust_id ?? null, st.steuernr ?? null, st.web ?? null,
      [st.register, st.inhaber && `Inhaber/Geschäftsführung: ${st.inhaber}`, st.bank && `Bank: ${st.bank}`].filter(Boolean).join('\n') || null).lastInsertRowid);
    db.prepare('UPDATE dokumente SET person_id = ? WHERE id = ?').run(id, dokId);
    indexieren(dokId);
    return id;
  }
  // Filing or booking an invoice makes its sender a contact, unless the document already belongs to a person.
  function kontaktSicherstellen(dokId) {
    const d = get('SELECT typ, person_id, steller FROM dokumente WHERE id = ?', dokId);
    const st = json(d?.steller);
    if (!d || d.person_id || !RECHNUNGSTYPEN.includes(d.typ) || !st?.name) return null;
    return kontaktAnlegen(dokId, st);
  }

  // The same invoice twice (a copy, photo and PDF, e-invoice and its PDF): same invoice number, amount and date (if
  // known) from the same sender (name, contact or VAT id). With abgelegt only a copy already filed or booked counts.
  function duplikat(id, { abgelegt = false } = {}) {
    return get(`SELECT x.id, x.titel, x.datum, x.status, x.buchung_id, (SELECT b.datum FROM buchungen b WHERE b.id = x.buchung_id) AS gebucht_am
      FROM dokumente d JOIN dokumente x ON ${GLEICHE_RECHNUNG('x', 'd')} WHERE d.id = ? ${abgelegt ? "AND (x.status = 'abgelegt' OR x.buchung_id IS NOT NULL)" : ''}
      ORDER BY x.buchung_id IS NOT NULL DESC, x.status = 'abgelegt' DESC, x.id LIMIT 1`, id) ?? null;
  }
  const mitDuplikat = (d) => d && { ...d, duplikat: d.status === 'papierkorb' ? null : duplikat(d.id) };
  function duplikatSperre(id) {
    const x = duplikat(id, { abgelegt: true });
    if (x) throw new Error(`Diese Rechnung gibt es schon: „${x.titel}“${x.datum ? ` vom ${x.datum.split('-').reverse().join('.')}` : ''}`
      + `${x.buchung_id ? `, gebucht am ${String(x.gebucht_am ?? '').split('-').reverse().join('.')}` : ', abgelegt'} – gleiche Rechnungsnummer, gleicher Betrag, gleicher Absender. `
      + 'Sie wird nicht doppelt abgelegt oder gebucht. Die Kopie bitte löschen; ist es keine Kopie, die Rechnungsnummer prüfen.');
  }

  function indexieren(id) {
    const d = get('SELECT * FROM dokumente WHERE id = ?', id);
    db.prepare('DELETE FROM dokumente_fts WHERE rowid = ?').run(id);
    if (!d || d.status === 'papierkorb') return;
    const objekt = d.objekt_id ? get('SELECT bezeichnung, strasse, ort FROM objekte WHERE id = ?', d.objekt_id) : null;
    const person = d.person_id ? get(`SELECT ${PERSON_NAME} AS n FROM personen p WHERE p.id = ?`, d.person_id)?.n : '';
    const steller = json(d.steller) ?? {};
    const posten = (json(d.positionen) ?? []).map((x) => x.text);
    const meta = [d.typ, d.kategorie, d.stichworte, d.absender, d.rechnungsnr, d.iban, d.name, d.notiz, d.zusammenfassung, person, ...Object.values(steller), ...posten,
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

  // Suggests the expense account from earlier invoices of the same sender; failing that, from a duty of the house
  // done by this firm (its cost type, e.g. boiler service → heating costs).
  function kontoVorschlag(objektId, absender, personId = null) {
    if (!objektId || (!absender && !personId)) return null;
    const r = absender ? get(`SELECT b.soll_id FROM dokumente d JOIN buchungen b ON b.id = d.buchung_id
      WHERE d.objekt_id = ? AND d.absender = ? ORDER BY d.id DESC LIMIT 1`, objektId, absender) : null;
    if (r) return r.soll_id;
    const pf = get(`SELECT f.kategorie FROM pflichten f JOIN personen p ON p.id = f.firma_id
      WHERE f.objekt_id = ?1 AND f.aktiv = 1 AND f.kategorie IS NOT NULL AND (p.id = ?2
        OR (?3 IS NOT NULL AND length(coalesce(p.firma, '')) > 3 AND instr(lower(?3), lower(p.firma)) > 0)
        OR (?3 IS NOT NULL AND length(coalesce(p.nachname, '')) > 3 AND instr(lower(?3), lower(p.nachname)) > 0))
      ORDER BY f.id LIMIT 1`, objektId, personId, absender || null);
    return pf ? get(`SELECT id FROM konten WHERE objekt_id = ? AND klasse = 'kosten' AND kategorie = ? AND coalesce(inaktiv, 0) = 0 ORDER BY nr LIMIT 1`, objektId, pf.kategorie)?.id ?? null : null;
  }

  // Recycle bin: a deleted document keeps its file for PAPIERKORB_TAGE days and can come back to where it was.
  function wiederherstellen(id) {
    db.prepare(`UPDATE dokumente SET status = coalesce(geloescht_aus, 'postfach'), geloescht = NULL, geloescht_aus = NULL WHERE id = ? AND status = 'papierkorb'`).run(id);
    indexieren(id);
  }
  // Removes records for good and returns their files, which the caller deletes (only from the recycle bin).
  function endgueltig(ids) {
    const dateien = [];
    for (const id of ids) {
      const d = get(`SELECT datei FROM dokumente WHERE id = ? AND status = 'papierkorb'`, id);
      if (!d) continue;
      db.prepare('DELETE FROM dokumente_fts WHERE rowid = ?').run(id);
      db.prepare('DELETE FROM dokumente WHERE id = ?').run(id);
      if (!get('SELECT 1 FROM dokumente WHERE datei = ?', d.datei)) dateien.push(d.datei);
    }
    return dateien;
  }

  return {
    norm,
    felderErkennen,
    kontaktFinden,

    // Image search: photos still without keywords (newest first), saving the result, and how far it got.
    bilderOhneStichworte: (limit = 3) => all(`SELECT id, datei FROM dokumente WHERE status <> 'papierkorb' AND stichworte IS NULL
      AND (lower(datei) GLOB '*.jp*g' OR lower(datei) GLOB '*.png' OR lower(datei) GLOB '*.webp') ORDER BY id DESC LIMIT ?`, limit),
    bildStichworteSetzen: (id, stichworte, vektor = null) => {
      db.prepare('UPDATE dokumente SET stichworte = ?, bildvektor = ? WHERE id = ?').run((stichworte ?? []).join(', '), vektor, id);
      indexieren(id);
    },
    bildsucheZaehlen: () => get(`SELECT count(*) AS gesamt, sum(stichworte IS NOT NULL) AS fertig FROM dokumente WHERE status <> 'papierkorb'
      AND (lower(datei) GLOB '*.jp*g' OR lower(datei) GLOB '*.png' OR lower(datei) GLOB '*.webp')`),

    dokumentLoeschen: (ids) => tx(() => {
      const liste = [ids].flat().map(Number).filter(Boolean);
      const jetzt = new Date().toISOString();
      for (const id of liste) {
        db.prepare(`UPDATE dokumente SET geloescht_aus = status, status = 'papierkorb', geloescht = ? WHERE id = ? AND status <> 'papierkorb'`).run(jetzt, id);
        db.prepare('DELETE FROM dokumente_fts WHERE rowid = ?').run(id);
      }
      return liste.length;
    }),
    dokumentWiederherstellen: (ids) => tx(() => { for (const id of [ids].flat()) wiederherstellen(Number(id)); }),
    dokumentEndgueltig: (ids) => tx(() => endgueltig([ids].flat().map(Number))),
    papierkorb: () => all(`SELECT d.id, d.titel, d.typ, d.name, d.datei, d.absender, d.betrag_ct, d.geloescht, d.geloescht_aus, d.buchung_id, o.bezeichnung AS objekt
      FROM dokumente d LEFT JOIN objekte o ON o.id = d.objekt_id WHERE d.status = 'papierkorb' ORDER BY d.geloescht DESC`)
      .map((d) => ({ ...d, endgueltig_am: new Date(Date.parse(d.geloescht) + PAPIERKORB_TAGE * 864e5).toISOString() })),
    papierkorbAnzahl: () => get(`SELECT count(*) AS n FROM dokumente WHERE status = 'papierkorb'`).n,
    // Empties what has been in the bin longer than the days given; returns the files to delete.
    papierkorbLeeren: (tage = PAPIERKORB_TAGE, jetzt = Date.now()) => tx(() => endgueltig(
      all(`SELECT id, geloescht FROM dokumente WHERE status = 'papierkorb'`).filter((d) => !d.geloescht || Date.parse(d.geloescht) <= jetzt - tage * 864e5).map((d) => d.id))),

    // A contact from the sender of a document (company), linked to the document.
    kontaktAusSteller: (dokId) => tx(() => {
      const d = get('SELECT steller FROM dokumente WHERE id = ?', dokId);
      const st = json(d?.steller);
      if (!st?.name) throw new Error('Der Rechnungssteller hat noch keinen Namen.');
      return kontaktAnlegen(dokId, st);
    }),
    kontaktSicherstellen,
    objektBeiStandort,
    dokumentDuplikat: (id, opt) => duplikat(id, opt),
    dokumentTypen: () => TYPEN,

    // Stores recognised text and fills empty fields from the rule-based extraction.
    analyseSpeichern: (id, text, seiten, ocr, er = null, layout = null, foto = null) => tx(() => {
      const d = get('SELECT * FROM dokumente WHERE id = ?', id);
      const f = felderErkennen(text ?? '');
      // Photos: the day it was taken (not a date read in the picture), a title from it, the house from its position.
      if (foto && (d?.typ === 'Foto' || !d?.typ)) {
        if (foto.aufnahme) {
          f.datum = ortszeit.lokalDatum(new Date(foto.aufnahme));
          if (d && d.titel === d.name?.replace(/\.[^.]+$/, '') && (d.typ === 'Foto' || /^(img|dsc|photo|pxl|image)[_-]?\d/i.test(d.titel)))
            db.prepare('UPDATE dokumente SET titel = ? WHERE id = ?').run(`Foto vom ${new Date(foto.aufnahme).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })}`, id);
        }
        if (foto.standort && !d?.objekt_id) { const o = objektBeiStandort(foto.standort.lat, foto.standort.lon); if (o) db.prepare('UPDATE dokumente SET objekt_id = ? WHERE id = ?').run(o.id, id); }
      }
      const z = zuordnungVorschlagen(text ?? '');
      const alsJson = (x) => (x == null ? null : JSON.stringify(x));
      // E-invoice data is exact: it replaces what was guessed from the text.
      let r = null;
      if (er) {
        r = belege.ausERechnung(er);
        db.prepare(`UPDATE dokumente SET erechnung = ?, typ = ?, betrag_ct = ?, netto_ct = ?, ust_ct = ?, datum = coalesce(?, datum), faellig = coalesce(?, faellig),
          absender = coalesce(?, absender), rechnungsnr = coalesce(?, rechnungsnr), iban = coalesce(?, iban),
          steller = ?, steuer = ?, positionen = ?, lohn_ct = coalesce(lohn_ct, ?) WHERE id = ?`)
          .run(JSON.stringify(er), er.gutschrift ? 'Gutschrift' : 'Rechnung', er.zahlbetrag_ct ?? er.brutto_ct ?? null, er.netto_ct ?? null, er.ust_ct ?? null,
            er.datum ?? null, er.faellig ?? null, er.verkaeufer?.name ?? null, er.nummer ?? null, er.iban ?? null,
            alsJson(r.steller), alsJson(r.steuer), alsJson(r.positionen), r.lohn_ct, id);
        if (d && (!d.titel || d.titel === d.name?.replace(/\.[^.]+$/, ''))) db.prepare('UPDATE dokumente SET titel = ? WHERE id = ?')
          .run(`${er.gutschrift ? 'Gutschrift' : 'Rechnung'} ${er.verkaeufer?.name ?? ''} ${er.nummer ?? ''}`.replace(/\s+/g, ' ').trim(), id);
      } else {
        // Sender from letterhead and imprint; for invoices also VAT, line items and the labour share.
        const steller = gelernt(belege.stellerErkennen(text ?? '', eigene(), layout), id);
        const typ = d?.typ ?? f.typ;
        const rechnung = ['Rechnung', 'Gutschrift', 'Angebot', 'Mahnung'].includes(typ);
        const brutto = d?.betrag_ct ?? f.betrag_ct ?? null;
        const steuer = rechnung ? belege.steuerErkennen(text ?? '', brutto) : null;
        const positionen = rechnung ? belege.positionenErkennen(text ?? '') : [];
        const netto = steuer ? steuer.reduce((x, t) => x + t.netto_ct, 0) : null;
        r = { steller, steuer, positionen: positionen.length ? positionen : null, lohn_ct: belege.lohnBerechnen(positionen, { brutto, netto }),
          netto_ct: netto, ust_ct: steuer ? steuer.reduce((x, t) => x + t.ust_ct, 0) : null };
        if (steller?.name) f.absender = steller.name;
        if (!f.iban && steller?.iban) f.iban = steller.iban;
        db.prepare(`UPDATE dokumente SET steller = coalesce(steller, ?), steuer = coalesce(steuer, ?), positionen = coalesce(positionen, ?),
          lohn_ct = coalesce(lohn_ct, ?), netto_ct = coalesce(netto_ct, ?), ust_ct = coalesce(ust_ct, ?) WHERE id = ?`)
          .run(alsJson(r.steller), alsJson(r.steuer), alsJson(r.positionen), r.lohn_ct, r.netto_ct, r.ust_ct, id);
      }
      db.prepare(`UPDATE dokumente SET text = ?, seiten = ?, ocr = ?, analyse = 'fertig',
        typ = coalesce(typ, ?), betrag_ct = coalesce(betrag_ct, ?), datum = coalesce(datum, ?), faellig = coalesce(faellig, ?),
        absender = coalesce(absender, ?), rechnungsnr = coalesce(rechnungsnr, ?), iban = coalesce(iban, ?),
        objekt_id = coalesce(objekt_id, ?), person_id = coalesce(person_id, ?), zusammenfassung = coalesce(zusammenfassung, ?) WHERE id = ?`)
        .run(text ?? '', seiten ?? null, ocr ? 1 : 0, f.typ ?? null, f.betrag_ct ?? null, f.datum ?? null, f.faellig ?? null,
          f.absender ?? null, f.rechnungsnr ?? null, f.iban ?? null, z.objekt_id ?? null, kontaktFinden(r?.steller) ?? z.person_id ?? null,
          belege.kurztext(r?.positionen), id);
      if (d && !d.titel) db.prepare('UPDATE dokumente SET titel = ? WHERE id = ?').run(d.name ?? 'Dokument', id);
      indexieren(id);
    }),
    analyseFehler: (id, meldung) => db.prepare(`UPDATE dokumente SET analyse = ? WHERE id = ?`).run(`fehler: ${meldung}`.slice(0, 300), id),
    analyseZuruecksetzen: (id) => db.prepare(`UPDATE dokumente SET analyse = 'offen' WHERE id = ?`).run(id),
    zuAnalysieren: () => all(`SELECT id, datei, name FROM dokumente WHERE analyse = 'offen' ORDER BY id`),

    dokumentNeu: (row) => {
      const vorhanden = row.sha256 ? get('SELECT id, titel, status FROM dokumente WHERE sha256 = ?', row.sha256) : null;
      // The same file once more out of the recycle bin: it comes back instead of a second copy.
      if (vorhanden?.status === 'papierkorb') {
        wiederherstellen(vorhanden.id);
        return { id: vorhanden.id, doppelt: false, wiederhergestellt: true, titel: vorhanden.titel };
      }
      if (vorhanden) return { id: vorhanden.id, doppelt: true, titel: vorhanden.titel };
      const id = Number(db.prepare(`INSERT INTO dokumente (objekt_id, einheit_id, projekt_id, person_id, buchung_id, vorgang_id, typ, titel, datei, name, groesse, sha256, status, quelle, erfasst, analyse)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, date('now', 'localtime'), 'offen')`).run(row.objekt_id ?? null, row.einheit_id ?? null, row.projekt_id ?? null,
        row.person_id ?? null, row.buchung_id ?? null, row.vorgang_id ?? null, row.typ ?? null, row.titel, row.datei, row.name, row.groesse, row.sha256 ?? null, row.status ?? 'postfach', row.quelle ?? 'upload').lastInsertRowid);
      indexieren(id);
      return { id, doppelt: false };
    },

    dokumentSpeichern: (row) => {
      const cols = ['objekt_id', 'projekt_id', 'person_id', 'einheit_id', 'titel', 'kategorie', 'datum', 'notiz', 'status', 'typ', 'betrag_ct',
        'absender', 'rechnungsnr', 'iban', 'faellig', 'zusammenfassung', 'buchung_id', 'netto_ct', 'ust_ct', 'vorgang_id',
        'steller', 'steuer', 'positionen', 'lohn_ct'];
      // Sender, VAT and items come as objects/lists and are kept as JSON; the VAT sums follow the rates.
      const r = { ...row };
      // Filed means checked: the sender's name is no longer marked uncertain.
      if (row.status === 'abgelegt' && r.steller && typeof r.steller === 'object') { const { name_unsicher, ...rest } = r.steller; r.steller = rest; }
      for (const k of ['steller', 'steuer', 'positionen']) {
        if (r[k] != null && typeof r[k] !== 'string') r[k] = (Array.isArray(r[k]) ? r[k].length : Object.values(r[k]).some((x) => x != null && x !== '')) ? JSON.stringify(r[k]) : null;
      }
      if ('steuer' in row && !('netto_ct' in row)) {
        const t = json(r.steuer);
        r.netto_ct = t ? t.reduce((x, y) => x + (Number(y.netto_ct) || 0), 0) : null;
        r.ust_ct = t ? t.reduce((x, y) => x + (Number(y.ust_ct) || 0), 0) : null;
      }
      // Filing: the other fields are stored first (a corrected invoice number counts), then a copy of a filed or booked
      // invoice is refused and the sender becomes a contact.
      const ablegen = r.status === 'abgelegt' && get('SELECT status FROM dokumente WHERE id = ?', row.id)?.status !== 'abgelegt';
      const keys = cols.filter((c) => c in r && !(ablegen && c === 'status'));
      if (keys.length) db.prepare(`UPDATE dokumente SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => (r[k] === '' || r[k] === undefined ? null : r[k])), row.id);
      if (ablegen) {
        duplikatSperre(row.id);
        db.prepare(`UPDATE dokumente SET status = 'abgelegt' WHERE id = ?`).run(row.id);
        kontaktSicherstellen(row.id);
      }
      indexieren(row.id);
      return row.id;
    },

    // Drag & drop of a filed or inbox document onto a person, unit, contract or posting.
    dokumentZuordnen: (id, ziel) => {
      const erlaubt = ['objekt_id', 'einheit_id', 'person_id', 'buchung_id', 'projekt_id', 'vorgang_id'];
      const werte = Object.fromEntries(Object.entries(ziel).filter(([k, v]) => erlaubt.includes(k) && v != null));
      const keys = Object.keys(werte);
      if (get('SELECT status FROM dokumente WHERE id = ?', id)?.status !== 'abgelegt') duplikatSperre(id);
      if (keys.length) db.prepare(`UPDATE dokumente SET ${keys.map((k) => `${k} = ?`).join(', ')}, status = 'abgelegt' WHERE id = ?`).run(...keys.map((k) => werte[k]), id);
      kontaktSicherstellen(id);
      indexieren(id);
    },

    dokument: (id) => mitDuplikat(mitJson(get(`SELECT d.*, o.bezeichnung AS objekt, e.bezeichnung AS einheit, ${PERSON_NAME} AS person,
        (SELECT b.soll_id FROM buchungen b WHERE b.id = d.buchung_id) AS buchung_konto_id, (SELECT b.datum FROM buchungen b WHERE b.id = d.buchung_id) AS buchung_datum
      FROM dokumente d LEFT JOIN objekte o ON o.id = d.objekt_id LEFT JOIN einheiten e ON e.id = d.einheit_id
      LEFT JOIN personen p ON p.id = d.person_id WHERE d.id = ?`, id))),

    // Archive listing with optional full-text search; matches come with a highlighted snippet.
    dokumentListe: ({ q = '', status = null, objekt_id = null, projekt_id = null, typ = null, jahr = null, limit = 300 } = {}) => {
      const fts = ftsAbfrage(q);
      const sql = `SELECT d.id, d.titel, d.typ, d.kategorie, d.datum, d.erfasst, d.status, d.analyse, d.name, d.datei, d.groesse, d.betrag_ct,
          d.absender, d.objekt_id, d.einheit_id, d.person_id, d.buchung_id, d.ocr, d.seiten, o.bezeichnung AS objekt, e.bezeichnung AS einheit, ${PERSON_NAME} AS person,
          (SELECT min(x.id) FROM dokumente x WHERE ${GLEICHE_RECHNUNG('x', 'd')}) AS duplikat_von
          ${fts ? ", snippet(dokumente_fts, 1, '[', ']', ' … ', 12) AS treffer" : ''}
        FROM dokumente d ${fts ? 'JOIN dokumente_fts f ON f.rowid = d.id' : ''}
        LEFT JOIN objekte o ON o.id = d.objekt_id LEFT JOIN einheiten e ON e.id = d.einheit_id LEFT JOIN personen p ON p.id = d.person_id
        WHERE ${status ? '1 = 1' : "d.status <> 'papierkorb'"} ${fts ? 'AND dokumente_fts MATCH ?' : ''} ${status ? 'AND d.status = ?' : ''} ${objekt_id ? 'AND d.objekt_id = ?' : ''} ${projekt_id ? 'AND d.projekt_id = ?' : ''}
          ${typ ? 'AND d.typ = ?' : ''} ${jahr ? "AND substr(coalesce(d.datum, d.erfasst), 1, 4) = ?" : ''}
        ORDER BY ${fts ? 'rank' : "coalesce(d.datum, d.erfasst) DESC, d.id DESC"} LIMIT ?`;
      return all(sql, ...[fts || null, status, objekt_id, projekt_id, typ, jahr ? String(jahr) : null].filter((x) => x != null), limit);
    },

    // Applies the same fields to several documents and optionally files them.
    stapelAblegen: (ids, felder, ablegen) => tx(() => {
      const erlaubt = ['objekt_id', 'einheit_id', 'projekt_id', 'person_id', 'typ', 'kategorie'];
      const keys = erlaubt.filter((k) => k in felder);
      // Copies of filed invoices – or the same invoice twice in the selection – are not filed: nothing changes then.
      if (ablegen) {
        const doppelt = ids.filter((id, i) => get(`SELECT status FROM dokumente WHERE id = ?`, id)?.status !== 'abgelegt'
          && (duplikat(id, { abgelegt: true }) || ids.slice(0, i).some((j) => duplikat(id)?.id === j)));
        if (doppelt.length) throw new Error(`${doppelt.length === 1 ? `„${get('SELECT titel FROM dokumente WHERE id = ?', doppelt[0]).titel}“ ist` : `${doppelt.length} Dokumente sind`} `
          + 'Duplikat(e) einer Rechnung, die es schon gibt (gleiche Nummer, gleicher Betrag, gleicher Absender). Bitte abwählen oder löschen.');
      }
      for (const id of ids) {
        if (keys.length) db.prepare(`UPDATE dokumente SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
          .run(...keys.map((k) => (felder[k] === '' ? null : felder[k])), id);
        if (ablegen) { db.prepare(`UPDATE dokumente SET status = 'abgelegt' WHERE id = ?`).run(id); kontaktSicherstellen(id); }
        indexieren(id);
      }
      return ids.length;
    }),

    // Photos and documents linked to an object, a unit or a project (for the galleries).
    galerie: ({ objekt_id = null, einheit_id = null, projekt_id = null, person_id = null, vorgang_id = null, nur_bilder = false } = {}) => all(`SELECT d.id, d.titel, d.typ, d.datum, d.erfasst,
        d.datei, d.name, d.einheit_id, d.status, e.bezeichnung AS einheit FROM dokumente d LEFT JOIN einheiten e ON e.id = d.einheit_id
      WHERE d.status = 'abgelegt' AND (?1 IS NULL OR d.objekt_id = ?1) AND (?2 IS NULL OR d.einheit_id = ?2) AND (?3 IS NULL OR d.projekt_id = ?3)
        AND (?5 IS NULL OR d.person_id = ?5) AND (?6 IS NULL OR d.vorgang_id = ?6)
        AND (?4 = 0 OR lower(d.datei) GLOB '*.png' OR lower(d.datei) GLOB '*.jp*g' OR lower(d.datei) GLOB '*.webp' OR lower(d.datei) GLOB '*.gif')
      ORDER BY coalesce(d.datum, d.erfasst) DESC, d.id DESC`, objekt_id, einheit_id, projekt_id, nur_bilder ? 1 : 0, person_id, vorgang_id),

    postfachAnzahl: () => get(`SELECT count(*) AS n FROM dokumente WHERE status = 'postfach'`).n,

    kontoVorschlag,

    // Invoices with their booking and payment state.
    rechnungen: ({ objekt_id = null, jahr = null } = {}) => all(`SELECT d.id, d.titel, d.datum, d.faellig, d.betrag_ct, d.absender, d.rechnungsnr,
        d.iban, d.buchung_id, d.datei, d.status, d.objekt_id, o.bezeichnung AS objekt, b.datum AS gebucht_am, k.id AS konto_id, k.bezeichnung AS konto, g.klasse AS gegen_klasse,
        (SELECT min(x.id) FROM dokumente x WHERE ${GLEICHE_RECHNUNG('x', 'd')}) AS duplikat_von
      FROM dokumente d LEFT JOIN objekte o ON o.id = d.objekt_id LEFT JOIN buchungen b ON b.id = d.buchung_id
      LEFT JOIN konten k ON k.id = b.soll_id LEFT JOIN konten g ON g.id = b.haben_id
      WHERE d.typ IN ('Rechnung', 'Gutschrift', 'Mahnung') AND d.status <> 'papierkorb' AND (?1 IS NULL OR d.objekt_id = ?1)
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
