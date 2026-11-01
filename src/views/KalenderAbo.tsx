// Calendar subscription for the iPhone or Mac calendar: a personal secret link (server only). A new link stops the old one.
import { useState } from 'react';
import { call, fehler } from '../api';
import { bestaetigen } from '../frage';

export function KalenderAbo(props: { onClose: () => void }) {
  const [link, setLink] = useState<string | null>(null);
  const [meldung, setMeldung] = useState('');
  const erstellen = async () => {
    if (!await bestaetigen('Einen neuen Abo-Link erstellen? Ein früherer Link hört dann auf zu funktionieren.', { ja: 'Link erstellen' })) return;
    try {
      const { token } = await call<{ token: string }>('kalenderAbo');
      setLink(`${location.origin}/kalender/${token}.ics`);
    } catch (e) { fehler(e); }
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="dialog">
        <h2>Kalender-Abo</h2>
        <p>Termine, Fristen, deine Vorgänge und Projekttermine erscheinen im Kalender von iPhone, iPad oder Mac und werden etwa stündlich aktualisiert.</p>
        <ul className="klein">
          <li>Das Abo aktualisiert sich nur, wenn <b>Tailscale</b> auf dem Gerät verbunden ist.</li>
          <li>Im Kalender stehen keine Beträge und keine Namen von Mietern. Beim Hinzufügen auf dem iPhone am besten „Konto: Auf meinem iPhone“ wählen, nicht iCloud.</li>
          <li>Der Link ist wie ein Passwort: nicht weitergeben. Ein neuer Link sperrt den alten.</li>
        </ul>
        {link ? (
          <>
            <label className="block">Dein Abo-Link<input readOnly value={link} onFocus={(e) => e.target.select()} /></label>
            <div className="buttons">
              <button onClick={async () => { await navigator.clipboard.writeText(link); setMeldung('Link kopiert.'); }}>Link kopieren</button>
              <button className="primary" onClick={() => window.hv.extern(link.replace(/^https?:/, 'webcal:'))}>Im Kalender öffnen</button>
              {meldung && <span className="meldung">{meldung}</span>}
            </div>
            <p className="klein hinweis">Auf dem iPhone geht es auch so: Einstellungen → Apps → Kalender → Kalenderaccounts → Account hinzufügen → Andere → Kalenderabo hinzufügen → Link einfügen.</p>
          </>
        ) : null}
        <div className="buttons">
          <button onClick={erstellen}>{link ? 'Neuen Link erstellen' : 'Abo-Link erstellen'}</button>
          <span className="spacer" />
          <button onClick={props.onClose}>Schließen</button>
        </div>
      </div>
    </div>
  );
}
