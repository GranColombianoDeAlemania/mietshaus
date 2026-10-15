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

module.exports = function auswertung({ db, all, get, tx, bh }) {
  // Cash received in a period on a tenant account, split by income type in first-in-first-out order:
  // payments settle the oldest charges first. Credit notes (e.g. a statement credit) count negatively.
  function zufluss(kontoId, von, bis) {
    const zahlung = (bisDatum) => get(`SELECT
        coalesce((SELECT sum(b.betrag_ct) FROM buchungen b JOIN konten g ON g.id = b.soll_id WHERE b.haben_id = ?1 AND g.klasse = 'geld' AND b.datum <= ?2), 0) -
        coalesce((SELECT sum(b.betrag_ct) FROM buchungen b JOIN konten g ON g.id = b.haben_id WHERE b.soll_id = ?1 AND g.klasse = 'geld' AND b.datum <= ?2), 0) AS s`,
    kontoId, bisDatum).s;
    const p0 = zahlung(vorTag(von)), p1 = zahlung(bis);
    const posten = all(`SELECT b.datum, b.id, e.kategorie, CASE WHEN b.soll_id = ?1 THEN b.betrag_ct ELSE -b.betrag_ct END AS ct
      FROM buchungen b JOIN konten e ON e.id = CASE WHEN b.soll_id = ?1 THEN b.haben_id ELSE b.soll_id END
      WHERE (b.soll_id = ?1 OR b.haben_id = ?1) AND e.klasse = 'einnahme' ORDER BY b.datum, b.id`, kontoId);
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
    const gruppen = Object.fromEntries(WK_GRUPPEN.map(([g, l]) => [g, { label: l, ct: 0, konten: [] }]));
    for (const k of kosten(objektId, von, bis)) {
      const [g] = WK_GRUPPEN.find(([, , f]) => f(k));
      gruppen[g].ct += k.betrag_ct;
      gruppen[g].konten.push({ nr: k.nr, bezeichnung: k.bezeichnung, ct: k.betrag_ct });
    }
    if (manuell.ruecklage_hausgeld_ct) gruppen.hausgeld.ct -= manuell.ruecklage_hausgeld_ct;
    const einnahmenZeilen = [
      ['Mieteinnahmen für Wohnungen und andere Räume (ohne Umlagen)', (ein.miete ?? 0) + (ein.sonst ?? 0)],
      ['Umlagen, verrechnet mit Erstattungen (Betriebs-/Heizkosten)', (ein.bk ?? 0) + (ein.hk ?? 0) + (ein.nk_ergebnis ?? 0)],
      ['Sonstige Einnahmen (z. B. Mahngebühren, Zinsen)', (ein.mahngebuehr ?? 0) + (ein.zins ?? 0) + (ein.sonstige ?? 0)],
    ];
    const werbungskosten = [
      ['Absetzung für Abnutzung (AfA) Gebäude', afa(o, jahr)],
      ['Schuldzinsen', manuell.schuldzinsen_ct ?? 0],
      ['Geldbeschaffungskosten', manuell.geldbeschaffung_ct ?? 0],
      ...WK_GRUPPEN.map(([g]) => [gruppen[g].label, gruppen[g].ct]),
      ['Fahrtkosten', manuell.fahrtkosten_ct ?? 0],
      ['Weitere Werbungskosten (manuell)', manuell.sonstige_ct ?? 0],
    ].filter(([, ct]) => ct);
    const summeE = einnahmenZeilen.reduce((s, [, c]) => s + c, 0);
    const summeW = werbungskosten.reduce((s, [, c]) => s + c, 0);
    return {
      objekt: o, jahr, einnahmen: einnahmenZeilen, werbungskosten, gruppen, manuell,
      summe_einnahmen_ct: summeE, summe_werbungskosten_ct: summeW, ergebnis_ct: summeE - summeW,
      // Kaution receipts are not income; they are listed only so they are not forgotten.
      kautionen_ct: ein.kaution ?? 0,
      gemischt: o.art === 'gemischt',
    };
  }

  function rendite(objektId, jahre = 5) {
    const o = get('SELECT * FROM objekte WHERE id = ?', objektId);
    const flaeche = get('SELECT coalesce(sum(wohnflaeche), 0) AS f FROM einheiten WHERE objekt_id = ?', objektId).f;
    const invest = (o.kaufpreis_ct ?? 0) + (o.kaufnebenkosten_ct ?? 0);
    const jetzt = new Date().getFullYear();
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
      const umlagen = (ein.bk ?? 0) + (ein.hk ?? 0) + (ein.nk_ergebnis ?? 0);
      // Net operating result before financing and depreciation.
      const netto = ist + umlagen - nichtUml - uml;
      if (!soll && !ist && !ks.length) continue;
      zeilen.push({
        jahr: j, soll_kaltmiete_ct: soll, ist_kaltmiete_ct: ist, umlagen_ct: umlagen, umlagefaehig_ct: uml, nicht_umlagefaehig_ct: nichtUml,
        netto_ct: netto, ausfall_ct: Math.max(0, soll - ist),
        brutto_rendite: invest && o.kaufpreis_ct ? soll / o.kaufpreis_ct * 100 : null,
        netto_rendite: invest ? netto / invest * 100 : null,
        miete_qm: flaeche ? soll / 12 / flaeche : null, kosten_qm: flaeche ? (uml + nichtUml) / 12 / flaeche : null,
      });
    }
    return { objekt: o, flaeche, invest_ct: invest, zeilen };
  }

  return {
    anlageV,
    rendite,
    steuerangabenSetzen: (objektId, jahr, w) => db.prepare(`INSERT INTO steuerangaben (objekt_id, jahr, schuldzinsen_ct, geldbeschaffung_ct, fahrtkosten_ct, sonstige_ct, ruecklage_hausgeld_ct, notiz)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (objekt_id, jahr) DO UPDATE SET schuldzinsen_ct = excluded.schuldzinsen_ct,
      geldbeschaffung_ct = excluded.geldbeschaffung_ct, fahrtkosten_ct = excluded.fahrtkosten_ct, sonstige_ct = excluded.sonstige_ct,
      ruecklage_hausgeld_ct = excluded.ruecklage_hausgeld_ct, notiz = excluded.notiz`)
      .run(objektId, jahr, w.schuldzinsen_ct ?? null, w.geldbeschaffung_ct ?? null, w.fahrtkosten_ct ?? null, w.sonstige_ct ?? null, w.ruecklage_hausgeld_ct ?? null, w.notiz ?? null),

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

function vorTag(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
