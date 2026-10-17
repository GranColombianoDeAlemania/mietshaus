// Actions on a contract: recording a notice (with the matching letter) and instalment agreements for arrears.
import { useEffect, useState } from 'react';
import { alleNamen, anrede, briefName, call, datum, euro, fehlerText, heute, parseCent, type Row } from '../api';
import { useLoad } from '../useLoad';
import { Chip, Dialog } from '../ui';
import { absaetze, absenderAus, alsPdfAblegen, brief, esc, tabelle, empfaengerVon } from '../dokument';
import { L } from '../navi';
import { sollNachfrage } from './Sollstellung';

const plusMonate = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  const tag = d.getUTCDate();
  const z = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const letzter = new Date(Date.UTC(z.getUTCFullYear(), z.getUTCMonth() + 1, 0)).getUTCDate();
  z.setUTCDate(Math.min(tag, letzter));
  return z.toISOString().slice(0, 10);
};
// Signature lines for agreements both sides sign: the landlord and every tenant of the contract (p.mit).
const feld = (wer: string) => `<td>______________________________<br>Ort, Datum<br><br><br>______________________________<br>${esc(wer)}</td>`;
export const unterschriften = (p: Row) => `<table class="unterschriften"><tr>${feld('Vermieter')}${feld(`Mieter${p.mit ? ': ' + (briefName(p) || p.firma) : ''}`)}</tr>${
  p.mit ? `<tr>${feld('')}${feld(`Mieter: ${briefName(p.mit) || p.mit.firma}`)}</tr>` : ''}</table>`;


// ===================================================================================================
// Notice of termination
// ===================================================================================================
type Durch = 'mieter' | 'vermieter' | 'aufhebung';

