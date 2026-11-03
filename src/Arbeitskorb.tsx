// Work basket: the queue on the left, the work on the right. J/K (or the arrow keys in the list) move through it; when
// the current item leaves the queue (filed, booked, done) the next one at the same place opens – "… und weiter".
// On a phone the list and the item take turns, with a back button.
import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

const schmal = () => typeof matchMedia === 'function' && matchMedia('(max-width: 800px)').matches;

export function Arbeitskorb<T>(props: {
  eintraege: T[] | undefined;
  id: (x: T) => number | string;
  zeile: (x: T) => ReactNode;
  detail: (x: T) => ReactNode;
  // Extra controls per row (checkbox, delete), outside the row's own button.
  vor?: (x: T) => ReactNode;
  nach?: (x: T) => ReactNode;
  kopf?: ReactNode;
  leer?: ReactNode;
  zeilenKlasse?: (x: T) => string;
  liProps?: (x: T) => HTMLAttributes<HTMLLIElement>;
  className?: string;
}) {
  const liste = props.eintraege;
  const [aktiv, setAktiv] = useState<number | string | null>(null);
  const [handyDetail, setHandyDetail] = useState(false);
  const letzterIndex = useRef(0);
  const listeRef = useRef<HTMLUListElement>(null);

  // Keep a valid item selected: the same one, else the one now at its old place.
  useEffect(() => {
    if (!liste) return;
    const i = liste.findIndex((x) => props.id(x) === aktiv);
    if (i >= 0) { letzterIndex.current = i; return; }
    const n = liste[Math.min(letzterIndex.current, liste.length - 1)];
    setAktiv(n ? props.id(n) : null);
    if (!n) setHandyDetail(false);
  }, [liste]);

  const waehlen = (x: T) => {
    setAktiv(props.id(x));
    if (schmal()) setHandyDetail(true);
  };
  const blaettern = (schritt: number) => {
    if (!liste?.length) return;
    const i = Math.max(0, Math.min(liste.length - 1, liste.findIndex((x) => props.id(x) === aktiv) + schritt));
    setAktiv(props.id(liste[i]));
    listeRef.current?.querySelectorAll('li.eintrag')[i]?.scrollIntoView({ block: 'nearest' });
  };
  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;
      if (e.key === 'j' || e.key === 'J') { e.preventDefault(); blaettern(1); }
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); blaettern(-1); }
    };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  });

  const x = liste?.find((y) => props.id(y) === aktiv);
  return (
    <div className={`arbeitskorb${handyDetail ? ' zeigt-detail' : ''} ${props.className ?? ''}`}>
      <div className="korb-liste">
        {props.kopf}
        <ul ref={listeRef} onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); blaettern(1); } if (e.key === 'ArrowUp') { e.preventDefault(); blaettern(-1); } }}>
          {liste?.map((y) => {
            const id = props.id(y);
            return (
              <li key={id} {...props.liProps?.(y)} className={`eintrag${id === aktiv ? ' aktiv' : ''} ${props.zeilenKlasse?.(y) ?? ''}`}>
                {props.vor?.(y)}
                <button className="korb-zeile" aria-current={id === aktiv ? 'true' : undefined} onClick={() => waehlen(y)}>{props.zeile(y)}</button>
                {props.nach?.(y)}
              </li>
            );
          })}
        </ul>
        {liste && !liste.length && <div className="korb-leer">{props.leer ?? 'Nichts zu tun.'}</div>}
        {!!liste?.length && <p className="klein hinweis korb-tasten">noch {liste.length} · <kbd>J</kbd> <kbd>K</kbd> blättern</p>}
      </div>
      <div className="korb-detail">
        <button className="link korb-zurueck" onClick={() => setHandyDetail(false)}><ChevronLeft size={16} /> Liste</button>
        {x ? props.detail(x) : null}
      </div>
    </div>
  );
}
