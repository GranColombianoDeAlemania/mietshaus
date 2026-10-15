// Document inbox, archive with full-text search and the invoice overview.
import { useEffect, useState } from 'react';
import { betrag, call, datum, diesesJahr, euro, fehler, heute, parseCent, personName, type Row } from '../api';
import { useLoad } from '../useLoad';
import { KontoSelect } from '../ui';
import { painUeberweisung } from '../bankformate';

const istBild = (datei: string) => /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(datei);
export const dokUrl = (datei: string) => `hvdok://dokument/${encodeURIComponent(datei)}`;

export function Vorschau(props: { datei: string }) {
  if (istBild(props.datei)) return <div className="vorschau"><img src={dokUrl(props.datei)} /></div>;
  if (/\.pdf$/i.test(props.datei)) return <iframe className="vorschau" src={dokUrl(props.datei)} />;
  return <div className="vorschau leer"><p>Keine Vorschau für diesen Dateityp.</p><button onClick={() => window.hv.dokumentOeffnen(props.datei)}>Mit Standardprogramm öffnen</button></div>;
}

const analyseText = (a: string) => (a === 'offen' ? 'wird gelesen…' : a === 'fertig' ? '' : 'Lesen fehlgeschlagen');

// Edit form for one document, used in the inbox and the archive.
function DokumentFormular(props: { id: number; onFertig: () => void; postfach?: boolean }) {
  const [d, ladeD] = useLoad<Row>(() => call('dokument', props.id), [props.id]);
  const [typen] = useLoad<string[]>(() => call('dokumentTypen'), []);
  const [objekte] = useLoad<Row[]>(async () => [...await call('objekte', 'miete'), ...await call('objekte', 'weg')], []);
  const [personen] = useLoad<Row[]>(() => call('personen'), []);
  const [projekte] = useLoad<Row[]>(() => call('projektListe'), []);
  const [f, setF] = useState<Row | null>(null);
  const [buchen, setBuchen] = useState(false);

  useEffect(() => {
    if (d) setF({ ...d, betrag: d.betrag_ct != null ? (d.betrag_ct / 100).toFixed(2).replace('.', ',') : '' });
  }, [d?.id, d?.analyse]);
  const [einheiten] = useLoad<Row[]>(async () => (f?.objekt_id ? call('einheiten', f.objekt_id) : []), [f?.objekt_id]);
  if (!d || !f) return null;

  const objektListe = [...new Map((objekte ?? []).map((o) => [o.id, o])).values()];
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });

  async function speichern(status?: string) {
    try {
      await call('dokumentSpeichern', {
        id: d!.id, titel: f!.titel, typ: f!.typ, objekt_id: f!.objekt_id || null, projekt_id: f!.projekt_id || null, einheit_id: f!.einheit_id || null, person_id: f!.person_id || null,
        datum: f!.datum, faellig: f!.faellig, betrag_ct: f!.betrag ? parseCent(f!.betrag) : null, absender: f!.absender, rechnungsnr: f!.rechnungsnr,
        iban: f!.iban, notiz: f!.notiz, zusammenfassung: f!.zusammenfassung, ...(status ? { status } : {}),
      });
      props.onFertig();
    } catch (e) {
      fehler(e);
    }
  }

  const text = (k: string, l: string, typ = 'text') => (
    <label key={k}>{l}<input type={typ} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></label>
  );

  return (
    <div className="dokformular">
      <div className="maske zwei">
        <label className="breit">Titel<input value={f.titel ?? ''} onChange={(e) => set('titel', e.target.value)} /></label>
        <label>Dokumenttyp
          <select value={f.typ ?? ''} onChange={(e) => set('typ', e.target.value)}>
            <option value="">–</option>{typen?.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        {text('datum', 'Datum', 'date')}
        <label>Objekt
          <select value={f.objekt_id ?? ''} onChange={(e) => setF({ ...f, objekt_id: Number(e.target.value) || null, einheit_id: null })}>
            <option value="">– keinem Objekt –</option>{objektListe.map((o) => <option key={o.id} value={o.id}>{o.bezeichnung}</option>)}
          </select>
        </label>
        <label>Einheit
          <select value={f.einheit_id ?? ''} onChange={(e) => set('einheit_id', Number(e.target.value) || null)} disabled={!f.objekt_id}>
            <option value="">–</option>{einheiten?.map((e) => <option key={e.id} value={e.id}>{e.nr} – {e.bezeichnung}</option>)}
          </select>
        </label>
        <label className="breit">Projekt
          <select value={f.projekt_id ?? ''} onChange={(e) => set('projekt_id', Number(e.target.value) || null)}>
            <option value="">– keinem Projekt –</option>{projekte?.map((p) => <option key={p.id} value={p.id}>{p.titel}</option>)}
          </select>
        </label>
        <label className="breit">Person
          <select value={f.person_id ?? ''} onChange={(e) => set('person_id', Number(e.target.value) || null)}>
            <option value="">–</option>{personen?.map((p) => <option key={p.id} value={p.id}>{personName(p)}</option>)}
          </select>
        </label>
        {text('absender', 'Absender')}
        {text('betrag', 'Betrag (€)')}
        {text('rechnungsnr', 'Rechnungs-/Aktenzeichen')}
        {text('faellig', 'Fällig am', 'date')}
        <label className="breit">IBAN<input value={f.iban ?? ''} onChange={(e) => set('iban', e.target.value)} /></label>
        <label className="breit">Zusammenfassung / Notiz<textarea rows={2} value={f.zusammenfassung ?? f.notiz ?? ''} onChange={(e) => set('zusammenfassung', e.target.value)} /></label>
      </div>
      <p className="klein hinweis">
        {d.analyse !== 'fertig' ? analyseText(d.analyse) : `${d.seiten ?? '?'} Seite(n)${d.ocr ? ', Text per Texterkennung gelesen' : ''} · ${d.name}`}
        {d.buchung_id && <> · <b>gebucht</b></>}
      </p>
      {buchen && f.objekt_id && <Belegbuchung dok={{ ...d, ...f, betrag_ct: parseCent(f.betrag) }} onFertig={async (bid) => { await call('dokumentSpeichern', { id: d.id, buchung_id: bid }); setBuchen(false); await speichern('abgelegt'); ladeD(); }} onAbbruch={() => setBuchen(false)} />}
      <div className="buttons">
        <button className="danger" onClick={async () => { if (confirm('Dokument und Datei löschen?')) { await window.hv.dokumentLoeschen(d.id); props.onFertig(); } }}>Löschen</button>
        <button onClick={async () => { await window.hv.neuAnalysieren(d.id); ladeD(); }} title="Text erneut lesen">Neu lesen</button>
        <button onClick={() => window.hv.dokumentOeffnen(d.datei)}>Öffnen</button>
        <span className="spacer" />
        {['Rechnung', 'Gutschrift'].includes(f.typ) && !d.buchung_id && (
          <button disabled={!f.objekt_id || !parseCent(f.betrag)} title={!f.objekt_id ? 'Bitte zuerst ein Objekt wählen' : ''} onClick={() => setBuchen(true)}>Buchen…</button>
        )}
        <button className="primary" onClick={() => speichern(props.postfach ? 'abgelegt' : undefined)}>{props.postfach ? 'Ablegen' : 'Speichern'}</button>
      </div>
    </div>
  );
}

