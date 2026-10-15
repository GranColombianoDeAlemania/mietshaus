// Owners' meetings with agenda and votes, the resolution register and contact roles (advisory board, caretaker …).
import { useState } from 'react';
import { anrede, call, datum, fehler, heute, personName, zahl, type Row } from '../api';
import { useLoad } from '../useLoad';
import { Liste } from '../Liste';
import { Dialog } from '../ui';
import { FormDialog, type Field } from '../Form';
import { absaetze, absenderAus, alsPdf, bericht, brief, esc, tabelle } from '../dokument';

const ABSTIMMUNG: [string, string][] = [['kopf', 'nach Köpfen (§ 25 WEG)'], ['mea', 'nach Miteigentumsanteilen'], ['objekt', 'nach Einheiten']];

export function Versammlungen(props: { objekt: Row }) {
  const [offen, setOffen] = useState<number | null>(null);
  return (
    <>
      <Liste titel={`Eigentümerversammlungen – ${props.objekt.bezeichnung}`} table="versammlungen" filter={{ objekt_id: props.objekt.id }} order="datum DESC"
        neuLabel="Neue Versammlung" neu={{ art: 'ordentlich', uhrzeit: '18:00' }}
        spalten={[['Datum', (r) => `${datum(r.datum)} ${r.uhrzeit ?? ''}`], ['Art', (r) => (r.art === 'ordentlich' ? 'ordentlich' : 'außerordentlich')], ['Ort', (r) => r.ort],
          ['Einladung', (r) => datum(r.einladung_am)]]}
        fields={[{ key: 'datum', label: 'Datum', type: 'date', required: true }, { key: 'uhrzeit', label: 'Uhrzeit' }, { key: 'ort', label: 'Ort', wide: true },
          { key: 'art', label: 'Art', type: 'select', required: true, options: [['ordentlich', 'Ordentliche Versammlung'], ['ausserordentlich', 'Außerordentliche Versammlung']] },
          { key: 'einladung_am', label: 'Einladung versandt am', type: 'date' }, { key: 'leitung', label: 'Versammlungsleitung' }, { key: 'protokoll', label: 'Protokollführung' },
          { key: 'notiz', label: 'Notiz', type: 'textarea' }]}
        aktionen={(r) => <button onClick={() => setOffen(r.id)}>Tagesordnung & Beschlüsse</button>} />
      {offen && <Versammlung id={offen} objekt={props.objekt} onClose={() => setOffen(null)} />}
    </>
  );
}

