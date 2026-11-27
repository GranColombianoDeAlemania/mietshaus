// Tenancy extras (deposits, indexed rent, rent increases), owners' meetings and resolutions,
// documents, cases, appointments and the DATEV export.
const { tageZwischen } = require('./buchhaltung.cjs');
const ortszeit = require('./zeit.cjs');
const { istZustaendigSql, namenSql } = require('./zustaendig.cjs');
const { objektSql, zeileSql, dokumentOhne } = require('./welt.cjs');

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
  // Running numbers of the register are never reused, also after an entry was deleted (counter per house).
  function beschlussNr(objektId, vergeben = true) {
    const key = `beschluss_nr_${objektId}`;
    const zaehler = Number(get('SELECT wert FROM einstellungen WHERE schluessel = ?', key)?.wert ?? 0);
    const nr = Math.max(zaehler, get('SELECT max(nr) AS n FROM beschluesse WHERE objekt_id = ?', objektId).n ?? 0) + 1;
    if (vergeben) db.prepare('INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?) ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert').run(key, String(nr));
    return nr;
  }
  function stimmen(objektId, art, stichtag) {
    const rows = all(`SELECT g.person_id, g.person2_id, ${PERSON_NAME} AS name, e.mea, e.bezeichnung FROM eigentum g
      JOIN einheiten e ON e.id = g.einheit_id JOIN personen p ON p.id = g.person_id
      WHERE e.objekt_id = ? AND g.beginn <= ? AND (g.ende IS NULL OR g.ende = '' OR g.ende >= ?)`, objektId, stichtag, stichtag);
    const map = new Map();
    for (const r of rows) {
      // Co-owners of a unit vote together (§ 25 Abs. 2 S. 2 WEG) but are each invited.
      const m = map.get(r.person_id) ?? { person_id: r.person_id, name: r.name, einheiten: [], stimmen: 0, mea: 0, mit: [] };
      m.einheiten.push(r.bezeichnung);
      m.mea += r.mea ?? 0;
      if (r.person2_id && !m.mit.includes(r.person2_id)) m.mit.push(r.person2_id);
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

    // Interest of a savings-account deposit since the last interest entry, as the bank credits it: per day on that day's
    // balance (top-ups and payouts count from their date), added to the deposit at each year's end (§ 551 Abs. 3 BGB:
    // the returns increase the deposit). A full year gives exactly the rate, also in a leap year.
    kautionZinsVorschlag: (kautionId, bis) => {
      const satz = get('SELECT zinssatz FROM kautionen WHERE id = ?', kautionId)?.zinssatz;
      const bew = all('SELECT datum, art FROM kautionsbewegungen WHERE kaution_id = ? AND datum <= ? ORDER BY datum', kautionId, bis);
      if (!satz || !bew.length) return 0;
      // Interest up to the last interest entry is booked; without one it runs from the first movement.
      const von = bew.filter((b) => b.art === 'zinsen').at(-1)?.datum ?? bew[0].datum;
      const stopps = [bis, ...bew.map((b) => b.datum).filter((d) => d > von)];
      for (let j = Number(von.slice(0, 4)) + 1; j <= Number(bis.slice(0, 4)); j++) stopps.push(`${j}-01-01`);
      // Up to the next stop the balance stays: the movements up to the day plus the interest credited so far.
      let tag = von, offen = 0, gesamt = 0;
      for (const s of [...new Set(stopps)].sort()) {
        const j = Number(tag.slice(0, 4));
        offen += Math.max(0, kautionStand(kautionId, tag) + gesamt) * satz / 100 * tageZwischen(tag, s) / tageZwischen(`${j}-01-01`, `${j + 1}-01-01`);
        tag = s;
        if (s.endsWith('-01-01')) { gesamt += Math.round(offen); offen = 0; }
      }
      return gesamt + Math.round(offen);
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
      // The base is the index month of the last adjustment; the contract's base month would count that increase twice.
      if (letzte && !letzte.index_monat) throw new Error(`Bei der Indexanpassung ab ${letzte.gueltig_ab.split('-').reverse().join('.')} fehlt der Indexmonat. Bitte dort eintragen.`);
      const basisMonat = letzte ? letzte.index_monat : m.basis_monat;
      const alt = get('SELECT wert FROM indexwerte WHERE monat = ?', basisMonat)?.wert;
      const neuM = neuMonat ?? get('SELECT max(monat) AS m FROM indexwerte').m;
      const neu = get('SELECT wert FROM indexwerte WHERE monat = ?', neuM)?.wert;
      if (!alt || !neu) throw new Error(`Indexwert fehlt für ${!alt ? basisMonat : neuM}. Bitte unter „Indexwerte“ ergänzen.`);
      const v = get('SELECT * FROM mietverhaeltnisse WHERE id = ?', vertragId);
      const heute = ortszeit.heute();
      // Unchanged since the last change of the base rent (modernisation and operating costs aside).
      const seit = get(`SELECT max(gueltig_ab) AS d FROM anpassungen WHERE vertrag_typ = 'miete' AND vertrag_id = ? AND kaltmiete_ct IS NOT NULL
        AND coalesce(grund, '') NOT IN ${NICHT_ZAEHLEND} AND gueltig_ab <= ?`, vertragId, heute).d ?? v.beginn;
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
        AND coalesce(grund, '') NOT IN ${NICHT_ZAEHLEND} AND gueltig_ab < ?`, vertragId, ab).d ?? v.beginn;
      const alt = bh.betraege('miete', vertragId, vortag(ab)).kaltmiete_ct;
      // Integer arithmetic: 50000 × 1.15 would give 57499.99….
      const grenze = Math.floor(basis * (100 + k) / 100) + zuschlaege;
      let modell = get('SELECT art FROM mietmodelle WHERE vertrag_id = ?', vertragId)?.art ?? null;
      // A graduated rent whose last step has passed no longer blocks § 558 (§ 557a Abs. 2 applies only while it runs).
      const staffelAbgelaufen = modell === 'staffel' && !get(`SELECT 1 FROM anpassungen WHERE vertrag_typ = 'miete' AND vertrag_id = ? AND grund = 'staffel' AND gueltig_ab >= ?`, vertragId, ab);
      if (staffelAbgelaufen) modell = null;
      const wirkungFrueh = plusMonate(z, 3);
      const qm = e?.wohnflaeche || null;
      return {
        basis_ct: basis, basis_datum: basisDatum, kappung: k, zuschlaege_ct: zuschlaege, grenze_ct: grenze, kappung_ok: neueMieteCt <= grenze,
        letzte_aenderung: letzte, frist_ok: ab >= plusMonateGenau(letzte, 15),
        verlangen_ab: plusMonateGenau(letzte, 12), jahresfrist_ok: z >= plusMonateGenau(letzte, 12),
        zugang: z, wirkung_frueh: wirkungFrueh, wirkung_ok: ab >= wirkungFrueh, zustimmung_bis: vortag(wirkungFrueh),
        frueheste_wirkung: [wirkungFrueh, monatsbeginn(plusMonateGenau(letzte, 15))].sort().pop(),
        modell, modell_ok: modell !== 'staffel' && modell !== 'index', staffel_abgelaufen: staffelAbgelaufen,
        kappung_festgelegt: kappung != null || e?.kappungsgrenze != null, bk_art: v.bk_art ?? 'vorauszahlung',
        // Increase within the three years against the cap, modernisation surcharges excluded.
        alt_ct: alt, erhoehung_ct: neueMieteCt - alt, erhoehung_prozent: basis ? ((neueMieteCt - zuschlaege) / basis - 1) * 100 : 0,
        qm, alt_qm: qm ? alt / 100 / qm : null, neu_qm: qm ? neueMieteCt / 100 / qm : null,
      };
    },

    // § 559 Abs. 3a BGB: within six years at most 3 €/m² more (2 €/m² when the rent was below 7 €/m²); earlier modernisation increases count.
    // The increase applies from the start of the third month after receipt (§ 559b Abs. 2).
    // ankuendigung/arbeitenAb/angekuendigtCt: the notice of the works (§ 555c: three months before, with the expected increase).
    // Without a notice in time, or with an increase more than 10 % above the announced one, the increase applies six months
    // later (§ 559b Abs. 2 Satz 2). Graduated rent: no § 559 increase; indexed rent: only for works the landlord did not choose.
    modernisierungPruefen: (vertragId, neueMieteCt, ab, zugang = null, ankuendigung = null, arbeitenAb = null, angekuendigtCt = null) => {
      const v = get('SELECT * FROM mietverhaeltnisse WHERE id = ?', vertragId);
      const qm = get('SELECT wohnflaeche FROM einheiten WHERE id = ?', v.einheit_id)?.wohnflaeche || null;
      const alt = bh.betraege('miete', vertragId, vortag(ab)).kaltmiete_ct;
      const frueher = all(`SELECT gueltig_ab, kaltmiete_ct FROM anpassungen WHERE vertrag_typ = 'miete' AND vertrag_id = ? AND grund = 'modernisierung'
        AND kaltmiete_ct IS NOT NULL AND gueltig_ab > ? AND gueltig_ab < ?`, vertragId, plusMonateGenau(ab, -72), ab)
        .reduce((s, a) => s + a.kaltmiete_ct - bh.betraege('miete', vertragId, vortag(a.gueltig_ab)).kaltmiete_ct, 0);
      const satz = qm && alt / 100 / qm < 7 ? 2 : 3;
      const grenze = qm ? Math.round(satz * qm * 100) - frueher : null;
      const z = zugang ?? ortszeit.heute();
      const modell = get('SELECT art FROM mietmodelle WHERE vertrag_id = ?', vertragId)?.art ?? null;
      const ankuendigungFrist = !ankuendigung ? false : !arbeitenAb || ankuendigung <= plusMonateGenau(arbeitenAb, -3);
      const mehrAlsAngekuendigt = angekuendigtCt > 0 && neueMieteCt - alt > angekuendigtCt * 1.1;
      const verlaengert = !ankuendigungFrist || mehrAlsAngekuendigt;
      const frueh = verlaengert ? plusMonate(plusMonate(z, 3), 6) : plusMonate(z, 3);
      return { qm, alt_ct: alt, erhoehung_ct: neueMieteCt - alt, frueher_ct: frueher, satz, grenze_ct: grenze,
        kappung_ok: grenze == null || neueMieteCt - alt <= grenze, zugang: z, wirkung_frueh: frueh, wirkung_ok: ab >= frueh,
        modell, ankuendigung_frist_ok: ankuendigungFrist, mehr_als_angekuendigt: mehrAlsAngekuendigt, verlaengert };
    },

    // ---------- owners' association ----------
    stimmen,
    versammlung: (id) => {
      const v = get('SELECT * FROM versammlungen WHERE id = ?', id);
      return v ? { ...v, tops: all('SELECT * FROM tops WHERE versammlung_id = ? ORDER BY nr', id) } : null;
    },
    // Records the vote on an agenda item and enters an adopted or rejected resolution in the register. Majorities:
    // einfach – more yes than no (§ 25 Abs. 1); doppelt – more than two thirds of the votes cast and more than half of all
    // co-ownership shares (§ 21 Abs. 2 Nr. 1, costs of a structural change for all); dreiviertel – three quarters of the votes
    // cast (§ 23 Abs. 1a, meetings online only); allstimmig – every owner yes. Abstentions are no votes cast.
    // The register is a record: a new vote never overwrites an entry – it gets a new number and the old one a note.
    topBeschliessen: (topId) => tx(() => {
      const t = get('SELECT t.*, v.objekt_id, v.datum, v.ort FROM tops t JOIN versammlungen v ON v.id = t.versammlung_id WHERE t.id = ?', topId);
      const ja = t.ja ?? 0, nein = t.nein ?? 0, enth = t.enthaltung ?? 0;
      if (!ja && !nein && !enth) throw new Error('Keine Stimmen erfasst – bitte die Stimmen der Anwesenden eintragen.');
      const einzel = all('SELECT * FROM top_stimmen WHERE top_id = ?', topId);
      const mehrheit = t.mehrheit ?? 'einfach';
      let ergebnis, grund = '';
      if (mehrheit === 'doppelt' || mehrheit === 'allstimmig') {
        if (!einzel.length) throw new Error('Für diese Mehrheit die Stimme jedes Eigentümers erfassen (Abstimmung je Eigentümer).');
      }
      if (mehrheit === 'doppelt') {
        const meaGesamt = get('SELECT coalesce(sum(mea), 0) AS m FROM einheiten WHERE objekt_id = ?', t.objekt_id).m;
        const meaJa = einzel.filter((x) => x.wahl === 'ja').reduce((a, x) => a + x.mea, 0);
        const zweiDrittel = ja * 3 > (ja + nein) * 2, haelfte = meaJa * 2 > meaGesamt;
        ergebnis = zweiDrittel && haelfte ? 'angenommen' : 'abgelehnt';
        grund = ` Doppelt qualifizierte Mehrheit (§ 21 Abs. 2 Nr. 1 WEG): mehr als zwei Drittel der abgegebenen Stimmen ${zweiDrittel ? 'erreicht' : 'nicht erreicht'}, mehr als die Hälfte der Miteigentumsanteile (${meaJa} von ${meaGesamt}) ${haelfte ? 'erreicht' : 'nicht erreicht'}.`;
      } else if (mehrheit === 'dreiviertel') {
        ergebnis = ja * 4 >= (ja + nein) * 3 ? 'angenommen' : 'abgelehnt';
        grund = ' Erforderlich: drei Viertel der abgegebenen Stimmen (§ 23 Abs. 1a WEG).';
      } else if (mehrheit === 'allstimmig') {
        const alle = stimmen(t.objekt_id, 'kopf', t.datum).length;
        const jaKoepfe = einzel.filter((x) => x.wahl === 'ja').length;
        ergebnis = jaKoepfe === alle ? 'angenommen' : 'abgelehnt';
        grund = ` Erforderlich: Zustimmung aller Eigentümer (${jaKoepfe} von ${alle}).`;
      } else ergebnis = ja > nein ? 'angenommen' : 'abgelehnt';
      const text = `${t.beschlussvorschlag ?? ''}\n\nAbstimmung (${t.abstimmungsart === 'kopf' ? 'nach Köpfen' : t.abstimmungsart === 'mea' ? 'nach Miteigentumsanteilen' : 'nach Einheiten'}): ` +
        `Ja ${ja}, Nein ${nein}, Enthaltung ${enth}.${grund} Das Ergebnis wurde vom Versammlungsleiter festgestellt und verkündet.`;
      const alt = t.beschluss_id ? get('SELECT * FROM beschluesse WHERE id = ?', t.beschluss_id) : null;
      if (alt?.status === 'angefochten') throw new Error(`Beschluss Nr. ${alt.nr} ist angefochten – das Ergebnis lässt sich nicht mehr ändern.`);
      const nr = beschlussNr(t.objekt_id);
      const bid = Number(db.prepare(`INSERT INTO beschluesse (objekt_id, nr, datum, art, titel, text, ergebnis, ort) VALUES (?, ?, ?, 'versammlung', ?, ?, ?, ?)`)
        .run(t.objekt_id, nr, t.datum, t.titel, text.trim(), ergebnis, t.ort ?? null).lastInsertRowid);
      if (alt) db.prepare(`UPDATE beschluesse SET status = 'aufgehoben', vermerk = trim(coalesce(vermerk, '') || ' ' || ?) WHERE id = ?`)
        .run(`Ergebnis berichtigt am ${ortszeit.heute().split('-').reverse().join('.')}: ersetzt durch Nr. ${nr}.`, alt.id);
      db.prepare('UPDATE tops SET beschluss_id = ?, ergebnis = ? WHERE id = ?').run(bid, ergebnis, topId);
      return ergebnis;
    }),
    // Vote per owner: stores each owner's vote (with votes and shares), the totals, and enters the resolution.
    topStimmenSpeichern: (topId, art, liste) => tx(() => {
      const t = get('SELECT t.*, v.objekt_id, v.datum FROM tops t JOIN versammlungen v ON v.id = t.versammlung_id WHERE t.id = ?', topId);
      const st = new Map(stimmen(t.objekt_id, art, t.datum).map((x) => [x.person_id, x]));
      db.prepare('DELETE FROM top_stimmen WHERE top_id = ?').run(topId);
      const sum = { ja: 0, nein: 0, enthaltung: 0 };
      for (const { person_id, wahl } of liste ?? []) {
        const x = st.get(person_id);
        if (!x || !sum.hasOwnProperty(wahl)) continue;
        db.prepare('INSERT INTO top_stimmen (top_id, person_id, wahl, stimmen, mea) VALUES (?, ?, ?, ?, ?)').run(topId, person_id, wahl, x.stimmen, x.mea);
        sum[wahl] += x.stimmen;
      }
      db.prepare('UPDATE tops SET abstimmungsart = ?, ja = ?, nein = ?, enthaltung = ? WHERE id = ?').run(art, sum.ja, sum.nein, sum.enthaltung, topId);
    }),
    topStimmen: (topId) => all('SELECT * FROM top_stimmen WHERE top_id = ?', topId),
    anwesenheit: (versammlungId) => all('SELECT * FROM versammlung_anwesend WHERE versammlung_id = ?', versammlungId),
    anwesenheitSpeichern: (versammlungId, liste) => tx(() => {
      db.prepare('DELETE FROM versammlung_anwesend WHERE versammlung_id = ?').run(versammlungId);
      for (const x of liste ?? []) if (x.status === 'anwesend' || x.status === 'vertreten')
        db.prepare('INSERT INTO versammlung_anwesend (versammlung_id, person_id, status, vertreter) VALUES (?, ?, ?, ?)').run(versammlungId, x.person_id, x.status, x.vertreter || null);
    }),
    naechsteBeschlussNr: (objektId) => beschlussNr(objektId, false),

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
      WHERE (?1 IS NULL OR d.objekt_id = ?1) AND d.status <> 'papierkorb' AND ${zeileSql('d', dokumentOhne('d'))} ORDER BY coalesce(d.datum, '') DESC, d.id DESC`, objektId ?? null),

    vorgaengeListe: (objektId, nurOffen) => all(`SELECT v.*, ${PERSON_NAME} AS person, e.bezeichnung AS einheit, o.bezeichnung AS objekt,
        (SELECT count(*) FROM vorgangseintraege x WHERE x.vorgang_id = v.id) AS eintraege,
        ${namenSql('v')} AS zustaendig_name
      FROM vorgaenge v LEFT JOIN personen p ON p.id = v.person_id LEFT JOIN einheiten e ON e.id = v.einheit_id
      LEFT JOIN objekte o ON o.id = v.objekt_id
      WHERE (?1 IS NULL OR v.objekt_id = ?1) AND (?2 = 0 OR v.status <> 'erledigt') AND ${zeileSql('v')}
      ORDER BY v.status = 'erledigt', coalesce(v.faellig, '9999'), v.prioritaet, v.id DESC`, objektId ?? null, nurOffen ? 1 : 0),

    // Open cases assigned to a user, for "Meine Aufgaben" in the cockpit.
    meineAufgaben: (benutzerId) => all(`SELECT v.*, o.bezeichnung AS objekt FROM vorgaenge v LEFT JOIN objekte o ON o.id = v.objekt_id
      WHERE ${istZustaendigSql('v', '?1')} AND v.status <> 'erledigt' AND ${zeileSql('v')} ORDER BY coalesce(v.faellig, '9999'), v.prioritaet, v.id`, benutzerId),

    termineListe: (von, bis) => all(`SELECT t.*, o.bezeichnung AS objekt, ${PERSON_NAME} AS person, v.titel AS vorgang FROM termine t
      LEFT JOIN objekte o ON o.id = t.objekt_id LEFT JOIN personen p ON p.id = t.person_id LEFT JOIN vorgaenge v ON v.id = t.vorgang_id
      WHERE t.datum BETWEEN ? AND ? AND ${zeileSql('t')} ORDER BY t.datum, coalesce(t.uhrzeit, '')`, von, bis),

    // Things that need attention soon, for the overview page.
    faelligkeiten: (tage = 30) => {
      const bis = ortszeit.inTagen(tage);
      return {
        vorgaenge: all(`SELECT v.id, v.titel, v.faellig, o.bezeichnung AS objekt FROM vorgaenge v LEFT JOIN objekte o ON o.id = v.objekt_id
          WHERE v.status <> 'erledigt' AND v.faellig IS NOT NULL AND v.faellig <= ? AND ${zeileSql('v')} ORDER BY v.faellig`, bis),
        termine: all(`SELECT t.id, t.titel, t.datum, t.uhrzeit, o.bezeichnung AS objekt FROM termine t LEFT JOIN objekte o ON o.id = t.objekt_id
          WHERE t.erledigt = 0 AND t.datum BETWEEN date('now', 'localtime') AND ? AND ${zeileSql('t')} ORDER BY t.datum`, bis),
        vertraege: all(`SELECT 'miete' AS typ, m.ende AS datum, e.bezeichnung AS einheit, o.bezeichnung AS objekt FROM mietverhaeltnisse m
          JOIN einheiten e ON e.id = m.einheit_id JOIN objekte o ON o.id = e.objekt_id WHERE m.ende BETWEEN date('now', 'localtime') AND ? AND ${objektSql('o.id')}`, bis),
        eichungen: all(`SELECT z.nummer, z.art, z.eichung_bis AS datum, o.bezeichnung AS objekt FROM zaehler z JOIN objekte o ON o.id = z.objekt_id
          WHERE (z.ausbau IS NULL OR z.ausbau = '') AND z.eichung_bis IS NOT NULL AND z.eichung_bis <= ? AND ${objektSql('o.id')}`, bis),
        versicherungen: all(`SELECT v.art, v.gesellschaft, v.kuendbar_bis AS datum, o.bezeichnung AS objekt FROM versicherungen v
          JOIN objekte o ON o.id = v.objekt_id WHERE v.kuendbar_bis BETWEEN date('now', 'localtime') AND ? AND ${objektSql('o.id')}`, bis),
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
module.exports.NICHT_ZAEHLEND = NICHT_ZAEHLEND;
