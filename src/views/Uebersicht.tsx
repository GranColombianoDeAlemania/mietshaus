import { call, datum, euro, type Modus, type Row } from '../api';
import { useLoad } from '../useLoad';

export function Uebersicht(props: { modus: Modus }) {
  const [d] = useLoad<Row>(() => call('uebersicht', props.modus), [props.modus]);
  const [f] = useLoad<Row>(() => call('faelligkeiten', 30), []);
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
      {f && (f.vorgaenge.length + f.termine.length + f.vertraege.length + f.eichungen.length + f.versicherungen.length > 0) && (
        <div className="panel">
          <h3>Demnächst fällig (30 Tage)</h3>
          <ul className="faellig">
            {f.termine.map((t: Row) => <li key={'t' + t.id}>📅 {datum(t.datum)} {t.uhrzeit} – {t.titel} {t.objekt && <span className="klein">({t.objekt})</span>}</li>)}
            {f.vorgaenge.map((v: Row) => <li key={'v' + v.id}>📌 {datum(v.faellig)} – Vorgang: {v.titel} {v.objekt && <span className="klein">({v.objekt})</span>}</li>)}
            {f.vertraege.map((v: Row, i: number) => <li key={'m' + i}>🔑 {datum(v.datum)} – Mietende {v.einheit} ({v.objekt})</li>)}
            {f.eichungen.map((z: Row, i: number) => <li key={'z' + i}>🔧 {datum(z.datum)} – Eichfrist Zähler {z.nummer ?? z.art} ({z.objekt})</li>)}
            {f.versicherungen.map((v: Row, i: number) => <li key={'s' + i}>📄 {datum(v.datum)} – Kündigungsfrist {v.art} {v.gesellschaft} ({v.objekt})</li>)}
          </ul>
        </div>
      )}
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
