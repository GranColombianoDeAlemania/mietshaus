// Yield per object, Anlage V figures for the tax return, and cost shares from an external WEG statement.
import { useEffect, useState } from 'react';
import { betrag, call, datum, diesesJahr, euro, fehler, parseCent, parseZahl, zahl, type Row } from '../api';
import { useLoad } from '../useLoad';
import { KontoSelect, Leer, Tabs } from '../ui';
import { alsPdf, bericht, dokument, esc, tabelle } from '../dokument';
import { L, useNavi } from '../navi';
import { euro0, Kennzahl, prozent as prozentKz, Ring, RingZeile, type Zonen } from '../zeiger';

const ZONEN_RENDITE: Zonen = [[2.499, 'rot'], [3.499, 'gelb'], [100, 'gruen']];

export function Auswertungen(props: { objekt: Row }) {
  const [tab, setTab] = useState<'rendite' | 'anlagev' | 'steuer' | 'ust' | 'weg'>('rendite');
  return (
    <section>
      <div className="toolbar">
        <h1>Auswertungen</h1>
        <Tabs tabs={[['rendite', 'Rendite'], ['anlagev', 'Anlage V'], ['steuer', 'Steuer-Wächter'], ['ust', 'Umsatzsteuer'], ['weg', 'Kosten aus WEG-Abrechnung']]} value={tab} onChange={setTab} />
      </div>
      {tab === 'rendite' ? <Rendite objekt={props.objekt} /> : tab === 'anlagev' ? <AnlageV objekt={props.objekt} /> : tab === 'steuer' ? <SteuerWaechter objekt={props.objekt} />
        : tab === 'ust' ? <Umsatzsteuer objekt={props.objekt} /> : <WegUebernahme objekt={props.objekt} />}
    </section>
  );
}

const prozent = (x: number | null) => (x == null ? '–' : `${zahl(+x.toFixed(2))} %`);

