export type Modus = 'miete' | 'weg';
export type Row = Record<string, any>;

declare global {
  interface Window {
    hv: { call: (fn: string, ...args: unknown[]) => Promise<any> };
  }
}

export const call = <T = any>(fn: string, ...args: unknown[]): Promise<T> => window.hv.call(fn, ...args);

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const num = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 });

export const euro = (ct: number | null | undefined) => eur.format((ct ?? 0) / 100);
export const zahl = (n: number | null | undefined) => (n == null ? '' : num.format(n));

export const datum = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

// Parses German input such as "1.234,56" or "1234.5".
export const parseZahl = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
};

export const personName = (p: Row) =>
  [p.nachname, p.vorname].filter(Boolean).join(', ') + (p.firma ? ` (${p.firma})` : '') || '(ohne Namen)';

export const OBJEKT_ART: Record<string, string> = {
  miete: 'Mietobjekt',
  weg: 'WEG',
  gemischt: 'Miet/WEG gemischt',
};
