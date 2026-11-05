// Tasks across all houses, as a list by date like Things or Todoist: overdue, today, the next 7 days, later, without a
// date. A round tick gets one done (with „Rückgängig“), on a phone a swipe does too – to the right done, to the left
// later. Views instead of many filters (mine, all, waiting, shopping, done); house and person sit behind one „Filter“.
// A quick field understands „Wasserhahn Meier morgen dringend“. The board (Offen → Erledigt) stays as a second view,
// on a phone one column at a time. A task opens as one sheet: beside the list on a wide screen, else as a window.
import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ZeigerEreignis } from 'react';
import * as I from 'lucide-react';
import { call, fehler, heute, inTagen, type Row } from '../api';
import { useLoad } from '../useLoad';
import { useAktion } from '../aktion';
import { Bild } from '../Symbol';
import { AblaufStarten, AblaufVorlagen } from './Ablaeufe';
import { DiktatKnopf, diktatMoeglich } from '../Diktat';
import { aktuellerBenutzer } from '../offline';
import { Aufgabenblatt, STATUS_KURZ, useErledigen, wannText } from './Aufgabenblatt';
import { EinkaufListe } from './Einkauf';

type Sicht = 'meine' | 'alle' | 'wartet' | 'einkauf' | 'erledigt';
const GRUPPEN: [string, string][] = [['ueber', 'Überfällig'], ['heute', 'Heute'], ['bald', 'Nächste 7 Tage'], ['spaeter', 'Später'], ['ohne', 'Ohne Datum']];
const gruppeVon = (v: Row) => {
  const h = heute();
  return !v.faellig ? 'ohne' : v.faellig < h ? 'ueber' : v.faellig === h ? 'heute' : v.faellig <= inTagen(7) ? 'bald' : 'spaeter';
};
const reihenfolge = (a: Row, b: Row) => (a.prioritaet - b.prioritaet) || String(a.faellig ?? '9999').localeCompare(String(b.faellig ?? '9999')) || b.id - a.id;
const faelligKlasse = (v: Row) => (v.status === 'erledigt' || !v.faellig ? '' : v.faellig < heute() ? 'ueberfaellig' : v.faellig === heute() ? 'heute' : '');
const kuerzel = (name: string) => name.split(/\s+/).map((t) => t[0]).join('').slice(0, 2);
const lesen = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const schreiben = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

function useMedien(q: string) {
  const [an, setAn] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const f = () => setAn(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [q]);
  return an;
}

