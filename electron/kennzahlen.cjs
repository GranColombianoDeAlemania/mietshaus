// Key figures for the cockpit and the tenant, unit and house pages: payment behaviour, account history, occupancy,
// arrears by age, cash forecast, year comparison, rent increase radar, deadlines, costs by type and what the
// landlord's own flat costs. Amounts in cents; every figure comes from postings, contracts or meter readings.
const { tageZwischen, tageImMonat, einheitVonSql } = require('./buchhaltung.cjs');

const pad = (n) => String(n).padStart(2, '0');
const heute = () => new Date().toISOString().slice(0, 10);
const plusTage = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const vorTag = (iso) => plusTage(iso, -1);
const nachTag = (iso) => plusTage(iso, 1);
// Same day n years later (28 February when 29 February does not exist).
const plusJahre = (iso, n) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${y + n}-${pad(m)}-${pad(Math.min(d, new Date(Date.UTC(y + n, m, 0)).getUTCDate()))}`;
};
const monatPlus = (monat, n) => new Date(Date.UTC(Number(monat.slice(0, 4)), Number(monat.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const monatsEnde = (monat) => `${monat}-${pad(tageImMonat(monat))}`;
const maxD = (a, b) => (a > b ? a : b);
const minD = (a, b) => (a < b ? a : b);
const euro = (ct) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format((ct ?? 0) / 100);
const datumDe = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '');
const prozentDe = (x, d = 1) => x.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const vertragTab = (typ) => (typ === 'weg' ? 'eigentum' : 'mietverhaeltnisse');
const artenFuer = (modus) => (modus === 'weg' ? ['weg', 'gemischt'] : ['miete', 'gemischt']);
// Full years between two dates (as for notice periods, § 573c BGB).
const volleJahre = (von, bis) => {
  const [ay, am, ad] = von.split('-').map(Number), [by, bm, bd] = bis.split('-').map(Number);
  return by - ay - (bm < am || (bm === am && bd < ad) ? 1 : 0);
};
const volleMonate = (von, bis) => {
  const [ay, am, ad] = von.split('-').map(Number), [by, bm, bd] = bis.split('-').map(Number);
  return (by - ay) * 12 + (bm - am) - (bd < ad ? 1 : 0);
};

// Cost categories that come back every year (operating costs, administration, bank fees, house money).
const WIEDERKEHREND = (kat) => /^bk\d/.test(kat ?? '') || ['kabel_tv', 'verwaltung', 'bank', 'hausgeld_weg'].includes(kat);
// Cost groups for the ring chart.
const KOSTENGRUPPEN = [
  ['Grundsteuer', (k) => k === 'bk01'],
  ['Wasser & Abwasser', (k) => k === 'bk02' || k === 'bk03'],
  ['Heizung & Warmwasser', (k) => ['bk04', 'bk05', 'bk06'].includes(k)],
  ['Versicherungen', (k) => k === 'bk13'],
  ['Müll & Reinigung', (k) => k === 'bk08' || k === 'bk09'],
  ['Hauswart & Garten', (k) => k === 'bk10' || k === 'bk14'],
  ['Strom & Aufzug', (k) => k === 'bk11' || k === 'bk07'],
  ['Instandhaltung', (k) => k === 'instandhaltung'],
  ['Verwaltung', (k) => k === 'verwaltung'],
  ['Übrige Kosten', () => true],
];
const ZAEHLER = { kaltwasser: 'Kaltwasser', warmwasser: 'Warmwasser', waerme: 'Wärme', heizkostenverteiler: 'Heizkostenverteiler', strom: 'Strom', gas: 'Gas', sonstig: 'Sonstiger Zähler' };
const GRUND = { index: 'Indexmiete', staffel: 'Staffelmiete', erhoehung: 'Mieterhöhung', modernisierung: 'Modernisierungszuschlag', nk_anpassung: 'Neue Vorauszahlungen', manuell: 'Mietänderung' };

module.exports = function kennzahlen({ all, get, PERSON_NAME, bh, aw, ab, vw, dl }) {
  const objekteFuer = (modus) => all('SELECT * FROM objekte WHERE art IN (?, ?) ORDER BY bezeichnung', ...artenFuer(modus));
  const idListe = (objekte) => (objekte.length ? objekte.map((o) => Number(o.id)).join(',') : '-1');
  const vertragName = (typ, id) => get(`SELECT ${PERSON_NAME} AS name, e.bezeichnung AS einheit, e.id AS einheit_id, e.objekt_id FROM ${vertragTab(typ)} v
    JOIN personen p ON p.id = v.person_id JOIN einheiten e ON e.id = v.einheit_id WHERE v.id = ?`, id);
  const rueckstandAm = (kontoId, d) => {
    const op = bh.offenePostenKonto(kontoId, d);
    return op.offen.filter((x) => x.verzug >= 1).reduce((s, x) => s + x.offen_ct, 0) - op.guthaben_ct;
  };
  const monatlich = (typ, vertragId, d) => {
    const b = bh.betraege(typ, vertragId, d);
    return typ === 'weg' ? b.hausgeld_ct ?? 0 : (b.kaltmiete_ct ?? 0) + (b.bk_vz_ct ?? 0) + (b.hk_vz_ct ?? 0) + (b.sonstiges_ct ?? 0);
  };

  // ---------- payment behaviour ----------
  // Every charge of an account with the day it was settled. Payments settle the oldest charges first (as in the open
  // items): a charge is settled on the day the payments – credits less money paid back – cover it and all older charges
  // for good. Cancelled postings and their cancellations are left out.
  function zahlungsverlauf(kontoId, stichtag) {
    const lasten = all(`SELECT b.id, b.datum, b.monat, b.betrag_ct FROM buchungen b JOIN konten g ON g.id = b.haben_id
      WHERE b.soll_id = ?1 AND g.klasse <> 'geld' AND b.datum <= ?2 AND b.art <> 'storno'
        AND NOT EXISTS (SELECT 1 FROM buchungen x WHERE x.storno_von = b.id) ORDER BY b.datum, b.id`, kontoId, stichtag);
    const ereignisse = all(`SELECT b.datum, CASE WHEN b.haben_id = ?1 THEN b.betrag_ct ELSE -b.betrag_ct END AS ct FROM buchungen b
      WHERE (b.haben_id = ?1 OR (b.soll_id = ?1 AND b.haben_id IN (SELECT id FROM konten WHERE klasse = 'geld'))) AND b.datum <= ?2
        AND b.art <> 'storno' AND NOT EXISTS (SELECT 1 FROM buchungen x WHERE x.storno_von = b.id) ORDER BY b.datum, b.id`, kontoId, stichtag);
    const posten = [];
    for (const l of lasten) {
      const key = l.monat ? `${l.datum}|${l.monat}` : `${l.datum}|#${l.id}`;
      let p = posten.at(-1)?.key === key ? posten.at(-1) : null;
      if (!p) posten.push((p = { key, datum: l.datum, monat: l.monat, soll_ct: 0 }));
      p.soll_ct += l.betrag_ct;
    }
    // Running total of payments at the end of each day.
    const tage = [];
    let lauf = 0;
    for (const e of ereignisse) {
      lauf += e.ct;
      if (tage.at(-1)?.datum === e.datum) tage.at(-1).ct = lauf;
      else tage.push({ datum: e.datum, ct: lauf });
    }
    const beglichenAm = (schwelle) => {
      for (let i = tage.length - 1; i >= 0; i--) if (tage[i].ct >= schwelle && (i ? tage[i - 1].ct : 0) < schwelle) return tage[i].datum;
      return null;
    };
    let schwelle = 0;
    for (const p of posten) {
      p.bezahlt_ct = Math.max(0, Math.min(p.soll_ct, lauf - schwelle));
      schwelle += p.soll_ct;
      p.beglichen = p.bezahlt_ct >= p.soll_ct ? beglichenAm(schwelle) : null;
    }
    return posten;
  }

  // Monthly charges of the last months: on time, late (days), open or not due yet; and a score from 0 to 100.
  // Every month due counts: on time 100 points, late 4 points less per day (0 from 25 days), open 0. From the average,
  // 15 points come off per month still open, 10 per reminder and 10 per returned direct debit in the period.
  const PUNKTE_JE_TAG = 4;
  function zahlungsverhalten(typ, vertragId, { monate = 24, stichtag = heute() } = {}) {
    const k = bh.kontoVon(typ, vertragId);
    if (!k) return null;
    const posten = zahlungsverlauf(k.id, stichtag);
    const vonMonat = monatPlus(stichtag.slice(0, 7), -(monate - 1));
    const liste = [];
    for (let i = 0; i < monate; i++) {
      const m = monatPlus(vonMonat, i);
      const ps = posten.filter((p) => p.monat === m);
      if (!ps.length) { liste.push({ monat: m, status: 'keine' }); continue; }
      const datum = ps.map((p) => p.datum).sort()[0];
      const soll = ps.reduce((s, p) => s + p.soll_ct, 0), bezahlt = ps.reduce((s, p) => s + p.bezahlt_ct, 0);
      const offen = ps.some((p) => !p.beglichen);
      const am = offen ? null : ps.map((p) => p.beglichen).sort().at(-1);
      // Not late yet on its due date; a charge paid before it falls due counts once it is due.
      const x = { monat: m, datum, beglichen: am, soll_ct: soll, bezahlt_ct: bezahlt, tage: 0 };
      if (datum > stichtag || (offen && datum === stichtag)) x.status = 'kuenftig';
      else if (offen) { x.status = 'offen'; x.tage = tageZwischen(datum, stichtag); }
      else if (am <= datum) x.status = 'puenktlich';
      else { x.status = 'verspaetet'; x.tage = tageZwischen(datum, am); }
      liste.push(x);
    }
    const faellig = liste.filter((x) => ['puenktlich', 'verspaetet', 'offen'].includes(x.status));
    const puenktlich = faellig.filter((x) => x.status === 'puenktlich').length;
    const spaet = faellig.filter((x) => x.status === 'verspaetet');
    const offen = faellig.filter((x) => x.status === 'offen').length;
    const schnitt = spaet.length ? spaet.reduce((s, x) => s + x.tage, 0) / spaet.length : 0;
    const vonDatum = `${vonMonat}-01`;
    const mahnungen = get('SELECT count(*) AS n FROM mahnungen WHERE konto_id = ? AND datum BETWEEN ? AND ?', k.id, vonDatum, stichtag).n;
    const ruecklastschriften = get(`SELECT count(*) AS n FROM buchungen b JOIN konten g ON g.id = b.haben_id WHERE b.soll_id = ? AND g.klasse = 'geld'
      AND lower(coalesce(b.text, '')) GLOB '*r*cklastschrift*' AND b.datum BETWEEN ? AND ?`, k.id, vonDatum, stichtag).n;
    for (const x of faellig) x.punkte = x.status === 'puenktlich' ? 100 : x.status === 'verspaetet' ? Math.max(0, 100 - PUNKTE_JE_TAG * x.tage) : 0;
    const schnittPunkte = faellig.length ? faellig.reduce((s, x) => s + x.punkte, 0) / faellig.length : 0;
    const score = faellig.length ? Math.max(0, Math.min(100, Math.round(schnittPunkte - 15 * offen - 10 * mahnungen - 10 * ruecklastschriften))) : null;
    return {
      score, label: score == null ? 'noch nichts fällig' : score >= 85 ? 'zuverlässig' : score >= 70 ? 'meist pünktlich' : score >= 60 ? 'unregelmäßig' : 'kritisch',
      monate: liste, faellig: faellig.length, puenktlich, verspaetet: spaet.length, offen, schnitt_tage: Math.round(schnitt * 10) / 10,
      schnitt_punkte: Math.round(schnittPunkte * 10) / 10,
      mahnungen, ruecklastschriften, von: vonDatum, bis: stichtag, konto_id: k.id,
    };
  }

  // Arrears (positive) or credit (negative) at the end of each month, and today.
  function kontoverlauf(typ, vertragId, { monate = 24, stichtag = heute() } = {}) {
    const k = bh.kontoVon(typ, vertragId);
    const v = get(`SELECT beginn FROM ${vertragTab(typ)} WHERE id = ?`, vertragId);
    if (!k || !v) return [];
    const punkte = [];
    for (let i = monate - 1; i >= 1; i--) {
      const d = monatsEnde(monatPlus(stichtag.slice(0, 7), -i));
      if (d >= v.beginn) punkte.push({ datum: d, ct: rueckstandAm(k.id, d) });
    }
    punkte.push({ datum: stichtag, ct: rueckstandAm(k.id, stichtag) });
    return punkte;
  }

  // ---------- deposit ----------
  function kaution(vertragId, stichtag = heute()) {
    const v = get('SELECT kaution_ct FROM mietverhaeltnisse WHERE id = ?', vertragId);
    const k = get('SELECT * FROM kautionen WHERE vertrag_id = ?', vertragId);
    const bew = k ? all('SELECT * FROM kautionsbewegungen WHERE kaution_id = ? AND datum <= ? ORDER BY datum', k.id, stichtag) : [];
    const bestand = bew.reduce((s, b) => s + (['einzahlung', 'zinsen'].includes(b.art) ? b.betrag_ct : -b.betrag_ct), 0);
    const vorjahr = Number(stichtag.slice(0, 4)) - 1;
    return {
      vereinbart_ct: v?.kaution_ct ?? 0, bestand_ct: bestand, raten: bew.filter((b) => b.art === 'einzahlung').length,
      bank: k?.bank ?? null, art: k?.art ?? null, vorjahr,
      zinsen_vorjahr_ct: bew.filter((b) => b.art === 'zinsen' && b.datum.startsWith(String(vorjahr))).reduce((s, b) => s + b.betrag_ct, 0),
      quote: v?.kaution_ct ? Math.min(1, Math.max(0, bestand / v.kaution_ct)) : null,
    };
  }

  // ---------- rent per m² against the house and the rent index ----------
  // The rent index applies to flats; other units only compare with their own values or the house.
  function vergleich(einheitId, kaltCt, stichtag = heute()) {
    const e = get('SELECT * FROM einheiten WHERE id = ?', einheitId);
    if (!e) return null;
    const vgl = aw.vergleichsmieteQm(einheitId, stichtag);
    const spiegel = (e.art ?? 'Wohnung') === 'Wohnung' || e.vergleichsmiete_ct || e.mietspiegel_von_ct;
    return {
      flaeche: e.wohnflaeche ?? null, kalt_ct: kaltCt ?? null, art: e.art ?? 'Wohnung',
      qm_ct: kaltCt && e.wohnflaeche ? Math.round(kaltCt / e.wohnflaeche) : null,
      haus_ct: vgl?.haus_ct ?? null, von_ct: spiegel ? vgl?.von ?? null : null, bis_ct: spiegel ? vgl?.bis ?? null : null,
      mittel_ct: spiegel && vgl && vgl.quelle !== 'haus' ? vgl.ct : null, quelle: spiegel ? vgl?.quelle ?? null : 'haus',
    };
  }

  // ---------- possible rent increases ----------
  // Up to the comparative rent (§ 558, flats only, without graduated or indexed rent), indexed rent (§ 557b) and the
  // next step of a graduated rent. plus_ct null: the date is known, the amount needs a comparative rent.
  function erhoehungen(v, stichtag = heute()) {
    const out = [];
    if (v.ende) return out;
    const e = get('SELECT * FROM einheiten WHERE id = ?', v.einheit_id);
    const modell = get('SELECT * FROM mietmodelle WHERE vertrag_id = ?', v.id);
    if (modell?.art === 'index') {
      try {
        const r = vw.indexBerechnung(v.id, null, plusTage(stichtag, 3));
        if (r.neue_miete_ct > r.alte_miete_ct) out.push({ art: 'index', ab: r.frueheste_wirkung, alt_ct: r.alte_miete_ct, neu_ct: r.neue_miete_ct, plus_ct: r.neue_miete_ct - r.alte_miete_ct,
          text: `Indexmiete (${r.basis_monat} → ${r.neu_monat}: +${prozentDe(r.aenderung_prozent)} %)`,
          notiz: `Index ${r.neu_monat}: ${r.neu_wert} (Basis ${r.basis_monat}: ${r.basis_wert})` });
      } catch { /* index values missing */ }
      return out;
    }
    if (modell?.art === 'staffel') {
      const n = get(`SELECT * FROM anpassungen WHERE vertrag_typ = 'miete' AND vertrag_id = ? AND grund = 'staffel' AND kaltmiete_ct IS NOT NULL AND gueltig_ab > ?
        ORDER BY gueltig_ab LIMIT 1`, v.id, stichtag);
      if (n) {
        const alt = bh.betraege('miete', v.id, vorTag(n.gueltig_ab)).kaltmiete_ct ?? 0;
        if (n.kaltmiete_ct > alt) out.push({ art: 'staffel', ab: n.gueltig_ab, alt_ct: alt, neu_ct: n.kaltmiete_ct, plus_ct: n.kaltmiete_ct - alt, text: 'nächste Staffel', automatisch: true });
      }
      return out;
    }
    if ((e?.art ?? 'Wohnung') !== 'Wohnung') return out;
    // Earliest effect: receipt in three days; one year since the last increase before the request, 15 months before
    // the effect, and the start of the third month after receipt (§§ 558, 558b BGB).
    const zugang = plusTage(stichtag, 3);
    const p0 = vw.mieterhoehungPruefen(v.id, 0, monatPlus(zugang.slice(0, 7), 3) + '-01', null, zugang);
    const zugangMoeglich = maxD(zugang, p0.verlangen_ab);
    const ab = maxD(p0.frueheste_wirkung, monatPlus(zugangMoeglich.slice(0, 7), 3) + '-01');
    const vgl = aw.vergleichsmieteQm(v.einheit_id, stichtag);
    const alt = bh.betraege('miete', v.id, vorTag(ab)).kaltmiete_ct ?? 0;
    const x = { art: '558', ab, alt_ct: alt, letzte: p0.letzte_aenderung, zugang: zugangMoeglich, plus_ct: null, neu_ct: null };
    if (vgl?.ct && vgl.quelle !== 'haus' && e.wohnflaeche) {
      const ziel = Math.round(vgl.ct * e.wohnflaeche);
      const p = vw.mieterhoehungPruefen(v.id, ziel, ab, null, zugangMoeglich);
      x.neu_ct = Math.min(ziel, p.grenze_ct);
      x.plus_ct = x.neu_ct - p.alt_ct;
      x.alt_ct = p.alt_ct;
      x.gekappt = ziel > p.grenze_ct;
      x.ziel_ct = ziel;
      x.kappung = p.kappung;
    }
    x.text = x.plus_ct == null ? 'Mieterhöhung bis zur Vergleichsmiete (§ 558)' : x.gekappt ? `§ 558 bis zur Kappungsgrenze (${x.kappung} %)` : '§ 558 bis zur Vergleichsmiete';
    out.push(x);
    return out;
  }

  // ---------- tenancy facts ----------
  function mietverhaeltnisFakten(v, stichtag = heute()) {
    const bis = v.ende && v.ende < stichtag ? v.ende : stichtag;
    const monate = Math.max(0, volleMonate(v.beginn, nachTag(bis)));
    const k = bh.kontoVon('miete', v.id);
    const gezahlt = k ? get(`SELECT coalesce(sum(CASE WHEN b.haben_id = ?1 THEN b.betrag_ct ELSE -b.betrag_ct END), 0) AS s FROM buchungen b
      WHERE ((b.haben_id = ?1 AND b.soll_id IN (SELECT id FROM konten WHERE klasse = 'geld')) OR (b.soll_id = ?1 AND b.haben_id IN (SELECT id FROM konten WHERE klasse = 'geld')))
        AND b.datum <= ?2`, k.id, stichtag).s : 0;
    const start = v.kaltmiete_ct ?? 0;
    const jetzt = bh.betraege('miete', v.id, bis).kaltmiete_ct ?? 0;
    const jahre = v.beginn <= stichtag ? volleJahre(v.beginn, stichtag) : 0;
    const schritte = [];
    for (const x of erhoehungen(v, stichtag)) {
      schritte.push({ datum: x.ab, art: x.art, plus_ct: x.plus_ct, text: x.art === '558'
        ? (x.plus_ct == null ? `Mieterhöhung § 558 möglich – 15 Monate seit der letzten Änderung (${datumDe(x.letzte)}). Vergleichsmiete beim Objekt eintragen, dann steht hier der Betrag.`
          : x.plus_ct > 0 ? `Mieterhöhung § 558 möglich: +${euro(x.plus_ct)} ${x.gekappt ? `(Kappungsgrenze ${x.kappung} %)` : 'bis zur Vergleichsmiete'}, letzte Änderung ${datumDe(x.letzte)}`
            : 'Die Miete liegt schon bei oder über der Vergleichsmiete.')
        : x.art === 'index' ? `Indexanpassung möglich: +${euro(x.plus_ct)}` : `Nächste Staffel: +${euro(x.plus_ct)}` });
    }
    if (!v.ende && jahre < 8) {
      const n = jahre < 5 ? 5 : 8;
      schritte.push({ datum: plusJahre(v.beginn, n), art: 'frist', text: `Kündigungsfrist des Vermieters steigt nach ${n} Jahren auf ${n === 5 ? 6 : 9} Monate (§ 573c BGB)` });
    }
    if (v.ende && v.ende >= stichtag) schritte.push({ datum: v.ende, art: 'ende', text: 'Mietende – Übergabe, Zählerstände, Kautionsabrechnung' });
    const kau = kaution(v.id, stichtag);
    if (kau.vereinbart_ct > kau.bestand_ct && v.beginn <= stichtag) schritte.push({ datum: null, art: 'kaution', text: `Kaution: noch ${euro(kau.vereinbart_ct - kau.bestand_ct)} offen` });
    schritte.sort((a, b) => (a.datum ?? '9').localeCompare(b.datum ?? '9'));
    return {
      jahre: Math.floor(monate / 12), monate: monate % 12, gezahlt_ct: gezahlt, kalt_start_ct: start, kalt_jetzt_ct: jetzt,
      kalt_aenderung: start ? (jetzt / start - 1) * 100 : null, frist_monate: jahre >= 8 ? 9 : jahre >= 5 ? 6 : 3, schritte,
    };
  }

  // Everything for the tenant profile of one tenancy.
  function mieterKennzahlen(vertragId, stichtag = heute()) {
    const v = get('SELECT * FROM mietverhaeltnisse WHERE id = ?', vertragId);
    if (!v) return null;
    const bis = v.ende && v.ende < stichtag ? v.ende : v.beginn > stichtag ? v.beginn : stichtag;
    return {
      vertrag_id: v.id, einheit_id: v.einheit_id,
      zahlung: zahlungsverhalten('miete', v.id, { stichtag }),
      verlauf: kontoverlauf('miete', v.id, { stichtag }),
      fakten: mietverhaeltnisFakten(v, stichtag),
      vergleich: vergleich(v.einheit_id, bh.betraege('miete', v.id, bis).kaltmiete_ct, stichtag),
      kaution: kaution(v.id, stichtag),
    };
  }

  // ---------- occupancy ----------
  // Use of a unit over a period: tenancies, then self-use (the landlord's, or an owner's who lives there) in the gaps,
  // and vacancy for what is left.
  function belegung(einheitId, von, bis) {
    const vs = all(`SELECT m.*, ${PERSON_NAME} AS name FROM mietverhaeltnisse m JOIN personen p ON p.id = m.person_id WHERE m.einheit_id = ?
      AND m.beginn <= ? AND (m.ende IS NULL OR m.ende = '' OR m.ende >= ?) ORDER BY m.beginn`, einheitId, bis, von);
    const selbst = [
      ...all(`SELECT beginn, ende, personen, 'selbst' AS quelle FROM selbstnutzung WHERE einheit_id = ? AND beginn <= ? AND (ende IS NULL OR ende = '' OR ende >= ?)`, einheitId, bis, von),
      ...all(`SELECT beginn, ende, NULL AS personen, 'eigentuemer' AS quelle FROM eigentum WHERE einheit_id = ? AND selbstnutzer = 1 AND beginn <= ? AND (ende IS NULL OR ende = '' OR ende >= ?)`, einheitId, bis, von),
    ].sort((a, b) => (a.beginn < b.beginn ? -1 : 1));
    const out = [];
    const luecke = (a, b) => {
      let c = a;
      for (const s of selbst) {
        const sa = maxD(s.beginn, c), sb = minD(s.ende || '9999-12-31', b);
        if (sa > sb) continue;
        if (sa > c) out.push({ art: 'leer', von: c, bis: vorTag(sa), tage: tageZwischen(c, sa) });
        out.push({ art: 'selbst', quelle: s.quelle, von: sa, bis: sb, tage: tageZwischen(sa, sb) + 1 });
        c = nachTag(sb);
      }
      if (c <= b) out.push({ art: 'leer', von: c, bis: b, tage: tageZwischen(c, b) + 1 });
    };
    let c = von;
    for (const v of vs) {
      const a = maxD(maxD(v.beginn, von), c), b = minD(v.ende || '9999-12-31', bis);
      if (a > b) continue;
      if (a > c) luecke(c, vorTag(a));
      out.push({ art: 'miete', vertrag_id: v.id, name: v.name, von: a, bis: b, tage: tageZwischen(a, b) + 1 });
      c = nachTag(b);
    }
    if (c <= bis) luecke(c, bis);
    return out;
  }

  // Cold rent a vacancy loses per month: the rent before it, otherwise the rent after it, the offer, the comparative rent
  // or the house average for the area.
  function referenzmiete(einheitId, von, bis) {
    const vorher = get(`SELECT id, ende FROM mietverhaeltnisse WHERE einheit_id = ? AND ende IS NOT NULL AND ende <> '' AND ende < ? ORDER BY ende DESC LIMIT 1`, einheitId, von);
    if (vorher) return bh.betraege('miete', vorher.id, vorher.ende).kaltmiete_ct ?? 0;
    const nachher = get(`SELECT id, beginn FROM mietverhaeltnisse WHERE einheit_id = ? AND beginn > ? ORDER BY beginn LIMIT 1`, einheitId, bis);
    if (nachher) return bh.betraege('miete', nachher.id, nachher.beginn).kaltmiete_ct ?? 0;
    const angebot = get('SELECT kaltmiete_ct FROM angebote WHERE einheit_id = ?', einheitId)?.kaltmiete_ct;
    if (angebot) return angebot;
    const e = get('SELECT wohnflaeche FROM einheiten WHERE id = ?', einheitId);
    const vgl = aw.vergleichsmieteQm(einheitId);
    return vgl?.ct && e?.wohnflaeche ? Math.round(vgl.ct * e.wohnflaeche) : 0;
  }
  const entgangen = (monatCt, tage) => Math.round(monatCt * 12 * tage / 365);

  // ---------- the unit page ----------
  function einheitKennzahlen(einheitId, stichtag = heute()) {
    const e = get('SELECT e.*, o.art AS objekt_art FROM einheiten e JOIN objekte o ON o.id = e.objekt_id WHERE e.id = ?', einheitId);
    if (!e) return null;
    const jahr = Number(stichtag.slice(0, 4));
    // E1: occupancy since the first tenancy or self-use.
    const erst = get(`SELECT min(d) AS d FROM (SELECT min(beginn) AS d FROM mietverhaeltnisse WHERE einheit_id = ?1 UNION ALL SELECT min(beginn) FROM selbstnutzung WHERE einheit_id = ?1
      UNION ALL SELECT min(beginn) FROM eigentum WHERE einheit_id = ?1 AND selbstnutzer = 1)`, einheitId).d;
    const segmente = erst && erst <= stichtag ? belegung(einheitId, erst, stichtag) : [];
    const gesamt = segmente.reduce((s, x) => s + x.tage, 0);
    const belegt = segmente.filter((x) => x.art !== 'leer').reduce((s, x) => s + x.tage, 0);
    const jahrVon = `${jahr}-01-01`;
    const leerJahr = segmente.filter((x) => x.art === 'leer').reduce((s, x) => s + Math.max(0, tageZwischen(maxD(x.von, jahrVon), x.bis) + 1), 0);
    for (const x of segmente.filter((s) => s.art === 'leer')) x.entgangen_ct = entgangen(referenzmiete(einheitId, x.von, x.bis), x.tage);
    const mieten = segmente.filter((x) => x.art === 'miete');
    const belegungInfo = { seit: erst ?? null, bis: stichtag, segmente, quote: gesamt ? belegt / gesamt : null, wechsel: Math.max(0, mieten.length - 1), leer_jahr: leerJahr, jahr };

    // E2: cold rent charged and paid, and costs booked for the unit, per year.
    const konten = all('SELECT id FROM mietverhaeltnisse WHERE einheit_id = ?', einheitId).map((v) => bh.kontoVon('miete', v.id)).filter(Boolean);
    const ertrag = [];
    for (let j = jahr - 3; j <= jahr; j++) {
      const von = `${j}-01-01`, bis = `${j}-12-31`;
      let soll = 0, ist = 0;
      for (const k of konten) {
        soll += get(`SELECT coalesce(sum(CASE WHEN b.soll_id = ?1 THEN b.betrag_ct ELSE -b.betrag_ct END), 0) AS s FROM buchungen b JOIN konten x ON x.id IN (b.soll_id, b.haben_id) AND x.id <> ?1
          WHERE (b.soll_id = ?1 OR b.haben_id = ?1) AND x.klasse = 'einnahme' AND x.kategorie IN ('miete', 'sonst') AND b.art IN ('soll', 'storno') AND b.datum BETWEEN ?2 AND ?3`, k.id, von, bis).s;
        const z = aw.zufluss(k.id, von, bis);
        ist += (z.miete ?? 0) + (z.sonst ?? 0);
      }
      const kosten = get(`SELECT coalesce(sum(CASE WHEN k.id = b.soll_id THEN b.betrag_ct ELSE -b.betrag_ct END), 0) AS s FROM buchungen b JOIN konten k ON k.id IN (b.soll_id, b.haben_id)
        WHERE k.objekt_id = ? AND k.klasse = 'kosten' AND b.datum BETWEEN ? AND ? AND ${einheitVonSql('b')} = ?`, e.objekt_id, von, bis, einheitId).s;
      if (soll || ist || kosten || ertrag.length) ertrag.push({ jahr: j, soll_ct: soll, ist_ct: ist, kosten_ct: kosten });
    }

    // E3: consumption per m² in the last full year against the house and the year before.
    const verbrauch = verbrauchEinheit(e, jahr - 1);

    // E4: the last change of tenant: vacancy, renovation and agent costs booked for the unit.
    const wechsel = mieterwechselKosten(e, segmente, stichtag);

    const aktuell = get(`SELECT id FROM mietverhaeltnisse WHERE einheit_id = ?1 AND beginn <= ?2 AND (ende IS NULL OR ende = '' OR ende >= ?2) ORDER BY beginn DESC LIMIT 1`, einheitId, stichtag);
    const angebot = get('SELECT kaltmiete_ct FROM angebote WHERE einheit_id = ? AND aktiv = 1', einheitId)?.kaltmiete_ct ?? null;
    return {
      einheit_id: einheitId, belegung: belegungInfo, ertrag, verbrauch, wechsel,
      vergleich: vergleich(einheitId, aktuell ? bh.betraege('miete', aktuell.id, stichtag).kaltmiete_ct : angebot, stichtag),
      vergleich_quelle: aktuell ? 'miete' : angebot ? 'angebot' : null,
      selbst: selbstKosten(einheitId, stichtag),
    };
  }

  // Consumption of one meter over a year; null when there is no reading within a month of either end.
  function zaehlerJahr(z, jahr) {
    const a = `${jahr - 1}-12-31`, b = `${jahr}-12-31`;
    if ((z.einbau && z.einbau > plusTage(a, 31)) || (z.ausbau && z.ausbau < plusTage(b, -31))) return null;
    const nah = (d) => get('SELECT 1 FROM zaehlerstaende WHERE zaehler_id = ? AND abs(julianday(datum) - julianday(?)) <= 31', z.id, d);
    return nah(a) && nah(b) ? bh.verbrauch(z.id, a, b) : null;
  }
  function verbrauchEinheit(e, jahr) {
    const zaehler = all(`SELECT z.*, x.wohnflaeche FROM zaehler z JOIN einheiten x ON x.id = z.einheit_id WHERE z.objekt_id = ?`, e.objekt_id);
    const arten = [...new Set(zaehler.filter((z) => z.einheit_id === e.id).map((z) => z.art))];
    return arten.map((art) => {
      const wert = (eid, j) => {
        const zs = zaehler.filter((z) => z.einheit_id === eid && z.art === art);
        const w = zs.map((z) => zaehlerJahr(z, j));
        return zs.length && w.every((x) => x != null) ? w.reduce((s, x) => s + x, 0) : null;
      };
      const jetzt = wert(e.id, jahr), vorher = wert(e.id, jahr - 1);
      // House: all units with a complete reading of this kind.
      let summe = 0, flaeche = 0;
      for (const eid of [...new Set(zaehler.filter((z) => z.art === art).map((z) => z.einheit_id))]) {
        const w = wert(eid, jahr);
        const f = zaehler.find((z) => z.einheit_id === eid)?.wohnflaeche ?? 0;
        if (w != null && f > 0) { summe += w; flaeche += f; }
      }
      const z0 = zaehler.find((z) => z.einheit_id === e.id && z.art === art);
      return {
        art, label: ZAEHLER[art] ?? art, einheit: z0?.einheit ?? '', jahr, wert: jetzt, vorjahr: vorher,
        qm: jetzt != null && e.wohnflaeche ? jetzt / e.wohnflaeche : null, haus_qm: flaeche ? summe / flaeche : null,
        aenderung: jetzt != null && vorher ? Math.round((jetzt / vorher - 1) * 1000) / 10 : null,
      };
    });
  }

  function mieterwechselKosten(e, segmente, stichtag) {
    const vs = all(`SELECT m.*, ${PERSON_NAME} AS name FROM mietverhaeltnisse m JOIN personen p ON p.id = m.person_id WHERE m.einheit_id = ? AND m.beginn <= ?
      ORDER BY m.beginn`, e.id, stichtag);
    const dauer = vs.map((v) => tageZwischen(v.beginn, minD(v.ende || stichtag, stichtag)) + 1);
    const schnitt = dauer.length ? dauer.reduce((s, x) => s + x, 0) / dauer.length / 365.25 : null;
    const kostenIm = (von, bis) => all(`SELECT b.datum, b.text, k.bezeichnung, CASE WHEN k.id = b.soll_id THEN b.betrag_ct ELSE -b.betrag_ct END AS ct FROM buchungen b
      JOIN konten k ON k.id IN (b.soll_id, b.haben_id) WHERE k.objekt_id = ? AND k.klasse = 'kosten' AND k.umlagefaehig = 0 AND k.kategorie <> 'zinsen'
      AND b.datum BETWEEN ? AND ? AND ${einheitVonSql('b')} = ? ORDER BY b.datum`, e.objekt_id, von, bis, e.id);
    const posten = (leerTage, leerCt, kosten) => {
      const makler = kosten.filter((k) => /makler/i.test(`${k.text ?? ''} ${k.bezeichnung}`)).reduce((s, k) => s + k.ct, 0);
      const rest = kosten.reduce((s, k) => s + k.ct, 0) - makler;
      return [
        { label: `Leerstand ${leerTage} Tage`, ct: leerCt },
        ...(rest ? [{ label: 'Renovierung und Reparaturen', ct: rest }] : []),
        ...(makler ? [{ label: 'Makler', ct: makler }] : []),
      ];
    };
    const letzte = segmente.at(-1);
    // Vacant now after a tenancy: what the vacancy has cost so far.
    if (letzte?.art === 'leer' && vs.length && vs.at(-1).ende && vs.at(-1).ende < letzte.von) {
      const leerCt = letzte.entgangen_ct ?? 0;
      const p = posten(letzte.tage, leerCt, kostenIm(plusTage(vs.at(-1).ende, -30), stichtag));
      return { laufend: true, von_name: vs.at(-1).name, seit: letzte.von, tage: letzte.tage, posten: p, summe_ct: p.reduce((s, x) => s + x.ct, 0), schnitt_jahre: schnitt };
    }
    if (vs.length < 2) return { laufend: false, posten: [], summe_ct: 0, schnitt_jahre: schnitt, keiner: true };
    const [alt, neu] = vs.slice(-2);
    if (!alt.ende) return { laufend: false, posten: [], summe_ct: 0, schnitt_jahre: schnitt, keiner: true };
    const leer = segmente.filter((x) => x.art === 'leer' && x.von > alt.ende && x.bis < neu.beginn);
    const leerTage = leer.reduce((s, x) => s + x.tage, 0);
    const p = posten(leerTage, leer.reduce((s, x) => s + (x.entgangen_ct ?? 0), 0), kostenIm(plusTage(alt.ende, -30), plusTage(neu.beginn, 60)));
    return { laufend: false, von_name: alt.name, nach_name: neu.name, ende: alt.ende, beginn: neu.beginn, tage: leerTage, posten: p,
      summe_ct: p.reduce((s, x) => s + x.ct, 0), schnitt_jahre: schnitt };
  }

  // ---------- what the own flat costs ----------
  // Per month: its share of the operating and heating costs of the last full year (as if self-used all year, with the
  // options of that year's statement), its share of the loan interest, and of maintenance over three years
  // (costs booked for the flat fully, those of the whole house by area). And what it would bring when let.
  function selbstKosten(einheitId, stichtag = heute()) {
    const s = get(`SELECT * FROM selbstnutzung WHERE einheit_id = ?1 AND beginn <= ?2 AND (ende IS NULL OR ende = '' OR ende >= ?2) ORDER BY beginn DESC LIMIT 1`, einheitId, stichtag);
    if (!s) return null;
    const e = get('SELECT * FROM einheiten WHERE id = ?', einheitId);
    const jahr = Number(stichtag.slice(0, 4)) - 1;
    const von = `${jahr}-01-01`, bis = `${jahr}-12-31`;
    const gesamtFlaeche = get('SELECT coalesce(sum(wohnflaeche), 0) AS f FROM einheiten WHERE objekt_id = ?', e.objekt_id).f;
    const flaechenAnteil = gesamtFlaeche ? (e.wohnflaeche ?? 0) / gesamtFlaeche : 0;
    const gespeichert = get(`SELECT daten FROM abrechnungen WHERE objekt_id = ? AND typ = 'nk' AND von = ? AND bis = ? ORDER BY id DESC LIMIT 1`, e.objekt_id, von, bis);
    const optionen = gespeichert ? JSON.parse(gespeichert.daten).optionen ?? {} : {};
    const nk = ab.nkAbrechnung(e.objekt_id, von, bis, { ...optionen, annahme_selbst: { einheit_id: einheitId, personen: s.personen } });
    const nebenkosten = nk.ergebnisse.filter((x) => x.segment.einheit.id === einheitId).reduce((sum, x) => sum + x.kosten_ct, 0);
    const steuer = get('SELECT * FROM steuerangaben WHERE objekt_id = ? AND jahr = ?', e.objekt_id, jahr) ?? {};
    let zinsen = (get(`SELECT coalesce(sum(CASE WHEN k.id = b.soll_id THEN b.betrag_ct ELSE -b.betrag_ct END), 0) AS s FROM buchungen b JOIN konten k ON k.id IN (b.soll_id, b.haben_id)
      WHERE k.objekt_id = ? AND k.klasse = 'kosten' AND k.kategorie = 'zinsen' AND b.datum BETWEEN ? AND ?`, e.objekt_id, von, bis).s) + (steuer.schuldzinsen_ct ?? 0);
    // Without booked interest the loans' repayment schedules give the interest of the year.
    const zinsenLautPlan = !zinsen;
    if (zinsenLautPlan) for (const d of all('SELECT id FROM darlehen WHERE objekt_id = ?', e.objekt_id)) zinsen += dl.tilgungsplan(d.id).jahre.find((j) => j.jahr === String(jahr))?.zins_ct ?? 0;
    // With an own deductible share for interest, the rest belongs to the self-used flats by their area.
    let zinsAnteil = flaechenAnteil;
    if (steuer.zins_anteil != null) {
      const selbstFlaeche = get(`SELECT coalesce(sum(e.wohnflaeche), 0) AS f FROM einheiten e WHERE e.objekt_id = ?1 AND EXISTS (SELECT 1 FROM selbstnutzung sn
        WHERE sn.einheit_id = e.id AND sn.beginn <= ?2 AND (sn.ende IS NULL OR sn.ende = '' OR sn.ende >= ?2))`, e.objekt_id, stichtag).f;
      zinsAnteil = (1 - steuer.zins_anteil / 100) * (selbstFlaeche ? (e.wohnflaeche ?? 0) / selbstFlaeche : 0);
    }
    let instand = 0;
    for (const r of all(`SELECT CASE WHEN k.id = b.soll_id THEN b.betrag_ct ELSE -b.betrag_ct END AS ct, ${einheitVonSql('b')} AS eid FROM buchungen b
        JOIN konten k ON k.id IN (b.soll_id, b.haben_id) WHERE k.objekt_id = ? AND k.klasse = 'kosten' AND k.kategorie = 'instandhaltung' AND k.aus_ruecklage = 0
        AND b.datum BETWEEN ? AND ?`, e.objekt_id, `${jahr - 2}-01-01`, bis)) {
      instand += !r.eid ? r.ct * flaechenAnteil : r.eid === einheitId ? r.ct : 0;
    }
    const posten = [
      { label: `Anteil Betriebs- und Heizkosten ${jahr}`, ct: Math.round(nebenkosten / 12) },
      { label: `Anteil Zinsen ${jahr}${zinsenLautPlan && zinsen ? ' (lt. Tilgungsplan)' : ''}`, ct: Math.round(zinsen * zinsAnteil / 12) },
      { label: `Instandhaltung (Ø ${jahr - 2}–${jahr})`, ct: Math.round(instand / 36) },
    ];
    const vgl = aw.vergleichsmieteQm(einheitId, stichtag);
    return {
      seit: s.beginn, bis: s.ende || null, personen: s.personen, flaeche: e.wohnflaeche ?? null, jahr, posten,
      monat_ct: posten.reduce((sum, x) => sum + x.ct, 0),
      qm_ct: vgl?.ct ?? null, quelle: vgl?.quelle ?? null, fiktiv_ct: vgl?.ct && e.wohnflaeche ? Math.round(vgl.ct * e.wohnflaeche) : null,
    };
  }

  // ---------- house view by floor ----------
  function stockwerk(e) {
    const t = `${e.lage ?? ''} ${e.bezeichnung ?? ''}`;
    if (['Garage', 'Stellplatz'].includes(e.art)) return ['Außen', -10];
    if (e.art === 'Keller' || /\b(UG|KG|Keller|Souterrain|Untergeschoss)\b/i.test(t)) return ['UG', -1];
    const og = t.match(/(\d+)\s*\.?\s*(OG|Obergeschoss|Etage|Stock)\b/i);
    if (og) return [`${Number(og[1])}. OG`, Number(og[1])];
    if (/\b(DG|Dachgeschoss|Spitzboden|Penthouse)\b/i.test(t)) return ['DG', 50];
    if (/\bOG\b|Obergeschoss/i.test(t)) return ['1. OG', 1];
    if (/\b(EG|Erdgeschoss|Hochparterre|Parterre)\b/i.test(t)) return ['EG', 0];
    return ['Weitere', -5];
  }

  // Units by floor with their state: let, in arrears, notice given, vacant, self-used (or for WEG: owner, arrears).
  function hausansicht(objektId, modus = 'miete', stichtag = heute()) {
    const etagen = new Map();
    for (const e of all('SELECT * FROM einheiten WHERE objekt_id = ? ORDER BY nr', objektId)) {
      const [name, ordnung] = stockwerk(e);
      const x = { id: e.id, bezeichnung: e.bezeichnung, art: e.art, flaeche: e.wohnflaeche ?? null };
      if (modus === 'weg') {
        const g = get(`SELECT g.id, g.selbstnutzer, ${PERSON_NAME} AS name FROM eigentum g JOIN personen p ON p.id = g.person_id WHERE g.einheit_id = ?1 AND g.beginn <= ?2
          AND (g.ende IS NULL OR g.ende = '' OR g.ende >= ?2) ORDER BY g.beginn DESC LIMIT 1`, e.id, stichtag);
        const k = g && bh.kontoVon('weg', g.id);
        const r = k ? Math.max(0, rueckstandAm(k.id, stichtag)) : 0;
        Object.assign(x, !g ? { status: 'leer', text: 'ohne Eigentümer' } : r > 0 ? { status: 'rueckstand', text: g.name, betrag_ct: r, vertrag: { typ: 'weg', id: g.id } }
          : { status: 'vermietet', text: `${g.name}${g.selbstnutzer ? ' · selbst genutzt' : ''}`, vertrag: { typ: 'weg', id: g.id } });
      } else {
        const m = get(`SELECT m.*, ${PERSON_NAME} AS name, w.kuendigung_zum FROM mietverhaeltnisse m JOIN personen p ON p.id = m.person_id LEFT JOIN mieterwechsel w ON w.vertrag_id = m.id
          WHERE m.einheit_id = ?1 AND m.beginn <= ?2 AND (m.ende IS NULL OR m.ende = '' OR m.ende >= ?2) ORDER BY m.beginn DESC LIMIT 1`, e.id, stichtag);
        const selbst = get(`SELECT 1 AS x FROM selbstnutzung WHERE einheit_id = ?1 AND beginn <= ?2 AND (ende IS NULL OR ende = '' OR ende >= ?2)
          UNION ALL SELECT 1 FROM eigentum WHERE einheit_id = ?1 AND selbstnutzer = 1 AND beginn <= ?2 AND (ende IS NULL OR ende = '' OR ende >= ?2) LIMIT 1`, e.id, stichtag);
        const kuenftig = get(`SELECT m.beginn, ${PERSON_NAME} AS name FROM mietverhaeltnisse m JOIN personen p ON p.id = m.person_id WHERE m.einheit_id = ? AND m.beginn > ?
          ORDER BY m.beginn LIMIT 1`, e.id, stichtag);
        if (m) {
          const k = bh.kontoVon('miete', m.id);
          const r = k ? Math.max(0, rueckstandAm(k.id, stichtag)) : 0;
          const ende = m.ende || m.kuendigung_zum;
          Object.assign(x, { vertrag: { typ: 'miete', id: m.id }, person_id: m.person_id },
            r > 0 ? { status: 'rueckstand', text: m.name, betrag_ct: r } : ende ? { status: 'gekuendigt', text: `${m.name} · bis ${datumDe(ende)}` } : { status: 'vermietet', text: m.name });
        } else if (selbst) Object.assign(x, { status: 'selbst', text: 'selbst genutzt' });
        else Object.assign(x, { status: 'leer', text: kuenftig ? `frei · ab ${datumDe(kuenftig.beginn)} ${kuenftig.name}` : 'frei' });
      }
      if (!etagen.has(name)) etagen.set(name, { name, ordnung, einheiten: [] });
      etagen.get(name).einheiten.push(x);
    }
    return [...etagen.values()].sort((a, b) => b.ordnung - a.ordnung);
  }

  // ---------- cockpit ----------
  // K1: this month's charges and how much of them is paid (oldest charges first); who still owes.
  function eingang(objekte, typ, t) {
    const monat = t.slice(0, 7), ende = monatsEnde(monat);
    let soll = 0, ist = 0;
    const offen = [];
    for (const k of all(`SELECT * FROM konten WHERE objekt_id IN (${idListe(objekte)}) AND klasse = 'person' AND vertrag_typ = ?`, typ)) {
      const s = get(`SELECT coalesce(sum(CASE WHEN b.soll_id = ?1 THEN b.betrag_ct ELSE -b.betrag_ct END), 0) AS s, min(CASE WHEN b.soll_id = ?1 THEN b.datum END) AS d
        FROM buchungen b WHERE (b.soll_id = ?1 OR b.haben_id = ?1) AND b.monat = ?2 AND b.art IN ('soll', 'storno')`, k.id, monat);
      if (s.s <= 0) continue;
      const o = Math.min(s.s, bh.offenePostenKonto(k.id, ende).offen.filter((x) => x.monat === monat).reduce((a, x) => a + x.offen_ct, 0));
      soll += s.s;
      ist += s.s - o;
      if (o > 0) offen.push({ ...vertragName(typ, k.vertrag_id), vertrag_id: k.vertrag_id, typ, offen_ct: o, faellig: s.d, ueberfaellig: s.d < t });
    }
    offen.sort((a, b) => b.ueberfaellig - a.ueberfaellig || b.offen_ct - a.offen_ct);
    return { monat, soll_ct: soll, ist_ct: ist, quote: soll ? ist / soll : null, offen };
  }

  // K2: let area-days of the last 12 months (self-use left out) and the cold rent lost to vacancy.
  function vermietung(objekte, t) {
    const von = plusTage(plusJahre(t, -1), 1);
    let vermietet = 0, basis = 0, leerCt = 0;
    const luecken = [];
    const stand = { vermietet: 0, selbst: 0, leer: 0, einheiten: 0 };
    for (const e of all(`SELECT * FROM einheiten WHERE objekt_id IN (${idListe(objekte)}) ORDER BY objekt_id, nr`)) {
      const seg = belegung(e.id, von, t);
      const f = e.wohnflaeche ?? 0;
      for (const s of seg) {
        if (s.art === 'miete') vermietet += f * s.tage;
        if (s.art !== 'selbst') basis += f * s.tage;
        if (s.art === 'leer') {
          const ct = entgangen(referenzmiete(e.id, s.von, s.bis), s.tage);
          leerCt += ct;
          luecken.push({ einheit_id: e.id, einheit: e.bezeichnung, tage: s.tage, ct, von: s.von, bis: s.bis });
        }
      }
      const jetzt = seg.at(-1)?.art;
      stand.einheiten++;
      if (jetzt === 'miete') stand.vermietet++; else if (jetzt === 'selbst') stand.selbst++; else stand.leer++;
    }
    luecken.sort((a, b) => b.ct - a.ct);
    return { von, bis: t, quote: basis ? vermietet / basis : null, leerstand_ct: leerCt, luecken, ...stand };
  }

  // K3: overdue amounts by age, and tenancies where two months' rent are overdue (§ 543 Abs. 2 Nr. 3 BGB).
  function rueckstaende(objekte, typ, t) {
    const stufen = [['≤ 30 Tage', 1, 30], ['31–60 Tage', 31, 60], ['61–90 Tage', 61, 90], ['> 90 Tage', 91, Infinity]].map(([label, von, bis]) => ({ label, von, bis, ct: 0 }));
    const konten = [], p543 = [];
    for (const k of all(`SELECT * FROM konten WHERE objekt_id IN (${idListe(objekte)}) AND klasse = 'person' AND vertrag_typ = ?`, typ)) {
      const op = bh.offenePostenKonto(k.id, t);
      const ueber = op.offen.filter((x) => x.verzug >= 1);
      const summe = Math.max(0, ueber.reduce((s, x) => s + x.offen_ct, 0) - op.guthaben_ct);
      if (!summe) continue;
      for (const x of ueber) stufen.find((s) => x.verzug >= s.von && x.verzug <= s.bis).ct += x.offen_ct;
      const n = vertragName(typ, k.vertrag_id);
      konten.push({ ...n, vertrag_id: k.vertrag_id, typ, ct: summe, aeltester: Math.max(...ueber.map((x) => x.verzug)) });
      if (typ === 'miete') {
        const miete = monatlich('miete', k.vertrag_id, t);
        const monate = ueber.filter((x) => x.monat).map((x) => x.monat).sort();
        const folge = monate.some((m, i) => i && monatPlus(monate[i - 1], 1) === m);
        if (miete > 0 && (summe >= 2 * miete || (folge && summe > miete)))
          p543.push({ ...n, vertrag_id: k.vertrag_id, ct: summe, monatsmieten: summe / miete, folge });
      }
    }
    konten.sort((a, b) => b.ct - a.ct);
    return { summe_ct: konten.reduce((s, x) => s + x.ct, 0), stufen, konten, p543 };
  }

  // K4: expected bank balance over the next days: rents as the tenants have paid in the last 12 months (share and delay),
  // loan instalments, insurance premiums and the recurring costs paid in the same weeks of last year.
  function vorschau(objekte, typ, t, tage = 90) {
    const ids = idListe(objekte);
    const bisD = plusTage(t, tage);
    const start = all(`SELECT id FROM konten WHERE objekt_id IN (${ids}) AND klasse = 'geld'`).reduce((s, k) => s + bh.saldoBis(k.id, t), 0);
    const ereignisse = [];
    for (const v of all(`SELECT v.id, v.lastschrift, ${PERSON_NAME} AS name FROM ${vertragTab(typ)} v JOIN einheiten e ON e.id = v.einheit_id JOIN personen p ON p.id = v.person_id
        WHERE e.objekt_id IN (${ids}) AND (v.ende IS NULL OR v.ende = '' OR v.ende > ?1) AND v.beginn <= ?2`, t, bisD)) {
      const z = zahlungsverhalten(typ, v.id, { monate: 12, stichtag: t });
      const due = (z?.monate ?? []).filter((m) => ['puenktlich', 'verspaetet', 'offen'].includes(m.status));
      const sollSumme = due.reduce((s, m) => s + m.soll_ct, 0);
      const quote = sollSumme ? Math.min(1, due.reduce((s, m) => s + m.bezahlt_ct, 0) / sollSumme) : 1;
      const erledigt = due.filter((m) => m.status !== 'offen');
      const verzug = v.lastschrift || !erledigt.length ? 0 : Math.round(erledigt.reduce((s, m) => s + (m.status === 'verspaetet' ? m.tage : 0), 0) / erledigt.length);
      let s = t;
      for (let i = 0; i < 4; i++) {
        const n = bh.naechsteFaelligkeit(typ, v.id, s);
        if (!n || n.datum > bisD) break;
        const d = plusTage(n.datum, verzug);
        const ct = Math.round(n.betrag_ct * quote);
        if (d <= bisD && ct > 0) ereignisse.push({ datum: d, ct, text: `${typ === 'weg' ? 'Hausgeld' : 'Miete'} ${v.name}`, art: 'ein' });
        s = n.datum;
      }
    }
    for (const d of all(`SELECT * FROM darlehen WHERE objekt_id IN (${ids})`)) {
      const tag = Number(d.erste_rate.slice(8, 10));
      for (const z of dl.tilgungsplan(d.id).zeilen) {
        const datum = `${z.monat}-${pad(Math.min(tag, tageImMonat(z.monat)))}`;
        if (datum > t && datum <= bisD) ereignisse.push({ datum, ct: -z.rate_ct, text: `Darlehensrate ${d.bank}`, art: 'darlehen' });
      }
    }
    const mitVersicherung = new Set();
    for (const v of all(`SELECT * FROM versicherungen WHERE objekt_id IN (${ids}) AND faellig IS NOT NULL AND faellig <> '' AND beitrag_ct > 0`)) {
      mitVersicherung.add(v.objekt_id);
      let d = v.faellig;
      while (d <= t) d = plusJahre(d, 1);
      if (d <= bisD) ereignisse.push({ datum: d, ct: -v.beitrag_ct, text: v.art, art: 'versicherung' });
    }
    for (const b of all(`SELECT b.datum, b.betrag_ct, b.text, k.bezeichnung, k.kategorie, k.objekt_id, CASE WHEN g.id = b.haben_id THEN -1 ELSE 1 END AS richtung
        FROM buchungen b JOIN konten k ON k.id IN (b.soll_id, b.haben_id) AND k.klasse = 'kosten' JOIN konten g ON g.id IN (b.soll_id, b.haben_id) AND g.klasse = 'geld'
        WHERE k.objekt_id IN (${ids}) AND b.datum BETWEEN ? AND ?`, plusJahre(nachTag(t), -1), plusJahre(bisD, -1))) {
      if (!WIEDERKEHREND(b.kategorie) || (b.kategorie === 'bk13' && mitVersicherung.has(b.objekt_id))) continue;
      const d = plusJahre(b.datum, 1);
      if (d > t && d <= bisD) ereignisse.push({ datum: d, ct: b.richtung * b.betrag_ct, text: b.bezeichnung, art: 'kosten' });
    }
    ereignisse.sort((a, b) => a.datum.localeCompare(b.datum) || a.ct - b.ct);
    const punkte = [];
    let lauf = start, i = 0;
    for (let n = 0; n <= tage; n++) {
      const d = plusTage(t, n);
      while (i < ereignisse.length && ereignisse[i].datum <= d) lauf += ereignisse[i++].ct;
      punkte.push({ datum: d, ct: lauf });
    }
    const tief = punkte.reduce((m, p) => (p.ct < m.ct ? p : m), punkte[0]);
    const gruende = ereignisse.filter((x) => x.ct < 0 && x.datum <= tief.datum && x.datum >= plusTage(tief.datum, -10)).sort((a, b) => a.ct - b.ct).slice(0, 2).map((x) => x.text);
    return {
      start_ct: start, ende_ct: lauf, punkte, tief: { ...tief, gruende: [...new Set(gruende)] },
      ein_ct: ereignisse.filter((x) => x.ct > 0).reduce((s, x) => s + x.ct, 0), aus_ct: -ereignisse.filter((x) => x.ct < 0).reduce((s, x) => s + x.ct, 0), ereignisse,
    };
  }

  // K5: income, operating costs and surplus since 1 January against the same days of last year; after interest and repayment.
  function jahresvergleich(objekte, typ, t) {
    const ids = idListe(objekte);
    const kat = typ === 'weg' ? ['hausgeld', 'ruecklage', 'sonderumlage', 'weg_ergebnis'] : ['miete', 'sonst', 'bk', 'hk', 'nk_ergebnis'];
    const werte = (von, bis) => {
      let ein = 0;
      for (const k of all(`SELECT id FROM konten WHERE objekt_id IN (${ids}) AND klasse = 'person' AND vertrag_typ = ?`, typ)) {
        const z = aw.zufluss(k.id, von, bis);
        for (const c of kat) ein += z[c] ?? 0;
      }
      const kosten = get(`SELECT coalesce(sum(CASE WHEN k.id = b.soll_id THEN b.betrag_ct ELSE -b.betrag_ct END), 0) AS s FROM buchungen b JOIN konten k ON k.id IN (b.soll_id, b.haben_id)
        WHERE k.objekt_id IN (${ids}) AND k.klasse = 'kosten' AND k.kategorie <> 'zinsen' AND k.aus_ruecklage = 0 AND b.datum BETWEEN ? AND ?`, von, bis).s;
      const zins = get(`SELECT coalesce(sum(CASE WHEN k.id = b.soll_id THEN b.betrag_ct ELSE -b.betrag_ct END), 0) AS s FROM buchungen b JOIN konten k ON k.id IN (b.soll_id, b.haben_id)
        WHERE k.objekt_id IN (${ids}) AND k.klasse = 'kosten' AND k.kategorie = 'zinsen' AND b.datum BETWEEN ? AND ?`, von, bis).s;
      const tilgung = get(`SELECT coalesce(sum(b.betrag_ct), 0) AS s FROM buchungen b JOIN konten k ON k.id = b.soll_id JOIN konten g ON g.id = b.haben_id
        WHERE k.objekt_id IN (${ids}) AND k.klasse = 'darlehen' AND g.klasse = 'geld' AND b.datum BETWEEN ? AND ?`, von, bis).s;
      return { ein, kosten, ueberschuss: ein - kosten, kapitaldienst: zins + tilgung, danach: ein - kosten - zins - tilgung };
    };
    const jahr = Number(t.slice(0, 4));
    const a = werte(`${jahr}-01-01`, t), b = werte(`${jahr - 1}-01-01`, plusJahre(t, -1));
    const zeile = (label, x, y, mehrIstGut) => ({ label, ct: x, vorjahr_ct: y, aenderung: y ? (x / y - 1) * 100 : null, gut: mehrIstGut ? x >= y : x <= y });
    return {
      jahr, bis: t, zeilen: [
        zeile(typ === 'weg' ? 'Hausgeld erhalten' : 'Mieteinnahmen', a.ein, b.ein, true),
        zeile('Bewirtschaftung', a.kosten, b.kosten, false),
        zeile('Überschuss', a.ueberschuss, b.ueberschuss, true),
        zeile('nach Zins und Tilgung', a.danach, b.danach, true),
      ],
    };
  }

  // K6: possible rent increases of the current tenancies.
  function radar(objekte, t) {
    const eintraege = [];
    let ohneVergleich = 0;
    for (const v of all(`SELECT m.*, e.bezeichnung AS einheit, e.objekt_id, ${PERSON_NAME} AS name FROM mietverhaeltnisse m JOIN einheiten e ON e.id = m.einheit_id
        JOIN personen p ON p.id = m.person_id WHERE e.objekt_id IN (${idListe(objekte)}) AND m.beginn <= ?1 AND (m.ende IS NULL OR m.ende = '' OR m.ende >= ?1)
        ORDER BY e.objekt_id, e.nr`, t)) {
      for (const x of erhoehungen(v, t)) {
        if (x.plus_ct > 0) eintraege.push({ ...x, vertrag_id: v.id, einheit_id: v.einheit_id, objekt_id: v.objekt_id, einheit: v.einheit, name: v.name });
        else if (x.plus_ct == null) ohneVergleich++;
      }
    }
    eintraege.sort((a, b) => a.ab.localeCompare(b.ab) || b.plus_ct - a.plus_ct);
    return { summe_ct: eintraege.reduce((s, x) => s + x.plus_ct, 0), eintraege, ohne_vergleich: ohneVergleich };
  }

  // K7: deadlines and dates of the next days (no calibration, legionella, smoke detector or boiler service dates).
  function fristen(objekte, typ, t, tage = 90) {
    const ids = idListe(objekte);
    const bisD = plusTage(t, tage);
    const out = [];
    const add = (datum, text, x = {}) => { if (datum > t && datum <= bisD) out.push({ datum, text, tage: tageZwischen(t, datum), ...x }); };
    const jahr = Number(t.slice(0, 4));
    if (typ === 'miete') {
      for (const o of objekte.filter((o) => o.art !== 'weg')) {
        const hatte = get('SELECT 1 FROM mietverhaeltnisse m JOIN einheiten e ON e.id = m.einheit_id WHERE e.objekt_id = ? AND m.beginn <= ?', o.id, `${jahr - 1}-12-31`);
        const fertig = get(`SELECT 1 FROM abrechnungen WHERE objekt_id = ? AND typ = 'nk' AND substr(von, 1, 4) = ?`, o.id, String(jahr - 1));
        if (hatte && !fertig) add(`${jahr}-12-31`, `Betriebskostenabrechnung ${jahr - 1} muss beim Mieter sein (${o.bezeichnung})`, { wichtig: true, ziel: { seite: 'nk', objektId: o.id } });
      }
      for (const a of all(`SELECT a.*, e.bezeichnung AS einheit, e.objekt_id, ${PERSON_NAME} AS name FROM anpassungen a JOIN mietverhaeltnisse m ON a.vertrag_typ = 'miete' AND m.id = a.vertrag_id
          JOIN einheiten e ON e.id = m.einheit_id JOIN personen p ON p.id = m.person_id WHERE e.objekt_id IN (${ids}) AND a.gueltig_ab > ? AND a.gueltig_ab <= ? ORDER BY a.gueltig_ab`, t, bisD)) {
        const alt = bh.betraege('miete', a.vertrag_id, vorTag(a.gueltig_ab));
        const plus = a.kaltmiete_ct != null ? a.kaltmiete_ct - (alt.kaltmiete_ct ?? 0) : 0;
        add(a.gueltig_ab, `${GRUND[a.grund] ?? 'Mietänderung'} ${a.einheit} wirksam${plus ? ` (${plus > 0 ? '+' : ''}${euro(plus)})` : ''}`, { ziel: { vertrag: a.vertrag_id, typ: 'miete' } });
      }
      for (const m of all(`SELECT m.*, e.bezeichnung AS einheit, ${PERSON_NAME} AS name FROM mietverhaeltnisse m JOIN einheiten e ON e.id = m.einheit_id
          JOIN personen p ON p.id = m.person_id WHERE e.objekt_id IN (${ids}) AND ((m.ende > ?1 AND m.ende <= ?2) OR (m.beginn > ?1 AND m.beginn <= ?2))`, t, bisD)) {
        if (m.ende > t && m.ende <= bisD) add(m.ende, `Auszug ${m.name} (${m.einheit}) – Übergabe und Zählerstände`, { ziel: { vertrag: m.id, typ: 'miete' } });
        if (m.beginn > t && m.beginn <= bisD) add(m.beginn, `Einzug ${m.name} (${m.einheit})`, { ziel: { vertrag: m.id, typ: 'miete' } });
      }
      if (get(`SELECT 1 FROM kautionen k JOIN mietverhaeltnisse m ON m.id = k.vertrag_id JOIN einheiten e ON e.id = m.einheit_id WHERE e.objekt_id IN (${ids}) AND k.zinssatz > 0`))
        add(`${jahr}-12-31`, 'Kautionszinsen gutschreiben', { ziel: { seite: 'kaution' } });
    } else {
      for (const v of all(`SELECT * FROM versammlungen WHERE objekt_id IN (${ids}) AND datum > ? AND datum <= ?`, t, plusTage(bisD, 21))) {
        add(v.datum, `Eigentümerversammlung${v.ort ? ` (${v.ort})` : ''}`, { ziel: { seite: 'versammlungen', objektId: v.objekt_id } });
        if (!v.einladung_am) add(plusTage(v.datum, -21), `Einladung zur Versammlung am ${datumDe(v.datum)} verschicken`, { wichtig: true, ziel: { seite: 'versammlungen', objektId: v.objekt_id } });
      }
    }
    for (const v of all(`SELECT * FROM versicherungen WHERE objekt_id IN (${ids})`)) {
      if (v.kuendbar_bis) add(v.kuendbar_bis, `${v.art}${v.gesellschaft ? ` (${v.gesellschaft})` : ''} kündbar bis`, { wichtig: tageZwischen(t, v.kuendbar_bis) <= 30, ziel: { seite: 'versicherungen', objektId: v.objekt_id } });
      if (v.faellig && v.beitrag_ct > 0) {
        let d = v.faellig;
        while (d <= t) d = plusJahre(d, 1);
        add(d, `${v.art} (${euro(v.beitrag_ct)})`, { ziel: { seite: 'versicherungen', objektId: v.objekt_id } });
      }
    }
    for (const d of all(`SELECT * FROM darlehen WHERE objekt_id IN (${ids}) AND zinsbindung_bis IS NOT NULL`)) add(d.zinsbindung_bis, `Zinsbindung ${d.bank} endet`, { wichtig: true, ziel: { seite: 'darlehen', objektId: d.objekt_id } });
    // Property tax: the instalments paid in the same weeks of last year.
    for (const b of all(`SELECT b.datum, sum(b.betrag_ct) AS ct FROM buchungen b JOIN konten k ON k.id = b.soll_id JOIN konten g ON g.id = b.haben_id
        WHERE k.objekt_id IN (${ids}) AND k.kategorie = 'bk01' AND g.klasse = 'geld' AND b.datum BETWEEN ? AND ? GROUP BY b.datum`, plusJahre(nachTag(t), -1), plusJahre(bisD, -1))) {
      add(plusJahre(b.datum, 1), `Grundsteuer (${euro(b.ct)})`, { ziel: { seite: 'buchen' } });
    }
    return out.sort((a, b) => a.datum.localeCompare(b.datum)).slice(0, 14);
  }

  // K9: costs of the year by type, allocable share and non-allocable costs per m².
  function kostenNachArt(objekte, t) {
    const ids = idListe(objekte);
    const jahr = Number(t.slice(0, 4));
    const konten = all(`SELECT k.kategorie, k.umlagefaehig, coalesce(sum(CASE WHEN k.id = b.soll_id THEN b.betrag_ct ELSE -b.betrag_ct END), 0) AS ct
      FROM buchungen b JOIN konten k ON k.id IN (b.soll_id, b.haben_id) WHERE k.objekt_id IN (${ids}) AND k.klasse = 'kosten' AND k.kategorie IS NOT 'zinsen'
      AND b.datum BETWEEN ? AND ? GROUP BY k.id`, `${jahr}-01-01`, t).filter((k) => k.ct > 0);
    const gruppen = KOSTENGRUPPEN.map(([label]) => ({ label, ct: 0 }));
    for (const k of konten) gruppen[KOSTENGRUPPEN.findIndex(([, f]) => f(k.kategorie))].ct += k.ct;
    const summe = konten.reduce((s, k) => s + k.ct, 0);
    const uml = konten.filter((k) => k.umlagefaehig).reduce((s, k) => s + k.ct, 0);
    const flaeche = get(`SELECT coalesce(sum(wohnflaeche), 0) AS f FROM einheiten WHERE objekt_id IN (${ids})`).f;
    return { jahr, bis: t, summe_ct: summe, gruppen: gruppen.filter((g) => g.ct > 0).sort((a, b) => b.ct - a.ct), umlagefaehig_ct: uml,
      umlagefaehig_anteil: summe ? uml / summe : null, nicht_umlagefaehig_qm_ct: flaeche ? Math.round((summe - uml) / flaeche) : null, flaeche };
  }

  function cockpitKennzahlen(modus = 'miete', stichtag = heute()) {
    const typ = modus === 'weg' ? 'weg' : 'miete';
    const objekte = objekteFuer(modus);
    return {
      modus: typ, stichtag,
      eingang: eingang(objekte, typ, stichtag),
      vermietung: typ === 'miete' ? vermietung(objekte, stichtag) : null,
      rueckstaende: rueckstaende(objekte, typ, stichtag),
      vorschau: vorschau(objekte, typ, stichtag),
      vergleich: jahresvergleich(objekte, typ, stichtag),
      radar: typ === 'miete' ? radar(objekte, stichtag) : null,
      fristen: fristen(objekte, typ, stichtag),
      kosten: kostenNachArt(objekte, stichtag),
    };
  }

  // ---------- small gauges in the lists ----------
  function listenKennzahlen(objektId, stichtag = heute()) {
    const vertraege = {};
    for (const v of all(`SELECT m.id, m.einheit_id FROM mietverhaeltnisse m JOIN einheiten e ON e.id = m.einheit_id WHERE e.objekt_id = ?1
        AND (m.ende IS NULL OR m.ende = '' OR m.ende >= ?2)`, objektId, stichtag)) {
      const z = zahlungsverhalten('miete', v.id, { stichtag });
      const vg = vergleich(v.einheit_id, bh.betraege('miete', v.id, stichtag).kaltmiete_ct, stichtag);
      vertraege[v.id] = { score: z?.score ?? null, label: z?.label ?? null, qm_ct: vg?.qm_ct ?? null, von_ct: vg?.von_ct ?? null, bis_ct: vg?.bis_ct ?? null, mittel_ct: vg?.mittel_ct ?? null };
    }
    const einheiten = {};
    const von = plusTage(plusJahre(stichtag, -1), 1);
    for (const e of all('SELECT * FROM einheiten WHERE objekt_id = ?', objektId)) {
      const seg = belegung(e.id, von, stichtag);
      const tage = seg.reduce((s, x) => s + x.tage, 0);
      const m = get(`SELECT id FROM mietverhaeltnisse WHERE einheit_id = ?1 AND beginn <= ?2 AND (ende IS NULL OR ende = '' OR ende >= ?2) ORDER BY beginn DESC LIMIT 1`, e.id, stichtag);
      const vg = m ? vergleich(e.id, bh.betraege('miete', m.id, stichtag).kaltmiete_ct, stichtag) : null;
      einheiten[e.id] = { belegung: tage ? seg.filter((x) => x.art !== 'leer').reduce((s, x) => s + x.tage, 0) / tage : null,
        selbst: seg.at(-1)?.art === 'selbst', qm_ct: vg?.qm_ct ?? null, von_ct: vg?.von_ct ?? null, bis_ct: vg?.bis_ct ?? null, mittel_ct: vg?.mittel_ct ?? null };
    }
    return { vertraege, einheiten };
  }

  // Consumption jumps of the last full year (± 40 %), for the cockpit hints.
  function verbrauchSpruenge(stichtag = heute()) {
    const jahr = Number(stichtag.slice(0, 4)) - 1;
    const out = [];
    for (const e of all(`SELECT e.*, o.bezeichnung AS objekt, o.art AS objekt_art FROM einheiten e JOIN objekte o ON o.id = e.objekt_id
        WHERE EXISTS (SELECT 1 FROM zaehler z WHERE z.einheit_id = e.id)`)) {
      for (const x of verbrauchEinheit(e, jahr)) {
        if (x.aenderung != null && Math.abs(x.aenderung) >= 40 && x.vorjahr > 0) out.push({ ...x, einheit_id: e.id, einheit_name: e.bezeichnung, objekt_id: e.objekt_id, objekt: e.objekt, objekt_art: e.objekt_art });
      }
    }
    return out;
  }

  return { zahlungsverhalten, kontoverlauf, mieterKennzahlen, einheitKennzahlen, hausansicht, cockpitKennzahlen, listenKennzahlen, selbstKosten, verbrauchSpruenge, belegung };
};
