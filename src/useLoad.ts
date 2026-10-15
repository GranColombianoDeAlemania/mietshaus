import { useCallback, useEffect, useState } from 'react';

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
    load().then((d) => aktiv && setData(d));
    return () => {
      aktiv = false;
    };
  }, [...deps, tick]);
  return [data, useCallback(() => setTick((t) => t + 1), [])];
}
