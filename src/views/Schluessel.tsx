import { useState } from 'react';
import { call, parseZahl, zahl, type Row } from '../api';
import { FormDialog, type Field } from '../Form';
import { useLoad } from '../useLoad';
import { ZAEHLER_ARTEN } from './Zaehler';

const TYPEN: [string, string][] = [
  ['flaeche', 'Wohnfläche (aus Einheiten)'],
  ['mea', 'Miteigentumsanteile (aus Einheiten)'],
  ['einheiten', 'Je Einheit gleich'],
  ['personen', 'Personen (aus Mietverhältnissen)'],
  ['zaehler', 'Zählerverbrauch im Abrechnungszeitraum'],
  ['manuell', 'Manuell eingeben'],
];

const FELDER = (f: Row): Field[] => [
  { key: 'bezeichnung', label: 'Bezeichnung', required: true },
  { key: 'einheit', label: 'Maßeinheit (z. B. m², MEA)' },
  { key: 'typ', label: 'Werte kommen aus', type: 'select', required: true, options: TYPEN },
  ...(f.typ === 'zaehler' ? [{ key: 'zaehler_art', label: 'Zählerart', type: 'select', required: true, options: ZAEHLER_ARTEN } as Field] : []),
];

// Allocation keys: how each cost is split across the units of an object.
export function Schluessel(props: { objekt: Row }) {
  const [keys, reload] = useLoad<Row[]>(() => call('schluessel', props.objekt.id), [props.objekt.id]);
  const [einheiten] = useLoad<Row[]>(() => call('einheiten', props.objekt.id), [props.objekt.id]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [werte, setWerte] = useState<Record<string, Record<number, string>>>({});

  const wert = (k: Row, eid: number) => werte[k.id]?.[eid] ?? (k.werte[eid] == null ? '' : String(k.werte[eid]).replace('.', ','));
  const summe = (k: Row) => einheiten?.reduce((s, e) => s + (parseZahl(wert(k, e.id)) ?? 0), 0) ?? 0;
  const geaendert = Object.keys(werte).length > 0;

  async function speichern() {
    for (const [kid, w] of Object.entries(werte))
      await call('setzeWerte', Number(kid), Object.fromEntries(Object.entries(w).map(([e, v]) => [e, parseZahl(v) ?? 0])));
    setWerte({});
    reload();
  }


  return (
    <section>
      <div className="toolbar">
        <h1>Umlageschlüssel – {props.objekt.bezeichnung}</h1>
        <span className="spacer" />
        <button onClick={() => setEdit({ typ: 'manuell' })}>Neuer Schlüssel</button>
        <button className="primary" disabled={!geaendert} onClick={speichern}>Werte speichern</button>
      </div>
      <p className="hinweis klein">
        Diese Schlüssel verteilen in den Abrechnungen die Kosten auf die Einheiten. Fläche, MEA, Einheiten und Personen kommen
        automatisch aus den Stammdaten (bei Personen tagegenau aus den Mietverhältnissen); nur „manuelle“ Schlüssel trägst du hier ein.
        Klick auf einen Spaltenkopf zum Bearbeiten des Schlüssels.
      </p>
      {keys && einheiten && (
        <div className="scroll-x">
          <table className="matrix">
            <thead>
              <tr>
                <th>Einheit</th>
                {keys.map((k) => (
                  <th key={k.id} className="num klickbar" onClick={() => setEdit(k)}>
                    {k.bezeichnung}
                    <div className="klein">{k.einheit}{k.typ === 'manuell' ? ' · manuell' : ''}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {einheiten.map((e) => (
                <tr key={e.id}>
                  <td>{e.nr} – {e.bezeichnung}</td>
                  {keys.map((k) => k.typ === 'zaehler' ? (
                    <td key={k.id} className="num klein hinweis">aus Zählern</td>
                  ) : k.typ !== 'manuell' ? (
                    <td key={k.id} className="num" title="Wird automatisch aus den Einheiten bzw. Mietverhältnissen übernommen">{zahl(k.werte[e.id])}</td>
                  ) : (
                    <td key={k.id} className="num">
                      <input
                        className="num zelle"
                        value={wert(k, e.id)}
                        onChange={(ev) => setWerte({ ...werte, [k.id]: { ...werte[k.id], [e.id]: ev.target.value } })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Summe</td>
                {keys.map((k) => <td key={k.id} className="num"><b>{zahl(summe(k))}</b></td>)}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {edit && (
        <FormDialog
          title={edit.id ? 'Schlüssel bearbeiten' : 'Neuer Schlüssel'}
          fields={FELDER}
          row={edit}
          onSave={(r) => call('save', 'umlageschluessel', { ...r, objekt_id: props.objekt.id })}
          onDelete={() => call('remove', 'umlageschluessel', edit.id)}
          onClose={() => {
            setEdit(null);
            reload();
          }}
        />
      )}
    </section>
  );
}
