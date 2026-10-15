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
      const heute = new Date().toISOString().slice(0, 7);
      const p = plan(d, heute);
      const ist = d.konto_id ? -bh.saldoBis(d.konto_id, '9999-12-31') : null;
      return { ...d, rate_berechnet_ct: rate(d), rest_plan_ct: p.at(-1)?.rest_ct ?? d.betrag_ct, rest_ist_ct: ist,
        zinsen_jahr_ct: plan(d).filter((z) => z.monat.slice(0, 4) === heute.slice(0, 4)).reduce((s, z) => s + z.zins_ct, 0) };
    }),

    tilgungsplan: (id) => {
      const d = get('SELECT * FROM darlehen WHERE id = ?', id);
      const zeilen = plan(d);
      // Yearly totals are what the tax return and the bank statement show.
      const jahre = {};
      for (const z of zeilen) {
        const j = (jahre[z.monat.slice(0, 4)] ??= { jahr: z.monat.slice(0, 4), zins_ct: 0, tilgung_ct: 0, rest_ct: 0 });
        j.zins_ct += z.zins_ct; j.tilgung_ct += z.tilgung_ct; j.rest_ct = z.rest_ct;
      }
      const restBindung = d.zinsbindung_bis ? zeilen.filter((z) => z.monat <= d.zinsbindung_bis.slice(0, 7)).at(-1)?.rest_ct ?? null : null;
      return { darlehen: d, rate_ct: rate(d), zeilen, jahre: Object.values(jahre), rest_zinsbindung_ct: restBindung, laufzeit_monate: zeilen.length };
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
