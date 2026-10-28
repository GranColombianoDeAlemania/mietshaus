// Notes at the bottom of the window that concern the program itself: a newer Mac app, or an app too old for the server.
import { useEffect, useState } from 'react';
import type { status, Update } from './bruecke';
import { fehler } from './api';

export function Leisten(props: { status: Awaited<ReturnType<typeof status>> }) {
  const d = window.hvDesktop;
  const [update, setUpdate] = useState<Update | null>(null);
  const [fortschritt, setFortschritt] = useState('');
  const [weg, setWeg] = useState(false);
  useEffect(() => {
    if (!d) return;
    d.updateStatus().then(setUpdate);
    const a = d.bei('update', setUpdate);
    const b = d.bei('fortschritt', setFortschritt);
    return () => { a(); b(); };
  }, []);
  // The server needs a newer desktop part than this app has: the app has to be updated first.
  const zuAlt = !!d && (props.status.desktop_schnittstelle ?? 1) > (d.schnittstelle ?? 1);
  if (zuAlt) {
    return (
      <div className="leiste rot">
        Diese Mietshaus-App ({d!.version}) ist zu alt für den Server ({props.status.version}). Bitte aktualisieren.
        {update && !update.hindernis && <button className="primary" onClick={() => d!.updateInstallieren().catch(fehler)}>Jetzt aktualisieren</button>}
      </div>
    );
  }
  if (!update || weg) return null;
  return (
    <div className="leiste">
      <span><b>Mietshaus {update.version}</b> ist da (installiert: {d!.version}).</span>
      {fortschritt ? <span className="hinweis">{fortschritt}</span> : <>
        <button className="link" onClick={() => window.hv.extern(update.url)}>Was ist neu?</button>
        {update.hindernis ? <span className="hinweis klein">{update.hindernis}</span>
          : <button className="primary" onClick={() => d!.updateInstallieren().catch((e) => { setFortschritt(''); fehler(e); })}>Jetzt aktualisieren</button>}
        <button className="link" onClick={() => setWeg(true)}>Später</button>
      </>}
    </div>
  );
}
