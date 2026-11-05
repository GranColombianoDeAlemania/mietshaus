// Illustrated symbols in the cel-shading style (public/symbole, drawn by scripts/symbole – change them there and rebuild).
// They are for navigation and large surfaces from 24 px on; buttons, tables and toolbars keep the line icons. With the
// display setting "Schlicht" the line icon given as ersatz is shown instead.
import type { LucideIcon } from 'lucide-react';
import { useSymbolStil } from './anzeige';

export const SYMBOLE = ['cockpit', 'aufgaben', 'objekte', 'steckbrief', 'einheiten', 'mieter', 'zaehler', 'umlage', 'adressbuch', 'postfach',
  'vorschlaege', 'archiv', 'rechnungen', 'buchungen', 'konten', 'sollstellung', 'op', 'bank', 'darlehen', 'betriebskosten', 'jahresabrechnung',
  'wirtschaftsplan', 'ruecklagen', 'rendite', 'kaution', 'anpassung', 'vermietung', 'uebergabe', 'versammlung', 'beschluesse', 'kontakte',
  'schluessel', 'versicherung', 'briefe', 'vorgaenge', 'kalender', 'pruefung', 'status', 'protokoll', 'export', 'einstellungen', 'glocke',
  'kamera', 'mehr', 'miete', 'projekte', 'zeitplan', 'kosten', 'fotos', 'suche', 'pflichten', 'inventar'] as const;
export type SymbolName = typeof SYMBOLE[number];

// The symbol of each page (ids of SEITEN in App.tsx) and of the three modes.
export const SEITEN_SYMBOL: Record<string, SymbolName> = {
  uebersicht: 'cockpit', pcockpit: 'cockpit', aufgaben: 'aufgaben', projekte: 'projekte', zeitplan: 'zeitplan', pkosten: 'kosten', pdok: 'fotos',
  objekte: 'objekte', steckbrief: 'steckbrief', einheiten: 'einheiten', vertraege: 'mieter', zaehler: 'zaehler', schluessel: 'umlage', personen: 'adressbuch',
  postfach: 'postfach', vorschlaege: 'vorschlaege', archiv: 'archiv', rechnungen: 'rechnungen',
  buchen: 'buchungen', konten: 'konten', soll: 'sollstellung', op: 'op', bank: 'bank', darlehen: 'darlehen',
  nk: 'betriebskosten', wegabr: 'jahresabrechnung', wipl: 'wirtschaftsplan', ruecklagen: 'ruecklagen', auswertung: 'rendite',
  kaution: 'kaution', anpassung: 'anpassung', vermietung: 'vermietung', uebergabe: 'uebergabe', versammlungen: 'versammlung', beschluesse: 'beschluesse',
  kontakte: 'kontakte', schluesselv: 'schluessel', versicherungen: 'versicherung', pflichten: 'pflichten', inventar: 'inventar', briefe: 'briefe', vorgaenge: 'vorgaenge', kalender: 'kalender',
  pruefung: 'pruefung', status: 'status', protokoll: 'protokoll', export: 'export', einstellungen: 'einstellungen',
};
export const MODUS_SYMBOL: Record<string, SymbolName> = { miete: 'miete', weg: 'einheiten', projekt: 'projekte' };

export function Bild(props: { name: SymbolName; groesse?: number; ersatz?: LucideIcon; className?: string }) {
  const stil = useSymbolStil();
  const g = props.groesse ?? 24;
  if (stil === 'schlicht' && props.ersatz) {
    const E = props.ersatz;
    return <E size={Math.round(g * 0.72)} strokeWidth={1.9} aria-hidden="true" className={props.className} />;
  }
  return <img className={`bild ${props.className ?? ''}`} src={`/symbole/${props.name}.svg`} width={g} height={g} alt="" aria-hidden="true" draggable={false} decoding="async" />;
}
