// Owners' meetings with agenda and votes, the resolution register and contact roles (advisory board, caretaker …).
import { useState } from 'react';
import { anrede, call, datum, fehler, heute, personName, zahl, type Row } from '../api';
import { useLoad } from '../useLoad';
import { L } from '../navi';
import { Liste } from '../Liste';
import { Dialog, Tabs } from '../ui';
import { FormDialog, type Field } from '../Form';
import { absaetze, absenderAus, alsPdf, bericht, brief, esc, tabelle } from '../dokument';
import { bestaetigen, hinweis } from '../frage';

const ABSTIMMUNG: [string, string][] = [['kopf', 'nach Köpfen (§ 25 WEG)'], ['mea', 'nach Miteigentumsanteilen'], ['objekt', 'nach Einheiten']];

export function Versammlungen(props: { objekt: Row }) {
  const [offen, setOffen] = useState<number | null>(null);
  return (
    <>
      <Liste titel="Eigentümerversammlungen" table="versammlungen" filter={{ objekt_id: props.objekt.id }} order="datum DESC"
        neuLabel="Neue Versammlung" neu={{ art: 'ordentlich', uhrzeit: '18:00', einladung_weg: 'post' }}
        spalten={[['Datum', (r) => `${datum(r.datum)} ${r.uhrzeit ?? ''}`], ['Art', (r) => (r.art === 'ordentlich' ? 'ordentlich' : 'außerordentlich')], ['Ort', (r) => r.ort],
          ['Einladung', (r) => datum(r.einladung_am)]]}
        fields={[{ key: 'datum', label: 'Datum', type: 'date', required: true }, { key: 'uhrzeit', label: 'Uhrzeit' }, { key: 'ort', label: 'Ort', wide: true },
          { key: 'art', label: 'Art', type: 'select', required: true, options: [['ordentlich', 'Ordentliche Versammlung'], ['ausserordentlich', 'Außerordentliche Versammlung']] },
          { key: 'einladung_weg', label: 'Einladung', type: 'select', options: [['post', 'per Post (3 Tage Postlauf)'], ['email', 'per E-Mail'], ['hand', 'persönlich übergeben']] },
          { key: 'einladung_am', label: 'Einladung versandt am', type: 'date' }, { key: 'leitung', label: 'Versammlungsleitung' }, { key: 'protokoll', label: 'Protokollführung' },
          { key: 'notiz', label: 'Notiz', type: 'textarea' }]}
        aktionen={(r) => <button onClick={() => setOffen(r.id)}>Versammlung durchführen</button>} />
      {offen && <Versammlung id={offen} objekt={props.objekt} onClose={() => setOffen(null)} />}
    </>
  );
}

const MEHRHEIT: [string, string][] = [['einfach', 'einfache Mehrheit (§ 25 WEG)'], ['doppelt', 'doppelt qualifiziert: > 2/3 der Stimmen und > 1/2 der MEA (§ 21 Abs. 2)'],
  ['dreiviertel', 'drei Viertel der abgegebenen Stimmen (§ 23 Abs. 1a)'], ['allstimmig', 'Zustimmung aller Eigentümer']];
