// Automation and checks: runs routine work by itself (monthly charges) and reports what needs a decision
// or is missing. Each hint has a stable key so it can be snoozed or marked as done.
const { tageZwischen, selbstSql } = require('./buchhaltung.cjs');

const heute = () => new Date().toISOString().slice(0, 10);
const plusTage = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const plusMonate = (iso, n) => {
  const d = new Date(iso.slice(0, 7) + '-01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const euro = (ct) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format((ct ?? 0) / 100);
const datumDe = (iso) => (iso ? iso.split('-').reverse().join('.') : '');

module.exports = function automatik({ db, all, get, tx, PERSON_NAME, bh, ab, vw, kz, einstellungen }) {
  const einst = () => einstellungen();

  // Monthly charges up to the current month for all objects. Starts with the month automation was switched on,
  // so older months are never filled in behind the user's back.
  function sollstellungAutomatisch() {
    const e = einst();
    if (e.auto_soll === '0') return { erzeugt: 0 };
    const monat = heute().slice(0, 7);
    let ab_monat = e.auto_soll_ab;
    if (!ab_monat) {
      ab_monat = monat;
      db.prepare(`INSERT INTO einstellungen (schluessel, wert) VALUES ('auto_soll_ab', ?) ON CONFLICT (schluessel) DO NOTHING`).run(ab_monat);
    }
    let erzeugt = 0;
    for (const o of all('SELECT id FROM objekte')) {
      const neu = bh.sollstellung(o.id, ab_monat, monat, true).filter((z) => !z.vorhanden);
      if (neu.length) {
        bh.sollstellung(o.id, ab_monat, monat, false);
        erzeugt += neu.length;
      }
    }
    return { erzeugt, ab_monat };
  }

  function lauf() {
    const r = sollstellungAutomatisch();
    db.prepare(`INSERT INTO einstellungen (schluessel, wert) VALUES ('auto_letzter_lauf', ?) ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert`)
      .run(new Date().toISOString());
    return r;
  }

  // ---------- checks ----------
  // stufe: 'rot' (handeln), 'orange' (bald / prüfen), 'gelb' (Chance / Info). ziel: page to open in the app.
  function hinweise({ alle = false } = {}) {
    const h = [];
    const add = (x) => h.push(x);
    const t = heute();
    const jahr = Number(t.slice(0, 4));
    const monat = Number(t.slice(5, 7));
    const objekte = all('SELECT * FROM objekte ORDER BY bezeichnung');
    const e = einst();

    if (!e.verwalter_name) add({ schluessel: 'stamm:verwalter', stufe: 'orange', kategorie: 'Stammdaten', text: 'Verwalterdaten fehlen – sie stehen als Absender auf allen Briefen.', ziel: 'einstellungen' });

    const postfach = get(`SELECT count(*) AS n FROM dokumente WHERE status = 'postfach'`).n;
    if (postfach) add({ schluessel: 'dok:postfach', stufe: 'orange', kategorie: 'Dokumente', text: `${postfach} Dokument(e) im Postfach warten auf Ablage.`, ziel: 'postfach', dauerhaft: true });
    const fehler = get(`SELECT count(*) AS n FROM dokumente WHERE analyse LIKE 'fehler%'`).n;
    if (fehler) add({ schluessel: 'dok:fehler', stufe: 'gelb', kategorie: 'Dokumente', text: `${fehler} Dokument(e) konnten nicht gelesen werden.`, ziel: 'archiv' });

    // Once after version 0.8: months that had been charged by day are now full months.
    try {
      const u = JSON.parse(e.umstellung_monatlich ?? 'null');
      const umgebucht = (u?.monate ?? []).filter((x) => x.gebucht);
      const gesperrt = (u?.monate ?? []).filter((x) => !x.gebucht);
      const monatDe = (m) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
      if (umgebucht.length) add({ schluessel: 'umstellung:monatlich', stufe: 'gelb', kategorie: 'Buchhaltung', ziel: 'soll',
        text: `Miete und Hausgeld sind jetzt immer volle Monatsbeträge. Umgebucht: ${umgebucht.slice(0, 3).map((x) => `${x.name} ${monatDe(x.monat)} ${euro(x.alt_ct)} → ${euro(x.neu_ct)}`).join('; ')}`
          + `${umgebucht.length > 3 ? ` und ${umgebucht.length - 3} weitere` : ''}.`
          + (gesperrt.length ? ` ${gesperrt.length} Monat(e) in festgeschriebenen Zeiträumen oder von Hand storniert sind unverändert.` : '') });
    } catch { /* no conversion recorded */ }

    for (const r of all(`SELECT d.id, d.titel, d.absender, d.betrag_ct, d.faellig, d.objekt_id, o.bezeichnung AS objekt FROM dokumente d
        LEFT JOIN objekte o ON o.id = d.objekt_id WHERE d.typ = 'Rechnung' AND d.buchung_id IS NULL AND d.faellig IS NOT NULL AND d.faellig <= ?
        -- The same invoice stored twice (e.g. PDF and photo) is reported once.
        AND NOT EXISTS (SELECT 1 FROM dokumente x WHERE x.id < d.id AND x.rechnungsnr = d.rechnungsnr AND coalesce(x.betrag_ct, -1) = coalesce(d.betrag_ct, -1)
          AND coalesce(x.absender, '') = coalesce(d.absender, ''))`, plusTage(t, 7))) {
      add({ schluessel: `re:${r.id}`, stufe: r.faellig < t ? 'rot' : 'orange', kategorie: 'Rechnungen', objekt_id: r.objekt_id, objekt: r.objekt,
        text: `Rechnung ${r.absender ?? r.titel} über ${euro(r.betrag_ct)} ${r.faellig < t ? 'überfällig seit' : 'fällig am'} ${datumDe(r.faellig)}.`, ziel: 'rechnungen',
        links: [{ text: `Rechnung ${r.absender ?? r.titel}`, ziel: { dokument: r.id } }] });
    }

    for (const o of objekte) {
      const miete = o.art !== 'weg', weg = o.art !== 'miete';
      const ziel = (s) => ({ objekt_id: o.id, objekt: o.bezeichnung, ziel: s });

      // Arrears: monthly charges not (fully) paid by their due date.
      for (const k of all(`SELECT * FROM konten WHERE objekt_id = ? AND klasse = 'person'`, o.id)) {
        const op = bh.offenePostenKonto(k.id, t);
        // Only what was not paid by its due date counts; something due today is not yet late.
        const ueberfaellig = op.offen.filter((x) => x.verzug >= 1);
        const betrag = Math.max(0, ueberfaellig.reduce((s, x) => s + x.offen_ct, 0) - op.guthaben_ct);
        if (!betrag) continue;
        const alt = Math.max(...ueberfaellig.map((x) => x.verzug));
        const monate = ueberfaellig.map((x) => x.monat ? `${x.monat.slice(5)}/${x.monat.slice(2, 4)}${x.status === 'teilweise bezahlt' ? ' (teilw.)' : ''}` : x.text).join(', ');
        add({ modus: k.vertrag_typ, schluessel: `op:${k.id}:${t.slice(0, 7)}`, stufe: alt >= 14 ? 'rot' : 'orange', kategorie: k.vertrag_typ === 'weg' ? 'Hausgeld' : 'Miete',
          text: `Rückstand ${k.bezeichnung}: ${euro(betrag)} – offen: ${monate} (seit ${alt} Tagen).`, ...ziel('op'),
          links: k.vertrag_id ? [{ text: k.bezeichnung, ziel: { vertrag: k.vertrag_id, typ: k.vertrag_typ } }] : [] });
      }

      // Instalment agreements: a missed instalment, or the plan paid off.
      for (const r of all(`SELECT r.id, k.bezeichnung, k.vertrag_id, k.vertrag_typ FROM ratenplaene r JOIN konten k ON k.id = r.konto_id
          WHERE k.objekt_id = ? AND r.status = 'aktiv'`, o.id)) {
        const st = bh.ratenplanStand(r.id, t);
        const links = r.vertrag_id ? [{ text: r.bezeichnung, ziel: { vertrag: r.vertrag_id, typ: r.vertrag_typ } }] : [];
        if (st.erfuellt) add({ modus: r.vertrag_typ, schluessel: `rate-ok:${r.id}`, stufe: 'gelb', kategorie: 'Ratenzahlung', ...ziel('op'), links,
          text: `Ratenzahlung ${r.bezeichnung} ist vollständig bezahlt – Vereinbarung als erfüllt abschließen.` });
        else if (st.verzug_ct > 0) add({ modus: r.vertrag_typ, schluessel: `rate:${r.id}:${t.slice(0, 7)}`, stufe: 'rot', kategorie: 'Ratenzahlung', ...ziel('op'), links,
          text: `Ratenzahlung ${r.bezeichnung}: ${euro(st.verzug_ct)} der fälligen Raten fehlen.` });
      }

      // Returned direct debits in the last 30 days.
      for (const b of all(`SELECT b.datum, b.betrag_ct, k.bezeichnung, k.vertrag_id, k.vertrag_typ FROM buchungen b JOIN konten k ON k.id = b.soll_id
          WHERE b.objekt_id = ? AND k.klasse = 'person' AND b.art = 'bank' AND b.datum >= ? AND lower(coalesce(b.text,'')) GLOB '*r*cklastschrift*'`, o.id, plusTage(t, -30))) {
        add({ schluessel: `rl:${o.id}:${b.datum}:${b.betrag_ct}`, stufe: 'rot', kategorie: 'Bank', text: `Rücklastschrift ${b.bezeichnung} über ${euro(b.betrag_ct)} am ${datumDe(b.datum)}.`, ...ziel('op'),
          links: b.vertrag_id ? [{ text: b.bezeichnung, ziel: { vertrag: b.vertrag_id, typ: b.vertrag_typ } }] : [] });
      }

      // Service-charge statement for last year: deadline 31.12. of this year (§ 556 Abs. 3 BGB).
      if (miete && get('SELECT count(*) AS n FROM mietverhaeltnisse m JOIN einheiten e ON e.id = m.einheit_id WHERE e.objekt_id = ? AND m.beginn <= ?', o.id, `${jahr - 1}-12-31`).n) {
        const fertig = get(`SELECT 1 FROM abrechnungen WHERE objekt_id = ? AND typ = 'nk' AND substr(von, 1, 4) = ?`, o.id, String(jahr - 1));
        if (!fertig && monat >= 3) {
          add({ modus: 'miete', schluessel: `nk:${o.id}:${jahr - 1}`, stufe: monat >= 10 ? 'rot' : 'orange', kategorie: 'Abrechnung', ...ziel('nk'),
            text: `Betriebskostenabrechnung ${jahr - 1} erstellen – Frist 31.12.${jahr} (danach keine Nachforderung mehr).` });
          // Cost types that had postings two years ago but none last year: an invoice may be missing.
          for (const k of all(`SELECT k.id, k.bezeichnung FROM konten k WHERE k.objekt_id = ? AND k.klasse = 'kosten' AND k.umlagefaehig = 1
              AND EXISTS (SELECT 1 FROM buchungen b WHERE b.soll_id = k.id AND substr(b.datum, 1, 4) = ?)
              AND NOT EXISTS (SELECT 1 FROM buchungen b WHERE b.soll_id = k.id AND substr(b.datum, 1, 4) = ?)`, o.id, String(jahr - 2), String(jahr - 1))) {
            add({ modus: 'miete', schluessel: `nkfehlt:${k.id}:${jahr - 1}`, stufe: 'orange', kategorie: 'Abrechnung', ...ziel('archiv'),
              text: `Für „${k.bezeichnung}“ fehlt ${jahr - 1} eine Rechnung (${jahr - 2} war gebucht) – für die Betriebskostenabrechnung nachreichen.`,
              links: [{ text: k.bezeichnung, ziel: { konto: k.id } }] });
          }
        }
      }

      if (weg && get('SELECT count(*) AS n FROM eigentum g JOIN einheiten e ON e.id = g.einheit_id WHERE e.objekt_id = ?', o.id).n) {
        if (!get(`SELECT 1 FROM abrechnungen WHERE objekt_id = ? AND typ = 'weg' AND substr(von, 1, 4) = ?`, o.id, String(jahr - 1)) && monat >= 3) {
          add({ modus: 'weg', schluessel: `weg:${o.id}:${jahr - 1}`, stufe: monat >= 7 ? 'rot' : 'orange', kategorie: 'Abrechnung', ...ziel('wegabr'),
            text: `Jahresabrechnung ${jahr - 1} für die Eigentümerversammlung erstellen.` });
        }
        if (monat >= 9 && !get(`SELECT 1 FROM abrechnungen WHERE objekt_id = ? AND typ = 'wipl' AND substr(von, 1, 4) = ?`, o.id, String(jahr + 1))) {
          add({ modus: 'weg', schluessel: `wipl:${o.id}:${jahr + 1}`, stufe: 'orange', kategorie: 'Abrechnung', ...ziel('wipl'), text: `Wirtschaftsplan ${jahr + 1} vorbereiten.` });
        }
        if (monat >= 6 && !get(`SELECT 1 FROM versammlungen WHERE objekt_id = ? AND substr(datum, 1, 4) = ?`, o.id, String(jahr))) {
          add({ modus: 'weg', schluessel: `vers:${o.id}:${jahr}`, stufe: monat >= 10 ? 'rot' : 'orange', kategorie: 'WEG', ...ziel('versammlungen'),
            text: `Für ${jahr} ist noch keine Eigentümerversammlung angelegt (mindestens einmal jährlich, Ladungsfrist 3 Wochen).` });
        }
        for (const v of all(`SELECT * FROM versammlungen WHERE objekt_id = ? AND datum BETWEEN ? AND ? AND (einladung_am IS NULL OR einladung_am = '')`, o.id, t, plusTage(t, 35))) {
          add({ modus: 'weg', schluessel: `einl:${v.id}`, stufe: tageZwischen(t, v.datum) <= 24 ? 'rot' : 'orange', kategorie: 'WEG', ...ziel('versammlungen'),
            text: `Einladung zur Versammlung am ${datumDe(v.datum)} verschicken (spätestens ${datumDe(plusTage(v.datum, -21))}).` });
        }
      }

      if (miete) {
        for (const v of all(`SELECT m.*, e.bezeichnung AS einheit, ${PERSON_NAME} AS name FROM mietverhaeltnisse m JOIN einheiten e ON e.id = m.einheit_id
            JOIN personen p ON p.id = m.person_id WHERE e.objekt_id = ?1 AND m.beginn <= ?2 AND (m.ende IS NULL OR m.ende = '' OR m.ende >= ?2)`, o.id, t)) {
          const links = [{ text: v.name, ziel: { person: v.person_id } }, { text: v.einheit, ziel: { einheit: v.einheit_id } }];
          const modell = get('SELECT * FROM mietmodelle WHERE vertrag_id = ?', v.id);
          // Indexed rent: possible once 12 months have passed and the index has risen.
          if (modell?.art === 'index') {
            try {
              const r = vw.indexBerechnung(v.id);
              if (r.neue_miete_ct > r.alte_miete_ct) add({ modus: 'miete', schluessel: `idx:${v.id}:${r.neu_monat}`, stufe: 'gelb', kategorie: 'Chance', ...ziel('anpassung'), links,
                text: `Indexerhöhung möglich bei ${v.name} (${v.einheit}): +${euro(r.neue_miete_ct - r.alte_miete_ct)} pro Monat, frühestens ab ${datumDe(r.frueheste_wirkung)}.` });
            } catch (err) {
              add({ modus: 'miete', schluessel: `idxfehlt:${v.id}`, stufe: 'gelb', kategorie: 'Stammdaten', ...ziel('anpassung'), links, text: `Indexmiete ${v.name}: ${err.message}` });
            }
          } else if (!modell) {
            const letzte = get(`SELECT max(gueltig_ab) AS d FROM anpassungen WHERE vertrag_typ = 'miete' AND vertrag_id = ? AND kaltmiete_ct IS NOT NULL`, v.id).d ?? v.beginn;
            if (plusMonate(letzte, 15) <= t) add({ modus: 'miete', schluessel: `mh:${v.id}:${jahr}`, stufe: 'gelb', kategorie: 'Chance', ...ziel('anpassung'), links,
              text: `Mieterhöhung prüfen bei ${v.name} (${v.einheit}): Miete seit ${datumDe(letzte)} unverändert.` });
          }
          // Deposit not fully paid three months after move-in.
          if (v.kaution_ct > 0 && plusMonate(v.beginn, 3) <= t) {
            const k = get('SELECT id FROM kautionen WHERE vertrag_id = ?', v.id);
            const ist = k ? get(`SELECT coalesce(sum(CASE WHEN art IN ('einzahlung','zinsen') THEN betrag_ct ELSE -betrag_ct END), 0) AS s FROM kautionsbewegungen WHERE kaution_id = ?`, k.id).s : 0;
            if (ist < v.kaution_ct) add({ modus: 'miete', schluessel: `kau:${v.id}`, stufe: 'orange', kategorie: 'Miete', ...ziel('kaution'), links,
              text: `Kaution ${v.name}: ${euro(ist)} von ${euro(v.kaution_ct)} erfasst.` });
          }
          if (v.ende && v.ende <= plusTage(t, 60)) add({ modus: 'miete', schluessel: `ende:${v.id}`, stufe: 'orange', kategorie: 'Miete', ...ziel('vertraege'), links,
            text: `Mietende ${v.name} (${v.einheit}) am ${datumDe(v.ende)}: Übergabe, Zählerstände, Kautionsabrechnung planen.` });
          if (v.lastschrift && (!get('SELECT iban FROM personen WHERE id = ?', v.person_id)?.iban || !v.sepa_mandat))
            add({ modus: 'miete', schluessel: `ls:${v.id}`, stufe: 'orange', kategorie: 'Bank', ...ziel('vertraege'), links, text: `Lastschrift bei ${v.name}: IBAN oder Mandatsreferenz fehlt.` });
        }
        // Advance payments too low: last statement asked for a large back payment and nothing was adjusted since.
        const nk = get(`SELECT * FROM abrechnungen WHERE objekt_id = ? AND typ = 'nk' ORDER BY bis DESC LIMIT 1`, o.id);
        if (nk) {
          const d = JSON.parse(nk.daten);
          for (const e2 of d.ergebnisse ?? []) {
            const vz = (e2.bk_vz_ct ?? 0) + (e2.hk_vz_ct ?? 0);
            if (!e2.segment?.vertrag || vz <= 0 || e2.ergebnis_ct <= vz * 0.15) continue;
            const angepasst = get(`SELECT 1 FROM anpassungen WHERE vertrag_typ = 'miete' AND vertrag_id = ? AND gueltig_ab > ? AND (bk_vz_ct IS NOT NULL OR hk_vz_ct IS NOT NULL)`, e2.segment.vertrag.id, nk.bis);
            if (!angepasst && !e2.segment.vertrag.ende) add({ modus: 'miete', schluessel: `vz:${e2.segment.vertrag.id}:${nk.bis}`, stufe: 'gelb', kategorie: 'Chance', ...ziel('nk'),
              links: [{ text: e2.segment.vertrag.name, ziel: { vertrag: e2.segment.vertrag.id, typ: 'miete' } }],
              text: `Vorauszahlungen ${e2.segment.vertrag.name} zu niedrig: Nachzahlung ${euro(e2.ergebnis_ct)} bei ${euro(vz)} Vorauszahlungen – anpassen.` });
          }
        }
        const leer = all(`SELECT e.id, e.bezeichnung FROM einheiten e WHERE e.objekt_id = ?1 AND NOT EXISTS (SELECT 1 FROM mietverhaeltnisse m WHERE m.einheit_id = e.id
          AND m.beginn <= ?2 AND (m.ende IS NULL OR m.ende = '' OR m.ende >= ?2)) AND NOT EXISTS (SELECT 1 FROM eigentum g WHERE g.einheit_id = e.id AND g.selbstnutzer = 1)
          AND NOT ${selbstSql('e', '?2')}`, o.id, t);
        if (leer.length) add({ modus: 'miete', schluessel: `leer:${o.id}:${t.slice(0, 7)}`, stufe: 'gelb', kategorie: 'Miete', ...ziel('vermietung'),
          text: `Leerstand: ${leer.map((x) => x.bezeichnung).join(', ')}.`, links: leer.map((x) => ({ text: x.bezeichnung, ziel: { einheit: x.id } })) });
      }

      // Interest rate fixation ends: look for follow-up financing in time (18 months ahead, urgent within 6).
      for (const d of all(`SELECT * FROM darlehen WHERE objekt_id = ? AND zinsbindung_bis IS NOT NULL AND zinsbindung_bis BETWEEN ? AND ?`, o.id, t, plusMonate(t, 18))) {
        add({ schluessel: `zb:${d.id}`, stufe: d.zinsbindung_bis <= plusMonate(t, 6) ? 'rot' : 'orange', kategorie: 'Finanzierung', objekt_id: o.id, objekt: o.bezeichnung, ziel: 'darlehen',
          text: `Zinsbindung Darlehen ${d.bank} endet am ${datumDe(d.zinsbindung_bis)} – Anschlussfinanzierung (z. B. Forward-Darlehen) prüfen.` });
      }

      if (!o.iban) add({ schluessel: `stamm:iban:${o.id}`, stufe: 'gelb', kategorie: 'Stammdaten', ...ziel('objekte'), text: 'IBAN des Objektkontos fehlt (nötig für Briefe und SEPA).' });
      // Garages, parking spaces and cellars have no living area.
      const ohneFlaeche = get(`SELECT count(*) AS n FROM einheiten WHERE objekt_id = ? AND (wohnflaeche IS NULL OR wohnflaeche = 0)
        AND coalesce(art, 'Wohnung') NOT IN ('Garage', 'Stellplatz', 'Keller')`, o.id).n;
      if (ohneFlaeche) add({ schluessel: `stamm:flaeche:${o.id}`, stufe: 'gelb', kategorie: 'Stammdaten', ...ziel('einheiten'), text: `${ohneFlaeche} Einheit(en) ohne Wohnfläche – wichtig für die Kostenverteilung.` });

      for (const v of all(`SELECT * FROM versicherungen WHERE objekt_id = ? AND kuendbar_bis BETWEEN ? AND ?`, o.id, t, plusTage(t, 60))) {
        add({ schluessel: `vers:${v.id}:${v.kuendbar_bis}`, stufe: 'orange', kategorie: 'Verträge', ...ziel('versicherungen'),
          text: `${v.art} (${v.gesellschaft ?? ''}) bis ${datumDe(v.kuendbar_bis)} kündbar – Konditionen prüfen.` });
      }
    }

    // Consumption jumps against the year before: a leak, a faulty meter or a change of tenant?
    const zahl = (x) => x.toLocaleString('de-DE', { maximumFractionDigits: x < 100 ? 1 : 0 });
    for (const x of kz?.verbrauchSpruenge() ?? []) {
      add({ modus: x.objekt_art === 'weg' ? 'weg' : 'miete', schluessel: `verbrauch:${x.einheit_id}:${x.art}:${x.jahr}`, stufe: 'gelb', kategorie: 'Verbrauch',
        objekt_id: x.objekt_id, objekt: x.objekt, ziel: 'zaehler', links: [{ text: x.einheit_name, ziel: { einheit: x.einheit_id } }],
        text: `${x.label} ${x.einheit_name}: ${x.jahr} ${x.aenderung > 0 ? '+' : '−'}${Math.round(Math.abs(x.aenderung))} % gegenüber ${x.jahr - 1} (${zahl(x.vorjahr)} → ${zahl(x.wert)} ${x.einheit}) – Leck, defekter Zähler oder Mieterwechsel?` });
    }

    // Snoozed or done hints are hidden unless all are requested.
    const status = Object.fromEntries(all('SELECT * FROM hinweis_status').map((s) => [s.schluessel, s]));
    const ordnung = { rot: 0, orange: 1, gelb: 2 };
    return h.map((x) => ({ ...x, status: status[x.schluessel] }))
      .filter((x) => alle || x.dauerhaft || !x.status || (x.status.bis && x.status.bis < t))
      .sort((a, b) => ordnung[a.stufe] - ordnung[b.stufe]);
  }

  // Key figures for the overview.
  function kennzahlen(modus = 'miete') {
    const t = heute();
    const monat = t.slice(0, 7);
    const summe = (sql, ...p) => get(sql, ...p).s ?? 0;
    // Charges and receipts of this month, only for the contracts of the current mode.
    const soll = summe(`SELECT sum(b.betrag_ct) AS s FROM buchungen b JOIN konten k ON k.id = b.soll_id
      WHERE k.klasse = 'person' AND k.vertrag_typ = ? AND b.art = 'soll' AND b.monat = ?`, modus, monat);
    const ist = summe(`SELECT sum(b.betrag_ct) AS s FROM buchungen b JOIN konten k ON k.id = b.haben_id JOIN konten g ON g.id = b.soll_id
      WHERE k.klasse = 'person' AND k.vertrag_typ = ? AND g.klasse = 'geld' AND substr(b.datum, 1, 7) = ?`, modus, monat);
    const geld = summe(`SELECT sum(CASE WHEN k.id = b.soll_id THEN b.betrag_ct ELSE -b.betrag_ct END) AS s FROM buchungen b JOIN konten k ON k.id IN (b.soll_id, b.haben_id) WHERE k.klasse = 'geld'`);
    const einheiten = get('SELECT count(*) AS n FROM einheiten e JOIN objekte o ON o.id = e.objekt_id WHERE o.art <> \'weg\'').n;
    const vermietet = get(`SELECT count(DISTINCT m.einheit_id) AS n FROM mietverhaeltnisse m WHERE m.beginn <= ?1 AND (m.ende IS NULL OR m.ende = '' OR m.ende >= ?1)`, t).n;
    // Cash flow per month: bank inflows and outflows, transfers between own accounts left out.
    const verlauf = [];
    for (let i = 11; i >= 0; i--) {
      const m = plusMonate(`${monat}-01`, -i).slice(0, 7);
      verlauf.push({
        monat: m,
        ein_ct: summe(`SELECT sum(b.betrag_ct) AS s FROM buchungen b JOIN konten s ON s.id = b.soll_id JOIN konten h ON h.id = b.haben_id
          WHERE s.klasse = 'geld' AND h.klasse <> 'geld' AND substr(b.datum, 1, 7) = ?`, m),
        aus_ct: summe(`SELECT sum(b.betrag_ct) AS s FROM buchungen b JOIN konten s ON s.id = b.soll_id JOIN konten h ON h.id = b.haben_id
          WHERE h.klasse = 'geld' AND s.klasse <> 'geld' AND substr(b.datum, 1, 7) = ?`, m),
      });
    }
    return { monat, soll_ct: soll, ist_ct: ist, geld_ct: geld, einheiten, vermietet, verlauf };
  }

  // First steps after a fresh start: what is set up already and what is still missing.
  function ersteSchritte() {
    const e = einst();
    const n = (sql, ...p) => get(sql, ...p).n;
    const schritte = [
      { punkt: 'verwalter', text: 'Eigene Absenderdaten eintragen (stehen auf allen Briefen)', fertig: !!e.verwalter_name, ziel: { seite: 'einstellungen' } },
      { punkt: 'objekt', text: 'Erstes Haus anlegen', fertig: n('SELECT count(*) AS n FROM objekte') > 0, ziel: { seite: 'objekte', aktion: 'neues-objekt' } },
      { punkt: 'einheiten', text: 'Einheiten mit Wohnfläche erfassen', fertig: n('SELECT count(*) AS n FROM einheiten') > 0 && !n(`SELECT count(*) AS n FROM einheiten WHERE (wohnflaeche IS NULL OR wohnflaeche = 0) AND coalesce(art, 'Wohnung') NOT IN ('Garage', 'Stellplatz', 'Keller')`), ziel: { seite: 'einheiten' } },
      { punkt: 'personen', text: 'Mieter und Eigentümer ins Adressbuch aufnehmen', fertig: n('SELECT count(*) AS n FROM personen') > 0, ziel: { seite: 'personen', aktion: 'neue-person' } },
      { punkt: 'vertraege', text: 'Mietverhältnisse bzw. Eigentum zuordnen', fertig: n('SELECT (SELECT count(*) FROM mietverhaeltnisse) + (SELECT count(*) FROM eigentum) AS n') > 0, ziel: { seite: 'vertraege' } },
      { punkt: 'iban', text: 'IBAN des Objektkontos hinterlegen', fertig: n('SELECT count(*) AS n FROM objekte') > 0 && !n(`SELECT count(*) AS n FROM objekte WHERE iban IS NULL OR iban = ''`), ziel: { seite: 'objekte' } },
      { punkt: 'soll', text: 'Monatliche Sollstellung prüfen (läuft automatisch)', fertig: n(`SELECT count(*) AS n FROM buchungen WHERE art = 'soll'`) > 0, ziel: { seite: 'soll' } },
      { punkt: 'bank', text: 'Ersten Kontoauszug importieren', fertig: n(`SELECT count(*) AS n FROM buchungen WHERE art = 'bank'`) > 0, ziel: { seite: 'bank' } },
      { punkt: 'sicherung', text: 'Eine Datensicherung anlegen', fertig: !!e.letzte_sicherung, ziel: { seite: 'einstellungen' } },
    ];
    const ausgeblendet = !!get(`SELECT 1 FROM checkliste WHERE liste = 'erste-schritte' AND punkt = 'ausgeblendet'`);
    return { schritte, fertig: schritte.every((x) => x.fertig), ausgeblendet };
  }

  // Year-end checklist for the year being closed. Points are ticked automatically when the data shows them done;
  // the others can be ticked by hand (table checkliste, list "jahreswechsel-<year>").
  function jahreswechsel(jahr) {
    const e = einst();
    const n = (sql, ...p) => get(sql, ...p).n;
    const ende = `${jahr}-12-31`;
    const liste = `jahreswechsel-${jahr}`;
    const haken = new Set(all('SELECT punkt FROM checkliste WHERE liste = ?', liste).map((x) => x.punkt));
    const objekte = all('SELECT * FROM objekte');
    const mietObjekte = objekte.filter((o) => o.art !== 'weg' && n(`SELECT count(*) AS n FROM mietverhaeltnisse m JOIN einheiten x ON x.id = m.einheit_id WHERE x.objekt_id = ? AND m.beginn <= ?`, o.id, ende));
    const wegObjekte = objekte.filter((o) => o.art !== 'miete' && n(`SELECT count(*) AS n FROM eigentum g JOIN einheiten x ON x.id = g.einheit_id WHERE x.objekt_id = ?`, o.id));
    const bankBis = objekte.every((o) => {
      const d = get(`SELECT max(b.datum) AS d FROM buchungen b JOIN konten k ON k.id IN (b.soll_id, b.haben_id) WHERE k.objekt_id = ? AND k.klasse = 'geld' AND b.art = 'bank'`, o.id).d;
      return !n(`SELECT count(*) AS n FROM konten WHERE objekt_id = ? AND klasse = 'person'`, o.id) || (d && d >= `${jahr}-12-20`);
    });
    const zaehlerOffen = n(`SELECT count(*) AS n FROM zaehler z WHERE (z.ausbau IS NULL OR z.ausbau = '' OR z.ausbau > ?1) AND (z.einbau IS NULL OR z.einbau = '' OR z.einbau <= ?1)
      AND NOT EXISTS (SELECT 1 FROM zaehlerstaende s WHERE s.zaehler_id = z.id AND abs(julianday(s.datum) - julianday(?1)) <= 14)`, ende);
    const punkte = [
      { punkt: 'kontoauszuege', text: `Alle Kontoauszüge bis 31.12.${jahr} importiert und gebucht`, auto: bankBis, ziel: { seite: 'bank' } },
      { punkt: 'postfach', text: 'Postfach abgearbeitet', auto: !n(`SELECT count(*) AS n FROM dokumente WHERE status = 'postfach'`), ziel: { seite: 'postfach' } },
      { punkt: 'rechnungen', text: `Alle Rechnungen aus ${jahr} gebucht`, auto: !n(`SELECT count(*) AS n FROM dokumente WHERE typ = 'Rechnung' AND buchung_id IS NULL AND substr(coalesce(datum, erfasst), 1, 4) = ?`, String(jahr)), ziel: { seite: 'rechnungen' } },
      { punkt: 'zaehler', text: `Zählerstände zum 31.12.${jahr} abgelesen`, auto: zaehlerOffen === 0, hinweis: zaehlerOffen ? `${zaehlerOffen} Zähler ohne Stand` : null, ziel: { seite: 'zaehler' } },
      { punkt: 'rueckstaende', text: 'Offene Posten geprüft, Mahnungen verschickt', auto: false, ziel: { seite: 'op' } },
      ...(mietObjekte.length ? [{ punkt: 'nk', text: `Betriebskostenabrechnung ${jahr - 1} bis 31.12.${jahr} beim Mieter (Frist!)`,
        auto: mietObjekte.every((o) => get(`SELECT 1 FROM abrechnungen WHERE objekt_id = ? AND typ = 'nk' AND substr(von, 1, 4) = ?`, o.id, String(jahr - 1))), ziel: { seite: 'nk' } }] : []),
      ...(mietObjekte.length ? [{ punkt: 'anpassungen', text: `Mieterhöhungen und Indexanpassungen für ${jahr + 1} geprüft`, auto: false, ziel: { seite: 'anpassung' } }] : []),
      ...(wegObjekte.length ? [{ punkt: 'wipl', text: `Wirtschaftsplan ${jahr + 1} beschlossen`,
        auto: wegObjekte.every((o) => get(`SELECT 1 FROM abrechnungen WHERE objekt_id = ? AND typ = 'wipl' AND substr(von, 1, 4) = ?`, o.id, String(jahr + 1))), ziel: { seite: 'wipl', modus: 'weg' } }] : []),
      { punkt: 'versicherungen', text: 'Versicherungen und Verträge mit Kündigungsfrist zum Jahresende geprüft', auto: false, ziel: { seite: 'versicherungen' } },
      ...(n(`SELECT count(*) AS n FROM kautionen WHERE art = 'konto'`) ? [{ punkt: 'kautionszinsen', text: `Zinsen der Kautionskonten für ${jahr} gutgeschrieben`, auto: false, ziel: { seite: 'kaution' } }] : []),
      { punkt: 'steuer', text: `Steuerunterlagen ${jahr} für den Steuerberater erstellt`, auto: false, ziel: { seite: 'auswertung' } },
      { punkt: 'festschreibung', text: `Jahr ${jahr} festgeschrieben (nach allen Abrechnungen)`, auto: (e.festgeschrieben_bis ?? '') >= ende, ziel: { seite: 'einstellungen' } },
      { punkt: 'sicherung', text: 'Datensicherung angelegt', auto: (e.letzte_sicherung ?? '') >= `${jahr}-12-01`, ziel: { seite: 'einstellungen' } },
    ].map((x) => ({ ...x, erledigt: x.auto || haken.has(x.punkt), manuell: !x.auto && haken.has(x.punkt) }));
    return { jahr, punkte, fertig: punkte.filter((x) => x.erledigt).length, gesamt: punkte.length };
  }

  return {
    jahreswechsel,
    jahreswechselHaken: (jahr, punkt, an) => (an
      ? db.prepare('INSERT OR IGNORE INTO checkliste (liste, punkt) VALUES (?, ?)').run(`jahreswechsel-${jahr}`, punkt)
      : db.prepare('DELETE FROM checkliste WHERE liste = ? AND punkt = ?').run(`jahreswechsel-${jahr}`, punkt)),
    ersteSchritte,
    ersteSchritteAusblenden: () => db.prepare(`INSERT OR IGNORE INTO checkliste (liste, punkt) VALUES ('erste-schritte', 'ausgeblendet')`).run(),
    automatikLauf: lauf,
    hinweise,
    kennzahlen,
    hinweisSetzen: (schluessel, status, tage) => db.prepare(`INSERT INTO hinweis_status (schluessel, status, bis) VALUES (?, ?, ?)
      ON CONFLICT (schluessel) DO UPDATE SET status = excluded.status, bis = excluded.bis`).run(schluessel, status, tage ? plusTage(heute(), tage) : null),
    hinweisZuruecksetzen: (schluessel) => db.prepare('DELETE FROM hinweis_status WHERE schluessel = ?').run(schluessel),
  };
};
