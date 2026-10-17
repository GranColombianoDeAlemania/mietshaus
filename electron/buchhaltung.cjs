// Bookkeeping: chart of accounts, postings, charges (Sollstellung), open items, dunning, meters and bank import.
const kalender = require('./kalender.cjs');
// Double entry: every posting moves betrag_ct from the credit account (haben) to the debit account (soll).
// Balance of an account = sum of debits − sum of credits.

// Standard accounts created per object. side: which management type needs them.
// Kosten categories follow § 2 BetrKV so service-charge statements can group them.
const STANDARDKONTEN = [
  // [nr, bezeichnung, klasse, kategorie, side, extra]
  [1200, 'Bankkonto (Objektkonto)', 'geld', 'giro', 'beide'],
  [1210, 'Rücklagenkonto', 'geld', 'ruecklage', 'weg'],
  [1300, 'Kasse', 'geld', 'kasse', 'beide'],
  [30000, 'Erhaltungsrücklage', 'ruecklage', 'ruecklage', 'weg'],
  [60000, 'Miete (kalt)', 'einnahme', 'miete', 'miete'],
  [60010, 'Sonstige Mieteinnahmen (Garage, Stellplatz)', 'einnahme', 'sonst', 'miete'],
  [60020, 'Betriebskosten-Vorauszahlungen', 'einnahme', 'bk', 'miete'],
  [60025, 'Betriebskostenpauschalen', 'einnahme', 'bk_pauschale', 'miete', { seit: 3 }],
  [60030, 'Heizkosten-Vorauszahlungen', 'einnahme', 'hk', 'miete'],
  [60080, 'Kautionen', 'einnahme', 'kaution', 'miete'],
  [60090, 'Nebenkostenabrechnung Mieter', 'einnahme', 'nk_ergebnis', 'miete'],
  [60100, 'Hausgeld', 'einnahme', 'hausgeld', 'weg'],
  [60110, 'Zuführung Erhaltungsrücklage', 'einnahme', 'ruecklage', 'weg'],
  [60180, 'Sonderumlagen', 'einnahme', 'sonderumlage', 'weg'],
  [60190, 'Hausgeldabrechnung Eigentümer', 'einnahme', 'weg_ergebnis', 'weg'],
  [60200, 'Mahngebühren', 'einnahme', 'mahngebuehr', 'beide'],
  [68900, 'Zinserträge', 'einnahme', 'zins', 'beide'],
  [40100, 'Grundsteuer', 'kosten', 'bk01', 'beide', { umlagefaehig: 1 }],
  [40200, 'Wasserversorgung', 'kosten', 'bk02', 'beide', { umlagefaehig: 1, schluessel: 'personen' }],
  [40300, 'Entwässerung', 'kosten', 'bk03', 'beide', { umlagefaehig: 1, schluessel: 'personen' }],
  [41000, 'Heizkosten (Brennstoff, Wartung)', 'kosten', 'bk04', 'beide', { umlagefaehig: 1, heizkosten: 1 }],
  [41100, 'Warmwasserkosten', 'kosten', 'bk05', 'beide', { umlagefaehig: 1, heizkosten: 1 }],
  [40400, 'Aufzug', 'kosten', 'bk07', 'beide', { umlagefaehig: 1 }],
  [40500, 'Straßenreinigung', 'kosten', 'bk08', 'beide', { umlagefaehig: 1 }],
  [40600, 'Müllbeseitigung', 'kosten', 'bk08', 'beide', { umlagefaehig: 1, schluessel: 'personen' }],
  [40700, 'Gebäudereinigung', 'kosten', 'bk09', 'beide', { umlagefaehig: 1, p35a: 'dienstleistung' }],
  [40800, 'Gartenpflege', 'kosten', 'bk10', 'beide', { umlagefaehig: 1, p35a: 'dienstleistung' }],
  [40900, 'Allgemeinstrom / Beleuchtung', 'kosten', 'bk11', 'beide', { umlagefaehig: 1 }],
  [41200, 'Schornsteinreinigung', 'kosten', 'bk12', 'beide', { umlagefaehig: 1, p35a: 'handwerker' }],
  [41300, 'Sach- und Haftpflichtversicherung', 'kosten', 'bk13', 'beide', { umlagefaehig: 1 }],
  [41400, 'Hauswart', 'kosten', 'bk14', 'beide', { umlagefaehig: 1, p35a: 'dienstleistung' }],
  // § 2 Nr. 15 BetrKV since 1 July 2024: only power and maintenance of the aerial / distribution system remain chargeable;
  // cable TV fees are not. A fibre provision fee (§ 72 TKG) is chargeable within its limits.
  [41500, 'Antenne/Breitband: Betriebsstrom & Wartung', 'kosten', 'bk15', 'beide', { umlagefaehig: 1, schluessel: 'einheiten' }],
  [41510, 'Kabel-TV-Gebühren (seit 1.7.2024 nicht umlagefähig)', 'kosten', 'kabel_tv', 'beide', { seit: 2 }],
  [41520, 'Glasfaser-Bereitstellungsentgelt (§ 72 TKG)', 'kosten', 'bk15c', 'beide', { umlagefaehig: 1, schluessel: 'einheiten', seit: 2 }],
  [41600, 'Sonstige Betriebskosten', 'kosten', 'bk17', 'beide', { umlagefaehig: 1 }],
  [45000, 'Verwaltervergütung', 'kosten', 'verwaltung', 'beide', { schluessel: 'einheiten' }],
  [45100, 'Instandhaltung / Reparaturen', 'kosten', 'instandhaltung', 'beide', { p35a: 'handwerker' }],
  [45200, 'Bankgebühren', 'kosten', 'bank', 'beide'],
  [45300, 'Sonstige nicht umlagefähige Kosten', 'kosten', 'sonstige', 'beide'],
  [45400, 'Instandhaltung aus Rücklage', 'kosten', 'instandhaltung', 'weg', { aus_ruecklage: 1, p35a: 'handwerker' }],
];

// VAT accounts, created once an object has a commercial letting with VAT.
const USTKONTEN = [
  [1576, 'Vorsteuer 19 %', 'steuer', 'vorsteuer19'],
  [1571, 'Vorsteuer 7 %', 'steuer', 'vorsteuer7'],
  [1776, 'Umsatzsteuer 19 %', 'steuer', 'ust19'],
  [1771, 'Umsatzsteuer 7 %', 'steuer', 'ust7'],
  [1780, 'Umsatzsteuer: Zahlungen an / Erstattungen vom Finanzamt', 'steuer', 'ust_fa'],
];
// Version of the standard chart; objects created earlier get the accounts added later (marker 'k3' in kontenplan).
const KONTENPLAN_VERSION = 3;

// Contract amounts and the income account category each one is charged to.
const POSTEN = {
  miete: [['kaltmiete_ct', 'miete', 'Miete'], ['sonstiges_ct', 'sonst', 'Sonstiges'],
    ['bk_vz_ct', 'bk', 'BK-Vorauszahlung'], ['hk_vz_ct', 'hk', 'HK-Vorauszahlung']],
  weg: [['hausgeld_netto_ct', 'hausgeld', 'Hausgeld'], ['ruecklage_ct', 'ruecklage', 'Rücklage']],
};

