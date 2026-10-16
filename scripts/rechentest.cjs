// Calculation test: builds a sample house with two years of data and recomputes every figure independently, to the cent.
// Run: ELECTRON_RUN_AS_NODE=1 npx electron scripts/rechentest.cjs
const { open, api } = require('../electron/db.cjs');
const kalender = require('../electron/kalender.cjs');

let ok = 0, falsch = 0;
function gleich(name, ist, soll) {
  const a = JSON.stringify(ist), b = JSON.stringify(soll);
  if (a === b) { ok++; return true; }
  falsch++;
  console.log(`FEHLER ${name}\n   ist:  ${a}\n   soll: ${b}`);
  return false;
}

// ---------- independent date helpers ----------
const pad = (n) => String(n).padStart(2, '0');
const tageImMonat = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const plusTage = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const tageInkl = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
const wochentag = (s) => new Date(s + 'T00:00:00Z').getUTCDay();
function monate(von, bis) {
  const out = [];
  let [y, m] = von.split('-').map(Number);
  const [y2, m2] = bis.split('-').map(Number);
  while (y < y2 || (y === y2 && m <= m2)) { out.push(`${y}-${pad(m)}`); if (++m > 12) { m = 1; y++; } }
  return out;
}
// Public holidays in Berlin 2025–2027 (Easter 2025-04-20, 2026-04-05, 2027-03-28).
const FEIERTAGE_BE = new Set([
  '2025-01-01', '2025-03-08', '2025-04-18', '2025-04-21', '2025-05-01', '2025-05-29', '2025-06-09', '2025-10-03', '2025-12-25', '2025-12-26',
  '2026-01-01', '2026-03-08', '2026-04-03', '2026-04-06', '2026-05-01', '2026-05-14', '2026-05-25', '2026-10-03', '2026-12-25', '2026-12-26',
  '2027-01-01', '2027-03-08', '2027-03-26', '2027-03-29', '2027-05-01', '2027-05-06', '2027-05-17', '2027-10-03', '2027-12-25', '2027-12-26',
]);
// Rent: 3rd working day, Saturdays not counted (BGH VIII ZR 129/09).
function dritterWerktagMiete(monat) {
  let n = 0;
  for (let d = 1; ; d++) {
    const s = `${monat}-${pad(d)}`;
    if (wochentag(s) !== 0 && wochentag(s) !== 6 && !FEIERTAGE_BE.has(s) && ++n === 3) return s;
  }
}

// ---------- 1. Calendar ----------
const HAND = { '2025-01': '2025-01-06', '2025-05': '2025-05-06', '2025-10': '2025-10-06', '2026-04': '2026-04-07', '2026-10': '2026-10-05', '2026-01': '2026-01-06' };
for (const [m, d] of Object.entries(HAND)) gleich(`Handwert 3. Werktag ${m}`, dritterWerktagMiete(m), d);
for (const m of monate('2025-01', '2027-12')) gleich(`3. Werktag Miete ${m}`, kalender.mieteFaellig(m, 'BE'), dritterWerktagMiete(m));

// ---------- 2. Sample data: rented house ----------
const db = api(open(':memory:'));
db.setzeEinstellungen({ bundesland: 'BE', verwalter_name: 'Hausverwaltung Muster', verwalter_strasse: 'Hauptstr. 1', verwalter_plz: '10115', verwalter_ort: 'Berlin' });
const o = db.neuesObjekt({ bezeichnung: 'Musterhaus Lindenstraße 5', art: 'miete', strasse: 'Lindenstraße 5', plz: '10115', ort: 'Berlin',
  kaufpreis_ct: 120000000, kaufnebenkosten_ct: 9600000, kaufdatum: '2024-05-01', gebaeudeanteil: 75, afa_satz: 2 });
const EINHEITEN = [['WE01', 'EG links', 'Wohnung', 72.5], ['WE02', 'EG rechts', 'Wohnung', 58], ['WE03', '1. OG links', 'Wohnung', 85.25],
  ['WE04', '1. OG rechts', 'Wohnung', 64], ['GE01', 'Laden', 'Gewerbe', 110], ['ST01', 'Stellplatz 1', 'Stellplatz', 0]];
