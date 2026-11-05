// Duties of a house: recurring checks and services (smoke detectors, boiler, legionella, chimney sweep, trees …).
// Nothing is active by itself – per house the user ticks what applies from the catalogue. Ahead of each date a case is
// opened on the board; marking it done keeps the date and the proof and moves the next date on by the interval.
const ortszeit = require('./zeit.cjs');

// art: key; monate: interval (null = set by notice, e.g. the chimney sweep's); kategorie: cost type for the
// service-charge statement; hinweis: shown when choosing and on the entry.
const KATALOG = [
  { art: 'rauchmelder', titel: 'Rauchmelder prüfen', monate: 12, kategorie: 'bk17',
    hinweis: 'Jährliche Sicht- und Funktionsprüfung. Wer prüft (Vermieter oder Mieter), regelt die Landesbauordnung. Die Wartung ist als sonstige Betriebskosten umlagefähig, wenn der Mietvertrag es vorsieht – die Miete der Geräte nicht.' },
  { art: 'heizung', titel: 'Heizungswartung', monate: 12, kategorie: 'bk04',
    hinweis: 'Wartung der Heizanlage durch den Fachbetrieb; als Heizkosten umlagefähig.' },
  { art: 'legionellen', titel: 'Trinkwasser: Legionellenprüfung', monate: 36, kategorie: 'bk05',
    hinweis: 'Pflicht nur bei einer Großanlage zur Trinkwassererwärmung (Speicher über 400 Liter oder mehr als 3 Liter in einer Leitung vom Erwärmer bis zur Zapfstelle, ohne Zirkulationsleitung) mit Duschen in vermieteten Wohnungen. Liegt der Befund über dem technischen Maßnahmenwert, Gesundheitsamt und Mieter informieren und eine Gefährdungsanalyse veranlassen. Die Kosten gehören zu den Warmwasserkosten.' },
  { art: 'schornstein', titel: 'Schornsteinfeger / Feuerstättenschau', monate: null, kategorie: 'bk12',
    hinweis: 'Die Termine stehen im Feuerstättenbescheid. Nach jedem Termin trägst du den nächsten laut Bescheid ein.' },
  { art: 'baum', titel: 'Baumkontrolle (Verkehrssicherung)', monate: 12, kategorie: 'bk10',
    hinweis: 'Sichtkontrolle der Bäume auf dem Grundstück, am besten dokumentiert mit Fotos. Schützt bei Schäden durch herabfallende Äste. Ob die Kontrolle als Gartenpflege umlagefähig ist, ist umstritten.' },
  { art: 'winterdienst', titel: 'Winterdienst vorbereiten', monate: 12, kategorie: 'bk08', start: '10-01',
    hinweis: 'Vor dem Winter prüfen: Vertrag mit dem Dienst oder Einteilung laut Hausordnung, Streumittel vorhanden.' },
  { art: 'dachrinne', titel: 'Dachrinnen reinigen', monate: 12, kategorie: 'bk17',
    hinweis: 'Regelmäßige Reinigung ist als sonstige Betriebskosten umlagefähig, wenn vereinbart.' },
  { art: 'rueckstau', titel: 'Rückstausicherung warten', monate: 12, kategorie: 'bk17',
    hinweis: 'Rückstauklappe oder Hebeanlage im Keller; schützt bei Starkregen.' },
  { art: 'aufzug', titel: 'Aufzug: Prüfung durch die Prüfstelle', monate: 12, kategorie: 'bk07',
    hinweis: 'Hauptprüfung alle zwei Jahre, dazwischen die Zwischenprüfung – also jedes Jahr ein Termin.' },
  { art: 'feuerloescher', titel: 'Feuerlöscher prüfen', monate: 24, kategorie: 'bk17',
    hinweis: 'Prüfung durch einen Sachkundigen.' },
  { art: 'spielplatz', titel: 'Spielplatz kontrollieren', monate: 12, kategorie: 'bk10',
    hinweis: 'Hauptinspektion der Spielgeräte, dazu regelmäßige Sichtkontrollen; Sand austauschen.' },
  { art: 'echeck', titel: 'Elektroanlage prüfen (E-Check)', monate: 48, kategorie: 'bk17',
    hinweis: 'Freiwillig, aber hilfreich bei Versicherungsfragen. Regelmäßig durchgeführt als sonstige Betriebskosten umlagefähig, wenn der Mietvertrag es vorsieht (BGH VIII ZR 123/06).' },
  { art: 'gas', titel: 'Gasleitungen prüfen', monate: 144, kategorie: 'instandhaltung',
    hinweis: 'Gebrauchsfähigkeitsprüfung der Gasleitungen im Haus, empfohlen alle 12 Jahre. Bei so langem Turnus ist die Umlage fraglich – im Zweifel nicht umlegen.' },
  { art: 'energieausweis', titel: 'Energieausweis erneuern', monate: 120, kategorie: 'sonstige',
    hinweis: 'Ein Energieausweis gilt zehn Jahre (GEG). Bei Neuvermietung musst du ihn Interessenten vorlegen und die Kennwerte in die Anzeige schreiben. Nicht umlagefähig.' },
];