export function Kuendigung(props: { vertrag: Row; einheit: Row; onClose: () => void }) {
  const v = props.vertrag;
  const [durch, setDurch] = useState<Durch>('mieter');
  const [art, setArt] = useState<'ordentlich' | 'fristlos'>('ordentlich');
  const [zugang, setZugang] = useState(heute());
  const [r, setR] = useState<Row | null>(null);
  const [zum, setZum] = useState('');
  const [gruende, setGruende] = useState('');
  const [termine, setTermine] = useState('');
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [op] = useLoad<Row | null>(() => (v.konto_id ? call("offenePostenKonto", v.konto_id) : Promise.resolve(null)), [v.konto_id]);
  const ueberfaellig = (op?.offen ?? []).filter((o: Row) => o.verzug >= 1);
  const monatsmiete = v.monatlich_ct || 1;
  // § 543 Abs. 2 Nr. 3 BGB: two consecutive due dates with more than one month's rent, or two months' rent in total.
  const zweiInFolge = ueberfaellig.length >= 2 && ueberfaellig.slice(-2).reduce((s: number, o: Row) => s + o.offen_ct, 0) > monatsmiete;
  const zweiMonate = ueberfaellig.reduce((s: number, o: Row) => s + o.offen_ct, 0) >= 2 * monatsmiete;
  const verzugGrund = zweiInFolge || zweiMonate;

  useEffect(() => {
    const a = durch === 'aufhebung' ? 'aufhebung' : art;
    call('kuendigungBerechnen', { vertrag_id: v.id, durch: durch === 'aufhebung' ? 'mieter' : durch, art: a, zugang })
      .then((x) => { setR(x); setZum(x.zum ?? ''); setFehler(''); }, (e) => setFehler(fehlerText(e)));
  }, [durch, art, zugang]);

  async function erfassen() {
    setLaeuft(true);
    try {
      const a = durch === 'aufhebung' ? 'aufhebung' : art;
      await call('kuendigungErfassen', { vertrag_id: v.id, durch, art: a, zugang, zum });
      await sollNachfrage('miete', v.id);
      const einst = await call('einstellungen');
      const absender = absenderAus(einst);
      const p = await empfaengerVon(v);
      const objekt = await call('get', 'objekte', props.einheit.objekt_id);
      const lage = `${props.einheit.bezeichnung}, ${[objekt.strasse, [objekt.plz, objekt.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}`;
      const widerspruch = (ende: string) => `Hinweis zu Ihrem Widerspruchsrecht (§ 568 Abs. 2, §§ 574 bis 574b BGB): Sie können der ${art === 'fristlos' ? 'hilfsweise erklärten ordentlichen ' : ''}Kündigung widersprechen und die Fortsetzung des Mietverhältnisses verlangen, wenn die Beendigung für Sie, Ihre Familie oder einen anderen Angehörigen Ihres Haushalts eine Härte bedeuten würde, die auch unter Würdigung unserer berechtigten Interessen nicht zu rechtfertigen ist. Der Widerspruch ist schriftlich zu erklären und muss uns spätestens zwei Monate vor der Beendigung des Mietverhältnisses zugehen, also bis zum ${datum(plusMonate(ende, -2))}.`;
      let titel: string, betreff: string, inhalt: string;
      if (durch === 'mieter') {
        titel = 'Kündigungsbestätigung';
        betreff = `Bestätigung Ihrer Kündigung – ${lage}`;
        inhalt = absaetze([
          `wir bestätigen, dass Ihre Kündigung des Mietverhältnisses über die Wohnung ${lage} am ${datum(zugang)} bei uns eingegangen ist.`,
          r?.rechtzeitig === false
            ? `Da die Kündigung nach dem dritten Werktag des Monats eingegangen ist, endet das Mietverhältnis unter Einhaltung der gesetzlichen Kündigungsfrist (§ 573c BGB) zum ${datum(zum)}.`
            : `Das Mietverhältnis endet unter Einhaltung der gesetzlichen Kündigungsfrist (§ 573c BGB) zum ${datum(zum)}.`,
          `Bis dahin sind die Miete und die Vorauszahlungen wie bisher zu zahlen. Bitte geben Sie die Wohnung spätestens am ${datum(zum)} vollständig geräumt und mit allen Schlüsseln zurück.`,
          termine.trim() ? `Für die Vorbesichtigung und die Wohnungsübergabe schlagen wir vor:\n${termine.trim()}\nBitte teilen Sie uns mit, ob diese Termine für Sie passen.`
            : 'Für die Vorbesichtigung und die Wohnungsübergabe melden wir uns mit Terminvorschlägen bei Ihnen.',
          'Bei der Übergabe lesen wir gemeinsam die Zählerstände ab und halten den Zustand der Wohnung in einem Übergabeprotokoll fest.',
          'Die Mietkaution rechnen wir ab, sobald alle Ansprüche aus dem Mietverhältnis feststehen. Für die noch ausstehende Betriebskostenabrechnung können wir einen angemessenen Teil vorerst einbehalten.',
          'Bitte teilen Sie uns rechtzeitig Ihre neue Anschrift und die Bankverbindung für die Rückzahlung der Kaution mit.',
        ].join('\n\n'));
      } else if (durch === 'aufhebung') {
        titel = 'Mietaufhebungsvertrag';
        betreff = `Mietaufhebungsvertrag – ${lage}`;
        inhalt = absaetze([
          `Zwischen ${absender.name} (Vermieter) und ${alleNamen(p)} (Mieter) wird über die Wohnung ${lage} Folgendes vereinbart:`,
          `1. Das Mietverhältnis endet einvernehmlich mit Ablauf des ${datum(zum)}.`,
          `2. Der Mieter gibt die Wohnung spätestens am ${datum(zum)} geräumt und mit allen Schlüsseln zurück. Über die Übergabe wird ein Protokoll erstellt, in dem auch die Zählerstände festgehalten werden.`,
          '3. Bis zum Vertragsende sind Miete und Vorauszahlungen wie bisher zu zahlen.',
          '4. Die Betriebskosten werden bis zum Vertragsende abgerechnet. Die Kaution wird abgerechnet, sobald alle gegenseitigen Ansprüche feststehen.',
          `5. Weitere Vereinbarungen: ${gruende.trim() || 'keine'}`,
        ].join('\n\n')) + unterschriften(p);
      } else if (art === 'fristlos') {
        titel = 'Fristlose Kündigung';
        betreff = `Fristlose, hilfsweise ordentliche Kündigung des Mietverhältnisses – ${lage}`;
        const ordentlich = await call('kuendigungBerechnen', { vertrag_id: v.id, durch: 'vermieter', art: 'ordentlich', zugang });
        const summe = ueberfaellig.reduce((s: number, o: Row) => s + o.offen_ct, 0);
        inhalt = absaetze(`hiermit kündigen wir das mit Ihnen bestehende Mietverhältnis über die Wohnung ${lage} fristlos aus wichtigem Grund wegen Zahlungsverzugs (§ 543 Abs. 1, Abs. 2 Satz 1 Nr. 3 BGB in Verbindung mit § 569 Abs. 3 BGB).\n\nSie sind mit der Zahlung folgender Beträge in Verzug:`)
          + tabelle(['Fällig am', 'Forderung', '#roffen'], ueberfaellig.map((o: Row) => [datum(o.datum), esc(o.text), `#r${euro(o.offen_ct)}`]), { summe: ['', 'Rückstand gesamt', `#r${euro(summe)}`] })
          + absaetze([
            gruende.trim() ? `Ergänzend: ${gruende.trim()}` : '',
            `Hilfsweise kündigen wir das Mietverhältnis ordentlich zum nächstmöglichen Termin; das ist nach unserer Berechnung der ${datum(ordentlich.zum)} (§ 573 Abs. 2 Nr. 1 BGB).`,
            'Bitte geben Sie die Wohnung unverzüglich geräumt und mit allen Schlüsseln an uns zurück. Einer stillschweigenden Fortsetzung des Mietverhältnisses (§ 545 BGB) widersprechen wir.',
            widerspruch(ordentlich.zum),
          ].filter(Boolean).join('\n\n'));
      } else {
        titel = 'Kündigung';
        betreff = `Kündigung des Mietverhältnisses – ${lage}`;
        inhalt = absaetze([
          `hiermit kündigen wir das mit Ihnen bestehende Mietverhältnis über die Wohnung ${lage} ordentlich und fristgerecht zum ${datum(zum)}.`,
          `Die Kündigung begründen wir wie folgt (§ 573 Abs. 3 BGB):\n${gruende.trim() || '[Bitte die Gründe der Kündigung einsetzen – ohne Begründung ist die Kündigung unwirksam.]'}`,
          `Bitte geben Sie die Wohnung zum ${datum(zum)} geräumt und mit allen Schlüsseln zurück. Einer stillschweigenden Fortsetzung des Mietverhältnisses (§ 545 BGB) widersprechen wir bereits jetzt.`,
          widerspruch(zum),
        ].join('\n\n'));
      }
      const gruss = durch === 'aufhebung' ? '' : `<p class="unterschrift">Mit freundlichen Grüßen<br><br><br>${esc(absender.name)}</p>`;
      const html = brief({
        absender, empfaenger: p, betreff,
        info: [['Objekt', objekt.bezeichnung], ['Einheit', props.einheit.bezeichnung]],
        inhalt: `${durch === 'aufhebung' ? '' : `<p>${esc(anrede(p))}</p>`}${inhalt}${gruss}`,
      });
      const dok = await alsPdfAblegen([html], `${titel} ${props.einheit.bezeichnung} ${heute()}`,
        { objekt_id: props.einheit.objekt_id, einheit_id: props.einheit.id, person_id: v.person_id, typ: 'Brief', titel: `${titel} ${v.name}` });
      await call('kuendigungDokument', v.id, dok.id);
      await window.hv.dokumentOeffnen(dok.datei);
      props.onClose();
    } catch (e) {
      setFehler(fehlerText(e));
      setLaeuft(false);
    }
  }

  return (
    <Dialog titel={`Kündigung erfassen – ${v.name}`} onClose={props.onClose} breit aktionen={
      <button className="primary" disabled={laeuft || !zum} onClick={erfassen}>
        {durch === 'mieter' ? 'Erfassen und Bestätigung erstellen' : durch === 'aufhebung' ? 'Erfassen und Aufhebungsvertrag erstellen' : 'Erfassen und Kündigungsschreiben erstellen'}
      </button>}>
      <div className="maske">
        <label>Wer kündigt?
          <select value={durch} onChange={(e) => setDurch(e.target.value as Durch)}>
            <option value="mieter">Mieter kündigt</option><option value="vermieter">Vermieter kündigt</option><option value="aufhebung">Aufhebungsvertrag</option>
          </select>
        </label>
        {durch === 'vermieter' && (
          <label>Art
            <select value={art} onChange={(e) => setArt(e.target.value as 'ordentlich' | 'fristlos')}>
              <option value="ordentlich">ordentlich (mit Frist)</option><option value="fristlos">fristlos wegen Zahlungsverzug</option>
            </select>
          </label>
        )}
        <label>{durch === 'vermieter' ? 'Zugang beim Mieter (geplant)' : durch === 'aufhebung' ? 'Datum der Vereinbarung' : 'Eingang der Kündigung'}<input type="date" value={zugang} onChange={(e) => setZugang(e.target.value)} /></label>
        <label>Mietverhältnis endet am<input type="date" value={zum} onChange={(e) => setZum(e.target.value)} /></label>
      </div>
      {r?.hinweise?.length > 0 && <ul className="hinweisbox liste-punkte">{r!.hinweise.map((h: string, i: number) => <li key={i}>{h}</li>)}</ul>}
      {durch === 'vermieter' && art === 'fristlos' && (
        <p className={verzugGrund ? 'hinweisbox' : 'fehler'}>
          Rückstand {euro(ueberfaellig.reduce((s: number, o: Row) => s + o.offen_ct, 0))} bei {euro(monatsmiete)} Monatsmiete:{' '}
          {verzugGrund ? 'Die Schwelle des § 543 Abs. 2 Nr. 3 BGB ist erreicht (zwei Termine in Folge mit mehr als einer Monatsmiete oder insgesamt zwei Monatsmieten).'
            : 'Die Schwelle des § 543 Abs. 2 Nr. 3 BGB ist nach den Buchungen nicht erreicht. Eine fristlose Kündigung wegen Zahlungsverzugs wäre so voraussichtlich unwirksam.'}
        </p>
      )}
      {durch === 'mieter' && (
        <p className="klein hinweis">
          Die Kündigung des Mieters braucht die Schriftform mit eigenhändiger Unterschrift (§ 568 Abs. 1 BGB) – eine E-Mail reicht nicht.
          {v.person2_id ? ' Dieses Mietverhältnis hat zwei Mieter: Beide müssen unterschrieben haben, sonst ist die Kündigung unwirksam.' : ''}
        </p>
      )}
      {durch === 'mieter' && (
        <label className="block">Terminvorschläge für Vorbesichtigung und Übergabe (optional, eine Zeile je Termin)
          <textarea className="brieftext" rows={3} value={termine} onChange={(e) => setTermine(e.target.value)} placeholder={'Vorbesichtigung: Mittwoch, 18.11., 17 Uhr\nÜbergabe: Donnerstag, 31.12., 10 Uhr'} />
        </label>
      )}
      {durch !== 'mieter' && (
        <label className="block">{durch === 'aufhebung' ? 'Weitere Vereinbarungen (optional)' : art === 'fristlos' ? 'Ergänzende Begründung (optional)' : 'Gründe der Kündigung (Pflicht, § 573 Abs. 3 BGB)'}
          <textarea className="brieftext" rows={4} value={gruende} onChange={(e) => setGruende(e.target.value)} />
        </label>
      )}
      {durch === 'vermieter' && (
        <p className="klein hinweis">
          Eine Kündigung des Vermieters muss eigenhändig unterschrieben im Original zugehen (Schriftform, § 568 Abs. 1 BGB) – E-Mail oder Fax reichen nicht.
          Bei mehreren Mietern an alle richten. Den Zugang nachweisbar machen, etwa durch einen Boten mit Zeugen.
        </p>
      )}
      <p className="klein hinweis">Beim Erfassen wird das Vertragsende eingetragen und ein Vorgang „Mieterwechsel“ mit den nächsten Schritten angelegt. Das Schreiben wird im Archiv bei {v.name} abgelegt.</p>
      {fehler && <p className="fehler">{fehler}</p>}
    </Dialog>
  );
}