const E = {};
EINHEITEN.forEach(([k, b, art, f], i) => { E[k] = { id: db.save('einheiten', { objekt_id: o, nr: i + 1, bezeichnung: b, art, wohnflaeche: f }), flaeche: f, art, nr: i + 1 }; });
const person = (vorname, nachname, extra = {}) => db.save('personen', { anrede: extra.anrede ?? 'Frau', vorname, nachname, strasse: 'Lindenstraße 5', plz: '10115', ort: 'Berlin', ...extra });
const P = {
  meier: person('Anna', 'Meier'), becker: person('Jonas', 'Becker', { anrede: 'Herr' }), schulz: person('Petra', 'Schulz'),
  wagner: person('Karl', 'Wagner', { anrede: 'Herr' }), neumann: person('Lena', 'Neumann'), krume: db.save('personen', { firma: 'Bäckerei Krume GmbH', strasse: 'Lindenstraße 5', plz: '10115', ort: 'Berlin' }),
  richter: person('Tom', 'Richter', { anrede: 'Herr' }),
};
// Contracts: amounts in cents. sonst = other rent.
const VERTRAEGE = {
  v1: { einheit: 'WE01', person_id: P.meier, beginn: '2020-04-01', kaltmiete_ct: 78000, bk_vz_ct: 16000, hk_vz_ct: 9500, personen_anzahl: 2, faelligkeitstag: 0 },
  v2: { einheit: 'WE02', person_id: P.becker, beginn: '2025-03-15', kaltmiete_ct: 60000, bk_vz_ct: 13000, hk_vz_ct: 8000, personen_anzahl: 1, faelligkeitstag: 0, teilmonat_beginn: 'anteilig' },
  v3: { einheit: 'WE03', person_id: P.schulz, beginn: '2018-01-01', ende: '2025-06-20', kaltmiete_ct: 90000, bk_vz_ct: 18000, hk_vz_ct: 11000, personen_anzahl: 3, faelligkeitstag: 0, teilmonat_ende: 'anteilig' },
  v3b: { einheit: 'WE03', person_id: P.wagner, beginn: '2025-08-16', kaltmiete_ct: 98000, bk_vz_ct: 18000, hk_vz_ct: 11000, personen_anzahl: 2, faelligkeitstag: 0, teilmonat_beginn: 'voll' },
  v4: { einheit: 'WE04', person_id: P.neumann, beginn: '2025-10-10', kaltmiete_ct: 72000, bk_vz_ct: 14000, hk_vz_ct: 8500, personen_anzahl: 1, faelligkeitstag: 0, teilmonat_beginn: 'folgemonat' },
  v5: { einheit: 'GE01', person_id: P.krume, beginn: '2024-01-01', kaltmiete_ct: 150000, bk_vz_ct: 25000, hk_vz_ct: 15000, personen_anzahl: 0, faelligkeitstag: 1, ust_satz: 19 },
  v6: { einheit: 'ST01', person_id: P.richter, beginn: '2023-01-01', kaltmiete_ct: 5000, personen_anzahl: 0, faelligkeitstag: 1 },
};
const V = {};
for (const [k, v] of Object.entries(VERTRAEGE)) {
  V[k] = { ...v, einheit_id: E[v.einheit].id, teilmonat_beginn: v.teilmonat_beginn ?? 'anteilig', teilmonat_ende: v.teilmonat_ende ?? 'anteilig', ust_satz: v.ust_satz ?? 0 };
  const { einheit, ...row } = V[k];
  V[k].id = db.save('mietverhaeltnisse', row);
}
// Adjustments: increase (§ 558), graduated rent, indexed rent.
const ANPASSUNGEN = [
  { v: 'v1', gueltig_ab: '2025-08-01', grund: 'erhoehung', kaltmiete_ct: 85000 },
  { v: 'v2', gueltig_ab: '2026-03-01', grund: 'staffel', kaltmiete_ct: 63000 },
];
db.mietmodellSetzen(V.v4.id, { art: 'index', basis_monat: '2025-09' });
db.indexwerteSetzen([['2025-09', 121.7], ['2026-07', 124.5]]);
const idx = db.indexBerechnung(V.v4.id, '2026-07', '2026-08-20');
gleich('Index neue Miete', idx.neue_miete_ct, Math.round(72000 * 124.5 / 121.7));
gleich('Index frühestens (1 Jahr seit 10.10.2025 → 1.11.2026)', idx.frueheste_wirkung, '2026-11-01');
ANPASSUNGEN.push({ v: 'v4', gueltig_ab: idx.frueheste_wirkung, grund: 'index', kaltmiete_ct: idx.neue_miete_ct, notiz: `Index 2026-07: 124.5 (Basis 2025-09: 121.7)` });
for (const a of ANPASSUNGEN) db.save('anpassungen', { vertrag_typ: 'miete', vertrag_id: V[a.v].id, gueltig_ab: a.gueltig_ab, grund: a.grund, kaltmiete_ct: a.kaltmiete_ct, notiz: a.notiz ?? null });

