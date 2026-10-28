// Letters and mail merge from templates, document archive, cases and appointments.
import { useEffect, useState } from 'react';
import { alleNamen, anrede, call, datum, euro, fehler, heute, inTagen, personName, type Modus, type Row } from '../api';
import { useLoad } from '../useLoad';
import { useAktion } from '../aktion';
import { Liste } from '../Liste';
import { Dialog, Tabs } from '../ui';
import { FormDialog, type Field } from '../Form';
import { absaetze, absenderAus, alsPdf, brief, esc, empfaengerVon } from '../dokument';
import { L } from '../navi';

export const PLATZHALTER: [string, string][] = [
  ['anrede', 'Briefanrede („Sehr geehrte Frau …,“)'], ['name', 'Vollständiger Name'], ['vorname', 'Vorname'], ['nachname', 'Nachname'],
  ['strasse', 'Straße des Empfängers'], ['plz_ort', 'PLZ und Ort des Empfängers'],
  ['objekt', 'Objektbezeichnung'], ['objekt_anschrift', 'Anschrift des Objekts'], ['einheit', 'Einheit'], ['lage', 'Lage der Einheit'],
  ['flaeche', 'Wohnfläche'], ['beginn', 'Vertrags-/Eigentumsbeginn'], ['ende', 'Vertragsende'],
  ['kaltmiete', 'Kaltmiete'], ['bk_vz', 'BK-Vorauszahlung'], ['hk_vz', 'HK-Vorauszahlung'], ['gesamtmiete', 'Gesamtmiete'],
  ['hausgeld', 'Hausgeld'], ['ruecklage', 'Rücklagenanteil'],
  ['rueckstand', 'Überfälliger Betrag'], ['offene_monate', 'Liste der offenen Monate mit Beträgen'],
  ['kaution', 'Vereinbarte Kaution'], ['kaution_bestand', 'Erfasste Kaution'], ['eigentuemer', 'Eigentümer der Einheit'],
  ['iban_objekt', 'IBAN des Objektkontos'], ['frist_14', 'Datum in 14 Tagen'], ['datum', 'Heutiges Datum'], ['verwalter', 'Name und Anschrift des Verwalters'],
];

const UNTERSCHRIFT_ZEILE = '\n\n\n______________________________\nOrt, Datum, Unterschrift';

