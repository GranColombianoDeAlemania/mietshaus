// One sheet per task – to look at and to change in the same place, no separate edit form (like Linear or Todoist): what
// is to be done on the left (title, details, steps, photos, history), where, who and when on the right (on a phone and
// beside the list: on top). A change is saved at once. A new task starts with what is mostly needed – kind, title, where,
// by when, urgency –; the rest comes on a tap („+ Betrifft“). A purchase shows quantity, shop and price instead.
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import * as I from 'lucide-react';
import { call, datum, euro, fehler, heute, inTagen, parseZahl, personName, type Row } from '../api';
import { useLoad } from '../useLoad';
import { Auswahl, Fenster, FensterTitel } from '../ui';
import { Galerie } from '../Galerie';
import { DiktatKnopf } from '../Diktat';
import { bestaetigen } from '../frage';
import { PflichtErledigen } from './Pflichten';
import { Kassenbon } from './Einkauf';

export const STATUS_KURZ: [string, string][] = [['offen', 'Offen'], ['in_arbeit', 'In Arbeit'], ['wartet', 'Wartet'], ['erledigt', 'Erledigt']];
// The kinds offered as buttons; the stored names stay those of earlier versions.
export const ARTEN: { k: string; l: string; S: I.LucideIcon }[] = [
  { k: 'Schaden / Reparatur', l: 'Reparatur', S: I.Wrench }, { k: 'Einkauf', l: 'Einkauf', S: I.ShoppingCart },
  { k: 'Mieteranfrage', l: 'Anfrage', S: I.MessageSquare }, { k: 'Verwaltung', l: 'Verwaltung', S: I.Briefcase }];
const WEITERE = ['Eigentümeranfrage', 'Beschwerde', 'Vermietung', 'Sonstiges'];
const EINTRAG_ARTEN: [string, string][] = [['kommentar', 'Kommentar'], ['anruf', 'Anruf'], ['notiz', 'Notiz'], ['email', 'E-Mail'], ['brief', 'Brief'],
  ['termin', 'Termin vor Ort'], ['auftrag', 'Auftrag erteilt']];
const WICHTIG: [number, string][] = [[3, 'später'], [2, 'normal'], [1, 'dringend']];

const tagNr = (iso: string) => Math.round((new Date(`${iso}T12:00:00`).getTime() - new Date(`${heute()}T12:00:00`).getTime()) / 864e5);
// A date the way people say it: „heute“, „morgen“, „Fr 07.11.“ this week, else 07.11. (with the year when it is another).
export function wannText(iso?: string | null) {
  if (!iso) return '';
  const n = tagNr(iso);
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n === -1) return 'gestern';
  const d = new Date(`${iso}T12:00:00`);
  const kurz = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
  if (n > 1 && n < 7) return `${d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '')} ${kurz}`;
  return d.getFullYear() === new Date().getFullYear() ? kurz : datum(iso);
}
export const cent = (s: string) => (s.trim() ? Math.round((parseZahl(s) ?? 0) * 100) : null);
export const euroFeld = (ct: number | null | undefined) => (ct == null ? '' : (ct / 100).toFixed(2).replace('.', ','));

// Setting a task's status, the same everywhere: a purchase is done through its receipt, a duty through its proof
// (and the next date), the last step of a workflow offers to close the workflow. Returns true when the status was set
// directly (so it can be undone), false when a window took over or it failed.
export function useErledigen(fertig: () => void) {
  const [bon, setBon] = useState<Row[] | null>(null);
  const [pflicht, setPflicht] = useState<Row | null>(null);
  const [geschafft, setGeschafft] = useState(0);
  const feiern = () => { const t = Date.now(); setGeschafft(t); setTimeout(() => setGeschafft((x) => (x === t ? 0 : x)), 1200); };
  async function setzen(v: Row, status: string): Promise<boolean> {
    try {
      if (status === 'erledigt' && v.kategorie === 'Einkauf') { setBon([v]); return false; }
      if (status === 'erledigt' && v.pflicht_id) {
        const p = await call<Row>('get', 'pflichten', v.pflicht_id);
        if (p) { setPflicht(p); return false; }
      }
      await call('vorgangStatus', v.id, status);
      if (status === 'erledigt' && v.eltern_id) {
        const offen = (await call<Row[]>('ablaufSchritte', v.eltern_id)).filter((x) => x.status !== 'erledigt' && x.id !== v.id);
        if (!offen.length && await bestaetigen(`Alle Schritte von „${v.eltern_titel ?? 'diesem Ablauf'}“ sind erledigt. Den Ablauf abschließen?`, { titel: 'Ablauf fertig', ja: 'Abschließen' }))
          await call('vorgangStatus', v.eltern_id, 'erledigt');
      }
      if (status === 'erledigt') feiern();
      fertig();
      return true;
    } catch (e) { fehler(e); return false; }
  }
  const dialoge = (
    <>
      {!!geschafft && <div key={geschafft} className="geschafft" aria-hidden="true"><I.Check size={48} strokeWidth={3} /></div>}
      {bon && <Kassenbon artikel={bon} onClose={(ok) => { setBon(null); if (ok) { feiern(); fertig(); } }} />}
      {pflicht && <PflichtErledigen pflicht={pflicht} onClose={(ok) => { setPflicht(null); if (ok) { feiern(); fertig(); } }} />}
    </>
  );
  return { setzen, dialoge };
}

