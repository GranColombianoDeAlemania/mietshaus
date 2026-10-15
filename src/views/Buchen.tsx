import { useState } from 'react';
import { betrag, call, datum, diesesJahr, fehlerText, heute, parseCent, type Row } from '../api';
import { useLoad } from '../useLoad';
import { KontoSelect, Tabs, Zeitraum } from '../ui';

type Art = 'einnahme' | 'ausgabe' | 'frei';
type Pos = { gegen_id: number | ''; soll_id: number | ''; haben_id: number | ''; betrag: string; text: string };

const leerePos = (): Pos => ({ gegen_id: '', soll_id: '', haben_id: '', betrag: '', text: '' });

export function Buchen(props: { objekt: Row }) {
  const [konten, ladeKonten] = useLoad<Row[]>(() => call('konten', props.objekt.id), [props.objekt.id]);
  const [von, setVon] = useState(`${diesesJahr()}-01-01`);
  const [bis, setBis] = useState(`${diesesJahr()}-12-31`);
  const [suche, setSuche] = useState('');
  const [rows, reload] = useLoad<Row[]>(() => call('buchungen', props.objekt.id, { von, bis, suche }), [props.objekt.id, von, bis, suche]);
  const [offen, setOffen] = useState(false);

  return (
    <section>
      <div className="toolbar">
        <h1>Buchungen – {props.objekt.bezeichnung}</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setOffen(true)}>Neue Buchung</button>
      </div>
      <div className="toolbar">
        <Zeitraum von={von} bis={bis} onChange={(a, b) => { setVon(a); setBis(b); }} />
        <input className="suche" placeholder="Text, Beleg oder Konto suchen…" value={suche} onChange={(e) => setSuche(e.target.value)} />
        <span className="spacer" />
        <span className="hinweis klein">{rows?.length ?? 0} Buchungen</span>
      </div>
      {offen && konten && (
        <Buchungsmaske objekt={props.objekt} konten={konten} onDone={() => { reload(); ladeKonten(); }} onClose={() => setOffen(false)} />
      )}
      <table>
        <thead><tr><th>Datum</th><th>Beleg</th><th>Text</th><th>Soll</th><th>Haben</th><th className="num">Betrag</th><th /></tr></thead>
        <tbody>
          {rows?.map((b) => (
            <tr key={b.id} className={b.gruppe ? 'split' : ''}>
              <td>{datum(b.datum)}</td>
              <td>{b.beleg}</td>
              <td>{b.text}{b.art === 'soll' && <span className="tag">Soll</span>}{b.art === 'bank' && <span className="tag">Bank</span>}</td>
              <td className="klein">{b.soll_nr} {b.soll_bez}</td>
              <td className="klein">{b.haben_nr} {b.haben_bez}</td>
              <td className="num">{betrag(b.betrag_ct)}</td>
              <td className="aktionen">
                <button title={b.gruppe ? 'Löscht die ganze Splitbuchung' : ''} onClick={async () => {
                  if (!confirm(b.gruppe ? 'Ganze Splitbuchung löschen?' : 'Buchung löschen?')) return;
                  await call('buchungLoeschen', b.id);
                  reload();
                  ladeKonten();
                }}>Löschen</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// Entry form for receipts, expenses (both with optional split) and free double-entry postings.
function Buchungsmaske(props: { objekt: Row; konten: Row[]; onDone: () => void; onClose: () => void }) {
  const geldStandard = props.konten.find((k) => k.klasse === 'geld')?.id ?? '';
  const [art, setArt] = useState<Art>('einnahme');
  const [kopf, setKopf] = useState({ datum: heute(), beleg: '', text: '', geld_id: geldStandard as number | '' });
  const [pos, setPos] = useState<Pos[]>([leerePos()]);
  const [meldung, setMeldung] = useState('');

  const setP = (i: number, p: Partial<Pos>) => setPos(pos.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const summe = pos.reduce((s, p) => s + parseCent(p.betrag), 0);

  async function speichern() {
    try {
      const positionen = pos.filter((p) => parseCent(p.betrag)).map((p) => {
        const betrag_ct = parseCent(p.betrag);
        if (art === 'frei') return { soll_id: p.soll_id, haben_id: p.haben_id, betrag_ct, text: p.text || undefined };
        return art === 'einnahme'
          ? { soll_id: kopf.geld_id, haben_id: p.gegen_id, betrag_ct, text: p.text || undefined }
          : { soll_id: p.gegen_id, haben_id: kopf.geld_id, betrag_ct, text: p.text || undefined };
      });
      await call('buchen', { objekt_id: props.objekt.id, datum: kopf.datum, beleg: kopf.beleg, text: kopf.text, positionen });
      setMeldung(`Gebucht: ${betrag(summe)} €`);
      setPos([leerePos()]);
      setKopf({ ...kopf, beleg: kopf.beleg && /\d+$/.test(kopf.beleg) ? kopf.beleg.replace(/\d+$/, (n) => String(Number(n) + 1).padStart(n.length, '0')) : '', text: '' });
      props.onDone();
    } catch (e) {
      setMeldung(fehlerText(e));
    }
  }

  const gegenKlassen = art === 'einnahme' ? ['person', 'einnahme', 'geld', 'ruecklage'] : ['kosten', 'person', 'geld', 'ruecklage'];

  return (
    <div className="panel">
      <div className="toolbar">
        <Tabs tabs={[['einnahme', 'Zahlungseingang'], ['ausgabe', 'Ausgabe / Rechnung'], ['frei', 'Umbuchung (Soll/Haben)']]} value={art} onChange={(a) => { setArt(a); setPos([leerePos()]); }} />
        <span className="spacer" />
        <button onClick={props.onClose}>Schließen</button>
      </div>
      <div className="maske">
        <label>Datum<input type="date" value={kopf.datum} onChange={(e) => setKopf({ ...kopf, datum: e.target.value })} /></label>
        <label>Beleg-Nr.<input value={kopf.beleg} onChange={(e) => setKopf({ ...kopf, beleg: e.target.value })} /></label>
        <label className="breit">Buchungstext<input value={kopf.text} onChange={(e) => setKopf({ ...kopf, text: e.target.value })} placeholder="z. B. Miete März, Rechnung Stadtwerke" /></label>
        {art !== 'frei' && (
          <label className="breit">{art === 'einnahme' ? 'Eingang auf Konto' : 'Bezahlt von Konto'}
            <KontoSelect konten={props.konten} klassen={['geld']} value={kopf.geld_id} onChange={(id) => setKopf({ ...kopf, geld_id: id })} />
          </label>
        )}
      </div>
      <table className="positionen">
        <thead>
          <tr>
            {art === 'frei' ? <><th>Soll (Zugang)</th><th>Haben (Abgang)</th></> : <th>{art === 'einnahme' ? 'Von (Mieter, Eigentümer, Einnahme)' : 'Für (Kostenart)'}</th>}
            <th>Text (optional)</th><th className="num">Betrag €</th><th />
          </tr>
        </thead>
        <tbody>
          {pos.map((p, i) => (
            <tr key={i}>
              {art === 'frei' ? (
                <>
                  <td><KontoSelect konten={props.konten} value={p.soll_id} onChange={(id) => setP(i, { soll_id: id })} /></td>
                  <td><KontoSelect konten={props.konten} value={p.haben_id} onChange={(id) => setP(i, { haben_id: id })} /></td>
                </>
              ) : (
                <td><KontoSelect konten={props.konten} klassen={gegenKlassen} value={p.gegen_id} onChange={(id) => setP(i, { gegen_id: id })} /></td>
              )}
              <td><input value={p.text} onChange={(e) => setP(i, { text: e.target.value })} /></td>
              <td><input className="num" inputMode="decimal" value={p.betrag} onChange={(e) => setP(i, { betrag: e.target.value })} /></td>
              <td>{pos.length > 1 && <button onClick={() => setPos(pos.filter((_, j) => j !== i))}>×</button>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={art === 'frei' ? 3 : 2}><button onClick={() => setPos([...pos, leerePos()])}>+ Aufteilen (Splitbuchung)</button></td>
            <td className="num"><b>{betrag(summe)}</b></td><td />
          </tr>
        </tfoot>
      </table>
      <div className="buttons">
        {meldung && <span className="meldung">{meldung}</span>}
        <span className="spacer" />
        <button className="primary" disabled={!summe} onClick={speichern}>Buchen</button>
      </div>
    </div>
  );
}
