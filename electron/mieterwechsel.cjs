// Hand-over protocols and the tenant change assistant.
const STANDARDRAEUME = ['Flur / Diele', 'Wohnzimmer', 'Schlafzimmer', 'Kinderzimmer', 'Küche', 'Bad', 'Gäste-WC', 'Balkon / Terrasse', 'Keller', 'Fenster & Türen'];

// Statutory notice for a tenant (§ 573c BGB): notice received by the 3rd working day of a month ends the
// tenancy at the end of the month after next. Saturdays count as working days, Sundays do not (BGH).
function mieterKuendigungsende(eingang) {
  const d = new Date(eingang + 'T00:00:00Z');
  let werktag = 0, tag = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  while (werktag < 3) {
    if (tag.getUTCDay() !== 0) werktag++;
    if (werktag < 3) tag.setUTCDate(tag.getUTCDate() + 1);
  }
  const zusatz = d <= tag ? 3 : 4;
  const ende = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + zusatz, 0));
  return ende.toISOString().slice(0, 10);
}

module.exports = function mieterwechsel({ db, all, get, tx, PERSON_NAME }) {
  const parse = (u) => (u ? { ...u, raeume: JSON.parse(u.raeume), zaehler: JSON.parse(u.zaehler), schluessel: JSON.parse(u.schluessel) } : null);

  return {
    mieterKuendigungsende,

    uebergabenListe: (objektId) => all(`SELECT u.id, u.art, u.datum, u.abgeschlossen, u.dokument_id, e.bezeichnung AS einheit, e.id AS einheit_id,
        ${PERSON_NAME} AS name FROM uebergaben u JOIN einheiten e ON e.id = u.einheit_id
        LEFT JOIN mietverhaeltnisse m ON m.id = u.vertrag_id LEFT JOIN personen p ON p.id = m.person_id
      WHERE e.objekt_id = ? ORDER BY u.datum DESC`, objektId),

    // A new protocol is pre-filled: standard rooms, the unit's meters (with last reading) and keys issued to the tenant.
    uebergabeNeu: ({ einheit_id, vertrag_id, art, datum }) => {
      const zaehler = all(`SELECT z.id AS zaehler_id, z.art, z.nummer, z.einheit AS masseinheit,
          (SELECT stand FROM zaehlerstaende s WHERE s.zaehler_id = z.id ORDER BY datum DESC LIMIT 1) AS letzter
        FROM zaehler z WHERE z.einheit_id = ? AND (z.ausbau IS NULL OR z.ausbau = '')`, einheit_id).map((z) => ({ ...z, stand: null }));
      const v = vertrag_id ? get('SELECT * FROM mietverhaeltnisse WHERE id = ?', vertrag_id) : null;
      const schluessel = all(`SELECT s.id AS schluessel_id, s.bezeichnung, s.nummer,
          coalesce((SELECT sum(a.anzahl) FROM schluesselausgaben a WHERE a.schluessel_id = s.id AND a.person_id = ? AND (a.rueckgabe IS NULL OR a.rueckgabe = '')), 0) AS bei_mieter
        FROM schluessel s JOIN einheiten e ON e.objekt_id = s.objekt_id WHERE e.id = ?`, v?.person_id ?? -1, einheit_id)
        .map((s) => ({ ...s, anzahl: art === 'auszug' ? s.bei_mieter : 0 }));
      const raeume = STANDARDRAEUME.map((name) => ({ name, zustand: '', bemerkung: '', fotos: [] }));
      return Number(db.prepare(`INSERT INTO uebergaben (einheit_id, vertrag_id, art, datum, raeume, zaehler, schluessel) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(einheit_id, vertrag_id ?? null, art, datum, JSON.stringify(raeume), JSON.stringify(zaehler), JSON.stringify(schluessel)).lastInsertRowid);
    },

    uebergabe: (id) => {
      const u = parse(get('SELECT * FROM uebergaben WHERE id = ?', id));
      if (!u) return null;
      const e = get('SELECT e.*, o.bezeichnung AS objekt, o.strasse, o.plz, o.ort FROM einheiten e JOIN objekte o ON o.id = e.objekt_id WHERE e.id = ?', u.einheit_id);
      const v = u.vertrag_id ? get(`SELECT m.*, ${PERSON_NAME} AS name FROM mietverhaeltnisse m JOIN personen p ON p.id = m.person_id WHERE m.id = ?`, u.vertrag_id) : null;
      return { ...u, einheit: e, vertrag: v };
    },

    uebergabeSpeichern: (u) => {
      db.prepare(`UPDATE uebergaben SET datum = ?, teilnehmer = ?, raeume = ?, zaehler = ?, schluessel = ?, notiz = ?, unterschrift_mieter = ?, unterschrift_vermieter = ?
        WHERE id = ? AND abgeschlossen = 0`).run(u.datum, u.teilnehmer ?? null, JSON.stringify(u.raeume), JSON.stringify(u.zaehler), JSON.stringify(u.schluessel),
        u.notiz ?? null, u.unterschrift_mieter ?? null, u.unterschrift_vermieter ?? null, u.id);
    },

    // Completes the protocol: meter readings and key hand-overs are recorded, the PDF is linked.
    uebergabeAbschliessen: (id, dokumentId) => tx(() => {
      const u = parse(get('SELECT * FROM uebergaben WHERE id = ?', id));
      const v = u.vertrag_id ? get('SELECT * FROM mietverhaeltnisse WHERE id = ?', u.vertrag_id) : null;
      const st = db.prepare(`INSERT INTO zaehlerstaende (zaehler_id, datum, stand, notiz) VALUES (?, ?, ?, ?)
        ON CONFLICT (zaehler_id, datum) DO UPDATE SET stand = excluded.stand, notiz = excluded.notiz`);
      for (const z of u.zaehler) if (z.stand != null && z.stand !== '') st.run(z.zaehler_id, u.datum, Number(z.stand), `${u.art === 'einzug' ? 'Einzug' : 'Auszug'}sübergabe`);
      if (v) {
        for (const s of u.schluessel) {
          if (!s.anzahl) continue;
          if (u.art === 'einzug') db.prepare('INSERT INTO schluesselausgaben (schluessel_id, person_id, anzahl, ausgabe, notiz) VALUES (?, ?, ?, ?, ?)')
            .run(s.schluessel_id, v.person_id, s.anzahl, u.datum, 'Einzugsübergabe');
          else db.prepare(`UPDATE schluesselausgaben SET rueckgabe = ? WHERE schluessel_id = ? AND person_id = ? AND (rueckgabe IS NULL OR rueckgabe = '')`)
            .run(u.datum, s.schluessel_id, v.person_id);
        }
      }
      db.prepare('UPDATE uebergaben SET abgeschlossen = 1, dokument_id = ? WHERE id = ?').run(dokumentId ?? null, id);
    }),

    mieterwechsel: (vertragId) => {
      const v = get(`SELECT m.*, e.bezeichnung AS einheit, e.objekt_id, ${PERSON_NAME} AS name FROM mietverhaeltnisse m JOIN einheiten e ON e.id = m.einheit_id
        JOIN personen p ON p.id = m.person_id WHERE m.id = ?`, vertragId);
      const w = get('SELECT * FROM mieterwechsel WHERE vertrag_id = ?', vertragId);
      const konto = get(`SELECT id FROM konten WHERE vertrag_typ = 'miete' AND vertrag_id = ?`, vertragId);
      const nach = v ? get(`SELECT m.id, ${PERSON_NAME} AS name, m.beginn FROM mietverhaeltnisse m JOIN personen p ON p.id = m.person_id
        WHERE m.einheit_id = ? AND m.beginn > ? ORDER BY m.beginn LIMIT 1`, v.einheit_id, v.beginn) : null;
      return {
        vertrag: v, wechsel: w ? { ...w, schritte: JSON.parse(w.schritte) } : null, konto_id: konto?.id ?? null, nachmieter: nach,
        uebergaben: all('SELECT id, art, datum, abgeschlossen FROM uebergaben WHERE vertrag_id = ? OR (einheit_id = ? AND vertrag_id = ?)', vertragId, v?.einheit_id, nach?.id ?? -1),
        kaution: get(`SELECT k.id, coalesce((SELECT sum(CASE WHEN art IN ('einzahlung','zinsen') THEN betrag_ct ELSE -betrag_ct END) FROM kautionsbewegungen b WHERE b.kaution_id = k.id), 0) AS bestand
          FROM kautionen k WHERE k.vertrag_id = ?`, vertragId),
      };
    },

    mieterwechselSpeichern: (vertragId, w) => db.prepare(`INSERT INTO mieterwechsel (vertrag_id, kuendigung_eingang, kuendigung_durch, schritte, notiz) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (vertrag_id) DO UPDATE SET kuendigung_eingang = excluded.kuendigung_eingang, kuendigung_durch = excluded.kuendigung_durch,
        schritte = excluded.schritte, notiz = excluded.notiz`).run(vertragId, w.kuendigung_eingang ?? null, w.kuendigung_durch ?? null, JSON.stringify(w.schritte ?? {}), w.notiz ?? null),

    // Units that are vacant now or become vacant within 4 months, with their offer and interested parties.
    vermietung: (objektId) => {
      const t = new Date().toISOString().slice(0, 10);
      const in4 = new Date(Date.now() + 122 * 864e5).toISOString().slice(0, 10);
      return all(`SELECT e.*, (SELECT max(m.ende) FROM mietverhaeltnisse m WHERE m.einheit_id = e.id AND m.ende IS NOT NULL AND m.ende <> '') AS letztes_ende,
          (SELECT count(*) FROM interessenten i WHERE i.einheit_id = e.id AND i.status NOT IN ('absage', 'vermietet')) AS interessenten
        FROM einheiten e WHERE e.objekt_id = ?1
          AND NOT EXISTS (SELECT 1 FROM mietverhaeltnisse m WHERE m.einheit_id = e.id AND m.beginn <= ?3 AND (m.ende IS NULL OR m.ende = '' OR m.ende > ?3))
          AND NOT EXISTS (SELECT 1 FROM eigentum g WHERE g.einheit_id = e.id AND g.selbstnutzer = 1 AND (g.ende IS NULL OR g.ende = '' OR g.ende >= ?2))
        ORDER BY e.nr`, objektId, t, in4)
        .map((e) => ({ ...e, angebot: get('SELECT * FROM angebote WHERE einheit_id = ?', e.id) ?? null }));
    },
    angebotSpeichern: (einheitId, a) => db.prepare(`INSERT INTO angebote (einheit_id, kaltmiete_ct, bk_vz_ct, hk_vz_ct, kaution_ct, frei_ab, titel, beschreibung, ausstattung, energie)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (einheit_id) DO UPDATE SET kaltmiete_ct = excluded.kaltmiete_ct, bk_vz_ct = excluded.bk_vz_ct,
      hk_vz_ct = excluded.hk_vz_ct, kaution_ct = excluded.kaution_ct, frei_ab = excluded.frei_ab, titel = excluded.titel, beschreibung = excluded.beschreibung,
      ausstattung = excluded.ausstattung, energie = excluded.energie, aktiv = 1`).run(einheitId, a.kaltmiete_ct ?? null, a.bk_vz_ct ?? null, a.hk_vz_ct ?? null,
      a.kaution_ct ?? null, a.frei_ab ?? null, a.titel ?? null, a.beschreibung ?? null, a.ausstattung ?? null, a.energie ?? null),
    interessentenListe: (einheitId) => all('SELECT * FROM interessenten WHERE einheit_id = ? ORDER BY bewertung DESC, id', einheitId),

    // Accepting an applicant: person and tenancy are created from the applicant and the offer.
    zusage: (interessentId, beginn) => tx(() => {
      const i = get('SELECT * FROM interessenten WHERE id = ?', interessentId);
      const a = get('SELECT * FROM angebote WHERE einheit_id = ?', i.einheit_id) ?? {};
      const teile = i.name.trim().split(/\s+/);
      const personId = i.person_id ?? Number(db.prepare('INSERT INTO personen (vorname, nachname, email, telefon) VALUES (?, ?, ?, ?)')
        .run(teile.length > 1 ? teile.slice(0, -1).join(' ') : null, teile.at(-1), i.email ?? null, i.telefon ?? null).lastInsertRowid);
      const vid = Number(db.prepare(`INSERT INTO mietverhaeltnisse (einheit_id, person_id, beginn, kaltmiete_ct, bk_vz_ct, hk_vz_ct, kaution_ct, personen_anzahl)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(i.einheit_id, personId, beginn, a.kaltmiete_ct ?? 0, a.bk_vz_ct ?? 0, a.hk_vz_ct ?? 0, a.kaution_ct ?? 0, i.personen ?? 1).lastInsertRowid);
      db.prepare(`UPDATE interessenten SET status = 'vermietet', person_id = ? WHERE id = ?`).run(personId, interessentId);
      db.prepare(`UPDATE interessenten SET status = 'absage' WHERE einheit_id = ? AND id <> ? AND status NOT IN ('absage', 'vermietet')`).run(i.einheit_id, interessentId);
      db.prepare(`UPDATE angebote SET aktiv = 0 WHERE einheit_id = ?`).run(i.einheit_id);
      return { person_id: personId, vertrag_id: vid };
    }),

    laufendeWechsel: (objektId) => all(`SELECT w.*, m.ende, e.bezeichnung AS einheit, ${PERSON_NAME} AS name FROM mieterwechsel w
      JOIN mietverhaeltnisse m ON m.id = w.vertrag_id JOIN einheiten e ON e.id = m.einheit_id JOIN personen p ON p.id = m.person_id
      WHERE e.objekt_id = ? ORDER BY m.ende`, objektId).map((w) => ({ ...w, schritte: JSON.parse(w.schritte) })),
  };
};

module.exports.mieterKuendigungsende = mieterKuendigungsende;