const plusTage = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
// Day-exact months: the 31st becomes the last day of a shorter month, 29.02. becomes 28.02.
const plusMonate = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const z = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  z.setUTCDate(Math.min(d.getUTCDate(), new Date(Date.UTC(z.getUTCFullYear(), z.getUTCMonth() + 1, 0)).getUTCDate()));
  return z.toISOString().slice(0, 10);
};
const datumDe = (iso) => (iso ? iso.split('-').reverse().join('.') : '');

// Status for the list and the cockpit: paused, overdue, due soon (within the lead time), ok, or without a date.
function zustand(p, t) {
  if (!p.aktiv) return 'pausiert';
  if (!p.naechste) return 'ohne_datum';
  if (p.naechste < t) return 'ueberfaellig';
  if (p.naechste <= plusTage(t, p.vorlauf_tage ?? 30)) return 'bald';
  return 'ok';
}

module.exports = function pflichten({ db, all, get, tx, PERSON_NAME }) {
  const liste = (where, ...args) => {
    const t = ortszeit.heute();
    return all(`SELECT f.*, o.bezeichnung AS objekt, e.bezeichnung AS einheit,
        (SELECT ${PERSON_NAME} FROM personen p WHERE p.id = f.firma_id) AS firma,
        (SELECT max(x.datum) FROM pflicht_erledigt x WHERE x.pflicht_id = f.id) AS zuletzt,
        (SELECT v.id FROM vorgaenge v WHERE v.pflicht_id = f.id AND v.status <> 'erledigt' ORDER BY v.id DESC LIMIT 1) AS vorgang_id
      FROM pflichten f JOIN objekte o ON o.id = f.objekt_id LEFT JOIN einheiten e ON e.id = f.einheit_id
      WHERE ${where} ORDER BY f.aktiv DESC, coalesce(f.naechste, '9999'), f.titel`, ...args)
      .map((p) => ({ ...p, zustand: zustand(p, t), hinweis: KATALOG.find((k) => k.art === p.art)?.hinweis ?? null }));
  };

  // The next date suggested when choosing from the catalogue: a fixed day of the year (winter service), otherwise in
  // a month – so the first case appears right away and the date can be checked.
  const vorschlagNaechste = (k, t) => {
    if (k.start) { const d = `${t.slice(0, 4)}-${k.start}`; return d >= t ? d : `${Number(t.slice(0, 4)) + 1}-${k.start}`; }
    return plusTage(t, 30);
  };

  // Opens the case of a duty once its lead time has begun; one open case per duty at most.
  function vorgangAnlegen(p) {
    const r = db.prepare(`INSERT INTO vorgaenge (objekt_id, einheit_id, titel, kategorie, status, prioritaet, faellig, beschreibung, zustaendig, pflicht_id)
      VALUES (?, ?, ?, 'pflicht', 'offen', 2, ?, ?, ?, ?)`).run(p.objekt_id, p.einheit_id ?? null, p.titel, p.naechste,
      [p.firma ? `Firma: ${p.firma}` : null, KATALOG.find((k) => k.art === p.art)?.hinweis ?? null, p.notiz || null].filter(Boolean).join('\n\n') || null,
      p.geaendert_benutzer ?? null, p.id);
    return Number(r.lastInsertRowid);
  }

  return {
    pflichtKatalog: () => KATALOG,
    pflichten: (objektId) => liste('f.objekt_id = ?', objektId),
    // All active duties that are due soon or overdue (cockpit), across the houses of one mode.
    pflichtenFaellig: (objektIds) => {
      const ids = (objektIds ?? []).map(Number).filter(Number.isInteger);
      if (!ids.length) return [];
      return liste(`f.objekt_id IN (${ids.join(',')}) AND f.aktiv = 1`).filter((p) => p.zustand === 'ueberfaellig' || p.zustand === 'bald' || p.zustand === 'ohne_datum');
    },

    // Creates the ticked catalogue entries for one house: [{ art, naechste?, intervall_monate?, firma_id?, einheit_id? }].
    // An active duty of the same kind for the same house (and unit) is not created twice.
    pflichtenAnlegen: (objektId, auswahl) => tx(() => {
      const t = ortszeit.heute();
      const neu = [];
      for (const a of auswahl ?? []) {
        const k = KATALOG.find((x) => x.art === a.art);
        if (!k) throw new Error(`Unbekannte Pflicht: ${a.art}`);
        if (get(`SELECT 1 FROM pflichten WHERE objekt_id = ? AND art = ? AND coalesce(einheit_id, 0) = ? AND aktiv = 1`, objektId, k.art, a.einheit_id ?? 0)) continue;
        const monate = a.intervall_monate === undefined ? k.monate : a.intervall_monate || null;
        const r = db.prepare(`INSERT INTO pflichten (objekt_id, einheit_id, art, titel, intervall_monate, naechste, firma_id, kategorie)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(objektId, a.einheit_id ?? null, k.art, a.titel || k.titel, monate,
          a.naechste || vorschlagNaechste(k, t), a.firma_id ?? null, k.kategorie);
        neu.push(Number(r.lastInsertRowid));
      }
      return neu;
    }),

    // Done: keeps the date and the proof, moves the next date on (by the interval, or to the date given – the chimney
    // sweep's notice) and closes the open case.
    pflichtErledigen: (id, { datum, dokument_id = null, buchung_id = null, notiz = null, naechste = null, von = null } = {}) => tx(() => {
      const p = get('SELECT * FROM pflichten WHERE id = ?', id);
      if (!p) throw new Error('Diese Pflicht gibt es nicht mehr.');
      const d = datum || ortszeit.heute();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Bitte ein gültiges Datum angeben.');
      if (d > ortszeit.heute()) throw new Error('Das Datum liegt in der Zukunft – erledigt wird es, wenn es gemacht ist.');
      db.prepare('INSERT INTO pflicht_erledigt (pflicht_id, datum, dokument_id, buchung_id, notiz, von) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, d, dokument_id, buchung_id, notiz || null, von);
      const weiter = naechste || (p.intervall_monate ? plusMonate(d, p.intervall_monate) : null);
      db.prepare('UPDATE pflichten SET naechste = ? WHERE id = ?').run(weiter, id);
      for (const v of all(`SELECT id FROM vorgaenge WHERE pflicht_id = ? AND status <> 'erledigt'`, id)) {
        db.prepare(`UPDATE vorgaenge SET status = 'erledigt' WHERE id = ?`).run(v.id);
        db.prepare(`INSERT INTO vorgangseintraege (vorgang_id, datum, art, text, von) VALUES (?, ?, 'status', ?, ?)`)
          .run(v.id, ortszeit.heute(), `Erledigt am ${datumDe(d)}${weiter ? ` – nächster Termin ${datumDe(weiter)}` : ''}`, von);
      }
      return { naechste: weiter };
    }),

    pflichtVerlauf: (id) => all(`SELECT x.*, d.datei, d.titel AS dokument, d.name AS dokument_name FROM pflicht_erledigt x
      LEFT JOIN dokumente d ON d.id = x.dokument_id WHERE x.pflicht_id = ? ORDER BY x.datum DESC, x.id DESC`, id),

    // Run by the automation: a case for every active duty whose lead time has begun and that has none open yet.
    pflichtVorgaenge: (t = ortszeit.heute()) => tx(() => {
      let n = 0;
      for (const p of all(`SELECT f.*, (SELECT ${PERSON_NAME} FROM personen p WHERE p.id = f.firma_id) AS firma FROM pflichten f
          WHERE f.aktiv = 1 AND f.naechste IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vorgaenge v WHERE v.pflicht_id = f.id AND v.status <> 'erledigt')`)) {
        if (plusTage(p.naechste, -(p.vorlauf_tage ?? 30)) > t) continue;
        // Already done for this date (the case was closed by hand): not opened again.
        if (get('SELECT 1 FROM vorgaenge WHERE pflicht_id = ? AND faellig = ?', p.id, p.naechste)) continue;
        vorgangAnlegen(p);
        n++;
      }
      return n;
    }),
  };
};

Object.assign(module.exports, { KATALOG, plusMonate, zustand });