// ===================================================================================================
// Instalment agreement
// ===================================================================================================
export function Ratenplan(props: { vertrag: Row; einheit: Row; kontoId: number; rueckstand: number; onClose: () => void }) {
  const v = props.vertrag;
  const naechster15 = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 15)).toISOString().slice(0, 10); };
  const [betrag, setBetrag] = useState((props.rueckstand / 100).toFixed(2).replace('.', ','));
  const [rate, setRate] = useState('');
  const [erste, setErste] = useState(naechster15());
  const [verfall, setVerfall] = useState(14);
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [op] = useLoad<Row>(() => call('offenePostenKonto', props.kontoId), [props.kontoId]);
  const gesamt = parseCent(betrag), r = parseCent(rate);
  const plan: { faellig: string; betrag: number }[] = [];
  for (let rest = gesamt, i = 0; r > 0 && rest > 0 && i < 120; i++) { plan.push({ faellig: plusMonate(erste, i), betrag: Math.min(r, rest) }); rest -= Math.min(r, rest); }
  const monate = (op?.offen ?? []).filter((o: Row) => o.verzug >= 1).map((o: Row) => o.text).join(', ');

  async function anlegen() {
    setLaeuft(true);
    try {
      if (!plan.length) throw new Error('Bitte Rückstand und Rate angeben.');
      const id = await call('ratenplanAnlegen', { konto_id: props.kontoId, datum: heute(), betrag_ct: gesamt, rate_ct: r, erste_rate: erste });
      const einst = await call('einstellungen');
      const absender = absenderAus(einst);
      const p = await empfaengerVon(v);
      const objekt = await call('get', 'objekte', props.einheit.objekt_id);
      const iban = objekt.iban || absender.iban;
      const lage = `${props.einheit.bezeichnung}, ${[objekt.strasse, [objekt.plz, objekt.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}`;
      const mieter = alleNamen(p);
      const letzte = plan[plan.length - 1];
      const text = [
        `Zwischen ${absender.name} (Vermieter) und ${mieter} (Mieter) wird zum Mietverhältnis über die Wohnung ${lage} folgende Ratenzahlung vereinbart:`,
        `1. Der Mieter erkennt an, dem Vermieter zum ${datum(heute())} aus dem Mietverhältnis ${euro(gesamt)} zu schulden${monate ? ` (rückständige Zahlungen für ${monate})` : ''}.`,
        `2. Der Vermieter ist damit einverstanden, dass der Mieter diesen Betrag in monatlichen Raten von ${euro(r)} zahlt. Die erste Rate ist am ${datum(erste)} fällig, die weiteren jeweils am ${Number(erste.slice(8, 10))}. der folgenden Monate, die letzte Rate über ${euro(letzte.betrag)} am ${datum(letzte.faellig)}.`,
        '3. Die Raten sind zusätzlich zur laufenden Miete und den Vorauszahlungen zu zahlen. Diese bleiben unverändert zu den vertraglich vereinbarten Terminen fällig.',
        `4. Gerät der Mieter mit einer Rate ganz oder teilweise länger als ${verfall} Tage in Verzug, wird der gesamte dann noch offene Betrag sofort in einer Summe fällig.`,
        '5. Im Übrigen bleiben die Rechte aus dem Mietvertrag unberührt, insbesondere wegen künftiger Zahlungsrückstände.',
        `6. Zahlungen bitte auf das Konto ${iban ? `IBAN ${iban}` : 'des Vermieters'} mit dem Verwendungszweck „Rate ${mieter}“.`,
      ].join('\n\n');
      const tab = tabelle(['Rate', 'Fällig am', '#rBetrag'], plan.map((x, i) => [String(i + 1), datum(x.faellig), `#r${euro(x.betrag)}`]), { summe: ['', 'Summe', `#r${euro(gesamt)}`] });
      const html = brief({
        absender, empfaenger: p, betreff: `Ratenzahlungsvereinbarung – ${lage}`,
        info: [['Objekt', objekt.bezeichnung], ['Einheit', props.einheit.bezeichnung]],
        inhalt: `${absaetze(text)}<h2>Zahlungsplan</h2>${tab}${unterschriften(p)}`,
      });
      const dok = await alsPdfAblegen([html], `Ratenzahlungsvereinbarung ${props.einheit.bezeichnung} ${heute()}`,
        { objekt_id: props.einheit.objekt_id, einheit_id: props.einheit.id, person_id: v.person_id, typ: 'Vertrag', titel: `Ratenzahlungsvereinbarung ${v.name}` });
      await call('ratenplanSetzen', id, { dokument_id: dok.id });
      await window.hv.dokumentOeffnen(dok.datei);
      props.onClose();
    } catch (e) {
      setFehler(fehlerText(e));
      setLaeuft(false);
    }
  }

  return (
    <Dialog titel={`Ratenzahlung vereinbaren – ${v.name}`} onClose={props.onClose} breit aktionen={
      <button className="primary" disabled={laeuft || !plan.length} onClick={anlegen}>Vereinbarung erstellen (PDF)</button>}>
      <div className="maske">
        <label>Rückstand (€)<input className="num" value={betrag} onChange={(e) => setBetrag(e.target.value)} /></label>
        <label>Monatliche Rate (€)<input className="num" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="z. B. 200,00" /></label>
        <label>Erste Rate am<input type="date" value={erste} onChange={(e) => setErste(e.target.value)} /></label>
        <label>Gesamtfälligkeit nach Verzug von (Tagen)<input className="num" type="number" value={verfall} onChange={(e) => setVerfall(Number(e.target.value) || 14)} /></label>
      </div>
      {plan.length > 0 && <p className="hinweisbox">{plan.length} Raten, letzte Rate am {datum(plan[plan.length - 1].faellig)} über {euro(plan[plan.length - 1].betrag)}. Die Raten kommen zur laufenden Miete hinzu.</p>}
      <p className="klein hinweis">Das Programm verfolgt die Raten: Zahlungen des Mieters tilgen zuerst die ältesten offenen Monate. Bleibt eine Rate aus, meldet sich das Cockpit. Die Vereinbarung wird beim Mieter im Archiv abgelegt; beide sollten sie unterschreiben.</p>
      {fehler && <p className="fehler">{fehler}</p>}
    </Dialog>
  );
}

