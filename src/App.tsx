import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { call, OBJEKT_ART, type Modus, type Row } from './api';
import { useLoad } from './useLoad';
import { Uebersicht } from './views/Uebersicht';
import { Objekte } from './views/Objekte';
import { Einheiten } from './views/Einheiten';
import { Vertraege } from './views/Vertraege';
import { Schluessel } from './views/Schluessel';
import { Personen } from './views/Personen';
import { Zaehler } from './views/Zaehler';
import { Konten } from './views/Konten';
import { Buchen } from './views/Buchen';
import { Sollstellung } from './views/Sollstellung';
import { OffenePosten } from './views/OffenePosten';
import { Bank } from './views/Bank';
import { Einstellungen } from './views/Einstellungen';
import { NkAbrechnung } from './views/NkAbrechnung';
import { WegAbrechnung } from './views/WegAbrechnung';
import { Wirtschaftsplan } from './views/Wirtschaftsplan';
import { Ruecklagen } from './views/Ruecklagen';
import { Kautionen, Mietanpassung, Schluesselverwaltung, Versicherungen } from './views/MieteExtras';
import { Beschluesse, Kontakte, Versammlungen } from './views/WegExtras';
import { Briefe, Termine, Vorgaenge } from './views/Kommunikation';
import { Archiv, DokumentDialog, Postfach, Rechnungen } from './views/Archiv';
import { Export } from './views/Export';
import { Protokoll } from './views/Protokoll';
import { Uebergaben } from './views/Uebergabe';
import { Vermietung } from './views/Vermietung';
import { Auswertungen } from './views/Auswertungen';
import { Darlehen, Steckbrief } from './views/Steckbrief';
import { EinheitSeite, KontoSeite, PersonSeite, VertragSeite } from './views/Akten';
import { ProjektCockpit, ProjektDokumente, ProjektKosten, ProjektListe, ProjektZeitplan } from './views/Projekte';
import { Pruefbericht } from './views/Pruefbericht';
import { Suche, type Befehl } from './Suche';
import { Vorschaukarte } from './Vorschaukarte';
import { FrageHost } from './frage';
import { kontextmenue, zielZuordnung } from './kontext';
import { aktionSetzen } from './aktion';
import { anzeige } from './anzeige';
import { DETAILSEITEN, NaviContext, zielAusKey, type Ort, type PfadTeil, type Ziel } from './navi';
import * as I from 'lucide-react';

// One icon per page; unknown ids fall back to a neutral dot.
const ICON: Record<string, I.LucideIcon> = {
  uebersicht: I.Gauge, pcockpit: I.Gauge, projekte: I.FolderKanban, zeitplan: I.CalendarRange, pkosten: I.HandCoins, pdok: I.Image,
  objekte: I.Building2, steckbrief: I.House, einheiten: I.LayoutGrid, vertraege: I.Users, zaehler: I.Gauge, schluessel: I.Scale, personen: I.Contact,
  postfach: I.Inbox, archiv: I.Archive, rechnungen: I.Receipt,
  buchen: I.BookOpen, konten: I.Landmark, soll: I.Repeat, op: I.BadgeEuro, bank: I.Wallet, darlehen: I.PiggyBank,
  nk: I.Calculator, wegabr: I.Calculator, wipl: I.ClipboardList, ruecklagen: I.PiggyBank, auswertung: I.ChartColumn,
  kaution: I.Shield, anpassung: I.TrendingUp, vermietung: I.UserPlus, uebergabe: I.ClipboardCheck, versammlungen: I.Gavel, beschluesse: I.ScrollText,
  kontakte: I.Phone, schluesselv: I.KeyRound, versicherungen: I.Umbrella,
  briefe: I.Mail, vorgaenge: I.ListChecks, termine: I.CalendarDays,
  pruefung: I.ShieldCheck, protokoll: I.History, export: I.Download, einstellungen: I.Settings,
};

type Ctx = { modus: Modus; objekt: Row; objekte: Row[]; ladeObjekte: () => void; oeffne: (seite: string, objektId?: number) => void };
type Seite = {
  id: string;
  label: string | ((m: Modus) => string);
  gruppe: string;
  objekt?: boolean; // needs a selected object
  modi?: Modus[]; // default: rental and WEG mode
  alle?: boolean; // shown in every mode, including projects
  render: (c: Ctx) => ReactNode;
};