// ---------- 3. Monthly debits ----------
function betraegeAm(k, datum) {
  const v = V[k];
  const b = { kaltmiete_ct: v.kaltmiete_ct ?? 0, sonstiges_ct: v.sonstiges_ct ?? 0, bk_vz_ct: v.bk_vz_ct ?? 0, hk_vz_ct: v.hk_vz_ct ?? 0 };
  for (const a of ANPASSUNGEN.filter((a) => a.v === k && a.gueltig_ab <= datum).sort((x, y) => (x.gueltig_ab < y.gueltig_ab ? -1 : 1)))
    for (const f of Object.keys(b)) if (a[f] != null) b[f] = a[f];
  return b;
}
// Expected charge of one contract for one month: { datum, posten: { label: ct }, summe }.
function erwartetesSoll(k, monat) {
  const v = V[k];
  const [y, m] = monat.split('-').map(Number);
  const T = tageImMonat(y, m), erster = `${monat}-01`, letzter = `${monat}-${pad(T)}`;
  if (v.beginn > letzter || (v.ende && v.ende < erster)) return null;
  const beginntHier = v.beginn > erster, endetHier = !!v.ende && v.ende < letzter;
  if (beginntHier && v.teilmonat_beginn === 'folgemonat') return null;
  const ab = beginntHier && v.teilmonat_beginn !== 'voll' ? v.beginn : erster;
  const bis = endetHier && v.teilmonat_ende !== 'voll' ? v.ende : letzter;
  const tage = tageInkl(ab, bis);
  const b = betraegeAm(k, beginntHier ? v.beginn : erster);
  const posten = {};
  let netto = 0;
  for (const [f, label] of [['kaltmiete_ct', 'Miete'], ['sonstiges_ct', 'Sonstiges'], ['bk_vz_ct', 'BK-Vorauszahlung'], ['hk_vz_ct', 'HK-Vorauszahlung']]) {
    const ct = Math.round(b[f] * tage / T);
    if (ct > 0) { posten[label] = ct; netto += ct; }
  }
  if (v.ust_satz && netto) posten[`USt ${v.ust_satz} %`] = Math.round(netto * v.ust_satz / 100);
  let datum = v.faelligkeitstag === 0 ? dritterWerktagMiete(monat) : `${monat}-${pad(Math.min(v.faelligkeitstag, T))}`;
  if (beginntHier && datum < v.beginn) datum = v.beginn;
  return { datum, posten, summe: Object.values(posten).reduce((s, x) => s + x, 0), tage, T };
}
const zeilen = db.sollstellung(o, '2025-01', '2026-12');
for (const [k, v] of Object.entries(V)) {
  for (const monat of monate('2025-01', '2026-12')) {
    const soll = erwartetesSoll(k, monat);
    const z = zeilen.filter((x) => x.vertrag_id === v.id && x.monat === monat);
    const ist = z.length ? { datum: z[0].datum, posten: Object.fromEntries(z.map((x) => [x.posten, x.betrag_ct])) } : null;
    gleich(`Soll ${k} ${monat}`, ist, soll && { datum: soll.datum, posten: soll.posten });
  }
}
// Spot checks by hand: Becker March 2025 (from 15th, 17/31 days), Schulz June (20/30), Wagner August (full), Neumann first in November.
gleich('Becker 03/2025 Miete 600 × 17/31', zeilen.find((x) => x.vertrag_id === V.v2.id && x.monat === '2025-03' && x.posten === 'Miete')?.betrag_ct, 32903);
gleich('Becker 03/2025 fällig am Einzug', zeilen.find((x) => x.vertrag_id === V.v2.id && x.monat === '2025-03')?.datum, '2025-03-15');
gleich('Schulz 06/2025 Miete 900 × 20/30', zeilen.find((x) => x.vertrag_id === V.v3.id && x.monat === '2025-06' && x.posten === 'Miete')?.betrag_ct, 60000);
gleich('Wagner 08/2025 voller Monat, fällig 16.8.', zeilen.filter((x) => x.vertrag_id === V.v3b.id && x.monat === '2025-08').map((x) => [x.datum, x.betrag_ct]),
  [['2025-08-16', 98000], ['2025-08-16', 18000], ['2025-08-16', 11000]]);
gleich('Neumann erst ab 11/2025', zeilen.filter((x) => x.vertrag_id === V.v4.id && x.monat <= '2025-10').length, 0);
gleich('Krume USt 19 % auf 1.900 €', zeilen.find((x) => x.vertrag_id === V.v5.id && x.monat === '2025-01' && /^USt/.test(x.posten))?.betrag_ct, 36100);

// ---------- 4. Payments ----------
const kt = Object.fromEntries(db.konten(o).map((k) => [k.nr, k.id]));
const bank = kt[1200];
const kontoVon = (k) => db.kontoVon('miete', V[k].id).id;
const ZAHLUNGEN = {};
const zahle = (k, datum, ct) => {
  (ZAHLUNGEN[k] ??= []).push({ datum, ct });
  db.buchen({ objekt_id: o, datum, text: `Zahlung ${k}`, art: 'bank', positionen: [{ soll_id: bank, haben_id: kontoVon(k), betrag_ct: ct }] });
};
const STICHTAG = '2026-10-16';
for (const k of Object.keys(V)) {
  for (const monat of monate('2025-01', '2026-10')) {
    const s = erwartetesSoll(k, monat);
    if (!s) continue;
    let ct = s.summe, datum = s.datum;
    if (k === 'v1' && monat === '2025-09') { zahle(k, datum, 50000); zahle(k, '2025-10-20', s.summe - 50000); continue; }
    if (k === 'v1' && monat === '2026-09') continue; // missed: October's payment settles September
    if (k === 'v2' && monat >= '2026-03') ct = s.summe - 3000; // keeps paying the rent before the graduated step
    if (k === 'v3b' && (monat === '2026-08' || monat === '2026-09')) continue;
    if (k === 'v2' && monat === '2025-12') datum = '2026-01-15';
    zahle(k, datum, ct);
  }
}
zahle('v3b', '2026-10-15', 50000); // first instalment

// Expected open items: payments settle the oldest month first; a month not paid in full stays open with its whole charge.
function erwarteteOP(k, stichtag) {
  const lasten = monate('2025-01', '2026-12').map((m) => erwartetesSoll(k, m)).filter((s) => s && s.datum <= stichtag);
  let gezahlt = (ZAHLUNGEN[k] ?? []).filter((z) => z.datum <= stichtag).reduce((s, z) => s + z.ct, 0);
  const offen = [];
  for (const l of lasten) {
    const b = Math.min(gezahlt, l.summe);
    gezahlt -= b;
    if (b < l.summe) offen.push({ datum: l.datum, soll_ct: l.summe, bezahlt_ct: b, offen_ct: l.summe - b });
  }
  return { offen, guthaben_ct: gezahlt };
}
for (const k of Object.keys(V)) {
  const op = db.offenePostenKonto(kontoVon(k), STICHTAG);
  gleich(`Offene Posten ${k}`, { offen: op.offen.map((x) => ({ datum: x.datum, soll_ct: x.soll_ct, bezahlt_ct: x.bezahlt_ct, offen_ct: x.offen_ct })), guthaben_ct: op.guthaben_ct }, erwarteteOP(k, STICHTAG));
}
// By hand: Meier missed September, October's payment settled it → October open in full (1.105 €), not a part.
gleich('Meier: Oktober voll offen', db.offenePostenKonto(kontoVon('v1'), STICHTAG).offen.map((x) => [x.monat, x.offen_ct, x.status]), [['2026-10', 110500, 'nicht bezahlt']]);
gleich('Becker: 8 × 30 € zu wenig → Oktober Rest 240 €', db.offenePostenKonto(kontoVon('v2'), STICHTAG).offen.map((x) => [x.monat, x.offen_ct]), [['2026-10', 24000]]);

