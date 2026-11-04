import { useRef, useState } from 'react';
import { call, heute, zahl, type Modus, type Row } from '../api';
import { FormDialog, type Field } from '../Form';
import { useLoad } from '../useLoad';
import { Galerie } from '../Galerie';
import { L, useNavi } from '../navi';
import { Leer, SortTh, sortiere, type Sortierung } from '../ui';
import { BelegungMini, QmMini, SelbstnutzungDialog } from './Kennzahlen';
import { VertragDialog, neuerVertrag } from './Vertraege';

const ARTEN = ['Wohnung', 'Gewerbe', 'Garage', 'Stellplatz', 'Keller', 'Sonstiges'];

export const EINHEIT_FELDER: Field[] = [
  { key: 'nr', label: 'Nr.', type: 'number', required: true },
  { key: 'bezeichnung', label: 'Bezeichnung', required: true },
  { key: 'art', label: 'Art', type: 'select', required: true, options: ARTEN.map((a) => [a, a]) },
  { key: 'lage', label: 'Lage (z. B. EG links)' },
  { key: 'wohnflaeche', label: 'Fläche m²', type: 'number' },
  { key: 'zimmer', label: 'Zimmer', type: 'number' },
  { key: 'mea', label: 'Miteigentumsanteile (MEA)', type: 'number' },
  { key: 'vergleichsmiete_ct', label: 'Ortsübliche Vergleichsmiete je m²', type: 'money', section: 'Vergleichsmiete – nur wenn sie vom Haus abweicht (z. B. andere Größenklasse im Mietspiegel)' },
  { key: 'mietspiegel_von_ct', label: 'Mietspiegel von je m²', type: 'money' },
  { key: 'mietspiegel_bis_ct', label: 'Mietspiegel bis je m²', type: 'money' },
  { key: 'notiz', label: 'Notiz', type: 'textarea', section: 'Sonstiges' },
];

// A new unit asks right away how it is used: let (the tenant is entered next, even if not yet in the address book),
// used by the owner, or still open.
const nutzungFeld = (modus: Modus): Field => ({ key: 'nutzung', label: 'Nutzung', type: 'select', section: 'Nutzung',
  options: modus === 'weg' ? [['eigentuemer', 'Eigentümer gleich erfassen']] : [['mieter', 'Vermietet – Mieter gleich erfassen'], ['eigen', 'Eigennutzung']] });