const SEITEN: Seite[] = [
  { id: 'postfach', label: 'Postfach', gruppe: 'Dokumente', alle: true, render: () => <Postfach /> },
  { id: 'archiv', label: 'Archiv & Suche', gruppe: 'Dokumente', alle: true, render: (c) => <Archiv objekt={c.modus === 'projekt' ? undefined : c.objekt} /> },
  { id: 'rechnungen', label: 'Rechnungen', gruppe: 'Dokumente', alle: true, render: (c) => <Rechnungen objekt={c.modus === 'projekt' ? undefined : c.objekt} /> },
  { id: 'pcockpit', label: 'Cockpit', gruppe: 'Start', modi: ['projekt'], render: (c) => <ProjektCockpit oeffne={c.oeffne} /> },
  { id: 'projekte', label: 'Alle Projekte', gruppe: 'Projekte', modi: ['projekt'], render: (c) => <ProjektListe reload={c.ladeObjekte} oeffne={c.oeffne} /> },
  { id: 'zeitplan', label: 'Zeitplan', gruppe: 'Projekte', objekt: true, modi: ['projekt'], render: (c) => <ProjektZeitplan key={c.objekt.id} projekt={c.objekt} /> },
  { id: 'pkosten', label: 'Kosten & Budget', gruppe: 'Projekte', objekt: true, modi: ['projekt'], render: (c) => <ProjektKosten key={c.objekt.id} projekt={c.objekt} /> },
  { id: 'pdok', label: 'Fotos & Dokumente', gruppe: 'Projekte', objekt: true, modi: ['projekt'], render: (c) => <ProjektDokumente key={c.objekt.id} projekt={c.objekt} /> },
  { id: 'uebersicht', label: 'Cockpit', gruppe: 'Start', render: (c) => <Uebersicht modus={c.modus} objekte={c.objekte} oeffne={c.oeffne} /> },
  { id: 'steckbrief', label: 'Steckbrief', gruppe: 'Stammdaten', objekt: true, render: (c) => <Steckbrief key={c.objekt.id} objekt={c.objekt} oeffne={c.oeffne} modus={c.modus} /> },
  { id: 'objekte', label: 'Objekte', gruppe: 'Stammdaten', render: (c) => <Objekte modus={c.modus} objekte={c.objekte} reload={c.ladeObjekte} onOpen={(id) => c.oeffne('steckbrief', id)} /> },
  { id: 'einheiten', label: 'Einheiten', gruppe: 'Stammdaten', objekt: true, render: (c) => <Einheiten key={c.objekt.id} modus={c.modus} objekt={c.objekt} /> },
  { id: 'vertraege', label: (m) => (m === 'weg' ? 'Eigentümer' : 'Mieter'), gruppe: 'Stammdaten', objekt: true, render: (c) => <Vertraege key={c.objekt.id + c.modus} modus={c.modus} objekt={c.objekt} /> },
  { id: 'zaehler', label: 'Zähler', gruppe: 'Stammdaten', objekt: true, render: (c) => <Zaehler key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'schluessel', label: 'Umlageschlüssel', gruppe: 'Stammdaten', objekt: true, render: (c) => <Schluessel key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'personen', label: 'Adressbuch', gruppe: 'Stammdaten', alle: true, render: () => <Personen /> },
  { id: 'buchen', label: 'Buchungen', gruppe: 'Buchhaltung', objekt: true, render: (c) => <Buchen key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'konten', label: 'Konten', gruppe: 'Buchhaltung', objekt: true, render: (c) => <Konten key={c.objekt.id + c.modus} objekt={c.objekt} modus={c.modus} /> },
  { id: 'soll', label: 'Sollstellung', gruppe: 'Buchhaltung', objekt: true, render: (c) => <Sollstellung key={c.objekt.id + c.modus} objekt={c.objekt} modus={c.modus} /> },
  { id: 'op', label: 'Offene Posten', gruppe: 'Buchhaltung', objekt: true, render: (c) => <OffenePosten key={c.objekt.id + c.modus} objekt={c.objekt} modus={c.modus} /> },
  { id: 'darlehen', label: 'Darlehen', gruppe: 'Buchhaltung', objekt: true, render: (c) => <Darlehen key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'bank', label: 'Bank & SEPA', gruppe: 'Buchhaltung', objekt: true, render: (c) => <Bank key={c.objekt.id + c.modus} objekt={c.objekt} modus={c.modus} /> },
  { id: 'nk', label: 'Betriebskosten', gruppe: 'Abrechnung', objekt: true, modi: ['miete'], render: (c) => <NkAbrechnung key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'wegabr', label: 'Jahresabrechnung', gruppe: 'Abrechnung', objekt: true, modi: ['weg'], render: (c) => <WegAbrechnung key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'wipl', label: 'Wirtschaftsplan', gruppe: 'Abrechnung', objekt: true, modi: ['weg'], render: (c) => <Wirtschaftsplan key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'ruecklagen', label: 'Rücklagen', gruppe: 'Abrechnung', objekt: true, modi: ['weg'], render: (c) => <Ruecklagen key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'auswertung', label: 'Rendite & Steuer', gruppe: 'Abrechnung', objekt: true, modi: ['miete'], render: (c) => <Auswertungen key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'vermietung', label: 'Vermietung', gruppe: 'Verwaltung', objekt: true, modi: ['miete'], render: (c) => <Vermietung key={c.objekt.id} objekt={c.objekt} oeffne={c.oeffne} /> },
  { id: 'uebergabe', label: 'Übergaben', gruppe: 'Verwaltung', objekt: true, modi: ['miete'], render: (c) => <Uebergaben key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'kaution', label: 'Kautionen', gruppe: 'Verwaltung', objekt: true, modi: ['miete'], render: (c) => <Kautionen key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'anpassung', label: 'Mietanpassungen', gruppe: 'Verwaltung', objekt: true, modi: ['miete'], render: (c) => <Mietanpassung key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'versammlungen', label: 'Versammlungen', gruppe: 'Verwaltung', objekt: true, modi: ['weg'], render: (c) => <Versammlungen key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'beschluesse', label: 'Beschluss-Sammlung', gruppe: 'Verwaltung', objekt: true, modi: ['weg'], render: (c) => <Beschluesse key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'kontakte', label: (m) => (m === 'weg' ? 'Beirat & Kontakte' : 'Ansprechpartner'), gruppe: 'Verwaltung', objekt: true, render: (c) => <Kontakte key={c.objekt.id + c.modus} objekt={c.objekt} titel={c.modus === 'weg' ? 'Beirat & Ansprechpartner' : 'Ansprechpartner'} /> },
  { id: 'schluesselv', label: 'Schlüssel', gruppe: 'Verwaltung', objekt: true, render: (c) => <Schluesselverwaltung key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'versicherungen', label: 'Versicherungen', gruppe: 'Verwaltung', objekt: true, render: (c) => <Versicherungen key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'briefe', label: 'Briefe', gruppe: 'Kommunikation', objekt: true, render: (c) => <Briefe key={c.objekt.id + c.modus} objekt={c.objekt} modus={c.modus} /> },
  { id: 'vorgaenge', label: 'Vorgänge', gruppe: 'Kommunikation', objekt: true, render: (c) => <Vorgaenge key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'termine', label: 'Termine', gruppe: 'Kommunikation', alle: true, render: (c) => <Termine objekte={c.modus === 'projekt' ? [] : c.objekte} /> },
  { id: 'pruefung', label: 'Prüfbericht', gruppe: 'System', render: (c) => <Pruefbericht modus={c.modus} /> },
  { id: 'protokoll', label: 'Änderungsprotokoll', gruppe: 'System', alle: true, render: () => <Protokoll /> },
  { id: 'export', label: 'Export & Steuer', gruppe: 'System', objekt: true, render: (c) => <Export key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'einstellungen', label: 'Einstellungen', gruppe: 'System', alle: true, render: () => <Einstellungen /> },
];