// ---------- 5. Instalment plan (Wagner: August and September 2026 missed, plan agreed 20.9.) ----------
const rp = db.ratenplanAnlegen({ konto_id: kontoVon('v3b'), datum: '2026-09-20', betrag_ct: 254000, rate_ct: 50000, erste_rate: '2026-10-15' });
const st = db.ratenplanStand(rp, STICHTAG);
// Paid after the plan: October rent 1.270 € (settles August) + 500 € → September rest 770 € open; October itself is new arrears.
gleich('Ratenplan getilgt', st.getilgt_ct, 254000 - 77000);
gleich('Ratenplan neue Rückstände', st.neue_rueckstaende_ct, 127000);
gleich('Ratenplan Raten', st.raten.map((r) => [r.faellig, r.betrag_ct]), [['2026-10-15', 50000], ['2026-11-15', 50000], ['2026-12-15', 50000], ['2027-01-15', 50000], ['2027-02-15', 50000], ['2027-03-15', 4000]]);

// ---------- 6. Notice periods (§ 573c BGB; Saturday counts, but not as the last day) ----------
const KUENDIGUNG = [
  ['mieter', '2026-10-05', '2026-12-31', true],   // Oct 1 Thu, 2 Fri, 3 Sat = holiday, 5 Mon = 3rd working day
  ['mieter', '2026-10-06', '2027-01-31', false],
  ['mieter', '2025-11-04', '2026-01-31', true],   // Nov 1 Sat counts → Sat, Mon, Tue
  ['mieter', '2025-11-05', '2026-02-28', false],
  ['mieter', '2027-04-05', '2027-06-30', true],   // Apr 1 Thu, 2 Fri, 3 Sat would be 3rd → last day on a Saturday moves to Monday
  ['vermieter', '2026-10-05', '2027-03-31', true], // Meier since 1.4.2020: more than 5 years → 6 months
];
for (const [durch, zugang, zum, rechtzeitig] of KUENDIGUNG) {
  const r = db.kuendigungBerechnen({ vertrag_id: V.v1.id, durch, zugang });
  gleich(`Kündigung ${durch} Zugang ${zugang}`, [r.zum, r.rechtzeitig], [zum, rechtzeitig]);
}

// ---------- 7. Deposit interest ----------
const kaution = db.kautionAnlegen(V.v1.id);
db.save('kautionen', { id: kaution, art: 'konto', zinssatz: 0.25 });
db.save('kautionsbewegungen', { kaution_id: kaution, datum: '2020-04-01', art: 'einzahlung', betrag_ct: 234000 });
gleich('Kautionszinsen bis 31.12.2025', db.kautionZinsVorschlag(kaution, '2025-12-31'), Math.round(234000 * 0.0025 * (tageInkl('2020-04-01', '2025-12-31') - 1) / 365));

// ---------- 8. Loan ----------
const darlehen = db.darlehenSpeichern({ objekt_id: o, bank: 'Sparkasse', betrag_ct: 30000000, auszahlung: '2024-05-15', zinssatz: 3.5, tilgung_satz: 2, erste_rate: '2024-06-30' });
const tp = db.tilgungsplan(darlehen);
{
  const rate = Math.round(30000000 * 5.5 / 100 / 12);
  let rest = 30000000;
  const jahre = {};
  const z = [];
  for (let i = 0; rest > 0 && i < 600; i++) {
    const d = new Date(Date.UTC(2024, 5 + i, 1)).toISOString().slice(0, 7);
    const zins = Math.round(rest * 3.5 / 100 / 12);
    const tilgung = Math.min(rest, rate - zins);
    rest -= tilgung;
    z.push([d, zins, tilgung, rest]);
    const j = (jahre[d.slice(0, 4)] ??= [0, 0]);
    j[0] += zins; j[1] += tilgung;
  }
  gleich('Darlehen Rate', tp.rate_ct, 137500);
  gleich('Darlehen erste 3 Monate', tp.zeilen.slice(0, 3).map((x) => [x.monat, x.zins_ct, x.tilgung_ct, x.rest_ct]), z.slice(0, 3));
  gleich('Darlehen Laufzeit', tp.zeilen.length, z.length);
  gleich('Darlehen Zinsen 2025', tp.jahre.find((j) => j.jahr === '2025').zins_ct, jahre['2025'][0]);
}

