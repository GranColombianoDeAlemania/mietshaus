// MCP server for Claude Desktop: lets Claude work through the document inbox and file the results
// in Hausverwalter. Started by Claude Desktop as: Hausverwalter (ELECTRON_RUN_AS_NODE=1) electron/mcp.cjs
// Talks JSON-RPC over stdin/stdout, so nothing else may be printed to stdout.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const z = require('zod');
const { open, api } = require('./db.cjs');

// Same locations Electron uses for the app's userData folder.
const userData = process.env.HAUSVERWALTER_DATEN || (process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'Hausverwalter')
  : process.platform === 'win32' ? path.join(process.env.APPDATA ?? os.homedir(), 'Hausverwalter')
    : path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'Hausverwalter'));
const dbFile = process.env.HAUSVERWALTER_DB || path.join(userData, 'hausverwalter.sqlite');
const dokumente = path.join(userData, 'dokumente');

const ANWEISUNGEN = `Hausverwalter ist die Hausverwaltungs-Software des Nutzers (Mietverwaltung und WEG-Verwaltung).
Typischer Auftrag: „Arbeite das Postfach ab“. Vorgehen:
1. postfach_liste aufrufen.
2. Je Dokument dokument_lesen; der erkannte Text ist dabei, bei Scans und Fotos zusätzlich die Seitenbilder.
3. Mit objekte_liste / objekt_details / suchen die passenden Stammdaten finden (Objekt, Einheit, Person, Vertrag).
4. dokument_ablegen mit korrekt bestimmtem Typ, Titel, Datum, Betrag, Absender, Objekt usw. und einer kurzen Zusammenfassung.
5. Je nach Inhalt die Daten ins Programm übernehmen, z. B.:
   - bezahlte Rechnung: rechnung_buchen (Kostenkonto aus konten_liste wählen; Betriebskosten auf das passende umlagefähige Konto nach BetrKV),
   - unbezahlte Rechnung: nur ablegen mit Fälligkeit (sie erscheint dann unter „Rechnungen“ als offen),
   - neuer Mietvertrag: person_anlegen + mietvertrag_anlegen, Kaufvertrag/Eigentümerwechsel: eigentum_anlegen,
   - Zählerablesung: zaehlerstand_erfassen, Termin/Frist: termin_anlegen, Schaden/Anfrage: vorgang_anlegen,\n   - Hausgeldabrechnung einer fremdverwalteten WEG (vermietete Eigentumswohnung): weg_kosten_uebernehmen mit den umlagefähigen Positionen,\n   - Angebot/Auftrag/Rechnung zu einem Projekt (z. B. Sanierung): projekte_liste, dann projekt_posten_anlegen und dokument_ablegen mit projekt_id.
Beträge immer in Euro angeben (z. B. 1232.40). Datumsangaben im Format JJJJ-MM-TT.
Wenn etwas nicht eindeutig ist (z. B. welches Objekt), nicht raten: den Nutzer fragen oder das Dokument im Postfach lassen und den Grund in der Zusammenfassung notieren.
Vor dem Buchen kurz zusammenfassen, was gebucht wird.\nFür „Was steht an?“ / ein Tagesbriefing: hinweise und faelligkeiten abrufen und kurz priorisiert zusammenfassen.`;

const text = (x) => ({ content: [{ type: 'text', text: typeof x === 'string' ? x : JSON.stringify(x, null, 1) }] });
const cent = (eur) => (eur == null ? null : Math.round(Number(eur) * 100));
const eur = (ct) => (ct == null ? null : ct / 100);
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

