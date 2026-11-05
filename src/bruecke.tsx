// The bridge between the user interface and the Mietshaus server: the same window.hv the views always used, now over
// HTTP (fetch, Server-Sent Events) – in a browser and in the Mac app alike. What only a desktop can do (PDF files,
// native menus and save dialogs, Claude Desktop) comes from window.hvDesktop, which the Mac app's preload provides;
// a browser gets an equivalent (print dialog, download, its own small menu).
import type { Row } from './api';
import { bestaetigen, frage } from './frage';
import * as offline from './offline';
import * as ausgang from './ausgang';

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
  paketErstellen: (p: { titel: string; anleitung: string; link: string }) => Promise<string | null>;
  bei: (kanal: string, fn: (...a: any[]) => void) => () => void;
};
declare global {
  interface Window { hvDesktop?: Desktop }
}

export class HttpFehler extends Error {
  constructor(public status: number, text: string, public konflikt?: { wer: string; wann: string }, public bestaetigen?: string) { super(text); }
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
  offline: number | null;               // without a connection: time of the oldest kept answer shown
};
const zustand: Verbindung = { strom: 'verbindet', wegSeit: null, offen: 0, latenz: null, puls: null, pulsAm: null, offline: null };
const beobachter = new Set<(v: Verbindung) => void>();
const melden = () => { for (const fn of beobachter) fn({ ...zustand }); };
export function verbindungBeobachten(fn: (v: Verbindung) => void) {
  beobachter.add(fn);
  fn({ ...zustand });
  ereignisse();
  return () => { beobachter.delete(fn); };
}
// Red: showing kept answers, stream or network gone for more than 5 seconds, or no sign of life for 40 seconds.
export const farbe = (v: Verbindung, jetzt = Date.now()): 'gruen' | 'gelb' | 'rot' =>
  v.offline != null || (v.wegSeit != null && jetzt - v.wegSeit > 5000) || (v.pulsAm != null && jetzt - v.pulsAm > 40_000) ? 'rot'
    : v.strom !== 'offen' || v.offen > 0 || (v.puls?.analyse ?? 0) > 0 ? 'gelb' : 'gruen';