const REIHENFOLGE = ['Start', 'Projekte', 'Stammdaten', 'Dokumente', 'Buchhaltung', 'Abrechnung', 'Verwaltung', 'Kommunikation', 'System'];
// Detail pages highlight the list they belong to.
const LISTE_ZU_DETAIL: Record<string, string> = { person: 'personen', einheit: 'einheiten', vertrag: 'vertraege', konto: 'konten' };

const lesen = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const schreiben = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

const sichtbarIn = (s: Seite, m: Modus) => s.alle || (s.modi ? s.modi.includes(m) : m !== 'projekt');
const labelVon = (s: Seite, m: Modus) => (typeof s.label === 'function' ? s.label(m) : s.label);

function startOrt(): Ort {
  const m = lesen('modus');
  const modus: Modus = m === 'weg' || m === 'projekt' ? m : 'miete';
  return { modus, seite: lesen(`seite_${modus}`) ?? lesen('seite') ?? (modus === 'projekt' ? 'pcockpit' : 'uebersicht'), objektId: Number(lesen(`objekt_${modus}`)) || null };
}
const gleich = (a: Ort, b: Ort) => a.modus === b.modus && a.seite === b.seite && a.objektId === b.objektId && (a.param ?? '') === (b.param ?? '');

export default function App() {
  const [nav, setNav] = useState<{ verlauf: Ort[]; pos: number }>(() => ({ verlauf: [startOrt()], pos: 0 }));
  const ort = nav.verlauf[nav.pos];
  const { modus, seite, objektId } = ort;
  // In project mode the header selects a project instead of an object.
  const [objekte, ladeObjekte] = useLoad<Row[]>(() => (modus === 'projekt' ? call('projektListe') : call('objekte', modus)), [modus]);
  // All houses with their kind, to know which mode shows a house that a link points to.
  const [alleObjekte] = useLoad<Row[]>(async () => [...await call('objekte', 'miete'), ...await call('objekte', 'weg')], []);
  const [pfad, setPfad] = useState<PfadTeil[] | null>(null);
  const [meldung, setMeldung] = useState('');
  const [ziehen, setZiehen] = useState(false);
  const [dokOffen, setDokOffen] = useState<{ id: number; datei?: string } | null>(null);
  const [postfach] = useLoad<number>(() => call('postfachAnzahl'), []);
  const dropZiel = useRef<Element | null>(null);

  // ---------- navigation ----------
  const gehe = useCallback((neu: Partial<Ort>, ersetzen = false) => setNav((n) => {
    const akt = n.verlauf[n.pos];
    const ziel: Ort = { modus: neu.modus ?? akt.modus, seite: neu.seite ?? akt.seite, objektId: neu.objektId !== undefined ? neu.objektId : akt.objektId, param: neu.param };
    if (gleich(akt, ziel)) return n;
    if (ersetzen) return { verlauf: n.verlauf.map((x, i) => (i === n.pos ? ziel : x)), pos: n.pos };
    const verlauf = [...n.verlauf.slice(0, n.pos + 1), ziel].slice(-100);
    return { verlauf, pos: verlauf.length - 1 };
  }), []);
  const zurueck = useCallback(() => setNav((n) => (n.pos > 0 ? { ...n, pos: n.pos - 1 } : n)), []);
  const vor = useCallback(() => setNav((n) => (n.pos < n.verlauf.length - 1 ? { ...n, pos: n.pos + 1 } : n)), []);

  const artVon = (id: number | null | undefined) => alleObjekte?.find((o) => o.id === id)?.art;
  // The mode in which a house is visible: pure WEG houses only in WEG mode, pure rental houses only in rental mode.
  const modusFuer = (id: number | null | undefined, wunsch?: Modus): Modus => {
    const art = artVon(id);
    if (art === 'weg') return 'weg';
    if (art === 'miete') return 'miete';
    const m = wunsch ?? modus;
    return m === 'projekt' ? 'miete' : m;
  };

  const zu = useCallback((z: Ziel) => {
    window.dispatchEvent(new Event('hv-navigiert'));
    const neutral: Modus = modus === 'projekt' ? 'miete' : modus;
    if ('dokument' in z) return setDokOffen({ id: z.dokument, datei: z.datei });
    if ('person' in z) return gehe({ seite: 'person', param: String(z.person), modus: neutral });
    if ('einheit' in z) return gehe({ seite: 'einheit', param: String(z.einheit), modus: neutral });
    if ('vertrag' in z) return gehe({ seite: 'vertrag', param: `${z.typ}:${z.vertrag}`, modus: z.typ === 'weg' ? 'weg' : 'miete' });
    if ('konto' in z) return gehe({ seite: 'konto', param: String(z.konto), modus: neutral });
    if ('objekt' in z) return gehe({ seite: 'steckbrief', objektId: z.objekt, modus: modusFuer(z.objekt, neutral) });
    if ('projekt' in z) return gehe({ modus: 'projekt', seite: 'zeitplan', objektId: z.projekt });
    if ('vorgang' in z) {
      aktionSetzen(`vorgang:${z.vorgang}`);
      const oid = z.objektId ?? objektId;
      return gehe({ seite: 'vorgaenge', objektId: oid, modus: modusFuer(oid, neutral) });
    }
    if (z.aktion) aktionSetzen(z.aktion);
    const s = SEITEN.find((x) => x.id === z.seite);
    let m = z.modus ?? modus;
    if (s && !sichtbarIn(s, m)) m = s.modi?.[0] ?? 'miete';
    const oid = z.objektId !== undefined ? z.objektId : objektId;
    if (s?.objekt && m !== 'projekt' && oid) m = modusFuer(oid, m);
    gehe({ seite: z.seite, objektId: m === modus || m === 'projekt' ? oid : (oid ?? (Number(lesen(`objekt_${m}`)) || null)), modus: m });
  }, [gehe, modus, objektId, alleObjekte]);

  const setzeObjekt = useCallback((id: number) => {
    const m = modusFuer(id, modus);
    gehe({ objektId: id, modus: m, seite: ort.seite, param: ort.param }, true);
  }, [gehe, modus, ort.seite, ort.param, alleObjekte]);

  const navi = useMemo(() => ({ ort, zu, zurueck, vor, kannZurueck: nav.pos > 0, kannVor: nav.pos < nav.verlauf.length - 1, setzePfad: setPfad, setzeObjekt }),
    [ort, zu, zurueck, vor, nav.pos, nav.verlauf.length, setzeObjekt]);
  // Navigation by event, e.g. window.dispatchEvent(new CustomEvent('hv-zu', { detail: { vertrag: 3, typ: 'miete' } })).
  useEffect(() => {
    const h = (e: Event) => zu((e as CustomEvent<Ziel>).detail);
    window.addEventListener('hv-zu', h);
    return () => window.removeEventListener('hv-zu', h);
  }, [zu]);

  // Remember the place per mode (detail pages are not restored at the next start).
  useEffect(() => {
    document.documentElement.dataset.modus = modus;
    schreiben('modus', modus);
    if (!DETAILSEITEN.includes(seite)) schreiben(`seite_${modus}`, seite);
    if (objektId) schreiben(`objekt_${modus}`, String(objektId));
    window.dispatchEvent(new Event('hv-navigiert'));
    document.querySelector('main')?.scrollTo(0, 0);
  }, [modus, seite, objektId, ort.param]);

  // Keep a valid object selected for the current mode.
  useEffect(() => {
    if (!objekte || DETAILSEITEN.includes(seite)) return;
    if (!objekte.some((o) => o.id === objektId)) gehe({ objektId: objekte[0]?.id ?? null, param: ort.param }, true);
  }, [objekte, objektId, seite]);

  function wechsle(m: Modus) {
    if (m === modus) return;
    gehe({ modus: m, seite: lesen(`seite_${m}`) ?? (m === 'projekt' ? 'pcockpit' : 'uebersicht'), objektId: Number(lesen(`objekt_${m}`)) || null, param: undefined });
  }

  // ---------- back / forward: keys, mouse buttons, trackpad swipe ----------
  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      const mac = window.hv.plattform === 'darwin';
      if ((e.metaKey || (!mac && e.ctrlKey)) && e.key === '[') { e.preventDefault(); zurueck(); }
      else if ((e.metaKey || (!mac && e.ctrlKey)) && e.key === ']') { e.preventDefault(); vor(); }
      else if (!mac && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(e.target as HTMLElement).closest('input, textarea, select')) {
        e.preventDefault();
        if (e.key === 'ArrowLeft') zurueck(); else vor();
      }
    };
    const maus = (e: MouseEvent) => { if (e.button === 3) { e.preventDefault(); zurueck(); } if (e.button === 4) { e.preventDefault(); vor(); } };
    // Two-finger swipe sideways (like Safari), unless the area under the pointer scrolls sideways itself.
    let summe = 0, zuletzt = 0, sperre = 0;
    const rad = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) < 4 || Math.abs(e.deltaX) < Math.abs(e.deltaY) * 2) return;
      for (let el = e.target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
        if (el.scrollWidth > el.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowX)) return;
      }
      const jetzt = Date.now();
      if (jetzt < sperre) return;
      if (jetzt - zuletzt > 250) summe = 0;
      zuletzt = jetzt;
      summe += e.deltaX;
      if (summe < -160) { zurueck(); sperre = jetzt + 1000; summe = 0; }
      else if (summe > 160) { vor(); sperre = jetzt + 1000; summe = 0; }
    };
    const ab = window.hv.bei('navigation', (richtung: string) => (richtung === 'zurueck' ? zurueck() : richtung === 'vor' ? vor() : null));
    window.addEventListener('keydown', taste);
    window.addEventListener('mouseup', maus);
    window.addEventListener('wheel', rad, { passive: true });
    return () => { window.removeEventListener('keydown', taste); window.removeEventListener('mouseup', maus); window.removeEventListener('wheel', rad); ab(); };
  }, [zurueck, vor]);

  // ---------- background events, context menu ----------
  useEffect(() => {
    const feuern = () => window.dispatchEvent(new Event('hv-daten'));
    const a = window.hv.bei('aktualisiert', feuern);
    const b = window.hv.bei('dokumentAnalysiert', feuern);
    const c = window.hv.bei('meldung', (text: string) => { setMeldung(text); feuern(); setTimeout(() => setMeldung(''), 8000); });
    return () => { a(); b(); c(); };
  }, []);
  useEffect(() => {
    const menue = (e: MouseEvent) => {
      const el = (e.target as Element).closest?.('[data-ziel]');
      if (!el || (e.target as Element).closest('input, textarea')) return;
      e.preventDefault();
      kontextmenue(el.getAttribute('data-ziel')!, navi, melden);
    };
    window.addEventListener('contextmenu', menue);
    return () => window.removeEventListener('contextmenu', menue);
  }, [navi]);

  function melden(text: string, ms = 5000) {
    setMeldung(text);
    window.dispatchEvent(new Event('hv-daten'));
    setTimeout(() => setMeldung(''), ms);
  }

  // Header button: pick files; they go to the inbox, pre-assigned to the current object or project, for review.
  async function schnellAblegen() {
    const opt = modus === 'projekt' ? { projekt_id: objektId } : { objekt_id: objektId };
    const r = await window.hv.dateienImportieren(objektId ? opt : {});
    if (!r.length) return;
    const neu = r.filter((x) => !x.doppelt).length;
    melden(`${neu} Dokument(e) ins Postfach gelegt – bitte dort prüfen und ablegen.${r.length - neu ? ` ${r.length - neu} waren schon vorhanden.` : ''}`, 6000);
    gehe({ seite: 'postfach', param: undefined });
  }

  // ---------- drag & drop: onto a person, unit, contract or posting = filed there; anywhere else = inbox ----------
  const zielUnter = (e: React.DragEvent) => (e.target as Element).closest?.('[data-ziel]') ?? null;
  function ueber(e: React.DragEvent) {
    e.preventDefault();
    const z = zielUnter(e);
    const k = z?.getAttribute('data-ziel') ?? '';
    const passt = z && /^(person|einheit|vertrag|objekt|buchung):/.test(k);
    if (dropZiel.current !== (passt ? z : null)) {
      dropZiel.current?.classList.remove('drop-ziel');
      dropZiel.current = passt ? z : null;
      dropZiel.current?.classList.add('drop-ziel');
    }
    setZiehen(!passt && e.dataTransfer.types.includes('Files'));
  }
  async function abgelegt(e: React.DragEvent) {
    e.preventDefault();
    setZiehen(false);
    const z = dropZiel.current;
    z?.classList.remove('drop-ziel');
    dropZiel.current = null;
    const dokId = e.dataTransfer.getData('application/x-hv-dokument');
    if (z) {
      const key = z.getAttribute('data-ziel')!;
      const zuordnung = await zielZuordnung(key);
      if (dokId) {
        await call('dokumentZuordnen', Number(dokId), zuordnung.felder);
        return melden(`Dokument ${zuordnung.label} zugeordnet.`);
      }
      if (!e.dataTransfer.files.length) return;
      const r = await window.hv.importieren(e.dataTransfer.files, { ...zuordnung.felder, status: 'abgelegt' });
      return melden(`${r.length} Datei(en) ${zuordnung.label} abgelegt.`);
    }
    if (!e.dataTransfer.files.length) return;
    const r = await window.hv.importieren(e.dataTransfer.files);
    const neu = r.filter((x) => !x.doppelt).length;
    melden(`${neu} Dokument(e) ins Postfach gelegt${r.length - neu ? `, ${r.length - neu} waren schon vorhanden` : ''}.`);
  }
  useEffect(() => {
    const aus = () => setZiehen(false);
    window.addEventListener('hv-ziehen-aus', aus);
    return () => window.removeEventListener('hv-ziehen-aus', aus);
  }, []);

  // ---------- what to show ----------
  const objekt = objekte?.find((o) => o.id === objektId);
  const sichtbar = SEITEN.filter((s) => sichtbarIn(s, modus));
  const detail = DETAILSEITEN.includes(seite);
  const aktiv = detail ? null : sichtbar.find((s) => s.id === seite) ?? sichtbar.find((s) => s.gruppe === 'Start') ?? sichtbar[0];
  const markiert = detail ? LISTE_ZU_DETAIL[seite] : aktiv?.id;
  const gruppen = [...new Set(sichtbar.map((s) => s.gruppe))].sort((a, b) => REIHENFOLGE.indexOf(a) - REIHENFOLGE.indexOf(b));

  const [zugeklappt, setZugeklappt] = useState<string[]>(() => { try { return JSON.parse(lesen('zugeklappt') ?? '[]'); } catch { return []; } });
  const klappen = (g: string) => {
    const neu = zugeklappt.includes(g) ? zugeklappt.filter((x) => x !== g) : [...zugeklappt, g];
    setZugeklappt(neu);
    schreiben('zugeklappt', JSON.stringify(neu));
  };
  // Units of the current house in the sidebar (tree under "Einheiten").
  const [baumEinheiten] = useLoad<Row[]>(() => (objektId && modus !== 'projekt' ? call('einheiten', objektId) : Promise.resolve([])), [objektId, modus]);
  const baumOffen = !zugeklappt.includes('baum');
  const aktiveEinheit = seite === 'einheit' ? Number(ort.param) : null;

  const pfadAnzeige: PfadTeil[] = pfad ?? (aktiv ? [
    ...(aktiv.objekt && objekt ? [{ label: objekt.bezeichnung ?? objekt.titel, ziel: modus === 'projekt' ? undefined : { objekt: objekt.id } } as PfadTeil] : []),
    { label: labelVon(aktiv, modus) },
  ] : []);

  const befehle: Befehl[] = [
    { label: 'Dokumente ablegen', stichworte: 'hochladen import scan', icon: I.FilePlus2, run: schnellAblegen },
    ...(modus !== 'projekt' ? [
      { label: 'Neue Buchung', stichworte: 'buchen rechnung zahlung', icon: I.BookOpen, run: () => zu({ seite: 'buchen', aktion: 'neue-buchung' }) },
      { label: 'Mahnlauf / offene Posten', stichworte: 'mahnung rückstand', icon: I.BadgeEuro, run: () => zu({ seite: 'op' }) },
      { label: 'Kontoauszug importieren', stichworte: 'bank camt mt940 csv', icon: I.Wallet, run: () => zu({ seite: 'bank' }) },
      { label: 'Neuer Vorgang', stichworte: 'aufgabe schaden anfrage', icon: I.ListChecks, run: () => zu({ seite: 'vorgaenge', aktion: 'neuer-vorgang' }) },
      { label: 'Neues Objekt', stichworte: 'haus anlegen', icon: I.Building2, run: () => zu({ seite: 'objekte', aktion: 'neues-objekt' }) },
      { label: 'Prüfbericht', stichworte: 'prüfen fehler vollständig', icon: I.ShieldCheck, run: () => zu({ seite: 'pruefung' }) },
    ] : []),
    { label: 'Neue Person', stichworte: 'kontakt mieter eigentümer adresse', icon: I.UserPlus, run: () => zu({ seite: 'personen', aktion: 'neue-person' }) },
    { label: 'Neuer Termin', stichworte: 'kalender', icon: I.CalendarPlus, run: () => zu({ seite: 'termine', aktion: 'neuer-termin' }) },
    { label: 'Zur Mietverwaltung', icon: I.KeyRound, run: () => wechsle('miete') },
    { label: 'Zur WEG-Verwaltung', icon: I.Building2, run: () => wechsle('weg') },
    { label: 'Zu den Projekten', icon: I.Hammer, run: () => wechsle('projekt') },
    { label: 'Zurück', stichworte: 'verlauf', icon: I.ChevronLeft, run: zurueck },
    { label: 'Hell / Dunkel umschalten', stichworte: 'dunkelmodus farbschema', icon: I.Moon,
      run: () => anzeige.setzeThema(document.documentElement.dataset.thema === 'dunkel' ? 'hell' : 'dunkel') },
    { label: 'Datensicherung erstellen', stichworte: 'backup', icon: I.Download, run: () => { window.hv.sicherung(); } },
    ...sichtbar.map((x) => ({ label: `Gehe zu: ${labelVon(x, modus)}`, stichworte: x.gruppe, icon: ICON[x.id], run: () => zu({ seite: x.id }) })),
  ];

  const ctx: Ctx | null = objekte
    ? { modus, objekt: objekt!, objekte, ladeObjekte, oeffne: (s, id) => zu({ seite: s, objektId: id ?? objektId }) }
    : null;

  function inhalt() {
    if (!ctx) return null;
    if (seite === 'person') return <PersonSeite key={ort.param} id={Number(ort.param)} />;
    if (seite === 'einheit') return <EinheitSeite key={ort.param} id={Number(ort.param)} />;
    if (seite === 'konto') return <KontoSeite key={ort.param} id={Number(ort.param)} />;
    if (seite === 'vertrag') {
      const [typ, id] = (ort.param ?? '').split(':');
      return <VertragSeite key={ort.param} typ={typ === 'weg' ? 'weg' : 'miete'} id={Number(id)} />;
    }
    if (!aktiv) return null;
    if (aktiv.objekt && !objekt) {
      return (
        <div className="leerzustand gross">
          <I.Building2 size={40} strokeWidth={1.3} />
          <p>{modus === 'projekt' ? 'Noch kein Projekt angelegt.' : 'Noch kein Objekt angelegt. Lege zuerst ein Haus an – Einheiten, Mieter und Buchungen hängen daran.'}</p>
          <button className="primary" onClick={() => zu(modus === 'projekt' ? { seite: 'projekte' } : { seite: 'objekte', aktion: 'neues-objekt' })}>{modus === 'projekt' ? 'Zu den Projekten' : 'Objekt anlegen'}</button>
        </div>
      );
    }
    return aktiv.render(ctx);
  }

  return (
    <NaviContext.Provider value={navi}>
      <div className={`app${ziehen ? ' ziehen' : ''}`} onDragOver={ueber}
        onDragLeave={(e) => { if (e.currentTarget === e.target) { setZiehen(false); dropZiel.current?.classList.remove('drop-ziel'); dropZiel.current = null; } }} onDrop={abgelegt}>
        <aside className="seitenleiste">
          <div className="marke"><I.House size={17} strokeWidth={2.2} /><span>Mietshaus</span></div>
          <div className="modi" role="tablist">
            {([['miete', 'Miete', I.KeyRound], ['weg', 'WEG', I.Building2], ['projekt', 'Projekte', I.Hammer]] as [Modus, string, I.LucideIcon][]).map(([m, l, Icon]) => (
              <button key={m} role="tab" className={`modus-${m}`} aria-selected={modus === m} onClick={() => wechsle(m)}><Icon size={18} strokeWidth={1.8} /><span>{l}</span></button>
            ))}
          </div>
          <nav>
            {gruppen.map((g) => {
              const zu_ = zugeklappt.includes(g) && !sichtbar.some((x) => x.gruppe === g && x.id === markiert);
              return (
                <div key={g} className={`navgruppe${zu_ ? ' zu' : ''}`}>
                  <h4><button onClick={() => klappen(g)} aria-expanded={!zu_}>{g}<I.ChevronDown size={13} /></button></h4>
                  {!zu_ && sichtbar.filter((s) => s.gruppe === g).map((s) => {
                    const Icon = ICON[s.id] ?? I.Dot;
                    return (
                      <div key={s.id}>
                        <button className={`eintrag${markiert === s.id ? ' active' : ''}`} onClick={() => zu({ seite: s.id })}>
                          <Icon size={16} strokeWidth={1.9} /><span className="text">{labelVon(s, modus)}</span>
                          {s.id === 'postfach' && !!postfach && <span className="zaehler">{postfach}</span>}
                          {s.id === 'einheiten' && !!baumEinheiten?.length && (
                            <span className={`baumpfeil${baumOffen ? ' offen' : ''}`} role="button" title={baumOffen ? 'Einheiten ausblenden' : 'Einheiten zeigen'}
                              onClick={(e) => { e.stopPropagation(); klappen('baum'); }}><I.ChevronRight size={14} /></span>
                          )}
                        </button>
                        {s.id === 'einheiten' && baumOffen && !!baumEinheiten?.length && (
                          <div className="baum">
                            {baumEinheiten.map((e) => (
                              <button key={e.id} className={`eintrag kind${aktiveEinheit === e.id ? ' active' : ''}`} data-ziel={`einheit:${e.id}`} onClick={() => zu({ einheit: e.id })}
                                title={[e.mieter && `Mieter: ${e.mieter}`, e.eigentuemer && `Eigentümer: ${e.eigentuemer}`].filter(Boolean).join(' · ')}>
                                <span className={`punkt ${(modus === 'weg' ? e.eigentuemer : e.mieter || e.selbstgenutzt) ? 'belegt' : 'frei'}`} /><span className="text">{e.bezeichnung}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </nav>
        </aside>
        <header className="kopfleiste">
          <div className="navknoepfe">
            <button className="rund" title="Zurück (⌘[)" disabled={!navi.kannZurueck} onClick={zurueck}><I.ChevronLeft size={18} /></button>
            <button className="rund" title="Vor (⌘])" disabled={!navi.kannVor} onClick={vor}><I.ChevronRight size={18} /></button>
          </div>
          <nav className="pfad" aria-label="Pfad">
            {pfadAnzeige.map((t, i) => (
              <span key={i} className="pfadteil">
                {i > 0 && <I.ChevronRight size={13} className="trenner" />}
                {t.ziel && i < pfadAnzeige.length - 1 ? <button onClick={() => zu(t.ziel!)}>{t.label}</button> : <b>{t.label}</b>}
              </span>
            ))}
          </nav>
          <Suche befehle={befehle} onDokument={(d) => setDokOffen({ id: d.id, datei: d.datei })} />
          <label className="objektwahl" title={modus === 'projekt' ? 'Projekt' : 'Objekt'}>
            <I.Building2 size={15} />
            <select value={objektId ?? ''} onChange={(e) => {
              const id = Number(e.target.value);
              detail ? zu({ seite: modus === 'projekt' ? 'zeitplan' : 'steckbrief', objektId: id }) : gehe({ objektId: id, param: undefined });
            }} disabled={!objekte?.length}>
              {!objekte?.length && <option value="">{modus === 'projekt' ? '– noch keine Projekte –' : '– noch keine Objekte –'}</option>}
              {detail && objektId && !objekte?.some((o) => o.id === objektId) && <option value={objektId}>…</option>}
              {objekte?.map((o) => (
                <option key={o.id} value={o.id}>{o.bezeichnung ?? o.titel}{o.art === 'gemischt' ? ' (gemischt)' : ''}</option>
              ))}
            </select>
          </label>
          <button className="rund ring" title="Dokumente ablegen – sie landen zur Prüfung im Postfach" onClick={schnellAblegen}><I.FilePlus2 size={16} /></button>
        </header>
        <main>{inhalt()}</main>
        <footer>{meldung ? <b>{meldung}</b> : objekt ? (modus === 'projekt' ? `Projekt: ${objekt.titel}${objekt.objekt ? ` · ${objekt.objekt}` : ''}` : `${objekt.bezeichnung} · ${OBJEKT_ART[objekt.art]}`) : ''}</footer>
        {ziehen && <div className="dropzone">Dateien loslassen – sie landen im Postfach. Auf eine Person, Einheit oder Buchung ziehen, um sie dort abzulegen.</div>}
        <Vorschaukarte />
        {dokOffen && <DokumentDialog id={dokOffen.id} datei={dokOffen.datei} onClose={() => setDokOffen(null)} />}
        <FrageHost />
      </div>
    </NaviContext.Provider>
  );
}

export { zielAusKey };
