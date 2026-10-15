// Yield per object, Anlage V figures for the tax return, and cost shares from an external WEG statement.
import { useEffect, useState } from 'react';
import { betrag, call, diesesJahr, euro, fehler, parseCent, zahl, type Row } from '../api';
import { useLoad } from '../useLoad';
import { KontoSelect, Tabs } from '../ui';
import { alsPdf, bericht, esc, tabelle } from '../dokument';

export function Auswertungen(props: { objekt: Row }) {
  const [tab, setTab] = useState<'rendite' | 'anlagev' | 'weg'>('rendite');
  return (
    <section>
      <div className="toolbar">
        <h1>Auswertungen – {props.objekt.bezeichnung}</h1>
        <Tabs tabs={[['rendite', 'Rendite'], ['anlagev', 'Anlage V (Steuer)'], ['weg', 'Kosten aus WEG-Abrechnung']]} value={tab} onChange={setTab} />
      </div>
      {tab === 'rendite' ? <Rendite objekt={props.objekt} /> : tab === 'anlagev' ? <AnlageV objekt={props.objekt} /> : <WegUebernahme objekt={props.objekt} />}
    </section>
  );
}

const prozent = (x: number | null) => (x == null ? '–' : `${zahl(+x.toFixed(2))} %`);

function Rendite(props: { objekt: Row }) {
  const [r] = useLoad<Row>(() => call('rendite', props.objekt.id, 6), [props.objekt.id]);
  if (!r) return null;
  const z = r.zeilen.filter((x: Row) => x.soll_kaltmiete_ct || x.ist_kaltmiete_ct);
  const letzte = z.at(-2) ?? z.at(-1);
  return (
    <>
      {!r.invest_ct && <p className="fehler">Für Renditewerte bitte unter Objekte → Bearbeiten den Kaufpreis (und ggf. Nebenkosten) eintragen.</p>}
      {letzte && (
        <div className="kacheln">
          <div className="kachel"><div className="wert">{prozent(letzte.brutto_rendite)}</div><div className="label">Bruttomietrendite {letzte.jahr} (Jahreskaltmiete / Kaufpreis)</div></div>
          <div className="kachel"><div className="wert">{prozent(letzte.netto_rendite)}</div><div className="label">Nettorendite {letzte.jahr} (Überschuss / Kaufpreis inkl. Nebenkosten)</div></div>
          <div className="kachel"><div className="wert">{letzte.miete_qm != null ? `${betrag(letzte.miete_qm)} €` : '–'}</div><div className="label">Kaltmiete je m² und Monat</div></div>
          <div className="kachel"><div className="wert">{euro(letzte.ausfall_ct)}</div><div className="label">Mietausfall {letzte.jahr} (Soll – Ist)</div></div>
        </div>
      )}
      <table>
        <thead><tr><th>Jahr</th><th className="num">Kaltmiete Soll</th><th className="num">Kaltmiete Ist</th><th className="num">Umlagen erhalten</th>
          <th className="num">Umlagefähige Kosten</th><th className="num">Nicht umlagefähig</th><th className="num">Überschuss</th><th className="num">Brutto</th><th className="num">Netto</th><th className="num">Kosten/m²·Monat</th></tr></thead>
        <tbody>
          {z.map((x: Row) => (
            <tr key={x.jahr}>
              <td>{x.jahr}{x.jahr === diesesJahr() ? ' (lfd.)' : ''}</td><td className="num">{euro(x.soll_kaltmiete_ct)}</td><td className="num">{euro(x.ist_kaltmiete_ct)}</td>
              <td className="num">{euro(x.umlagen_ct)}</td><td className="num">{euro(x.umlagefaehig_ct)}</td><td className="num">{euro(x.nicht_umlagefaehig_ct)}</td>
              <td className="num"><b>{euro(x.netto_ct)}</b></td><td className="num">{prozent(x.brutto_rendite)}</td><td className="num">{prozent(x.netto_rendite)}</td>
              <td className="num">{x.kosten_qm != null ? `${betrag(x.kosten_qm)} €` : ''}</td>
            </tr>
          ))}
          {!z.length && <tr><td colSpan={10} className="hinweis">Noch keine Mieteinnahmen gebucht.</td></tr>}
        </tbody>
      </table>
      <p className="hinweis klein">Überschuss = erhaltene Kaltmiete und Umlagen minus alle Kosten, vor Finanzierung und Abschreibung. Ist-Werte nach Zahlungseingang (ältere Forderungen werden zuerst getilgt).</p>
    </>
  );
}

