// Letters for rent changes, each checked against the statutory dates and caps before it is written:
// increase to the local comparative rent (§ 558), indexed rent (§ 557b), graduated rent (§ 557a),
// modernisation (§ 559) and new advance payments (§ 560 Abs. 4).
import { useState, type ReactNode } from 'react';
import { alleNamen, anrede, briefName, call, datum, euro, fehlerText, heute, parseCent, parseZahl, type Row } from '../api';
import { useLoad } from '../useLoad';
import { Dialog } from '../ui';
import { absaetze, absenderAus, alsPdfAblegen, brief, empfaengerVon, esc, tabelle } from '../dokument';
import { sollNachfrage } from './Sollstellung';

const plusTage = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// First of the month n months after the month of iso.
const plusMonate = (iso: string, n: number) => {
  const d = new Date(iso.slice(0, 7) + '-01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
// Same calendar day n months later, then the next first of a month.
const abMonatNach = (iso: string, n: number) => {
  const [y, m, t] = iso.split('-').map(Number);
  const z = new Date(Date.UTC(y, m - 1 + n, 1));
  const letzter = new Date(Date.UTC(z.getUTCFullYear(), z.getUTCMonth() + 1, 0)).getUTCDate();
  const tag = `${z.toISOString().slice(0, 8)}${String(Math.min(t, letzter)).padStart(2, '0')}`;
  return tag.endsWith('-01') ? tag : plusMonate(tag, 1);
};
const qm2 = (x: number | null | undefined) => (x == null || !isFinite(x) ? '–' : `${x.toFixed(2).replace('.', ',')} €/m²`);
const komma = (x: number, n = 2) => x.toFixed(n).replace('.', ',');
const monatText = (m: string) => (/^\d{4}-\d{2}$/.test(m) ? `${['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'][Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` : m);
// Changes that do not count for waiting periods: modernisation (§ 559) and operating costs (§ 560).
const NICHT_ZAEHLEND = ['modernisierung', 'nk_anpassung', 'wirtschaftsplan'];

type Art = 'erhoehung' | 'index' | 'staffel' | 'modernisierung' | 'nk_anpassung' | 'manuell';
type Pruefpunkt = { ok: boolean; text: ReactNode; hart?: boolean; aktion?: ReactNode };

const MITTEL: [string, string][] = [
  ['mietspiegel', 'Mietspiegel (§ 558a Abs. 2 Nr. 1)'],
  ['vergleich', 'Drei Vergleichswohnungen (§ 558a Abs. 2 Nr. 4)'],
  ['gutachten', 'Sachverständigengutachten (§ 558a Abs. 2 Nr. 3)'],
  ['datenbank', 'Mietdatenbank (§ 558a Abs. 2 Nr. 2)'],
];

// Index values written by "Indexanpassung berechnen" into the note of the adjustment.
function indexAusNotiz(notiz: string | null | undefined) {
  const m = notiz?.match(/Index (\d{4}-\d{2}): ([\d.,]+) \(Basis (\d{4}-\d{2}): ([\d.,]+)\)/);
  return m ? { neu_monat: m[1], neu_wert: m[2].replace('.', ','), basis_monat: m[3], basis_wert: m[4].replace('.', ',') } : {};
}

export function AnpassungBrief(props: { v: Row; a: Row; objekt: Row; anpassungen: Row[]; onClose: () => void; onGeaendert: () => void }) {
  const v = props.v;
  const [a, setA] = useState(props.a);
  const art = (['erhoehung', 'index', 'staffel', 'modernisierung', 'nk_anpassung'].includes(a.grund) ? a.grund : 'manuell') as Art;
  const [zugang, setZugang] = useState(plusTage(heute(), 3));
  const [f, setF] = useState<Row>(() => ({ mittel: 'mietspiegel', jahr: String(Number(heute().slice(0, 4)) - 1), ...indexAusNotiz(a.notiz) }));
  const [meldung, setMeldung] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const setze = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const [d] = useLoad<Row>(async () => {
    const [alt, einheit, einheiten, p, einst] = await Promise.all([
      call('betraege', 'miete', v.id, plusTage(a.gueltig_ab, -1)), call('get', 'einheiten', v.einheit_id), call('einheiten', props.objekt.id),
      empfaengerVon(v), call('einstellungen')]);
    return { alt, einheit, p, einst, gesamt_qm: (einheiten as Row[]).reduce((s, e) => s + (e.wohnflaeche ?? 0), 0) };
  }, [v.id, a.gueltig_ab]);
  const [pr] = useLoad<Row | null>(() => (art === 'erhoehung' && a.kaltmiete_ct ? call('mieterhoehungPruefen', v.id, a.kaltmiete_ct, a.gueltig_ab, null, zugang)
    : art === 'modernisierung' && a.kaltmiete_ct ? call('modernisierungPruefen', v.id, a.kaltmiete_ct, a.gueltig_ab, zugang) : Promise.resolve(null)),
  [art, zugang, a.kaltmiete_ct, a.gueltig_ab]);

  if (!d) return null;
  const alt = d.alt;
  const neu: Row = Object.fromEntries(['kaltmiete_ct', 'bk_vz_ct', 'hk_vz_ct', 'sonstiges_ct'].map((k) => [k, a[k] ?? alt[k] ?? 0]));
  const summe = (b: Row) => (b.kaltmiete_ct ?? 0) + (b.bk_vz_ct ?? 0) + (b.hk_vz_ct ?? 0) + (b.sonstiges_ct ?? 0);
  const qm: number | null = d.einheit.wohnflaeche || null;
  const gewerbe = d.einheit.art === 'Gewerbe';
  // Last change of the base rent before this one (start of the contract if none).
  const seit = props.anpassungen.filter((x) => x.id !== a.id && x.kaltmiete_ct != null && !NICHT_ZAEHLEND.includes(x.grund) && x.gueltig_ab < a.gueltig_ab)
    .map((x) => x.gueltig_ab).sort().pop() ?? v.beginn;

  async function verschieben(ab: string) {
    try {
      await call('save', 'anpassungen', { id: a.id, gueltig_ab: ab });
      setA({ ...a, gueltig_ab: ab });
      void sollNachfrage('miete', v.id);
      props.onGeaendert();
    } catch (e) { setMeldung(fehlerText(e)); }
  }
  async function betragSetzen(ct: number) {
    try {
      await call('save', 'anpassungen', { id: a.id, kaltmiete_ct: ct });
      setA({ ...a, kaltmiete_ct: ct });
      void sollNachfrage('miete', v.id);
      props.onGeaendert();
    } catch (e) { setMeldung(fehlerText(e)); }
  }
  const knopfAb = (ab: string) => <button onClick={() => verschieben(ab)}>Gültig ab {datum(ab)} setzen</button>;

  // ---------- checks ----------
  const punkte: Pruefpunkt[] = [];
  let modern: Row | null = null;
  let index: Row | null = null;
  if (gewerbe) punkte.push({ ok: false, text: 'Gewerberaum: §§ 557–561 BGB gelten hier nicht, maßgeblich ist allein der Mietvertrag (bei Indexklauseln das Preisklauselgesetz).' });
  if (art === 'erhoehung' && pr) {
    punkte.push({ ok: pr.modell_ok, hart: true, text: pr.modell_ok ? 'Keine Staffel- oder Indexmiete vereinbart.' : `Bei ${pr.modell === 'index' ? 'Indexmiete' : 'Staffelmiete'} ist eine Erhöhung nach § 558 ausgeschlossen (§ ${pr.modell === 'index' ? '557b' : '557a'} Abs. 2 BGB).` });
    punkte.push({ ok: pr.jahresfrist_ok, hart: true, text: pr.jahresfrist_ok ? `Jahresfrist eingehalten: Verlangen ab ${datum(pr.verlangen_ab)} möglich.`
      : `Das Verlangen darf frühestens am ${datum(pr.verlangen_ab)} zugehen (ein Jahr nach der letzten Erhöhung, § 558 Abs. 1 Satz 2 BGB) – ein früheres Verlangen ist unwirksam.` });
    punkte.push({ ok: pr.frist_ok, hart: true, text: `Miete unverändert seit ${datum(pr.letzte_aenderung)}: ${pr.frist_ok ? 'zum Erhöhungszeitpunkt 15 Monate erreicht' : `15 Monate erst erreicht – frühestens ab ${datum(pr.frueheste_wirkung)}`} (§ 558 Abs. 1 BGB).`,
      aktion: !pr.frist_ok && knopfAb(pr.frueheste_wirkung) });
    punkte.push({ ok: pr.wirkung_ok, hart: true, text: `Bei Zugang am ${datum(zugang)} wirkt die Erhöhung frühestens ab ${datum(pr.wirkung_frueh)}; Zustimmungsfrist bis ${datum(pr.zustimmung_bis)} (§ 558b BGB).`,
      aktion: !pr.wirkung_ok && knopfAb(pr.frueheste_wirkung) });
    punkte.push({ ok: pr.kappung_ok, hart: true, text: <>Kappungsgrenze {pr.kappung} %: Miete am {datum(pr.basis_datum)} {euro(pr.basis_ct)}, höchstens {euro(pr.grenze_ct)}{pr.zuschlaege_ct ? ` (inkl. Modernisierungszuschlägen ${euro(pr.zuschlaege_ct)})` : ''} – verlangt {euro(a.kaltmiete_ct)} (+{komma(pr.erhoehung_prozent, 1)} %).</> });
    const bis = parseZahl(f.bis) ?? parseZahl(f.wert);
    const mittel = parseZahl(f.mittelwert);
    if (pr.neu_qm != null && bis != null) punkte.push({ ok: pr.neu_qm <= bis + 0.005, hart: true, text: `Neue Miete ${qm2(pr.neu_qm)} – ortsübliche Vergleichsmiete ${f.mittel === 'mietspiegel' ? `bis ${qm2(bis)}` : qm2(bis)}.` });
    if (pr.neu_qm != null && mittel != null && pr.neu_qm > mittel + 0.005) punkte.push({ ok: false, text: `Die neue Miete liegt über dem Mittelwert ${qm2(mittel)}: Die Einordnung in die obere Spanne bitte mit Merkmalen der Wohnung begründen.` });
    if (!qm) punkte.push({ ok: false, text: 'Für die Einheit ist keine Wohnfläche erfasst – sie gehört in die Begründung.' });
  }
  if (art === 'index') {
    const b = parseZahl(f.basis_wert), n = parseZahl(f.neu_wert);
    const ab = plusMonate(zugang, 2);
    const jahr = abMonatNach(seit, 12);
    punkte.push({ ok: !!(b && n && f.basis_monat && f.neu_monat), hart: true, text: 'Die Erklärung muss die Indexänderung nennen (§ 557b Abs. 3 BGB): Monat und Wert alt und neu.' });
    if (b && n) {
      index = { b, n, prozent: (n / b - 1) * 100, neu_ct: Math.round(alt.kaltmiete_ct * n / b) };
      const passt = Math.abs(index.neu_ct - (a.kaltmiete_ct ?? 0)) <= 1;
      punkte.push({ ok: passt, text: `${euro(alt.kaltmiete_ct)} × ${komma(n, 1)} / ${komma(b, 1)} = ${euro(index.neu_ct)}${passt ? '' : ` – eingetragen sind ${euro(a.kaltmiete_ct)}`}.`,
        aktion: !passt && <button onClick={() => betragSetzen(index!.neu_ct)}>{euro(index.neu_ct)} übernehmen</button> });
    }
    punkte.push({ ok: a.gueltig_ab >= ab, hart: true, text: `Bei Zugang am ${datum(zugang)} gilt die neue Miete ab ${datum(ab)} (Beginn des übernächsten Monats, § 557b Abs. 3 BGB).`, aktion: a.gueltig_ab < ab && knopfAb([ab, jahr].sort().pop()!) });
    punkte.push({ ok: a.gueltig_ab >= jahr, hart: true, text: `Miete unverändert seit ${datum(seit)}: mindestens ein Jahr nötig, also frühestens ab ${datum(jahr)} (§ 557b Abs. 2 BGB).`, aktion: a.gueltig_ab < jahr && knopfAb([ab, jahr].sort().pop()!) });
  }
  if (art === 'staffel') {
    const jahr = abMonatNach(seit, 12);
    punkte.push({ ok: a.gueltig_ab >= jahr, text: `Miete unverändert seit ${datum(seit)}: Jede Staffel muss mindestens ein Jahr gelten (§ 557a Abs. 2 BGB), also frühestens ab ${datum(jahr)}.` });
    punkte.push({ ok: true, text: 'Die Staffel gilt ohne Erklärung; das Schreiben ist eine Erinnerung für den Dauerauftrag.' });
  }
  if (art === 'modernisierung') {
    const kosten = parseCent(f.kosten), erhaltung = parseCent(f.erhaltung), foerderung = parseCent(f.foerderung);
    const wqm = parseZahl(f.wohnung_qm) ?? qm ?? 0, gqm = parseZahl(f.gesamt_qm) ?? d.gesamt_qm ?? 0;
    const umlage = Math.max(0, kosten - erhaltung - foerderung);
    const anteil = gqm ? umlage * wqm / gqm : 0;
    const jaehrlich = Math.round(anteil * 0.08);
    modern = { kosten, erhaltung, foerderung, umlage, wqm, gqm, anteil: Math.round(anteil), jaehrlich, monatlich: Math.round(jaehrlich / 12) };
    const diff = (a.kaltmiete_ct ?? 0) - alt.kaltmiete_ct;
    punkte.push({ ok: kosten > 0 && gqm > 0, hart: true, text: 'Die Erklärung muss die Erhöhung aus den Kosten berechnen und erläutern (§ 559b Abs. 1 BGB): Kosten, Erhaltungsanteil, Verteilung.' });
    if (kosten > 0 && gqm > 0) punkte.push({ ok: Math.abs(modern.monatlich - diff) <= 1, text: `8 % von ${euro(modern.anteil)} = ${euro(jaehrlich)} im Jahr = ${euro(modern.monatlich)} im Monat${Math.abs(modern.monatlich - diff) <= 1 ? '' : ` – eingetragen sind ${euro(diff)}`}.`,
      aktion: Math.abs(modern.monatlich - diff) > 1 && <button onClick={() => betragSetzen(alt.kaltmiete_ct + modern!.monatlich)}>{euro(alt.kaltmiete_ct + modern.monatlich)} übernehmen</button> });
    if (pr) {
      punkte.push({ ok: pr.kappung_ok, hart: true, text: pr.grenze_ct == null ? 'Ohne Wohnfläche lässt sich die Kappung (§ 559 Abs. 3a) nicht prüfen.'
        : `Kappung: höchstens ${pr.satz} €/m² in sechs Jahren = ${euro(pr.grenze_ct + pr.frueher_ct)}${pr.frueher_ct ? `, davon bereits ${euro(pr.frueher_ct)} genutzt` : ''} – Erhöhung ${euro(pr.erhoehung_ct)} (§ 559 Abs. 3a BGB).` });
      const verspaetet = !f.ankuendigung;
      const ab = verspaetet ? plusMonate(pr.wirkung_frueh, 6) : pr.wirkung_frueh;
      punkte.push({ ok: a.gueltig_ab >= ab, hart: true, text: `Bei Zugang am ${datum(zugang)} gilt die Erhöhung ab ${datum(ab)} (Beginn des dritten Monats, § 559b Abs. 2 BGB${verspaetet ? '; ohne Modernisierungsankündigung sechs Monate später' : ''}).`, aktion: a.gueltig_ab < ab && knopfAb(ab) });
    }
  }
  if (art === 'nk_anpassung') {
    const ab = plusMonate(zugang, 1);
    punkte.push({ ok: a.gueltig_ab >= ab, hart: true, text: `Neue Vorauszahlungen gelten ab der nächsten Fälligkeit nach Zugang, also frühestens ab ${datum(ab)} (§ 560 Abs. 4 BGB).`, aktion: a.gueltig_ab < ab && knopfAb(ab) });
    punkte.push({ ok: true, text: 'Voraussetzung ist eine vorausgegangene, formell ordnungsgemäße Betriebskostenabrechnung; die Anpassung muss angemessen sein (Ergebnis der Abrechnung / 12).' });
  }
  const blockiert = punkte.some((x) => x.hart && !x.ok);

  // ---------- letter ----------
  function erstellen() {
    const einst = d!.einst;
    const absender = absenderAus(einst);
    const p = d!.p;
    const lage = `${props.objekt.bezeichnung}, ${v.einheit}`;
    const gruss = `<p class="unterschrift">Mit freundlichen Grüßen<br><br><br>${esc(absender.name)}</p>`;
    const zahlweise = v.lastschrift ? `Wir ziehen den neuen Betrag ab dem ${datum(a.gueltig_ab)} per Lastschrift ein.` : 'Bitte passen Sie Ihren Dauerauftrag rechtzeitig an.';
    const mieteTabelle = tabelle(['', '#rbisher', '#rkünftig'], [
      ['Nettokaltmiete', `#r${euro(alt.kaltmiete_ct)}`, `#r${euro(neu.kaltmiete_ct)}`],
      ['Vorauszahlung Betriebskosten', `#r${euro(alt.bk_vz_ct)}`, `#r${euro(neu.bk_vz_ct)}`],
      ['Vorauszahlung Heizkosten', `#r${euro(alt.hk_vz_ct)}`, `#r${euro(neu.hk_vz_ct)}`],
      ...((alt.sonstiges_ct || neu.sonstiges_ct) ? [['Sonstiges', `#r${euro(alt.sonstiges_ct)}`, `#r${euro(neu.sonstiges_ct)}`]] : []),
    ], { summe: ['Monatliche Gesamtmiete', `#r${euro(summe(alt))}`, `#r${euro(summe(neu))}`] });
    const diff = neu.kaltmiete_ct - alt.kaltmiete_ct;
    let betreff = `Anpassung der Miete – ${lage}`;
    let inhalt = '';
    const seiten: string[] = [];

    if (art === 'erhoehung' && pr) {
      betreff = `Mieterhöhungsverlangen nach § 558 BGB – ${lage}`;
      const sp = (k: string) => (parseZahl(f[k]) != null ? qm2(parseZahl(f[k])) : '–');
      const begruendung = f.mittel === 'mietspiegel'
        ? `Zur Begründung beziehen wir uns auf den ${f.qualifiziert ? 'qualifizierten ' : ''}Mietspiegel „${f.bezeichnung || '[Bezeichnung]'}“${f.qualifiziert ? ' (§ 558d BGB)' : ''}. ` +
          `${f.feld ? `Einordnung Ihrer Wohnung: ${f.feld.replace(/\.$/, '')}. ` : ''}Die Spanne reicht dort von ${sp('von')} bis ${sp('bis')}${f.mittelwert ? `, der Mittelwert beträgt ${sp('mittelwert')}` : ''}. ` +
          `Die verlangte Miete von ${qm2(pr.neu_qm)} liegt innerhalb dieser Spanne.${f.einordnung ? `\n\nZur Einordnung innerhalb der Spanne: ${f.einordnung}` : ''}` +
          `${f.erhaeltlich ? `\n\nDer Mietspiegel ist ${f.erhaeltlich}.` : '\n\nDer Mietspiegel liegt diesem Schreiben bei.'}`
        : f.mittel === 'vergleich'
          ? `Zur Begründung benennen wir drei vergleichbare Wohnungen (§ 558a Abs. 2 Nr. 4 BGB), für die folgende Nettokaltmieten gezahlt werden:\n${(f.vergleich ?? '').trim() || '[Anschrift, Geschoss, Lage, Wohnfläche, Miete je m²]'}`
          : f.mittel === 'gutachten'
            ? `Zur Begründung fügen wir das Gutachten ${f.bezeichnung ? `von ${f.bezeichnung}, ` : ''}eines öffentlich bestellten und vereidigten Sachverständigen bei (§ 558a Abs. 2 Nr. 3 BGB). Es ermittelt eine ortsübliche Vergleichsmiete von ${sp('wert')}.`
            : `Zur Begründung beziehen wir uns auf die Auskunft aus der Mietdatenbank ${f.bezeichnung ? `„${f.bezeichnung}“ ` : ''}(§ 558a Abs. 2 Nr. 2, § 558e BGB). Sie weist eine ortsübliche Vergleichsmiete von ${sp('wert')} aus.`;
      inhalt = absaetze([
        `die Nettokaltmiete für Ihre Wohnung ${v.einheit}${qm ? ` (${komma(qm, qm % 1 ? 2 : 0)} m² Wohnfläche)` : ''} beträgt derzeit ${euro(alt.kaltmiete_ct)} monatlich${qm ? ` (${qm2(pr.alt_qm)})` : ''}. Sie ist seit dem ${datum(pr.letzte_aenderung)} unverändert.`,
        `Wir bitten Sie, einer Erhöhung der Nettokaltmiete auf ${euro(a.kaltmiete_ct)} monatlich${qm ? ` (${qm2(pr.neu_qm)})` : ''} mit Wirkung ab dem ${datum(a.gueltig_ab)} zuzustimmen (§ 558 BGB). Das sind ${euro(diff)} mehr im Monat. Die Vorauszahlungen für Betriebs- und Heizkosten bleiben unverändert:`,
      ].join('\n\n')) + mieteTabelle + absaetze([
        begruendung,
        `Die Kappungsgrenze ist eingehalten (§ 558 Abs. 3 BGB): Am ${datum(pr.basis_datum)} betrug die Nettokaltmiete ${euro(pr.basis_ct)}. Innerhalb von drei Jahren darf sie um höchstens ${pr.kappung} % steigen` +
          `${pr.zuschlaege_ct ? `; Erhöhungen wegen Modernisierung (${euro(pr.zuschlaege_ct)}) bleiben dabei außer Betracht` : ''}. Die verlangte Miete liegt mit ${euro(a.kaltmiete_ct)} nicht über ${euro(pr.grenze_ct)}.`,
        `Bitte erklären Sie Ihre Zustimmung bis zum ${datum(pr.zustimmung_bis)}, am einfachsten mit der beigefügten Erklärung. Stimmen Sie nicht zu, können wir auf Erteilung der Zustimmung klagen (§ 558b Abs. 2 BGB). ${zahlweise}`,
        `Hinweis: Nach § 561 BGB können Sie das Mietverhältnis bis zum Ablauf des zweiten Monats nach Zugang dieses Schreibens außerordentlich zum Ablauf des übernächsten Monats kündigen.`,
      ].join('\n\n'));
      seiten.push(brief({ absender, empfaenger: p, betreff, info: [['Objekt', props.objekt.bezeichnung], ['Einheit', v.einheit]], inhalt: `<p>${esc(anrede(p))}</p>${inhalt}${gruss}` }));
      // Consent form for the tenant(s) to sign and return.
      const unterschrift = (name: string) => `<td>______________________________<br>Ort, Datum<br><br><br>______________________________<br>${esc(name)}</td>`;
      seiten.push(brief({ absender: { name: alleNamen(p), strasse: p.strasse, ort: [p.plz, p.ort].filter(Boolean).join(' ') }, empfaenger: { firma: absender.name, strasse: absender.strasse, ort: absender.ort },
        betreff: 'Zustimmung zur Mieterhöhung', info: [['Objekt', props.objekt.bezeichnung], ['Einheit', v.einheit]], datum: null,
        inhalt: absaetze(`Mietverhältnis über die Wohnung ${lage}\n\nIhrem Mieterhöhungsverlangen stimme(n) ich/wir zu: Die monatliche Nettokaltmiete erhöht sich ab dem ${datum(a.gueltig_ab)} von ${euro(alt.kaltmiete_ct)} auf ${euro(a.kaltmiete_ct)}.`) +
          `<table class="unterschriften"><tr>${unterschrift(briefName(p) || p.firma)}${p.mit ? unterschrift(briefName(p.mit) || p.mit.firma) : '<td></td>'}</tr></table>` }));
    } else {
      if (art === 'index' && index) {
        betreff = `Anpassung der Indexmiete nach § 557b BGB – ${lage}`;
        const steigt = index.n >= index.b;
        inhalt = absaetze(`in Ihrem Mietvertrag ist eine Indexmiete vereinbart: Die Nettokaltmiete folgt dem vom Statistischen Bundesamt ermittelten Verbraucherpreisindex für Deutschland (VPI, Basis 2020 = 100). Seit der letzten Festlegung der Miete hat sich der Index wie folgt entwickelt:`) +
          tabelle(['', '#rIndex'], [[`VPI ${monatText(f.basis_monat)} (Grundlage der bisherigen Miete)`, `#r${komma(index.b, 1)}`], [`VPI ${monatText(f.neu_monat)} (zuletzt veröffentlicht)`, `#r${komma(index.n, 1)}`]],
            { summe: ['Veränderung', `#r${steigt ? '+' : ''}${komma(index.prozent)} %`] }) +
          absaetze(`Die Nettokaltmiete ${steigt ? 'erhöht' : 'verringert'} sich deshalb im gleichen Verhältnis von ${euro(alt.kaltmiete_ct)} auf ${euro(a.kaltmiete_ct)} (${euro(alt.kaltmiete_ct)} × ${komma(index.n, 1)} / ${komma(index.b, 1)}), also um ${euro(Math.abs(diff))} monatlich.`) +
          mieteTabelle +
          absaetze(`Die geänderte Miete ist ab dem ${datum(a.gueltig_ab)} zu zahlen (§ 557b Abs. 3 BGB). Die bisherige Miete galt seit dem ${datum(seit)} und damit mindestens ein Jahr (§ 557b Abs. 2 BGB). ${zahlweise}`);
      } else if (art === 'staffel') {
        betreff = `Nächste Mietstaffel ab ${datum(a.gueltig_ab)} – ${lage}`;
        inhalt = absaetze(`nach der in Ihrem Mietvertrag vereinbarten Staffelmiete (§ 557a BGB) erhöht sich die Nettokaltmiete ab dem ${datum(a.gueltig_ab)} von ${euro(alt.kaltmiete_ct)} auf ${euro(a.kaltmiete_ct)}. Einer gesonderten Erklärung bedarf es nicht; dieses Schreiben dient Ihrer Erinnerung.`) +
          mieteTabelle + absaetze(zahlweise);
      } else if (art === 'modernisierung' && modern) {
        betreff = `Mieterhöhung nach Modernisierung (§ 559 BGB) – ${lage}`;
        inhalt = absaetze(`${f.ankuendigung ? `wie mit Schreiben vom ${datum(f.ankuendigung)} angekündigt, haben wir` : 'wir haben'} folgende Modernisierungsmaßnahme durchgeführt:\n${(f.massnahme ?? '').trim() || '[Beschreibung der Maßnahme]'}\n\nDie Erhöhung der jährlichen Miete berechnen wir nach § 559 BGB wie folgt:`) +
          tabelle(['', '#rBetrag'], [
            ['Aufgewendete Kosten der Maßnahme', `#r${euro(modern.kosten)}`],
            ['abzüglich ersparte Erhaltungskosten (§ 559 Abs. 2 BGB)', `#r−${euro(modern.erhaltung)}`],
            ...(modern.foerderung ? [['abzüglich Fördermittel und Zuschüsse (§ 559a BGB)', `#r−${euro(modern.foerderung)}`]] : []),
            ['Umlagefähige Kosten', `#r${euro(modern.umlage)}`],
            [`Anteil Ihrer Wohnung nach Wohnfläche (${komma(modern.wqm)} m² von ${komma(modern.gqm)} m²)`, `#r${euro(modern.anteil)}`],
            ['davon 8 % jährlich (§ 559 Abs. 1 BGB)', `#r${euro(modern.jaehrlich)}`],
          ], { summe: ['Erhöhung monatlich (÷ 12)', `#r${euro(modern.monatlich)}`] }) +
          absaetze(`Die Nettokaltmiete erhöht sich damit von ${euro(alt.kaltmiete_ct)} auf ${euro(a.kaltmiete_ct)}.${pr?.grenze_ct != null ? ` Die Grenze von ${pr.satz} € je m² Wohnfläche innerhalb von sechs Jahren ist eingehalten (§ 559 Abs. 3a BGB).` : ''}`) +
          mieteTabelle +
          absaetze(`Die erhöhte Miete ist ab dem ${datum(a.gueltig_ab)} zu zahlen (§ 559b Abs. 2 BGB). Die Rechnungen zu den Kosten können Sie nach Terminabsprache bei uns einsehen. ${zahlweise}`);
      } else if (art === 'nk_anpassung') {
        betreff = `Anpassung Ihrer Vorauszahlungen – ${lage}`;
        inhalt = absaetze(`auf Grundlage der Betriebskostenabrechnung für ${f.jahr || '[Jahr]'} passen wir Ihre monatlichen Vorauszahlungen nach § 560 Abs. 4 BGB auf eine angemessene Höhe an:`) +
          mieteTabelle + absaetze(`Die neuen Vorauszahlungen gelten ab dem ${datum(a.gueltig_ab)}. Ihre Nettokaltmiete bleibt unverändert. ${zahlweise}`);
      } else {
        inhalt = absaetze(`ab dem ${datum(a.gueltig_ab)} ändert sich Ihre monatliche Miete wie folgt:`) + mieteTabelle + absaetze(zahlweise);
      }
      seiten.push(brief({ absender, empfaenger: p, betreff, info: [['Objekt', props.objekt.bezeichnung], ['Einheit', v.einheit]], inhalt: `<p>${esc(anrede(p))}</p>${inhalt}${gruss}` }));
    }
    return { seiten, betreff };
  }

  async function pdf() {
    setLaeuft(true);
    try {
      const { seiten, betreff } = erstellen();
      const titel = betreff.replace(/ – .*$/, '');
      const dok = await alsPdfAblegen(seiten, `${titel} ${v.einheit} ${heute()}`,
        { objekt_id: props.objekt.id, einheit_id: v.einheit_id, person_id: v.person_id, typ: 'Brief', titel: `${titel} ${v.name}` });
      await window.hv.dokumentOeffnen(dok.datei);
      props.onClose();
    } catch (e) {
      setMeldung(fehlerText(e));
      setLaeuft(false);
    }
  }

  const feld = (k: string, label: string, opts: { breit?: boolean; typ?: string; platz?: string } = {}) => (
    <label className={opts.breit ? 'breit' : undefined}>{label}<input type={opts.typ ?? 'text'} value={f[k] ?? ''} placeholder={opts.platz} onChange={setze(k)} /></label>
  );

  return (
    <Dialog titel={`Brief zur Anpassung ab ${datum(a.gueltig_ab)} – ${v.name}`} onClose={props.onClose} breit aktionen={
      <button className="primary" disabled={laeuft || blockiert} title={blockiert ? 'Erst die rot markierten Punkte klären.' : undefined} onClick={pdf}>Brief erstellen und ablegen</button>}>
      <div className="maske">
        <label>Zugang beim Mieter (voraussichtlich)<input type="date" value={zugang} onChange={(e) => setZugang(e.target.value || heute())} /></label>
        <p className="klein hinweis breit">Per Post etwa drei Tage nach Versand, bei persönlicher Übergabe heute. Vom Zugang hängen die Fristen ab.</p>
        {art === 'erhoehung' && (
          <>
            <label className="breit">Begründung<select value={f.mittel} onChange={setze('mittel')}>{MITTEL.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            {f.mittel === 'mietspiegel' && (
              <>
                {feld('bezeichnung', 'Mietspiegel', { breit: true, platz: 'z. B. Mietspiegel der Stadt Musterstadt 2026' })}
                <label className="check breit"><input type="checkbox" checked={!!f.qualifiziert} onChange={(e) => setF({ ...f, qualifiziert: e.target.checked })} /> qualifizierter Mietspiegel (§ 558d BGB)</label>
                {feld('feld', 'Feld / Einordnung', { breit: true, platz: 'z. B. Baujahr 1950–1964, 60–90 m², mittlere Lage (Feld F3)' })}
                {feld('von', 'Spanne von (€/m²)')}{feld('mittelwert', 'Mittelwert (€/m²)')}{feld('bis', 'Spanne bis (€/m²)')}
                <label className="breit">Einordnung in der Spanne (Ausstattung, Lage …)<textarea rows={2} value={f.einordnung ?? ''} onChange={setze('einordnung')} /></label>
                {feld('erhaeltlich', 'Mietspiegel erhältlich (leer = liegt bei)', { breit: true, platz: 'z. B. kostenlos im Internet unter www.musterstadt.de/mietspiegel abrufbar' })}
              </>
            )}
            {f.mittel === 'vergleich' && (
              <label className="breit">Drei Vergleichswohnungen (je Zeile: Anschrift, Geschoss, Wohnfläche, Miete je m²)
                <textarea rows={4} value={f.vergleich ?? ''} onChange={setze('vergleich')} placeholder={'Musterweg 3, 2. OG links, 68 m², 9,40 €/m²\n…'} /></label>
            )}
            {(f.mittel === 'gutachten' || f.mittel === 'datenbank') && <>{feld('bezeichnung', f.mittel === 'gutachten' ? 'Sachverständige(r)' : 'Mietdatenbank', { breit: true })}{feld('wert', 'Ortsübliche Vergleichsmiete (€/m²)')}</>}
            {f.mittel !== 'mietspiegel' && <p className="klein hinweis breit">Gibt es für die Gemeinde einen qualifizierten Mietspiegel, müssen seine Werte im Schreiben trotzdem genannt werden (§ 558a Abs. 3 BGB).</p>}
          </>
        )}
        {art === 'index' && <>{feld('basis_monat', 'Indexmonat bisher (JJJJ-MM)')}{feld('basis_wert', 'Indexwert bisher')}{feld('neu_monat', 'Indexmonat neu (JJJJ-MM)')}{feld('neu_wert', 'Indexwert neu')}</>}
        {art === 'modernisierung' && (
          <>
            <label className="breit">Durchgeführte Maßnahme<textarea rows={2} value={f.massnahme ?? ''} onChange={setze('massnahme')} placeholder="z. B. Dämmung der Fassade (WDVS 14 cm) und Austausch der Fenster" /></label>
            {feld('ankuendigung', 'Modernisierungsankündigung vom', { typ: 'date' })}
            {feld('kosten', 'Kosten der Maßnahme (€)')}{feld('erhaltung', 'davon ersparte Instandsetzung (€)')}{feld('foerderung', 'Fördermittel / Zuschüsse (€)')}
            {feld('wohnung_qm', `Wohnfläche der Wohnung (m²)`, { platz: qm ? String(qm).replace('.', ',') : '' })}{feld('gesamt_qm', 'Wohnfläche aller Wohnungen (m²)', { platz: d.gesamt_qm ? String(d.gesamt_qm).replace('.', ',') : '' })}
          </>
        )}
        {art === 'nk_anpassung' && feld('jahr', 'Abrechnungsjahr')}
      </div>
      <ul className="pruefliste">
        {punkte.map((x, i) => <li key={i} className={x.ok ? 'ok' : x.hart ? 'fehler' : 'warnung'}><span>{x.text}</span>{x.aktion || null}</li>)}
      </ul>
      {meldung && <p className="fehler">{meldung}</p>}
    </Dialog>
  );
}
