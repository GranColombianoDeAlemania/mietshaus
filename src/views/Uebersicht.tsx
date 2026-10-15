import { call, euro, type Modus, type Row } from '../api';
import { useLoad } from '../useLoad';

export function Uebersicht(props: { modus: Modus }) {
  const [d] = useLoad<Row>(() => call('uebersicht', props.modus), [props.modus]);
  const weg = props.modus === 'weg';
  if (!d) return null;

  const kacheln: [string, string | number][] = [
    ['Objekte', d.objekte],
    ['Einheiten', d.einheiten],
    [weg ? 'Eigentumsverhältnisse' : 'Mietverhältnisse', d.vertraege],
    [weg ? 'Hausgeld-Soll / Monat' : 'Mieten-Soll / Monat', euro(d.soll_monat_ct)],
    [weg ? 'Einheiten ohne Eigentümer' : 'Leerstand (Einheiten)', d.leer],
  ];

  return (
    <section>
      <div className="toolbar">
        <h1>{weg ? 'WEG-Verwaltung' : 'Mietverwaltung'} – Übersicht</h1>
      </div>
      <div className="kacheln">
        {kacheln.map(([l, v]) => (
          <div className="kachel" key={l}>
            <div className="wert">{v}</div>
            <div className="label">{l}</div>
          </div>
        ))}
      </div>
      {d.objekte === 0 && (
        <div className="hinweis">
          <p><b>So geht's los:</b></p>
          <ol>
            <li>Unter <i>Objekte</i> ein Haus anlegen. Häuser mit Mietern und Eigentümern anlegen als „Miet/WEG gemischt“.</li>
            <li>Unter <i>Einheiten</i> die Wohnungen, Garagen usw. erfassen.</li>
            <li>Im <i>Adressbuch</i> die Personen anlegen.</li>
            <li>Unter <i>{weg ? 'Eigentümer' : 'Mieter'}</i> die Personen den Einheiten zuordnen.</li>
          </ol>
        </div>
      )}
    </section>
  );
}
