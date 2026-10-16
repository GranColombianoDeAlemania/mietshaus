import { useState } from 'react';
import { betrag, call, datum, euro, fehler, type Modus, type Row } from '../api';
import { useLoad } from '../useLoad';
import { L } from '../navi';
import { frage } from '../frage';

const monatJetzt = () => new Date().toISOString().slice(0, 7);
const monatDe = (m: string) => `${m.slice(5)}/${m.slice(0, 4)}`;
const zeitraum = (ms: Row[]) => (ms.length > 1 ? `${monatDe(ms[0].monat)} bis ${monatDe(ms.at(-1)!.monat)}` : monatDe(ms[0].monat));

// After a contract or its amounts were changed. Charges from the start of automatic charging follow the contract by
// themselves; this offers to rebook older charges that no longer match and – for a new contract or a new start date –
// to charge the months since the start that the automation does not cover.
export async function sollNachfrage(typ: 'miete' | 'weg', id: number, opt: { fruehereMonate?: boolean } = {}) {
  try {
    const r: Row = await call('sollAbgleich', typ, id);
    const aenderbar = r.aenderungen.filter((a: Row) => !a.gesperrt && !a.manuell);
    const fest = r.aenderungen.filter((a: Row) => a.gesperrt || a.manuell);
    if (aenderbar.length || fest.length) {
      const wahl = await frage({
        titel: 'Gebuchte Forderungen passen nicht mehr zum Vertrag',
        text: <>
          <p className="hinweis">{r.name} ({r.einheit}): Für diese Monate ist ein anderer Betrag oder ein anderes Fälligkeitsdatum gebucht, als der Vertrag jetzt ergibt.</p>
          <table className="kompakt">
            <thead><tr><th>Monat</th><th className="num">gebucht</th><th className="num">laut Vertrag</th><th /></tr></thead>
            <tbody>{r.aenderungen.map((a: Row) => (
              <tr key={a.monat}><td>{monatDe(a.monat)}</td><td className="num">{euro(a.alt_ct)}<div className="klein hinweis">{datum(a.alt_datum)}</div></td>
                <td className="num"><b>{euro(a.neu_ct)}</b>{a.neu_datum && <div className="klein hinweis">{datum(a.neu_datum)}</div>}</td>
                <td className="klein hinweis">{a.gesperrt ? 'festgeschrieben' : a.manuell ? 'von Hand storniert' : ''}</td></tr>
            ))}</tbody>
          </table>
          {fest.length > 0 && <p className="klein hinweis">Festgeschriebene oder von Hand stornierte Monate bleiben unverändert; einen Unterschied dort bitte als eigene Buchung erfassen.</p>}
        </>,
        optionen: aenderbar.length ? [{ id: 'nein', label: 'Nicht anpassen' }, { id: 'ja', label: `${aenderbar.length === 1 ? '1 Monat' : `${aenderbar.length} Monate`} neu buchen`, primary: true }]
          : [{ id: 'nein', label: 'Verstanden' }],
      });
      if (wahl === 'ja') await call('sollAbgleich', typ, id, { anwenden: true });
    }
    if (opt.fruehereMonate && r.fehlend.length) {
      const e: Row = await call('einstellungen');
      const auto = e.auto_soll !== '0' && e.auto_soll_ab;
      const summe = r.fehlend.reduce((s: number, f: Row) => s + f.betrag_ct, 0);
      const wahl = await frage({
        titel: 'Frühere Monate als Forderung buchen?',
        text: <>
          <p>{r.name} ({r.einheit}): Der Vertrag beginnt am {datum(r.beginn)}. Für {zeitraum(r.fehlend)} ist noch keine {typ === 'weg' ? 'Hausgeldforderung' : 'Miete'} gebucht
            {' '}({r.fehlend.length === 1 ? '1 Monat' : `${r.fehlend.length} Monate`}, zusammen {euro(summe)}){auto ? ` – die automatische Sollstellung läuft erst seit ${monatDe(e.auto_soll_ab)}` : ''}.</p>
          <ul className="klein hinweis">
            <li><b>Buchen</b>, wenn du die Zahlungen ab Vertragsbeginn hier erfasst: Was nicht bezahlt ist, erscheint als Rückstand.</li>
            <li><b>Nicht buchen</b>, wenn diese Monate schon vor dem Programm erledigt waren, z. B. bei einem bestehenden Mietverhältnis.</li>
          </ul>
        </>,
        optionen: [{ id: 'nein', label: 'Nicht buchen' }, { id: 'ja', label: `${r.fehlend.length === 1 ? '1 Monat' : `${r.fehlend.length} Monate`} buchen`, primary: true }],
      });
      if (wahl === 'ja') await call('sollAbgleich', typ, id, { nachholen: true });
    }
  } catch (e) {
    fehler(e);
  }
}

