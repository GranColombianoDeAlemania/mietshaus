// Overviews that pull everything together: object tiles for the cockpit, the object fact sheet
// and the person file, each with a timeline of what happened.
module.exports = function akten({ db, all, get, PERSON_NAME, bh }) {
  const heute = () => new Date().toISOString().slice(0, 10);
  const BILD = `(lower(d.datei) GLOB '*.jp*g' OR lower(d.datei) GLOB '*.png' OR lower(d.datei) GLOB '*.webp')`;

  // Title photo: the chosen one, otherwise the newest photo of the house itself (not of a unit).
  const titelbild = (o) => (o.titelbild_id ? get('SELECT datei FROM dokumente WHERE id = ?', o.titelbild_id)?.datei : null) ??
    get(`SELECT d.datei FROM dokumente d WHERE d.objekt_id = ? AND d.einheit_id IS NULL AND d.status <> 'postfach' AND ${BILD}
      ORDER BY (d.typ = 'Foto') DESC, d.id DESC LIMIT 1`, o.id)?.datei ?? null;

  const rueckstand = (objektId, typ) => all(`SELECT id FROM konten WHERE objekt_id = ? AND klasse = 'person' AND (?2 IS NULL OR vertrag_typ = ?2)`, objektId, typ ?? null)
    .reduce((s, k) => s + Math.max(0, bh.offenePostenKonto(k.id).summe_ct), 0);

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
      const mieten = get(`SELECT count(*) AS n, coalesce(sum(m.kaltmiete_ct), 0) AS kalt FROM mietverhaeltnisse m JOIN einheiten e ON e.id = m.einheit_id
        WHERE e.objekt_id = ?1 AND m.beginn <= ?2 AND (m.ende IS NULL OR m.ende = '' OR m.ende >= ?2)`, objektId, t);
      const eigner = get(`SELECT count(DISTINCT g.person_id) AS n FROM eigentum g JOIN einheiten e ON e.id = g.einheit_id
        WHERE e.objekt_id = ?1 AND g.beginn <= ?2 AND (g.ende IS NULL OR g.ende = '' OR g.ende >= ?2)`, objektId, t).n;
      return {
        objekt: { ...o, titelbild: titelbild(o) },
        einheiten: e.n, flaeche: e.f, mea: e.mea, mieter: mieten.n, kaltmiete_ct: mieten.kalt, eigentuemer: eigner,
        rueckstand_ct: rueckstand(objektId, null),
        geld: all(`SELECT id, nr, bezeichnung FROM konten WHERE objekt_id = ? AND klasse = 'geld' ORDER BY nr`, objektId).map((k) => ({ ...k, saldo_ct: bh.saldoBis(k.id, t) })),
        zaehler: get('SELECT count(*) AS n FROM zaehler WHERE objekt_id = ? AND (ausbau IS NULL OR ausbau = \'\')', objektId).n,
        versicherungen: all('SELECT art, gesellschaft, beitrag_ct, kuendbar_bis FROM versicherungen WHERE objekt_id = ? ORDER BY art', objektId),
        kontakte: all(`SELECT r.rolle, ${PERSON_NAME} AS name, p.telefon, p.mobil, p.email FROM rollen r JOIN personen p ON p.id = r.person_id
          WHERE r.objekt_id = ? AND (r.bis IS NULL OR r.bis = '' OR r.bis >= ?) ORDER BY r.rolle`, objektId, t),
        darlehen: all(`SELECT * FROM darlehen WHERE objekt_id = ?`, objektId).length ? all(`SELECT id, bank, betrag_ct, zinssatz, zinsbindung_bis FROM darlehen WHERE objekt_id = ?`, objektId) : [],
        vorgaenge: all(`SELECT id, titel, faellig, status FROM vorgaenge WHERE objekt_id = ? AND status <> 'erledigt' ORDER BY coalesce(faellig, '9999') LIMIT 8`, objektId),
        projekte: all(`SELECT id, titel, status FROM projekte WHERE objekt_id = ? AND status <> 'abgeschlossen'`, objektId),
        dokumente: all(`SELECT id, titel, typ, datum, erfasst, datei FROM dokumente WHERE objekt_id = ? AND status <> 'postfach'
          ORDER BY coalesce(datum, erfasst) DESC, id DESC LIMIT 8`, objektId),
        zeitleiste: zeitleisteObjekt(objektId),
      };
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
        const k = bh.kontoVon(v.typ, v.id);
        const op = k ? bh.offenePostenKonto(k.id) : null;
        return { ...v, konto: k, saldo_ct: op?.summe_ct ?? 0, offen: op?.offen.length ?? 0 };
      });
      const kontoIds = vertraege.map((v) => v.konto?.id).filter(Boolean);
      const zahlungen = kontoIds.length ? all(`SELECT b.datum, b.text, b.betrag_ct, CASE WHEN b.haben_id IN (${kontoIds.join(',')}) THEN 'ein' ELSE 'aus' END AS richtung
        FROM buchungen b JOIN konten g ON g.id IN (b.soll_id, b.haben_id) AND g.klasse = 'geld'
        WHERE b.soll_id IN (${kontoIds.join(',')}) OR b.haben_id IN (${kontoIds.join(',')}) ORDER BY b.datum DESC LIMIT 24`) : [];
      return {
        person: p, vertraege, zahlungen,
        dokumente: all(`SELECT id, titel, typ, datum, erfasst, datei FROM dokumente WHERE person_id = ? ORDER BY coalesce(datum, erfasst) DESC LIMIT 20`, personId),
        vorgaenge: all(`SELECT v.id, v.titel, v.status, v.faellig, o.bezeichnung AS objekt FROM vorgaenge v LEFT JOIN objekte o ON o.id = v.objekt_id
          WHERE v.person_id = ? ORDER BY v.status = 'erledigt', v.id DESC LIMIT 20`, personId),
        schluessel: all(`SELECT s.bezeichnung, s.nummer, a.anzahl, a.ausgabe, a.rueckgabe FROM schluesselausgaben a JOIN schluessel s ON s.id = a.schluessel_id
          WHERE a.person_id = ? ORDER BY a.ausgabe DESC`, personId),
        rollen: all(`SELECT r.rolle, o.bezeichnung AS objekt FROM rollen r JOIN objekte o ON o.id = r.objekt_id WHERE r.person_id = ?`, personId),
        zeitleiste: zeitleistePerson(personId),
      };
    },
  };
};
