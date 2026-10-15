import { useEffect, useState, type ReactNode } from 'react';
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
import { Suche } from './Suche';
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
  protokoll: I.History, export: I.Download, einstellungen: I.Settings,
};
import { Export } from './views/Export';
import { Protokoll } from './views/Protokoll';
import { Uebergaben } from './views/Uebergabe';
import { Auswertungen } from './views/Auswertungen';
import { Darlehen, PersonAkte, Steckbrief } from './views/Steckbrief';
import { ProjektCockpit, ProjektDokumente, ProjektKosten, ProjektListe, ProjektZeitplan } from './views/Projekte';

type Ctx = { modus: Modus; objekt: Row; objekte: Row[]; ladeObjekte: () => void; oeffne: (seite: string, objektId?: number) => void; akte: (personId: number) => void };
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
  { id: 'steckbrief', label: 'Steckbrief', gruppe: 'Stammdaten', objekt: true, render: (c) => <Steckbrief key={c.objekt.id} objekt={c.objekt} oeffne={c.oeffne} /> },
  { id: 'objekte', label: 'Objekte', gruppe: 'Stammdaten', render: (c) => <Objekte modus={c.modus} objekte={c.objekte} reload={c.ladeObjekte} onOpen={(id) => c.oeffne('einheiten', id)} /> },
  { id: 'einheiten', label: 'Einheiten', gruppe: 'Stammdaten', objekt: true, render: (c) => <Einheiten key={c.objekt.id} modus={c.modus} objekt={c.objekt} /> },
  { id: 'vertraege', label: (m) => (m === 'weg' ? 'Eigentümer' : 'Mieter'), gruppe: 'Stammdaten', objekt: true, render: (c) => <Vertraege key={c.objekt.id + c.modus} modus={c.modus} objekt={c.objekt} /> },
  { id: 'zaehler', label: 'Zähler', gruppe: 'Stammdaten', objekt: true, render: (c) => <Zaehler key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'schluessel', label: 'Umlageschlüssel', gruppe: 'Stammdaten', objekt: true, render: (c) => <Schluessel key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'personen', label: 'Adressbuch', gruppe: 'Stammdaten', alle: true, render: (c) => <Personen onAkte={c.akte} /> },
  { id: 'buchen', label: 'Buchungen', gruppe: 'Buchhaltung', objekt: true, render: (c) => <Buchen key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'konten', label: 'Konten', gruppe: 'Buchhaltung', objekt: true, render: (c) => <Konten key={c.objekt.id + c.modus} objekt={c.objekt} modus={c.modus} /> },
  { id: 'soll', label: 'Sollstellung', gruppe: 'Buchhaltung', objekt: true, render: (c) => <Sollstellung key={c.objekt.id + c.modus} objekt={c.objekt} modus={c.modus} /> },
  { id: 'op', label: 'Offene Posten & Mahnungen', gruppe: 'Buchhaltung', objekt: true, render: (c) => <OffenePosten key={c.objekt.id + c.modus} objekt={c.objekt} modus={c.modus} /> },
  { id: 'darlehen', label: 'Darlehen', gruppe: 'Buchhaltung', objekt: true, render: (c) => <Darlehen key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'bank', label: 'Bank & SEPA', gruppe: 'Buchhaltung', objekt: true, render: (c) => <Bank key={c.objekt.id + c.modus} objekt={c.objekt} modus={c.modus} /> },
  { id: 'nk', label: 'Betriebskosten', gruppe: 'Abrechnung', objekt: true, modi: ['miete'], render: (c) => <NkAbrechnung key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'wegabr', label: 'Jahresabrechnung', gruppe: 'Abrechnung', objekt: true, modi: ['weg'], render: (c) => <WegAbrechnung key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'wipl', label: 'Wirtschaftsplan', gruppe: 'Abrechnung', objekt: true, modi: ['weg'], render: (c) => <Wirtschaftsplan key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'ruecklagen', label: 'Rücklagen & Sonderumlagen', gruppe: 'Abrechnung', objekt: true, modi: ['weg'], render: (c) => <Ruecklagen key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'auswertung', label: 'Rendite & Steuer', gruppe: 'Abrechnung', objekt: true, modi: ['miete'], render: (c) => <Auswertungen key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'uebergabe', label: 'Übergaben & Mieterwechsel', gruppe: 'Verwaltung', objekt: true, modi: ['miete'], render: (c) => <Uebergaben key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'kaution', label: 'Kautionen', gruppe: 'Verwaltung', objekt: true, modi: ['miete'], render: (c) => <Kautionen key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'anpassung', label: 'Mietanpassungen', gruppe: 'Verwaltung', objekt: true, modi: ['miete'], render: (c) => <Mietanpassung key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'versammlungen', label: 'Versammlungen', gruppe: 'Verwaltung', objekt: true, modi: ['weg'], render: (c) => <Versammlungen key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'beschluesse', label: 'Beschluss-Sammlung', gruppe: 'Verwaltung', objekt: true, modi: ['weg'], render: (c) => <Beschluesse key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'kontakte', label: (m) => (m === 'weg' ? 'Beirat & Ansprechpartner' : 'Ansprechpartner'), gruppe: 'Verwaltung', objekt: true, render: (c) => <Kontakte key={c.objekt.id + c.modus} objekt={c.objekt} titel={c.modus === 'weg' ? 'Beirat & Ansprechpartner' : 'Ansprechpartner'} /> },
  { id: 'schluesselv', label: 'Schlüssel', gruppe: 'Verwaltung', objekt: true, render: (c) => <Schluesselverwaltung key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'versicherungen', label: 'Versicherungen & Verträge', gruppe: 'Verwaltung', objekt: true, render: (c) => <Versicherungen key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'briefe', label: 'Briefe & Serienbriefe', gruppe: 'Kommunikation', objekt: true, render: (c) => <Briefe key={c.objekt.id + c.modus} objekt={c.objekt} modus={c.modus} /> },
  { id: 'vorgaenge', label: 'Vorgänge', gruppe: 'Kommunikation', objekt: true, render: (c) => <Vorgaenge key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'termine', label: 'Termine', gruppe: 'Kommunikation', alle: true, render: (c) => <Termine objekte={c.modus === 'projekt' ? [] : c.objekte} /> },
  { id: 'protokoll', label: 'Änderungsprotokoll', gruppe: 'System', alle: true, render: () => <Protokoll /> },
  { id: 'export', label: 'Export & DATEV', gruppe: 'System', objekt: true, render: (c) => <Export key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'einstellungen', label: 'Einstellungen & Sicherung', gruppe: 'System', alle: true, render: () => <Einstellungen /> },
];


