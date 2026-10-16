import { useState } from 'react';
import { betrag, call, datum, euro, type Modus, type Row } from '../api';
import { useLoad } from '../useLoad';
import { L } from '../navi';

const monatJetzt = () => new Date().toISOString().slice(0, 7);

// Monthly charges (rent, advance payments, house money) from the contracts.
export function Sollstellung(props: { objekt: Row; modus: Modus }) {
  const [von, setVon] = useState(monatJetzt());
  const [bis, setBis] = useState(monatJetzt());
  const [zeilen, reload] = useLoad<Row[]>(() => call('sollstellung', props.objekt.id, von, bis, true, [props.modus]), [props.objekt.id, von, bis, props.modus]);
  const [meldung, setMeldung] = useState('');

  const neu = (zeilen ?? []).filter((z) => !z.vorhanden);
  const summe = neu.reduce((s, z) => s + z.betrag_ct, 0);

  async function buchen() {
    await call('sollstellung', props.objekt.id, von, bis, false, [props.modus]);
    setMeldung(`${neu.length} Sollbuchungen über ${euro(summe)} erzeugt.`);
    reload();
  }

  return (
    <section>
      <div className="toolbar">
        <h1>Sollstellung</h1>
      </div>
      <p className="hinweis">
        Erzeugt die monatlichen Forderungen aus den {props.modus === 'weg' ? 'Eigentumsverhältnissen (Hausgeld, Rücklage)' : 'Mietverträgen (Miete, Vorauszahlungen)'} als
        Buchungen auf den {props.modus === 'weg' ? 'Eigentümerkonten' : 'Mieterkonten'}. Bereits erzeugte Monate werden übersprungen. Wie ein Ein- oder Auszug mitten im Monat
        berechnet wird (tagegenau, voller Monat oder ab dem Folgemonat), steht im jeweiligen Vertrag; der erste Monat ist nie vor dem Einzug fällig.
        Miet- und Hausgeldänderungen gelten ab ihrem Gültigkeitsdatum.
      </p>
      <div className="toolbar">
        <label>Von Monat <input type="month" value={von} onChange={(e) => setVon(e.target.value)} /></label>
        <label>bis <input type="month" value={bis} onChange={(e) => setBis(e.target.value < von ? von : e.target.value)} /></label>
        <span className="spacer" />
        {meldung && <span className="meldung">{meldung}</span>}
        <button className="primary" disabled={!neu.length} onClick={buchen}>{neu.length} Sollbuchungen erzeugen</button>
      </div>
      <table>
        <thead><tr><th>Monat</th><th>Fällig</th><th>Vertrag</th><th>Einheit</th><th>Posten</th><th className="num">Betrag</th><th>Status</th></tr></thead>
        <tbody>
          {zeilen?.map((z, i) => (
            <tr key={i} className={z.vorhanden ? 'inaktiv' : ''} data-ziel={`vertrag:${z.typ}:${z.vertrag_id}`}>
              <td>{z.monat.slice(5)}/{z.monat.slice(0, 4)}</td>
              <td>{datum(z.datum)}</td>
              <td><L zu={{ vertrag: z.vertrag_id, typ: z.typ }}>{z.name}</L></td>
              <td><L zu={{ einheit: z.einheit_id }}>{z.einheit}</L></td>
              <td>{z.posten} {z.anteilig && <span className="tag" title="Ein- oder Auszug in diesem Monat">anteilig {z.tage}/{z.tage_monat} Tage</span>}</td>
              <td className="num">{betrag(z.betrag_ct)}</td>
              <td>{z.vorhanden ? 'bereits gebucht' : 'neu'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={5}>Summe neu</td><td className="num"><b>{betrag(summe)}</b></td><td /></tr></tfoot>
      </table>
    </section>
  );
}
