// The bridge between the user interface and the Mietshaus server: the same window.hv the views always used, now over
// HTTP (fetch, Server-Sent Events) – in a browser and in the Mac app alike. What only a desktop can do (PDF files,
// native menus and save dialogs, Claude Desktop) comes from window.hvDesktop, which the Mac app's preload provides;
// a browser gets an equivalent (print dialog, download, its own small menu).
import type { Row } from './api';
import { frage } from './frage';

type DateiFilter = { name: string; extensions: string[] };
type MenueEintrag = { id: string; label: string; enabled?: boolean } | '-';

export type Update = { version: string; url: string; notizen: string; hindernis: string | null };

// What the Mac app adds (electron/preload.cjs).
export type Desktop = {
  plattform: string;
  geraet: { id: string; name: string };
  lokal: boolean;
  version: string;
  schnittstelle: number;
  updateStatus: () => Promise<Update | null>;
  updateInstallieren: () => Promise<void>;
  zoom: (faktor: number) => void;
  pdfBytes: (html: string) => Promise<Uint8Array>;
  speichern: (inhalt: string | Uint8Array, name: string, filter?: DateiFilter, oeffnen?: boolean) => Promise<string | null>;
  dateiOeffnen: (url: string, name: string) => Promise<string>;
  extern: (url: string) => Promise<void>;
  kontextmenue: (eintraege: MenueEintrag[]) => Promise<string | null>;
  ordnerWaehlen: () => Promise<string | null>;
  ordnerZeigen: (pfad: string) => Promise<void>;
  claudeStatus: () => Promise<Row>;
  claudeVerbinden: (token?: string) => Promise<Row>;
  verbindung: () => Promise<{ art: 'lokal' | 'server'; adresse: string | null }>;
  verbindungSetzen: (art: 'lokal' | 'server', adresse?: string) => Promise<void>;
  datenUebertragen: () => Promise<{ dateien: number }>;
  bei: (kanal: string, fn: (...a: any[]) => void) => () => void;
};
declare global {
  interface Window { hvDesktop?: Desktop }
}

export class HttpFehler extends Error {
  constructor(public status: number, text: string, public konflikt?: { wer: string; wann: string }) { super(text); }
}
// An error the user already knows about (e.g. chose not to overwrite): fehler() shows nothing for it.
export class StillerFehler extends Error { still = true; }

const desktop = () => window.hvDesktop;
const lesen = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const schreiben = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };
const zufall = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

// This window (its own changes do not come back as events) and this device (named in the change log).
const CLIENT = zufall();
const geraet = () => desktop()?.geraet ?? (() => {
  let id = lesen('geraet');
  if (!id) { id = `browser-${zufall()}`; schreiben('geraet', id); }
  return { id, name: 'Browser' };
})();

// ---------- connection state (traffic light) ----------
export type Verbindung = {
  strom: 'verbindet' | 'offen' | 'weg'; // the event stream
  wegSeit: number | null;               // since when the stream or the network has been gone
  offen: number;                        // requests under way
  latenz: number | null;                // last request, ms
  puls: { zeit: string; version: string; analyse: number; letzte: { zeit: string; wer: string | null } | null } | null;
  pulsAm: number | null;
};
const zustand: Verbindung = { strom: 'verbindet', wegSeit: null, offen: 0, latenz: null, puls: null, pulsAm: null };
const beobachter = new Set<(v: Verbindung) => void>();
const melden = () => { for (const fn of beobachter) fn({ ...zustand }); };
export function verbindungBeobachten(fn: (v: Verbindung) => void) {
  beobachter.add(fn);
  fn({ ...zustand });
  ereignisse();
  return () => { beobachter.delete(fn); };
}
// Red: stream or network gone for more than 5 seconds, or no sign of life for 40 seconds.
export const farbe = (v: Verbindung, jetzt = Date.now()): 'gruen' | 'gelb' | 'rot' =>
  (v.wegSeit != null && jetzt - v.wegSeit > 5000) || (v.pulsAm != null && jetzt - v.pulsAm > 40_000) ? 'rot'
    : v.strom !== 'offen' || v.offen > 0 || (v.puls?.analyse ?? 0) > 0 ? 'gelb' : 'gruen';
export const neuVerbinden = () => { quelle?.close(); quelle = null; zustand.strom = 'verbindet'; melden(); ereignisse(); };

