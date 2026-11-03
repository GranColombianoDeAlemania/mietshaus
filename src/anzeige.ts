// Display preferences per computer: colour theme (system / light / dark), text size, the glass effect and the kind of
// symbols. Changes are announced with the event 'hv-anzeige', so open views follow at once.
import { useSyncExternalStore } from 'react';

const lesen = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const schreiben = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

export type Thema = 'system' | 'hell' | 'dunkel';
export type Glas = 'auto' | 'an' | 'aus';
export type SymbolStil = 'illustriert' | 'schlicht';
export const SCHRIFTGROESSEN: [number, string][] = [[0.9, 'Klein'], [1, 'Normal'], [1.15, 'Groß'], [1.3, 'Sehr groß']];

const dunkelSystem = window.matchMedia('(prefers-color-scheme: dark)');
// "Reduce transparency" on the iPhone or Mac: no glass in automatic mode.
const wenigerTransparenz = window.matchMedia('(prefers-reduced-transparency: reduce)');

export function anzeigeAnwenden() {
  const thema = (lesen('thema') as Thema) ?? 'system';
  const dunkel = thema === 'dunkel' || (thema === 'system' && dunkelSystem.matches);
  const glas = (lesen('glas') as Glas) ?? 'auto';
  const wurzel = document.documentElement.dataset;
  wurzel.thema = dunkel ? 'dunkel' : 'hell';
  wurzel.glas = glas === 'an' || (glas === 'auto' && !wenigerTransparenz.matches) ? 'an' : 'aus';
  wurzel.symbole = lesen('symbole') === 'schlicht' ? 'schlicht' : 'illustriert';
  window.hv?.zoom(Number(lesen('schrift')) || 1);
  window.dispatchEvent(new Event('hv-anzeige'));
}
dunkelSystem.addEventListener('change', anzeigeAnwenden);
wenigerTransparenz.addEventListener('change', anzeigeAnwenden);

export const anzeige = {
  thema: (): Thema => (lesen('thema') as Thema) ?? 'system',
  schrift: () => Number(lesen('schrift')) || 1,
  glas: (): Glas => (lesen('glas') as Glas) ?? 'auto',
  symbole: (): SymbolStil => (lesen('symbole') === 'schlicht' ? 'schlicht' : 'illustriert'),
  setzeThema: (t: Thema) => { schreiben('thema', t); anzeigeAnwenden(); },
  setzeSchrift: (f: number) => { schreiben('schrift', String(f)); anzeigeAnwenden(); },
  setzeGlas: (g: Glas) => { schreiben('glas', g); anzeigeAnwenden(); },
  setzeSymbole: (s: SymbolStil) => { schreiben('symbole', s); anzeigeAnwenden(); },
};

const abonnieren = (fn: () => void) => { window.addEventListener('hv-anzeige', fn); return () => window.removeEventListener('hv-anzeige', fn); };
// The symbol kind in effect, re-rendering when it changes.
export const useSymbolStil = () => useSyncExternalStore(abonnieren, () => document.documentElement.dataset.symbole ?? 'illustriert');
