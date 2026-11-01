// Calendar of everything with a date: appointments, deadlines, due cases, project tasks, moves (db: kalender).
// A month grid on wide screens, a list on phones; a click opens the record, a double click on a day adds an appointment.
import { useEffect, useState } from 'react';
import { call, type Row } from '../api';
import { FormDialog } from '../Form';
import { useLoad } from '../useLoad';
import { useAktion } from '../aktion';
import { useNavi } from '../navi';
import { KalenderAbo } from './KalenderAbo';
import { terminFelder } from './Kommunikation';

export const KAL_ARTEN: [string, string][] = [['termin', 'Termine'], ['frist', 'Fristen'], ['vorgang', 'Vorgänge'], ['projekt', 'Projekte'], ['umzug', 'Ein- und Auszüge']];
const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const heuteIso = () => iso(new Date());
const schmal = () => matchMedia('(max-width: 800px)').matches;

// The weeks (Monday to Sunday) that cover a month.
function raster(monat: string) {
  const erster = new Date(`${monat}-01T12:00:00`);
  const start = new Date(erster);
  start.setDate(1 - ((erster.getDay() + 6) % 7));
  const letzter = new Date(erster.getFullYear(), erster.getMonth() + 1, 0, 12);
  const ende = new Date(letzter);
  ende.setDate(letzter.getDate() + (6 - ((letzter.getDay() + 6) % 7)));
  const tage: string[] = [];
  for (const d = new Date(start); d <= ende; d.setDate(d.getDate() + 1)) tage.push(iso(d));
  return tage;
}

const monatPlus = (monat: string, n: number) => {
  const d = new Date(`${monat}-01T12:00:00`);
  d.setMonth(d.getMonth() + n);
  return iso(d).slice(0, 7);
};

export function Kalender(props: { objekte: Row[] }) {
  const navi = useNavi();
  const [monat, setMonat] = useState(() => heuteIso().slice(0, 7));
  const [liste, setListe] = useState(schmal);
  const [arten, setArten] = useState<Set<string>>(() => new Set(KAL_ARTEN.map(([a]) => a)));
  const [nurMeine, setNurMeine] = useState(false);
  const [edit, setEdit] = useState<Row | null>(null);
  const [abo, setAbo] = useState(false);
  useEffect(() => {
    const h = () => schmal() && setListe(true);
    addEventListener('resize', h);
    return () => removeEventListener('resize', h);
  }, []);
  const tage = raster(monat);
  const von = liste ? `${monat}-01` : tage[0];
  const bis = liste ? iso(new Date(Number(monat.slice(0, 4)), Number(monat.slice(5, 7)), 0, 12)) : tage.at(-1)!;
  const [rows, reload] = useLoad<Row[]>(() => call('kalender', von, bis), [von, bis]);
  const [personen] = useLoad<Row[]>(() => call('personen'), []);
  const [info] = useLoad(() => window.hv.info(), []);
  useAktion('neuer-termin', () => setEdit({ datum: heuteIso() }));

  const sichtbar = (rows ?? []).filter((r) => arten.has(r.art) && (!nurMeine || r.meins || r.art === 'termin'));
  const amTag = (t: string) => sichtbar.filter((r) => r.datum === t);
  const oeffnen = async (r: Row) => {
    if (r.termin_id) setEdit(await call('get', 'termine', r.termin_id));
    else if (r.ziel) navi.zu(r.ziel);
  };
  const eintrag = (r: Row, i: number) => (
    <button key={i} className={`kal-e ${r.art}${r.wichtig ? ' wichtig' : ''}${r.erledigt ? ' erledigt' : ''}`} title={[r.titel, r.objekt, r.ort].filter(Boolean).join(' · ')}
      onClick={(e) => { e.stopPropagation(); oeffnen(r); }}>
      {r.uhrzeit && <b>{r.uhrzeit} </b>}{r.titel}
    </button>
  );
  const monatsName = new Date(`${monat}-01T12:00:00`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

  return (
    <section>
      <div className="toolbar">
        <h1>Kalender</h1>
        <button onClick={() => setMonat(monatPlus(monat, -1))} title="Vormonat">‹</button>
        <b className="kal-monat">{monatsName}</b>
        <button onClick={() => setMonat(monatPlus(monat, 1))} title="Nächster Monat">›</button>
        <button onClick={() => setMonat(heuteIso().slice(0, 7))}>Heute</button>
        <span className="spacer" />
        {!schmal() && <button onClick={() => setListe(!liste)}>{liste ? 'Monatsansicht' : 'Liste'}</button>}
        {info?.modus === 'server' && <button onClick={() => setAbo(true)}>Kalender-Abo…</button>}
        <button className="primary" onClick={() => setEdit({ datum: heuteIso() })}>Neuer Termin</button>
      </div>
      <div className="kal-filter">
        {KAL_ARTEN.map(([a, l]) => (
          <label key={a} className={`check kal-f ${a}`}>
            <input type="checkbox" checked={arten.has(a)} onChange={() => { const n = new Set(arten); n.has(a) ? n.delete(a) : n.add(a); setArten(n); }} /> {l}
          </label>
        ))}
        {info?.modus === 'server' && <label className="check"><input type="checkbox" checked={nurMeine} onChange={(e) => setNurMeine(e.target.checked)} /> nur meine Vorgänge</label>}
      </div>

      {!liste ? (
        <div className="kal-raster">
          {WOCHENTAGE.map((w) => <div key={w} className="kal-kopf">{w}</div>)}
          {tage.map((t) => {
            const e = amTag(t);
            return (
              <div key={t} className={`kal-tag${t.slice(0, 7) !== monat ? ' fremd' : ''}${t === heuteIso() ? ' heute' : ''}`} onDoubleClick={() => setEdit({ datum: t })}>
                <span className="kal-nr">{Number(t.slice(8))}</span>
                {e.slice(0, 4).map(eintrag)}
                {e.length > 4 && <button className="link klein" onClick={() => { setMonat(t.slice(0, 7)); setListe(true); }}>+{e.length - 4} weitere</button>}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="kal-liste">
          {[...new Set(sichtbar.map((r) => r.datum))].map((t) => (
            <div key={t} className="block">
              <h3 className={t === heuteIso() ? 'heute' : ''}>{new Date(`${t}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
              {amTag(t).map((r, i) => (
                <div key={i} className="kal-zeile">
                  {eintrag(r, i)}
                  <span className="klein hinweis">{[r.objekt, r.ort].filter(Boolean).join(' · ')}</span>
                </div>
              ))}
            </div>
          ))}
          {rows && !sichtbar.length && <p className="hinweis">Nichts in diesem Monat.</p>}
        </div>
      )}

      {edit && <FormDialog title={edit.id ? 'Termin bearbeiten' : 'Neuer Termin'} row={edit} fields={terminFelder(props.objekte, personen ?? [])}
        onSave={(r) => call('save', 'termine', r)} onDelete={() => call('remove', 'termine', edit.id)} onClose={() => { setEdit(null); reload(); }} />}
      {abo && <KalenderAbo onClose={() => setAbo(false)} />}
    </section>
  );
}
