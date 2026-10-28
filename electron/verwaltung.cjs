// Tenancy extras (deposits, indexed rent, rent increases), owners' meetings and resolutions,
// documents, cases, appointments and the DATEV export.
const { tageZwischen } = require('./buchhaltung.cjs');
const ortszeit = require('./zeit.cjs');

// First of the month n months after the month of iso.
const plusMonate = (iso, n) => {
  const d = new Date(iso.slice(0, 7) + '-01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
// Same calendar day n months later (the month's last day when that day does not exist).
const plusMonateGenau = (iso, n) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const z = new Date(Date.UTC(y, m - 1 + n, 1));
  const letzter = new Date(Date.UTC(z.getUTCFullYear(), z.getUTCMonth() + 1, 0)).getUTCDate();
  return `${z.toISOString().slice(0, 8)}${String(Math.min(d, letzter)).padStart(2, '0')}`;
};
// First of the month on or after a date.
const monatsbeginn = (iso) => (iso.slice(8, 10) === '01' ? iso.slice(0, 10) : plusMonate(iso, 1));
const vortag = (iso) => {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
// Rent changes that do not count for waiting periods and caps: modernisation (§ 559) and operating costs (§ 560).
const NICHT_ZAEHLEND = "('modernisierung','nk_anpassung','wirtschaftsplan')";

module.exports = function verwaltung({ db, all, get, tx, PERSON_NAME, bh }) {
  const kautionStand = (kautionId, bis = '9999-12-31') => get(`SELECT
      coalesce(sum(CASE WHEN art IN ('einzahlung','zinsen') THEN betrag_ct ELSE -betrag_ct END), 0) AS s
    FROM kautionsbewegungen WHERE kaution_id = ? AND datum <= ?`, kautionId, bis).s;

  // Votes per owner for a resolution: per head (one vote per owner), per co-ownership share, or per unit.
  function stimmen(objektId, art, stichtag) {
    const rows = all(`SELECT g.person_id, ${PERSON_NAME} AS name, e.mea, e.bezeichnung FROM eigentum g
      JOIN einheiten e ON e.id = g.einheit_id JOIN personen p ON p.id = g.person_id
      WHERE e.objekt_id = ? AND g.beginn <= ? AND (g.ende IS NULL OR g.ende = '' OR g.ende >= ?)`, objektId, stichtag, stichtag);
    const map = new Map();
    for (const r of rows) {
      const m = map.get(r.person_id) ?? { person_id: r.person_id, name: r.name, einheiten: [], stimmen: 0 };
      m.einheiten.push(r.bezeichnung);
      m.stimmen = art === 'kopf' ? 1 : art === 'mea' ? m.stimmen + (r.mea ?? 0) : m.stimmen + 1;
      map.set(r.person_id, m);
    }
    return [...map.values()];
  }

  return {
    // ---------- deposits ----------
    kautionen: (objektId) => all(`SELECT m.id AS vertrag_id, m.kaution_ct AS soll_ct, m.beginn, m.ende, e.bezeichnung AS einheit, e.id AS einheit_id, m.person_id,
        ${PERSON_NAME} AS name, k.id AS kaution_id, k.art, k.bank, k.iban, k.zinssatz
      FROM mietverhaeltnisse m JOIN einheiten e ON e.id = m.einheit_id JOIN personen p ON p.id = m.person_id
      LEFT JOIN kautionen k ON k.vertrag_id = m.id WHERE e.objekt_id = ? ORDER BY e.nr, m.beginn DESC`, objektId)
      .map((r) => ({ ...r, ist_ct: r.kaution_id ? kautionStand(r.kaution_id) : 0 })),

    kautionAnlegen: (vertragId) => {
      const k = get('SELECT id FROM kautionen WHERE vertrag_id = ?', vertragId);
      return k ? k.id : Number(db.prepare('INSERT INTO kautionen (vertrag_id) VALUES (?)').run(vertragId).lastInsertRowid);
    },

    kautionsbewegungen: (kautionId) => all('SELECT * FROM kautionsbewegungen WHERE kaution_id = ? ORDER BY datum', kautionId),

    // Simple annual interest on the balance since the last interest entry (for savings-account deposits).
    kautionZinsVorschlag: (kautionId, bis) => {
      const k = get('SELECT * FROM kautionen WHERE id = ?', kautionId);
      const letzte = get(`SELECT max(datum) AS d FROM kautionsbewegungen WHERE kaution_id = ? AND art IN ('zinsen','einzahlung')`, kautionId).d;
      if (!k?.zinssatz || !letzte) return 0;
      return Math.max(0, Math.round(kautionStand(kautionId, bis) * k.zinssatz / 100 * tageZwischen(letzte, bis) / 365));
    },

    // ---------- indexed and stepped rent ----------
    indexwerte: () => all('SELECT * FROM indexwerte ORDER BY monat DESC'),
    indexwerteSetzen: (liste) => tx(() => {
      const st = db.prepare('INSERT INTO indexwerte (monat, wert) VALUES (?, ?) ON CONFLICT (monat) DO UPDATE SET wert = excluded.wert');
      for (const [m, w] of liste) st.run(m, w);
      return liste.length;
    }),
    indexwertLoeschen: (monat) => db.prepare('DELETE FROM indexwerte WHERE monat = ?').run(monat),

    mietmodell: (vertragId) => get('SELECT * FROM mietmodelle WHERE vertrag_id = ?', vertragId) ?? null,
    mietmodellSetzen: (vertragId, m) => {
      if (!m) return db.prepare('DELETE FROM mietmodelle WHERE vertrag_id = ?').run(vertragId);
      db.prepare(`INSERT INTO mietmodelle (vertrag_id, art, basis_monat, mindestabstand_monate) VALUES (?, ?, ?, ?)
        ON CONFLICT (vertrag_id) DO UPDATE SET art = excluded.art, basis_monat = excluded.basis_monat,
        mindestabstand_monate = excluded.mindestabstand_monate`).run(vertragId, m.art, m.basis_monat ?? null, m.mindestabstand_monate ?? 12);
    },

    // § 557b BGB: new rent = base rent × (current index / index at the base month or last adjustment).
    // zugang: day the tenant receives the declaration; the new rent applies from the start of the month after next.
    indexBerechnung: (vertragId, neuMonat, zugang = null) => {
      const m = get('SELECT * FROM mietmodelle WHERE vertrag_id = ?', vertragId);
      if (!m || m.art !== 'index') throw new Error('Für diesen Vertrag ist keine Indexmiete hinterlegt.');
      const letzte = get(`SELECT * FROM anpassungen WHERE vertrag_typ = 'miete' AND vertrag_id = ? AND grund = 'index' ORDER BY gueltig_ab DESC LIMIT 1`, vertragId);
      const basisMonat = letzte?.notiz?.match(/Index (\d{4}-\d{2})/)?.[1] ?? m.basis_monat;
      const alt = get('SELECT wert FROM indexwerte WHERE monat = ?', basisMonat)?.wert;
      const neuM = neuMonat ?? get('SELECT max(monat) AS m FROM indexwerte').m;
      const neu = get('SELECT wert FROM indexwerte WHERE monat = ?', neuM)?.wert;
      if (!alt || !neu) throw new Error(`Indexwert fehlt für ${!alt ? basisMonat : neuM}. Bitte unter „Indexwerte“ ergänzen.`);
      const v = get('SELECT * FROM mietverhaeltnisse WHERE id = ?', vertragId);
      const heute = ortszeit.heute();
      // Unchanged since the last change of the base rent (modernisation and operating costs aside).
      const seit = get(`SELECT max(gueltig_ab) AS d FROM anpassungen WHERE vertrag_typ = 'miete' AND vertrag_id = ? AND kaltmiete_ct IS NOT NULL
        AND grund NOT IN ${NICHT_ZAEHLEND} AND gueltig_ab <= ?`, vertragId, heute).d ?? v.beginn;
      const aktuell = bh.betraege('miete', vertragId, heute);
      const neueMiete = Math.round(aktuell.kaltmiete_ct * neu / alt);
      const z = zugang ?? heute;
      return {
        basis_monat: basisMonat, basis_wert: alt, neu_monat: neuM, neu_wert: neu,
        aenderung_prozent: (neu / alt - 1) * 100, alte_miete_ct: aktuell.kaltmiete_ct, neue_miete_ct: neueMiete, erhoehung_ct: neueMiete - aktuell.kaltmiete_ct,
        unveraendert_seit: seit, zugang: z,
        // The rent must remain unchanged for at least 12 months (§ 557b Abs. 2); the new rent applies from the start of the month after next (Abs. 3).
        frueheste_wirkung: [monatsbeginn(plusMonateGenau(seit, m.mindestabstand_monate ?? 12)), plusMonate(z, 2)].sort().pop(),
      };
    },

    // § 558 BGB checks for a rent increase up to the local comparative rent:
    // - the rent has been unchanged for 15 months when the increase takes effect, the request comes at least a year after the last increase (Abs. 1);
    // - cap of 20 % (15 % where a state ordinance applies) within three years, modernisation increases aside (Abs. 3);
    // - effect from the start of the third month after receipt, consent due by the end of the second month (§ 558b);
    // - no § 558 increase during a graduated or indexed rent (§ 557a Abs. 2, § 557b Abs. 2).
    mieterhoehungPruefen: (vertragId, neueMieteCt, ab, kappung = null, zugang = null) => {
      const v = get('SELECT * FROM mietverhaeltnisse WHERE id = ?', vertragId);
      const e = get('SELECT e.wohnflaeche, o.kappungsgrenze FROM einheiten e JOIN objekte o ON o.id = e.objekt_id WHERE e.id = ?', v.einheit_id);
      const k = kappung ?? e?.kappungsgrenze ?? 20;
      const z = zugang ?? ortszeit.heute();
      const vor3 = plusMonateGenau(ab, -36);
      const basisDatum = vor3 < v.beginn ? v.beginn : vor3;
      const basis = bh.betraege('miete', vertragId, basisDatum).kaltmiete_ct;
      const zuschlaege = all(`SELECT gueltig_ab, kaltmiete_ct FROM anpassungen WHERE vertrag_typ = 'miete' AND vertrag_id = ? AND grund = 'modernisierung'
        AND kaltmiete_ct IS NOT NULL AND gueltig_ab > ? AND gueltig_ab < ?`, vertragId, basisDatum, ab)
        .reduce((s, a) => s + a.kaltmiete_ct - bh.betraege('miete', vertragId, vortag(a.gueltig_ab)).kaltmiete_ct, 0);
      const letzte = get(`SELECT max(gueltig_ab) AS d FROM anpassungen WHERE vertrag_typ = 'miete' AND vertrag_id = ? AND kaltmiete_ct IS NOT NULL
        AND grund NOT IN ${NICHT_ZAEHLEND} AND gueltig_ab < ?`, vertragId, ab).d ?? v.beginn;
      const alt = bh.betraege('miete', vertragId, vortag(ab)).kaltmiete_ct;
      // Integer arithmetic: 50000 × 1.15 would give 57499.99….
      const grenze = Math.floor(basis * (100 + k) / 100) + zuschlaege;
      const modell = get('SELECT art FROM mietmodelle WHERE vertrag_id = ?', vertragId)?.art ?? null;
      const wirkungFrueh = plusMonate(z, 3);
      const qm = e?.wohnflaeche || null;
      return {
        basis_ct: basis, basis_datum: basisDatum, kappung: k, zuschlaege_ct: zuschlaege, grenze_ct: grenze, kappung_ok: neueMieteCt <= grenze,
        letzte_aenderung: letzte, frist_ok: ab >= plusMonateGenau(letzte, 15),
        verlangen_ab: plusMonateGenau(letzte, 12), jahresfrist_ok: z >= plusMonateGenau(letzte, 12),
        zugang: z, wirkung_frueh: wirkungFrueh, wirkung_ok: ab >= wirkungFrueh, zustimmung_bis: vortag(wirkungFrueh),
        frueheste_wirkung: [wirkungFrueh, monatsbeginn(plusMonateGenau(letzte, 15))].sort().pop(),
        modell, modell_ok: modell !== 'staffel' && modell !== 'index',
        // Increase within the three years against the cap, modernisation surcharges excluded.
        alt_ct: alt, erhoehung_ct: neueMieteCt - alt, erhoehung_prozent: basis ? ((neueMieteCt - zuschlaege) / basis - 1) * 100 : 0,
        qm, alt_qm: qm ? alt / 100 / qm : null, neu_qm: qm ? neueMieteCt / 100 / qm : null,
      };
    },

    // § 559 Abs. 3a BGB: within six years at most 3 €/m² more (2 €/m² when the rent was below 7 €/m²); earlier modernisation increases count.
    // The increase applies from the start of the third month after receipt (§ 559b Abs. 2).
    modernisierungPruefen: (vertragId, neueMieteCt, ab, zugang = null) => {
      const v = get('SELECT * FROM mietverhaeltnisse WHERE id = ?', vertragId);
      const qm = get('SELECT wohnflaeche FROM einheiten WHERE id = ?', v.einheit_id)?.wohnflaeche || null;
      const alt = bh.betraege('miete', vertragId, vortag(ab)).kaltmiete_ct;
      const frueher = all(`SELECT gueltig_ab, kaltmiete_ct FROM anpassungen WHERE vertrag_typ = 'miete' AND vertrag_id = ? AND grund = 'modernisierung'
        AND kaltmiete_ct IS NOT NULL AND gueltig_ab > ? AND gueltig_ab < ?`, vertragId, plusMonateGenau(ab, -72), ab)
        .reduce((s, a) => s + a.kaltmiete_ct - bh.betraege('miete', vertragId, vortag(a.gueltig_ab)).kaltmiete_ct, 0);
      const satz = qm && alt / 100 / qm < 7 ? 2 : 3;
      const grenze = qm ? Math.round(satz * qm * 100) - frueher : null;
      const z = zugang ?? ortszeit.heute();
      return { qm, alt_ct: alt, erhoehung_ct: neueMieteCt - alt, frueher_ct: frueher, satz, grenze_ct: grenze,
        kappung_ok: grenze == null || neueMieteCt - alt <= grenze, zugang: z, wirkung_frueh: plusMonate(z, 3), wirkung_ok: ab >= plusMonate(z, 3) };
    },

    // ---------- owners' association ----------
    stimmen,
    versammlung: (id) => {
      const v = get('SELECT * FROM versammlungen WHERE id = ?', id);
      return v ? { ...v, tops: all('SELECT * FROM tops WHERE versammlung_id = ? ORDER BY nr', id) } : null;
    },
    // Records the vote on an agenda item and enters an adopted or rejected resolution in the register.
    topBeschliessen: (topId) => tx(() => {
      const t = get('SELECT t.*, v.objekt_id, v.datum FROM tops t JOIN versammlungen v ON v.id = t.versammlung_id WHERE t.id = ?', topId);
      const ergebnis = (t.ja ?? 0) > (t.nein ?? 0) ? 'angenommen' : 'abgelehnt';
      const text = `${t.beschlussvorschlag ?? ''}\n\nAbstimmung (${t.abstimmungsart === 'kopf' ? 'nach Köpfen' : t.abstimmungsart === 'mea' ? 'nach Miteigentumsanteilen' : 'nach Einheiten'}): ` +
        `Ja ${t.ja ?? 0}, Nein ${t.nein ?? 0}, Enthaltung ${t.enthaltung ?? 0}.`;
      if (t.beschluss_id) {
        db.prepare('UPDATE beschluesse SET titel = ?, text = ?, ergebnis = ?, datum = ? WHERE id = ?').run(t.titel, text.trim(), ergebnis, t.datum, t.beschluss_id);
      } else {
        const nr = (get('SELECT max(nr) AS n FROM beschluesse WHERE objekt_id = ?', t.objekt_id).n ?? 0) + 1;
        const bid = Number(db.prepare(`INSERT INTO beschluesse (objekt_id, nr, datum, art, titel, text, ergebnis) VALUES (?, ?, ?, 'versammlung', ?, ?, ?)`)
          .run(t.objekt_id, nr, t.datum, t.titel, text.trim(), ergebnis).lastInsertRowid);
        db.prepare('UPDATE tops SET beschluss_id = ? WHERE id = ?').run(bid, topId);
      }
      db.prepare('UPDATE tops SET ergebnis = ? WHERE id = ?').run(ergebnis, topId);
      return ergebnis;
    }),
    naechsteBeschlussNr: (objektId) => (get('SELECT max(nr) AS n FROM beschluesse WHERE objekt_id = ?', objektId).n ?? 0) + 1,

    rollenListe: (objektId) => all(`SELECT r.*, ${PERSON_NAME} AS name, p.telefon, p.mobil, p.email FROM rollen r
      JOIN personen p ON p.id = r.person_id WHERE r.objekt_id = ? ORDER BY r.rolle, p.nachname`, objektId),

    schluesselListe: (objektId) => all(`SELECT s.*,
        (SELECT coalesce(sum(anzahl), 0) FROM schluesselausgaben a WHERE a.schluessel_id = s.id AND (a.rueckgabe IS NULL OR a.rueckgabe = '')) AS ausgegeben
      FROM schluessel s WHERE s.objekt_id = ? ORDER BY s.bezeichnung`, objektId),
    schluesselausgabenListe: (schluesselId) => all(`SELECT a.*, ${PERSON_NAME} AS name FROM schluesselausgaben a
      JOIN personen p ON p.id = a.person_id WHERE a.schluessel_id = ? ORDER BY a.ausgabe DESC`, schluesselId),

    // ---------- documents, cases, appointments ----------
    dokumenteListe: (objektId) => all(`SELECT d.*, ${PERSON_NAME} AS person, e.bezeichnung AS einheit FROM dokumente d
      LEFT JOIN personen p ON p.id = d.person_id LEFT JOIN einheiten e ON e.id = d.einheit_id
      WHERE (?1 IS NULL OR d.objekt_id = ?1) ORDER BY coalesce(d.datum, '') DESC, d.id DESC`, objektId ?? null),

    vorgaengeListe: (objektId, nurOffen) => all(`SELECT v.*, ${PERSON_NAME} AS person, e.bezeichnung AS einheit, o.bezeichnung AS objekt,
        (SELECT count(*) FROM vorgangseintraege x WHERE x.vorgang_id = v.id) AS eintraege,
        (SELECT b.name FROM benutzer b WHERE b.id = v.zustaendig) AS zustaendig_name
      FROM vorgaenge v LEFT JOIN personen p ON p.id = v.person_id LEFT JOIN einheiten e ON e.id = v.einheit_id
      LEFT JOIN objekte o ON o.id = v.objekt_id
      WHERE (?1 IS NULL OR v.objekt_id = ?1) AND (?2 = 0 OR v.status <> 'erledigt')
      ORDER BY v.status = 'erledigt', coalesce(v.faellig, '9999'), v.prioritaet, v.id DESC`, objektId ?? null, nurOffen ? 1 : 0),

    // Open cases assigned to a user, for "Meine Aufgaben" in the cockpit.
    meineAufgaben: (benutzerId) => all(`SELECT v.*, o.bezeichnung AS objekt FROM vorgaenge v LEFT JOIN objekte o ON o.id = v.objekt_id
      WHERE v.zustaendig = ? AND v.status <> 'erledigt' ORDER BY coalesce(v.faellig, '9999'), v.prioritaet, v.id`, benutzerId),

    termineListe: (von, bis) => all(`SELECT t.*, o.bezeichnung AS objekt, ${PERSON_NAME} AS person, v.titel AS vorgang FROM termine t
      LEFT JOIN objekte o ON o.id = t.objekt_id LEFT JOIN personen p ON p.id = t.person_id LEFT JOIN vorgaenge v ON v.id = t.vorgang_id
      WHERE t.datum BETWEEN ? AND ? ORDER BY t.datum, coalesce(t.uhrzeit, '')`, von, bis),

    // Things that need attention soon, for the overview page.
    faelligkeiten: (tage = 30) => {
      const bis = ortszeit.inTagen(tage);
      return {
        vorgaenge: all(`SELECT v.id, v.titel, v.faellig, o.bezeichnung AS objekt FROM vorgaenge v LEFT JOIN objekte o ON o.id = v.objekt_id
          WHERE v.status <> 'erledigt' AND v.faellig IS NOT NULL AND v.faellig <= ? ORDER BY v.faellig`, bis),
        termine: all(`SELECT t.id, t.titel, t.datum, t.uhrzeit, o.bezeichnung AS objekt FROM termine t LEFT JOIN objekte o ON o.id = t.objekt_id
          WHERE t.erledigt = 0 AND t.datum BETWEEN date('now', 'localtime') AND ? ORDER BY t.datum`, bis),
        vertraege: all(`SELECT 'miete' AS typ, m.ende AS datum, e.bezeichnung AS einheit, o.bezeichnung AS objekt FROM mietverhaeltnisse m
          JOIN einheiten e ON e.id = m.einheit_id JOIN objekte o ON o.id = e.objekt_id WHERE m.ende BETWEEN date('now', 'localtime') AND ?`, bis),
        eichungen: all(`SELECT z.nummer, z.art, z.eichung_bis AS datum, o.bezeichnung AS objekt FROM zaehler z JOIN objekte o ON o.id = z.objekt_id
          WHERE (z.ausbau IS NULL OR z.ausbau = '') AND z.eichung_bis IS NOT NULL AND z.eichung_bis <= ?`, bis),
        versicherungen: all(`SELECT v.art, v.gesellschaft, v.kuendbar_bis AS datum, o.bezeichnung AS objekt FROM versicherungen v
          JOIN objekte o ON o.id = v.objekt_id WHERE v.kuendbar_bis BETWEEN date('now', 'localtime') AND ?`, bis),
      };
    },

    // ---------- DATEV ----------
    // Postings in DATEV "Buchungsstapel" format (EXTF 700). Account numbers are taken as they are.
    datevExport: (objektId, von, bis, berater, mandant, wjBeginn) => {
      const o = get('SELECT * FROM objekte WHERE id = ?', objektId);
      const rows = all(`SELECT b.*, s.nr AS soll_nr, h.nr AS haben_nr FROM buchungen b JOIN konten s ON s.id = b.soll_id
        JOIN konten h ON h.id = b.haben_id WHERE b.objekt_id = ? AND b.datum BETWEEN ? AND ? ORDER BY b.datum, b.id`, objektId, von, bis);
      const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
      const d8 = (iso) => iso.replace(/-/g, '');
      const jetzt = new Date().toISOString().replace(/\D/g, '').slice(0, 17);
      const kopf = ['"EXTF"', 700, 21, '"Buchungsstapel"', 13, jetzt, '', '"RE"', '""', '""', berater || 0, mandant || 0,
        d8(wjBeginn || `${von.slice(0, 4)}-01-01`), 5, d8(von), d8(bis), q(`Mietshaus ${o.bezeichnung}`.slice(0, 30)), '""', 1, 0, 0, '"EUR"'].join(';');
      const spalten = ['Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Kurs', 'Basis-Umsatz', 'WKZ Basis-Umsatz',
        'Konto', 'Gegenkonto (ohne BU-Schlüssel)', 'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Skonto', 'Buchungstext'].join(';');
      const zeilen = rows.map((b) => [
        (b.betrag_ct / 100).toFixed(2).replace('.', ','), '"S"', '"EUR"', '', '', '', b.soll_nr, b.haben_nr, '""',
        b.datum.slice(8, 10) + b.datum.slice(5, 7), q((b.beleg ?? '').slice(0, 36)), '""', '', q((b.text ?? '').slice(0, 60)),
      ].join(';'));
      return [kopf, spalten, ...zeilen].join('\r\n') + '\r\n';
    },
  };
};