// A property row: symbol, name, value.
function Eig(props: { symbol: ReactNode; name: string; fuer?: string; children: ReactNode }) {
  return (
    <div className="eig">
      <span className="eig-symbol" aria-hidden="true">{props.symbol}</span>
      {props.fuer ? <label className="eig-name" htmlFor={props.fuer}>{props.name}</label> : <span className="eig-name">{props.name}</span>}
      <div className="eig-wert">{props.children}</div>
    </div>
  );
}

// An input that saves when it is left (or with Enter) – text of a title, a quantity, a price. wachsend: one line that
// grows with a long title instead of cutting it off (Enter still saves).
function Feld(props: { wert: string; onFertig: (s: string) => void; onTippen?: (s: string) => void; className?: string; platzhalter?: string;
  label: string; id?: string; mehrzeilig?: boolean; wachsend?: boolean; inputMode?: 'decimal'; eingabeRef?: React.RefObject<HTMLTextAreaElement | null>;
  onEnter?: () => void; leeren?: boolean }) {
  const [s, setS] = useState(props.wert);
  useEffect(() => setS(props.wert), [props.wert]);
  const eigenRef = useRef<HTMLTextAreaElement | null>(null);
  const flaeche = props.eingabeRef ?? eigenRef;
  useLayoutEffect(() => {
    const el = flaeche.current;
    if (!props.wachsend || !el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [s, props.wachsend]);
  const fertig = () => { if (s !== props.wert) { props.onFertig(s); if (props.leeren) setS(''); } };
  if (props.wachsend) return (
    <textarea ref={flaeche} rows={1} id={props.id} className={props.className} aria-label={props.label} placeholder={props.platzhalter} value={s}
      onChange={(e) => { const t = e.target.value.replace(/\n/g, ' '); setS(t); props.onTippen?.(t); }} onBlur={fertig}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (props.onEnter) { fertig(); props.onEnter(); } else e.currentTarget.blur(); } }} />
  );
  if (props.mehrzeilig) return (
    <textarea id={props.id} className={props.className} aria-label={props.label} placeholder={props.platzhalter} value={s} rows={Math.min(8, Math.max(2, s.split('\n').length))}
      onChange={(e) => { setS(e.target.value); props.onTippen?.(e.target.value); }} onBlur={fertig} />
  );
  return (
    <input id={props.id} className={props.className} aria-label={props.label} placeholder={props.platzhalter} value={s} inputMode={props.inputMode}
      onChange={(e) => { setS(e.target.value); props.onTippen?.(e.target.value); }} onBlur={fertig}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (props.onEnter) { fertig(); props.onEnter(); } else e.currentTarget.blur(); } }} />
  );
}

