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
// Version of the standard chart; objects created earlier get the accounts added later (marker 'k2' in kontenplan).
const KONTENPLAN_VERSION = 2;

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
      // Accounts added to the standard chart later reach objects whose chart is older.
      const nachtrag = plan.length > 0 && !plan.includes(`k${KONTENPLAN_VERSION}`);
      if (fehlend.length || nachtrag) {
        const keys = Object.fromEntries(all('SELECT typ, id FROM umlageschluessel WHERE objekt_id = ? ORDER BY id DESC', o.id).map((k) => [k.typ, k.id]));
        const ins = db.prepare(`INSERT OR IGNORE INTO konten (objekt_id, nr, bezeichnung, klasse, kategorie, umlagefaehig,
          heizkosten, schluessel_id, weg_schluessel_id, aus_ruecklage, p35a) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
        for (const [nr, bez, klasse, kat, side, x = {}] of STANDARDKONTEN) {
          const neuSeite = fehlend.includes(side) || (side === 'beide' && fehlend.length === seiten.length);
          const neuVersion = nachtrag && (x.seit ?? 1) > 1 && (side === 'beide' || plan.includes(side));
          if (!neuSeite && !neuVersion) continue;
          const sKey = keys[x.schluessel] ?? keys.flaeche ?? null;
          const wKey = (x.schluessel === 'einheiten' ? keys.einheiten : null) ?? keys.mea ?? keys.flaeche ?? null;
          ins.run(o.id, nr, bez, klasse, kat, x.umlagefaehig ?? 0, x.heizkosten ?? 0,
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
    return r;
  }

  function saldo(kontoId, bis = '9999-12-31', von = '0000-01-01') {
    return get(`SELECT
      coalesce((SELECT sum(betrag_ct) FROM buchungen WHERE soll_id = ?1 AND datum BETWEEN ?2 AND ?3), 0) -
      coalesce((SELECT sum(betrag_ct) FROM buchungen WHERE haben_id = ?1 AND datum BETWEEN ?2 AND ?3), 0) AS s`,
    kontoId, von, bis).s;
  }

  // ohneTx: for callers that already run inside a transaction.
  function buchen({ objekt_id, datum, beleg, text, art = 'manuell', monat = null, import_ref = null, positionen }, ohneTx = false) {
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
      const st = db.prepare(`INSERT INTO buchungen (objekt_id, datum, beleg, text, betrag_ct, soll_id, haben_id, art, monat, gruppe, import_ref)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
      let gruppe = null;
      const ids = pos.map((p, i) => {
        const id = Number(st.run(objekt_id, datum, beleg || null, p.text || text || null, p.betrag_ct, p.soll_id, p.haben_id,
          art, p.monat ?? monat, gruppe, i === 0 ? import_ref : null).lastInsertRowid);
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
        offen.push({
          id: p.id, datum: p.datum, monat: p.monat,
          text: p.monat ? `${p.teile.length > 1 ? 'Monatssoll' : p.teile[0].text.replace(/\s\d{2}\/\d{4}.*$/, '')} ${m}/${y}` : p.teile[0].text,
          teile: p.teile, soll_ct: p.soll_ct, bezahlt_ct: bezahlt, offen_ct: p.soll_ct - bezahlt,
          status: bezahlt > 0 ? 'teilweise bezahlt' : 'nicht bezahlt',
          verzug: Math.max(0, tageZwischen(p.datum, stichtag)),
        });
      }
    }
    const guthaben = Math.max(0, zahlungen);
    return { offen, guthaben_ct: guthaben, summe_ct: offen.reduce((s, o) => s + o.offen_ct, 0) - guthaben };
  }

  // Which part of a month a contract is charged for. The month of moving in or out is charged by day unless the
  // contract says "full month" (or, moving in, "from the next month"). The first month is never due before the start.
  function teilmonat(v, monat) {
    const tage = tageImMonat(monat);
    const erster = `${monat}-01`, letzter = `${monat}-${pad(tage)}`;
    if (v.beginn > letzter || (v.ende && v.ende < erster)) return null;
    const beginntHier = v.beginn > erster;
    const endetHier = !!v.ende && v.ende < letzter;
    if (beginntHier && v.teilmonat_beginn === 'folgemonat') return null;
    const ab = beginntHier && v.teilmonat_beginn !== 'voll' ? v.beginn : erster;
    const bis = endetHier && v.teilmonat_ende !== 'voll' ? v.ende : letzter;
    const tageAnteil = tageZwischen(ab, bis) + 1;
    // Due day 0 means the statutory rule: the 3rd working day of the month (§ 556b BGB, Saturdays not counted).
    let datum = v.faelligkeitstag === 0 ? kalender.mieteFaellig(monat, land()) : `${monat}-${pad(Math.min(v.faelligkeitstag || 1, tage))}`;
    if (beginntHier && datum < v.beginn) datum = v.beginn;
    return { anteil: tageAnteil / tage, tage: tageAnteil, tage_monat: tage, datum, stichtag: beginntHier ? v.beginn : erster };
  }

  function sollZeile({ monat, datum, konto, ertrag, v, typ, posten, betrag_ct, t }) {
    const vorhanden = get(`SELECT id FROM buchungen WHERE art = 'soll' AND soll_id = ? AND haben_id = ? AND monat = ?`, konto.id, ertrag.id, monat);
    return { monat, datum, konto_id: konto.id, name: v.name, einheit: v.einheit, typ, vertrag_id: v.id, einheit_id: v.einheit_id, person_id: v.person_id,
      posten, betrag_ct, ertrag_id: ertrag.id, vorhanden: !!vorhanden, anteilig: t.anteil < 1, tage: t.tage, tage_monat: t.tage_monat };
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
    teilmonat,
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
    sollstellung: (objektId, vonMonat, bisMonat, nurVorschau = false, typen = ['miete', 'weg']) => {
      const zeilen = [];
      for (const typ of typen) {
        const vertraege = all(`SELECT v.*, e.bezeichnung AS einheit, ${PERSON_NAME} AS name FROM ${vertragTabelle(typ)} v
          JOIN einheiten e ON e.id = v.einheit_id JOIN personen p ON p.id = v.person_id WHERE e.objekt_id = ?`, objektId);
        for (const v of vertraege) {
          const konto = kontoVon(typ, v.id);
          if (!konto) continue;
          for (const monat of monatsliste(vonMonat, bisMonat)) {
            const t = teilmonat(v, monat);
            if (!t) continue;
            const b = betraege(typ, v.id, t.stichtag);
            let netto = 0;
            for (const [feld, kat, label] of POSTEN[typ]) {
              const betrag = Math.round((b[feld] ?? 0) * t.anteil);
              if (betrag <= 0) continue;
              const ertrag = kontoKat(objektId, kat);
              if (!ertrag) continue;
              netto += betrag;
              zeilen.push(sollZeile({ monat, datum: t.datum, konto, ertrag, v, typ, posten: label, betrag_ct: betrag, t }));
            }
            // Commercial lettings with VAT: one VAT charge per month on the net total.
            const satz = typ === 'miete' ? Number(v.ust_satz) || 0 : 0;
            if (satz > 0 && netto > 0) {
              const ust = kontoKat(objektId, satz === 7 ? 'ust7' : 'ust19', 'steuer');
              if (ust) zeilen.push(sollZeile({ monat, datum: t.datum, konto, ertrag: ust, v, typ,
                posten: `USt ${String(satz).replace('.', ',')} %`, betrag_ct: Math.round(netto * satz / 100), t }));
            }
          }
        }
      }
      // Months in a closed (locked) period are not charged automatically any more.
      const gesperrt = get(`SELECT wert FROM einstellungen WHERE schluessel = 'festgeschrieben_bis'`)?.wert ?? '0000-00-00';
      for (const z of zeilen) if (z.datum <= gesperrt) z.vorhanden = true;
      if (!nurVorschau) {
        tx(() => {
          const st = db.prepare(`INSERT INTO buchungen (objekt_id, datum, text, betrag_ct, soll_id, haben_id, art, monat)
            VALUES (?, ?, ?, ?, ?, ?, 'soll', ?)`);
          for (const z of zeilen.filter((z) => !z.vorhanden)) {
            const [y, m] = z.monat.split('-');
            st.run(objektId, z.datum, `${z.posten} ${m}/${y}${z.anteilig ? ` (anteilig ${z.tage}/${z.tage_monat} Tage)` : ''}`, z.betrag_ct, z.konto_id, z.ertrag_id, z.monat);
          }
        });
      }
      return zeilen;
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