const STANDARDVORLAGEN = [
  { titel: 'Wohnungsgeberbestätigung (§ 19 BMG)', kategorie: 'Bescheinigung', betreff: 'Wohnungsgeberbestätigung nach § 19 Bundesmeldegesetz',
    text: 'Hiermit bestätige ich als Wohnungsgeber den Einzug in die folgende Wohnung:\n\nAnschrift der Wohnung: {objekt_anschrift}, {einheit} ({lage})\nArt des meldepflichtigen Vorgangs: Einzug\nDatum des Einzugs: {beginn}\n\nName der meldepflichtigen Person(en): {name}\n\nName und Anschrift des Wohnungsgebers: {verwalter}\nEigentümer der Wohnung (falls nicht der Wohnungsgeber): {eigentuemer}\n\nIch bestätige, dass die oben genannte(n) Person(en) in die angegebene Wohnung tatsächlich eingezogen ist bzw. sind.\n\nHinweis: Es ist verboten, eine Wohnanschrift für eine Anmeldung anzubieten oder zur Verfügung zu stellen, wenn ein tatsächlicher Bezug der Wohnung weder stattfindet noch beabsichtigt ist (§ 19 Abs. 6 BMG). Ein Verstoß ist eine Ordnungswidrigkeit und kann mit einer Geldbuße bis zu 50.000 Euro geahndet werden (§ 54 BMG).' + UNTERSCHRIFT_ZEILE + ' des Wohnungsgebers' },
  { titel: 'Mietbescheinigung', kategorie: 'Bescheinigung', betreff: 'Mietbescheinigung',
    text: 'Hiermit bestätigen wir, dass das Mietverhältnis mit {name} über die Wohnung {einheit} im Objekt {objekt_anschrift} (Wohnfläche {flaeche} m²) seit dem {beginn} besteht.\n\nDie monatliche Miete setzt sich wie folgt zusammen:\nKaltmiete: {kaltmiete}\nBetriebskostenvorauszahlung: {bk_vz}\nHeizkostenvorauszahlung: {hk_vz}\nGesamtmiete: {gesamtmiete}' + UNTERSCHRIFT_ZEILE + ' des Vermieters' },
  { titel: 'Mietschuldenfreiheitsbescheinigung', kategorie: 'Bescheinigung', betreff: 'Mietschuldenfreiheitsbescheinigung',
    text: 'Hiermit bestätigen wir, dass das Mietverhältnis mit {name} über die Wohnung {einheit}, {objekt_anschrift}, seit dem {beginn} besteht. Die monatliche Gesamtmiete beträgt derzeit {gesamtmiete} (Kaltmiete {kaltmiete} zuzüglich Vorauszahlungen).\n\nMit Stand vom {datum} bestehen aus dem Mietverhältnis keine Mietrückstände.\n\nDiese Bescheinigung wird auf Wunsch der Mieterseite ausgestellt.' + UNTERSCHRIFT_ZEILE + ' des Vermieters' },
  { titel: 'Zahlungserinnerung', kategorie: 'Miete', betreff: 'Zahlungserinnerung – {einheit}, {objekt}',
    text: 'sicher ist es Ihrer Aufmerksamkeit entgangen: Für Ihre Wohnung {einheit} sind folgende Zahlungen noch offen:\n\n{offene_monate}\nGesamt: {rueckstand}\n\nBitte überweisen Sie den Betrag bis zum {frist_14} auf unser Konto {iban_objekt}.\n\nSollten Sie inzwischen gezahlt haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.' },
  { titel: 'Abmahnung unpünktliche Mietzahlung', kategorie: 'Miete', betreff: 'Abmahnung wegen unpünktlicher Mietzahlung – {einheit}',
    text: 'die Miete ist nach Ihrem Mietvertrag und § 556b Abs. 1 BGB spätestens bis zum dritten Werktag eines Monats im Voraus zu zahlen. In den folgenden Monaten ist Ihre Zahlung verspätet bei uns eingegangen:\n\n[Monat – Eingang am …]\n[Monat – Eingang am …]\n\nWir mahnen Sie hiermit ab und fordern Sie auf, die Miete künftig pünktlich zu zahlen. Gehen weitere Zahlungen verspätet ein, behalten wir uns vor, das Mietverhältnis fristlos, hilfsweise ordentlich zu kündigen (§ 543 Abs. 1, § 573 Abs. 2 Nr. 1 BGB).' },
  { titel: 'Abmahnung Verstoß gegen die Hausordnung', kategorie: 'Miete', betreff: 'Abmahnung – {einheit}, {objekt}',
    text: 'wir haben festgestellt bzw. es wurde uns mitgeteilt, dass [Beschreibung des Verhaltens mit Datum und Uhrzeit].\n\nDieses Verhalten verstößt gegen [§ … Ihres Mietvertrags / Nr. … der Hausordnung].\n\nWir mahnen Sie hiermit ab und fordern Sie auf, dies künftig zu unterlassen. Im Wiederholungsfall behalten wir uns weitere rechtliche Schritte bis hin zur Kündigung des Mietverhältnisses vor.' },
  { titel: 'Ankündigung Modernisierung (§ 555c BGB)', kategorie: 'Miete', betreff: 'Ankündigung einer Modernisierungsmaßnahme – {objekt}',
    text: 'hiermit kündigen wir Ihnen nach § 555c BGB folgende Modernisierungsmaßnahme an:\n\nArt und voraussichtlicher Umfang: [Beschreibung der Maßnahme in wesentlichen Zügen]\nVoraussichtlicher Beginn: [Datum – mindestens drei Monate nach Zugang dieses Schreibens]\nVoraussichtliche Dauer: [Dauer]\nVoraussichtliche Mieterhöhung nach § 559 BGB: [Betrag] € monatlich\nVoraussichtliche künftige Betriebskosten: [Betrag] € monatlich\n\nHinweis zu Ihrem Härteeinwand: Umstände, die für Sie oder Ihre Haushaltsangehörigen eine Härte im Hinblick auf die Duldung der Maßnahme oder die Mieterhöhung begründen, teilen Sie uns bitte bis zum Ablauf des Monats, der auf den Zugang dieser Ankündigung folgt, in Textform mit (§ 555d Abs. 3 BGB).' },
  { titel: 'Ankündigung Erhaltungsmaßnahme (§ 555a BGB)', kategorie: 'Miete', betreff: 'Ankündigung von Erhaltungsmaßnahmen',
    text: 'hiermit kündigen wir Ihnen folgende Erhaltungsmaßnahme an:\n\nArt der Arbeiten: [Beschreibung]\nVoraussichtlicher Beginn: [Datum]\nVoraussichtliche Dauer: [Dauer]\n\nWir bitten Sie, den Handwerkern Zugang zur Wohnung {einheit} zu gewähren, und bemühen uns, die Beeinträchtigungen so gering wie möglich zu halten.' },
  { titel: 'Anpassung der Vorauszahlungen (§ 560 Abs. 4 BGB)', kategorie: 'Miete', betreff: 'Anpassung Ihrer Betriebskostenvorauszahlungen – {einheit}',
    text: 'auf Grundlage der Betriebskostenabrechnung für [Jahr] passen wir Ihre monatlichen Vorauszahlungen nach § 560 Abs. 4 BGB auf eine angemessene Höhe an:\n\nBetriebskosten-Vorauszahlung: bisher {bk_vz}, künftig [Betrag] €\nHeizkosten-Vorauszahlung: bisher {hk_vz}, künftig [Betrag] €\n\nDie neuen Vorauszahlungen gelten ab der ersten Fälligkeit nach Zugang dieses Schreibens, also ab dem [Datum]. Ihre Kaltmiete bleibt unverändert.' },
  { titel: 'Erlaubnis zur Untervermietung (§ 553 BGB)', kategorie: 'Miete', betreff: 'Erlaubnis zur Untervermietung – {einheit}',
    text: 'Sie haben uns um Erlaubnis gebeten, einen Teil Ihrer Wohnung {einheit} unterzuvermieten. Hiermit erlauben wir Ihnen, [Raum/Räume] ab dem [Datum] an [Name der Person] unterzuvermieten.\n\nDie Erlaubnis gilt nur für die genannte Person und kann aus wichtigem Grund widerrufen werden. Sie bleiben uns gegenüber für alle Pflichten aus dem Mietvertrag verantwortlich; ein Verschulden der Untermieterin oder des Untermieters wird Ihnen zugerechnet (§ 540 Abs. 2 BGB).\n\nBitte beachten Sie: Für die Anmeldung beim Bürgeramt stellen in diesem Fall Sie als Hauptmieter die Wohnungsgeberbestätigung aus.' },
  { titel: 'Zustimmung zur Tierhaltung', kategorie: 'Miete', betreff: 'Zustimmung zur Tierhaltung – {einheit}',
    text: 'Sie haben uns um Zustimmung gebeten, in Ihrer Wohnung {einheit} folgendes Tier zu halten: [Tierart, Rasse, Name].\n\nWir stimmen der Haltung dieses Tieres zu. Die Zustimmung gilt nur für das genannte Tier. Wir können sie widerrufen, wenn von dem Tier erhebliche Störungen oder Gefahren für Mitbewohner oder Nachbarn ausgehen oder Schäden an der Wohnung entstehen. Für Schäden durch das Tier haften Sie; wir empfehlen eine Tierhalter-Haftpflichtversicherung.' },
  { titel: 'Bestätigung Kautionseingang', kategorie: 'Miete', betreff: 'Bestätigung Ihrer Mietkaution – {einheit}',
    text: 'wir bestätigen den Eingang Ihrer Mietkaution über {kaution_bestand}.\n\nDie Kaution legen wir getrennt von unserem Vermögen bei einem Kreditinstitut zu dem für Spareinlagen mit dreimonatiger Kündigungsfrist üblichen Zinssatz an (§ 551 Abs. 3 BGB). Die Zinsen stehen Ihnen zu und erhöhen die Sicherheit.' },
  { titel: 'Ankündigung Zählerablesung', kategorie: 'Allgemein', betreff: 'Ankündigung der Zählerablesung',
    text: 'am [Datum] zwischen [Uhrzeit] werden die Zählerstände in Ihrer Wohnung {einheit} abgelesen. Bitte ermöglichen Sie den Zugang zu den Zählern oder hinterlegen Sie einen Schlüssel bei einer Vertrauensperson.\n\nVielen Dank für Ihre Mithilfe.' },
  { titel: 'Hausmitteilung', kategorie: 'Allgemein', betreff: 'Information für alle Bewohner – {objekt}',
    text: 'wir möchten Sie über Folgendes informieren:\n\n[Text]\n\nBei Fragen erreichen Sie uns gerne.' },
  { titel: 'Hausgeld-Zahlungserinnerung', kategorie: 'WEG', betreff: 'Zahlungserinnerung Hausgeld – {einheit}, {objekt}',
    text: 'für Ihre Einheit {einheit} sind folgende Hausgeldzahlungen noch offen:\n\n{offene_monate}\nGesamt: {rueckstand}\n\nDas Hausgeld ist nach dem beschlossenen Wirtschaftsplan monatlich im Voraus fällig. Bitte überweisen Sie den Betrag bis zum {frist_14} auf das Konto der Gemeinschaft {iban_objekt}.\n\nSollten Sie inzwischen gezahlt haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.' },
  { titel: 'Beschluss im Umlaufverfahren (§ 23 Abs. 3 WEG)', kategorie: 'WEG', betreff: 'Beschlussfassung im Umlaufverfahren – {objekt}',
    text: 'die Verwaltung bittet um Beschlussfassung ohne Versammlung über folgenden Antrag:\n\n[Wortlaut des Beschlussantrags]\n\nBegründung: [kurze Erläuterung]\n\nEin Beschluss im Umlaufverfahren kommt nur zustande, wenn alle Wohnungseigentümer ihre Zustimmung in Textform erklären, zum Beispiel per E-Mail oder mit diesem unterschriebenen Schreiben (§ 23 Abs. 3 WEG). Bitte senden Sie Ihre Erklärung bis zum [Datum] zurück.\n\n☐ Ich stimme dem Antrag zu.\n☐ Ich stimme dem Antrag nicht zu.' + UNTERSCHRIFT_ZEILE + ' ({name}, {einheit})' },
];

