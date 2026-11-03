import { useCallback } from 'react';
import { keepPreviousData, QueryClient, useQuery } from '@tanstack/react-query';
import { fehler } from './api';

// One cache for all loaded data (TanStack Query): a page opened again shows what it had at once and refreshes in the
// background; a change elsewhere (server event, own save) refreshes what is on screen.
export const datenCache = new QueryClient({
  defaultOptions: { queries: { staleTime: 0, gcTime: 30 * 60_000, retry: false, refetchOnWindowFocus: false } },
});
if (typeof window !== 'undefined') {
  window.addEventListener('hv-daten', () => { datenCache.invalidateQueries(); });
  // Signing out leaves nothing of the previous user's data behind.
  window.addEventListener('hv-abgemeldet', () => { datenCache.clear(); });
}

// Loads data whenever deps change; returns the data and a reload function. The cache key is the loader's source and
// its deps, so every loader must list what it reads in deps (as before).
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): [T | undefined, () => void] {
  const q = useQuery<T>({
    queryKey: ['laden', load.toString(), JSON.stringify(deps)],
    // A failed load says why (a lost connection only turns the light red, a lapsed login leads to the sign-in).
    queryFn: () => load().catch((e) => { if (![0, 401].includes(e?.status)) fehler(e); throw e; }),
    // While new deps load, the previous result stays on screen (no flicker).
    placeholderData: keepPreviousData,
  });
  const { refetch } = q;
  return [q.data, useCallback(() => { refetch(); }, [refetch])];
}
