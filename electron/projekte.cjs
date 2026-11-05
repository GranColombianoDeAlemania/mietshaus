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

  // Shopping list – of one project, or of all (projektId null: every open purchase, bought ones of the last 30 days):
  // tasks of the category „Einkauf“, open ones first by shop, the ones in the cart at the end of their shop.
  const einkaeufe = (projektId) => all(`SELECT v.*, a.titel AS schritt, a.beginn AS schritt_beginn, pr.titel AS projekt, o.bezeichnung AS objekt,
      (SELECT d.datei FROM dokumente d WHERE d.vorgang_id = v.id AND d.status <> 'papierkorb' AND (lower(d.datei) GLOB '*.jp*g' OR lower(d.datei) GLOB '*.png' OR lower(d.datei) GLOB '*.webp') ORDER BY d.id LIMIT 1) AS foto,
      (SELECT count(*) FROM dokumente d WHERE d.vorgang_id = v.id AND d.status <> 'papierkorb') AS fotos,
      (SELECT x.preis_ct FROM vorgaenge x WHERE x.kategorie = 'Einkauf' AND x.status = 'erledigt' AND x.id <> v.id AND x.preis_ct IS NOT NULL
        AND lower(trim(x.titel)) = lower(trim(v.titel)) ORDER BY x.id DESC LIMIT 1) AS zuletzt_ct,
      (SELECT x.menge FROM vorgaenge x WHERE x.kategorie = 'Einkauf' AND x.status = 'erledigt' AND x.id <> v.id AND x.preis_ct IS NOT NULL
        AND lower(trim(x.titel)) = lower(trim(v.titel)) ORDER BY x.id DESC LIMIT 1) AS zuletzt_menge
    FROM vorgaenge v LEFT JOIN projektaufgaben a ON a.id = v.projektaufgabe_id LEFT JOIN projekte pr ON pr.id = v.projekt_id LEFT JOIN objekte o ON o.id = v.objekt_id
    WHERE v.kategorie = 'Einkauf' AND (?1 IS NULL OR v.projekt_id = ?1)
      AND (?1 IS NOT NULL OR v.status <> 'erledigt' OR coalesce(v.geaendert_am, v.erstellt) >= ?2)
    ORDER BY v.status = 'erledigt', coalesce(v.laden, '~'), v.im_wagen, coalesce(a.beginn, '9999'), v.id`,
  projektId ?? null, ortszeit.inTagen(-30));

  // The shop an article was last bought in or written down for („Silikon“ → Bauhaus), the way a grocery list remembers.
  const ladenFuer = (titel) => get(`SELECT laden FROM vorgaenge WHERE kategorie = 'Einkauf' AND laden IS NOT NULL AND lower(trim(titel)) = lower(trim(?))
    ORDER BY status = 'erledigt' DESC, id DESC LIMIT 1`, titel)?.laden ?? null;

  // Shops known from all purchases, the most used first – to choose with one tap.
  const einkaufLaeden = () => all(`SELECT laden, count(*) AS n FROM vorgaenge WHERE kategorie = 'Einkauf' AND laden IS NOT NULL AND trim(laden) <> ''
    GROUP BY lower(laden) ORDER BY n DESC, max(id) DESC LIMIT 12`).map((x) => x.laden);

  // Shares of one receipt for the projects whose articles are on it (and for the articles of no project, which nobody
  // books): by the articles' prices, by their number without any prices; the cents left over by rounding go to the last
  // share, so the shares add up to the receipt exactly.
  function aufteilen(summe, gruppen) {
    const preise = gruppen.reduce((x, g) => x + g.preis, 0);
    const basis = preise ? gruppen.map((g) => g.preis) : gruppen.map((g) => g.artikel.length);
    const gesamt = basis.reduce((x, y) => x + y, 0);
    const anteile = gruppen.map((g, i) => Math.round(summe * basis[i] / gesamt));
    anteile[anteile.length - 1] += summe - anteile.reduce((x, y) => x + y, 0);
    return anteile;
  }

  // Paid at the till: every article bought gets its price (as typed, else its estimate) and is done; the receipt – one
  // amount and one photo for everything – becomes one paid invoice per project („Kosten & Budget“). Articles of no project
  // are only marked done.
  const einkaufAbschliessen = ({ ids = [], betrag_ct = null, dokument_id = null, datum = null, preise = {} } = {}) => tx(() => {
    const liste = [...new Set(ids.map(Number))].map((id) => get(`SELECT * FROM vorgaenge WHERE id = ? AND kategorie = 'Einkauf'`, id)).filter(Boolean);
    if (!liste.length) throw new Error('Diese Einkäufe gibt es nicht mehr.');
    const tag = datum || ortszeit.heute();
    // Paid is only what was typed (the total, else the articles' prices); an estimate alone books nothing.
    let bezahlt = 0;
    for (const v of liste) {
      const p = preise?.[v.id] ?? preise?.[String(v.id)];
      if (p != null && p !== '') { v.preis_ct = Math.round(Number(p)); bezahlt += v.preis_ct; }
      db.prepare(`UPDATE vorgaenge SET status = 'erledigt', im_wagen = 0, preis_ct = ? WHERE id = ?`).run(v.preis_ct ?? null, v.id);
      if (v.status !== 'erledigt') db.prepare(`INSERT INTO vorgangseintraege (vorgang_id, datum, art, text) VALUES (?, ?, 'status', ?)`).run(v.id, tag, 'Gekauft');
    }
    const summe = betrag_ct != null && betrag_ct !== '' ? Math.round(Number(betrag_ct)) : bezahlt;
    const gruppen = [];
    for (const v of liste) {
      let g = gruppen.find((x) => x.projekt_id === (v.projekt_id ?? null));
      if (!g) gruppen.push(g = { projekt_id: v.projekt_id ?? null, artikel: [], preis: 0 });
      g.artikel.push(v);
      g.preis += v.preis_ct ?? 0;
    }
    const posten = [];
    const projekte = gruppen.filter((g) => g.projekt_id);
    if (projekte.length && (summe || dokument_id)) {
      const anteile = aufteilen(summe, gruppen);
      gruppen.forEach((g, i) => {
        if (!g.projekt_id) return;
        const laeden = [...new Set(g.artikel.map((v) => v.laden).filter(Boolean))];
        const schritte = [...new Set(g.artikel.map((v) => v.projektaufgabe_id))];
        const namen = g.artikel.map((v) => `${v.menge ? `${v.menge} ` : ''}${v.titel}`).join(', ');
        posten.push(Number(db.prepare(`INSERT INTO projektposten (projekt_id, art, datum, firma, titel, betrag_ct, status, bezahlt_am, aufgabe_id, dokument_id, notiz)
          VALUES (?, 'rechnung', ?, ?, ?, ?, 'bezahlt', ?, ?, ?, ?)`).run(g.projekt_id, tag, laeden.length === 1 ? laeden[0] : null,
          `Einkauf${laeden.length === 1 ? ` ${laeden[0]}` : ''}: ${namen}`.slice(0, 200), anteile[i], tag, schritte.length === 1 ? schritte[0] ?? null : null,
          dokument_id ?? null, gruppen.length > 1 ? 'aus der Einkaufsliste – Anteil an einem gemeinsamen Kassenbon' : 'aus der Einkaufsliste').lastInsertRowid));
      });
    }
    if (dokument_id) db.prepare('UPDATE dokumente SET projekt_id = coalesce(projekt_id, ?), vorgang_id = coalesce(vorgang_id, ?) WHERE id = ?')
      .run(projekte[0]?.projekt_id ?? null, liste[0].id, dokument_id);
    return { posten, summe_ct: summe };
  });

  return {
    projektListe,
    einkaufsliste: (projektId = null) => {
      const liste = einkaeufe(projektId);
      const offen = liste.filter((v) => v.status !== 'erledigt');
      return { liste, offen: offen.length, offen_geschaetzt_ct: offen.reduce((s, v) => s + (v.preis_ct ?? 0), 0), laeden: einkaufLaeden() };
    },
    einkaufLaeden,
    // Articles bought before and not on the list now, the most frequent first: added again with one tap, with their
    // shop, quantity and last price.
    einkaufVorschlaege: (projektId = null, anzahl = 10) => all(`SELECT v.titel, v.menge, v.laden, v.preis_ct, h.n, h.zuletzt FROM vorgaenge v
      JOIN (SELECT lower(trim(titel)) AS k, max(id) AS id, count(*) AS n, max(coalesce(geaendert_am, erstellt)) AS zuletzt FROM vorgaenge
        WHERE kategorie = 'Einkauf' AND status = 'erledigt' GROUP BY lower(trim(titel))) h ON h.id = v.id
      WHERE NOT EXISTS (SELECT 1 FROM vorgaenge o WHERE o.kategorie = 'Einkauf' AND o.status <> 'erledigt' AND lower(trim(o.titel)) = h.k
        AND (?1 IS NULL OR o.projekt_id = ?1))
      ORDER BY h.n DESC, h.zuletzt DESC LIMIT ?2`, projektId ?? null, anzahl),
    // Quick entry: „3 Sack Fliesenkleber“ – a leading quantity with its unit is split off; without a shop, the one the
    // article was bought in last time.
    einkaufNeu: (projektId, { titel, menge = null, laden = null, preis_ct = null, projektaufgabe_id = null, objekt_id = null }) => {
      let t = String(titel ?? '').trim(), m = menge;
      if (!t) throw new Error('Was soll gekauft werden?');
      const z = !m && t.match(/^(\d+(?:[.,]\d+)?\s*(?:x|×|stk\.?|stück|sack|säcke|eimer|rollen?|pakete?|kartons?|dosen?|tuben?|kartuschen?|m²|m2|qm|m|l|liter|kg|g)?)\s+(.+)$/i);
      if (z) { m = z[1].trim(); t = z[2].trim(); }
      const p = projektId ? get('SELECT objekt_id FROM projekte WHERE id = ?', projektId) : null;
      return Number(db.prepare(`INSERT INTO vorgaenge (objekt_id, projekt_id, titel, kategorie, status, prioritaet, menge, laden, preis_ct, projektaufgabe_id, faellig)
        VALUES (?, ?, ?, 'Einkauf', 'offen', 2, ?, ?, ?, ?, (SELECT date(beginn, '-1 day') FROM projektaufgaben WHERE id = ?))`)
        .run(objekt_id ?? p?.objekt_id ?? null, projektId ?? null, t.slice(0, 200), m || null, (laden || ladenFuer(t)) ?? null, preis_ct ?? null,
          projektaufgabe_id ?? null, projektaufgabe_id ?? null).lastInsertRowid);
    },
    // Ticked off in the shop: in the cart (or out again) – paid later for the whole cart with einkaufAbschliessen.
    einkaufWagen: (id, an = true) => {
      const r = db.prepare(`UPDATE vorgaenge SET im_wagen = ? WHERE id = ? AND kategorie = 'Einkauf' AND status <> 'erledigt'`).run(an ? 1 : 0, id);
      return r.changes > 0;
    },
    einkaufAbschliessen,
    // One article bought (from the board or an older device): the same as a receipt for this article alone.
    einkaufGekauft: (id, { betrag_ct = null, dokument_id = null, datum = null } = {}) => {
      const r = einkaufAbschliessen({ ids: [id], betrag_ct, dokument_id, datum });
      return { posten: r.posten[0] ?? null };
    },
    // Steps of the schedule that start within `tage` days while material for them is still to buy.
    materialFehlt: (projektId, tage = 3) => all(`SELECT a.id, a.titel, a.beginn, count(v.id) AS offen FROM projektaufgaben a
      JOIN vorgaenge v ON v.projektaufgabe_id = a.id AND v.kategorie = 'Einkauf' AND v.status <> 'erledigt'
      WHERE a.projekt_id = ? AND a.beginn <= date(?, '+' || ? || ' days') AND a.fortschritt < 100
      GROUP BY a.id ORDER BY a.beginn`, projektId, ortszeit.heute(), String(tage)),
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