export function Aufgaben(props: { objekte: Row[] }) {
  const [benutzer] = useLoad<Row[]>(() => call<Row[]>('benutzerListe').catch(() => []), []);
  const mehrere = !!benutzer?.length;
  const ich = aktuellerBenutzer();
  const [gewuenscht, setSicht] = useState<Sicht>(() => (lesen('aufgaben_sicht') as Sicht | null) ?? (lesen('aufgaben_meine') === '1' ? 'meine' : 'alle'));
  const sicht: Sicht = gewuenscht === 'meine' && (!mehrere || !ich) ? 'alle' : gewuenscht;
  const [ansicht, setAnsicht] = useState<'liste' | 'board'>(() => (lesen('aufgaben_ansicht') === 'board' ? 'board' : 'liste'));
  // Filters stay for the next visit (like a work-order list does).
  const [objektId, setObjektId] = useState<number | ''>(() => Number(lesen('aufgaben_objekt')) || '');
  const [zustaendig, setZustaendig] = useState<number | ''>(() => Number(lesen('aufgaben_person')) || '');
  const [filterOffen, setFilterOffen] = useState(false);
  const [rows, reload] = useLoad<Row[]>(() => call('aufgabenListe', { objekt_id: objektId || null, zustaendig: zustaendig || null }), [objektId, zustaendig]);
  const [alleObjekte] = useLoad<Row[]>(async () => [...new Map([...await call('objekte', 'miete'), ...await call('objekte', 'weg')].map((o: Row) => [o.id, o])).values()], []);
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);
  const [neu, setNeu] = useState<Row | null>(null);
  const [ablauf, setAblauf] = useState<'starten' | 'vorlagen' | null>(null);
  const [menue, setMenue] = useState(false);
  const [sofortDiktat, setSofortDiktat] = useState(false);
  const breit = useMedien('(min-width: 1180px)');
  const erl = useErledigen(reload);

  // Done with a tick or a swipe: „Rückgängig“ for a few seconds.
  const [rueck, setRueck] = useState<{ v: Row; vorher: string; t: number } | null>(null);
  useEffect(() => { if (!rueck) return; const h = setTimeout(() => setRueck((r) => (r?.t === rueck.t ? null : r)), 8000); return () => clearTimeout(h); }, [rueck]);
  async function setzen(v: Row, status: string) {
    const ok = await erl.setzen(v, status);
    if (ok && status === 'erledigt') setRueck({ v, vorher: v.status, t: Date.now() });
    return ok;
  }
  async function spaeter(v: Row, faellig: string) {
    try { await call('save', 'vorgaenge', { id: v.id, faellig, geaendert_am: v.geaendert_am }); reload(); } catch (e) { fehler(e); }
  }

  const vorgabe = (): Row => ({ status: 'offen', prioritaet: 2, objekt_id: objektId || (props.objekte.length === 1 ? props.objekte[0].id : null),
    ...(sicht === 'meine' && ich ? { zustaendig: Number(ich) } : {}), ...(sicht === 'einkauf' ? { kategorie: 'Einkauf' } : {}) });
  useAktion('neue-aufgabe', () => setNeu(vorgabe()));
  const sichtWaehlen = (s: Sicht) => { setSicht(s); schreiben('aufgaben_sicht', s); setGewaehlt(null); };

  // Steps of a task without their own date show only inside their task.
  const alle = (rows ?? []).filter((v) => !(v.eltern_id && !v.faellig));
  const offen = alle.filter((v) => v.status !== 'erledigt');
  const meine = offen.filter((v) => ich != null && String(v.zustaendig) === String(ich));
  const zahl: Record<Sicht, number> = { meine: meine.length, alle: offen.length, wartet: offen.filter((v) => v.status === 'wartet').length,
    einkauf: offen.filter((v) => v.kategorie === 'Einkauf').length, erledigt: alle.filter((v) => v.status === 'erledigt').length };
  const sichtbar = sicht === 'meine' ? meine : sicht === 'wartet' ? offen.filter((v) => v.status === 'wartet')
    : sicht === 'erledigt' ? alle.filter((v) => v.status === 'erledigt').sort((a, b) => String(b.geaendert_am ?? '').localeCompare(String(a.geaendert_am ?? ''))) : offen;
  const offenesBlatt = (rows ?? []).find((v) => v.id === gewaehlt) ?? null;
  const oeffnen = (v: Row) => setGewaehlt(gewaehlt === v.id && breit ? null : v.id);

  const objektName = alleObjekte?.find((o) => o.id === objektId)?.bezeichnung;
  const personName = benutzer?.find((b) => b.id === zustaendig)?.name;
  const SICHTEN: [Sicht, string][] = [...(mehrere && ich ? [['meine', 'Meine'] as [Sicht, string]] : []), ['alle', 'Alle'], ['wartet', 'Wartet'], ['einkauf', 'Einkaufen'], ['erledigt', 'Erledigt']];

  const blatt = offenesBlatt && (
    <Aufgabenblatt key={offenesBlatt.id} v={offenesBlatt} eingebettet={breit} onClose={() => setGewaehlt(null)} onGeaendert={reload} setzeStatus={setzen} />
  );

  return (
    <section className="aufgaben">
      <div className="toolbar aufgaben-kopf">
        <h1>Aufgaben</h1>
        <span className="spacer" />
        {sicht !== 'einkauf' && (
          <div className="segment" role="tablist" aria-label="Ansicht">
            <button role="tab" aria-selected={ansicht === 'liste'} aria-label="Liste" title="Liste" onClick={() => { setAnsicht('liste'); schreiben('aufgaben_ansicht', 'liste'); }}><I.List size={15} aria-hidden="true" /><span className="nur-breit">Liste</span></button>
            <button role="tab" aria-selected={ansicht === 'board'} aria-label="Board" title="Board" onClick={() => { setAnsicht('board'); schreiben('aufgaben_ansicht', 'board'); }}><I.Columns3 size={15} aria-hidden="true" /><span className="nur-breit">Board</span></button>
          </div>
        )}
        <Menue offen={menue} setOffen={setMenue} knopf={<><I.Plus size={15} aria-hidden="true" /> Neu</>} label="Neue Aufgabe oder Ablauf">
          <button role="menuitem" onClick={() => { setMenue(false); setNeu(vorgabe()); }}><I.SquarePen size={15} aria-hidden="true" /> Aufgabe mit allen Angaben</button>
          {diktatMoeglich() && <button role="menuitem" onClick={() => { setMenue(false); setSofortDiktat(true); setNeu(vorgabe()); }}><I.Mic size={15} aria-hidden="true" /> Sprachnotiz</button>}
          <button role="menuitem" onClick={() => { setMenue(false); setAblauf('starten'); }}><I.Workflow size={15} aria-hidden="true" /> Ablauf aus Vorlage starten</button>
          <button role="menuitem" onClick={() => { setMenue(false); setAblauf('vorlagen'); }}><I.Settings2 size={15} aria-hidden="true" /> Vorlagen bearbeiten</button>
        </Menue>
      </div>

      <div className="sichten" role="tablist" aria-label="Welche Aufgaben">
        {SICHTEN.map(([s, l]) => (
          <button key={s} role="tab" aria-selected={sicht === s} className={`chip-knopf${sicht === s ? ' an' : ''}`} onClick={() => sichtWaehlen(s)}>
            {l}{s !== 'erledigt' && <span className="zahl">{zahl[s]}</span>}</button>
        ))}
        <button type="button" className={`chip-knopf${objektId || zustaendig ? ' gefiltert' : ''}`} aria-expanded={filterOffen} onClick={() => setFilterOffen(!filterOffen)}>
          <I.SlidersHorizontal size={14} aria-hidden="true" /> Filter</button>
        {objektName && <span className="chip">{objektName}<button type="button" className="chip-weg" aria-label={`Filter ${objektName} entfernen`}
          onClick={() => { setObjektId(''); schreiben('aufgaben_objekt', ''); }}><I.X size={12} /></button></span>}
        {personName && <span className="chip">{personName}<button type="button" className="chip-weg" aria-label={`Filter ${personName} entfernen`}
          onClick={() => { setZustaendig(''); schreiben('aufgaben_person', ''); }}><I.X size={12} /></button></span>}
      </div>
      {filterOffen && (
        <div className="filterleiste">
          <label>Haus
            <select value={objektId} onChange={(e) => { const n = Number(e.target.value) || ''; setObjektId(n); schreiben('aufgaben_objekt', String(n)); }}>
              <option value="">alle Häuser</option>{alleObjekte?.map((o) => <option key={o.id} value={o.id}>{o.bezeichnung}</option>)}
            </select>
          </label>
          {mehrere && (
            <label>Kümmert sich
              <select value={zustaendig} onChange={(e) => { const n = Number(e.target.value) || ''; setZustaendig(n); schreiben('aufgaben_person', String(n)); }}>
                <option value="">alle</option>{benutzer!.filter((b) => b.aktiv).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          )}
        </div>
      )}

      {sicht === 'einkauf' ? <EinkaufListe onGeaendert={reload} /> : (
        <div className={`aufgaben-raster${breit && offenesBlatt ? ' mit-blatt' : ''}`}>
          <div className="aufgaben-haupt">
            {sicht !== 'erledigt' && <Schnellfeld vorgabe={vorgabe()} onNeu={reload} />}
            {ansicht === 'board' && sicht !== 'erledigt' ? (
              <Board liste={sicht === 'wartet' ? sichtbar : [...sichtbar, ...alle.filter((v) => v.status === 'erledigt' && (sicht !== 'meine' || String(v.zustaendig) === String(ich)))]}
                aktiv={gewaehlt} mehrere={mehrere} onOeffnen={oeffnen} setzen={setzen} />
            ) : (
              <div className="aufgabenliste">
                {sicht === 'erledigt' ? (
                  <ul className="az-liste">{sichtbar.map((v) => <Zeile key={v.id} v={v} aktiv={v.id === gewaehlt} mehrere={mehrere} sicht={sicht}
                    onOeffnen={() => oeffnen(v)} onHaken={() => setzen(v, 'offen')} onSpaeter={(t) => spaeter(v, t)} />)}</ul>
                ) : GRUPPEN.map(([g, l]) => {
                  const teil = sichtbar.filter((v) => gruppeVon(v) === g).sort(reihenfolge);
                  if (!teil.length) return null;
                  return (
                    <section key={g} className={`az-gruppe ${g}`} aria-label={l}>
                      <h3>{l} <span className="hinweis">{teil.length}</span></h3>
                      <ul className="az-liste">{teil.map((v) => <Zeile key={v.id} v={v} aktiv={v.id === gewaehlt} mehrere={mehrere} sicht={sicht}
                        onOeffnen={() => oeffnen(v)} onHaken={() => setzen(v, 'erledigt')} onSpaeter={(t) => spaeter(v, t)} />)}</ul>
                    </section>
                  );
                })}
                {rows && !sichtbar.length && (
                  <div className="alles-erledigt"><Bild name="aufgaben" groesse={88} className="leer-bild" />
                    <p>{sicht === 'erledigt' ? 'In den letzten 14 Tagen wurde nichts erledigt.' : sicht === 'wartet' ? 'Nichts wartet auf eine Rückmeldung.' : <><b>Alles erledigt.</b> Neue Aufgaben kommen oben ins Feld.</>}</p></div>
                )}
              </div>
            )}
          </div>
          {breit && blatt}
        </div>
      )}

      {!breit && blatt}
      {rueck && (
        <div className="kurzmeldung" role="status">
          <I.CircleCheck size={16} aria-hidden="true" /><span>„{rueck.v.titel}“ erledigt</span>
          <button type="button" className="link" onClick={async () => {
            const r = rueck; setRueck(null);
            try { await call('vorgangStatus', r.v.id, r.vorher === 'erledigt' ? 'offen' : r.vorher); reload(); } catch (e) { fehler(e); }
          }}>Rückgängig</button>
        </div>
      )}
      {erl.dialoge}
      {neu && <NeueAufgabe vorlage={neu} sofortDiktat={sofortDiktat} onClose={() => { setNeu(null); setSofortDiktat(false); }} onNeu={reload} />}
      {ablauf === 'starten' && <AblaufStarten onClose={(id) => { setAblauf(null); if (id) reload(); }} />}
      {ablauf === 'vorlagen' && <AblaufVorlagen onClose={() => setAblauf(null)} />}
    </section>
  );
}