// Plans of a contract with their progress.
export function RatenplanListe(props: { plaene: Row[]; onAenderung: () => void }) {
  return <div className="ratenplaene">{props.plaene.map((p) => <RatenplanZeile key={p.id} plan={p} onAenderung={props.onAenderung} />)}</div>;
}

function RatenplanZeile(props: { plan: Row; onAenderung: () => void }) {
  const [s] = useLoad<Row>(() => call('ratenplanStand', props.plan.id), [props.plan.id, props.plan.status]);
  const p = props.plan;
  if (!s) return null;
  const status = p.status !== 'aktiv' ? <Chip>{p.status === 'erfuellt' ? 'erfüllt' : p.status}</Chip>
    : s.erfuellt ? <Chip art="gruen">vollständig bezahlt</Chip> : s.verzug_ct > 0 ? <Chip art="rot">Rate offen: {euro(s.verzug_ct)}</Chip> : <Chip art="gruen">im Plan</Chip>;
  const setzen = async (status: string) => { await call('ratenplanSetzen', p.id, { status }); props.onAenderung(); };
  return (
    <div className="ratenplan">
      <div className="zeile"><b>Ratenzahlung vom {datum(p.datum)}</b>{status}<span className="spacer" />
        {p.dokument_id && <L zu={{ dokument: p.dokument_id }}>Vereinbarung</L>}
        {p.status === 'aktiv' && <button className="klein" onClick={() => setzen(s.erfuellt ? 'erfuellt' : 'beendet')}>{s.erfuellt ? 'Als erfüllt abschließen' : 'Beenden'}</button>}
      </div>
      <div className="fortschritt" title={`${euro(s.getilgt_ct)} von ${euro(p.betrag_ct)} getilgt`}><span style={{ width: `${Math.min(100, (100 * s.getilgt_ct) / p.betrag_ct)}%` }} /></div>
      <div className="klein hinweis">{euro(s.getilgt_ct)} von {euro(p.betrag_ct)} getilgt · Rate {euro(p.rate_ct)} · {s.naechste ? `nächste Rate ${datum(s.naechste.faellig)}` : 'keine Rate mehr offen'}
        {s.neue_rueckstaende_ct > 0 ? ` · neue Rückstände seit der Vereinbarung: ${euro(s.neue_rueckstaende_ct)}` : ''}</div>
    </div>
  );
}