// Monthly charges (rent, advance payments, house money) from the contracts.
export function Sollstellung(props: { objekt: Row; modus: Modus }) {
  const [von, setVon] = useState(monatJetzt());
  const [bis, setBis] = useState(monatJetzt());
  const [zeilen, reload] = useLoad<Row[]>(() => call('sollstellung', props.objekt.id, von, bis, true, [props.modus]), [props.objekt.id, von, bis, props.modus]);
  const [meldung, setMeldung] = useState('');

  const neu = (zeilen ?? []).filter((z) => !z.vorhanden);
  const summe = neu.reduce((s, z) => s + z.betrag_ct, 0);
  const abweichend = (zeilen ?? []).filter((z) => z.abweichend);

  async function buchen() {
    await call('sollstellung', props.objekt.id, von, bis, false, [props.modus]);
    setMeldung(`${neu.length} Sollbuchungen über ${euro(summe)} erzeugt.`);
    reload();
  }

  async function abgleichen() {
    for (const id of new Set(abweichend.map((z) => z.vertrag_id))) await sollNachfrage(props.modus as 'miete' | 'weg', id);
    reload();
  }

  return (
    <section>
      <div className="toolbar">
        <h1>Sollstellung</h1>
      </div>
      <p className="hinweis">
        Erzeugt die monatlichen Forderungen aus den {props.modus === 'weg' ? 'Eigentumsverhältnissen (Hausgeld, Rücklage)' : 'Mietverträgen (Miete, Vorauszahlungen)'} als
        Buchungen auf den {props.modus === 'weg' ? 'Eigentümerkonten' : 'Mieterkonten'}. Der laufende Monat wird automatisch gebucht – auch sofort, wenn du einen Vertrag
        anlegst oder änderst. Bereits erzeugte Monate werden übersprungen. Wie ein Ein- oder Auszug mitten im Monat
        berechnet wird (tagegenau, voller Monat oder ab dem Folgemonat), steht im jeweiligen Vertrag; der erste Monat ist nie vor dem Einzug fällig.
        Miet- und Hausgeldänderungen gelten ab ihrem Gültigkeitsdatum.
      </p>
      <div className="toolbar">
        <label>Von Monat <input type="month" value={von} onChange={(e) => setVon(e.target.value)} /></label>
        <label>bis <input type="month" value={bis} onChange={(e) => setBis(e.target.value < von ? von : e.target.value)} /></label>
        <span className="spacer" />
        {meldung && <span className="meldung">{meldung}</span>}
        {abweichend.length > 0 && <button onClick={abgleichen}>{abweichend.length} Abweichung{abweichend.length === 1 ? '' : 'en'} prüfen</button>}
        <button className="primary" disabled={!neu.length} onClick={buchen}>{neu.length} Sollbuchungen erzeugen</button>
      </div>
      <table>
        <thead><tr><th>Monat</th><th>Fällig</th><th>Vertrag</th><th>Einheit</th><th>Posten</th><th className="num">Betrag</th><th>Status</th></tr></thead>
        <tbody>
          {zeilen?.map((z, i) => (
            <tr key={i} className={z.vorhanden && !z.abweichend ? 'inaktiv' : ''} data-ziel={`vertrag:${z.typ}:${z.vertrag_id}`}>
              <td>{z.monat.slice(5)}/{z.monat.slice(0, 4)}</td>
              <td>{datum(z.datum)}</td>
              <td><L zu={{ vertrag: z.vertrag_id, typ: z.typ }}>{z.name}</L></td>
              <td><L zu={{ einheit: z.einheit_id }}>{z.einheit}</L></td>
              <td>{z.posten} {z.anteilig && <span className="tag" title="Ein- oder Auszug in diesem Monat">anteilig {z.tage}/{z.tage_monat} Tage</span>}</td>
              <td className="num">{betrag(z.betrag_ct)}</td>
              <td>{z.abweichend ? <span className="negativ" title="Der gebuchte Betrag passt nicht zum Vertrag">gebucht {euro(z.vorhanden_ct)}</span> : z.vorhanden ? 'bereits gebucht' : 'neu'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={5}>Summe neu</td><td className="num"><b>{betrag(summe)}</b></td><td /></tr></tfoot>
      </table>
    </section>
  );
}
