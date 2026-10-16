import { useState } from 'react';
import * as I from 'lucide-react';
import { call, datum, diesesJahr, euro, fehler, heute, parseCent, parseZahl, zahl, type Row } from '../api';
import { useLoad } from '../useLoad';
import { L, mitLinks } from '../navi';
import { Tabs } from '../ui';
import { absenderAus, alsPdf, empfaengerVon } from '../dokument';
import { nkBrief, nkUebersicht } from '../abrechnungDocs';

const ersterNaechsterMonat = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1)).toISOString().slice(0, 10);
};

// Service-charge statement for tenants (Betriebs- und Heizkostenabrechnung).
export function NkAbrechnung(props: { objekt: Row }) {
  const jahr = diesesJahr() - 1;
  const [von, setVon] = useState(`${jahr}-01-01`);
  const [bis, setBis] = useState(`${jahr}-12-31`);
  const [heizung, setHeizung] = useState<'intern' | 'extern' | 'ohne'>('intern');
  const [anteil, setAnteil] = useState(70);
  const [co2Kg, setCo2Kg] = useState('');
  const [co2Eur, setCo2Eur] = useState('');
  const [leerPersonen, setLeerPersonen] = useState(1);
  const [extern, setExtern] = useState<Record<number, string>>({});
  const [a, setA] = useState<Row | null>(null);
  const [pruefung, setPruefung] = useState<Row | null>(null);
  const [neuVz, setNeuVz] = useState<Record<number, { bk: string; hk: string }>>({});
  const [neuAb, setNeuAb] = useState(ersterNaechsterMonat());
  const [meldung, setMeldung] = useState('');
  const [gespeichert, ladeGespeichert] = useLoad<Row[]>(() => call('abrechnungen', props.objekt.id, 'nk'), [props.objekt.id]);
  const [vertraege] = useLoad<Row[]>(() => call('vertraege', 'mietverhaeltnisse', props.objekt.id), [props.objekt.id]);

  const relevant = (vertraege ?? []).filter((v) => v.beginn <= bis && (!v.ende || v.ende >= von));

  async function berechnen() {
    try {
      const opt = {
        heizung, verbrauchsanteil: anteil, co2_kg: parseZahl(co2Kg) ?? 0, co2_kosten_ct: parseCent(co2Eur), leerstand_personen: leerPersonen,
        extern: Object.fromEntries(Object.entries(extern).map(([k, v]) => [k, parseCent(v)])),
      };
      const r = await call('nkAbrechnung', props.objekt.id, von, bis, opt);
      setA(r);
      setPruefung(await call('nkPruefung', props.objekt.id, von, bis, opt));
      setNeuVz(Object.fromEntries(r.ergebnisse.filter((e: Row) => e.segment.vertrag && (!e.segment.vertrag.ende || e.segment.vertrag.ende >= heute()))
        .map((e: Row) => [e.segment.vertrag.id, { bk: (e.neu_bk_vz_ct / 100).toFixed(2).replace('.', ','), hk: (e.neu_hk_vz_ct / 100).toFixed(2).replace('.', ',') }])));
      setMeldung('');
    } catch (e) {
      fehler(e);
    }
  }

  const mieterErgebnisse = (a?.ergebnisse ?? []).filter((e: Row) => e.segment.vertrag);

  async function pdfs() {
    if (!a) return;
    if (pruefung?.fehler && !confirm(`Die Prüfung hat ${pruefung.fehler} Fehler gefunden. Abrechnungen trotzdem erstellen?`)) return;
    const vzOffen = Object.fromEntries((pruefung?.punkte ?? []).filter((x: Row) => x.vz_offen_ct).map((x: Row) => [x.vertrag_id, x.vz_offen_ct]));
    const einst = await call('einstellungen');
    const absender = { ...absenderAus(einst), iban: props.objekt.iban || einst.verwalter_iban, bank: props.objekt.bank || einst.verwalter_bank, bic: props.objekt.bic || einst.verwalter_bic };
    const seiten = [nkUebersicht(a, props.objekt)];
    for (const e of mieterErgebnisse) {
      const p = await empfaengerVon(e.segment.vertrag);
      const n = neuVz[e.segment.vertrag.id];
      seiten.push(nkBrief(a, e, absender, props.objekt, p, n ? { bk: parseCent(n.bk), hk: parseCent(n.hk), ab: neuAb } : null, vzOffen[e.segment.vertrag.id] ?? 0));
    }
    await alsPdf(seiten, `Betriebskostenabrechnung ${props.objekt.bezeichnung} ${von.slice(0, 4)}`);
  }

  async function speichernUndBuchen(buchen: boolean) {
    if (!a) return;
    const id = await call('abrechnungSpeichern', props.objekt.id, 'nk', von, bis, `Betriebskosten ${datum(von)} – ${datum(bis)}`, { ...a, neuVz, neuAb });
    if (buchen) {
      const n = await call('abrechnungBuchen', props.objekt.id, 'nk_ergebnis', heute(), `BK-Abrechnung ${von.slice(0, 4)}`,
        mieterErgebnisse.map((e: Row) => ({ konto_id: e.segment.konto_id, ergebnis_ct: e.ergebnis_ct, ust_ct: e.ust_ct, ust_satz: e.ust_satz })));
      await call('abrechnungGebucht', id);
      setMeldung(`Gespeichert und ${n} Ergebnisse auf die Mieterkonten gebucht.`);
    } else setMeldung('Abrechnung gespeichert.');
    ladeGespeichert();
  }

  async function vzUebernehmen() {
    const liste = Object.entries(neuVz).map(([vid, n]) => ({ vertrag_id: Number(vid), bk_vz_ct: parseCent(n.bk), hk_vz_ct: parseCent(n.hk) }));
    const n = await call('anpassungenAnwenden', 'miete', neuAb, 'nk_anpassung', liste);
    setMeldung(`Neue Vorauszahlungen für ${n} Mietverhältnisse ab ${datum(neuAb)} hinterlegt.`);
  }

  return (
    <section>
      <div className="toolbar"><h1>Betriebskostenabrechnung</h1></div>
      <div className="panel">
        <div className="maske">
          <label>Abrechnungszeitraum von<input type="date" value={von} onChange={(e) => setVon(e.target.value)} /></label>
          <label>bis<input type="date" value={bis} onChange={(e) => setBis(e.target.value)} /></label>
          <label className="breit">Heizkosten
            <Tabs tabs={[['intern', 'selbst abrechnen (HeizkostenV)'], ['extern', 'Messdienst (z. B. ista, Techem)'], ['ohne', 'wie Betriebskosten']]} value={heizung} onChange={setHeizung} />
          </label>
          {heizung === 'intern' && (
            <label>Verbrauchsanteil %<input className="num" type="number" min={50} max={70} value={anteil} onChange={(e) => setAnteil(Number(e.target.value))} /></label>
          )}
          <label>CO₂-Ausstoß gesamt (kg)<input className="num" value={co2Kg} onChange={(e) => setCo2Kg(e.target.value)} placeholder="lt. Brennstoffrechnung" /></label>
          <label>CO₂-Kosten gesamt (€)<input className="num" value={co2Eur} onChange={(e) => setCo2Eur(e.target.value)} /></label>
          <label className="breit">Leerstand bei Verteilung nach Personen
            <select value={leerPersonen} onChange={(e) => setLeerPersonen(Number(e.target.value))}>
              <option value={1}>leere Wohnung zählt als 1 Person – den Anteil trägt der Vermieter</option>
              <option value={0}>leere Wohnung zählt nicht – die Mieter tragen alles</option>
            </select>
          </label>
        </div>
        {heizung === 'extern' && (
          <div className="block">
            <h3>Heizkosten je Mieter lt. Abrechnung des Messdienstes</h3>
            <div className="maske">
              {relevant.map((v) => (
                <label key={v.id}>{v.einheit} – {v.name}<input className="num" value={extern[v.id] ?? ''} onChange={(e) => setExtern({ ...extern, [v.id]: e.target.value })} /></label>
              ))}
            </div>
          </div>
        )}
        <p className="hinweis klein">
          Berücksichtigt werden alle Kostenkonten mit „umlagefähig“ und Buchungsdatum im Zeitraum (Abflussprinzip). Kosten werden nach
          dem Schlüssel des Kontos auf die Einheiten verteilt und bei Mieterwechsel tagegenau aufgeteilt; Leerstand trägt der Vermieter.
          Eine selbst genutzte Wohnung nimmt an allen Schlüsseln teil (nach Personen mit deiner Haushaltsgröße); ihren Eigenanteil trägst du.
          {heizung === 'intern' && ' Heizkosten: Grundkosten nach Wohnfläche, Verbrauchskosten nach Wärme- bzw. Warmwasserzählern (Schlüssel vom Typ „Zähler“).'}
        </p>
        <div className="buttons"><span className="spacer" /><button className="primary" onClick={berechnen}>Berechnen</button></div>
      </div>

      {a && (
        <>
          {pruefung && (
            <div className="panel">
              <div className="panelkopf"><h3>Prüfung vor dem Versand</h3>
                <span className="chips">{pruefung.fehler ? <span className="chip rot">{pruefung.fehler} Fehler</span> : <span className="chip gruen">keine Fehler</span>}
                  {pruefung.warnungen ? <span className="chip gelb">{pruefung.warnungen} zu prüfen</span> : null}</span></div>
              <ul className="hinweisliste">
                {pruefung.punkte.map((x: Row, i: number) => (
                  <li key={i} className={x.stufe === 'fehler' ? 'hinweis-rot' : x.stufe === 'warnung' ? 'hinweis-orange' : 'hinweis-gelb'}>
                    <span className="punkt">{x.stufe === 'fehler' ? <I.CircleX size={15} /> : x.stufe === 'warnung' ? <I.TriangleAlert size={15} /> : <I.Info size={15} />}</span>
                    <div className="inhalt"><div>{mitLinks(x.text, x.links)}</div>{x.hilfe && <div className="klein hinweis">{x.hilfe}</div>}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="block">
            <h3>Kosten</h3>
            <table>
              <thead><tr><th>Kostenart</th><th>Schlüssel</th><th className="num">Gesamteinheiten</th><th className="num">Betrag</th></tr></thead>
              <tbody>
                {a.posten.map((p: Row, i: number) => (
                  <tr key={i}><td>{p.label}</td><td>{p.schluessel}</td><td className="num">{p.gesamt_einheiten ? zahl(+p.gesamt_einheiten.toFixed(3)) : ''} {p.einheit}</td><td className="num">{euro(p.gesamt_ct)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}>Summe (davon Leerstand {euro(a.leerstand_ct)}{a.eigenanteil_ct ? ` · Eigenanteil selbst genutzt ${euro(a.eigenanteil_ct)}` : ''})</td><td className="num"><b>{euro(a.summe_ct)}</b></td></tr></tfoot>
            </table>
          </div>
          <div className="block">
            <h3>Ergebnis je Mieter</h3>
            <table>
              <thead><tr><th>Einheit</th><th>Mieter</th><th>Zeitraum</th><th className="num">Kosten</th><th className="num">Vorausz.</th><th className="num">Ergebnis</th><th>Neue BK-VZ</th><th>Neue HK-VZ</th></tr></thead>
              <tbody>
                {a.ergebnisse.map((e: Row, i: number) => {
                  const v = e.segment.vertrag;
                  const n = v && neuVz[v.id];
                  return (
                    <tr key={i} className={v ? '' : 'inaktiv'} data-ziel={v ? `vertrag:miete:${v.id}` : `einheit:${e.segment.einheit.id}`}>
                      <td><L zu={{ einheit: e.segment.einheit.id }}>{e.segment.einheit.bezeichnung}</L></td>
                      <td>{v ? <L zu={{ vertrag: v.id, typ: 'miete' }}>{v.name}</L> : e.segment.selbst ? `selbst genutzt · Eigenanteil (${zahl(e.segment.selbst.personen)} Pers.)` : 'Leerstand (Vermieter)'}</td>
                      <td>{datum(e.segment.von)} – {datum(e.segment.bis)}</td>
                      <td className="num">{euro(e.kosten_ct)}</td>
                      <td className="num">{euro(e.bk_vz_ct + e.hk_vz_ct)}</td>
                      <td className="num"><b className={e.ergebnis_ct > 0 ? 'negativ' : ''}>{v ? (e.ergebnis_ct > 0 ? 'Nachz. ' : 'Guth. ') + euro(Math.abs(e.ergebnis_ct + (e.ust_ct ?? 0))) : ''}</b>
                        {e.ust_ct ? <div className="klein hinweis">inkl. {e.ust_satz} % USt {euro(Math.abs(e.ust_ct))}</div> : null}</td>
                      <td>{n && <input className="num zelle" value={n.bk} onChange={(ev) => setNeuVz({ ...neuVz, [v.id]: { ...n, bk: ev.target.value } })} />}</td>
                      <td>{n && <input className="num zelle" value={n.hk} onChange={(ev) => setNeuVz({ ...neuVz, [v.id]: { ...n, hk: ev.target.value } })} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="toolbar">
            <label title="Die neuen Vorauszahlungen gelten frühestens ab der nächsten Fälligkeit nach Zugang der Abrechnung (§ 560 Abs. 4 BGB).">Neue Vorauszahlungen ab <input type="date" value={neuAb} onChange={(e) => setNeuAb(e.target.value)} /></label>
            <button onClick={vzUebernehmen}>Vorauszahlungen übernehmen</button>
            <span className="spacer" />
            {meldung && <span className="meldung">{meldung}</span>}
            <button onClick={pdfs}>Abrechnungen als PDF</button>
            <button onClick={() => speichernUndBuchen(false)}>Speichern</button>
            <button className="primary" onClick={() => confirm('Ergebnisse auf die Mieterkonten buchen (Nachzahlung als Forderung, Guthaben als Gutschrift)?') && speichernUndBuchen(true)}>Speichern & buchen</button>
          </div>
        </>
      )}
      <Gespeichert liste={gespeichert} onOpen={(d) => { setA(d); setNeuVz(d.neuVz ?? {}); if (d.neuAb) setNeuAb(d.neuAb); setVon(d.von); setBis(d.bis); }} />
    </section>
  );
}

export function Gespeichert(props: { liste?: Row[]; onOpen: (daten: Row) => void }) {
  if (!props.liste?.length) return null;
  return (
    <div className="block">
      <h3>Gespeicherte Abrechnungen</h3>
      <table>
        <thead><tr><th>Bezeichnung</th><th>Erstellt</th><th>Status</th><th /></tr></thead>
        <tbody>
          {props.liste.map((g) => (
            <tr key={g.id}>
              <td>{g.titel}</td><td>{datum(g.erstellt.slice(0, 10))}</td><td>{g.gebucht ? 'gebucht' : 'nicht gebucht'}</td>
              <td className="aktionen"><button onClick={async () => props.onOpen((await call('abrechnungLaden', g.id)).daten)}>Öffnen</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