const pad = (n) => String(n).padStart(2, '0');
const tageImMonat = (monat) => {
  const [y, m] = monat.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const monatsliste = (von, bis) => {
  const out = [];
  let [y, m] = von.split('-').map(Number);
  const [by, bm] = bis.split('-').map(Number);
  while (y < by || (y === by && m <= bm)) {
    out.push(`${y}-${pad(m)}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
};
const tageZwischen = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const vorTag = (iso) => new Date(Date.parse(iso) - 864e5).toISOString().slice(0, 10);
const nachTag = (iso) => new Date(Date.parse(iso) + 864e5).toISOString().slice(0, 10);
const monatPlus = (monat, n) => new Date(Date.UTC(Number(monat.slice(0, 4)), Number(monat.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
// Day of the month a contract's rent month starts on: 1, or the day of moving in for tenancies that run from it.
const ankertag = (v) => (v?.mietmonat_ab === 'einzug' && v.beginn && Number(v.beginn.slice(8, 10)) > 1 ? Number(v.beginn.slice(8, 10)) : 1);
// Start of the rent month in calendar month `monat` (the last day of a shorter month for days 29 to 31).
const periodeBeginn = (monat, anker) => `${monat}-${pad(Math.min(anker, tageImMonat(monat)))}`;

// SQL condition: the unit `e` is used by the landlord himself on date `d` (a column, parameter or literal).
const selbstSql = (e, d) => `EXISTS (SELECT 1 FROM selbstnutzung sn WHERE sn.einheit_id = ${e}.id AND sn.beginn <= ${d}
  AND (sn.ende IS NULL OR sn.ende = '' OR sn.ende >= ${d}))`;
// SQL expression: the unit a posting `b` concerns – set on the posting, or taken from its receipt or its project.
const einheitVonSql = (b) => `coalesce(${b}.einheit_id,
  (SELECT d.einheit_id FROM dokumente d WHERE d.buchung_id IN (${b}.id, coalesce(${b}.gruppe, -1)) AND d.einheit_id IS NOT NULL ORDER BY d.id LIMIT 1),
  (SELECT pj.einheit_id FROM projektposten pp JOIN projekte pj ON pj.id = pp.projekt_id WHERE pp.buchung_id IN (${b}.id, coalesce(${b}.gruppe, -1))
    AND pj.einheit_id IS NOT NULL LIMIT 1))`;

module.exports = function buchhaltung({ db, all, get, tx, save, aktuell, PERSON_NAME }) {
  const vertragTabelle = (typ) => (typ === 'weg' ? 'eigentum' : 'mietverhaeltnisse');
  // State for public holidays (affects working-day due dates); empty = nationwide holidays only.
  const land = () => get(`SELECT wert FROM einstellungen WHERE schluessel = 'bundesland'`)?.wert || null;

  // Creates missing standard accounts and one account per contract; keeps contract account names current.
  function syncKonten() {
    for (const o of all('SELECT id, art, kontenplan FROM objekte')) {
      const plan = o.kontenplan.split(',').filter(Boolean);
      const seiten = o.art === 'gemischt' ? ['miete', 'weg'] : [o.art];
      const fehlend = seiten.filter((s) => !plan.includes(s));
      // Accounts added to the standard chart later reach objects whose chart is older (only those newer than its version).
      const nachtrag = plan.length > 0 && !plan.includes(`k${KONTENPLAN_VERSION}`);
      const planVersion = Number(plan.find((x) => /^k\d+$/.test(x))?.slice(1) ?? 1);
      if (fehlend.length || nachtrag) {
        const keys = Object.fromEntries(all('SELECT typ, id FROM umlageschluessel WHERE objekt_id = ? ORDER BY id DESC', o.id).map((k) => [k.typ, k.id]));
        const ins = db.prepare(`INSERT OR IGNORE INTO konten (objekt_id, nr, bezeichnung, klasse, kategorie, umlagefaehig,
          heizkosten, schluessel_id, weg_schluessel_id, aus_ruecklage, p35a) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
        for (const [nr, bez, klasse, kat, side, x = {}] of STANDARDKONTEN) {
          const neuSeite = fehlend.includes(side) || (side === 'beide' && fehlend.length === seiten.length);
          const neuVersion = nachtrag && (x.seit ?? 1) > planVersion && (side === 'beide' || plan.includes(side));
          if (!neuSeite && !neuVersion) continue;
          const sKey = keys[x.schluessel] ?? keys.flaeche ?? null;
          const wKey = (x.schluessel === 'einheiten' ? keys.einheiten : null) ?? keys.mea ?? keys.flaeche ?? null;
          // An account added later takes the next free number if the user already uses its number for something else.
          let n = nr;
          if (neuVersion && !neuSeite) {
            if (get('SELECT 1 FROM konten WHERE objekt_id = ? AND klasse = ? AND kategorie = ?', o.id, klasse, kat)) continue;
            while (get('SELECT 1 FROM konten WHERE objekt_id = ? AND nr = ?', o.id, n)) n++;
          }
          ins.run(o.id, n, bez, klasse, kat, x.umlagefaehig ?? 0, x.heizkosten ?? 0,
            klasse === 'kosten' ? sKey : null, klasse === 'kosten' ? wKey : null, x.aus_ruecklage ?? 0, x.p35a ?? null);
        }
        if (nachtrag) db.prepare(`UPDATE konten SET bezeichnung = 'Antenne/Breitband: Betriebsstrom & Wartung'
          WHERE objekt_id = ? AND nr = 41500 AND bezeichnung = 'Kabel / Antenne'`).run(o.id);
        const neu = [...new Set([...plan.filter((x) => !/^k\d+$/.test(x)), ...fehlend, `k${KONTENPLAN_VERSION}`])].join(',');
        db.prepare('UPDATE objekte SET kontenplan = ? WHERE id = ?').run(neu, o.id);
      }
      // Objects with a VAT-able letting get the VAT accounts.
      if (get(`SELECT 1 FROM mietverhaeltnisse m JOIN einheiten e ON e.id = m.einheit_id WHERE e.objekt_id = ? AND m.ust_satz > 0`, o.id)) ustKontenAnlegen(o.id);
    }

    for (const typ of ['miete', 'weg']) {
      const basis = typ === 'weg' ? 200000 : 100000;
      const vertraege = all(`SELECT v.id, e.objekt_id, e.nr, e.bezeichnung AS einheit, ${PERSON_NAME} AS name
        FROM ${vertragTabelle(typ)} v JOIN einheiten e ON e.id = v.einheit_id JOIN personen p ON p.id = v.person_id`);
      for (const v of vertraege) {
        const bez = `${v.name} – ${v.einheit}`;
        const k = get('SELECT id, objekt_id FROM konten WHERE vertrag_typ = ? AND vertrag_id = ?', typ, v.id);
        if (k) {
          db.prepare('UPDATE konten SET bezeichnung = ? WHERE id = ?').run(bez, k.id);
          continue;
        }
        const max = get('SELECT max(nr) AS m FROM konten WHERE objekt_id = ? AND nr BETWEEN ? AND ?',
          v.objekt_id, basis + v.nr * 100, basis + v.nr * 100 + 99).m;
        const nr = max == null ? basis + v.nr * 100 : max + 1;
        db.prepare(`INSERT INTO konten (objekt_id, nr, bezeichnung, klasse, vertrag_typ, vertrag_id)
          VALUES (?, ?, ?, 'person', ?, ?)`).run(v.objekt_id, nr, bez, typ, v.id);
      }
      // Accounts of deleted contracts disappear unless they still carry postings.
      db.prepare(`DELETE FROM konten WHERE vertrag_typ = ? AND vertrag_id NOT IN (SELECT id FROM ${vertragTabelle(typ)})
        AND NOT EXISTS (SELECT 1 FROM buchungen b WHERE b.soll_id = konten.id OR b.haben_id = konten.id)`).run(typ);
    }
  }

  function ustKontenAnlegen(objektId) {
    const ins = db.prepare(`INSERT OR IGNORE INTO konten (objekt_id, nr, bezeichnung, klasse, kategorie) VALUES (?, ?, ?, ?, ?)`);
    for (const [nr, bez, klasse, kat] of USTKONTEN) {
      if (!get('SELECT 1 FROM konten WHERE objekt_id = ? AND klasse = ? AND kategorie = ?', objektId, klasse, kat)) ins.run(objektId, nr, bez, klasse, kat);
    }
  }

  const kontoVon = (typ, id) => get('SELECT * FROM konten WHERE vertrag_typ = ? AND vertrag_id = ?', typ, id);
  const kontoKat = (objektId, kategorie, klasse = 'einnahme') =>
    get('SELECT * FROM konten WHERE objekt_id = ? AND klasse = ? AND kategorie = ? AND inaktiv = 0 ORDER BY nr LIMIT 1', objektId, klasse, kategorie);

  // Amounts in force on a date: the contract's base amounts overridden by the latest change on or before it.
  function betraege(typ, vertragId, datum) {
    const v = get(`SELECT * FROM ${vertragTabelle(typ)} WHERE id = ?`, vertragId);
    const r = { ...v };
    for (const a of all(`SELECT * FROM anpassungen WHERE vertrag_typ = ? AND vertrag_id = ? AND gueltig_ab <= ?
      ORDER BY gueltig_ab`, typ, vertragId, datum)) {
      for (const k of ['kaltmiete_ct', 'bk_vz_ct', 'hk_vz_ct', 'sonstiges_ct', 'hausgeld_ct', 'ruecklage_ct'])
        if (a[k] != null) r[k] = a[k];
    }
    if (typ === 'weg') r.hausgeld_netto_ct = Math.max(0, (r.hausgeld_ct ?? 0) - (r.ruecklage_ct ?? 0));
    // Operating costs included in the rent: there is no separate amount (later changes cannot add one either).
    if (typ === 'miete' && v?.bk_art === 'inklusiv') r.bk_vz_ct = 0;
    return r;
  }

  function saldo(kontoId, bis = '9999-12-31', von = '0000-01-01') {
    return get(`SELECT
      coalesce((SELECT sum(betrag_ct) FROM buchungen WHERE soll_id = ?1 AND datum BETWEEN ?2 AND ?3), 0) -
      coalesce((SELECT sum(betrag_ct) FROM buchungen WHERE haben_id = ?1 AND datum BETWEEN ?2 AND ?3), 0) AS s`,
    kontoId, von, bis).s;
  }

  // ohneTx: for callers that already run inside a transaction.
  // einheit_id: the unit the costs concern (also per position).
  function buchen({ objekt_id, datum, beleg, text, art = 'manuell', monat = null, import_ref = null, einheit_id = null, positionen }, ohneTx = false) {
    if (!datum) throw new Error('Bitte ein Buchungsdatum angeben.');
    const pos = positionen.filter((p) => p.betrag_ct);
    if (!pos.length) throw new Error('Bitte einen Betrag angeben.');
    for (const p of pos) {
      if (!p.soll_id || !p.haben_id) throw new Error('Bitte Soll- und Habenkonto wählen.');
      if (p.soll_id === p.haben_id) throw new Error('Soll- und Habenkonto müssen verschieden sein.');
      // A negative amount is booked the other way round.
      if (p.betrag_ct < 0) [p.soll_id, p.haben_id, p.betrag_ct] = [p.haben_id, p.soll_id, -p.betrag_ct];
    }
    return (ohneTx ? (f) => f() : tx)(() => {
      const st = db.prepare(`INSERT INTO buchungen (objekt_id, datum, beleg, text, betrag_ct, soll_id, haben_id, art, monat, gruppe, import_ref, einheit_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      let gruppe = null;
      const ids = pos.map((p, i) => {
        const id = Number(st.run(objekt_id, datum, beleg || null, p.text || text || null, p.betrag_ct, p.soll_id, p.haben_id,
          art, p.monat ?? monat, gruppe, i === 0 ? import_ref : null, p.einheit_id || einheit_id || null).lastInsertRowid);
        if (i === 0 && pos.length > 1) {
          gruppe = id;
          db.prepare('UPDATE buchungen SET gruppe = ? WHERE id = ?').run(id, id);
        }
        return id;
      });
      return ids[0];
    });
  }

  const BUCHUNG_SQL = `SELECT b.*, s.nr AS soll_nr, s.bezeichnung AS soll_bez, h.nr AS haben_nr, h.bezeichnung AS haben_bez,
      s.klasse AS soll_klasse, h.klasse AS haben_klasse, s.vertrag_typ AS soll_vtyp, s.vertrag_id AS soll_vid, h.vertrag_typ AS haben_vtyp, h.vertrag_id AS haben_vid,
      (SELECT d.id FROM dokumente d WHERE d.buchung_id IN (b.id, coalesce(b.gruppe, -1)) ORDER BY d.id LIMIT 1) AS dok_id,
      (SELECT d.datei FROM dokumente d WHERE d.buchung_id IN (b.id, coalesce(b.gruppe, -1)) ORDER BY d.id LIMIT 1) AS dok_datei,
      EXISTS (SELECT 1 FROM buchungen x WHERE x.storno_von = b.id) AS storniert,
      ${einheitVonSql('b')} AS einheit_eff, (SELECT x.bezeichnung FROM einheiten x WHERE x.id = ${einheitVonSql('b')}) AS einheit_bez,
      b.datum <= coalesce((SELECT wert FROM einstellungen WHERE schluessel = 'festgeschrieben_bis'), '0000-00-00') AS festgeschrieben
    FROM buchungen b JOIN konten s ON s.id = b.soll_id JOIN konten h ON h.id = b.haben_id`;

  // Open items of a contract account on a reference date (default: today).
  // Charges are grouped by due date: one monthly charge (rent + advance payments, or house money) is one item.
  // Only charges due on or before the reference date count; a charge not paid on its due date is open in full.
  // Payments settle the oldest due month first. Money paid back to the tenant/owner (e.g. a returned direct
  // debit) reduces the payments, so the affected month becomes open again.
  function offenePostenKonto(kontoId, stichtag = new Date().toISOString().slice(0, 10)) {
    const lasten = all(`SELECT b.id, b.datum, b.monat, b.text, b.betrag_ct FROM buchungen b JOIN konten g ON g.id = b.haben_id
      WHERE b.soll_id = ? AND g.klasse <> 'geld' AND b.datum <= ? ORDER BY b.datum, b.id`, kontoId, stichtag);
    let zahlungen = get(`SELECT
        coalesce((SELECT sum(betrag_ct) FROM buchungen WHERE haben_id = ?1 AND datum <= ?2), 0) -
        coalesce((SELECT sum(b.betrag_ct) FROM buchungen b JOIN konten g ON g.id = b.haben_id WHERE b.soll_id = ?1 AND g.klasse = 'geld' AND b.datum <= ?2), 0) AS s`,
    kontoId, stichtag).s;
    // One item per due date and month (several postings of the same monthly charge belong together).
    const posten = [];
    for (const l of lasten) {
      const key = l.monat ? `${l.datum}|${l.monat}` : `${l.datum}|#${l.id}`;
      let p = posten.at(-1)?.key === key ? posten.at(-1) : null;
      if (!p) posten.push((p = { key, id: l.id, datum: l.datum, monat: l.monat, teile: [], soll_ct: 0 }));
      p.teile.push({ text: l.text, betrag_ct: l.betrag_ct });
      p.soll_ct += l.betrag_ct;
    }
    const offen = [];
    for (const p of posten) {
      const bezahlt = Math.max(0, Math.min(zahlungen, p.soll_ct));
      zahlungen -= bezahlt;
      if (p.soll_ct > bezahlt) {
        const [y, m] = (p.monat ?? '').split('-');
        // A rent month from another day than the 1st keeps its days: "Monatssoll 10/2026 (15.10.–14.11.)".
        const tage = p.monat ? p.teile[0].text.match(/\s\d{2}\/\d{4}( \(\d{2}\.\d{2}\.–\d{2}\.\d{2}\.\))/)?.[1] ?? '' : '';
        offen.push({
          id: p.id, datum: p.datum, monat: p.monat,
          text: p.monat ? `${p.teile.length > 1 ? 'Monatssoll' : p.teile[0].text.replace(/\s\d{2}\/\d{4}.*$/, '')} ${m}/${y}${tage}` : p.teile[0].text,
          teile: p.teile, soll_ct: p.soll_ct, bezahlt_ct: bezahlt, offen_ct: p.soll_ct - bezahlt,
          status: bezahlt > 0 ? 'teilweise bezahlt' : 'nicht bezahlt',
          verzug: Math.max(0, tageZwischen(p.datum, stichtag)),
        });
      }
    }
    const guthaben = Math.max(0, zahlungen);
    return { offen, guthaben_ct: guthaben, summe_ct: offen.reduce((s, o) => s + o.offen_ct, 0) - guthaben };
  }

  // Rent and house money are monthly amounts. The rent month is the calendar month, or – for a tenancy that says so –
  // runs from the day of moving in (e.g. the 15th) to the day before it in the next month. A month in which a contract
  // starts or ends is charged in full; moving in during a calendar month, the contract may say "from the next month".
  // Only where a tenancy says so explicitly ('teilbetrag'), the month of moving in is charged for its days from the
  // move-in day (or an agreed amount), and the month of moving out for its days up to the move-out day.
  // The first charge is never due before the start.
  // periode(v, monat): the rent month starting in calendar month `monat` (YYYY-MM) if the contract is charged for it;
  // von/bis are the days charged, teil the share of a part month.
  function periode(v, monat) {
    const anker = ankertag(v);
    const pVon = periodeBeginn(monat, anker);
    const pBis = vorTag(periodeBeginn(monatPlus(monat, 1), anker));
    if (!v.beginn || v.beginn > pBis || (v.ende && v.ende < pVon)) return null;
    const beginntHier = v.beginn > pVon;
    if (beginntHier && v.teilmonat_beginn === 'folgemonat') return null;
    const teilBeginn = beginntHier && v.teilmonat_beginn === 'teilbetrag';
    const teilEnde = !!v.ende && v.ende < pBis && v.teilmonat_ende === 'teilbetrag';
    const von = teilBeginn ? v.beginn : pVon, bis = teilEnde ? v.ende : pBis;
    let datum = faelligAb(v.faelligkeitstag, pVon);
    if (datum < v.beginn) datum = v.beginn;
    return { monat, von, bis, anker, datum, stichtag: beginntHier ? v.beginn : pVon,
      teil: teilBeginn || teilEnde ? { tage: tageZwischen(von, bis) + 1, tage_periode: tageZwischen(pVon, pBis) + 1, beginn: teilBeginn, ende: teilEnde } : null };
  }
  // The rent month containing a date (whether charged or not).
  function periodeAm(v, datum) {
    const anker = ankertag(v);
    const m = datum.slice(0, 7);
    const monat = datum >= periodeBeginn(m, anker) ? m : monatPlus(m, -1);
    return { monat, von: periodeBeginn(monat, anker), bis: vorTag(periodeBeginn(monatPlus(monat, 1), anker)) };
  }
  // First and last rent month a contract is charged for (null: never charged / no end).
  function erstePeriode(v) {
    const m = v.beginn.slice(0, 7);
    return periode(v, m) ?? periode(v, monatPlus(m, 1));
  }
  const letztePeriode = (v) => (v.ende ? periode(v, periodeAm(v, v.ende).monat) : null);
  // Days charged twice when a contract of a unit follows another in mid-month: the outgoing one pays its last month in
  // full, and the incoming one is charged for the same days (e.g. out on the 15th, in on the 16th with a full month).
  function doppelteMiete(alt, neu) {
    const a = letztePeriode(alt), b = erstePeriode(neu);
    if (!a || !b || b.von > a.bis || a.von > b.bis) return null;
    return { monat: b.monat, von: b.von > a.von ? b.von : a.von, bis: a.bis < b.bis ? a.bis : b.bis };
  }
  // What the form shows for a contract being entered: its first rent month with its amount and due date, the last one
  // if it ends, and whether the previous contract of the unit is charged for the same days. Amounts as entered (cents).
  function mietbeginnInfo(typ, v) {
    if (!v?.beginn || !/^\d{4}-\d{2}-\d{2}$/.test(v.beginn)) return null;
    const x = { ...v, faelligkeitstag: v.faelligkeitstag === '' || v.faelligkeitstag == null ? 0 : Number(v.faelligkeitstag), ende: v.ende || null };
    const b = Object.fromEntries(['kaltmiete_ct', 'bk_vz_ct', 'hk_vz_ct', 'sonstiges_ct', 'hausgeld_ct', 'ruecklage_ct'].map((k) => [k, Number(v[k]) || 0]));
    if (typ === 'weg') b.hausgeld_netto_ct = Math.max(0, b.hausgeld_ct - b.ruecklage_ct);
    const mitBetrag = (t) => (t ? { ...t, betrag_ct: monatsPosten(typ, x, b, t).reduce((s, p) => s + p.ct, 0) } : null);
    const erste = mitBetrag(erstePeriode(x));
    const letzte = x.ende ? mitBetrag(letztePeriode(x)) : null;
    let doppelt = null;
    if (v.einheit_id) {
      const alt = get(`SELECT v.*, ${PERSON_NAME} AS name FROM ${vertragTabelle(typ)} v JOIN personen p ON p.id = v.person_id
        WHERE v.einheit_id = ? AND v.id <> ? AND v.beginn < ? AND v.ende IS NOT NULL AND v.ende <> '' ORDER BY v.ende DESC LIMIT 1`, Number(v.einheit_id), Number(v.id) || -1, v.beginn);
      const d = alt && doppelteMiete(alt, x);
      if (d) doppelt = { ...d, name: alt.name, ende: alt.ende, vertrag_id: alt.id, folgemonat: x.teilmonat_beginn !== 'folgemonat' && ankertag(x) === 1 && x.beginn > `${x.beginn.slice(0, 7)}-01` };
    }
    return { erste, letzte, doppelt };
  }

  // Calendar months whose 1st lies in [von, bis] (dates) and for which no tenancy of the unit is charged – the months
  // a vacancy or the landlord's own use costs rent (a month a tenant pays for counts as let, even if he moved in or
  // out during it).
  function monateOhneMiete(einheitId, von, bis) {
    const vs = all('SELECT * FROM mietverhaeltnisse WHERE einheit_id = ?', einheitId);
    const out = [];
    for (let m = von.endsWith('-01') ? von.slice(0, 7) : monatPlus(von.slice(0, 7), 1); `${m}-01` <= bis; m = monatPlus(m, 1)) {
      const a = `${m}-01`, b = `${m}-${pad(tageImMonat(m))}`;
      if (!vs.some((v) => [monatPlus(m, -1), m].some((k) => { const p = periode(v, k); return p && p.von <= b && p.bis >= a; }))) out.push(m);
    }
    return out;
  }
  // Rent months a period of a unit lacks: per calendar month, the days of [von, bis] no tenancy is charged for, as a
  // share of that month. A whole month without any rent counts 1; a month a tenant pays in full counts nothing, even
  // if he moved in or out during it; of a part month only its unpaid days count.
  function fehlendeMietmonate(einheitId, von, bis) {
    const vs = all('SELECT * FROM mietverhaeltnisse WHERE einheit_id = ?', einheitId);
    const gedeckt = [];
    for (const v of vs) {
      for (let m = monatPlus(von.slice(0, 7), -1); m <= bis.slice(0, 7); m = monatPlus(m, 1)) {
        const p = periode(v, m);
        if (p && p.von <= bis && p.bis >= von) gedeckt.push([p.von, p.bis]);
      }
    }
    let monate = 0;
    for (let m = von.slice(0, 7); m <= bis.slice(0, 7); m = monatPlus(m, 1)) {
      const ende = `${m}-${pad(tageImMonat(m))}`;
      let frei = 0;
      for (let d = `${m}-01` > von ? `${m}-01` : von; d <= ende && d <= bis; d = nachTag(d)) if (!gedeckt.some(([a, z]) => a <= d && d <= z)) frei++;
      monate += frei / tageImMonat(m);
    }
    return monate;
  }
  // Due date of a rent month starting on `von`: day 0 is the statutory rule (3rd working day of the rent month,
  // § 556b BGB, Saturdays not counted), otherwise the first such day of a month on or after the start.
  function faelligAb(tag, von) {
    if (tag === 0) return kalender.mieteFaelligAb(von, land());
    const n = Number(tag) || 1;
    const amTag = (monat) => `${monat}-${pad(Math.min(n, tageImMonat(monat)))}`;
    const d = amTag(von.slice(0, 7));
    return d >= von ? d : amTag(monatPlus(von.slice(0, 7), 1));
  }

  function sollZeile({ monat, datum, konto, ertrag, v, typ, posten, betrag_ct, t }) {
    const vorhanden = get(`SELECT count(*) AS n, coalesce(sum(betrag_ct), 0) AS s FROM buchungen WHERE art = 'soll' AND soll_id = ? AND haben_id = ? AND monat = ?`,
      konto.id, ertrag.id, monat);
    return { monat, datum, konto_id: konto.id, name: v.name, einheit: v.einheit, typ, vertrag_id: v.id, einheit_id: v.einheit_id, person_id: v.person_id,
      posten, betrag_ct, ertrag_id: ertrag.id, vorhanden: vorhanden.n > 0, vorhanden_ct: vorhanden.s, periode_von: t.von, periode_bis: t.bis, anker: t.anker,
      teil: t.teil ?? null };
  }

  // The amounts a contract is charged for one rent month: operating costs as a flat fee go to their own income
  // account (no statement), included in the rent there is none. A part month (only where the contract says so) is
  // charged for its days, or – moving in – with the agreed amount split like the monthly amounts.
  function monatsPosten(typ, v, b, t) {
    const posten = [];
    for (const [feld, kat0, label0] of POSTEN[typ]) {
      const bk = typ === 'miete' && feld === 'bk_vz_ct';
      if (bk && v.bk_art === 'inklusiv') continue;
      const [kat, label] = bk && v.bk_art === 'pauschale' ? ['bk_pauschale', 'BK-Pauschale'] : [kat0, label0];
      if ((b[feld] ?? 0) > 0) posten.push({ kat, label, ct: b[feld] });
    }
    if (!t.teil) return posten;
    const voll = posten.reduce((s, p) => s + p.ct, 0);
    const fest = t.teil.beginn && !t.teil.ende && Number(v.teilbetrag_beginn_ct) > 0 ? Number(v.teilbetrag_beginn_ct) : null;
    if (fest != null && voll > 0) {
      let rest = fest;
      return posten.map((p, i) => {
        const ct = i === posten.length - 1 ? rest : Math.round(fest * p.ct / voll);
        rest -= ct;
        return { ...p, ct };
      });
    }
    return posten.map((p) => ({ ...p, ct: Math.round(p.ct * t.teil.tage / t.teil.tage_periode) }));
  }

  // Charge lines of one contract for one month; none when the contract does not run (or is not charged) that month.
  function sollZeilenVertrag(typ, v, monat) {
    const konto = kontoVon(typ, v.id);
    const t = konto && periode(v, monat);
    if (!t) return [];
    const b = betraege(typ, v.id, t.stichtag);
    const zeilen = [];
    let netto = 0;
    for (const p of monatsPosten(typ, v, b, t)) {
      if (p.ct <= 0) continue;
      const ertrag = kontoKat(konto.objekt_id, p.kat);
      if (!ertrag) continue;
      netto += p.ct;
      zeilen.push(sollZeile({ monat, datum: t.datum, konto, ertrag, v, typ, posten: p.label, betrag_ct: p.ct, t }));
    }
    // Commercial lettings with VAT: one VAT charge per month on the net total.
    const satz = typ === 'miete' ? Number(v.ust_satz) || 0 : 0;
    if (satz > 0 && netto > 0) {
      const ust = kontoKat(konto.objekt_id, satz === 7 ? 'ust7' : 'ust19', 'steuer');
      if (ust) zeilen.push(sollZeile({ monat, datum: t.datum, konto, ertrag: ust, v, typ,
        posten: `USt ${String(satz).replace('.', ',')} %`, betrag_ct: Math.round(netto * satz / 100), t }));
    }
    return zeilen;
  }

  const gesperrtBis = () => get(`SELECT wert FROM einstellungen WHERE schluessel = 'festgeschrieben_bis'`)?.wert ?? '0000-00-00';
  const summe = (xs) => xs.reduce((s, x) => s + x.betrag_ct, 0);
  // Text of a charge: "Miete 10/2026"; a rent month from another day or a part month names its days:
  // "Miete 10/2026 (15.10.–14.11.)", "Miete 10/2026 (20.10.–31.10.)".
  const sollText = (z) => {
    const [y, m] = z.monat.split('-');
    const kurz = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;
    return `${z.posten} ${m}/${y}${z.anker > 1 || z.teil ? ` (${kurz(z.periode_von)}–${kurz(z.periode_bis)})` : ''}`;
  };
  function sollEinfuegen(objektId, z) {
    db.prepare(`INSERT INTO buchungen (objekt_id, datum, text, betrag_ct, soll_id, haben_id, art, monat) VALUES (?, ?, ?, ?, ?, ?, 'soll', ?)`)
      .run(objektId, z.datum, sollText(z), z.betrag_ct, z.konto_id, z.ertrag_id, z.monat);
  }
  const vertragMitNamen = (typ, id) => get(`SELECT v.*, e.bezeichnung AS einheit, e.objekt_id, ${PERSON_NAME} AS name FROM ${vertragTabelle(typ)} v
    JOIN einheiten e ON e.id = v.einheit_id JOIN personen p ON p.id = v.person_id WHERE v.id = ?`, id);

  // Compares a contract's booked monthly charges (from month `von` on) with what the contract says: amounts and their
  // changes, start, end and part months. Returns the months whose charges differ and the months from the start up to
  // the current month without any charge. `anwenden` rebooks the differing months, except in a locked period or where
  // a charge was cancelled by hand; `nachholen` charges the missing months. `nurTeilmonate`: rebook only months that
  // were charged by day (before version 0.8).
  function sollAbgleich(typ, vertragId, { von = '0000-00', anwenden = false, nachholen = false, nurTeilmonate = false } = {}) {
    const v = vertragMitNamen(typ, vertragId);
    const konto = v && kontoVon(typ, v.id);
    if (!konto) return { aenderungen: [], fehlend: [] };
    const jetzt = new Date().toISOString().slice(0, 7);
    const sperre = gesperrtBis();
    const gebucht = new Map();
    for (const b of all(`SELECT b.*, EXISTS (SELECT 1 FROM buchungen x WHERE x.storno_von = b.id) AS storniert FROM buchungen b
        WHERE b.soll_id = ? AND b.art = 'soll' AND b.monat >= ? ORDER BY b.monat, b.id`, konto.id, von)) {
      if (!gebucht.has(b.monat)) gebucht.set(b.monat, []);
      gebucht.get(b.monat).push(b);
    }
    const kennung = (xs) => xs.map((x) => `${x.haben_id ?? x.ertrag_id}|${x.betrag_ct}|${x.datum}`).sort().join(',');
    const aenderungen = [];
    for (const [monat, alt] of gebucht) {
      const neu = sollZeilenVertrag(typ, v, monat);
      if (kennung(alt) === kennung(neu)) continue;
      aenderungen.push({ monat, alt_ct: summe(alt), neu_ct: summe(neu), alt_datum: alt[0].datum, neu_datum: neu[0]?.datum ?? null,
        gesperrt: alt.some((b) => b.datum <= sperre) || neu.some((z) => z.datum <= sperre), manuell: alt.some((b) => b.storniert),
        teilmonat: alt.some((b) => /\(anteilig \d/.test(b.text ?? '')), ids: alt.map((b) => b.id), zeilen: neu });
    }
    const start = [v.beginn.slice(0, 7), von].sort().at(-1);
    const ende = [(v.ende || '9999-12').slice(0, 7), jetzt].sort()[0];
    const fehlend = (start > ende ? [] : monatsliste(start, ende)).filter((m) => !gebucht.has(m))
      .map((monat) => ({ monat, zeilen: sollZeilenVertrag(typ, v, monat) }))
      .filter((f) => f.zeilen.length && f.zeilen[0].datum > sperre)
      .map((f) => ({ ...f, datum: f.zeilen[0].datum, betrag_ct: summe(f.zeilen) }));
    if (anwenden || nachholen) {
      tx(() => {
        if (anwenden) for (const a of aenderungen.filter((a) => !a.gesperrt && !a.manuell && (!nurTeilmonate || a.teilmonat))) {
          db.prepare(`DELETE FROM buchungen WHERE id IN (${a.ids.map(() => '?').join(', ')})`).run(...a.ids);
          for (const z of a.zeilen) sollEinfuegen(v.objekt_id, z);
        }
        if (nachholen) for (const f of fehlend) for (const z of f.zeilen) sollEinfuegen(v.objekt_id, z);
      });
    }
    const ohne = ({ ids, zeilen, ...x }) => x;
    return { vertrag_id: v.id, typ, name: v.name, einheit: v.einheit, beginn: v.beginn, aenderungen: aenderungen.map(ohne), fehlend: fehlend.map(ohne) };
  }

  // Automatic charging: after every change of a contract or its amounts, its charges from the month automation
  // started on are brought in line at once (missing months up to the current one are added), not only at the next
  // hourly run. Months before that start are left to the user (see sollAbgleich).
  function sollAutomatisch(typ, vertragId) {
    const e = Object.fromEntries(all(`SELECT schluessel, wert FROM einstellungen WHERE schluessel IN ('auto_soll', 'auto_soll_ab')`)
      .map((r) => [r.schluessel, r.wert]));
    if (e.auto_soll === '0') return null;
    const ab = e.auto_soll_ab ?? new Date().toISOString().slice(0, 7);
    if (!e.auto_soll_ab) db.prepare(`INSERT INTO einstellungen (schluessel, wert) VALUES ('auto_soll_ab', ?) ON CONFLICT (schluessel) DO NOTHING`).run(ab);
    return sollAbgleich(typ, vertragId, { von: ab, anwenden: true, nachholen: true });
  }

  // One-time conversion (version 0.8): months that used to be charged by day are rebooked as full months, except in a
  // locked period or where a charge was cancelled by hand. What changed is kept for a note in the cockpit.
  function umstellungMonatlich() {
    if (get(`SELECT 1 FROM einstellungen WHERE schluessel = 'umstellung_monatlich'`)) return null;
    const liste = [];
    tx(() => {
      for (const typ of ['miete', 'weg']) {
        for (const { id } of all(`SELECT id FROM ${vertragTabelle(typ)} ORDER BY id`)) {
          const r = sollAbgleich(typ, id, { anwenden: true, nurTeilmonate: true });
          for (const a of r.aenderungen.filter((a) => a.teilmonat)) {
            liste.push({ typ, vertrag_id: id, name: r.name, einheit: r.einheit, monat: a.monat, alt_ct: a.alt_ct, neu_ct: a.neu_ct, gebucht: !a.gesperrt && !a.manuell });
          }
        }
      }
      db.prepare(`INSERT INTO einstellungen (schluessel, wert) VALUES ('umstellung_monatlich', ?) ON CONFLICT (schluessel) DO NOTHING`)
        .run(JSON.stringify({ datum: new Date().toISOString().slice(0, 10), monate: liste }));
    });
    return liste;
  }

  // The next charge of a contract after the reference date (for "next due" hints).
  function naechsteFaelligkeit(typ, vertragId, stichtag = new Date().toISOString().slice(0, 10)) {
    const v = vertragMitNamen(typ, vertragId);
    if (!v) return null;
    let [y, m] = stichtag.slice(0, 7).split('-').map(Number);
    for (let i = 0; i < 15; i++) {
      const zeilen = sollZeilenVertrag(typ, v, `${y}-${pad(m)}`);
      if (zeilen.length && zeilen[0].datum > stichtag) return { monat: `${y}-${pad(m)}`, datum: zeilen[0].datum, betrag_ct: summe(zeilen) };
      if (++m > 12) { m = 1; y++; }
    }
    return null;
  }

  // Schedule and progress of an instalment plan on a date.
  function ratenplanStand(id, stichtag) {
    const p = get('SELECT * FROM ratenplaene WHERE id = ?', id);
    if (!p) return null;
    const raten = [];
    let rest = p.betrag_ct;
    for (let i = 0; rest > 0 && i < 240; i++) {
      const d = new Date(p.erste_rate + 'T00:00:00Z');
      const tag = d.getUTCDate();
      const f = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1));
      const letzter = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0)).getUTCDate();
      f.setUTCDate(Math.min(tag, letzter));
      const betrag = Math.min(p.rate_ct, rest);
      raten.push({ nr: i + 1, faellig: f.toISOString().slice(0, 10), betrag_ct: betrag });
      rest -= betrag;
    }
    const op = offenePostenKonto(p.konto_id, stichtag);
    const offenAlt = op.offen.filter((o) => o.datum <= p.datum).reduce((s, o) => s + o.offen_ct, 0);
    const getilgt = Math.max(0, p.betrag_ct - offenAlt);
    const soll = raten.filter((r) => r.faellig <= stichtag).reduce((s, r) => s + r.betrag_ct, 0);
    const neu = op.offen.filter((o) => o.datum > p.datum && o.verzug >= 1).reduce((s, o) => s + o.offen_ct, 0);
    let bezahlt = getilgt;
    for (const r of raten) { r.bezahlt_ct = Math.min(r.betrag_ct, bezahlt); bezahlt -= r.bezahlt_ct; r.offen = r.faellig <= stichtag && r.bezahlt_ct < r.betrag_ct; }
    return {
      plan: p, raten, getilgt_ct: getilgt, rest_ct: p.betrag_ct - getilgt, soll_bis_heute_ct: soll,
      verzug_ct: Math.max(0, soll - getilgt), neue_rueckstaende_ct: neu,
      erfuellt: getilgt >= p.betrag_ct, naechste: raten.find((r) => r.bezahlt_ct < r.betrag_ct) ?? null,
    };
  }

  function verbrauch(zaehlerId, von, bis) {
    const z = get('SELECT * FROM zaehler WHERE id = ?', zaehlerId);
    const st = all('SELECT datum, stand FROM zaehlerstaende WHERE zaehler_id = ? ORDER BY datum', zaehlerId);
    // Linear interpolation between readings; outside the readings the nearest one is used.
    const standAm = (d) => {
      if (!st.length) return null;
      if (d <= st[0].datum) return st[0].stand;
      for (let i = 1; i < st.length; i++) {
        if (d <= st[i].datum) {
          const a = st[i - 1], b = st[i];
          const t = tageZwischen(a.datum, d) / Math.max(1, tageZwischen(a.datum, b.datum));
          return a.stand + (b.stand - a.stand) * t;
        }
      }
      return st[st.length - 1].stand;
    };
    const a = standAm(von), b = standAm(bis);
    if (a == null || b == null) return 0;
    return Math.max(0, (b - a) * (z.faktor ?? 1));
  }

  return {
    syncKonten,
    ustKontenAnlegen,
    periode,
    periodeAm,
    erstePeriode,
    letztePeriode,
    doppelteMiete,
    mietbeginnInfo,
    monateOhneMiete,
    fehlendeMietmonate,
    umstellungMonatlich,
    kontoVon,
    buchenIntern: (b) => buchen(b, true),
    saldoBis: (kontoId, bis) => saldo(kontoId, bis),
    betraege,
    verbrauch,
    offenePostenKonto,

    konten: (objektId, klasse) => all(`SELECT k.*,
        coalesce((SELECT sum(betrag_ct) FROM buchungen WHERE soll_id = k.id), 0) -
        coalesce((SELECT sum(betrag_ct) FROM buchungen WHERE haben_id = k.id), 0) AS saldo_ct,
        (SELECT count(*) FROM buchungen WHERE soll_id = k.id OR haben_id = k.id) AS anzahl
      FROM konten k WHERE k.objekt_id = ? ${klasse ? 'AND k.klasse = ?' : ''} ORDER BY k.nr`, ...(klasse ? [objektId, klasse] : [objektId])),

    kontoLoeschen: (id) => {
      if (get('SELECT count(*) AS n FROM buchungen WHERE soll_id = ?1 OR haben_id = ?1', id).n)
        throw new Error('Auf diesem Konto gibt es Buchungen. Setze es stattdessen auf „inaktiv“.');
      if (get('SELECT vertrag_id FROM konten WHERE id = ?', id)?.vertrag_id)
        throw new Error('Personenkonten werden automatisch mit dem Vertrag verwaltet.');
      db.prepare('DELETE FROM konten WHERE id = ?').run(id);
    },

    buchen,

    buchungen: (objektId, { von = '0000-01-01', bis = '9999-12-31', konto_id = null, suche = '' } = {}) => all(`${BUCHUNG_SQL}
      WHERE b.objekt_id = ? AND b.datum BETWEEN ? AND ? ${konto_id ? 'AND (b.soll_id = ? OR b.haben_id = ?)' : ''}
      ${suche ? "AND (b.text LIKE ? OR b.beleg LIKE ? OR s.bezeichnung LIKE ? OR h.bezeichnung LIKE ?)" : ''}
      ORDER BY b.datum DESC, b.id DESC LIMIT 2000`,
    objektId, von, bis, ...(konto_id ? [konto_id, konto_id] : []), ...(suche ? Array(4).fill(`%${suche}%`) : [])),

    // Reverses a posting (and its whole split group) with counter-postings dated today; the original stays.
    buchungStornieren: (id, datum = new Date().toISOString().slice(0, 10)) => tx(() => {
      const b = get('SELECT * FROM buchungen WHERE id = ?', id);
      if (!b) throw new Error('Buchung nicht gefunden');
      if (get('SELECT 1 FROM buchungen WHERE storno_von = ?', id)) throw new Error('Diese Buchung wurde bereits storniert.');
      const gruppe = b.gruppe ? all('SELECT * FROM buchungen WHERE gruppe = ? ORDER BY id', b.gruppe) : [b];
      let neueGruppe = null;
      for (const [i, x] of gruppe.entries()) {
        const nid = Number(db.prepare(`INSERT INTO buchungen (objekt_id, datum, beleg, text, betrag_ct, soll_id, haben_id, art, monat, gruppe, storno_von)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'storno', ?, ?, ?)`).run(x.objekt_id, datum, x.beleg, `Storno: ${x.text ?? ''}`.slice(0, 300), x.betrag_ct,
          x.haben_id, x.soll_id, x.monat, neueGruppe, x.id).lastInsertRowid);
        if (i === 0 && gruppe.length > 1) { neueGruppe = nid; db.prepare('UPDATE buchungen SET gruppe = ? WHERE id = ?').run(nid, nid); }
      }
      return gruppe.length;
    }),

    // Assigns a posting (with its whole split group) to a unit, or removes the assignment (einheitId null).
    buchungEinheitSetzen: (id, einheitId) => tx(() => {
      const b = get('SELECT id, gruppe, objekt_id FROM buchungen WHERE id = ?', id);
      if (!b) throw new Error('Buchung nicht gefunden');
      if (einheitId && !get('SELECT 1 FROM einheiten WHERE id = ? AND objekt_id = ?', einheitId, b.objekt_id)) throw new Error('Die Einheit gehört nicht zu diesem Objekt.');
      if (b.gruppe) db.prepare('UPDATE buchungen SET einheit_id = ? WHERE gruppe = ?').run(einheitId || null, b.gruppe);
      else db.prepare('UPDATE buchungen SET einheit_id = ? WHERE id = ?').run(einheitId || null, id);
    }),

    buchungLoeschen: (id) => tx(() => {
      const b = get('SELECT gruppe FROM buchungen WHERE id = ?', id);
      if (b?.gruppe) db.prepare('DELETE FROM buchungen WHERE gruppe = ?').run(b.gruppe);
      else db.prepare('DELETE FROM buchungen WHERE id = ?').run(id);
    }),

    kontoauszug: (kontoId, von, bis) => {
      const anfang = saldo(kontoId, prevDay(von));
      let lauf = anfang;
      const zeilen = all(`${BUCHUNG_SQL} WHERE (b.soll_id = ?1 OR b.haben_id = ?1) AND b.datum BETWEEN ?2 AND ?3
        ORDER BY b.datum, b.id`, kontoId, von, bis).map((b) => {
        const soll = b.soll_id === kontoId ? b.betrag_ct : 0;
        const haben = b.haben_id === kontoId ? b.betrag_ct : 0;
        lauf += soll - haben;
        return { ...b, soll_ct: soll, haben_ct: haben, saldo_ct: lauf, gegen_id: b.soll_id === kontoId ? b.haben_id : b.soll_id,
          gegen: b.soll_id === kontoId ? `${b.haben_nr} ${b.haben_bez}` : `${b.soll_nr} ${b.soll_bez}` };
      });
      return { konto: get('SELECT * FROM konten WHERE id = ?', kontoId), anfang_ct: anfang, zeilen, ende_ct: lauf };
    },

    saldenliste: (objektId, von, bis) => all(`SELECT k.id, k.nr, k.bezeichnung, k.klasse,
        coalesce((SELECT sum(betrag_ct) FROM buchungen WHERE soll_id = k.id AND datum < ?2), 0) -
        coalesce((SELECT sum(betrag_ct) FROM buchungen WHERE haben_id = k.id AND datum < ?2), 0) AS anfang_ct,
        coalesce((SELECT sum(betrag_ct) FROM buchungen WHERE soll_id = k.id AND datum BETWEEN ?2 AND ?3), 0) AS soll_ct,
        coalesce((SELECT sum(betrag_ct) FROM buchungen WHERE haben_id = k.id AND datum BETWEEN ?2 AND ?3), 0) AS haben_ct
      FROM konten k WHERE k.objekt_id = ?1 ORDER BY k.nr`, objektId, von, bis)
      .map((k) => ({ ...k, ende_ct: k.anfang_ct + k.soll_ct - k.haben_ct }))
      .filter((k) => k.anfang_ct || k.soll_ct || k.haben_ct),

    // Generates monthly charges for all contracts of an object; existing charges are not duplicated.
    // A line whose booked amount differs from the contract is marked `abweichend` (see sollAbgleich).
    sollstellung: (objektId, vonMonat, bisMonat, nurVorschau = false, typen = ['miete', 'weg']) => {
      const zeilen = [];
      for (const typ of typen) {
        const vertraege = all(`SELECT v.*, e.bezeichnung AS einheit, ${PERSON_NAME} AS name FROM ${vertragTabelle(typ)} v
          JOIN einheiten e ON e.id = v.einheit_id JOIN personen p ON p.id = v.person_id WHERE e.objekt_id = ?`, objektId);
        for (const v of vertraege)
          for (const monat of monatsliste(vonMonat, bisMonat)) zeilen.push(...sollZeilenVertrag(typ, v, monat));
      }
      for (const z of zeilen) z.abweichend = z.vorhanden && z.vorhanden_ct !== z.betrag_ct;
      // Months in a closed (locked) period are not charged automatically any more.
      const gesperrt = gesperrtBis();
      for (const z of zeilen) if (z.datum <= gesperrt) z.vorhanden = true;
      if (!nurVorschau) tx(() => { for (const z of zeilen.filter((z) => !z.vorhanden)) sollEinfuegen(objektId, z); });
      return zeilen;
    },

    sollAbgleich: (typ, vertragId, opt) => sollAbgleich(typ, vertragId, opt),
    sollAutomatisch,
    naechsteFaelligkeit,

    // State of a contract account for the payment form: overdue, due today, credit and the next charge.
    kontoStatus: (kontoId, stichtag = new Date().toISOString().slice(0, 10)) => {
      const k = get('SELECT * FROM konten WHERE id = ?', kontoId);
      if (!k?.vertrag_id) return null;
      const op = offenePostenKonto(kontoId, stichtag);
      const v = get(`SELECT beginn, ende FROM ${vertragTabelle(k.vertrag_typ)} WHERE id = ?`, k.vertrag_id);
      const ueberfaellig = op.offen.filter((o) => o.verzug >= 1);
      return {
        typ: k.vertrag_typ, vertrag_id: k.vertrag_id, beginn: v?.beginn ?? null, ende: v?.ende ?? null,
        ueberfaellig_ct: Math.max(0, ueberfaellig.reduce((s, o) => s + o.offen_ct, 0) - op.guthaben_ct),
        offene_monate: ueberfaellig.map((o) => o.text),
        heute_faellig_ct: op.offen.filter((o) => o.verzug < 1).reduce((s, o) => s + o.offen_ct, 0),
        guthaben_ct: op.guthaben_ct,
        saldo_ct: op.summe_ct,
        naechste: naechsteFaelligkeit(k.vertrag_typ, k.vertrag_id, stichtag),
      };
    },

    offenePosten: (objektId, stichtag = new Date().toISOString().slice(0, 10), typ = null) => {
      const konten = all(`SELECT k.*, (SELECT max(stufe) FROM mahnungen m WHERE m.konto_id = k.id) AS mahnstufe,
          (SELECT max(datum) FROM mahnungen m WHERE m.konto_id = k.id) AS letzte_mahnung
        FROM konten k WHERE k.objekt_id = ? AND k.klasse = 'person' AND (?2 IS NULL OR k.vertrag_typ = ?2) ORDER BY k.nr`, objektId, typ);
      return konten.map((k) => {
        const op = offenePostenKonto(k.id, stichtag);
        const v = get(`SELECT v.*, p.* , v.id AS vertrag_id FROM ${vertragTabelle(k.vertrag_typ)} v JOIN personen p ON p.id = v.person_id WHERE v.id = ?`, k.vertrag_id);
        return { konto: k, person: v, ...op };
      }).filter((x) => x.summe_ct !== 0 || x.offen.length);
    },

    // ---------- Instalment agreements ----------
    // The plan covers the arrears on the day it was agreed. Payments settle the oldest months first, so what is
    // still open of the months due up to that day is what remains of the plan.
    ratenplanAnlegen: ({ konto_id, datum, betrag_ct, rate_ct, erste_rate, notiz = null }) => {
      if (!(rate_ct > 0) || !(betrag_ct > 0)) throw new Error('Bitte Rückstand und Ratenhöhe angeben.');
      return Number(db.prepare(`INSERT INTO ratenplaene (konto_id, datum, betrag_ct, rate_ct, erste_rate, notiz) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(konto_id, datum, betrag_ct, rate_ct, erste_rate, notiz).lastInsertRowid);
    },
    ratenplanSetzen: (id, felder) => {
      const erlaubt = ['status', 'notiz', 'dokument_id'];
      const keys = Object.keys(felder).filter((k) => erlaubt.includes(k));
      if (keys.length) db.prepare(`UPDATE ratenplaene SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => felder[k]), id);
    },
    ratenplanStand: (id, stichtag = new Date().toISOString().slice(0, 10)) => ratenplanStand(id, stichtag),

    // Records a reminder; a fee becomes a charge on the contract account.
    mahnen: ({ konto_id, stufe, gebuehr_ct = 0, frist, datum, offen_ct }) => tx(() => {
      const k = get('SELECT * FROM konten WHERE id = ?', konto_id);
      db.prepare('INSERT INTO mahnungen (konto_id, datum, stufe, offen_ct, gebuehr_ct, frist) VALUES (?, ?, ?, ?, ?, ?)')
        .run(konto_id, datum, stufe, offen_ct, gebuehr_ct, frist ?? null);
      if (gebuehr_ct > 0) {
        const ertrag = kontoKat(k.objekt_id, 'mahngebuehr');
        if (ertrag) db.prepare(`INSERT INTO buchungen (objekt_id, datum, text, betrag_ct, soll_id, haben_id, art)
          VALUES (?, ?, ?, ?, ?, ?, 'mahngebuehr')`).run(k.objekt_id, datum, `Mahngebühr ${stufe}. Mahnung`, gebuehr_ct, k.id, ertrag.id);
      }
    }),

    mahnungen: (kontoId) => all('SELECT * FROM mahnungen WHERE konto_id = ? ORDER BY datum DESC', kontoId),

    anpassungen: (typ, vertragId) => all('SELECT * FROM anpassungen WHERE vertrag_typ = ? AND vertrag_id = ? ORDER BY gueltig_ab', typ, vertragId),

    zaehler: (objektId) => all(`SELECT z.*, e.nr AS einheit_nr, e.bezeichnung AS einheit_bez,
        (SELECT stand FROM zaehlerstaende s WHERE s.zaehler_id = z.id ORDER BY datum DESC LIMIT 1) AS letzter_stand,
        (SELECT datum FROM zaehlerstaende s WHERE s.zaehler_id = z.id ORDER BY datum DESC LIMIT 1) AS letztes_datum
      FROM zaehler z LEFT JOIN einheiten e ON e.id = z.einheit_id WHERE z.objekt_id = ? ORDER BY z.art, e.nr, z.nummer`, objektId),

    zaehlerstaende: (zaehlerId) => all('SELECT * FROM zaehlerstaende WHERE zaehler_id = ? ORDER BY datum DESC', zaehlerId),

    // Saves many readings at once (reading day for the whole house).
    ablesung: (datum, werte) => tx(() => {
      const st = db.prepare(`INSERT INTO zaehlerstaende (zaehler_id, datum, stand) VALUES (?, ?, ?)
        ON CONFLICT (zaehler_id, datum) DO UPDATE SET stand = excluded.stand`);
      for (const [id, stand] of Object.entries(werte)) if (stand != null && stand !== '') st.run(Number(id), datum, Number(stand));
    }),

    // Suggests a counter account for each bank transaction: returned debits, open invoices, learned rules, then the payer's IBAN.
    bankVorschlaege: (objektId, umsaetze) => {
      const regeln = all('SELECT * FROM bankregeln WHERE objekt_id = ? ORDER BY length(muster) DESC', objektId);
      const personKonten = all(`SELECT k.id, k.vertrag_typ, k.vertrag_id, k.bezeichnung, p.iban, p.nachname FROM konten k
        JOIN (SELECT 'miete' AS t, id, person_id, ende FROM mietverhaeltnisse UNION ALL SELECT 'weg', id, person_id, ende FROM eigentum) v
          ON v.t = k.vertrag_typ AND v.id = k.vertrag_id
        JOIN personen p ON p.id = v.person_id WHERE k.objekt_id = ? ORDER BY (v.ende IS NULL OR v.ende = '') DESC`, objektId);
      // Open invoices of this object (documents) and of projects linked to it.
      const rechnungen = all(`SELECT id, titel, absender, betrag_ct, iban, rechnungsnr FROM dokumente
        WHERE objekt_id = ? AND typ = 'Rechnung' AND buchung_id IS NULL AND betrag_ct > 0`, objektId);
      const projektRechnungen = all(`SELECT pp.id, pp.titel, pp.firma, pp.betrag_ct, p.kosten_konto_id, p.titel AS projekt FROM projektposten pp
        JOIN projekte p ON p.id = pp.projekt_id WHERE p.objekt_id = ? AND pp.art = 'rechnung' AND pp.buchung_id IS NULL AND pp.status <> 'bezahlt'`, objektId);
      const norm = (s) => (s ?? '').replace(/\s/g, '').toUpperCase();
      const RUECKLAST = /r(ü|ue|u)ck(lastschrift|buchung|ueberweisung|überweisung)|retoure|r-transaktion|(^|\W)(AC04|AC06|AM04|MD01|MD06|MS02|MS03)(\W|$)/i;
      return umsaetze.map((u) => {
        const doppelt = !!get('SELECT 1 FROM buchungen WHERE import_ref = ?', u.ref);
        const text = `${u.name ?? ''} ${u.zweck ?? ''} ${u.iban ?? ''}`.toLowerCase();
        const r = { ...u, konto_id: null, doppelt, hinweis: null, ruecklast: false, dokument_id: null, projektposten_id: null };
        // A returned direct debit re-opens the tenant's or owner's charge: book it back onto their account.
        if (u.betrag_ct < 0 && RUECKLAST.test(`${u.name} ${u.zweck}`)) {
          const k = (u.iban && personKonten.find((p) => norm(p.iban) && norm(p.iban) === norm(u.iban))) ||
            personKonten.find((p) => p.nachname && text.includes(p.nachname.toLowerCase()));
          r.ruecklast = true;
          r.konto_id = k?.id ?? null;
          r.hinweis = k ? `Rücklastschrift – wird ${k.bezeichnung} wieder belastet` : 'Rücklastschrift – Person bitte wählen';
          return r;
        }
        if (u.betrag_ct < 0) {
          const betrag = -u.betrag_ct;
          const re = rechnungen.find((d) => d.betrag_ct === betrag && ((d.iban && norm(d.iban) === norm(u.iban)) ||
            (d.rechnungsnr && text.includes(d.rechnungsnr.toLowerCase())) || (d.absender && text.includes(d.absender.toLowerCase().split(' ')[0]))));
          if (re) {
            r.dokument_id = re.id;
            r.konto_id = get(`SELECT b.soll_id FROM dokumente d JOIN buchungen b ON b.id = d.buchung_id
              WHERE d.objekt_id = ? AND d.absender = ? ORDER BY d.id DESC LIMIT 1`, objektId, re.absender)?.soll_id ?? null;
            r.hinweis = `Rechnung erkannt: ${re.absender ?? re.titel}${re.rechnungsnr ? ` (${re.rechnungsnr})` : ''}${r.konto_id ? '' : ' – Kostenart wählen'}`;
          } else {
            const pr = projektRechnungen.find((x) => x.betrag_ct === betrag && (!x.firma || text.includes(x.firma.toLowerCase().split(' ')[0])));
            if (pr) {
              r.projektposten_id = pr.id;
              r.konto_id = pr.kosten_konto_id;
              r.hinweis = `Projektrechnung erkannt: ${pr.projekt} – ${pr.firma ?? ''} ${pr.titel}`;
            }
          }
        }
        if (!r.konto_id) r.konto_id = regeln.find((x) => text.includes(x.muster.toLowerCase()))?.konto_id ?? null;
        if (!r.konto_id && u.iban) r.konto_id = personKonten.find((k) => norm(k.iban) && norm(k.iban) === norm(u.iban))?.id ?? null;
        if (!r.konto_id && u.name) r.konto_id = personKonten.find((k) => k.nachname && u.betrag_ct > 0 && text.includes(k.nachname.toLowerCase()))?.id ?? null;
        return r;
      });
    },

    bankBuchen: (objektId, geldKontoId, zeilen, lernen) => tx(() => {
      let n = 0;
      for (const z of zeilen) {
        if (!z.konto_id || get('SELECT 1 FROM buchungen WHERE import_ref = ?', z.ref)) continue;
        const ein = z.betrag_ct > 0;
        const text = `${z.ruecklast ? 'Rücklastschrift: ' : ''}${[z.name, z.zweck].filter(Boolean).join(' – ')}`.slice(0, 300);
        const id = Number(db.prepare(`INSERT INTO buchungen (objekt_id, datum, text, betrag_ct, soll_id, haben_id, art, import_ref)
          VALUES (?, ?, ?, ?, ?, ?, 'bank', ?)`).run(objektId, z.datum, text,
          Math.abs(z.betrag_ct), ein ? geldKontoId : z.konto_id, ein ? z.konto_id : geldKontoId, z.ref).lastInsertRowid);
        n++;
        if (z.dokument_id) db.prepare('UPDATE dokumente SET buchung_id = ? WHERE id = ? AND buchung_id IS NULL').run(id, z.dokument_id);
        if (z.projektposten_id) db.prepare(`UPDATE projektposten SET buchung_id = ?, status = 'bezahlt', bezahlt_am = ? WHERE id = ?`).run(id, z.datum, z.projektposten_id);
        // A returned debit gets a case so the follow-up (contact, fee, new debit) is not forgotten.
        if (z.ruecklast) db.prepare(`INSERT INTO vorgaenge (objekt_id, titel, kategorie, status, prioritaet, faellig, beschreibung)
          VALUES (?, ?, 'Mieteranfrage', 'offen', 1, date('now', '+3 days'), ?)`).run(objektId,
          `Rücklastschrift ${get('SELECT bezeichnung FROM konten WHERE id = ?', z.konto_id)?.bezeichnung ?? ''}`,
          `Rücklastschrift über ${(Math.abs(z.betrag_ct) / 100).toFixed(2).replace('.', ',')} € am ${z.datum}. ${z.zweck ?? ''}\nBitte Kontakt aufnehmen; Bankgebühren können weiterberechnet werden.`);
        if (lernen && z.muster && !z.ruecklast && !z.dokument_id) db.prepare(`INSERT INTO bankregeln (objekt_id, muster, konto_id) VALUES (?, ?, ?)
          ON CONFLICT (objekt_id, muster) DO UPDATE SET konto_id = excluded.konto_id`).run(objektId, z.muster, z.konto_id);
      }
      return n;
    }),

    bankregeln: (objektId) => all(`SELECT r.*, k.nr, k.bezeichnung FROM bankregeln r JOIN konten k ON k.id = r.konto_id
      WHERE r.objekt_id = ? ORDER BY r.muster`, objektId),

    // Direct-debit candidates: open charges of contracts that pay by SEPA mandate.
    lastschriften: (objektId, stichtag, typen = ['miete', 'weg']) => {
      const out = [];
      for (const typ of typen) {
        for (const v of all(`SELECT v.*, p.vorname, p.nachname, p.firma, p.iban, p.bic, p.kontoinhaber, e.bezeichnung AS einheit
          FROM ${vertragTabelle(typ)} v JOIN personen p ON p.id = v.person_id JOIN einheiten e ON e.id = v.einheit_id
          WHERE e.objekt_id = ? AND v.lastschrift = 1 AND ${aktuell('v')}`, objektId)) {
          const k = kontoVon(typ, v.id);
          if (!k) continue;
          const op = offenePostenKonto(k.id, stichtag);
          if (op.summe_ct > 0) out.push({ typ, vertrag: v, konto_id: k.id, betrag_ct: op.summe_ct });
        }
      }
      return out;
    },
  };
};

function prevDay(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

module.exports.STANDARDKONTEN = STANDARDKONTEN;
module.exports.USTKONTEN = USTKONTEN;
module.exports.tageImMonat = tageImMonat;
module.exports.tageZwischen = tageZwischen;
module.exports.monatsliste = monatsliste;
module.exports.selbstSql = selbstSql;
module.exports.einheitVonSql = einheitVonSql;