const WEG: [string, string][] = [['post', 'per Post (3 Tage Postlauf)'], ['email', 'per E-Mail'], ['hand', 'persönlich übergeben']];
type Schritt = 'daten' | 'tops' | 'einladung' | 'anwesend' | 'abstimmung' | 'protokoll';
const SCHRITTE: [Schritt, string][] = [['daten', '1 Grunddaten'], ['tops', '2 Tagesordnung'], ['einladung', '3 Einladung'], ['anwesend', '4 Anwesenheit'], ['abstimmung', '5 Abstimmung'], ['protokoll', '6 Protokoll']];
const plusTageIso = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// Guided meeting like the professional programs: basic data → agenda → invitation (deadline from receipt) → attendance →
// votes per owner → minutes and register.
function Versammlung(props: { id: number; objekt: Row; onClose: () => void }) {
  const [v, reload] = useLoad<Row>(() => call('versammlung', props.id), [props.id]);
  const [eigentuemer] = useLoad<Row[]>(() => (v ? call('stimmen', props.objekt.id, 'kopf', v.datum) : Promise.resolve([])), [v?.datum]);
  const [anwesend, ladeAnwesend] = useLoad<Row[]>(() => call('anwesenheit', props.id), [props.id]);
  const [rollen] = useLoad<Row[]>(() => call('rollenListe', props.objekt.id), [props.objekt.id]);
  const [schritt, setSchritt] = useState<Schritt>('daten');
  const [edit, setEdit] = useState<Row | null>(null);
  const [daten, setDaten] = useState<Row | null>(null);
  const [abstimmen, setAbstimmen] = useState<Row | null>(null);
  const [liste, setListe] = useState<Record<number, { status: string; vertreter: string }>>({});

  const felder: Field[] = [
    { key: 'nr', label: 'TOP Nr.', type: 'number', required: true }, { key: 'titel', label: 'Titel', required: true, wide: true },
    { key: 'erlaeuterung', label: 'Erläuterung', type: 'textarea' }, { key: 'beschlussvorschlag', label: 'Beschlussvorschlag', type: 'textarea' },
    { key: 'abstimmungsart', label: 'Stimmrecht', type: 'select', required: true, options: ABSTIMMUNG },
    { key: 'mehrheit', label: 'Erforderliche Mehrheit', type: 'select', required: true, options: MEHRHEIT },
  ];
  const datenFelder: Field[] = [{ key: 'datum', label: 'Datum', type: 'date', required: true }, { key: 'uhrzeit', label: 'Beginn' }, { key: 'ende', label: 'Ende' },
    { key: 'ort', label: 'Ort', wide: true }, { key: 'art', label: 'Art', type: 'select', required: true, options: [['ordentlich', 'Ordentliche Versammlung'], ['ausserordentlich', 'Außerordentliche Versammlung']] },
    { key: 'virtuell', label: 'Nur online (Beschluss mit 3/4 nötig, § 23 Abs. 1a WEG)', type: 'check' },
    { key: 'einladung_weg', label: 'Einladung', type: 'select', required: true, options: WEG }, { key: 'einladung_am', label: 'Einladung versandt am', type: 'date' },
    { key: 'leitung', label: 'Versammlungsleitung' }, { key: 'protokoll', label: 'Protokollführung' }, { key: 'notiz', label: 'Notiz', type: 'textarea' }];

  if (!v) return null;
  const postlauf = (v.einladung_weg ?? 'post') === 'post' ? 3 : 0;
  const spaetestens = plusTageIso(v.datum, -21 - postlauf);
  const fristOk = v.einladung_am ? plusTageIso(v.einladung_am, postlauf) <= plusTageIso(v.datum, -21) : heute() <= spaetestens;
  const beirat = (rollen ?? []).find((r) => r.rolle === 'beiratsvorsitz' && (!r.bis || r.bis >= v.datum));
  const status = (pid: number) => liste[pid]?.status ?? (anwesend ?? []).find((a) => a.person_id === pid)?.status ?? '';
  const vertreter = (pid: number) => liste[pid]?.vertreter ?? (anwesend ?? []).find((a) => a.person_id === pid)?.vertreter ?? '';
  const nachEinladung = (t: Row) => !!(v.einladung_am && t.angelegt && t.angelegt > v.einladung_am);

  async function einladung() {
    if (!v) return;
    if (!fristOk && !await bestaetigen(`Die Einladung geht ${postlauf ? 'per Post ' : ''}nicht mehr drei Wochen vor der Versammlung zu (spätestens ${datum(spaetestens)} verschicken, § 24 Abs. 4 WEG). Beschlüsse wären anfechtbar. Trotzdem erstellen?`)) return;
    const einst = await call('einstellungen');
    const liste = await call('stimmen', props.objekt.id, 'kopf', v.datum);
    const tops = v.tops.map((t: Row) => `<p><b>TOP ${t.nr}: ${esc(t.titel)}</b>${t.beschlussvorschlag ? ' (Beschlussfassung)' : ''}${t.erlaeuterung ? `<br>${esc(t.erlaeuterung)}` : ''}${t.beschlussvorschlag ? `<br><i>Beschlussvorschlag:</i> ${esc(t.beschlussvorschlag)}` : ''}</p>`).join('');
    const seiten = [];
    const titel = `Einladung zur ${v.art === 'ordentlich' ? 'ordentlichen' : 'außerordentlichen'} Eigentümerversammlung – ${props.objekt.bezeichnung}`;
    for (const e of liste) {
      // Each co-owner gets the invitation (they vote together, but each must be invited).
      for (const pid of [e.person_id, ...(e.mit ?? [])]) {
        const p = await call('get', 'personen', pid);
        seiten.push(brief({ absender: absenderAus(einst), empfaenger: p, betreff: titel, info: [['Objekt', props.objekt.bezeichnung]],
          inhalt: `<p>${esc(anrede(p))}</p>${absaetze(`hiermit laden wir Sie zur Eigentümerversammlung ein:\n\nDatum: ${datum(v.datum)}, ${v.uhrzeit ?? ''} Uhr\nOrt: ${v.virtuell ? 'online – die Zugangsdaten folgen rechtzeitig' : v.ort ?? ''}`)}
            <h2>Tagesordnung</h2>${tops}${absaetze('Sollten Sie verhindert sein, können Sie sich durch eine Person Ihres Vertrauens vertreten lassen; die Vollmacht muss in Textform vorliegen (§ 25 Abs. 3 WEG). Ein Vordruck liegt bei. Die Versammlung ist unabhängig von der Zahl der Anwesenden beschlussfähig (§ 25 Abs. 1 WEG).')}
            <p class="unterschrift">Mit freundlichen Grüßen<br><br>${esc(einst.verwalter_name ?? '')}</p>` }));
        seiten.push(brief({ absender: absenderAus(einst), empfaenger: p, betreff: `Vollmacht für die Eigentümerversammlung am ${datum(v.datum)}`, info: [['Objekt', props.objekt.bezeichnung]],
          inhalt: absaetze(`Ich, ${personName(p)}, Eigentümer/in von ${e.einheiten.join(', ')}, bevollmächtige\n\n______________________________________ (Name, Anschrift)\n\nmich in der Eigentümerversammlung am ${datum(v.datum)} zu vertreten und das Stimmrecht für mich auszuüben – ohne Weisung / mit folgenden Weisungen:\n\n______________________________________\n\n______________________________________\n\nOrt, Datum, Unterschrift: ______________________________________`) }));
      }
    }
    await alsPdf(seiten, `Einladung Versammlung ${props.objekt.bezeichnung} ${v.datum}`);
    if (!v.einladung_am) { await call('save', 'versammlungen', { id: v.id, einladung_am: heute() }); reload(); }
  }

  async function anwesenheitSpeichern() {
    await call('anwesenheitSpeichern', props.id, (eigentuemer ?? []).map((e) => ({ person_id: e.person_id, status: status(e.person_id), vertreter: vertreter(e.person_id) })));
    setListe({}); ladeAnwesend(); setSchritt('abstimmung');
  }

  async function protokoll() {
    if (!v) return;
    const da = (eigentuemer ?? []).filter((e) => status(e.person_id));
    const anwesenheit = da.length ? tabelle(['Eigentümer', 'Einheiten', 'anwesend'], da.map((e) => [esc(e.name), esc(e.einheiten.join(', ')), status(e.person_id) === 'vertreten' ? `vertreten durch ${esc(vertreter(e.person_id) || '–')}` : 'persönlich'])) : '<p>Anwesenheit nicht erfasst.</p>';
    const inhalt = `<p>Datum: ${datum(v.datum)} · Beginn: ${v.uhrzeit ?? '–'} Uhr · Ende: ${v.ende ?? '–'} Uhr · Ort: ${esc(v.virtuell ? 'online' : v.ort ?? '')}<br>Versammlungsleitung: ${esc(v.leitung ?? '')} · Protokoll: ${esc(v.protokoll ?? '')}</p>
      <h2>Anwesenheit</h2>${anwesenheit}<p>Die Versammlung ist ordnungsgemäß einberufen (Einladung vom ${datum(v.einladung_am)}) und unabhängig von der Zahl der Anwesenden beschlussfähig (§ 25 Abs. 1 WEG).</p>` +
      v.tops.map((t: Row) => `<h2>TOP ${t.nr}: ${esc(t.titel)}</h2>${t.erlaeuterung ? absaetze(t.erlaeuterung) : ''}
        ${t.beschlussvorschlag ? `<p><i>Beschlussantrag:</i> ${esc(t.beschlussvorschlag)}</p>` : ''}
        ${t.ja != null ? `<p>Abstimmung ${ABSTIMMUNG.find(([a]) => a === t.abstimmungsart)?.[1]}, erforderlich: ${MEHRHEIT.find(([m]) => m === (t.mehrheit ?? 'einfach'))?.[1]}: Ja ${zahl(t.ja)}, Nein ${zahl(t.nein ?? 0)}, Enthaltung ${zahl(t.enthaltung ?? 0)}.</p>
        <p class="hervor">Der Versammlungsleiter stellt fest und verkündet: Beschluss ${esc(t.ergebnis ?? '')}.</p>` : ''}`).join('') +
      `<p class="unterschrift">____________________________ &nbsp;&nbsp; ____________________________${beirat ? ' &nbsp;&nbsp; ____________________________' : ''}<br>Versammlungsleitung &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Wohnungseigentümer/in${beirat ? ` &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Beiratsvorsitz (${esc(beirat.name)})` : ''}</p>
      <p class="klein">Unterschrieben von Versammlungsleitung, einem Wohnungseigentümer und – wenn ein Beirat bestellt ist – dem Beiratsvorsitz (§ 24 Abs. 6 WEG).</p>`;
    await alsPdf([bericht(`Protokoll der Eigentümerversammlung`, props.objekt.bezeichnung, inhalt)], `Protokoll ${props.objekt.bezeichnung} ${v.datum}`);
  }

  async function aufgabe(t: Row) {
    await call('save', 'vorgaenge', { objekt_id: props.objekt.id, titel: `Beschluss umsetzen: ${t.titel}`, kategorie: 'Beschluss', status: 'offen', prioritaet: 1,
      beschreibung: `Beschluss vom ${datum(v!.datum)}, TOP ${t.nr}:\n${t.beschlussvorschlag ?? ''}` });
    hinweis('Aufgabe angelegt.');
  }

  const topTabelle = (mitAbstimmen: boolean) => (
    <table>
      <thead><tr><th>TOP</th><th>Titel</th><th>Mehrheit</th><th className="num">Ja</th><th className="num">Nein</th><th className="num">Enth.</th><th>Ergebnis</th><th /></tr></thead>
      <tbody>
        {v.tops.map((t: Row) => (
          <tr key={t.id} onDoubleClick={() => setEdit(t)}>
            <td>{t.nr}</td><td>{t.titel}{nachEinladung(t) && <div className="klein negativ">nach der Einladung angelegt – nur beschließen, wenn er angekündigt war</div>}</td>
            <td className="klein">{(MEHRHEIT.find(([m]) => m === (t.mehrheit ?? 'einfach'))?.[1] ?? '').replace(/ \(.*$/, '')}</td>
            <td className="num">{zahl(t.ja)}</td><td className="num">{zahl(t.nein)}</td><td className="num">{zahl(t.enthaltung)}</td>
            <td>{t.ergebnis ? <span className={`tag ${t.ergebnis === 'angenommen' ? 'art-weg' : ''}`}>{t.ergebnis}</span> : ''}</td>
            <td className="aktionen">
              {mitAbstimmen && t.beschlussvorschlag && <button onClick={() => setAbstimmen(t)}>Abstimmen</button>}
              {!mitAbstimmen && <button onClick={() => setEdit(t)}>Bearbeiten</button>}
              {t.ergebnis === 'angenommen' && <button onClick={() => aufgabe(t)}>Aufgabe</button>}
            </td>
          </tr>
        ))}
        {!v.tops.length && <tr><td colSpan={8} className="hinweis">Noch keine Tagesordnungspunkte.</td></tr>}
      </tbody>
    </table>
  );

  const nr = SCHRITTE.findIndex(([k]) => k === schritt);
  return (
    <Dialog titel={`Versammlung am ${datum(v.datum)}`} onClose={props.onClose} breit aktionen={<>
      {nr > 0 && <button onClick={() => setSchritt(SCHRITTE[nr - 1][0])}>Zurück</button>}
      {nr < SCHRITTE.length - 1 && <button className="primary" onClick={() => setSchritt(SCHRITTE[nr + 1][0])}>Weiter</button>}</>}>
      <Tabs tabs={SCHRITTE} value={schritt} onChange={setSchritt} />
      <div style={{ marginTop: 12 }}>
        {schritt === 'daten' && (
          <>
            <table><tbody>
              <tr><td>Datum, Zeit</td><td>{datum(v.datum)} {v.uhrzeit ?? ''}{v.ende ? ` – ${v.ende}` : ''}</td></tr>
              <tr><td>Ort</td><td>{v.virtuell ? 'online' : v.ort ?? '–'}</td></tr>
              <tr><td>Einladung</td><td>{WEG.find(([k]) => k === (v.einladung_weg ?? 'post'))?.[1]}{v.einladung_am ? `, versandt ${datum(v.einladung_am)}` : ''}</td></tr>
              <tr><td>Leitung / Protokoll</td><td>{v.leitung ?? '–'} / {v.protokoll ?? '–'}</td></tr>
            </tbody></table>
            <div className="buttons"><button onClick={() => setDaten(v)}>Grunddaten bearbeiten</button></div>
          </>
        )}
        {schritt === 'tops' && (<>{topTabelle(false)}<div className="buttons"><button className="primary" onClick={() => setEdit({ nr: (v.tops.at(-1)?.nr ?? 0) + 1, abstimmungsart: 'kopf', mehrheit: v.virtuell ? 'dreiviertel' : 'einfach' })}>TOP hinzufügen</button></div></>)}
        {schritt === 'einladung' && (
          <>
            <p className={fristOk ? 'hinweis' : 'fehler'}>
              Ladungsfrist drei Wochen ab Zugang (§ 24 Abs. 4 WEG): {v.einladung_am
                ? `versandt am ${datum(v.einladung_am)}${postlauf ? ', Zugang nach 3 Tagen Postlauf' : ''} – ${fristOk ? 'eingehalten' : 'nicht eingehalten, Beschlüsse wären anfechtbar; Termin verschieben'}.`
                : `spätestens am ${datum(spaetestens)} ${postlauf ? 'per Post ' : ''}verschicken${fristOk ? '' : ' – dieser Tag ist vorbei'}.`}
            </p>
            <p className="klein hinweis">Jeder Eigentümer bekommt eine Einladung, bei mehreren Eigentümern einer Wohnung jeder einzeln, dazu einen Vordruck für die Vollmacht.</p>
            <div className="buttons"><button className="primary" onClick={einladung}>Einladungen erstellen (PDF)</button></div>
          </>
        )}
        {schritt === 'anwesend' && (
          <>
            <table>
              <thead><tr><th>Eigentümer</th><th>Einheiten</th><th>Anwesend</th><th>Vertreten durch</th></tr></thead>
              <tbody>{(eigentuemer ?? []).map((e) => (
                <tr key={e.person_id}><td>{e.name}</td><td className="klein">{e.einheiten.join(', ')}</td>
                  <td><select value={status(e.person_id)} onChange={(ev) => setListe({ ...liste, [e.person_id]: { status: ev.target.value, vertreter: vertreter(e.person_id) } })}>
                    <option value="">abwesend</option><option value="anwesend">anwesend</option><option value="vertreten">vertreten</option></select></td>
                  <td>{status(e.person_id) === 'vertreten' && <input value={vertreter(e.person_id)} placeholder="Name (Vollmacht in Textform)" onChange={(ev) => setListe({ ...liste, [e.person_id]: { status: 'vertreten', vertreter: ev.target.value } })} />}</td></tr>
              ))}</tbody>
            </table>
            <div className="buttons"><span className="spacer" /><button className="primary" onClick={anwesenheitSpeichern}>Anwesenheit speichern</button></div>
          </>
        )}
        {schritt === 'abstimmung' && topTabelle(true)}
        {schritt === 'protokoll' && (
          <>
            <p className="klein hinweis">Das Protokoll enthält Anwesenheit, Beginn und Ende, die Abstimmungen mit erforderlicher Mehrheit und die Feststellung jedes Ergebnisses. Unterschriftszeilen: Versammlungsleitung, ein Eigentümer{beirat ? `, Beiratsvorsitz (${beirat.name})` : ''}.</p>
            <div className="buttons"><button className="primary" onClick={protokoll}>Protokoll erstellen (PDF)</button></div>
          </>
        )}
      </div>
      {edit && <FormDialog title="Tagesordnungspunkt" row={edit} fields={felder}
        onSave={(r) => call('save', 'tops', { ...r, versammlung_id: v.id })} onDelete={() => call('remove', 'tops', edit.id)}
        onClose={() => { setEdit(null); reload(); }} />}
      {daten && <FormDialog title="Grunddaten der Versammlung" row={daten} fields={datenFelder}
        onSave={(r) => call('save', 'versammlungen', { ...r, id: v.id, objekt_id: v.objekt_id })} onClose={() => { setDaten(null); reload(); }} />}
      {abstimmen && <Abstimmung top={abstimmen} objekt={props.objekt} datum={v.datum} anwesend={anwesend ?? []} nachEinladung={nachEinladung(abstimmen)} onClose={() => { setAbstimmen(null); reload(); }} />}
    </Dialog>
  );
}

// Vote entry: each owner's vote (absent owners preselected from the attendance); the result follows the required majority.
function Abstimmung(props: { top: Row; objekt: Row; datum: string; anwesend: Row[]; nachEinladung: boolean; onClose: () => void }) {
  const [art, setArt] = useState(props.top.abstimmungsart);
  const [liste] = useLoad<Row[]>(() => call('stimmen', props.objekt.id, art, props.datum), [art]);
  const [wahl, setWahl] = useState<Record<number, 'ja' | 'nein' | 'enthaltung' | ''>>({});
  const summe = (w: string) => (liste ?? []).filter((e) => wahl[e.person_id] === w).reduce((s, e) => s + e.stimmen, 0);
  const mehrheit = props.top.mehrheit ?? 'einfach';

  async function speichern() {
    try {
      if (props.nachEinladung && !await bestaetigen('Dieser Tagesordnungspunkt wurde nach der Einladung angelegt. Ein Beschluss über einen nicht angekündigten Punkt ist anfechtbar (§ 23 Abs. 2 WEG). Trotzdem abstimmen?')) return;
      await call('topStimmenSpeichern', props.top.id, art, Object.entries(wahl).filter(([, w]) => w).map(([pid, w]) => ({ person_id: Number(pid), wahl: w })));
      const ergebnis = await call('topBeschliessen', props.top.id);
      hinweis(`Beschluss ${ergebnis} und in die Beschlusssammlung eingetragen.`);
      props.onClose();
    } catch (e) {
      fehler(e);
    }
  }

  return (
    <Dialog titel={`Abstimmung TOP ${props.top.nr}: ${props.top.titel}`} onClose={props.onClose} aktionen={<button className="primary" onClick={speichern}>Ergebnis festhalten</button>}>
      <p className="klein">{props.top.beschlussvorschlag}</p>
      <div className="toolbar"><label>Stimmrecht <select value={art} onChange={(e) => setArt(e.target.value)}>{ABSTIMMUNG.map(([a, l]) => <option key={a} value={a}>{l}</option>)}</select></label>
        <span className="klein">Erforderlich: {MEHRHEIT.find(([m]) => m === mehrheit)?.[1]}</span></div>
      <table>
        <thead><tr><th>Eigentümer</th><th>Einheiten</th><th className="num">Stimmen</th><th>Ja</th><th>Nein</th><th>Enth.</th><th>abwesend</th></tr></thead>
        <tbody>
          {liste?.map((e) => {
            const da = props.anwesend.some((a) => a.person_id === e.person_id);
            return (
              <tr key={e.person_id} className={!da && props.anwesend.length ? 'inaktiv' : ''}>
                <td><L zu={{ person: e.person_id }}>{e.name}</L></td><td className="klein">{e.einheiten.join(', ')}</td><td className="num">{zahl(e.stimmen)}</td>
                {(['ja', 'nein', 'enthaltung', ''] as const).map((w) => (
                  <td key={w}><input type="radio" name={`s${e.person_id}`} checked={(wahl[e.person_id] ?? '') === w} onChange={() => setWahl({ ...wahl, [e.person_id]: w })} /></td>
                ))}
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr><td colSpan={3}>Summe</td><td>{zahl(summe('ja'))}</td><td>{zahl(summe('nein'))}</td><td>{zahl(summe('enthaltung'))}</td><td /></tr></tfoot>
      </table>
      <p className="hinweis klein">Enthaltungen zählen nicht als abgegebene Stimmen. Abweichende Mehrheiten nach der Gemeinschaftsordnung bitte selbst prüfen.</p>
    </Dialog>
  );
}

const STATUS: [string, string][] = [['gueltig', 'gültig'], ['angefochten', 'angefochten'], ['aufgehoben', 'aufgehoben / für ungültig erklärt'], ['vollzogen', 'vollzogen']];

export function Beschluesse(props: { objekt: Row }) {
  const [naechste] = useLoad<number>(() => call('naechsteBeschlussNr', props.objekt.id), [props.objekt.id]);
  async function aufgabe(b: Row) {
    await call('save', 'vorgaenge', { objekt_id: props.objekt.id, titel: `Beschluss Nr. ${b.nr} umsetzen: ${b.titel}`, kategorie: 'Beschluss', status: 'offen', prioritaet: 1,
      beschreibung: `Beschluss Nr. ${b.nr} vom ${datum(b.datum)}:\n${b.text ?? ''}` });
    hinweis('Aufgabe angelegt.');
  }
  async function drucken(rows: Row[]) {
    const z = rows.map((b) => [b.nr, datum(b.datum), esc(b.art === 'umlauf' ? 'Umlaufbeschluss' : b.art === 'gericht' ? 'Gerichtsentscheidung' : 'Versammlung'),
      `<b>${esc(b.titel)}</b><br>${esc(b.text ?? '').replace(/\n/g, '<br>')}${b.ort ? `<br>Ort: ${esc(b.ort)}` : ''}${b.gericht ? `<br>${esc(b.gericht)}` : ''}`, esc(b.ergebnis ?? ''), esc(STATUS.find(([s]) => s === b.status)?.[1] ?? '') + (b.vermerk ? `<br>${esc(b.vermerk)}` : '')]);
    await alsPdf([bericht('Beschluss-Sammlung (§ 24 Abs. 7 WEG)', props.objekt.bezeichnung, tabelle(['Nr.', 'Datum', 'Art', 'Wortlaut', 'Ergebnis', 'Vermerke'], z))],
      `Beschlusssammlung ${props.objekt.bezeichnung}`);
  }
  return (
    <Liste titel="Beschluss-Sammlung" table="beschluesse" filter={{ objekt_id: props.objekt.id }} order="nr DESC"
      neuLabel="Beschluss eintragen" neu={{ nr: naechste ?? undefined, datum: heute(), art: 'versammlung', status: 'gueltig', ergebnis: 'angenommen' }}
      hinweis="Beschlüsse aus Versammlungen werden beim Abstimmen automatisch eingetragen. Umlaufbeschlüsse und Gerichtsentscheidungen hier von Hand erfassen. Einträge nicht löschen, sondern den Status ändern (aufgehoben, angefochten) – löschen darf nur ein Verwalter, die Nummer wird nie wieder vergeben."
      aktionen={(r) => (r.ergebnis === 'angenommen' && r.status === 'gueltig' ? <button onClick={() => aufgabe(r)}>Aufgabe</button> : null)}
      kopf={(rows) => <button onClick={() => drucken(rows)}>Als PDF</button>}
      zeilenKlasse={(r) => (r.status === 'aufgehoben' ? 'inaktiv' : '')}
      spalten={[['Nr.', (r) => r.nr, 'num'], ['Datum', (r) => datum(r.datum)], ['Titel', (r) => r.titel], ['Ergebnis', (r) => r.ergebnis],
        ['Status', (r) => STATUS.find(([s]) => s === r.status)?.[1]]]}
      fields={[{ key: 'nr', label: 'Laufende Nummer', type: 'number', required: true }, { key: 'datum', label: 'Datum', type: 'date', required: true },
        { key: 'art', label: 'Art', type: 'select', required: true, options: [['versammlung', 'Versammlung'], ['umlauf', 'Umlaufbeschluss'], ['gericht', 'Gerichtsentscheidung']] },
        { key: 'titel', label: 'Titel', required: true, wide: true }, { key: 'text', label: 'Wortlaut', type: 'textarea' },
        { key: 'ort', label: 'Ort (Versammlung bzw. Verkündung)' }, { key: 'gericht', label: 'Gericht, Aktenzeichen und Parteien (bei Urteilen)' },
        { key: 'ergebnis', label: 'Ergebnis', type: 'select', options: [['angenommen', 'angenommen'], ['abgelehnt', 'abgelehnt']] },
        { key: 'status', label: 'Status', type: 'select', required: true, options: STATUS }, { key: 'vermerk', label: 'Vermerk (z. B. Anfechtung, Aktenzeichen)', type: 'textarea' }]} />
  );
}

export const ROLLEN: [string, string][] = [['beirat', 'Verwaltungsbeirat'], ['beiratsvorsitz', 'Beiratsvorsitz'], ['hausmeister', 'Hausmeister'],
  ['handwerker', 'Handwerker'], ['dienstleister', 'Dienstleister'], ['versorger', 'Versorger'], ['notfall', 'Notdienst'], ['sonstige', 'Sonstige']];

export function Kontakte(props: { objekt: Row; titel: string }) {
  const [personen] = useLoad<Row[]>(() => call('personen'), []);
  return (
    <Liste titel={props.titel} table="rollen" filter={{ objekt_id: props.objekt.id }}
      laden={() => call('rollenListe', props.objekt.id)} neuLabel="Ansprechpartner hinzufügen"
      zeilenKlasse={(r) => (r.bis && r.bis < heute() ? 'inaktiv' : '')}
      spalten={[['Rolle', (r) => ROLLEN.find(([k]) => k === r.rolle)?.[1] ?? r.rolle], ['Name', (r) => <L zu={{ person: r.person_id }}>{r.name}</L>], ['Telefon', (r) => r.telefon || r.mobil],
        ['E-Mail', (r) => r.email ? <a href="#" onClick={(e) => { e.preventDefault(); window.hv.extern(`mailto:${r.email}`); }}>{r.email}</a> : ''], ['Seit', (r) => datum(r.von)], ['Bis', (r) => datum(r.bis)]]}
      fields={[{ key: 'rolle', label: 'Rolle', type: 'select', required: true, options: ROLLEN },
        { key: 'person_id', label: 'Person (aus dem Adressbuch)', type: 'select', required: true, options: (personen ?? []).map((p) => [p.id, personName(p)]) },
        { key: 'von', label: 'Seit', type: 'date' }, { key: 'bis', label: 'Bis', type: 'date' }, { key: 'notiz', label: 'Notiz', type: 'textarea' }]} />
  );
}
