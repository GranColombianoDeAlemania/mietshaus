import { useState } from 'react';
import { anrede, call, datum, euro, heute, parseCent, personName, type Modus, type Row } from '../api';
import { useLoad } from '../useLoad';
import { Betrag, Dialog } from '../ui';
import { absaetze, absenderAus, alsPdf, brief, esc, tabelle } from '../dokument';

const STUFEN = ['Zahlungserinnerung', '1. Mahnung', '2. Mahnung', 'Letzte Mahnung'];
const plusTage = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function OffenePosten(props: { objekt: Row; modus: Modus }) {
  const [stichtag, setStichtag] = useState(heute());
  const [rows, reload] = useLoad<Row[]>(() => call('offenePosten', props.objekt.id, stichtag, props.modus), [props.objekt.id, stichtag, props.modus]);
  const [detail, setDetail] = useState<Row | null>(null);
  const [mahnen, setMahnen] = useState<Row[] | null>(null);
  const [minVerzug, setMinVerzug] = useState(14);

  const rueckstand = (rows ?? []).filter((r) => r.summe_ct > 0);
  const guthaben = (rows ?? []).filter((r) => r.summe_ct < 0);
  const faellig = rueckstand.filter((r) => r.offen.some((o: Row) => o.verzug >= minVerzug));

  return (
    <section>
      <div className="toolbar">
        <h1>Offene Posten & Mahnwesen – {props.objekt.bezeichnung}</h1>
        <span className="spacer" />
        <label>Stichtag <input type="date" value={stichtag} onChange={(e) => setStichtag(e.target.value)} /></label>
      </div>
      <div className="kacheln">
        <div className="kachel"><div className="wert">{euro(rueckstand.reduce((s, r) => s + r.summe_ct, 0))}</div><div className="label">Rückstände ({rueckstand.length})</div></div>
        <div className="kachel"><div className="wert">{euro(-guthaben.reduce((s, r) => s + r.summe_ct, 0) || 0)}</div><div className="label">Guthaben / Überzahlungen ({guthaben.length})</div></div>
      </div>
      <div className="toolbar">
        <h3>Rückstände</h3>
        <span className="spacer" />
        <label>Mahnen ab <input className="kurz num" type="number" value={minVerzug} onChange={(e) => setMinVerzug(Number(e.target.value))} /> Tagen Verzug</label>
        <button className="primary" disabled={!faellig.length} onClick={() => setMahnen(faellig)}>Mahnlauf ({faellig.length})</button>
      </div>
      <table>
        <thead><tr><th>Konto</th><th>Name</th><th>Offene Monate</th><th className="num">Ältester Verzug</th><th>Letzte Mahnung</th><th className="num">Rückstand</th><th /></tr></thead>
        <tbody>
          {rueckstand.map((r) => (
            <tr key={r.konto.id} onDoubleClick={() => setDetail(r)}>
              <td className="num">{r.konto.nr}</td>
              <td>{r.konto.bezeichnung}</td>
              <td className="klein">{r.offen.map((o: Row) => (o.monat ? `${o.monat.slice(5)}/${o.monat.slice(2, 4)}${o.status === 'teilweise bezahlt' ? ' (teilw.)' : ''}` : o.text)).join(', ')}</td>
              <td className="num">{Math.max(0, ...r.offen.map((o: Row) => o.verzug))} Tage</td>
              <td>{r.konto.mahnstufe ? `${STUFEN[Math.min(r.konto.mahnstufe, 3)]} am ${datum(r.konto.letzte_mahnung)}` : '–'}</td>
              <td className="num"><b>{euro(r.summe_ct)}</b></td>
              <td className="aktionen">
                <button onClick={() => setDetail(r)}>Details</button>
                <button onClick={() => setMahnen([r])}>Mahnen</button>
              </td>
            </tr>
          ))}
          {!rueckstand.length && <tr><td colSpan={7} className="hinweis">Keine Rückstände.</td></tr>}
        </tbody>
      </table>
      {guthaben.length > 0 && (
        <>
          <h3>Guthaben</h3>
          <table>
            <thead><tr><th>Konto</th><th>Name</th><th className="num">Guthaben</th></tr></thead>
            <tbody>
              {guthaben.map((r) => (
                <tr key={r.konto.id}><td className="num">{r.konto.nr}</td><td>{r.konto.bezeichnung}</td><td className="num">{euro(-r.summe_ct)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {detail && (
        <Dialog titel={`Offene Posten ${detail.konto.bezeichnung}`} onClose={() => setDetail(null)} breit>
          <table>
            <thead><tr><th>Fällig am</th><th>Forderung</th><th className="num">Soll</th><th className="num">bezahlt</th><th className="num">offen</th><th>Status</th><th className="num">Verzug</th></tr></thead>
            <tbody>
              {detail.offen.map((o: Row) => (
                <tr key={o.id}>
                  <td>{datum(o.datum)}</td>
                  <td>{o.text}{o.teile?.length > 1 && <div className="klein hinweis">{o.teile.map((t: Row) => `${t.text.replace(/\s\d{2}\/\d{4}.*$/, '')} ${euro(t.betrag_ct)}`).join(' · ')}</div>}</td>
                  <td className="num">{euro(o.soll_ct)}</td><td className="num">{o.bezahlt_ct ? euro(o.bezahlt_ct) : '–'}</td>
                  <td className="num"><b>{euro(o.offen_ct)}</b></td>
                  <td><span className={`tag ${o.status === 'nicht bezahlt' ? 'fehlertext' : ''}`}>{o.status}</span></td>
                  <td className="num">{o.verzug ? `${o.verzug} T.` : 'heute fällig'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}>Summe {detail.guthaben_ct > 0 ? `(abzgl. ${euro(detail.guthaben_ct)} Guthaben)` : ''}</td><td className="num"><Betrag ct={detail.summe_ct} fett /></td><td colSpan={2} /></tr></tfoot>
          </table>
          <p className="klein hinweis">Zahlungen werden immer auf den ältesten offenen Monat angerechnet. „Teilweise bezahlt“ heißt: Für diesen Monat ist ein Teil eingegangen, der Rest fehlt.</p>
        </Dialog>
      )}
      {mahnen && <Mahnlauf objekt={props.objekt} faelle={mahnen} stichtag={stichtag} onClose={() => { setMahnen(null); reload(); }} />}
    </section>
  );
}

function Mahnlauf(props: { objekt: Row; faelle: Row[]; stichtag: string; onClose: () => void }) {
  const [einst] = useLoad<Row>(() => call('einstellungen'), []);
  const [auswahl, setAuswahl] = useState<Record<number, { an: boolean; stufe: number }>>(() =>
    Object.fromEntries(props.faelle.map((f) => [f.konto.id, { an: true, stufe: Math.min((f.konto.mahnstufe ?? -1) + 1, 3) }])));
  const [gebuehr, setGebuehr] = useState(['0,00', '5,00', '5,00', '10,00']);
  const [fristTage, setFristTage] = useState(10);
  const [laeuft, setLaeuft] = useState(false);

  async function erstellen() {
    if (!einst) return;
    setLaeuft(true);
    const absender = absenderAus(einst);
    const frist = plusTage(heute(), fristTage);
    const seiten: string[] = [];
    for (const f of props.faelle) {
      const a = auswahl[f.konto.id];
      if (!a?.an) continue;
      const geb = parseCent(gebuehr[a.stufe]);
      const posten = tabelle(['Fällig am', 'Forderung', '#rSoll', '#rgezahlt', '#roffen'],
        f.offen.map((o: Row) => [datum(o.datum), esc(o.text), `#r${euro(o.soll_ct)}`, `#r${o.bezahlt_ct ? euro(o.bezahlt_ct) : '–'}`, `#r${euro(o.offen_ct)}`]),
        { summe: ['', f.guthaben_ct > 0 ? `Summe abzüglich Guthaben ${euro(f.guthaben_ct)}` : 'Summe offener Forderungen', '', '', `#r${euro(f.summe_ct)}`] });
      const text = [
        a.stufe === 0
          ? 'sicher ist es Ihrer Aufmerksamkeit entgangen: Auf Ihrem Konto sind folgende Beträge noch offen.'
          : `trotz unserer bisherigen Erinnerung sind auf Ihrem Konto folgende Beträge weiterhin offen.`,
      ];
      const nach = [
        geb ? `Für diese Mahnung berechnen wir eine Gebühr von ${euro(geb)}.` : '',
        `Bitte überweisen Sie den Gesamtbetrag von ${euro(f.summe_ct + geb)} bis spätestens ${datum(frist)} auf das unten genannte Konto` +
          (props.objekt.iban ? ` (IBAN ${props.objekt.iban})` : '') + '.',
        a.stufe >= 3 ? 'Sollte der Betrag bis dahin nicht eingehen, werden wir ohne weitere Ankündigung rechtliche Schritte einleiten.' : '',
        'Sollten Sie die Zahlung inzwischen geleistet haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.',
      ].filter(Boolean).join('\n\n');
      seiten.push(brief({
        absender: { ...absender, iban: props.objekt.iban || absender.iban, bank: props.objekt.bank || absender.bank, bic: props.objekt.bic || absender.bic },
        empfaenger: f.person,
        betreff: `${STUFEN[a.stufe]} – ${props.objekt.bezeichnung}`,
        info: [['Objekt', props.objekt.bezeichnung], ['Konto', String(f.konto.nr)]],
        inhalt: `<p>${esc(anrede(f.person))}</p>${absaetze(text.join('\n\n'))}${posten}${absaetze(nach)}<p class="unterschrift">Mit freundlichen Grüßen<br><br>${esc(absender.name)}</p>`,
      }));
      await call('mahnen', { konto_id: f.konto.id, stufe: a.stufe, gebuehr_ct: geb, frist, datum: heute(), offen_ct: f.summe_ct });
    }
    if (seiten.length) await alsPdf(seiten, `Mahnungen ${props.objekt.bezeichnung} ${heute()}`);
    setLaeuft(false);
    props.onClose();
  }

  return (
    <Dialog titel="Mahnlauf" onClose={props.onClose} breit aktionen={
      <button className="primary" disabled={laeuft} onClick={erstellen}>Mahnungen erstellen (PDF)</button>}>
      <p className="hinweis klein">Die Stufe erhöht sich automatisch gegenüber der letzten Mahnung. Mahngebühren werden dem Konto als Forderung belastet.</p>
      <div className="maske">
        {STUFEN.map((s, i) => (
          <label key={s}>Gebühr {s} (€)<input className="num" value={gebuehr[i]} onChange={(e) => setGebuehr(gebuehr.map((g, j) => (j === i ? e.target.value : g)))} /></label>
        ))}
        <label>Zahlungsfrist (Tage)<input className="num" type="number" value={fristTage} onChange={(e) => setFristTage(Number(e.target.value))} /></label>
      </div>
      <table>
        <thead><tr><th /><th>Name</th><th className="num">Rückstand</th><th>Stufe</th></tr></thead>
        <tbody>
          {props.faelle.map((f) => {
            const a = auswahl[f.konto.id];
            return (
              <tr key={f.konto.id}>
                <td><input type="checkbox" checked={a.an} onChange={(e) => setAuswahl({ ...auswahl, [f.konto.id]: { ...a, an: e.target.checked } })} /></td>
                <td>{f.person ? personName(f.person) : f.konto.bezeichnung}</td>
                <td className="num">{euro(f.summe_ct)}</td>
                <td>
                  <select value={a.stufe} onChange={(e) => setAuswahl({ ...auswahl, [f.konto.id]: { ...a, stufe: Number(e.target.value) } })}>
                    {STUFEN.map((s, i) => <option key={s} value={i}>{s}</option>)}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Dialog>
  );
}