function Rendite(props: { objekt: Row }) {
  const [r] = useLoad<Row>(() => call('rendite', props.objekt.id, 6), [props.objekt.id]);
  // With self-use: the yield of the rented part, or as if the own flat were let at the comparative rent.
  const [sicht, setSicht] = useState<'teil' | 'fiktiv'>('teil');
  if (!r) return null;
  const z = r.zeilen.filter((x: Row) => x.soll_kaltmiete_ct || x.ist_kaltmiete_ct);
  const letzte = z.at(-2) ?? z.at(-1);
  const wert = (x: Row) => !x.selbst ? { netto_ct: x.netto_ct, brutto: x.brutto_rendite, netto: x.netto_rendite }
    : sicht === 'teil' ? { netto_ct: x.selbst.netto_ct, brutto: x.selbst.brutto_rendite, netto: x.selbst.netto_rendite }
      : { netto_ct: x.selbst.fiktiv_netto_ct, brutto: x.selbst.fiktiv_brutto_rendite, netto: x.selbst.fiktiv_netto_rendite };
  const w = letzte ? wert(letzte) : null;
  const sl = letzte?.selbst;
  const erklaerung = !sl ? 'Überschuss / Kaufpreis inkl. Nebenkosten'
    : sicht === 'teil' ? `auf ${prozent(sl.anteil * 100)} des Kaufpreises (vermieteter Teil, nach Fläche und Tagen)`
      : `mit Vergleichsmiete für ${sl.einheiten.map((e: Row) => e.bezeichnung).join(', ')} (${euro0(sl.fiktiv_kaltmiete_ct)} im Jahr), Betriebskosten zahlt der Mieter`;
  return (
    <>
      {!r.invest_ct && <p className="fehler">Für Renditewerte bitte unter Objekte → Bearbeiten den Kaufpreis (und ggf. Nebenkosten) eintragen.</p>}
      {r.selbstnutzung && (
        <div className="toolbar">
          <span className="hinweis klein">Ein Teil des Hauses ist selbst genutzt. Rendite rechnen für</span>
          <Tabs tabs={[['teil', 'den vermieteten Teil'], ['fiktiv', 'als ob alles vermietet']]} value={sicht} onChange={setSicht} />
        </div>
      )}
      {letzte && w && (
        <div className="kz-raster">
          <Kennzahl titel={`Nettorendite ${letzte.jahr}`} breite={4}>
            <RingZeile ring={<Ring wert={w.netto} max={8} zonen={ZONEN_RENDITE} text={w.netto == null ? '–' : prozentKz(w.netto, 1)} />}
              wert={<>{euro0(w.netto_ct)}<small>Überschuss</small></>}><div className="kz-text">{erklaerung}</div></RingZeile>
          </Kennzahl>
          <Kennzahl titel={`Bruttomietrendite ${letzte.jahr}`} breite={3}><div className="kz-wert">{prozent(w.brutto)}</div>
            <div className="kz-text">Jahreskaltmiete{sl && sicht === 'fiktiv' ? ' mit Vergleichsmiete' : ''} / Kaufpreis{sl && sicht === 'teil' ? ' des vermieteten Teils' : ''}</div></Kennzahl>
          <Kennzahl titel="Kaltmiete je m² und Monat" breite={3}><div className="kz-wert">{letzte.miete_qm != null ? `${betrag(letzte.miete_qm)} €` : '–'}</div>
            <div className="kz-text">{sl ? `über alle Flächen; vermietet: ${betrag(letzte.soll_kaltmiete_ct / 12 / Math.max(1, sl.flaeche_vermietet))} €` : 'über alle Flächen des Hauses'}</div></Kennzahl>
          <Kennzahl titel={`Mietausfall ${letzte.jahr}`} breite={2}><div className="kz-wert">{euro0(letzte.ausfall_ct)}</div><div className="kz-text">Soll – Ist</div></Kennzahl>
        </div>
      )}
      <table>
        <thead><tr><th>Jahr</th><th className="num">Kaltmiete Soll</th><th className="num">Kaltmiete Ist</th><th className="num">Umlagen erhalten</th>
          <th className="num">Umlagefähige Kosten</th><th className="num">Nicht umlagefähig</th><th className="num">Überschuss</th>
          <th className="num">Brutto</th><th className="num">Netto</th><th className="num">Kosten/m²·Monat</th></tr></thead>
        <tbody>
          {z.map((x: Row) => {
            const y = wert(x);
            return (
              <tr key={x.jahr}>
                <td>{x.jahr}{x.jahr === diesesJahr() ? ' (lfd.)' : ''}</td><td className="num">{euro(x.soll_kaltmiete_ct)}</td><td className="num">{euro(x.ist_kaltmiete_ct)}</td>
                <td className="num">{euro(x.umlagen_ct)}</td><td className="num">{euro(x.umlagefaehig_ct)}</td><td className="num">{euro(x.nicht_umlagefaehig_ct)}</td>
                <td className="num"><b>{euro(y.netto_ct)}</b></td><td className="num">{prozent(y.brutto)}</td><td className="num">{prozent(y.netto)}</td>
                <td className="num">{x.kosten_qm != null ? `${betrag(x.kosten_qm)} €` : ''}</td>
              </tr>
            );
          })}
          {!z.length && <tr><td colSpan={10} className="hinweis">Noch keine Mieteinnahmen gebucht.</td></tr>}
        </tbody>
      </table>
      <p className="hinweis klein">Überschuss = erhaltene Kaltmiete und Umlagen minus alle Kosten, vor Finanzierung und Abschreibung. Ist-Werte nach Zahlungseingang (ältere Forderungen werden zuerst getilgt).
        {r.selbstnutzung && ' Vermieteter Teil: Kosten des ganzen Hauses nach Fläche und Tagen, Kosten einer vermieteten Einheit voll, der eigenen Wohnung gar nicht; Kaufpreis anteilig. Als ob vermietet: plus Vergleichsmiete der eigenen Wohnung und ihr Betriebskostenanteil.'}</p>
    </>
  );
}

