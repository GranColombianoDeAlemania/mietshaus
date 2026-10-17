// Calendar rules: public holidays per state, working days and statutory periods of German tenancy law.
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => d.toISOString().slice(0, 10);
const tag = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const plus = (d, n) => new Date(d.getTime() + n * 864e5);

// Easter Sunday (Gauss / Meeus algorithm, Gregorian calendar).
function ostern(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31), t = ((h + l - 7 * m + 114) % 31) + 1;
  return tag(y, monat, t);
}

const LAENDER = {
  BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg', HE: 'Hessen',
  MV: 'Mecklenburg-Vorpommern', NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen', RP: 'Rheinland-Pfalz', SL: 'Saarland',
  SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen',
};

// Statutory holidays: nationwide ones plus those of the given state (two-letter code, optional).
function feiertage(y, land = null) {
  const o = ostern(y);
  const f = new Map([
    [iso(tag(y, 1, 1)), 'Neujahr'], [iso(plus(o, -2)), 'Karfreitag'], [iso(plus(o, 1)), 'Ostermontag'], [iso(tag(y, 5, 1)), 'Tag der Arbeit'],
    [iso(plus(o, 39)), 'Christi Himmelfahrt'], [iso(plus(o, 50)), 'Pfingstmontag'], [iso(tag(y, 10, 3)), 'Tag der Deutschen Einheit'],
    [iso(tag(y, 12, 25)), '1. Weihnachtstag'], [iso(tag(y, 12, 26)), '2. Weihnachtstag'],
  ]);
  const in_ = (...l) => land && l.includes(land);
  if (in_('BW', 'BY', 'ST')) f.set(iso(tag(y, 1, 6)), 'Heilige Drei Könige');
  if (in_('BE') && y >= 2019) f.set(iso(tag(y, 3, 8)), 'Internationaler Frauentag');
  if (in_('MV') && y >= 2023) f.set(iso(tag(y, 3, 8)), 'Internationaler Frauentag');
  if (in_('BW', 'BY', 'HE', 'NW', 'RP', 'SL')) f.set(iso(plus(o, 60)), 'Fronleichnam');
  if (in_('SL')) f.set(iso(tag(y, 8, 15)), 'Mariä Himmelfahrt');
  if (in_('TH') && y >= 2019) f.set(iso(tag(y, 9, 20)), 'Weltkindertag');
  if (in_('BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH') || y === 2017) f.set(iso(tag(y, 10, 31)), 'Reformationstag');
  if (in_('BW', 'BY', 'NW', 'RP', 'SL')) f.set(iso(tag(y, 11, 1)), 'Allerheiligen');
  if (in_('SN')) {
    // Wednesday before 23 November.
    let d = tag(y, 11, 22);
    while (d.getUTCDay() !== 3) d = plus(d, -1);
    f.set(iso(d), 'Buß- und Bettag');
  }
  return f;
}

const istFeiertag = (datum, land) => feiertage(Number(datum.slice(0, 4)), land).has(datum);

// Working day: Monday to Saturday unless a holiday; for payment periods Saturday does not count (BGH VIII ZR 129/09).
function istWerktag(datum, land, { samstag = true } = {}) {
  const wt = new Date(datum + 'T00:00:00Z').getUTCDay();
  if (wt === 0 || (wt === 6 && !samstag)) return false;
  return !istFeiertag(datum, land);
}

// n-th working day counted from a date (YYYY-MM-DD, the date itself included).
function werktagAb(datum, n, land, opt) {
  let d = new Date(datum + 'T00:00:00Z');
  let zaehler = 0;
  for (;;) {
    if (istWerktag(iso(d), land, opt)) zaehler++;
    if (zaehler === n) return iso(d);
    d = plus(d, 1);
  }
}

// n-th working day of a month (YYYY-MM).
const werktagImMonat = (monat, n, land, opt) => werktagAb(`${monat}-01`, n, land, opt);

// Rent due date by statute (§ 556b Abs. 1 BGB): at the latest on the 3rd working day of the period the rent is
// measured by, Saturdays not counted. mieteFaellig: calendar month (YYYY-MM); mieteFaelligAb: a rent month that
// starts on another day (e.g. the 15th).
const mieteFaelligAb = (beginn, land) => werktagAb(beginn, 3, land, { samstag: false });
const mieteFaellig = (monat, land) => mieteFaelligAb(`${monat}-01`, land);

// Next working day on or after a date (Saturday counts as a working day except as the last day of a period, § 193 BGB).
function naechsterWerktag(datum, land) {
  let d = new Date(datum + 'T00:00:00Z');
  while (!istWerktag(iso(d), land, { samstag: false })) d = plus(d, 1);
  return iso(d);
}

const monatsende = (y, m) => iso(new Date(Date.UTC(y, m, 0)));

// Ordinary notice of a residential tenancy (§ 573c BGB). The notice must arrive by the 3rd working day of a month
// (Saturdays count, unless the 3rd working day itself is a Saturday – then the next working day, BGH VIII ZR 206/04).
// Tenant: end of the month after next. Landlord: same, plus 3 months after 5 and after 8 years since hand-over.
function ordentlicheKuendigung({ zugang, durch = 'mieter', ueberlassung = null, land = null }) {
  const [y, m] = zugang.split('-').map(Number);
  const monat = `${y}-${pad(m)}`;
  let karenz = werktagImMonat(monat, 3, land, { samstag: true });
  if (new Date(karenz + 'T00:00:00Z').getUTCDay() === 6) karenz = naechsterWerktag(karenz, land);
  const rechtzeitig = zugang <= karenz;
  let monate = 3;
  let jahre = null;
  if (durch === 'vermieter' && ueberlassung) {
    // Full years since the dwelling was handed over, up to the receipt of the notice.
    const [uy, um, ud] = ueberlassung.split('-').map(Number);
    const [zy, zm, zd] = zugang.split('-').map(Number);
    jahre = zy - uy - (zm < um || (zm === um && zd < ud) ? 1 : 0);
    monate = jahre >= 8 ? 9 : jahre >= 5 ? 6 : 3;
  }
  // Received in time: the current month counts as the first month of the notice period.
  const zusatz = (rechtzeitig ? monate - 1 : monate);
  const ende = monatsende(y, m + zusatz);
  return { zum: ende, karenz_bis: karenz, rechtzeitig, frist_monate: monate, jahre };
}

module.exports = { ostern, feiertage, istFeiertag, istWerktag, werktagAb, werktagImMonat, mieteFaellig, mieteFaelligAb, naechsterWerktag, ordentlicheKuendigung, LAENDER };
