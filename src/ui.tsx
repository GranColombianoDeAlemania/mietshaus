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
