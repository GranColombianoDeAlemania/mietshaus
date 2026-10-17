// Evaluations for landlords: cash received per income type (inflow principle), Anlage V figures,
// yield per object, and taking over cost shares from an external owners' statement.

// Expense categories grouped the way the Anlage V asks for them.
const WK_GRUPPEN = [
  ['erhaltung', 'Erhaltungsaufwendungen (sofort abziehbar)', (k) => k.kategorie === 'instandhaltung'],
  ['betriebskosten', 'Grundsteuer, Straßenreinigung, Müllabfuhr, Wasser, Entwässerung, Beleuchtung, Heizung, Warmwasser, Schornsteinfeger, Versicherungen, Hauswart, Reinigung, Aufzug u. ä.', (k) => /^bk/.test(k.kategorie ?? '')],
  ['verwaltung', 'Verwaltungskosten', (k) => k.kategorie === 'verwaltung'],
  ['schuldzinsen', 'Schuldzinsen (aus Darlehensraten)', (k) => k.kategorie === 'zinsen'],
  ['hausgeld', 'Hausgeld an eine fremdverwaltete WEG', (k) => k.kategorie === 'hausgeld_weg'],
  ['sonstige', 'Sonstige Werbungskosten (z. B. Bankgebühren)', () => true],
];

const { tageZwischen, einheitVonSql } = require('./buchhaltung.cjs');
const maxD = (a, b) => (a > b ? a : b);
const minD = (a, b) => (a < b ? a : b);
const monatsEnde = (monat) => new Date(Date.UTC(Number(monat.slice(0, 4)), Number(monat.slice(5, 7)), 0)).toISOString().slice(0, 10);

