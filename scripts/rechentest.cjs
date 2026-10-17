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
// Expected charge of one contract for one month: { datum, posten: { label: ct }, summe }. Rent is a monthly amount:
// the month of moving in or out is charged in full ("anteilig" from older versions counts as full), moving in
// during a month the contract may say "from the next month".
function erwartetesSoll(k, monat) {
  const v = V[k];
  const [y, m] = monat.split('-').map(Number);
  const T = tageImMonat(y, m), erster = `${monat}-01`, letzter = `${monat}-${pad(T)}`;
  if (v.beginn > letzter || (v.ende && v.ende < erster)) return null;
  const beginntHier = v.beginn > erster;
  if (beginntHier && v.teilmonat_beginn === 'folgemonat') return null;
  const b = betraegeAm(k, beginntHier ? v.beginn : erster);
  const posten = {};
  let netto = 0;
  for (const [f, label] of [['kaltmiete_ct', 'Miete'], ['sonstiges_ct', 'Sonstiges'], ['bk_vz_ct', 'BK-Vorauszahlung'], ['hk_vz_ct', 'HK-Vorauszahlung']]) {
    const ct = b[f];
    if (ct > 0) { posten[label] = ct; netto += ct; }
  }
  if (v.ust_satz && netto) posten[`USt ${v.ust_satz} %`] = Math.round(netto * v.ust_satz / 100);
  let datum = v.faelligkeitstag === 0 ? dritterWerktagMiete(monat) : `${monat}-${pad(Math.min(v.faelligkeitstag, T))}`;
  if (beginntHier && datum < v.beginn) datum = v.beginn;
  return { datum, posten, summe: Object.values(posten).reduce((s, x) => s + x, 0) };
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
// Spot checks by hand: Becker moves in on 15 March 2025 (stored as "anteilig" by an old version) and pays the full month,
// Schulz moves out on 20 June and pays June in full, Wagner August (full), Neumann first in November.
gleich('Becker 03/2025 voller Monat 600 € (Einzug 15.3., nicht 17/31)', zeilen.find((x) => x.vertrag_id === V.v2.id && x.monat === '2025-03' && x.posten === 'Miete')?.betrag_ct, 60000);
gleich('Becker gespeichert als „voller Monat“', db.get('mietverhaeltnisse', V.v2.id).teilmonat_beginn, 'voll');
gleich('Becker 03/2025 fällig am Einzug', zeilen.find((x) => x.vertrag_id === V.v2.id && x.monat === '2025-03')?.datum, '2025-03-15');
gleich('Schulz 06/2025 voller Monat 900 € (Auszug 20.6., nicht 20/30)', zeilen.find((x) => x.vertrag_id === V.v3.id && x.monat === '2025-06' && x.posten === 'Miete')?.betrag_ct, 90000);
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
  // Segments by unit: contracts and vacancies. A contract counts for the rent months it is charged for: from the 1st of
  // the month of moving in (the next month with "from the next month") to the end of the month of moving out.
  const VON = '2025-01-01', BIS = '2025-12-31', JAHR = 365;
  const monatsletzter = (d) => `${d.slice(0, 7)}-${pad(tageImMonat(...d.slice(0, 7).split('-').map(Number)))}`;
  const zeitraumMonate = (v) => {
    let von = `${v.beginn.slice(0, 7)}-01`;
    if (v.beginn > von && v.teilmonat_beginn === 'folgemonat') von = plusTage(monatsletzter(v.beginn), 1);
    return { von, bis: v.ende ? monatsletzter(v.ende) : '9999-12-31' };
  };
  const seg = [];
  for (const [ek, e] of Object.entries(E)) {
    const vs = Object.entries(V).filter(([, v]) => v.einheit === ek && zeitraumMonate(v).von <= BIS && zeitraumMonate(v).bis >= VON).sort((a, b) => (a[1].beginn < b[1].beginn ? -1 : 1));
    let cursor = VON;
    for (const [vk, v] of vs) {
      const z = zeitraumMonate(v);
      const a = z.von > VON ? z.von : VON, b = z.bis < BIS ? z.bis : BIS;
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

// ---------- 15. New contract, payment by hand (report of 16.10.2026: 800 € warm, 400 € paid, no arrears shown) ----------
// The charges used to appear only with the next hourly run, so the payment counted as credit. Relative to the
// current month so it holds whenever the test runs: the automation started last month.
{
  const t = api(open(':memory:'));
  const HEUTE = new Date().toISOString().slice(0, 10);
  const monatPlus = (m, n) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm - 1 + n, 1)).toISOString().slice(0, 7); };
  const M = HEUTE.slice(0, 7), VM = monatPlus(M, -1), VVM = monatPlus(M, -2), NM = monatPlus(M, 1);
  const letzterTag = (m) => `${m}-${pad(tageImMonat(...m.split('-').map(Number)))}`;
  t.setzeEinstellungen({ bundesland: 'BE', auto_soll_ab: VM });
  const ob = t.neuesObjekt({ bezeichnung: 'Testhaus', art: 'miete', strasse: 'Teststr. 1', plz: '10115', ort: 'Berlin' });
  const eh = [1, 2, 3].map((nr) => t.save('einheiten', { objekt_id: ob, nr, bezeichnung: `WE0${nr}`, art: 'Wohnung', wohnflaeche: 60 }));
  const pe = ['Test', 'Zukunft', 'Irrtum'].map((n) => t.save('personen', { anrede: 'Herr', vorname: 'Max', nachname: n }));
  const vertrag = (i, beginn, extra = {}) => t.save('mietverhaeltnisse', { einheit_id: eh[i], person_id: pe[i], beginn, kaltmiete_ct: 60000, bk_vz_ct: 12000, hk_vz_ct: 8000,
    personen_anzahl: 1, faelligkeitstag: 0, teilmonat_beginn: 'anteilig', teilmonat_ende: 'anteilig', ust_satz: 0, ...extra });
  const soll = (vid) => Object.fromEntries(Object.entries(t.buchungen(ob, {}).filter((b) => b.art === 'soll' && b.soll_id === t.kontoVon('miete', vid).id)
    .reduce((m, b) => ({ ...m, [b.monat]: (m[b.monat] ?? 0) + b.betrag_ct }), {})).sort());
  const bank = t.konten(ob).find((k) => k.nr === 1200).id;
  const zahlung = (vid, ct) => t.buchen({ objekt_id: ob, datum: HEUTE, text: 'Zahlung', positionen: [{ soll_id: bank, haben_id: t.kontoVon('miete', vid).id, betrag_ct: ct }] });

  const vt = vertrag(0, `${VM}-01`);
  const kk = t.kontoVon('miete', vt).id;
  gleich('Neuer Vertrag: Forderungen sofort gebucht, nicht erst beim nächsten Lauf', soll(vt), { [VM]: 80000, [M]: 80000 });
  gleich('... fällig am 3. Werktag', [...new Set(t.buchungen(ob, {}).filter((b) => b.art === 'soll').map((b) => b.datum))].sort(), [dritterWerktagMiete(VM), dritterWerktagMiete(M)].sort());
  gleich('Stündlicher Lauf bucht nichts doppelt', t.automatikLauf().erzeugt, 0);
  zahlung(vt, 40000);
  const faelligM = dritterWerktagMiete(M) <= HEUTE, verzugM = dritterWerktagMiete(M) < HEUTE;
  gleich('800 € fällig, 400 € gezahlt: 400 € offen', t.offenePostenKonto(kk, HEUTE).offen.map((x) => [x.monat, x.offen_ct, x.status]),
    [[VM, 40000, 'teilweise bezahlt'], ...(faelligM ? [[M, 80000, 'nicht bezahlt']] : [])]);
  gleich('Vertragsseite: Rückstand', t.vertragAkte('miete', vt).vertrag.ueberfaellig_ct, 40000 + (verzugM ? 80000 : 0));
  const ks = t.kontoStatus(kk, HEUTE);
  gleich('Zahlungsformular: Stand und nächste Fälligkeit', [ks.saldo_ct, ks.guthaben_ct, ks.naechste.datum, ks.naechste.betrag_ct],
    [40000 + (faelligM ? 80000 : 0), 0, faelligM ? dritterWerktagMiete(NM) : dritterWerktagMiete(M), 80000]);

  // Corrections reach the charges at once: contract amount, rent change from this month, its removal.
  t.save('mietverhaeltnisse', { id: vt, kaltmiete_ct: 70000 });
  gleich('Vertrag korrigiert: Forderungen folgen', soll(vt), { [VM]: 90000, [M]: 90000 });
  const an = t.save('anpassungen', { vertrag_typ: 'miete', vertrag_id: vt, gueltig_ab: `${M}-01`, grund: 'erhoehung', kaltmiete_ct: 75000 });
  gleich('Mietanpassung ab diesem Monat', soll(vt), { [VM]: 90000, [M]: 95000 });
  t.remove('anpassungen', an);
  gleich('Mietanpassung gelöscht', soll(vt), { [VM]: 90000, [M]: 90000 });
  // Start on the 15th of last month: the full month (rent is a monthly amount, never by day), due on the day of moving in.
  t.save('mietverhaeltnisse', { id: vt, beginn: `${VM}-15` });
  gleich('Beginn am 15.: voller Monat, nicht tageweise', soll(vt), { [VM]: 90000, [M]: 90000 });
  gleich('... fällig am Einzug', [...new Set(t.buchungen(ob, {}).filter((b) => b.art === 'soll' && b.monat === VM).map((b) => b.datum))], [`${VM}-15`]);
  t.save('mietverhaeltnisse', { id: vt, teilmonat_beginn: 'anteilig' });
  gleich('... „anteilig“ (alte Einstellung) wird zum vollen Monat', [t.get('mietverhaeltnisse', vt).teilmonat_beginn, soll(vt)], ['voll', { [VM]: 90000, [M]: 90000 }]);
  t.save('mietverhaeltnisse', { id: vt, teilmonat_beginn: 'folgemonat' });
  gleich('... erst ab Folgemonat', soll(vt), { [M]: 90000 });

  // A start before the automation: the months before are offered, not booked by themselves.
  t.save('mietverhaeltnisse', { id: vt, beginn: `${VVM}-01`, teilmonat_beginn: 'anteilig' });
  gleich('Früherer Beginn: Monate davor nur angeboten', [t.sollAbgleich('miete', vt).fehlend.map((f) => [f.monat, f.betrag_ct]), soll(vt)],
    [[[VVM, 90000]], { [VM]: 90000, [M]: 90000 }]);
  t.sollAbgleich('miete', vt, { nachholen: true });
  gleich('... nach Zustimmung gebucht', soll(vt), { [VVM]: 90000, [VM]: 90000, [M]: 90000 });
  t.save('mietverhaeltnisse', { id: vt, kaltmiete_ct: 60000 });
  gleich('Ältere Monate: Änderung wird angeboten, nicht still gebucht', [t.sollAbgleich('miete', vt).aenderungen.map((a) => [a.monat, a.alt_ct, a.neu_ct]), soll(vt)],
    [[[VVM, 90000, 80000]], { [VVM]: 90000, [VM]: 80000, [M]: 80000 }]);
  gleich('Sollstellung zeigt die Abweichung', t.sollstellung(ob, VVM, VVM, true).filter((z) => z.abweichend).map((z) => [z.posten, z.vorhanden_ct, z.betrag_ct]), [['Miete', 70000, 60000]]);
  gleich('Prüfbericht meldet die Abweichung', t.pruefbericht().punkte.some((p) => p.schluessel.startsWith(`sollabw:miete:${vt}:`)), true);
  t.setzeEinstellungen({ festgeschrieben_bis: letzterTag(VVM) });
  t.sollAbgleich('miete', vt, { anwenden: true });
  gleich('Festgeschriebener Monat bleibt unverändert', [t.sollAbgleich('miete', vt).aenderungen.map((a) => [a.monat, a.gesperrt]), soll(vt)[VVM]], [[[VVM, true]], 90000]);
  t.setzeEinstellungen({ festgeschrieben_bis: null });
  t.sollAbgleich('miete', vt, { anwenden: true });
  gleich('... nach Aufheben der Sperre angepasst', [soll(vt)[VVM], t.sollAbgleich('miete', vt).aenderungen.length], [80000, 0]);

  // New contracts start on the 1st of next month by default: a payment before that is credit, the first rent is shown.
  const vz = vertrag(1, `${NM}-01`);
  zahlung(vz, 40000);
  const opz = t.offenePostenKonto(t.kontoVon('miete', vz).id, HEUTE);
  gleich('Beginn nächster Monat: nichts fällig, Zahlung als Guthaben', [soll(vz), opz.offen.length, opz.guthaben_ct], [{}, 0, 40000]);
  gleich('... erste Fälligkeit angezeigt', t.vertragAkte('miete', vz).naechste, { monat: NM, datum: dritterWerktagMiete(NM), betrag_ct: 80000 });

  // A contract entered by mistake can be deleted while it only carries automatic charges; with a payment it stays.
  const vi = vertrag(2, `${VM}-01`);
  const ki = t.kontoVon('miete', vi).id;
  t.remove('mietverhaeltnisse', vi);
  gleich('Irrtümlicher Vertrag gelöscht samt Forderungen', [t.get('mietverhaeltnisse', vi) ?? null, t.get('konten', ki) ?? null,
    t.buchungen(ob, {}).filter((b) => b.soll_id === ki).length], [null, null, 0]);
  let meldung = null;
  try { t.remove('mietverhaeltnisse', vt); } catch (e) { meldung = e.message; }
  gleich('Vertrag mit Zahlung bleibt', /Zahlungen/.test(meldung ?? ''), true);

  // Automation switched off: saving books nothing, the months are offered.
  t.setzeEinstellungen({ auto_soll: '0' });
  const va = vertrag(2, `${VM}-01`);
  gleich('Automatik aus: nichts gebucht, Monate angeboten', [soll(va), t.sollAbgleich('miete', va).fehlend.map((f) => f.monat)], [{}, [VM, M]]);
}

