// Traffic light in the header: green – connected, everything up to date; yellow – saving, loading, reconnecting or
// documents still being read; red – no connection to the server; grey – local mode (data on this Mac).
// A click shows the details (server, user, response time, version, newest change) and can reconnect. Changes kept on
// this device without a connection are listed there; a conflict is decided there (send anyway, or discard).
import { useEffect, useState } from 'react';
import { farbe, neuVerbinden, verbindungBeobachten, type Verbindung } from './bruecke';
import * as ausgang from './ausgang';
import { bestaetigen } from './frage';

const TEXT = { gruen: 'Verbunden – alles aktuell', gelb: 'Arbeitet …', rot: 'Keine Verbindung zum Server', grau: 'Lokal auf diesem Mac' };
const vorher = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso.replace(' ', 'T')).getTime()) / 1000));
  return s < 60 ? 'gerade eben' : s < 3600 ? `vor ${Math.round(s / 60)} Min.` : s < 86400 ? `vor ${Math.round(s / 3600)} Std.` : new Date(iso.replace(' ', 'T')).toLocaleString('de-DE');
};

export function Ampel(props: { benutzer?: string | null }) {
  const [v, setV] = useState<Verbindung | null>(null);
  const [offen, setOffen] = useState(false);
  const [, setTakt] = useState(0);
  // Flickering is avoided: yellow only shows after a quarter second of work.
  const [gelbAb, setGelbAb] = useState<number | null>(null);
  useEffect(() => verbindungBeobachten(setV), []);
  const [wartend, setWartend] = useState<ausgang.Eintrag[]>([]);
  useEffect(() => ausgang.beobachten((_, l) => setWartend(l.sort((a, b) => a.nr! - b.nr!))), []);
  const stockt = wartend.find((e) => e.status !== 'wartet');
  useEffect(() => { const t = setInterval(() => setTakt((x) => x + 1), 2000); return () => clearInterval(t); }, []);
  const roh = v ? farbe(v) : 'gelb';
  useEffect(() => { setGelbAb(roh === 'gelb' ? (gelbAb ?? Date.now()) : null); }, [roh]);
  if (!v) return null;
  const lokal = !!window.hvDesktop?.lokal;
  const f0 = lokal && roh !== 'rot' ? 'grau' : roh === 'gelb' && gelbAb && Date.now() - gelbAb < 250 ? 'gruen' : roh;
  // Waiting changes keep the light from green until they are on the server.
  const f = f0 === 'gruen' && wartend.length ? 'gelb' : f0;
  const titel = wartend.length ? `${TEXT[f0]} – ${wartend.length} ${wartend.length === 1 ? 'Änderung wartet' : 'Änderungen warten'} auf dem Gerät` : TEXT[f];
  const gelbGrund = v.strom !== 'offen' ? 'verbindet neu' : v.offen > 0 ? 'speichert oder lädt' : (v.puls?.analyse ?? 0) > 0 ? `liest ${v.puls!.analyse} Dokument(e)` : '';
  return (
    <div className="ampel-rahmen">
      <button className={`ampel ${f}`} title={titel} aria-label={titel} onClick={() => setOffen(!offen)}><span />{!!wartend.length && <b className="ampel-zahl">{wartend.length}</b>}</button>
      {offen && (
        <div className="ampel-details" role="dialog">
          <b>{TEXT[f0]}{f0 === 'gelb' && gelbGrund ? ` (${gelbGrund})` : ''}{v.offline ? ' – offline lesen' : ''}</b>
          <dl>
            <dt>Server</dt><dd>{lokal ? 'eingebaut, auf diesem Mac' : location.host}</dd>
            {props.benutzer && <><dt>Angemeldet</dt><dd>{props.benutzer}</dd></>}
            {v.latenz != null && <><dt>Antwortzeit</dt><dd>{v.latenz} ms</dd></>}
            {v.puls && <><dt>Version</dt><dd>{v.puls.version}</dd></>}
            {v.puls?.letzte && <><dt>Letzte Änderung</dt><dd>{vorher(v.puls.letzte.zeit)}{v.puls.letzte.wer ? ` von ${v.puls.letzte.wer}` : ''}</dd></>}
            {v.pulsAm && <><dt>Lebenszeichen</dt><dd>{vorher(new Date(v.pulsAm).toISOString())}</dd></>}
          </dl>
          {f === 'rot' && <p className="klein">Läuft der Server, und ist Tailscale verbunden? Bis die Verbindung wieder steht, sammelt Mietshaus Änderungen auf diesem Gerät und überträgt sie danach.</p>}
          {!!wartend.length && (
            <div className="ausgang">
              <b>{wartend.length} {wartend.length === 1 ? 'Änderung wartet' : 'Änderungen warten'} auf diesem Gerät</b>
              {stockt && <p className="klein fehlertext">{stockt.status === 'konflikt' ? 'Der Server hat eine Rückfrage' : 'Der Server hat eine Änderung abgelehnt'} – die übrigen warten dahinter, damit die Reihenfolge stimmt.</p>}
              <ul>
                {wartend.slice(0, 8).map((e) => (
                  <li key={e.nr} className={e.status !== 'wartet' ? 'stockt' : ''}>
                    <span>{e.titel} <span className="hinweis">· {new Date(e.zeit).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                      {e.meldung && <span className="klein fehlertext"><br />{e.meldung}</span>}</span>
                    {e.status === 'konflikt' && <button className="klein" onClick={() => ausgang.trotzdem(e.nr!)}>{e.konflikt ? 'Meine speichern' : 'Ja, so speichern'}</button>}
                    {e.status !== 'wartet' && <button className="klein" onClick={async () => {
                      if (await bestaetigen(`„${e.titel}“ wirklich verwerfen? Diese Änderung geht dann verloren.`, { titel: 'Änderung verwerfen', ja: 'Verwerfen' })) await ausgang.verwerfen(e.nr!);
                    }}>Verwerfen</button>}
                  </li>
                ))}
                {wartend.length > 8 && <li className="hinweis">… und {wartend.length - 8} weitere</li>}
              </ul>
              {f !== 'rot' && !stockt && <button className="klein" onClick={() => ausgang.senden()}>Jetzt übertragen</button>}
            </div>
          )}
          <div className="buttons">
            <button onClick={neuVerbinden}>Neu verbinden</button>
            {window.hvDesktop && <button onClick={() => window.dispatchEvent(new CustomEvent('hv-zu', { detail: { seite: 'einstellungen' } }))}>Verbindung …</button>}
          </div>
        </div>
      )}
    </div>
  );
}