export function Einheiten(props: { modus: Modus; objekt: Row }) {
  const navi = useNavi();
  const [rows, reload] = useLoad<Row[]>(() => call('einheiten', props.objekt.id), [props.objekt.id]);
  const [kz, ladeKz] = useLoad<Row>(() => call('listenKennzahlen', props.objekt.id), [props.objekt.id]);
  const [edit, setEdit] = useState<Row | null>(null);
  // After saving a new unit: the contract form or the self-use form for it.
  const [danach, setDanach] = useState<{ art: string; einheit_id: number } | null>(null);
  const neueEinheit = useRef<{ id: number; nutzung: string } | null>(null);
  const [sort, setSort] = useState<Sortierung>(null);
  const gemischt = props.objekt.art === 'gemischt';
  // Mixed houses show both sides; otherwise only the side that belongs to the mode.
  const zeigeMieter = props.modus === 'miete' || gemischt;
  const zeigeEigentuemer = props.modus === 'weg' || gemischt;

  const summe = (k: string) => rows?.reduce((s, r) => s + (r[k] ?? 0), 0) ?? 0;
  const naechsteNr = (rows?.reduce((m, r) => Math.max(m, r.nr), 0) ?? 0) + 1;
  const neu = () => setEdit({ objekt_id: props.objekt.id, nr: naechsteNr, art: 'Wohnung' });
  const liste = sortiere(rows, sort);

  return (
    <section>
      <div className="toolbar">
        <h1>Einheiten</h1>
        <span className="spacer" />
        <button className="primary" onClick={neu}>Neue Einheit</button>
      </div>
      {rows && rows.length === 0 ? (
        <Leer symbol="einheiten" text="Dieses Objekt hat noch keine Einheiten. Lege Wohnungen, Gewerbe, Garagen oder Stellplätze an – mit Fläche und (bei WEG) Miteigentumsanteilen." aktion={<button className="primary" onClick={neu}>Erste Einheit anlegen</button>} />
      ) : (
        <table>
          <thead>
            <tr>
              <SortTh k="nr" s={sort} set={setSort} className="num">Nr.</SortTh><SortTh k="bezeichnung" s={sort} set={setSort}>Bezeichnung</SortTh>
              <SortTh k="art" s={sort} set={setSort}>Art</SortTh><SortTh k="lage" s={sort} set={setSort}>Lage</SortTh>
              <SortTh k="wohnflaeche" s={sort} set={setSort} className="num">m²</SortTh><SortTh k="zimmer" s={sort} set={setSort} className="num">Zi.</SortTh>
              {zeigeEigentuemer && <SortTh k="mea" s={sort} set={setSort} className="num">MEA</SortTh>}
              {zeigeEigentuemer && <SortTh k="eigentuemer" s={sort} set={setSort} className="seite-weg">Eigentümer</SortTh>}
              {zeigeMieter && <SortTh k="mieter" s={sort} set={setSort} className="seite-miete">Mieter</SortTh>}
              {zeigeMieter && <th title="Vermietet oder selbst genutzt in den letzten 12 Monaten, tagegenau">Belegung</th>}
              {zeigeMieter && <th className="num" title="Kaltmiete je m² und Monat; gelb unter, rot über der Spanne des Mietspiegels">€/m²</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {liste.map((e) => (
              <tr key={e.id} className="klickbar" data-ziel={`einheit:${e.id}`} onClick={() => navi.zu({ einheit: e.id })} title="Steckbrief öffnen">
                <td className="num">{e.nr}</td>
                <td><L zu={{ einheit: e.id }}>{e.bezeichnung}</L></td>
                <td>{e.art}</td>
                <td>{e.lage}</td>
                <td className="num">{zahl(e.wohnflaeche)}</td>
                <td className="num">{zahl(e.zimmer)}</td>
                {zeigeEigentuemer && <td className="num">{zahl(e.mea)}</td>}
                {zeigeEigentuemer && <td className="seite-weg">{e.eigentuemer ? <L zu={{ person: e.eigentuemer_id }}>{e.eigentuemer}</L> : <i className="hinweis">–</i>}</td>}
                {zeigeMieter && <td className="seite-miete">{e.mieter ? <L zu={{ person: e.mieter_id }}>{e.mieter}</L> : <i className="hinweis">{e.selbstgenutzt ? 'selbst genutzt' : 'leer'}</i>}</td>}
                {zeigeMieter && <td><BelegungMini x={kz?.einheiten[e.id]} /></td>}
                {zeigeMieter && <td className="num"><QmMini x={kz?.einheiten[e.id]} /></td>}
                <td className="aktionen"><button onClick={(ev) => { ev.stopPropagation(); setEdit(e); }}>Bearbeiten</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td /><td>{rows?.length ?? 0} Einheiten</td><td /><td />
              <td className="num">{zahl(summe('wohnflaeche'))}</td><td />
              {zeigeEigentuemer && <td className="num">{zahl(summe('mea'))}</td>}
              {zeigeEigentuemer && <td />}
              {zeigeMieter && <><td /><td /><td /></>}
              <td />
            </tr>
          </tfoot>
        </table>
      )}
      <h3>Fotos & Dokumente des Objekts</h3>
      <Galerie filter={{ objekt_id: props.objekt.id }} hinweis={props.objekt.bezeichnung} />
      {edit && (
        <FormDialog
          title={edit.id ? 'Einheit bearbeiten' : 'Neue Einheit'}
          fields={edit.id ? EINHEIT_FELDER : [...EINHEIT_FELDER, nutzungFeld(props.modus)]}
          row={edit}
          onSave={async (r) => {
            const { nutzung, ...zeile } = r;
            const id = await call('save', 'einheiten', { ...zeile, objekt_id: props.objekt.id });
            if (!edit.id && nutzung) neueEinheit.current = { id, nutzung };
            return id;
          }}
          onDelete={() => call('remove', 'einheiten', edit.id)}
          onClose={() => {
            setEdit(null);
            const n = neueEinheit.current;
            neueEinheit.current = null;
            if (n) setDanach({ art: n.nutzung, einheit_id: n.id });
            reload();
            ladeKz();
          }}
        />
      )}
      {(danach?.art === 'mieter' || danach?.art === 'eigentuemer') && (
        <VertragDialog modus={danach.art === 'eigentuemer' ? 'weg' : 'miete'} objekt={props.objekt} edit={neuerVertrag(danach.art === 'eigentuemer' ? 'weg' : 'miete', { einheit_id: danach.einheit_id })}
          onClose={() => { setDanach(null); reload(); ladeKz(); }} />
      )}
      {danach?.art === 'eigen' && (
        <SelbstnutzungDialog einheitId={danach.einheit_id} row={{ beginn: heute(), personen: 1 }} onClose={() => { setDanach(null); reload(); ladeKz(); }} />
      )}
    </section>
  );
}