// ---------- 16. Key figures and self-use (pick of 16.10.2026: K1–K7, K9, M1–M5, M7, E1–E5, N1–N5, Z1) ----------
// A small house: EG (60 m², Anna), 1. OG (80 m², Bernd until 31.05.2025, vacant June/July, Carla from 01.08.2025),
// DG (100 m², the landlord's own flat since 01.06.2024, 2 persons) and a parking space (Paul). Every figure is recomputed
// here on its own: payments in first-in-first-out order, shares by area and day, keys by person-days.
{
  const S = '2026-10-16';
  const k = api(open(':memory:'));
  k.setzeEinstellungen({ bundesland: 'BE', verwalter_name: 'Test', auto_soll: '0' });
  const ko = k.neuesObjekt({ bezeichnung: 'Testhaus Selbstnutzung', art: 'miete', strasse: 'Teststr. 1', plz: '10115', ort: 'Berlin',
    kaufpreis_ct: 60000000, kaufnebenkosten_ct: 4800000, kaufdatum: '2024-03-01', gebaeudeanteil: 80, afa_satz: 2,
    vergleichsmiete_ct: 1200, mietspiegel_von_ct: 1000, mietspiegel_bis_ct: 1400 });
  const FL = { A: 60, B: 80, C: 100, P: 0 };
  const KE = {};
  [['A', 'EG', 'Wohnung'], ['B', '1. OG', 'Wohnung'], ['C', 'DG', 'Wohnung'], ['P', 'Stellplatz', 'Stellplatz']]
    .forEach(([x, b, art], i) => { KE[x] = k.save('einheiten', { objekt_id: ko, nr: i + 1, bezeichnung: b, art, wohnflaeche: FL[x] }); });
  const kp = (n) => k.save('personen', { vorname: 'Test', nachname: n });
  const KV = {
    anna: { einheit: 'A', person_id: kp('Anna'), beginn: '2022-01-01', kaltmiete_ct: 60000, bk_vz_ct: 12000, hk_vz_ct: 8000, personen_anzahl: 2, faelligkeitstag: 0, kaution_ct: 180000 },
    bernd: { einheit: 'B', person_id: kp('Bernd'), beginn: '2020-06-01', ende: '2025-05-31', kaltmiete_ct: 80000, bk_vz_ct: 15000, hk_vz_ct: 10000, personen_anzahl: 1, faelligkeitstag: 0 },
    carla: { einheit: 'B', person_id: kp('Carla'), beginn: '2025-08-01', kaltmiete_ct: 96000, bk_vz_ct: 16000, hk_vz_ct: 11000, personen_anzahl: 3, faelligkeitstag: 0 },
    paul: { einheit: 'P', person_id: kp('Paul'), beginn: '2023-01-01', kaltmiete_ct: 5000, bk_vz_ct: 0, hk_vz_ct: 0, personen_anzahl: 0, faelligkeitstag: 1 },
  };
  for (const v of Object.values(KV)) {
    const { einheit, ...row } = v;
    v.id = k.save('mietverhaeltnisse', { ...row, einheit_id: KE[einheit], teilmonat_beginn: 'anteilig', teilmonat_ende: 'anteilig', ust_satz: 0 });
  }
  const selbstId = k.save('selbstnutzung', { einheit_id: KE.C, beginn: '2024-06-01', personen: 2 });
  k.sollstellung(ko, '2025-01', '2026-10');
  const kkt = Object.fromEntries(k.konten(ko).map((x) => [x.nr, x.id]));
  const kbank = kkt[1200];
  const kKonto = (x) => k.kontoVon('miete', KV[x].id).id;
  const KZAHL = {};
  const kzahle = (x, datum, ct, text = `Zahlung ${x}`) => {
    (KZAHL[x] ??= []).push({ datum, ct });
    return k.buchen({ objekt_id: ko, datum, text, art: 'bank', positionen: [{ soll_id: kbank, haben_id: kKonto(x), betrag_ct: ct }] });
  };
  const faellig = (x, m) => (KV[x].faelligkeitstag === 0 ? dritterWerktagMiete(m) : `${m}-${pad(KV[x].faelligkeitstag)}`);
  const summeMonat = (x) => KV[x].kaltmiete_ct + KV[x].bk_vz_ct + KV[x].hk_vz_ct;
  for (const m of monate('2025-01', '2026-10')) {
    // Anna: March 2026 five days late, September 2026 missed. Carla: September and October 2026 missed.
    if (m === '2026-03') kzahle('anna', plusTage(faellig('anna', m), 5), summeMonat('anna'));
    else if (m !== '2026-09') kzahle('anna', faellig('anna', m), summeMonat('anna'));
    if (m <= '2025-05') kzahle('bernd', faellig('bernd', m), summeMonat('bernd'));
    if (m >= '2025-08' && m <= '2026-08') kzahle('carla', faellig('carla', m), summeMonat('carla'));
    kzahle('paul', faellig('paul', m), 5000);
  }
  const KOST = [];
  const kkosten = (nr, datum, ct, text, einheit_id = null) => {
    KOST.push({ nr, datum, ct });
    return k.buchen({ objekt_id: ko, datum, text, einheit_id, positionen: [{ soll_id: kkt[nr], haben_id: kbank, betrag_ct: ct }] });
  };
  for (const d of ['2025-02-15', '2025-05-15', '2025-08-15', '2025-11-15', '2026-02-15', '2026-05-15', '2026-08-15']) kkosten(40100, d, 30000, 'Grundsteuer');
  kkosten(40200, '2025-12-10', 240000, 'Wasser');
  kkosten(41300, '2025-01-20', 120000, 'Gebäudeversicherung');
  kkosten(41400, '2025-12-31', 96000, 'Hauswart');
  kkosten(45000, '2025-12-31', 60000, 'Verwaltung');
  kkosten(45100, '2025-07-15', 300000, 'Renovierung 1. OG', KE.B);
  kkosten(45100, '2025-09-01', 200000, 'Bad DG', KE.C);
  const dach = kkosten(45100, '2025-10-01', 150000, 'Dachreparatur');
  k.steuerangabenSetzen(ko, 2025, { schuldzinsen_ct: 900000 });
  k.darlehenSpeichern({ objekt_id: ko, bank: 'Testbank', betrag_ct: 20000000, auszahlung: '2024-04-01', zinssatz: 3, tilgung_satz: 2, erste_rate: '2024-04-30', zinsbindung_bis: '2034-04-30' });
  k.save('versicherungen', { objekt_id: ko, art: 'Gebäudeversicherung', gesellschaft: 'Test-Versicherung', beitrag_ct: 125000, faellig: '2026-01-10', kuendbar_bis: '2026-11-30' });
  const kau = k.kautionAnlegen(KV.anna.id);
  k.save('kautionen', { id: kau, art: 'konto', zinssatz: 0.5, bank: 'Testbank' });
  k.save('kautionsbewegungen', { kaution_id: kau, datum: '2022-01-01', art: 'einzahlung', betrag_ct: 180000 });
  k.save('kautionsbewegungen', { kaution_id: kau, datum: '2025-12-31', art: 'zinsen', betrag_ct: 450 });
  const KZ = {};
  for (const x of ['A', 'B', 'C']) KZ[x] = k.save('zaehler', { objekt_id: ko, einheit_id: KE[x], art: 'kaltwasser', nummer: `KW-${x}`, einheit: 'm³', faktor: 1 });
  k.ablesung('2023-12-31', { [KZ.A]: 100, [KZ.B]: 200, [KZ.C]: 50 });
  k.ablesung('2024-12-31', { [KZ.A]: 160, [KZ.B]: 280, [KZ.C]: 90 });
  k.ablesung('2025-12-31', { [KZ.A]: 250, [KZ.B]: 350, [KZ.C]: 140 });

  // ----- N1: the own flat is neither vacant nor up for letting -----
  gleich('N1 Einheit selbst genutzt, nicht leer', [k.einheiten(ko).find((e) => e.id === KE.C).selbstgenutzt, k.objektKacheln('miete').find((x) => x.id === ko).leer,
    k.objektKacheln('miete').find((x) => x.id === ko).selbst, k.vermietung(ko).map((e) => e.id), k.einheitAkte(KE.C).leertage], [1, 0, 1, [], 0]);
  gleich('N1 kein Leerstand-Hinweis für die eigene Wohnung', k.hinweise().filter((h) => h.schluessel.startsWith(`leer:${ko}:`)).length, 0);
  const vUeber = k.save('mietverhaeltnisse', { einheit_id: KE.C, person_id: KV.paul.person_id, beginn: '2026-11-01', kaltmiete_ct: 100000, personen_anzahl: 1, faelligkeitstag: 0 });
  gleich('N1 Prüfbericht: Mietvertrag überschneidet die Selbstnutzung', k.pruefbericht().punkte.filter((p) => p.schluessel === `selbstmiete:${selbstId}:${vUeber}`).map((p) => p.stufe), ['fehler']);
  k.remove('mietverhaeltnisse', vUeber);
  gleich('N1 ohne Überschneidung keine Meldung', k.pruefbericht().punkte.filter((p) => /^selbst/.test(p.schluessel)).length, 0);

  // ----- N2: service charges 2025 with the landlord's own share -----
  const SEG = [
    { e: 'A', v: KV.anna.id, von: '2025-01-01', bis: '2025-12-31', personen: 2 },
    { e: 'B', v: KV.bernd.id, von: '2025-01-01', bis: '2025-05-31', personen: 1 },
    { e: 'B', v: 'leer', von: '2025-06-01', bis: '2025-07-31', personen: 1 },
    { e: 'B', v: KV.carla.id, von: '2025-08-01', bis: '2025-12-31', personen: 3 },
    { e: 'C', v: 'selbst', von: '2025-01-01', bis: '2025-12-31', personen: 2 },
    { e: 'P', v: KV.paul.id, von: '2025-01-01', bis: '2025-12-31', personen: 0 },
  ];
  const UMLAGE25 = [[120000, 'flaeche'], [240000, 'personen'], [120000, 'flaeche'], [96000, 'flaeche']];
  const wertSeg = (x, key) => (key === 'flaeche' ? FL[x.e] : x.personen) * tageInkl(x.von, x.bis) / 365;
  const gesamtKey = (key) => (key === 'flaeche' ? 240 : SEG.reduce((y, x) => y + wertSeg(x, 'personen'), 0));
  const anteilSeg = (x) => UMLAGE25.reduce((y, [ct, key]) => y + Math.round(ct * wertSeg(x, key) / gesamtKey(key)), 0);
  const nk25 = k.nkAbrechnung(ko, '2025-01-01', '2025-12-31');
  gleich('N2 Abschnitte: Mieter, Leerstand, Selbstnutzung', nk25.ergebnisse.map((e) => [e.segment.einheit.id, e.segment.vertrag?.id ?? (e.segment.selbst ? 'selbst' : 'leer'), e.segment.von, e.segment.bis]),
    SEG.map((x) => [KE[x.e], x.v, x.von, x.bis]));
  gleich('N2 Kosten je Abschnitt (eigene Wohnung mit 2 Personen)', nk25.ergebnisse.map((e) => e.kosten_ct), SEG.map(anteilSeg));
  gleich('N2 Eigenanteil getrennt vom Leerstand', [nk25.eigenanteil_ct, nk25.leerstand_ct], [anteilSeg(SEG[4]), anteilSeg(SEG[2])]);
  gleich('N2 Prüfung nennt den Eigenanteil', k.nkPruefung(ko, '2025-01-01', '2025-12-31').punkte.some((p) => p.text.includes(`entfallen ${new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(anteilSeg(SEG[4]) / 100)} (Eigenanteil)`)), true);

  // ----- N4: what the own flat costs per month (operating costs 2025, interest by area, maintenance 2023–2025) -----
  const n4 = k.selbstKosten(KE.C, S);
  gleich('N4 Kosten der eigenen Wohnung', n4.posten.map((x) => x.ct), [Math.round(anteilSeg(SEG[4]) / 12), Math.round(900000 * 100 / 240 / 12), Math.round((200000 + 150000 * 100 / 240) / 36)]);
  gleich('N4 vermietet brächte sie', [n4.fiktiv_ct, n4.qm_ct, n4.quelle, n4.monat_ct], [120000, 1200, 'objekt', n4.posten.reduce((x, p) => x + p.ct, 0)]);
  gleich('N4 nur für selbst genutzte Einheiten', k.selbstKosten(KE.A, S), null);

  // ----- N3: Anlage V 2025 only for the rented part (140 of 240 m² all year = 7/12) -----
  const A7 = 7 / 12;
  const afaGanz = Math.round((60000000 + 4800000) * 80 / 100 * 2 / 100);
  const av = k.anlageV(ko, 2025);
  gleich('N3 vermieteter Anteil nach Fläche und Tagen', [Math.round(av.selbstnutzung.anteil * 1e9), av.selbstnutzung.flaeche_vermietet], [Math.round(A7 * 1e9), 140]);
  gleich('N3 gesamt und absetzbar je Zeile', av.selbstnutzung.zeilen.map(([l, g, a]) => [l.split(' ')[0], g, a]), [
    ['Absetzung', afaGanz, Math.round(afaGanz * A7)],
    ['Schuldzinsen', 900000, Math.round(900000 * A7)],
    ['Erhaltungsaufwendungen', 650000, 300000 + Math.round(150000 * A7)],
    ['Grundsteuer,', 576000, [120000, 240000, 120000, 96000].reduce((x, ct) => x + Math.round(ct * A7), 0)],
    ['Verwaltungskosten', 60000, Math.round(60000 * A7)],
  ]);
  gleich('N3 Summe Werbungskosten', av.summe_werbungskosten_ct, Math.round(afaGanz * A7) + Math.round(900000 * A7) + 300000 + Math.round(150000 * A7) + 576000 * 7 / 12 + Math.round(60000 * A7));
  gleich('N3 Jahr ohne Selbstnutzung bleibt ungeteilt', k.anlageV(ko, 2023).selbstnutzung, null);
  const erhaltung = () => k.anlageV(ko, 2025).werbungskosten.find(([l]) => l.startsWith('Erhaltung'))[1];
  k.buchungEinheitSetzen(dach, KE.C);
  const dachEigen = erhaltung();
  k.buchungEinheitSetzen(dach, KE.A);
  const dachVermietet = erhaltung();
  k.buchungEinheitSetzen(dach, null);
  gleich('N3 Dach der eigenen / einer vermieteten Einheit zugeordnet', [dachEigen, dachVermietet, erhaltung()], [300000, 450000, 300000 + Math.round(150000 * A7)]);
  // 15 % rule for the rented part: area-days from purchase (01.03.2024) to 01.03.2027, self-use from 01.06.2024.
  const a15 = 1 - 100 * tageInkl('2024-06-01', '2027-03-01') / (240 * tageInkl('2024-03-01', '2027-03-01'));
  const geb15 = Math.round(Math.round((60000000 + 4800000) * 80 / 100) * a15);
  const w15 = k.anschaffungsnah(ko)[0];
  gleich('15 % anteilig: Gebäudeteil und Grenze', [w15.gebaeude_ct, w15.grenze_ct], [geb15, Math.round(geb15 * 0.15)]);
  gleich('15 % anteilig: Kosten (vermietet voll, eigene nicht, Haus anteilig)', [w15.summe_netto_ct, w15.summe_brutto_ct],
    [Math.round(300000 / 1.19) + Math.round(Math.round(150000 / 1.19) * a15), 300000 + Math.round(150000 * a15)]);

  // ----- N5: yield of the rented part, or as if the own flat were let at the comparative rent -----
  const r25 = k.rendite(ko, 2).zeilen.find((z) => z.jahr === 2025);
  const kostenTeil = 300000 + Math.round(150000 * A7) + [120000, 240000, 120000, 96000].reduce((x, ct) => x + Math.round(ct * A7), 0) + Math.round(60000 * A7);
  gleich('N5 Kaltmiete und Umlagen 2025 (alles pünktlich bezahlt)', [r25.ist_kaltmiete_ct, r25.umlagen_ct],
    [12 * 60000 + 5 * 80000 + 5 * 96000 + 12 * 5000, 12 * 20000 + 5 * 25000 + 5 * 27000]);
  gleich('N5 vermieteter Teil: Kosten, Überschuss, Kaufpreisanteil', [r25.selbst.kosten_ct, r25.selbst.netto_ct, r25.selbst.invest_ct],
    [kostenTeil, r25.ist_kaltmiete_ct + r25.umlagen_ct - kostenTeil, Math.round(64800000 * A7)]);
  gleich('N5 Rendite vermieteter Teil', r25.selbst.netto_rendite.toFixed(9), (r25.selbst.netto_ct / (64800000 * A7) * 100).toFixed(9));
  gleich('N5 als ob vermietet', [r25.selbst.fiktiv_kaltmiete_ct, r25.selbst.eigenanteil_ct, r25.selbst.fiktiv_netto_ct, r25.selbst.fiktiv_netto_rendite.toFixed(9)],
    [1440000, anteilSeg(SEG[4]), r25.netto_ct + 1440000 + anteilSeg(SEG[4]), ((r25.netto_ct + 1440000 + anteilSeg(SEG[4])) / 64800000 * 100).toFixed(9)]);
  k.steuerangabenSetzen(ko, 2025, { schuldzinsen_ct: 900000, zins_anteil: 90 });
  gleich('N3 eigener Zinsanteil 90 %', k.anlageV(ko, 2025).werbungskosten.find(([l]) => l === 'Schuldzinsen')[1], 810000);
  gleich('N4 Zinsen mit eigenem Satz: 10 % trägt die eigene Wohnung', k.selbstKosten(KE.C, S).posten[1].ct, Math.round(900000 * 0.1 / 12));

  // ----- M1–M3: payment behaviour, calendar and account history, recomputed in first-in-first-out order -----
  function erwartet(x, stichtag, anzahl = 24) {
    const lasten = monate('2025-01', '2026-10').filter((m) => `${m}-31` >= KV[x].beginn && (!KV[x].ende || `${m}-01` <= KV[x].ende))
      .map((m) => ({ monat: m, datum: faellig(x, m), ct: summeMonat(x) })).filter((l) => l.datum <= stichtag);
    const zahlungen = (KZAHL[x] ?? []).filter((z) => z.datum <= stichtag).sort((a, b) => a.datum.localeCompare(b.datum));
    let schwelle = 0;
    const gesamt = zahlungen.reduce((y, z) => y + z.ct, 0);
    for (const l of lasten) {
      l.von = schwelle; schwelle += l.ct;
      let lauf = 0;
      l.am = gesamt >= schwelle ? zahlungen.find((z) => (lauf += z.ct) >= schwelle).datum : null;
      l.bezahlt = Math.max(0, Math.min(l.ct, gesamt - l.von));
    }
    const [y, m] = stichtag.split('-').map(Number);
    const liste = Array.from({ length: anzahl }, (_, i) => {
      const d = new Date(Date.UTC(y, m - anzahl + i, 1)).toISOString().slice(0, 7);
      const l = lasten.find((q) => q.monat === d);
      if (!l) return [d, 'keine', 0];
      if (!l.am) return [d, l.datum === stichtag ? 'kuenftig' : 'offen', l.datum === stichtag ? 0 : tageInkl(l.datum, stichtag) - 1];
      return l.am <= l.datum ? [d, 'puenktlich', 0] : [d, 'verspaetet', tageInkl(l.datum, l.am) - 1];
    });
    const due = liste.filter(([, st]) => ['puenktlich', 'verspaetet', 'offen'].includes(st));
    const punkte = due.reduce((s2, [, st, t]) => s2 + (st === 'puenktlich' ? 100 : st === 'verspaetet' ? Math.max(0, 100 - 4 * t) : 0), 0);
    const offen = due.filter(([, st]) => st === 'offen').length;
    const score = due.length ? Math.max(0, Math.min(100, Math.round(punkte / due.length - 15 * offen))) : null;
    return { liste, score, label: score >= 85 ? 'zuverlässig' : score >= 70 ? 'meist pünktlich' : score >= 60 ? 'unregelmäßig' : 'kritisch', lasten };
  }
  for (const x of ['anna', 'carla', 'paul']) {
    const z = k.zahlungsverhalten('miete', KV[x].id, { stichtag: S });
    const e = erwartet(x, S);
    gleich(`M2 Zahlungskalender ${x}`, z.monate.map((q) => [q.monat, q.status, q.tage ?? 0]), e.liste);
    gleich(`M1 Zahlungsverhalten ${x}`, [z.score, z.label], [e.score, e.label]);
  }
  gleich('M1 von Hand: Anna 19 pünktlich, März 5 Tage, September 32 Tage, Oktober offen', (() => {
    const z = k.zahlungsverhalten('miete', KV.anna.id, { stichtag: S });
    return [z.faellig, z.puenktlich, z.verspaetet, z.offen, z.score, z.monate.find((q) => q.monat === '2026-09').tage];
  })(), [22, 19, 2, 1, Math.round((19 * 100 + 80) / 22 - 15), 32]);
  const verlauf = k.kontoverlauf('miete', KV.anna.id, { stichtag: S });
  gleich('M3 Kontoverlauf Anna (Monatsende und heute)', [verlauf.length, verlauf.slice(0, -2).every((p) => p.ct === 0), verlauf.slice(-2)],
    [24, true, [{ datum: '2026-09-30', ct: 80000 }, { datum: S, ct: 80000 }]]);

  // ----- M4, M5, M7 -----
  const mk = k.mieterKennzahlen(KV.anna.id, S);
  gleich('M4 Mietverhältnis in Zahlen', [mk.fakten.jahre, mk.fakten.monate, mk.fakten.gezahlt_ct, mk.fakten.kalt_aenderung, mk.fakten.frist_monate],
    [4, 9, KZAHL.anna.reduce((x, z) => x + z.ct, 0), 0, 3]);
  // § 558: unchanged since 01.01.2022, receipt in three days → effect 01.01.2027; 12,00 €/m² × 60 m² = 720 €, cap 20 % of 600 € = 720 €.
  gleich('M4 nächste Schritte', mk.fakten.schritte.map((x) => [x.datum, x.art, x.plus_ct ?? null]), [['2027-01-01', '558', 12000], ['2027-01-01', 'frist', null]]);
  gleich('M5 Miete je m² im Vergleich', [mk.vergleich.qm_ct, mk.vergleich.haus_ct, mk.vergleich.von_ct, mk.vergleich.bis_ct, mk.vergleich.mittel_ct],
    [1000, Math.round((60000 + 96000) / 140), 1000, 1400, 1200]);
  gleich('M7 Kaution', [mk.kaution.vereinbart_ct, mk.kaution.bestand_ct, mk.kaution.raten, mk.kaution.zinsen_vorjahr_ct, mk.kaution.quote], [180000, 180450, 1, 450, 1]);

  // ----- E1–E4 for the 1st floor (Bernd → 61 days vacant → Carla) -----
  const ek = k.einheitKennzahlen(KE.B, S);
  // Vacancy costs whole months without rent: June and July (not 61/365 of a year's rent).
  const leer61 = 2 * 80000;
  gleich('E1 Belegung seit 2020', ek.belegung.segmente.map((x) => [x.art, x.von, x.bis, x.tage, x.entgangen_ct ?? null]), [
    ['miete', '2020-06-01', '2025-05-31', tageInkl('2020-06-01', '2025-05-31'), null], ['leer', '2025-06-01', '2025-07-31', 61, leer61],
    ['miete', '2025-08-01', S, tageInkl('2025-08-01', S), null]]);
  gleich('E1 Quote und Wechsel', [ek.belegung.quote.toFixed(9), ek.belegung.wechsel, ek.belegung.leer_jahr],
    [(1 - 61 / tageInkl('2020-06-01', S)).toFixed(9), 1, 0]);
  gleich('E2 Ertrag je Jahr (Soll, gezahlt, Kosten der Einheit)', ek.ertrag.map((x) => [x.jahr, x.soll_ct, x.ist_ct, x.kosten_ct]),
    [[2025, 5 * 80000 + 5 * 96000, 5 * 80000 + 5 * 96000, 300000], [2026, 10 * 96000, 8 * 96000, 0]]);
  gleich('E4 Mieterwechsel', [ek.wechsel.posten.map((x) => [x.label, x.ct]), ek.wechsel.summe_ct, ek.wechsel.schnitt_jahre.toFixed(9)],
    [[['Leerstand 61 Tage (2 Monate ohne Miete)', leer61], ['Renovierung und Reparaturen', 300000]], leer61 + 300000,
      ((tageInkl('2020-06-01', '2025-05-31') + tageInkl('2025-08-01', S)) / 2 / 365.25).toFixed(9)]);
  const e3 = k.einheitKennzahlen(KE.A, S).verbrauch;
  gleich('E3 Kaltwasser je m² gegen Haus und Vorjahr', e3.map((x) => [x.art, x.jahr, x.wert, x.vorjahr, x.qm, x.haus_qm, x.aenderung]),
    [['kaltwasser', 2025, 90, 60, 1.5, 210 / 240, 50]]);
  gleich('E3 großer Sprung wird gemeldet (nur EG: +50 %)', k.verbrauchSpruenge(S).map((x) => [x.einheit_id, x.art, x.aenderung]), [[KE.A, 'kaltwasser', 50]]);
  gleich('E3 Hinweis im Cockpit', k.hinweise().some((h) => h.schluessel === `verbrauch:${KE.A}:kaltwasser:2025`), true);

  // ----- E5: house view by floor -----
  gleich('E5 Hausansicht', k.hausansicht(ko, 'miete', S).map((f) => [f.name, f.einheiten.map((x) => [x.id, x.status, x.betrag_ct ?? 0])]), [
    ['DG', [[KE.C, 'selbst', 0]]], ['1. OG', [[KE.B, 'rueckstand', 246000]]], ['EG', [[KE.A, 'rueckstand', 80000]]], ['Außen', [[KE.P, 'vermietet', 0]]]]);

  // ----- Cockpit -----
  const c = k.cockpitKennzahlen('miete', S);
  gleich('K1 Mieteingang Oktober (älteste Monate zuerst bezahlt)', [c.eingang.soll_ct, c.eingang.ist_ct, c.eingang.offen.map((x) => [x.vertrag_id, x.offen_ct, x.faellig])],
    [80000 + 123000 + 5000, 5000, [[KV.carla.id, 123000, faellig('carla', '2026-10')], [KV.anna.id, 80000, faellig('anna', '2026-10')]]]);
  gleich('K3 Rückstände nach Alter', [c.rueckstaende.stufen.map((x) => x.ct), c.rueckstaende.summe_ct], [[80000 + 123000, 123000, 0, 0], 326000]);
  gleich('K3 § 543: zwei Monatsmieten offen', c.rueckstaende.p543.map((x) => [x.vertrag_id, x.ct, x.monatsmieten, x.folge]), [[KV.carla.id, 246000, 2, true]]);
  const c2 = k.cockpitKennzahlen('miete', '2026-06-30');
  gleich('K2 Vermietung 12 Monate (Fläche × Tage, eigene Wohnung zählt nicht; Leerstand Juli = 1 Monatsmiete)', [c2.vermietung.quote.toFixed(9), c2.vermietung.leerstand_ct, c2.vermietung.vermietet, c2.vermietung.selbst, c2.vermietung.leer],
    [((60 * 365 + 80 * 334) / (60 * 365 + 80 * 365)).toFixed(9), 80000, 3, 1, 0]);
  // K4: expected rent at the share and delay of the last 12 months, loan instalments, insurance, last year's recurring costs.
  const quote = (x) => { const e = erwartet(x, S, 12); const due = e.lasten.filter((l) => l.datum >= '2025-11-01'); return due.reduce((y, l) => y + l.bezahlt, 0) / due.reduce((y, l) => y + l.ct, 0); };
  const verzug = (x) => { const e = erwartet(x, S, 12).liste.filter(([, st]) => st === 'puenktlich' || st === 'verspaetet'); return Math.round(e.reduce((y, [, st, t]) => y + (st === 'verspaetet' ? t : 0), 0) / e.length); };
  const EIN = [];
  for (const x of ['anna', 'carla', 'paul']) for (const m of ['2026-11', '2026-12', '2027-01']) {
    const d = plusTage(faellig(x, m), verzug(x));
    if (d <= '2027-01-14') EIN.push([d, Math.round(summeMonat(x) * quote(x))]);
  }
  const AUS = [['2026-10-30', -83333], ['2026-11-30', -83333], ['2026-12-30', -83333], ['2027-01-10', -125000], ['2026-11-15', -30000], ['2026-12-10', -240000], ['2026-12-31', -96000], ['2026-12-31', -60000]];
  const EREIG = [...EIN, ...AUS].sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
  gleich('K4 erwartete Ein- und Ausgänge', c.vorschau.ereignisse.map((x) => [x.datum, x.ct]), EREIG);
  const start = Object.values(KZAHL).flat().reduce((x, z) => x + z.ct, 0) - KOST.reduce((x, z) => x + z.ct, 0);
  let lauf = start, tief = { datum: S, ct: start };
  for (let n = 1; n <= 90; n++) {
    const d = plusTage(S, n);
    lauf += EREIG.filter(([dd]) => dd === d).reduce((x, [, ct]) => x + ct, 0);
    if (lauf < tief.ct) tief = { datum: d, ct: lauf };
  }
  gleich('K4 Start, Ende, tiefster Punkt', [c.vorschau.start_ct, c.vorschau.ende_ct, c.vorschau.tief.datum, c.vorschau.tief.ct], [start, lauf, tief.datum, tief.ct]);
  const summeZ = (von, bis) => Object.values(KZAHL).flat().filter((z) => z.datum >= von && z.datum <= bis).reduce((x, z) => x + z.ct, 0);
  const summeK = (von, bis) => KOST.filter((z) => z.datum >= von && z.datum <= bis).reduce((x, z) => x + z.ct, 0);
  gleich('K5 Jahresvergleich', c.vergleich.zeilen.map((x) => [x.ct, x.vorjahr_ct]), [
    [summeZ('2026-01-01', S), summeZ('2025-01-01', '2025-10-16')], [summeK('2026-01-01', S), summeK('2025-01-01', '2025-10-16')],
    [summeZ('2026-01-01', S) - summeK('2026-01-01', S), summeZ('2025-01-01', '2025-10-16') - summeK('2025-01-01', '2025-10-16')],
    [summeZ('2026-01-01', S) - summeK('2026-01-01', S), summeZ('2025-01-01', '2025-10-16') - summeK('2025-01-01', '2025-10-16')]]);
  gleich('K6 Mieterhöhungs-Radar (EG § 558 +120 € ab 01.01.2027; 1. OG schon bei der Vergleichsmiete)',
    [c.radar.summe_ct, c.radar.eintraege.map((x) => [x.vertrag_id, x.art, x.ab, x.plus_ct, x.neu_ct])], [12000, [[KV.anna.id, '558', '2027-01-01', 12000, 72000]]]);
  gleich('K7 Fristen der nächsten 90 Tage', c.fristen.map((x) => [x.datum, x.text.split(' (')[0], !!x.wichtig]), [
    ['2026-11-15', 'Grundsteuer', false], ['2026-11-30', 'Gebäudeversicherung', false], ['2026-12-31', 'Betriebskostenabrechnung 2025 muss beim Mieter sein', true],
    ['2026-12-31', 'Kautionszinsen gutschreiben', false], ['2027-01-10', 'Gebäudeversicherung', false]]);
  gleich('K9 Kosten 2026 nach Art', [c.kosten.gruppen.map((x) => [x.label, x.ct]), c.kosten.summe_ct, c.kosten.umlagefaehig_anteil], [[['Grundsteuer', 90000]], 90000, 1]);

  // ----- Z1: small gauges in the lists -----
  const lk = k.listenKennzahlen(ko, S);
  gleich('Z1 Mieterliste: Zahlungsverhalten und €/m²', ['anna', 'carla', 'paul'].map((x) => [lk.vertraege[KV[x].id].score, lk.vertraege[KV[x].id].qm_ct]),
    [[erwartet('anna', S).score, 1000], [erwartet('carla', S).score, 1200], [100, null]]);
  gleich('Z1 Einheitenliste: Belegung 12 Monate', ['A', 'B', 'C', 'P'].map((x) => [lk.einheiten[KE[x]].belegung, lk.einheiten[KE[x]].selbst]), [[1, false], [1, false], [1, true], [1, false]]);

  // ----- Returned direct debit and a cancelled payment (after the cockpit figures) -----
  const juni = faellig('paul', '2026-06');
  k.buchen({ objekt_id: ko, datum: '2026-06-08', text: 'Rücklastschrift Paul', art: 'bank', positionen: [{ soll_id: kKonto('paul'), haben_id: kbank, betrag_ct: 5000 }] });
  KZAHL.paul.push({ datum: '2026-06-08', ct: -5000 });
  kzahle('paul', '2026-06-20', 5000);
  const irrtum = kzahle('paul', '2026-07-10', 5000, 'Zahlung irrtümlich');
  k.buchungStornieren(irrtum, '2026-07-12');
  const zp = k.zahlungsverhalten('miete', KV.paul.id, { stichtag: S });
  gleich('M1 Rücklastschrift öffnet den Juni wieder, Storno zählt nicht', [zp.monate.find((q) => q.monat === '2026-06').status, zp.monate.find((q) => q.monat === '2026-06').tage, zp.ruecklastschriften, zp.score],
    ['verspaetet', tageInkl(juni, '2026-06-20') - 1, 1, Math.round((21 * 100 + Math.max(0, 100 - 4 * (tageInkl(juni, '2026-06-20') - 1))) / 22 - 10)]);
}