export function Aufgabenblatt(props: {
  v?: Row | null; // the task (a row of a list) – none: a new one
  vorlage?: Row; // a new task's first values (house, kind, project, due date …)
  eingebettet?: boolean; // beside the list instead of in a window
  onClose: () => void;
  onGeaendert?: (id?: number) => void;
  setzeStatus?: (v: Row, status: string) => Promise<boolean>; // the page's own (with undo); else this sheet's
}) {
  const [d, setD] = useState<Row>(() => props.v ?? { status: 'offen', prioritaet: 2, ...props.vorlage });
  const neu = !d.id;
  // The change time the task was loaded with: someone else's change since then asks before it is overwritten.
  const stand = useRef<string | null>(props.v?.geaendert_am ?? null);
  useEffect(() => { if (props.v?.id) { setD(props.v); stand.current = props.v.geaendert_am ?? null; } }, [props.v]);
  const geaendert = () => props.onGeaendert?.(d.id);
  const eigen = useErledigen(geaendert);
  const setzeStatus = props.setzeStatus ?? eigen.setzen;
  const einkauf = d.kategorie === 'Einkauf';

  const [objekte] = useLoad<Row[]>(async () => [...new Map([...await call('objekte', 'miete'), ...await call('objekte', 'weg')].map((o: Row) => [o.id, o])).values()], []);
  const [einheiten] = useLoad<Row[]>(() => (d.objekt_id ? call('einheiten', Number(d.objekt_id)) : Promise.resolve([])), [d.objekt_id]);
  const [personen] = useLoad<Row[]>(() => call('personen'), []);
  const [benutzer] = useLoad<Row[]>(() => call<Row[]>('benutzerListe').catch(() => []), []);
  const [projekte] = useLoad<Row[]>(() => call<Row[]>('projektListe').catch(() => []), []);
  const [laeden] = useLoad<string[]>(() => (einkauf ? call('einkaufLaeden') : Promise.resolve([])), [einkauf]);
  const [projekt] = useLoad<Row | null>(() => (einkauf && d.projekt_id ? call('projekt', Number(d.projekt_id)) : Promise.resolve(null)), [einkauf, d.projekt_id]);
  const [geraete] = useLoad<Row[]>(() => (d.einheit_id ? call('inventarGarantie', Number(d.einheit_id)) : Promise.resolve([])), [d.einheit_id]);
  const [schritte, ladeSchritte] = useLoad<Row[]>(() => (d.id && !einkauf ? call('ablaufSchritte', d.id) : Promise.resolve([])), [d.id, einkauf]);
  const [eintraege, ladeEintraege] = useLoad<Row[]>(() => (d.id ? call('liste', 'vorgangseintraege', { vorgang_id: d.id }, 'datum, id') : Promise.resolve([])), [d.id]);

  // Rows shown: what has a value, what is mostly needed, and what was asked for with „+ …“.
  const [zeige, setZeige] = useState<Set<string>>(new Set());
  const dazu = (k: string) => setZeige((z) => new Set(z).add(k));
  const hat = (k: string) => zeige.has(k) || (d[k] != null && d[k] !== '');
  const [hinweis, setHinweis] = useState('');
  const [erkannt, setErkannt] = useState<string[]>([]);
  const [laeuft, setLaeuft] = useState(false);
  const titelRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (neu && !props.eingebettet) titelRef.current?.focus(); }, []);

  async function aendern(teil: Row) {
    const vorher = d;
    setD((x) => ({ ...x, ...teil }));
    if (neu) return;
    try {
      await call('save', 'vorgaenge', { id: d.id, geaendert_am: stand.current, ...teil });
      geaendert();
    } catch (e) { fehler(e); setD(vorher); }
  }

  async function status(s: string) {
    if (neu) { setD((x) => ({ ...x, status: s })); return; }
    if (await setzeStatus(d, s)) setD((x) => ({ ...x, status: s }));
  }

  // A new task saved; the sheet stays open on it when there is more to add (a photo).
  async function anlegen(): Promise<number | null> {
    const titel = String(d.titel ?? '').trim();
    if (!titel) { setHinweis(einkauf ? 'Was soll gekauft werden?' : 'Was ist zu tun?'); titelRef.current?.focus(); return null; }
    setLaeuft(true);
    try {
      const row: Row = { titel, status: d.status ?? 'offen' };
      for (const k of ['objekt_id', 'einheit_id', 'person_id', 'zustaendig', 'faellig', 'prioritaet', 'kategorie', 'beschreibung', 'projekt_id', 'menge', 'laden',
        'preis_ct', 'projektaufgabe_id', 'eltern_id']) if (d[k] != null && d[k] !== '') row[k] = d[k];
      let id: number;
      if (einkauf) {
        // As in the shopping list: the quantity is split off and a known article gets its shop.
        id = await call<number>('einkaufNeu', row.projekt_id ?? null, { titel, menge: row.menge, laden: row.laden, preis_ct: row.preis_ct,
          projektaufgabe_id: row.projektaufgabe_id, objekt_id: row.objekt_id });
        const rest = Object.fromEntries(Object.entries(row).filter(([k]) => ['einheit_id', 'person_id', 'zustaendig', 'faellig', 'prioritaet', 'beschreibung'].includes(k)));
        if (Object.keys(rest).length) await call('save', 'vorgaenge', { id, ...rest });
      } else id = await call<number>('save', 'vorgaenge', row);
      props.onGeaendert?.(id);
      return id;
    } catch (e) { fehler(e); return null; } finally { setLaeuft(false); }
  }
  const anlegenUndSchliessen = async () => { if (await anlegen()) props.onClose(); };

  async function diktiert(text: string) {
    try {
      const r = await call<Row>('diktatDeuten', text, d.objekt_id ? Number(d.objekt_id) : null);
      setD((x) => ({ ...x, titel: r.titel, beschreibung: r.beschreibung, prioritaet: r.prioritaet, ...(r.objekt_id ? { objekt_id: r.objekt_id } : {}),
        ...(r.einheit_id ? { einheit_id: r.einheit_id } : {}), ...(r.person_id ? { person_id: r.person_id } : {}), ...(r.faellig ? { faellig: r.faellig } : {}) }));
      setErkannt(r.erkannt ?? []);
    } catch { setD((x) => ({ ...x, titel: text })); }
  }

  async function loeschen() {
    if (!await bestaetigen(`„${d.titel}“ mit Verlauf löschen? Fotos und Dokumente bleiben im Archiv.`, { titel: 'Aufgabe löschen', ja: 'Löschen' })) return;
    try { await call('remove', 'vorgaenge', d.id); geaendert(); props.onClose(); } catch (e) { fehler(e); }
  }

  // ---------- head: kind and status ----------
  const kopf = (
    <div className="blatt-kopf">
      {neu ? (
        <div className="blatt-arten" role="radiogroup" aria-label="Art der Aufgabe">
          {ARTEN.map((a) => (
            <button key={a.k} type="button" role="radio" aria-checked={d.kategorie === a.k} className={`chip-knopf${d.kategorie === a.k ? ' an' : ''}`}
              onClick={() => setD((x) => ({ ...x, kategorie: x.kategorie === a.k ? null : a.k }))}><a.S size={14} aria-hidden="true" /> {a.l}</button>
          ))}
          <select aria-label="Andere Art" className={`chip-wahl${WEITERE.includes(d.kategorie) ? ' an' : ''}`} value={WEITERE.includes(d.kategorie) ? d.kategorie : ''}
            onChange={(e) => setD((x) => ({ ...x, kategorie: e.target.value || null }))}>
            <option value="">Andere …</option>{WEITERE.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <span className="spacer" />
          <button type="button" className="icon blatt-zu" aria-label="Schließen" title="Schließen" onClick={props.onClose}><I.X size={16} /></button>
        </div>
      ) : (
        <>
          <select aria-label="Art der Aufgabe" className="chip-wahl" value={d.kategorie ?? ''} onChange={(e) => aendern({ kategorie: e.target.value || null })}>
            <option value="">ohne Art</option>
            {[...ARTEN.map((a) => a.k), ...WEITERE, ...(d.kategorie && ![...ARTEN.map((a) => a.k), ...WEITERE].includes(d.kategorie) ? [d.kategorie] : [])]
              .map((k) => <option key={k} value={k}>{artName(k)}</option>)}
          </select>
          <span className="spacer" />
          <button type="button" className="icon blatt-zu" aria-label="Schließen" title="Schließen" onClick={props.onClose}><I.X size={16} /></button>
          <div className="segment blatt-status" role="radiogroup" aria-label="Status">
            {STATUS_KURZ.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={d.status === k} onClick={() => status(k)}>{l}</button>)}
          </div>
        </>
      )}
    </div>
  );

  // ---------- title (for a purchase: quantity and article) ----------
  const titel = (
    <div className="blatt-titel">
      {einkauf && (
        <Feld wert={d.menge ?? ''} label="Menge" platzhalter="Menge" className="blatt-menge" onTippen={neu ? (s) => setD((x) => ({ ...x, menge: s })) : undefined}
          onFertig={(s) => aendern({ menge: s.trim() || null })} />
      )}
      <Feld wachsend eingabeRef={titelRef} wert={d.titel ?? ''} label={einkauf ? 'Artikel' : 'Titel'} className="blatt-titel-eingabe"
        platzhalter={einkauf ? 'Was wird gebraucht?' : 'Was ist zu tun?'}
        onTippen={(s) => { setHinweis(''); if (neu) setD((x) => ({ ...x, titel: s })); }}
        onFertig={(s) => { if (!neu && s.trim()) aendern({ titel: s.trim() }); }} onEnter={neu ? anlegenUndSchliessen : undefined} />
      {neu && <DiktatKnopf klein onText={diktiert} />}
    </div>
  );

  // ---------- where, who, when ----------
  const offeneProjekte = (projekte ?? []).filter((p) => p.status !== 'abgeschlossen' || p.id === Number(d.projekt_id));
  const wann = (
    <div className="knopfreihe">
      {([['Heute', heute()], ['Morgen', inTagen(1)], ['Nächste Woche', inTagen(7)]] as [string, string][]).map(([l, t]) => (
        <button key={l} type="button" className={`chip-knopf${d.faellig === t ? ' an' : ''}`} aria-pressed={d.faellig === t} onClick={() => aendern({ faellig: t })}>{l}</button>
      ))}
      <input type="date" aria-label="Datum wählen" value={d.faellig ?? ''} onChange={(e) => aendern({ faellig: e.target.value || null })} />
      {d.faellig && <button type="button" className="icon" aria-label="Datum entfernen" title="Datum entfernen" onClick={() => aendern({ faellig: null })}><I.X size={14} /></button>}
    </div>
  );
  const zeilen: { k: string; immer?: boolean; plus: string; inhalt: ReactNode }[] = einkauf ? [
    { k: 'laden', immer: true, plus: 'Laden', inhalt: (
      <Eig symbol={<I.Store size={15} />} name="Laden">
        <div className="knopfreihe">
          {[...new Set([...(laeden ?? []), ...(d.laden ? [d.laden] : [])])].map((l) => (
            <button key={l} type="button" className={`chip-knopf${d.laden === l ? ' an' : ''}`} aria-pressed={d.laden === l} onClick={() => aendern({ laden: d.laden === l ? null : l })}>{l}</button>
          ))}
          <Feld wert="" leeren label="Anderer Laden" platzhalter={laeden?.length ? 'anderer …' : 'z. B. Bauhaus'} className="kurz" onFertig={(s) => { if (s.trim()) aendern({ laden: s.trim() }); }} />
        </div>
      </Eig>) },
    { k: 'preis_ct', immer: true, plus: 'Preis', inhalt: (
      <Eig symbol={<I.Euro size={15} />} name="Preis ca." fuer="bl-preis">
        <Feld id="bl-preis" wert={euroFeld(d.preis_ct)} label="Geschätzter Preis in Euro" platzhalter="0,00" inputMode="decimal" className="kurz"
          onFertig={(s) => aendern({ preis_ct: cent(s) })} />
        {d.zuletzt_ct != null && <span className="klein hinweis">zuletzt {euro(d.zuletzt_ct)}{d.zuletzt_menge ? ` (${d.zuletzt_menge})` : ''}</span>}
      </Eig>) },
    ...(projekt?.aufgaben?.length ? [{ k: 'projektaufgabe_id', immer: true, plus: 'Schritt', inhalt: (
      <Eig symbol={<I.ListChecks size={15} />} name="Für Schritt" fuer="bl-schritt">
        <select id="bl-schritt" value={d.projektaufgabe_id ?? ''} onChange={(e) => aendern({ projektaufgabe_id: Number(e.target.value) || null })}>
          <option value="">für keinen Schritt</option>
          {projekt.aufgaben.map((a: Row) => <option key={a.id} value={a.id}>{a.titel}{a.beginn ? ` (ab ${datum(a.beginn)})` : ''}</option>)}
        </select>
      </Eig>) }] : []),
  ] : [];
  zeilen.push(
    { k: 'objekt_id', immer: !einkauf, plus: 'Haus', inhalt: (
      <Eig symbol={<I.House size={15} />} name="Wo" fuer="bl-objekt">
        <div className="knopfreihe">
          <select id="bl-objekt" value={d.objekt_id ?? ''} onChange={(e) => aendern({ objekt_id: Number(e.target.value) || null, einheit_id: null })}>
            <option value="">kein Haus</option>
            {/* While the houses load, the saved one shows by its name (not as „kein Haus“). */}
            {!!d.objekt_id && !objekte?.some((o) => o.id === Number(d.objekt_id)) && <option value={d.objekt_id}>{d.objekt ?? '…'}</option>}
            {objekte?.map((o) => <option key={o.id} value={o.id}>{o.bezeichnung}</option>)}
          </select>
          {!!d.objekt_id && !!einheiten?.length && (
            <select aria-label="Einheit" value={d.einheit_id ?? ''} onChange={(e) => aendern({ einheit_id: Number(e.target.value) || null })}>
              <option value="">ganzes Haus</option>{einheiten.map((e) => <option key={e.id} value={e.id}>{e.nr ? `${e.nr} – ` : ''}{e.bezeichnung}</option>)}
            </select>
          )}
        </div>
        {!!geraete?.length && (
          <div className="chips" title="Geräte der Einheit aus dem Inventar – bei einem Defekt erst die Garantie prüfen">
            {geraete.map((g) => <span key={g.id} className={`chip${g.garantie_bis && g.garantie_bis >= heute() ? ' gruen' : ''}`}>
              {g.bezeichnung}{g.garantie_bis ? `: Garantie ${g.garantie_bis >= heute() ? 'bis' : 'abgelaufen'} ${datum(g.garantie_bis)}` : ''}</span>)}
          </div>
        )}
      </Eig>) },
    ...(!einkauf ? [{ k: 'person_id', plus: 'Betrifft', inhalt: (
      <Eig symbol={<I.User size={15} />} name="Betrifft">
        <Auswahl value={d.person_id ?? ''} options={personen ? personen.map((p) => [p.id, personName(p)]) : d.person_id ? [[d.person_id, d.person ?? '…']] : []} onChange={(v) => aendern({ person_id: Number(v) || null })}
          leer="niemand" platzhalter="Mieter, Handwerker, Kontakt" label="Betrifft" />
      </Eig>) }] : []),
    ...(benutzer?.length ? [{ k: 'zustaendig', plus: 'Kümmert sich', inhalt: (
      <Eig symbol={<I.UserCheck size={15} />} name="Kümmert sich" fuer="bl-zustaendig">
        <select id="bl-zustaendig" value={d.zustaendig ?? ''} onChange={(e) => aendern({ zustaendig: Number(e.target.value) || null })}>
          <option value="">niemand Bestimmtes</option>{benutzer.filter((b) => b.aktiv || b.id === Number(d.zustaendig)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </Eig>) }] : []),
    { k: 'faellig', immer: !einkauf, plus: 'Bis wann', inhalt: <Eig symbol={<I.CalendarClock size={15} />} name="Bis wann">{wann}</Eig> },
    { k: 'prioritaet', immer: !einkauf || Number(d.prioritaet) === 1, plus: 'Wichtigkeit', inhalt: (
      <Eig symbol={<I.Flag size={15} />} name="Wichtigkeit">
        <div className="segment" role="radiogroup" aria-label="Wichtigkeit">
          {WICHTIG.map(([w, l]) => <button key={w} type="button" role="radio" aria-checked={Number(d.prioritaet ?? 2) === w} className={w === 1 ? 'dringend' : undefined}
            onClick={() => aendern({ prioritaet: w })}>{l}</button>)}
        </div>
      </Eig>) },
    ...(offeneProjekte.length ? [{ k: 'projekt_id', immer: einkauf, plus: 'Projekt', inhalt: (
      <Eig symbol={<I.FolderKanban size={15} />} name="Projekt" fuer="bl-projekt">
        <select id="bl-projekt" value={d.projekt_id ?? ''} onChange={(e) => aendern({ projekt_id: Number(e.target.value) || null, ...(einkauf ? { projektaufgabe_id: null } : {}) })}>
          <option value="">kein Projekt</option>{offeneProjekte.map((p) => <option key={p.id} value={p.id}>{p.titel}</option>)}
        </select>
      </Eig>) }] : []),
  );
  const sichtbar = zeilen.filter((z) => z.immer || hat(z.k) || (z.k === 'prioritaet' && zeige.has('prioritaet')));
  const fehlend = zeilen.filter((z) => !sichtbar.includes(z));
  const seite = (
    <aside className="blatt-seite" aria-label="Wo, wer, wann">
      {sichtbar.map((z) => <div key={z.k}>{z.inhalt}</div>)}
      {(fehlend.length > 0 || (neu && !hat('beschreibung'))) && (
        <div className="chips blatt-mehr">
          {fehlend.map((z) => <button key={z.k} type="button" className="chip-knopf leer" onClick={() => dazu(z.k)}>+ {z.plus}</button>)}
          {neu && !hat('beschreibung') && <button type="button" className="chip-knopf leer" onClick={() => dazu('beschreibung')}>+ Details</button>}
          {neu && <button type="button" className="chip-knopf leer" onClick={async () => { const id = await anlegen(); if (id) { setD((x) => ({ ...x, id })); setHinweis('Angelegt. Jetzt das Foto aufnehmen.'); } }}>+ Foto</button>}
        </div>
      )}
      {!!erkannt.length && <p className="klein hinweis">Erkannt: {erkannt.join(' · ')}. Bitte prüfen.</p>}
    </aside>
  );

  // ---------- details, steps, photos, history ----------
  const [schritt, setSchritt] = useState('');
  async function schrittDazu(e: FormEvent) {
    e.preventDefault();
    if (!schritt.trim()) return;
    try {
      await call('save', 'vorgaenge', { titel: schritt.trim(), eltern_id: d.id, objekt_id: d.objekt_id ?? null, einheit_id: d.einheit_id ?? null, projekt_id: d.projekt_id ?? null,
        kategorie: d.kategorie ?? null, zustaendig: d.zustaendig ?? null, status: 'offen', prioritaet: 2 });
      setSchritt(''); ladeSchritte(); geaendert();
    } catch (x) { fehler(x); }
  }
  const [eintrag, setEintrag] = useState({ art: 'kommentar', text: '', datum: heute() });
  async function eintragen(e: FormEvent) {
    e.preventDefault();
    if (!eintrag.text.trim()) return;
    try {
      if (eintrag.art === 'kommentar') await call('vorgangKommentieren', d.id, eintrag.text.trim());
      else await call('save', 'vorgangseintraege', { ...eintrag, text: eintrag.text.trim(), vorgang_id: d.id });
      setEintrag({ ...eintrag, text: '' }); ladeEintraege(); geaendert();
    } catch (x) { fehler(x); }
  }
  const haupt = (
    <div className="blatt-haupt">
      {d.eltern_titel && <p className="klein hinweis">Schritt von „{d.eltern_titel}“</p>}
      {!!d.pflicht_id && <p className="klein hinweis"><I.ClipboardCheck size={13} aria-hidden="true" /> Pflicht am Haus: „Erledigt“ fragt nach Datum und Nachweis und setzt den nächsten Termin.</p>}
      {(!neu || hat('beschreibung')) && (
        <Feld mehrzeilig wert={d.beschreibung ?? ''} label="Details" className="blatt-details"
          platzhalter={einkauf ? 'Notiz: Farbe, Größe, Artikelnummer …' : 'Details, z. B. was genau gesagt wurde'}
          onTippen={neu ? (s) => setD((x) => ({ ...x, beschreibung: s })) : undefined} onFertig={(s) => aendern({ beschreibung: s.trim() || null })} />
      )}
      {!neu && !einkauf && (
        <section className="blatt-abschnitt" aria-label="Schritte">
          <h4>Schritte{!!schritte?.length && <span className="hinweis"> {schritte.filter((s) => s.status === 'erledigt').length}/{schritte.length}</span>}</h4>
          <ul className="schritte">
            {schritte?.map((s) => (
              <li key={s.id} className={s.status === 'erledigt' ? 'fertig' : ''}>
                <button type="button" className={`haken${s.status === 'erledigt' ? ' an' : ''}`} aria-pressed={s.status === 'erledigt'}
                  aria-label={`„${s.titel}“ ${s.status === 'erledigt' ? 'wieder öffnen' : 'erledigen'}`}
                  onClick={async () => { try { await call('vorgangStatus', s.id, s.status === 'erledigt' ? 'offen' : 'erledigt'); ladeSchritte(); geaendert(); } catch (x) { fehler(x); } }}>
                  <I.Check size={12} strokeWidth={3} aria-hidden="true" /></button>
                <span className="text">{s.titel}</span>
                {s.faellig && <span className="klein hinweis">{wannText(s.faellig)}</span>}
              </li>
            ))}
          </ul>
          <form className="schritt-neu" onSubmit={schrittDazu}>
            <I.Plus size={14} aria-hidden="true" />
            <input aria-label="Neuer Schritt" placeholder="Schritt hinzufügen" value={schritt} onChange={(e) => setSchritt(e.target.value)} />
          </form>
        </section>
      )}
      {!neu && (
        <section className="blatt-abschnitt" aria-label="Fotos und Dateien">
          <h4>{einkauf ? 'Fotos (Etikett, altes Teil)' : 'Fotos und Dateien'}</h4>
          <Galerie kompakt filter={{ vorgang_id: d.id }} onGeaendert={geaendert}
            ablage={{ vorgang_id: d.id, ...(d.objekt_id ? { objekt_id: d.objekt_id } : {}), ...(d.einheit_id ? { einheit_id: d.einheit_id } : {}), ...(d.projekt_id ? { projekt_id: d.projekt_id } : {}) }} />
        </section>
      )}
      {!neu && (
        <section className="blatt-abschnitt" aria-label="Verlauf">
          <h4>Verlauf</h4>
          {!eintraege?.length && <p className="klein hinweis">Noch nichts notiert.</p>}
          <ol className="verlauf">
            {eintraege?.map((e) => (
              <li key={e.id} className={e.art === 'status' ? 'still' : ''}>
                <span className="verlauf-kopf">{wannText(e.datum)}{e.von ? ` · ${e.von}` : ''}{!['kommentar', 'status'].includes(e.art) ? ` · ${EINTRAG_ARTEN.find(([a]) => a === e.art)?.[1] ?? e.art}` : ''}</span>
                <span className="verlauf-text">{e.text}</span>
                {e.art !== 'status' && <button type="button" className="icon verlauf-weg" aria-label="Eintrag löschen" title="Eintrag löschen"
                  onClick={async () => { if (await bestaetigen('Diesen Eintrag löschen?', { ja: 'Löschen' })) { await call('remove', 'vorgangseintraege', e.id); ladeEintraege(); } }}><I.X size={12} /></button>}
              </li>
            ))}
          </ol>
          <form className="verlauf-neu" onSubmit={eintragen}>
            <select aria-label="Art des Eintrags" value={eintrag.art} onChange={(e) => setEintrag({ ...eintrag, art: e.target.value })}>
              {EINTRAG_ARTEN.map(([a, l]) => <option key={a} value={a}>{l}</option>)}
            </select>
            {eintrag.art !== 'kommentar' && <input type="date" aria-label="Datum des Eintrags" value={eintrag.datum} onChange={(e) => setEintrag({ ...eintrag, datum: e.target.value })} />}
            <input aria-label="Eintrag" placeholder={eintrag.art === 'kommentar' ? 'Kommentar schreiben' : eintrag.art === 'anruf' ? 'Was wurde besprochen?' : 'Was ist passiert?'}
              value={eintrag.text} onChange={(e) => setEintrag({ ...eintrag, text: e.target.value })} />
            <DiktatKnopf klein onText={(t) => setEintrag((x) => ({ ...x, text: x.text ? `${x.text} ${t}` : t }))} />
            <button type="submit" className="icon" aria-label="Eintragen" title="Eintragen" disabled={!eintrag.text.trim()}><I.SendHorizontal size={15} /></button>
          </form>
        </section>
      )}
    </div>
  );

  const inhalt = (
    <>
      {kopf}
      {titel}
      {hinweis && <p className={`klein ${neu && !d.id ? 'fehlertext' : 'hinweis'}`} role="status">{hinweis}</p>}
      <div className="blatt-raster">{haupt}{seite}</div>
      {eigen.dialoge}
    </>
  );
  if (props.eingebettet) return <section className="blatt eingebettet" aria-label={d.titel ?? 'Aufgabe'}>{inhalt}</section>;
  return (
    <Fenster onClose={props.onClose}>
      <div className="dialog breit blatt blatt-fenster">
        <FensterTitel className="sr-only">{neu ? (einkauf ? 'Neuer Artikel' : 'Neue Aufgabe') : d.titel}</FensterTitel>
        {inhalt}
        <div className="buttons">
          {!neu && <button type="button" className="link gefahr" onClick={loeschen}><I.Trash2 size={14} aria-hidden="true" /> Löschen</button>}
          <span className="spacer" />
          {neu && !d.id ? <>
            <button type="button" onClick={props.onClose}>Abbrechen</button>
            <button type="button" className="primary" disabled={laeuft} onClick={anlegenUndSchliessen}>Anlegen</button>
          </> : <button type="button" className="primary" onClick={props.onClose}>Fertig</button>}
        </div>
      </div>
    </Fenster>
  );
}

// Used where art is shown as a word only (list rows).
const INTERN: Record<string, string> = { pflicht: 'Pflicht am Haus', ablauf: 'Ablauf' };
export const artName = (k?: string | null) => ARTEN.find((a) => a.k === k)?.l ?? INTERN[k ?? ''] ?? k ?? '';
