// Jago, the helper: answers questions from the help topics, opens pages and commands, makes a task from one sentence,
// and keeps faults and ideas (with what was going on) to be worked on later. No AI: help topics and the dictation
// reading run on the server (electron/jago.cjs, electron/diktat.cjs).
import { useEffect, useMemo, useState } from 'react';
import * as I from 'lucide-react';
import { call, fehler, type Modus, type Row } from './api';
import { useNavi } from './navi';
import { Dialog } from './ui';
import { DiktatKnopf } from './Diktat';
import { norm, type Befehl } from './Suche';
import { diagnose, letzteFehler, letzteSeite } from './diagnose';

type Art = 'fehler' | 'idee';
type Melden = { art: Art; text: string; mitDiagnose: boolean };
export type JagoVorgabe = { art?: Art; text?: string };
export const jagoOeffnen = (vorgabe?: JagoVorgabe) => window.dispatchEvent(new CustomEvent('jago-oeffnen', { detail: vorgabe ?? null }));

// „Fehler: …“ or „Idee: …“ at the start goes straight to noting it.
const PRAEFIX: [RegExp, Art][] = [[/^\s*(fehler|bug|problem)\s*[:–-]\s*/i, 'fehler'], [/^\s*(idee|vorschlag|wunsch)\s*[:–-]\s*/i, 'idee']];
const mitHaus = (m: Modus) => m === 'miete' || m === 'weg';

