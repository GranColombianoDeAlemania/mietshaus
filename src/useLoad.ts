import { useCallback, useEffect, useState } from 'react';
import { fehler } from './api';

// Loads data whenever deps change; returns the data and a reload function.
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): [T | undefined, () => void] {
  const [data, setData] = useState<T>();
  const [tick, setTick] = useState(0);
  // Reload when data changed elsewhere (document analysed, Claude Desktop wrote something).
  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener('hv-daten', h);
    return () => window.removeEventListener('hv-daten', h);
  }, []);
  useEffect(() => {
    let aktiv = true;
    // A failed load says why (a lost connection only turns the light red, a lapsed login leads to the sign-in).
    load().then((d) => { if (aktiv) setData(d); }, (e) => { if (aktiv && ![0, 401].includes(e?.status)) fehler(e); });
    return () => {
      aktiv = false;
    };
  }, [...deps, tick]);
  return [data, useCallback(() => setTick((t) => t + 1), [])];
}
