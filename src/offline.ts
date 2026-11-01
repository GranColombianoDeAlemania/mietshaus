// Reading without a connection: answers of reading calls (the server marks them with X-Lesend) are kept in this
// browser's IndexedDB, per user. Without a connection the last kept answer is shown; saving still fails. Everything is
// deleted when the user logs out or someone else logs in on this device.
const DB = 'mietshaus-offline';
const MAX = 3000; // answers kept; the oldest go first
let offen: Promise<IDBDatabase> | null = null;
let schreibZaehler = 0;

function oeffnen() {
  offen ??= new Promise((ok, nein) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('antworten', { keyPath: 'k' }).createIndex('zeit', 'zeit');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => nein(r.error);
  });
  return offen;
}
const vorgang = async <T>(modus: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
  const s = (await oeffnen()).transaction('antworten', modus).objectStore('antworten');
  return new Promise((ok, nein) => {
    const r = fn(s);
    if (!r) { s.transaction.oncomplete = () => ok(undefined); s.transaction.onerror = () => nein(s.transaction.error); return; }
    r.onsuccess = () => ok(r.result);
    r.onerror = () => nein(r.error);
  });
};

const lesen = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const schreiben = (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} };

let benutzer: string | null = lesen('offline_benutzer');
const schluessel = (fn: string, args: unknown[]) => `${benutzer}|${fn}|${JSON.stringify(args)}`;

// Called with each status of the server: another user on this device empties the store first.
export async function benutzerSetzen(id: string | null, status?: unknown) {
  if (id && benutzer && id !== benutzer) await leeren();
  benutzer = id;
  schreiben('offline_benutzer', id);
  if (status) schreiben('offline_status', JSON.stringify(status));
}
export const letzterStatus = () => { try { return JSON.parse(lesen('offline_status') ?? 'null'); } catch { return null; } };

export async function merken(fn: string, args: unknown[], wert: unknown) {
  if (!benutzer) return;
  try {
    await vorgang('readwrite', (s) => s.put({ k: schluessel(fn, args), wert, zeit: Date.now() }));
    if (++schreibZaehler % 100 === 0) aufraeumen();
  } catch { /* full or blocked: then there is simply no offline copy */ }
}

export async function holen(fn: string, args: unknown[]): Promise<{ wert: unknown; zeit: number } | null> {
  if (!benutzer) return null;
  try { return (await vorgang('readonly', (s) => s.get(schluessel(fn, args)))) ?? null; } catch { return null; }
}

export async function leeren() {
  schreiben('offline_status', null);
  try { await vorgang('readwrite', (s) => s.clear()); } catch {}
}

async function aufraeumen() {
  const n = (await vorgang('readonly', (s) => s.count())) ?? 0;
  if (n <= MAX) return;
  let weg = n - MAX;
  const s = (await oeffnen()).transaction('antworten', 'readwrite').objectStore('antworten');
  s.index('zeit').openCursor().onsuccess = (e) => {
    const c = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
    if (c && weg-- > 0) { c.delete(); c.continue(); }
  };
}
