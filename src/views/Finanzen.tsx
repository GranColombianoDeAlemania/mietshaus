// Private finances (mode „Finanzen“): each user sees only their own accounts and movements – the server puts the
// signed-in user in front of every fin… call (electron/finanzen.cjs). Pages: overview (net worth, this month, budgets,
// what is due), movements (entry, bank statement import, categories, hand-over to a house or project and back),
// budgets, contracts and standing orders, evaluation with forecast, and the master data (accounts, categories, rules).
import { useState, type ReactNode } from 'react';
import * as I from 'lucide-react';
import { call, datum, euro, fehler, heute, inTagen, type Row } from '../api';
import { useLoad } from '../useLoad';
import { FormDialog, type Field } from '../Form';
import { Dialog, Tabs } from '../ui';
import { bestaetigen, hinweis } from '../frage';
import { leseKontoauszug } from '../bankformate';

const KONTOART: [string, string][] = [['giro', 'Girokonto'], ['spar', 'Tagesgeld / Sparkonto'], ['bar', 'Bargeld'], ['karte', 'Kreditkarte'], ['depot', 'Depot'], ['kredit', 'Kredit / Darlehen'], ['sonstig', 'Sonstiges']];
const VERTRAGSART = ['Miete', 'Strom / Gas', 'Internet / Telefon', 'Mobilfunk', 'Versicherung', 'Abo', 'Mitgliedschaft', 'Kredit', 'Sparplan', 'Gehalt', 'Sonstiges'];
const RHYTHMUS: [number, string][] = [[1, 'monatlich'], [2, 'alle 2 Monate'], [3, 'vierteljährlich'], [6, 'halbjährlich'], [12, 'jährlich']];
const STEUER: [string, string][] = [['werbungskosten', 'Werbungskosten'], ['vorsorge', 'Vorsorgeaufwendungen'], ['haushaltsnah', 'Haushaltsnahe Leistungen (§ 35a)'], ['spenden', 'Spenden'],
  ['aussergewoehnlich', 'Außergewöhnliche Belastungen'], ['kapital', 'Kapitalerträge']];
const monatName = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
const zahlKlasse = (ct: number) => (ct < 0 ? 'num negativ' : 'num');
const prozent = (teil: number, ganz: number) => (ganz > 0 ? Math.min(100, Math.round((teil / ganz) * 100)) : 0);

function Balken(props: { wert: number; max: number; art?: 'rot' | 'gruen' }) {
  return <div className="fin-balken"><span className={props.art ?? ''} style={{ width: `${prozent(props.wert, props.max)}%` }} /></div>;
}
const Leer = (props: { children: ReactNode; aktion?: ReactNode }) => <div className="leerzustand"><p>{props.children}</p>{props.aktion}</div>;

