// Ideas and faults noted in Jago: open ones first, each with what was going on. Done or dropped with a note; all open
// ones as text to hand on for working on them (e.g. to Claude).
import { useState } from 'react';
import * as I from 'lucide-react';
import { call, datum, fehler, type Row } from '../api';
import { useLoad } from '../useLoad';
import { Tabs } from '../ui';
import { jagoOeffnen } from '../Jago';

type Filter = 'offen' | 'erledigt' | 'alle';
const STATUS: Record<string, string> = { offen: 'offen', erledigt: 'erledigt', verworfen: 'verworfen' };

export function Rueckmeldungen() {
  const [filter, setFilter] = useState<Filter>('offen');
  const [liste, reload] = useLoad<Row[]>(() => call('rueckmeldungen', {}), []);
  const [auf, setAuf] = useState<number | null>(null);
  const zeigen = (liste ?? []).filter((r) => filter === 'alle' || (filter === 'offen' ? r.status === 'offen' : r.status !== 'offen'));
  const tun = async (fn: () => Promise<unknown>) => { try { await fn(); reload(); } catch (e) { fehler(e); } };
  // The note is edited right in the entry (what was done, or why not).
  const [notiz, setNotiz] = useState<{ id: number; text: string } | null>(null);
  async function alsText() {
    try {
      const text = await call<string>('rueckmeldungenText', { status: 'offen' });
      const ziel = await window.hv.speichern(text, `Mietshaus Ideen und Fehler ${new Date().toISOString().slice(0, 10)}.md`, { name: 'Text', extensions: ['md'] });
      if (!ziel) await navigator.clipboard?.writeText(text).catch(() => {});
    } catch (e) { fehler(e); }
  }
  const offen = (liste ?? []).filter((r) => r.status === 'offen');
  return (
    <section>
      <div className="toolbar"><h1>Ideen & Fehler</h1>
        <span className="hinweis klein">{offen.filter((r) => r.art === 'fehler').length} Fehler und {offen.filter((r) => r.art === 'idee').length} Ideen offen</span>
        <span className="spacer" />
        <button disabled={!offen.length} onClick={alsText} title="Alle offenen Einträge mit Angaben zur Fehlersuche, zum Weitergeben">Als Text speichern</button>
        <button onClick={() => jagoOeffnen({ art: 'idee' })}><I.Lightbulb size={15} aria-hidden="true" /> Idee</button>
        <button className="primary" onClick={() => jagoOeffnen({ art: 'fehler' })}><I.Bug size={15} aria-hidden="true" /> Fehler melden</button>
      </div>
      <p className="hinweis klein">Was in Jago festgehalten wird, steht hier. „Als Text speichern“ gibt alle offenen Einträge mit Seite, Version, Gerät und den letzten Fehlermeldungen aus – so setzen wir sie gemeinsam um.</p>
      <Tabs tabs={[['offen', 'Offen'], ['erledigt', 'Erledigt'], ['alle', 'Alle']]} value={filter} onChange={setFilter} />
      {liste && !zeigen.length && <p className="leerseite hinweis">{filter === 'offen' ? 'Nichts offen. Neues hältst du bei Jago fest: oben rechts sein Bild antippen.' : 'Keine Einträge.'}</p>}
      <ul className="rueckmeldungen">
        {zeigen.map((r) => (
          <li key={r.id} className={`panel${r.status !== 'offen' ? ' inaktiv' : ''}`}>
            <div className="kz-zeile">
              <span className={`chip${r.art === 'fehler' ? ' rot' : ''}`}>{r.art === 'fehler' ? <><I.Bug size={13} aria-hidden="true" /> Fehler</> : <><I.Lightbulb size={13} aria-hidden="true" /> Idee</>}</span>
              <span className="klein hinweis">#{r.id} · {datum(r.erstellt?.slice(0, 10))}{r.von ? ` · ${r.von}` : ''}{r.seite ? ` · ${r.seite}` : ''} · {r.version}{r.status !== 'offen' ? ` · ${STATUS[r.status]}` : ''}</span>
            </div>
            <p className="rueckmeldung-text">{r.text}</p>
            {notiz && notiz.id === r.id ? (
              <label className="klein">Notiz (was gemacht wurde oder warum nicht)
                <textarea autoFocus rows={2} value={notiz.text} onChange={(e) => setNotiz({ ...notiz, text: e.target.value })} />
              </label>
            ) : r.notiz && <p className="klein"><b>Notiz:</b> {r.notiz}</p>}
            {r.diagnose && auf === r.id && (
              <div className="klein hinweis">
                <div>Gerät: {[r.diagnose.geraet, r.diagnose.bildschirm, r.diagnose.online === false ? 'offline' : null].filter(Boolean).join(', ')}</div>
                {!!r.diagnose.wege?.length && <div>Zuletzt: {r.diagnose.wege.join(' → ')}</div>}
                {!!r.diagnose.fehler?.length && <ul>{r.diagnose.fehler.map((f: Row, i: number) => <li key={i}>{f.zeit} {f.text}</li>)}</ul>}
              </div>
            )}
            <div className="buttons">
              {r.diagnose && <button className="link" aria-expanded={auf === r.id} onClick={() => setAuf(auf === r.id ? null : r.id)}>{auf === r.id ? 'Angaben ausblenden' : 'Angaben zur Fehlersuche'}</button>}
              <span className="spacer" />
              {notiz && notiz.id === r.id
                ? <button onClick={() => { const n = notiz; setNotiz(null); tun(() => call('rueckmeldungAendern', r.id, { notiz: n.text })); }}>Notiz speichern</button>
                : <button onClick={() => setNotiz({ id: r.id, text: r.notiz ?? '' })}>Notiz</button>}
              {r.status === 'offen' ? <>
                <button onClick={() => tun(() => call('rueckmeldungAendern', r.id, { status: 'verworfen' }))}>Verwerfen</button>
                <button className="primary" onClick={() => tun(() => call('rueckmeldungAendern', r.id, { status: 'erledigt' }))}>Erledigt</button>
              </> : <button onClick={() => tun(() => call('rueckmeldungAendern', r.id, { status: 'offen' }))}>Wieder öffnen</button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
