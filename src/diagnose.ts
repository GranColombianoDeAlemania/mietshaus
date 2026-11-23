// What was going on before a fault is noted in Jago: the last error messages and pages of this window. Kept in memory
// only; it leaves the device only with a note the user saves (and can switch off there).
type Eintrag = { zeit: string; text: string };
const fehlerListe: Eintrag[] = [];
const wege: string[] = [];
const uhrzeit = () => new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function fehlerMerken(fehler: unknown) {
  const text = String((fehler as { message?: string } | null)?.message ?? fehler ?? '').trim().slice(0, 300);
  if (!text) return;
  fehlerListe.push({ zeit: uhrzeit(), text });
  if (fehlerListe.length > 20) fehlerListe.shift();
}
export function seiteMerken(seite: string) {
  if (wege.at(-1) === seite) return;
  wege.push(seite);
  if (wege.length > 8) wege.shift();
}
export const letzteSeite = () => wege.at(-1) ?? null;
export const letzteFehler = () => [...fehlerListe];

// "Mozilla/5.0 (iPhone; …) … Safari" → "iPhone · Safari"
export function geraetName(ua?: string | null) {
  if (!ua) return '–';
  const system = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Gerät';
  const programm = /Electron|Mietshaus/.test(ua) ? 'Mietshaus-App' : /Edg\//.test(ua) ? 'Edge' : /Firefox/.test(ua) ? 'Firefox' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Browser';
  return `${system} · ${programm}`;
}

export const diagnose = () => ({
  geraet: geraetName(navigator.userAgent), bildschirm: `${innerWidth}×${innerHeight}`, online: navigator.onLine,
  wege: [...wege], fehler: [...fehlerListe],
});

if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => fehlerMerken(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => fehlerMerken(e.reason));
}
