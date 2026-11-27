import { useState } from 'react';
import { call, datum, diesesJahr, euro, fehler, heute, zahl, type Row } from '../api';
import { useLoad } from '../useLoad';
import { L } from '../navi';
import { absenderAus, zahlungsAbsender, alsPdf, empfaengerVon } from '../dokument';
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
    const absender = zahlungsAbsender(einst, props.objekt);
    const seiten = [wegGesamt(a, props.objekt)];
    for (const e of a.ergebnisse) seiten.push(wegEinzel(a, e, absender, props.objekt, await empfaengerVon(e.segment.vertrag)));
    await alsPdf(seiten, `Jahresabrechnung ${props.objekt.bezeichnung} ${von.slice(0, 4)}`);
  }

  async function speichern(buchen: boolean) {
    if (!a) return;
    const id = await call('abrechnungSpeichern', props.objekt.id, 'weg', von, bis, `Jahresabrechnung ${datum(von)} – ${datum(bis)}`, a);
    if (buchen) {
      if (a.nicht_verteilt_ct && !await bestaetigen(`${euro(a.nicht_verteilt_ct)} der Kosten sind keinem Eigentümer zugeordnet. Trotzdem buchen?`)) return;
      // Fälligkeitstheorie: each unit's Abrechnungsspitze goes to its owner on the booking (resolution) day.
      const r = await call('wegAbrechnung', props.objekt.id, von, bis, { stichtag: heute() });
      const n = await call('abrechnungBuchen', props.objekt.id, 'weg_ergebnis', heute(), `Jahresabrechnung ${von.slice(0, 4)}`,
        r.spitzen.map((s: Row) => ({ konto_id: s.konto_id, ergebnis_ct: s.ergebnis_ct })));
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
          verteilt, Heizkosten nach HeizkostenV (70 % Verbrauch, 30 % Fläche). Bei Eigentümerwechsel zeigt die Abrechnung die Monate je Eigentümer;
          die Abrechnungsspitze schuldet der Eigentümer am Tag des Beschlusses. Ausgaben „aus Rücklage“ erscheinen nicht als Kosten, sondern in der Rücklagenentwicklung.
          Ergebnis je Eigentümer ist die Abrechnungsspitze: Kostenanteil minus Hausgeld-Vorschüsse (ohne Rücklagenanteil).
        </p>
        <div className="buttons"><span className="spacer" /><button className="primary" onClick={berechnen}>Berechnen</button></div>
      </div>
      {a && (
        <>
          {a.nicht_verteilt_ct !== 0 && (
            <p className="fehler">
              Nicht verteilt: {euro(a.nicht_verteilt_ct)}.{' '}
              {a.ohne_eigentuemer?.length > 0
                ? <>Diese Einheiten haben im Zeitraum (teilweise) keinen Eigentümer: {a.ohne_eigentuemer.map((o: Row) => `${o.einheit} (${datum(o.von)} – ${datum(o.bis)})`).join(', ')}. Bitte unter „Eigentümer“ ergänzen.</>
                : <>Ein Verbrauchsschlüssel ergibt 0 (keine Zählerstände) – diese Kosten trägt sonst niemand. Zählerstände erfassen oder einen anderen Schlüssel wählen.</>}
            </p>
          )}
          {a.heiz_ohne_verbrauch?.length > 0 && (
            <p className="fehler">Heizkosten ohne Verbrauchserfassung: {a.heiz_ohne_verbrauch.join(', ')} – verteilt nach dem WEG-Schlüssel. Die HeizkostenV verlangt auch unter Eigentümern 50–70 % nach Verbrauch; Zähler-Schlüssel (Wärme/Heizkostenverteiler bzw. Warmwasser) und Stände ergänzen.</p>
          )}
          {a.spitzen?.some((s: Row) => s.wechsel) && (
            <p className="hinweis">Eigentümerwechsel: Die Abrechnungsspitze schuldet, wer am Tag des Beschlusses Eigentümer ist (Fälligkeitstheorie) – gebucht wird sie deshalb ganz auf {a.spitzen.filter((s: Row) => s.wechsel).map((s: Row) => `${s.schuldner.name} (${s.einheit.bezeichnung}, ${euro(s.ergebnis_ct)})`).join(', ')}. Die Aufteilung nach Zeiträumen unten ist eine Information für den Ausgleich zwischen Verkäufer und Käufer.</p>
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
                    <td className="num">{euro(e.hausgeld_soll_ct)}{e.sonderumlage_ct ? <div className="klein hinweis">+ Sonderumlage {euro(e.sonderumlage_ct)}</div> : null}</td><td className="num">{euro(e.ruecklage_soll_ct)}</td>
                    <td className="num"><b className={e.ergebnis_ct > 0 ? 'negativ' : ''}>{e.ergebnis_ct > 0 ? 'Nachschuss ' : 'Guthaben '}{euro(Math.abs(e.ergebnis_ct))}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {a.vergleich?.length > 0 && (
            <p className="hinweis">Gegenüber dem Vorjahr deutlich verändert: {a.vergleich.map((x: Row) => `${x.bezeichnung} ${euro(x.vorjahr_ct)} → ${euro(x.jetzt_ct)}`).join('; ')}. Bitte vor dem Versand prüfen.</p>
          )}
          <div className="block">
            <h3>Abstimmung: Konten, Rücklage und Vermögen</h3>
            <table>
              <thead><tr><th>Konto</th><th className="num">Anfang</th><th className="num">Eingänge</th><th className="num">Ausgänge</th><th className="num">Ende</th><th /></tr></thead>
              <tbody>{(a.konten_entwicklung ?? []).map((k: Row) => (
                <tr key={k.id}><td>{k.bezeichnung}</td><td className="num">{euro(k.anfang_ct)}</td><td className="num">{euro(k.ein_ct)}</td><td className="num">{euro(-k.aus_ct)}</td><td className="num">{euro(k.ende_ct)}</td>
                  <td>{k.stimmt ? <span className="tag art-weg">stimmt</span> : <span className="tag">Differenz</span>}</td></tr>
              ))}</tbody>
            </table>
            <p className="klein hinweis">Rücklage Soll {euro(r.ende_ct)} · Ist {euro(r.ist_ende_ct)}{r.bankkonto_ct != null ? ` · Rücklagenkonto ${euro(r.bankkonto_ct)}${Math.abs(r.bankkonto_ct - r.ist_ende_ct) > 100 ? ' – weicht vom Ist ab, Buchungen prüfen' : ''}` : ''}.
              {(a.vermoegen.forderungen_nach_art ?? []).length > 0 && ` Offene Forderungen: ${a.vermoegen.forderungen_nach_art.map((x: Row) => `${x.art} ${euro(x.ct)}`).join(', ')}.`}
              {(a.vermoegen.verbindlichkeiten ?? []).length > 0 && ` Noch nicht gebuchte Rechnungen: ${euro(a.vermoegen.verbindlichkeiten.reduce((s2: number, x: Row) => s2 + x.betrag_ct, 0))}.`}</p>
          </div>
          <div className="kacheln">
            <div className="kachel"><div className="wert">{euro(r.anfang_ct)}</div><div className="label">Rücklage am {datum(von)}</div></div>
            <div className="kachel"><div className="wert">{euro(r.zufuehrung_soll_ct)}</div><div className="label">Soll-Zuführungen</div></div>
            <div className="kachel"><div className="wert">{euro(r.entnahmen_ct)}</div><div className="label">Entnahmen</div></div>
            <div className="kachel"><div className="wert">{euro(r.ende_ct)}</div><div className="label">Rücklage (Soll) am {datum(bis)}</div></div>
            <div className="kachel"><div className="wert">{euro(r.ist_ende_ct)}</div><div className="label">Rücklage (Ist) am {datum(bis)}</div></div>
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