// ---------- 9. Operating costs 2025 and the service-charge statement ----------
const kosten = (nr, datum, ct, text) => db.buchen({ objekt_id: o, datum, text, positionen: [{ soll_id: kt[nr], haben_id: bank, betrag_ct: ct }] });
for (const d of ['2025-02-15', '2025-05-15', '2025-08-15', '2025-11-15']) kosten(40100, d, 46250, 'Grundsteuer');
kosten(40200, '2025-12-10', 187220, 'Wasser');
kosten(40300, '2025-12-10', 124820, 'Abwasser');
kosten(40600, '2025-06-30', 123600, 'Müllabfuhr');
kosten(40900, '2025-12-20', 41280, 'Allgemeinstrom');
kosten(41300, '2025-01-20', 234567, 'Gebäudeversicherung');
kosten(41400, '2025-12-31', 180000, 'Hauswart');
kosten(40800, '2025-10-01', 96000, 'Gartenpflege');
kosten(41000, '2025-12-15', 987654, 'Gas');
kosten(45000, '2025-12-31', 120000, 'Verwaltung'); // not allocable
kosten(41510, '2025-03-01', 30000, 'Kabel-TV');  // not allocable since 1.7.2024
db.save('konten', { id: kt[41400], schluessel_id: db.schluessel(o).find((s) => s.typ === 'einheiten').id });
// Heat meters per unit; readings are the state at the end of the day.
const waerme = db.save('umlageschluessel', { objekt_id: o, bezeichnung: 'Wärmeverbrauch', einheit: 'Einh.', typ: 'zaehler', zaehler_art: 'waerme' });
const Z = {};
for (const k of ['WE01', 'WE02', 'WE03', 'WE04', 'GE01']) Z[k] = db.save('zaehler', { objekt_id: o, einheit_id: E[k].id, art: 'waerme', nummer: `W-${k}`, einheit: 'Einh.', faktor: 1 });
const ABLESUNG = {
  '2024-12-31': { WE01: 1000, WE02: 500, WE03: 2000, WE04: 300, GE01: 4000 },
  '2025-06-20': { WE03: 2810 },
  '2025-08-15': { WE03: 2850 },
  '2025-10-09': { WE04: 420 },
  '2025-12-31': { WE01: 2450, WE02: 1610, WE03: 3600, WE04: 1210, GE01: 7600 },
};
for (const [d, w] of Object.entries(ABLESUNG)) db.ablesung(d, Object.fromEntries(Object.entries(w).map(([k, x]) => [Z[k], x])));
const CO2 = { co2_kg: 18000, co2_kosten_ct: 99000 };
const nk = db.nkAbrechnung(o, '2025-01-01', '2025-12-31', { heizung: 'intern', verbrauchsanteil: 70, ...CO2, leerstand_personen: 1 });

{
  // Segments by unit: contracts and vacancies.
  const VON = '2025-01-01', BIS = '2025-12-31', JAHR = 365;
  const seg = [];
  for (const [ek, e] of Object.entries(E)) {
    const vs = Object.entries(V).filter(([, v]) => v.einheit === ek && v.beginn <= BIS && (!v.ende || v.ende >= VON)).sort((a, b) => (a[1].beginn < b[1].beginn ? -1 : 1));
    let cursor = VON;
    for (const [vk, v] of vs) {
      const a = v.beginn > VON ? v.beginn : VON, b = v.ende && v.ende < BIS ? v.ende : BIS;
      if (a > cursor) seg.push({ ek, vk: null, von: cursor, bis: plusTage(a, -1) });
      seg.push({ ek, vk, von: a, bis: b });
      cursor = plusTage(b, 1);
    }
    if (cursor <= BIS) seg.push({ ek, vk: null, von: cursor, bis: BIS });
  }
  for (const s of seg) s.tage = tageInkl(s.von, s.bis);
  gleich('Abschnitte', nk.ergebnisse.map((e) => [e.segment.einheit.id, e.segment.vertrag?.id ?? null, e.segment.von, e.segment.bis]),
    seg.map((s) => [E[s.ek].id, s.vk ? V[s.vk].id : null, s.von, s.bis]));
  // Allocation keys.
  const flaeche = (s) => E[s.ek].flaeche * s.tage / JAHR;
  const flaecheGesamt = Object.values(E).reduce((x, e) => x + e.flaeche, 0);
  const personen = (s) => (s.vk ? V[s.vk].personen_anzahl : E[s.ek].art === 'Wohnung' ? 1 : 0) * s.tage / JAHR;
  const personenGesamt = seg.reduce((x, s) => x + personen(s), 0);
  const einheiten = (s) => s.tage / JAHR;
  // Meter reading at the end of a day, linear in between.
  const stand = (ek, d) => {
    const st = Object.entries(ABLESUNG).filter(([, w]) => w[ek] != null).map(([dd, w]) => [dd, w[ek]]).sort();
    if (d <= st[0][0]) return st[0][1];
    for (let i = 1; i < st.length; i++) if (d <= st[i][0]) return st[i - 1][1] + (st[i][1] - st[i - 1][1]) * (tageInkl(st[i - 1][0], d) - 1) / (tageInkl(st[i - 1][0], st[i][0]) - 1);
    return st.at(-1)[1];
  };
  const verbrauch = (s) => (Z[s.ek] ? stand(s.ek, s.bis) - stand(s.ek, plusTage(s.von, -1)) : 0);
  const verbrauchGesamt = Object.keys(Z).reduce((x, ek) => x + stand(ek, BIS) - stand(ek, '2024-12-31'), 0);
  const POSTEN = [
    ['Grundsteuer', 185000, flaeche, flaecheGesamt], ['Wasserversorgung', 187220, personen, personenGesamt], ['Entwässerung', 124820, personen, personenGesamt],
    ['Müllbeseitigung', 123600, personen, personenGesamt], ['Gartenpflege', 96000, flaeche, flaecheGesamt], ['Allgemeinstrom / Beleuchtung', 41280, flaeche, flaecheGesamt],
    ['Sach- und Haftpflichtversicherung', 234567, flaeche, flaecheGesamt], ['Hauswart', 180000, einheiten, Object.keys(E).length],
    ['Heizkosten (Brennstoff, Wartung) – Grundkosten (30 %)', 987654 - Math.round(987654 * 0.7), flaeche, flaecheGesamt],
    ['Heizkosten (Brennstoff, Wartung) – Verbrauchskosten (70 %)', Math.round(987654 * 0.7), verbrauch, verbrauchGesamt],
  ];
  gleich('NK Posten', nk.posten.filter((p) => !p.co2).map((p) => [p.label, p.gesamt_ct]).sort(), POSTEN.map(([l, ct]) => [l, ct]).sort());
  const kg = 18000 / flaecheGesamt;
  gleich('CO₂ kg/m²', +nk.co2.kg_pro_qm.toFixed(4), +kg.toFixed(4));
  gleich('CO₂ Stufe (42–47 kg → 70 %)', nk.co2.vermieter_prozent, 70);
  const heizGesamt = 987654;
  for (const [i, s] of seg.entries()) {
    const anteile = {};
    for (const [l, ct, f, g] of POSTEN) anteile[l] = Math.round(ct * f(s) / g);
    const heiz = anteile[POSTEN[8][0]] + anteile[POSTEN[9][0]];
    const co2 = -Math.round(99000 * 70 / 100 * heiz / heizGesamt);
    const kostenSoll = Object.values(anteile).reduce((x, y) => x + y, 0) + co2;
    // Advance payments charged (by due date) within the segment.
    let bk = 0, hk = 0;
    if (s.vk) for (const m of monate('2025-01', '2025-12')) {
      const e = erwartetesSoll(s.vk, m);
      if (e && e.datum >= s.von && e.datum <= s.bis) { bk += e.posten['BK-Vorauszahlung'] ?? 0; hk += e.posten['HK-Vorauszahlung'] ?? 0; }
    }
    const e = nk.ergebnisse[i];
    const ist = Object.fromEntries(nk.posten.map((p, j) => [p.co2 ? 'co2' : p.label, e.anteile[j].ct]));
    gleich(`NK ${s.ek} ${s.vk ?? 'Leerstand'} Anteile`, ist, { ...anteile, co2 });
    gleich(`NK ${s.ek} ${s.vk ?? 'Leerstand'} Ergebnis`, [e.kosten_ct, e.bk_vz_ct, e.hk_vz_ct, e.ergebnis_ct, e.ust_ct],
      [kostenSoll, bk, hk, kostenSoll - bk - hk, s.vk && V[s.vk].ust_satz ? Math.round((kostenSoll - bk - hk) * V[s.vk].ust_satz / 100) : 0]);
  }
  // Not allocable costs stay out; the check flags TV fees booked as allocable antenna costs.
  kosten(41500, '2025-03-01', 12000, 'Kabelanschluss TV-Gebühren');
  const pr = db.nkPruefung(o, '2025-01-01', '2025-12-31', { heizung: 'intern', verbrauchsanteil: 70, ...CO2 });
  gleich('NK-Prüfung meldet Kabel-TV als Fehler', pr.punkte.some((x) => x.stufe === 'fehler' && /Kabel-TV/.test(x.text)), true);
}

