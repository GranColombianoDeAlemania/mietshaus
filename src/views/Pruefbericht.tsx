// Data check report: completeness and plausibility of master data, postings and statements.
import { useState } from 'react';
import * as I from 'lucide-react';
import { call, type Modus, type Row } from '../api';
import { useLoad } from '../useLoad';
import { mitLinks, useNavi } from '../navi';
import { Chip, Leer, Tabs } from '../ui';
import { Jahreswechsel } from './Jahreswechsel';

const STUFE: Record<string, [string, 'rot' | 'gelb' | undefined]> = { fehler: ['Fehler', 'rot'], warnung: ['Prüfen', 'gelb'], info: ['Hinweis', undefined] };

export function Pruefbericht(props: { modus: Modus }) {
  const navi = useNavi();
  const [alle, setAlle] = useState(false);
  const [tab, setTab] = useState<'pruefung' | 'jahr'>('pruefung');
  const [r, reload] = useLoad<Row>(() => call('pruefbericht', { alle }), [alle]);
  const gruppen = r ? [...new Set<string>(r.punkte.map((p: Row) => p.bereich))] : [];
  return (
    <section>
      <div className="toolbar">
        <h1>Prüfbericht</h1>
        <Tabs tabs={[['pruefung', 'Datenprüfung'], ['jahr', 'Jahreswechsel']]} value={tab} onChange={setTab} />
        <span className="spacer" />
        {tab === 'pruefung' && <label className="check"><input type="checkbox" checked={alle} onChange={(e) => setAlle(e.target.checked)} /> auch ausgeblendete zeigen</label>}
        {tab === 'pruefung' && <button className="icon" onClick={reload}><I.RefreshCw size={14} /> Neu prüfen</button>}
      </div>
      {tab === 'jahr' && <Jahreswechsel />}
      {tab === 'pruefung' && r && (
        <div className="kacheln">
          <div className="kachel"><div className="wert">{r.punkte.filter((p: Row) => p.stufe === 'fehler').length}</div><div className="label">Fehler</div></div>
          <div className="kachel"><div className="wert">{r.punkte.filter((p: Row) => p.stufe === 'warnung').length}</div><div className="label">zu prüfen</div></div>
          <div className="kachel"><div className="wert">{r.geprueft}</div><div className="label">Prüfungen durchgeführt</div></div>
        </div>
      )}
      {tab === 'pruefung' && r && !r.punkte.length && <Leer text="Alles in Ordnung – keine Auffälligkeiten gefunden." />}
      {tab === 'pruefung' && gruppen.map((g) => (
        <div key={g} className="panel">
          <div className="panelkopf"><h3>{g}</h3></div>
          <ul className="hinweisliste">
            {r!.punkte.filter((p: Row) => p.bereich === g).map((p: Row) => (
              <li key={p.schluessel} className={`hinweis-${p.stufe === 'fehler' ? 'rot' : p.stufe === 'warnung' ? 'orange' : 'gelb'}${p.ausgeblendet ? ' vergangen' : ''}`}>
                <span className="punkt">●</span>
                <div className="inhalt">
                  <div>{mitLinks(p.text, p.links)}</div>
                  {p.hilfe && <div className="klein hinweis">{p.hilfe}</div>}
                </div>
                <div className="aktionen">
                  <Chip art={STUFE[p.stufe]?.[1]}>{STUFE[p.stufe]?.[0]}</Chip>
                  {p.ziel && <button onClick={() => navi.zu(p.ziel)}>Öffnen</button>}
                  {!p.ausgeblendet
                    ? <button title="Diesen Punkt nicht mehr melden" onClick={async () => { await call('hinweisSetzen', `pruef:${p.schluessel}`, 'ignoriert'); reload(); }}>Ausblenden</button>
                    : <button onClick={async () => { await call('hinweisZuruecksetzen', `pruef:${p.schluessel}`); reload(); }}>Wieder zeigen</button>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
