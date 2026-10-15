// Display preferences per computer: colour theme (system / light / dark) and text size.
const lesen = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const schreiben = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

export type Thema = 'system' | 'hell' | 'dunkel';
export const SCHRIFTGROESSEN: [number, string][] = [[0.9, 'Klein'], [1, 'Normal'], [1.15, 'Groß'], [1.3, 'Sehr groß']];

const dunkelSystem = window.matchMedia('(prefers-color-scheme: dark)');

export function anzeigeAnwenden() {
  const thema = (lesen('thema') as Thema) ?? 'system';
  const dunkel = thema === 'dunkel' || (thema === 'system' && dunkelSystem.matches);
  document.documentElement.dataset.thema = dunkel ? 'dunkel' : 'hell';
  window.hv?.zoom(Number(lesen('schrift')) || 1);
}
dunkelSystem.addEventListener('change', anzeigeAnwenden);

export const anzeige = {
  thema: (): Thema => (lesen('thema') as Thema) ?? 'system',
  schrift: () => Number(lesen('schrift')) || 1,
  setzeThema: (t: Thema) => { schreiben('thema', t); anzeigeAnwenden(); },
  setzeSchrift: (f: number) => { schreiben('schrift', String(f)); anzeigeAnwenden(); },
};