// ---------- 10. 15 % rule, Anlage V, VAT ----------
kosten(45100, '2026-03-10', 2500000, 'Dachreparatur');
const an = db.anschaffungsnah(o)[0];
gleich('15-%-Grenze', [an.gebaeude_ct, an.grenze_ct, an.frist], [97200000, 14580000, '2027-05-01']);
gleich('15-%-Grenze netto (19 % heraus)', an.summe_netto_ct, Math.round(2500000 / 1.19));
db.buchen({ objekt_id: o, datum: '2025-04-10', text: 'USt Q1', positionen: [{ soll_id: db.konten(o).find((k) => k.kategorie === 'ust_fa').id, haben_id: bank, betrag_ct: 108300 }] });
{
  // Cash received in 2025 by category: payments settle charges in date order.
  const ein = {};
  const kat = { Miete: 'miete', Sonstiges: 'sonst', 'BK-Vorauszahlung': 'bk', 'HK-Vorauszahlung': 'hk', 'USt 19 %': 'ust19' };
  for (const k of Object.keys(V)) {
    let rest = (ZAHLUNGEN[k] ?? []).filter((z) => z.datum <= '2025-12-31').reduce((s, z) => s + z.ct, 0);
    const lasten = monate('2025-01', '2026-12').map((m) => erwartetesSoll(k, m)).filter(Boolean).sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
    for (const l of lasten) for (const [p, ct] of Object.entries(l.posten)) { const x = Math.min(rest, ct); rest -= x; if (x) ein[kat[p]] = (ein[kat[p]] ?? 0) + x; }
  }
  const av = db.anlageV(o, 2025);
  const zeile = (t) => av.einnahmen.find(([l]) => l.startsWith(t))?.[1] ?? 0;
  gleich('Anlage V Mieteinnahmen', zeile('Mieteinnahmen'), (ein.miete ?? 0) + (ein.sonst ?? 0));
  gleich('Anlage V Umlagen', zeile('Umlagen'), (ein.bk ?? 0) + (ein.hk ?? 0));
  gleich('Anlage V vereinnahmte USt', zeile('Vereinnahmte'), ein.ust19);
  const afa = Math.round(Math.round((120000000 + 9600000) * 75 / 100) * 2 / 100);
  gleich('Anlage V AfA', av.werbungskosten.find(([l]) => /AfA/.test(l))[1], afa);
  const kostenSumme = 185000 + 187220 + 124820 + 123600 + 41280 + 234567 + 180000 + 96000 + 987654 + 120000 + 30000 + 12000;
  gleich('Anlage V Werbungskosten gesamt', av.summe_werbungskosten_ct, afa + kostenSumme + 108300);
  const ust = db.ustUebersicht(o, 2025, { zeitraum: 'quartal', versteuerung: 'soll' });
  gleich('USt Q1 (Soll)', [ust.zeilen[0].kz81_bemessung_ct, ust.zeilen[0].kz81_steuer_ct, ust.zeilen[0].kz83_ct, ust.zeilen[0].gezahlt_ct], [570000, 108300, 108300, 0]);
  gleich('USt Q2 an das Finanzamt gezahlt', ust.zeilen[1].gezahlt_ct, 108300);
  const ist = db.ustUebersicht(o, 2025, { zeitraum: 'monat', versteuerung: 'ist' });
  gleich('USt Ist Jan', ist.zeilen[0].kz81_steuer_ct, 36100);
}