export function Jago(props: { befehle: Befehl[]; modus: Modus; objektId: number | null }) {
  const navi = useNavi();
  const [offen, setOffen] = useState(false);
  const [text, setText] = useState('');
  const [melden, setMelden] = useState<Melden | null>(null);
  const [thema, setThema] = useState<Row | null>(null);
  const [hilfe, setHilfe] = useState<Row[]>([]);
  const [aufgabe, setAufgabe] = useState<Row | null>(null);
  const [hinweise, setHinweise] = useState<Row[]>([]);
  const [offeneZahl, setOffeneZahl] = useState(0);
  const [kurz, setKurz] = useState<{ text: string; seite: string } | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  // The text whose answers are in: „Dazu weiß ich nichts“ only once they are.
  const [geladen, setGeladen] = useState('');
  const objektId = mitHaus(props.modus) ? props.objektId : null;

  useEffect(() => {
    const auf = (e: Event) => {
      const v = (e as CustomEvent<JagoVorgabe | null>).detail;
      setOffen(true); setText(''); setThema(null);
      setMelden(v?.art ? { art: v.art, text: v.text ?? '', mitDiagnose: v.art === 'fehler' } : null);
    };
    window.addEventListener('jago-oeffnen', auf);
    return () => window.removeEventListener('jago-oeffnen', auf);
  }, []);
  useEffect(() => { if (!kurz) return; const t = setTimeout(() => setKurz(null), 6000); return () => clearTimeout(t); }, [kurz]);

  // Opened without text: the three most pressing points of the cockpit, and how many notes are open.
  useEffect(() => {
    if (!offen) return;
    call<number>('rueckmeldungenOffen').then(setOffeneZahl, () => {});
    if (!mitHaus(props.modus)) { setHinweise([]); return; }
    call<Row[]>('hinweise').then((h) => setHinweise(h.filter((x) => x.stufe !== 'gelb' && (!x.modus || x.modus === props.modus))
      .sort((a, b) => Number(b.stufe === 'rot') - Number(a.stufe === 'rot')).slice(0, 3)), () => setHinweise([]));
  }, [offen, props.modus]);

  // While typing: help topics and – when a house, flat or person is named – a task.
  useEffect(() => {
    const t = text.trim();
    setThema(null);
    if (t.length < 3 || PRAEFIX.some(([m]) => m.test(t))) { setHilfe([]); setAufgabe(null); return; }
    const h = setTimeout(() => {
      Promise.all([
        call<Row[]>('jagoHilfe', t).then(setHilfe, () => setHilfe([])),
        call<Row>('diktatDeuten', t, objektId).then((r) => setAufgabe(r?.erkannt?.some((x: string) => /^(Einheit|Person|Objekt)/.test(x)) ? r : null), () => setAufgabe(null)),
      ]).then(() => setGeladen(t));
    }, 250);
    return () => clearTimeout(h);
  }, [text, objektId]);

  const befehle = useMemo(() => {
    const w = norm(text.trim()).split(/\s+/).filter((x) => x.length > 2);
    if (!w.length) return [];
    return props.befehle.filter((b) => { const n = norm(`${b.label} ${b.stichworte ?? ''}`); return w.every((x) => n.includes(x)); }).slice(0, 4);
  }, [text, props.befehle]);

  const schliessen = () => { setOffen(false); setMelden(null); setThema(null); setText(''); };
  const oeffne = (seite: string, modus?: Modus | null, objekt?: number | null) => { schliessen(); navi.zu({ seite, ...(modus ? { modus } : {}), ...(objekt ? { objektId: objekt } : {}) }); };
  const festhalten = (art: Art, t = text) => setMelden({ art, text: t.replace(PRAEFIX.find(([, a]) => a === art)?.[0] ?? /^$/, ''), mitDiagnose: art === 'fehler' });

  function absenden() {
    const t = text.trim();
    const p = PRAEFIX.find(([m]) => m.test(t));
    if (p) return festhalten(p[1], t);
    if (befehle[0] && !hilfe.length) { schliessen(); return befehle[0].run(); }
    if (hilfe[0]) return setThema(hilfe[0]);
  }

  async function speichern() {
    if (!melden || laeuft) return;
    setLaeuft(true);
    try {
      await call('rueckmeldungNeu', { art: melden.art, text: melden.text, seite: letzteSeite(), diagnose: melden.mitDiagnose ? diagnose() : null });
      schliessen();
      setKurz({ text: melden.art === 'fehler' ? 'Jago hat den Fehler notiert.' : 'Jago hat die Idee notiert.', seite: 'rueckmeldungen' });
    } catch (e) { fehler(e); } finally { setLaeuft(false); }
  }

  async function aufgabeAnlegen() {
    if (!aufgabe || laeuft) return;
    setLaeuft(true);
    try {
      await call('save', 'vorgaenge', { status: 'offen', titel: aufgabe.titel || text.trim(), prioritaet: aufgabe.prioritaet ?? 2, objekt_id: aufgabe.objekt_id ?? objektId,
        einheit_id: aufgabe.einheit_id ?? null, person_id: aufgabe.person_id ?? null, faellig: aufgabe.faellig ?? null });
      schliessen();
      setKurz({ text: `Aufgabe „${aufgabe.titel || text.trim()}“ angelegt.`, seite: 'aufgaben' });
      window.dispatchEvent(new Event('hv-daten'));
    } catch (e) { fehler(e); } finally { setLaeuft(false); }
  }

  const fehlerJetzt = letzteFehler();
  // What Jago says above the window's content.
  const spruch = melden ? (melden.art === 'fehler' ? 'Erzähl mir, was schiefgegangen ist. Ich merke mir dazu, wo du warst und welche Meldungen kamen.'
    : 'Her mit der Idee! Ich hebe sie auf, bis wir sie gemeinsam umsetzen.')
    : thema ? 'Das weiß ich:'
      : !text.trim() ? 'Wuff! Ich bin Jago. Frag mich, was du suchst – oder sag mir, was kaputt ist oder besser sein könnte.'
        : geladen === text.trim() && !hilfe.length && !befehle.length && !aufgabe ? 'Da habe ich keine Spur. Halte es als Idee fest, dann setzen wir es gemeinsam um.'
          : 'Das habe ich gefunden:';
  return (
    <>
      {offen && (
        <Dialog titel={melden ? (melden.art === 'fehler' ? 'Jago · Fehler melden' : 'Jago · Idee festhalten') : 'Jago'} onClose={schliessen}
          aktionen={melden && <>
            <button onClick={() => setMelden(null)}>Zurück</button>
            <button className="primary" disabled={!melden.text.trim() || laeuft} onClick={speichern}>Festhalten</button>
          </>}>
          <div className="jago-kopf"><img className="jago-bild" src="/jago.jpg" alt="Jago" width={80} height={80} /><p className="jago-blase">{spruch}</p></div>
          {melden ? (
            <div className="jago">
              <div className="knopfreihe" role="group" aria-label="Art">
                <button aria-pressed={melden.art === 'fehler'} className={melden.art === 'fehler' ? 'primary' : ''} onClick={() => setMelden({ ...melden, art: 'fehler', mitDiagnose: true })}><I.Bug size={15} aria-hidden="true" /> Fehler</button>
                <button aria-pressed={melden.art === 'idee'} className={melden.art === 'idee' ? 'primary' : ''} onClick={() => setMelden({ ...melden, art: 'idee', mitDiagnose: false })}><I.Lightbulb size={15} aria-hidden="true" /> Idee</button>
              </div>
              <label>{melden.art === 'fehler' ? 'Was ist passiert, und was hättest du erwartet?' : 'Was wäre gut?'}
                <textarea autoFocus rows={5} value={melden.text} onChange={(e) => setMelden({ ...melden, text: e.target.value })}
                  placeholder={melden.art === 'fehler' ? 'z. B. „Beim Buchen der Rechnung kommt eine Fehlermeldung, die Buchung fehlt danach.“' : 'z. B. „Zählerstände per Foto für alle Wohnungen nacheinander.“'} />
              </label>
              <DiktatKnopf label="Diktieren" onText={(t) => setMelden({ ...melden, text: melden.text ? `${melden.text} ${t}` : t })} />
              {melden.art === 'fehler' && <>
                <label className="check"><input type="checkbox" checked={melden.mitDiagnose} onChange={(e) => setMelden({ ...melden, mitDiagnose: e.target.checked })} /> Angaben zur Fehlersuche anhängen</label>
                {melden.mitDiagnose && (
                  <details className="klein">
                    <summary>Was angehängt wird</summary>
                    <p className="hinweis">Seite, Version, Gerät und Bildschirm, die zuletzt besuchten Seiten und die letzten Fehlermeldungen dieses Fensters. Fehlermeldungen können Namen enthalten.</p>
                    {fehlerJetzt.length ? <ul>{fehlerJetzt.slice(-5).map((f, i) => <li key={i}>{f.zeit} {f.text}</li>)}</ul> : <p className="hinweis">Noch keine Fehlermeldung in diesem Fenster.</p>}
                  </details>
                )}
              </>}
              <p className="klein hinweis">Alles Festgehaltene steht unter System → Ideen & Fehler und lässt sich dort als Text zum Umsetzen speichern.</p>
            </div>
          ) : (
            <div className="jago">
              <form className="jago-feld" onSubmit={(e) => { e.preventDefault(); absenden(); }}>
                <I.MessageCircleQuestion size={18} aria-hidden="true" />
                <input autoFocus aria-label="Frage an Jago" value={text} onChange={(e) => setText(e.target.value)}
                  placeholder="Frag mich etwas oder schreib, was zu tun ist …" />
                <DiktatKnopf klein onText={(t) => setText(t)} />
              </form>
              {thema ? (
                <div className="panel jago-antwort">
                  <b>{thema.titel}</b>
                  <p>{thema.antwort}</p>
                  <div className="buttons"><button className="link" onClick={() => setThema(null)}>Zurück</button><span className="spacer" />
                    <button className="primary" onClick={() => oeffne(thema.seite, thema.modus)}>Seite öffnen</button></div>
                </div>
              ) : !text.trim() ? (
                <>
                  {hinweise.length > 0 && <>
                    <h4 className="jago-gruppe">Was jetzt?</h4>
                    <ul className="jago-liste">{hinweise.map((h) => (
                      <li key={h.schluessel ?? h.text}><button onClick={() => h.ziel && oeffne(h.ziel, null, h.objekt_id)}>
                        <I.CircleAlert size={15} aria-hidden="true" className={h.stufe === 'rot' ? 'negativ' : ''} /><span>{h.text}</span></button></li>
                    ))}</ul>
                  </>}
                  <h4 className="jago-gruppe">Festhalten</h4>
                  <div className="knopfreihe">
                    <button onClick={() => festhalten('fehler', '')}><I.Bug size={15} aria-hidden="true" /> Fehler melden</button>
                    <button onClick={() => festhalten('idee', '')}><I.Lightbulb size={15} aria-hidden="true" /> Idee festhalten</button>
                    <button className="link" onClick={() => oeffne('rueckmeldungen')}>Ideen & Fehler{offeneZahl ? ` (${offeneZahl} offen)` : ''}</button>
                  </div>
                  <p className="klein hinweis">Frag z. B. „Wie mache ich die Nebenkostenabrechnung?“, schreib „Wohnung 3 Heizung kalt, dringend“ für eine Aufgabe oder „Idee: …“.</p>
                </>
              ) : (
                <>
                  {hilfe.length > 0 && <>
                    <h4 className="jago-gruppe">Hilfe</h4>
                    <ul className="jago-liste">{hilfe.map((h) => <li key={h.titel}><button onClick={() => setThema(h)}><I.LifeBuoy size={15} aria-hidden="true" /><span>{h.titel}</span></button></li>)}</ul>
                  </>}
                  {befehle.length > 0 && <>
                    <h4 className="jago-gruppe">Seiten und Befehle</h4>
                    <ul className="jago-liste">{befehle.map((b) => { const Icon = b.icon ?? I.ArrowRight; return <li key={b.label}><button onClick={() => { schliessen(); b.run(); }}><Icon size={15} aria-hidden="true" /><span>{b.label}</span></button></li>; })}</ul>
                  </>}
                  {aufgabe && <>
                    <h4 className="jago-gruppe">Aufgabe</h4>
                    <ul className="jago-liste"><li><button disabled={laeuft} onClick={aufgabeAnlegen}><I.ListPlus size={15} aria-hidden="true" />
                      <span>Anlegen: „{aufgabe.titel || text.trim()}“ {(aufgabe.erkannt ?? []).map((x: string) => <span key={x} className="chip">{x}</span>)}</span></button></li></ul>
                  </>}
                  <h4 className="jago-gruppe">Festhalten</h4>
                  <div className="knopfreihe">
                    <button onClick={() => festhalten('fehler')}><I.Bug size={15} aria-hidden="true" /> Als Fehler melden</button>
                    <button onClick={() => festhalten('idee')}><I.Lightbulb size={15} aria-hidden="true" /> Als Idee festhalten</button>
                  </div>
                </>
              )}
            </div>
          )}
        </Dialog>
      )}
      {kurz && (
        <div className="kurzmeldung" role="status">
          <img className="jago-mini" src="/jago.jpg" alt="" width={24} height={24} /><span>{kurz.text}</span>
          <button type="button" className="link" onClick={() => { const s = kurz.seite; setKurz(null); navi.zu({ seite: s }); }}>Ansehen</button>
        </div>
      )}
    </>
  );
}
