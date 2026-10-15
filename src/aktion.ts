// Intents from the command palette: the palette stores one, the opened page picks it up once.
import { useEffect } from 'react';

export const aktionSetzen = (name: string) => { try { sessionStorage.setItem('aktion', name); } catch {} };

export function useAktion(name: string, fn: () => void) {
  useEffect(() => {
    try {
      if (sessionStorage.getItem('aktion') !== name) return;
      sessionStorage.removeItem('aktion');
    } catch { return; }
    fn();
  }, []);
}
