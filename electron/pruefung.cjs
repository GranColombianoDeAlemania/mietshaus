// Data check report: completeness and plausibility of master data, postings, statements and documents.
// Every point has a stable key so it can be hidden; texts are plain German with the reason and what to do.
const { tageZwischen, monatsliste } = require('./buchhaltung.cjs');
const ortszeit = require('./zeit.cjs');

const heute = () => ortszeit.heute();
const plusTage = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const euro = (ct) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format((ct ?? 0) / 100);
const datumDe = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '');
const monatDe = (m) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

module.exports = function pruefung({ all, get, PERSON_NAME, bh, aw, einstellungen }) {
  function pruefbericht({ alle = false } = {}) {
    const punkte = [];
    let geprueft = 0;
    const t = heute();
    const e = einstellungen();
    const add = (bereich, schluessel, stufe, text, x = {}) => punkte.push({ bereich, schluessel, stufe, text, ...x });
    const pruefe = (fn) => { geprueft++; fn(); };
    const objekte = all('SELECT * FROM objekte ORDER BY bezeichnung');
    const vertragTab = (typ) => (typ === 'weg' ? 'eigentum' : 'mietverhaeltnisse');

    // ---------- master data ----------
    pruefe(() => {
      if (!e.verwalter_name || !e.verwalter_strasse) add('Stammdaten', 'verwalter', 'warnung', 'Deine Absenderdaten sind unvollständig – sie stehen auf allen Briefen und Abrechnungen.', { ziel: { seite: 'einstellungen' } });
    });
    for (const o of objekte) {
      const ziel = { seite: 'objekte' };
      const links = [{ text: o.bezeichnung, ziel: { objekt: o.id } }];
      pruefe(() => { if (!o.strasse || !o.plz || !o.ort) add('Stammdaten', `adresse:${o.id}`, 'warnung', `${o.bezeichnung}: Die Anschrift ist unvollständig.`, { links, ziel, hilfe: 'Wird für Briefe, Wohnungsgeberbestätigung und Abrechnungen gebraucht.' }); });
      pruefe(() => { if (!o.iban) add('Stammdaten', `iban:${o.id}`, 'info', `${o.bezeichnung}: Keine IBAN für das Objektkonto hinterlegt.`, { links, ziel, hilfe: 'Steht auf Briefen und wird für SEPA-Lastschriften und Überweisungen gebraucht.' }); });
      const einheiten = all('SELECT * FROM einheiten WHERE objekt_id = ? ORDER BY nr', o.id);
      pruefe(() => {
        if (!einheiten.length) add('Stammdaten', `einheiten:${o.id}`, 'warnung', `${o.bezeichnung}: Noch keine Einheiten angelegt.`, { links, ziel: { seite: 'einheiten', objektId: o.id } });
      });
      pruefe(() => {
        for (const x of einheiten.filter((x) => !(x.wohnflaeche > 0) && !['Garage', 'Stellplatz', 'Keller'].includes(x.art))) {
          add('Stammdaten', `flaeche:${x.id}`, 'fehler', `${o.bezeichnung}, ${x.bezeichnung}: Keine Wohnfläche – Kosten nach Fläche werden dort mit 0 verteilt.`,
            { links: [{ text: x.bezeichnung, ziel: { einheit: x.id } }] });
        }
      });
      if (o.art !== 'miete') {
        pruefe(() => {
          for (const x of einheiten.filter((x) => !(x.mea > 0))) add('Stammdaten', `mea:${x.id}`, 'fehler', `${o.bezeichnung}, ${x.bezeichnung}: Keine Miteigentumsanteile – das Hausgeld nach MEA wird dort mit 0 verteilt.`,
            { links: [{ text: x.bezeichnung, ziel: { einheit: x.id } }] });
        });
        pruefe(() => {
          const summe = einheiten.reduce((s, x) => s + (x.mea ?? 0), 0);
          if (summe > 0 && ![1000, 10000, 100000].includes(Math.round(summe))) add('Stammdaten', `measumme:${o.id}:${Math.round(summe)}`, 'info',
            `${o.bezeichnung}: Die Miteigentumsanteile ergeben zusammen ${summe.toLocaleString('de-DE')}.`, { links, hilfe: 'Üblich sind 1.000 oder 10.000 – bitte mit der Teilungserklärung vergleichen.' });
        });
      }
      // Overlapping contracts in the same unit.
      for (const typ of ['miete', 'weg']) {
        pruefe(() => {
          const ueber = all(`SELECT a.id AS a_id, b.id AS b_id, e.bezeichnung, e.id AS einheit_id FROM ${vertragTab(typ)} a JOIN ${vertragTab(typ)} b ON b.einheit_id = a.einheit_id AND b.id > a.id
            JOIN einheiten e ON e.id = a.einheit_id
            WHERE e.objekt_id = ? AND a.beginn <= coalesce(nullif(b.ende, ''), '9999-12-31') AND b.beginn <= coalesce(nullif(a.ende, ''), '9999-12-31')`, o.id);
          for (const u of ueber) add('Verträge', `ueberlappung:${typ}:${u.a_id}:${u.b_id}`, typ === 'miete' ? 'fehler' : 'warnung',
            `${o.bezeichnung}, ${u.bezeichnung}: Zwei ${typ === 'miete' ? 'Mietverhältnisse' : 'Eigentumsverhältnisse'} überschneiden sich zeitlich.`,
            { links: [{ text: u.bezeichnung, ziel: { einheit: u.einheit_id } }], hilfe: typ === 'miete' ? 'Beim alten Vertrag das Ende eintragen (der Tag vor dem Einzug des Nachmieters). Mehrere Mieter einer Wohnung gehören in einen Vertrag („Weiterer Mieter“).'
              : 'Bei mehreren Eigentümern einer Einheit den zweiten als „Weiterer Eigentümer“ im selben Vertrag eintragen; bei Verkauf beim alten Eigentümer das Ende setzen.' });
        });
      }
    }
    // Self-use periods: no tenancy at the same time, no overlaps, a household size for per-person keys.
    pruefe(() => {
      const zeit = (a, b) => (b ? `${datumDe(a)} – ${datumDe(b)}` : `ab ${datumDe(a)}`);
      for (const x of all(`SELECT s.*, e.bezeichnung AS einheit, e.objekt_id, o.bezeichnung AS objekt, m.id AS vertrag_id, m.beginn AS m_beginn, m.ende AS m_ende, ${PERSON_NAME} AS name
          FROM selbstnutzung s JOIN einheiten e ON e.id = s.einheit_id JOIN objekte o ON o.id = e.objekt_id
          JOIN mietverhaeltnisse m ON m.einheit_id = s.einheit_id JOIN personen p ON p.id = m.person_id
          WHERE s.beginn <= coalesce(nullif(m.ende, ''), '9999-12-31') AND m.beginn <= coalesce(nullif(s.ende, ''), '9999-12-31')`)) {
        add('Verträge', `selbstmiete:${x.id}:${x.vertrag_id}`, 'fehler', `${x.objekt}, ${x.einheit}: Die Selbstnutzung (${zeit(x.beginn, x.ende)}) überschneidet sich mit dem Mietverhältnis ${x.name} (${zeit(x.m_beginn, x.m_ende)}).`,
          { links: [{ text: x.einheit, ziel: { einheit: x.einheit_id } }, { text: x.name, ziel: { vertrag: x.vertrag_id, typ: 'miete' } }],
            hilfe: 'Eine Einheit ist entweder vermietet oder selbst genutzt. Ende der Selbstnutzung bzw. Beginn des Mietverhältnisses anpassen – sonst stimmen Betriebskostenabrechnung und Anlage V nicht.' });
      }
      for (const x of all(`SELECT a.id AS a_id, b.id AS b_id, e.id AS einheit_id, e.bezeichnung AS einheit, o.bezeichnung AS objekt FROM selbstnutzung a
          JOIN selbstnutzung b ON b.einheit_id = a.einheit_id AND b.id > a.id JOIN einheiten e ON e.id = a.einheit_id JOIN objekte o ON o.id = e.objekt_id
          WHERE a.beginn <= coalesce(nullif(b.ende, ''), '9999-12-31') AND b.beginn <= coalesce(nullif(a.ende, ''), '9999-12-31')`)) {
        add('Verträge', `selbstdoppelt:${x.a_id}:${x.b_id}`, 'warnung', `${x.objekt}, ${x.einheit}: Zwei Zeiträume der Selbstnutzung überschneiden sich.`,
          { links: [{ text: x.einheit, ziel: { einheit: x.einheit_id } }], hilfe: 'Die Zeiträume zusammenfassen oder beim früheren ein Ende eintragen.' });
      }
      for (const x of all(`SELECT s.*, e.bezeichnung AS einheit, o.bezeichnung AS objekt FROM selbstnutzung s JOIN einheiten e ON e.id = s.einheit_id
          JOIN objekte o ON o.id = e.objekt_id WHERE s.ende IS NOT NULL AND s.ende <> '' AND s.ende < s.beginn`)) {
        add('Verträge', `selbstende:${x.id}`, 'fehler', `${x.objekt}, ${x.einheit}: Das Ende der Selbstnutzung liegt vor dem Beginn.`, { links: [{ text: x.einheit, ziel: { einheit: x.einheit_id } }] });
      }
      for (const x of all(`SELECT s.*, e.bezeichnung AS einheit, e.objekt_id, o.bezeichnung AS objekt FROM selbstnutzung s JOIN einheiten e ON e.id = s.einheit_id
          JOIN objekte o ON o.id = e.objekt_id WHERE NOT (s.personen > 0) AND (s.ende IS NULL OR s.ende = '' OR s.ende >= ?)`, t)) {
        if (get(`SELECT 1 FROM konten k JOIN umlageschluessel u ON u.id = k.schluessel_id WHERE k.objekt_id = ? AND k.umlagefaehig = 1 AND u.typ = 'personen'`, x.objekt_id))
          add('Verträge', `selbstpersonen:${x.id}`, 'warnung', `${x.objekt}, ${x.einheit}: Für die Selbstnutzung ist keine Haushaltsgröße eingetragen – nach Personen verteilte Kosten tragen dann allein die Mieter.`,
            { links: [{ text: x.einheit, ziel: { einheit: x.einheit_id } }] });
      }
    });
    pruefe(() => {
      for (const typ of ['miete', 'weg']) {
        for (const v of all(`SELECT v.id, v.beginn, v.ende, e.bezeichnung AS einheit, ${PERSON_NAME} AS name FROM ${vertragTab(typ)} v JOIN einheiten e ON e.id = v.einheit_id
            JOIN personen p ON p.id = v.person_id WHERE v.ende IS NOT NULL AND v.ende <> '' AND v.ende < v.beginn`)) {
          add('Verträge', `endevorbeginn:${typ}:${v.id}`, 'fehler', `${v.name} (${v.einheit}): Das Vertragsende liegt vor dem Beginn.`, { links: [{ text: v.name, ziel: { vertrag: v.id, typ } }] });
        }
      }
    });
    const laufendeMiete = all(`SELECT m.*, e.bezeichnung AS einheit, e.objekt_id, ${PERSON_NAME} AS name FROM mietverhaeltnisse m JOIN einheiten e ON e.id = m.einheit_id
      JOIN personen p ON p.id = m.person_id WHERE m.beginn <= ?1 AND (m.ende IS NULL OR m.ende = '' OR m.ende >= ?1)`, t);
    for (const v of laufendeMiete) {
      const links = [{ text: v.name, ziel: { vertrag: v.id, typ: 'miete' } }];
      pruefe(() => { if (!(v.kaltmiete_ct > 0)) add('Verträge', `kalt0:${v.id}`, 'warnung', `${v.name} (${v.einheit}): Keine Kaltmiete eingetragen.`, { links }); });
      pruefe(() => {
        if (v.lastschrift && (!v.sepa_mandat || !get('SELECT iban FROM personen WHERE id = ?', v.person_id)?.iban))
          add('Verträge', `mandat:${v.id}`, 'warnung', `${v.name}: Zahlt per Lastschrift, aber IBAN oder Mandatsreferenz fehlt.`, { links });
      });
      pruefe(() => {
        const personenKey = get(`SELECT 1 FROM konten k JOIN umlageschluessel s ON s.id = k.schluessel_id WHERE k.objekt_id = ? AND k.umlagefaehig = 1 AND s.typ = 'personen'`, v.objekt_id);
        if (personenKey && !(v.personen_anzahl > 0)) add('Verträge', `personen:${v.id}`, 'warnung', `${v.name}: Keine Personenzahl – nach Personen verteilte Kosten (z. B. Wasser) fallen dort mit 0 an.`, { links });
      });
      pruefe(() => {
        if (get(`SELECT 1 FROM eigentum g WHERE g.einheit_id = ? AND g.selbstnutzer = 1 AND g.beginn <= ?2 AND (g.ende IS NULL OR g.ende = '' OR g.ende >= ?2)`, v.einheit_id, t))
          add('Verträge', `selbst:${v.id}`, 'warnung', `${v.einheit}: Als vom Eigentümer selbst genutzt markiert, hat aber auch ein laufendes Mietverhältnis (${v.name}).`, { links });
      });
    }
    // People: likely duplicates and owners without an address.
    pruefe(() => {
      const gruppen = all(`SELECT lower(trim(coalesce(vorname, ''))) || '|' || lower(trim(coalesce(nachname, ''))) || '|' || lower(trim(coalesce(firma, ''))) AS k, group_concat(id) AS ids, count(*) AS n
        FROM personen GROUP BY k HAVING n > 1`);
      for (const g of gruppen) {
        const ids = g.ids.split(',').map(Number);
        const p = get(`SELECT ${PERSON_NAME} AS name FROM personen p WHERE p.id = ?`, ids[0]);
        add('Adressbuch', `doppelt:${g.ids}`, 'warnung', `${p.name} steht ${g.n}-mal im Adressbuch.`, { links: [{ text: p.name, ziel: { person: ids[0] } }],
          hilfe: 'Doppelte Einträge zusammenführen: Verträge und Dokumente auf einen Eintrag umhängen, den anderen löschen.' });
      }
    });
    pruefe(() => {
      for (const g of all(`SELECT DISTINCT p.id, ${PERSON_NAME} AS name FROM eigentum g JOIN personen p ON p.id = g.person_id
          WHERE g.selbstnutzer = 0 AND (g.ende IS NULL OR g.ende = '' OR g.ende >= ?) AND (p.strasse IS NULL OR p.strasse = '' OR p.plz IS NULL OR p.plz = '')`, t)) {
        add('Adressbuch', `adresse:${g.id}`, 'warnung', `${g.name}: Eigentümer ohne eigene Anschrift – Einladungen und Abrechnungen können nicht adressiert werden.`, { links: [{ text: g.name, ziel: { person: g.id } }] });
      }
    });

    // ---------- bookkeeping ----------
    const autoAb = e.auto_soll_ab;
    for (const o of objekte) {
      pruefe(() => {
        // Months without charges for running contracts (from the start of automatic charging, or the contract start).
        for (const typ of ['miete', 'weg']) {
          for (const v of all(`SELECT v.*, e.bezeichnung AS einheit, ${PERSON_NAME} AS name FROM ${vertragTab(typ)} v JOIN einheiten e ON e.id = v.einheit_id
              JOIN personen p ON p.id = v.person_id WHERE e.objekt_id = ? AND v.beginn <= ?`, o.id, t)) {
            const k = bh.kontoVon(typ, v.id);
            if (!k) continue;
            const ab = [v.beginn.slice(0, 7), autoAb ?? t.slice(0, 7)].sort().at(-1);
            const bis = [(v.ende || '9999-12').slice(0, 7), t.slice(0, 7)].sort()[0];
            if (ab > bis) continue;
            const vorhanden = new Set(all(`SELECT DISTINCT monat FROM buchungen WHERE soll_id = ? AND art = 'soll' AND monat IS NOT NULL`, k.id).map((x) => x.monat));
            const fehlend = monatsliste(ab, bis).filter((m) => !vorhanden.has(m) && bh.periode(v, m));
            if (fehlend.length) add('Buchhaltung', `soll:${typ}:${v.id}:${fehlend.at(-1)}`, 'warnung',
              `${v.name} (${v.einheit}): Für ${fehlend.length > 3 ? `${fehlend.length} Monate (${monatDe(fehlend[0])} bis ${monatDe(fehlend.at(-1))})` : fehlend.map(monatDe).join(', ')} fehlen die monatlichen Forderungen.`,
              { links: [{ text: v.name, ziel: { vertrag: v.id, typ } }], ziel: { seite: 'soll', objektId: o.id, modus: typ }, hilfe: 'Unter „Sollstellung“ erzeugen – sonst fehlen diese Monate in offenen Posten und Abrechnungen.' });
            // Charges that no longer match the contract (amounts or start/end changed after they were booked).
            const abw = bh.sollAbgleich(typ, v.id).aenderungen.filter((a) => !a.manuell);
            if (abw.length) add('Buchhaltung', `sollabw:${typ}:${v.id}:${abw.map((a) => `${a.monat}=${a.neu_ct}`).join(',')}`, 'warnung',
              `${v.name} (${v.einheit}): Die gebuchten Forderungen für ${abw.length > 3 ? `${abw.length} Monate` : abw.map((a) => monatDe(a.monat)).join(', ')} passen nicht zum Vertrag `
                + `(z. B. ${monatDe(abw[0].monat)}: gebucht ${euro(abw[0].alt_ct)}, laut Vertrag ${euro(abw[0].neu_ct)}).`,
              { links: [{ text: v.name, ziel: { vertrag: v.id, typ } }], ziel: { vertrag: v.id, typ }, hilfe: 'Auf der Vertragsseite mit „Forderungen prüfen“ neu buchen – oder Vertrag und Mietanpassungen prüfen.' });
          }
        }
      });
      pruefe(() => {
        // A month charged twice on a change in mid-month (both contracts pay it in full).
        for (const typ of ['miete', 'weg']) {
          const vs = all(`SELECT v.*, e.bezeichnung AS einheit, ${PERSON_NAME} AS name FROM ${vertragTab(typ)} v JOIN einheiten e ON e.id = v.einheit_id
            JOIN personen p ON p.id = v.person_id WHERE e.objekt_id = ? ORDER BY v.einheit_id, v.beginn`, o.id);
          for (let i = 1; i < vs.length; i++) {
            const [alt, neu] = [vs[i - 1], vs[i]];
            if (alt.einheit_id !== neu.einheit_id || !alt.ende) continue;
            const d = bh.doppelteMiete(alt, neu);
            if (d) add('Buchhaltung', `doppelmonat:${typ}:${alt.id}:${neu.id}`, 'warnung',
              `${neu.einheit}: ${datumDe(d.von)} bis ${datumDe(d.bis)} wird doppelt gefordert – von ${alt.name} (Auszug ${datumDe(alt.ende)}, voller Monat) und von ${neu.name} (Einzug ${datumDe(neu.beginn)}).`,
              { links: [{ text: alt.name, ziel: { vertrag: alt.id, typ } }, { text: neu.name, ziel: { vertrag: neu.id, typ } }], ziel: { vertrag: neu.id, typ },
                hilfe: typ === 'weg' ? 'Beim neuen Eigentümer „erst ab dem Folgemonat“ wählen – oder es ist so vereinbart.' : 'Beim neuen Mieter „erst ab dem Folgemonat“ wählen – oder es ist so vereinbart.' });
          }
        }
        // A flat fee for operating costs without an amount.
        for (const v of all(`SELECT m.*, e.bezeichnung AS einheit, ${PERSON_NAME} AS name FROM mietverhaeltnisse m JOIN einheiten e ON e.id = m.einheit_id
            JOIN personen p ON p.id = m.person_id WHERE e.objekt_id = ? AND m.bk_art = 'pauschale' AND (m.ende IS NULL OR m.ende = '' OR m.ende >= ?)`, o.id, t)) {
          if (!(bh.betraege('miete', v.id, t).bk_vz_ct > 0)) add('Buchhaltung', `pauschale0:${v.id}`, 'warnung', `${v.name} (${v.einheit}): Betriebskosten als Pauschale vereinbart, aber ohne Betrag.`,
            { links: [{ text: v.name, ziel: { vertrag: v.id, typ: 'miete' } }], ziel: { vertrag: v.id, typ: 'miete' }, hilfe: 'Im Vertrag den Betrag der Pauschale eintragen – oder „in der Kaltmiete enthalten“ wählen.' });
        }
      });
      pruefe(() => {
        for (const k of all(`SELECT * FROM konten WHERE objekt_id = ? AND klasse = 'geld'`, o.id)) {
          const s = bh.saldoBis(k.id, t);
          if (s < 0) add('Buchhaltung', `geldminus:${k.id}`, 'warnung', `${o.bezeichnung}, ${k.bezeichnung}: Der Saldo ist negativ (${euro(s)}).`,
            { links: [{ text: k.bezeichnung, ziel: { konto: k.id } }], hilfe: 'Meist fehlt eine Einnahme oder ein Anfangsbestand – bitte mit dem Kontoauszug abgleichen.' });
        }
      });
      pruefe(() => {
        const letzte = get(`SELECT max(b.datum) AS d FROM buchungen b JOIN konten k ON k.id IN (b.soll_id, b.haben_id) WHERE k.objekt_id = ? AND k.klasse = 'geld' AND b.art = 'bank'`, o.id).d;
        const vertraege = get(`SELECT count(*) AS n FROM mietverhaeltnisse m JOIN einheiten x ON x.id = m.einheit_id WHERE x.objekt_id = ?`, o.id).n +
          get(`SELECT count(*) AS n FROM eigentum g JOIN einheiten x ON x.id = g.einheit_id WHERE x.objekt_id = ?`, o.id).n;
        if (vertraege && (!letzte || letzte < plusTage(t, -45))) add('Buchhaltung', `bank:${o.id}:${t.slice(0, 7)}`, 'info',
          `${o.bezeichnung}: ${letzte ? `Letzter importierter Kontoumsatz vom ${datumDe(letzte)}` : 'Noch kein Kontoauszug importiert'} – Zahlungseingänge fehlen sonst in den offenen Posten.`,
          { links: [{ text: o.bezeichnung, ziel: { objekt: o.id } }], ziel: { seite: 'bank', objektId: o.id } });
      });
      pruefe(() => {
        for (const k of all(`SELECT k.* FROM konten k WHERE k.objekt_id = ? AND k.klasse = 'person'`, o.id)) {
          const op = bh.offenePostenKonto(k.id, t);
          if (op.guthaben_ct > 0) add('Buchhaltung', `guthaben:${k.id}:${op.guthaben_ct}`, 'info', `${k.bezeichnung}: Guthaben von ${euro(op.guthaben_ct)} (Überzahlung).`,
            { links: [{ text: k.bezeichnung, ziel: k.vertrag_id ? { vertrag: k.vertrag_id, typ: k.vertrag_typ } : { konto: k.id } }], hilfe: 'Mit der nächsten Forderung verrechnen oder zurückzahlen.' });
        }
      });
      pruefe(() => {
        for (const k of all(`SELECT k.*, (SELECT count(*) FROM buchungen b WHERE (b.soll_id = k.id OR b.haben_id = k.id) AND b.datum >= ?2) AS n
            FROM konten k WHERE k.objekt_id = ?1 AND k.inaktiv = 1`, o.id, `${Number(t.slice(0, 4)) - 1}-01-01`).filter((k) => k.n)) {
          add('Buchhaltung', `inaktiv:${k.id}`, 'info', `${k.bezeichnung}: Konto ist inaktiv, hat aber Buchungen seit ${Number(t.slice(0, 4)) - 1}.`, { links: [{ text: k.bezeichnung, ziel: { konto: k.id } }] });
        }
      });
      // Allocation keys with values that cannot work.
      pruefe(() => {
        for (const s of all(`SELECT * FROM umlageschluessel WHERE objekt_id = ? AND typ = 'manuell'`, o.id)) {
          const benutzt = get('SELECT 1 FROM konten WHERE schluessel_id = ?1 OR weg_schluessel_id = ?1', s.id);
          const summe = get('SELECT coalesce(sum(wert), 0) AS s FROM schluesselwerte WHERE schluessel_id = ?', s.id).s;
          if (benutzt && !summe) add('Abrechnung', `schluessel0:${s.id}`, 'fehler', `${o.bezeichnung}: Der manuelle Schlüssel „${s.bezeichnung}“ hat keine Werte, wird aber von Kostenkonten benutzt.`,
            { ziel: { seite: 'schluessel', objektId: o.id } });
        }
      });
      // Meter readings at the end of last year for consumption-based keys.
      pruefe(() => {
        const arten = all(`SELECT DISTINCT zaehler_art FROM umlageschluessel WHERE objekt_id = ? AND typ = 'zaehler'`, o.id).map((x) => x.zaehler_art);
        if (!arten.length) return;
        const stichtag = `${Number(t.slice(0, 4)) - 1}-12-31`;
        for (const z of all(`SELECT z.*, x.bezeichnung AS einheit FROM zaehler z LEFT JOIN einheiten x ON x.id = z.einheit_id WHERE z.objekt_id = ? AND z.art IN (${arten.map(() => '?').join(',')})
            AND (z.ausbau IS NULL OR z.ausbau = '' OR z.ausbau > ?) AND (z.einbau IS NULL OR z.einbau = '' OR z.einbau <= ?)`, o.id, ...arten, stichtag, stichtag)) {
          if (!get(`SELECT 1 FROM zaehlerstaende WHERE zaehler_id = ? AND abs(julianday(datum) - julianday(?)) <= 14`, z.id, stichtag))
            add('Abrechnung', `ablesung:${z.id}:${stichtag}`, 'warnung', `${o.bezeichnung}: Zähler ${z.nummer ?? z.art}${z.einheit ? ` (${z.einheit})` : ''} hat keinen Stand zum ${datumDe(stichtag)}.`,
              { ziel: { seite: 'zaehler', objektId: o.id }, hilfe: 'Ohne Jahresablesung wird der Verbrauch geschätzt.' });
        }
      });
      pruefe(() => {
        if (get(`SELECT 1 FROM konten k WHERE k.objekt_id = ? AND k.heizkosten = 1 AND EXISTS (SELECT 1 FROM buchungen b WHERE b.soll_id = k.id)`, o.id) &&
          !get(`SELECT 1 FROM zaehler WHERE objekt_id = ? AND art IN ('waerme', 'heizkostenverteiler')`, o.id))
          add('Abrechnung', `heizzaehler:${o.id}`, 'info', `${o.bezeichnung}: Es gibt Heizkosten, aber keine Wärmezähler oder Heizkostenverteiler.`,
            { hilfe: 'Rechnet ein Messdienst ab (ista, Techem …), in der Betriebskostenabrechnung „Messdienst“ wählen. Sonst Zähler anlegen – ohne Verbrauchserfassung dürfen Mieter um 15 % kürzen.' });
      });
      // Purchase data for depreciation and yield.
      pruefe(() => {
        if (o.art !== 'weg' && (!o.kaufpreis_ct || !o.kaufdatum || !o.gebaeudeanteil)) add('Steuer', `kauf:${o.id}`, 'info',
          `${o.bezeichnung}: Kaufpreis, Kaufdatum oder Gebäudeanteil fehlen – ohne sie gibt es keine AfA in der Anlage V und keine Rendite.`, { links: [{ text: o.bezeichnung, ziel: { objekt: o.id } }], ziel: { seite: 'objekte' } });
      });
    }
    pruefe(() => {
      const fest = e.festgeschrieben_bis ?? '';
      const vorjahr = `${Number(t.slice(0, 4)) - 1}-12-31`;
      if (t.slice(5, 7) >= '07' && fest < vorjahr && get(`SELECT 1 FROM buchungen WHERE datum <= ?`, vorjahr))
        add('Buchhaltung', `festschreibung:${vorjahr}`, 'info', `Das Jahr ${vorjahr.slice(0, 4)} ist noch nicht festgeschrieben.`,
          { ziel: { seite: 'einstellungen' }, hilfe: 'Nach Abschluss von Abrechnungen und Steuer festschreiben (GoBD): Danach sind Buchungen nur noch per Storno änderbar.' });
    });

    // ---------- documents ----------
    pruefe(() => {
      for (const d of all(`SELECT d.id, d.titel, d.absender, d.betrag_ct, d.datum, d.erfasst FROM dokumente d WHERE d.typ = 'Rechnung' AND d.buchung_id IS NULL AND d.status <> 'postfach'
          AND coalesce(d.datum, d.erfasst) < ?`, plusTage(t, -30))) {
        add('Dokumente', `rechnung:${d.id}`, 'warnung', `Rechnung ${d.absender ?? d.titel}${d.betrag_ct ? ` über ${euro(d.betrag_ct)}` : ''} vom ${datumDe(d.datum ?? d.erfasst)} ist noch nicht gebucht.`,
          { links: [{ text: `Rechnung ${d.absender ?? d.titel}`, ziel: { dokument: d.id } }] });
      }
    });
    pruefe(() => {
      const n = get(`SELECT count(*) AS n FROM dokumente WHERE status = 'postfach' AND erfasst < ?`, plusTage(t, -14)).n;
      if (n) add('Dokumente', `postfach:${t.slice(0, 7)}`, 'info', `${n} Dokument(e) liegen seit mehr als zwei Wochen im Postfach.`, { ziel: { seite: 'postfach' } });
    });
    pruefe(() => {
      for (const d of all(`SELECT d.id, d.titel FROM dokumente d WHERE d.typ = 'Rechnung' AND d.rechnungsnr IS NOT NULL AND EXISTS (SELECT 1 FROM dokumente x WHERE x.id < d.id
          AND x.rechnungsnr = d.rechnungsnr AND coalesce(x.betrag_ct, -1) = coalesce(d.betrag_ct, -1) AND coalesce(x.absender, '') = coalesce(d.absender, ''))`)) {
        add('Dokumente', `duplikat:${d.id}`, 'warnung', `„${d.titel}“ ist vermutlich doppelt abgelegt (gleiche Rechnungsnummer, gleicher Betrag).`, { links: [{ text: `„${d.titel}“`, ziel: { dokument: d.id } }] });
      }
    });
    pruefe(() => {
      const n = get(`SELECT count(*) AS n FROM dokumente WHERE analyse LIKE 'fehler%'`).n;
      if (n) add('Dokumente', `lesefehler:${n}`, 'info', `${n} Dokument(e) konnten nicht gelesen werden – Text und Felder bitte von Hand prüfen.`, { ziel: { seite: 'archiv' } });
    });
    pruefe(() => {
      const n = get(`SELECT count(*) AS n FROM dokumente WHERE status = 'abgelegt' AND objekt_id IS NULL AND projekt_id IS NULL AND person_id IS NULL`).n;
      if (n) add('Dokumente', `ohnezuordnung:${n}`, 'info', `${n} abgelegte(s) Dokument(e) sind keinem Haus, keiner Person und keinem Projekt zugeordnet.`, { ziel: { seite: 'archiv' } });
    });

    // ---------- tax ----------
    pruefe(() => {
      for (const w of aw.anschaffungsnah()) {
        if (w.anteil >= 0.8) add('Steuer', `15prozent:${w.objekt_id}`, w.anteil >= 1 ? 'fehler' : 'warnung',
          `${w.objekt}: Renovierungskosten in den ersten drei Jahren nach dem Kauf erreichen ${Math.round(w.anteil * 100)} % der 15-%-Grenze (${euro(w.summe_netto_ct)} von ${euro(w.grenze_ct)} netto).`,
          { links: [{ text: w.objekt, ziel: { objekt: w.objekt_id } }], ziel: { seite: 'auswertung', objektId: w.objekt_id },
            hilfe: `Über der Grenze werden die Kosten zu anschaffungsnahen Herstellungskosten und sind nur über die AfA absetzbar (§ 6 Abs. 1 Nr. 1a EStG). Frist bis ${datumDe(w.frist)}.` });
      }
    });

    const status = Object.fromEntries(all(`SELECT * FROM hinweis_status WHERE schluessel LIKE 'pruef:%'`).map((s) => [s.schluessel.slice(6), s]));
    const ordnung = { fehler: 0, warnung: 1, info: 2 };
    const liste = punkte.map((x) => ({ ...x, ausgeblendet: !!status[x.schluessel] }))
      .filter((x) => alle || !x.ausgeblendet)
      .sort((a, b) => ordnung[a.stufe] - ordnung[b.stufe]);
    return { geprueft, punkte: liste };
  }

  return { pruefbericht };
};
