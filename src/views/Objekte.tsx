import { useState } from 'react';
import { call, OBJEKT_ART, zahl, type Modus, type Row } from '../api';
import { FormDialog, type Field } from '../Form';
import { useAktion } from '../aktion';

const FELDER: Field[] = [
  { key: 'bezeichnung', label: 'Bezeichnung', required: true, wide: true },
  { key: 'art', label: 'Verwaltungsart', type: 'select', required: true, options: Object.entries(OBJEKT_ART) },
  { key: 'baujahr', label: 'Baujahr', type: 'number' },
  { key: 'strasse', label: 'Straße', wide: true, section: 'Anschrift' },
  { key: 'plz', label: 'PLZ' },
  { key: 'ort', label: 'Ort' },
  { key: 'wj_beginn', label: 'Beginn Wirtschaftsjahr (MM-TT)', section: 'Verwaltung' },
  { key: 'hausmeister', label: 'Hausmeister' },
  { key: 'bank', label: 'Bank', section: 'Objektkonto' },
  { key: 'iban', label: 'IBAN' },
  { key: 'bic', label: 'BIC' },
  { key: 'ruecklage_iban', label: 'IBAN Rücklagenkonto' },
  { key: 'sepa_glaeubiger_id', label: 'SEPA-Gläubiger-ID' },
  { key: 'kaufpreis_ct', label: 'Kaufpreis', type: 'money', section: 'Kauf & Steuer (für Rendite und AfA)' },
  { key: 'kaufnebenkosten_ct', label: 'Kaufnebenkosten', type: 'money' },
  { key: 'kaufdatum', label: 'Kaufdatum', type: 'date' },
  { key: 'gebaeudeanteil', label: 'Gebäudeanteil am Kaufpreis (%)', type: 'number' },
  { key: 'afa_satz', label: 'AfA-Satz (% pro Jahr, z. B. 2 / 2,5 / 3)', type: 'number' },
  { key: 'vorsteuer_quote', label: 'Abziehbare Vorsteuer in % (nur bei Gewerbe mit Umsatzsteuer)', type: 'number' },
  { key: 'kappungsgrenze', label: 'Kappungsgrenze für Mieterhöhungen (§ 558 BGB)', type: 'select', section: 'Mietrecht',
    options: [['20', '20 % in drei Jahren (Regelfall)'], ['15', '15 % – Gemeinde mit Kappungsgrenzen-Verordnung']] },
  { key: 'notiz', label: 'Notiz', type: 'textarea', section: 'Sonstiges' },
];

export function Objekte(props: { modus: Modus; objekte: Row[]; reload: () => void; onOpen: (id: number) => void }) {
  const [edit, setEdit] = useState<Row | null>(null);
  useAktion('neues-objekt', () => setEdit({ art: props.modus, wj_beginn: '01-01' }));

  return (
    <section>
      <div className="toolbar">
        <h1>Objekte</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setEdit({ art: props.modus, wj_beginn: '01-01' })}>
          Neues Objekt
        </button>
      </div>
      {props.objekte.length === 0 ? (
        <p className="hinweis">
          Noch keine Objekte in der {props.modus === 'weg' ? 'WEG-Verwaltung' : 'Mietverwaltung'}. Gemischte Objekte
          (Miete und WEG im selben Haus) erscheinen in beiden Bereichen.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Bezeichnung</th><th>Art</th><th>Anschrift</th><th className="num">Einheiten</th><th className="num">Fläche m²</th><th />
            </tr>
          </thead>
          <tbody>
            {props.objekte.map((o) => (
              <tr key={o.id} onDoubleClick={() => setEdit(o)}>
                <td>{o.bezeichnung}</td>
                <td><span className={`tag art-${o.art}`}>{OBJEKT_ART[o.art]}</span></td>
                <td>{[o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</td>
                <td className="num">{o.anzahl_einheiten}</td>
                <td className="num">{zahl(o.flaeche)}</td>
                <td className="aktionen">
                  <button onClick={() => props.onOpen(o.id)}>Einheiten</button>
                  <button onClick={() => setEdit(o)}>Bearbeiten</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {edit && (
        <FormDialog
          title={edit.id ? 'Objekt bearbeiten' : 'Neues Objekt'}
          fields={FELDER}
          row={edit}
          onSave={(r) => (r.id ? call('save', 'objekte', r) : call('neuesObjekt', r))}
          onDelete={() => call('remove', 'objekte', edit.id)}
          onClose={() => {
            setEdit(null);
            props.reload();
          }}
        />
      )}
    </section>
  );
}