// Short names for the Anlage V lines in the split table.
const kurzname = (l: string) => (l.startsWith('Grundsteuer, Straßenreinigung') ? 'Betriebskosten (Grundsteuer, Wasser, Versicherung u. a.)' : l.split(' (')[0]);

// Split of the deductible costs when part of the house is self-used.
function Aufteilung(props: { s: Row }) {
  const s = props.s;
  return (
    <div className="panel">
      <div className="panelkopf"><h3>Aufteilung wegen Selbstnutzung</h3>
        <span className="klein hinweis">{s.einheiten.map((e: Row) => `${e.bezeichnung} (${zahl(e.flaeche)} m², ${e.tage} Tage)`).join(', ')}</span></div>
      <div className="kz-zeile"><span><b>{prozent(s.anteil * 100)} vermietet</b> <span className="klein hinweis">{zahl(Math.round(s.flaeche_vermietet * 100) / 100)} von {zahl(s.flaeche_gesamt)} m², tagegenau</span></span>
        <span className="klein hinweis">{prozent((1 - s.anteil) * 100)} selbst genutzt</span></div>
      <div className="anteil-balken" aria-hidden="true"><span style={{ width: `${s.anteil * 100}%` }} /><span style={{ width: `${(1 - s.anteil) * 100}%` }} /></div>
      <table className="kompakt">
        <thead><tr><th>Werbungskosten</th><th>Regel</th><th className="num">gesamt</th><th className="num">absetzbar</th></tr></thead>
        <tbody>{s.zeilen.map(([l, ges, ab, regel]: [string, number, number, string]) => (
          <tr key={l}><td className="klein">{kurzname(l)}</td><td className="klein hinweis">{regel}</td><td className="num">{euro(ges)}</td><td className="num">{euro(ab)}</td></tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={2}>Summe</td><td className="num">{euro(s.summe_gesamt_ct)}</td><td className="num"><b>{euro(s.zeilen.reduce((x: number, z: Row) => x + z[2], 0))}</b></td></tr></tfoot>
      </table>
      <p className="klein hinweis">Kosten einer Einheit entstehen, wenn du die Buchung (oder ihren Beleg) einer Einheit zuordnest. Die 15-%-Grenze gilt dann nur für den vermieteten Teil. Bitte für die Steuererklärung mit dem Steuerberater abstimmen.</p>
    </div>
  );
}

// The Anlage V overview as a printable page (also used in the tax adviser package).
function anlageVSeite(a: Row, objekt: Row) {
  const z = a.einnahmen.map(([l, c]: [string, number]) => [esc(l), `#r${euro(c)}`]);
  const w = a.werbungskosten.map(([l, c]: [string, number]) => [esc(l), `#r${euro(c)}`]);
  const det = Object.values(a.gruppen).filter((g: any) => g.konten.length).map((g: any) =>
    `<h2>${esc(g.label.split(' (')[0])}</h2>` + tabelle(['Konto', '#rBetrag'], g.konten.map((k: Row) => [`${k.nr} ${esc(k.bezeichnung)}`, `#r${euro(k.ct)}`]))).join('');
  const s = a.selbstnutzung;
  const teil = s ? `<h2>Aufteilung wegen Selbstnutzung</h2><p>Vermietet ${prozent(s.anteil * 100)} der Fläche (tagegenau); selbst genutzt: ${s.einheiten.map((e: Row) => esc(e.bezeichnung)).join(', ')}.</p>`
    + tabelle(['Werbungskosten', 'Regel', '#rgesamt', '#rabsetzbar'], s.zeilen.map(([l, g, ab, r]: [string, number, number, string]) => [esc(kurzname(l)), esc(r), `#r${euro(g)}`, `#r${euro(ab)}`])) : '';
  return bericht(`Einkünfte aus Vermietung und Verpachtung ${a.jahr}`, `${objekt.bezeichnung} · Aufstellung als Grundlage für die Anlage V`,
    `${teil}<h2>Einnahmen</h2>${tabelle(['Art', '#rBetrag'], z, { summe: ['Summe Einnahmen', `#r${euro(a.summe_einnahmen_ct)}`] })}
     <h2>Werbungskosten</h2>${tabelle(['Art', '#rBetrag'], w, { summe: ['Summe Werbungskosten', `#r${euro(a.summe_werbungskosten_ct)}`] })}
     <p class="hervor">Überschuss / Verlust: ${euro(a.ergebnis_ct)}</p>${det}
     <p class="klein">Einnahmen nach Zufluss, Ausgaben nach Abfluss im Kalenderjahr. Keine Steuerberatung – bitte mit der Steuererklärung bzw. dem Steuerberater abgleichen.</p>`);
}

// Tax guard: 15 % rule after a purchase, spreading large repairs (§ 82b EStDV) and the package for the tax adviser.
function SteuerWaechter(props: { objekt: Row }) {
  const [w] = useLoad<Row[]>(() => call('anschaffungsnah', props.objekt.id), [props.objekt.id]);
  const [verteilungen, ladeV] = useLoad<Row[]>(() => call('erhaltungsverteilungen', props.objekt.id), [props.objekt.id]);
  const [jahr, setJahr] = useState(diesesJahr() - 1);
  const [kandidaten] = useLoad<Row[]>(() => call('erhaltungKandidaten', props.objekt.id, jahr), [props.objekt.id, jahr]);
  const [neu, setNeu] = useState({ betrag: '', jahre: 3, text: '' });
  const [paket, setPaket] = useState('');
  const g = w?.[0];

  async function steuerpaket() {
    setPaket('Wird erstellt …');
    try {
      const a = await call('anlageV', props.objekt.id, jahr);
      const r = await window.hv.steuerpaket(props.objekt.id, jahr, dokument([anlageVSeite(a, props.objekt)], `Anlage V ${jahr}`));
      setPaket(r ? `Gespeichert: ${r.datei} – ${r.buchungen} Buchungen, ${r.belege} Belege.` : '');
    } catch (e) { setPaket(''); fehler(e); }
  }

  return (
    <div className="raster2">
      <div className="spalte">
        <div className="panel">
          <div className="panelkopf"><h3>15-%-Grenze nach dem Kauf</h3></div>
          {!g ? (
            <p className="hinweis klein">{props.objekt.kaufdatum ? 'Der Kauf liegt mehr als drei Jahre zurück – die Grenze spielt keine Rolle mehr.' : 'Für die Prüfung bitte Kaufpreis, Kaufdatum und Gebäudeanteil beim Objekt eintragen.'}</p>
          ) : (
            <>
              <div className="kacheln">
                <div className="kachel"><div className={`wert${g.anteil >= 1 ? ' negativ' : ''}`}>{Math.round(g.anteil * 100)} %</div><div className="label">der Grenze ausgeschöpft</div></div>
                <div className="kachel"><div className="wert">{euro(g.rest_ct)}</div><div className="label">noch frei (netto) bis {datum(g.frist)}</div></div>
              </div>
              <div className="fortschritt" style={{ height: 8 }}><span style={{ width: `${Math.min(100, g.anteil * 100)}%`, background: g.anteil >= 1 ? 'var(--rot)' : g.anteil >= 0.8 ? 'var(--gelb)' : undefined }} /></div>
              <p className="klein">Gebäudeanteil der Anschaffungskosten {euro(g.gebaeude_ct)} · Grenze 15 % = {euro(g.grenze_ct)} netto · bisher {euro(g.summe_netto_ct)} netto ({euro(g.summe_brutto_ct)} brutto) auf Instandhaltungskonten seit {datum(g.kaufdatum)}.</p>
              {g.vermietet_anteil != null && <p className="klein">Selbstnutzung: Grenze und Kosten gelten nur für den vermieteten Teil ({prozent(g.vermietet_anteil * 100)} der Fläche; Gebäudeanteil ganz {euro(g.gebaeude_ganz_ct)}).
                Kosten der eigenen Wohnung zählen nicht, Kosten vermieteter Einheiten voll.</p>}
              <p className="klein hinweis">Übersteigen Instandsetzungs- und Modernisierungskosten in den ersten drei Jahren nach dem Kauf 15 % der Gebäudekosten (ohne Umsatzsteuer),
                gelten sie als anschaffungsnahe Herstellungskosten und sind nicht sofort, sondern nur über die AfA absetzbar (§ 6 Abs. 1 Nr. 1a EStG). Jährlich übliche Erhaltungsarbeiten zählen nicht mit.</p>
            </>
          )}
        </div>
        <div className="panel">
          <div className="panelkopf"><h3>Steuerberater-Paket</h3></div>
          <p className="klein">Eine ZIP-Datei mit der Anlage-V-Aufstellung (PDF), Journal, Saldenliste und Kontenblättern (CSV) sowie allen Belegen des Jahres.</p>
          <div className="buttons">
            <label>Jahr <select value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>{Array.from({ length: 6 }, (_, i) => diesesJahr() - i).map((j) => <option key={j}>{j}</option>)}</select></label>
            <span className="spacer" /><button className="primary" onClick={steuerpaket}>Paket erstellen …</button>
          </div>
          {paket && <p className="meldung klein">{paket}</p>}
        </div>
      </div>
      <div className="spalte">
        <div className="panel">
          <div className="panelkopf"><h3>Große Reparaturen verteilen (§ 82b EStDV)</h3></div>
          <p className="klein hinweis">Größere Erhaltungsaufwendungen an Gebäuden, die überwiegend Wohnzwecken dienen, darfst du gleichmäßig auf zwei bis fünf Jahre verteilen.
            Das kann sich lohnen, wenn ein Jahr sonst einen hohen Verlust hätte. Die Anlage V berücksichtigt die Verteilung automatisch.</p>
          {verteilungen && verteilungen.length > 0 && (
            <table className="kompakt">
              <thead><tr><th>Jahr</th><th>Aufwand</th><th className="num">Betrag</th><th className="num">Jahre</th><th className="num">je Jahr</th><th /></tr></thead>
              <tbody>{verteilungen.map((v) => (
                <tr key={v.id}><td>{v.jahr}</td><td className="klein">{v.text}</td><td className="num">{euro(v.betrag_ct)}</td><td className="num">{v.jahre}</td>
                  <td className="num">{euro(Math.floor(v.betrag_ct / v.jahre))}</td>
                  <td className="aktionen"><button onClick={async () => { if (confirm('Verteilung löschen?')) { await call('remove', 'erhaltungsverteilung', v.id); ladeV(); } }}>Löschen</button></td></tr>
              ))}</tbody>
            </table>
          )}
          <div className="maske zwei" style={{ marginTop: 10 }}>
            <label>Jahr der Zahlung<select value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>{Array.from({ length: 6 }, (_, i) => diesesJahr() - i).map((j) => <option key={j}>{j}</option>)}</select></label>
            <label>Verteilen auf<select value={neu.jahre} onChange={(e) => setNeu({ ...neu, jahre: Number(e.target.value) })}>{[2, 3, 4, 5].map((j) => <option key={j} value={j}>{j} Jahre</option>)}</select></label>
            <label>Betrag (€)<input className="num" value={neu.betrag} onChange={(e) => setNeu({ ...neu, betrag: e.target.value })} /></label>
            <label>Bezeichnung<input value={neu.text} onChange={(e) => setNeu({ ...neu, text: e.target.value })} placeholder="z. B. Dachsanierung" /></label>
          </div>
          {kandidaten && kandidaten.length > 0 && (
            <p className="klein">Instandhaltung {jahr}: {kandidaten.slice(0, 5).map((k) => (
              <button key={k.id} className="ln" onClick={() => setNeu({ ...neu, betrag: (k.betrag_ct / 100).toFixed(2).replace('.', ','), text: k.text ?? k.konto })}>{k.text ?? k.konto} ({euro(k.betrag_ct)})</button>
            )).reduce((acc: React.ReactNode[], x, i) => (i ? [...acc, ' · ', x] : [x]), [])}</p>
          )}
          <div className="buttons"><span className="spacer" />
            <button className="primary" disabled={!parseCent(neu.betrag)} onClick={async () => {
              await call('save', 'erhaltungsverteilung', { objekt_id: props.objekt.id, jahr, betrag_ct: parseCent(neu.betrag), jahre: neu.jahre, text: neu.text });
              setNeu({ betrag: '', jahre: 3, text: '' }); ladeV();
            }}>Verteilung anlegen</button></div>
        </div>
        <p className="klein hinweis">Keine Steuerberatung – die Werte sind eine Arbeitsgrundlage. <L zu={{ seite: 'auswertung', objektId: props.objekt.id }}>Anlage V ansehen</L></p>
      </div>
    </div>
  );
}

// Figures for the VAT return (Umsatzsteuer-Voranmeldung) of commercial lettings with VAT.
function Umsatzsteuer(props: { objekt: Row }) {
  const navi = useNavi();
  const [jahr, setJahr] = useState(diesesJahr());
  const [einst] = useLoad<Row>(() => call('einstellungen'), []);
  const [konten] = useLoad<Row[]>(() => call('konten', props.objekt.id, 'steuer'), [props.objekt.id]);
  const [u] = useLoad<Row | null>(() => (einst ? call('ustUebersicht', props.objekt.id, jahr, { zeitraum: einst.ust_zeitraum ?? 'quartal', versteuerung: einst.ust_versteuerung ?? 'soll' }) : Promise.resolve(null)),
    [props.objekt.id, jahr, einst?.ust_zeitraum, einst?.ust_versteuerung]);
  if (!u) return null;
  if (!u.aktiv) return <Leer text="Für dieses Haus ist keine Umsatzsteuer eingerichtet. Sie wird aktiv, sobald ein Mietverhältnis mit Umsatzsteuer angelegt ist (Gewerbe mit Option nach § 9 UStG)." />;
  const fa = konten?.find((k) => k.kategorie === 'ust_fa');
  const summe = (k: string) => u.zeilen.reduce((s: number, z: Row) => s + z[k], 0);
  return (
    <>
      <div className="toolbar">
        <label>Jahr <select value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>{Array.from({ length: 4 }, (_, i) => diesesJahr() - i).map((j) => <option key={j}>{j}</option>)}</select></label>
        <span className="hinweis klein">{u.versteuerung === 'ist' ? 'nach vereinnahmten Entgelten (Ist)' : 'nach vereinbarten Entgelten (Soll)'} · {u.zeitraum === 'monat' ? 'monatlich' : 'vierteljährlich'} – ändern unter Einstellungen</span>
      </div>
      <table>
        <thead><tr><th>Zeitraum</th><th className="num">Kz 81 Umsätze 19 %</th><th className="num">Steuer 19 %</th><th className="num">Kz 86 Umsätze 7 %</th><th className="num">Kz 66 Vorsteuer</th>
          <th className="num">Kz 83 Vorauszahlung</th><th className="num">gezahlt</th><th /></tr></thead>
        <tbody>{u.zeilen.map((z: Row) => (
          <tr key={z.label}>
            <td>{z.label}</td><td className="num">{euro(z.kz81_bemessung_ct)}</td><td className="num">{euro(z.kz81_steuer_ct)}</td><td className="num">{euro(z.kz86_bemessung_ct)}</td>
            <td className="num">{euro(z.kz66_vorsteuer_ct)}</td><td className="num"><b>{euro(z.kz83_ct)}</b></td><td className="num">{euro(z.gezahlt_ct)}</td>
            <td className="aktionen">{fa && z.kz83_ct > 0 && z.gezahlt_ct < z.kz83_ct && (
              <button onClick={() => { sessionStorage.setItem('buchungVorlage', JSON.stringify({ art: 'ausgabe', gegen_id: fa.id, text: `USt-Vorauszahlung ${z.label}` })); navi.zu({ seite: 'buchen', objektId: props.objekt.id, aktion: 'neue-buchung' }); }}>Zahlung buchen</button>
            )}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr><td>Summe {jahr}</td><td className="num">{euro(summe('kz81_bemessung_ct'))}</td><td className="num">{euro(summe('kz81_steuer_ct'))}</td><td className="num">{euro(summe('kz86_bemessung_ct'))}</td>
          <td className="num">{euro(summe('kz66_vorsteuer_ct'))}</td><td className="num"><b>{euro(summe('kz83_ct'))}</b></td><td className="num">{euro(summe('gezahlt_ct'))}</td><td /></tr></tfoot>
      </table>
      <p className="klein hinweis">Arbeitsgrundlage für die Voranmeldung in ELSTER. Umsätze sind die Nettomieten der Mietverhältnisse mit Umsatzsteuer, Vorsteuer stammt aus Rechnungen, die mit „darin USt“ gebucht wurden.
        Bei gemischt genutzten Häusern ist nur der Anteil der Vorsteuer abziehbar, der auf die steuerpflichtig vermieteten Flächen entfällt (Quote beim Objekt).</p>
    </>
  );
}

function AnlageV(props: { objekt: Row }) {
  const [jahr, setJahr] = useState(diesesJahr() - 1);
  const [a, reload] = useLoad<Row>(() => call('anlageV', props.objekt.id, jahr), [props.objekt.id, jahr]);
  const [m, setM] = useState<Record<string, string>>({});
  useEffect(() => {
    if (a) setM({ ...Object.fromEntries(['schuldzinsen_ct', 'geldbeschaffung_ct', 'fahrtkosten_ct', 'sonstige_ct', 'ruecklage_hausgeld_ct']
      .map((k) => [k, a.manuell[k] != null ? (a.manuell[k] / 100).toFixed(2).replace('.', ',') : ''])), zins_anteil: a.manuell.zins_anteil != null ? String(a.manuell.zins_anteil).replace('.', ',') : '' });
  }, [a?.jahr, a?.objekt?.id]);
  if (!a) return null;

  async function speichern() {
    const { zins_anteil, ...geld } = m;
    const anteil = zins_anteil ? parseZahl(zins_anteil) : null;
    if (anteil != null && (anteil < 0 || anteil > 100)) return fehler('Der Zinsanteil muss zwischen 0 und 100 % liegen.');
    await call('steuerangabenSetzen', props.objekt.id, jahr, { ...Object.fromEntries(Object.entries(geld).map(([k, v]) => [k, v ? parseCent(v) : null])), zins_anteil: anteil });
    reload();
  }
  const pdf = () => a && alsPdf([anlageVSeite(a, props.objekt)], `Anlage V ${props.objekt.bezeichnung} ${jahr}`);

  const feld = (k: string, l: string) => <label key={k}>{l} (€)<input className="num" value={m[k] ?? ''} onChange={(e) => setM({ ...m, [k]: e.target.value })} /></label>;
  return (
    <>
      <div className="toolbar">
        <label>Jahr <select value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>{Array.from({ length: 6 }, (_, i) => diesesJahr() - i).map((j) => <option key={j}>{j}</option>)}</select></label>
        <span className="spacer" /><button onClick={pdf}>Als PDF</button>
      </div>
      {a.gemischt && <p className="fehler">Gemischtes Objekt: Die Kosten gelten für das ganze Haus. Für deine Steuer zählt nur dein Anteil – bitte entsprechend anpassen.</p>}
      {!a.objekt.afa_satz && <p className="hinweis">Für die AfA unter Objekte → Bearbeiten Kaufpreis, Kaufdatum, Gebäudeanteil und AfA-Satz eintragen.</p>}
      {a.selbstnutzung && <Aufteilung s={a.selbstnutzung} />}
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
            {a.selbstnutzung && <label>Abziehbarer Zinsanteil (%)<input className="num" value={m.zins_anteil ?? ''} placeholder={`nach Fläche: ${zahl(Math.round(a.selbstnutzung.anteil * 1000) / 10)}`}
              onChange={(e) => setM({ ...m, zins_anteil: e.target.value })} /></label>}
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
