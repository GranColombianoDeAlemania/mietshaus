import { useState } from 'react';
import { betrag, call, datum, diesesJahr, euro, fehler, fehlerText, heute, parseCent, type Row } from '../api';
import { useLoad } from '../useLoad';
import { KontoSelect, Tabs, Zeitraum } from '../ui';
import { useAktion } from '../aktion';
import { L } from '../navi';

type Art = 'einnahme' | 'ausgabe' | 'frei';
type Pos = { gegen_id: number | ''; soll_id: number | ''; haben_id: number | ''; betrag: string; text: string; ust: '' | '19' | '7' };

const leerePos = (): Pos => ({ gegen_id: '', soll_id: '', haben_id: '', betrag: '', text: '', ust: '' });

// Input tax contained in a gross amount and the deductible part of it (mixed houses: only the commercial share).
export const vorsteuerAnteil = (brutto: number, satz: number, quote: number) => {
  const ust = Math.round(brutto * satz / (100 + satz));
  return Math.round(ust * quote / 100);
};

export function Buchen(props: { objekt: Row }) {
  const [konten, ladeKonten] = useLoad<Row[]>(() => call('konten', props.objekt.id), [props.objekt.id]);
  const [von, setVon] = useState(`${diesesJahr()}-01-01`);
  const [bis, setBis] = useState(`${diesesJahr()}-12-31`);
  const [suche, setSuche] = useState(() => {
    const s = sessionStorage.getItem('buchungSuche') ?? '';
    sessionStorage.removeItem('buchungSuche');
    return s;
  });
  const [rows, reload] = useLoad<Row[]>(() => call('buchungen', props.objekt.id, { von, bis, suche }), [props.objekt.id, von, bis, suche]);
  const [offen, setOffen] = useState(false);
  useAktion('neue-buchung', () => setOffen(true));

  return (
    <section>
      <div className="toolbar">
        <h1>Buchungen</h1>
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
            <tr key={b.id} className={b.gruppe ? 'split' : ''} data-ziel={`buchung:${b.id}`} title="Rechtsklick für weitere Aktionen; Beleg hierher ziehen, um ihn zuzuordnen">
              <td>{datum(b.datum)}</td>
              <td>{b.dok_id ? <L zu={{ dokument: b.dok_id, datei: b.dok_datei }} title="Beleg öffnen">{b.beleg || 'Beleg'}</L> : b.beleg}</td>
              <td>{b.text} {b.art === 'soll' && <span className="tag">Soll</span>}{b.art === 'bank' && <span className="tag">Bank</span>}
                {b.storniert ? <span className="tag fehlertext">storniert</span> : null}{b.festgeschrieben ? <span className="tag" title="festgeschriebener Zeitraum">🔒</span> : null}</td>
              <td className="klein"><L zu={b.soll_vid ? { vertrag: b.soll_vid, typ: b.soll_vtyp } : { konto: b.soll_id }}>{b.soll_nr} {b.soll_bez}</L></td>
              <td className="klein"><L zu={b.haben_vid ? { vertrag: b.haben_vid, typ: b.haben_vtyp } : { konto: b.haben_id }}>{b.haben_nr} {b.haben_bez}</L></td>
              <td className="num">{betrag(b.betrag_ct)}</td>
              <td className="aktionen">
                {!b.storniert && b.art !== 'storno' && (
                  <button title="Gegenbuchung mit heutigem Datum – die ursprüngliche Buchung bleibt sichtbar" onClick={async () => {
                    if (!confirm('Buchung stornieren (Gegenbuchung mit heutigem Datum)?')) return;
                    try { await call('buchungStornieren', b.id); } catch (e) { fehler(e); }
                    reload();
                    ladeKonten();
                  }}>Storno</button>
                )}
                {!b.festgeschrieben && (
                  <button title={b.gruppe ? 'Löscht die ganze Splitbuchung' : ''} onClick={async () => {
                    if (!confirm(b.gruppe ? 'Ganze Splitbuchung löschen?' : 'Buchung löschen?')) return;
                    try { await call('buchungLoeschen', b.id); } catch (e) { fehler(e); }
                    reload();
                    ladeKonten();
                  }}>Löschen</button>
                )}
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
  // A page like the contract page can pre-fill the form ("Zahlung buchen").
  const [vorlage] = useState<Row | null>(() => {
    try { const v = JSON.parse(sessionStorage.getItem('buchungVorlage') ?? 'null'); sessionStorage.removeItem('buchungVorlage'); return v; } catch { return null; }
  });
  const [art, setArt] = useState<Art>(vorlage?.art ?? 'einnahme');
  const [kopf, setKopf] = useState({ datum: heute(), beleg: '', text: vorlage?.text ?? '', geld_id: geldStandard as number | '' });
  const [pos, setPos] = useState<Pos[]>([{ ...leerePos(), gegen_id: vorlage?.gegen_id ?? '' }]);
  const [meldung, setMeldung] = useState('');

  const setP = (i: number, p: Partial<Pos>) => setPos(pos.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const summe = pos.reduce((s, p) => s + parseCent(p.betrag), 0);
  // Objects with a VAT-able letting can split input tax off expenses.
  const vst19 = props.konten.find((k) => k.klasse === 'steuer' && k.kategorie === 'vorsteuer19');
  const vst7 = props.konten.find((k) => k.klasse === 'steuer' && k.kategorie === 'vorsteuer7');
  const quote = props.objekt.vorsteuer_quote ?? 100;
  const vorsteuer = art === 'ausgabe' && vst19 ? pos.reduce((s, p) => s + (p.ust ? vorsteuerAnteil(parseCent(p.betrag), Number(p.ust), quote) : 0), 0) : 0;

  async function speichern() {
    try {
      const positionen = pos.filter((p) => parseCent(p.betrag)).flatMap((p) => {
        const betrag_ct = parseCent(p.betrag);
        if (art === 'frei') return [{ soll_id: p.soll_id, haben_id: p.haben_id, betrag_ct, text: p.text || undefined }];
        if (art === 'einnahme') return [{ soll_id: kopf.geld_id, haben_id: p.gegen_id, betrag_ct, text: p.text || undefined }];
        // Expense with input tax: the deductible part goes to the input tax account, the rest to the cost account.
        const vst = p.ust && vst19 ? vorsteuerAnteil(betrag_ct, Number(p.ust), quote) : 0;
        const konto = p.ust === '7' ? vst7 ?? vst19 : vst19;
        return [
          { soll_id: p.gegen_id, haben_id: kopf.geld_id, betrag_ct: betrag_ct - vst, text: p.text || undefined },
          ...(vst ? [{ soll_id: konto!.id, haben_id: kopf.geld_id, betrag_ct: vst, text: `Vorsteuer ${p.ust} %${p.text ? ` – ${p.text}` : ''}` }] : []),
        ];
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

  const gegenKlassen = art === 'einnahme' ? ['person', 'einnahme', 'geld', 'ruecklage', 'steuer'] : ['kosten', 'person', 'geld', 'ruecklage', 'steuer', 'darlehen'];

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
            <th>Text (optional)</th>{art === 'ausgabe' && vst19 && <th>darin USt</th>}<th className="num">Betrag € (brutto)</th><th />
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
                <td><KontoSelect konten={props.konten} klassen={gegenKlassen} value={p.gegen_id} onChange={(id) => setP(i, { gegen_id: id })} />
                  {art === 'einnahme' && p.gegen_id && <KontoHinweis konto={props.konten.find((k) => k.id === p.gegen_id)} betrag_ct={parseCent(p.betrag)} datum={kopf.datum} />}</td>
              )}
              <td><input value={p.text} onChange={(e) => setP(i, { text: e.target.value })} /></td>
              {art === 'ausgabe' && vst19 && (
                <td><select value={p.ust} onChange={(e) => setP(i, { ust: e.target.value as Pos['ust'] })}><option value="">keine</option><option value="19">19 %</option><option value="7">7 %</option></select></td>
              )}
              <td><input className="num" inputMode="decimal" value={p.betrag} onChange={(e) => setP(i, { betrag: e.target.value })} /></td>
              <td>{pos.length > 1 && <button onClick={() => setPos(pos.filter((_, j) => j !== i))}>×</button>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={art === 'frei' ? 3 : art === 'ausgabe' && vst19 ? 3 : 2}><button onClick={() => setPos([...pos, leerePos()])}>+ Aufteilen (Splitbuchung)</button>
              {vorsteuer > 0 && <span className="klein hinweis"> · davon abziehbare Vorsteuer {betrag(vorsteuer)} €{quote < 100 ? ` (${quote} % der USt)` : ''}</span>}</td>
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

// Rent and house money are charged to the contract account by the monthly charges; a payment booked straight to
// the income account would count twice and leave the tenant in arrears.
const ERTRAG_AUS_SOLL = ['miete', 'sonst', 'bk', 'hk', 'hausgeld', 'ruecklage'];

// Shows the selected account's state when a payment is entered: what is due, what remains after this payment.
function KontoHinweis(props: { konto: Row | undefined; betrag_ct: number; datum: string }) {
  const k = props.konto;
  const [s] = useLoad<Row | null>(() => (k?.klasse === 'person' ? call('kontoStatus', k.id, props.datum || heute()) : Promise.resolve(null)), [k?.id, props.datum]);
  if (k?.klasse === 'einnahme' && ERTRAG_AUS_SOLL.includes(k.kategorie))
    return <p className="klein fehlertext">Mieter- und Eigentümerzahlungen bitte auf das Personenkonto buchen: Die {k.kategorie === 'hausgeld' || k.kategorie === 'ruecklage' ? 'Hausgeldforderung' : 'Miete'} ist
      über die Sollstellung schon als Ertrag gebucht. Hier gebucht, zählt sie doppelt und beim Mieter bleibt ein Rückstand.</p>;
  if (!s) return null;
  const nachher = s.saldo_ct - props.betrag_ct;
  const naechste = s.naechste ? `nächste Fälligkeit ${datum(s.naechste.datum)}: ${euro(s.naechste.betrag_ct)}` : '';
  return (
    <p className="klein hinweis">
      {s.beginn > (props.datum || heute()) ? `Vertrag beginnt am ${datum(s.beginn)} – noch nichts fällig. `
        : s.saldo_ct > 0 ? `Fällig und offen: ${euro(s.saldo_ct)}${s.offene_monate.length ? ` (${s.offene_monate.join(', ')})` : ''}. `
          : s.guthaben_ct > 0 ? `Nichts offen, Guthaben ${euro(s.guthaben_ct)}. ` : 'Nichts offen. '}
      {props.betrag_ct > 0 && (nachher > 0 ? <>Nach dieser Zahlung bleiben <b className="negativ">{euro(nachher)}</b> offen. </>
        : nachher < 0 ? <>Nach dieser Zahlung: Guthaben <b>{euro(-nachher)}</b>{s.naechste ? ', wird mit der nächsten Forderung verrechnet' : ''}. </>
          : <>Nach dieser Zahlung ist das Konto ausgeglichen. </>)}
      {naechste && <>{naechste.charAt(0).toUpperCase() + naechste.slice(1)}.</>}
    </p>
  );
}