// A new task with all its fields; with „Sprachnotiz“ the microphone starts at once.
function NeueAufgabe(props: { vorlage: Row; sofortDiktat: boolean; onClose: () => void; onNeu: () => void }) {
  useEffect(() => {
    if (!props.sofortDiktat) return;
    const h = setTimeout(() => (document.querySelector('.blatt-titel .diktat button') as HTMLButtonElement | null)?.click(), 300);
    return () => clearTimeout(h);
  }, []);
  return <Aufgabenblatt vorlage={props.vorlage} onClose={props.onClose} onGeaendert={props.onNeu} />;
}

// A small menu under a button (closes on a click beside it or with Escape).
function Menue(props: { offen: boolean; setOffen: (b: boolean) => void; knopf: React.ReactNode; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.offen) return;
    const weg = (e: Event) => { if (!ref.current?.contains(e.target as Node)) props.setOffen(false); };
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') props.setOffen(false); };
    document.addEventListener('pointerdown', weg);
    document.addEventListener('keydown', taste);
    return () => { document.removeEventListener('pointerdown', weg); document.removeEventListener('keydown', taste); };
  }, [props.offen]);
  return (
    <div className="menue-anker" ref={ref}>
      <button type="button" className="primary" aria-haspopup="menu" aria-expanded={props.offen} aria-label={props.label} onClick={() => props.setOffen(!props.offen)}>{props.knopf}</button>
      {props.offen && <div className="menue" role="menu">{props.children}</div>}
    </div>
  );
}

