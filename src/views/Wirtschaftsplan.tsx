import { useEffect, useState } from 'react';
import { call, datum, diesesJahr, euro, fehler, parseCent, type Row } from '../api';
import { useLoad } from '../useLoad';
import { L } from '../navi';
import { absenderAus, alsPdf, bericht, esc, tabelle, empfaengerVon } from '../dokument';
import { wiplEinzel } from '../abrechnungDocs';
import { Gespeichert } from './NkAbrechnung';
import { bestaetigen } from '../frage';

const cent2 = (ct: number) => (ct / 100).toFixed(2).replace('.', ',');

export function Wirtschaftsplan(props: { objekt: Row }) {
  const [jahr, setJahr] = useState(diesesJahr() + 1);
  const [vorschlag] = useLoad<Row[]>(() => call('wirtschaftsplanVorschlag', props.objekt.id, jahr), [props.objekt.id, jahr]);
  const [keys] = useLoad<Row[]>(() => call('schluessel', props.objekt.id), [props.objekt.id]);
  const [plan, setPlan] = useState<Record<number, string>>({});
  const [ruecklage, setRuecklage] = useState('0,00');
  const [w, setW] = useState<Row | null>(null);
  const [ab, setAb] = useState(`${jahr}-01-01`);
  const [meldung, setMeldung] = useState('');
  const [gespeichert, ladeGespeichert] = useLoad<Row[]>(() => call('abrechnungen', props.objekt.id, 'wipl'), [props.objekt.id]);

  useEffect(() => {
    if (vorschlag) setPlan(Object.fromEntries(vorschlag.map((v) => [v.konto_id, cent2(v.vorjahr_ct)])));
    setAb(`${jahr}-01-01`);
  }, [vorschlag]);

  const summe = Object.values(plan).reduce((s, v) => s + parseCent(v), 0);

  async function berechnen() {
    try {
      const mea = keys?.find((k) => k.typ === 'mea')?.id;
      setW(await call('wirtschaftsplanBerechnen', props.objekt.id, jahr,
        Object.entries(plan).map(([k, v]) => ({ konto_id: Number(k), betrag_ct: parseCent(v) })), parseCent(ruecklage), mea));
    } catch (e) {
      fehler(e);
    }
  }

  async function pdf() {
    if (!w) return;
    const einst = await call('einstellungen');
    const absender = absenderAus(einst);
    const gesamt = bericht(`Wirtschaftsplan ${jahr}`, props.objekt.bezeichnung,
      tabelle(['Kostenart', 'Schlüssel', '#rBetrag'], w.posten.map((p: Row) => [esc(p.label), esc(p.schluessel), `#r${euro(p.gesamt_ct)}`]),
        { summe: ['Summe Kosten', '', `#r${euro(w.summe_ct)}`] }) +
      `<p>Zuführung zur Erhaltungsrücklage: <b>${euro(w.ruecklage_ct)}</b></p>` +
      tabelle(['Einheit', 'Eigentümer', '#rKosten', '#rRücklage', '#rHausgeld mtl.'],
        w.zeilen.map((z: Row) => [esc(z.einheit.bezeichnung), esc(z.eigentum?.name ?? '–'), `#r${euro(z.kosten_ct)}`, `#r${euro(z.ruecklage_ct)}`, `#r${euro(z.monat_hausgeld_ct)}`])));
    const seiten = [gesamt];
    for (const z of w.zeilen.filter((z: Row) => z.eigentum)) seiten.push(wiplEinzel(w, z, absender, props.objekt, await empfaengerVon(z.eigentum), ab));
    await alsPdf(seiten, `Wirtschaftsplan ${props.objekt.bezeichnung} ${jahr}`);
  }

  async function uebernehmen() {
    if (!w) return;
    const liste = w.zeilen.filter((z: Row) => z.eigentum).map((z: Row) => ({ vertrag_id: z.eigentum.id, hausgeld_ct: z.monat_hausgeld_ct, ruecklage_ct: z.monat_ruecklage_ct }));
    const n = await call('anpassungenAnwenden', 'weg', ab, 'wirtschaftsplan', liste);
    await call('abrechnungSpeichern', props.objekt.id, 'wipl', `${jahr}-01-01`, `${jahr}-12-31`, `Wirtschaftsplan ${jahr}`, { ...w, ab });
    ladeGespeichert();
    setMeldung(`Neues Hausgeld für ${n} Eigentümer ab ${datum(ab)} hinterlegt.`);
  }

  return (
    <section>
      <div className="toolbar">
        <h1>Wirtschaftsplan</h1>
        <span className="spacer" />
        <label>Jahr <input className="kurz num" type="number" value={jahr} onChange={(e) => setJahr(Number(e.target.value))} /></label>
      </div>
      <p className="hinweis klein">Vorgeschlagen sind die tatsächlichen Kosten des Vorjahres. Passe die Ansätze an und lege die Zuführung zur Erhaltungsrücklage fest.</p>
      <table>
        <thead><tr><th>Konto</th><th>Kostenart</th><th className="num">Vorjahr</th><th className="num">Ansatz {jahr}</th></tr></thead>
        <tbody>
          {vorschlag?.map((v) => (
            <tr key={v.konto_id}>
              <td className="num">{v.nr}</td><td>{v.bezeichnung}</td><td className="num">{euro(v.vorjahr_ct)}</td>
              <td className="num"><input className="num zelle" value={plan[v.konto_id] ?? ''} onChange={(e) => setPlan({ ...plan, [v.konto_id]: e.target.value })} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td /><td>Zuführung Erhaltungsrücklage (Jahr)</td><td /><td className="num"><input className="num zelle" value={ruecklage} onChange={(e) => setRuecklage(e.target.value)} /></td></tr>
          <tr><td /><td>Summe Kosten</td><td /><td className="num"><b>{euro(summe)}</b></td></tr>
        </tfoot>
      </table>
      <div className="buttons"><span className="spacer" /><button className="primary" onClick={berechnen}>Auf Eigentümer verteilen</button></div>
      {w && (
        <div className="block">
          <h3>Hausgeld je Eigentümer</h3>
          <table>
            <thead><tr><th>Einheit</th><th>Eigentümer</th><th className="num">Kostenanteil</th><th className="num">Rücklage</th><th className="num">Hausgeld monatlich</th><th className="num">davon Rücklage</th></tr></thead>
            <tbody>
              {w.zeilen.map((z: Row) => (
                <tr key={z.einheit.id}>
                  <td><L zu={{ einheit: z.einheit.id }}>{z.einheit.bezeichnung}</L></td><td>{z.eigentum ? <L zu={{ vertrag: z.eigentum.id, typ: 'weg' }}>{z.eigentum.name}</L> : <i>kein Eigentümer</i>}</td>
                  <td className="num">{euro(z.kosten_ct)}</td><td className="num">{euro(z.ruecklage_ct)}</td>
                  <td className="num"><b>{euro(z.monat_hausgeld_ct)}</b></td><td className="num">{euro(z.monat_ruecklage_ct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="toolbar">
            <label>Gültig ab <input type="date" value={ab} onChange={(e) => setAb(e.target.value)} /></label>
            <span className="spacer" />
            {meldung && <span className="meldung">{meldung}</span>}
            <button onClick={pdf}>Als PDF</button>
            <button className="primary" onClick={async () => await bestaetigen('Neues Hausgeld für alle Eigentümer hinterlegen? Erst nach Beschluss sinnvoll.') && uebernehmen()}>Hausgeld übernehmen</button>
          </div>
        </div>
      )}
      <Gespeichert liste={gespeichert} onOpen={(d) => { setW(d); if (d.ab) setAb(d.ab); }} />
    </section>
  );
}
