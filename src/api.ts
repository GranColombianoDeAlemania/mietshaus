export type Modus = 'miete' | 'weg' | 'projekt';
export type Row = Record<string, any>;

type DateiFilter = { name: string; extensions: string[] };

declare global {
  interface Window {
    hv: {
      plattform: string;
      zoom: (faktor: number) => void;
      call: (fn: string, ...args: unknown[]) => Promise<any>;
      pdf: (html: string, name: string) => Promise<string | null>;
      steuerpaket: (objektId: number, jahr: number, html: string) => Promise<{ datei: string; belege: number; buchungen: number } | null>;
      pdfAblegen: (html: string, name: string, meta: Row) => Promise<{ id: number; datei: string }>;
      speichern: (inhalt: string, name: string, filter?: DateiFilter) => Promise<string | null>;
      oeffnen: (filter?: DateiFilter) => Promise<{ name: string; base64: string } | null>;
      sicherung: () => Promise<string | null>;
      wiederherstellen: () => Promise<boolean>;
      dokumentAblegen: () => Promise<{ name: string; datei: string; groesse: number }[]>;
      dokumentOeffnen: (datei: string) => Promise<string>;
      dokumentLoeschen: (id: number) => Promise<void>;
      importieren: (files: FileList | File[], opt?: Row) => Promise<{ id: number; doppelt: boolean; name: string }[]>;
      dateienImportieren: (opt?: Row) => Promise<{ id: number; doppelt: boolean; name: string }[]>;
      neuAnalysieren: (id: number) => Promise<void>;
      bei: (kanal: string, fn: (...a: any[]) => void) => () => void;
      extern: (url: string) => Promise<void>;
      info: () => Promise<{ dbFile: string; dokumente: string; version: string }>;
      eingangsordnerWaehlen: () => Promise<string | null>;
      eingangsordnerAus: () => Promise<void>;
      mailSpeichern: (cfg: Row, pw?: string) => Promise<{ verschluesselt: boolean }>;
      mailTesten: () => Promise<string>;
      mailAbrufen: () => Promise<{ neu: number; mails: number }>;
      claudeStatus: () => Promise<{ datei: string; installiert: boolean; verbunden: boolean; eintrag: Row }>;
      claudeVerbinden: () => Promise<{ datei: string; installiert: boolean; verbunden: boolean; eintrag: Row }>;
      kontextmenue: (eintraege: ({ id: string; label: string; enabled?: boolean } | '-')[]) => Promise<string | null>;
    };
  }
}

export const call = <T = any>(fn: string, ...args: unknown[]): Promise<T> => window.hv.call(fn, ...args);

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const num = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 });
const num2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// `|| 0` turns -0 into 0 so nothing prints as "-0,00".
export const euro = (ct: number | null | undefined) => eur.format((ct ?? 0) / 100 || 0);
export const betrag = (ct: number | null | undefined) => num2.format((ct ?? 0) / 100 || 0);
export const zahl = (n: number | null | undefined) => (n == null ? '' : num.format(n));

export const datum = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

export const heute = () => new Date().toISOString().slice(0, 10);
export const diesesJahr = () => new Date().getFullYear();

// Parses German input such as "1.234,56" or "1234.5".
export const parseZahl = (s: string | number | null | undefined): number | null => {
  if (typeof s === 'number') return s;
  const t = (s ?? '').trim();
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
};
export const parseCent = (s: string | number | null | undefined) => Math.round((parseZahl(s) ?? 0) * 100);

export const personName = (p: Row) => {
  const name = [p.nachname, p.vorname].filter(Boolean).join(', ');
  return (name ? name + (p.firma ? ` (${p.firma})` : '') : p.firma) || '(ohne Namen)';
};

// Name as used in letters: "Dr. Anna Meier".
export const briefName = (p: Row) =>
  [p.titel, p.vorname, p.nachname].filter(Boolean).join(' ') || p.firma || '';

const eineAnrede = (p: Row) =>
  p.anrede === 'Herr' ? `Sehr geehrter Herr ${[p.titel, p.nachname].filter(Boolean).join(' ')},`
    : p.anrede === 'Frau' ? `Sehr geehrte Frau ${[p.titel, p.nachname].filter(Boolean).join(' ')},`
      : 'Sehr geehrte Damen und Herren,';
// A letter to a contract addresses every party of it (p.mit: the second tenant or owner).
export const anrede = (p: Row) => {
  const a = eineAnrede(p);
  if (!p.mit) return a;
  const b = eineAnrede(p.mit);
  return a === b ? a : `${a} ${b.charAt(0).toLowerCase()}${b.slice(1)}`;
};
// Due day 0 is the statutory third working day (§ 556b BGB).
export const faelligText = (tag: number | null | undefined) => (!tag ? 'bis zum 3. Werktag des Monats' : `am ${tag}. des Monats`);
// Names of all parties: "Max Muster und Erika Muster".
export const alleNamen = (p: Row) => [briefName(p) || p.firma, p.mit && (briefName(p.mit) || p.mit.firma)].filter(Boolean).join(' und ');

export const OBJEKT_ART: Record<string, string> = {
  miete: 'Mietobjekt',
  weg: 'WEG',
  gemischt: 'Miet/WEG gemischt',
};

export const KLASSEN: Record<string, string> = {
  geld: 'Geldkonten',
  einnahme: 'Einnahmen',
  kosten: 'Kosten',
  ruecklage: 'Rücklagen',
  person: 'Mieter- und Eigentümerkonten',
  darlehen: 'Darlehen',
  steuer: 'Steuerkonten (Umsatzsteuer, Vorsteuer)',
};

export const kontoLabel = (k: Row) => `${k.nr} ${k.bezeichnung}`;

export const fehlerText = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export const fehler = (e: any) => alert(fehlerText(e));
