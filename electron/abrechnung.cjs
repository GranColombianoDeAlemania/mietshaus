// Annual statements: service charges for tenants (incl. heating and CO2 split), house money for owners,
// budget plan, reserves and special levies. All amounts in cents.
const { tageZwischen } = require('./buchhaltung.cjs');

const tage = (von, bis) => tageZwischen(von, bis) + 1;
const max = (a, b) => (a > b ? a : b);
const min = (a, b) => (a < b ? a : b);

// CO2KostAufG stage model for residential buildings: kg CO2 per m² and year → landlord share.
const CO2_STUFEN = [[12, 0], [17, 10], [22, 20], [27, 30], [32, 40], [37, 50], [42, 60], [47, 70], [52, 80], [Infinity, 95]];
const co2Vermieteranteil = (kgProQm) => CO2_STUFEN.find(([grenze]) => kgProQm < grenze)[1];

module.exports = function abrechnung({ db, all, get, tx, PERSON_NAME, bh }) {
  const vertragTabelle = (typ) => (typ === 'weg' ? 'eigentum' : 'mietverhaeltnisse');

  // Splits each unit's use over the period into contract segments; gaps become vacancy segments (vertrag = null).
  // For tenancies a gap in which the landlord lives in the unit himself is a self-use segment (selbst = { personen }):
  // it takes part in every key like a tenancy, and its share is borne by the landlord.
  // annahme: { einheit_id, personen } treats that unit as self-used for the whole period (what the own flat would cost).
  function abschnitte(objektId, typ, von, bis, annahme = null) {
    const einheiten = all('SELECT * FROM einheiten WHERE objekt_id = ? ORDER BY nr', objektId);
    const out = [];
    for (const e of einheiten) {
      if (annahme && annahme.einheit_id === e.id) {
        out.push({ einheit: e, vertrag: null, selbst: { id: null, personen: Number(annahme.personen) || 0 }, von, bis, tage: tage(von, bis) });
        continue;
      }
      const selbst = typ === 'miete' ? all(`SELECT * FROM selbstnutzung WHERE einheit_id = ? AND beginn <= ? AND (ende IS NULL OR ende = '' OR ende >= ?)
        ORDER BY beginn`, e.id, bis, von) : [];
      const luecke = (a, b) => {
        let c = a;
        for (const sn of selbst) {
          const sa = max(sn.beginn, c), sb = min(sn.ende || '9999-12-31', b);
          if (sa > sb) continue;
          if (sa > c) out.push({ einheit: e, vertrag: null, von: c, bis: vorTag(sa), tage: tage(c, vorTag(sa)) });
          out.push({ einheit: e, vertrag: null, selbst: { id: sn.id, personen: sn.personen ?? 0 }, von: sa, bis: sb, tage: tage(sa, sb) });
          c = nachTag(sb);
        }
        if (c <= b) out.push({ einheit: e, vertrag: null, von: c, bis: b, tage: tage(c, b) });
      };
      const vs = all(`SELECT v.*, ${PERSON_NAME} AS name FROM ${vertragTabelle(typ)} v JOIN personen p ON p.id = v.person_id
        WHERE v.einheit_id = ? AND v.beginn <= ? AND (v.ende IS NULL OR v.ende = '' OR v.ende >= ?) ORDER BY v.beginn`, e.id, bis, von);
      let cursor = von;
      for (const v of vs) {
        const a = max(v.beginn, von), b = min(v.ende || '9999-12-31', bis);
        if (a > cursor) luecke(cursor, vorTag(a));
        out.push({ einheit: e, vertrag: v, von: a, bis: b, tage: tage(a, b) });
        cursor = nachTag(b);
      }
      if (cursor <= bis) luecke(cursor, bis);
    }
    return out;
  }

  // Value of an allocation key for one segment, and the key's total over the whole period.
  // leerPersonen: persons counted for a vacant flat under a per-person key, so the landlord bears the vacancy
  // (no fixed rule, BGH VIII ZR 180/12; tenants' associations count one person).
  function schluesselRechner(objektId, von, bis, leerPersonen = 0) {
    const cache = new Map();
    const periodeTage = tage(von, bis);
    return (schluesselId, segmente) => {
      if (!schluesselId) return null;
      if (cache.has(schluesselId)) return cache.get(schluesselId);
      const k = get('SELECT * FROM umlageschluessel WHERE id = ?', schluesselId);
      if (!k) return null;
      const werte = Object.fromEntries(all('SELECT einheit_id, wert FROM schluesselwerte WHERE schluessel_id = ?', k.id).map((w) => [w.einheit_id, w.wert]));
      let wert, gesamt;
      if (k.typ === 'personen') {
        // Person-days: each tenancy's people weighted by its days in the period.
        const leer = (e) => (!e.art || e.art === 'Wohnung' ? leerPersonen : 0);
        // The own household counts with its real size.
        wert = (s) => (s.vertrag ? s.vertrag.personen_anzahl ?? 0 : s.selbst ? s.selbst.personen ?? 0 : leer(s.einheit)) * s.tage / periodeTage;
        gesamt = segmente.reduce((sum, s) => sum + wert(s), 0);
      } else if (k.typ === 'zaehler') {
        const zaehler = all(`SELECT * FROM zaehler WHERE objekt_id = ? AND art = ? AND einheit_id IS NOT NULL`, objektId, k.zaehler_art);
        const verbrauchEinheit = (eid, a, b) => zaehler.filter((z) => z.einheit_id === eid).reduce((s, z) => s + bh.verbrauch(z.id, a, b), 0);
        // A reading is the meter state at the end of its day, as read that day ("Stand am 31.12."): a segment [von, bis]
        // runs from the reading of the day before it starts to the reading of its last day. Dates without a reading are interpolated.
        wert = (s) => verbrauchEinheit(s.einheit.id, vorTag(s.von), s.bis);
        const einheiten = [...new Set(segmente.map((s) => s.einheit.id))];
        gesamt = einheiten.reduce((sum, eid) => sum + verbrauchEinheit(eid, vorTag(von), bis), 0);
      } else {
        // Area, co-ownership shares and unit count always come straight from the units; only manual keys use stored values.
        const einheitWert = (e) => (k.typ === 'flaeche' ? e.wohnflaeche ?? 0 : k.typ === 'mea' ? e.mea ?? 0 : k.typ === 'einheiten' ? 1 : werte[e.id] ?? 0);
        wert = (s) => einheitWert(s.einheit) * s.tage / periodeTage;
        const einheiten = [...new Map(segmente.map((s) => [s.einheit.id, s.einheit])).values()];
        gesamt = einheiten.reduce((sum, e) => sum + einheitWert(e), 0);
      }
      const r = { k, wert, gesamt };
      cache.set(schluesselId, r);
      return r;
    };
  }

  const kostenImZeitraum = (objektId, von, bis, filter) => all(`SELECT k.*,
      coalesce((SELECT sum(betrag_ct) FROM buchungen WHERE soll_id = k.id AND datum BETWEEN ?2 AND ?3), 0) -
      coalesce((SELECT sum(betrag_ct) FROM buchungen WHERE haben_id = k.id AND datum BETWEEN ?2 AND ?3), 0) AS betrag_ct
    FROM konten k WHERE k.objekt_id = ?1 AND k.klasse = 'kosten' ${filter} ORDER BY k.nr`, objektId, von, bis)
    .filter((k) => k.betrag_ct !== 0);

  // Charged advance payments of a contract in the period, by income category.
  const vorauszahlungen = (kontoId, kategorien, von, bis) => kategorien.map((kat) => get(`SELECT coalesce(sum(b.betrag_ct), 0) AS s
      FROM buchungen b JOIN konten e ON e.id = b.haben_id
      WHERE b.soll_id = ? AND e.kategorie = ? AND b.art = 'soll' AND b.datum BETWEEN ? AND ?`, kontoId, kat, von, bis).s);

  // ---------- Service-charge statement (tenants) ----------
  function nkAbrechnung(objektId, von, bis, opt = {}) {
    const o = { heizung: 'intern', verbrauchsanteil: 70, co2_kg: 0, co2_kosten_ct: 0, extern: {}, ausnahmen: [], leerstand_personen: 1, ...opt };
    const segmente = abschnitte(objektId, 'miete', von, bis, o.annahme_selbst ?? null);
    const rechner = schluesselRechner(objektId, von, bis, Number(o.leerstand_personen) || 0);
    const konten = kostenImZeitraum(objektId, von, bis, 'AND k.umlagefaehig = 1');
    const flaecheKey = get(`SELECT id FROM umlageschluessel WHERE objekt_id = ? AND typ = 'flaeche' ORDER BY id LIMIT 1`, objektId)?.id;
    const ausnahme = new Set(o.ausnahmen.map(([v, k]) => `${v}:${k}`));

    const posten = []; // one line per cost account (heating may be split into base and consumption)
    const anteil = new Map(); // segment index → array of shares per posten
    const add = (i, p, ct, einheiten) => {
      if (!anteil.has(i)) anteil.set(i, []);
      anteil.get(i)[p] = { ct, einheiten };
    };

    const verteile = (label, k, betrag, schluesselId, extra = {}) => {
      const r = rechner(schluesselId, segmente);
      const p = posten.length;
      posten.push({ label, konto: k, gesamt_ct: betrag, schluessel: r?.k?.bezeichnung ?? '–', einheit: r?.k?.einheit ?? '', gesamt_einheiten: r?.gesamt ?? 0, ...extra });
      segmente.forEach((s, i) => {
        if (!r || !r.gesamt) return add(i, p, 0, 0);
        const w = r.wert(s);
        const ct = Math.round(betrag * w / r.gesamt);
        add(i, p, s.vertrag && ausnahme.has(`${s.vertrag.id}:${k?.id}`) ? 0 : ct, w);
      });
    };

    const heizkonten = konten.filter((k) => k.heizkosten);
    for (const k of konten.filter((k) => !k.heizkosten || o.heizung === 'ohne')) verteile(k.bezeichnung, k, k.betrag_ct, k.schluessel_id ?? flaecheKey, { kategorie: k.kategorie, p35a: k.p35a });

    let heizung = null;
    if (heizkonten.length && o.heizung === 'intern') {
      // HeizkostenV: a share by consumption (50–70 %), the rest by heated area.
      for (const k of heizkonten) {
        const zArt = k.kategorie === 'bk05' ? 'warmwasser' : 'waerme';
        const vKey = get(`SELECT id FROM umlageschluessel WHERE objekt_id = ? AND typ = 'zaehler' AND zaehler_art IN (?, ?) ORDER BY id LIMIT 1`,
          objektId, zArt, zArt === 'waerme' ? 'heizkostenverteiler' : zArt)?.id;
        const vr = vKey ? rechner(vKey, segmente) : null;
        const verbrauch = vr && vr.gesamt > 0 ? Math.round(k.betrag_ct * o.verbrauchsanteil / 100) : 0;
        verteile(`${k.bezeichnung} – Grundkosten (${verbrauch ? 100 - o.verbrauchsanteil : 100} %)`, k, k.betrag_ct - verbrauch, flaecheKey, { kategorie: k.kategorie, heizung: true, p35a: k.p35a });
        if (verbrauch) verteile(`${k.bezeichnung} – Verbrauchskosten (${o.verbrauchsanteil} %)`, k, verbrauch, vKey, { kategorie: k.kategorie, heizung: true });
      }
      heizung = { modus: 'intern', ohne_zaehler: !get(`SELECT 1 FROM zaehler WHERE objekt_id = ? AND art IN ('waerme','heizkostenverteiler')`, objektId) };
    } else if (o.heizung === 'extern') {
      // Results of an external billing company, entered per contract.
      const p = posten.length;
      const gesamt = Object.values(o.extern).reduce((s, v) => s + (Number(v) || 0), 0);
      posten.push({ label: 'Heiz- und Warmwasserkosten lt. Abrechnung des Messdienstes', gesamt_ct: gesamt, schluessel: 'Einzelabrechnung', einheit: '', gesamt_einheiten: 0, heizung: true, kategorie: 'bk04' });
      segmente.forEach((s, i) => add(i, p, s.vertrag ? Number(o.extern[s.vertrag.id]) || 0 : 0, 0));
      heizung = { modus: 'extern' };
    }

    // CO2 cost split: the landlord bears a share of the CO2 price depending on the building's emissions per m².
    let co2 = null;
    if (o.co2_kg > 0 && o.co2_kosten_ct > 0) {
      const flaeche = get('SELECT coalesce(sum(wohnflaeche), 0) AS f FROM einheiten WHERE objekt_id = ?', objektId).f || 1;
      const kgProQm = o.co2_kg / flaeche * (365 / tage(von, bis));
      const prozent = co2Vermieteranteil(kgProQm);
      const heizIdx = posten.map((p, i) => (p.heizung ? i : -1)).filter((i) => i >= 0);
      const heizGesamt = heizIdx.reduce((s, i) => s + posten[i].gesamt_ct, 0) || 1;
      const p = posten.length;
      posten.push({ label: `CO₂-Kostenanteil Vermieter (${prozent} %, ${kgProQm.toFixed(1).replace('.', ',')} kg CO₂/m²·a)`, gesamt_ct: -Math.round(o.co2_kosten_ct * prozent / 100), schluessel: 'Heizkostenanteil', einheit: '', gesamt_einheiten: 0, co2: true });
      segmente.forEach((s, i) => {
        const heiz = heizIdx.reduce((sum, j) => sum + (anteil.get(i)?.[j]?.ct ?? 0), 0);
        add(i, p, -Math.round(o.co2_kosten_ct * prozent / 100 * heiz / heizGesamt), 0);
      });
      co2 = { kg: o.co2_kg, kg_pro_qm: kgProQm, vermieter_prozent: prozent, kosten_ct: o.co2_kosten_ct };
    }

    const ergebnisse = segmente.map((s, i) => {
      const a = posten.map((_, p) => anteil.get(i)?.[p] ?? { ct: 0, einheiten: 0 });
      const kosten = a.reduce((sum, x) => sum + x.ct, 0);
      const heiz = a.reduce((sum, x, p) => sum + (posten[p].heizung || posten[p].co2 ? x.ct : 0), 0);
      const konto = s.vertrag ? bh.kontoVon('miete', s.vertrag.id) : null;
      const [bkVz, hkVz] = konto ? vorauszahlungen(konto.id, ['bk', 'hk'], s.von, s.bis) : [0, 0];
      const p35a = { dienstleistung: 0, handwerker: 0 };
      a.forEach((x, p) => { if (posten[p].p35a) p35a[posten[p].p35a] += x.ct; });
      // Suggested new monthly advance payments: this year's costs spread over 12 months, rounded up to whole euros.
      const monate = 12 * s.tage / tage(von, bis);
      // Commercial lettings with VAT: the result is net, VAT is added on top.
      const ustSatz = s.vertrag ? Number(s.vertrag.ust_satz) || 0 : 0;
      const ergebnis = kosten - bkVz - hkVz;
      return {
        segment: { von: s.von, bis: s.bis, tage: s.tage, einheit: s.einheit, vertrag: s.vertrag, konto_id: konto?.id ?? null, selbst: s.selbst ?? null },
        anteile: a, kosten_ct: kosten, heiz_ct: heiz, bk_ct: kosten - heiz, bk_vz_ct: bkVz, hk_vz_ct: hkVz,
        ergebnis_ct: ergebnis, ust_satz: ustSatz, ust_ct: ustSatz ? Math.round(ergebnis * ustSatz / 100) : 0, p35a,
        neu_bk_vz_ct: Math.ceil((kosten - heiz) / Math.max(1, monate) / 100) * 100,
        neu_hk_vz_ct: Math.ceil(heiz / Math.max(1, monate) / 100) * 100,
      };
    });

    return { typ: 'nk', objekt_id: objektId, von, bis, optionen: o, posten, ergebnisse, heizung, co2,
      summe_ct: posten.reduce((s, p) => s + p.gesamt_ct, 0),
      leerstand_ct: ergebnisse.filter((e) => !e.segment.vertrag && !e.segment.selbst).reduce((s, e) => s + e.kosten_ct, 0),
      eigenanteil_ct: ergebnisse.filter((e) => e.segment.selbst).reduce((s, e) => s + e.kosten_ct, 0) };
  }

  // ---------- Checks before a service-charge statement goes out ----------
  // Each point: stufe 'fehler' (must be fixed), 'warnung' (check), 'info'; text in plain German, with the legal source.
  function nkPruefung(objektId, von, bis, opt = {}) {
    const a = nkAbrechnung(objektId, von, bis, opt);
    const o = a.optionen;
    const punkte = [];
    const add = (stufe, text, hilfe = null, extra = {}) => punkte.push({ stufe, text, hilfe, ...extra });
    const heuteIso = new Date().toISOString().slice(0, 10);
    const euro = (ct) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format((ct ?? 0) / 100);
    const datumDe = (iso) => iso.split('-').reverse().join('.');
    const tageP = tage(von, bis);

    // Period and deadline (§ 556 Abs. 3 BGB).
    if (tageP > 366) add('fehler', `Der Abrechnungszeitraum ist länger als zwölf Monate (${tageP} Tage).`, '§ 556 Abs. 3 Satz 1 BGB: höchstens ein Jahr.');
    const [by, bm, bd] = bis.split('-').map(Number);
    const monatsEnde = bd === new Date(Date.UTC(by, bm, 0)).getUTCDate();
    const frist = monatsEnde ? new Date(Date.UTC(by + 1, bm, 0)).toISOString().slice(0, 10) : `${by + 1}-${String(bm).padStart(2, '0')}-${String(bd).padStart(2, '0')}`;
    const rest = Math.round((Date.parse(frist) - Date.parse(heuteIso)) / 864e5);
    if (rest < 0) add('fehler', `Die Abrechnungsfrist ist am ${datumDe(frist)} abgelaufen: Nachzahlungen können nicht mehr verlangt werden, Guthaben müssen trotzdem ausgezahlt werden.`, '§ 556 Abs. 3 Satz 3 BGB (es sei denn, die Verspätung ist nicht vom Vermieter zu vertreten).');
    else if (rest <= 30) add('warnung', `Die Abrechnung muss bis spätestens ${datumDe(frist)} beim Mieter eingegangen sein – noch ${rest} Tage.`, '§ 556 Abs. 3 Satz 2 BGB. Zugang nachweisbar machen.');
    else add('info', `Frist: Die Abrechnung muss bis ${datumDe(frist)} beim Mieter eingegangen sein.`, '§ 556 Abs. 3 Satz 2 BGB.');

    const konten = all(`SELECT k.* FROM konten k WHERE k.objekt_id = ? AND k.klasse = 'kosten'`, objektId);
    const kosten = (k, v = von, b = bis) => get(`SELECT coalesce(sum(betrag_ct), 0) AS s FROM buchungen WHERE soll_id = ? AND datum BETWEEN ? AND ?`, k.id, v, b).s -
      get(`SELECT coalesce(sum(betrag_ct), 0) AS s FROM buchungen WHERE haben_id = ? AND datum BETWEEN ? AND ?`, k.id, v, b).s;
    const umlagefaehig = konten.filter((k) => k.umlagefaehig);

    // Costs that are no operating costs.
    for (const k of umlagefaehig.filter((k) => ['verwaltung', 'instandhaltung', 'bank', 'sonstige', 'kabel_tv'].includes(k.kategorie))) {
      const b = kosten(k);
      if (b) add('fehler', `„${k.bezeichnung}“ ist als umlagefähig markiert (${euro(b)}), gehört aber nicht zu den Betriebskosten.`,
        k.kategorie === 'kabel_tv' ? 'Laufende Kabel-TV-Gebühren sind seit 1.7.2024 nicht mehr umlagefähig (§ 2 Nr. 15 BetrKV, Ende des Nebenkostenprivilegs).'
          : 'Verwaltungs- und Instandhaltungskosten dürfen nicht umgelegt werden (§ 1 Abs. 2 BetrKV).', { links: [{ text: `„${k.bezeichnung}“`, ziel: { konto: k.id } }] });
    }
    for (const k of umlagefaehig.filter((k) => !k.kategorie || !/^bk\d/.test(k.kategorie))) {
      if (['verwaltung', 'instandhaltung', 'bank', 'sonstige', 'kabel_tv'].includes(k.kategorie)) continue;
      const b = kosten(k);
      if (b) add('warnung', `„${k.bezeichnung}“ ist umlagefähig, aber keiner Betriebskostenart nach § 2 BetrKV zugeordnet.`, 'Im Kontenplan die Kostenart setzen – nur die dort genannten Kosten sind umlegbar.',
        { links: [{ text: `„${k.bezeichnung}“`, ziel: { konto: k.id } }] });
    }
    // Cable TV / broadband since 1 July 2024.
    if (bis >= '2024-07-01') {
      for (const k of umlagefaehig.filter((k) => k.kategorie === 'bk15')) {
        const verdaechtig = all(`SELECT DISTINCT text FROM buchungen WHERE soll_id = ? AND datum BETWEEN ? AND ? AND (lower(coalesce(text, '')) LIKE '%kabel%'
          OR lower(coalesce(text, '')) LIKE '%vodafone%' OR lower(coalesce(text, '')) LIKE '%pyur%' OR lower(coalesce(text, '')) LIKE '%tele columbus%'
          OR lower(coalesce(text, '')) LIKE '%tv%' OR lower(coalesce(text, '')) LIKE '%fernseh%')`, k.id, von > '2024-07-01' ? von : '2024-07-01', bis).map((x) => x.text);
        if (verdaechtig.length) add('fehler', `Unter „${k.bezeichnung}“ stehen Buchungen, die nach Kabel-TV aussehen (${verdaechtig.slice(0, 3).join('; ')}).`,
          'Seit 1.7.2024 sind nur noch Betriebsstrom und Wartung der Antenne bzw. Verteilanlage umlagefähig, keine TV-Gebühren (§ 2 Nr. 15 BetrKV). Solche Rechnungen auf „Kabel-TV-Gebühren (nicht umlagefähig)“ buchen.',
          { links: [{ text: `„${k.bezeichnung}“`, ziel: { konto: k.id } }] });
        else if (kosten(k)) add('info', `„${k.bezeichnung}“: Seit 1.7.2024 dürfen hier nur Betriebsstrom und Wartung umgelegt werden.`, '§ 2 Nr. 15 BetrKV.');
      }
    }
    // Fibre provision fee: at most 60 € per flat and year.
    const wohnungen = get(`SELECT count(*) AS n FROM einheiten WHERE objekt_id = ? AND art IN ('Wohnung', 'Gewerbe')`, objektId).n || 1;
    for (const k of umlagefaehig.filter((k) => k.kategorie === 'bk15c')) {
      const b = kosten(k);
      const jeWohnungJahr = b / wohnungen * 365 / tageP;
      if (jeWohnungJahr > 6000.5) add('fehler', `Glasfaser-Bereitstellungsentgelt: ${euro(Math.round(jeWohnungJahr))} je Wohnung und Jahr – erlaubt sind höchstens 60 €.`,
        '§ 2 Nr. 15 c BetrKV i. V. m. § 72 TKG; insgesamt höchstens 540 € je Wohnung, längstens 5 Jahre (in Ausnahmefällen 9).');
      else if (b) add('info', `Glasfaser-Bereitstellungsentgelt ${euro(Math.round(jeWohnungJahr))} je Wohnung und Jahr (Grenze 60 €).`, 'Nur umlegbar, wenn die Mieter ihren Anbieter frei wählen können; höchstens 5 Jahre (9 in Ausnahmefällen).');
    }
    // "Other operating costs" must be named in the lease.
    for (const k of umlagefaehig.filter((k) => k.kategorie === 'bk17')) {
      const b = kosten(k);
      if (b) add('warnung', `„${k.bezeichnung}“ (${euro(b)}): Sonstige Betriebskosten sind nur umlegbar, wenn sie im Mietvertrag einzeln benannt sind.`, '§ 2 Nr. 17 BetrKV.');
    }
    // Allocation keys that sum to zero.
    for (const p of a.posten.filter((p) => p.gesamt_ct && !p.heizung && !p.co2 && p.schluessel !== 'Einzelabrechnung' && !p.gesamt_einheiten)) {
      add('fehler', `„${p.label}“ (${euro(p.gesamt_ct)}) kann nicht verteilt werden: Der Schlüssel „${p.schluessel}“ ergibt 0.`, 'Fehlende Flächen, Personenzahlen oder Zählerstände ergänzen.');
    }
    // Heating (HeizkostenV) and CO2 split.
    if (o.heizung === 'intern' && a.posten.some((p) => p.heizung)) {
      if (o.verbrauchsanteil < 50 || o.verbrauchsanteil > 70) add('fehler', `Der Verbrauchsanteil der Heizkosten beträgt ${o.verbrauchsanteil} % – zulässig sind 50 bis 70 %.`, '§§ 7, 8 HeizkostenV.');
      if (a.heizung?.ohne_zaehler) add('warnung', 'Für die Heizkosten gibt es keine Verbrauchserfassung; sie werden nur nach Fläche verteilt.', 'Der Mieter darf seinen Anteil dann um 15 % kürzen (§ 12 Abs. 1 HeizkostenV).');
    }
    if (a.posten.some((p) => p.heizung) && !a.co2) add('warnung', 'Die CO₂-Kostenaufteilung fehlt.',
      'Bei Heizöl, Erdgas, Flüssiggas oder fossiler Fernwärme trägt der Vermieter je nach Ausstoß einen Teil der CO₂-Kosten (CO2KostAufG). Fehlt die Angabe, darf der Mieter seinen Heizkostenanteil um 3 % kürzen. CO₂-Menge und -Kosten stehen auf der Brennstoff- bzw. Fernwärmerechnung.');
    // Vacancy, § 35a.
    if (a.leerstand_ct) add('info', `Auf Leerstand entfallen ${euro(a.leerstand_ct)}; diese Kosten trägt der Vermieter.`);
    if (a.eigenanteil_ct) add('info', `Auf die selbst genutzte Wohnung entfallen ${euro(a.eigenanteil_ct)} (Eigenanteil). Sie nimmt an allen Schlüsseln teil, nach Personen mit deiner Haushaltsgröße; den Anteil trägst du, kein Mieter zahlt dafür.`);
    const p35 = a.ergebnisse.reduce((s, e) => s + (e.p35a?.dienstleistung ?? 0) + (e.p35a?.handwerker ?? 0), 0);
    if (p35) add('info', `Die Anteile für haushaltsnahe Dienstleistungen und Handwerkerleistungen (${euro(p35)}) werden je Mieter ausgewiesen.`, '§ 35a EStG – Mieter können sie in der Steuererklärung geltend machen.');
    // Parking spaces, garages and cellars bear only what their lease assigns to them; a per-unit key counts them like flats.
    for (const e of a.ergebnisse.filter((e) => e.segment.vertrag && e.kosten_ct > 0 && !['Wohnung', 'Gewerbe'].includes(e.segment.einheit.art ?? 'Wohnung'))) {
      add('warnung', `${e.segment.einheit.bezeichnung} (${e.segment.einheit.art}) trägt ${euro(e.kosten_ct)} Betriebskosten.`,
        'Nur richtig, wenn der Mietvertrag für diese Einheit Betriebskosten vorsieht. Sonst einen Schlüssel ohne sie verwenden (z. B. eigener Schlüssel statt „Einheiten“).',
        { links: [{ text: e.segment.vertrag.name, ziel: { vertrag: e.segment.vertrag.id, typ: 'miete' } }] });
    }
    // People and meter readings.
    if (a.posten.some((p) => /person/i.test(p.schluessel ?? ''))) {
      for (const e of a.ergebnisse.filter((e) => e.segment.vertrag && !(e.segment.vertrag.personen_anzahl > 0) && (e.segment.einheit.art ?? 'Wohnung') === 'Wohnung')) {
        add('warnung', `Bei ${e.segment.vertrag.name} ist keine Personenzahl hinterlegt; nach Personen verteilte Kosten fallen dort mit 0 an.`, null,
          { links: [{ text: e.segment.vertrag.name, ziel: { vertrag: e.segment.vertrag.id, typ: 'miete' } }] });
      }
    }
    const zaehlerKeys = all(`SELECT DISTINCT zaehler_art FROM umlageschluessel WHERE objekt_id = ? AND typ = 'zaehler'`, objektId).map((x) => x.zaehler_art);
    if (zaehlerKeys.length) {
      for (const z of all(`SELECT z.*, e.bezeichnung AS einheit FROM zaehler z LEFT JOIN einheiten e ON e.id = z.einheit_id WHERE z.objekt_id = ? AND z.einheit_id IS NOT NULL
          AND z.art IN (${zaehlerKeys.map(() => '?').join(',')}) AND (z.ausbau IS NULL OR z.ausbau = '' OR z.ausbau >= ?)`, objektId, ...zaehlerKeys, von)) {
        for (const [stichtag, wort] of [[von, 'Beginn'], [bis, 'Ende']]) {
          const nah = get(`SELECT 1 FROM zaehlerstaende WHERE zaehler_id = ? AND abs(julianday(datum) - julianday(?)) <= 31`, z.id, stichtag);
          if (!nah) add('warnung', `Zähler ${z.nummer ?? z.art} (${z.einheit}): kein Ablesewert zum ${wort} des Zeitraums – der Verbrauch wird zwischen den vorhandenen Ständen geschätzt.`,
            'Zum Stichtag ablesen (oder bei Mieterwechsel im Übergabeprotokoll festhalten).');
        }
      }
    }
    // Cost jumps against the previous year (economic efficiency, § 556 Abs. 3 Satz 1 BGB).
    const vVon = `${Number(von.slice(0, 4)) - 1}${von.slice(4)}`, vBis = `${Number(bis.slice(0, 4)) - 1}${bis.slice(4)}`;
    for (const k of umlagefaehig) {
      const jetzt = kosten(k), vorher = kosten(k, vVon, vBis);
      if (vorher > 0 && jetzt > vorher * 1.1 && jetzt - vorher > 5000) {
        add('warnung', `„${k.bezeichnung}“ ist gegenüber dem Vorjahr um ${Math.round((jetzt / vorher - 1) * 100)} % gestiegen (${euro(vorher)} → ${euro(jetzt)}).`,
          'Wirtschaftlichkeitsgebot (§ 556 Abs. 3 Satz 1 BGB): Steigerungen sollten erklärbar sein, z. B. durch neue Tarife oder Nachzahlungen.', { links: [{ text: `„${k.bezeichnung}“`, ziel: { konto: k.id } }] });
      }
      if (vorher > 0 && jetzt === 0) add('warnung', `Für „${k.bezeichnung}“ ist im Zeitraum nichts gebucht (Vorjahr ${euro(vorher)}) – fehlt eine Rechnung?`, null,
        { links: [{ text: `„${k.bezeichnung}“`, ziel: { konto: k.id } }] });
    }
    // Unpaid advance payments: the statement deducts the agreed payments; what is still open stays as arrears.
    for (const e of a.ergebnisse.filter((e) => e.segment.vertrag && e.segment.konto_id)) {
      const op = bh.offenePostenKonto(e.segment.konto_id);
      let vzOffen = 0;
      for (const x of op.offen.filter((x) => x.monat && `${x.monat}-01` >= von.slice(0, 7) + '-01' && x.monat <= bis.slice(0, 7))) {
        const vzTeil = x.teile.filter((t) => /Vorauszahlung/.test(t.text ?? '')).reduce((s, t) => s + t.betrag_ct, 0);
        vzOffen += Math.round(x.offen_ct * vzTeil / x.soll_ct);
      }
      if (vzOffen > 0) add('warnung', `${e.segment.vertrag.name}: Vorauszahlungen von rund ${euro(vzOffen)} aus dem Zeitraum sind noch nicht bezahlt.`,
        'Die Abrechnung zieht die vereinbarten Vorauszahlungen ab; der offene Betrag bleibt zusätzlich als Rückstand stehen und wird im Brief genannt. Grundsätzlich sind die tatsächlich gezahlten Vorauszahlungen anzusetzen (BGH VIII ZR 108/02) – in der Summe schuldet der Mieter dasselbe.',
        { links: [{ text: e.segment.vertrag.name, ziel: { vertrag: e.segment.vertrag.id, typ: 'miete' } }], vz_offen_ct: vzOffen, vertrag_id: e.segment.vertrag.id });
    }
    // Statement already saved for the same period.
    const frueher = get(`SELECT id, erstellt FROM abrechnungen WHERE objekt_id = ? AND typ = 'nk' AND von = ? AND bis = ? ORDER BY id DESC LIMIT 1`, objektId, von, bis);
    if (frueher) add('info', `Für diesen Zeitraum ist bereits eine Abrechnung gespeichert (${frueher.erstellt.slice(0, 10).split('-').reverse().join('.')}).`);
    const ordnung = { fehler: 0, warnung: 1, info: 2 };
    return { frist, punkte: punkte.sort((x, y) => ordnung[x.stufe] - ordnung[y.stufe]),
      fehler: punkte.filter((x) => x.stufe === 'fehler').length, warnungen: punkte.filter((x) => x.stufe === 'warnung').length };
  }

  // ---------- House-money statement (owners), § 28 WEG ----------
  function wegAbrechnung(objektId, von, bis) {
    const segmente = abschnitte(objektId, 'weg', von, bis);
    const rechner = schluesselRechner(objektId, von, bis);
    const meaKey = get(`SELECT id FROM umlageschluessel WHERE objekt_id = ? AND typ = 'mea' ORDER BY id LIMIT 1`, objektId)?.id;
    // Costs paid from the reserve are not allocated as house money; they show up in the reserve statement.
    const konten = kostenImZeitraum(objektId, von, bis, 'AND k.aus_ruecklage = 0');
    const posten = konten.map((k) => {
      const r = rechner(k.weg_schluessel_id ?? meaKey, segmente);
      return { label: k.bezeichnung, konto: k, gesamt_ct: k.betrag_ct, umlagefaehig: !!k.umlagefaehig, p35a: k.p35a,
        schluessel: r?.k?.bezeichnung ?? '–', einheit: r?.k?.einheit ?? '', gesamt_einheiten: r?.gesamt ?? 0, r };
    });
    const ergebnisse = segmente.filter((s) => s.vertrag).map((s) => {
      const anteile = posten.map((p) => {
        if (!p.r || !p.r.gesamt) return { ct: 0, einheiten: 0 };
        const w = p.r.wert(s);
        return { ct: Math.round(p.gesamt_ct * w / p.r.gesamt), einheiten: w };
      });
      const konto = bh.kontoVon('weg', s.vertrag.id);
      const [hgSoll, rlSoll] = konto ? vorauszahlungen(konto.id, ['hausgeld', 'ruecklage'], s.von, s.bis) : [0, 0];
      const kosten = anteile.reduce((sum, a) => sum + a.ct, 0);
      const umlagefaehig = anteile.reduce((sum, a, i) => sum + (posten[i].umlagefaehig ? a.ct : 0), 0);
      const p35a = { dienstleistung: 0, handwerker: 0 };
      anteile.forEach((a, i) => { if (posten[i].p35a) p35a[posten[i].p35a] += a.ct; });
      return {
        segment: { von: s.von, bis: s.bis, tage: s.tage, einheit: s.einheit, vertrag: s.vertrag, konto_id: konto?.id ?? null },
        anteile, kosten_ct: kosten, umlagefaehig_ct: umlagefaehig, hausgeld_soll_ct: hgSoll, ruecklage_soll_ct: rlSoll,
        // Abrechnungsspitze: costs minus the house-money advances due (reserve contributions are settled separately).
        ergebnis_ct: kosten - hgSoll, p35a,
      };
    });
    const summe = posten.reduce((s, p) => s + p.gesamt_ct, 0);
    // Shares of units without an owner in (part of) the period are not charged to anyone.
    const ohne = segmente.filter((s) => !s.vertrag).map((s) => ({ einheit: s.einheit.bezeichnung, von: s.von, bis: s.bis }));
    return { typ: 'weg', objekt_id: objektId, von, bis, posten: posten.map(({ r, ...p }) => p), ergebnisse, ohne_eigentuemer: ohne,
      nicht_verteilt_ct: summe - ergebnisse.reduce((s, e) => s + e.kosten_ct, 0),
      summe_ct: summe, ruecklage: ruecklagen(objektId, von, bis), vermoegen: vermoegen(objektId, bis) };
  }

  function ruecklagen(objektId, von, bis) {
    const summe = (sql, ...p) => get(sql, ...p).s ?? 0;
    const rlKonto = get(`SELECT id FROM konten WHERE objekt_id = ? AND klasse = 'ruecklage' ORDER BY nr LIMIT 1`, objektId);
    const zufuehrungBis = (d) => summe(`SELECT sum(b.betrag_ct) AS s FROM buchungen b JOIN konten e ON e.id = b.haben_id
      WHERE e.objekt_id = ? AND e.kategorie = 'ruecklage' AND e.klasse = 'einnahme' AND b.datum <= ?`, objektId, d);
    const entnahmeBis = (d) => summe(`SELECT sum(b.betrag_ct) AS s FROM buchungen b JOIN konten k ON k.id = b.soll_id
      WHERE k.objekt_id = ? AND k.aus_ruecklage = 1 AND b.datum <= ?`, objektId, d) -
      summe(`SELECT sum(b.betrag_ct) AS s FROM buchungen b JOIN konten k ON k.id = b.haben_id
      WHERE k.objekt_id = ? AND k.aus_ruecklage = 1 AND b.datum <= ?`, objektId, d);
    // Opening balance: credit balance of the reserve account (e.g. from a takeover booking).
    const eroeffnungBis = (d) => (rlKonto ? -bh.saldoBis(rlKonto.id, d) : 0);
    const stand = (d) => eroeffnungBis(d) + zufuehrungBis(d) - entnahmeBis(d);
    const vorher = vorTag(von);
    const zinsen = summe(`SELECT sum(b.betrag_ct) AS s FROM buchungen b JOIN konten e ON e.id = b.haben_id
      WHERE e.objekt_id = ? AND e.kategorie = 'zins' AND b.datum BETWEEN ? AND ?`, objektId, von, bis);
    const entnahmen = all(`SELECT b.datum, b.text, b.betrag_ct, k.bezeichnung FROM buchungen b JOIN konten k ON k.id = b.soll_id
      WHERE k.objekt_id = ? AND k.aus_ruecklage = 1 AND b.datum BETWEEN ? AND ? ORDER BY b.datum`, objektId, von, bis);
    const bankRl = get(`SELECT id FROM konten WHERE objekt_id = ? AND klasse = 'geld' AND kategorie = 'ruecklage'`, objektId);
    return {
      anfang_ct: stand(vorher),
      zufuehrung_soll_ct: zufuehrungBis(bis) - zufuehrungBis(vorher),
      entnahmen_ct: entnahmeBis(bis) - entnahmeBis(vorher),
      eroeffnung_ct: eroeffnungBis(bis) - eroeffnungBis(vorher),
      zinsen_ct: zinsen,
      ende_ct: stand(bis),
      entnahmen,
      bankkonto_ct: bankRl ? bh.saldoBis(bankRl.id, bis) : null,
    };
  }

  // Asset report (§ 28 Abs. 4 WEG): bank balances, reserve and receivables from owners at the reporting date.
  function vermoegen(objektId, stichtag) {
    const geld = all(`SELECT id, nr, bezeichnung FROM konten WHERE objekt_id = ? AND klasse = 'geld' ORDER BY nr`, objektId)
      .map((k) => ({ ...k, saldo_ct: bh.saldoBis(k.id, stichtag) }));
    const forderungen = all(`SELECT id, nr, bezeichnung FROM konten WHERE objekt_id = ? AND klasse = 'person' AND vertrag_typ = 'weg' ORDER BY nr`, objektId)
      .map((k) => ({ ...k, saldo_ct: bh.saldoBis(k.id, stichtag) })).filter((k) => k.saldo_ct !== 0);
    return { stichtag, geld, forderungen };
  }

  // ---------- Budget plan (Wirtschaftsplan) ----------
  function wirtschaftsplanVorschlag(objektId, jahr) {
    const von = `${jahr - 1}-01-01`, bis = `${jahr - 1}-12-31`;
    return kostenImZeitraum(objektId, von, bis, 'AND k.aus_ruecklage = 0')
      .concat(all(`SELECT k.*, 0 AS betrag_ct FROM konten k WHERE k.objekt_id = ? AND k.klasse = 'kosten' AND k.aus_ruecklage = 0 AND k.inaktiv = 0`, objektId))
      .filter((k, i, arr) => arr.findIndex((x) => x.id === k.id) === i)
      .sort((a, b) => a.nr - b.nr)
      .map((k) => ({ konto_id: k.id, nr: k.nr, bezeichnung: k.bezeichnung, vorjahr_ct: k.betrag_ct, weg_schluessel_id: k.weg_schluessel_id }));
  }

  // Distributes planned costs and the reserve contribution to the current owners → monthly house money.
  function wirtschaftsplanBerechnen(objektId, jahr, plan, ruecklageCt, ruecklageSchluesselId) {
    const von = `${jahr}-01-01`, bis = `${jahr}-12-31`;
    const segmente = abschnitte(objektId, 'weg', von, bis);
    const rechner = schluesselRechner(objektId, von, bis);
    const meaKey = get(`SELECT id FROM umlageschluessel WHERE objekt_id = ? AND typ = 'mea' ORDER BY id LIMIT 1`, objektId)?.id;
    // Plan per unit for the full year: every unit is treated as owned for 365 days.
    const einheiten = [...new Map(segmente.map((s) => [s.einheit.id, s])).values()].map((s) => ({ ...s, von, bis, tage: tage(von, bis) }));
    const posten = plan.filter((p) => p.betrag_ct).map((p) => {
      const k = get('SELECT * FROM konten WHERE id = ?', p.konto_id);
      const r = rechner(p.schluessel_id ?? k.weg_schluessel_id ?? meaKey, einheiten);
      return { konto_id: k.id, label: k.bezeichnung, gesamt_ct: p.betrag_ct, schluessel: r?.k?.bezeichnung ?? '–', r };
    });
    const rl = ruecklageCt ? rechner(ruecklageSchluesselId ?? meaKey, einheiten) : null;
    const zeilen = einheiten.map((s) => {
      const anteile = posten.map((p) => (p.r && p.r.gesamt ? Math.round(p.gesamt_ct * p.r.wert(s) / p.r.gesamt) : 0));
      const kosten = anteile.reduce((a, b) => a + b, 0);
      const rlAnteil = rl && rl.gesamt ? Math.round(ruecklageCt * rl.wert(s) / rl.gesamt) : 0;
      const eigentum = get(`SELECT g.*, ${PERSON_NAME} AS name FROM eigentum g JOIN personen p ON p.id = g.person_id
        WHERE g.einheit_id = ? AND g.beginn <= ? AND (g.ende IS NULL OR g.ende = '' OR g.ende >= ?) ORDER BY g.beginn DESC LIMIT 1`, s.einheit.id, bis, von);
      return {
        einheit: s.einheit, eigentum, anteile, kosten_ct: kosten, ruecklage_ct: rlAnteil,
        // Monthly amounts rounded up to whole euros, costs and reserve each on their own so both stay covered.
        monat_hausgeld_ct: Math.ceil(kosten / 12 / 100) * 100 + Math.ceil(rlAnteil / 12 / 100) * 100,
        monat_ruecklage_ct: Math.ceil(rlAnteil / 12 / 100) * 100,
      };
    });
    return { jahr, posten: posten.map(({ r, ...p }) => p), ruecklage_ct: ruecklageCt, zeilen,
      summe_ct: posten.reduce((s, p) => s + p.gesamt_ct, 0) };
  }

  return {
    nkAbrechnung,
    wegAbrechnung,
    ruecklagen,
    vermoegen,
    wirtschaftsplanVorschlag,
    wirtschaftsplanBerechnen,
    co2Vermieteranteil,

    // Applies new monthly amounts as dated changes on the contracts.
    anpassungenAnwenden: (typ, gueltigAb, grund, liste) => tx(() => {
      const st = db.prepare(`INSERT INTO anpassungen (vertrag_typ, vertrag_id, gueltig_ab, grund, bk_vz_ct, hk_vz_ct, hausgeld_ct, ruecklage_ct, kaltmiete_ct)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (vertrag_typ, vertrag_id, gueltig_ab) DO UPDATE SET grund = excluded.grund,
          bk_vz_ct = coalesce(excluded.bk_vz_ct, bk_vz_ct), hk_vz_ct = coalesce(excluded.hk_vz_ct, hk_vz_ct),
          hausgeld_ct = coalesce(excluded.hausgeld_ct, hausgeld_ct), ruecklage_ct = coalesce(excluded.ruecklage_ct, ruecklage_ct),
          kaltmiete_ct = coalesce(excluded.kaltmiete_ct, kaltmiete_ct)`);
      for (const a of liste) st.run(typ, a.vertrag_id, gueltigAb, grund, a.bk_vz_ct ?? null, a.hk_vz_ct ?? null,
        a.hausgeld_ct ?? null, a.ruecklage_ct ?? null, a.kaltmiete_ct ?? null);
      return liste.length;
    }),

    // Posts statement results to the contract accounts: arrears as a charge, credits as a credit note.
    abrechnungBuchen: (objektId, kategorie, datum, text, liste) => tx(() => {
      const gegen = get(`SELECT id FROM konten WHERE objekt_id = ? AND klasse = 'einnahme' AND kategorie = ? ORDER BY nr LIMIT 1`, objektId, kategorie);
      if (!gegen) throw new Error('Das Ergebniskonto der Abrechnung fehlt im Kontenplan.');
      const st = db.prepare(`INSERT INTO buchungen (objekt_id, datum, text, betrag_ct, soll_id, haben_id, art) VALUES (?, ?, ?, ?, ?, ?, 'abrechnung')`);
      let n = 0;
      for (const e of liste) {
        if (!e.konto_id || !e.ergebnis_ct) continue;
        if (e.ergebnis_ct > 0) st.run(objektId, datum, `${text} Nachzahlung`, e.ergebnis_ct, e.konto_id, gegen.id);
        else st.run(objektId, datum, `${text} Guthaben`, -e.ergebnis_ct, gegen.id, e.konto_id);
        // VAT on the result of a commercial tenant goes to the VAT account.
        if (e.ust_ct) {
          const ust = get(`SELECT id FROM konten WHERE objekt_id = ? AND klasse = 'steuer' AND kategorie = ?`, objektId, e.ust_satz === 7 ? 'ust7' : 'ust19');
          if (!ust) throw new Error('Das Umsatzsteuerkonto fehlt im Kontenplan.');
          if (e.ust_ct > 0) st.run(objektId, datum, `${text} USt ${e.ust_satz} %`, e.ust_ct, e.konto_id, ust.id);
          else st.run(objektId, datum, `${text} USt ${e.ust_satz} %`, -e.ust_ct, ust.id, e.konto_id);
        }
        n++;
      }
      return n;
    }),

    // Special levy: a total amount split by key and charged to the current owners.
    sonderumlage: (objektId, { betrag_ct, schluessel_id, datum, text }) => tx(() => {
      const segmente = abschnitte(objektId, 'weg', datum, datum).filter((s) => s.vertrag);
      const r = schluesselRechner(objektId, datum, datum)(schluessel_id, segmente);
      if (!r || !r.gesamt) throw new Error('Der Schlüssel hat keine Werte.');
      const ertrag = get(`SELECT id FROM konten WHERE objekt_id = ? AND klasse = 'einnahme' AND kategorie = 'sonderumlage' ORDER BY nr LIMIT 1`, objektId);
      const st = db.prepare(`INSERT INTO buchungen (objekt_id, datum, text, betrag_ct, soll_id, haben_id, art) VALUES (?, ?, ?, ?, ?, ?, 'soll')`);
      const out = [];
      for (const s of segmente) {
        const konto = bh.kontoVon('weg', s.vertrag.id);
        const ct = Math.round(betrag_ct * r.wert(s) / r.gesamt);
        if (konto && ct > 0) {
          st.run(objektId, datum, text, ct, konto.id, ertrag.id);
          out.push({ name: s.vertrag.name, einheit: s.einheit.bezeichnung, betrag_ct: ct });
        }
      }
      return out;
    }),

    nkPruefung,
    abrechnungen: (objektId, typ) => all(`SELECT id, typ, von, bis, titel, erstellt, gebucht FROM abrechnungen
      WHERE objekt_id = ? AND (?2 IS NULL OR typ = ?2) ORDER BY erstellt DESC`, objektId, typ ?? null),
    abrechnungLaden: (id) => {
      const a = get('SELECT * FROM abrechnungen WHERE id = ?', id);
      return a ? { ...a, daten: JSON.parse(a.daten) } : null;
    },
    abrechnungSpeichern: (objektId, typ, von, bis, titel, daten) =>
      Number(db.prepare('INSERT INTO abrechnungen (objekt_id, typ, von, bis, titel, daten) VALUES (?, ?, ?, ?, ?, ?)')
        .run(objektId, typ, von, bis, titel, JSON.stringify(daten)).lastInsertRowid),
    abrechnungGebucht: (id) => db.prepare('UPDATE abrechnungen SET gebucht = 1 WHERE id = ?').run(id),
  };
};

function vorTag(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function nachTag(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
