// The notification bell in the header: what happened for me (new documents, cases assigned or due, comments, server
// and backup warnings). A click opens the matter and marks it read; it refreshes as notifications arrive.
import { useEffect, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { AlertTriangle, Bell, CalendarClock, CheckCheck, Inbox, ListChecks, MessageSquare, Server, type LucideIcon } from 'lucide-react';
import { call, type Row } from './api';
import { Bild, type SymbolName } from './Symbol';
import { useLoad } from './useLoad';
import { useNavi } from './navi';

const SYMBOLE: Record<string, [SymbolName, LucideIcon]> = { postfach: ['postfach', Inbox], aufgaben: ['aufgaben', ListChecks], faellig: ['kalender', CalendarClock],
  kommentar: ['briefe', MessageSquare], sicherung: ['status', AlertTriangle], server: ['status', Server] };

const wann = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  if (min < 24 * 60) return `vor ${Math.round(min / 60)} Std.`;
  return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
};

export function Glocke(props: { klein?: boolean }) {
  const navi = useNavi();
  const [offen, setOffen] = useState(false);
  const [zahl, ladeZahl] = useLoad<number>(() => call('mitteilungenUngelesen'), []);
  const [liste, ladeListe] = useLoad<Row[]>(() => (offen ? call('mitteilungen') : Promise.resolve([])), [offen]);
  useEffect(() => window.hv.bei('benachrichtigung', () => { ladeZahl(); ladeListe(); }), [ladeZahl, ladeListe]);
  const oeffnen = async (m: Row) => {
    if (!m.gelesen) await call('mitteilungGelesen', m.id);
    setOffen(false);
    ladeZahl();
    if (m.ziel) navi.zu(m.ziel);
  };
  return (
    <Popover.Root open={offen} onOpenChange={setOffen}>
      <Popover.Trigger asChild>
        <button className={`rund glocke${props.klein ? ' klein' : ''}`} aria-label={zahl ? `Mitteilungen, ${zahl} ungelesen` : 'Mitteilungen'} title="Mitteilungen">
          <Bild name="glocke" groesse={props.klein ? 28 : 24} ersatz={Bell} />{props.klein && <span>Mitteilungen</span>}{!!zahl && <span className="glocke-zahl" aria-hidden="true">{zahl > 99 ? '99+' : zahl}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="glocke-liste" align="end" sideOffset={8} collisionPadding={8}>
          <div className="glocke-kopf">
            <b>Mitteilungen</b>
            <span className="spacer" />
            {!!zahl && <button className="link klein" onClick={async () => { await call('alleMitteilungenGelesen'); ladeZahl(); ladeListe(); }}>
              <CheckCheck size={14} /> Alle gelesen</button>}
          </div>
          {liste && !liste.length && <p className="hinweis klein glocke-leer">Keine Mitteilungen. Neue Dokumente, zugewiesene und fällige Aufgaben erscheinen hier.</p>}
          <ul>
            {liste?.map((m) => {
              const [bild, S] = SYMBOLE[m.art] ?? (['glocke', Bell] as [SymbolName, LucideIcon]);
              return (
                <li key={m.id}>
                  <button className={m.gelesen ? '' : 'ungelesen'} onClick={() => oeffnen(m)}>
                    <Bild name={bild} groesse={26} ersatz={S} />
                    <span className="glocke-text"><b>{m.titel}</b>{m.text && <span className="klein">{m.text}</span>}</span>
                    <span className="klein hinweis glocke-zeit">{wann(m.erstellt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
