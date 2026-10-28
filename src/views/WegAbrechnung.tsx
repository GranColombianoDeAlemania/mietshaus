import { useState } from 'react';
import { call, datum, diesesJahr, euro, fehler, heute, zahl, type Row } from '../api';
import { useLoad } from '../useLoad';
import { L } from '../navi';
import { absenderAus, alsPdf, empfaengerVon } from '../dokument';
import { wegEinzel, wegGesamt } from '../abrechnungDocs';
import { Gespeichert } from './NkAbrechnung';
import { bestaetigen } from '../frage';

// Annual statement for the owners' association with individual statements, reserve and asset report.
export function WegAbrechnung(props: { objekt: Row }) {
  const jahr = diesesJahr() - 1;
  const [von, setVon] = useState(`${jahr}-01-01`);
  const [bis, setBis] = useState(`${jahr}-12-31`);
  const [a, setA] = useState<Row | null>(null);
  const [meldung, setMeldung] = useState('');
  const [gespeichert, ladeGespeichert] = useLoad<Row[]>(() => call('abrechnungen', props.objekt.id, 'weg'), [props.objekt.id]);

  async function berechnen() {
    try {
      setA(await call('wegAbrechnung', props.objekt.id, von, bis));
      setMeldung('');
    } catch (e) {
      fehler(e);
    }
  }

  async function pdfs() {
    if (!a) return;
    const einst = await call('einstellungen');
    const absender = { ...absenderAus(einst), iban: props.objekt.iban || einst.verwalter_iban, bank: props.objekt.bank || einst.verwalter_bank, bic: props.objekt.bic || einst.verwalter_bic };
    const seiten = [wegGesamt(a, props.objekt)];
    for (const e of a.ergebnisse) seiten.push(wegEinzel(a, e, absender, props.objekt, await empfaengerVon(e.segment.vertrag)));
    await alsPdf(seiten, `Jahresabrechnung ${props.objekt.bezeichnung} ${von.slice(0, 4)}`);
  }

  async function speichern(buchen: boolean) {
    if (!a) return;
    const id = await call('abrechnungSpeichern', props.objekt.id, 'weg', von, bis, `Jahresabrechnung ${datum(von)} – ${datum(bis)}`, a);
    if (buchen) {
      const n = await call('abrechnungBuchen', props.objekt.id, 'weg_ergebnis', heute(), `Jahresabrechnung ${von.slice(0, 4)}`,
        a.ergebnisse.map((e: Row) => ({ konto_id: e.segment.konto_id, ergebnis_ct: e.ergebnis_ct })));
      await call('abrechnungGebucht', id);
      setMeldung(`Gespeichert und ${n} Abrechnungsspitzen auf die Eigentümerkonten gebucht.`);
    } else setMeldung('Abrechnung gespeichert.');
    ladeGespeichert();
  }

  const r = a?.ruecklage;
  return (
    <section>
      <div className="toolbar"><h1>Jahresabrechnung (Hausgeld)</h1></div>
      <div className="panel">
        <div className="maske">
          <label>Wirtschaftsjahr von<input type="date" value={von} onChange={(e) => setVon(e.target.value)} /></label>
          <label>bis<input type="date" value={bis} onChange={(e) => setBis(e.target.value)} /></label>
        </div>
        <p className="hinweis klein">
          Alle Kosten des Zeitraums werden nach dem WEG-Schlüssel des Kontos (Standard: Miteigentumsanteile) auf die Eigentümer
          verteilt, bei Eigentümerwechsel nach den Monaten, für die jeder Hausgeld zahlt. Ausgaben „aus Rücklage“ erscheinen nicht als Kosten, sondern in der Rücklagenentwicklung.
          Ergebnis je Eigentümer ist die Abrechnungsspitze: Kostenanteil minus Hausgeld-Vorschüsse (ohne Rücklagenanteil).
        </p>
        <div className="buttons"><span className="spacer" /><button className="primary" onClick={berechnen}>Berechnen</button></div>
      </div>
      {a && (
        <>
          {a.ohne_eigentuemer?.length > 0 && (
            <p className="fehler">
              Nicht verteilt: {euro(a.nicht_verteilt_ct)}. Diese Einheiten haben im Zeitraum (teilweise) keinen Eigentümer:{' '}
              {a.ohne_eigentuemer.map((o: Row) => `${o.einheit} (${datum(o.von)} – ${datum(o.bis)})`).join(', ')}. Bitte unter „Eigentümer“ ergänzen.
            </p>
          )}
          <div className="block">
            <h3>Gesamtabrechnung</h3>
            <table>
              <thead><tr><th>Kostenart</th><th>Schlüssel</th><th className="num">Gesamteinheiten</th><th className="num">Betrag</th></tr></thead>
              <tbody>
                {a.posten.map((p: Row, i: number) => (
                  <tr key={i}><td>{p.label}{p.umlagefaehig ? <span className="tag art-miete">umlegbar</span> : null}</td><td>{p.schluessel}</td>
                    <td className="num">{zahl(+p.gesamt_einheiten.toFixed(3))} {p.einheit}</td><td className="num">{euro(p.gesamt_ct)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}>Summe</td><td className="num"><b>{euro(a.summe_ct)}</b></td></tr></tfoot>
            </table>
          </div>
          <div className="block">
            <h3>Einzelabrechnungen</h3>
            <table>
              <thead><tr><th>Einheit</th><th>Eigentümer</th><th>Zeitraum</th><th className="num">Kostenanteil</th><th className="num">davon umlegbar</th><th className="num">Hausgeld-Soll</th><th className="num">Rücklage-Soll</th><th className="num">Abrechnungsspitze</th></tr></thead>
              <tbody>
                {a.ergebnisse.map((e: Row, i: number) => (
                  <tr key={i} data-ziel={`vertrag:weg:${e.segment.vertrag.id}`}>
                    <td><L zu={{ einheit: e.segment.einheit.id }}>{e.segment.einheit.bezeichnung}</L></td><td><L zu={{ vertrag: e.segment.vertrag.id, typ: 'weg' }}>{e.segment.vertrag.name}</L></td>
                    <td>{datum(e.segment.von)} – {datum(e.segment.bis)}</td>
                    <td className="num">{euro(e.kosten_ct)}</td><td className="num">{euro(e.umlagefaehig_ct)}</td>
                    <td className="num">{euro(e.hausgeld_soll_ct)}</td><td className="num">{euro(e.ruecklage_soll_ct)}</td>
                    <td className="num"><b className={e.ergebnis_ct > 0 ? 'negativ' : ''}>{e.ergebnis_ct > 0 ? 'Nachschuss ' : 'Guthaben '}{euro(Math.abs(e.ergebnis_ct))}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="kacheln">
            <div className="kachel"><div className="wert">{euro(r.anfang_ct)}</div><div className="label">Rücklage am {datum(von)}</div></div>
            <div className="kachel"><div className="wert">{euro(r.zufuehrung_soll_ct)}</div><div className="label">Soll-Zuführungen</div></div>
            <div className="kachel"><div className="wert">{euro(r.entnahmen_ct)}</div><div className="label">Entnahmen</div></div>
            <div className="kachel"><div className="wert">{euro(r.ende_ct)}</div><div className="label">Rücklage am {datum(bis)}</div></div>
            {a.vermoegen.geld.map((g: Row) => (
              <div className="kachel" key={g.id}><div className="wert">{euro(g.saldo_ct)}</div><div className="label">{g.bezeichnung}</div></div>
            ))}
          </div>
          <div className="toolbar">
            <span className="spacer" />
            {meldung && <span className="meldung">{meldung}</span>}
            <button onClick={pdfs}>Abrechnung als PDF</button>
            <button onClick={() => speichern(false)}>Speichern</button>
            <button className="primary" onClick={async () => await bestaetigen('Abrechnungsspitzen auf die Eigentümerkonten buchen? Erst nach Beschluss der Eigentümerversammlung sinnvoll.') && speichern(true)}>Speichern & buchen</button>
          </div>
        </>
      )}
      <Gespeichert liste={gespeichert} onOpen={(d) => { setA(d); setVon(d.von); setBis(d.bis); }} />
    </section>
  );
}