// The quick field: typed (or spoken) in one line; house, flat, person, date and urgency are recognised and shown before
// Enter saves – without a connection the text is saved as it is.
function Schnellfeld(props: { vorgabe: Row; onNeu: () => void }) {
  const [text, setText] = useState('');
  const [gesprochen, setGesprochen] = useState(false);
  const [deutung, setDeutung] = useState<{ text: string; r: Row } | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const objekt = props.vorgabe.objekt_id ?? null;
  useEffect(() => {
    const t = text.trim();
    if (t.length < 4) { setDeutung(null); return; }
    const h = setTimeout(() => { call<Row>('diktatDeuten', t, objekt).then((r) => setDeutung({ text: t, r }), () => setDeutung(null)); }, 350);
    return () => clearTimeout(h);
  }, [text, objekt]);
  async function anlegen() {
    const t = text.trim();
    if (!t || laeuft) return;
    setLaeuft(true);
    try {
      const r = deutung?.text === t ? deutung.r : await call<Row>('diktatDeuten', t, objekt).catch(() => null);
      await call('save', 'vorgaenge', { ...props.vorgabe, titel: r?.titel || t, ...(gesprochen && r?.beschreibung ? { beschreibung: r.beschreibung } : {}),
        prioritaet: r?.prioritaet ?? 2, objekt_id: r?.objekt_id ?? objekt, einheit_id: r?.einheit_id ?? null, person_id: r?.person_id ?? null, faellig: r?.faellig ?? null });
      setText(''); setDeutung(null); setGesprochen(false);
      props.onNeu();
    } catch (e) { fehler(e); } finally { setLaeuft(false); }
  }
  const erkannt: string[] = deutung?.text === text.trim() ? deutung.r.erkannt ?? [] : [];
  return (
    <form className="schnellfeld" onSubmit={(e) => { e.preventDefault(); anlegen(); }}>
      <I.Plus size={16} aria-hidden="true" />
      <input aria-label="Neue Aufgabe" placeholder="Neue Aufgabe, z. B. „Wasserhahn Meier morgen dringend“" value={text}
        onChange={(e) => { setText(e.target.value); if (!e.target.value) setGesprochen(false); }} />
      <DiktatKnopf klein onText={(t) => { setText(t); setGesprochen(true); }} />
      <button type="submit" className="icon" aria-label="Anlegen" title="Anlegen (Enter)" disabled={!text.trim() || laeuft}><I.CornerDownLeft size={15} /></button>
      {!!erkannt.length && <div className="schnellfeld-erkannt" aria-live="polite"><span className="klein hinweis">Erkannt:</span>{erkannt.map((x) => <span key={x} className="chip">{x}</span>)}</div>}
    </form>
  );
}