// Books an invoice: expense account against the bank (paid) – the document is linked to the posting.
function Belegbuchung(props: { dok: Row; onFertig: (buchungId: number) => void; onAbbruch: () => void }) {
  const d = props.dok;
  const [konten] = useLoad<Row[]>(() => call('konten', d.objekt_id), [d.objekt_id]);
  const [vorschlag] = useLoad<number | null>(() => call('kontoVorschlag', d.objekt_id, d.absender), [d.objekt_id, d.absender]);
  const [kosten, setKosten] = useState<number | ''>('');
  const [geld, setGeld] = useState<number | ''>('');
  const [datumB, setDatumB] = useState(d.datum ?? heute());
  useEffect(() => { if (vorschlag) setKosten(vorschlag); }, [vorschlag]);
  useEffect(() => { if (konten && !geld) setGeld(konten.find((k) => k.klasse === 'geld')?.id ?? ''); }, [konten]);
  const gutschrift = d.typ === 'Gutschrift';
  return (
    <div className="panel">
      <h3>{gutschrift ? 'Gutschrift' : 'Rechnung'} buchen: {euro(d.betrag_ct)}</h3>
      <div className="maske">
        <label className="breit">Kostenart<KontoSelect konten={konten ?? []} klassen={['kosten', 'ruecklage', 'einnahme']} value={kosten} onChange={setKosten} /></label>
        <label>{gutschrift ? 'Eingang auf' : 'Bezahlt von'}<KontoSelect konten={konten ?? []} klassen={['geld']} value={geld} onChange={setGeld} /></label>
        <label>Buchungsdatum<input type="date" value={datumB} onChange={(e) => setDatumB(e.target.value)} /></label>
      </div>
      <div className="buttons">
        <span className="spacer" />
        <button onClick={props.onAbbruch}>Abbrechen</button>
        <button className="primary" disabled={!kosten || !geld} onClick={async () => {
          try {
            const id = await call('buchen', { objekt_id: d.objekt_id, datum: datumB, beleg: d.rechnungsnr, text: [d.absender, d.titel].filter(Boolean).join(' – ').slice(0, 120),
              positionen: [gutschrift ? { soll_id: geld, haben_id: kosten, betrag_ct: d.betrag_ct } : { soll_id: kosten, haben_id: geld, betrag_ct: d.betrag_ct }] });
            props.onFertig(id);
          } catch (e) { fehler(e); }
        }}>Buchen</button>
      </div>
    </div>
  );
}