export async function anfrage(pfad: string, opt: { methode?: string; json?: unknown; roh?: BodyInit; typ?: string; kopf?: Record<string, string> } = {}) {
  const methode = opt.methode ?? (opt.json !== undefined || opt.roh !== undefined ? 'POST' : 'GET');
  const start = performance.now();
  zustand.offen++;
  melden();
  let r: Response;
  try {
    r = await fetch(pfad, {
    method: methode, credentials: 'same-origin',
    headers: { 'X-Mietshaus': '1', 'X-Client': CLIENT, 'X-Geraet': geraet().id, ...opt.kopf,
      ...(opt.json !== undefined ? { 'Content-Type': 'application/json' } : opt.typ ? { 'Content-Type': opt.typ } : {}) },
    body: opt.json !== undefined ? JSON.stringify(opt.json) : opt.roh,
    });
  } catch {
    // The server cannot be reached: the light turns red, nothing pretends to be saved.
    zustand.wegSeit ??= Date.now();
    throw new HttpFehler(0, 'Keine Verbindung zum Mietshaus-Server. Die Änderung wurde nicht gespeichert.');
  } finally {
    zustand.offen--;
    melden();
  }
  zustand.latenz = Math.round(performance.now() - start);
  if (zustand.strom === 'offen') zustand.wegSeit = null;
  melden();
  if (!r.ok) {
    let text = `Fehler ${r.status}`;
    let konflikt;
    try { const j = await r.json(); text = j.fehler ?? text; konflikt = j.konflikt; } catch {}
    if (r.status === 401) window.dispatchEvent(new Event('hv-abgemeldet'));
    throw new HttpFehler(r.status, text, konflikt);
  }
  return r;
}
const jsonVon = async (pfad: string, json?: unknown) => (await anfrage(pfad, json === undefined ? {} : { json })).json();

// ---------- events ----------
const hoerer = new Map<string, Set<(...a: any[]) => void>>();
let quelle: EventSource | null = null;
function ereignisse() {
  if (quelle) return;
  quelle = new EventSource(`/api/ereignisse?client=${encodeURIComponent(CLIENT)}`);
  quelle.addEventListener('puls', (e) => {
    zustand.puls = JSON.parse((e as MessageEvent).data);
    zustand.pulsAm = Date.now();
    melden();
  });
  for (const kanal of ['aktualisiert', 'dokumentAnalysiert', 'meldung']) {
    quelle.addEventListener(kanal, (e) => {
      const wert = JSON.parse((e as MessageEvent).data ?? 'null');
      for (const fn of hoerer.get(kanal) ?? []) fn(wert);
    });
  }
  // After a lost connection (NAS restarted, laptop asleep) everything is reloaded once it is back.
  let weg = false;
  quelle.onerror = () => {
    weg = true;
    zustand.strom = quelle?.readyState === EventSource.CLOSED ? 'weg' : 'verbindet';
    zustand.wegSeit ??= Date.now();
    melden();
    // A closed stream (e.g. the server answered with an error) does not retry by itself.
    if (zustand.strom === 'weg') setTimeout(() => { if (zustand.strom === 'weg') neuVerbinden(); }, 10_000);
  };
  quelle.onopen = () => {
    zustand.strom = 'offen';
    zustand.wegSeit = null;
    melden();
    if (weg) { weg = false; for (const fn of hoerer.get('aktualisiert') ?? []) fn(null); }
  };
}