// ---------- overview ----------
export function FinCockpit(props: { oeffne: (seite: string) => void }) {
  const [d] = useLoad<Row>(() => call('finUebersicht'), []);
  if (!d) return null;
  if (!d.konten.length) return (
    <section>
      <div className="toolbar"><h1>Finanzen</h1></div>
      <Leer aktion={<button className="primary" onClick={() => props.oeffne('fstamm')}>Erstes Konto anlegen</button>}>
        Hier verwaltest du dein privates Geld: Konten, Ausgaben nach Kategorien, Budgets, Verträge und Auswertungen. Nur du siehst diese Daten.
      </Leer>
    </section>
  );
  const maxMonat = Math.max(1, ...d.verlauf.map((v: Row) => Math.max(v.ein_ct, v.aus_ct)));
  const minV = Math.min(...d.verlauf.map((v: Row) => v.vermoegen_ct)), maxV = Math.max(...d.verlauf.map((v: Row) => v.vermoegen_ct));
  return (
    <section>
      <div className="toolbar"><h1>Finanzen</h1><span className="spacer" /><button className="primary" onClick={() => props.oeffne('fbuchungen')}>Buchungen</button></div>
      <div className="kz-raster">
        <div className="kz b4">
          <div className="kz-kopf"><h3>Vermögen</h3></div>
          <div className="kz-wert">{euro(d.vermoegen_ct)}</div>
          <div className="kz-text">Guthaben {euro(d.guthaben_ct)}{d.schulden_ct ? <> · Schulden {euro(d.schulden_ct)}</> : null}</div>
          <div className="fin-linie" role="img" aria-label="Vermögen der letzten zwölf Monate">
            {d.verlauf.map((v: Row) => <span key={v.monat} title={`${monatName(v.monat)}: ${euro(v.vermoegen_ct)}`}
              style={{ height: `${maxV === minV ? 60 : 30 + ((v.vermoegen_ct - minV) / (maxV - minV)) * 70}%` }} />)}
          </div>
        </div>
        <div className="kz b4">
          <div className="kz-kopf"><h3>Dieser Monat</h3></div>
          <div className="kz-wert">{euro(d.ein_ct - d.aus_ct)}<small>übrig</small></div>
          <div className="kz-text">Einnahmen <b>{euro(d.ein_ct)}</b> · Ausgaben <b>{euro(d.aus_ct)}</b>{d.sparquote != null && <> · Sparquote <b>{String(d.sparquote).replace('.', ',')} %</b></>}</div>
          <ul className="kz-liste">{d.top.map((t: Row) => <li key={t.name}><span>{t.name}</span><span className="num">{euro(t.summe_ct)}</span></li>)}</ul>
        </div>
        <div className="kz b4">
          <div className="kz-kopf"><h3>Fällig in 30 Tagen</h3><button className="link" onClick={() => props.oeffne('fdauer')}>Verträge</button></div>
          <div className="kz-text">Feste Ausgaben je Monat <b>{euro(d.fix_monat_ct)}</b></div>
          {!d.faellig.length && <div className="kz-text">Nichts fällig.</div>}
          <ul className="kz-liste">{d.faellig.map((f: Row) => <li key={f.id}><span>{datum(f.naechste)} · {f.empfaenger}</span><span className={zahlKlasse(f.betrag_ct)}>{euro(f.betrag_ct)}</span></li>)}</ul>
        </div>
        <div className="kz b6">
          <div className="kz-kopf"><h3>Konten</h3><button className="link" onClick={() => props.oeffne('fstamm')}>verwalten</button></div>
          <ul className="kz-liste">{d.konten.map((k: Row) => <li key={k.id}><span>{k.name} <span className="klein">{KONTOART.find(([a]) => a === k.art)?.[1]}{k.warnung ? (k.warnung === 'dispo' ? ' · über dem Dispo' : ' · unter dem Mindeststand') : ''}</span></span><span className={zahlKlasse(k.wert_ct)}>{euro(k.wert_ct)}</span></li>)}</ul>
        </div>
        <div className="kz b6">
          <div className="kz-kopf"><h3>Budgets</h3><button className="link" onClick={() => props.oeffne('fbudget')}>alle</button></div>
          {!d.budgets.length && <div className="kz-text">Noch kein Budget. Ein Budget je Kategorie zeigt früh, wenn ein Monat aus dem Ruder läuft.</div>}
          {d.budgets.slice(0, 6).map((g: Row) => (
            <div key={g.kategorie_id} className="fin-budgetzeile">
              <div className="kz-zeile"><span>{g.name}</span><span className={g.rest_ct < 0 ? 'num negativ' : 'num'}>{euro(g.ist_ct)} von {euro(g.betrag_ct)}</span></div>
              <Balken wert={g.ist_ct} max={g.betrag_ct} art={g.rest_ct < 0 ? 'rot' : undefined} />
            </div>
          ))}
        </div>
        <div className="kz b8">
          <div className="kz-kopf"><h3>Einnahmen und Ausgaben, 12 Monate</h3><button className="link" onClick={() => props.oeffne('fauswertung')}>Auswertung</button></div>
          <div className="fin-saeulen" role="img" aria-label="Einnahmen und Ausgaben je Monat">
            {d.verlauf.map((v: Row) => (
              <div key={v.monat} title={`${monatName(v.monat)}: ein ${euro(v.ein_ct)}, aus ${euro(v.aus_ct)}`}>
                <div className="paar"><span className="ein" style={{ height: `${prozent(v.ein_ct, maxMonat)}%` }} /><span className="aus" style={{ height: `${prozent(v.aus_ct, maxMonat)}%` }} /></div>
                <small>{monatName(v.monat).split(' ')[0]}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="kz b4">
          <div className="kz-kopf"><h3>Zu tun</h3></div>
          {d.ohne_kategorie > 0
            ? <div className="kz-text"><b>{d.ohne_kategorie}</b> Buchungen ohne Kategorie. <button className="link" onClick={() => props.oeffne('fbuchungen')}>Zuordnen</button></div>
            : <div className="kz-text">Alle Buchungen haben eine Kategorie.</div>}
          {d.neue > 0 && <div className="kz-text"><b>{d.neue}</b> neue Buchungen vom Kontoauszug noch nicht angesehen.</div>}
          {d.vorgemerkt.n > 0 && <div className="kz-text"><b>{d.vorgemerkt.n}</b> vorgemerkte Zahlungen ({euro(d.vorgemerkt.summe_ct)}) warten auf den Kontoauszug.</div>}
          {d.warnungen.filter((w: Row) => w.abgleich_ct).map((w: Row) => <div key={w.konto_id} className="kz-text">{w.konto}: <b>{euro(Math.abs(w.abgleich_ct))}</b> Abweichung zum Kontostand der Bank.</div>)}
          {d.kuendigen.map((v: Row) => <div key={v.id} className="kz-text">{v.empfaenger}: kündbar bis <b>{datum(v.kuendigen_bis)}</b></div>)}
          <div className="kz-text">Kontostand voraussichtlich:</div>
          <ul className="kz-liste">{d.prognose.map((p: Row) => <li key={p.monat}><span>Ende {monatName(p.monat)}</span><span className={zahlKlasse(p.stand_ct)}>{euro(p.stand_ct)}</span></li>)}</ul>
        </div>
      </div>
    </section>
  );
}

// ---------- movements ----------
const buchungFelder = (konten: Row[], kategorien: Row[]) => (f: Row): Field[] => [
  { key: 'art', label: 'Art', type: 'select', required: true, options: [['aus', 'Ausgabe'], ['ein', 'Einnahme'], ...(f.id ? [] : [['um', 'Umbuchung zwischen eigenen Konten'] as [string, string]])] },
  { key: 'betrag', label: 'Betrag', type: 'money', required: true },
  { key: 'datum', label: 'Datum', type: 'date', required: true },
  { key: 'konto_id', label: f.art === 'um' ? 'Von Konto' : 'Konto', type: 'select', required: true, options: konten.map((k) => [k.id, k.name]) },
  ...(f.art === 'um' ? [{ key: 'gegenkonto_id', label: 'Auf Konto', type: 'select', required: true, options: konten.map((k) => [k.id, k.name]) } as Field] : [
    { key: 'empfaenger', label: f.art === 'ein' ? 'Von wem' : 'An wen' } as Field,
    { key: 'kategorie_id', label: 'Kategorie', type: 'select', options: kategorien.filter((c) => !c.archiviert && c.art === (f.art === 'ein' ? 'einnahme' : 'ausgabe')).map((c) => [c.id, c.pfad]) } as Field,
  ]),
  { key: 'zweck', label: 'Verwendungszweck', wide: true },
  { key: 'kennzeichen', label: 'Kennzeichen (z. B. Urlaub 2026, Steuer)' },
  { key: 'vorgemerkt', label: 'Vorgemerkt: noch nicht auf dem Kontoauszug', type: 'check' },
  { key: 'notiz', label: 'Notiz', type: 'textarea' },
];

export function FinBuchungen() {
  const [konten] = useLoad<Row[]>(() => call('finKonten'), []);
  const [kategorien] = useLoad<Row[]>(() => call('finKategorien'), []);
  const [kontoId, setKontoId] = useState<number | ''>('');
  const [katId, setKatId] = useState<number | ''>('');
  const [ohne, setOhne] = useState(false);
  const [nurNeue, setNurNeue] = useState(false);
  const [teilen, setTeilen] = useState<Row | null>(null);
  const [umb, ladeUmb] = useLoad<Row[]>(() => call('finUmbuchungVorschlaege'), []);
  const [suche, setSuche] = useState('');
  const [von, setVon] = useState(inTagen(-90));
  const [rows, reload] = useLoad<Row[]>(() => call('finBuchungen', { konto_id: kontoId || null, kategorie_id: katId || null, ohne_kategorie: ohne, nur_neue: nurNeue, suche, von: von || null }), [kontoId, katId, ohne, nurNeue, suche, von]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [gewaehlt, setGewaehlt] = useState<Set<number>>(new Set());
  const [ueber, setUeber] = useState<Row | null>(null);
  const [holen, setHolen] = useState(false);
  const aktiv = (konten ?? []).filter((k) => !k.archiviert);
  const neu = () => setEdit({ art: 'aus', datum: heute(), konto_id: kontoId || aktiv[0]?.id });

  async function importieren() {
    const ziel = kontoId || (aktiv.length === 1 ? aktiv[0].id : null);
    if (!ziel) return hinweis('Wähle oben zuerst das Konto, zu dem der Kontoauszug gehört.');
    const f = await window.hv.oeffnen({ name: 'Kontoauszug (CAMT, MT940, CSV)', extensions: ['xml', 'sta', 'mt940', 'txt', 'csv'] });
    if (!f) return;
    try {
      const zeilen = leseKontoauszug(Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)));
      const r = await call<Row>('finImport', ziel, zeilen);
      reload(); ladeUmb();
      hinweis(`${r.neu} neue Buchungen übernommen${r.doppelt ? `, ${r.doppelt} waren schon da` : ''}${r.bestaetigt ? `, ${r.bestaetigt} vorgemerkte bestätigt` : ''}. ${r.kategorisiert} davon haben über deine Regeln eine Kategorie bekommen.`, 'Kontoauszug');
    } catch (e) { fehler(e); }
  }
  async function kategorisieren(kategorieId: number) {
    const ids = [...gewaehlt];
    const erste = rows?.find((r) => r.id === ids[0]);
    const namen = new Set(ids.map((id) => rows?.find((r) => r.id === id)?.empfaenger));
    // One payee chosen: offer to remember it, so the next statement is categorised by itself.
    const regel = namen.size === 1 && erste?.empfaenger && await bestaetigen(`„${erste.empfaenger}“ künftig immer so einordnen?`, { titel: 'Regel merken', ja: 'Ja, merken', nein: 'Nur diese' }) ? erste.empfaenger : null;
    try { await call('finKategorisieren', ids, kategorieId, regel); setGewaehlt(new Set()); reload(); } catch (e) { fehler(e); }
  }
  const umschalten = (id: number) => setGewaehlt((g) => { const n = new Set(g); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (konten && !konten.length) return <section><div className="toolbar"><h1>Buchungen</h1></div><Leer>Lege zuerst unter „Konten & Kategorien“ ein Konto an.</Leer></section>;
  return (
    <section>
      <div className="toolbar">
        <h1>Buchungen</h1><span className="spacer" />
        <button onClick={() => setHolen(true)} title="Eine Buchung aus einem Haus oder Projekt in die privaten Finanzen übernehmen"><I.ArrowDownToLine size={15} /> Aus Haus / Projekt</button>
        <button onClick={importieren}><I.FileUp size={15} /> Kontoauszug</button>
        <button className="primary" onClick={neu}>Neue Buchung</button>
      </div>
      <div className="toolbar filter">
        <select aria-label="Konto" value={kontoId} onChange={(e) => setKontoId(Number(e.target.value) || '')}><option value="">alle Konten</option>{konten?.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select>
        <select aria-label="Kategorie" value={katId} onChange={(e) => setKatId(Number(e.target.value) || '')}><option value="">alle Kategorien</option>{kategorien?.map((c) => <option key={c.id} value={c.id}>{c.pfad}</option>)}</select>
        <label className="check"><input type="checkbox" checked={ohne} onChange={(e) => setOhne(e.target.checked)} /> ohne Kategorie</label>
        <label className="check"><input type="checkbox" checked={nurNeue} onChange={(e) => setNurNeue(e.target.checked)} /> nur neue</label>
        {rows?.some((r) => r.neu) && <button className="link" onClick={async () => { try { await call('finGesehen'); reload(); } catch (e) { fehler(e); } }}>Alle als gesehen markieren</button>}
        <label className="klein">ab <input type="date" value={von} onChange={(e) => setVon(e.target.value)} /></label>
        <input className="suche" placeholder="Suchen" aria-label="Suchen" value={suche} onChange={(e) => setSuche(e.target.value)} />
      </div>
      {!!umb?.length && (
        <div className="hinweisbox">
          <b>Umbuchung zwischen deinen Konten?</b> Diese Zahlungen tauchen auf zwei Konten mit gleichem Betrag auf. Verbunden zählen sie nicht als Ausgabe und Einnahme.
          <div className="chips" style={{ marginTop: 8 }}>
            {umb.slice(0, 6).map((u) => <button key={u.von_id} className="chip-knopf" onClick={async () => { try { await call('finUmbuchungVerbinden', u.von_id, u.nach_id); reload(); ladeUmb(); } catch (e) { fehler(e); } }}>
              {datum(u.datum)} · {euro(Math.abs(u.betrag_ct))} · {u.von_konto} → {u.nach_konto}</button>)}
          </div>
        </div>
      )}
      {gewaehlt.size > 0 && (
        <div className="hinweisbox fin-auswahl">
          <span>{gewaehlt.size} gewählt:</span>
          <select aria-label="Kategorie zuweisen" value="" onChange={(e) => e.target.value && kategorisieren(Number(e.target.value))}>
            <option value="">Kategorie zuweisen …</option>
            {kategorien?.filter((c) => !c.archiviert).map((c) => <option key={c.id} value={c.id}>{c.pfad} ({c.art === 'einnahme' ? 'Einnahme' : 'Ausgabe'})</option>)}
          </select>
          <button className="link" onClick={() => setGewaehlt(new Set())}>Auswahl aufheben</button>
        </div>
      )}
      <table className="fin-tabelle">
        <thead><tr><th /><th>Datum</th><th>Empfänger / Zweck</th><th>Kategorie</th><th>Konto</th><th className="num">Betrag</th><th /></tr></thead>
        <tbody>
          {rows?.map((r) => (
            <tr key={r.id} className={`klickbar${r.neu ? ' fin-neu' : ''}${r.vorgemerkt ? ' fin-vorgemerkt' : ''}`} onClick={() => setEdit({ ...r, art: r.betrag_ct < 0 ? 'aus' : 'ein', betrag: Math.abs(r.betrag_ct) })}>
              <td onClick={(e) => e.stopPropagation()}>{!r.umbuchung_id && !r.teile && <input type="checkbox" aria-label={`${r.empfaenger ?? 'Buchung'} auswählen`} checked={gewaehlt.has(r.id)} onChange={() => umschalten(r.id)} />}</td>
              <td>{datum(r.datum)}</td>
              <td><b>{r.empfaenger ?? '–'}</b>{r.zweck && <div className="klein hinweis">{r.zweck}</div>}</td>
              <td>{r.umbuchung_id ? <span className="chip">Umbuchung</span> : r.teile ? <span title="aufgeteilt"><span className="chip">Split</span> {r.teil_kategorien}</span> : r.kategorie ?? <span className="chip gelb">offen</span>}
                {r.kennzeichen && <span className="chip">{r.kennzeichen}</span>}{!!r.vorgemerkt && <span className="chip gelb">vorgemerkt</span>}
                {r.ziel_art && <span className="chip akzent" title={r.richtung === 'hin' ? 'an Haus oder Projekt übergeben' : 'aus Haus oder Projekt übernommen'}>{r.ziel_art === 'buchung' ? 'Haus' : 'Projekt'}</span>}</td>
              <td className="klein">{r.konto}</td>
              <td className={zahlKlasse(r.betrag_ct)}>{euro(r.betrag_ct)}</td>
              <td className="aktionen" onClick={(e) => e.stopPropagation()}>
                {!r.umbuchung_id && <button title="Auf mehrere Kategorien aufteilen" aria-label="Aufteilen" onClick={() => setTeilen(r)}><I.Split size={14} /></button>}
                {!r.umbuchung_id && !r.ziel_art && <button title="An ein Haus oder Projekt übergeben" aria-label="An Haus oder Projekt übergeben" onClick={() => setUeber(r)}><I.ArrowUpFromLine size={14} /></button>}
              </td>
            </tr>
          ))}
          {rows && !rows.length && <tr><td colSpan={7} className="hinweis">Keine Buchungen in dieser Auswahl.</td></tr>}
        </tbody>
      </table>
      {edit && <FormDialog title={edit.id ? 'Buchung bearbeiten' : 'Neue Buchung'} row={edit} fields={buchungFelder(aktiv, kategorien ?? [])}
        onSave={(r) => call('finBuchungSpeichern', { id: edit.id, konto_id: Number(r.konto_id), gegenkonto_id: r.art === 'um' ? Number(r.gegenkonto_id) : null, datum: r.datum,
          betrag_ct: (r.art === 'ein' ? 1 : -1) * Math.abs(r.betrag), empfaenger: r.empfaenger, zweck: r.zweck, notiz: r.notiz, kategorie_id: Number(r.kategorie_id) || null,
          kennzeichen: r.kennzeichen, vorgemerkt: r.vorgemerkt ? 1 : 0 })}
        onDelete={edit.id ? () => call('finBuchungLoeschen', edit.id) : undefined} onClose={() => { setEdit(null); reload(); }} />}
      {teilen && <Aufteilen buchung={teilen} kategorien={kategorien ?? []} onClose={() => { setTeilen(null); reload(); }} />}
      {ueber && <Uebergeben buchung={ueber} onClose={() => { setUeber(null); reload(); }} />}
      {holen && <Uebernehmen konten={aktiv} kategorien={kategorien ?? []} vorgabe={kontoId || aktiv[0]?.id} onClose={() => { setHolen(false); reload(); }} />}
    </section>
  );
}

// One movement, several categories (the supermarket receipt with food and clothes): the parts must add up to the amount.
function Aufteilen(props: { buchung: Row; kategorien: Row[]; onClose: () => void }) {
  const x = props.buchung;
  const minus = x.betrag_ct < 0;
  const gesamt = Math.abs(x.betrag_ct);
  const [teile, setTeile] = useState<{ betrag: string; kategorie_id: string; zweck: string }[] | null>(null);
  useLoad<Row[]>(async () => {
    const t: Row[] = await call('finBuchungTeile', x.id);
    setTeile(t.length ? t.map((r) => ({ betrag: (Math.abs(r.betrag_ct) / 100).toFixed(2).replace('.', ','), kategorie_id: String(r.kategorie_id ?? ''), zweck: r.zweck ?? '' }))
      : [{ betrag: (gesamt / 100).toFixed(2).replace('.', ','), kategorie_id: String(x.kategorie_id ?? ''), zweck: '' }, { betrag: '', kategorie_id: '', zweck: '' }]);
    return t;
  }, [x.id]);
  const cent = (s: string) => Math.round((Number(s.replace(/\./g, '').replace(',', '.')) || 0) * 100);
  const summe = (teile ?? []).reduce((s, t) => s + cent(t.betrag), 0);
  const rest = gesamt - summe;
  const setze = (i: number, teil: Partial<{ betrag: string; kategorie_id: string; zweck: string }>) => setTeile((alt) => alt!.map((t, j) => (j === i ? { ...t, ...teil } : t)));
  async function speichern(liste: typeof teile) {
    try {
      await call('finBuchungTeilen', x.id, (liste ?? []).filter((t) => cent(t.betrag)).map((t) => ({ betrag_ct: (minus ? -1 : 1) * cent(t.betrag), kategorie_id: Number(t.kategorie_id) || null, zweck: t.zweck })));
      props.onClose();
    } catch (e) { fehler(e); }
  }
  const passend = props.kategorien.filter((c) => !c.archiviert && c.art === (minus ? 'ausgabe' : 'einnahme'));
  return (
    <Dialog titel="Buchung aufteilen" onClose={props.onClose}
      aktionen={<><button onClick={() => speichern([])}>Aufteilung entfernen</button><button className="primary" disabled={rest !== 0} onClick={() => speichern(teile)}>Speichern</button></>}>
      <p><b>{x.empfaenger ?? 'Buchung'}</b> · {datum(x.datum)} · <span className={zahlKlasse(x.betrag_ct)}>{euro(x.betrag_ct)}</span></p>
      <div className="fin-teile">
        {teile?.map((t, i) => (
          <div key={i} className="fin-teil">
            <input aria-label={`Betrag Teil ${i + 1}`} inputMode="decimal" className="num" placeholder="0,00" value={t.betrag} onChange={(e) => setze(i, { betrag: e.target.value })} />
            <select aria-label={`Kategorie Teil ${i + 1}`} value={t.kategorie_id} onChange={(e) => setze(i, { kategorie_id: e.target.value })}><option value="">– Kategorie –</option>{passend.map((c) => <option key={c.id} value={c.id}>{c.pfad}</option>)}</select>
            <input aria-label={`Notiz Teil ${i + 1}`} placeholder="wofür" value={t.zweck} onChange={(e) => setze(i, { zweck: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="knopfreihe">
        <button onClick={() => setTeile((alt) => [...(alt ?? []), { betrag: rest > 0 ? (rest / 100).toFixed(2).replace('.', ',') : '', kategorie_id: '', zweck: '' }])}>+ Teil</button>
        <span className={rest === 0 ? 'hinweis klein' : 'fehlertext klein'}>{rest === 0 ? 'Die Teile ergeben den Betrag.' : rest > 0 ? `Es fehlen noch ${euro(rest)}.` : `${euro(-rest)} zu viel verteilt.`}</span>
      </div>
    </Dialog>
  );
}

// A private movement goes to a house (its ledger) or to a project (a paid invoice).
function Uebergeben(props: { buchung: Row; onClose: () => void }) {
  const x = props.buchung;
  const [ziel, setZiel] = useState<'objekt' | 'projekt'>(x.betrag_ct < 0 ? 'projekt' : 'objekt');
  const [objekte] = useLoad<Row[]>(async () => [...new Map([...await call('objekte', 'miete'), ...await call('objekte', 'weg')].map((o: Row) => [o.id, o])).values()], []);
  const [projekte] = useLoad<Row[]>(() => call<Row[]>('projektListe'), []);
  const [objektId, setObjektId] = useState<number | ''>('');
  const [projektId, setProjektId] = useState<number | ''>('');
  const [konten] = useLoad<Row[]>(() => (objektId ? call('finObjektKonten', objektId) : Promise.resolve([])), [objektId]);
  const [kontoId, setKontoId] = useState<number | ''>('');
  const passend = (konten ?? []).filter((k) => (x.betrag_ct < 0 ? k.klasse === 'kosten' : k.klasse !== 'kosten'));
  async function los() {
    try {
      await call('finUebergeben', x.id, ziel === 'projekt' ? { ziel, projekt_id: projektId } : { ziel, objekt_id: objektId, konto_id: kontoId });
      props.onClose();
    } catch (e) { fehler(e); }
  }
  return (
    <Dialog titel="An Haus oder Projekt übergeben" onClose={props.onClose}
      aktionen={<button className="primary" disabled={ziel === 'projekt' ? !projektId : !objektId || !kontoId} onClick={los}>Übergeben</button>}>
      <p><b>{x.empfaenger ?? 'Buchung'}</b> · {datum(x.datum)} · <span className={zahlKlasse(x.betrag_ct)}>{euro(x.betrag_ct)}</span></p>
      {x.betrag_ct < 0 && <Tabs tabs={[['projekt', 'Projekt'], ['objekt', 'Haus']]} value={ziel} onChange={setZiel} />}
      {ziel === 'projekt' ? (
        <div className="maske">
          <label>Projekt<select value={projektId} onChange={(e) => setProjektId(Number(e.target.value) || '')}><option value="">– bitte wählen –</option>{projekte?.filter((p) => p.status !== 'abgeschlossen').map((p) => <option key={p.id} value={p.id}>{p.titel}</option>)}</select></label>
          <p className="hinweis klein" style={{ gridColumn: '1 / -1', margin: 0 }}>Die Ausgabe steht danach als bezahlte Rechnung unter „Kosten & Budget“ des Projekts.</p>
        </div>
      ) : (
        <div className="maske">
          <label>Haus<select value={objektId} onChange={(e) => { setObjektId(Number(e.target.value) || ''); setKontoId(''); }}><option value="">– bitte wählen –</option>{objekte?.map((o) => <option key={o.id} value={o.id}>{o.bezeichnung}</option>)}</select></label>
          <label>{x.betrag_ct < 0 ? 'Kostenkonto' : 'Einnahme- oder Mieterkonto'}<select value={kontoId} onChange={(e) => setKontoId(Number(e.target.value) || '')}><option value="">– bitte wählen –</option>{passend.map((k) => <option key={k.id} value={k.id}>{k.nr} {k.bezeichnung}</option>)}</select></label>
          <p className="hinweis klein" style={{ gridColumn: '1 / -1', margin: 0 }}>In der Buchhaltung des Hauses wird gegen das Konto „Privat (Einlagen und Entnahmen)“ gebucht. So zählt die Zahlung dort mit, ohne dass sie über das Objektkonto lief.</p>
        </div>
      )}
    </Dialog>
  );
}

// The other way: a movement of a house's bank account or a paid project invoice becomes a private movement.
function Uebernehmen(props: { konten: Row[]; kategorien: Row[]; vorgabe?: number; onClose: () => void }) {
  const [art, setArt] = useState<'objekt' | 'projekt'>('objekt');
  const [objekte] = useLoad<Row[]>(async () => [...new Map([...await call('objekte', 'miete'), ...await call('objekte', 'weg')].map((o: Row) => [o.id, o])).values()], []);
  const [projekte] = useLoad<Row[]>(() => call<Row[]>('projektListe'), []);
  const [id, setId] = useState<number | ''>('');
  const [kontoId, setKontoId] = useState<number | ''>(props.vorgabe ?? '');
  const [liste, reload] = useLoad<Row[]>(() => (id ? call('finUebernehmbar', art === 'objekt' ? { objekt_id: id } : { projekt_id: id }) : Promise.resolve([])), [art, id]);
  async function nimm(q: Row, kategorieId: number | null) {
    try { await call('finUebernehmen', { quelle: q.quelle, id: q.id, konto_id: kontoId, kategorie_id: kategorieId }); reload(); } catch (e) { fehler(e); }
  }
  return (
    <Dialog titel="Aus Haus oder Projekt übernehmen" breit onClose={props.onClose}>
      <Tabs tabs={[['objekt', 'Haus'], ['projekt', 'Projekt']]} value={art} onChange={(a) => { setArt(a); setId(''); }} />
      <div className="toolbar filter">
        <select aria-label={art === 'objekt' ? 'Haus' : 'Projekt'} value={id} onChange={(e) => setId(Number(e.target.value) || '')}>
          <option value="">– {art === 'objekt' ? 'Haus' : 'Projekt'} wählen –</option>
          {(art === 'objekt' ? objekte : projekte)?.map((o) => <option key={o.id} value={o.id}>{o.bezeichnung ?? o.titel}</option>)}
        </select>
        <label className="klein">auf mein Konto <select value={kontoId} onChange={(e) => setKontoId(Number(e.target.value) || '')}>{props.konten.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label>
      </div>
      <p className="hinweis klein">{art === 'objekt' ? 'Zahlungen der letzten drei Monate über die Geldkonten des Hauses. Geld, das das Haus verlässt, ist für dich eine Einnahme (z. B. eine Entnahme), Geld, das hineingeht, eine Ausgabe.'
        : 'Rechnungen des Projekts der letzten drei Monate, die du privat bezahlt hast.'}</p>
      <table>
        <tbody>
          {liste?.map((q) => (
            <tr key={q.id}>
              <td>{datum(q.datum)}</td><td><b>{q.name ?? ''}</b><div className="klein hinweis">{q.text}</div></td><td className={zahlKlasse(q.betrag_ct)}>{euro(q.betrag_ct)}</td>
              <td className="aktionen">
                <select aria-label="Kategorie und übernehmen" value="" disabled={!kontoId} onChange={(e) => e.target.value && nimm(q, Number(e.target.value) || null)}>
                  <option value="">Übernehmen als …</option><option value="0">ohne Kategorie</option>
                  {props.kategorien.filter((c) => !c.archiviert && c.art === (q.betrag_ct < 0 ? 'ausgabe' : 'einnahme')).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </td>
            </tr>
          ))}
          {id !== '' && liste && !liste.length && <tr><td className="hinweis">Nichts zu übernehmen.</td></tr>}
        </tbody>
      </table>
    </Dialog>
  );
}

// ---------- budgets ----------
export function FinBudget() {
  const [monat, setMonat] = useState(heute().slice(0, 7));
  const [budgets, reload] = useLoad<Row[]>(() => call('finBudgets', monat), [monat]);
  const [kategorien] = useLoad<Row[]>(() => call('finKategorien'), []);
  const [edit, setEdit] = useState<Row | null>(null);
  const frei = (kategorien ?? []).filter((c) => c.art === 'ausgabe' && !c.archiviert && !budgets?.some((g) => g.kategorie_id === c.id));
  const monatlich = (budgets ?? []).filter((g) => g.intervall_monate === 1);
  const summe = monatlich.reduce((s, g) => s + g.betrag_ct, 0), ist = monatlich.reduce((s, g) => s + g.ist_ct, 0);
  return (
    <section>
      <div className="toolbar"><h1>Budgets</h1><span className="spacer" />
        <input type="month" aria-label="Monat" value={monat} onChange={(e) => setMonat(e.target.value || heute().slice(0, 7))} />
        <button className="primary" disabled={!frei.length} onClick={() => setEdit({ kategorie_id: frei[0]?.id, intervall_monate: 1, mit_unter: 1 })}>Budget festlegen</button></div>
      {budgets && !budgets.length && <Leer>Lege je Ausgaben-Kategorie fest, wie viel du im Monat ausgeben willst. Die Liste zeigt dann, wie viel davon schon weg ist.</Leer>}
      {!!budgets?.length && (
        <div className="panel">
          <div className="kz-zeile"><h3>Monatsbudgets gesamt</h3><span className="num">{euro(ist)} von {euro(summe)} · {euro(summe - ist)} übrig</span></div>
          <Balken wert={ist} max={summe} art={ist > summe ? 'rot' : undefined} />
          {budgets.map((g) => (
            <button key={g.kategorie_id} className="fin-budgetzeile knopf" onClick={() => setEdit(g)}>
              <div className="kz-zeile"><span>{g.eltern ? `${g.eltern} › ` : ''}{g.name} <span className="klein hinweis">{g.intervall_monate === 12 ? 'im Jahr' : g.intervall_monate === 3 ? 'im Quartal' : 'im Monat'}{g.tempo != null && g.tempo > 115 && g.rest_ct >= 0 ? ' · schneller als geplant' : ''}</span></span>
                <span className={g.rest_ct < 0 ? 'num negativ' : 'num'}>{euro(g.ist_ct)}{g.erwartet_ct ? ` + ${euro(g.erwartet_ct)} erwartet` : ''} von {euro(g.betrag_ct)}{g.rest_ct < 0 ? ` · ${euro(-g.rest_ct)} drüber` : ` · ${euro(g.rest_ct)} übrig`}</span></div>
              <Balken wert={g.ist_ct + g.erwartet_ct} max={g.betrag_ct} art={g.rest_ct < 0 ? 'rot' : undefined} />
            </button>
          ))}
        </div>
      )}
      {edit && <FormDialog title="Budget je Monat" row={edit}
        fields={[{ key: 'kategorie_id', label: 'Kategorie', type: 'select', required: true, options: (edit.name ? [[edit.kategorie_id, edit.name] as [number, string]] : frei.map((c): [number, string] => [c.id, c.pfad])) },
          { key: 'intervall_monate', label: 'Zeitraum', type: 'select', required: true, options: [[1, 'je Monat'], [3, 'je Quartal'], [12, 'je Jahr']] },
          { key: 'betrag_ct', label: 'Betrag für den Zeitraum (0 entfernt das Budget)', type: 'money', required: true },
          { key: 'mit_unter', label: 'Unterkategorien zählen mit', type: 'check' },
          { key: 'prognose', label: 'Noch anstehende Daueraufträge mitrechnen', type: 'check' }]}
        onSave={(r) => call('finBudgetSetzen', { kategorie_id: Number(r.kategorie_id), betrag_ct: r.betrag_ct, intervall_monate: Number(r.intervall_monate), mit_unter: r.mit_unter ? 1 : 0, prognose: r.prognose ? 1 : 0 })} onClose={() => { setEdit(null); reload(); }} />}
    </section>
  );
}

// ---------- contracts and standing orders ----------
export function FinDauer() {
  const [rows, reload] = useLoad<Row[]>(() => call('finDauer'), []);
  const [konten] = useLoad<Row[]>(() => call('finKonten'), []);
  const [kategorien] = useLoad<Row[]>(() => call('finKategorien'), []);
  const [erkannt, ladeErkannt] = useLoad<Row[]>(() => call('finDauerErkennen'), []);
  const [edit, setEdit] = useState<Row | null>(null);
  const aktiv = (konten ?? []).filter((k) => !k.archiviert);
  const felder = (f: Row): Field[] => [
    { key: 'empfaenger', label: 'Vertrag / Empfänger', required: true, wide: true },
    { key: 'art', label: 'Art', type: 'select', required: true, options: [['aus', 'Ausgabe'], ['ein', 'Einnahme'], ['um', 'Sparen / Umbuchung']] },
    { key: 'betrag', label: 'Betrag', type: 'money', required: true },
    { key: 'rhythmus_monate', label: 'Rhythmus', type: 'select', required: true, options: RHYTHMUS },
    { key: 'naechste', label: 'Nächste Zahlung', type: 'date', required: true },
    { key: 'konto_id', label: 'Konto', type: 'select', required: true, options: aktiv.map((k) => [k.id, k.name]) },
    ...(f.art === 'um' ? [{ key: 'gegenkonto_id', label: 'Auf Konto', type: 'select', required: true, options: aktiv.map((k) => [k.id, k.name]) } as Field]
      : [{ key: 'kategorie_id', label: 'Kategorie', type: 'select', options: (kategorien ?? []).filter((c) => !c.archiviert && c.art === (f.art === 'ein' ? 'einnahme' : 'ausgabe')).map((c) => [c.id, c.pfad]) } as Field]),
    { key: 'variabel', label: 'Betrag schwankt (beim Buchen nachfragen)', type: 'check' },
    { key: 'aktiv', label: 'Aktiv', type: 'check' },
    { key: 'typ', label: 'Vertragsart', type: 'select', section: 'Vertrag', options: VERTRAGSART.map((v) => [v, v]) },
    { key: 'vertragsnummer', label: 'Vertragsnummer' }, { key: 'kundennummer', label: 'Kundennummer' },
    { key: 'beginn', label: 'Vertragsbeginn', type: 'date' }, { key: 'laufzeit_bis', label: 'Laufzeit bis', type: 'date' },
    { key: 'verlaengerung_monate', label: 'Verlängert sich um (Monate)', type: 'number' }, { key: 'kuendigungsfrist_tage', label: 'Kündigungsfrist (Tage)', type: 'number' },
    { key: 'gekuendigt_am', label: 'Gekündigt am', type: 'date' }, { key: 'ende', label: 'Letzte Zahlung am', type: 'date' },
    { key: 'notiz', label: 'Notiz', type: 'textarea' },
  ];
  const offen = (d: Row) => setEdit({ ...d, art: d.gegenkonto_id ? 'um' : d.betrag_ct < 0 ? 'aus' : 'ein', betrag: Math.abs(d.betrag_ct) });
  const fix = (rows ?? []).filter((d) => d.aktiv && !d.gegenkonto_id && d.betrag_ct < 0).reduce((s, d) => s - d.monatlich_ct, 0);
  return (
    <section>
      <div className="toolbar"><h1>Verträge & Daueraufträge</h1><span className="hinweis klein">feste Ausgaben {euro(fix)} im Monat · {euro(fix * 12)} im Jahr</span><span className="spacer" />
        <button className="primary" disabled={!aktiv.length} onClick={() => setEdit({ art: 'aus', rhythmus_monate: 1, naechste: heute(), konto_id: aktiv[0]?.id, aktiv: 1 })}>Neuer Vertrag</button></div>
      {!!erkannt?.length && (
        <div className="hinweisbox">
          <b>Regelmäßige Zahlungen erkannt</b> – mit einem Klick als Vertrag übernehmen:
          <div className="chips" style={{ marginTop: 8 }}>
            {erkannt.map((x) => <button key={`${x.empfaenger}${x.konto_id}`} className="chip-knopf" onClick={() => setEdit({ empfaenger: x.empfaenger, art: x.betrag_ct < 0 ? 'aus' : 'ein', betrag: Math.abs(x.betrag_ct),
              rhythmus_monate: 1, naechste: x.naechste, konto_id: x.konto_id, kategorie_id: x.kategorie_id, aktiv: 1 })}>+ {x.empfaenger} · {euro(x.betrag_ct)}</button>)}
          </div>
        </div>
      )}
      <table>
        <thead><tr><th>Nächste Zahlung</th><th>Vertrag</th><th>Rhythmus</th><th>Kategorie</th><th>Kündbar bis</th><th className="num">Betrag</th><th className="num">je Monat</th><th /></tr></thead>
        <tbody>
          {rows?.map((d) => (
            <tr key={d.id} className={`klickbar${d.aktiv ? '' : ' inaktiv'}`} onClick={() => offen(d)}>
              <td className={d.aktiv && d.naechste <= heute() ? 'fehlertext' : ''}>{datum(d.naechste)}</td>
              <td><b>{d.empfaenger}</b><div className="klein hinweis">{[d.typ, d.konto, d.vertragsnummer && `Nr. ${d.vertragsnummer}`].filter(Boolean).join(' · ')}</div></td>
              <td>{RHYTHMUS.find(([n]) => n === d.rhythmus_monate)?.[1]}</td><td>{d.gegenkonto ? `→ ${d.gegenkonto}` : d.kategorie ?? ''}</td>
              <td>{d.vertragsstand === 'gekuendigt' ? <span className="chip">gekündigt zum {datum(d.laufzeit_ende)}</span> : d.kuendigen_bis ? <span className={`chip${d.vertragsstand === 'bald' ? ' gelb' : ''}`}>{datum(d.kuendigen_bis)}</span> : ''}</td>
              <td className={zahlKlasse(d.betrag_ct)}>{euro(d.betrag_ct)}</td><td className={zahlKlasse(d.monatlich_ct)}>{euro(d.monatlich_ct)}</td>
              <td className="aktionen" onClick={(e) => e.stopPropagation()}>{!!d.aktiv && <button title="Diese Zahlung jetzt als Buchung eintragen und den Termin weitersetzen"
                onClick={async () => {
                  try {
                    let betrag: number | null = null;
                    if (d.variabel) {
                      const t = window.prompt(`Betrag dieser Zahlung an ${d.empfaenger} in Euro`, (Math.abs(d.betrag_ct) / 100).toFixed(2).replace('.', ','));
                      if (t == null) return;
                      betrag = (d.betrag_ct < 0 ? -1 : 1) * Math.round((Number(t.replace(/\./g, '').replace(',', '.')) || 0) * 100);
                    }
                    await call('finDauerBuchen', d.id, betrag); reload();
                  } catch (e) { fehler(e); }
                }}>Buchen</button>}</td>
            </tr>
          ))}
          {rows && !rows.length && <tr><td colSpan={8} className="hinweis">Noch keine Verträge. Miete, Strom, Versicherungen und Abos hier einzutragen macht die Prognose möglich.</td></tr>}
        </tbody>
      </table>
      {edit && <FormDialog title={edit.id ? 'Vertrag bearbeiten' : 'Neuer Vertrag'} row={edit} fields={felder}
        onSave={(r) => call('finDauerSpeichern', { id: edit.id, empfaenger: r.empfaenger, konto_id: Number(r.konto_id), gegenkonto_id: r.art === 'um' ? Number(r.gegenkonto_id) : null,
          betrag_ct: (r.art === 'ein' ? 1 : -1) * Math.abs(r.betrag), rhythmus_monate: Number(r.rhythmus_monate), naechste: r.naechste, kategorie_id: Number(r.kategorie_id) || null,
          ende: r.ende, aktiv: r.aktiv ? 1 : 0, variabel: r.variabel ? 1 : 0, typ: r.typ, vertragsnummer: r.vertragsnummer, kundennummer: r.kundennummer, beginn: r.beginn,
          laufzeit_bis: r.laufzeit_bis, verlaengerung_monate: r.verlaengerung_monate, kuendigungsfrist_tage: r.kuendigungsfrist_tage, gekuendigt_am: r.gekuendigt_am, notiz: r.notiz })}
        onDelete={edit.id ? () => call('finDauerLoeschen', edit.id) : undefined} onClose={() => { setEdit(null); reload(); ladeErkannt(); }} />}
    </section>
  );
}

// ---------- evaluation ----------
export function FinAuswertung() {
  const jahr = heute().slice(0, 4);
  const [von, setVon] = useState(`${jahr}-01-01`);
  const [bis, setBis] = useState(heute());
  const [d] = useLoad<Row>(() => call('finAuswertung', { von, bis }), [von, bis]);
  const [prognose] = useLoad<Row[]>(() => call('finPrognose', 12), []);
  const maxAus = Math.max(1, ...(d?.ausgaben ?? []).map((k: Row) => k.summe_ct));
  const maxEin = Math.max(1, ...(d?.einnahmen ?? []).map((k: Row) => k.summe_ct));
  return (
    <section>
      <div className="toolbar"><h1>Auswertung</h1><span className="spacer" />
        <button onClick={() => { setVon(`${jahr}-01-01`); setBis(heute()); }}>Dieses Jahr</button>
        <button onClick={() => { setVon(`${Number(jahr) - 1}-01-01`); setBis(`${Number(jahr) - 1}-12-31`); }}>Vorjahr</button>
        <input type="date" aria-label="von" value={von} onChange={(e) => setVon(e.target.value)} /><span>bis</span><input type="date" aria-label="bis" value={bis} onChange={(e) => setBis(e.target.value)} />
      </div>
      {d && (
        <>
          <div className="kacheln">
            <div className="kachel"><div className="wert">{euro(d.ein_ct)}</div><div className="label">Einnahmen</div></div>
            <div className="kachel"><div className="wert">{euro(d.aus_ct)}</div><div className="label">Ausgaben</div></div>
            <div className="kachel"><div className="wert">{euro(d.saldo_ct)}</div><div className="label">Überschuss{d.sparquote != null ? ` · Sparquote ${String(d.sparquote).replace('.', ',')} %` : ''}</div></div>
            <div className="kachel"><div className="wert">{euro(d.fix_ct)}</div><div className="label">davon Fixkosten · variabel {euro(d.variabel_ct)}</div></div>
          </div>
          <div className="raster2">
            <div className="panel spalte">
              <h3>Ausgaben nach Kategorie</h3>
              {d.ausgaben.map((k: Row) => <div key={k.name} className="fin-budgetzeile"><div className="kz-zeile"><span>{k.name}</span><span className="num">{euro(k.summe_ct)} · {prozent(k.summe_ct, d.aus_ct)} %</span></div><Balken wert={k.summe_ct} max={maxAus} />
                {k.unter.length > 0 && <ul className="kz-liste fin-unter">{k.unter.map((u: Row) => <li key={u.name}><span>{u.name}</span><span className="num">{euro(u.summe_ct)}</span></li>)}</ul>}</div>)}
              {!d.ausgaben.length && <p className="hinweis">Keine Ausgaben im Zeitraum.</p>}
            </div>
            <div className="panel spalte">
              <h3>Einnahmen nach Kategorie</h3>
              {d.einnahmen.map((k: Row) => <div key={k.name} className="fin-budgetzeile"><div className="kz-zeile"><span>{k.name}</span><span className="num">{euro(k.summe_ct)}</span></div><Balken wert={k.summe_ct} max={maxEin} art="gruen" /></div>)}
              {!d.einnahmen.length && <p className="hinweis">Keine Einnahmen im Zeitraum.</p>}
              <h3>Größte Empfänger</h3>
              <table><tbody>{d.empfaenger.map((e: Row) => <tr key={e.empfaenger}><td>{e.empfaenger}</td><td className="klein">{e.anzahl}×</td><td className="num">{euro(e.summe_ct)}</td></tr>)}</tbody></table>
            </div>
          </div>
          <div className="raster2">
            <div className="panel spalte">
              <h3>Vergleich mit dem Zeitraum davor</h3>
              <Vergleich von={von} bis={bis} />
              <h3>Monate</h3>
              <table><thead><tr><th>Monat</th><th className="num">Einnahmen</th><th className="num">Ausgaben</th><th className="num">Überschuss</th></tr></thead>
                <tbody>{d.monate.map((m: Row) => <tr key={m.monat}><td>{monatName(m.monat)}</td><td className="num">{euro(m.ein_ct)}</td><td className="num">{euro(m.aus_ct)}</td><td className={zahlKlasse(m.ein_ct - m.aus_ct)}>{euro(m.ein_ct - m.aus_ct)}</td></tr>)}</tbody></table>
            </div>
            <div className="panel spalte">
              <h3>Für die Steuererklärung</h3>
              {Object.keys(d.steuer).length ? <table><tbody>{Object.entries(d.steuer as Record<string, number>).map(([k, ct]) => <tr key={k}><td>{STEUER.find(([s]) => s === k)?.[1] ?? k}</td><td className="num">{euro(ct)}</td></tr>)}</tbody></table>
                : <p className="hinweis klein">Kategorien mit einem Steuer-Merkmal (unter „Konten & Kategorien“) werden hier summiert.</p>}
              <h3>Prognose aus den Verträgen</h3>
              <table><thead><tr><th>Monatsende</th><th className="num">Einnahmen</th><th className="num">Ausgaben</th><th className="num">Kontostand</th></tr></thead>
                <tbody>{prognose?.map((p) => <tr key={p.monat}><td>{monatName(p.monat)}</td><td className="num">{euro(p.ein_ct)}</td><td className="num">{euro(p.aus_ct)}</td><td className={zahlKlasse(p.stand_ct)}>{euro(p.stand_ct)}</td></tr>)}</tbody></table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

// Expenses of the chosen period against the equally long period one year before.
function Vergleich(props: { von: string; bis: string }) {
  const vorjahr = (iso: string) => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`;
  const [d] = useLoad<Row>(() => call('finVergleich', { von: props.von, bis: props.bis, von2: vorjahr(props.von), bis2: vorjahr(props.bis) }), [props.von, props.bis]);
  if (!d) return null;
  if (!d.zeilen.length) return <p className="hinweis klein">Noch keine Ausgaben zum Vergleichen.</p>;
  return (
    <table>
      <thead><tr><th>Kategorie</th><th className="num">Zeitraum</th><th className="num">Vorjahr</th><th className="num">Unterschied</th></tr></thead>
      <tbody>
        {d.zeilen.slice(0, 10).map((r: Row) => <tr key={r.name}><td>{r.name}</td><td className="num">{euro(r.a_ct)}</td><td className="num">{euro(r.b_ct)}</td>
          <td className={r.diff_ct > 0 ? 'num negativ' : 'num'}>{r.diff_ct > 0 ? '+' : ''}{euro(r.diff_ct)}{r.prozent != null ? ` (${r.prozent > 0 ? '+' : ''}${String(r.prozent).replace('.', ',')} %)` : ''}</td></tr>)}
        <tr><td><b>Ausgaben gesamt</b></td><td className="num"><b>{euro(d.a.aus_ct)}</b></td><td className="num"><b>{euro(d.b.aus_ct)}</b></td><td className={d.a.aus_ct > d.b.aus_ct ? 'num negativ' : 'num'}>{euro(d.a.aus_ct - d.b.aus_ct)}</td></tr>
      </tbody>
    </table>
  );
}

// ---------- accounts, categories, rules ----------
export function FinStammdaten() {
  const [tab, setTab] = useState<'konten' | 'kategorien' | 'regeln'>('konten');
  const [konten, ladeKonten] = useLoad<Row[]>(() => call('finKonten'), []);
  const [kategorien, ladeKat] = useLoad<Row[]>(() => call('finKategorien'), []);
  const [regeln, ladeRegeln] = useLoad<Row[]>(() => call('finRegeln'), []);
  const [edit, setEdit] = useState<{ art: typeof tab; row: Row } | null>(null);
  const zu = () => { setEdit(null); ladeKonten(); ladeKat(); ladeRegeln(); };
  return (
    <section>
      <div className="toolbar"><h1>Konten & Kategorien</h1><span className="spacer" />
        {tab === 'regeln' && <button onClick={async () => { try { hinweis(`${await call('finRegelnAnwenden')} Buchungen haben eine Kategorie bekommen.`, 'Regeln angewendet'); } catch (e) { fehler(e); } }}>Auf offene Buchungen anwenden</button>}
        <button className="primary" onClick={() => setEdit({ art: tab, row: tab === 'konten' ? { art: 'giro', anfang_datum: heute() } : tab === 'kategorien' ? { art: 'ausgabe' } : {} })}>
          {tab === 'konten' ? 'Neues Konto' : tab === 'kategorien' ? 'Neue Kategorie' : 'Neue Regel'}</button></div>
      <Tabs tabs={[['konten', 'Konten'], ['kategorien', 'Kategorien'], ['regeln', 'Regeln']]} value={tab} onChange={setTab} />
      {tab === 'konten' && (
        <table>
          <thead><tr><th>Konto</th><th>Art</th><th>Bank / IBAN</th><th className="num">Buchungen</th><th className="num">Kontostand</th></tr></thead>
          <tbody>
            {konten?.map((k) => <tr key={k.id} className={`klickbar${k.archiviert ? ' inaktiv' : ''}`} onClick={() => setEdit({ art: 'konten', row: k })}>
              <td><b>{k.name}</b>{k.gruppe && <span className="klein hinweis"> {k.gruppe}</span>}{!!k.archiviert && <span className="chip">archiviert</span>}</td><td>{KONTOART.find(([a]) => a === k.art)?.[1]}</td><td className="klein">{[k.bank, k.iban].filter(Boolean).join(' · ')}</td>
              <td className="num">{k.buchungen}</td><td className={zahlKlasse(k.wert_ct)}>{euro(k.wert_ct)}{k.abgleich_ct ? <div className="klein fehlertext">Bank: {euro(k.bank_saldo_ct)} ({k.abgleich_ct > 0 ? '+' : ''}{euro(k.abgleich_ct)})</div> : k.bank_saldo_ct != null ? <div className="klein hinweis">abgeglichen {datum(k.bank_saldo_datum)}</div> : null}</td></tr>)}
            {konten && !konten.length && <tr><td colSpan={5} className="hinweis">Noch kein Konto. Beginne mit dem Girokonto und seinem heutigen Kontostand als Anfangsbestand.</td></tr>}
          </tbody>
        </table>
      )}
      {tab === 'kategorien' && (
        <table>
          <thead><tr><th>Kategorie</th><th>Art</th><th>Fixkosten</th><th>Steuer</th></tr></thead>
          <tbody>{kategorien?.map((c) => <tr key={c.id} className={`klickbar${c.archiviert ? ' inaktiv' : ''}`} onClick={() => setEdit({ art: 'kategorien', row: c })}>
            <td>{c.eltern ? <span className="fin-einzug">{c.name}</span> : <b>{c.name}</b>}</td><td>{c.art === 'einnahme' ? 'Einnahme' : 'Ausgabe'}</td><td>{c.fix ? 'ja' : ''}</td><td className="klein">{STEUER.find(([s]) => s === c.steuer)?.[1] ?? ''}</td></tr>)}</tbody>
        </table>
      )}
      {tab === 'regeln' && (
        <>
          <p className="hinweis klein">Steht der Text im Empfänger oder im Verwendungszweck, bekommt die Buchung die Kategorie – beim Kontoauszug-Import und bei neuen Buchungen.</p>
          <table>
            <thead><tr><th>Text enthält</th><th>Bedingungen</th><th>Kategorie</th></tr></thead>
            <tbody>{regeln?.map((r) => <tr key={r.id} className="klickbar" onClick={() => setEdit({ art: 'regeln', row: r })}><td><b>{r.muster}</b></td>
              <td className="klein">{[r.feld !== 'beide' && (r.feld === 'empfaenger' ? 'nur im Empfänger' : 'nur im Zweck'), r.konto && `Konto ${r.konto}`, r.betrag_von_ct != null && `ab ${euro(r.betrag_von_ct)}`,
                r.betrag_bis_ct != null && `bis ${euro(r.betrag_bis_ct)}`, r.rang ? `Vorrang ${r.rang}` : null].filter(Boolean).join(' · ')}</td>
              <td>{r.kategorie}{r.kennzeichen && <span className="chip">{r.kennzeichen}</span>}</td></tr>)}
              {regeln && !regeln.length && <tr><td colSpan={3} className="hinweis">Noch keine Regeln. Sie entstehen auch, wenn du bei den Buchungen einen Empfänger einordnest und „merken“ wählst.</td></tr>}</tbody>
          </table>
        </>
      )}
      {edit?.art === 'konten' && <FormDialog title={edit.row.id ? 'Konto bearbeiten' : 'Neues Konto'} row={edit.row}
        fields={[{ key: 'name', label: 'Name', required: true, wide: true }, { key: 'art', label: 'Art', type: 'select', required: true, options: KONTOART },
          { key: 'bank', label: 'Bank' }, { key: 'iban', label: 'IBAN' }, { key: 'anfang_ct', label: 'Anfangsbestand (Schulden mit Minus)', type: 'money' }, { key: 'anfang_datum', label: 'Stand vom', type: 'date' },
          { key: 'gruppe', label: 'Gruppe (z. B. Alltag, Sparen)' },
          { key: 'dispo_ct', label: 'Dispo-Rahmen', type: 'money', section: 'Grenzen und Abgleich' }, { key: 'min_ct', label: 'Warnen unter', type: 'money' },
          { key: 'bank_saldo_ct', label: 'Kontostand laut Bank', type: 'money' }, { key: 'bank_saldo_datum', label: 'am', type: 'date' },
          { key: 'zins_prozent', label: 'Sollzins % im Jahr', section: 'Kredit' }, { key: 'rate_ct', label: 'Monatsrate', type: 'money' }, { key: 'zinsbindung_bis', label: 'Zinsbindung bis', type: 'date' },
          ...(edit.row.id ? [{ key: 'archiviert', label: 'Archiviert (zählt nicht mehr zum Vermögen)', type: 'check' } as Field] : [])]}
        onSave={(r) => call('finKontoSpeichern', { ...r, id: edit.row.id, dispo_ct: r.dispo_ct || null, min_ct: edit.row.min_ct == null && !r.min_ct ? null : r.min_ct,
          bank_saldo_ct: edit.row.bank_saldo_ct == null && !r.bank_saldo_ct ? null : r.bank_saldo_ct, rate_ct: r.rate_ct || null })}
        onDelete={edit.row.id ? async () => { if (await call('finKontoLoeschen', edit.row.id) === 'archiviert') hinweis('Das Konto hat Buchungen und wurde deshalb archiviert statt gelöscht.'); } : undefined} onClose={zu} />}
      {edit?.art === 'kategorien' && <FormDialog title={edit.row.id ? 'Kategorie bearbeiten' : 'Neue Kategorie'} row={edit.row}
        fields={(f) => [{ key: 'name', label: 'Name', required: true, wide: true }, { key: 'art', label: 'Art', type: 'select', required: true, options: [['ausgabe', 'Ausgabe'], ['einnahme', 'Einnahme']] },
          { key: 'eltern_id', label: 'Unterkategorie von', type: 'select', options: (kategorien ?? []).filter((c) => !c.eltern_id && !c.archiviert && c.art === f.art && c.id !== edit.row.id).map((c) => [c.id, c.name]) },
          { key: 'steuer', label: 'Steuer-Merkmal', type: 'select', options: STEUER }, { key: 'fix', label: 'Fixkosten (jeden Monat gleich)', type: 'check' },
          ...(edit.row.id ? [{ key: 'archiviert', label: 'Archiviert', type: 'check' } as Field] : [])]}
        onSave={(r) => call('finKategorieSpeichern', { ...r, eltern_id: Number(r.eltern_id) || null, id: edit.row.id })}
        onDelete={edit.row.id ? async () => { if (await call('finKategorieLoeschen', edit.row.id) === 'archiviert') hinweis('Die Kategorie wird verwendet und wurde deshalb archiviert statt gelöscht.'); } : undefined} onClose={zu} />}
      {edit?.art === 'regeln' && <FormDialog title={edit.row.id ? 'Regel bearbeiten' : 'Neue Regel'} row={edit.row}
        fields={[{ key: 'muster', label: 'Text im Empfänger oder Zweck', required: true, wide: true },
          { key: 'kategorie_id', label: 'Kategorie', type: 'select', required: true, options: (kategorien ?? []).filter((c) => !c.archiviert).map((c) => [c.id, c.pfad]) },
          { key: 'feld', label: 'Suchen in', type: 'select', section: 'Bedingungen (alle optional)', options: [['beide', 'Empfänger und Zweck'], ['empfaenger', 'nur Empfänger'], ['zweck', 'nur Zweck']] },
          { key: 'konto_id', label: 'Nur auf Konto', type: 'select', options: (konten ?? []).map((k) => [k.id, k.name]) },
          { key: 'betrag_von_ct', label: 'Betrag ab', type: 'money' }, { key: 'betrag_bis_ct', label: 'Betrag bis', type: 'money' },
          { key: 'kennzeichen', label: 'Kennzeichen setzen' }, { key: 'rang', label: 'Vorrang (höher gewinnt)', type: 'number' }]}
        onSave={(r) => call('finRegelSpeichern', { ...r, kategorie_id: Number(r.kategorie_id), konto_id: Number(r.konto_id) || null, betrag_von_ct: r.betrag_von_ct || null, betrag_bis_ct: r.betrag_bis_ct || null, id: edit.row.id })}
        onDelete={edit.row.id ? () => call('finRegelLoeschen', edit.row.id) : undefined} onClose={zu} />}
    </section>
  );
}

// ---------- depot, loans, account forecast ----------
export function FinVermoegen() {
  const [konten, ladeKonten] = useLoad<Row[]>(() => call('finKonten'), []);
  const [papiere, ladePapiere] = useLoad<Row[]>(() => call('finWertpapiere'), []);
  const [edit, setEdit] = useState<Row | null>(null);
  const aktiv = (konten ?? []).filter((k) => !k.archiviert);
  const depots = aktiv.filter((k) => k.art === 'depot'), kredite = aktiv.filter((k) => k.art === 'kredit' && k.saldo_ct < 0), laufend = aktiv.filter((k) => ['giro', 'spar', 'karte'].includes(k.art));
  const wert = (papiere ?? []).reduce((s, w) => s + w.wert_ct, 0), einstand = (papiere ?? []).reduce((s, w) => s + w.einstand_ct, 0);
  return (
    <section>
      <div className="toolbar"><h1>Depot, Kredite, Prognose</h1><span className="spacer" />
        <button className="primary" disabled={!depots.length} title={depots.length ? undefined : 'Lege zuerst ein Konto der Art „Depot“ an'} onClick={() => setEdit({ konto_id: depots[0]?.id, kurs_datum: heute() })}>Neues Wertpapier</button></div>
      <div className="panel">
        <div className="kz-zeile"><h3>Wertpapiere</h3>{!!papiere?.length && <span className="num">{euro(wert)} · <span className={wert - einstand < 0 ? 'negativ' : ''}>{wert - einstand >= 0 ? '+' : ''}{euro(wert - einstand)}</span> gegenüber dem Einstand</span>}</div>
        {!depots.length && <p className="hinweis klein">Für ein Depot legst du unter „Konten & Kategorien“ ein Konto der Art „Depot“ an. Kurse trägst du selbst ein; jeder neue Kurs bleibt im Verlauf.</p>}
        {!!papiere?.length && (
          <table>
            <thead><tr><th>Wertpapier</th><th className="num">Stück</th><th className="num">Kurs</th><th className="num">Einstand</th><th className="num">Wert</th><th className="num">Gewinn / Verlust</th></tr></thead>
            <tbody>{papiere.map((w) => <tr key={w.id} className="klickbar" onClick={() => setEdit(w)}>
              <td><b>{w.name}</b><div className="klein hinweis">{[w.isin, w.konto].filter(Boolean).join(' · ')}</div></td><td className="num">{String(w.stueck).replace('.', ',')}</td>
              <td className="num">{w.kurs_ct != null ? euro(w.kurs_ct) : '–'}<div className="klein hinweis">{datum(w.kurs_datum)}</div></td><td className="num">{euro(w.einstand_ct)}</td><td className="num">{euro(w.wert_ct)}</td>
              <td className={w.gewinn_ct != null && w.gewinn_ct < 0 ? 'num negativ' : 'num'}>{w.gewinn_ct != null ? `${w.gewinn_ct >= 0 ? '+' : ''}${euro(w.gewinn_ct)}${w.gewinn_prozent != null ? ` (${String(w.gewinn_prozent).replace('.', ',')} %)` : ''}` : '–'}</td></tr>)}</tbody>
          </table>
        )}
      </div>
      {kredite.map((k) => <Kredit key={k.id} konto={k} />)}
      {!kredite.length && <div className="panel"><h3>Kredite</h3><p className="hinweis klein">Ein Konto der Art „Kredit“ mit negativem Stand, Sollzins und Monatsrate bekommt hier seinen Tilgungsplan.</p></div>}
      <div className="raster2">{laufend.map((k) => <KontoPrognose key={k.id} konto={k} />)}</div>
      {edit && <FormDialog title={edit.id ? 'Wertpapier bearbeiten' : 'Neues Wertpapier'} row={edit}
        fields={[{ key: 'name', label: 'Name', required: true, wide: true }, { key: 'isin', label: 'ISIN' }, { key: 'konto_id', label: 'Depot', type: 'select', required: true, options: depots.map((k) => [k.id, k.name]) },
          { key: 'stueck', label: 'Stück', type: 'number', required: true }, { key: 'einstand_ct', label: 'Einstand gesamt (Kaufpreis mit Gebühren)', type: 'money' },
          { key: 'kurs_ct', label: 'Aktueller Kurs je Stück', type: 'money' }, { key: 'kurs_datum', label: 'Kurs vom', type: 'date' }]}
        onSave={(r) => call('finWertpapierSpeichern', { ...r, konto_id: Number(r.konto_id), id: edit.id, kurs_ct: r.kurs_ct || null })}
        onDelete={edit.id ? () => call('finWertpapierLoeschen', edit.id) : undefined} onClose={() => { setEdit(null); ladePapiere(); ladeKonten(); }} />}
    </section>
  );
}

// A loan's repayment plan, and what an extra repayment now would save.
function Kredit(props: { konto: Row }) {
  const k = props.konto;
  const [sonder, setSonder] = useState('');
  const [alle, setAlle] = useState(false);
  const sonderCt = Math.round((Number(sonder.replace(/\./g, '').replace(',', '.')) || 0) * 100);
  const [plan] = useLoad<Row>(() => call('finTilgungsplan', k.id), [k.id, k.saldo_ct, k.rate_ct, k.zins_prozent]);
  const [mit] = useLoad<Row | null>(() => (sonderCt > 0 ? call('finTilgungsplan', k.id, { sonder_ct: sonderCt }) : Promise.resolve(null)), [k.id, sonderCt]);
  if (!plan) return null;
  const ende = (m: string | null) => (m ? new Date(`${m}-15T12:00:00`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) : '–');
  return (
    <div className="panel">
      <div className="kz-zeile"><h3>{k.name}</h3><span className="num">Restschuld {euro(plan.schuld_ct)} · {String(plan.zins_prozent).replace('.', ',')} % · Rate {euro(plan.rate_ct)}</span></div>
      {!plan.rate_ct || !plan.zins_prozent ? <p className="hinweis klein">Trage beim Konto Sollzins und Monatsrate ein, dann steht hier der Tilgungsplan.</p>
        : !plan.tilgt ? <p className="fehlertext">Die Rate deckt nicht einmal die Zinsen von {euro(plan.erste_zinsen_ct)} im Monat. So wird der Kredit nie getilgt.</p> : (
          <>
            <div className="kacheln">
              <div className="kachel"><div className="wert">{ende(plan.ende)}</div><div className="label">schuldenfrei nach {plan.zeilen.length} Raten</div></div>
              <div className="kachel"><div className="wert">{euro(plan.zinsen_ct)}</div><div className="label">Zinsen bis zum Ende</div></div>
              {plan.rest_zinsbindung_ct != null && <div className="kachel"><div className="wert">{euro(plan.rest_zinsbindung_ct)}</div><div className="label">Restschuld am Ende der Zinsbindung ({datum(plan.zinsbindung_bis)})</div></div>}
            </div>
            <div className="knopfreihe">
              <label className="klein">Sondertilgung jetzt (€) <input className="kurz num" inputMode="decimal" placeholder="z. B. 2.000" value={sonder} onChange={(e) => setSonder(e.target.value)} /></label>
              {mit && mit.tilgt && <span className="klein">spart <b>{euro(plan.zinsen_ct - mit.zinsen_ct)}</b> Zinsen und <b>{plan.zeilen.length - mit.zeilen.length}</b> Raten – fertig {ende(mit.ende)}.</span>}
              <span className="spacer" /><button className="link" aria-expanded={alle} onClick={() => setAlle(!alle)}>{alle ? 'Plan ausblenden' : 'Tilgungsplan zeigen'}</button>
            </div>
            {alle && (
              <table>
                <thead><tr><th>Monat</th><th className="num">Zinsen</th><th className="num">Tilgung</th><th className="num">Restschuld</th></tr></thead>
                <tbody>{plan.zeilen.map((z: Row) => <tr key={z.monat}><td>{monatName(z.monat)}</td><td className="num">{euro(z.zins_ct)}</td><td className="num">{euro(z.tilgung_ct)}</td><td className="num">{euro(z.rest_ct)}</td></tr>)}</tbody>
              </table>
            )}
          </>
        )}
    </div>
  );
}

// One account over the next 90 days from its standing orders: where it will be lowest.
function KontoPrognose(props: { konto: Row }) {
  const [p] = useLoad<Row>(() => call('finKontoPrognose', props.konto.id, 90), [props.konto.id, props.konto.saldo_ct]);
  if (!p) return null;
  return (
    <div className="panel spalte">
      <div className="kz-zeile"><h3>{p.konto}: nächste 90 Tage</h3><span className={zahlKlasse(p.ende_ct)}>{euro(p.start_ct)} → {euro(p.ende_ct)}</span></div>
      {p.warnung ? <p className="fehlertext klein">Tiefster Stand {euro(p.tief.stand_ct)} am {datum(p.tief.datum)}: {p.warnung === 'dispo' ? 'über dem Dispo-Rahmen' : p.warnung === 'min' ? 'unter dem Mindeststand' : 'im Minus'}.</p>
        : <p className="hinweis klein">Tiefster Stand {euro(p.tief.stand_ct)} am {datum(p.tief.datum)}.</p>}
      {!p.punkte.length && <p className="hinweis klein">Keine Daueraufträge auf diesem Konto.</p>}
      <table><tbody>{p.punkte.slice(0, 12).map((m: Row, i: number) => <tr key={i}><td>{datum(m.datum)}</td><td>{m.text}</td><td className={zahlKlasse(m.betrag_ct)}>{euro(m.betrag_ct)}</td><td className={zahlKlasse(m.stand_ct)}>{euro(m.stand_ct)}</td></tr>)}</tbody></table>
    </div>
  );
}