// No connection right now (the outbox then keeps changes; reading shows kept answers, which may be older).
export const istOffline = () => zustand.wegSeit != null || zustand.offline != null;
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
    // The server cannot be reached: the light turns red. If the connection broke after sending, the server may have
    // saved it all the same – a blind second try would then create it twice.
    zustand.wegSeit ??= Date.now();
    throw new HttpFehler(0, methode === 'GET' ? 'Keine Verbindung zum Mietshaus-Server.'
      : 'Keine Verbindung zum Mietshaus-Server. Ob die Änderung gespeichert wurde, ist nicht sicher – bitte nach dem Wiederverbinden prüfen, bevor du es erneut versuchst.');
  } finally {
    zustand.offen--;
    melden();
  }
  zustand.latenz = Math.round(performance.now() - start);
  zustand.offline = null;
  if (zustand.strom === 'offen') zustand.wegSeit = null;
  melden();
  if (!r.ok) {
    let text = `Fehler ${r.status}`;
    let konflikt, bestaetigen;
    try { const j = await r.json(); text = j.fehler ?? text; konflikt = j.konflikt; bestaetigen = j.bestaetigen; } catch {}
    if (r.status === 401) window.dispatchEvent(new Event('hv-abgemeldet'));
    throw new HttpFehler(r.status, text, konflikt, bestaetigen);
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
  for (const kanal of ['aktualisiert', 'dokumentAnalysiert', 'meldung', 'benachrichtigung']) {
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
    if (ausgang.wartend()) ausgang.senden();
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
// kamera: the phone opens its camera directly (rear camera); elsewhere only images can be chosen.
export function dateienWaehlen(opt: { mehrere?: boolean; endungen?: string[]; kamera?: boolean } = {}): Promise<File[]> {
  return new Promise((ok) => {
    const i = Object.assign(document.createElement('input'), { type: 'file', multiple: !!opt.mehrere });
    if (opt.endungen?.length) i.accept = opt.endungen.map((e) => `.${e}`).join(',');
    if (opt.kamera) { i.accept = 'image/*'; i.setAttribute('capture', 'environment'); }
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
    // Inside an open window the menu belongs to it: a modal window blocks clicks on everything outside itself.
    ([...document.querySelectorAll('[role="dialog"]')].pop() ?? document.body).append(menue);
    const r = menue.getBoundingClientRect();
    menue.style.left = `${Math.min(zeiger.x, innerWidth - r.width - 8)}px`;
    menue.style.top = `${Math.min(zeiger.y, innerHeight - r.height - 8)}px`;
    setTimeout(() => { document.addEventListener('mousedown', aussen, true); document.addEventListener('keydown', taste, true); });
  });
}

// Browser: the letter opens in a new tab with the print dialog (save as PDF, on the iPhone through "Share").
// Safari (above all on the iPhone) blocks a new tab that does not open right on a tap; then a button opens it.
async function drucken(html: string) {
  const url = URL.createObjectURL(new Blob([html.replace('</body>', '<script>addEventListener("load",()=>setTimeout(()=>print(),300))</script></body>')], { type: 'text/html' }));
  setTimeout(() => URL.revokeObjectURL(url), 600_000);
  if (window.open(url, '_blank')) return;
  if (await frage({ titel: 'Dokument ist fertig', text: absatz('Es öffnet sich in einem neuen Tab. Dort „Teilen → Drucken“ oder „Als PDF sichern“ wählen.'),
    optionen: [{ id: 'nein', label: 'Abbrechen' }, { id: 'auf', label: 'Öffnen', primary: true }] }) === 'auf') window.open(url, '_blank');
}

const absatz = (t: string) => <p>{t}</p>;

const base64 = async (f: File) => {
  const b = new Uint8Array(await f.arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

const hochladenDirekt = async (f: Blob, name: string, opt: Row) =>
  (await anfrage(`/api/hochladen?name=${encodeURIComponent(name)}&opt=${encodeURIComponent(JSON.stringify(opt))}`, { roh: f, typ: 'application/octet-stream' })).json();
// Without a connection (or while changes wait) a file is kept on this device and sent later; until then it has a
// provisional number and a preview from the device.
async function hochladen(files: FileList | File[], opt0: Row = {}) {
  const opt = ausgang.umschreiben(opt0);
  const ergebnis: { id: number; doppelt: boolean; name: string; datei?: string | null; vorschau?: string; offline?: boolean }[] = [];
  for (const f of [...files]) {
    try {
      if (ausgang.wartend() > 0) throw new HttpFehler(0, 'wartet');
      ergebnis.push(...(await hochladenDirekt(f, f.name, opt)));
    } catch (e) {
      if (!(e instanceof HttpFehler) || e.status !== 0) throw e;
      const id = await ausgang.ablegen({ art: 'upload', blob: f, name: f.name, opt, schluessel: zufall(), titel: `Datei „${f.name}“` }) as number;
      ergebnis.push({ id, doppelt: false, name: f.name, datei: null, vorschau: URL.createObjectURL(f), offline: true });
      offlineGemerkt();
    }
  }
  return ergebnis;
}
// Said once a minute at most, not with every change.
let zuletztGesagt = 0;
function offlineGemerkt() {
  if (Date.now() - zuletztGesagt < 60_000) return;
  zuletztGesagt = Date.now();
  for (const fn of hoerer.get('meldung') ?? []) fn('Keine Verbindung – auf diesem Gerät gespeichert. Es wird übertragen, sobald der Server erreichbar ist (Ampel oben rechts).');
}

// Fetches a download (backup, tax package) and saves it like the desktop would.
async function speichernVon(r: Response, vorschlag: string, filter?: DateiFilter) {
  const name = /filename\*=UTF-8''([^;]+)/.exec(r.headers.get('content-disposition') ?? '')?.[1];
  return speichern(new Uint8Array(await r.arrayBuffer()), name ? decodeURIComponent(name) : vorschlag, filter);
}

// Every call carries a key. When the connection breaks, the same call goes again with the same key – a few times by
// itself, and later when the user saves the very same thing again – and the server does it only once.
const unklar = new Map<string, { schluessel: string; zeit: number }>();
async function aufrufSenden(fn: string, args: unknown[], kopf: Record<string, string> = {}) {
  const inhalt = JSON.stringify([fn, args, kopf]);
  const alt = unklar.get(inhalt);
  const schluessel = alt && Date.now() - alt.zeit < 10 * 60_000 ? alt.schluessel : zufall();
  for (let versuch = 0; ; versuch++) {
    try {
      const r = await anfrage('/api/call', { json: { fn, args }, kopf: { ...kopf, 'X-Vorgang': schluessel } });
      unklar.delete(inhalt);
      return r;
    } catch (e) {
      if (!(e instanceof HttpFehler) || e.status !== 0) { unklar.delete(inhalt); throw e; }
      unklar.set(inhalt, { schluessel, zeit: alt?.schluessel === schluessel ? alt.zeit : Date.now() });
      // A read with a kept answer shows that at once; anything else is tried again after 1, 2 and 4 seconds.
      // Offline for a while already (in the cellar, on the road): no waiting – the change goes into the outbox at once.
      const langeWeg = zustand.wegSeit != null && Date.now() - zustand.wegSeit > 10_000;
      if (versuch >= 3 || langeWeg || await offline.holen(fn, args)) {
        throw Object.assign(new HttpFehler(0, 'Keine Verbindung zum Mietshaus-Server. Ob die Änderung gespeichert wurde, ist nicht sicher. '
          + 'Speichere nach dem Wiederverbinden einfach noch einmal, ohne etwas zu ändern – es wird dann nicht doppelt angelegt.'), { schluessel });
      }
      await new Promise((ok) => setTimeout(ok, 1000 * 2 ** versuch));
    }
  }
}

export function brueckeEinrichten() {
  const d = desktop();
  ausgang.einrichten({
    benutzer: offline.aktuellerBenutzer,
    // Sending from the outbox goes straight to the server with the entry's key (no second queueing).
    rufen: async (fn, args, kopf, schluessel) => {
      const r = await anfrage('/api/call', { json: { fn, args }, kopf: { ...kopf, 'X-Vorgang': schluessel } });
      return (await r.json()).wert;
    },
    hochladen: async (blob, name, opt) => {
      const [r] = await hochladenDirekt(blob, name, opt);
      const d2 = await jsonVon('/api/call', { fn: 'dokument', args: [r.id] }).catch(() => null);
      return { id: r.id, datei: d2?.wert?.datei ?? null };
    },
    aktualisiert: () => { for (const fn of hoerer.get('aktualisiert') ?? []) fn(null); },
  });
  window.hv = {
    plattform: d?.plattform ?? 'web',
    zoom: (f) => (d ? d.zoom(f) : void (document.documentElement.style.zoom = String(f))),
    call: async (fn, ...args0) => {
      // Provisional numbers of records made offline and sent meanwhile are replaced by the real ones.
      const args = ausgang.umschreiben(args0);
      // While changes wait on this device, a new change queues behind them – their order counts.
      if (ausgang.schreibend(fn) && ausgang.wartend() > 0) {
        const v = await ausgang.ablegen({ art: 'call', fn, args, kopf: {}, schluessel: zufall() });
        ausgang.senden();
        return v;
      }
      try {
        const r = await aufrufSenden(fn, args);
        const { wert } = await r.json();
        if (r.headers.get('x-lesend') === '1') offline.merken(fn, args, wert);
        return wert;
      } catch (e) {
        if (e instanceof HttpFehler && e.status === 0) {
          // No connection: reading shows the last kept answer (marked in the traffic light); a change is kept on this
          // device with its key and sent later.
          const alt = await offline.holen(fn, args);
          if (alt) { zustand.offline = Math.min(zustand.offline ?? alt.zeit, alt.zeit); melden(); return alt.wert; }
          if (ausgang.schreibend(fn)) {
            offlineGemerkt();
            return ausgang.ablegen({ art: 'call', fn, args, kopf: {}, schluessel: (e as HttpFehler & { schluessel?: string }).schluessel ?? zufall() });
          }
        }
        // A plausibility question of the server: asked here, then sent again as confirmed.
        if (e instanceof HttpFehler && e.bestaetigen) {
          if (!await bestaetigen(e.bestaetigen, { titel: 'Bitte prüfen', ja: 'Ja, so speichern' })) throw new StillerFehler('Nicht gespeichert.');
          return (await (await aufrufSenden(fn, args, { 'X-Bestaetigt': '1' })).json()).wert;
        }
        if (!(e instanceof HttpFehler) || !e.konflikt) throw e;
        // Someone else changed the record meanwhile: overwrite on purpose, or keep theirs and see it.
        const wahl = await frage({ titel: 'Inzwischen geändert', text: <>{absatz(e.message)}{absatz('Speicherst du trotzdem, ersetzt deine Änderung die andere. Wenn du abbrichst, siehst du den neuen Stand und kannst deine Änderung dort noch einmal eintragen.')}</>,
          optionen: [{ id: 'neu', label: 'Abbrechen, neuen Stand zeigen' }, { id: 'ueber', label: 'Meine Änderung speichern', primary: true }] });
        if (wahl === 'ueber') return (await (await aufrufSenden(fn, args, { 'X-Ueberschreiben': '1' })).json()).wert;
        for (const h of hoerer.get('aktualisiert') ?? []) h(null);
        throw new StillerFehler('Nicht gespeichert.');
      }
    },
    pdf: async (html, name) => {
      if (!d) { await drucken(html); return null; }
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
    fotoAufnehmen: async (opt) => {
      const files = await dateienWaehlen({ kamera: true });
      return files.length ? hochladen(files, opt) : [];
    },
    // The phone's camera button: the position is asked for while the camera is open (the camera has to open right on
    // the tap), the server files the photo at the house nearby or puts it in the inbox.
    fotoMitStandort: async () => {
      const ort = new Promise<{ lat: number; lon: number } | null>((ok) => {
        if (!('geolocation' in navigator) || !window.isSecureContext) return ok(null);
        navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lon: p.coords.longitude }), () => ok(null),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
      });
      const files = await dateienWaehlen({ kamera: true });
      return files.length ? hochladen(files, { standort: await ort }) : [];
    },
    zaehlerFoto: async (zaehlerId) => {
      const [f] = await dateienWaehlen({ kamera: true });
      if (!f) return null;
      return (await anfrage(`/api/zaehlerfoto?zaehler=${zaehlerId}&name=${encodeURIComponent(f.name)}`, { roh: f, typ: 'application/octet-stream' })).json();
    },
    neuAnalysieren: async (id) => { await anfrage('/api/neu-analysieren', { json: { id } }); },
    bei: (kanal, fn) => {
      if (kanal === 'navigation') return d?.bei('navigation', fn) ?? (() => {});
      ereignisse();
      if (!hoerer.has(kanal)) hoerer.set(kanal, new Set());
      hoerer.get(kanal)!.add(fn);
      return () => hoerer.get(kanal)?.delete(fn);
    },
    extern: async (url) => { if (d) await d.extern(url); else if (/^(mailto:|https:|webcal:)/.test(url)) window.open(url, /^(mailto|webcal):/.test(url) ? '_self' : '_blank'); },
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
type Status = { modus: 'server' | 'lokal'; version: string; desktop_schnittstelle: number; angemeldet: boolean; benutzer: Row | null; einrichtung: boolean; offline?: boolean };
// Without a connection the last status of this device is used, if answers are kept for reading (server only).
export async function status(): Promise<Status> {
  try {
    const s: Status = await fetch('/api/status', { credentials: 'same-origin' }).then((r) => r.json());
    if (s.modus === 'server' && s.angemeldet) await offline.benutzerSetzen(String(s.benutzer?.id), s);
    return s;
  } catch (e) {
    const alt = desktop()?.lokal ? null : offline.letzterStatus();
    if (alt?.angemeldet) { zustand.wegSeit ??= Date.now(); return { ...alt, offline: true }; }
    throw e;
  }
}
export const anmelden = (login: string, passwort: string) => anfrage('/api/anmelden', { json: { login, passwort } }).then((r) => r.json());
export const einrichten = (login: string, name: string, passwort: string) => anfrage('/api/einrichten', { json: { login, name, passwort } }).then((r) => r.json());
export const abmelden = async () => { await anfrage('/api/abmelden', { json: {} }); await offline.leeren(); await offline.benutzerSetzen(null); window.dispatchEvent(new Event('hv-abgemeldet')); };

// Passkeys (WebAuthn) – only where the browser offers them; the Mac app's window does not.
export const passkeyMoeglich = () => !window.hvDesktop && typeof window.PublicKeyCredential === 'function' && window.isSecureContext;
export async function passkeyAnmelden() {
  const { startAuthentication } = await import('@simplewebauthn/browser');
  const { vorgang, optionen } = await (await anfrage('/api/passkey/anmelden/optionen', { json: {} })).json();
  const antwort = await startAuthentication({ optionsJSON: optionen });
  return (await anfrage('/api/passkey/anmelden', { json: { vorgang, antwort } })).json();
}
export async function passkeyHinzufuegen(name: string) {
  const { startRegistration } = await import('@simplewebauthn/browser');
  const optionen = await (await anfrage('/api/passkey/registrieren/optionen', { json: {} })).json();
  const antwort = await startRegistration({ optionsJSON: optionen });
  return (await anfrage('/api/passkey/registrieren', { json: { antwort, name } })).json();
}
