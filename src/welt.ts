// The two worlds of Mietshaus (electron/welt.cjs): „Privat“ – the rented houses with one's own projects and money – and
// „WEG“ – the managed owners' associations with the management business's projects and money. The world being worked in
// goes with every request (header X-Welt); the server shows and links only records of that world.
export type Welt = 'privat' | 'weg';
export const WELT_NAME: Record<Welt, string> = { privat: 'Privat', weg: 'WEG' };

const lesen = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

let welt: Welt = lesen('welt') === 'weg' ? 'weg' : 'privat';
// Set for one call that looks at both worlds (the tasks and the calendar with „Alle“); read synchronously when sending.
let beideFuerAufruf = false;

export const aktuelleWelt = () => welt;
// Set by the app whenever the place changes, before the pages load their data.
export const weltSetzen = (w: Welt) => { welt = w; };
// The header for a request: the world, or „beide“ for a call that looks at both.
export const weltKopf = (): Record<string, string> => ({ 'X-Welt': beideFuerAufruf ? 'beide' : welt });
// Runs one call across both worlds: fn must start its request synchronously (window.hv.call does).
export function inBeidenWelten<T>(fn: () => Promise<T>): Promise<T> {
  beideFuerAufruf = true;
  try { return fn(); } finally { beideFuerAufruf = false; }
}
// A call about a row shown in the view of both worlds (tasks): one of the other world goes without a world, so the
// server does not refuse it as foreign (its links are still checked).
const fremd = (row?: { welt?: unknown } | null) => (row?.welt === 'privat' || row?.welt === 'weg') && row.welt !== welt;
export const fuerZeile = <T,>(row: { welt?: unknown } | null | undefined, fn: () => Promise<T>): Promise<T> => (fremd(row) ? inBeidenWelten(fn) : fn());
// The world of a house by its kind (a mixed house lies in both: null).
export const weltVonArt = (art?: string | null): Welt | null => (art === 'weg' ? 'weg' : art === 'miete' ? 'privat' : null);