// ---------- 11. Owners' association ----------
const w = db.neuesObjekt({ bezeichnung: 'WEG Parkallee 12', art: 'weg', strasse: 'Parkallee 12', plz: '10117', ort: 'Berlin' });
const WE = [['W1', 70, 250], ['W2', 70, 250], ['W3', 85, 300], ['W4', 55, 200]].map(([b, f, mea], i) => ({ b, mea, id: db.save('einheiten', { objekt_id: w, nr: i + 1, bezeichnung: b, art: 'Wohnung', wohnflaeche: f, mea }) }));
const eig = (i, p, beginn, hg, rl, ende = null) => db.save('eigentum', { einheit_id: WE[i].id, person_id: p, beginn, ende, hausgeld_ct: hg, ruecklage_ct: rl, faelligkeitstag: 1 });
const EIG = [
  { e: 0, id: eig(0, person('Eva', 'Ost'), '2015-01-01', 30000, 6000), von: '2025-01-01', bis: '2025-12-31' },
  { e: 1, id: eig(1, person('Udo', 'Süd', { anrede: 'Herr' }), '2015-01-01', 30000, 6000, '2025-06-30'), von: '2025-01-01', bis: '2025-06-30' },
  { e: 1, id: eig(1, person('Ina', 'West'), '2025-07-01', 30000, 6000), von: '2025-07-01', bis: '2025-12-31' },
  { e: 2, id: eig(2, person('Max', 'Nord', { anrede: 'Herr' }), '2010-01-01', 36000, 7200), von: '2025-01-01', bis: '2025-12-31' },
  { e: 3, id: eig(3, person('Ali', 'Mitte', { anrede: 'Herr' }), '2012-01-01', 24000, 4800), von: '2025-01-01', bis: '2025-12-31' },
];
db.sollstellung(w, '2025-01', '2025-12');
const wk = Object.fromEntries(db.konten(w).map((k) => [k.nr, k.id]));
db.buchen({ objekt_id: w, datum: '2024-12-31', text: 'Eröffnung Rücklage', positionen: [{ soll_id: wk[1210], haben_id: wk[30000], betrag_ct: 2000000 }] });
const wkosten = (nr, datum, ct, gegen = wk[1200]) => db.buchen({ objekt_id: w, datum, text: 'Kosten', positionen: [{ soll_id: wk[nr], haben_id: gegen, betrag_ct: ct }] });
wkosten(41300, '2025-01-15', 240000);
wkosten(41400, '2025-12-31', 360000);
wkosten(45000, '2025-12-31', 144000);
wkosten(40900, '2025-12-20', 48000);
wkosten(45400, '2025-09-01', 500000, wk[1210]);
const wa = db.wegAbrechnung(w, '2025-01-01', '2025-12-31');
{
  const mea = (x, tage) => WE[x.e].mea * tage / 365;
  const anz = (x, tage) => tage / 365;
  // Accounts in number order: power (MEA), insurance (MEA), caretaker (MEA), administrator fee (per unit).
  const P2 = [[48000, mea, 1000], [240000, mea, 1000], [360000, mea, 1000], [144000, anz, 4]];
  for (const x of EIG) {
    const tage = tageInkl(x.von, x.bis);
    const anteile = P2.map(([ct, f, g]) => Math.round(ct * f(x, tage) / g));
    const monateAnz = monate(x.von.slice(0, 7), x.bis.slice(0, 7)).length;
    const hgNetto = (EIG.find((y) => y.id === x.id) && x.e === 2 ? 36000 - 7200 : x.e === 3 ? 24000 - 4800 : 30000 - 6000) * monateAnz;
    const e = wa.ergebnisse.find((r) => r.segment.vertrag.id === x.id);
    const kostenSoll = anteile.reduce((a, b) => a + b, 0);
    gleich(`WEG ${WE[x.e].b} ${x.von} Anteile/Ergebnis`, [e.anteile.map((a) => a.ct), e.kosten_ct, e.hausgeld_soll_ct, e.ergebnis_ct], [anteile, kostenSoll, hgNetto, kostenSoll - hgNetto]);
  }
  gleich('WEG Rücklage', [wa.ruecklage.anfang_ct, wa.ruecklage.zufuehrung_soll_ct, wa.ruecklage.entnahmen_ct, wa.ruecklage.ende_ct],
    [2000000, 12 * (6000 + 6000 + 7200 + 4800), 500000, 2000000 + 12 * 24000 - 500000]);
  // Budget plan 2026: monthly house money rounded up to whole euros, costs and reserve separately.
  const plan = [[wk[41300], 250000], [wk[41400], 370000], [wk[45000], 150000], [wk[40900], 50000]];
  const wp = db.wirtschaftsplanBerechnen(w, 2026, plan.map(([konto_id, betrag_ct]) => ({ konto_id, betrag_ct })), 300000, null);
  const k2 = [[250000, 'mea'], [370000, 'mea'], [150000, 'anz'], [50000, 'mea']];
  for (const [i, e] of WE.entries()) {
    const kosten = k2.reduce((s, [ct, t]) => s + Math.round(t === 'mea' ? ct * e.mea / 1000 : ct / 4), 0);
    const rl = Math.round(300000 * e.mea / 1000);
    const z = wp.zeilen.find((x) => x.einheit.id === e.id);
    gleich(`Wirtschaftsplan ${e.b}`, [z.kosten_ct, z.ruecklage_ct, z.monat_hausgeld_ct, z.monat_ruecklage_ct],
      [kosten, rl, Math.ceil(kosten / 1200) * 100 + Math.ceil(rl / 1200) * 100, Math.ceil(rl / 1200) * 100]);
    void i;
  }
}