// ===================================================================================================
// Standing invoice for a commercial letting with VAT (§ 14 Abs. 4 UStG): together with the monthly payment
// it serves as the invoice for each month.
// ===================================================================================================
export async function dauerrechnung(v: Row, e: Row) {
  const einst = await call('einstellungen');
  if (!einst.verwalter_steuernr && !einst.verwalter_ustid) throw new Error('Für eine Rechnung braucht es deine Steuernummer oder USt-IdNr. – bitte unter Einstellungen eintragen.');
  const absender = absenderAus(einst);
  const p = await empfaengerVon(v);
  const objekt = await call('get', 'objekte', e.objekt_id);
  const b = await call('betraege', 'miete', v.id, heute() < v.beginn ? v.beginn : heute());
  const nr = einst.rechnungsnr_naechste || `${new Date().getFullYear()}-001`;
  const ab = heute() < v.beginn ? v.beginn : `${heute().slice(0, 7)}-01`;
  const satz = Number(v.ust_satz) || 19;
  const posten: [string, number][] = [[v.bk_art === 'inklusiv' ? 'Kaltmiete inkl. Betriebskosten' : 'Nettokaltmiete', b.kaltmiete_ct ?? 0],
    [v.bk_art === 'pauschale' ? 'Betriebskostenpauschale' : 'Betriebskosten-Vorauszahlung', b.bk_vz_ct ?? 0],
    ['Heizkosten-Vorauszahlung', b.hk_vz_ct ?? 0], ['Sonstiges', b.sonstiges_ct ?? 0]].filter(([, ct]) => ct) as [string, number][];
  const netto = posten.reduce((s, [, ct]) => s + ct, 0);
  const ust = Math.round(netto * satz / 100);
  const lage = `${e.bezeichnung}${e.lage ? ` (${e.lage})` : ''}, ${[objekt.strasse, [objekt.plz, objekt.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}`;
  const tab = tabelle(['Leistung', '#rnetto monatlich'], posten.map(([l, ct]) => [esc(l), `#r${euro(ct)}`]),
    { summe: ['Summe netto', `#r${euro(netto)}`] }) + tabelle(['', '#rBetrag'], [[`zuzüglich ${satz} % Umsatzsteuer`, `#r${euro(ust)}`]],
    { summe: ['Monatlich zu zahlen (brutto)', `#r${euro(netto + ust)}`] });
  const html = brief({
    absender, empfaenger: p, betreff: `Dauerrechnung Nr. ${nr} – Miete ${e.bezeichnung}`,
    info: [['Rechnungsnummer', nr], [einst.verwalter_ustid ? 'USt-IdNr.' : 'Steuernummer', einst.verwalter_ustid || einst.verwalter_steuernr], ['Objekt', objekt.bezeichnung]],
    inhalt: `<p>${esc(anrede(p))}</p>${absaetze(`für die Vermietung der Gewerbeeinheit ${lage} stellen wir Ihnen gemäß Mietvertrag vom ${datum(v.beginn)} folgende monatliche Leistung in Rechnung:`)}
      ${tab}${absaetze([`Leistungszeitraum: monatlich ab ${datum(ab)}, jeweils für den laufenden Kalendermonat. Fällig ${v.faelligkeitstag === 0 ? 'bis zum 3. Werktag' : `am ${v.faelligkeitstag}.`} eines jeden Monats.`,
        'Diese Rechnung gilt als Dauerrechnung bis zu einer Änderung der Beträge oder des Steuersatzes. Zusammen mit dem jeweiligen Zahlungsbeleg erfüllt sie die Anforderungen an eine Rechnung nach § 14 UStG. Die Vermietung erfolgt steuerpflichtig aufgrund der Option nach § 9 UStG.',
        objekt.iban ? `Bitte überweisen Sie auf IBAN ${objekt.iban}${objekt.bank ? ` (${objekt.bank})` : ''}.` : ''].filter(Boolean).join('\n\n'))}
      <p class="unterschrift">Mit freundlichen Grüßen<br><br>${esc(absender.name)}</p>`,
  });
  const dok = await alsPdfAblegen([html], `Dauerrechnung ${nr} ${e.bezeichnung}`, { objekt_id: e.objekt_id, einheit_id: e.id, person_id: v.person_id, typ: 'Rechnung', titel: `Dauerrechnung ${nr} ${v.name}` });
  // Next number: the trailing digits count up.
  const naechste = /\d+$/.test(nr) ? nr.replace(/\d+$/, (n: string) => String(Number(n) + 1).padStart(n.length, '0')) : `${nr}-2`;
  await call('setzeEinstellungen', { rechnungsnr_naechste: naechste });
  await window.hv.dokumentOeffnen(dok.datei);
}