const lesen = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const schreiben = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

export default function App() {
  const [modus, setModus] = useState<Modus>(() => { const m = lesen('modus'); return m === 'weg' || m === 'projekt' ? m : 'miete'; });
  const [seite, setSeite] = useState(() => lesen('seite') ?? 'uebersicht');
  const [objektId, setObjektId] = useState<number | null>(() => Number(lesen(`objekt_${modus}`)) || null);
  // In project mode the header selects a project instead of an object.
  const [objekte, ladeObjekte] = useLoad<Row[]>(() => (modus === 'projekt' ? call('projektListe') : call('objekte', modus)), [modus]);

  useEffect(() => {
    document.documentElement.dataset.modus = modus;
    schreiben('modus', modus);
  }, [modus]);
  useEffect(() => schreiben('seite', seite), [seite]);

  const [meldung, setMeldung] = useState('');
  // Folded navigation groups, remembered per computer.
  const [zugeklappt, setZugeklappt] = useState<string[]>(() => { try { return JSON.parse(lesen('zugeklappt') ?? '[]'); } catch { return []; } });
  const klappen = (g: string) => {
    const neu = zugeklappt.includes(g) ? zugeklappt.filter((x) => x !== g) : [...zugeklappt, g];
    setZugeklappt(neu);
    schreiben('zugeklappt', JSON.stringify(neu));
  };
  // Background events from the main process trigger a data reload everywhere.
  useEffect(() => {
    const feuern = () => window.dispatchEvent(new Event('hv-daten'));
    const a = window.hv.bei('aktualisiert', feuern);
    const b = window.hv.bei('dokumentAnalysiert', feuern);
    const c = window.hv.bei('meldung', (text: string) => { setMeldung(text); feuern(); setTimeout(() => setMeldung(''), 8000); });
    return () => { a(); b(); c(); };
  }, []);
  const [postfach] = useLoad<number>(() => call('postfachAnzahl'), []);
  const [ziehen, setZiehen] = useState(false);
  const [dokOffen, setDokOffen] = useState<Row | null>(null);
  const [akte, setAkte] = useState<number | null>(null);

  useEffect(() => {
    const aus = () => setZiehen(false);
    window.addEventListener('hv-ziehen-aus', aus);
    return () => window.removeEventListener('hv-ziehen-aus', aus);
  }, []);

  // Header button: pick files; they go to the inbox, pre-assigned to the current object or project, for review.
  async function schnellAblegen() {
    const opt = modus === 'projekt' ? { projekt_id: objektId } : { objekt_id: objektId };
    const r = await window.hv.dateienImportieren(objektId ? opt : {});
    if (!r.length) return;
    const neu = r.filter((x) => !x.doppelt).length;
    setMeldung(`${neu} Dokument(e) ins Postfach gelegt – bitte dort prüfen und ablegen.${r.length - neu ? ` ${r.length - neu} waren schon vorhanden.` : ''}`);
    setSeite('postfach');
    window.dispatchEvent(new Event('hv-daten'));
    setTimeout(() => setMeldung(''), 6000);
  }

  // Files dropped anywhere on the window go to the inbox.
  async function abgelegt(e: React.DragEvent) {
    e.preventDefault();
    setZiehen(false);
    if (!e.dataTransfer.files.length) return;
    const r = await window.hv.importieren(e.dataTransfer.files);
    const neu = r.filter((x) => !x.doppelt).length;
    setMeldung(`${neu} Dokument(e) ins Postfach gelegt${r.length - neu ? `, ${r.length - neu} waren schon vorhanden` : ''}.`);
    window.dispatchEvent(new Event('hv-daten'));
    setTimeout(() => setMeldung(''), 5000);
  }

  // Keep a valid object selected for the current mode.
  useEffect(() => {
    if (!objekte) return;
    if (!objekte.some((o) => o.id === objektId)) setObjektId(objekte[0]?.id ?? null);
  }, [objekte]);
  useEffect(() => {
    if (objektId) schreiben(`objekt_${modus}`, String(objektId));
  }, [objektId, modus]);

  // Each mode remembers its own last page and selected object/project.
  function wechsle(m: Modus) {
    schreiben(`seite_${modus}`, seite);
    setModus(m);
    setSeite(lesen(`seite_${m}`) ?? (m === 'projekt' ? 'pcockpit' : 'uebersicht'));
    setObjektId(Number(lesen(`objekt_${m}`)) || null);
  }

  const objekt = objekte?.find((o) => o.id === objektId);
  const sichtbar = SEITEN.filter((s) => s.alle || (s.modi ? s.modi.includes(modus) : modus !== 'projekt'));
  const aktiv = sichtbar.find((s) => s.id === seite) ?? sichtbar.find((s) => s.gruppe === 'Start') ?? sichtbar[0];
  const label = (s: Seite) => (typeof s.label === 'function' ? s.label(modus) : s.label);
  const REIHENFOLGE = ['Start', 'Projekte', 'Stammdaten', 'Dokumente', 'Buchhaltung', 'Abrechnung', 'Verwaltung', 'Kommunikation', 'System'];
  const gruppen = [...new Set(sichtbar.map((s) => s.gruppe))].sort((a, b) => REIHENFOLGE.indexOf(a) - REIHENFOLGE.indexOf(b));

  const ctx: Ctx | null = objekte
    ? { modus, objekt: objekt!, objekte, ladeObjekte, oeffne: (s, id) => { if (id) setObjektId(id); setSeite(s); }, akte: setAkte }
    : null;

  return (
    <div className={`app${ziehen ? ' ziehen' : ''}`} onDragOver={(e) => { e.preventDefault(); setZiehen(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setZiehen(false); }} onDrop={abgelegt}>
      <header>
        <div className="brand"><I.House size={19} strokeWidth={2.4} />Hausverwalter</div>
        <div className="modus" role="tablist">
          <button role="tab" aria-selected={modus === 'miete'} onClick={() => wechsle('miete')}><I.KeyRound size={15} />Mietverwaltung</button>
          <button role="tab" aria-selected={modus === 'weg'} onClick={() => wechsle('weg')}><I.Building2 size={15} />WEG-Verwaltung</button>
          <button role="tab" aria-selected={modus === 'projekt'} onClick={() => wechsle('projekt')}><I.Hammer size={15} />Projekte</button>
        </div>
        <button className="schnell" title="Dateien auswählen – sie landen zur Prüfung im Postfach" onClick={schnellAblegen}><I.FilePlus2 size={16} />Dokumente ablegen</button>
        <Suche onDokument={setDokOffen} onPerson={setAkte} oeffne={(seite, objektId) => { if (objektId) setObjektId(objektId); setSeite(seite); }} />
        <label className="objektwahl">
          {modus === 'projekt' ? 'Projekt' : 'Objekt'}
          <select value={objektId ?? ''} onChange={(e) => setObjektId(Number(e.target.value))} disabled={!objekte?.length}>
            {!objekte?.length && <option value="">{modus === 'projekt' ? '– noch keine Projekte –' : '– noch keine Objekte –'}</option>}
            {objekte?.map((o) => (
              <option key={o.id} value={o.id}>{o.bezeichnung ?? o.titel}{o.art === 'gemischt' ? ' (gemischt)' : ''}</option>
            ))}
          </select>
        </label>
      </header>
      <nav>
        {gruppen.map((g) => {
          const zu = zugeklappt.includes(g) && !sichtbar.some((x) => x.gruppe === g && x.id === aktiv.id);
          return (
            <div key={g} className={`navgruppe${zu ? ' zu' : ''}`}>
              <h4><button onClick={() => klappen(g)} aria-expanded={!zu}>{g}<I.ChevronDown size={15} /></button></h4>
              {!zu && sichtbar.filter((s) => s.gruppe === g).map((s) => {
                const Icon = ICON[s.id] ?? I.Dot;
                return (
                  <button key={s.id} className={`eintrag${aktiv.id === s.id ? ' active' : ''}`} onClick={() => setSeite(s.id)}>
                    <Icon size={17} strokeWidth={2} />{label(s)}{s.id === 'postfach' && !!postfach && <span className="zaehler">{postfach}</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
      <main>
        {!ctx ? null : aktiv.objekt && !objekt ? (
          <div className="leer">
            <p>{modus === 'projekt' ? 'Bitte zuerst ein Projekt anlegen.' : 'Bitte zuerst ein Objekt anlegen.'}</p>
            <button className="primary" onClick={() => setSeite(modus === 'projekt' ? 'projekte' : 'objekte')}>{modus === 'projekt' ? 'Zu den Projekten' : 'Zu den Objekten'}</button>
          </div>
        ) : (
          aktiv.render(ctx)
        )}
      </main>
      <footer>{meldung ? <b>{meldung}</b> : objekt ? (modus === 'projekt' ? `Projekt: ${objekt.titel}${objekt.objekt ? ` · ${objekt.objekt}` : ''}` : `${objekt.bezeichnung} · ${OBJEKT_ART[objekt.art]}`) : ''}</footer>
      {ziehen && <div className="dropzone">Dateien loslassen – sie landen im Postfach</div>}
      {akte && <PersonAkte personId={akte} onClose={() => setAkte(null)} />}
      {dokOffen && <DokumentDialog id={dokOffen.id} datei={dokOffen.datei} onClose={() => setDokOffen(null)} />}
    </div>
  );
}