function Versammlung(props: { id: number; objekt: Row; onClose: () => void }) {
  const [v, reload] = useLoad<Row>(() => call('versammlung', props.id), [props.id]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [abstimmen, setAbstimmen] = useState<Row | null>(null);

  const felder: Field[] = [
    { key: 'nr', label: 'TOP Nr.', type: 'number', required: true }, { key: 'titel', label: 'Titel', required: true, wide: true },
    { key: 'erlaeuterung', label: 'Erläuterung', type: 'textarea' }, { key: 'beschlussvorschlag', label: 'Beschlussvorschlag', type: 'textarea' },
    { key: 'abstimmungsart', label: 'Abstimmung', type: 'select', required: true, options: ABSTIMMUNG },
  ];

  async function einladung() {
    if (!v) return;
    const einst = await call('einstellungen');
    const eigentuemer = await call('stimmen', props.objekt.id, 'kopf', v.datum);
    const tops = v.tops.map((t: Row) => `<p><b>TOP ${t.nr}: ${esc(t.titel)}</b>${t.erlaeuterung ? `<br>${esc(t.erlaeuterung)}` : ''}${t.beschlussvorschlag ? `<br><i>Beschlussvorschlag:</i> ${esc(t.beschlussvorschlag)}` : ''}</p>`).join('');
    const seiten = [];
    for (const e of eigentuemer) {
      const p = await call('get', 'personen', e.person_id);
      seiten.push(brief({ absender: absenderAus(einst), empfaenger: p, betreff: `Einladung zur ${v.art === 'ordentlich' ? 'ordentlichen' : 'außerordentlichen'} Eigentümerversammlung – ${props.objekt.bezeichnung}`,
        info: [['Objekt', props.objekt.bezeichnung]],
        inhalt: `<p>${esc(anrede(p))}</p>${absaetze(`hiermit laden wir Sie zur Eigentümerversammlung ein:\n\nDatum: ${datum(v.datum)}, ${v.uhrzeit ?? ''} Uhr\nOrt: ${v.ort ?? ''}`)}
          <h2>Tagesordnung</h2>${tops}${absaetze('Sollten Sie verhindert sein, können Sie sich durch eine Person Ihres Vertrauens in Textform vertreten lassen. Die Versammlung ist unabhängig von der Zahl der Anwesenden beschlussfähig (§ 25 Abs. 1 WEG).')}
          <p class="unterschrift">Mit freundlichen Grüßen<br><br>${esc(einst.verwalter_name ?? '')}</p>` }));
    }
    await alsPdf(seiten, `Einladung Versammlung ${props.objekt.bezeichnung} ${v.datum}`);
    if (!v.einladung_am) { await call('save', 'versammlungen', { id: v.id, einladung_am: heute() }); reload(); }
  }

  async function protokoll() {
    if (!v) return;
    const inhalt = `<p>Datum: ${datum(v.datum)} ${v.uhrzeit ?? ''} · Ort: ${esc(v.ort ?? '')}<br>Versammlungsleitung: ${esc(v.leitung ?? '')} · Protokoll: ${esc(v.protokoll ?? '')}</p>` +
      v.tops.map((t: Row) => `<h2>TOP ${t.nr}: ${esc(t.titel)}</h2>${t.erlaeuterung ? absaetze(t.erlaeuterung) : ''}
        ${t.beschlussvorschlag ? `<p><i>Beschlussantrag:</i> ${esc(t.beschlussvorschlag)}</p>` : ''}
        ${t.ja != null ? `<p>Abstimmung ${ABSTIMMUNG.find(([a]) => a === t.abstimmungsart)?.[1]}: Ja ${zahl(t.ja)}, Nein ${zahl(t.nein ?? 0)}, Enthaltung ${zahl(t.enthaltung ?? 0)}.</p>
        <p class="hervor">Ergebnis: Beschluss ${esc(t.ergebnis ?? '')}</p>` : ''}`).join('') +
      '<p class="unterschrift">____________________________ &nbsp;&nbsp; ____________________________<br>Versammlungsleitung &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Wohnungseigentümer/in</p>';
    await alsPdf([bericht(`Protokoll der Eigentümerversammlung`, props.objekt.bezeichnung, inhalt)], `Protokoll ${props.objekt.bezeichnung} ${v.datum}`);
  }

  if (!v) return null;
  return (
    <Dialog titel={`Versammlung am ${datum(v.datum)}`} onClose={props.onClose} breit aktionen={<>
      <button onClick={einladung}>Einladungen (PDF)</button>
      <button onClick={protokoll}>Protokoll (PDF)</button>
      <button className="primary" onClick={() => setEdit({ nr: (v.tops.at(-1)?.nr ?? 0) + 1, abstimmungsart: 'kopf' })}>TOP hinzufügen</button></>}>
      <table>
        <thead><tr><th>TOP</th><th>Titel</th><th>Abstimmung</th><th className="num">Ja</th><th className="num">Nein</th><th className="num">Enth.</th><th>Ergebnis</th><th /></tr></thead>
        <tbody>
          {v.tops.map((t: Row) => (
            <tr key={t.id} onDoubleClick={() => setEdit(t)}>
              <td>{t.nr}</td><td>{t.titel}</td><td className="klein">{ABSTIMMUNG.find(([a]) => a === t.abstimmungsart)?.[1]}</td>
              <td className="num">{zahl(t.ja)}</td><td className="num">{zahl(t.nein)}</td><td className="num">{zahl(t.enthaltung)}</td>
              <td>{t.ergebnis ? <span className={`tag ${t.ergebnis === 'angenommen' ? 'art-weg' : ''}`}>{t.ergebnis}</span> : ''}</td>
              <td className="aktionen">{t.beschlussvorschlag && <button onClick={() => setAbstimmen(t)}>Abstimmen</button>}</td>
            </tr>
          ))}
          {!v.tops.length && <tr><td colSpan={8} className="hinweis">Noch keine Tagesordnungspunkte.</td></tr>}
        </tbody>
      </table>
      {edit && <FormDialog title="Tagesordnungspunkt" row={edit} fields={felder}
        onSave={(r) => call('save', 'tops', { ...r, versammlung_id: v.id })} onDelete={() => call('remove', 'tops', edit.id)}
        onClose={() => { setEdit(null); reload(); }} />}
      {abstimmen && <Abstimmung top={abstimmen} objekt={props.objekt} datum={v.datum} onClose={() => { setAbstimmen(null); reload(); }} />}
    </Dialog>
  );
}

// Vote entry: tick each owner's vote, or enter totals directly.
function Abstimmung(props: { top: Row; objekt: Row; datum: string; onClose: () => void }) {
  const [art, setArt] = useState(props.top.abstimmungsart);
  const [liste] = useLoad<Row[]>(() => call('stimmen', props.objekt.id, art, props.datum), [art]);
  const [wahl, setWahl] = useState<Record<number, 'ja' | 'nein' | 'enthaltung' | ''>>({});
  const summe = (w: string) => (liste ?? []).filter((e) => wahl[e.person_id] === w).reduce((s, e) => s + e.stimmen, 0);

  async function speichern() {
    try {
      await call('save', 'tops', { id: props.top.id, abstimmungsart: art, ja: summe('ja'), nein: summe('nein'), enthaltung: summe('enthaltung') });
      const ergebnis = await call('topBeschliessen', props.top.id);
      alert(`Beschluss ${ergebnis} und in die Beschlusssammlung eingetragen.`);
      props.onClose();
    } catch (e) {
      fehler(e);
    }
  }

  return (
    <Dialog titel={`Abstimmung TOP ${props.top.nr}: ${props.top.titel}`} onClose={props.onClose} aktionen={<button className="primary" onClick={speichern}>Ergebnis festhalten</button>}>
      <p className="klein">{props.top.beschlussvorschlag}</p>
      <div className="toolbar"><label>Stimmrecht <select value={art} onChange={(e) => setArt(e.target.value)}>{ABSTIMMUNG.map(([a, l]) => <option key={a} value={a}>{l}</option>)}</select></label></div>
      <table>
        <thead><tr><th>Eigentümer</th><th>Einheiten</th><th className="num">Stimmen</th><th>Ja</th><th>Nein</th><th>Enth.</th><th>abwesend</th></tr></thead>
        <tbody>
          {liste?.map((e) => (
            <tr key={e.person_id}>
              <td>{e.name}</td><td className="klein">{e.einheiten.join(', ')}</td><td className="num">{zahl(e.stimmen)}</td>
              {(['ja', 'nein', 'enthaltung', ''] as const).map((w) => (
                <td key={w}><input type="radio" name={`s${e.person_id}`} checked={(wahl[e.person_id] ?? '') === w} onChange={() => setWahl({ ...wahl, [e.person_id]: w })} /></td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={3}>Summe</td><td>{zahl(summe('ja'))}</td><td>{zahl(summe('nein'))}</td><td>{zahl(summe('enthaltung'))}</td><td /></tr></tfoot>
      </table>
      <p className="hinweis klein">Ein Beschluss ist angenommen, wenn mehr Ja- als Nein-Stimmen abgegeben werden; Enthaltungen zählen nicht (§ 25 Abs. 1 WEG). Abweichende Mehrheitserfordernisse nach Gemeinschaftsordnung bitte selbst prüfen.</p>
    </Dialog>
  );
}

const STATUS: [string, string][] = [['gueltig', 'gültig'], ['angefochten', 'angefochten'], ['aufgehoben', 'aufgehoben / für ungültig erklärt'], ['vollzogen', 'vollzogen']];

export function Beschluesse(props: { objekt: Row }) {
  async function drucken(rows: Row[]) {
    const z = rows.map((b) => [b.nr, datum(b.datum), esc(b.art === 'umlauf' ? 'Umlaufbeschluss' : b.art === 'gericht' ? 'Gerichtsentscheidung' : 'Versammlung'),
      `<b>${esc(b.titel)}</b><br>${esc(b.text ?? '').replace(/\n/g, '<br>')}`, esc(b.ergebnis ?? ''), esc(STATUS.find(([s]) => s === b.status)?.[1] ?? '') + (b.vermerk ? `<br>${esc(b.vermerk)}` : '')]);
    await alsPdf([bericht('Beschluss-Sammlung (§ 24 Abs. 7 WEG)', props.objekt.bezeichnung, tabelle(['Nr.', 'Datum', 'Art', 'Wortlaut', 'Ergebnis', 'Vermerke'], z))],
      `Beschlusssammlung ${props.objekt.bezeichnung}`);
  }
  return (
    <Liste titel={`Beschluss-Sammlung – ${props.objekt.bezeichnung}`} table="beschluesse" filter={{ objekt_id: props.objekt.id }} order="nr DESC"
      neuLabel="Beschluss eintragen" neu={{ datum: heute(), art: 'versammlung', status: 'gueltig', ergebnis: 'angenommen' }}
      hinweis="Beschlüsse aus Versammlungen werden beim Abstimmen automatisch eingetragen. Umlaufbeschlüsse und Gerichtsentscheidungen hier von Hand erfassen."
      kopf={(rows) => <button onClick={() => drucken(rows)}>Als PDF</button>}
      zeilenKlasse={(r) => (r.status === 'aufgehoben' ? 'inaktiv' : '')}
      spalten={[['Nr.', (r) => r.nr, 'num'], ['Datum', (r) => datum(r.datum)], ['Titel', (r) => r.titel], ['Ergebnis', (r) => r.ergebnis],
        ['Status', (r) => STATUS.find(([s]) => s === r.status)?.[1]]]}
      fields={[{ key: 'nr', label: 'Laufende Nummer', type: 'number', required: true }, { key: 'datum', label: 'Datum', type: 'date', required: true },
        { key: 'art', label: 'Art', type: 'select', required: true, options: [['versammlung', 'Versammlung'], ['umlauf', 'Umlaufbeschluss'], ['gericht', 'Gerichtsentscheidung']] },
        { key: 'titel', label: 'Titel', required: true, wide: true }, { key: 'text', label: 'Wortlaut', type: 'textarea' },
        { key: 'ergebnis', label: 'Ergebnis', type: 'select', options: [['angenommen', 'angenommen'], ['abgelehnt', 'abgelehnt']] },
        { key: 'status', label: 'Status', type: 'select', required: true, options: STATUS }, { key: 'vermerk', label: 'Vermerk (z. B. Anfechtung, Aktenzeichen)', type: 'textarea' }]} />
  );
}

const ROLLEN: [string, string][] = [['beirat', 'Verwaltungsbeirat'], ['beiratsvorsitz', 'Beiratsvorsitz'], ['hausmeister', 'Hausmeister'],
  ['handwerker', 'Handwerker'], ['dienstleister', 'Dienstleister'], ['versorger', 'Versorger'], ['notfall', 'Notdienst'], ['sonstige', 'Sonstige']];

export function Kontakte(props: { objekt: Row; titel: string }) {
  const [personen] = useLoad<Row[]>(() => call('personen'), []);
  return (
    <Liste titel={`${props.titel} – ${props.objekt.bezeichnung}`} table="rollen" filter={{ objekt_id: props.objekt.id }}
      laden={() => call('rollenListe', props.objekt.id)} neuLabel="Ansprechpartner hinzufügen"
      zeilenKlasse={(r) => (r.bis && r.bis < heute() ? 'inaktiv' : '')}
      spalten={[['Rolle', (r) => ROLLEN.find(([k]) => k === r.rolle)?.[1] ?? r.rolle], ['Name', (r) => r.name], ['Telefon', (r) => r.telefon || r.mobil],
        ['E-Mail', (r) => r.email ? <a href="#" onClick={(e) => { e.preventDefault(); window.hv.extern(`mailto:${r.email}`); }}>{r.email}</a> : ''], ['Seit', (r) => datum(r.von)], ['Bis', (r) => datum(r.bis)]]}
      fields={[{ key: 'rolle', label: 'Rolle', type: 'select', required: true, options: ROLLEN },
        { key: 'person_id', label: 'Person (aus dem Adressbuch)', type: 'select', required: true, options: (personen ?? []).map((p) => [p.id, personName(p)]) },
        { key: 'von', label: 'Seit', type: 'date' }, { key: 'bis', label: 'Bis', type: 'date' }, { key: 'notiz', label: 'Notiz', type: 'textarea' }]} />
  );
}
