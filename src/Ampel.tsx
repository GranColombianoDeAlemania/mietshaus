// Traffic light in the header: green – connected, everything up to date; yellow – saving, loading, reconnecting or
// documents still being read; red – no connection to the server; grey – local mode (data on this Mac).
// A click shows the details (server, user, response time, version, newest change) and can reconnect.
import { useEffect, useState } from 'react';
import { farbe, neuVerbinden, verbindungBeobachten, type Verbindung } from './bruecke';

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
  useEffect(() => { const t = setInterval(() => setTakt((x) => x + 1), 2000); return () => clearInterval(t); }, []);
  const roh = v ? farbe(v) : 'gelb';
  useEffect(() => { setGelbAb(roh === 'gelb' ? (gelbAb ?? Date.now()) : null); }, [roh]);
  if (!v) return null;
  const lokal = !!window.hvDesktop?.lokal;
  const f = lokal && roh !== 'rot' ? 'grau' : roh === 'gelb' && gelbAb && Date.now() - gelbAb < 250 ? 'gruen' : roh;
  const gelbGrund = v.strom !== 'offen' ? 'verbindet neu' : v.offen > 0 ? 'speichert oder lädt' : (v.puls?.analyse ?? 0) > 0 ? `liest ${v.puls!.analyse} Dokument(e)` : '';
  return (
    <div className="ampel-rahmen">
      <button className={`ampel ${f}`} title={TEXT[f]} aria-label={TEXT[f]} onClick={() => setOffen(!offen)}><span /></button>
      {offen && (
        <div className="ampel-details" role="dialog">
          <b>{TEXT[f]}{f === 'gelb' && gelbGrund ? ` (${gelbGrund})` : ''}</b>
          <dl>
            <dt>Server</dt><dd>{lokal ? 'eingebaut, auf diesem Mac' : location.host}</dd>
            {props.benutzer && <><dt>Angemeldet</dt><dd>{props.benutzer}</dd></>}
            {v.latenz != null && <><dt>Antwortzeit</dt><dd>{v.latenz} ms</dd></>}
            {v.puls && <><dt>Version</dt><dd>{v.puls.version}</dd></>}
            {v.puls?.letzte && <><dt>Letzte Änderung</dt><dd>{vorher(v.puls.letzte.zeit)}{v.puls.letzte.wer ? ` von ${v.puls.letzte.wer}` : ''}</dd></>}
            {v.pulsAm && <><dt>Lebenszeichen</dt><dd>{vorher(new Date(v.pulsAm).toISOString())}</dd></>}
          </dl>
          {f === 'rot' && <p className="klein">Läuft der Server, und ist Tailscale verbunden? Bis die Verbindung wieder steht, wird nichts gespeichert.</p>}
          <div className="buttons">
            <button onClick={neuVerbinden}>Neu verbinden</button>
            {window.hvDesktop && <button onClick={() => window.dispatchEvent(new CustomEvent('hv-zu', { detail: { seite: 'einstellungen' } }))}>Verbindung …</button>}
          </div>
        </div>
      )}
    </div>
  );
}
