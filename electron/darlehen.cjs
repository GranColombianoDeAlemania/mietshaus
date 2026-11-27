const ortszeit = require('./zeit.cjs');
// Loans: annuity repayment schedule, loan and interest accounts, splitting each instalment into interest
// (expense, flows into Anlage V) and repayment (reduces the loan account).
const monatPlus = (iso, n) => {
  const d = new Date(iso.slice(0, 7) + '-01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

module.exports = function darlehen({ db, all, get, tx, bh }) {
  // Monthly instalment: given, or from the initial repayment rate (annuity = amount × (interest + repayment) / 12).
  const rate = (d) => d.rate_ct ?? Math.round(d.betrag_ct * ((d.zinssatz + (d.tilgung_satz ?? 2)) / 100) / 12);

  function plan(d, bisMonat = null) {
    const zeilen = [];
    let rest = d.betrag_ct;
    const r = rate(d);
    let monat = d.erste_rate.slice(0, 7);
    for (let i = 0; rest > 0 && i < 600; i++) {
      const zins = Math.round(rest * d.zinssatz / 100 / 12);
      const tilgung = Math.min(rest, Math.max(0, r - zins));
      rest -= tilgung;
      zeilen.push({ monat, rate_ct: zins + tilgung, zins_ct: zins, tilgung_ct: tilgung, rest_ct: rest });
      if (bisMonat && monat >= bisMonat) break;
      monat = monatPlus(`${monat}-01`, 1);
      if (tilgung === 0) break; // instalment below interest: no repayment, avoid an endless plan
    }
    return zeilen;
  }

  // The schedule with the special repayments made: a month in which more was repaid on the loan account than the plan
  // says (Sondertilgung, or a larger instalment) lowers the balance by the excess; the plan then runs on with the same
  // instalment – so the remaining term and the balance at the end of the fixed-interest period include it. Instalments
  // not booked yet change nothing.
  function planMitIst(d) {
    if (!d.konto_id) return { zeilen: plan(d), neu_ab: null };
    const gebucht = new Map(all(`SELECT substr(datum, 1, 7) AS m, sum(betrag_ct) AS s FROM buchungen WHERE soll_id = ? GROUP BY m`, d.konto_id).map((x) => [x.m, x.s]));
    const zeilen = [];
    let rest = d.betrag_ct, neuAb = null;
    const r = rate(d);
    let monat = d.erste_rate.slice(0, 7);
    for (let i = 0; rest > 0 && i < 600; i++) {
      const zins = Math.round(rest * d.zinssatz / 100 / 12);
      const tilgung = Math.min(rest, Math.max(0, r - zins));
      const extra = Math.min(rest - tilgung, Math.max(0, (gebucht.get(monat) ?? 0) - tilgung));
      rest -= tilgung + (extra > 100 ? extra : 0);
      if (extra > 100) neuAb ??= monat;
      zeilen.push({ monat, rate_ct: zins + tilgung, zins_ct: zins, tilgung_ct: tilgung, rest_ct: rest, ...(extra > 100 ? { sondertilgung_ct: extra } : {}) });
      monat = monatPlus(`${monat}-01`, 1);
      if (tilgung === 0) break;
    }
    return { zeilen, neu_ab: neuAb };
  }

  function konten(objektId, d) {
    // Interest account (expense, not allocable) shared by all loans of the object.
    let zins = get(`SELECT id FROM konten WHERE objekt_id = ? AND kategorie = 'zinsen' AND klasse = 'kosten'`, objektId);
    if (!zins) {
      const nr = get('SELECT 1 FROM konten WHERE objekt_id = ? AND nr = 45600', objektId) ? 45601 : 45600;
      db.prepare(`INSERT INTO konten (objekt_id, nr, bezeichnung, klasse, kategorie) VALUES (?, ?, 'Schuldzinsen', 'kosten', 'zinsen')`).run(objektId, nr);
      zins = get(`SELECT id FROM konten WHERE objekt_id = ? AND kategorie = 'zinsen' AND klasse = 'kosten'`, objektId);
    }
    let konto = d.konto_id ? get('SELECT id FROM konten WHERE id = ?', d.konto_id) : null;
    if (!konto) {
      const nr = (get(`SELECT max(nr) AS n FROM konten WHERE objekt_id = ? AND nr BETWEEN 2100 AND 2199`, objektId).n ?? 2099) + 1;
      const id = Number(db.prepare(`INSERT INTO konten (objekt_id, nr, bezeichnung, klasse, kategorie) VALUES (?, ?, ?, 'darlehen', 'darlehen')`)
        .run(objektId, nr, `Darlehen ${d.bank}${d.vertragsnr ? ' ' + d.vertragsnr : ''}`).lastInsertRowid);
      db.prepare('UPDATE darlehen SET konto_id = ? WHERE id = ?').run(id, d.id);
      konto = { id };
    }
    return { zins_id: zins.id, konto_id: konto.id };
  }

  // Splits a paid instalment: interest per schedule for that month, the rest repays the loan.
  function rateAufteilen(darlehenId, datum, betrag_ct) {
    const d = get('SELECT * FROM darlehen WHERE id = ?', darlehenId);
    const zeile = plan(d, datum.slice(0, 7)).find((z) => z.monat === datum.slice(0, 7)) ?? plan(d).at(-1);
    const zins = Math.min(betrag_ct, zeile?.zins_ct ?? 0);
    return { zins_ct: zins, tilgung_ct: betrag_ct - zins };
  }

  return {
    darlehenListe: (objektId) => all(`SELECT d.*, o.bezeichnung AS objekt FROM darlehen d JOIN objekte o ON o.id = d.objekt_id
      WHERE (?1 IS NULL OR d.objekt_id = ?1) ORDER BY d.erste_rate`, objektId ?? null).map((d) => {
      const heute = ortszeit.monatJetzt();
      // Before the first instalment nothing is repaid yet.
      const p = d.erste_rate.slice(0, 7) > heute ? [] : plan(d, heute);
      const ist = d.konto_id ? -bh.saldoBis(d.konto_id, '9999-12-31') : null;
      // An instalment that does not even cover the interest never repays the loan.
      const ersterZins = Math.round(d.betrag_ct * d.zinssatz / 100 / 12);
      const warnung = rate(d) <= ersterZins && d.betrag_ct > 0 ? `Die Rate (${(rate(d) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €) deckt nicht einmal die Zinsen – das Darlehen wird so nie getilgt.` : null;
      return { ...d, rate_berechnet_ct: rate(d), rest_plan_ct: p.at(-1)?.rest_ct ?? d.betrag_ct, rest_ist_ct: ist, warnung,
        zinsen_jahr_ct: plan(d).filter((z) => z.monat.slice(0, 4) === heute.slice(0, 4)).reduce((s, z) => s + z.zins_ct, 0) };
    }),

    tilgungsplan: (id) => {
      const d = get('SELECT * FROM darlehen WHERE id = ?', id);
      const { zeilen, neu_ab } = planMitIst(d);
      // Yearly totals are what the tax return and the bank statement show.
      const jahre = {};
      for (const z of zeilen) {
        const j = (jahre[z.monat.slice(0, 4)] ??= { jahr: z.monat.slice(0, 4), zins_ct: 0, tilgung_ct: 0, rest_ct: 0 });
        j.zins_ct += z.zins_ct; j.tilgung_ct += z.tilgung_ct; j.rest_ct = z.rest_ct;
      }
      const restBindung = d.zinsbindung_bis ? zeilen.filter((z) => z.monat <= d.zinsbindung_bis.slice(0, 7)).at(-1)?.rest_ct ?? null : null;
      return { darlehen: d, rate_ct: rate(d), zeilen, jahre: Object.values(jahre), rest_zinsbindung_ct: restBindung, laufzeit_monate: zeilen.length, neu_berechnet_ab: neu_ab };
    },

    darlehenSpeichern: (row) => tx(() => {
      const keys = ['objekt_id', 'bank', 'vertragsnr', 'betrag_ct', 'auszahlung', 'zinssatz', 'tilgung_satz', 'rate_ct', 'erste_rate', 'zinsbindung_bis', 'sondertilgung_ct', 'notiz'].filter((k) => k in row);
      const vals = keys.map((k) => (row[k] === '' || row[k] === undefined ? null : row[k]));
      let id = row.id;
      if (id) db.prepare(`UPDATE darlehen SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...vals, id);
      else id = Number(db.prepare(`INSERT INTO darlehen (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...vals).lastInsertRowid);
      const d = get('SELECT * FROM darlehen WHERE id = ?', id);
      konten(d.objekt_id, d);
      return id;
    }),

    // Books the payout of the loan to the bank account (bank debit, loan credit).
    darlehenAuszahlungBuchen: (id, geldKontoId) => tx(() => {
      const d = get('SELECT * FROM darlehen WHERE id = ?', id);
      const k = konten(d.objekt_id, d);
      return bh.buchenIntern({ objekt_id: d.objekt_id, datum: d.auszahlung ?? d.erste_rate, text: `Auszahlung Darlehen ${d.bank}`,
        positionen: [{ soll_id: geldKontoId, haben_id: k.konto_id, betrag_ct: d.betrag_ct }] });
    }),

    // Books one instalment paid from the bank, split into interest and repayment.
    darlehenRateBuchen: (id, geldKontoId, datum, betrag_ct, importRef = null) => tx(() => {
      const d = get('SELECT * FROM darlehen WHERE id = ?', id);
      const k = konten(d.objekt_id, d);
      const betrag = betrag_ct ?? rate(d);
      const a = rateAufteilen(id, datum, betrag);
      return bh.buchenIntern({ objekt_id: d.objekt_id, datum, text: `Rate Darlehen ${d.bank} ${datum.slice(5, 7)}/${datum.slice(0, 4)}`, import_ref: importRef, art: 'bank',
        positionen: [
          { soll_id: k.zins_id, haben_id: geldKontoId, betrag_ct: a.zins_ct, text: 'Zinsen' },
          { soll_id: k.konto_id, haben_id: geldKontoId, betrag_ct: a.tilgung_ct, text: 'Tilgung' },
        ].filter((p) => p.betrag_ct > 0) });
    }),

    darlehenZuKonto: (kontoId) => get('SELECT * FROM darlehen WHERE konto_id = ?', kontoId) ?? null,
  };
};
