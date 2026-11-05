// Tasks across all houses: a board (Offen → In Arbeit → Wartet → Erledigt, cards dragged between columns or moved with
// the status menu on a phone) or a work basket to go through them one by one. Filters: mine, a house, a person.
import { useState, type DragEvent } from 'react';
import { CalendarClock, Check, Columns3, ImageIcon, List, MessageSquare } from 'lucide-react';
import { call, datum, fehler, heute, type Row } from '../api';
import { useLoad } from '../useLoad';
import { useAktion } from '../aktion';
import { FormDialog } from '../Form';
import { Arbeitskorb } from '../Arbeitskorb';
import { Bild } from '../Symbol';
import { STATUS, Vorgang, vorgangFelder } from './Kommunikation';
import { PflichtErledigen } from './Pflichten';
import { AblaufStarten, AblaufVorlagen } from './Ablaeufe';
import { bestaetigen } from '../frage';

const SPALTEN: [string, string][] = [['offen', 'Offen'], ['in_arbeit', 'In Arbeit'], ['wartet', 'Wartet'], ['erledigt', 'Erledigt']];
const faelligKlasse = (v: Row) => (v.status === 'erledigt' || !v.faellig ? '' : v.faellig < heute() ? 'ueberfaellig' : v.faellig === heute() ? 'heute' : '');
const lesen = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const schreiben = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

