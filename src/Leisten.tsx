// Notes at the bottom of the window that concern the program itself: a newer Mac app, an app too old for the server, or
// reading without a connection.
import { useEffect, useState } from 'react';
import { verbindungBeobachten, type status, type Update, type Verbindung } from './bruecke';
import { fehler } from './api';

export function Leisten(props: { status: Awaited<ReturnType<typeof status>> }) {
  const d = window.hvDesktop;
  const [update, setUpdate] = useState<Update | null>(null);
  const [fortschritt, setFortschritt] = useState('');
  const [weg, setWeg] = useState(false);
  const [v, setV] = useState<Verbindung | null>(null);
  useEffect(() => verbindungBeobachten(setV), []);
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
  if (v?.offline || props.status.offline) {
    const stand = v?.offline ? new Date(v.offline).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
    return (
      <div className="leiste rot">
        <span><b>Keine Verbindung</b> – du siehst {stand ? `den Stand von ${stand}` : 'den zuletzt geladenen Stand'}. Änderungen sammelt Mietshaus auf diesem Gerät und überträgt sie, sobald die Verbindung wieder steht.</span>
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
