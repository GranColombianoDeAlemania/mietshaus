// Overviews that pull everything together: object tiles for the cockpit, the object fact sheet
// and the person file, each with a timeline of what happened.
module.exports = function akten({ db, all, get, PERSON_NAME, bh }) {
  const heute = () => new Date().toISOString().slice(0, 10);
  const BILD = `(lower(d.datei) GLOB '*.jp*g' OR lower(d.datei) GLOB '*.png' OR lower(d.datei) GLOB '*.webp')`;

  // Title photo: the chosen one, otherwise the newest photo of the house itself (not of a unit).
  const titelbild = (o) => (o.titelbild_id ? get('SELECT datei FROM dokumente WHERE id = ?', o.titelbild_id)?.datei : null) ??
    get(`SELECT d.datei FROM dokumente d WHERE d.objekt_id = ? AND d.einheit_id IS NULL AND d.status <> 'postfach' AND ${BILD}
      ORDER BY (d.typ = 'Foto') DESC, d.id DESC LIMIT 1`, o.id)?.datei ?? null;

  // Arrears: what was not paid by its due date (charges due today are not late yet), less any credit.
  const rueckstand = (objektId, typ) => all(`SELECT id FROM konten WHERE objekt_id = ? AND klasse = 'person' AND (?2 IS NULL OR vertrag_typ = ?2)`, objektId, typ ?? null)
    .reduce((s, k) => {
      const op = bh.offenePostenKonto(k.id);
      return s + Math.max(0, op.offen.filter((x) => x.verzug >= 1).reduce((a, x) => a + x.offen_ct, 0) - op.guthaben_ct);
    }, 0);

  const tageZwischen = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const vertragTabelle = (typ) => (typ === 'weg' ? 'eigentum' : 'mietverhaeltnisse');

  // A contract with its account, balance and the amounts in force today (or at its end).
  function vertragInfo(typ, v) {
    const t = heute();
    const k = bh.kontoVon(typ, v.id);
    const op = k ? bh.offenePostenKonto(k.id) : null;
    const stichtag = v.ende && v.ende < t ? v.ende : t < v.beginn ? v.beginn : t;
    const b = bh.betraege(typ, v.id, stichtag);
    const netto = (b.kaltmiete_ct ?? 0) + (b.bk_vz_ct ?? 0) + (b.hk_vz_ct ?? 0) + (b.sonstiges_ct ?? 0);
    const ust = typ === 'miete' && v.ust_satz > 0 ? Math.round(netto * v.ust_satz / 100) : 0;
    const p2 = v.person2_id ? get(`SELECT p.id, ${PERSON_NAME} AS name FROM personen p WHERE p.id = ?`, v.person2_id) : null;
    return {
      ...v, typ, person2: p2 ?? null, konto_id: k?.id ?? null, konto_nr: k?.nr ?? null,
      saldo_ct: op?.summe_ct ?? 0,
      ueberfaellig_ct: op ? Math.max(0, op.offen.filter((x) => x.verzug >= 1).reduce((a, x) => a + x.offen_ct, 0) - op.guthaben_ct) : 0,
      offene_monate: op ? op.offen.filter((x) => x.verzug >= 1).map((x) => x.monat ?? x.datum) : [],
      betraege: b, ust_ct: ust, monatlich_ct: typ === 'weg' ? b.hausgeld_ct ?? 0 : netto + ust,
      aktuell: v.beginn <= t && (!v.ende || v.ende >= t) ? 1 : 0, zukuenftig: v.beginn > t ? 1 : 0,
    };
  }

  function zeitleisteEinheit(einheitId) {
    return all(`
      SELECT m.beginn AS datum, 'Einzug ' || ${PERSON_NAME} AS text, 'vertrag' AS art FROM mietverhaeltnisse m JOIN personen p ON p.id = m.person_id WHERE m.einheit_id = ?1
      UNION ALL SELECT m.ende, 'Auszug ' || ${PERSON_NAME}, 'vertrag' FROM mietverhaeltnisse m JOIN personen p ON p.id = m.person_id WHERE m.einheit_id = ?1 AND m.ende IS NOT NULL AND m.ende <> ''
      UNION ALL SELECT g.beginn, 'Eigentümer ' || ${PERSON_NAME}, 'vertrag' FROM eigentum g JOIN personen p ON p.id = g.person_id WHERE g.einheit_id = ?1
      UNION ALL SELECT u.datum, CASE u.art WHEN 'einzug' THEN 'Übergabe beim Einzug' ELSE 'Übergabe beim Auszug' END, 'uebergabe' FROM uebergaben u WHERE u.einheit_id = ?1
      UNION ALL SELECT coalesce(d.datum, d.erfasst), coalesce(d.typ, 'Dokument') || ': ' || d.titel, 'dokument' FROM dokumente d WHERE d.einheit_id = ?1 AND d.status <> 'postfach'
      UNION ALL SELECT v.erstellt, 'Vorgang: ' || v.titel || CASE WHEN v.status = 'erledigt' THEN ' (erledigt)' ELSE '' END, 'vorgang' FROM vorgaenge v WHERE v.einheit_id = ?1
      UNION ALL SELECT a.gueltig_ab, 'Mietanpassung', 'vertrag' FROM anpassungen a JOIN mietverhaeltnisse m ON a.vertrag_typ = 'miete' AND m.id = a.vertrag_id
        WHERE m.einheit_id = ?1 AND a.kaltmiete_ct IS NOT NULL
      ORDER BY 1 DESC LIMIT 60`, einheitId).filter((z) => z.datum);
  }

  function zeitleisteObjekt(objektId) {
    return all(`
      SELECT m.beginn AS datum, 'Einzug ' || ${PERSON_NAME} || ' (' || e.bezeichnung || ')' AS text, 'vertrag' AS art FROM mietverhaeltnisse m
        JOIN einheiten e ON e.id = m.einheit_id JOIN personen p ON p.id = m.person_id WHERE e.objekt_id = ?1
      UNION ALL SELECT m.ende, 'Auszug ' || ${PERSON_NAME} || ' (' || e.bezeichnung || ')', 'vertrag' FROM mietverhaeltnisse m
        JOIN einheiten e ON e.id = m.einheit_id JOIN personen p ON p.id = m.person_id WHERE e.objekt_id = ?1 AND m.ende IS NOT NULL AND m.ende <> ''
      UNION ALL SELECT g.beginn, 'Eigentümer ' || ${PERSON_NAME} || ' (' || e.bezeichnung || ')', 'vertrag' FROM eigentum g
        JOIN einheiten e ON e.id = g.einheit_id JOIN personen p ON p.id = g.person_id WHERE e.objekt_id = ?1
      UNION ALL SELECT coalesce(d.datum, d.erfasst), coalesce(d.typ, 'Dokument') || ': ' || d.titel, 'dokument' FROM dokumente d WHERE d.objekt_id = ?1 AND d.status <> 'postfach'
      UNION ALL SELECT v.erstellt, 'Vorgang: ' || v.titel || CASE WHEN v.status = 'erledigt' THEN ' (erledigt)' ELSE '' END, 'vorgang' FROM vorgaenge v WHERE v.objekt_id = ?1
      UNION ALL SELECT x.datum, 'Eigentümerversammlung', 'termin' FROM versammlungen x WHERE x.objekt_id = ?1
      UNION ALL SELECT substr(a.erstellt, 1, 10), a.titel || ' erstellt', 'abrechnung' FROM abrechnungen a WHERE a.objekt_id = ?1
      UNION ALL SELECT a.gueltig_ab, 'Mietanpassung ' || e.bezeichnung, 'vertrag' FROM anpassungen a JOIN mietverhaeltnisse m ON a.vertrag_typ = 'miete' AND m.id = a.vertrag_id
        JOIN einheiten e ON e.id = m.einheit_id WHERE e.objekt_id = ?1 AND a.kaltmiete_ct IS NOT NULL
      UNION ALL SELECT coalesce(p.beginn, p.erstellt), 'Projekt: ' || p.titel, 'projekt' FROM projekte p WHERE p.objekt_id = ?1
      ORDER BY 1 DESC LIMIT 80`, objektId).filter((z) => z.datum);
  }

  function zeitleistePerson(personId) {
    return all(`
      SELECT m.beginn AS datum, 'Mietbeginn ' || e.bezeichnung || ', ' || o.bezeichnung AS text, 'vertrag' AS art FROM mietverhaeltnisse m
        JOIN einheiten e ON e.id = m.einheit_id JOIN objekte o ON o.id = e.objekt_id WHERE ?1 IN (m.person_id, m.person2_id)
      UNION ALL SELECT m.ende, 'Mietende ' || e.bezeichnung, 'vertrag' FROM mietverhaeltnisse m JOIN einheiten e ON e.id = m.einheit_id
        WHERE ?1 IN (m.person_id, m.person2_id) AND m.ende IS NOT NULL AND m.ende <> ''
      UNION ALL SELECT g.beginn, 'Eigentum ' || e.bezeichnung || ', ' || o.bezeichnung, 'vertrag' FROM eigentum g JOIN einheiten e ON e.id = g.einheit_id
        JOIN objekte o ON o.id = e.objekt_id WHERE ?1 IN (g.person_id, g.person2_id)
      UNION ALL SELECT coalesce(d.datum, d.erfasst), coalesce(d.typ, 'Dokument') || ': ' || d.titel, 'dokument' FROM dokumente d WHERE d.person_id = ?1
      UNION ALL SELECT v.erstellt, 'Vorgang: ' || v.titel, 'vorgang' FROM vorgaenge v WHERE v.person_id = ?1
      UNION ALL SELECT t.datum, 'Termin: ' || t.titel, 'termin' FROM termine t WHERE t.person_id = ?1
      UNION ALL SELECT mh.datum, 'Mahnung Stufe ' || mh.stufe, 'mahnung' FROM mahnungen mh JOIN konten k ON k.id = mh.konto_id
        JOIN mietverhaeltnisse m ON k.vertrag_typ = 'miete' AND m.id = k.vertrag_id WHERE ?1 IN (m.person_id, m.person2_id)
      ORDER BY 1 DESC LIMIT 80`, personId).filter((z) => z.datum);
  }

  return {
    protokoll: ({ tabelle = null, quelle = null, suche = '', von = null, limit = 500 } = {}) => all(`SELECT * FROM protokoll
      WHERE (?1 IS NULL OR tabelle = ?1) AND (?2 IS NULL OR quelle = ?2) AND (?3 IS NULL OR zeit >= ?3)
        AND (?4 = '' OR coalesce(alt, '') LIKE '%' || ?4 || '%' OR coalesce(neu, '') LIKE '%' || ?4 || '%')
      ORDER BY id DESC LIMIT ?5`, tabelle, quelle, von, suche, limit),
    protokollDatensatz: (tabelle, id) => all('SELECT * FROM protokoll WHERE tabelle = ? AND datensatz = ? ORDER BY id DESC', tabelle, id),

    objektKacheln: (modus) => {
      const arten = modus === 'weg' ? ['weg', 'gemischt'] : ['miete', 'gemischt'];
      const t = heute();
      return all(`SELECT * FROM objekte WHERE art IN (?, ?) ORDER BY bezeichnung`, ...arten).map((o) => {
        const einheiten = get('SELECT count(*) AS n, coalesce(sum(wohnflaeche), 0) AS f FROM einheiten WHERE objekt_id = ?', o.id);
        const leer = modus === 'weg' ? get(`SELECT count(*) AS n FROM einheiten e WHERE e.objekt_id = ?1 AND NOT EXISTS (SELECT 1 FROM eigentum g
            WHERE g.einheit_id = e.id AND g.beginn <= ?2 AND (g.ende IS NULL OR g.ende = '' OR g.ende >= ?2))`, o.id, t).n
          : get(`SELECT count(*) AS n FROM einheiten e WHERE e.objekt_id = ?1 AND NOT EXISTS (SELECT 1 FROM mietverhaeltnisse m
            WHERE m.einheit_id = e.id AND m.beginn <= ?2 AND (m.ende IS NULL OR m.ende = '' OR m.ende >= ?2))
            AND NOT EXISTS (SELECT 1 FROM eigentum g WHERE g.einheit_id = e.id AND g.selbstnutzer = 1)`, o.id, t).n;
        const vorgaenge = get(`SELECT count(*) AS n FROM vorgaenge WHERE objekt_id = ? AND status <> 'erledigt'`, o.id).n;
        return { ...o, titelbild: titelbild(o), einheiten: einheiten.n, flaeche: einheiten.f, leer,
          rueckstand_ct: rueckstand(o.id, modus === 'weg' ? 'weg' : 'miete'), vorgaenge };
      });
    },

    objektSteckbrief: (objektId) => {
      const o = get('SELECT * FROM objekte WHERE id = ?', objektId);
      if (!o) return null;
      const t = heute();
      const e = get('SELECT count(*) AS n, coalesce(sum(wohnflaeche), 0) AS f, coalesce(sum(mea), 0) AS mea FROM einheiten WHERE objekt_id = ?', objektId);
      const laufend = all(`SELECT m.id FROM mietverhaeltnisse m JOIN einheiten e ON e.id = m.einheit_id
        WHERE e.objekt_id = ?1 AND m.beginn <= ?2 AND (m.ende IS NULL OR m.ende = '' OR m.ende >= ?2)`, objektId, t);
      const mieten = { n: laufend.length, kalt: laufend.reduce((s, m) => s + (bh.betraege('miete', m.id, t).kaltmiete_ct ?? 0), 0) };
      const eigner = get(`SELECT count(DISTINCT g.person_id) AS n FROM eigentum g JOIN einheiten e ON e.id = g.einheit_id
        WHERE e.objekt_id = ?1 AND g.beginn <= ?2 AND (g.ende IS NULL OR g.ende = '' OR g.ende >= ?2)`, objektId, t).n;
      return {
        objekt: { ...o, titelbild: titelbild(o) },
        einheiten: e.n, flaeche: e.f, mea: e.mea, mieter: mieten.n, kaltmiete_ct: mieten.kalt, eigentuemer: eigner,
        // Rent arrears and house-money arrears are different claims and are shown separately.
        rueckstand_ct: rueckstand(objektId, null),
        rueckstand_miete_ct: o.art !== 'weg' ? rueckstand(objektId, 'miete') : 0,
        rueckstand_weg_ct: o.art !== 'miete' ? rueckstand(objektId, 'weg') : 0,
        geld: all(`SELECT id, nr, bezeichnung FROM konten WHERE objekt_id = ? AND klasse = 'geld' ORDER BY nr`, objektId).map((k) => ({ ...k, saldo_ct: bh.saldoBis(k.id, t) })),
        zaehler: get('SELECT count(*) AS n FROM zaehler WHERE objekt_id = ? AND (ausbau IS NULL OR ausbau = \'\')', objektId).n,
        versicherungen: all('SELECT art, gesellschaft, beitrag_ct, kuendbar_bis FROM versicherungen WHERE objekt_id = ? ORDER BY art', objektId),
        kontakte: all(`SELECT r.rolle, r.person_id, ${PERSON_NAME} AS name, p.telefon, p.mobil, p.email FROM rollen r JOIN personen p ON p.id = r.person_id
          WHERE r.objekt_id = ? AND (r.bis IS NULL OR r.bis = '' OR r.bis >= ?) ORDER BY r.rolle`, objektId, t),
        darlehen: all(`SELECT * FROM darlehen WHERE objekt_id = ?`, objektId).length ? all(`SELECT id, bank, betrag_ct, zinssatz, zinsbindung_bis FROM darlehen WHERE objekt_id = ?`, objektId) : [],
        vorgaenge: all(`SELECT id, titel, faellig, status FROM vorgaenge WHERE objekt_id = ? AND status <> 'erledigt' ORDER BY coalesce(faellig, '9999') LIMIT 8`, objektId),
        projekte: all(`SELECT id, titel, status FROM projekte WHERE objekt_id = ? AND status <> 'abgeschlossen'`, objektId),
        dokumente: all(`SELECT id, titel, typ, datum, erfasst, datei FROM dokumente WHERE objekt_id = ? AND status <> 'postfach'
          ORDER BY coalesce(datum, erfasst) DESC, id DESC LIMIT 8`, objektId),
        zeitleiste: zeitleisteObjekt(objektId),
      };
    },

    // Unit fact sheet: who lives there and owns it (now and before), rent today, meters, keys, documents, cases, hand-overs.
    einheitAkte: (einheitId) => {
      const e = get(`SELECT e.*, o.bezeichnung AS objekt, o.art AS objekt_art, o.strasse, o.plz, o.ort,
          (SELECT coalesce(sum(x.mea), 0) FROM einheiten x WHERE x.objekt_id = e.objekt_id) AS mea_gesamt,
          (SELECT coalesce(sum(x.wohnflaeche), 0) FROM einheiten x WHERE x.objekt_id = e.objekt_id) AS flaeche_gesamt
        FROM einheiten e JOIN objekte o ON o.id = e.objekt_id WHERE e.id = ?`, einheitId);
      if (!e) return null;
      const t = heute();
      const liste = (typ) => all(`SELECT v.*, ${PERSON_NAME} AS name FROM ${vertragTabelle(typ)} v JOIN personen p ON p.id = v.person_id
        WHERE v.einheit_id = ? ORDER BY v.beginn DESC`, einheitId).map((v) => vertragInfo(typ, v));
      const mieter = liste('miete');
      const eigentum = liste('weg');
      // Vacant days this year: days without a tenancy (a unit used by its owner is not vacant).
      const jahrStart = `${t.slice(0, 4)}-01-01`;
      const tageJahr = tageZwischen(jahrStart, t) + 1;
      const belegt = new Set();
      for (const v of [...mieter, ...eigentum.filter((g) => g.selbstnutzer)]) {
        const a = v.beginn > jahrStart ? v.beginn : jahrStart, b = (v.ende || '9999-12-31') < t ? v.ende : t;
        for (let d = Date.parse(a); d <= Date.parse(b); d += 86400000) belegt.add(d);
      }
      const personIds = [...new Set([...mieter, ...eigentum].flatMap((v) => [v.person_id, v.person2_id]).filter(Boolean))];
      return {
        einheit: e, mieter, eigentum,
        leertage: Math.max(0, tageJahr - belegt.size), tage_jahr: tageJahr,
        zaehler: all(`SELECT z.*, (SELECT stand FROM zaehlerstaende s WHERE s.zaehler_id = z.id ORDER BY datum DESC LIMIT 1) AS letzter_stand,
            (SELECT datum FROM zaehlerstaende s WHERE s.zaehler_id = z.id ORDER BY datum DESC LIMIT 1) AS letztes_datum
          FROM zaehler z WHERE z.einheit_id = ? ORDER BY (z.ausbau IS NOT NULL AND z.ausbau <> ''), z.art, z.nummer`, einheitId),
        schluessel: personIds.length ? all(`SELECT s.bezeichnung, s.nummer, a.anzahl, a.ausgabe, a.rueckgabe, a.person_id, ${PERSON_NAME} AS name
          FROM schluesselausgaben a JOIN schluessel s ON s.id = a.schluessel_id JOIN personen p ON p.id = a.person_id
          WHERE s.objekt_id = ? AND a.person_id IN (${personIds.join(',')}) ORDER BY (a.rueckgabe IS NOT NULL AND a.rueckgabe <> ''), a.ausgabe DESC`, e.objekt_id) : [],
        dokumente: all(`SELECT id, titel, typ, datum, erfasst, datei, person_id FROM dokumente WHERE einheit_id = ? AND status <> 'postfach'
          ORDER BY coalesce(datum, erfasst) DESC, id DESC LIMIT 40`, einheitId),
        vorgaenge: all(`SELECT id, titel, status, faellig, kategorie, erstellt, objekt_id FROM vorgaenge WHERE einheit_id = ?
          ORDER BY status = 'erledigt', coalesce(faellig, '9999'), id DESC LIMIT 20`, einheitId),
        uebergaben: all('SELECT id, art, datum, abgeschlossen, dokument_id, vertrag_id FROM uebergaben WHERE einheit_id = ? ORDER BY datum DESC', einheitId),
        anpassungen: mieter.find((v) => v.aktuell) ? all(`SELECT * FROM anpassungen WHERE vertrag_typ = 'miete' AND vertrag_id = ? ORDER BY gueltig_ab`, mieter.find((v) => v.aktuell).id) : [],
        interessenten: all(`SELECT id, name, status, bewertung FROM interessenten WHERE einheit_id = ? AND status NOT IN ('absage', 'vermietet') ORDER BY bewertung DESC, id`, einheitId),
        angebot: get('SELECT * FROM angebote WHERE einheit_id = ? AND aktiv = 1', einheitId) ?? null,
        zeitleiste: zeitleisteEinheit(einheitId),
      };
    },

    // Contract page: the tenancy or ownership with amounts over time, open months, statement of account, deposit,
    // reminders, instalment plans, notice, documents, hand-overs and annual statements.
    vertragAkte: (typ, vertragId) => {
      if (typ !== 'miete' && typ !== 'weg') throw new Error('Ungültige Vertragsart');
      const v = get(`SELECT v.*, ${PERSON_NAME} AS name, p.anrede, p.email, p.telefon, p.mobil FROM ${vertragTabelle(typ)} v
        JOIN personen p ON p.id = v.person_id WHERE v.id = ?`, vertragId);
      if (!v) return null;
      const info = vertragInfo(typ, v);
      const e = get(`SELECT e.*, o.bezeichnung AS objekt, o.art AS objekt_art, o.iban AS objekt_iban FROM einheiten e
        JOIN objekte o ON o.id = e.objekt_id WHERE e.id = ?`, v.einheit_id);
      const felder = typ === 'weg' ? ['hausgeld_ct', 'ruecklage_ct'] : ['kaltmiete_ct', 'bk_vz_ct', 'hk_vz_ct', 'sonstiges_ct'];
      const verlauf = [{ gueltig_ab: v.beginn, grund: 'beginn', ...Object.fromEntries(felder.map((f) => [f, v[f] ?? 0])) }];
      for (const a of all('SELECT * FROM anpassungen WHERE vertrag_typ = ? AND vertrag_id = ? ORDER BY gueltig_ab', typ, vertragId)) {
        const vorher = verlauf.at(-1);
        verlauf.push({ gueltig_ab: a.gueltig_ab, grund: a.grund, notiz: a.notiz, ...Object.fromEntries(felder.map((f) => [f, a[f] ?? vorher[f]])) });
      }
      const k = info.konto_id;
      const t = heute();
      const auszugVon = `${Number(t.slice(0, 4)) - 1}-01-01`;
      const eigentuemer = typ === 'miete' ? get(`SELECT g.person_id AS id, ${PERSON_NAME} AS name FROM eigentum g JOIN personen p ON p.id = g.person_id
        WHERE g.einheit_id = ? AND g.beginn <= ?2 AND (g.ende IS NULL OR g.ende = '' OR g.ende >= ?2) ORDER BY g.beginn DESC LIMIT 1`, v.einheit_id, t) : null;
      return {
        vertrag: info, einheit: e, eigentuemer: eigentuemer ?? null, verlauf,
        op: k ? bh.offenePostenKonto(k) : null,
        kontoauszug: k ? bh.kontoauszug(k, auszugVon, '9999-12-31') : null,
        kaution: typ === 'miete' ? get(`SELECT k.*, coalesce((SELECT sum(CASE WHEN art IN ('einzahlung','zinsen') THEN betrag_ct ELSE -betrag_ct END)
            FROM kautionsbewegungen b WHERE b.kaution_id = k.id), 0) AS bestand_ct FROM kautionen k WHERE k.vertrag_id = ?`, vertragId) ?? null : null,
        mahnungen: k ? all('SELECT * FROM mahnungen WHERE konto_id = ? ORDER BY datum DESC', k) : [],
        ratenplaene: k ? all('SELECT * FROM ratenplaene WHERE konto_id = ? ORDER BY datum DESC', k) : [],
        kuendigung: typ === 'miete' ? get('SELECT * FROM mieterwechsel WHERE vertrag_id = ?', vertragId) ?? null : null,
        dokumente: all(`SELECT id, titel, typ, datum, erfasst, datei FROM dokumente WHERE status <> 'postfach' AND person_id IN (?, ?)
          AND (einheit_id = ? OR einheit_id IS NULL) ORDER BY coalesce(datum, erfasst) DESC, id DESC LIMIT 30`, v.person_id, v.person2_id ?? -1, v.einheit_id),
        uebergaben: typ === 'miete' ? all('SELECT id, art, datum, abgeschlossen, dokument_id FROM uebergaben WHERE vertrag_id = ? ORDER BY datum', vertragId) : [],
        abrechnungen: all(`SELECT id, titel, von, bis, erstellt, daten FROM abrechnungen WHERE objekt_id = ? AND typ = ? ORDER BY von DESC`, e.objekt_id, typ === 'weg' ? 'weg' : 'nk')
          .map((a) => {
            const erg = (JSON.parse(a.daten).ergebnisse ?? []).filter((x) => x.segment?.vertrag?.id === vertragId);
            return erg.length ? { id: a.id, titel: a.titel, von: a.von, bis: a.bis, erstellt: a.erstellt, ergebnis_ct: erg.reduce((s, x) => s + (x.ergebnis_ct ?? 0), 0) } : null;
          }).filter(Boolean),
      };
    },

    // Account page: statement for a period; person accounts know their contract.
    kontoAkte: (kontoId, von, bis) => {
      const k = get(`SELECT k.*, o.bezeichnung AS objekt FROM konten k JOIN objekte o ON o.id = k.objekt_id WHERE k.id = ?`, kontoId);
      if (!k) return null;
      const v = k.vertrag_id ? get(`SELECT v.id, v.einheit_id, v.person_id, ${PERSON_NAME} AS name, e.bezeichnung AS einheit FROM ${vertragTabelle(k.vertrag_typ)} v
        JOIN personen p ON p.id = v.person_id JOIN einheiten e ON e.id = v.einheit_id WHERE v.id = ?`, k.vertrag_id) : null;
      return { konto: k, vertrag: v ?? null, auszug: bh.kontoauszug(kontoId, von, bis) };
    },

    // Small preview for the hover card: contact data and each contract's state.
    personKarte: (personId) => {
      const p = get(`SELECT p.*, ${PERSON_NAME} AS name FROM personen p WHERE p.id = ?`, personId);
      if (!p) return null;
      const vertraege = ['miete', 'weg'].flatMap((typ) => all(`SELECT v.*, e.bezeichnung AS einheit, o.bezeichnung AS objekt, e.objekt_id
          FROM ${vertragTabelle(typ)} v JOIN einheiten e ON e.id = v.einheit_id JOIN objekte o ON o.id = e.objekt_id
          WHERE ?1 IN (v.person_id, v.person2_id) ORDER BY v.beginn DESC`, personId)
        .map((v) => ({ ...vertragInfo(typ, v), einheit: v.einheit, objekt: v.objekt, objekt_id: v.objekt_id })))
        .filter((v) => v.aktuell || v.zukuenftig || v.saldo_ct !== 0);
      return { person: p, vertraege, rollen: all(`SELECT r.rolle, o.bezeichnung AS objekt FROM rollen r JOIN objekte o ON o.id = r.objekt_id
        WHERE r.person_id = ? AND (r.bis IS NULL OR r.bis = '' OR r.bis >= ?)`, personId, heute()) };
    },

    // What a link key (e.g. "vertrag:miete:7") refers to: ids for context menus and drag & drop.
    zielInfo: (key) => {
      const [art, a, b] = String(key).split(':');
      const t = heute();
      if (art === 'person') {
        const p = get(`SELECT p.id, p.email, ${PERSON_NAME} AS name FROM personen p WHERE p.id = ?`, Number(a));
        if (!p) return null;
        const v = ['miete', 'weg'].map((typ) => get(`SELECT v.id, v.einheit_id, e.objekt_id, '${typ}' AS typ FROM ${vertragTabelle(typ)} v JOIN einheiten e ON e.id = v.einheit_id
          WHERE ?1 IN (v.person_id, v.person2_id) ORDER BY (v.ende IS NULL OR v.ende = '' OR v.ende >= ?2) DESC, v.beginn DESC LIMIT 1`, p.id, t)).find(Boolean);
        return { art, person_id: p.id, name: p.name, email: p.email, objekt_id: v?.objekt_id ?? null, einheit_id: v?.einheit_id ?? null, vertrag: v ? { typ: v.typ, id: v.id } : null };
      }
      if (art === 'einheit') {
        const e = get('SELECT id, objekt_id, bezeichnung FROM einheiten WHERE id = ?', Number(a));
        if (!e) return null;
        const m = get(`SELECT id, person_id FROM mietverhaeltnisse WHERE einheit_id = ?1 AND beginn <= ?2 AND (ende IS NULL OR ende = '' OR ende >= ?2) ORDER BY beginn DESC LIMIT 1`, e.id, t);
        const g = get(`SELECT id, person_id FROM eigentum WHERE einheit_id = ?1 AND beginn <= ?2 AND (ende IS NULL OR ende = '' OR ende >= ?2) ORDER BY beginn DESC LIMIT 1`, e.id, t);
        return { art, einheit_id: e.id, objekt_id: e.objekt_id, name: e.bezeichnung, mieter: m ?? null, eigentum: g ?? null };
      }
      if (art === 'vertrag') {
        const v = get(`SELECT v.*, e.objekt_id, e.bezeichnung AS einheit, ${PERSON_NAME} AS name, p.email FROM ${vertragTabelle(a)} v JOIN einheiten e ON e.id = v.einheit_id
          JOIN personen p ON p.id = v.person_id WHERE v.id = ?`, Number(b));
        if (!v) return null;
        return { art, typ: a, vertrag_id: v.id, person_id: v.person_id, einheit_id: v.einheit_id, objekt_id: v.objekt_id, konto_id: bh.kontoVon(a, v.id)?.id ?? null,
          name: `${v.name} – ${v.einheit}`, email: v.email, aktuell: v.beginn <= t && (!v.ende || v.ende >= t) };
      }
      if (art === 'objekt') {
        const o = get('SELECT id, bezeichnung FROM objekte WHERE id = ?', Number(a));
        return o ? { art, objekt_id: o.id, name: o.bezeichnung } : null;
      }
      if (art === 'konto') {
        const k = get('SELECT * FROM konten WHERE id = ?', Number(a));
        return k ? { art, konto_id: k.id, objekt_id: k.objekt_id, name: `${k.nr} ${k.bezeichnung}`, vertrag: k.vertrag_id ? { typ: k.vertrag_typ, id: k.vertrag_id } : null } : null;
      }
      if (art === 'buchung') {
        const x = get(`SELECT b.*, (SELECT d.id FROM dokumente d WHERE d.buchung_id IN (b.id, coalesce(b.gruppe, -1)) LIMIT 1) AS dok_id,
          EXISTS (SELECT 1 FROM buchungen s WHERE s.storno_von = b.id) AS storniert FROM buchungen b WHERE b.id = ?`, Number(a));
        return x ? { art, buchung_id: x.id, objekt_id: x.objekt_id, name: x.text ?? 'Buchung', soll_id: x.soll_id, haben_id: x.haben_id, dok_id: x.dok_id, storniert: !!x.storniert, art_buchung: x.art } : null;
      }
      if (art === 'dokument') {
        const d = get('SELECT id, titel, datei, objekt_id FROM dokumente WHERE id = ?', Number(a));
        return d ? { art, dokument_id: d.id, objekt_id: d.objekt_id, name: d.titel, datei: d.datei } : null;
      }
      if (art === 'vorgang') {
        const v = get('SELECT id, titel, objekt_id FROM vorgaenge WHERE id = ?', Number(a));
        return v ? { art, vorgang_id: v.id, objekt_id: v.objekt_id, name: v.titel } : null;
      }
      return null;
    },

    personAkte: (personId) => {
      const p = get(`SELECT p.*, ${PERSON_NAME} AS name FROM personen p WHERE p.id = ?`, personId);
      if (!p) return null;
      const vertraege = [
        ...all(`SELECT 'miete' AS typ, m.*, e.bezeichnung AS einheit, o.bezeichnung AS objekt, o.id AS objekt_id FROM mietverhaeltnisse m
          JOIN einheiten e ON e.id = m.einheit_id JOIN objekte o ON o.id = e.objekt_id WHERE ?1 IN (m.person_id, m.person2_id)`, personId),
        ...all(`SELECT 'weg' AS typ, g.*, e.bezeichnung AS einheit, o.bezeichnung AS objekt, o.id AS objekt_id FROM eigentum g
          JOIN einheiten e ON e.id = g.einheit_id JOIN objekte o ON o.id = e.objekt_id WHERE ?1 IN (g.person_id, g.person2_id)`, personId),
      ].map((v) => {
        const i = vertragInfo(v.typ, v);
        const op = i.konto_id ? bh.offenePostenKonto(i.konto_id) : null;
        return { ...i, einheit: v.einheit, objekt: v.objekt, objekt_id: v.objekt_id, konto: i.konto_id ? { id: i.konto_id, nr: i.konto_nr } : null,
          offen: op?.offen.length ?? 0, offene_posten: op?.offen ?? [] };
      }).sort((a, b) => b.aktuell - a.aktuell || (b.beginn > a.beginn ? 1 : -1));
      const kontoIds = vertraege.map((v) => v.konto?.id).filter(Boolean);
      const zahlungen = kontoIds.length ? all(`SELECT b.datum, b.text, b.betrag_ct, CASE WHEN b.haben_id IN (${kontoIds.join(',')}) THEN 'ein' ELSE 'aus' END AS richtung
        FROM buchungen b JOIN konten g ON g.id IN (b.soll_id, b.haben_id) AND g.klasse = 'geld'
        WHERE b.soll_id IN (${kontoIds.join(',')}) OR b.haben_id IN (${kontoIds.join(',')}) ORDER BY b.datum DESC LIMIT 24`) : [];
      return {
        person: p, vertraege, zahlungen,
        dokumente: all(`SELECT id, titel, typ, datum, erfasst, datei, einheit_id, objekt_id FROM dokumente WHERE person_id = ? AND status <> 'postfach'
          ORDER BY coalesce(datum, erfasst) DESC LIMIT 40`, personId),
        vorgaenge: all(`SELECT v.id, v.titel, v.status, v.faellig, v.objekt_id, o.bezeichnung AS objekt FROM vorgaenge v LEFT JOIN objekte o ON o.id = v.objekt_id
          WHERE v.person_id = ? ORDER BY v.status = 'erledigt', v.id DESC LIMIT 20`, personId),
        termine: all(`SELECT t.id, t.titel, t.datum, t.uhrzeit, t.erledigt, t.objekt_id FROM termine t WHERE t.person_id = ? ORDER BY t.datum DESC LIMIT 20`, personId),
        schluessel: all(`SELECT s.bezeichnung, s.nummer, a.anzahl, a.ausgabe, a.rueckgabe, s.objekt_id FROM schluesselausgaben a JOIN schluessel s ON s.id = a.schluessel_id
          WHERE a.person_id = ? ORDER BY a.ausgabe DESC`, personId),
        rollen: all(`SELECT r.rolle, r.objekt_id, o.bezeichnung AS objekt FROM rollen r JOIN objekte o ON o.id = r.objekt_id WHERE r.person_id = ?`, personId),
        zeitleiste: zeitleistePerson(personId),
      };
    },
  };
};
