// Year-end checklist: what to finish before and after 31 December; points already done are ticked automatically.
import { useState } from 'react';
import * as I from 'lucide-react';
import { call, type Row } from '../api';
import { useLoad } from '../useLoad';
import { useNavi } from '../navi';

// The year to close: in December the current one, from January to the end of March the previous one.
export const jahreswechselJahr = () => {
  const d = new Date();
  return d.getMonth() === 11 ? d.getFullYear() : d.getFullYear() - 1;
};
export const jahreswechselZeit = () => { const m = new Date().getMonth(); return m === 11 || m <= 2; };

export function Jahreswechsel(props: { jahr?: number; kompakt?: boolean }) {
  const navi = useNavi();
  const [jahr, setJahr] = useState(props.jahr ?? jahreswechselJahr());
  const [r, reload] = useLoad<Row>(() => call('jahreswechsel', jahr), [jahr]);
  if (!r) return null;
  const quote = Math.round((r.fertig / r.gesamt) * 100);
  return (
    <div className="panel">
      <div className="panelkopf">
        <h3>Jahreswechsel {jahr}/{String(jahr + 1).slice(2)}</h3>
        <span className="chips">
          <span className={`chip ${r.fertig === r.gesamt ? 'gruen' : ''}`}>{r.fertig} von {r.gesamt} erledigt</span>
          {!props.kompakt && <select value={jahr} onChange={(e) => setJahr(Number(e.target.value))}>{[0, 1, 2].map((i) => new Date().getFullYear() - i).map((j) => <option key={j} value={j}>{j}</option>)}</select>}
        </span>
      </div>
      <div className="fortschritt"><span style={{ width: `${quote}%` }} /></div>
      <ul className="checkliste">
        {r.punkte.map((x: Row) => (
          <li key={x.punkt} className={x.erledigt ? 'fertig' : ''}>
            {x.auto ? <span className="haken" title="Automatisch erkannt"><I.Check size={13} strokeWidth={3} /></span>
              : <button className="haken" style={{ cursor: 'pointer', padding: 0 }} title={x.erledigt ? 'Haken entfernen' : 'Als erledigt abhaken'}
                onClick={async () => { await call('jahreswechselHaken', jahr, x.punkt, !x.erledigt); reload(); }}><I.Check size={13} strokeWidth={3} /></button>}
            <span className="text">{x.text}{x.hinweis && <span className="klein hinweis"> · {x.hinweis}</span>}</span>
            {!x.erledigt && <button className="klein" onClick={() => navi.zu(x.ziel)}>Öffnen</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
