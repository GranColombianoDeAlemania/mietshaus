import { useState } from 'react';
import { call, zahl, type Modus, type Row } from '../api';
import { FormDialog, type Field } from '../Form';
import { useLoad } from '../useLoad';
import { Galerie } from '../Galerie';
import { Dialog } from '../ui';

const ARTEN = ['Wohnung', 'Gewerbe', 'Garage', 'Stellplatz', 'Keller', 'Sonstiges'];

const FELDER: Field[] = [
  { key: 'nr', label: 'Nr.', type: 'number', required: true },
  { key: 'bezeichnung', label: 'Bezeichnung', required: true },
  { key: 'art', label: 'Art', type: 'select', required: true, options: ARTEN.map((a) => [a, a]) },
  { key: 'lage', label: 'Lage (z. B. EG links)' },
  { key: 'wohnflaeche', label: 'Fläche m²', type: 'number' },
  { key: 'zimmer', label: 'Zimmer', type: 'number' },
  { key: 'mea', label: 'Miteigentumsanteile (MEA)', type: 'number' },
  { key: 'notiz', label: 'Notiz', type: 'textarea' },
];

export function Einheiten(props: { modus: Modus; objekt: Row }) {
  const [rows, reload] = useLoad<Row[]>(() => call('einheiten', props.objekt.id), [props.objekt.id]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [fotos, setFotos] = useState<Row | null>(null);
  const gemischt = props.objekt.art === 'gemischt';
  // Mixed houses show both sides; otherwise only the side that belongs to the mode.
  const zeigeMieter = props.modus === 'miete' || gemischt;
  const zeigeEigentuemer = props.modus === 'weg' || gemischt;

  const summe = (k: string) => rows?.reduce((s, r) => s + (r[k] ?? 0), 0) ?? 0;
  const naechsteNr = (rows?.reduce((m, r) => Math.max(m, r.nr), 0) ?? 0) + 1;

  return (
    <section>
      <div className="toolbar">
        <h1>Einheiten – {props.objekt.bezeichnung}</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setEdit({ objekt_id: props.objekt.id, nr: naechsteNr, art: 'Wohnung' })}>
          Neue Einheit
        </button>
      </div>
      {rows && rows.length === 0 ? (
        <p className="hinweis">Noch keine Einheiten angelegt.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="num">Nr.</th><th>Bezeichnung</th><th>Art</th><th>Lage</th>
              <th className="num">m²</th><th className="num">Zi.</th>
              {zeigeEigentuemer && <th className="num">MEA</th>}
              {zeigeEigentuemer && <th className="seite-weg">Eigentümer</th>}
              {zeigeMieter && <th className="seite-miete">Mieter</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows?.map((e) => (
              <tr key={e.id} onDoubleClick={() => setEdit(e)}>
                <td className="num">{e.nr}</td>
                <td>{e.bezeichnung}</td>
                <td>{e.art}</td>
                <td>{e.lage}</td>
                <td className="num">{zahl(e.wohnflaeche)}</td>
                <td className="num">{zahl(e.zimmer)}</td>
                {zeigeEigentuemer && <td className="num">{zahl(e.mea)}</td>}
                {zeigeEigentuemer && <td className="seite-weg">{e.eigentuemer ?? <i>–</i>}</td>}
                {zeigeMieter && <td className="seite-miete">{e.mieter ?? <i>{e.selbstgenutzt ? 'selbst genutzt' : 'leer'}</i>}</td>}
                <td className="aktionen"><button onClick={() => setFotos(e)}>Fotos & Dokumente</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td /><td>{rows?.length ?? 0} Einheiten</td><td /><td />
              <td className="num">{zahl(summe('wohnflaeche'))}</td><td />
              {zeigeEigentuemer && <td className="num">{zahl(summe('mea'))}</td>}
              {zeigeEigentuemer && <td />}
              {zeigeMieter && <td />}
              <td />
            </tr>
          </tfoot>
        </table>
      )}
      <p className="hinweis klein">Doppelklick auf eine Zeile zum Bearbeiten.</p>
      <h3>Fotos & Dokumente des Objekts</h3>
      <Galerie filter={{ objekt_id: props.objekt.id }} hinweis={props.objekt.bezeichnung} />
      {fotos && (
        <Dialog titel={`Fotos & Dokumente – ${fotos.bezeichnung}`} onClose={() => setFotos(null)} breit>
          <Galerie filter={{ objekt_id: props.objekt.id, einheit_id: fotos.id }} hinweis={`${props.objekt.bezeichnung}, ${fotos.bezeichnung}`} />
        </Dialog>
      )}
      {edit && (
        <FormDialog
          title={edit.id ? 'Einheit bearbeiten' : 'Neue Einheit'}
          fields={FELDER}
          row={edit}
          onSave={(r) => call('save', 'einheiten', { ...r, objekt_id: props.objekt.id })}
          onDelete={() => call('remove', 'einheiten', edit.id)}
          onClose={() => {
            setEdit(null);
            reload();
          }}
        />
      )}
    </section>
  );
}