const euroFmt = (ct: number) => euro(ct);
function werte(p: Row, v: Row | null, b: Row | null, objekt: Row, einst: Row, akte: Row | null = null): Record<string, string> {
  const offen = (akte?.op?.offen ?? []).filter((o: Row) => o.verzug >= 1);
  const frist = inTagen(14);
  return {
    anrede: anrede(p), name: alleNamen(p), vorname: p.vorname ?? '', nachname: p.nachname ?? '',
    strasse: p.strasse ?? '', plz_ort: [p.plz, p.ort].filter(Boolean).join(' '),
    objekt: objekt.bezeichnung, objekt_anschrift: [objekt.strasse, [objekt.plz, objekt.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    einheit: v?.einheit ?? '', lage: v?.lage ?? '', flaeche: v?.wohnflaeche != null ? String(v.wohnflaeche).replace('.', ',') : '',
    beginn: datum(v?.beginn), ende: datum(v?.ende),
    kaltmiete: b ? euro(b.kaltmiete_ct) : '', bk_vz: b ? euro(b.bk_vz_ct) : '', hk_vz: b ? euro(b.hk_vz_ct) : '',
    gesamtmiete: b && b.kaltmiete_ct != null ? euro((b.kaltmiete_ct ?? 0) + (b.bk_vz_ct ?? 0) + (b.hk_vz_ct ?? 0) + (b.sonstiges_ct ?? 0)) : '',
    hausgeld: b?.hausgeld_ct != null ? euro(b.hausgeld_ct) : '', ruecklage: b?.ruecklage_ct != null ? euro(b.ruecklage_ct) : '',
    rueckstand: euroFmt(akte?.vertrag?.ueberfaellig_ct ?? 0),
    offene_monate: offen.map((o: Row) => `${o.text} (fällig ${datum(o.datum)}): ${euro(o.offen_ct)}${o.status === 'teilweise bezahlt' ? ' – Rest' : ''}`).join('\n'),
    kaution: v?.kaution_ct != null ? euro(v.kaution_ct) : '', kaution_bestand: euro(akte?.kaution?.bestand_ct ?? 0),
    eigentuemer: akte?.eigentuemer?.name ?? '–',
    iban_objekt: objekt.iban ? `IBAN ${objekt.iban}` : '', frist_14: datum(frist),
    datum: datum(heute()), verwalter: [einst.verwalter_name, einst.verwalter_strasse, [einst.verwalter_plz, einst.verwalter_ort].filter(Boolean).join(' ')].filter(Boolean).join(', '),
  };
}
// Empty values leave no "()" and no space before a full stop or comma behind.
const ersetze = (t: string, w: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k) => (k in w ? w[k] : m)).replace(/ \(\)/g, '').replace(/ +([.,;:])/g, '$1');

// One letter page. Certificates (category "Bescheinigung") carry no salutation and no closing, they end with their signature line.
function briefSeite(o: { text: string; betreff: string; kategorie?: string | null; p: Row; v: Row | null; b: Row | null; akte: Row | null; objekt: Row; einst: Row }) {
  const w = werte(o.p, o.v, o.b, o.objekt, o.einst, o.akte);
  const rumpf = ersetze(o.text, w);
  const formular = o.kategorie === 'Bescheinigung';
  // Templates may start with the salutation themselves; otherwise it is added.
  const mitAnrede = formular || /^\s*\{anrede\}/.test(o.text) || /^Sehr geehrte/.test(rumpf) ? rumpf : `${w.anrede}\n\n${rumpf}`;
  const schluss = formular ? '' : `<p class="unterschrift">Mit freundlichen Grüßen<br><br>${esc(o.einst.verwalter_name ?? '')}</p>`;
  return brief({ absender: absenderAus(o.einst), empfaenger: o.p, betreff: ersetze(o.betreff, w), info: [['Objekt', o.objekt.bezeichnung], ...(o.v ? [['Einheit', o.v.einheit] as [string, string]] : [])],
    inhalt: `${absaetze(mitAnrede)}${schluss}` });
}

// Data of one contract for the placeholders.
async function vertragsdaten(typ: 'miete' | 'weg', v: Row) {
  const einheit = await call('get', 'einheiten', v.einheit_id);
  return {
    p: await empfaengerVon(v),
    v: { ...v, einheit: v.einheit ?? einheit.bezeichnung, lage: einheit.lage, wohnflaeche: einheit.wohnflaeche },
    b: await call('betraege', typ, v.id, heute()),
    akte: await call('vertragAkte', typ, v.id),
    objekt: await call('get', 'objekte', einheit.objekt_id),
  };
}

// A model letter for one contract straight from its page (the stored template if it was edited, else the built-in one).
export async function musterbrief(titel: string, typ: 'miete' | 'weg', vertrag: Row) {
  try {
    const vorlage = (await call('liste', 'vorlagen', {}, 'titel') as Row[]).find((x) => x.titel === titel) ?? STANDARDVORLAGEN.find((x) => x.titel === titel);
    if (!vorlage) throw new Error(`Vorlage „${titel}“ nicht gefunden.`);
    const d = await vertragsdaten(typ, vertrag);
    if (/keine Mietrückstände/.test(vorlage.text) && (d.akte?.vertrag?.ueberfaellig_ct ?? 0) > 0
      && !confirm(`Es sind ${euro(d.akte.vertrag.ueberfaellig_ct)} überfällig – die Bescheinigung „keine Mietrückstände“ wäre falsch. Trotzdem erstellen?`)) return;
    const einst = await call('einstellungen');
    await alsPdf([briefSeite({ text: vorlage.text, betreff: vorlage.betreff ?? titel, kategorie: vorlage.kategorie, einst, ...d })], `${titel} ${alleNamen(d.p)}`);
  } catch (e) { fehler(e); }
}
export const BESCHEINIGUNGEN = STANDARDVORLAGEN.filter((v) => v.kategorie === 'Bescheinigung').map((v) => v.titel);

export function Briefe(props: { objekt: Row; modus: Modus }) {
  const [tab, setTab] = useState<'schreiben' | 'vorlagen'>('schreiben');
  return (
    <section>
      <div className="toolbar">
        <h1>Briefe & Serienbriefe</h1>
        <Tabs tabs={[['schreiben', 'Brief schreiben'], ['vorlagen', 'Vorlagen']]} value={tab} onChange={setTab} />
      </div>
      {tab === 'schreiben' ? <Schreiben objekt={props.objekt} modus={props.modus} /> : <Vorlagen />}
    </section>
  );
}

function Schreiben(props: { objekt: Row; modus: Modus }) {
  const [vorlagen] = useLoad<Row[]>(() => call('liste', 'vorlagen', {}, 'titel'), []);
  const [mieter] = useLoad<Row[]>(() => call('vertraege', 'mietverhaeltnisse', props.objekt.id), [props.objekt.id]);
  const [eigner] = useLoad<Row[]>(() => call('vertraege', 'eigentum', props.objekt.id), [props.objekt.id]);
  const [kontakte] = useLoad<Row[]>(() => call('rollenListe', props.objekt.id), [props.objekt.id]);
  const [betreff, setBetreff] = useState('');
  const [text, setText] = useState('');
  const [kategorie, setKategorie] = useState<string | null>(null);
  const [titel, setTitel] = useState('');
  // A person or contract page can open this page with the recipient already ticked.
  const [auswahl, setAuswahl] = useState<Record<string, boolean>>(() => {
    try {
      const an = JSON.parse(sessionStorage.getItem('briefAn') ?? '[]');
      sessionStorage.removeItem('briefAn');
      return Object.fromEntries(an.map((k: string) => [k, true]));
    } catch { return {}; }
  });

  const empfaenger = [
    ...(props.objekt.art !== 'weg' ? (mieter ?? []).filter((v) => v.aktuell).map((v) => ({ key: `m${v.id}`, typ: 'miete', v, person_id: v.person_id, label: `${v.name} – ${v.einheit}`, gruppe: 'Mieter' })) : []),
    ...(props.objekt.art !== 'miete' ? (eigner ?? []).filter((v) => v.aktuell).map((v) => ({ key: `e${v.id}`, typ: 'weg', v, person_id: v.person_id, label: `${v.name} – ${v.einheit}`, gruppe: 'Eigentümer' })) : []),
    ...(kontakte ?? []).map((k) => ({ key: `r${k.id}`, typ: null, v: null, person_id: k.person_id, label: `${k.name} (${k.rolle})`, gruppe: 'Ansprechpartner' })),
  ];
  const gewaehlt = empfaenger.filter((e) => auswahl[e.key]);
  const gruppeWaehlen = (g: string, an: boolean) => setAuswahl({ ...auswahl, ...Object.fromEntries(empfaenger.filter((e) => e.gruppe === g).map((e) => [e.key, an])) });

  async function erstellen() {
    try {
      const einst = await call('einstellungen');
      const seiten = [];
      for (const e of gewaehlt) {
        const d = e.v ? await vertragsdaten(e.typ as 'miete' | 'weg', e.v)
          : { p: await call('get', 'personen', e.person_id), v: null, b: null, akte: null, objekt: props.objekt };
        // A certificate of no arrears must not go out while something is overdue.
        if (/keine Mietrückstände/.test(text) && (d.akte?.vertrag?.ueberfaellig_ct ?? 0) > 0
          && !confirm(`${e.label}: Es sind ${euro(d.akte!.vertrag.ueberfaellig_ct)} überfällig – die Bescheinigung „keine Mietrückstände“ wäre falsch. Trotzdem erstellen?`)) continue;
        seiten.push(briefSeite({ text, betreff, kategorie, einst, ...d, objekt: props.objekt }));
      }
      const name = (titel || betreff).replace(/\{\w+\}/g, '').replace(/[\s,–-]+$/, '').replace(/\s+[–-]\s*(,\s*)?$/, '').trim() || 'Brief';
      await alsPdf(seiten, `${name} ${props.objekt.bezeichnung}`);
    } catch (e) {
      fehler(e);
    }
  }

  async function email() {
    const mails = (await Promise.all(gewaehlt.map((e) => call('get', 'personen', e.person_id)))).map((p) => p.email).filter(Boolean);
    if (!mails.length) return alert('Keiner der gewählten Empfänger hat eine E-Mail-Adresse.');
    // Recipients go into BCC so they do not see each other's addresses.
    window.hv.extern(`mailto:?bcc=${encodeURIComponent(mails.join(','))}&subject=${encodeURIComponent(ersetze(betreff, { objekt: props.objekt.bezeichnung }))}&body=${encodeURIComponent(ersetze(text, { objekt: props.objekt.bezeichnung, anrede: 'Guten Tag,' }))}`);
  }

  return (
    <div className="zweispaltig">
      <div className="panel">
        <div className="maske">
          <label className="breit">Vorlage
            <select defaultValue="" onChange={(e) => { const v = vorlagen?.find((x) => x.id === Number(e.target.value)); setKategorie(v?.kategorie ?? null); setTitel(v?.titel ?? ''); if (v) { setBetreff(v.betreff ?? ''); setText(v.text ?? ''); } }}>
              <option value="">– freier Brief –</option>
              {vorlagen?.map((v) => <option key={v.id} value={v.id}>{v.titel}</option>)}
            </select>
          </label>
          <label className="breit">Betreff<input value={betreff} onChange={(e) => setBetreff(e.target.value)} /></label>
        </div>
        <textarea className="brieftext" rows={16} value={text} onChange={(e) => setText(e.target.value)} placeholder="Brieftext. Platzhalter wie {name}, {einheit} oder {kaltmiete} werden je Empfänger ersetzt." />
        <details className="klein"><summary>Platzhalter</summary>{PLATZHALTER.map(([k, l]) => <div key={k}><code>{`{${k}}`}</code> {l}</div>)}</details>
      </div>
      <div className="panel">
        <h3>Empfänger ({gewaehlt.length})</h3>
        {['Mieter', 'Eigentümer', 'Ansprechpartner'].map((g) => {
          const es = empfaenger.filter((e) => e.gruppe === g);
          if (!es.length) return null;
          return (
            <div key={g} className="block">
              <label className="check"><input type="checkbox" checked={es.every((e) => auswahl[e.key])} onChange={(ev) => gruppeWaehlen(g, ev.target.checked)} /> <b>Alle {g}</b></label>
              {es.map((e) => <label key={e.key} className="check eingerueckt"><input type="checkbox" checked={!!auswahl[e.key]} onChange={(ev) => setAuswahl({ ...auswahl, [e.key]: ev.target.checked })} /> {e.label}</label>)}
            </div>
          );
        })}
        <div className="buttons">
          <button disabled={!gewaehlt.length} onClick={email}>Als E-Mail…</button>
          <span className="spacer" />
          <button className="primary" disabled={!gewaehlt.length || !text.trim()} onClick={erstellen}>{gewaehlt.length > 1 ? `${gewaehlt.length} Briefe` : 'Brief'} als PDF</button>
        </div>
      </div>
    </div>
  );
}

function Vorlagen() {
  return (
    <Liste titel="" table="vorlagen" order="titel" neuLabel="Neue Vorlage"
      kopf={(rows, reload) => {
        const fehlend = STANDARDVORLAGEN.filter((v) => !rows.some((r) => r.titel === v.titel));
        // Built-in templates whose stored copy differs (older version or edited by the user).
        const anders = STANDARDVORLAGEN.map((v) => [v, rows.find((r) => r.titel === v.titel)] as const).filter(([v, r]) => r && (r.text !== v.text || r.betreff !== v.betreff));
        return (
          <>
            {fehlend.length > 0 && <button onClick={async () => { for (const v of fehlend) await call('save', 'vorlagen', v); reload(); }}>{fehlend.length} Musterbriefe ergänzen</button>}
            {anders.length > 0 && <button title={anders.map(([v]) => v.titel).join('\n')} onClick={async () => {
              if (!confirm(`${anders.length} Vorlage(n) auf den aktuellen Muster-Text setzen? Eigene Änderungen daran gehen verloren:\n\n${anders.map(([v]) => v.titel).join('\n')}`)) return;
              for (const [v, r] of anders) await call('save', 'vorlagen', { ...v, id: r!.id });
              reload();
            }}>{anders.length} Muster aktualisieren</button>}
          </>
        );
      }}
      spalten={[['Titel', (r) => r.titel], ['Kategorie', (r) => r.kategorie], ['Betreff', (r) => r.betreff]]}
      fields={[{ key: 'titel', label: 'Titel', required: true }, { key: 'kategorie', label: 'Kategorie' }, { key: 'betreff', label: 'Betreff', wide: true },
        { key: 'text', label: 'Text (Platzhalter in geschweiften Klammern, z. B. {name})', type: 'textarea' }]} />
  );
}

const STATUS: [string, string][] = [['offen', 'offen'], ['in_arbeit', 'in Arbeit'], ['wartet', 'wartet auf Rückmeldung'], ['erledigt', 'erledigt']];
const ARTEN: [string, string][] = [['notiz', 'Notiz'], ['anruf', 'Anruf'], ['email', 'E-Mail'], ['brief', 'Brief'], ['termin', 'Termin vor Ort'], ['auftrag', 'Auftrag erteilt']];

export function Vorgaenge(props: { objekt: Row }) {
  const [nurOffen, setNurOffen] = useState(true);
  const [rows, reload] = useLoad<Row[]>(() => call('vorgaengeListe', props.objekt.id, nurOffen), [props.objekt.id, nurOffen]);
  const [einheiten] = useLoad<Row[]>(() => call('einheiten', props.objekt.id), [props.objekt.id]);
  const [personen] = useLoad<Row[]>(() => call('personen'), []);
  const [edit, setEdit] = useState<Row | null>(null);
  const [offen, setOffen] = useState<Row | null>(null);
  useAktion('neuer-vorgang', () => setEdit({ objekt_id: props.objekt.id, status: 'offen', prioritaet: 2 }));
  // A link to a single case opens it right away (also when it is already done).
  useEffect(() => {
    let id: number | null = null;
    try { const a = sessionStorage.getItem('aktion'); if (a?.startsWith('vorgang:')) { sessionStorage.removeItem('aktion'); id = Number(a.slice(8)); } } catch {}
    if (id) call('vorgaengeListe', props.objekt.id, false).then((alle: Row[]) => { const v = alle.find((x) => x.id === id); if (v) setOffen(v); });
  }, [props.objekt.id]);
  const felder: Field[] = [
    { key: 'titel', label: 'Titel', required: true, wide: true },
    { key: 'kategorie', label: 'Kategorie', type: 'select', options: ['Schaden / Reparatur', 'Mieteranfrage', 'Eigentümeranfrage', 'Beschwerde', 'Vermietung', 'Verwaltung', 'Sonstiges'].map((k) => [k, k]) },
    { key: 'status', label: 'Status', type: 'select', required: true, options: STATUS },
    { key: 'prioritaet', label: 'Priorität', type: 'select', required: true, options: [[1, 'hoch'], [2, 'normal'], [3, 'niedrig']] },
    { key: 'faellig', label: 'Fällig / Wiedervorlage', type: 'date' },
    { key: 'einheit_id', label: 'Einheit', type: 'select', options: (einheiten ?? []).map((e) => [e.id, `${e.nr} – ${e.bezeichnung}`]) },
    { key: 'person_id', label: 'Person', type: 'select', options: (personen ?? []).map((p) => [p.id, personName(p)]) },
    { key: 'beschreibung', label: 'Beschreibung', type: 'textarea' },
  ];
  return (
    <section>
      <div className="toolbar">
        <h1>Vorgänge</h1>
        <span className="spacer" />
        <label className="check"><input type="checkbox" checked={nurOffen} onChange={(e) => setNurOffen(e.target.checked)} /> nur offene</label>
        <button className="primary" onClick={() => setEdit({ objekt_id: props.objekt.id, status: 'offen', prioritaet: 2 })}>Neuer Vorgang</button>
      </div>
      <table>
        <thead><tr><th>Fällig</th><th>Titel</th><th>Kategorie</th><th>Einheit / Person</th><th>Status</th><th className="num">Einträge</th><th /></tr></thead>
        <tbody>
          {rows?.map((r) => (
            <tr key={r.id} className={`klickbar${r.status === 'erledigt' ? ' inaktiv' : ''}`} data-ziel={`vorgang:${r.id}`} onClick={() => setOffen(r)}>
              <td className={r.faellig && r.faellig < heute() && r.status !== 'erledigt' ? 'fehlertext' : ''}>{datum(r.faellig)}</td>
              <td>{r.prioritaet === 1 && <span className="tag fehlertext">!</span>}{r.titel}</td><td>{r.kategorie}</td>
              <td className="klein">{r.einheit_id && <L zu={{ einheit: r.einheit_id }}>{r.einheit}</L>}{r.einheit_id && r.person_id ? ' · ' : ''}{r.person_id && <L zu={{ person: r.person_id }}>{r.person}</L>}</td>
              <td>{STATUS.find(([s]) => s === r.status)?.[1]}</td><td className="num">{r.eintraege}</td>
              <td className="aktionen"><button onClick={(e) => { e.stopPropagation(); setEdit(r); }}>Bearbeiten</button></td>
            </tr>
          ))}
          {rows && !rows.length && <tr><td colSpan={7} className="hinweis">Keine Vorgänge.</td></tr>}
        </tbody>
      </table>
      {edit && <FormDialog title={edit.id ? 'Vorgang bearbeiten' : 'Neuer Vorgang'} row={edit} fields={felder}
        onSave={(r) => call('save', 'vorgaenge', { ...r, objekt_id: props.objekt.id })} onDelete={() => call('remove', 'vorgaenge', edit.id)}
        onClose={() => { setEdit(null); reload(); }} />}
      {offen && <Vorgang v={offen} onClose={() => { setOffen(null); reload(); }} />}
    </section>
  );
}

function Vorgang(props: { v: Row; onClose: () => void }) {
  const [eintraege, reload] = useLoad<Row[]>(() => call('liste', 'vorgangseintraege', { vorgang_id: props.v.id }, 'datum DESC, id DESC'), [props.v.id]);
  const [neu, setNeu] = useState({ art: 'notiz', text: '', datum: heute() });
  return (
    <Dialog titel={props.v.titel} onClose={props.onClose} breit aktionen={
      props.v.status !== 'erledigt' && <button onClick={async () => { await call('save', 'vorgaenge', { id: props.v.id, status: 'erledigt' }); props.onClose(); }}>Als erledigt markieren</button>}>
      {(props.v.einheit_id || props.v.person_id) && (
        <p className="chips">{props.v.einheit_id && <span className="chip">Einheit <L zu={{ einheit: props.v.einheit_id }}>{props.v.einheit}</L></span>}
          {props.v.person_id && <span className="chip">Person <L zu={{ person: props.v.person_id }}>{props.v.person}</L></span>}</p>
      )}
      {props.v.beschreibung && <p style={{ whiteSpace: 'pre-wrap' }}>{props.v.beschreibung}</p>}
      <div className="toolbar">
        <input type="date" value={neu.datum} onChange={(e) => setNeu({ ...neu, datum: e.target.value })} />
        <select value={neu.art} onChange={(e) => setNeu({ ...neu, art: e.target.value })}>{ARTEN.map(([a, l]) => <option key={a} value={a}>{l}</option>)}</select>
        <input style={{ flex: 1 }} className="suche" placeholder="Was ist passiert?" value={neu.text} onChange={(e) => setNeu({ ...neu, text: e.target.value })} />
        <button className="primary" disabled={!neu.text.trim()} onClick={async () => { await call('save', 'vorgangseintraege', { ...neu, vorgang_id: props.v.id }); setNeu({ ...neu, text: '' }); reload(); }}>Eintragen</button>
      </div>
      <table>
        <tbody>{eintraege?.map((e) => (
          <tr key={e.id}><td>{datum(e.datum)}</td><td><span className="tag">{ARTEN.find(([a]) => a === e.art)?.[1]}</span></td><td>{e.text}</td>
            <td className="aktionen"><button onClick={async () => { await call('remove', 'vorgangseintraege', e.id); reload(); }}>×</button></td></tr>
        ))}</tbody>
      </table>
    </Dialog>
  );
}

export function Termine(props: { objekte: Row[] }) {
  const [von, setVon] = useState(heute());
  const bis = new Date(Date.parse(von) + 90 * 864e5).toISOString().slice(0, 10);
  const [rows, reload] = useLoad<Row[]>(() => call('termineListe', von, bis), [von]);
  const [personen] = useLoad<Row[]>(() => call('personen'), []);
  const [edit, setEdit] = useState<Row | null>(null);
  useAktion('neuer-termin', () => setEdit({ datum: heute() }));
  const felder: Field[] = [
    { key: 'titel', label: 'Titel', required: true, wide: true }, { key: 'datum', label: 'Datum', type: 'date', required: true },
    { key: 'uhrzeit', label: 'Uhrzeit (z. B. 14:30)' }, { key: 'dauer_min', label: 'Dauer (Minuten)', type: 'number' }, { key: 'ort', label: 'Ort' },
    { key: 'objekt_id', label: 'Objekt', type: 'select', options: props.objekte.map((o) => [o.id, o.bezeichnung]) },
    { key: 'person_id', label: 'Person', type: 'select', options: (personen ?? []).map((p) => [p.id, personName(p)]) },
    { key: 'erledigt', label: 'Erledigt', type: 'check' }, { key: 'notiz', label: 'Notiz', type: 'textarea' },
  ];
  const tage = [...new Set((rows ?? []).map((r) => r.datum))];
  return (
    <section>
      <div className="toolbar">
        <h1>Termine</h1>
        <label>ab <input type="date" value={von} onChange={(e) => setVon(e.target.value)} /></label>
        <span className="hinweis klein">die nächsten 90 Tage</span>
        <span className="spacer" />
        <button className="primary" onClick={() => setEdit({ datum: heute() })}>Neuer Termin</button>
      </div>
      {tage.map((t) => (
        <div key={t} className="block">
          <h3>{new Date(t + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</h3>
          <table>
            <tbody>{rows!.filter((r) => r.datum === t).map((r) => (
              <tr key={r.id} className={r.erledigt ? 'inaktiv' : ''} onDoubleClick={() => setEdit(r)}>
                <td style={{ width: 80 }}>{r.uhrzeit}</td><td><b>{r.titel}</b>{r.ort && <span className="klein"> · {r.ort}</span>}</td>
                <td className="klein">{r.objekt_id && <L zu={{ objekt: r.objekt_id }}>{r.objekt}</L>}{r.objekt_id && r.person_id ? ' · ' : ''}{r.person_id && <L zu={{ person: r.person_id }}>{r.person}</L>}</td>
                <td className="aktionen"><button onClick={() => setEdit(r)}>Bearbeiten</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
      {rows && !rows.length && <p className="hinweis">Keine Termine in diesem Zeitraum.</p>}
      {edit && <FormDialog title={edit.id ? 'Termin bearbeiten' : 'Neuer Termin'} row={edit} fields={felder}
        onSave={(r) => call('save', 'termine', r)} onDelete={() => call('remove', 'termine', edit.id)} onClose={() => { setEdit(null); reload(); }} />}
    </section>
  );
}