function AnlageV(props: { objekt: Row }) {
  const [jahr, setJahr] = useState(diesesJahr() - 1);
  const [a, reload] = useLoad<Row>(() => call('anlageV', props.objekt.id, jahr), [props.objekt.id, jahr]);
  const [m, setM] = useState<Record<string, string>>({});
  useEffect(() => {
    if (a) setM(Object.fromEntries(['schuldzinsen_ct', 'geldbeschaffung_ct', 'fahrtkosten_ct', 'sonstige_ct', 'ruecklage_hausgeld_ct']
      .map((k) => [k, a.manuell[k] != null ? (a.manuell[k] / 100).toFixed(2).replace('.', ',') : ''])));
  }, [a?.jahr, a?.objekt?.id]);
  if (!a) return null;

  async function speichern() {
    await call('steuerangabenSetzen', props.objekt.id, jahr, Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v ? parseCent(v) : null])));
    reload();
  }
  function pdf() {
    if (!a) return;
    const z = a.einnahmen.map(([l, c]: [string, number]) => [esc(l), `#r${euro(c)}`]);
    const w = a.werbungskosten.map(([l, c]: [string, number]) => [esc(l), `#r${euro(c)}`]);
    const det = Object.values(a.gruppen).filter((g: any) => g.konten.length).map((g: any) =>
      `<h2>${esc(g.label.split(' (')[0])}</h2>` + tabelle(['Konto', '#rBetrag'], g.konten.map((k: Row) => [`${k.nr} ${esc(k.bezeichnung)}`, `#r${euro(k.ct)}`]))).join('');
    alsPdf([bericht(`Einkünfte aus Vermietung und Verpachtung ${jahr}`, `${props.objekt.bezeichnung} · Aufstellung als Grundlage für die Anlage V`,
      `<h2>Einnahmen</h2>${tabelle(['Art', '#rBetrag'], z, { summe: ['Summe Einnahmen', `#r${euro(a.summe_einnahmen_ct)}`] })}
       <h2>Werbungskosten</h2>${tabelle(['Art', '#rBetrag'], w, { summe: ['Summe Werbungskosten', `#r${euro(a.summe_werbungskosten_ct)}`] })}
       <p class="hervor">Überschuss / Verlust: ${euro(a.ergebnis_ct)}</p>${det}
       <p class="klein">Einnahmen nach Zufluss, Ausgaben nach Abfluss im Kalenderjahr. Keine Steuerberatung – bitte mit der Steuererklärung bzw. dem Steuerberater abgleichen.</p>`)],
    `Anlage V ${props.objekt.bezeichnung} ${jahr}`);
  }

  const feld = (k: string, l: string) => <label key={k}>{l} (€)<input className="num" value={m[k] ?? ''} onChange={(e) => setM({ ...m, [k]: e.target.value })} /></label>;
  return (
    <>
      <div className="toolbar">
        <label>Jahr <select value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>{Array.from({ length: 6 }, (_, i) => diesesJahr() - i).map((j) => <option key={j}>{j}</option>)}</select></label>
        <span className="spacer" /><button onClick={pdf}>Als PDF</button>
      </div>
      {a.gemischt && <p className="fehler">Gemischtes Objekt: Die Kosten gelten für das ganze Haus. Für deine Steuer zählt nur dein Anteil – bitte entsprechend anpassen.</p>}
      {!a.objekt.afa_satz && <p className="hinweis">Für die AfA unter Objekte → Bearbeiten Kaufpreis, Kaufdatum, Gebäudeanteil und AfA-Satz eintragen.</p>}
      <div className="zweispaltig">
        <div>
          <table>
            <thead><tr><th>Einnahmen</th><th className="num">Betrag</th></tr></thead>
            <tbody>{a.einnahmen.map(([l, c]: [string, number]) => <tr key={l}><td>{l}</td><td className="num">{euro(c)}</td></tr>)}</tbody>
            <tfoot><tr><td>Summe Einnahmen</td><td className="num"><b>{euro(a.summe_einnahmen_ct)}</b></td></tr></tfoot>
          </table>
          <table style={{ marginTop: 14 }}>
            <thead><tr><th>Werbungskosten</th><th className="num">Betrag</th></tr></thead>
            <tbody>{a.werbungskosten.map(([l, c]: [string, number]) => <tr key={l}><td className="klein">{l}</td><td className="num">{euro(c)}</td></tr>)}</tbody>
            <tfoot><tr><td>Summe Werbungskosten</td><td className="num"><b>{euro(a.summe_werbungskosten_ct)}</b></td></tr></tfoot>
          </table>
          <p className="hervor kachel" style={{ marginTop: 14 }}>{a.ergebnis_ct >= 0 ? 'Überschuss' : 'Verlust'}: {euro(a.ergebnis_ct)}</p>
          {a.kautionen_ct > 0 && <p className="klein hinweis">Erhaltene Kautionen ({euro(a.kautionen_ct)}) sind keine Einnahmen und nicht enthalten.</p>}
        </div>
        <div className="panel">
          <h3>Ergänzende Angaben {jahr}</h3>
          <div className="maske zwei">
            {feld('schuldzinsen_ct', 'Schuldzinsen')}{feld('geldbeschaffung_ct', 'Geldbeschaffungskosten')}
            {feld('fahrtkosten_ct', 'Fahrtkosten')}{feld('sonstige_ct', 'Weitere Werbungskosten')}
            {feld('ruecklage_hausgeld_ct', 'Im Hausgeld enthaltene Rücklagenzuführung')}
          </div>
          <div className="buttons"><span className="spacer" /><button className="primary" onClick={speichern}>Übernehmen</button></div>
          <p className="klein hinweis">Einnahmen nach Zahlungseingang im Jahr, Ausgaben nach Zahlung. Die Zuführung zur Erhaltungsrücklage einer WEG ist erst bei Verwendung abziehbar.</p>
        </div>
      </div>
    </>
  );
}

function WegUebernahme(props: { objekt: Row }) {
  const [konten] = useLoad<Row[]>(() => call('konten', props.objekt.id, 'kosten'), [props.objekt.id]);
  const [werte, setWerte] = useState<Record<number, string>>({});
  const [jahr, setJahr] = useState(diesesJahr() - 1);
  const [meldung, setMeldung] = useState('');
  const umlagefaehig = (konten ?? []).filter((k) => k.umlagefaehig && !k.inaktiv);
  const summe = Object.values(werte).reduce((s, v) => s + parseCent(v), 0);
  const [extra, setExtra] = useState<number | ''>('');
  const zeilen = [...umlagefaehig, ...(konten ?? []).filter((k) => k.id === extra && !k.umlagefaehig)];
  return (
    <>
      <p className="hinweis">
        Für eine vermietete Eigentumswohnung, deren WEG ein anderer Verwalter führt: Trage die umlagefähigen Kosten aus dessen
        Hausgeldabrechnung ein. Sie werden vom gezahlten Hausgeld auf die passenden Kostenkonten umgebucht und stehen dann in deiner
        Betriebskostenabrechnung für den Mieter. Tipp: Lege die WEG-Abrechnung ins Postfach und sag Claude „übernimm die umlagefähigen Kosten“.
      </p>
      <div className="toolbar"><label>Abrechnungsjahr <input className="kurz num" type="number" value={jahr} onChange={(e) => setJahr(Number(e.target.value))} /></label></div>
      <table>
        <thead><tr><th>Kostenart (umlagefähig)</th><th className="num">Anteil lt. WEG-Abrechnung (€)</th></tr></thead>
        <tbody>
          {zeilen.map((k) => (
            <tr key={k.id}><td>{k.nr} {k.bezeichnung}</td>
              <td className="num"><input className="num zelle" value={werte[k.id] ?? ''} onChange={(e) => setWerte({ ...werte, [k.id]: e.target.value })} /></td></tr>
          ))}
          <tr><td><KontoSelect konten={konten ?? []} klassen={['kosten']} value={extra} onChange={setExtra} leer="+ weiteres Kostenkonto" /></td><td /></tr>
        </tbody>
        <tfoot><tr><td>Summe</td><td className="num"><b>{euro(summe)}</b></td></tr></tfoot>
      </table>
      <div className="buttons">
        {meldung && <span className="meldung">{meldung}</span>}
        <span className="spacer" />
        <button className="primary" disabled={!summe} onClick={async () => {
          try {
            await call('wegKostenUebernehmen', props.objekt.id, `${jahr}-12-31`,
              Object.entries(werte).map(([k, v]) => ({ konto_id: Number(k), betrag_ct: parseCent(v) })), `Umlagefähige Kosten aus WEG-Abrechnung ${jahr}`);
            setWerte({});
            setMeldung(`Übernommen: ${euro(summe)} zum 31.12.${jahr}.`);
          } catch (e) { fehler(e); }
        }}>Kosten übernehmen</button>
      </div>
      {extra !== '' && !umlagefaehig.some((k) => k.id === extra) && (
        <p className="klein hinweis">Dieses Konto ist nicht als umlagefähig markiert – unter Konten anpassen, wenn es in die Betriebskostenabrechnung soll.</p>
      )}
    </>
  );
}
