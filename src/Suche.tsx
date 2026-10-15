// Global search in the header (⌘K / Strg+K): documents by full text, people, objects, units, postings.
import { useEffect, useRef, useState } from 'react';
import { call, datum, euro, type Row } from './api';

export function Suche(props: { onDokument: (d: Row) => void; oeffne: (seite: string, objektId?: number) => void }) {
  const [q, setQ] = useState('');
  const [r, setR] = useState<Row | null>(null);
  const [offen, setOffen] = useState(false);
  const feld = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); feld.current?.focus(); }
      if (e.key === 'Escape') setOffen(false);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) return setR(null);
    const t = setTimeout(async () => setR(await call('suche', q)), 150);
    return () => clearTimeout(t);
  }, [q]);

  const waehle = (fn: () => void) => { fn(); setOffen(false); };
  const leer = r && !Object.values(r).some((l: any) => l.length);
  const markiert = (s: string) => s.split(/(\[[^\]]*\])/).map((t, i) => (t.startsWith('[') ? <mark key={i}>{t.slice(1, -1)}</mark> : t));

  return (
    <div className="globalsuche">
      <input ref={feld} placeholder="Suchen… (⌘K)" value={q} onChange={(e) => { setQ(e.target.value); setOffen(true); }} onFocus={() => setOffen(true)} />
      {offen && r && (
        <div className="suchergebnis" onMouseDown={(e) => e.preventDefault()}>
          {leer && <div className="hinweis">Nichts gefunden.</div>}
          {r.dokumente.length > 0 && <h4>Dokumente</h4>}
          {r.dokumente.map((d: Row) => (
            <button key={'d' + d.id} onClick={() => waehle(() => props.onDokument(d))}>
              <b>{d.titel}</b> <span className="klein">{[d.typ, datum(d.datum), d.objekt].filter(Boolean).join(' · ')}</span>
              {d.treffer && <div className="klein">{markiert(d.treffer)}</div>}
            </button>
          ))}
          {r.personen.length > 0 && <h4>Personen</h4>}
          {r.personen.map((p: Row) => (
            <button key={'p' + p.id} onClick={() => waehle(() => { sessionStorage.setItem('personSuche', p.name.split(',')[0]); props.oeffne('personen'); })}>
              <b>{p.name}</b> <span className="klein">{[p.ort, p.telefon, p.email].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          {r.objekte.length > 0 && <h4>Objekte</h4>}
          {r.objekte.map((o: Row) => <button key={'o' + o.id} onClick={() => waehle(() => props.oeffne('einheiten', o.id))}><b>{o.bezeichnung}</b> <span className="klein">{o.ort}</span></button>)}
          {r.einheiten.length > 0 && <h4>Einheiten</h4>}
          {r.einheiten.map((e: Row) => <button key={'e' + e.id} onClick={() => waehle(() => props.oeffne('einheiten', e.objekt_id))}><b>{e.bezeichnung}</b> <span className="klein">{e.objekt}</span></button>)}
          {r.buchungen.length > 0 && <h4>Buchungen</h4>}
          {r.buchungen.map((b: Row) => (
            <button key={'b' + b.id} onClick={() => waehle(() => { sessionStorage.setItem('buchungSuche', b.text ?? b.beleg ?? ''); props.oeffne('buchen', b.objekt_id); })}>
              {datum(b.datum)} <b>{b.text}</b> <span className="klein">{euro(b.betrag_ct)} · {b.objekt}</span>
            </button>
          ))}
          {r.dokumente.length > 0 && (
            <button className="mehr" onClick={() => waehle(() => { sessionStorage.setItem('archivSuche', q); props.oeffne('archiv'); })}>Alle Dokument-Treffer im Archiv zeigen →</button>
          )}
        </div>
      )}
    </div>
  );
}
