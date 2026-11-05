// Working without a connection: changes (and photos or files) that cannot reach the server are kept in this device's
// IndexedDB and sent later, in their order, each with its key – the server does every change only once (table
// vorgangsschluessel). New records get a provisional number (-1000001, -1000002 …); later changes that refer to it are
// rewritten to the real number when sending. Nothing is dropped silently: logging out keeps the entries, a conflict
// or an error stops the sending and waits for the user (send anyway, or discard after asking).
const DB = 'mietshaus-ausgang';
const VORLAEUFIG_AB = -1_000_000;

export type Eintrag = {
  nr?: number;
  benutzer: string | null;
  zeit: number;
  art: 'call' | 'upload';
  fn?: string;
  args?: unknown[];
  kopf?: Record<string, string>;
  schluessel: string;
  vorlaeufig?: number | null;
  blob?: Blob;
  name?: string;
  opt?: Record<string, unknown>;
  titel: string;
  status: 'wartet' | 'konflikt' | 'fehler';
  meldung?: string;
  konflikt?: boolean;
  bestaetigen?: string;
};

// Calls that change data and may wait for the connection; everything else needs the server (or a kept answer).
const SCHREIBEND = new Set(['save', 'remove', 'dokumentSpeichern', 'dokumentZuordnen', 'vorgangStatus', 'vorgangKommentieren', 'aufgabeVerschieben',
  'hinweisSetzen', 'mitteilungGelesen', 'alleMitteilungenGelesen', 'ablesung', 'uebergabeSpeichern', 'begehungNeu', 'begehungSpeichern', 'begehungMangel',
  'begehungAbschliessen', 'pflichtenAnlegen', 'pflichtErledigen', 'ablaufStarten', 'buchen', 'belegBuchen', 'stapelAblegen', 'einkaufNeu', 'einkaufGekauft']);
// Calls that create a record and answer with its number.
const neueNummer = (fn: string, args: unknown[]) => (fn === 'save' && !(args[1] as { id?: unknown } | undefined)?.id)
  || ['begehungNeu', 'begehungMangel', 'ablaufStarten', 'buchen', 'einkaufNeu'].includes(fn);
export const schreibend = (fn: string) => SCHREIBEND.has(fn);
export const istVorlaeufig = (x: unknown) => typeof x === 'number' && x <= VORLAEUFIG_AB;

const TABELLE: Record<string, string> = { vorgaenge: 'Aufgabe', termine: 'Termin', zaehlerstaende: 'Zählerstand', inventar: 'Inventar', pflichten: 'Pflicht',
  personen: 'Person', dokumente: 'Dokument', vorgangseintraege: 'Eintrag', begehungen: 'Begehung', buchungen: 'Buchung' };
function titelVon(fn: string, args: unknown[]): string {
  const a = args as any[];
  if (fn === 'save') return `${TABELLE[a[0]] ?? a[0]}${a[1]?.titel ? ` „${a[1].titel}“` : ''} ${a[1]?.id ? 'geändert' : 'neu'}`;
  if (fn === 'remove') return `${TABELLE[a[0]] ?? a[0]} gelöscht`;
  return ({ vorgangStatus: 'Status einer Aufgabe', vorgangKommentieren: 'Kommentar', begehungSpeichern: 'Begehung', begehungNeu: 'Neue Begehung',
    begehungMangel: `Mangel „${a[2]?.text ?? ''}“`, begehungAbschliessen: 'Begehung abgeschlossen', ablesung: 'Zählerstände', pflichtErledigen: 'Pflicht erledigt',
    pflichtenAnlegen: 'Pflichten angelegt', dokumentSpeichern: 'Angaben zu einem Dokument', ablaufStarten: 'Ablauf gestartet', uebergabeSpeichern: 'Übergabeprotokoll',
    buchen: 'Buchung', belegBuchen: 'Beleg gebucht', einkaufNeu: `Einkauf „${a[1]?.titel ?? ''}“`, einkaufGekauft: 'Einkauf gekauft' } as Record<string, string>)[fn] ?? fn;
}

// ---------- storage ----------
let offen: Promise<IDBDatabase> | null = null;
function oeffnen() {
  offen ??= new Promise((ok, nein) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('eintraege', { keyPath: 'nr', autoIncrement: true });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => nein(r.error);
  });
  return offen;
}
async function vorgang<T>(modus: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const s = (await oeffnen()).transaction('eintraege', modus).objectStore('eintraege');
  return new Promise((ok, nein) => { const r = fn(s); r.onsuccess = () => ok(r.result); r.onerror = () => nein(r.error); });
}
const lesen = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const schreiben = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

// Provisional numbers and what they became: { "-1000001": { id: 42, datei: "…" } } – kept until nothing refers to them.
const ZUORDNUNG = 'ausgang_zuordnung';
const zuordnung = (): Record<string, { id: number; datei?: string | null }> => { try { return JSON.parse(lesen(ZUORDNUNG) ?? '{}'); } catch { return {}; } };
function zuordnen(vorl: number, id: number, datei?: string | null) { schreiben(ZUORDNUNG, JSON.stringify({ ...zuordnung(), [vorl]: { id, datei: datei ?? null } })); }
export function neueVorlaeufige() {
  const n = Math.min(Number(lesen('ausgang_naechste') ?? VORLAEUFIG_AB) - 1, VORLAEUFIG_AB - 1);
  schreiben('ausgang_naechste', String(n));
  return n;
}

