const ortszeit = require('./zeit.cjs');
// Projects: schedule (Gantt), quotes, orders and invoices with budget control. A project can stand alone
// or be linked to an object, in which case its invoices are booked in that object's ledger.
module.exports = function projekte({ db, all, get, tx, bh }) {
  const summen = (projektId) => {
    const s = (art, extra = '') => get(`SELECT coalesce(sum(betrag_ct), 0) AS s FROM projektposten WHERE projekt_id = ? AND art = ? ${extra}`, projektId, art).s;
    return {
      angebote_ct: s('angebot'),
      auftraege_ct: s('auftrag', "AND status <> 'storniert'"),
      rechnungen_ct: s('rechnung'),
      bezahlt_ct: s('rechnung', "AND (status = 'bezahlt' OR buchung_id IS NOT NULL)"),
      sonstiges_ct: s('sonstiges'),
    };
  };

  // Expected final cost: invoiced so far plus the not yet invoiced part of each order.
  const prognose = (projektId, sm) => {
    const offeneAuftraege = all(`SELECT a.betrag_ct,
        (SELECT coalesce(sum(r.betrag_ct), 0) FROM projektposten r WHERE r.projekt_id = a.projekt_id AND r.art = 'rechnung'
          AND (r.firma = a.firma OR (r.aufgabe_id IS NOT NULL AND r.aufgabe_id = a.aufgabe_id))) AS berechnet
      FROM projektposten a WHERE a.projekt_id = ? AND a.art = 'auftrag' AND a.status <> 'storniert'`, projektId);
    return sm.rechnungen_ct + sm.sonstiges_ct + offeneAuftraege.reduce((x, a) => x + Math.max(0, a.betrag_ct - a.berechnet), 0);
  };

  function projektListe() {
    return all(`SELECT p.*, o.bezeichnung AS objekt, e.bezeichnung AS einheit,
        (SELECT min(beginn) FROM projektaufgaben a WHERE a.projekt_id = p.id) AS plan_beginn,
        (SELECT max(ende) FROM projektaufgaben a WHERE a.projekt_id = p.id) AS plan_ende,
        (SELECT round(avg(fortschritt)) FROM projektaufgaben a WHERE a.projekt_id = p.id) AS fortschritt,
        (SELECT count(*) FROM projektaufgaben a WHERE a.projekt_id = p.id) AS aufgaben
      FROM projekte p LEFT JOIN objekte o ON o.id = p.objekt_id LEFT JOIN einheiten e ON e.id = p.einheit_id
      ORDER BY p.status = 'abgeschlossen', p.status = 'planung', coalesce(p.beginn, p.erstellt) DESC`)
      .map((p) => { const sm = summen(p.id); return { ...p, ...sm, prognose_ct: prognose(p.id, sm) }; });
  }

  return {
    projektListe,
    projekt: (id) => {
      const p = projektListe().find((x) => x.id === id);
      if (!p) return null;
      return {
        ...p,
        aufgaben: all('SELECT * FROM projektaufgaben WHERE projekt_id = ? ORDER BY sort, beginn, id', id),
        posten: all(`SELECT pp.*, d.datei, d.titel AS dokument FROM projektposten pp LEFT JOIN dokumente d ON d.id = pp.dokument_id
          WHERE pp.projekt_id = ? ORDER BY coalesce(pp.datum, '') DESC, pp.id DESC`, id),
      };
    },

    // Moves a task and every task that follows it (directly or indirectly) by the same number of days.
    aufgabeVerschieben: (id, tage) => tx(() => {
      const verschiebe = (aid, gesehen = new Set()) => {
        if (gesehen.has(aid)) return;
        gesehen.add(aid);
        db.prepare(`UPDATE projektaufgaben SET beginn = date(beginn, ? || ' days'), ende = date(ende, ? || ' days') WHERE id = ?`).run(String(tage), String(tage), aid);
        for (const n of all('SELECT id FROM projektaufgaben WHERE nach_id = ?', aid)) verschiebe(n.id, gesehen);
      };
      verschiebe(id);
    }),

    // Books a project invoice in the linked object's ledger (expense account against bank) and marks it paid.
    projektRechnungBuchen: (postenId, geldKontoId, datum) => tx(() => {
      const r = get('SELECT pp.*, p.objekt_id, p.kosten_konto_id, p.titel AS projekt FROM projektposten pp JOIN projekte p ON p.id = pp.projekt_id WHERE pp.id = ?', postenId);
      if (!r.objekt_id) throw new Error('Das Projekt ist keinem Objekt zugeordnet – die Rechnung wird nur im Projekt geführt.');
      if (!r.kosten_konto_id) throw new Error('Im Projekt ist kein Kostenkonto für die Buchung hinterlegt.');
      if (r.buchung_id) throw new Error('Diese Rechnung ist bereits gebucht.');
      const geld = geldKontoId ?? get(`SELECT id FROM konten WHERE objekt_id = ? AND klasse = 'geld' ORDER BY nr LIMIT 1`, r.objekt_id).id;
      const id = bh.buchenIntern({ objekt_id: r.objekt_id, datum: datum ?? r.datum, text: `${r.projekt}: ${r.firma ?? ''} ${r.titel}`.slice(0, 120),
        positionen: [{ soll_id: r.kosten_konto_id, haben_id: geld, betrag_ct: r.betrag_ct }] });
      db.prepare(`UPDATE projektposten SET buchung_id = ?, status = 'bezahlt', bezahlt_am = coalesce(bezahlt_am, ?) WHERE id = ?`).run(id, datum ?? r.datum, postenId);
      if (r.dokument_id) db.prepare('UPDATE dokumente SET buchung_id = ? WHERE id = ?').run(id, r.dokument_id);
      return id;
    }),

    // Administrative year plan derived from the data: statement periods, deadlines, meetings, budget plans.
    jahresplan: (jahr) => {
      const zeilen = [];
      const t = ortszeit.heute();
      for (const o of all('SELECT * FROM objekte ORDER BY bezeichnung')) {
        const fertig = (typ, j) => !!get('SELECT 1 FROM abrechnungen WHERE objekt_id = ? AND typ = ? AND substr(von, 1, 4) = ?', o.id, typ, String(j));
        if (o.art !== 'weg') zeilen.push({ gruppe: o.bezeichnung, titel: `Betriebskostenabrechnung ${jahr - 1}`, beginn: `${jahr}-01-01`, ende: `${jahr}-12-31`, erledigt: fertig('nk', jahr - 1), art: 'frist' });
        if (o.art !== 'miete') {
          zeilen.push({ gruppe: o.bezeichnung, titel: `Jahresabrechnung ${jahr - 1}`, beginn: `${jahr}-01-15`, ende: `${jahr}-06-30`, erledigt: fertig('weg', jahr - 1), art: 'frist' });
          zeilen.push({ gruppe: o.bezeichnung, titel: `Wirtschaftsplan ${jahr + 1}`, beginn: `${jahr}-09-01`, ende: `${jahr}-12-15`, erledigt: fertig('wipl', jahr + 1), art: 'frist' });
          for (const v of all(`SELECT * FROM versammlungen WHERE objekt_id = ? AND substr(datum, 1, 4) = ?`, o.id, String(jahr))) {
            zeilen.push({ gruppe: o.bezeichnung, titel: 'Einladung (3 Wochen Frist)', beginn: shift(v.datum, -35), ende: shift(v.datum, -21), erledigt: !!v.einladung_am, art: 'frist' });
            zeilen.push({ gruppe: o.bezeichnung, titel: 'Eigentümerversammlung', beginn: v.datum, ende: v.datum, erledigt: v.datum < t, art: 'termin' });
          }
        }
        for (const m of all(`SELECT m.ende, e.bezeichnung FROM mietverhaeltnisse m JOIN einheiten e ON e.id = m.einheit_id WHERE e.objekt_id = ? AND substr(m.ende, 1, 4) = ?`, o.id, String(jahr))) {
          zeilen.push({ gruppe: o.bezeichnung, titel: `Mietende ${m.bezeichnung}`, beginn: m.ende, ende: m.ende, erledigt: m.ende < t, art: 'termin' });
        }
      }
      for (const p of all(`SELECT * FROM projekte WHERE status <> 'abgeschlossen'`)) {
        const b = get('SELECT min(beginn) AS b, max(ende) AS e FROM projektaufgaben WHERE projekt_id = ?', p.id);
        if (b.b) zeilen.push({ gruppe: 'Projekte', titel: p.titel, beginn: b.b, ende: b.e, erledigt: false, art: 'projekt', projekt_id: p.id });
      }
      return zeilen;
    },
  };
};

function shift(iso, tage) {
  return new Date(Date.parse(iso) + tage * 864e5).toISOString().slice(0, 10);
}