// One task in the list: tick, title with where and who, date on the right. On a touch screen it can be swiped.
function Zeile(props: { v: Row; aktiv: boolean; mehrere: boolean; sicht: Sicht; onOeffnen: () => void; onHaken: () => void; onSpaeter: (iso: string) => void }) {
  const v = props.v;
  const fertig = v.status === 'erledigt';
  const [dx, setDx] = useState(0);
  const [spaeter, setSpaeter] = useState(false);
  const zug = useRef<{ x: number; y: number; id: number; aktiv: boolean } | null>(null);
  const geschoben = useRef(false);
  const runter = (e: ZeigerEreignis) => { if (e.pointerType === 'touch') zug.current = { x: e.clientX, y: e.clientY, id: e.pointerId, aktiv: false }; };
  const ziehen = (e: ZeigerEreignis) => {
    const z = zug.current;
    if (!z) return;
    const x = e.clientX - z.x, y = e.clientY - z.y;
    if (!z.aktiv) {
      if (Math.abs(y) > 12) { zug.current = null; return; }
      if (Math.abs(x) < 14 || Math.abs(x) < Math.abs(y) * 1.5) return;
      z.aktiv = true;
      geschoben.current = true;
      (e.currentTarget as Element).setPointerCapture(z.id);
    }
    setDx(Math.max(-150, Math.min(150, x)));
  };
  const hoch = () => {
    const z = zug.current;
    zug.current = null;
    if (!z?.aktiv) return;
    const x = dx;
    setDx(0);
    if (x > 90) props.onHaken();
    else if (x < -90 && !fertig) setSpaeter(true);
    setTimeout(() => { geschoben.current = false; }, 50);
  };
  const meta = [v.eltern_titel && `↳ ${v.eltern_titel}`, v.projekt, v.objekt, v.einheit, v.person, v.kategorie === 'Einkauf' && v.laden].filter(Boolean).join(' · ');
  return (
    <li className={`az${props.aktiv ? ' aktiv' : ''}${fertig ? ' fertig' : ''}`}>
      {dx !== 0 && <div className={`az-unter ${dx > 0 ? 'rechts' : 'links'}`} aria-hidden="true">
        {dx > 0 ? <><I.Check size={16} /> {fertig ? 'Wieder öffnen' : 'Erledigt'}</> : <>Später <I.Clock size={16} /></>}</div>}
      <div className="az-zeile" style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onPointerDown={runter} onPointerMove={ziehen} onPointerUp={hoch} onPointerCancel={() => { zug.current = null; setDx(0); }}>
        <button type="button" className={`haken${fertig ? ' an' : ''}${v.prioritaet === 1 ? ' dringend' : ''}`} aria-pressed={fertig}
          aria-label={`„${v.titel}“ ${fertig ? 'wieder öffnen' : 'erledigen'}`} onClick={props.onHaken}><I.Check size={13} strokeWidth={3} aria-hidden="true" /></button>
        <button type="button" className="az-text" aria-current={props.aktiv || undefined} onClick={() => { if (!geschoben.current) props.onOeffnen(); }}>
          <span className="az-titel">
            {v.prioritaet === 1 && <I.Flag size={13} className="dringend-symbol" aria-label="dringend" />}
            {v.kategorie === 'Einkauf' && <I.ShoppingCart size={13} className="karte-symbol" aria-label="Einkauf" />}
            {v.menge ? `${v.menge} ` : ''}{v.titel}
            {v.status === 'wartet' && props.sicht !== 'wartet' && <span className="tag">wartet</span>}
            {v.status === 'in_arbeit' && <span className="tag">in Arbeit</span>}
          </span>
          {(meta || !!v.schritte) && <span className="az-meta">{meta}{!!v.schritte && `${meta ? ' · ' : ''}Schritte ${v.schritte_erledigt}/${v.schritte}`}</span>}
        </button>
        <span className="az-rechts">
          {!!v.fotos && <span className="az-zahl" title="Fotos und Dateien"><I.Image size={13} aria-hidden="true" /> {v.fotos}</span>}
          {!!v.eintraege && <span className="az-zahl" title="Kommentare und Einträge"><I.MessageSquare size={13} aria-hidden="true" /> {v.eintraege}</span>}
          {v.faellig && <span className={`faellig ${faelligKlasse(v)}`}>{wannText(v.faellig)}</span>}
          {props.mehrere && v.zustaendig_name && <span className="person-kurz" title={`Kümmert sich: ${v.zustaendig_name}`}>{kuerzel(v.zustaendig_name)}</span>}
        </span>
      </div>
      {spaeter && (
        <div className="az-spaeter" role="group" aria-label={`„${v.titel}“ verschieben`}>
          <span className="klein hinweis">Verschieben auf</span>
          <button type="button" onClick={() => { setSpaeter(false); props.onSpaeter(inTagen(1)); }}>Morgen</button>
          <button type="button" onClick={() => { setSpaeter(false); props.onSpaeter(inTagen(7)); }}>Nächste Woche</button>
          <button type="button" className="link" onClick={() => setSpaeter(false)}>Abbrechen</button>
        </div>
      )}
    </li>
  );
}