module.exports = function auswertung({ db, all, get, tx, bh, ab }) {
  // ---------- self-use: which part of the house is rented ----------
  const selbstPerioden = (objektId) => all(`SELECT s.*, e.bezeichnung, e.wohnflaeche FROM selbstnutzung s JOIN einheiten e ON e.id = s.einheit_id
    WHERE e.objekt_id = ? ORDER BY s.beginn`, objektId);
  // Days of [von, bis] a unit was used by the landlord (overlapping periods count once).
  function selbstTage(perioden, einheitId, von, bis) {
    const iv = perioden.filter((p) => p.einheit_id === einheitId).map((p) => [maxD(p.beginn, von), minD(p.ende || '9999-12-31', bis)]).filter(([a, b]) => a <= b)
      .sort((x, y) => (x[0] < y[0] ? -1 : 1));
    let tage = 0, ende = null;
    for (const [a, b] of iv) {
      const start = ende && a <= ende ? nachTag(ende) : a;
      if (start <= b) tage += tageZwischen(start, b) + 1;
      if (!ende || b > ende) ende = b;
    }
    return tage;
  }
  const selbstAm = (perioden, einheitId, datum) => perioden.some((p) => p.einheit_id === einheitId && p.beginn <= datum && (!p.ende || p.ende >= datum));

  // Rented share of the building by area and day. Self-used area-days are taken out; vacant flats count as rented,
  // since they are meant to be let. Without self-use the share is 1.
  function vermietAnteil(objektId, von, bis, perioden = selbstPerioden(objektId)) {
    const einheiten = all('SELECT id, bezeichnung, wohnflaeche FROM einheiten WHERE objekt_id = ? ORDER BY nr', objektId);
    const T = tageZwischen(von, bis) + 1;
    const gesamt = einheiten.reduce((s, e) => s + (e.wohnflaeche ?? 0), 0);
    let selbstFlaechenTage = 0;
    const selbst = [];
    for (const e of einheiten) {
      const t = selbstTage(perioden, e.id, von, bis);
      if (!t) continue;
      selbstFlaechenTage += (e.wohnflaeche ?? 0) * t;
      selbst.push({ einheit_id: e.id, bezeichnung: e.bezeichnung, flaeche: e.wohnflaeche ?? 0, tage: t });
    }
    const anteil = gesamt > 0 ? 1 - selbstFlaechenTage / (gesamt * T) : 1;
    return { anteil, flaeche_gesamt: gesamt, flaeche_vermietet: Math.round(gesamt * anteil * 100) / 100, tage: T, selbst };
  }

  // Cost accounts of a period with the part that belongs to the rented part of the house: costs booked for a unit
  // count fully when the unit was let (or vacant) on the posting date and not at all when the landlord lived there;
  // all other costs count with the rented share (interest with its own factor).
  function kostenAufgeteilt(objektId, von, bis, anteil, zinsFaktor = anteil, perioden = selbstPerioden(objektId)) {
    const konten = new Map();
    for (const r of all(`SELECT k.*, CASE WHEN k.id = b.soll_id THEN b.betrag_ct ELSE -b.betrag_ct END AS ct, b.datum AS b_datum, ${einheitVonSql('b')} AS eid
        FROM buchungen b JOIN konten k ON k.id IN (b.soll_id, b.haben_id)
        WHERE k.objekt_id = ? AND k.klasse = 'kosten' AND k.aus_ruecklage = 0 AND b.datum BETWEEN ? AND ? ORDER BY k.nr, b.id`, objektId, von, bis)) {
      let k = konten.get(r.id);
      if (!k) {
        const { ct, b_datum, eid, ...konto } = r;
        konten.set(r.id, (k = { ...konto, betrag_ct: 0, gemeinsam_ct: 0, vermietet_ct: 0, selbst_ct: 0 }));
      }
      k.betrag_ct += r.ct;
      if (!r.eid) k.gemeinsam_ct += r.ct;
      else if (selbstAm(perioden, r.eid, r.b_datum)) k.selbst_ct += r.ct;
      else k.vermietet_ct += r.ct;
    }
    return [...konten.values()].filter((k) => k.betrag_ct).map((k) => ({
      ...k, absetzbar_ct: Math.round(k.gemeinsam_ct * (k.kategorie === 'zinsen' ? zinsFaktor : anteil)) + k.vermietet_ct,
    }));
  }

  // Cash received in a period on a tenant account, split by income type in first-in-first-out order:
  // payments settle the oldest charges first. Credit notes (e.g. a statement credit) count negatively.
  function zufluss(kontoId, von, bis) {
    const zahlung = (bisDatum) => get(`SELECT
        coalesce((SELECT sum(b.betrag_ct) FROM buchungen b JOIN konten g ON g.id = b.soll_id WHERE b.haben_id = ?1 AND g.klasse = 'geld' AND b.datum <= ?2), 0) -
        coalesce((SELECT sum(b.betrag_ct) FROM buchungen b JOIN konten g ON g.id = b.haben_id WHERE b.soll_id = ?1 AND g.klasse = 'geld' AND b.datum <= ?2), 0) AS s`,
    kontoId, bisDatum).s;
    const p0 = zahlung(vorTag(von)), p1 = zahlung(bis);
    // VAT charged on commercial rents counts as received VAT ('ust').
    const posten = all(`SELECT b.datum, b.id, e.kategorie, CASE WHEN b.soll_id = ?1 THEN b.betrag_ct ELSE -b.betrag_ct END AS ct
      FROM buchungen b JOIN konten e ON e.id = CASE WHEN b.soll_id = ?1 THEN b.haben_id ELSE b.soll_id END
      WHERE (b.soll_id = ?1 OR b.haben_id = ?1) AND (e.klasse = 'einnahme' OR (e.klasse = 'steuer' AND e.kategorie IN ('ust19', 'ust7'))) ORDER BY b.datum, b.id`, kontoId);
    const out = {};
    let c = 0;
    for (const p of posten) {
      const a = Math.min(c, c + p.ct), b = Math.max(c, c + p.ct);
      const schnitt = Math.max(0, Math.min(b, p1) - Math.max(a, p0));
      if (schnitt) out[p.kategorie] = (out[p.kategorie] ?? 0) + Math.sign(p.ct) * schnitt;
      c += p.ct;
    }
    return out;
  }

  function einnahmen(objektId, von, bis) {
    const summe = {};
    for (const k of all(`SELECT id FROM konten WHERE objekt_id = ? AND klasse = 'person' AND vertrag_typ = 'miete'`, objektId)) {
      for (const [kat, ct] of Object.entries(zufluss(k.id, von, bis))) summe[kat] = (summe[kat] ?? 0) + ct;
    }
    return summe;
  }

  const kosten = (objektId, von, bis) => all(`SELECT k.*,
      coalesce((SELECT sum(betrag_ct) FROM buchungen WHERE soll_id = k.id AND datum BETWEEN ?2 AND ?3), 0) -
      coalesce((SELECT sum(betrag_ct) FROM buchungen WHERE haben_id = k.id AND datum BETWEEN ?2 AND ?3), 0) AS betrag_ct
    FROM konten k WHERE k.objekt_id = ?1 AND k.klasse = 'kosten' AND k.aus_ruecklage = 0 ORDER BY k.nr`, objektId, von, bis).filter((k) => k.betrag_ct);

  function afa(o, jahr) {
    if (!o.kaufpreis_ct || !o.afa_satz) return 0;
    const basis = (o.kaufpreis_ct + (o.kaufnebenkosten_ct ?? 0)) * (o.gebaeudeanteil ?? 100) / 100;
    const voll = Math.round(basis * o.afa_satz / 100);
    if (!o.kaufdatum || Number(o.kaufdatum.slice(0, 4)) < jahr) return voll;
    if (Number(o.kaufdatum.slice(0, 4)) > jahr) return 0;
    // Purchase year: pro rata by month, starting with the month of purchase.
    return Math.round(voll * (13 - Number(o.kaufdatum.slice(5, 7))) / 12);
  }

  function anlageV(objektId, jahr) {
    const o = get('SELECT * FROM objekte WHERE id = ?', objektId);
    const von = `${jahr}-01-01`, bis = `${jahr}-12-31`;
    const ein = einnahmen(objektId, von, bis);
    const manuell = get('SELECT * FROM steuerangaben WHERE objekt_id = ? AND jahr = ?', objektId, jahr) ?? {};
    // Self-use: only the rented part may be deducted (by area and day; interest optionally with its own share).
    const perioden = selbstPerioden(objektId);
    const va = vermietAnteil(objektId, von, bis, perioden);
    const zinsFaktor = manuell.zins_anteil != null ? manuell.zins_anteil / 100 : va.anteil;
    const geteilt = va.selbst.length > 0;
    const gruppen = Object.fromEntries(WK_GRUPPEN.map(([g, l]) => [g, { label: l, ct: 0, absetzbar_ct: 0, einzeln: false, konten: [] }]));
    for (const k of kostenAufgeteilt(objektId, von, bis, va.anteil, zinsFaktor, perioden)) {
      const [g] = WK_GRUPPEN.find(([, , f]) => f(k));
      gruppen[g].ct += k.betrag_ct;
      gruppen[g].absetzbar_ct += k.absetzbar_ct;
      if (k.vermietet_ct || k.selbst_ct) gruppen[g].einzeln = true;
      gruppen[g].konten.push({ nr: k.nr, bezeichnung: k.bezeichnung, ct: k.betrag_ct, absetzbar_ct: k.absetzbar_ct });
    }
    const korrektur = (g, ct, text) => {
      gruppen[g].ct += ct;
      gruppen[g].absetzbar_ct += Math.round(ct * va.anteil);
      if (text) gruppen[g].konten.push({ nr: '', bezeichnung: text, ct, absetzbar_ct: Math.round(ct * va.anteil) });
    };
    if (manuell.ruecklage_hausgeld_ct) korrektur('hausgeld', -manuell.ruecklage_hausgeld_ct, null);
    // Larger maintenance spread over 2–5 years (§ 82b EStDV): taken out of its year, a share counted in each year.
    for (const r of all('SELECT * FROM erhaltungsverteilung WHERE objekt_id = ? AND jahr <= ? AND jahr + jahre > ?', objektId, jahr, jahr)) {
      if (r.jahr === jahr) korrektur('erhaltung', -r.betrag_ct, `abzüglich zu verteilender Aufwand (§ 82b EStDV)${r.text ? `: ${r.text}` : ''}`);
      const teil = Math.floor(r.betrag_ct / r.jahre);
      const anteil = jahr === r.jahr + r.jahre - 1 ? r.betrag_ct - teil * (r.jahre - 1) : teil;
      korrektur('erhaltung', anteil, `Verteilung aus ${r.jahr} (${jahr - r.jahr + 1}/${r.jahre})${r.text ? `: ${r.text}` : ''}`);
    }
    // VAT for commercial lettings: input tax paid and VAT paid to / refunded by the tax office.
    const steuer = (kategorien, richtung) => get(`SELECT coalesce(sum(CASE WHEN b.${richtung === 'soll' ? 'soll_id' : 'haben_id'} = k.id THEN b.betrag_ct ELSE -b.betrag_ct END), 0) AS s
      FROM buchungen b JOIN konten k ON k.id IN (b.soll_id, b.haben_id) WHERE k.objekt_id = ? AND k.klasse = 'steuer' AND k.kategorie IN (${kategorien.map(() => '?').join(',')})
      AND b.datum BETWEEN ? AND ?`, objektId, ...kategorien, von, bis).s;
    const vorsteuer = steuer(['vorsteuer19', 'vorsteuer7'], 'soll');
    const fa = steuer(['ust_fa'], 'soll');
    const einnahmenZeilen = [
      ['Mieteinnahmen für Wohnungen und andere Räume (ohne Umlagen)', (ein.miete ?? 0) + (ein.sonst ?? 0)],
      ['Umlagen, verrechnet mit Erstattungen (Betriebs-/Heizkosten)', (ein.bk ?? 0) + (ein.bk_pauschale ?? 0) + (ein.hk ?? 0) + (ein.nk_ergebnis ?? 0)],
      ['Sonstige Einnahmen (z. B. Mahngebühren, Zinsen)', (ein.mahngebuehr ?? 0) + (ein.zins ?? 0) + (ein.sonstige ?? 0)],
      ['Vereinnahmte Umsatzsteuer', (ein.ust19 ?? 0) + (ein.ust7 ?? 0)],
      ['Vom Finanzamt erstattete Umsatzsteuer', fa < 0 ? -fa : 0],
    ].filter(([l, ct]) => ct || !/Umsatzsteuer/.test(l));
    // [label, total, deductible, rule]; the rule is only shown when part of the house is self-used.
    const flaeche = 'nach Fläche';
    const zinsRegel = manuell.zins_anteil != null ? `eigener Satz ${String(manuell.zins_anteil).replace('.', ',')} %` : 'nach Fläche, änderbar';
    const afaGesamt = afa(o, jahr);
    const aufteilung = [
      ['Absetzung für Abnutzung (AfA) Gebäude', afaGesamt, Math.round(afaGesamt * va.anteil), flaeche],
      ['Schuldzinsen', manuell.schuldzinsen_ct ?? 0, Math.round((manuell.schuldzinsen_ct ?? 0) * zinsFaktor), zinsRegel],
      ['Geldbeschaffungskosten', manuell.geldbeschaffung_ct ?? 0, Math.round((manuell.geldbeschaffung_ct ?? 0) * zinsFaktor), zinsRegel],
      ...WK_GRUPPEN.map(([g]) => [gruppen[g].label, gruppen[g].ct, gruppen[g].absetzbar_ct,
        g === 'schuldzinsen' ? zinsRegel : gruppen[g].einzeln ? 'nach Fläche; Kosten einer Einheit: vermietet voll, eigene nicht' : flaeche]),
      ['Gezahlte Vorsteuerbeträge', vorsteuer, vorsteuer, 'voll'],
      ['An das Finanzamt gezahlte Umsatzsteuer', fa > 0 ? fa : 0, fa > 0 ? fa : 0, 'voll'],
      ['Fahrtkosten', manuell.fahrtkosten_ct ?? 0, manuell.fahrtkosten_ct ?? 0, 'wie eingetragen'],
      ['Weitere Werbungskosten (manuell)', manuell.sonstige_ct ?? 0, manuell.sonstige_ct ?? 0, 'wie eingetragen'],
    ].filter(([, ct, ab]) => ct || ab);
    const werbungskosten = aufteilung.map(([l, , ab]) => [l, ab]).filter(([, ct]) => ct);
    const summeE = einnahmenZeilen.reduce((s, [, c]) => s + c, 0);
    const summeW = werbungskosten.reduce((s, [, c]) => s + c, 0);
    return {
      objekt: o, jahr, einnahmen: einnahmenZeilen, werbungskosten, gruppen, manuell,
      selbstnutzung: geteilt ? { anteil: va.anteil, flaeche_gesamt: va.flaeche_gesamt, flaeche_vermietet: va.flaeche_vermietet, einheiten: va.selbst,
        zins_faktor: zinsFaktor, zeilen: aufteilung, summe_gesamt_ct: aufteilung.reduce((s, z) => s + z[1], 0) } : null,
      summe_einnahmen_ct: summeE, summe_werbungskosten_ct: summeW, ergebnis_ct: summeE - summeW,
      // Kaution receipts are not income; they are listed only so they are not forgotten.
      kautionen_ct: ein.kaution ?? 0,
      gemischt: o.art === 'gemischt',
    };
  }

  // Comparative rent per m² and month for a unit (cents): the unit's own value, the object's, or the average
  // cold rent per m² of the house's current tenancies of the same kind.
  function vergleichsmieteQm(einheitId, stichtag = new Date().toISOString().slice(0, 10)) {
    const e = get(`SELECT e.*, o.vergleichsmiete_ct AS o_vgl, o.mietspiegel_von_ct AS o_von, o.mietspiegel_bis_ct AS o_bis FROM einheiten e
      JOIN objekte o ON o.id = e.objekt_id WHERE e.id = ?`, einheitId);
    if (!e) return null;
    const wohnung = (e.art ?? 'Wohnung') === 'Wohnung';
    const von = e.mietspiegel_von_ct || (wohnung ? e.o_von : null) || null, bis = e.mietspiegel_bis_ct || (wohnung ? e.o_bis : null) || null;
    const haus = hausDurchschnittQm(e.objekt_id, e.art, stichtag);
    if (e.vergleichsmiete_ct) return { ct: e.vergleichsmiete_ct, quelle: 'einheit', von, bis, haus_ct: haus };
    if (e.o_vgl && wohnung) return { ct: e.o_vgl, quelle: 'objekt', von, bis, haus_ct: haus };
    if (von && bis) return { ct: Math.round((von + bis) / 2), quelle: 'spanne', von, bis, haus_ct: haus };
    return { ct: haus, quelle: haus ? 'haus' : null, von, bis, haus_ct: haus };
  }
  // Average cold rent per m² (cents) of the current tenancies of one kind of unit in a house.
  function hausDurchschnittQm(objektId, art = 'Wohnung', stichtag = new Date().toISOString().slice(0, 10)) {
    let kalt = 0, qm = 0;
    for (const m of all(`SELECT m.id, e.wohnflaeche FROM mietverhaeltnisse m JOIN einheiten e ON e.id = m.einheit_id WHERE e.objekt_id = ?1
        AND coalesce(e.art, 'Wohnung') = ?2 AND e.wohnflaeche > 0 AND m.beginn <= ?3 AND (m.ende IS NULL OR m.ende = '' OR m.ende >= ?3)
        AND m.bk_art <> 'inklusiv'`, objektId, art ?? 'Wohnung', stichtag)) {
      kalt += bh.betraege('miete', m.id, stichtag).kaltmiete_ct ?? 0;
      qm += m.wohnflaeche;
    }
    return qm ? Math.round(kalt / qm) : null;
  }

  function rendite(objektId, jahre = 5) {
    const o = get('SELECT * FROM objekte WHERE id = ?', objektId);
    const flaeche = get('SELECT coalesce(sum(wohnflaeche), 0) AS f FROM einheiten WHERE objekt_id = ?', objektId).f;
    const invest = (o.kaufpreis_ct ?? 0) + (o.kaufnebenkosten_ct ?? 0);
    const jetzt = new Date().getFullYear();
    const perioden = selbstPerioden(objektId);
    const zeilen = [];
    for (let j = jetzt - jahre + 1; j <= jetzt; j++) {
      const von = `${j}-01-01`, bis = `${j}-12-31`;
      const soll = get(`SELECT coalesce(sum(b.betrag_ct), 0) AS s FROM buchungen b JOIN konten e ON e.id = b.haben_id JOIN konten p ON p.id = b.soll_id
        WHERE e.objekt_id = ? AND e.kategorie IN ('miete', 'sonst') AND p.klasse = 'person' AND b.datum BETWEEN ? AND ?`, objektId, von, bis).s;
      const ein = einnahmen(objektId, von, bis);
      const ks = kosten(objektId, von, bis);
      const nichtUml = ks.filter((k) => !k.umlagefaehig).reduce((s, k) => s + k.betrag_ct, 0);
      const uml = ks.filter((k) => k.umlagefaehig).reduce((s, k) => s + k.betrag_ct, 0);
      const ist = (ein.miete ?? 0) + (ein.sonst ?? 0);
      const umlagen = (ein.bk ?? 0) + (ein.bk_pauschale ?? 0) + (ein.hk ?? 0) + (ein.nk_ergebnis ?? 0);
      // Net operating result before financing and depreciation.
      const netto = ist + umlagen - nichtUml - uml;
      if (!soll && !ist && !ks.length) continue;
      // Self-use: the yield of the rented part (its share of price and costs), or as if the own flat were let at the
      // comparative rent with its operating costs paid by a tenant.
      let selbst = null;
      const va = vermietAnteil(objektId, von, bis, perioden);
      if (va.selbst.length) {
        const zuordenbar = kostenAufgeteilt(objektId, von, bis, va.anteil, va.anteil, perioden).reduce((s, k) => s + k.absetzbar_ct, 0);
        const nettoTeil = ist + umlagen - zuordenbar;
        // As if let: the comparative rent for every whole month the landlord lives there and no tenant pays.
        const fiktiv = va.selbst.reduce((s, x) => {
          const qm = vergleichsmieteQm(x.einheit_id)?.ct ?? 0;
          const monate = bh.monateOhneMiete(x.einheit_id, von, bis)
            .filter((m) => perioden.some((p) => p.einheit_id === x.einheit_id && p.beginn <= monatsEnde(m) && (!p.ende || p.ende >= `${m}-01`))).length;
          return s + Math.round(qm * x.flaeche) * monate;
        }, 0);
        const eigenanteil = ab ? ab.nkAbrechnung(objektId, von, bis).eigenanteil_ct : 0;
        const nettoFiktiv = netto + fiktiv + eigenanteil;
        selbst = {
          anteil: va.anteil, flaeche_vermietet: va.flaeche_vermietet, einheiten: va.selbst, kosten_ct: zuordenbar,
          netto_ct: nettoTeil, invest_ct: Math.round(invest * va.anteil),
          brutto_rendite: o.kaufpreis_ct ? soll / (o.kaufpreis_ct * va.anteil) * 100 : null,
          netto_rendite: invest ? nettoTeil / (invest * va.anteil) * 100 : null,
          fiktiv_kaltmiete_ct: fiktiv, eigenanteil_ct: eigenanteil, fiktiv_netto_ct: nettoFiktiv,
          fiktiv_brutto_rendite: o.kaufpreis_ct ? (soll + fiktiv) / o.kaufpreis_ct * 100 : null,
          fiktiv_netto_rendite: invest ? nettoFiktiv / invest * 100 : null,
        };
      }
      zeilen.push({
        jahr: j, soll_kaltmiete_ct: soll, ist_kaltmiete_ct: ist, umlagen_ct: umlagen, umlagefaehig_ct: uml, nicht_umlagefaehig_ct: nichtUml,
        netto_ct: netto, ausfall_ct: Math.max(0, soll - ist),
        brutto_rendite: invest && o.kaufpreis_ct ? soll / o.kaufpreis_ct * 100 : null,
        netto_rendite: invest ? netto / invest * 100 : null,
        miete_qm: flaeche ? soll / 12 / flaeche : null, kosten_qm: flaeche ? (uml + nichtUml) / 12 / flaeche : null,
        selbst,
      });
    }
    return { objekt: o, flaeche, invest_ct: invest, zeilen, selbstnutzung: perioden.length > 0 };
  }

  // 15 % rule (§ 6 Abs. 1 Nr. 1a EStG): repairs and modernisation within three years after purchase that exceed 15 %
  // of the building's purchase cost (net, without VAT) become acquisition costs and can only be depreciated.
  function anschaffungsnah(objektId = null) {
    const t = new Date().toISOString().slice(0, 10);
    return all(`SELECT * FROM objekte WHERE kaufdatum IS NOT NULL AND kaufpreis_ct > 0 AND (?1 IS NULL OR id = ?1)`, objektId).map((o) => {
      const [y, m, d] = o.kaufdatum.split('-').map(Number);
      const frist = new Date(Date.UTC(y + 3, m - 1, d)).toISOString().slice(0, 10);
      // With self-use the rented part is a building part of its own: the limit and the costs count for it only.
      const perioden = selbstPerioden(o.id);
      const va = vermietAnteil(o.id, o.kaufdatum, frist, perioden);
      const gebaeudeGanz = Math.round((o.kaufpreis_ct + (o.kaufnebenkosten_ct ?? 0)) * (o.gebaeudeanteil ?? 100) / 100);
      const gebaeude = Math.round(gebaeudeGanz * va.anteil);
      const grenze = Math.round(gebaeude * 0.15);
      // § 6 Abs. 1 Nr. 1a EStG counts the expenses without VAT. Per booking, the maintenance amount plus input tax booked
      // with it is the invoice total; an e-invoice linked to the booking gives the exact net amount, otherwise 19 % VAT is taken out.
      const gruppen = new Map();
      const faktor = new Map();
      for (const b of all(`SELECT coalesce(b.gruppe, b.id) AS g, CASE WHEN k.id = b.soll_id THEN b.betrag_ct ELSE -b.betrag_ct END AS ct, b.datum, ${einheitVonSql('b')} AS eid
          FROM buchungen b JOIN konten k ON k.id IN (b.soll_id, b.haben_id)
          WHERE k.objekt_id = ? AND k.kategorie = 'instandhaltung' AND b.datum BETWEEN ? AND ?`, o.id, o.kaufdatum, frist)) {
        gruppen.set(b.g, (gruppen.get(b.g) ?? 0) + b.ct);
        faktor.set(b.g, !b.eid ? va.anteil : selbstAm(perioden, b.eid, b.datum) ? 0 : 1);
      }
      let brutto = 0, netto = 0;
      for (const [g, ct] of gruppen) {
        const vst = get(`SELECT coalesce(sum(b.betrag_ct), 0) AS s FROM buchungen b JOIN konten k ON k.id = b.soll_id
          WHERE coalesce(b.gruppe, b.id) = ? AND k.klasse = 'steuer' AND k.kategorie IN ('vorsteuer19', 'vorsteuer7')`, g).s;
        const dok = get('SELECT netto_ct, betrag_ct FROM dokumente WHERE buchung_id = ? AND netto_ct IS NOT NULL ORDER BY id LIMIT 1', g);
        const summe = ct + (ct > 0 ? vst : -vst);
        const nettoG = dok && Math.abs(dok.betrag_ct - Math.abs(summe)) <= 1 ? Math.sign(summe) * dok.netto_ct : Math.round(summe / 1.19);
        // Self-use: costs of the own flat do not count, those of the whole house with the rented share.
        const f = faktor.get(g);
        brutto += Math.round(summe * f);
        netto += Math.round(nettoG * f);
      }
      return { objekt_id: o.id, objekt: o.bezeichnung, kaufdatum: o.kaufdatum, frist, laeuft: t <= frist, gebaeude_ct: gebaeude, grenze_ct: grenze,
        vermietet_anteil: va.selbst.length ? va.anteil : null, gebaeude_ganz_ct: gebaeudeGanz,
        summe_brutto_ct: brutto, summe_netto_ct: netto, anteil: grenze ? netto / grenze : 0, rest_ct: Math.max(0, grenze - netto) };
    }).filter((w) => w.laeuft || w.frist >= `${Number(t.slice(0, 4)) - 1}-01-01`);
  }

  // Files for the tax adviser: journal, balance list and account sheets as CSV, plus the receipts of the year.
  function steuerpaketDaten(objektId, jahr) {
    const von = `${jahr}-01-01`, bis = `${jahr}-12-31`;
    const o = get('SELECT * FROM objekte WHERE id = ?', objektId);
    const csv = (kopf, zeilen) => '\ufeff' + [kopf, ...zeilen].map((z) => z.map((c) => {
      const s = String(c ?? '');
      return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(';')).join('\r\n');
    const betrag = (ct) => ((ct ?? 0) / 100).toFixed(2).replace('.', ',');
    const datumDe = (iso) => iso.split('-').reverse().join('.');
    const buchungen = all(`SELECT b.id, b.gruppe, b.datum, b.beleg, b.text, b.betrag_ct, s.nr AS soll_nr, s.bezeichnung AS soll, h.nr AS haben_nr, h.bezeichnung AS haben
      FROM buchungen b JOIN konten s ON s.id = b.soll_id JOIN konten h ON h.id = b.haben_id WHERE b.objekt_id = ? AND b.datum BETWEEN ? AND ? ORDER BY b.datum, b.id`, objektId, von, bis);
    const journal = csv(['Datum', 'Beleg', 'Text', 'Soll-Konto', 'Soll-Bezeichnung', 'Haben-Konto', 'Haben-Bezeichnung', 'Betrag'],
      buchungen.map((b) => [datumDe(b.datum), b.beleg, b.text, b.soll_nr, b.soll, b.haben_nr, b.haben, betrag(b.betrag_ct)]));
    const salden = csv(['Konto', 'Bezeichnung', 'Anfangssaldo', 'Soll', 'Haben', 'Endsaldo'],
      bh.saldenliste(objektId, von, bis).map((k) => [k.nr, k.bezeichnung, betrag(k.anfang_ct), betrag(k.soll_ct), betrag(k.haben_ct), betrag(k.ende_ct)]));
    const blaetter = [];
    for (const k of all(`SELECT k.id, k.nr, k.bezeichnung FROM konten k WHERE k.objekt_id = ? AND EXISTS (SELECT 1 FROM buchungen b WHERE (b.soll_id = k.id OR b.haben_id = k.id)
        AND b.datum BETWEEN ? AND ?) ORDER BY k.nr`, objektId, von, bis)) {
      const a = bh.kontoauszug(k.id, von, bis);
      blaetter.push([k.nr, k.bezeichnung, datumDe(von), 'Anfangssaldo', '', '', '', betrag(a.anfang_ct)]);
      for (const z of a.zeilen) blaetter.push([k.nr, k.bezeichnung, datumDe(z.datum), z.text, z.gegen, z.soll_ct ? betrag(z.soll_ct) : '', z.haben_ct ? betrag(z.haben_ct) : '', betrag(z.saldo_ct)]);
    }
    const kontenblaetter = csv(['Konto', 'Bezeichnung', 'Datum', 'Text', 'Gegenkonto', 'Soll', 'Haben', 'Saldo'], blaetter);
    // Receipts: documents linked to a posting of the year, and invoices, notices and statements dated in the year.
    const ids = new Set(buchungen.flatMap((b) => [b.id, b.gruppe]).filter(Boolean));
    const doks = all(`SELECT id, datei, titel, typ, absender, datum, erfasst, betrag_ct, buchung_id FROM dokumente WHERE objekt_id = ? AND status <> 'postfach'`, objektId)
      .filter((d) => (d.buchung_id && ids.has(d.buchung_id)) || (['Rechnung', 'Gutschrift', 'Bescheid', 'Abrechnung', 'Kontoauszug'].includes(d.typ) && (d.datum ?? d.erfasst ?? '').startsWith(String(jahr))));
    const sauber = (x) => String(x ?? '').replace(/[\/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    const belege = doks.map((d) => ({ datei: d.datei, name: `Belege/${d.datum ?? d.erfasst ?? ''} ${sauber(d.absender || d.titel)}${d.betrag_ct ? ` ${betrag(d.betrag_ct)} EUR` : ''}${d.datei.slice(d.datei.lastIndexOf('.'))}` }));
    return { objekt: o.bezeichnung, jahr, journal, salden, kontenblaetter, belege, anzahl_buchungen: buchungen.length };
  }

  // VAT return figures per month or quarter: tax on rents (accrual or cash basis), input tax, payable amount.
  function ustUebersicht(objektId, jahr, { zeitraum = 'quartal', versteuerung = 'soll' } = {}) {
    const perioden = zeitraum === 'monat'
      ? Array.from({ length: 12 }, (_, i) => { const m = String(i + 1).padStart(2, '0'); return { label: `${m}/${jahr}`, von: `${jahr}-${m}-01`, bis: `${jahr}-${m}-${new Date(Date.UTC(jahr, i + 1, 0)).getUTCDate()}` }; })
      : [1, 2, 3, 4].map((q) => ({ label: `${q}. Quartal ${jahr}`, von: `${jahr}-${String(q * 3 - 2).padStart(2, '0')}-01`, bis: `${jahr}-${String(q * 3).padStart(2, '0')}-${q === 1 || q === 4 ? 31 : 30}` }));
    const saldo = (kategorien, von, bis, seite) => get(`SELECT coalesce(sum(CASE WHEN b.${seite} = k.id THEN b.betrag_ct ELSE -b.betrag_ct END), 0) AS s
      FROM buchungen b JOIN konten k ON k.id IN (b.soll_id, b.haben_id) WHERE k.objekt_id = ? AND k.klasse = 'steuer'
      AND k.kategorie IN (${kategorien.map(() => '?').join(',')}) AND b.datum BETWEEN ? AND ?`, objektId, ...kategorien, von, bis).s;
    const mieterKonten = all(`SELECT k.id FROM konten k JOIN mietverhaeltnisse m ON k.vertrag_typ = 'miete' AND k.vertrag_id = m.id WHERE k.objekt_id = ? AND m.ust_satz > 0`, objektId);
    const zeilen = perioden.map((p) => {
      let u19, u7;
      if (versteuerung === 'ist') {
        // Cash basis: the VAT share of what the tenants actually paid in the period.
        u19 = 0; u7 = 0;
        for (const k of mieterKonten) { const z = zufluss(k.id, p.von, p.bis); u19 += z.ust19 ?? 0; u7 += z.ust7 ?? 0; }
      } else {
        u19 = saldo(['ust19'], p.von, p.bis, 'haben_id');
        u7 = saldo(['ust7'], p.von, p.bis, 'haben_id');
      }
      const vst = saldo(['vorsteuer19', 'vorsteuer7'], p.von, p.bis, 'soll_id');
      return { ...p, kz81_bemessung_ct: Math.round(u19 / 0.19), kz81_steuer_ct: u19, kz86_bemessung_ct: Math.round(u7 / 0.07), kz86_steuer_ct: u7,
        kz66_vorsteuer_ct: vst, kz83_ct: u19 + u7 - vst, gezahlt_ct: saldo(['ust_fa'], p.von, p.bis, 'soll_id') };
    });
    return { jahr, zeitraum, versteuerung, zeilen, aktiv: !!get(`SELECT 1 FROM konten WHERE objekt_id = ? AND klasse = 'steuer'`, objektId) };
  }

  return {
    anlageV,
    rendite,
    vermietAnteil: (objektId, von, bis) => vermietAnteil(objektId, von, bis),
    kostenAufgeteilt: (objektId, von, bis, anteil, zinsFaktor) => kostenAufgeteilt(objektId, von, bis, anteil, zinsFaktor),
    vergleichsmieteQm,
    hausDurchschnittQm,
    einnahmen,
    zufluss,
    afa,
    anschaffungsnah,
    ustUebersicht,
    steuerpaketDaten,
    erhaltungsverteilungen: (objektId) => all('SELECT * FROM erhaltungsverteilung WHERE objekt_id = ? ORDER BY jahr DESC, id DESC', objektId),
    // Maintenance costs of a year that could be spread: the larger postings on maintenance accounts.
    erhaltungKandidaten: (objektId, jahr) => all(`SELECT b.id, b.datum, b.text, b.betrag_ct, k.bezeichnung AS konto FROM buchungen b JOIN konten k ON k.id = b.soll_id
      WHERE k.objekt_id = ? AND k.kategorie = 'instandhaltung' AND k.aus_ruecklage = 0 AND substr(b.datum, 1, 4) = ? ORDER BY b.betrag_ct DESC LIMIT 30`, objektId, String(jahr)),
    steuerangabenSetzen: (objektId, jahr, w) => db.prepare(`INSERT INTO steuerangaben (objekt_id, jahr, schuldzinsen_ct, geldbeschaffung_ct, fahrtkosten_ct, sonstige_ct, ruecklage_hausgeld_ct, notiz, zins_anteil)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (objekt_id, jahr) DO UPDATE SET schuldzinsen_ct = excluded.schuldzinsen_ct,
      geldbeschaffung_ct = excluded.geldbeschaffung_ct, fahrtkosten_ct = excluded.fahrtkosten_ct, sonstige_ct = excluded.sonstige_ct,
      ruecklage_hausgeld_ct = excluded.ruecklage_hausgeld_ct, notiz = excluded.notiz, zins_anteil = excluded.zins_anteil`)
      .run(objektId, jahr, w.schuldzinsen_ct ?? null, w.geldbeschaffung_ct ?? null, w.fahrtkosten_ct ?? null, w.sonstige_ct ?? null, w.ruecklage_hausgeld_ct ?? null, w.notiz ?? null,
        w.zins_anteil ?? null),

    // External owners' statement (condo let to a tenant, WEG managed elsewhere): the allocable cost shares from that
    // statement are moved out of the paid house money onto the matching cost accounts, so the tenant's
    // service-charge statement can use them.
    wegKostenUebernehmen: (objektId, datum, positionen, text) => tx(() => {
      let hg = get(`SELECT id FROM konten WHERE objekt_id = ? AND kategorie = 'hausgeld_weg'`, objektId);
      if (!hg) {
        const nr = get(`SELECT nr FROM konten WHERE objekt_id = ? AND nr = 45500`, objektId) ? 45501 : 45500;
        db.prepare(`INSERT INTO konten (objekt_id, nr, bezeichnung, klasse, kategorie) VALUES (?, ?, 'Hausgeld an WEG (fremdverwaltet)', 'kosten', 'hausgeld_weg')`).run(objektId, nr);
        hg = get(`SELECT id FROM konten WHERE objekt_id = ? AND kategorie = 'hausgeld_weg'`, objektId);
      }
      const pos = positionen.filter((p) => p.betrag_ct).map((p) => ({ soll_id: p.konto_id, haben_id: hg.id, betrag_ct: p.betrag_ct, text: p.text }));
      if (!pos.length) throw new Error('Keine Beträge angegeben.');
      return bh.buchenIntern({ objekt_id: objektId, datum, text: text ?? 'Umlagefähige Kosten aus WEG-Abrechnung', art: 'umbuchung', positionen: pos });
    }),
  };
};

function nachTag(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function vorTag(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