// ---------- 17. Rent is a monthly amount (report of 17.10.2026: "800 € warm, 500 € paid = 300 € missing, not a share by day") ----------
// Starts and ends in mid-month charge whole months; a rent month may run from the day of moving in; a tenant change in
// mid-month; statements by rent months or by days; flat fee and rent including operating costs; vacancy in months;
// the one-time conversion of months booked by day before.
{
  const S = '2026-10-17';
  const werktagAb = (d0, n = 3) => { let z = 0; for (let d = d0; ; d = plusTage(d, 1)) if (wochentag(d) !== 0 && wochentag(d) !== 6 && !FEIERTAGE_BE.has(d) && ++z === n) return d; };
  const haus = () => {
    const raw = open(':memory:');
    const t = api(raw);
    t.setzeEinstellungen({ bundesland: 'BE', auto_soll: '0' });
    const ob = t.neuesObjekt({ bezeichnung: 'Monatshaus', art: 'miete', strasse: 'Monatsweg 1', plz: '10115', ort: 'Berlin' });
    const bank = t.konten(ob).find((k) => k.nr === 1200).id;
    let nr = 0;
    const einheit = () => t.save('einheiten', { objekt_id: ob, nr: ++nr, bezeichnung: `WE${nr}`, art: 'Wohnung', wohnflaeche: 60 });
    const vertrag = (eh, beginn, x = {}) => t.save('mietverhaeltnisse', { einheit_id: eh, person_id: t.save('personen', { anrede: 'Herr', vorname: 'Max', nachname: `Mieter ${eh}-${beginn}` }),
      beginn, kaltmiete_ct: 60000, bk_vz_ct: 12000, hk_vz_ct: 8000, personen_anzahl: 1, faelligkeitstag: 0, ust_satz: 0, ...x });
    const konto = (vid) => t.kontoVon('miete', vid).id;
    const zahle = (vid, datum, ct) => t.buchen({ objekt_id: ob, datum, text: 'Zahlung', art: 'bank', positionen: [{ soll_id: bank, haben_id: konto(vid), betrag_ct: ct }] });
    const lasten = (vid) => t.buchungen(ob, {}).filter((b) => b.art === 'soll' && b.soll_id === konto(vid));
    const monate17 = (vid, bis = '9999-99') => {
      const m = {};
      for (const b of lasten(vid).filter((b) => b.monat <= bis)) (m[b.monat] ??= { ct: 0, datum: b.datum }).ct += b.betrag_ct;
      return Object.fromEntries(Object.entries(m).sort().map(([k, x]) => [k, [x.ct, x.datum]]));
    };
    return { raw, t, ob, bank, einheit, vertrag, konto, zahle, lasten, monate17 };
  };

  // ----- Julian's case with every start and end: 800 € warm, 500 € paid on 17.10.2026 -----
  const H = haus();
  const FAELLE = [
    // [name, start, extra, payments, expected months up to 11/2026 {monat: [ct, due]}, [overdue, due today, credit] on 17.10.]
    ['Beginn 01.10.', '2026-10-01', {}, [[S, 50000]], { '2026-10': [80000, '2026-10-05'], '2026-11': [80000, '2026-11-04'] }, [30000, 0, 0]],
    ['Beginn 02.10.', '2026-10-02', {}, [[S, 50000]], { '2026-10': [80000, '2026-10-05'], '2026-11': [80000, '2026-11-04'] }, [30000, 0, 0]],
    ['Beginn 15.10.', '2026-10-15', {}, [[S, 50000]], { '2026-10': [80000, '2026-10-15'], '2026-11': [80000, '2026-11-04'] }, [30000, 0, 0]],
    ['Beginn 17.10. (heute fällig)', '2026-10-17', {}, [[S, 50000]], { '2026-10': [80000, '2026-10-17'], '2026-11': [80000, '2026-11-04'] }, [0, 30000, 0]],
    ['Beginn 16.09. (Monat mit 30 Tagen)', '2026-09-16', {}, [[S, 50000]], { '2026-09': [80000, '2026-09-16'], '2026-10': [80000, '2026-10-05'], '2026-11': [80000, '2026-11-04'] }, [110000, 0, 0]],
    ['Beginn 30.09. (ein Tag im September)', '2026-09-30', {}, [[S, 50000]], { '2026-09': [80000, '2026-09-30'], '2026-10': [80000, '2026-10-05'], '2026-11': [80000, '2026-11-04'] }, [110000, 0, 0]],
    ['Auszug 15.10.', '2026-09-01', { ende: '2026-10-15' }, [['2026-09-03', 80000], [S, 50000]], { '2026-09': [80000, '2026-09-03'], '2026-10': [80000, '2026-10-05'] }, [30000, 0, 0]],
    ['Beginn 01.11. (nichts fällig)', '2026-11-01', {}, [[S, 50000]], { '2026-11': [80000, '2026-11-04'] }, [0, 0, 50000]],
    ['Beginn 17.10., erst ab Folgemonat', '2026-10-17', { teilmonat_beginn: 'folgemonat' }, [[S, 50000]], { '2026-11': [80000, '2026-11-04'] }, [0, 0, 50000]],
  ].map(([name, beginn, x, z, mon, stand]) => ({ name, vid: H.vertrag(H.einheit(), beginn, x), z, mon, stand }));
  H.t.sollstellung(H.ob, '2026-01', '2027-03');
  for (const f of FAELLE) for (const [d, ct] of f.z) H.zahle(f.vid, d, ct);
  for (const f of FAELLE) {
    gleich(`800/500 ${f.name}: Monate voll`, H.monate17(f.vid, '2026-11'), f.mon);
    const ks = H.t.kontoStatus(H.konto(f.vid), S);
    gleich(`800/500 ${f.name}: überfällig, heute fällig, Guthaben`, [ks.ueberfaellig_ct, ks.heute_faellig_ct, ks.guthaben_ct], f.stand);
  }
  gleich('800/500: nirgends ein Tagesanteil im Buchungstext', FAELLE.flatMap((f) => H.lasten(f.vid)).filter((b) => /anteilig|Tage\)/.test(b.text)).length, 0);
  gleich('800/500 Beginn 15.10.: Vertragsseite zeigt 300 € Rückstand', H.t.vertragAkte('miete', FAELLE[2].vid).vertrag.ueberfaellig_ct >= 0 && H.t.offenePostenKonto(H.konto(FAELLE[2].vid), S).offen.map((o) => [o.monat, o.soll_ct, o.bezahlt_ct, o.offen_ct, o.status]),
    [['2026-10', 80000, 50000, 30000, 'teilweise bezahlt']]);
  gleich('800/500 Beginn 16.09.: September und Oktober voll, 500 € auf den September', H.t.offenePostenKonto(H.konto(FAELLE[4].vid), S).offen.map((o) => [o.monat, o.offen_ct]),
    [['2026-09', 30000], ['2026-10', 80000]]);
  gleich('800/500 Cockpit: Mieteingang Oktober zählt volle Monate', (() => { const k1 = H.t.cockpitKennzahlen('miete', S).eingang; return k1.soll_ct; })(),
    FAELLE.reduce((x, f) => x + (f.mon['2026-10']?.[0] ?? 0), 0));

  // ----- Rent month from the day of moving in (the 15th to the 14th) -----
  const J = haus();
  const vj = J.vertrag(J.einheit(), '2026-10-15', { mietmonat_ab: 'einzug', ende: '2027-03-10' });
  const vj15 = J.vertrag(J.einheit(), '2026-10-15', { mietmonat_ab: 'einzug', faelligkeitstag: 15 });
  J.t.sollstellung(J.ob, '2026-01', '2027-06');
  gleich('Mietmonat ab 15.: volle Monate, fällig am 3. Werktag ab dem 15., letzter Monat 15.02.–14.03. voll', J.monate17(vj),
    Object.fromEntries(['2026-10', '2026-11', '2026-12', '2027-01', '2027-02'].map((m) => [m, [80000, werktagAb(`${m}-15`)]])));
  gleich('... Text nennt den Mietmonat', [...new Set(J.lasten(vj).filter((b) => b.monat === '2026-10').map((b) => b.text))].sort(),
    ['BK-Vorauszahlung 10/2026 (15.10.–14.11.)', 'HK-Vorauszahlung 10/2026 (15.10.–14.11.)', 'Miete 10/2026 (15.10.–14.11.)']);
  gleich('... fällig am 15.', Object.values(J.monate17(vj15, '2026-12')).map(([, d]) => d), ['2026-10-15', '2026-11-15', '2026-12-15']);
  J.zahle(vj, S, 50000);
  gleich('... vor dem 3. Werktag kein Rückstand, danach 300 €', [J.t.kontoStatus(J.konto(vj), S).ueberfaellig_ct, J.t.kontoStatus(J.konto(vj), '2026-10-20').ueberfaellig_ct], [0, 30000]);
  gleich('... offener Posten mit Mietmonat', J.t.offenePostenKonto(J.konto(vj), '2026-10-20').offen.map((o) => o.text), ['Monatssoll 10/2026 (15.10.–14.11.)']);
  gleich('... Betriebskosten ab dem 15. (Abrechnung nach Mietmonaten)', J.t.nkAbrechnung(J.ob, '2026-01-01', '2026-12-31').ergebnisse.filter((e) => e.segment.vertrag?.id === vj).map((e) => [e.segment.von, e.segment.bis]),
    [['2026-10-15', '2026-12-31']]);
  const v31 = J.vertrag(J.einheit(), '2027-01-31', { mietmonat_ab: 'einzug' });
  const r31 = J.t.get('mietverhaeltnisse', v31);
  gleich('Mietmonat ab 31.: kürzere Monate beginnen am Monatsletzten', ['2027-01', '2027-02', '2027-03', '2027-04'].map((m) => { const x = J.t.periode(r31, m); return [x.von, x.bis]; }),
    [['2027-01-31', '2027-02-27'], ['2027-02-28', '2027-03-30'], ['2027-03-31', '2027-04-29'], ['2027-04-30', '2027-05-30']]);

  // ----- Tenant change in mid-month -----
  const W = haus();
  const ew = W.einheit();
  const alt = W.vertrag(ew, '2026-01-01', { ende: '2026-10-15' });
  const neu = W.vertrag(ew, '2026-10-16');
  W.t.sollstellung(W.ob, '2026-01', '2026-12');
  gleich('Wechsel 15./16.10. mit vollem Monat: Oktober doppelt → Prüfbericht', W.t.pruefbericht().punkte.filter((p) => p.schluessel.startsWith('doppelmonat:')).map((p) => p.schluessel), [`doppelmonat:miete:${alt}:${neu}`]);
  const info = W.t.mietbeginnInfo('miete', { id: neu, einheit_id: ew, beginn: '2026-10-16', teilmonat_beginn: 'voll', mietmonat_ab: 'erster', faelligkeitstag: 0 });
  gleich('... Formular schlägt „ab Folgemonat“ vor', [info.erste.von, info.doppelt.von, info.doppelt.bis, info.doppelt.folgemonat], ['2026-10-01', '2026-10-01', '2026-10-31', true]);
  W.t.save('mietverhaeltnisse', { id: neu, teilmonat_beginn: 'folgemonat' });
  W.t.sollAbgleich('miete', neu, { anwenden: true });
  gleich('... mit „ab Folgemonat“: Oktober nur beim Vormieter, keine Warnung', [Object.keys(W.monate17(neu, '2026-11')), Object.keys(W.monate17(alt)).at(-1),
    W.t.pruefbericht().punkte.some((p) => p.schluessel.startsWith('doppelmonat:'))], [['2026-11'], '2026-10', false]);
  const Z = haus();
  const ez = Z.einheit();
  Z.vertrag(ez, '2026-01-01', { ende: '2026-10-15' });
  Z.t.angebotSpeichern(ez, { kaltmiete_ct: 60000, bk_vz_ct: 12000, hk_vz_ct: 8000, kaution_ct: 180000, frei_ab: '2026-10-16' });
  const zr = Z.t.zusage(Z.t.save('interessenten', { einheit_id: ez, name: 'Lea Neu' }), '2026-10-16');
  gleich('Zusage nach Auszug am 15.: neuer Mieter erst ab November', [Z.t.get('mietverhaeltnisse', zr.vertrag_id).teilmonat_beginn, !!zr.folgemonat], ['folgemonat', true]);

  // ----- Service-charge statement 2025: by rent months (standard), by days, rent month from the 15th, overlap -----
  const L = haus();
  const [lx, ly, lz, lw] = [L.einheit(), L.einheit(), L.einheit(), L.einheit()];
  const xa = L.vertrag(lx, '2024-01-01', { ende: '2025-06-15' });
  const xb = L.vertrag(lx, '2025-06-16', { teilmonat_beginn: 'folgemonat' });
  const ya = L.vertrag(ly, '2025-03-15', { bk_abrechnung: 'wohntage' });
  const za = L.vertrag(lz, '2025-05-15', { mietmonat_ab: 'einzug' });
  const wa2 = L.vertrag(lw, '2024-01-01', { ende: '2025-10-15' });
  const wb2 = L.vertrag(lw, '2025-10-16');
  L.t.sollstellung(L.ob, '2024-01', '2025-12');
  const lk = Object.fromEntries(L.t.konten(L.ob).map((k) => [k.nr, k.id]));
  L.t.buchen({ objekt_id: L.ob, datum: '2025-03-01', text: 'Grundsteuer', positionen: [{ soll_id: lk[40100], haben_id: L.bank, betrag_ct: 240000 }] });
  const nkL = L.t.nkAbrechnung(L.ob, '2025-01-01', '2025-12-31');
  gleich('NK nach Mietmonaten: Abschnitte', nkL.ergebnisse.map((e) => [e.segment.einheit.id, e.segment.vertrag?.id ?? null, e.segment.von, e.segment.bis]), [
    [lx, xa, '2025-01-01', '2025-06-30'], [lx, xb, '2025-07-01', '2025-12-31'],
    [ly, null, '2025-01-01', '2025-03-14'], [ly, ya, '2025-03-15', '2025-12-31'],
    [lz, null, '2025-01-01', '2025-05-14'], [lz, za, '2025-05-15', '2025-12-31'],
    [lw, wa2, '2025-01-01', '2025-10-15'], [lw, wb2, '2025-10-16', '2025-12-31']]);
  gleich('... angerechnete BK-Vorauszahlungen je Abschnitt', nkL.ergebnisse.filter((e) => e.segment.vertrag).map((e) => e.bk_vz_ct), [6, 6, 10, 8, 10, 3].map((n) => n * 12000));
  gleich('... Grundsteuer nach Fläche und Tagen der Abschnitte', nkL.ergebnisse.map((e) => e.kosten_ct),
    nkL.ergebnisse.map((e) => Math.round(240000 * tageInkl(e.segment.von, e.segment.bis) / 365 / 4)));

  // ----- V1: flat fee and rent including operating costs -----
  const P2 = haus();
  const [pp, pi, pv] = [P2.einheit(), P2.einheit(), P2.einheit()];
  const vp = P2.vertrag(pp, '2025-01-01', { bk_art: 'pauschale', bk_vz_ct: 10000 });
  const vi = P2.vertrag(pi, '2025-01-01', { bk_art: 'inklusiv', kaltmiete_ct: 72000, bk_vz_ct: 12000 });
  const vv = P2.vertrag(pv, '2025-01-01');
  P2.t.sollstellung(P2.ob, '2025-01', '2025-12');
  const pk = P2.t.konten(P2.ob);
  const kat = (id) => pk.find((k) => k.id === id).kategorie;
  gleich('Pauschale: eigenes Ertragskonto', pk.filter((k) => k.kategorie === 'bk_pauschale').map((k) => [k.nr, k.bezeichnung]), [[60025, 'Betriebskostenpauschalen']]);
  gleich('Pauschale: monatlich als „BK-Pauschale“', P2.lasten(vp).filter((b) => b.monat === '2025-03').map((b) => [b.text, b.betrag_ct, kat(b.haben_id)]).sort(),
    [['BK-Pauschale 03/2025', 10000, 'bk_pauschale'], ['HK-Vorauszahlung 03/2025', 8000, 'hk'], ['Miete 03/2025', 60000, 'miete']]);
  gleich('Inklusivmiete: kein eigener BK-Betrag, keine BK-Forderung', [P2.t.get('mietverhaeltnisse', vi).bk_vz_ct, P2.lasten(vi).filter((b) => b.monat === '2025-03').map((b) => b.text).sort()],
    [0, ['HK-Vorauszahlung 03/2025', 'Miete 03/2025']]);
  const pkn = Object.fromEntries(pk.map((k) => [k.nr, k.id]));
  P2.t.buchen({ objekt_id: P2.ob, datum: '2025-03-01', text: 'Grundsteuer', positionen: [{ soll_id: pkn[40100], haben_id: P2.bank, betrag_ct: 180000 }] });
  P2.t.buchen({ objekt_id: P2.ob, datum: '2025-12-01', text: 'Gas', positionen: [{ soll_id: pkn[41000], haben_id: P2.bank, betrag_ct: 90000 }] });
  for (const vid of [vp, vi, vv]) P2.zahle(vid, '2025-12-31', P2.lasten(vid).reduce((x, b) => x + b.betrag_ct, 0));
  const nkP = P2.t.nkAbrechnung(P2.ob, '2025-01-01', '2025-12-31', { heizung: 'intern' });
  gleich('Pauschale/Inklusiv: nur Heizung abgerechnet, Betriebskosten trägt der Vermieter', nkP.ergebnisse.map((e) => [e.bk_art, e.kosten_ct, e.umgelegt_ct, e.nicht_umgelegt_ct, e.bk_vz_ct, e.hk_vz_ct, e.ergebnis_ct, e.neu_bk_vz_ct]),
    [['pauschale', 90000, 30000, 60000, 0, 96000, 30000 - 96000, null], ['inklusiv', 90000, 30000, 60000, 0, 96000, 30000 - 96000, null],
      ['vorauszahlung', 90000, 90000, 0, 144000, 96000, 90000 - 240000, 5000]]);
  gleich('... Summe beim Vermieter und Hinweis in der Prüfung', [nkP.pauschal_ct, P2.t.nkPruefung(P2.ob, '2025-01-01', '2025-12-31', { heizung: 'intern' }).punkte.some((p) => /nicht abgerechnet: 1\.200,00\s€ trägt der Vermieter/.test(p.text))], [120000, true]);
  const avP = P2.t.anlageV(P2.ob, 2025);
  gleich('Anlage V: Pauschale zählt zu den Umlagen', avP.einnahmen.map(([l, ct]) => [l.split(' ')[0], ct]).slice(0, 2), [['Mieteinnahmen', 12 * (60000 + 72000 + 60000)], ['Umlagen,', 12 * (10000 + 12000) + 3 * 12 * 8000]]);
  const mi = P2.t.mieterKennzahlen(vi, S);
  gleich('Inklusivmiete: kein Mietspiegel-Vergleich, § 558 mit Hinweis', [mi.vergleich.quelle, mi.vergleich.von_ct, mi.fakten.schritte.find((x) => x.art === '558')?.plus_ct ?? null,
    /Betriebskosten/.test(mi.fakten.schritte.find((x) => x.art === '558')?.text ?? '')], ['brutto', null, null, true]);
  P2.t.save('mietverhaeltnisse', { id: vp, bk_vz_ct: 0 });
  gleich('Pauschale ohne Betrag → Prüfbericht', P2.t.pruefbericht().punkte.some((p) => p.schluessel === `pauschale0:${vp}`), true);

  // ----- Vacancy in whole months: out 15.06. (June paid), in 16.08. (August paid) → only July lost -----
  const O2 = haus();
  const eo = O2.einheit();
  O2.vertrag(eo, '2024-01-01', { ende: '2026-06-15' });
  O2.vertrag(eo, '2026-08-16');
  const lo = O2.t.einheitKennzahlen(eo, S).belegung.segmente.find((x) => x.art === 'leer');
  gleich('Leerstand 16.06.–15.08.: ein Monat ohne Miete', [lo.von, lo.bis, lo.tage, lo.monate, lo.entgangen_ct], ['2026-06-16', '2026-08-15', 61, 1, 60000]);

  // ----- One-time conversion of months booked by day (database of version 0.7) -----
  const U = haus();
  const [eu1, eu2] = [U.einheit(), U.einheit()];
  const vu1 = U.vertrag(eu1, '2026-09-16');
  const vu2 = U.vertrag(eu2, '2026-08-15');
  U.t.sollstellung(U.ob, '2026-08', '2026-10');
  // As version 0.7 left it: "anteilig" set and the first month booked by day (September 15/30, August 17/31).
  for (const [vid, monat, tg, T] of [[vu1, '2026-09', 15, 30], [vu2, '2026-08', 17, 31]]) {
    U.raw.prepare(`UPDATE mietverhaeltnisse SET teilmonat_beginn = 'anteilig' WHERE id = ?`).run(vid);
    for (const b of U.lasten(vid).filter((b) => b.monat === monat)) U.raw.prepare('UPDATE buchungen SET betrag_ct = ?, text = ? WHERE id = ?')
      .run(Math.round(b.betrag_ct * tg / T), `${b.text} (anteilig ${tg}/${T} Tage)`, b.id);
  }
  U.t.setzeEinstellungen({ festgeschrieben_bis: '2026-08-31' });
  U.raw.prepare(`DELETE FROM einstellungen WHERE schluessel = 'umstellung_monatlich'`).run();
  const um = U.t.umstellungMonatlich();
  gleich('Umstellung: Teilmonat umgebucht, festgeschriebener bleibt', um.map((x) => [x.vertrag_id, x.monat, x.alt_ct, x.neu_ct, x.gebucht]),
    [[vu1, '2026-09', 30000 + 6000 + 4000, 80000, true], [vu2, '2026-08', Math.round(60000 * 17 / 31) + Math.round(12000 * 17 / 31) + Math.round(8000 * 17 / 31), 80000, false]]);
  gleich('... September jetzt voll, August unverändert', [U.monate17(vu1)['2026-09'], U.monate17(vu2)['2026-08'][0]], [[80000, '2026-09-16'], Math.round(60000 * 17 / 31) + Math.round(12000 * 17 / 31) + Math.round(8000 * 17 / 31)]);
  gleich('... Hinweis im Cockpit, nur einmal', [U.t.hinweise().some((h) => h.schluessel === 'umstellung:monatlich' && /400,00\s€ → 800,00\s€/.test(h.text)), U.t.umstellungMonatlich()], [true, null]);

  // ----- WEG: house money of the month of an owner change once; a special levy on a date goes to the owner then -----
  const G = haus();
  const wo = G.t.neuesObjekt({ bezeichnung: 'WEG Monatsplatz', art: 'weg', strasse: 'Monatsplatz 2', plz: '10115', ort: 'Berlin' });
  const [g1, g2] = [1, 2].map((nr) => G.t.save('einheiten', { objekt_id: wo, nr, bezeichnung: `W${nr}`, art: 'Wohnung', wohnflaeche: 50, mea: 500 }));
  const eigen = (eh, name, beginn, x = {}) => G.t.save('eigentum', { einheit_id: eh, person_id: G.t.save('personen', { nachname: name }), beginn, hausgeld_ct: 30000, ruecklage_ct: 5000, faelligkeitstag: 1, ...x });
  const ga = eigen(g1, 'Alt', '2020-01-01', { ende: '2026-06-15' });
  const gb = eigen(g1, 'Neu', '2026-06-16', { teilmonat_beginn: 'folgemonat' });
  eigen(g2, 'Zwei', '2020-01-01');
  G.t.sollstellung(wo, '2026-01', '2026-12');
  const hg = (vid) => { const k = G.t.kontoVon('weg', vid).id; return [...new Set(G.t.buchungen(wo, {}).filter((b) => b.art === 'soll' && b.soll_id === k && b.monat).map((b) => b.monat))].sort(); };
  gleich('WEG Wechsel 15./16.06.: Juni nur beim alten Eigentümer (voll)', [hg(ga).at(-1), hg(gb)[0]], ['2026-06', '2026-07']);
  const meaKey = G.t.schluessel(wo).find((x) => x.typ === 'mea').id;
  const su = G.t.sonderumlage(wo, { betrag_ct: 100000, schluessel_id: meaKey, datum: '2026-06-20', text: 'Sonderumlage Dach' });
  gleich('Sonderumlage am 20.06.: schuldet der Eigentümer an diesem Tag (Neu, obwohl Hausgeld erst ab Juli)', su.map((x) => [x.name, x.betrag_ct]), [['Neu', 50000], ['Zwei', 50000]]);
}

console.log(`\nRechentest: ${ok} Prüfungen richtig, ${falsch} falsch.`);
if (falsch) process.exitCode = 1;
// The click test reuses the sample data.
module.exports = { db, o, w, V, E, P, falsch };