export function Postfach() {
  const [liste, reload] = useLoad<Row[]>(() => call('dokumentListe', { status: 'postfach' }), []);
  const [aktiv, setAktiv] = useState<number | null>(null);
  const [auswahl, setAuswahl] = useState<Record<number, boolean>>({});
  useEffect(() => {
    if (liste && !liste.some((d) => d.id === aktiv)) setAktiv(liste[0]?.id ?? null);
    if (liste) setAuswahl((a) => Object.fromEntries(Object.entries(a).filter(([id]) => liste.some((d) => d.id === Number(id)))));
  }, [liste]);
  const d = liste?.find((x) => x.id === aktiv);
  const gewaehlt = (liste ?? []).filter((x) => auswahl[x.id]);
  return (
    <section className="postfach">
      <div className="toolbar">
        <h1>Postfach</h1>
        <span className="hinweis">{liste?.length ?? 0} Dokumente warten</span>
        <span className="spacer" />
        <button className="primary" onClick={() => window.hv.dateienImportieren({}).then(reload)}>Dateien hinzufügen…</button>
      </div>
      <p className="hinweis klein">
        Das Programm hat die Dokumente gelesen und Vorschläge eingetragen. Nichts wird abgelegt oder gebucht, bevor du es prüfst:
        einzeln rechts, oder mehrere links anhaken und gemeinsam zuordnen. Alternativ in Claude Desktop: „Arbeite das Postfach im Hausverwalter ab“.
      </p>
      {liste && !liste.length ? (
        <div className="leer"><p>Das Postfach ist leer.</p></div>
      ) : (
        <>
          {gewaehlt.length > 0 && <Stapel dokumente={gewaehlt} onFertig={() => { setAuswahl({}); reload(); }} />}
          <div className="postfach-raster">
            <ul className="dokliste">
              <li className="kopf">
                <input type="checkbox" checked={!!liste?.length && gewaehlt.length === liste.length}
                  onChange={(e) => setAuswahl(e.target.checked ? Object.fromEntries((liste ?? []).map((x) => [x.id, true])) : {})} />
                <span className="klein"><b>Alle auswählen</b></span>
              </li>
              {liste?.map((x) => (
                <li key={x.id} className={x.id === aktiv ? 'aktiv' : ''} onClick={() => setAktiv(x.id)}>
                  <input type="checkbox" checked={!!auswahl[x.id]} onClick={(e) => e.stopPropagation()} onChange={(e) => setAuswahl({ ...auswahl, [x.id]: e.target.checked })} />
                  <div className="inhalt">
                    <b>{x.titel}</b>
                    <span className="klein">{[x.typ, x.absender, x.betrag_ct != null ? euro(x.betrag_ct) : null, x.objekt].filter(Boolean).join(' · ') || x.name}</span>
                    <span className="klein hinweis">{analyseText(x.analyse) || datum(x.datum ?? x.erfasst)}</span>
                    {x.duplikat_von && <span className="tag fehlertext">mögliches Duplikat</span>}
                  </div>
                </li>
              ))}
            </ul>
            {d && <Vorschau key={d.id} datei={d.datei} />}
            {d && <DokumentFormular key={d.id + d.analyse} id={d.id} postfach onFertig={reload} />}
          </div>
        </>
      )}
    </section>
  );
}