// Replaces provisional numbers already known by the real ones – also inside objects ({ id, datei } of a photo).
export function umschreiben<T>(x: T, z = zuordnung()): T {
  if (istVorlaeufig(x)) return (z[String(x)]?.id ?? x) as T;
  if (Array.isArray(x)) return x.map((y) => umschreiben(y, z)) as T;
  if (x && typeof x === 'object' && !(x instanceof Blob)) {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) o[k] = umschreiben(v, z);
    const id = (x as Record<string, unknown>).id;
    if (istVorlaeufig(id) && z[String(id)] && 'datei' in o && !o.datei) o.datei = z[String(id)].datei ?? null;
    return o as T;
  }
  return x;
}

// ---------- state ----------
let benutzer: () => string | null = () => null;
let anzahl = 0;
const beobachter = new Set<(n: number, liste: Eintrag[]) => void>();
async function melden() {
  const l = await liste();
  anzahl = l.length;
  for (const b of beobachter) b(anzahl, l);
}
export const wartend = () => anzahl;
export function beobachten(fn: (n: number, liste: Eintrag[]) => void) { beobachter.add(fn); melden(); return () => { beobachter.delete(fn); }; }

export async function liste(): Promise<Eintrag[]> {
  try { return (await vorgang('readonly', (s) => s.getAll())).filter((e: Eintrag) => e.benutzer === benutzer()); } catch { return []; }
}

// Keeps a change for later; answers what the caller expects for now: a provisional number for a new record, else true.
export async function ablegen(e: Omit<Eintrag, 'zeit' | 'status' | 'titel' | 'benutzer' | 'vorlaeufig'> & { titel?: string }) {
  const vorlaeufig = e.art === 'upload' || neueNummer(e.fn!, e.args ?? []) ? neueVorlaeufige() : null;
  const eintrag: Eintrag = { ...e, benutzer: benutzer(), zeit: Date.now(), status: 'wartet', vorlaeufig, titel: e.titel ?? titelVon(e.fn!, e.args ?? []) };
  await vorgang('readwrite', (s) => s.add(eintrag));
  await melden();
  return vorlaeufig ?? true;
}

export async function verwerfen(nr: number) { await vorgang('readwrite', (s) => s.delete(nr)); await melden(); }
// After a conflict or a question of the server: send once more, overwriting or confirmed.
export async function trotzdem(nr: number) {
  const e = await vorgang<Eintrag>('readonly', (s) => s.get(nr));
  if (!e) return;
  const kopf = { ...(e.kopf ?? {}), ...(e.konflikt ? { 'X-Ueberschreiben': '1' } : {}), ...(e.bestaetigen ? { 'X-Bestaetigt': '1' } : {}) };
  await vorgang('readwrite', (s) => s.put({ ...e, kopf, status: 'wartet', meldung: undefined }));
  await melden();
  senden();
}

// ---------- sending ----------
type Wege = {
  rufen: (fn: string, args: unknown[], kopf: Record<string, string>, schluessel: string) => Promise<unknown>;
  hochladen: (blob: Blob, name: string, opt: Record<string, unknown>) => Promise<{ id: number; datei?: string | null }>;
  aktualisiert: () => void;
};
let wege: Wege | null = null;
let laeuft = false;

export function einrichten(w: Wege & { benutzer: () => string | null }) {
  wege = w;
  benutzer = w.benutzer;
  melden();
  window.addEventListener('online', () => senden());
  setInterval(() => { if (anzahl) senden(); }, 20_000);
}

// Sends what waits, oldest first. Without a connection it stops and tries again later; a conflict or an error stops it
// at that entry (marked), so nothing after it overtakes it.
export async function senden() {
  if (laeuft || !wege) return;
  laeuft = true;
  let gesendet = 0;
  try {
    for (;;) {
      const l = await liste();
      const e = l.sort((a, b) => a.nr! - b.nr!)[0];
      if (!e || e.status !== 'wartet') break;
      try {
        if (e.art === 'upload') {
          const r = await wege.hochladen(e.blob!, e.name!, umschreiben(e.opt ?? {}));
          if (e.vorlaeufig) zuordnen(e.vorlaeufig, r.id, r.datei);
        } else {
          const wert = await wege.rufen(e.fn!, umschreiben(e.args ?? []), e.kopf ?? {}, e.schluessel);
          if (e.vorlaeufig && typeof wert === 'number') zuordnen(e.vorlaeufig, wert);
        }
        await vorgang('readwrite', (s) => s.delete(e.nr!));
        gesendet++;
      } catch (x: any) {
        if (x?.status === 0) break;
        await vorgang('readwrite', (s) => s.put({ ...e, status: x?.konflikt || x?.bestaetigen ? 'konflikt' : 'fehler', meldung: String(x?.message ?? x),
          konflikt: !!x?.konflikt, bestaetigen: x?.bestaetigen }));
        break;
      }
    }
  } finally {
    laeuft = false;
    await melden();
    if (gesendet) wege.aktualisiert();
  }
}
