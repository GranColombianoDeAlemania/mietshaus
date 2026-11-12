const ortszeit = require('./zeit.cjs');
// Private finances of one user: accounts with their movements (also split into parts, expected ones, transfers),
// categories in two levels, budgets per month, quarter or year, contracts and standing orders with notice periods,
// rules that categorise, reconciliation with the bank's balance, loans with their repayment plan, a depot with prices,
// evaluations, comparisons and forecasts – and the way between the private money and the houses and projects.
// Every function takes the user first (b; the server puts the signed-in user there, 0 in the local mode) and reads or
// changes only that user's rows.
module.exports = function finanzen({ db, all, get, tx, bh }) {
  const B = (b) => Number(b) || 0;
  const mein = (tabelle, id, b) => {
    const r = get(`SELECT * FROM ${tabelle} WHERE id = ? AND benutzer = ?`, id, B(b));
    if (!r) throw new Error('Diesen Eintrag gibt es nicht (mehr).');
    return r;
  };
  const ct = (x) => (x == null || x === '' ? null : Math.round(Number(x)));
  const monatVon = (iso) => String(iso).slice(0, 7);
  const monatsende = (monat) => { const [j, m] = monat.split('-').map(Number); return `${monat}-${String(new Date(Date.UTC(j, m, 0)).getUTCDate()).padStart(2, '0')}`; };
  const plusMonate = (iso, n) => {
    const [j, m, t] = iso.split('-').map(Number);
    const ziel = new Date(Date.UTC(j, m - 1 + n, 1));
    const letzter = new Date(Date.UTC(ziel.getUTCFullYear(), ziel.getUTCMonth() + 1, 0)).getUTCDate();
    return `${ziel.getUTCFullYear()}-${String(ziel.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(t, letzter)).padStart(2, '0')}`;
  };
  const plusTage = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const falten = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

  // Which rows count for what: the balance takes whole movements (a split's parts are only its explanation);
  // income, expenses and categories take plain movements and the parts of split ones, never transfers.
  const GANZ = (x) => `${x}.split_von IS NULL`;
  const WERT = (x) => `${x}.umbuchung_id IS NULL AND NOT EXISTS (SELECT 1 FROM fin_buchungen t WHERE t.split_von = ${x}.id)`;

  // Categories to start with (created at the first use, all changeable): [name, kind, fixed costs, tax tag].
  const START = [
    ['Gehalt', 'einnahme'], ['Mieteinnahmen', 'einnahme'], ['Kapitalerträge', 'einnahme', 0, 'kapital'], ['Kindergeld', 'einnahme'], ['Sonstige Einnahmen', 'einnahme'],
    ['Wohnen', 'ausgabe', 1], ['Strom, Gas, Wasser', 'ausgabe', 1], ['Internet und Telefon', 'ausgabe', 1], ['Versicherungen', 'ausgabe', 1, 'vorsorge'],
    ['Lebensmittel', 'ausgabe'], ['Mobilität', 'ausgabe'], ['Gesundheit', 'ausgabe', 0, 'aussergewoehnlich'], ['Freizeit', 'ausgabe'], ['Kleidung', 'ausgabe'],
    ['Abos und Mitgliedschaften', 'ausgabe', 1], ['Handwerker und Haushaltshilfe', 'ausgabe', 0, 'haushaltsnah'], ['Spenden', 'ausgabe', 0, 'spenden'],
    ['Beruf und Fortbildung', 'ausgabe', 0, 'werbungskosten'], ['Steuern', 'ausgabe'], ['Immobilien', 'ausgabe'], ['Kreditzinsen', 'ausgabe', 1], ['Sonstige Ausgaben', 'ausgabe'],
  ];
  function kategorien(b) {
    if (!get('SELECT 1 AS x FROM fin_kategorien WHERE benutzer = ? LIMIT 1', B(b))) {
      const ins = db.prepare('INSERT INTO fin_kategorien (benutzer, name, art, fix, steuer) VALUES (?, ?, ?, ?, ?)');
      tx(() => { for (const [name, art, fix = 0, steuer = null] of START) ins.run(B(b), name, art, fix, steuer); });
    }
    return all(`SELECT c.*, e.name AS eltern, CASE WHEN e.name IS NULL THEN c.name ELSE e.name || ' › ' || c.name END AS pfad
      FROM fin_kategorien c LEFT JOIN fin_kategorien e ON e.id = c.eltern_id WHERE c.benutzer = ? ORDER BY c.art DESC, c.archiviert, pfad COLLATE NOCASE`, B(b));
  }
  // A category with its sub-categories.
  const mitUnter = (b, id) => [id, ...all('SELECT id FROM fin_kategorien WHERE benutzer = ? AND eltern_id = ?', B(b), id).map((c) => c.id)];

  const SALDO = `k.anfang_ct + coalesce((SELECT sum(x.betrag_ct) FROM fin_buchungen x WHERE x.konto_id = k.id AND ${GANZ('x')}), 0)`;
  const DEPOT = `coalesce((SELECT sum(cast(round(w.stueck * coalesce(w.kurs_ct, 0)) AS INTEGER)) FROM fin_wertpapiere w WHERE w.konto_id = k.id), 0)`;
  function konten(b) {
    return all(`SELECT k.*, ${SALDO} AS saldo_ct, ${DEPOT} AS depot_ct, (SELECT count(*) FROM fin_buchungen x WHERE x.konto_id = k.id AND ${GANZ('x')}) AS buchungen,
        (SELECT max(x.datum) FROM fin_buchungen x WHERE x.konto_id = k.id) AS letzte,
        (SELECT count(*) FROM fin_buchungen x WHERE x.konto_id = k.id AND x.neu = 1 AND ${GANZ('x')}) AS neue
      FROM fin_konten k WHERE k.benutzer = ? ORDER BY k.archiviert, coalesce(k.gruppe, ''), k.sort, k.id`, B(b)).map((k) => {
      // What the account is worth (cash plus securities), and where it stands against its limits and the bank's balance.
      const wert = k.saldo_ct + k.depot_ct;
      const zumStichtag = k.bank_saldo_datum == null ? null : k.anfang_ct + get(`SELECT coalesce(sum(x.betrag_ct), 0) AS s FROM fin_buchungen x
        WHERE x.konto_id = ? AND ${GANZ('x')} AND x.vorgemerkt = 0 AND x.datum <= ?`, k.id, k.bank_saldo_datum).s;
      return { ...k, wert_ct: wert, abgleich_ct: k.bank_saldo_ct == null || zumStichtag == null ? null : k.bank_saldo_ct - zumStichtag,
        warnung: k.dispo_ct != null && k.saldo_ct < -k.dispo_ct ? 'dispo' : k.min_ct != null && k.saldo_ct < k.min_ct ? 'min' : null };
    });
  }

  // The first rule that fits a movement: its text in payee and/or purpose, and – when given – account and amount range.
  const regelnVon = (b) => all('SELECT * FROM fin_regeln WHERE benutzer = ? ORDER BY rang DESC, length(muster) DESC, id', B(b));
  function regelFuer(regeln, x) {
    const e = falten(x.empfaenger), z = falten(x.zweck), betrag = Math.abs(x.betrag_ct ?? 0);
    return regeln.find((r) => {
      const m = falten(r.muster);
      const text = r.feld === 'empfaenger' ? e.includes(m) : r.feld === 'zweck' ? z.includes(m) : `${e} ${z}`.includes(m);
      return text && (r.konto_id == null || r.konto_id === x.konto_id) && (r.betrag_von_ct == null || betrag >= r.betrag_von_ct) && (r.betrag_bis_ct == null || betrag <= r.betrag_bis_ct);
    }) ?? null;
  }

  // Sums per category between two days.
  const jeKategorie = (b, von, bis) => all(`SELECT x.kategorie_id, c.name, c.art, c.fix, c.steuer, c.eltern_id, e.name AS eltern, sum(x.betrag_ct) AS summe_ct, count(*) AS anzahl
    FROM fin_buchungen x LEFT JOIN fin_kategorien c ON c.id = x.kategorie_id LEFT JOIN fin_kategorien e ON e.id = c.eltern_id
    WHERE x.benutzer = ? AND ${WERT('x')} AND x.datum BETWEEN ? AND ? GROUP BY x.kategorie_id ORDER BY summe_ct`, B(b), von, bis);
  const einAus = (b, von, bis) => get(`SELECT coalesce(sum(CASE WHEN x.betrag_ct > 0 THEN x.betrag_ct END), 0) AS ein_ct, coalesce(-sum(CASE WHEN x.betrag_ct < 0 THEN x.betrag_ct END), 0) AS aus_ct
    FROM fin_buchungen x WHERE x.benutzer = ? AND ${WERT('x')} AND x.datum BETWEEN ? AND ?`, B(b), von, bis);
  // Sub-categories gathered under their main category: [{ name, summe_ct, unter: [...] }], the largest first.
  function gruppiert(zeilen, vorzeichen) {
    const g = new Map();
    for (const r of zeilen) {
      const haupt = r.eltern ?? r.name ?? 'Ohne Kategorie';
      const e = g.get(haupt) ?? { name: haupt, kategorie_id: r.eltern_id ?? r.kategorie_id, summe_ct: 0, anzahl: 0, fix: 0, unter: [] };
      e.summe_ct += vorzeichen * r.summe_ct; e.anzahl += r.anzahl; e.fix = e.fix || r.fix || 0;
      if (r.eltern) e.unter.push({ name: r.name, kategorie_id: r.kategorie_id, summe_ct: vorzeichen * r.summe_ct, anzahl: r.anzahl });
      g.set(haupt, e);
    }
    return [...g.values()].sort((x, y) => y.summe_ct - x.summe_ct);
  }

  const dauerRoh = (b) => all(`SELECT d.*, k.name AS konto, g.name AS gegenkonto, c.name AS kategorie FROM fin_dauer d JOIN fin_konten k ON k.id = d.konto_id
      LEFT JOIN fin_konten g ON g.id = d.gegenkonto_id LEFT JOIN fin_kategorien c ON c.id = d.kategorie_id
    WHERE d.benutzer = ? ORDER BY d.aktiv DESC, d.naechste`, B(b));
  // A contract's term: it renews by itself unless notice was given; notice has to arrive the notice period before the
  // term ends. laufzeit_ende is the end of the term running today, kuendigen_bis the last day for the notice.
  function vertragsstand(d, heute = ortszeit.heute()) {
    let ende = d.laufzeit_bis ?? null;
    if (ende && !d.gekuendigt_am && d.verlaengerung_monate > 0) while (ende < heute) ende = plusMonate(ende, d.verlaengerung_monate);
    const bis = d.kuendbar_bis ?? (ende && d.kuendigungsfrist_tage != null ? plusTage(ende, -d.kuendigungsfrist_tage) : null);
    const stand = d.gekuendigt_am ? 'gekuendigt' : !bis ? null : bis < heute ? 'verpasst' : bis <= plusTage(heute, 60) ? 'bald' : 'ok';
    // A missed notice with automatic renewal: the next chance is one term later.
    const naechste = stand === 'verpasst' && d.verlaengerung_monate > 0 && !d.kuendbar_bis ? plusMonate(bis, d.verlaengerung_monate) : bis;
    return { laufzeit_ende: ende, kuendigen_bis: d.gekuendigt_am ? null : naechste, vertragsstand: stand === 'verpasst' && naechste !== bis ? (naechste <= plusTage(heute, 60) ? 'bald' : 'ok') : stand };
  }
  const dauer = (b) => dauerRoh(b).map((d) => ({ ...d, monatlich_ct: Math.round(d.betrag_ct / d.rhythmus_monate), ...vertragsstand(d) }));
  // The runs of a standing order between two days (a contract under notice stops at its end).
  function* laeufe(d, von, bis) {
    const ende = [d.ende, d.gekuendigt_am ? d.laufzeit_bis : null].filter(Boolean).sort()[0] ?? null;
    for (let t = d.naechste; t <= bis && (!ende || t <= ende); t = plusMonate(t, d.rhythmus_monate)) if (t >= von) yield t;
  }

  // Budgets: the amount is per period (month, quarter, year); the period is the one the given month lies in. With
  // sub-categories their expenses count too; with the forecast, what standing orders will still take in this period.
  function budgets(b, monat = ortszeit.monatJetzt()) {
    const auftraege = dauerRoh(b).filter((d) => d.aktiv && !d.gegenkonto_id && d.betrag_ct < 0);
    const heute = ortszeit.heute();
    return all(`SELECT g.*, c.name, e.name AS eltern FROM fin_budgets g JOIN fin_kategorien c ON c.id = g.kategorie_id LEFT JOIN fin_kategorien e ON e.id = c.eltern_id
      WHERE g.benutzer = ? ORDER BY c.name COLLATE NOCASE`, B(b)).map((g) => {
      const [j, m] = monat.split('-').map(Number);
      const start = g.intervall_monate === 12 ? `${j}-01` : g.intervall_monate === 3 ? `${j}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}` : monat;
      const von = `${start}-01`, bis = monatsende(monatVon(plusMonate(von, g.intervall_monate - 1)));
      const ids = g.mit_unter ? mitUnter(b, g.kategorie_id) : [g.kategorie_id];
      const ist = Math.max(0, -get(`SELECT coalesce(sum(x.betrag_ct), 0) AS s FROM fin_buchungen x WHERE x.benutzer = ? AND ${WERT('x')} AND x.datum BETWEEN ? AND ?
        AND x.kategorie_id IN (${ids.map(() => '?').join(',')})`, B(b), von, bis, ...ids).s);
      let erwartet = 0;
      if (g.prognose) for (const d of auftraege) if (ids.includes(d.kategorie_id)) for (const t of laeufe(d, heute > von ? heute : von, bis)) { void t; erwartet -= d.betrag_ct; }
      const tage = (Date.parse(bis) - Date.parse(von)) / 864e5 + 1, vorbei = Math.min(tage, Math.max(0, (Date.parse(heute) - Date.parse(von)) / 864e5 + 1));
      return { ...g, von, bis, ist_ct: ist, erwartet_ct: erwartet, rest_ct: g.betrag_ct - ist - erwartet,
        // Spending faster than the period passes: the share spent against the share of days gone.
        tempo: g.betrag_ct > 0 && vorbei > 0 ? Math.round((ist / g.betrag_ct) / (vorbei / tage) * 100) : null };
    });
  }

  // Balance at the end of each of the coming months: today's balance plus what the standing orders will move.
  function prognose(b, monate = 6) {
    const heute = ortszeit.heute();
    let stand = konten(b).filter((k) => !k.archiviert).reduce((s, k) => s + k.saldo_ct, 0);
    const auftraege = dauerRoh(b).filter((d) => d.aktiv && !d.gegenkonto_id);
    const reihe = [];
    for (let i = 0; i < monate; i++) {
      const monat = monatVon(plusMonate(`${monatVon(heute)}-01`, i));
      let ein = 0, aus = 0;
      for (const d of auftraege) for (const t of laeufe(d, i === 0 ? heute : `${monat}-01`, monatsende(monat))) { void t; if (d.betrag_ct > 0) ein += d.betrag_ct; else aus -= d.betrag_ct; }
      stand += ein - aus;
      reihe.push({ monat, ein_ct: ein, aus_ct: aus, stand_ct: stand });
    }
    return reihe;
  }

  // Saves one movement; with gegenkonto_id it is a transfer between two own accounts (two rows that belong together).
  function buchungSpeichern(b, row) {
    const konto = mein('fin_konten', row.konto_id, b);
    if (!row.datum) throw new Error('Bitte ein Datum angeben.');
    const betrag = Math.round(Number(row.betrag_ct));
    if (!betrag) throw new Error('Bitte einen Betrag angeben.');
    if (row.kategorie_id) mein('fin_kategorien', row.kategorie_id, b);
    return tx(() => {
      if (row.id) {
        const alt = mein('fin_buchungen', row.id, b);
        if (alt.split_von) throw new Error('Teile einer Splitbuchung werden über die Aufteilung geändert.');
        const teile = get('SELECT count(*) AS n, coalesce(sum(betrag_ct), 0) AS s FROM fin_buchungen WHERE split_von = ?', row.id);
        if (teile.n && teile.s !== betrag) throw new Error('Diese Buchung ist aufgeteilt. Ändere zuerst die Aufteilung, damit die Teile wieder zum Betrag passen.');
        db.prepare(`UPDATE fin_buchungen SET konto_id = ?, datum = ?, valuta = ?, betrag_ct = ?, empfaenger = ?, zweck = ?, kategorie_id = ?, notiz = ?, kennzeichen = ?, vorgemerkt = ?, neu = 0 WHERE id = ?`)
          .run(konto.id, row.datum, row.valuta || null, betrag, row.empfaenger || null, row.zweck || null, alt.umbuchung_id || teile.n ? null : row.kategorie_id || null, row.notiz || null,
            row.kennzeichen || null, row.vorgemerkt ? 1 : 0, row.id);
        db.prepare('UPDATE fin_buchungen SET konto_id = ?, datum = ? WHERE split_von = ?').run(konto.id, row.datum, row.id);
        // The other side of a transfer follows date and amount.
        if (alt.umbuchung_id) db.prepare('UPDATE fin_buchungen SET datum = ?, betrag_ct = ? WHERE id = ? AND benutzer = ?').run(row.datum, -betrag, alt.umbuchung_id, B(b));
        return row.id;
      }
      const ins = db.prepare(`INSERT INTO fin_buchungen (benutzer, konto_id, datum, valuta, betrag_ct, empfaenger, zweck, kategorie_id, notiz, dauer_id, kennzeichen, vorgemerkt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const rest = [row.notiz || null, row.dauer_id ?? null, row.kennzeichen || null, row.vorgemerkt ? 1 : 0];
      if (row.gegenkonto_id) {
        const gegen = mein('fin_konten', row.gegenkonto_id, b);
        if (gegen.id === konto.id) throw new Error('Bitte zwei verschiedene Konten wählen.');
        const a = Number(ins.run(B(b), konto.id, row.datum, row.valuta || null, betrag, row.empfaenger || `Umbuchung ${betrag < 0 ? 'an' : 'von'} ${gegen.name}`, row.zweck || null, null, ...rest).lastInsertRowid);
        const z = Number(ins.run(B(b), gegen.id, row.datum, row.valuta || null, -betrag, row.empfaenger || `Umbuchung ${betrag < 0 ? 'von' : 'an'} ${konto.name}`, row.zweck || null, null, ...rest).lastInsertRowid);
        db.prepare('UPDATE fin_buchungen SET umbuchung_id = CASE id WHEN ? THEN ? ELSE ? END WHERE id IN (?, ?)').run(a, z, a, a, z);
        return a;
      }
      const regel = row.kategorie_id ? null : regelFuer(regelnVon(b), { ...row, konto_id: konto.id, betrag_ct: betrag });
      if (regel?.kennzeichen && !rest[2]) rest[2] = regel.kennzeichen;
      return Number(ins.run(B(b), konto.id, row.datum, row.valuta || null, betrag, row.empfaenger || null, row.zweck || null, row.kategorie_id || regel?.kategorie_id || null, ...rest).lastInsertRowid);
    });
  }

  // The house's account for money that came from or went to the owner privately (created when first needed).
  function privatKonto(objektId) {
    const k = get(`SELECT * FROM konten WHERE objekt_id = ? AND klasse = 'geld' AND kategorie = 'privat'`, objektId);
    if (k) return k;
    let nr = 1900;
    while (get('SELECT 1 AS x FROM konten WHERE objekt_id = ? AND nr = ?', objektId, nr)) nr++;
    const id = Number(db.prepare(`INSERT INTO konten (objekt_id, nr, bezeichnung, klasse, kategorie) VALUES (?, ?, 'Privat (Einlagen und Entnahmen)', 'geld', 'privat')`).run(objektId, nr).lastInsertRowid);
    return get('SELECT * FROM konten WHERE id = ?', id);
  }

  // Repayment plan of a loan account (its balance is the debt): each month interest on the remaining debt, the rest of
  // the instalment repays. sonder_ct: an extra repayment now, to see what it saves.
  function tilgungsplan(b, kontoId, { sonder_ct = 0, rate_ct = null } = {}) {
    const k = konten(b).find((x) => x.id === Number(kontoId));
    if (!k) throw new Error('Diesen Eintrag gibt es nicht (mehr).');
    const rate = Math.abs(ct(rate_ct) ?? k.rate_ct ?? 0), zins = Number(k.zins_prozent) || 0;
    let schuld = Math.max(0, -k.saldo_ct - Math.max(0, ct(sonder_ct) ?? 0));
    const start = schuld;
    if (!schuld) return { schuld_ct: 0, rate_ct: rate, zins_prozent: zins, zeilen: [], zinsen_ct: 0, ende: null, rest_zinsbindung_ct: null, tilgt: true };
    const zeilen = [];
    let zinsen = 0, monat = monatVon(ortszeit.heute()), restBindung = null;
    const ersteZinsen = Math.round(schuld * zins / 1200);
    const tilgt = rate > ersteZinsen;
    for (let i = 0; i < 720 && schuld > 0 && tilgt; i++) {
      monat = monatVon(plusMonate(`${monat}-01`, 1));
      const z = Math.round(schuld * zins / 1200), t = Math.min(schuld, rate - z);
      schuld -= t; zinsen += z;
      zeilen.push({ monat, zins_ct: z, tilgung_ct: t, rate_ct: z + t, rest_ct: schuld });
      if (k.zinsbindung_bis && restBindung == null && monat >= monatVon(k.zinsbindung_bis)) restBindung = schuld;
    }
    return { schuld_ct: start, rate_ct: rate, zins_prozent: zins, zeilen, zinsen_ct: zinsen, ende: zeilen.length && schuld === 0 ? zeilen[zeilen.length - 1].monat : null,
      rest_zinsbindung_ct: restBindung, zinsbindung_bis: k.zinsbindung_bis ?? null, tilgt, erste_zinsen_ct: ersteZinsen };
  }

  // One account day by day over the coming days: where it will be lowest, and whether that breaks its minimum or overdraft.
  function kontoPrognose(b, kontoId, tage = 90) {
    const k = konten(b).find((x) => x.id === Number(kontoId));
    if (!k) throw new Error('Diesen Eintrag gibt es nicht (mehr).');
    const heute = ortszeit.heute(), bis = plusTage(heute, tage);
    const bewegungen = [];
    for (const d of dauerRoh(b).filter((x) => x.aktiv)) {
      const betrag = d.konto_id === k.id ? d.betrag_ct : d.gegenkonto_id === k.id ? -d.betrag_ct : 0;
      if (betrag) for (const t of laeufe(d, heute, bis)) bewegungen.push({ datum: t, betrag_ct: betrag, text: d.empfaenger });
    }
    bewegungen.sort((x, y) => x.datum.localeCompare(y.datum));
    let stand = k.saldo_ct, tief = { datum: heute, stand_ct: stand };
    const punkte = bewegungen.map((m) => { stand += m.betrag_ct; if (stand < tief.stand_ct) tief = { datum: m.datum, stand_ct: stand }; return { ...m, stand_ct: stand }; });
    const grenze = k.dispo_ct != null ? -k.dispo_ct : null;
    return { konto: k.name, start_ct: k.saldo_ct, ende_ct: stand, tief, punkte,
      warnung: grenze != null && tief.stand_ct < grenze ? 'dispo' : k.min_ct != null && tief.stand_ct < k.min_ct ? 'min' : tief.stand_ct < 0 && grenze == null ? 'minus' : null };
  }

  const wertpapiere = (b, kontoId = null) => all(`SELECT w.*, k.name AS konto FROM fin_wertpapiere w JOIN fin_konten k ON k.id = w.konto_id
    WHERE w.benutzer = ?1 AND (?2 IS NULL OR w.konto_id = ?2) ORDER BY w.name COLLATE NOCASE`, B(b), kontoId || null).map((w) => {
    const wert = Math.round(w.stueck * (w.kurs_ct ?? 0));
    return { ...w, wert_ct: wert, gewinn_ct: w.kurs_ct == null ? null : wert - w.einstand_ct, gewinn_prozent: w.kurs_ct == null || !w.einstand_ct ? null : Math.round((wert - w.einstand_ct) / w.einstand_ct * 1000) / 10 };
  });

  return {
    finKonten: konten,
    finKontoSpeichern: (b, row) => {
      const name = String(row.name ?? '').trim();
      if (!name) throw new Error('Bitte einen Namen für das Konto angeben.');
      const w = [name, row.art || 'giro', row.bank || null, String(row.iban ?? '').replace(/\s+/g, '').toUpperCase() || null, Math.round(Number(row.anfang_ct) || 0), row.anfang_datum || null,
        row.archiviert ? 1 : 0, String(row.gruppe ?? '').trim() || null, ct(row.dispo_ct), ct(row.min_ct), ct(row.bank_saldo_ct), row.bank_saldo_ct == null || row.bank_saldo_ct === '' ? null : row.bank_saldo_datum || ortszeit.heute(),
        row.zins_prozent == null || row.zins_prozent === '' ? null : Number(String(row.zins_prozent).replace(',', '.')), ct(row.rate_ct), row.zinsbindung_bis || null];
      if (row.id) {
        mein('fin_konten', row.id, b);
        db.prepare(`UPDATE fin_konten SET name = ?, art = ?, bank = ?, iban = ?, anfang_ct = ?, anfang_datum = ?, archiviert = ?, gruppe = ?, dispo_ct = ?, min_ct = ?, bank_saldo_ct = ?, bank_saldo_datum = ?,
          zins_prozent = ?, rate_ct = ?, zinsbindung_bis = ? WHERE id = ?`).run(...w, row.id);
        return row.id;
      }
      return Number(db.prepare(`INSERT INTO fin_konten (benutzer, name, art, bank, iban, anfang_ct, anfang_datum, archiviert, gruppe, dispo_ct, min_ct, bank_saldo_ct, bank_saldo_datum, zins_prozent, rate_ct, zinsbindung_bis)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(B(b), ...w).lastInsertRowid);
    },
    // An account with movements is archived instead of deleted, so no history is lost by a slip.
    finKontoLoeschen: (b, id) => {
      mein('fin_konten', id, b);
      // Contracts and securities hang on the account too: deleting it would take them along without a word.
      if (get(`SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM fin_buchungen WHERE konto_id = ?1) OR EXISTS (SELECT 1 FROM fin_dauer WHERE konto_id = ?1 OR gegenkonto_id = ?1)
        OR EXISTS (SELECT 1 FROM fin_wertpapiere WHERE konto_id = ?1)`, id)) { db.prepare('UPDATE fin_konten SET archiviert = 1 WHERE id = ?').run(id); return 'archiviert'; }
      db.prepare('DELETE FROM fin_konten WHERE id = ?').run(id);
      return 'geloescht';
    },
    // Reconciliation: the balance the bank shows on a day. The difference to the own movements up to that day says
    // whether something is missing or double; with ausgleichen the difference is booked as a correction.
    finAbgleich: (b, kontoId, { bank_saldo_ct, datum = null, ausgleichen = false } = {}) => tx(() => {
      mein('fin_konten', kontoId, b);
      const tag = datum || ortszeit.heute();
      db.prepare('UPDATE fin_konten SET bank_saldo_ct = ?, bank_saldo_datum = ? WHERE id = ?').run(ct(bank_saldo_ct), tag, kontoId);
      let k = konten(b).find((x) => x.id === Number(kontoId));
      if (ausgleichen && k.abgleich_ct) {
        buchungSpeichern(b, { konto_id: kontoId, datum: tag, betrag_ct: k.abgleich_ct, empfaenger: 'Abgleich mit dem Kontostand der Bank', kennzeichen: 'Abgleich' });
        k = konten(b).find((x) => x.id === Number(kontoId));
      }
      return { abgleich_ct: k.abgleich_ct, saldo_ct: k.saldo_ct };
    }),
    finKontoPrognose: kontoPrognose,
    finTilgungsplan: tilgungsplan,

    finKategorien: kategorien,
    finKategorieSpeichern: (b, row) => {
      const name = String(row.name ?? '').trim();
      if (!name) throw new Error('Bitte einen Namen für die Kategorie angeben.');
      if (!['einnahme', 'ausgabe'].includes(row.art)) throw new Error('Einnahme oder Ausgabe?');
      // Two levels: a main category and its sub-categories of the same kind.
      let eltern = null;
      if (row.eltern_id) {
        const e = mein('fin_kategorien', row.eltern_id, b);
        if (e.eltern_id) throw new Error('Unterkategorien gehen nur eine Ebene tief.');
        if (e.art !== row.art) throw new Error('Haupt- und Unterkategorie müssen beide Einnahme oder beide Ausgabe sein.');
        if (row.id && (Number(row.id) === e.id || get('SELECT 1 AS x FROM fin_kategorien WHERE eltern_id = ? LIMIT 1', row.id))) throw new Error('Eine Kategorie mit Unterkategorien kann nicht selbst Unterkategorie werden.');
        eltern = e.id;
      }
      const w = [name, row.art, row.fix ? 1 : 0, row.steuer || null, row.archiviert ? 1 : 0, eltern];
      if (row.id) { mein('fin_kategorien', row.id, b); db.prepare('UPDATE fin_kategorien SET name = ?, art = ?, fix = ?, steuer = ?, archiviert = ?, eltern_id = ? WHERE id = ?').run(...w, row.id); return row.id; }
      return Number(db.prepare('INSERT INTO fin_kategorien (benutzer, name, art, fix, steuer, archiviert, eltern_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(B(b), ...w).lastInsertRowid);
    },
    finKategorieLoeschen: (b, id) => {
      mein('fin_kategorien', id, b);
      if (get('SELECT 1 AS x FROM fin_buchungen WHERE kategorie_id = ? LIMIT 1', id) || get('SELECT 1 AS x FROM fin_kategorien WHERE eltern_id = ? LIMIT 1', id)) {
        db.prepare('UPDATE fin_kategorien SET archiviert = 1 WHERE id = ?').run(id);
        return 'archiviert';
      }
      db.prepare('DELETE FROM fin_kategorien WHERE id = ?').run(id);
      return 'geloescht';
    },

    finBuchungen: (b, { konto_id = null, von = null, bis = null, kategorie_id = null, suche = '', ohne_kategorie = false, nur_neue = false, kennzeichen = null, limit = 500 } = {}) => {
      const s = `%${String(suche ?? '').trim()}%`;
      const kat = kategorie_id ? mitUnter(b, Number(kategorie_id)) : [];
      // A split movement is found by the categories of its parts as well.
      return all(`SELECT x.*, k.name AS konto, c.name AS kategorie, c.art AS kategorie_art, u.konto_id AS gegenkonto_id, (SELECT name FROM fin_konten WHERE id = u.konto_id) AS gegenkonto,
          (SELECT count(*) FROM fin_buchungen t WHERE t.split_von = x.id) AS teile,
          (SELECT group_concat(coalesce(tc.name, 'offen'), ', ') FROM fin_buchungen t LEFT JOIN fin_kategorien tc ON tc.id = t.kategorie_id WHERE t.split_von = x.id) AS teil_kategorien
        FROM fin_buchungen x JOIN fin_konten k ON k.id = x.konto_id LEFT JOIN fin_kategorien c ON c.id = x.kategorie_id LEFT JOIN fin_buchungen u ON u.id = x.umbuchung_id
        WHERE x.benutzer = ?1 AND ${GANZ('x')} AND (?2 IS NULL OR x.konto_id = ?2) AND (?3 IS NULL OR x.datum >= ?3) AND (?4 IS NULL OR x.datum <= ?4)
          AND (?5 = 0 OR (x.kategorie_id IS NULL AND ${WERT('x')}) OR EXISTS (SELECT 1 FROM fin_buchungen t WHERE t.split_von = x.id AND t.kategorie_id IS NULL))
          AND (?6 = '%%' OR x.empfaenger LIKE ?6 OR x.zweck LIKE ?6 OR x.notiz LIKE ?6 OR x.kennzeichen LIKE ?6)
          AND (?7 = 0 OR x.neu = 1) AND (?8 IS NULL OR x.kennzeichen = ?8)
          ${kat.length ? `AND (x.kategorie_id IN (${kat.join(',')}) OR EXISTS (SELECT 1 FROM fin_buchungen t WHERE t.split_von = x.id AND t.kategorie_id IN (${kat.join(',')})))` : ''}
        ORDER BY x.datum DESC, x.id DESC LIMIT ?9`, B(b), konto_id || null, von || null, bis || null, ohne_kategorie ? 1 : 0, s, nur_neue ? 1 : 0, kennzeichen || null, Math.min(5000, Number(limit) || 500));
    },
    finBuchungSpeichern: buchungSpeichern,
    finBuchungLoeschen: (b, id) => tx(() => {
      const x = mein('fin_buchungen', id, b);
      db.prepare('DELETE FROM fin_buchungen WHERE benutzer = ? AND (id IN (?, ?) OR split_von = ?)').run(B(b), id, x.umbuchung_id ?? id, id);
      return true;
    }),
    // The parts of a split movement (one purchase, several categories); without parts the split is removed.
    finBuchungTeile: (b, id) => { mein('fin_buchungen', id, b); return all(`SELECT t.id, t.betrag_ct, t.kategorie_id, t.zweck, c.name AS kategorie FROM fin_buchungen t LEFT JOIN fin_kategorien c ON c.id = t.kategorie_id WHERE t.split_von = ? ORDER BY t.id`, id); },
    finBuchungTeilen: (b, id, teile) => tx(() => {
      const x = mein('fin_buchungen', id, b);
      if (x.umbuchung_id || x.split_von) throw new Error('Diese Buchung lässt sich nicht aufteilen.');
      const liste = (teile ?? []).map((t) => ({ betrag_ct: Math.round(Number(t.betrag_ct)), kategorie_id: t.kategorie_id || null, zweck: t.zweck || null })).filter((t) => t.betrag_ct);
      db.prepare('DELETE FROM fin_buchungen WHERE split_von = ?').run(id);
      if (!liste.length) return 0;
      if (liste.length < 2) throw new Error('Eine Aufteilung braucht mindestens zwei Teile.');
      const summe = liste.reduce((s, t) => s + t.betrag_ct, 0);
      if (summe !== x.betrag_ct) throw new Error(`Die Teile ergeben ${(summe / 100).toFixed(2).replace('.', ',')} €, die Buchung hat ${(x.betrag_ct / 100).toFixed(2).replace('.', ',')} €.`);
      const ins = db.prepare('INSERT INTO fin_buchungen (benutzer, konto_id, datum, betrag_ct, empfaenger, zweck, kategorie_id, split_von) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const t of liste) { if (t.kategorie_id) mein('fin_kategorien', t.kategorie_id, b); ins.run(B(b), x.konto_id, x.datum, t.betrag_ct, x.empfaenger, t.zweck, t.kategorie_id, id); }
      db.prepare('UPDATE fin_buchungen SET kategorie_id = NULL WHERE id = ?').run(id);
      return liste.length;
    }),
    // Several movements get the same category; with regel the payee becomes a rule for the next ones.
    finKategorisieren: (b, ids, kategorieId, regel = null) => tx(() => {
      if (kategorieId) mein('fin_kategorien', kategorieId, b);
      const st = db.prepare(`UPDATE fin_buchungen SET kategorie_id = ?, neu = 0 WHERE id = ? AND benutzer = ? AND umbuchung_id IS NULL AND NOT EXISTS (SELECT 1 FROM fin_buchungen t WHERE t.split_von = fin_buchungen.id)`);
      let n = 0;
      for (const id of ids ?? []) n += st.run(kategorieId || null, id, B(b)).changes;
      const muster = String(regel ?? '').trim();
      if (muster && kategorieId && !get('SELECT 1 AS x FROM fin_regeln WHERE benutzer = ? AND lower(muster) = lower(?)', B(b), muster))
        db.prepare('INSERT INTO fin_regeln (benutzer, muster, kategorie_id) VALUES (?, ?, ?)').run(B(b), muster, kategorieId);
      return n;
    }),
    // Imported movements are „new“ until looked at.
    finGesehen: (b, ids = null) => {
      if (!ids) return db.prepare('UPDATE fin_buchungen SET neu = 0 WHERE benutzer = ? AND neu = 1').run(B(b)).changes;
      const st = db.prepare('UPDATE fin_buchungen SET neu = 0 WHERE id = ? AND benutzer = ?');
      return ids.reduce((n, id) => n + st.run(id, B(b)).changes, 0);
    },
    finKennzeichen: (b) => all(`SELECT kennzeichen, count(*) AS anzahl FROM fin_buchungen WHERE benutzer = ? AND kennzeichen IS NOT NULL AND split_von IS NULL GROUP BY kennzeichen ORDER BY kennzeichen COLLATE NOCASE`, B(b)),
    // Movements of a bank statement (read on the device): each once (its reference), categorised by the rules. An
    // expected movement of the same amount within a week is the same payment: it is confirmed instead of doubled.
    finImport: (b, kontoId, zeilen) => tx(() => {
      const konto = mein('fin_konten', kontoId, b);
      const regeln = regelnVon(b);
      const ins = db.prepare(`INSERT OR IGNORE INTO fin_buchungen (benutzer, konto_id, datum, betrag_ct, empfaenger, zweck, kategorie_id, kennzeichen, import_ref, neu) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
      const auftraege = dauerRoh(b).filter((d) => d.aktiv && !d.gegenkonto_id);
      let neu = 0, kategorisiert = 0, bestaetigt = 0, doppelt = 0, zugeordnet = 0;
      for (const z of zeilen ?? []) {
        const betrag = Math.round(Number(z.betrag_ct));
        if (!z.datum || !betrag) continue;
        const ref = String(z.ref ?? `${z.datum}|${betrag}|${z.name ?? ''}|${z.zweck ?? ''}`);
        if (get('SELECT 1 AS x FROM fin_buchungen WHERE konto_id = ? AND import_ref = ?', konto.id, ref)) { doppelt++; continue; }
        const erwartet = get(`SELECT id FROM fin_buchungen WHERE konto_id = ? AND vorgemerkt = 1 AND betrag_ct = ? AND split_von IS NULL AND abs(julianday(datum) - julianday(?)) <= 7 ORDER BY abs(julianday(datum) - julianday(?)) LIMIT 1`,
          konto.id, betrag, z.datum, z.datum);
        if (erwartet) {
          db.prepare(`UPDATE fin_buchungen SET datum = ?, empfaenger = coalesce(empfaenger, ?), zweck = coalesce(zweck, ?), import_ref = ?, vorgemerkt = 0, neu = 1 WHERE id = ?`).run(z.datum, z.name || null, z.zweck || null, ref, erwartet.id);
          db.prepare('UPDATE fin_buchungen SET datum = ? WHERE split_von = ?').run(z.datum, erwartet.id);
          bestaetigt++;
          continue;
        }
        const regel = regelFuer(regeln, { konto_id: konto.id, betrag_ct: betrag, empfaenger: z.name, zweck: z.zweck });
        // The run of a standing order that nobody booked by hand: the statement's payment is that run. It takes the
        // contract's category, and the contract moves on – otherwise it would stay overdue for ever.
        const name = falten(z.name);
        const lauf = auftraege.find((d) => d.konto_id === konto.id && Math.abs(Date.parse(z.datum) - Date.parse(d.naechste)) <= 10 * 864e5 && falten(d.empfaenger).length >= 4
          && (name.includes(falten(d.empfaenger)) || (name.length >= 4 && falten(d.empfaenger).includes(name)))
          && (d.variabel ? Math.sign(betrag) === Math.sign(d.betrag_ct) : Math.abs(betrag - d.betrag_ct) <= Math.abs(d.betrag_ct) / 10));
        const r = ins.run(B(b), konto.id, z.datum, betrag, z.name || null, z.zweck || null, regel?.kategorie_id ?? lauf?.kategorie_id ?? null, regel?.kennzeichen ?? null, ref);
        neu += r.changes;
        if (r.changes && (regel || lauf?.kategorie_id)) kategorisiert++;
        if (r.changes && lauf) {
          db.prepare('UPDATE fin_buchungen SET dauer_id = ? WHERE id = ?').run(lauf.id, Number(r.lastInsertRowid));
          lauf.naechste = plusMonate(lauf.naechste, lauf.rhythmus_monate);
          const schluss = [lauf.ende, lauf.gekuendigt_am ? lauf.laufzeit_bis : null].filter(Boolean).sort()[0] ?? null;
          db.prepare('UPDATE fin_dauer SET naechste = ?, aktiv = ? WHERE id = ?').run(lauf.naechste, schluss && lauf.naechste > schluss ? 0 : 1, lauf.id);
          zugeordnet++;
        }
      }
      return { neu, doppelt, kategorisiert, bestaetigt, zugeordnet };
    }),
    // Two movements on different own accounts, opposite amounts within four days, both without category: most likely
    // one transfer seen from both sides (each account's statement brings its half).
    finUmbuchungVorschlaege: (b) => all(`SELECT a.id AS von_id, z.id AS nach_id, a.datum, a.betrag_ct, ka.name AS von_konto, kz.name AS nach_konto, a.empfaenger, z.empfaenger AS gegen
      FROM fin_buchungen a JOIN fin_buchungen z ON z.benutzer = a.benutzer AND z.konto_id <> a.konto_id AND z.betrag_ct = -a.betrag_ct AND abs(julianday(z.datum) - julianday(a.datum)) <= 4
      JOIN fin_konten ka ON ka.id = a.konto_id JOIN fin_konten kz ON kz.id = z.konto_id
      WHERE a.benutzer = ? AND a.betrag_ct < 0 AND a.umbuchung_id IS NULL AND z.umbuchung_id IS NULL AND a.kategorie_id IS NULL AND z.kategorie_id IS NULL
        AND a.split_von IS NULL AND z.split_von IS NULL AND a.ziel_art IS NULL AND z.ziel_art IS NULL
        AND NOT EXISTS (SELECT 1 FROM fin_buchungen t WHERE t.split_von IN (a.id, z.id))
      GROUP BY a.id ORDER BY a.datum DESC LIMIT 50`, B(b)),
    finUmbuchungVerbinden: (b, vonId, nachId) => tx(() => {
      const a = mein('fin_buchungen', vonId, b), z = mein('fin_buchungen', nachId, b);
      if (a.umbuchung_id || z.umbuchung_id || a.konto_id === z.konto_id || a.betrag_ct !== -z.betrag_ct) throw new Error('Diese beiden Buchungen passen nicht als Umbuchung zusammen.');
      db.prepare('UPDATE fin_buchungen SET umbuchung_id = CASE id WHEN ? THEN ? ELSE ? END, kategorie_id = NULL, neu = 0 WHERE id IN (?, ?)').run(a.id, z.id, a.id, a.id, z.id);
      return true;
    }),

    finRegeln: (b) => all(`SELECT r.*, c.name AS kategorie, k.name AS konto FROM fin_regeln r JOIN fin_kategorien c ON c.id = r.kategorie_id LEFT JOIN fin_konten k ON k.id = r.konto_id
      WHERE r.benutzer = ? ORDER BY r.rang DESC, r.muster COLLATE NOCASE`, B(b)),
    finRegelSpeichern: (b, row) => {
      const muster = String(row.muster ?? '').trim();
      if (muster.length < 3) throw new Error('Der Suchtext braucht mindestens drei Zeichen.');
      mein('fin_kategorien', row.kategorie_id, b);
      if (row.konto_id) mein('fin_konten', row.konto_id, b);
      const w = [muster, row.kategorie_id, ['empfaenger', 'zweck'].includes(row.feld) ? row.feld : 'beide', ct(row.betrag_von_ct), ct(row.betrag_bis_ct), row.konto_id || null, String(row.kennzeichen ?? '').trim() || null, Number(row.rang) || 0];
      if (row.id) { mein('fin_regeln', row.id, b); db.prepare('UPDATE fin_regeln SET muster = ?, kategorie_id = ?, feld = ?, betrag_von_ct = ?, betrag_bis_ct = ?, konto_id = ?, kennzeichen = ?, rang = ? WHERE id = ?').run(...w, row.id); return row.id; }
      return Number(db.prepare('INSERT INTO fin_regeln (benutzer, muster, kategorie_id, feld, betrag_von_ct, betrag_bis_ct, konto_id, kennzeichen, rang) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(B(b), ...w).lastInsertRowid);
    },
    finRegelLoeschen: (b, id) => { mein('fin_regeln', id, b); db.prepare('DELETE FROM fin_regeln WHERE id = ?').run(id); return true; },
    // The rules applied to everything that has no category yet.
    finRegelnAnwenden: (b) => tx(() => {
      const regeln = regelnVon(b);
      const st = db.prepare('UPDATE fin_buchungen SET kategorie_id = ?, kennzeichen = coalesce(kennzeichen, ?) WHERE id = ?');
      let n = 0;
      for (const x of all(`SELECT x.id, x.konto_id, x.betrag_ct, x.empfaenger, x.zweck FROM fin_buchungen x WHERE x.benutzer = ? AND x.kategorie_id IS NULL AND ${WERT('x')} AND ${GANZ('x')}`, B(b))) {
        const r = regelFuer(regeln, x);
        if (r) { st.run(r.kategorie_id, r.kennzeichen, x.id); n++; }
      }
      return n;
    }),

    finBudgets: budgets,
    // (kategorie, amount per period) or a row { kategorie_id, betrag_ct, intervall_monate, mit_unter, prognose }.
    finBudgetSetzen: (b, kategorieOderRow, betragCt = null) => {
      const row = typeof kategorieOderRow === 'object' && kategorieOderRow ? kategorieOderRow : { kategorie_id: kategorieOderRow, betrag_ct: betragCt };
      mein('fin_kategorien', row.kategorie_id, b);
      const betrag = Math.round(Number(row.betrag_ct) || 0);
      if (betrag <= 0) db.prepare('DELETE FROM fin_budgets WHERE benutzer = ? AND kategorie_id = ?').run(B(b), row.kategorie_id);
      else db.prepare(`INSERT INTO fin_budgets (benutzer, kategorie_id, betrag_ct, intervall_monate, mit_unter, prognose) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT DO UPDATE SET betrag_ct = excluded.betrag_ct, intervall_monate = excluded.intervall_monate, mit_unter = excluded.mit_unter, prognose = excluded.prognose`)
        .run(B(b), row.kategorie_id, betrag, [1, 3, 12].includes(Number(row.intervall_monate)) ? Number(row.intervall_monate) : 1, row.mit_unter === 0 || row.mit_unter === false ? 0 : 1, row.prognose ? 1 : 0);
      return true;
    },

    finDauer: dauer,
    finDauerSpeichern: (b, row) => {
      mein('fin_konten', row.konto_id, b);
      if (row.gegenkonto_id) mein('fin_konten', row.gegenkonto_id, b);
      if (row.gegenkonto_id && Number(row.gegenkonto_id) === Number(row.konto_id)) throw new Error('Bitte zwei verschiedene Konten wählen.');
      if (row.kategorie_id) mein('fin_kategorien', row.kategorie_id, b);
      const empf = String(row.empfaenger ?? '').trim();
      const betrag = Math.round(Number(row.betrag_ct));
      if (!empf || !betrag || !row.naechste) throw new Error('Bitte Empfänger, Betrag und den nächsten Termin angeben.');
      const zahl = (x) => (x == null || x === '' ? null : Math.max(0, Math.round(Number(x))));
      const w = [row.konto_id, row.gegenkonto_id || null, empf, row.zweck || null, betrag, row.gegenkonto_id ? null : row.kategorie_id || null, [1, 2, 3, 6, 12].includes(Number(row.rhythmus_monate)) ? Number(row.rhythmus_monate) : 1,
        row.naechste, row.ende || null, row.kuendbar_bis || null, row.aktiv === 0 || row.aktiv === false ? 0 : 1, row.typ || null, row.vertragsnummer || null, row.kundennummer || null, row.beginn || null,
        row.laufzeit_bis || null, zahl(row.verlaengerung_monate), zahl(row.kuendigungsfrist_tage), row.gekuendigt_am || null, row.variabel ? 1 : 0, row.notiz || null];
      const spalten = ['konto_id', 'gegenkonto_id', 'empfaenger', 'zweck', 'betrag_ct', 'kategorie_id', 'rhythmus_monate', 'naechste', 'ende', 'kuendbar_bis', 'aktiv', 'typ', 'vertragsnummer', 'kundennummer', 'beginn',
        'laufzeit_bis', 'verlaengerung_monate', 'kuendigungsfrist_tage', 'gekuendigt_am', 'variabel', 'notiz'];
      if (row.id) { mein('fin_dauer', row.id, b); db.prepare(`UPDATE fin_dauer SET ${spalten.map((s) => `${s} = ?`).join(', ')} WHERE id = ?`).run(...w, row.id); return row.id; }
      return Number(db.prepare(`INSERT INTO fin_dauer (benutzer, ${spalten.join(', ')}) VALUES (?, ${spalten.map(() => '?').join(', ')})`).run(B(b), ...w).lastInsertRowid);
    },
    finDauerLoeschen: (b, id) => { mein('fin_dauer', id, b); db.prepare('DELETE FROM fin_dauer WHERE id = ?').run(id); return true; },
    // Books the next run of a standing order and moves it on by its rhythm. betrag_ct: this run's amount when it varies
    // (a utility bill). A contract under notice stops after its last run.
    finDauerBuchen: (b, id, betragCt = null) => tx(() => {
      const d = mein('fin_dauer', id, b);
      // On an account fed by bank statements (or for a day still to come) the run is only expected: the statement
      // confirms it instead of bringing the same payment a second time.
      const erwartet = d.naechste > ortszeit.heute() || !!get('SELECT 1 AS x FROM fin_buchungen WHERE konto_id = ? AND import_ref IS NOT NULL LIMIT 1', d.konto_id);
      const bid = buchungSpeichern(b, { konto_id: d.konto_id, gegenkonto_id: d.gegenkonto_id, datum: d.naechste, betrag_ct: ct(betragCt) || d.betrag_ct, empfaenger: d.empfaenger, zweck: d.zweck, kategorie_id: d.kategorie_id, dauer_id: d.id,
        vorgemerkt: erwartet ? 1 : 0 });
      const weiter = plusMonate(d.naechste, d.rhythmus_monate);
      const schluss = [d.ende, d.gekuendigt_am ? d.laufzeit_bis : null].filter(Boolean).sort()[0] ?? null;
      db.prepare('UPDATE fin_dauer SET naechste = ?, aktiv = ? WHERE id = ?').run(weiter, schluss && weiter > schluss ? 0 : 1, id);
      return bid;
    }),
    // What was really paid on a contract: its movements, the sum per year and how the amount changed.
    finDauerVerlauf: (b, id) => {
      const d = mein('fin_dauer', id, b);
      const zeilen = all(`SELECT id, datum, betrag_ct FROM fin_buchungen WHERE benutzer = ? AND split_von IS NULL AND (dauer_id = ? OR (dauer_id IS NULL AND konto_id = ? AND lower(empfaenger) = lower(?))) ORDER BY datum DESC LIMIT 120`, B(b), id, d.konto_id, d.empfaenger);
      const jahre = {};
      for (const z of zeilen) jahre[z.datum.slice(0, 4)] = (jahre[z.datum.slice(0, 4)] ?? 0) + z.betrag_ct;
      return { zeilen, jahre: Object.entries(jahre).map(([jahr, summe_ct]) => ({ jahr, summe_ct })).sort((x, y) => y.jahr.localeCompare(x.jahr)) };
    },
    // Payees that were paid about the same amount in at least three different months and are no standing order yet.
    finDauerErkennen: (b) => {
      const bekannt = new Set(all('SELECT lower(empfaenger) AS e FROM fin_dauer WHERE benutzer = ?', B(b)).map((x) => x.e));
      return all(`SELECT empfaenger, konto_id, kategorie_id, count(DISTINCT substr(datum, 1, 7)) AS monate, count(*) AS n, min(betrag_ct) AS von_ct, max(betrag_ct) AS bis_ct,
          cast(round(avg(betrag_ct)) AS INTEGER) AS betrag_ct, max(datum) AS letzte
        FROM fin_buchungen WHERE benutzer = ? AND umbuchung_id IS NULL AND split_von IS NULL AND empfaenger IS NOT NULL AND datum >= ? GROUP BY lower(empfaenger), konto_id
        HAVING monate >= 3 AND n <= monate + 1 AND abs(max(betrag_ct) - min(betrag_ct)) <= max(500, abs(avg(betrag_ct)) / 10) ORDER BY abs(betrag_ct) DESC LIMIT 30`,
      B(b), plusMonate(ortszeit.heute(), -13))
        .filter((x) => !bekannt.has(String(x.empfaenger).toLowerCase()))
        .map((x) => ({ ...x, naechste: plusMonate(x.letzte, 1) }));
    },

    finWertpapiere: wertpapiere,
    finWertpapierSpeichern: (b, row) => tx(() => {
      const k = mein('fin_konten', row.konto_id, b);
      if (k.art !== 'depot') throw new Error('Wertpapiere gehören in ein Konto der Art „Depot“.');
      const name = String(row.name ?? '').trim();
      if (!name) throw new Error('Bitte einen Namen angeben.');
      const stueck = Number(String(row.stueck ?? 0).replace(',', '.')) || 0;
      const w = [k.id, name, String(row.isin ?? '').trim().toUpperCase() || null, stueck, Math.round(Number(row.einstand_ct) || 0), ct(row.kurs_ct), row.kurs_ct == null || row.kurs_ct === '' ? null : row.kurs_datum || ortszeit.heute()];
      let id = row.id;
      if (id) { mein('fin_wertpapiere', id, b); db.prepare('UPDATE fin_wertpapiere SET konto_id = ?, name = ?, isin = ?, stueck = ?, einstand_ct = ?, kurs_ct = ?, kurs_datum = ? WHERE id = ?').run(...w, id); }
      else id = Number(db.prepare('INSERT INTO fin_wertpapiere (benutzer, konto_id, name, isin, stueck, einstand_ct, kurs_ct, kurs_datum) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(B(b), ...w).lastInsertRowid);
      if (w[5] != null) db.prepare('INSERT INTO fin_kurse (wertpapier_id, datum, kurs_ct) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET kurs_ct = excluded.kurs_ct').run(id, w[6], w[5]);
      return id;
    }),
    finWertpapierLoeschen: (b, id) => { mein('fin_wertpapiere', id, b); db.prepare('DELETE FROM fin_wertpapiere WHERE id = ?').run(id); return true; },
    finKurse: (b, id) => { mein('fin_wertpapiere', id, b); return all('SELECT datum, kurs_ct FROM fin_kurse WHERE wertpapier_id = ? ORDER BY datum DESC LIMIT 400', id); },

    finPrognose: prognose,
    // Evaluation of a period: income and expenses by category (sub-categories under their main one), by month, the
    // largest payees, fixed against variable costs and the sums of the tax tags (what belongs into the tax return).
    finAuswertung: (b, { von, bis } = {}) => {
      const v = von || `${ortszeit.heute().slice(0, 4)}-01-01`, z = bis || ortszeit.heute();
      const kat = jeKategorie(b, v, z);
      const monate = all(`SELECT substr(x.datum, 1, 7) AS monat, coalesce(sum(CASE WHEN x.betrag_ct > 0 THEN x.betrag_ct END), 0) AS ein_ct, coalesce(-sum(CASE WHEN x.betrag_ct < 0 THEN x.betrag_ct END), 0) AS aus_ct
        FROM fin_buchungen x WHERE x.benutzer = ? AND ${WERT('x')} AND x.datum BETWEEN ? AND ? GROUP BY monat ORDER BY monat`, B(b), v, z);
      const empfaenger = all(`SELECT x.empfaenger, -sum(x.betrag_ct) AS summe_ct, count(*) AS anzahl FROM fin_buchungen x
        WHERE x.benutzer = ? AND x.umbuchung_id IS NULL AND ${GANZ('x')} AND x.betrag_ct < 0 AND x.empfaenger IS NOT NULL AND x.datum BETWEEN ? AND ? GROUP BY lower(x.empfaenger) ORDER BY summe_ct DESC LIMIT 10`, B(b), v, z);
      const sum = einAus(b, v, z);
      const steuer = {};
      for (const k of kat) if (k.steuer) steuer[k.steuer] = (steuer[k.steuer] ?? 0) + Math.abs(k.summe_ct);
      const aus = kat.filter((k) => k.summe_ct < 0);
      return {
        von: v, bis: z, ...sum, saldo_ct: sum.ein_ct - sum.aus_ct, sparquote: sum.ein_ct > 0 ? Math.round((sum.ein_ct - sum.aus_ct) / sum.ein_ct * 1000) / 10 : null,
        einnahmen: gruppiert(kat.filter((k) => k.summe_ct > 0), 1), ausgaben: gruppiert(aus, -1),
        fix_ct: -aus.filter((k) => k.fix).reduce((s, k) => s + k.summe_ct, 0), variabel_ct: -aus.filter((k) => !k.fix).reduce((s, k) => s + k.summe_ct, 0),
        monate, empfaenger, steuer,
      };
    },
    // Two periods side by side by main category: what changed, and by how much.
    finVergleich: (b, { von, bis, von2, bis2 } = {}) => {
      const eins = gruppiert(jeKategorie(b, von, bis).filter((k) => k.summe_ct < 0), -1), zwei = gruppiert(jeKategorie(b, von2, bis2).filter((k) => k.summe_ct < 0), -1);
      const namen = [...new Set([...eins, ...zwei].map((k) => k.name))];
      const zeilen = namen.map((name) => {
        const a = eins.find((k) => k.name === name)?.summe_ct ?? 0, c = zwei.find((k) => k.name === name)?.summe_ct ?? 0;
        return { name, a_ct: a, b_ct: c, diff_ct: a - c, prozent: c ? Math.round((a - c) / c * 1000) / 10 : null };
      }).sort((x, y) => Math.abs(y.diff_ct) - Math.abs(x.diff_ct));
      const s1 = einAus(b, von, bis), s2 = einAus(b, von2, bis2);
      return { zeilen, a: s1, b: s2 };
    },
    // The start page: net worth, this month, budgets, what is due, what still needs attention, twelve months back.
    finUebersicht: (b) => {
      const heute = ortszeit.heute(), monat = monatVon(heute);
      const k = konten(b).filter((x) => !x.archiviert);
      const vermoegen = k.reduce((s, x) => s + x.wert_ct, 0);
      const m = einAus(b, `${monat}-01`, monatsende(monat));
      const ab = plusMonate(`${monat}-01`, -11);
      const netto = Object.fromEntries(all(`SELECT substr(x.datum, 1, 7) AS monat, sum(x.betrag_ct) AS s FROM fin_buchungen x WHERE x.benutzer = ? AND ${GANZ('x')} AND x.datum >= ? GROUP BY monat`, B(b), ab).map((r) => [r.monat, r.s]));
      const einaus = Object.fromEntries(all(`SELECT substr(x.datum, 1, 7) AS monat, coalesce(sum(CASE WHEN x.betrag_ct > 0 THEN x.betrag_ct END), 0) AS ein_ct, coalesce(-sum(CASE WHEN x.betrag_ct < 0 THEN x.betrag_ct END), 0) AS aus_ct
        FROM fin_buchungen x WHERE x.benutzer = ? AND ${WERT('x')} AND x.datum >= ? GROUP BY monat`, B(b), ab).map((r) => [r.monat, r]));
      // Net worth at each month's end, counted back from today (securities at today's prices).
      const verlauf = [];
      let stand = vermoegen;
      for (let i = 0; i < 12; i++) {
        const mm = monatVon(plusMonate(`${monat}-01`, -i));
        verlauf.unshift({ monat: mm, vermoegen_ct: stand, ein_ct: einaus[mm]?.ein_ct ?? 0, aus_ct: einaus[mm]?.aus_ct ?? 0 });
        stand -= netto[mm] ?? 0;
      }
      const d = dauer(b);
      return {
        konten: k, vermoegen_ct: vermoegen, guthaben_ct: k.filter((x) => x.wert_ct > 0).reduce((s, x) => s + x.wert_ct, 0), schulden_ct: -k.filter((x) => x.wert_ct < 0).reduce((s, x) => s + x.wert_ct, 0),
        monat, ...m, sparquote: m.ein_ct > 0 ? Math.round((m.ein_ct - m.aus_ct) / m.ein_ct * 1000) / 10 : null,
        budgets: budgets(b, monat), verlauf,
        faellig: d.filter((x) => x.aktiv && x.naechste <= plusMonate(heute, 1)).slice(0, 8),
        kuendigen: d.filter((x) => x.aktiv && x.vertragsstand === 'bald').sort((x, y) => x.kuendigen_bis.localeCompare(y.kuendigen_bis)).slice(0, 6),
        fix_monat_ct: -d.filter((x) => x.aktiv && !x.gegenkonto_id && x.betrag_ct < 0).reduce((s, x) => s + x.monatlich_ct, 0),
        ohne_kategorie: get(`SELECT count(*) AS n FROM fin_buchungen x WHERE x.benutzer = ? AND x.kategorie_id IS NULL AND ${WERT('x')}`, B(b)).n,
        neue: get(`SELECT count(*) AS n FROM fin_buchungen x WHERE x.benutzer = ? AND x.neu = 1 AND ${GANZ('x')}`, B(b)).n,
        vorgemerkt: get(`SELECT count(*) AS n, coalesce(sum(betrag_ct), 0) AS summe_ct FROM fin_buchungen x WHERE x.benutzer = ? AND x.vorgemerkt = 1 AND ${GANZ('x')}`, B(b)),
        warnungen: k.filter((x) => x.warnung || x.abgleich_ct).map((x) => ({ konto_id: x.id, konto: x.name, warnung: x.warnung, abgleich_ct: x.abgleich_ct, saldo_ct: x.saldo_ct })),
        top: gruppiert(jeKategorie(b, `${monat}-01`, monatsende(monat)).filter((r) => r.summe_ct < 0), -1).slice(0, 6).map((r) => ({ name: r.name, summe_ct: r.summe_ct })),
        prognose: prognose(b, 3),
      };
    },

    // ---------- between the private money and the houses and projects ----------
    // A private movement handed over: to a project as a paid invoice (an expense), or to a house's ledger – an expense
    // against a cost account, money received against an income or tenant account, the other side being the house's
    // account „Privat“. The movement remembers where it went, so it is handed over only once.
    finUebergeben: (b, id, { ziel, projekt_id = null, objekt_id = null, konto_id = null, titel = null } = {}) => tx(() => {
      const x = mein('fin_buchungen', id, b);
      if (x.ziel_art) throw new Error('Diese Buchung wurde schon übergeben.');
      if (x.umbuchung_id) throw new Error('Eine Umbuchung zwischen eigenen Konten kann nicht übergeben werden.');
      if (x.split_von) throw new Error('Übergib die ganze Buchung, nicht einen Teil.');
      const text = titel || [x.empfaenger, x.zweck].filter(Boolean).join(' – ') || 'Private Zahlung';
      let zielArt, zielId;
      if (ziel === 'projekt') {
        if (x.betrag_ct >= 0) throw new Error('An ein Projekt lassen sich nur Ausgaben übergeben.');
        if (!get('SELECT 1 AS x FROM projekte WHERE id = ?', projekt_id)) throw new Error('Dieses Projekt gibt es nicht.');
        zielArt = 'projektposten';
        zielId = Number(db.prepare(`INSERT INTO projektposten (projekt_id, art, datum, firma, titel, betrag_ct, status, bezahlt_am, notiz) VALUES (?, 'rechnung', ?, ?, ?, ?, 'bezahlt', ?, 'privat bezahlt (aus den Finanzen übergeben)')`)
          .run(projekt_id, x.datum, x.empfaenger || null, text.slice(0, 200), -x.betrag_ct, x.datum).lastInsertRowid);
      } else if (ziel === 'objekt') {
        const k = get('SELECT * FROM konten WHERE id = ? AND objekt_id = ?', konto_id, objekt_id);
        if (!k) throw new Error('Bitte ein Konto des Hauses wählen.');
        const privat = privatKonto(objekt_id);
        if (k.id === privat.id) throw new Error('Bitte das Kosten- oder Einnahmekonto wählen, nicht das Privatkonto.');
        zielArt = 'buchung';
        zielId = bh.buchen({ objekt_id, datum: x.datum, text: `${text} (privat ${x.betrag_ct < 0 ? 'bezahlt' : 'erhalten'})`, art: 'manuell',
          positionen: [x.betrag_ct < 0 ? { soll_id: k.id, haben_id: privat.id, betrag_ct: -x.betrag_ct } : { soll_id: privat.id, haben_id: k.id, betrag_ct: x.betrag_ct }] }, true);
      } else throw new Error('Wohin soll die Buchung?');
      db.prepare(`UPDATE fin_buchungen SET ziel_art = ?, ziel_id = ?, richtung = 'hin' WHERE id = ?`).run(zielArt, zielId, id);
      return { ziel_art: zielArt, ziel_id: zielId };
    }),
    // What can come the other way: movements on the money accounts of a house, or paid invoices of a project, that
    // this user has not taken over yet.
    finUebernehmbar: (b, { objekt_id = null, projekt_id = null, von = null } = {}) => {
      const ab = von || plusMonate(ortszeit.heute(), -3);
      if (projekt_id) return all(`SELECT 'projektposten' AS quelle, p.id, coalesce(p.bezahlt_am, p.datum) AS datum, p.titel AS text, p.firma AS name, -p.betrag_ct AS betrag_ct FROM projektposten p
        WHERE p.projekt_id = ? AND p.art = 'rechnung' AND coalesce(p.bezahlt_am, p.datum) >= ?
          AND NOT EXISTS (SELECT 1 FROM fin_buchungen f WHERE f.benutzer = ? AND f.ziel_art = 'projektposten' AND f.ziel_id = p.id) ORDER BY datum DESC LIMIT 200`, projekt_id, ab, B(b));
      // Money leaving the house (credit on a bank account) is money the owner receives, and the other way round. The
      // account „Privat“ is no bank account: what was booked against it is private already.
      const bank = (k) => `(${k}.klasse = 'geld' AND coalesce(${k}.kategorie, '') <> 'privat')`;
      return all(`SELECT 'buchung' AS quelle, x.id, x.datum, x.text, CASE WHEN ${bank('h')} THEN s.bezeichnung ELSE h.bezeichnung END AS name,
          CASE WHEN ${bank('h')} THEN x.betrag_ct ELSE -x.betrag_ct END AS betrag_ct
        FROM buchungen x JOIN konten s ON s.id = x.soll_id JOIN konten h ON h.id = x.haben_id
        WHERE x.objekt_id = ? AND x.datum >= ? AND ${bank('s')} <> ${bank('h')}
          AND NOT EXISTS (SELECT 1 FROM fin_buchungen f WHERE f.benutzer = ? AND f.ziel_art = 'buchung' AND f.ziel_id = x.id) ORDER BY x.datum DESC, x.id DESC LIMIT 200`, objekt_id, ab, B(b));
    },
    // Takes such a movement into a private account (the sign as given: what it means privately is the user's call).
    finUebernehmen: (b, { quelle, id, konto_id, kategorie_id = null, betrag_ct = null } = {}) => tx(() => {
      mein('fin_konten', konto_id, b);
      if (!['buchung', 'projektposten'].includes(quelle)) throw new Error('Unbekannte Quelle.');
      if (get('SELECT 1 AS x FROM fin_buchungen WHERE benutzer = ? AND ziel_art = ? AND ziel_id = ?', B(b), quelle, id)) throw new Error('Das wurde schon übernommen.');
      const q = quelle === 'buchung'
        ? get(`SELECT x.datum, x.text, x.betrag_ct, o.bezeichnung AS herkunft FROM buchungen x JOIN objekte o ON o.id = x.objekt_id WHERE x.id = ?`, id)
        : get(`SELECT coalesce(p.bezahlt_am, p.datum) AS datum, p.titel AS text, -p.betrag_ct AS betrag_ct, j.titel AS herkunft, p.firma FROM projektposten p JOIN projekte j ON j.id = p.projekt_id WHERE p.id = ?`, id);
      if (!q) throw new Error('Diese Buchung gibt es nicht mehr.');
      const bid = buchungSpeichern(b, { konto_id, datum: q.datum ?? ortszeit.heute(), betrag_ct: betrag_ct ?? q.betrag_ct, empfaenger: q.firma || q.herkunft, zweck: q.text, kategorie_id });
      db.prepare(`UPDATE fin_buchungen SET ziel_art = ?, ziel_id = ?, richtung = 'her' WHERE id = ?`).run(quelle, id, bid);
      return bid;
    }),
    // Accounts of a house a private movement can be booked against (costs for an expense, income and tenants for money received).
    finObjektKonten: (b, objektId) => all(`SELECT id, nr, bezeichnung, klasse FROM konten WHERE objekt_id = ? AND inaktiv = 0 AND klasse IN ('kosten', 'einnahme', 'person') ORDER BY klasse, nr`, objektId),
  };
};
