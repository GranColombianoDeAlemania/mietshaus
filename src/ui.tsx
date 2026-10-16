// Small shared UI pieces.
import type { ReactNode } from 'react';
import { KLASSEN, kontoLabel, type Row } from './api';

export function KontoSelect(props: {
  konten: Row[];
  value: number | '' | null;
  onChange: (id: number | '') => void;
  klassen?: string[];
  leer?: string;
}) {
  const gruppen = Object.keys(KLASSEN).filter((k) => !props.klassen || props.klassen.includes(k));
  return (
    <select value={props.value ?? ''} onChange={(e) => props.onChange(e.target.value ? Number(e.target.value) : '')}>
      <option value="">{props.leer ?? '– Konto wählen –'}</option>
      {gruppen.map((g) => {
        const ks = props.konten.filter((k) => k.klasse === g && !k.inaktiv);
        return ks.length ? (
          <optgroup key={g} label={KLASSEN[g]}>
            {ks.map((k) => <option key={k.id} value={k.id}>{kontoLabel(k)}</option>)}
          </optgroup>
        ) : null;
      })}
    </select>
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