function starten() {
  if (!fs.existsSync(dbFile)) {
    process.stderr.write(`Hausverwalter-Datenbank nicht gefunden: ${dbFile}. Bitte das Programm einmal starten.\n`);
    process.exit(1);
  }
  const db = api(open(dbFile, 'claude'));
  const server = new McpServer({ name: 'hausverwalter', version: '1.0.0' }, { instructions: ANWEISUNGEN });
  const werkzeug = (name, beschreibung, schema, fn, nurLesen = false) =>
    server.registerTool(name, { description: beschreibung, inputSchema: schema, annotations: { readOnlyHint: nurLesen } }, async (args) => {
      try {
        return await fn(args);
      } catch (e) {
        return { ...text(`Fehler: ${e?.message ?? e}`), isError: true };
      }
    });

  // ---------- reading ----------
  werkzeug('postfach_liste', 'Listet alle Dokumente im Postfach (noch nicht abgelegt) mit den automatisch erkannten Feldern.', {}, () =>
    text(db.dokumentListe({ status: 'postfach' }).map((d) => ({
      id: d.id, titel: d.titel, datei: d.name, typ: d.typ, datum: d.datum, betrag_eur: eur(d.betrag_ct), absender: d.absender,
      objekt: d.objekt, lesestatus: d.analyse, moegliches_duplikat_von: d.duplikat_von,
    }))), true);

  werkzeug('dokument_lesen', 'Liefert ein Dokument mit allen Feldern und dem erkannten Text; bei Scans und Fotos zusätzlich die Seitenbilder.',
    { id: z.number().int(), bilder: z.boolean().optional().describe('Seitenbilder mitsenden (Standard: nur wenn per Texterkennung gelesen)') }, ({ id, bilder }) => {
      const d = db.dokument(id);
      if (!d) throw new Error('Dokument nicht gefunden');
      const { text: inhalt, erechnung, ...felder } = d;
      // E-invoices (ZUGFeRD / XRechnung) carry exact data: sender, number, net, VAT, IBAN, line items.
      const out = [{ type: 'text', text: JSON.stringify({ ...felder, betrag_eur: eur(d.betrag_ct), erechnung: erechnung ? JSON.parse(erechnung) : null, text: (inhalt ?? '').slice(0, 60000) }, null, 1) }];
      if (bilder ?? !!d.ocr) {
        const ext = path.extname(d.datei).toLowerCase();
        const dateien = MIME[ext] ? [path.join(dokumente, d.datei)]
          : fs.existsSync(path.join(dokumente, 'vorschau')) ? fs.readdirSync(path.join(dokumente, 'vorschau'))
            .filter((f) => f.startsWith(path.parse(d.datei).name + '-')).sort().slice(0, 6).map((f) => path.join(dokumente, 'vorschau', f)) : [];
        for (const f of dateien) out.push({ type: 'image', data: fs.readFileSync(f).toString('base64'), mimeType: MIME[path.extname(f).toLowerCase()] ?? 'image/png' });
      }
      return { content: out };
    }, true);

  werkzeug('suchen', 'Durchsucht alles: Dokumente (Volltext), Personen, Objekte, Einheiten, Buchungen.', { begriff: z.string() },
    ({ begriff }) => text(db.suche(begriff)), true);

  werkzeug('archiv_suchen', 'Volltextsuche im Dokumentenarchiv mit Filtern.', {
    begriff: z.string().optional(), objekt_id: z.number().int().optional(), typ: z.string().optional(), jahr: z.number().int().optional(),
  }, (a) => text(db.dokumentListe({ q: a.begriff ?? '', objekt_id: a.objekt_id, typ: a.typ, jahr: a.jahr, limit: 50 })
    .map((d) => ({ id: d.id, titel: d.titel, typ: d.typ, datum: d.datum, betrag_eur: eur(d.betrag_ct), objekt: d.objekt, absender: d.absender, treffer: d.treffer }))), true);

  werkzeug('objekte_liste', 'Alle Objekte (Häuser) mit Art (miete, weg, gemischt) und Anschrift.', {}, () =>
    text([...new Map([...db.objekte('miete'), ...db.objekte('weg')].map((o) => [o.id, o])).values()]
      .map((o) => ({ id: o.id, bezeichnung: o.bezeichnung, art: o.art, anschrift: [o.strasse, o.plz, o.ort].filter(Boolean).join(' '), einheiten: o.anzahl_einheiten }))), true);

  werkzeug('objekt_details', 'Einheiten, Mieter, Eigentümer und Umlageschlüssel eines Objekts.', { objekt_id: z.number().int() }, ({ objekt_id }) => text({
    einheiten: db.einheiten(objekt_id).map((e) => ({ id: e.id, nr: e.nr, bezeichnung: e.bezeichnung, art: e.art, lage: e.lage, flaeche: e.wohnflaeche, mea: e.mea, mieter: e.mieter, eigentuemer: e.eigentuemer,
      selbst_genutzt: !!e.selbstgenutzt })),
    mietverhaeltnisse: db.vertraege('mietverhaeltnisse', objekt_id).map((v) => ({ id: v.id, einheit: v.einheit, einheit_id: v.einheit_id, name: v.name, person_id: v.person_id, beginn: v.beginn, ende: v.ende, aktuell: !!v.aktuell, kaltmiete_eur: eur(v.kaltmiete_ct), bk_vz_eur: eur(v.bk_vz_ct), hk_vz_eur: eur(v.hk_vz_ct),
      betriebskosten: v.bk_art, mietmonat_ab: v.mietmonat_ab === 'einzug' ? 'Einzugstag' : '1. des Monats' })),
    eigentum: db.vertraege('eigentum', objekt_id).map((v) => ({ id: v.id, einheit: v.einheit, einheit_id: v.einheit_id, name: v.name, person_id: v.person_id, beginn: v.beginn, ende: v.ende, aktuell: !!v.aktuell, hausgeld_eur: eur(v.hausgeld_ct) })),
    umlageschluessel: db.schluessel(objekt_id).map((k) => ({ id: k.id, bezeichnung: k.bezeichnung, typ: k.typ })),
    zaehler: db.zaehler(objekt_id).map((z) => ({ id: z.id, art: z.art, nummer: z.nummer, einheit: z.einheit_bez, letzter_stand: z.letzter_stand, am: z.letztes_datum })),
  }), true);

  werkzeug('konten_liste', 'Kontenplan eines Objekts (Geld-, Kosten-, Einnahme- und Personenkonten) mit Merkmalen.', { objekt_id: z.number().int() },
    ({ objekt_id }) => text(db.konten(objekt_id).filter((k) => !k.inaktiv).map((k) => ({ id: k.id, nr: k.nr, bezeichnung: k.bezeichnung, klasse: k.klasse,
      kategorie: k.kategorie, umlagefaehig: !!k.umlagefaehig, heizkosten: !!k.heizkosten, aus_ruecklage: !!k.aus_ruecklage, saldo_eur: eur(k.saldo_ct) }))), true);

  werkzeug('personen_suchen', 'Sucht Personen im Adressbuch nach Name, Firma, E-Mail oder IBAN.', { begriff: z.string() },
    ({ begriff }) => text(db.suche(begriff).personen), true);

  werkzeug('buchungen_liste', 'Buchungen eines Objekts, optional mit Zeitraum und Suchtext.', {
    objekt_id: z.number().int(), von: z.string().optional(), bis: z.string().optional(), suche: z.string().optional(),
  }, (a) => text(db.buchungen(a.objekt_id, { von: a.von, bis: a.bis, suche: a.suche ?? '' }).slice(0, 200)
    .map((b) => ({ id: b.id, datum: b.datum, beleg: b.beleg, text: b.text, betrag_eur: eur(b.betrag_ct), soll: `${b.soll_nr} ${b.soll_bez}`, haben: `${b.haben_nr} ${b.haben_bez}` }))), true);

  werkzeug('offene_posten', 'Rückstände und Guthaben der Mieter und Eigentümer eines Objekts.', { objekt_id: z.number().int() },
    ({ objekt_id }) => text(db.offenePosten(objekt_id).map((r) => ({ konto: r.konto.bezeichnung, saldo_eur: eur(r.summe_ct), offene_posten: r.offen.length }))), true);

  werkzeug('faelligkeiten', 'Was in den nächsten Tagen ansteht: Vorgänge, Termine, Vertragsenden, Versicherungsfristen.', { tage: z.number().int().optional() },
    ({ tage }) => text(db.faelligkeiten(tage ?? 30)), true);

  werkzeug('projekte_liste', 'Alle Projekte (z. B. Sanierungen) mit Status, Objekt, Budget, berechneten Kosten und Prognose.', {}, () =>
    text(db.projektListe().map((p) => ({ id: p.id, titel: p.titel, status: p.status, objekt: p.objekt, budget_eur: eur(p.budget_ct),
      berechnet_eur: eur(p.rechnungen_ct), prognose_eur: eur(p.prognose_ct), fortschritt: p.fortschritt }))), true);

  werkzeug('projekt_details', 'Aufgaben (Zeitplan) und Kostenposten eines Projekts.', { projekt_id: z.number().int() }, ({ projekt_id }) => {
    const p = db.projekt(projekt_id);
    if (!p) throw new Error('Projekt nicht gefunden');
    return text({ ...p, posten: p.posten.map(({ datei, ...x }) => ({ ...x, betrag_eur: eur(x.betrag_ct) })) });
  }, true);

  werkzeug('hinweise', 'Was das Programm gerade für wichtig hält: Rückstände, Fristen (z. B. Betriebskostenabrechnung), fehlende Unterlagen, Chancen wie mögliche Mieterhöhungen. Gut für ein Tagesbriefing.',
    {}, () => text(db.hinweise().map((h) => ({ dringlichkeit: h.stufe, bereich: h.kategorie, objekt: h.objekt, text: h.text }))), true);

  werkzeug('pruefbericht', 'Prüft alle Daten auf Fehler und Lücken (Stammdaten, Verträge, Buchhaltung, Abrechnung, Dokumente, Steuer) und nennt, was zu tun ist.',
    {}, () => text(db.pruefbericht({}).punkte.map((p) => ({ stufe: p.stufe, bereich: p.bereich, text: p.text, hilfe: p.hilfe }))), true);

  // ---------- writing ----------
  werkzeug('dokument_ablegen', 'Setzt die Angaben eines Dokuments und legt es (standardmäßig) aus dem Postfach ins Archiv ab.', {
    id: z.number().int(), typ: z.string().optional().describe(`Einer von: ${db.dokumentTypen().join(', ')}`), titel: z.string().optional(),
    objekt_id: z.number().int().nullable().optional(), einheit_id: z.number().int().nullable().optional(), person_id: z.number().int().nullable().optional(),
    projekt_id: z.number().int().nullable().optional(), datum: z.string().optional(), faellig: z.string().optional(), betrag_eur: z.number().nullable().optional(), absender: z.string().optional(),
    rechnungsnr: z.string().optional(), iban: z.string().optional(), zusammenfassung: z.string().optional(),
    im_postfach_lassen: z.boolean().optional().describe('true, wenn noch etwas unklar ist'),
  }, (a) => {
    const { betrag_eur, im_postfach_lassen, ...rest } = a;
    db.dokumentSpeichern({ ...rest, ...(betrag_eur !== undefined ? { betrag_ct: cent(betrag_eur) } : {}), status: im_postfach_lassen ? 'postfach' : 'abgelegt' });
    return text(`Dokument ${a.id} ${im_postfach_lassen ? 'aktualisiert (bleibt im Postfach)' : 'abgelegt'}.`);
  });

  werkzeug('rechnung_buchen', 'Bucht eine bezahlte Rechnung (Kostenkonto an Geldkonto) bzw. Gutschrift und verknüpft den Beleg mit der Buchung.', {
    dokument_id: z.number().int(), kosten_konto_id: z.number().int(), geld_konto_id: z.number().int().optional(),
    datum: z.string().optional().describe('Zahlungsdatum, Standard: Rechnungsdatum'), betrag_eur: z.number().optional(), text: z.string().optional(),
    vorsteuer_abziehen: z.boolean().optional().describe('Bei Objekten mit umsatzsteuerpflichtiger Vermietung: Umsatzsteuer der E-Rechnung als Vorsteuer buchen (Standard: ja, wenn bekannt)'),
    einheit_id: z.number().int().optional().describe('Wenn die Kosten nur eine Einheit betreffen (z. B. Renovierung einer Wohnung); Standard: Einheit des Dokuments'),
  }, (a) => {
    const d = db.dokument(a.dokument_id);
    if (!d) throw new Error('Dokument nicht gefunden');
    if (!d.objekt_id) throw new Error('Dem Dokument ist noch kein Objekt zugeordnet (dokument_ablegen mit objekt_id).');
    if (d.buchung_id) throw new Error('Dieses Dokument ist bereits gebucht.');
    const geld = a.geld_konto_id ?? db.konten(d.objekt_id, 'geld')[0]?.id;
    const betrag = cent(a.betrag_eur) ?? d.betrag_ct;
    if (!betrag) throw new Error('Kein Betrag bekannt.');
    const gutschrift = d.typ === 'Gutschrift';
    // Input tax: only with an exact VAT amount (e-invoice) and a VAT-able letting in the house; mixed houses deduct their share.
    const vst = db.konten(d.objekt_id).find((k) => k.klasse === 'steuer' && k.kategorie === 'vorsteuer19');
    const quote = db.get('objekte', d.objekt_id)?.vorsteuer_quote ?? 100;
    const abziehbar = vst && d.ust_ct && (a.vorsteuer_abziehen ?? true) && betrag === d.betrag_ct ? Math.round(d.ust_ct * quote / 100) : 0;
    const pos = [{ konto: a.kosten_konto_id, ct: betrag - abziehbar }, ...(abziehbar ? [{ konto: vst.id, ct: abziehbar }] : [])];
    const id = db.buchen({ objekt_id: d.objekt_id, datum: a.datum ?? d.datum, beleg: d.rechnungsnr, text: (a.text ?? [d.absender, d.titel].filter(Boolean).join(' – ')).slice(0, 120),
      einheit_id: a.einheit_id ?? d.einheit_id ?? null,
      positionen: pos.map((p) => (gutschrift ? { soll_id: geld, haben_id: p.konto, betrag_ct: p.ct } : { soll_id: p.konto, haben_id: geld, betrag_ct: p.ct })) });
    db.dokumentSpeichern({ id: d.id, buchung_id: id, status: 'abgelegt' });
    return text(`Gebucht (Buchung ${id})${abziehbar ? `, davon ${(abziehbar / 100).toFixed(2)} € Vorsteuer` : ''}, Beleg verknüpft.`);
  });

  werkzeug('buchen', 'Freie Buchung mit einer oder mehreren Positionen (Soll an Haben).', {
    objekt_id: z.number().int(), datum: z.string(), text: z.string(), beleg: z.string().optional(), dokument_id: z.number().int().optional(),
    einheit_id: z.number().int().optional().describe('Einheit, die die Kosten betreffen (sonst das ganze Haus)'),
    positionen: z.array(z.object({ soll_konto_id: z.number().int(), haben_konto_id: z.number().int(), betrag_eur: z.number(), text: z.string().optional() })),
  }, (a) => {
    const id = db.buchen({ objekt_id: a.objekt_id, datum: a.datum, text: a.text, beleg: a.beleg, einheit_id: a.einheit_id ?? null,
      positionen: a.positionen.map((p) => ({ soll_id: p.soll_konto_id, haben_id: p.haben_konto_id, betrag_ct: cent(p.betrag_eur), text: p.text })) });
    if (a.dokument_id) db.dokumentSpeichern({ id: a.dokument_id, buchung_id: id });
    return text(`Gebucht (Buchung ${id}).`);
  });

  const personFelder = {
    anrede: z.enum(['Herr', 'Frau', 'Divers', 'Firma', 'Eheleute']).optional(), titel: z.string().optional(), vorname: z.string().optional(),
    nachname: z.string().optional(), firma: z.string().optional(), strasse: z.string().optional(), plz: z.string().optional(), ort: z.string().optional(),
    telefon: z.string().optional(), mobil: z.string().optional(), email: z.string().optional(), iban: z.string().optional(), bic: z.string().optional(),
    geburtsdatum: z.string().optional(), notiz: z.string().optional(),
  };
  werkzeug('person_anlegen', 'Legt eine Person im Adressbuch an (vorher mit personen_suchen prüfen, ob es sie schon gibt).', personFelder, (a) => {
    if (!a.nachname && !a.firma) throw new Error('Nachname oder Firma nötig.');
    return text(`Person angelegt, id ${db.save('personen', a)}.`);
  });
  werkzeug('person_aendern', 'Ändert Angaben einer Person (nur die übergebenen Felder).', { id: z.number().int(), ...personFelder },
    (a) => text(`Person ${db.save('personen', a)} aktualisiert.`));

  werkzeug('mietvertrag_anlegen', 'Legt ein Mietverhältnis an. Miete ist immer ein Monatsbetrag: der Ein- und Auszugsmonat wird voll gefordert '
    + '(beim Einzug mitten im Monat wahlweise erst ab dem Folgemonat), nie tageweise. betriebskosten: vorauszahlung (wird abgerechnet), pauschale '
    + '(bk_vz_eur ist dann die Pauschale) oder inklusiv (in der Kaltmiete enthalten). mietmonat_ab einzug: Mietmonat vom Einzugstag bis zum Tag davor im Folgemonat.', {
    einheit_id: z.number().int(), person_id: z.number().int(), person2_id: z.number().int().optional(), beginn: z.string(), ende: z.string().optional(),
    kaltmiete_eur: z.number(), bk_vz_eur: z.number().optional(), hk_vz_eur: z.number().optional(), sonstiges_eur: z.number().optional(),
    kaution_eur: z.number().optional(), personen_anzahl: z.number().optional(), faelligkeitstag: z.number().int().optional(),
    betriebskosten: z.enum(['vorauszahlung', 'pauschale', 'inklusiv']).optional(), mietmonat_ab: z.enum(['erster', 'einzug']).optional(),
    einzugsmonat: z.enum(['voll', 'folgemonat']).optional(), abrechnung_nach: z.enum(['mietmonate', 'wohntage']).optional(),
  }, (a) => text(`Mietverhältnis angelegt, id ${db.save('mietverhaeltnisse', {
    einheit_id: a.einheit_id, person_id: a.person_id, person2_id: a.person2_id, beginn: a.beginn, ende: a.ende,
    kaltmiete_ct: cent(a.kaltmiete_eur), bk_vz_ct: cent(a.bk_vz_eur ?? 0), hk_vz_ct: cent(a.hk_vz_eur ?? 0), sonstiges_ct: cent(a.sonstiges_eur ?? 0),
    kaution_ct: cent(a.kaution_eur ?? 0), personen_anzahl: a.personen_anzahl ?? 1, faelligkeitstag: a.faelligkeitstag ?? 3,
    bk_art: a.betriebskosten ?? 'vorauszahlung', mietmonat_ab: a.mietmonat_ab ?? 'erster', teilmonat_beginn: a.einzugsmonat ?? 'voll', bk_abrechnung: a.abrechnung_nach ?? 'mietmonate' })}.`));

  werkzeug('eigentum_anlegen', 'Legt ein Eigentumsverhältnis (WEG) an.', {
    einheit_id: z.number().int(), person_id: z.number().int(), beginn: z.string(), ende: z.string().optional(),
    hausgeld_eur: z.number().optional(), ruecklage_eur: z.number().optional(), selbstnutzer: z.boolean().optional(),
  }, (a) => text(`Eigentum angelegt, id ${db.save('eigentum', { einheit_id: a.einheit_id, person_id: a.person_id, beginn: a.beginn, ende: a.ende,
    hausgeld_ct: cent(a.hausgeld_eur ?? 0), ruecklage_ct: cent(a.ruecklage_eur ?? 0), selbstnutzer: a.selbstnutzer ? 1 : 0 })}.`));

  werkzeug('vertrag_beenden', 'Trägt das Ende eines Miet- oder Eigentumsverhältnisses ein (z. B. nach Kündigung).', {
    art: z.enum(['miete', 'weg']), vertrag_id: z.number().int(), ende: z.string(),
  }, (a) => text(`Vertrag ${db.save(a.art === 'weg' ? 'eigentum' : 'mietverhaeltnisse', { id: a.vertrag_id, ende: a.ende })} endet am ${a.ende}.`));

  werkzeug('zaehlerstand_erfassen', 'Erfasst einen Zählerstand.', { zaehler_id: z.number().int(), datum: z.string(), stand: z.number() },
    (a) => { db.ablesung(a.datum, { [a.zaehler_id]: a.stand }); return text('Zählerstand gespeichert.'); });

  werkzeug('vorgang_anlegen', 'Legt einen Vorgang an (Schaden, Anfrage, Aufgabe) – optional mit Fälligkeit.', {
    objekt_id: z.number().int().optional(), titel: z.string(), beschreibung: z.string().optional(), faellig: z.string().optional(),
    kategorie: z.string().optional(), person_id: z.number().int().optional(), einheit_id: z.number().int().optional(), prioritaet: z.number().int().min(1).max(3).optional(),
  }, (a) => text(`Vorgang angelegt, id ${db.save('vorgaenge', { ...a, status: 'offen', prioritaet: a.prioritaet ?? 2 })}.`));

  werkzeug('projekt_posten_anlegen', 'Erfasst ein Angebot, einen Auftrag oder eine Rechnung zu einem Projekt, optional mit Verweis auf das Dokument.', {
    projekt_id: z.number().int(), art: z.enum(['angebot', 'auftrag', 'rechnung', 'sonstiges']), titel: z.string(), betrag_eur: z.number(),
    firma: z.string().optional(), datum: z.string().optional(), faellig: z.string().optional(), dokument_id: z.number().int().optional(),
    bezahlt: z.boolean().optional(), aufgabe_id: z.number().int().optional(),
  }, (a) => {
    const id = db.save('projektposten', { projekt_id: a.projekt_id, art: a.art, titel: a.titel, betrag_ct: cent(a.betrag_eur), firma: a.firma, datum: a.datum,
      faellig: a.faellig, dokument_id: a.dokument_id, aufgabe_id: a.aufgabe_id, status: a.bezahlt ? 'bezahlt' : 'offen' });
    if (a.dokument_id) db.dokumentSpeichern({ id: a.dokument_id, projekt_id: a.projekt_id });
    return text(`Posten ${id} im Projekt erfasst.`);
  });

  werkzeug('projekt_aufgabe_anlegen', 'Fügt dem Zeitplan eines Projekts eine Aufgabe hinzu.', {
    projekt_id: z.number().int(), titel: z.string(), beginn: z.string(), ende: z.string(), gewerk: z.string().optional(),
    nach_aufgabe_id: z.number().int().optional(), meilenstein: z.boolean().optional(),
  }, (a) => text(`Aufgabe angelegt, id ${db.save('projektaufgaben', { projekt_id: a.projekt_id, titel: a.titel, beginn: a.beginn, ende: a.meilenstein ? a.beginn : a.ende,
    gewerk: a.gewerk, nach_id: a.nach_aufgabe_id, meilenstein: a.meilenstein ? 1 : 0 })}.`));

  werkzeug('weg_kosten_uebernehmen', 'Für eine vermietete Eigentumswohnung mit fremder WEG-Verwaltung: bucht die umlagefähigen Kostenanteile aus deren Hausgeldabrechnung vom gezahlten Hausgeld auf die passenden Kostenkonten um (Grundlage für die Betriebskostenabrechnung des Mieters).', {
    objekt_id: z.number().int(), jahr: z.number().int(),
    positionen: z.array(z.object({ kosten_konto_id: z.number().int(), betrag_eur: z.number(), text: z.string().optional() })),
  }, (a) => text(`Umgebucht (Buchung ${db.wegKostenUebernehmen(a.objekt_id, `${a.jahr}-12-31`, a.positionen.map((p) => ({ konto_id: p.kosten_konto_id, betrag_ct: cent(p.betrag_eur), text: p.text })),
    `Umlagefähige Kosten aus WEG-Abrechnung ${a.jahr}`)}).`));

  werkzeug('termin_anlegen', 'Legt einen Termin an.', {
    titel: z.string(), datum: z.string(), uhrzeit: z.string().optional(), ort: z.string().optional(), objekt_id: z.number().int().optional(),
    person_id: z.number().int().optional(), notiz: z.string().optional(),
  }, (a) => text(`Termin angelegt, id ${db.save('termine', a)}.`));

  return server.connect(new StdioServerTransport());
}

starten();
