// Navigation: where the app is (mode, page, object, entity), a history for back/forward, and links between
// people, units, contracts, accounts, documents and pages.
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { Modus } from './api';

export type Ort = { modus: Modus; seite: string; objektId: number | null; param?: string };

export type Ziel =
  | { person: number }
  | { einheit: number }
  | { vertrag: number; typ: 'miete' | 'weg' }
  | { konto: number }
  | { objekt: number }
  | { dokument: number; datei?: string }
  | { vorgang: number; objektId?: number | null }
  | { projekt: number }
  | { seite: string; objektId?: number | null; modus?: Modus; aktion?: string };

export type PfadTeil = { label: string; ziel?: Ziel };

// Pages for single records; they are not in the sidebar.
export const DETAILSEITEN = ['person', 'einheit', 'vertrag', 'konto'];

type Navi = {
  ort: Ort;
  zu: (z: Ziel) => void;
  zurueck: () => void;
  vor: () => void;
  kannZurueck: boolean;
  kannVor: boolean;
  setzePfad: (teile: PfadTeil[] | null) => void;
  // Records the object of the open page without a new history entry (e.g. a unit page knows its house).
  setzeObjekt: (objektId: number) => void;
};

export const NaviContext = createContext<Navi | null>(null);
export const useNavi = () => useContext(NaviContext)!;

// A short text form of a link target, used in data attributes (context menu, hover card, drag & drop).
export const zielKey = (z: Ziel): string =>
  'person' in z ? `person:${z.person}`
    : 'einheit' in z ? `einheit:${z.einheit}`
      : 'vertrag' in z ? `vertrag:${z.typ}:${z.vertrag}`
        : 'konto' in z ? `konto:${z.konto}`
          : 'objekt' in z ? `objekt:${z.objekt}`
            : 'dokument' in z ? `dokument:${z.dokument}`
              : 'vorgang' in z ? `vorgang:${z.vorgang}`
                : 'projekt' in z ? `projekt:${z.projekt}`
                  : `seite:${z.seite}`;

export const zielAusKey = (k: string): Ziel | null => {
  const [art, a, b] = k.split(':');
  const n = Number(a);
  switch (art) {
    case 'person': return { person: n };
    case 'einheit': return { einheit: n };
    case 'vertrag': return { vertrag: Number(b), typ: a as 'miete' | 'weg' };
    case 'konto': return { konto: n };
    case 'objekt': return { objekt: n };
    case 'dokument': return { dokument: n };
    case 'vorgang': return { vorgang: n };
    case 'projekt': return { projekt: n };
    default: return null;
  }
};

// Link to a record or page. Inside clickable table rows the row's own action is not triggered.
export function L(props: { zu: Ziel | null | undefined; children: ReactNode; className?: string; title?: string }) {
  const navi = useNavi();
  if (!props.zu) return <>{props.children}</>;
  const z = props.zu;
  return (
    <button type="button" className={`ln${props.className ? ' ' + props.className : ''}`} title={props.title}
      data-ziel={zielKey(z)} {...('person' in z ? { 'data-person': z.person } : {})}
      onClick={(e) => { e.stopPropagation(); navi.zu(z); }}
      onDoubleClick={(e) => e.stopPropagation()}>
      {props.children}
    </button>
  );
}

// Detail pages announce their breadcrumb; it disappears again when the page closes.
export function usePfad(teile: PfadTeil[] | null, deps: unknown[]) {
  const navi = useNavi();
  useEffect(() => {
    navi.setzePfad(teile);
    return () => navi.setzePfad(null);
  }, deps);
}

// Replaces names inside a text with links, e.g. in cockpit hints: [{ text: 'Meier, Anna', ziel: { person: 3 } }].
export function mitLinks(text: string, links: { text: string; ziel: Ziel }[] | undefined): ReactNode {
  if (!links?.length) return text;
  const teile: ReactNode[] = [];
  let rest = text;
  let i = 0;
  while (rest) {
    let best: { pos: number; l: { text: string; ziel: Ziel } } | null = null;
    for (const l of links) {
      const pos = l.text ? rest.indexOf(l.text) : -1;
      if (pos >= 0 && (!best || pos < best.pos)) best = { pos, l };
    }
    if (!best) { teile.push(rest); break; }
    if (best.pos) teile.push(rest.slice(0, best.pos));
    teile.push(<L key={i++} zu={best.l.ziel}>{best.l.text}</L>);
    rest = rest.slice(best.pos + best.l.text.length);
  }
  return <>{teile}</>;
}
