import { useCallback, useEffect, useState } from 'react';

// Loads data whenever deps change; returns the data and a reload function.
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): [T | undefined, () => void] {
  const [data, setData] = useState<T>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let aktiv = true;
    load().then((d) => aktiv && setData(d));
    return () => {
      aktiv = false;
    };
  }, [...deps, tick]);
  return [data, useCallback(() => setTick((t) => t + 1), [])];
}
