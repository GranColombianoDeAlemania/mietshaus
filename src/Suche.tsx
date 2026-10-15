// Command palette in the header (⌘K / Strg+K): actions and pages by name, plus search across
// documents (full text), people, objects, units and postings. Arrow keys + Enter to choose.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as I from 'lucide-react';
import { call, datum, euro, type Row } from './api';

export type Befehl = { label: string; stichworte?: string; icon?: I.LucideIcon; run: () => void };
type Eintrag = { key: string; gruppe: string; inhalt: ReactNode; run: () => void };

const norm = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

export function Suche(props: { befehle: Befehl[]; onDokument: (d: Row) => void; onPerson: (id: number) => void; oeffne: (seite: string, objektId?: number) => void }) {
  const [q, setQ] = useState('');
  const [r, setR] = useState<Row | null>(null);
  const [offen, setOffen] = useState(false);
  const [aktiv, setAktiv] = useState(0);
  const feld = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); feld.current?.focus(); feld.current?.select(); setOffen(true); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  useEffect(() => {
    setAktiv(0);
    if (q.trim().length < 2) return setR(null);
    const t = setTimeout(async () => setR(await call('suche', q)), 150);
    return () => clearTimeout(t);
  }, [q]);

  const markiert = (s: string) => s.split(/(\[[^\]]*\])/).map((t, i) => (t.startsWith('[') ? <mark key={i}>{t.slice(1, -1)}</mark> : t));

  // One flat list so the keyboard can move through actions and results alike.
  const eintraege = useMemo<Eintrag[]>(() => {
    const n = norm(q.trim());
    const befehle = props.befehle.filter((b) => !n || norm(`${b.label} ${b.stichworte ?? ''}`).includes(n)).slice(0, n ? 8 : 12)
      .map((b, i): Eintrag => {
        const Icon = b.icon ?? I.CornerDownLeft;
        return { key: 'b' + i, gruppe: n ? 'Befehle' : 'Schnellzugriff', inhalt: <span className="aktion"><Icon size={15} /> {b.label}</span>, run: b.run };
      });
    if (!r) return befehle;
    return [
      ...befehle,
      ...r.dokumente.map((d: Row): Eintrag => ({ key: 'd' + d.id, gruppe: 'Dokumente', run: () => props.onDokument(d),
        inhalt: <><b>{d.titel}</b> <span className="klein">{[d.typ, datum(d.datum), d.objekt].filter(Boolean).join(' · ')}</span>{d.treffer && <div className="treffer klein">{markiert(d.treffer)}</div>}</> })),
      ...r.personen.map((p: Row): Eintrag => ({ key: 'p' + p.id, gruppe: 'Personen', run: () => props.onPerson(p.id),
        inhalt: <><b>{p.name}</b> <span className="klein">{[p.ort, p.telefon, p.email].filter(Boolean).join(' · ')}</span></> })),
      ...r.objekte.map((o: Row): Eintrag => ({ key: 'o' + o.id, gruppe: 'Objekte', run: () => props.oeffne('steckbrief', o.id), inhalt: <><b>{o.bezeichnung}</b> <span className="klein">{o.ort}</span></> })),
      ...r.einheiten.map((e: Row): Eintrag => ({ key: 'e' + e.id, gruppe: 'Einheiten', run: () => props.oeffne('einheiten', e.objekt_id), inhalt: <><b>{e.bezeichnung}</b> <span className="klein">{e.objekt}</span></> })),
      ...r.buchungen.map((b: Row): Eintrag => ({ key: 'u' + b.id, gruppe: 'Buchungen',
        run: () => { sessionStorage.setItem('buchungSuche', b.text ?? b.beleg ?? ''); props.oeffne('buchen', b.objekt_id); },
        inhalt: <>{datum(b.datum)} <b>{b.text}</b> <span className="klein">{euro(b.betrag_ct)} · {b.objekt}</span></> })),
      ...(r.dokumente.length ? [{ key: 'mehr', gruppe: 'Dokumente', run: () => { sessionStorage.setItem('archivSuche', q); props.oeffne('archiv'); },
        inhalt: <span className="mehr">Alle Dokument-Treffer im Archiv zeigen →</span> }] : []),
    ];
  }, [q, r, props.befehle]);

  const waehle = (e?: Eintrag) => { if (!e) return; e.run(); setOffen(false); setQ(''); feld.current?.blur(); };

  return (
    <div className="globalsuche">
      <input ref={feld} placeholder="Suchen / Befehl  ⌘K" value={q} onFocus={() => setOffen(true)}
        onBlur={() => setTimeout(() => setOffen(false), 150)}
        onChange={(e) => { setQ(e.target.value); setOffen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAktiv(Math.min(aktiv + 1, eintraege.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setAktiv(Math.max(aktiv - 1, 0)); }
          if (e.key === 'Enter') { e.preventDefault(); waehle(eintraege[aktiv]); }
          if (e.key === 'Escape') { setOffen(false); feld.current?.blur(); }
        }} />
      {offen && (
        <div className="suchergebnis" onMouseDown={(e) => e.preventDefault()}>
          {q.trim().length >= 2 && r && eintraege.length === 0 && <div className="hinweis">Nichts gefunden.</div>}
          {eintraege.map((e, i) => (
            <div key={e.key}>
              {(i === 0 || eintraege[i - 1].gruppe !== e.gruppe) && <h4>{e.gruppe}</h4>}
              <button className={i === aktiv ? 'gewaehlt' : ''} onMouseEnter={() => setAktiv(i)} onClick={() => waehle(e)}>{e.inhalt}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
