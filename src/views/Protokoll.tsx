// Change log: who changed what and when (app or Claude), with the changed fields side by side.
import { useState } from 'react';
import { call, type Row } from '../api';
import { useLoad } from '../useLoad';

const TABELLEN: Record<string, string> = {
  buchungen: 'Buchungen', konten: 'Konten', personen: 'Personen', mietverhaeltnisse: 'Mietverhältnisse', eigentum: 'Eigentum',
  objekte: 'Objekte', einheiten: 'Einheiten', anpassungen: 'Mietanpassungen', kautionen: 'Kautionen', kautionsbewegungen: 'Kautionsbewegungen',
  dokumente: 'Dokumente', darlehen: 'Darlehen', beschluesse: 'Beschlüsse', projekte: 'Projekte', projektposten: 'Projektposten',
  zaehlerstaende: 'Zählerstände', mahnungen: 'Mahnungen', abrechnungen: 'Abrechnungen',
};

function unterschiede(alt: Row | null, neu: Row | null) {
  const keys = [...new Set([...Object.keys(alt ?? {}), ...Object.keys(neu ?? {})])];
  return keys.filter((k) => !alt || !neu || JSON.stringify(alt[k]) !== JSON.stringify(neu[k]))
    .filter((k) => (alt?.[k] ?? null) !== null || (neu?.[k] ?? null) !== null)
    .map((k) => [k, alt?.[k], neu?.[k]] as [string, unknown, unknown]);
}
const zeige = (v: unknown) => (v == null || v === '' ? '–' : typeof v === 'string' ? v : JSON.stringify(v));

export function Protokoll() {
  const [tabelle, setTabelle] = useState('');
  const [quelle, setQuelle] = useState('');
  const [suche, setSuche] = useState('');
  const [rows] = useLoad<Row[]>(() => call('protokoll', { tabelle: tabelle || null, quelle: quelle || null, suche }), [tabelle, quelle, suche]);
  const [offen, setOffen] = useState<number | null>(null);
  return (
    <section>
      <div className="toolbar">
        <h1>Änderungsprotokoll</h1>
        <select value={tabelle} onChange={(e) => setTabelle(e.target.value)}><option value="">alle Bereiche</option>
          {Object.entries(TABELLEN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={quelle} onChange={(e) => setQuelle(e.target.value)}><option value="">alle Quellen</option><option value="app">Programm</option><option value="claude">Claude</option></select>
        <input className="suche" placeholder="Inhalt suchen…" value={suche} onChange={(e) => setSuche(e.target.value)} />
      </div>
      <p className="hinweis klein">
        Jede Anlage, Änderung und Löschung wird mit Zeit und Quelle festgehalten (die letzten 500 werden angezeigt). Buchungen in festgeschriebenen
        Zeiträumen lassen sich nur noch stornieren – den Zeitraum legst du unter Einstellungen fest.
      </p>
      <table>
        <thead><tr><th>Zeit</th><th>Quelle</th><th>Bereich</th><th>Aktion</th><th>Änderung</th></tr></thead>
        <tbody>
          {rows?.map((r) => {
            const d = unterschiede(r.alt ? JSON.parse(r.alt) : null, r.neu ? JSON.parse(r.neu) : null);
            const zusammen = r.aktion === 'geändert' ? d.slice(0, 3).map(([k, a, n]) => `${k}: ${zeige(a)} → ${zeige(n)}`).join(' · ')
              : (() => { const o = JSON.parse(r.neu ?? r.alt ?? '{}'); return [o.bezeichnung, o.titel, o.text, o.nachname, o.betrag_ct != null ? `${(o.betrag_ct / 100).toFixed(2)} €` : null].filter(Boolean).join(' · '); })();
            return (
              <tr key={r.id} className="klickbar" onClick={() => setOffen(offen === r.id ? null : r.id)}>
                <td className="klein" style={{ whiteSpace: 'nowrap' }}>{r.zeit}</td>
                <td><span className={`tag ${r.quelle === 'claude' ? 'art-weg' : ''}`}>{r.quelle === 'claude' ? 'Claude' : 'Programm'}</span></td>
                <td>{TABELLEN[r.tabelle] ?? r.tabelle} <span className="klein hinweis">#{r.datensatz}</span></td>
                <td>{r.aktion}</td>
                <td className="klein">{offen === r.id
                  ? <table className="positionen"><tbody>{d.map(([k, a, n]) => <tr key={k}><td><b>{k}</b></td><td>{zeige(a)}</td><td>→ {zeige(n)}</td></tr>)}</tbody></table>
                  : <>{zusammen}{d.length > 3 && r.aktion === 'geändert' ? ` (+${d.length - 3})` : ''}</>}</td>
              </tr>
            );
          })}
          {rows && !rows.length && <tr><td colSpan={5} className="hinweis">Keine Einträge.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