export function Aufgaben(props: { objekte: Row[] }) {
  const [ansicht, setAnsicht] = useState<'board' | 'korb'>(() => (lesen('aufgaben_ansicht') === 'korb' ? 'korb' : 'board'));
  const [nurMeine, setNurMeine] = useState(() => lesen('aufgaben_meine') === '1');
  const [objektId, setObjektId] = useState<number | ''>('');
  const [zustaendig, setZustaendig] = useState<number | ''>('');
  const [nurFaellig, setNurFaellig] = useState(false);
  const [rows, reload] = useLoad<Row[]>(() => call('aufgabenListe', { nur_meine: nurMeine, objekt_id: objektId || null, zustaendig: zustaendig || null }),
    [nurMeine, objektId, zustaendig]);
  const [benutzer] = useLoad<Row[]>(() => call<Row[]>('benutzerListe').catch(() => []), []);
  const [personen] = useLoad<Row[]>(() => call('personen'), []);
  const [alleObjekte] = useLoad<Row[]>(async () => [...new Map([...await call('objekte', 'miete'), ...await call('objekte', 'weg')].map((o: Row) => [o.id, o])).values()], []);
  const [offen, setOffen] = useState<Row | null>(null);
  const [edit, setEdit] = useState<Row | null>(null);
  const [ziel, setZiel] = useState<string | null>(null);
  const neu = () => setEdit({ status: 'offen', prioritaet: 2, objekt_id: props.objekte[0]?.id });
  useAktion('neue-aufgabe', neu);
  const liste = (rows ?? []).filter((v) => !nurFaellig || (v.status !== 'erledigt' && v.faellig && v.faellig <= heute()));

  // Done: a short check pops up (src/styles.css .geschafft; not with "reduce motion").
  const [geschafft, setGeschafft] = useState(0);
  // A duty's case is done through the duty: date and proof, then the next date moves on.
  const [pflicht, setPflicht] = useState<Row | null>(null);
  const [ablauf, setAblauf] = useState<'starten' | 'vorlagen' | null>(null);
  const setzeStatus = async (v: Row, status: string) => {
    try {
      if (status === 'erledigt' && v.pflicht_id) {
        const p = await call<Row>('get', 'pflichten', v.pflicht_id);
        if (p) { setPflicht(p); return; }
      }
      await call('vorgangStatus', v.id, status);
      // The last step of a workflow done: offer to close the workflow too.
      if (status === 'erledigt' && v.eltern_id) {
        const offen = (await call<Row[]>('ablaufSchritte', v.eltern_id)).filter((x) => x.status !== 'erledigt' && x.id !== v.id);
        if (!offen.length && await bestaetigen(`Alle Schritte von „${v.eltern_titel}“ sind erledigt. Den Ablauf abschließen?`, { titel: 'Ablauf fertig', ja: 'Abschließen' }))
          await call('vorgangStatus', v.eltern_id, 'erledigt');
      }
      reload();
      if (status === 'erledigt') { const t = Date.now(); setGeschafft(t); setTimeout(() => setGeschafft((x) => (x === t ? 0 : x)), 1200); }
    } catch (e) { fehler(e); }
  };
  const ablegen = (e: DragEvent, status: string) => {
    e.preventDefault();
    setZiel(null);
    const id = Number(e.dataTransfer.getData('application/x-hv-aufgabe'));
    const v = rows?.find((x) => x.id === id);
    if (v) setzeStatus(v, status);
  };
  const karte = (v: Row) => (
    <>
      <span className="karte-titel">{v.prioritaet === 1 && <span className="tag fehlertext">!</span>}{v.titel}
        {!!v.schritte && <span className="tag" title="Erledigte Schritte des Ablaufs">{v.schritte_erledigt}/{v.schritte}</span>}</span>
      {v.eltern_titel && <span className="klein hinweis">↳ {v.eltern_titel}</span>}
      <span className="klein hinweis">{[v.objekt, v.einheit, v.person].filter(Boolean).join(' · ')}</span>
      <span className="karte-fuss klein">
        {v.faellig && <span className={`faellig ${faelligKlasse(v)}`}><CalendarClock size={13} aria-hidden="true" /> {datum(v.faellig)}</span>}
        {!!v.eintraege && <span title="Kommentare und Einträge"><MessageSquare size={13} aria-hidden="true" /> {v.eintraege}</span>}
        {!!v.fotos && <span title="Fotos und Dokumente"><ImageIcon size={13} aria-hidden="true" /> {v.fotos}</span>}
        <span className="spacer" />
        {v.zustaendig_name && <span className="person-kurz" title={`Zuständig: ${v.zustaendig_name}`}>{v.zustaendig_name.split(/\s+/).map((t: string) => t[0]).join('').slice(0, 2)}</span>}
      </span>
    </>
  );

  return (
    <section className="aufgaben">
      <div className="toolbar">
        <h1>Aufgaben</h1>
        <div className="segment" role="tablist" aria-label="Ansicht">
          <button role="tab" aria-selected={ansicht === 'board'} onClick={() => { setAnsicht('board'); schreiben('aufgaben_ansicht', 'board'); }}><Columns3 size={15} /> Board</button>
          <button role="tab" aria-selected={ansicht === 'korb'} onClick={() => { setAnsicht('korb'); schreiben('aufgaben_ansicht', 'korb'); }}><List size={15} /> Abarbeiten</button>
        </div>
        <span className="spacer" />
        <button onClick={() => setAblauf('vorlagen')}>Vorlagen</button>
        <button onClick={() => setAblauf('starten')}>Ablauf starten</button>
        <button className="primary" onClick={neu}>Neue Aufgabe</button>
      </div>
      <div className="toolbar filter">
        {!!benutzer?.length && <label className="check"><input type="checkbox" checked={nurMeine} onChange={(e) => { setNurMeine(e.target.checked); schreiben('aufgaben_meine', e.target.checked ? '1' : '0'); }} /> nur meine</label>}
        <select value={objektId} onChange={(e) => setObjektId(Number(e.target.value) || '')} aria-label="Objekt">
          <option value="">alle Objekte</option>{alleObjekte?.map((o) => <option key={o.id} value={o.id}>{o.bezeichnung}</option>)}
        </select>
        {!!benutzer?.length && !nurMeine && <select value={zustaendig} onChange={(e) => setZustaendig(Number(e.target.value) || '')} aria-label="Zuständig">
          <option value="">alle Personen</option>{benutzer.filter((b) => b.aktiv).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>}
        <label className="check"><input type="checkbox" checked={nurFaellig} onChange={(e) => setNurFaellig(e.target.checked)} /> nur fällige</label>
        <span className="hinweis klein">{liste.filter((v) => v.status !== 'erledigt').length} offen</span>
      </div>

      {ansicht === 'board' ? (
        <div className="board">
          {SPALTEN.map(([s, l]) => {
            const karten = liste.filter((v) => v.status === s);
            return (
              <div key={s} className={`board-spalte${ziel === s ? ' ziel' : ''}`} onDragOver={(e) => { e.preventDefault(); setZiel(s); }}
                onDragLeave={(e) => { if (e.currentTarget === e.target) setZiel(null); }} onDrop={(e) => ablegen(e, s)} aria-label={l}>
                <h3>{l} <span className="hinweis">{karten.length}</span></h3>
                {karten.map((v) => (
                  <div key={v.id} className={`karte prio${v.prioritaet}`} draggable data-ziel={`vorgang:${v.id}`}
                    onDragStart={(e) => { e.dataTransfer.setData('application/x-hv-aufgabe', String(v.id)); e.dataTransfer.effectAllowed = 'move'; }}>
                    <button className="karte-inhalt" onClick={() => setOffen(v)}>{karte(v)}</button>
                    <select className="karte-status" value={v.status} aria-label="Status ändern" onChange={(e) => setzeStatus(v, e.target.value)}>
                      {STATUS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                    </select>
                  </div>
                ))}
                {!karten.length && <p className="hinweis klein board-leer">{s === 'erledigt' ? 'Erledigtes der letzten 14 Tage' : 'Karten hierher ziehen'}</p>}
              </div>
            );
          })}
        </div>
      ) : (
        <Arbeitskorb eintraege={liste.filter((v) => v.status !== 'erledigt')} id={(v) => v.id} zeile={karte} zeilenKlasse={(v) => `prio${v.prioritaet}`}
          leer={<div className="alles-erledigt"><Bild name="aufgaben" groesse={88} className="leer-bild" /><p><b>Alles erledigt.</b> Keine offenen Aufgaben.</p></div>}
          detail={(v) => <Vorgang key={v.id} v={v} eingebettet onClose={reload}
            aktionen={<select value={v.status} aria-label="Status" onChange={(e) => setzeStatus(v, e.target.value)}>{STATUS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>} />} />
      )}

      {!!geschafft && <div key={geschafft} className="geschafft" aria-hidden="true"><Check size={48} strokeWidth={3} /></div>}
      {offen && <Vorgang v={offen} onClose={() => { setOffen(null); reload(); }}
        aktionen={<button onClick={() => { setEdit(offen); setOffen(null); }}>Bearbeiten</button>} />}
      {edit && <FormDialog title={edit.id ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'} row={edit}
        fields={vorgangFelder({ personen: personen ?? [], benutzer: benutzer ?? [], objekte: alleObjekte ?? props.objekte })}
        onSave={(r) => call('save', 'vorgaenge', r)} onDelete={() => call('remove', 'vorgaenge', edit.id)} onClose={() => { setEdit(null); reload(); }} />}
      {ablauf === 'starten' && <AblaufStarten onClose={(id) => { setAblauf(null); if (id) reload(); }} />}
      {ablauf === 'vorlagen' && <AblaufVorlagen onClose={() => setAblauf(null)} />}
      {pflicht && <PflichtErledigen pflicht={pflicht} onClose={(ok) => { setPflicht(null); if (ok) { reload(); const t = Date.now(); setGeschafft(t); setTimeout(() => setGeschafft((x) => (x === t ? 0 : x)), 1200); } }} />}
    </section>
  );
}