// ---------- browser stand-ins ----------
function herunterladen(inhalt: BlobPart, name: string, typ = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([inhalt], { type: typ }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
async function speichern(inhalt: string | Uint8Array, name: string, filter?: DateiFilter, oeffnen = false) {
  const d = desktop();
  if (d) return d.speichern(inhalt, name, filter, oeffnen);
  herunterladen(inhalt as BlobPart, name);
  return name;
}

// Hidden file input, resolved with the chosen files (an empty list when cancelled).
export function dateienWaehlen(opt: { mehrere?: boolean; endungen?: string[] } = {}): Promise<File[]> {
  return new Promise((ok) => {
    const i = Object.assign(document.createElement('input'), { type: 'file', multiple: !!opt.mehrere });
    if (opt.endungen?.length) i.accept = opt.endungen.map((e) => `.${e}`).join(',');
    i.style.display = 'none';
    i.onchange = () => { ok([...(i.files ?? [])]); i.remove(); };
    i.addEventListener('cancel', () => { ok([]); i.remove(); });
    document.body.append(i);
    i.click();
  });
}

// Small context menu for browsers, at the spot of the last right-click.
let zeiger = { x: 100, y: 100 };
window.addEventListener('contextmenu', (e) => { zeiger = { x: e.clientX, y: e.clientY }; }, true);
window.addEventListener('mousedown', (e) => { zeiger = { x: e.clientX, y: e.clientY }; }, true);
function webMenue(eintraege: MenueEintrag[]): Promise<string | null> {
  return new Promise((ok) => {
    const menue = document.createElement('div');
    menue.className = 'webmenue';
    menue.setAttribute('role', 'menu');
    const zu = (wert: string | null) => { menue.remove(); document.removeEventListener('mousedown', aussen, true); document.removeEventListener('keydown', taste, true); ok(wert); };
    const aussen = (e: MouseEvent) => { if (!menue.contains(e.target as Node)) zu(null); };
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') zu(null); };
    for (const x of eintraege) {
      if (x === '-') { menue.append(Object.assign(document.createElement('hr'))); continue; }
      const b = Object.assign(document.createElement('button'), { textContent: x.label, disabled: x.enabled === false });
      b.setAttribute('role', 'menuitem');
      b.onclick = () => zu(x.id);
      menue.append(b);
    }
    document.body.append(menue);
    const r = menue.getBoundingClientRect();
    menue.style.left = `${Math.min(zeiger.x, innerWidth - r.width - 8)}px`;
    menue.style.top = `${Math.min(zeiger.y, innerHeight - r.height - 8)}px`;
    setTimeout(() => { document.addEventListener('mousedown', aussen, true); document.addEventListener('keydown', taste, true); });
  });
}

// Browser: the letter opens in a new tab with the print dialog (save as PDF, on the iPhone through "Share").
function drucken(html: string) {
  const url = URL.createObjectURL(new Blob([html.replace('</body>', '<script>addEventListener("load",()=>setTimeout(()=>print(),300))</script></body>')], { type: 'text/html' }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

const absatz = (t: string) => <p>{t}</p>;

const base64 = async (f: File) => {
  const b = new Uint8Array(await f.arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

async function hochladen(files: FileList | File[], opt: Row = {}) {
  const ergebnis: { id: number; doppelt: boolean; name: string }[] = [];
  for (const f of [...files]) {
    const r = await anfrage(`/api/hochladen?name=${encodeURIComponent(f.name)}&opt=${encodeURIComponent(JSON.stringify(opt))}`, { roh: f, typ: 'application/octet-stream' });
    ergebnis.push(...(await r.json()));
  }
  return ergebnis;
}

// Fetches a download (backup, tax package) and saves it like the desktop would.
async function speichernVon(r: Response, vorschlag: string, filter?: DateiFilter) {
  const name = /filename\*=UTF-8''([^;]+)/.exec(r.headers.get('content-disposition') ?? '')?.[1];
  return speichern(new Uint8Array(await r.arrayBuffer()), name ? decodeURIComponent(name) : vorschlag, filter);
}

export function brueckeEinrichten() {
  const d = desktop();
  window.hv = {
    plattform: d?.plattform ?? 'web',
    zoom: (f) => (d ? d.zoom(f) : void (document.documentElement.style.zoom = String(f))),
    call: async (fn, ...args) => {
      try {
        return (await jsonVon('/api/call', { fn, args })).wert;
      } catch (e) {
        if (!(e instanceof HttpFehler) || !e.konflikt) throw e;
        // Someone else changed the record meanwhile: overwrite on purpose, or keep theirs and see it.
        const wahl = await frage({ titel: 'Inzwischen geändert', text: <>{absatz(e.message)}{absatz('Deine Änderung überschreibt seine. Wenn du abbrichst, siehst du den neuen Stand und kannst deine Änderung dort noch einmal eintragen.')}</>,
          optionen: [{ id: 'neu', label: 'Abbrechen, neuen Stand zeigen' }, { id: 'ueber', label: 'Meine Änderung speichern', primary: true }] });
        if (wahl === 'ueber') return (await (await anfrage('/api/call', { json: { fn, args }, kopf: { 'X-Ueberschreiben': '1' } })).json()).wert;
        for (const h of hoerer.get('aktualisiert') ?? []) h(null);
        throw new StillerFehler('Nicht gespeichert.');
      }
    },
    pdf: async (html, name) => {
      if (!d) { drucken(html); return null; }
      return d.speichern(await d.pdfBytes(html), name, { name: 'PDF', extensions: ['pdf'] }, true);
    },
    pdfAblegen: async (html, name, meta) => {
      const pdf = d ? await d.pdfBytes(html) : null;
      const datei = pdf ? name : name.replace(/\.pdf$/i, '.html');
      const r = await anfrage(`/api/ablegen?name=${encodeURIComponent(datei)}&meta=${encodeURIComponent(JSON.stringify(meta ?? {}))}`,
        { roh: (pdf ?? html) as BodyInit, typ: pdf ? 'application/pdf' : 'text/html' });
      return r.json();
    },
    steuerpaket: async (objektId, jahr, html) => {
      const pdf = d ? await d.pdfBytes(html) : null;
      const r = await anfrage(`/api/steuerpaket?objekt=${objektId}&jahr=${jahr}`, { roh: (pdf ?? html) as BodyInit, typ: pdf ? 'application/pdf' : 'text/html' });
      const belege = Number(r.headers.get('x-belege')), buchungen = Number(r.headers.get('x-buchungen'));
      const datei = await speichernVon(r, `Steuerunterlagen ${jahr}.zip`, { name: 'ZIP-Archiv', extensions: ['zip'] });
      return datei ? { datei, belege, buchungen } : null;
    },
    speichern: (inhalt, name, filter) => speichern(inhalt, name, filter),
    oeffnen: async (filter) => {
      const [f] = await dateienWaehlen({ endungen: filter?.extensions });
      return f ? { name: f.name, base64: await base64(f) } : null;
    },
    sicherung: async () => speichernVon(await anfrage('/api/sicherung'), 'Mietshaus-Sicherung.sqlite', { name: 'Sicherung', extensions: ['sqlite'] }),
    // Restoring is a dialog in the settings (see Einstellungen.tsx: sicherungEinspielen); the old entry stays for the menu.
    wiederherstellen: async () => null,
    sicherungsOrdnerOeffnen: async () => { const i = await jsonVon('/api/info'); if (d?.lokal) await d.ordnerZeigen(i.sicherungen); return i.sicherungen; },
    dokumentAblegen: async () => [],
    dokumentOeffnen: async (datei) => {
      const url = `/dateien/dokument/${encodeURIComponent(datei)}`;
      if (d) return d.dateiOeffnen(url, datei);
      window.open(url, '_blank');
      return datei;
    },
    dokumentLoeschen: async (id) => { await anfrage('/api/dokument-loeschen', { json: { id } }); },
    importieren: (files, opt) => hochladen(files, opt),
    dateienImportieren: async (opt) => {
      const files = await dateienWaehlen({ mehrere: true });
      return files.length ? hochladen(files, opt) : [];
    },
    neuAnalysieren: async (id) => { await anfrage('/api/neu-analysieren', { json: { id } }); },
    bei: (kanal, fn) => {
      if (kanal === 'navigation') return d?.bei('navigation', fn) ?? (() => {});
      ereignisse();
      if (!hoerer.has(kanal)) hoerer.set(kanal, new Set());
      hoerer.get(kanal)!.add(fn);
      return () => hoerer.get(kanal)?.delete(fn);
    },
    extern: async (url) => { if (d) await d.extern(url); else if (/^(mailto:|https:)/.test(url)) window.open(url, url.startsWith('mailto:') ? '_self' : '_blank'); },
    info: () => jsonVon('/api/info'),
    eingangsordnerWaehlen: async () => {
      const info = await jsonVon('/api/info');
      if (info.eingangsordner_fest) return info.eingangsordner;
      const pfad = d?.lokal ? await d.ordnerWaehlen() : window.prompt('Pfad des Eingangsordners auf dem Server, z. B. /eingang:', info.eingangsordner ?? '/eingang');
      if (!pfad) return null;
      return (await jsonVon('/api/eingangsordner', { pfad })).pfad;
    },
    eingangsordnerAus: async () => { await jsonVon('/api/eingangsordner', { pfad: null }); },
    mailSpeichern: (cfg, pw) => jsonVon('/api/mail/speichern', { cfg, pw }),
    mailTesten: async () => (await jsonVon('/api/mail/testen', {})).text,
    mailAbrufen: () => jsonVon('/api/mail/abrufen', {}),
    claudeStatus: async () => (d ? d.claudeStatus() : { datei: '', installiert: false, verbunden: false, eintrag: {} }) as any,
    claudeVerbinden: async () => {
      if (!d) throw new Error('Claude Desktop lässt sich nur aus der Mac-App verbinden.');
      // On the server Claude needs a token of its own (one per user); locally it opens the database directly.
      const token = d.lokal ? undefined : (await jsonVon('/api/call', { fn: 'claudeToken', args: [] })).wert;
      return d.claudeVerbinden(token) as any;
    },
    kontextmenue: (eintraege) => (d ? d.kontextmenue(eintraege) : webMenue(eintraege)),
  };
}

// Login state for the start screen.
export const status = (): Promise<{ modus: 'server' | 'lokal'; version: string; desktop_schnittstelle: number; angemeldet: boolean; benutzer: Row | null; einrichtung: boolean }> =>
  fetch('/api/status', { credentials: 'same-origin' }).then((r) => r.json());
export const anmelden = (login: string, passwort: string) => anfrage('/api/anmelden', { json: { login, passwort } }).then((r) => r.json());
export const einrichten = (login: string, name: string, passwort: string) => anfrage('/api/einrichten', { json: { login, name, passwort } }).then((r) => r.json());
export const abmelden = () => anfrage('/api/abmelden', { json: {} });
