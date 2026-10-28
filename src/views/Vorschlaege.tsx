// Claude's proposals for bookings, contracts and bank details: nothing of this takes effect before the user accepts it.
import { useState } from 'react';
import { call, fehler, type Row } from '../api';
import { useLoad } from '../useLoad';
import { Tabs } from '../ui';

const WERKZEUG: Record<string, string> = {
  rechnung_buchen: 'Rechnung buchen', buchen: 'Buchung', person_aendern: 'Person ändern', mietvertrag_anlegen: 'Mietvertrag',
  eigentum_anlegen: 'Eigentum', vertrag_beenden: 'Vertragsende', weg_kosten_uebernehmen: 'WEG-Kosten umbuchen',
};
const zeit = (iso: string | null) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '');

export function Vorschlaege() {
  const [status, setStatus] = useState<'offen' | 'uebernommen' | 'verworfen'>('offen');
  const [liste, reload] = useLoad<Row[]>(() => call('vorschlaege', status), [status]);
  const [meldung, setMeldung] = useState('');
  const [laeuft, setLaeuft] = useState<number | null>(null);
  const tun = async (v: Row, uebernehmen: boolean) => {
    setLaeuft(v.id);
    try {
      if (uebernehmen) setMeldung(`Übernommen: ${await call('vorschlagUebernehmen', v.id)}`);
      else { await call('vorschlagVerwerfen', v.id); setMeldung('Verworfen.'); }
      reload();
    } catch (e) { fehler(e); } finally { setLaeuft(null); }
  };
  return (
    <section>
      <div className="toolbar"><h1>Vorschläge von Claude</h1>
        <Tabs value={status} onChange={setStatus} tabs={[['offen', 'Offen'], ['uebernommen', 'Übernommen'], ['verworfen', 'Verworfen']]} />
      </div>
      <p className="hinweis">
        Buchungen, Verträge und Änderungen an Personen (z. B. eine neue Bankverbindung) legt Claude nur als Vorschlag an. Erst wenn du ihn hier
        übernimmst, wird gebucht oder gespeichert – so kann eine gefälschte Rechnung im Postfach nichts von selbst auslösen. Übernommene Vorschläge
        lassen sich im Änderungsprotokoll rückgängig machen. Abschalten kannst du die Freigabe unter Einstellungen → Claude Desktop.
      </p>
      {meldung && <p className="meldung">{meldung}</p>}
      {liste && !liste.length && <div className="leer"><p>{status === 'offen' ? 'Keine offenen Vorschläge.' : 'Keine Einträge.'}</p></div>}
      <ul className="vorschlagliste">
        {liste?.map((v) => (
          <li key={v.id} className="panel">
            <div className="kz-zeile"><b>{WERKZEUG[v.werkzeug] ?? v.werkzeug}</b><span className="klein hinweis">Nr. {v.id} · {zeit(v.erstellt)}</span></div>
            <p>{v.beschreibung}</p>
            {v.ergebnis && <p className="klein hinweis">{v.ergebnis} ({zeit(v.erledigt)})</p>}
            <details className="klein"><summary className="hinweis">Angaben von Claude</summary><pre>{JSON.stringify(JSON.parse(v.argumente), null, 2)}</pre></details>
            {v.status === 'offen' && (
              <div className="buttons">
                <button onClick={() => tun(v, false)} disabled={laeuft === v.id}>Verwerfen</button>
                <button className="primary" onClick={() => tun(v, true)} disabled={laeuft === v.id}>Übernehmen</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
