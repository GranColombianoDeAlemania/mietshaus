// Change log: who changed what and when (app or Claude), with the changed fields side by side.
import { useState } from 'react';
import { call, euro, type Row } from '../api';
import { useLoad } from '../useLoad';
import { L, type Ziel } from '../navi';

// Records that have their own page get a link (deleted ones are not checked; the page then shows nothing).
const protokollZiel = (r: Row): Ziel | null => {
  if (r.aktion === 'gelöscht') return null;
  const id = Number(r.datensatz);
  switch (r.tabelle) {
    case 'personen': return { person: id };
    case 'einheiten': return { einheit: id };
    case 'mietverhaeltnisse': return { vertrag: id, typ: 'miete' };
    case 'eigentum': return { vertrag: id, typ: 'weg' };
    case 'konten': return { konto: id };
    case 'objekte': return { objekt: id };
    case 'dokumente': return { dokument: id };
    default: return null;
  }
};

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
              : (() => { const o = JSON.parse(r.neu ?? r.alt ?? '{}'); return [o.bezeichnung, o.titel, o.text, o.nachname, o.betrag_ct != null ? euro(o.betrag_ct) : null].filter(Boolean).join(' · '); })();
            return (
              <tr key={r.id} className="klickbar" onClick={() => setOffen(offen === r.id ? null : r.id)}>
                <td className="klein" style={{ whiteSpace: 'nowrap' }}>{r.zeit}</td>
                <td><span className={`tag ${r.quelle === 'claude' ? 'art-weg' : ''}`}>{r.quelle === 'claude' ? 'Claude' : 'Programm'}</span></td>
                <td>{TABELLEN[r.tabelle] ?? r.tabelle} {protokollZiel(r) ? <L zu={protokollZiel(r)}>#{r.datensatz}</L> : <span className="klein hinweis">#{r.datensatz}</span>}</td>
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
