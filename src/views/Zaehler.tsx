import { useState } from 'react';
import * as I from 'lucide-react';
import { call, datum, fehler, heute, inTagen, parseZahl, zahl, type Row } from '../api';
import { dokUrl } from './Archiv';
import { FormDialog, type Field } from '../Form';
import { useLoad } from '../useLoad';
import { L } from '../navi';
import { Dialog } from '../ui';

export const ZAEHLER_ARTEN: [string, string][] = [
  ['kaltwasser', 'Kaltwasser'], ['warmwasser', 'Warmwasser'], ['waerme', 'Wärme / Heizung'],
  ['heizkostenverteiler', 'Heizkostenverteiler'], ['strom', 'Strom'], ['gas', 'Gas'], ['sonstig', 'Sonstiger Zähler'],
];
const artName = (a: string) => ZAEHLER_ARTEN.find(([k]) => k === a)?.[1] ?? a;

export function Zaehler(props: { objekt: Row }) {
  const [rows, reload] = useLoad<Row[]>(() => call('zaehler', props.objekt.id), [props.objekt.id]);
  const [einheiten] = useLoad<Row[]>(() => call('einheiten', props.objekt.id), [props.objekt.id]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [verlauf, setVerlauf] = useState<Row | null>(null);
  const [ablesen, setAblesen] = useState(false);

  const felder: Field[] = [
    { key: 'art', label: 'Art', type: 'select', required: true, options: ZAEHLER_ARTEN },
    { key: 'einheit_id', label: 'Einheit (leer = Hauptzähler)', type: 'select', options: (einheiten ?? []).map((e) => [e.id, `${e.nr} – ${e.bezeichnung}`]) },
    { key: 'nummer', label: 'Zählernummer' },
    { key: 'ort', label: 'Einbauort (z. B. Bad, Küche)' },
    { key: 'einheit', label: 'Maßeinheit (m³, kWh, Einh.)' },
    { key: 'faktor', label: 'Umrechnungsfaktor', type: 'number' },
    { key: 'einbau', label: 'Eingebaut am', type: 'date', section: 'Daten' },
    { key: 'eichung_bis', label: 'Eichung gültig bis', type: 'date' },
    { key: 'ausbau', label: 'Ausgebaut am', type: 'date' },
    { key: 'notiz', label: 'Notiz', type: 'textarea' },
  ];
  const eichungFaellig = (z: Row) => z.eichung_bis && z.eichung_bis <= inTagen(180);

  return (
    <section>
      <div className="toolbar">
        <h1>Zähler</h1>
        <span className="spacer" />
        <button disabled={!rows?.length} onClick={() => setAblesen(true)}>Ablesung erfassen</button>
        <button className="primary" onClick={() => setEdit({ objekt_id: props.objekt.id, art: 'kaltwasser', einheit: 'm³', faktor: 1 })}>Neuer Zähler</button>
      </div>
      <p className="hinweis klein">
        Zählerstände dienen in den Abrechnungen als Verteilschlüssel (Umlageschlüssel vom Typ „Zähler“). Der Verbrauch im
        Abrechnungszeitraum wird zwischen zwei Ablesungen tagegenau interpoliert. Ein Stand gilt für das Ende seines Tages: Für das
        Jahr 2025 also die Stände vom 31.12.2024 und 31.12.2025, beim Auszug der Stand vom letzten Miettag. Bei einem Zählertausch: alten Zähler mit
        Ausbaudatum und Endstand, neuen Zähler mit Einbaudatum und Anfangsstand erfassen.
      </p>
      <table>
        <thead><tr><th>Art</th><th>Einheit</th><th>Nummer</th><th>Ort</th><th className="num">Letzter Stand</th><th>am</th><th>Eichung bis</th><th /></tr></thead>
        <tbody>
          {rows?.map((z) => (
            <tr key={z.id} className={z.ausbau ? 'inaktiv' : ''} onDoubleClick={() => setEdit(z)}>
              <td>{artName(z.art)}</td>
              <td>{z.einheit_id ? <L zu={{ einheit: z.einheit_id }}>{z.einheit_nr} – {z.einheit_bez}</L> : <b>Hauptzähler</b>}</td>
              <td>{z.nummer}</td><td>{z.ort}</td>
              <td className="num">{zahl(z.letzter_stand)} {z.einheit}</td>
              <td>{datum(z.letztes_datum)}</td>
              <td className={eichungFaellig(z) ? 'fehlertext' : ''}>{datum(z.eichung_bis)}</td>
              <td className="aktionen">
                <button onClick={() => setVerlauf(z)}>Stände</button>
                <button onClick={() => setEdit(z)}>Bearbeiten</button>
              </td>
            </tr>
          ))}
          {!rows?.length && <tr><td colSpan={8} className="hinweis">Noch keine Zähler erfasst.</td></tr>}
        </tbody>
      </table>
      {edit && (
        <FormDialog title={edit.id ? 'Zähler bearbeiten' : 'Neuer Zähler'} fields={felder} row={edit}
          onSave={(r) => call('save', 'zaehler', { ...r, objekt_id: props.objekt.id, faktor: r.faktor ?? 1 })}
          onDelete={() => call('remove', 'zaehler', edit.id)}
          onClose={() => { setEdit(null); reload(); }} />
      )}
      {verlauf && <Verlauf zaehler={verlauf} onClose={() => { setVerlauf(null); reload(); }} />}
      {ablesen && rows && <Ablesung zaehler={rows.filter((z) => !z.ausbau)} onClose={() => { setAblesen(false); reload(); }} />}
    </section>
  );
}

function Verlauf(props: { zaehler: Row; onClose: () => void }) {
  const [rows, reload] = useLoad<Row[]>(() => call('zaehlerstaende', props.zaehler.id), [props.zaehler.id]);
  const [neu, setNeu] = useState({ datum: heute(), stand: '' });
  const [foto, setFoto] = useState<Foto | undefined>();
  return (
    <Dialog titel={`Zählerstände ${artName(props.zaehler.art)} ${props.zaehler.nummer ?? ''}`} onClose={props.onClose}>
      <div className="toolbar">
        <input type="date" value={neu.datum} onChange={(e) => setNeu({ ...neu, datum: e.target.value })} />
        <input className="num" placeholder="Stand" value={neu.stand} onChange={(e) => setNeu({ ...neu, stand: e.target.value })} />
        <ZaehlerFoto zaehlerId={props.zaehler.id} foto={foto} onFoto={setFoto} onWert={(v) => setNeu({ ...neu, stand: v })} />
        <button className="primary" disabled={parseZahl(neu.stand) == null} onClick={async () => {
          await call('ablesung', neu.datum, { [props.zaehler.id]: parseZahl(neu.stand) }, foto ? { [props.zaehler.id]: foto.dokument_id } : {});
          setNeu({ ...neu, stand: '' });
          setFoto(undefined);
          reload();
        }}>Hinzufügen</button>
      </div>
      <table>
        <thead><tr><th>Datum</th><th className="num">Stand</th><th className="num">Verbrauch seit vorher</th><th /></tr></thead>
        <tbody>
          {rows?.map((r, i) => (
            <tr key={r.id}>
              <td>{datum(r.datum)}</td><td className="num">{zahl(r.stand)}</td>
              <td className="num">{rows[i + 1] ? zahl(+(r.stand - rows[i + 1].stand).toFixed(4)) : ''}</td>
              <td className="aktionen"><button onClick={async () => { await call('remove', 'zaehlerstaende', r.id); reload(); }}>Löschen</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

// Photo of a meter: the proposals of the text recognition as buttons; a click puts the value into the field.
type Foto = { dokument_id: number; datei: string; kandidaten: number[] };
function ZaehlerFoto(props: { zaehlerId: number; foto?: Foto; onFoto: (f: Foto) => void; onWert: (wert: string) => void }) {
  const [laeuft, setLaeuft] = useState(false);
  return (
    <span className="zaehlerfoto">
      <button className="icon" title="Foto vom Zähler – der Stand wird gelesen und vorgeschlagen" disabled={laeuft} onClick={async () => {
        setLaeuft(true);
        try { const f = await window.hv.zaehlerFoto(props.zaehlerId); if (f) props.onFoto(f); } catch (e) { fehler(e); } finally { setLaeuft(false); }
      }}>{laeuft ? '…' : <I.Camera size={15} />}</button>
      {props.foto && <a href={dokUrl(props.foto.datei)} target="_blank" rel="noreferrer"><img src={dokUrl(props.foto.datei)} alt="Zählerfoto" /></a>}
      {props.foto && (props.foto.kandidaten.length
        ? props.foto.kandidaten.slice(0, 3).map((k) => <button key={k} className="chip" title="Diesen Wert übernehmen" onClick={() => props.onWert(zahl(k))}>{zahl(k)}?</button>)
        : <span className="klein hinweis">nicht lesbar – bitte eintippen</span>)}
    </span>
  );
}

// Reading day: one input per meter, saved together.
function Ablesung(props: { zaehler: Row[]; onClose: () => void }) {
  const [tag, setTag] = useState(heute());
  const [werte, setWerte] = useState<Record<number, string>>({});
  const [fotos, setFotos] = useState<Record<number, Foto>>({});
  return (
    <Dialog titel="Ablesung erfassen" onClose={props.onClose} breit aktionen={
      <button className="primary" onClick={async () => {
        await call('ablesung', tag, Object.fromEntries(Object.entries(werte).map(([k, v]) => [k, parseZahl(v)]).filter(([, v]) => v != null)),
          Object.fromEntries(Object.entries(fotos).map(([k, f]) => [k, f.dokument_id])));
        props.onClose();
      }}>Speichern</button>}>
      <div className="toolbar"><label>Ablesedatum <input type="date" value={tag} onChange={(e) => setTag(e.target.value)} /></label></div>
      <table>
        <thead><tr><th>Einheit</th><th>Zähler</th><th className="num">Letzter Stand</th><th className="num">Neuer Stand</th><th>Foto</th></tr></thead>
        <tbody>
          {props.zaehler.map((z) => (
            <tr key={z.id}>
              <td>{z.einheit_id ? `${z.einheit_nr} – ${z.einheit_bez}` : 'Hauptzähler'}</td>
              <td>{artName(z.art)} {z.nummer}</td>
              <td className="num">{zahl(z.letzter_stand)} <span className="klein">{datum(z.letztes_datum)}</span></td>
              <td><input className="num zelle" value={werte[z.id] ?? ''} onChange={(e) => setWerte({ ...werte, [z.id]: e.target.value })} /></td>
              <td><ZaehlerFoto zaehlerId={z.id} foto={fotos[z.id]} onFoto={(f) => setFotos({ ...fotos, [z.id]: f })} onWert={(v) => setWerte({ ...werte, [z.id]: v })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
