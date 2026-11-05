// Workflow templates: start one for a house (and unit or person) from a key date, and edit the templates – one step
// per line, "-30 Vorabnahme" meaning 30 days before the key date.
import { useState } from 'react';
import { call, datum, fehler, heute, personName, type Row } from '../api';
import { useLoad } from '../useLoad';
import { Auswahl, Dialog } from '../ui';
import { FormDialog } from '../Form';

export function AblaufStarten(props: { vorgabe?: { art?: string; objekt_id?: number; einheit_id?: number | null; person_id?: number | null; stichtag?: string }; onClose: (id?: number) => void }) {
  const v = props.vorgabe ?? {};
  const [vorlagen] = useLoad<Row[]>(() => call('ablaeufe'), []);
  const [objekte] = useLoad<Row[]>(async () => [...new Map([...await call('objekte', 'miete'), ...await call('objekte', 'weg')].map((o: Row) => [o.id, o])).values()], []);
  const [benutzer] = useLoad<Row[]>(() => call<Row[]>('benutzerListe').catch(() => []), []);
  const [personen] = useLoad<Row[]>(() => call('personen'), []);
  const [wahl, setWahl] = useState<number | ''>('');
  const [objekt, setObjekt] = useState<number | ''>(v.objekt_id ?? '');
  const [einheit, setEinheit] = useState<number | ''>(v.einheit_id ?? '');
  const [person, setPerson] = useState<number | ''>(v.person_id ?? '');
  const [zustaendig, setZustaendig] = useState<number | ''>('');
  const [stichtag, setStichtag] = useState(v.stichtag ?? heute());
  const [laeuft, setLaeuft] = useState(false);
  const [einheiten] = useLoad<Row[]>(() => (objekt ? call('einheiten', objekt) : Promise.resolve([])), [objekt]);
  const vorlage = vorlagen?.find((a) => a.id === (wahl || vorlagen.find((x) => x.art === v.art)?.id));

  async function starten() {
    if (!vorlage) return;
    setLaeuft(true);
    try {
      const id = await call<number>('ablaufStarten', vorlage.id, { objekt_id: objekt || null, einheit_id: einheit || null, person_id: person || null, stichtag, zustaendig: zustaendig || null });
      props.onClose(id);
    } catch (e) { fehler(e); setLaeuft(false); }
  }

  const plus = (n: number) => new Date(Date.parse(`${stichtag}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  return (
    <Dialog titel="Ablauf starten" onClose={() => props.onClose()}
      aktionen={<button className="primary" disabled={!vorlage || !objekt || !stichtag || laeuft} onClick={starten}>Starten</button>}>
      <div className="maske zwei">
        <label>Vorlage<Auswahl pflicht value={vorlage?.id ?? ''} options={(vorlagen ?? []).map((a) => [a.id, a.titel])} onChange={(x) => setWahl(Number(x) || '')} /></label>
        <label>{vorlage?.anlass ?? 'Stichtag'}<input type="date" value={stichtag} onChange={(e) => setStichtag(e.target.value)} /></label>
        <label>Objekt<Auswahl pflicht value={objekt} options={(objekte ?? []).map((o) => [o.id, o.bezeichnung])} onChange={(x) => { setObjekt(Number(x) || ''); setEinheit(''); }} /></label>
        <label>Einheit (optional)<Auswahl value={einheit} leer="–" options={(einheiten ?? []).map((e) => [e.id, e.bezeichnung])} onChange={(x) => setEinheit(Number(x) || '')} /></label>
        <label>Person (optional)<Auswahl value={person} leer="–" options={(personen ?? []).map((p) => [p.id, personName(p)])} onChange={(x) => setPerson(Number(x) || '')} /></label>
        {!!benutzer?.length && <label>Zuständig<Auswahl value={zustaendig} leer="–" options={benutzer.filter((b) => b.aktiv).map((b) => [b.id, b.name])} onChange={(x) => setZustaendig(Number(x) || '')} /></label>}
      </div>
      {vorlage && (
        <ul className="ablauf-vorschau">
          {vorlage.schritte.map((s: Row, i: number) => {
            const d = plus(s.tage);
            return <li key={i}><span className={d < heute() ? 'hinweis' : ''}>{datum(d < heute() ? heute() : d)}</span> {s.titel}</li>;
          })}
        </ul>
      )}
    </Dialog>
  );
}

// "-30 Vorabnahme" ↔ { tage: -30, titel: 'Vorabnahme' }
const alsText = (schritte: Row[]) => schritte.map((s) => `${s.tage > 0 ? '+' : ''}${s.tage} ${s.titel}`).join('\n');
const ausText = (text: string) => text.split('\n').map((z) => z.trim().match(/^([+-]?\d+)\s+(.+)$/)).filter(Boolean).map((m) => ({ tage: Number(m![1]), titel: m![2].trim() }));

export function AblaufVorlagen(props: { onClose: () => void }) {
  const [vorlagen, reload] = useLoad<Row[]>(() => call('ablaeufe'), []);
  const [edit, setEdit] = useState<Row | null>(null);
  return (
    <Dialog titel="Ablauf-Vorlagen" breit onClose={props.onClose} aktionen={<button onClick={() => setEdit({ titel: '', anlass: 'Stichtag', text: '0 Erster Schritt' })}>Neue Vorlage</button>}>
      <p className="hinweis klein">Jede Vorlage ist eine Liste von Schritten mit Tagen vor (−) oder nach (+) einem Stichtag. Beim Start entsteht ein Vorgang mit diesen Schritten als Unteraufgaben.</p>
      <table>
        <thead><tr><th>Vorlage</th><th>Stichtag</th><th className="num">Schritte</th></tr></thead>
        <tbody>{vorlagen?.map((a) => (
          <tr key={a.id} className="klickbar" onClick={() => setEdit({ ...a, text: alsText(a.schritte) })}><td>{a.titel}</td><td>{a.anlass}</td><td className="num">{a.schritte.length}</td></tr>
        ))}</tbody>
      </table>
      {edit && (
        <FormDialog title={edit.id ? edit.titel : 'Neue Vorlage'} row={edit}
          fields={[{ key: 'titel', label: 'Name', required: true, wide: true }, { key: 'anlass', label: 'Stichtag heißt (z. B. „Auszug am“)', wide: true },
            { key: 'text', label: 'Schritte – je Zeile Tage und Text, z. B. „-30 Vorabnahme“', type: 'textarea', required: true, wide: true }]}
          onSave={async (r) => {
            const schritte = ausText(r.text ?? '');
            if (!schritte.length) throw new Error('Bitte mindestens einen Schritt eintragen, z. B. „0 Termin“.');
            return call('save', 'ablaeufe', { id: r.id, titel: r.titel, anlass: r.anlass, schritte: JSON.stringify(schritte) });
          }}
          onDelete={edit.id ? () => call('remove', 'ablaeufe', edit.id) : undefined}
          onClose={() => { setEdit(null); reload(); }} />
      )}
    </Dialog>
  );
}