// ---------- 12. Rent increase checks ----------
{
  const p = db.mieterhoehungPruefen(V.v1.id, 95000, '2027-01-01', null, '2026-10-10');
  // Last increase 1.8.2025: 15 months → 1.11.2026; received 10.10.2026 → effect from 1.1.2027; consent by 31.12.2026.
  gleich('§ 558 Fristen', [p.frist_ok, p.jahresfrist_ok, p.wirkung_frueh, p.zustimmung_bis], [true, true, '2027-01-01', '2026-12-31']);
  // Rent 3 years before 1.1.2027 (1.1.2024): 780 € → cap 20 % = 936 €; 950 € exceeds it.
  gleich('§ 558 Kappung', [p.basis_ct, p.grenze_ct, p.kappung_ok], [78000, 93600, false]);
  const p2 = db.mieterhoehungPruefen(V.v2.id, 66000, '2026-12-01', null, '2026-08-20');
  // Becker: last change 1.3.2026 (graduated step) → request only from 1.3.2027, effect only from 1.6.2027.
  gleich('§ 558 Sperrfristen nach Staffel', [p2.jahresfrist_ok, p2.verlangen_ab, p2.frist_ok, p2.frueheste_wirkung], [false, '2027-03-01', false, '2027-06-01']);
}

// ---------- 13. Booking the statement, reminder fees, long tenancies ----------
{
  const liste = nk.ergebnisse.filter((e) => e.segment.vertrag).map((e) => ({ konto_id: e.segment.konto_id, ergebnis_ct: e.ergebnis_ct + e.ust_ct }));
  db.abrechnungBuchen(o, 'nk_ergebnis', '2026-05-31', 'Betriebskostenabrechnung 2025', liste);
  const meier = nk.ergebnisse.find((e) => e.segment.vertrag?.id === V.v1.id);
  const op = db.offenePostenKonto(kontoVon('v1'), '2026-06-01');
  if (meier.ergebnis_ct > 0) gleich('Nachzahlung Meier als eigener offener Posten', op.offen.map((x) => [x.datum, x.offen_ct]), [['2026-05-31', meier.ergebnis_ct]]);
  else gleich('Guthaben Meier', op.guthaben_ct, -meier.ergebnis_ct);
  db.mahnen({ konto_id: kontoVon('v2'), stufe: 1, gebuehr_ct: 500, frist: '2026-10-30', datum: STICHTAG, offen_ct: 24000 });
  gleich('Mahngebühr als Forderung', db.offenePostenKonto(kontoVon('v2'), STICHTAG).summe_ct, 24000 + 500 + Math.max(0, nk.ergebnisse.filter((e) => e.segment.vertrag?.id === V.v2.id).reduce((x, e) => x + e.ergebnis_ct, 0))
    - Math.max(0, -nk.ergebnisse.filter((e) => e.segment.vertrag?.id === V.v2.id).reduce((x, e) => x + e.ergebnis_ct, 0)));
  // Schulz since 1.1.2018: more than 8 years at receipt → 9 months for the landlord.
  const r = db.kuendigungBerechnen({ vertrag_id: V.v3.id, durch: 'vermieter', zugang: '2026-10-05' });
  gleich('Vermieterkündigung nach 8 Jahren', [r.frist_monate, r.zum], [9, '2027-06-30']);
}

// ---------- 14. E-invoices (EN 16931) ----------
{
  const er = require('../electron/erechnung.cjs');
  const fs = require('node:fs');
  const lies = (f) => er.lesen(fs.readFileSync(require('node:path').join(__dirname, 'testdaten', f), 'utf8'));
  const cii = lies('erechnung-cii.xml'), ubl = lies('erechnung-ubl.xml');
  gleich('ZUGFeRD (CII)', [cii.syntax, cii.nummer, cii.datum, cii.faellig, cii.verkaeufer.name, cii.verkaeufer.ust_id, cii.iban, cii.netto_ct, cii.ust_ct, cii.zahlbetrag_ct, cii.zeilen.length],
    ['CII', 'RE-2026-0815', '2026-09-14', '2026-09-28', 'Sanitär Krüger GmbH', 'DE123456789', 'DE02120300000000202051', 31840, 6050, 37890, 2]);
  gleich('XRechnung (UBL)', [ubl.syntax, ubl.nummer, ubl.datum, ubl.faellig, ubl.verkaeufer.name, ubl.leistung_von, ubl.leistung_bis, ubl.netto_ct, ubl.ust_ct, ubl.zahlbetrag_ct],
    ['UBL', '2026/4711', '2026-10-02', '2026-10-30', 'Gartenbau Grün & Söhne', '2026-07-01', '2026-09-30', 45000, 8550, 53550]);
  gleich('Kein E-Rechnungs-XML', er.lesen('<?xml version="1.0"?><Document><BkToCstmrStmt/></Document>'), null);
  // Positions add up: net = sum of line totals, gross = net + VAT.
  gleich('CII Summen stimmen', [cii.zeilen.reduce((x, z) => x + z.netto_ct, 0), cii.netto_ct + cii.ust_ct], [cii.netto_ct, cii.brutto_ct]);
}

console.log(`\nRechentest: ${ok} Prüfungen richtig, ${falsch} falsch.`);
if (falsch) process.exitCode = 1;
// The click test reuses the sample data.
module.exports = { db, o, w, V, E, P, falsch };
