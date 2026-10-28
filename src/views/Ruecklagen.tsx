import { useState } from 'react';
import { call, datum, diesesJahr, euro, fehler, heute, parseCent, type Row } from '../api';
import { useLoad } from '../useLoad';
import { Zeitraum } from '../ui';

export function Ruecklagen(props: { objekt: Row }) {
  const [von, setVon] = useState(`${diesesJahr()}-01-01`);
  const [bis, setBis] = useState(`${diesesJahr()}-12-31`);
  const [r, reload] = useLoad<Row>(() => call('ruecklagen', props.objekt.id, von, bis), [props.objekt.id, von, bis]);
  const [keys] = useLoad<Row[]>(() => call('schluessel', props.objekt.id), [props.objekt.id]);
  const [su, setSu] = useState({ betrag: '', schluessel_id: '', datum: heute(), text: 'Sonderumlage' });
  const [ergebnis, setErgebnis] = useState<Row[] | null>(null);

  async function sonderumlage() {
    try {
      const sid = Number(su.schluessel_id) || keys?.find((k) => k.typ === 'mea')?.id;
      setErgebnis(await call('sonderumlage', props.objekt.id, { betrag_ct: parseCent(su.betrag), schluessel_id: sid, datum: su.datum, text: su.text }));
      reload();
    } catch (e) {
      fehler(e);
    }
  }

  return (
    <section>
      <div className="toolbar">
        <h1>Erhaltungsrücklage</h1>
        <span className="spacer" />
        <Zeitraum von={von} bis={bis} onChange={(a, b) => { setVon(a); setBis(b); }} />
      </div>
      {r && (
        <>
          <table>
            <tbody>
              <tr><td>Stand am {datum(von)}</td><td className="num">{euro(r.anfang_ct)}</td></tr>
              <tr><td>+ Soll-Zuführungen aus Hausgeld</td><td className="num">{euro(r.zufuehrung_soll_ct)}</td></tr>
              {r.eroeffnung_ct !== 0 && <tr><td>+ Eröffnung / Übernahme</td><td className="num">{euro(r.eroeffnung_ct)}</td></tr>}
              <tr><td>− Entnahmen</td><td className="num">{euro(-r.entnahmen_ct)}</td></tr>
              <tr className="zwischen"><td>Stand am {datum(bis)}</td><td className="num">{euro(r.ende_ct)}</td></tr>
              {r.bankkonto_ct != null && <tr><td>zum Vergleich: Saldo Rücklagen-Bankkonto</td><td className="num">{euro(r.bankkonto_ct)}</td></tr>}
              {r.zinsen_ct !== 0 && <tr><td>Zinserträge im Zeitraum</td><td className="num">{euro(r.zinsen_ct)}</td></tr>}
            </tbody>
          </table>
          {r.entnahmen.length > 0 && (
            <div className="block">
              <h3>Entnahmen</h3>
              <table>
                <thead><tr><th>Datum</th><th>Konto</th><th>Text</th><th className="num">Betrag</th></tr></thead>
                <tbody>{r.entnahmen.map((e: Row, i: number) => <tr key={i}><td>{datum(e.datum)}</td><td>{e.bezeichnung}</td><td>{e.text}</td><td className="num">{euro(e.betrag_ct)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <p className="hinweis klein">
            Ausgaben, die aus der Rücklage bezahlt werden, auf ein Kostenkonto mit dem Merkmal „aus Rücklage“ buchen (Standard: 45400).
            Einen übernommenen Anfangsbestand als Umbuchung Soll Rücklagen-Bankkonto an Haben 30000 Erhaltungsrücklage buchen.
          </p>
        </>
      )}
      <div className="panel">
        <h3>Sonderumlage erheben</h3>
        <div className="maske">
          <label>Gesamtbetrag (€)<input className="num" value={su.betrag} onChange={(e) => setSu({ ...su, betrag: e.target.value })} /></label>
          <label>Verteilen nach
            <select value={su.schluessel_id} onChange={(e) => setSu({ ...su, schluessel_id: e.target.value })}>
              <option value="">Miteigentumsanteile</option>
              {keys?.filter((k) => k.typ !== 'zaehler').map((k) => <option key={k.id} value={k.id}>{k.bezeichnung}</option>)}
            </select>
          </label>
          <label>Fällig am<input type="date" value={su.datum} onChange={(e) => setSu({ ...su, datum: e.target.value })} /></label>
          <label>Text<input value={su.text} onChange={(e) => setSu({ ...su, text: e.target.value })} /></label>
        </div>
        <div className="buttons">
          {ergebnis && <span className="meldung">{ergebnis.length} Forderungen gebucht: {ergebnis.map((e) => `${e.name} ${euro(e.betrag_ct)}`).join(', ')}</span>}
          <span className="spacer" />
          <button className="primary" disabled={!parseCent(su.betrag)} onClick={() => confirm('Sonderumlage als Forderung auf die Eigentümerkonten buchen?') && sonderumlage()}>Sonderumlage buchen</button>
        </div>
      </div>
    </section>
  );
}
