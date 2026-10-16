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
    const gruppen = Object.fromEntries(WK_GRUPPEN.map(([g, l]) => [g, { label: l, ct: 0, konten: [] }]));
    for (const k of kosten(objektId, von, bis)) {
      const [g] = WK_GRUPPEN.find(([, , f]) => f(k));
      gruppen[g].ct += k.betrag_ct;
      gruppen[g].konten.push({ nr: k.nr, bezeichnung: k.bezeichnung, ct: k.betrag_ct });
    }
    if (manuell.ruecklage_hausgeld_ct) gruppen.hausgeld.ct -= manuell.ruecklage_hausgeld_ct;
    // Larger maintenance spread over 2–5 years (§ 82b EStDV): taken out of its year, a share counted in each year.
    for (const r of all('SELECT * FROM erhaltungsverteilung WHERE objekt_id = ? AND jahr <= ? AND jahr + jahre > ?', objektId, jahr, jahr)) {
      if (r.jahr === jahr) {
        gruppen.erhaltung.ct -= r.betrag_ct;
        gruppen.erhaltung.konten.push({ nr: '', bezeichnung: `abzüglich zu verteilender Aufwand (§ 82b EStDV)${r.text ? `: ${r.text}` : ''}`, ct: -r.betrag_ct });
      }
      const teil = Math.floor(r.betrag_ct / r.jahre);
      const anteil = jahr === r.jahr + r.jahre - 1 ? r.betrag_ct - teil * (r.jahre - 1) : teil;
      gruppen.erhaltung.ct += anteil;
      gruppen.erhaltung.konten.push({ nr: '', bezeichnung: `Verteilung aus ${r.jahr} (${jahr - r.jahr + 1}/${r.jahre})${r.text ? `: ${r.text}` : ''}`, ct: anteil });
    }
    // VAT for commercial lettings: input tax paid and VAT paid to / refunded by the tax office.
    const steuer = (kategorien, richtung) => get(`SELECT coalesce(sum(CASE WHEN b.${richtung === 'soll' ? 'soll_id' : 'haben_id'} = k.id THEN b.betrag_ct ELSE -b.betrag_ct END), 0) AS s
      FROM buchungen b JOIN konten k ON k.id IN (b.soll_id, b.haben_id) WHERE k.objekt_id = ? AND k.klasse = 'steuer' AND k.kategorie IN (${kategorien.map(() => '?').join(',')})
      AND b.datum BETWEEN ? AND ?`, objektId, ...kategorien, von, bis).s;
    const vorsteuer = steuer(['vorsteuer19', 'vorsteuer7'], 'soll');
    const fa = steuer(['ust_fa'], 'soll');
    const einnahmenZeilen = [
      ['Mieteinnahmen für Wohnungen und andere Räume (ohne Umlagen)', (ein.miete ?? 0) + (ein.sonst ?? 0)],
      ['Umlagen, verrechnet mit Erstattungen (Betriebs-/Heizkosten)', (ein.bk ?? 0) + (ein.hk ?? 0) + (ein.nk_ergebnis ?? 0)],
      ['Sonstige Einnahmen (z. B. Mahngebühren, Zinsen)', (ein.mahngebuehr ?? 0) + (ein.zins ?? 0) + (ein.sonstige ?? 0)],
      ['Vereinnahmte Umsatzsteuer', (ein.ust19 ?? 0) + (ein.ust7 ?? 0)],
      ['Vom Finanzamt erstattete Umsatzsteuer', fa < 0 ? -fa : 0],
    ].filter(([l, ct]) => ct || !/Umsatzsteuer/.test(l));
    const werbungskosten = [
      ['Absetzung für Abnutzung (AfA) Gebäude', afa(o, jahr)],
      ['Schuldzinsen', manuell.schuldzinsen_ct ?? 0],
      ['Geldbeschaffungskosten', manuell.geldbeschaffung_ct ?? 0],
      ...WK_GRUPPEN.map(([g]) => [gruppen[g].label, gruppen[g].ct]),
      ['Gezahlte Vorsteuerbeträge', vorsteuer],
      ['An das Finanzamt gezahlte Umsatzsteuer', fa > 0 ? fa : 0],
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

  // 15 % rule (§ 6 Abs. 1 Nr. 1a EStG): repairs and modernisation within three years after purchase that exceed 15 %
  // of the building's purchase cost (net, without VAT) become acquisition costs and can only be depreciated.
  function anschaffungsnah(objektId = null) {
    const t = new Date().toISOString().slice(0, 10);
    return all(`SELECT * FROM objekte WHERE kaufdatum IS NOT NULL AND kaufpreis_ct > 0 AND (?1 IS NULL OR id = ?1)`, objektId).map((o) => {
      const [y, m, d] = o.kaufdatum.split('-').map(Number);
      const frist = new Date(Date.UTC(y + 3, m - 1, d)).toISOString().slice(0, 10);
      const gebaeude = Math.round((o.kaufpreis_ct + (o.kaufnebenkosten_ct ?? 0)) * (o.gebaeudeanteil ?? 100) / 100);
      const grenze = Math.round(gebaeude * 0.15);
      // § 6 Abs. 1 Nr. 1a EStG counts the expenses without VAT. Per booking, the maintenance amount plus input tax booked
      // with it is the invoice total; an e-invoice linked to the booking gives the exact net amount, otherwise 19 % VAT is taken out.
      const gruppen = new Map();
      for (const b of all(`SELECT coalesce(b.gruppe, b.id) AS g, CASE WHEN k.id = b.soll_id THEN b.betrag_ct ELSE -b.betrag_ct END AS ct
          FROM buchungen b JOIN konten k ON k.id IN (b.soll_id, b.haben_id)
          WHERE k.objekt_id = ? AND k.kategorie = 'instandhaltung' AND b.datum BETWEEN ? AND ?`, o.id, o.kaufdatum, frist)) gruppen.set(b.g, (gruppen.get(b.g) ?? 0) + b.ct);
      let brutto = 0, netto = 0;
      for (const [g, ct] of gruppen) {
        const vst = get(`SELECT coalesce(sum(b.betrag_ct), 0) AS s FROM buchungen b JOIN konten k ON k.id = b.soll_id
          WHERE coalesce(b.gruppe, b.id) = ? AND k.klasse = 'steuer' AND k.kategorie IN ('vorsteuer19', 'vorsteuer7')`, g).s;
        const dok = get('SELECT netto_ct, betrag_ct FROM dokumente WHERE buchung_id = ? AND netto_ct IS NOT NULL ORDER BY id LIMIT 1', g);
        const summe = ct + (ct > 0 ? vst : -vst);
        brutto += summe;
        netto += dok && Math.abs(dok.betrag_ct - Math.abs(summe)) <= 1 ? Math.sign(summe) * dok.netto_ct : Math.round(summe / 1.19);
      }
      return { objekt_id: o.id, objekt: o.bezeichnung, kaufdatum: o.kaufdatum, frist, laeuft: t <= frist, gebaeude_ct: gebaeude, grenze_ct: grenze,
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
    anschaffungsnah,
    ustUebersicht,
    steuerpaketDaten,
    erhaltungsverteilungen: (objektId) => all('SELECT * FROM erhaltungsverteilung WHERE objekt_id = ? ORDER BY jahr DESC, id DESC', objektId),
    // Maintenance costs of a year that could be spread: the larger postings on maintenance accounts.
    erhaltungKandidaten: (objektId, jahr) => all(`SELECT b.id, b.datum, b.text, b.betrag_ct, k.bezeichnung AS konto FROM buchungen b JOIN konten k ON k.id = b.soll_id
      WHERE k.objekt_id = ? AND k.kategorie = 'instandhaltung' AND k.aus_ruecklage = 0 AND substr(b.datum, 1, 4) = ? ORDER BY b.betrag_ct DESC LIMIT 30`, objektId, String(jahr)),
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
