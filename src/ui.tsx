// Small shared UI pieces.
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { KLASSEN, kontoLabel, type Row } from './api';

// Folds case and umlauts, so "uberw" finds "Überweisung".
const falten = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss');

// Account picker with search: type a number or part of the name, choose with the arrow keys and Enter (or the mouse).
// Long charts of accounts made a plain select slow to use.
export function KontoSelect(props: {
  konten: Row[];
  value: number | '' | null;
  onChange: (id: number | '') => void;
  klassen?: string[];
  leer?: string;
}) {
  const [suche, setSuche] = useState<string | null>(null);
  const [markiert, setMarkiert] = useState(0);
  const liste = useRef<HTMLDivElement>(null);
  const gruppen = Object.keys(KLASSEN).filter((k) => !props.klassen || props.klassen.includes(k));
  const aktiv = props.konten.filter((k) => !k.inaktiv && gruppen.includes(k.klasse));
  const gewaehlt = props.konten.find((k) => k.id === props.value);
  const worte = falten(suche ?? '').split(/\s+/).filter(Boolean);
  const treffer = gruppen.flatMap((g) => aktiv.filter((k) => k.klasse === g)
    .filter((k) => worte.every((w) => falten(`${k.nr ?? ''} ${kontoLabel(k)}`).includes(w))));
  const offen = suche !== null;

  useEffect(() => { liste.current?.querySelector('.markiert')?.scrollIntoView({ block: 'nearest' }); }, [markiert, offen]);

  const waehlen = (k: Row | null) => {
    props.onChange(k ? k.id : '');
    setSuche(null);
  };
  const taste = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!offen) { setSuche(''); setMarkiert(0); return; }
      setMarkiert((m) => Math.max(0, Math.min(treffer.length - 1, m + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && offen) {
      e.preventDefault();
      if (treffer[markiert]) waehlen(treffer[markiert]);
    } else if (e.key === 'Escape' && offen) {
      e.preventDefault();
      setSuche(null);
    }
  };

  let letzteGruppe = '';
  return (
    <div className="kontowahl">
      <input value={offen ? suche : gewaehlt ? kontoLabel(gewaehlt) : ''} placeholder={props.leer ?? '– Konto wählen –'}
        role="combobox" aria-expanded={offen} aria-autocomplete="list" title={gewaehlt ? kontoLabel(gewaehlt) : undefined}
        onFocus={(e) => { setSuche(''); setMarkiert(Math.max(0, treffer.findIndex((k) => k.id === props.value))); e.currentTarget.select(); }}
        onChange={(e) => { setSuche(e.target.value); setMarkiert(0); }}
        onBlur={() => setSuche(null)} onKeyDown={taste} />
      {offen && (
        <div className="kontowahl-liste" ref={liste} role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {props.value !== '' && props.value != null && !suche && <div className="option leer" onClick={() => waehlen(null)}>{props.leer ?? '– kein Konto –'}</div>}
          {treffer.length === 0 && <div className="option leer">Kein Konto passt zu „{suche}“.</div>}
          {treffer.map((k, i) => {
            const kopf = k.klasse !== letzteGruppe ? (letzteGruppe = k.klasse) : null;
            return (
              <div key={k.id}>
                {kopf && <div className="gruppe">{KLASSEN[kopf]}</div>}
                <div role="option" aria-selected={k.id === props.value} className={`option${i === markiert ? ' markiert' : ''}${k.id === props.value ? ' gewaehlt' : ''}`}
                  onMouseEnter={() => setMarkiert(i)} onClick={() => waehlen(k)}>{kontoLabel(k)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Tabs<T extends string>(props: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs">
      {props.tabs.map(([t, l]) => (
        <button key={t} className={props.value === t ? 'active' : ''} onClick={() => props.onChange(t)}>{l}</button>
      ))}
    </div>
  );
}

export function Zeitraum(props: { von: string; bis: string; onChange: (von: string, bis: string) => void }) {
  const jahr = Number(props.von.slice(0, 4)) || new Date().getFullYear();
  return (
    <span className="zeitraum">
      <button title="Vorjahr" onClick={() => props.onChange(`${jahr - 1}-01-01`, `${jahr - 1}-12-31`)}>‹</button>
      <input type="date" value={props.von} onChange={(e) => props.onChange(e.target.value, props.bis)} />
      <span>bis</span>
      <input type="date" value={props.bis} onChange={(e) => props.onChange(props.von, e.target.value)} />
      <button title="Folgejahr" onClick={() => props.onChange(`${jahr + 1}-01-01`, `${jahr + 1}-12-31`)}>›</button>
    </span>
  );
}

export function Dialog(props: { titel: string; children: ReactNode; onClose: () => void; breit?: boolean; aktionen?: ReactNode }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`dialog${props.breit ? ' breit' : ''}`}>
        <h2>{props.titel}</h2>
        {props.children}
        <div className="buttons">
          <span className="spacer" />
          {props.aktionen}
          <button onClick={props.onClose}>Schließen</button>
        </div>
      </div>
    </div>
  );
}

export const Betrag = ({ ct, fett }: { ct: number; fett?: boolean }) => {
  const s = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(ct / 100);
  return <span className={ct < 0 ? 'negativ' : undefined}>{fett ? <b>{s}</b> : s}</span>;
};

// Account balance in bookkeeping notation: debit balances get "S", credit balances "H".
export const Saldo = ({ ct, fett }: { ct: number; fett?: boolean }) => {
  const s = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(ct) / 100);
  const t = ct === 0 ? '0,00' : `${s} ${ct > 0 ? 'S' : 'H'}`;
  return fett ? <b>{t}</b> : <>{t}</>;
};

// ---------- Detail pages ----------
export const initialen = (name: string) => {
  const [nach, vor] = name.split(',').map((s) => s.trim());
  const teile = vor ? [vor, nach] : name.split(/\s+/);
  return teile.filter(Boolean).map((t) => t[0]).join('').slice(0, 2).toUpperCase() || '?';
};

// Head of a detail page: picture or initials, kind of record, title, key facts as chips, actions on the right.
export function DetailKopf(props: { bild?: ReactNode; eyebrow?: ReactNode; titel: ReactNode; chips?: ReactNode; aktionen?: ReactNode }) {
  return (
    <div className="detailkopf">
      {props.bild && <div className="detailbild">{props.bild}</div>}
      <div className="detailtext">
        {props.eyebrow && <div className="eyebrow">{props.eyebrow}</div>}
        <h1>{props.titel}</h1>
        {props.chips && <div className="chips">{props.chips}</div>}
      </div>
      {props.aktionen && <div className="detailaktionen">{props.aktionen}</div>}
    </div>
  );
}

// Tabs drawn as an underlined row below a detail head.
export function Reiter<T extends string>(props: { tabs: [T, string, number?][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="reiter" role="tablist">
      {props.tabs.map(([t, l, n]) => (
        <button key={t} role="tab" aria-selected={props.value === t} onClick={() => props.onChange(t)}>
          {l}{n ? <span className="anzahl">{n}</span> : null}
        </button>
      ))}
    </div>
  );
}

export const Chip = (props: { art?: 'rot' | 'gelb' | 'gruen' | 'akzent' | 'miete' | 'weg'; children: ReactNode; title?: string }) =>
  <span className={`chip${props.art ? ' ' + props.art : ''}`} title={props.title}>{props.children}</span>;

// Empty state: says what is missing and offers the next step.
export function Leer(props: { text: ReactNode; aktion?: ReactNode }) {
  return <div className="leerzustand"><p>{props.text}</p>{props.aktion}</div>;
}

// ---------- Sortable tables ----------
export type Sortierung = { key: string; ab: boolean } | null;

// Sorts rows by a column; numbers and dates compare as such, text alphabetically (German).
export function sortiere<T extends Row>(rows: T[] | undefined, s: Sortierung, wert?: (r: T, key: string) => unknown): T[] {
  if (!rows) return [];
  if (!s) return rows;
  const w = wert ?? ((r: T, k: string) => r[k]);
  const out = [...rows].sort((a, b) => {
    const x = w(a, s.key), y = w(b, s.key);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y), 'de', { numeric: true, sensitivity: 'base' });
  });
  return s.ab ? out.reverse() : out;
}

export function SortTh(props: { k: string; s: Sortierung; set: (s: Sortierung) => void; children: ReactNode; className?: string }) {
  const aktiv = props.s?.key === props.k;
  return (
    <th className={`sortierbar${props.className ? ' ' + props.className : ''}${aktiv ? ' aktiv' : ''}`}
      onClick={() => props.set(aktiv ? (props.s!.ab ? null : { key: props.k, ab: true }) : { key: props.k, ab: false })}
      aria-sort={aktiv ? (props.s!.ab ? 'descending' : 'ascending') : undefined}>
      {props.children}<span className="pfeil">{aktiv ? (props.s!.ab ? '▾' : '▴') : ''}</span>
    </th>
  );
}

// Keeps an error on one page from blanking the whole window: the page shows the error, sidebar and navigation keep
// working. Keyed by the page, so going elsewhere starts afresh.
export class Fehlergrenze extends Component<{ children: ReactNode }, { fehler: Error | null }> {
  state = { fehler: null as Error | null };
  static getDerivedStateFromError(fehler: Error) { return { fehler }; }
  componentDidCatch(fehler: Error) { console.error('Seite abgestürzt', fehler); }
  render() {
    if (!this.state.fehler) return this.props.children;
    return (
      <div className="leer ablagezone">
        <p><b>Diese Seite konnte nicht angezeigt werden.</b></p>
        <p className="hinweis">{String(this.state.fehler.message ?? this.state.fehler)}</p>
        <div className="buttons" style={{ justifyContent: 'center' }}>
          <button onClick={() => this.setState({ fehler: null })}>Erneut versuchen</button>
          <button onClick={() => location.reload()}>Programm neu laden</button>
        </div>
      </div>
    );
  }
}