// Batch filing: assign object, unit, project or type to all selected documents at once.
function Stapel(props: { dokumente: Row[]; onFertig: () => void }) {
  const [typen] = useLoad<string[]>(() => call('dokumentTypen'), []);
  const [objekte] = useLoad<Row[]>(async () => [...new Map([...await call('objekte', 'miete'), ...await call('objekte', 'weg')].map((o: Row) => [o.id, o])).values()], []);
  const [projekte] = useLoad<Row[]>(() => call('projektListe'), []);
  const [f, setF] = useState<Row>({});
  const [einheiten] = useLoad<Row[]>(async () => (f.objekt_id ? call('einheiten', f.objekt_id) : []), [f.objekt_id]);
  const ohneObjekt = props.dokumente.filter((x) => !x.objekt_id && !f.objekt_id && !f.projekt_id).length;
  const go = async (ablegen: boolean) => {
    const felder = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v != null));
    await call('stapelAblegen', props.dokumente.map((x) => x.id), felder, ablegen);
    props.onFertig();
  };
  const sel = (k: string, opts: [number | string, string][], leer: string) => (
    <select value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value === '' ? '' : isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value), ...(k === 'objekt_id' ? { einheit_id: '' } : {}) })}>
      <option value="">{leer}</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  return (
    <div className="stapel">
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <b>{props.dokumente.length} ausgewählt:</b>
        {sel('objekt_id', (objekte ?? []).map((o) => [o.id, o.bezeichnung]), 'Objekt unverändert')}
        {f.objekt_id ? sel('einheit_id', (einheiten ?? []).map((e) => [e.id, e.bezeichnung]), 'Einheit unverändert') : null}
        {sel('projekt_id', (projekte ?? []).map((p) => [p.id, p.titel]), 'Projekt unverändert')}
        {sel('typ', (typen ?? []).map((t) => [t, t]), 'Typ unverändert')}
        <span className="spacer" />
        <button onClick={() => go(false)}>Nur zuordnen</button>
        <button className="primary" onClick={() => go(true)}>Zuordnen & ablegen</button>
      </div>
      {ohneObjekt > 0 && <p className="klein hinweis" style={{ margin: '6px 0 0' }}>{ohneObjekt} der ausgewählten Dokumente haben noch kein Objekt und kein Projekt.</p>}
    </div>
  );
}