// The board: drag cards between the columns (on a computer); on a phone one column at a time with tabs.
function Board(props: { liste: Row[]; aktiv: number | null; mehrere: boolean; onOeffnen: (v: Row) => void; setzen: (v: Row, s: string) => Promise<boolean> }) {
  const schmal = useMedien('(max-width: 720px)');
  const [spalte, setSpalte] = useState('offen');
  const [ziel, setZiel] = useState<string | null>(null);
  const ablegen = (e: DragEvent, status: string) => {
    e.preventDefault();
    setZiel(null);
    const id = Number(e.dataTransfer.getData('application/x-hv-aufgabe'));
    const v = props.liste.find((x) => x.id === id);
    if (v && v.status !== status) props.setzen(v, status);
  };
  const spalten = schmal ? STATUS_KURZ.filter(([s]) => s === spalte) : STATUS_KURZ;
  return (
    <>
      {schmal && (
        <div className="segment board-reiter" role="tablist" aria-label="Spalte">
          {STATUS_KURZ.map(([s, l]) => <button key={s} role="tab" aria-selected={spalte === s} onClick={() => setSpalte(s)}>{l} <span className="hinweis">{props.liste.filter((v) => v.status === s).length}</span></button>)}
        </div>
      )}
      <div className={`board${schmal ? ' eine' : ''}`}>
        {spalten.map(([s, l]) => {
          const karten = props.liste.filter((v) => v.status === s).sort(reihenfolge);
          return (
            <div key={s} className={`board-spalte${ziel === s ? ' ziel' : ''}`} onDragOver={(e) => { e.preventDefault(); setZiel(s); }}
              onDragLeave={(e) => { if (e.currentTarget === e.target) setZiel(null); }} onDrop={(e) => ablegen(e, s)} aria-label={l}>
              {!schmal && <h3>{l} <span className="hinweis">{karten.length}</span></h3>}
              {karten.map((v) => (
                <div key={v.id} className={`karte prio${v.prioritaet}${props.aktiv === v.id ? ' aktiv' : ''}`} draggable data-ziel={`vorgang:${v.id}`}
                  onDragStart={(e) => { e.dataTransfer.setData('application/x-hv-aufgabe', String(v.id)); e.dataTransfer.effectAllowed = 'move'; }}>
                  <button type="button" className={`haken${v.status === 'erledigt' ? ' an' : ''}`} aria-pressed={v.status === 'erledigt'}
                    aria-label={`„${v.titel}“ ${v.status === 'erledigt' ? 'wieder öffnen' : 'erledigen'}`} onClick={() => props.setzen(v, v.status === 'erledigt' ? 'offen' : 'erledigt')}>
                    <I.Check size={12} strokeWidth={3} aria-hidden="true" /></button>
                  <button type="button" className="karte-inhalt" onClick={() => props.onOeffnen(v)}>
                    <span className="karte-titel">{v.prioritaet === 1 && <I.Flag size={13} className="dringend-symbol" aria-label="dringend" />}
                      {v.kategorie === 'Einkauf' && <I.ShoppingCart size={13} className="karte-symbol" aria-label="Einkauf" />}{v.menge ? `${v.menge} ` : ''}{v.titel}</span>
                    {v.eltern_titel && <span className="klein hinweis">↳ {v.eltern_titel}</span>}
                    <span className="klein hinweis">{[v.projekt, v.objekt, v.einheit, v.person, v.kategorie === 'Einkauf' && v.laden].filter(Boolean).join(' · ')}</span>
                    <span className="karte-fuss klein">
                      {v.faellig && <span className={`faellig ${faelligKlasse(v)}`}><I.CalendarClock size={13} aria-hidden="true" /> {wannText(v.faellig)}</span>}
                      {!!v.schritte && <span title="Schritte">{v.schritte_erledigt}/{v.schritte}</span>}
                      {!!v.eintraege && <span title="Kommentare und Einträge"><I.MessageSquare size={13} aria-hidden="true" /> {v.eintraege}</span>}
                      {!!v.fotos && <span title="Fotos und Dokumente"><I.Image size={13} aria-hidden="true" /> {v.fotos}</span>}
                      <span className="spacer" />
                      {props.mehrere && v.zustaendig_name && <span className="person-kurz" title={`Kümmert sich: ${v.zustaendig_name}`}>{kuerzel(v.zustaendig_name)}</span>}
                    </span>
                  </button>
                </div>
              ))}
              {!karten.length && <p className="hinweis klein board-leer">{s === 'erledigt' ? 'Erledigtes der letzten 14 Tage' : schmal ? 'Keine Karten.' : 'Karten hierher ziehen'}</p>}
            </div>
          );
        })}
      </div>
    </>
  );
}
