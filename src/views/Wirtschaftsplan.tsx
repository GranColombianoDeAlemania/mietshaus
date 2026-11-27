import { useEffect, useState } from 'react';
import { Tabs } from '../ui';
import { call, datum, diesesJahr, euro, fehler, parseCent, type Row } from '../api';
import { useLoad } from '../useLoad';
import { L } from '../navi';
import { absenderAus, zahlungsAbsender, alsPdf, bericht, esc, tabelle, empfaengerVon } from '../dokument';
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
  // Assistant like the professional programs: plan figures → income, shortfall, reserve → distribute → letters and apply.
  const [schritt, setSchritt] = useState<'ansaetze' | 'einnahmen' | 'verteilen' | 'uebernahme'>('ansaetze');
  const [prozent, setProzent] = useState('');
  const [einnahmen, setEinnahmen] = useState<{ bezeichnung: string; betrag: string }[]>([]);
  const [ausfall, setAusfall] = useState('0');
  const [rundung, setRundung] = useState(100);
  const [schwelle, setSchwelle] = useState('5,00');
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
        Object.entries(plan).map(([k, v]) => ({ konto_id: Number(k), betrag_ct: parseCent(v) })), parseCent(ruecklage), mea,
        { einnahmen: einnahmen.map((e) => ({ bezeichnung: e.bezeichnung, betrag_ct: parseCent(e.betrag) })), ausfall_prozent: Number(ausfall.replace(',', '.')) || 0, rundung }));
      setSchritt('verteilen');
    } catch (e) {
      fehler(e);
    }
  }

  async function pdf() {
    if (!w) return;
    const einst = await call('einstellungen');
    const absender = zahlungsAbsender(einst, props.objekt);
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
    // Only changes above the threshold are applied; smaller ones keep the current amount (fewer standing orders to change).
    const grenze = parseCent(schwelle);
    const liste = w.zeilen.filter((z: Row) => z.eigentum && (z.aktuell_ct == null || Math.abs(z.monat_hausgeld_ct - z.aktuell_ct) >= grenze))
      .map((z: Row) => ({ vertrag_id: z.eigentum.id, hausgeld_ct: z.monat_hausgeld_ct, ruecklage_ct: z.monat_ruecklage_ct }));
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
      <Tabs tabs={[['ansaetze', '1 Ansätze'], ['einnahmen', '2 Einnahmen & Rücklage'], ['verteilen', '3 Verteilen'], ['uebernahme', '4 Briefe & Übernahme']]} value={schritt} onChange={setSchritt} />
      {schritt === 'ansaetze' && (
        <>
          <p className="hinweis klein">Vorgeschlagen sind die tatsächlichen Kosten des Vorjahres. Nur die Spalte „Ansatz“ ist zu bearbeiten; eine pauschale Anpassung in Prozent gilt für alle Zeilen.</p>
          <div className="toolbar"><label>Alle Ansätze um <input className="kurz num" value={prozent} onChange={(e) => setProzent(e.target.value)} placeholder="z. B. 3" /> %</label>
            <button disabled={!prozent} onClick={() => { const p = Number(prozent.replace(',', '.')) || 0; setPlan(Object.fromEntries((vorschlag ?? []).map((v) => [v.konto_id, cent2(Math.round(v.vorjahr_ct * (1 + p / 100)))]))); }}>anpassen</button></div>
          <table>
            <thead><tr><th>Konto</th><th>Kostenart</th><th className="num">Vorjahr</th><th className="num">Ansatz {jahr}</th></tr></thead>
            <tbody>
              {vorschlag?.map((v) => (
                <tr key={v.konto_id}>
                  <td className="num">{v.nr}</td><td><L zu={{ konto: v.konto_id }}>{v.bezeichnung}</L></td><td className="num">{euro(v.vorjahr_ct)}</td>
                  <td className="num"><input className="num zelle" value={plan[v.konto_id] ?? ''} onChange={(e) => setPlan({ ...plan, [v.konto_id]: e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td /><td>Summe Kosten</td><td /><td className="num"><b>{euro(summe)}</b></td></tr></tfoot>
          </table>
          <div className="buttons"><span className="spacer" /><button className="primary" onClick={() => setSchritt('einnahmen')}>Weiter</button></div>
        </>
      )}
      {schritt === 'einnahmen' && (
        <>
          <div className="maske" style={{ marginTop: 12 }}>
            <label>Zuführung Erhaltungsrücklage (Jahr, €)<input className="num" value={ruecklage} onChange={(e) => setRuecklage(e.target.value)} /></label>
            <label>Ansatz für Hausgeldausfälle (% der Kosten)<input className="num" value={ausfall} onChange={(e) => setAusfall(e.target.value)} /></label>
            <label>Monatsbeträge runden auf
              <select value={rundung} onChange={(e) => setRundung(Number(e.target.value))}><option value={0}>Cent (keine Rundung)</option><option value={100}>volle Euro</option><option value={500}>5 Euro</option><option value={1000}>10 Euro</option></select>
            </label>
          </div>
          <h3>Erwartete Einnahmen (mindern das Hausgeld)</h3>
          {einnahmen.map((e, i) => (
            <div className="toolbar" key={i}>
              <input value={e.bezeichnung} placeholder="z. B. Miete Stellplatz, Zinsen" onChange={(ev) => setEinnahmen(einnahmen.map((x, k) => (k === i ? { ...x, bezeichnung: ev.target.value } : x)))} />
              <input className="kurz num" value={e.betrag} placeholder="€ im Jahr" onChange={(ev) => setEinnahmen(einnahmen.map((x, k) => (k === i ? { ...x, betrag: ev.target.value } : x)))} />
              <button onClick={() => setEinnahmen(einnahmen.filter((_, k) => k !== i))}>Entfernen</button>
            </div>
          ))}
          <div className="buttons"><button onClick={() => setEinnahmen([...einnahmen, { bezeichnung: '', betrag: '' }])}>Einnahme hinzufügen</button><span className="spacer" />
            <button onClick={() => setSchritt('ansaetze')}>Zurück</button><button className="primary" onClick={berechnen}>Auf Eigentümer verteilen</button></div>
        </>
      )}
      {schritt === 'verteilen' && w && (
        <div className="block">
          <h3>Hausgeld je Eigentümer</h3>
          {w.hinweise?.map((h: string) => <p key={h} className="hinweis klein">{h}</p>)}
          <table>
            <thead><tr><th>Einheit</th><th>Eigentümer</th><th className="num">Kostenanteil</th><th className="num">Rücklage</th><th className="num">bisher mtl.</th><th className="num">Hausgeld mtl.</th><th className="num">davon Rücklage</th></tr></thead>
            <tbody>
              {w.zeilen.map((z: Row) => (
                <tr key={z.einheit.id}>
                  <td><L zu={{ einheit: z.einheit.id }}>{z.einheit.bezeichnung}</L></td><td>{z.eigentum ? <L zu={{ vertrag: z.eigentum.id, typ: 'weg' }}>{z.eigentum.name}</L> : <i>kein Eigentümer</i>}</td>
                  <td className="num">{euro(z.kosten_ct)}</td><td className="num">{euro(z.ruecklage_ct)}</td><td className="num">{z.aktuell_ct != null ? euro(z.aktuell_ct) : '–'}</td>
                  <td className="num"><b>{euro(z.monat_hausgeld_ct)}</b></td><td className="num">{euro(z.monat_ruecklage_ct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="buttons"><button onClick={() => setSchritt('einnahmen')}>Zurück</button><span className="spacer" /><button className="primary" onClick={() => setSchritt('uebernahme')}>Weiter</button></div>
        </div>
      )}
      {schritt === 'verteilen' && !w && <p className="hinweis">Erst in Schritt 2 „Auf Eigentümer verteilen“.</p>}
      {schritt === 'uebernahme' && (w ? (
        <div className="block">
          <p className="hinweis klein">Beschlossen werden nur die Vorschüsse (§ 28 Abs. 1 WEG). Erst nach dem Beschluss das neue Hausgeld übernehmen; Änderungen unter dem Schwellenwert bleiben beim bisherigen Betrag.</p>
          <div className="toolbar">
            <label>Gültig ab <input type="date" value={ab} onChange={(e) => setAb(e.target.value)} /></label>
            <label>nur übernehmen ab Abweichung (€) <input className="kurz num" value={schwelle} onChange={(e) => setSchwelle(e.target.value)} /></label>
            <span className="spacer" />
            {meldung && <span className="meldung">{meldung}</span>}
            <button onClick={pdf}>Als PDF</button>
            <button className="primary" onClick={async () => await bestaetigen('Neues Hausgeld für die Eigentümer hinterlegen? Erst nach Beschluss sinnvoll.') && uebernehmen()}>Hausgeld übernehmen</button>
          </div>
        </div>
      ) : <p className="hinweis">Erst in Schritt 2 „Auf Eigentümer verteilen“.</p>)}
      <Gespeichert liste={gespeichert} onOpen={(d) => { setW(d); if (d.ab) setAb(d.ab); }} />
    </section>
  );
}