export function Archiv(props: { objekt?: Row }) {
  const [q, setQ] = useState(() => sessionStorage.getItem('archivSuche') ?? '');
  const [nurObjekt, setNurObjekt] = useState(!!props.objekt);
  const [typ, setTyp] = useState('');
  const [jahr, setJahr] = useState('');
  const [typen] = useLoad<string[]>(() => call('dokumentTypen'), []);
  const [liste, reload] = useLoad<Row[]>(() => call('dokumentListe', { q, typ: typ || null, jahr: jahr || null, objekt_id: nurObjekt ? props.objekt?.id : null }),
    [q, typ, jahr, nurObjekt, props.objekt?.id]);
  const [offen, setOffen] = useState<Row | null>(null);
  useEffect(() => { sessionStorage.removeItem('archivSuche'); }, []);

  return (
    <section>
      <div className="toolbar">
        <h1>Archiv</h1>
        <input className="suche gross" autoFocus placeholder="Volltext durchsuchen – z. B. „Heizung Wartung 2025“ oder eine Rechnungsnummer" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="toolbar">
        {props.objekt && <label className="check"><input type="checkbox" checked={nurObjekt} onChange={(e) => setNurObjekt(e.target.checked)} /> nur {props.objekt.bezeichnung}</label>}
        <select value={typ} onChange={(e) => setTyp(e.target.value)}><option value="">alle Typen</option>{typen?.map((t) => <option key={t}>{t}</option>)}</select>
        <select value={jahr} onChange={(e) => setJahr(e.target.value)}><option value="">alle Jahre</option>{Array.from({ length: 12 }, (_, i) => diesesJahr() - i).map((j) => <option key={j}>{j}</option>)}</select>
        <span className="spacer" />
        <span className="hinweis klein">{liste?.length ?? 0} Treffer</span>
        <button onClick={() => window.hv.dateienImportieren({ status: 'abgelegt', objekt_id: nurObjekt ? props.objekt?.id : null }).then(reload)}>Direkt ablegen…</button>
      </div>
      <table>
        <thead><tr><th>Datum</th><th>Titel</th><th>Typ</th><th>Objekt / Person</th><th className="num">Betrag</th><th /></tr></thead>
        <tbody>
          {liste?.map((d) => (
            <tr key={d.id} onDoubleClick={() => setOffen(d)} className={d.status === 'postfach' ? 'inaktiv' : ''}>
              <td>{datum(d.datum ?? d.erfasst)}</td>
              <td><b>{d.titel}</b>{d.status === 'postfach' && <span className="tag">Postfach</span>}{d.buchung_id && <span className="tag art-weg">gebucht</span>}
                {d.treffer && <div className="klein treffer" dangerouslySetInnerHTML={{ __html: escHtml(d.treffer).replace(/\[/g, '<mark>').replace(/\]/g, '</mark>') }} />}</td>
              <td>{d.typ}</td>
              <td className="klein">{[d.objekt, d.einheit, d.person, d.absender].filter(Boolean).join(' · ')}</td>
              <td className="num">{d.betrag_ct != null ? euro(d.betrag_ct) : ''}</td>
              <td className="aktionen"><button onClick={() => setOffen(d)}>Ansehen</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {offen && <DokumentDialog id={offen.id} datei={offen.datei} onClose={() => { setOffen(null); reload(); }} />}
    </section>
  );
}

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function DokumentDialog(props: { id: number; datei: string; onClose: () => void }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="dialog sehrbreit">
        <div className="postfach-raster zwei">
          <Vorschau datei={props.datei} />
          <div>
            <div className="toolbar"><span className="spacer" /><button onClick={props.onClose}>Schließen</button></div>
            <DokumentFormular id={props.id} onFertig={props.onClose} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function Rechnungen(props: { objekt?: Row }) {
  const [jahr, setJahr] = useState(String(diesesJahr()));
  const [nurObjekt, setNurObjekt] = useState(!!props.objekt);
  const [liste, reload] = useLoad<Row[]>(() => call('rechnungen', { objekt_id: nurObjekt ? props.objekt?.id : null, jahr: jahr || null }), [jahr, nurObjekt, props.objekt?.id]);
  const [offen, setOffen] = useState<Row | null>(null);
  const [auswahl, setAuswahl] = useState<Record<number, boolean>>({});
  const status = (r: Row) => (r.buchung_id ? (r.gegen_klasse === 'geld' ? 'bezahlt' : 'gebucht') : r.faellig && r.faellig < heute() ? 'überfällig' : 'offen');
  const summe = (s: string) => (liste ?? []).filter((r) => status(r) === s).reduce((a, r) => a + (r.betrag_ct ?? 0), 0);
  const fuerSepa = (liste ?? []).filter((r) => auswahl[r.id] && !r.buchung_id && r.iban && r.betrag_ct);

  async function sepa() {
    const o = props.objekt;
    if (!o?.iban) return alert('Für Überweisungen bitte im Objekt die IBAN des Objektkontos hinterlegen.');
    const xml = painUeberweisung({ auftraggeber: o.bezeichnung, iban: o.iban, bic: o.bic, ausfuehrung: heute(),
      posten: fuerSepa.map((r) => ({ name: r.absender ?? 'Empfänger', iban: r.iban, betrag_ct: r.betrag_ct, zweck: `Rechnung ${r.rechnungsnr ?? r.titel}`, e2e: `RE-${r.id}` })) });
    await window.hv.speichern(xml, `Ueberweisungen ${o.bezeichnung} ${heute()}.xml`, { name: 'SEPA-XML', extensions: ['xml'] });
  }

  return (
    <section>
      <div className="toolbar">
        <h1>Rechnungen</h1>
        {props.objekt && <label className="check"><input type="checkbox" checked={nurObjekt} onChange={(e) => setNurObjekt(e.target.checked)} /> nur {props.objekt.bezeichnung}</label>}
        <select value={jahr} onChange={(e) => setJahr(e.target.value)}><option value="">alle Jahre</option>{Array.from({ length: 8 }, (_, i) => diesesJahr() - i).map((j) => <option key={j}>{j}</option>)}</select>
        <span className="spacer" />
        <button disabled={!fuerSepa.length || !nurObjekt} title="Ausgewählte offene Rechnungen als SEPA-Überweisungsdatei" onClick={sepa}>Überweisen ({fuerSepa.length})</button>
      </div>
      <div className="kacheln">
        <div className="kachel"><div className="wert">{euro(summe('überfällig'))}</div><div className="label">überfällig</div></div>
        <div className="kachel"><div className="wert">{euro(summe('offen'))}</div><div className="label">offen, nicht gebucht</div></div>
        <div className="kachel"><div className="wert">{euro(summe('bezahlt') + summe('gebucht'))}</div><div className="label">gebucht</div></div>
      </div>
      <table>
        <thead><tr><th /><th>Datum</th><th>Absender</th><th>Titel / Nr.</th><th>Objekt</th><th>Fällig</th><th className="num">Betrag</th><th>Status</th><th /></tr></thead>
        <tbody>
          {liste?.map((r) => {
            const s = status(r);
            return (
              <tr key={r.id} onDoubleClick={() => setOffen(r)}>
                <td>{!r.buchung_id && <input type="checkbox" checked={!!auswahl[r.id]} onChange={(e) => setAuswahl({ ...auswahl, [r.id]: e.target.checked })} />}</td>
                <td>{datum(r.datum)}</td><td>{r.absender}</td>
                <td>{r.titel}{r.duplikat_von && <span className="tag fehlertext" title="Gleiche Rechnungsnummer, gleicher Betrag und Absender wie ein anderes Dokument">Duplikat?</span>}<div className="klein">{r.rechnungsnr}</div></td><td>{r.objekt}</td>
                <td className={s === 'überfällig' ? 'fehlertext' : ''}>{datum(r.faellig)}</td>
                <td className="num">{betrag(r.betrag_ct)}</td>
                <td><span className={`tag ${s === 'überfällig' ? 'fehlertext' : s === 'offen' ? '' : 'art-weg'}`}>{s}</span>{r.konto && <div className="klein">{r.konto}</div>}</td>
                <td className="aktionen"><button onClick={() => setOffen(r)}>Öffnen</button></td>
              </tr>
            );
          })}
          {liste && !liste.length && <tr><td colSpan={9} className="hinweis">Keine Rechnungen. Rechnungen landen hier, sobald sie im Postfach als Typ „Rechnung“ erkannt oder abgelegt werden.</td></tr>}
        </tbody>
      </table>
      {offen && <DokumentDialog id={offen.id} datei={offen.datei} onClose={() => { setOffen(null); reload(); }} />}
    </section>
  );
}
