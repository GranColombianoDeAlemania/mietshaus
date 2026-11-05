// Document inbox, archive with full-text search and the invoice overview.
import { useEffect, useState } from 'react';
import { betrag, call, datum, diesesJahr, euro, fehler, heute, inTagen, parseCent, personName, zahl, type Row } from '../api';
import { useLoad } from '../useLoad';
import { Dialog, Fenster, FensterTitel, KontoSelect, Leer } from '../ui';
import { L } from '../navi';
import { painUeberweisung } from '../bankformate';
import { bestaetigen, hinweis } from '../frage';
import { emailSchreiben } from '../Mail';
import { BelegFoto } from '../Foto';
import { SYMBOL } from '../icons';
import { Arbeitskorb } from '../Arbeitskorb';
import { Bild } from '../Symbol';
import { belegDaten, belegWerte, BetraegeUndPositionen, Rechnungssteller, type BelegWerte } from './Beleg';

const RECHNUNGSARTEN = ['Rechnung', 'Gutschrift', 'Mahnung', 'Angebot'];

// Into the recycle bin (30 days); a document behind a posting is asked about first (records are kept for 10 years).
export async function inPapierkorb(docs: Row[]) {
  const gebucht = docs.filter((x) => x.buchung_id);
  if (gebucht.length && !await bestaetigen(`${gebucht.length === 1 ? 'Dieser Beleg gehört' : `${gebucht.length} Belege gehören`} zu einer Buchung. `
    + 'Belege sind 10 Jahre aufzubewahren; die Buchung selbst bleibt. Trotzdem in den Papierkorb legen?', { ja: 'In den Papierkorb' })) return false;
  await window.hv.dokumentLoeschen(docs.map((x) => x.id));
  // Counters elsewhere (inbox badge in the sidebar) follow.
  window.dispatchEvent(new Event('hv-daten'));
  return true;
}

const istBild = (datei: string) => /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(datei);
export const dokUrl = (datei: string) => `/dateien/dokument/${encodeURIComponent(datei)}`;

// Readable view of an e-invoice (XRechnung has no visual layout of its own).
export function ERechnungAnsicht(props: { e: Row }) {
  const e = props.e;
  const partei = (p: Row | null, titel: string) => p && (
    <div><div className="eyebrow">{titel}</div><b>{p.name}</b><div className="klein">{[p.strasse, [p.plz, p.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</div>
      {(p.ust_id || p.steuernr) && <div className="klein hinweis">{p.ust_id ? `USt-IdNr. ${p.ust_id}` : `St.-Nr. ${p.steuernr}`}</div>}</div>
  );
  return (
    <div className="erechnung">
      <div className="kopf"><h2>{e.gutschrift ? 'Gutschrift' : 'Rechnung'} {e.nummer}</h2><span className="chip akzent">E-Rechnung {e.syntax}</span></div>
      <div className="parteien">{partei(e.verkaeufer, 'Rechnungssteller')}{partei(e.kaeufer, 'Rechnungsempfänger')}</div>
      <div className="fakten">
        <div className="fakt"><span>Rechnungsdatum</span><b>{datum(e.datum)}</b></div>
        {e.faellig && <div className="fakt"><span>Fällig am</span><b>{datum(e.faellig)}</b></div>}
        {(e.leistung_von || e.lieferdatum) && <div className="fakt"><span>Leistung</span><b>{e.leistung_von ? `${datum(e.leistung_von)} – ${datum(e.leistung_bis)}` : datum(e.lieferdatum)}</b></div>}
        {e.kaeufer_referenz && <div className="fakt"><span>Ihre Referenz</span><b>{e.kaeufer_referenz}</b></div>}
      </div>
      <div className="positionen-liste">
        {(e.zeilen ?? []).map((z: Row, i: number) => {
          const einheit = z.einheit === 'HUR' ? 'Std.' : z.einheit === 'C62' || z.einheit === 'H87' ? 'Stk.' : z.einheit === 'MON' ? 'Mon.' : z.einheit ?? '';
          return (
            <div key={i} className="pos">
              <div>{z.text}</div>
              <div className="pos-zahlen"><span>{[[z.menge != null && `${zahl(z.menge)} ${einheit}`.trim(), z.preis_ct != null && `× ${euro(z.preis_ct)}`].filter(Boolean).join(' '), z.satz != null && `${zahl(z.satz)} % USt`].filter(Boolean).join(' · ')}</span><b>{euro(z.netto_ct)}</b></div>
            </div>
          );
        })}
        <div className="summe"><span>Netto</span><b>{euro(e.netto_ct)}</b></div>
        {(e.steuer ?? []).map((t: Row, i: number) => <div key={i} className="summe"><span>Umsatzsteuer {zahl(t.satz)} % auf {euro(t.basis_ct)}</span><b>{euro(t.steuer_ct)}</b></div>)}
        <div className="summe gesamt"><span>Zu zahlen</span><b>{euro(e.zahlbetrag_ct)}</b></div>
      </div>
      {(e.iban || e.verwendungszweck || e.zahlungsbedingung) && <p className="klein">{[e.iban && `IBAN ${e.iban}`, e.verwendungszweck && `Verwendungszweck ${e.verwendungszweck}`, e.zahlungsbedingung].filter(Boolean).join(' · ')}</p>}
    </div>
  );
}

export function Vorschau(props: { datei: string; id?: number }) {
  const xml = /\.xml$/i.test(props.datei);
  const [d] = useLoad<Row | null>(() => (xml && props.id ? call('dokument', props.id) : Promise.resolve(null)), [props.id, xml]);
  if (xml && d?.erechnung) return <div className="vorschau"><ERechnungAnsicht e={JSON.parse(d.erechnung)} /></div>;
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
  const [w, setW] = useState<BelegWerte | null>(null);
  const [buchen, setBuchen] = useState(false);
  const [vorschlag] = useLoad<Row | null>(() => (props.postfach ? call('rechnungWieBisher', props.id) : Promise.resolve(null)), [props.id, d?.analyse, d?.objekt_id, d?.typ]);

  useEffect(() => {
    if (d) setF({ ...d, betrag: d.betrag_ct != null ? (d.betrag_ct / 100).toFixed(2).replace('.', ',') : '' });
    if (d) setW(belegWerte(d));
  }, [d?.id, d?.analyse, d?.person_id]);
  const [einheiten] = useLoad<Row[]>(async () => (f?.objekt_id ? call('einheiten', f.objekt_id) : []), [f?.objekt_id]);
  if (!d || !f || !w) return null;

  const objektListe = [...new Map((objekte ?? []).map((o) => [o.id, o])).values()];
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });

  // schliessen false: only stores (before booking or creating a contact), the form stays open.
  async function speichern(status?: string, schliessen = true) {
    try {
      await call('dokumentSpeichern', {
        id: d!.id, titel: f!.titel, typ: f!.typ, objekt_id: f!.objekt_id || null, projekt_id: f!.projekt_id || null, einheit_id: f!.einheit_id || null, person_id: f!.person_id || null,
        datum: f!.datum, faellig: f!.faellig, betrag_ct: f!.betrag ? parseCent(f!.betrag) : null, absender: f!.absender || w!.steller.name || null, rechnungsnr: f!.rechnungsnr,
        iban: f!.iban, notiz: f!.notiz, zusammenfassung: f!.zusammenfassung, ...belegDaten(w!), ...(status ? { status } : {}),
      });
      if (schliessen) props.onFertig();
      return true;
    } catch (e) {
      fehler(e);
      return false;
    }
  }
  const rechnung = RECHNUNGSARTEN.includes(f.typ) || !!d.steller;
  // Known sender, booked alike at least twice: one click books this one the same way.
  const wieBisher = props.postfach && !d.buchung_id ? vorschlag : null;
  const soBuchen = async () => {
    if (!wieBisher || !(await speichern(undefined, false))) return;
    try {
      if (!f.objekt_id) await call('dokumentSpeichern', { id: d.id, objekt_id: wieBisher.objekt_id });
      await call('belegBuchen', d.id, { kosten_konto_id: wieBisher.kosten_konto_id, geld_konto_id: wieBisher.geld_konto_id });
      props.onFertig();
    } catch (e) { fehler(e); }
  };
  // A copy of an invoice that is filed or booked already: it can only go to the recycle bin (db: duplikatSperre).
  const kopie = d.duplikat && d.status !== 'abgelegt' && (d.duplikat.status === 'abgelegt' || d.duplikat.buchung_id) ? d.duplikat : null;

  const text = (k: string, l: string, typ = 'text') => (
    <label key={k}>{l}<input type={typ} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></label>
  );

  return (
    <div className="dokformular">
      <div className="buttons dok-oben">
        <button className="danger" onClick={async () => { if (await inPapierkorb([d])) props.onFertig(); }} title="In den Papierkorb (30 Tage wiederherstellbar)">Löschen</button>
        <button onClick={async () => { await window.hv.neuAnalysieren(d.id); ladeD(); }} title="Text erneut lesen">Neu lesen</button>
        <button onClick={() => window.hv.dokumentOeffnen(d.datei)}>Öffnen</button>
      </div>
      {d.duplikat && (
        <div className={kopie ? 'hinweisbox fehler klein' : 'hinweisbox klein'}>
          <b>{kopie ? 'Duplikat – ' : 'Mögliches Duplikat – '}</b>gleiche Rechnungsnummer, gleicher Betrag, gleicher Absender wie{' '}
          <L zu={{ dokument: d.duplikat.id }}>„{d.duplikat.titel}“</L>{d.duplikat.buchung_id ? ' (gebucht)' : d.duplikat.status === 'abgelegt' ? ' (abgelegt)' : ' (im Postfach)'}.
          {kopie ? ' Es kann nicht abgelegt oder gebucht werden.' : ' Nur eines von beiden lässt sich ablegen.'}
          {' '}<button className="link" onClick={async () => { if (await inPapierkorb([d])) props.onFertig(); }}>Dieses in den Papierkorb</button>
        </div>
      )}
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
        {f.stichworte && <p className="breit chips klein" title="Von der lokalen Bildsuche erkannt – die Suche findet das Foto mit diesen Wörtern">Im Bild erkannt: {f.stichworte.split(', ').map((w: string) => <span key={w} className="chip">{w}</span>)}</p>}
      </div>
      {wieBisher && !kopie && (
        <div className="hinweisbox klein wie-bisher">
          <span>Wie die letzten {wieBisher.anzahl} Male buchen: <b>{wieBisher.kosten}</b>, bezahlt von <b>{wieBisher.geld}</b>.</span>
          <button className="primary" onClick={soBuchen}>So buchen und weiter</button>
        </div>
      )}
      {rechnung && <>
        <Rechnungssteller w={w} set={setW} offen={!!props.postfach} kontakt={{ id: d.person_id }}
          onKontakt={async () => { if (await speichern(undefined, false)) { try { await call('kontaktAusSteller', d.id); ladeD(); } catch (e) { fehler(e); } } }} />
        <BetraegeUndPositionen w={w} set={setW} brutto={f.betrag ? parseCent(f.betrag) : null} offen={!!props.postfach} />
      </>}
      {d.erechnung && <p className="hinweisbox klein">E-Rechnung erkannt: Betrag, Netto/Umsatzsteuer, Rechnungsnummer, Fälligkeit und IBAN wurden exakt aus den Rechnungsdaten übernommen.</p>}
      <p className="klein hinweis">
        {d.analyse !== 'fertig' ? analyseText(d.analyse) : `${d.seiten ?? '?'} Seite(n)${d.ocr ? ', Text per Texterkennung gelesen' : ''} · ${d.name}`}
        {d.buchung_id && <> · <b>gebucht</b></>}
      </p>
      {(d.objekt_id || d.einheit_id || d.person_id || d.buchung_id) && (
        <p className="chips">
          <span className="klein hinweis">Gehört zu:</span>
          {d.objekt_id && <span className="chip"><L zu={{ objekt: d.objekt_id }}>{d.objekt}</L></span>}
          {d.einheit_id && <span className="chip"><L zu={{ einheit: d.einheit_id }}>{d.einheit}</L></span>}
          {d.person_id && <span className="chip"><L zu={{ person: d.person_id }}>{d.person}</L></span>}
          {d.buchung_id && d.buchung_konto_id && <span className="chip"><L zu={{ konto: d.buchung_konto_id }}>Buchung vom {datum(d.buchung_datum)}</L></span>}
        </p>
      )}
      {buchen && f.objekt_id && <Belegbuchung dok={{ ...d, ...f, betrag_ct: parseCent(f.betrag) }} onFertig={() => { setBuchen(false); ladeD(); props.onFertig(); }} onAbbruch={() => setBuchen(false)} />}
      <div className="buttons">
        <button onClick={async () => {
          const p = d.person_id ? await call<Row>('get', 'personen', d.person_id) : null;
          emailSchreiben({ an: p?.email ?? '', betreff: d.titel ?? '', dokumente: [{ id: d.id, titel: d.titel ?? d.name }], ablage: { objekt_id: d.objekt_id, person_id: d.person_id, einheit_id: d.einheit_id } });
        }}>Per E-Mail…</button>
        <span className="spacer" />
        {['Rechnung', 'Gutschrift'].includes(f.typ) && !d.buchung_id && (
          <button disabled={!f.objekt_id || !parseCent(f.betrag) || !!kopie} title={kopie ? 'Duplikat – wird nicht doppelt gebucht' : !f.objekt_id ? 'Bitte zuerst ein Objekt wählen' : ''} onClick={async () => { if (await speichern(undefined, false)) setBuchen(true); }}>Buchen…</button>
        )}
        <button className="primary" disabled={!!kopie && props.postfach} title={kopie && props.postfach ? 'Duplikat – wird nicht doppelt abgelegt' : ''}
          onClick={() => speichern(props.postfach ? 'abgelegt' : undefined)}>{props.postfach ? 'Ablegen und weiter' : 'Speichern'}</button>
      </div>
    </div>
  );
}

// Books an invoice: expense account against the bank (paid) – the document is linked to the posting (db: belegBuchen).
// Input tax per VAT rate only in houses with VAT-able letting and only with a known VAT; the labour share goes along for § 35a.
function Belegbuchung(props: { dok: Row; onFertig: (buchungId: number) => void; onAbbruch: () => void }) {
  const d = props.dok;
  const [konten] = useLoad<Row[]>(() => call('konten', d.objekt_id), [d.objekt_id]);
  const [vorschlag] = useLoad<number | null>(() => call('kontoVorschlag', d.objekt_id, d.absender, d.person_id ?? null), [d.objekt_id, d.absender, d.person_id]);
  const [kosten, setKosten] = useState<number | ''>('');
  const [geld, setGeld] = useState<number | ''>('');
  const [datumB, setDatumB] = useState(d.datum ?? heute());
  const [mitVst, setMitVst] = useState(true);
  useEffect(() => { if (vorschlag) setKosten(vorschlag); }, [vorschlag]);
  useEffect(() => { if (konten && !geld) setGeld(konten.find((k) => k.klasse === 'geld')?.id ?? ''); }, [konten]);
  const [t] = useLoad<Row>(() => call('belegAufteilung', d.id, { kosten_konto_id: kosten || null, vorsteuer: mitVst }), [d.id, kosten, mitVst]);
  const gutschrift = d.typ === 'Gutschrift';
  return (
    <div className="panel">
      <h3>{gutschrift ? 'Gutschrift' : 'Rechnung'} buchen: {euro(d.betrag_ct)}</h3>
      {t?.vorsteuer_moeglich && (t.ust_bekannt
        ? <label className="check"><input type="checkbox" checked={mitVst} onChange={(e) => setMitVst(e.target.checked)} />
          Vorsteuer abziehen: {euro(t.abziehbar_ct)}{t.quote < 100 ? ` (${t.quote} % abziehbar)` : ''}
          {t.vorsteuer.length > 1 ? ` – ${t.vorsteuer.map((v: Row) => `${zahl(v.satz)} %: ${euro(v.ct)}`).join(', ')}` : ''}</label>
        : <p className="fehlertext klein">MwSt unbekannt – es wird keine Vorsteuer abgezogen. Bitte oben unter „Beträge & Positionen“ eintragen.</p>)}
      {t?.p35a_konto && <p className="klein hinweis">{t.p35a_ct != null
        ? `Davon Arbeits- und Fahrtkosten für § 35a: ${euro(t.p35a_ct)}.`
        : 'Arbeitsanteil unbekannt – die Rechnung zählt in der Abrechnung voll für § 35a. Oben eintragen, wenn Material dabei ist.'}</p>}
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
            props.onFertig(await call('belegBuchen', d.id, { kosten_konto_id: kosten, geld_konto_id: geld, datum: datumB, vorsteuer: mitVst }));
          } catch (e) { fehler(e); }
        }}>Buchen</button>
      </div>
    </div>
  );
}

export function Postfach() {
  const [liste, reload] = useLoad<Row[]>(() => call('dokumentListe', { status: 'postfach' }), []);
  const [auswahl, setAuswahl] = useState<Record<number, boolean>>({});
  useEffect(() => {
    if (liste) setAuswahl((a) => Object.fromEntries(Object.entries(a).filter(([id]) => liste.some((d) => d.id === Number(id)))));
  }, [liste]);
  // Invoices of known senders that can be booked like the last times, all at once.
  const [bekannt] = useLoad<Row[]>(() => call('bekannteRechnungen'), [liste]);
  const bekannteBuchen = async () => {
    if (!bekannt?.length) return;
    const text = bekannt.map((r) => `• ${r.absender ?? r.titel}: ${euro(r.betrag_ct)} → ${r.kosten}, bezahlt von ${r.geld}`).join('\n');
    if (!await bestaetigen(`${bekannt.length} Rechnung(en) wie bisher buchen?\n\n${text}\n\nMwSt, Arbeitsanteil und Duplikat-Prüfung gelten wie beim einzelnen Buchen.`, { ja: 'Alle buchen' })) return;
    try {
      const r = await call<Row>('bekannteBuchen', bekannt.map((x) => x.id));
      await hinweis(`${r.gebucht} Rechnung(en) gebucht und abgelegt.${r.fehler.length ? `\n\nNicht gebucht:\n${r.fehler.map((f: Row) => `• ${bekannt.find((x) => x.id === f.id)?.titel ?? f.id}: ${f.grund}`).join('\n')}` : ''}`);
    } catch (e) { fehler(e); }
    reload();
    window.dispatchEvent(new Event('hv-daten'));
  };
  const gewaehlt = (liste ?? []).filter((x) => auswahl[x.id]);
  const [korb, ladeKorb] = useLoad<number>(() => call('papierkorbAnzahl'), [liste]);
  const [korbOffen, setKorbOffen] = useState(false);
  const loeschen = async (docs: Row[]) => { if (await inPapierkorb(docs)) { setAuswahl({}); reload(); } };
  return (
    <section className="postfach">
      <div className="toolbar">
        <h1>Postfach</h1>
        <span className="hinweis">{liste?.length ?? 0} Dokumente warten</span>
        <span className="spacer" />
        {!!bekannt?.length && <button onClick={bekannteBuchen} title="Rechnungen von Absendern, die schon mindestens zweimal gleich gebucht wurden">{bekannt.length} bekannte Rechnung{bekannt.length === 1 ? '' : 'en'} buchen</button>}
        <button className="link" onClick={() => setKorbOffen(true)} title="Gelöschte Dokumente, 30 Tage wiederherstellbar">Papierkorb{korb ? ` (${korb})` : ''}</button>
        <BelegFoto onFertig={reload} />
        <button className="primary" onClick={() => window.hv.dateienImportieren({}).then(reload)}>Dateien hinzufügen…</button>
      </div>
      <p className="hinweis klein">
        Das Programm hat die Dokumente gelesen und Vorschläge eingetragen. Nichts wird abgelegt oder gebucht, bevor du es prüfst:
        einzeln rechts, oder mehrere links anhaken und gemeinsam zuordnen. Alternativ in Claude Desktop: „Arbeite das Postfach im Mietshaus ab“.
      </p>
      {liste && !liste.length ? (
        <div className="leer ablagezone alles-erledigt">
          <Bild name="postfach" groesse={96} className="leer-bild" />
          <p><b>Alles erledigt – das Postfach ist leer.</b></p>
          <p className="hinweis">Rechnungen, Bescheide und Scans einfach hierher ziehen – oder einen Eingangsordner bzw. ein E-Mail-Postfach
            unter Einstellungen → Dokumenteneingang verbinden, dann landen neue Dokumente von selbst hier.</p>
        </div>
      ) : (
        <>
          {gewaehlt.length > 0 && <Stapel dokumente={gewaehlt} onFertig={() => { setAuswahl({}); reload(); }} onLoeschen={() => loeschen(gewaehlt)} />}
          <Arbeitskorb eintraege={liste} id={(x) => x.id} className="postfach-korb"
            kopf={<label className="check korb-alle"><input type="checkbox" checked={!!liste?.length && gewaehlt.length === liste.length}
              onChange={(e) => setAuswahl(e.target.checked ? Object.fromEntries((liste ?? []).map((x) => [x.id, true])) : {})} /> <b className="klein">Alle auswählen</b></label>}
            liProps={(x) => ({ draggable: true, title: 'Zum Zuordnen auf eine Person, Einheit oder Buchung ziehen',
              onDragStart: (e) => { e.dataTransfer.setData('application/x-hv-dokument', String(x.id)); e.dataTransfer.effectAllowed = 'link'; } })}
            vor={(x) => <input type="checkbox" className="korb-haken" aria-label={`${x.titel} auswählen`} checked={!!auswahl[x.id]} onChange={(e) => setAuswahl({ ...auswahl, [x.id]: e.target.checked })} />}
            nach={(x) => <button className="link loeschen" title="In den Papierkorb" aria-label="In den Papierkorb" onClick={() => loeschen([x])}><SYMBOL.papierkorb size={15} /></button>}
            zeile={(x) => <>
              <b>{x.titel}</b>
              <span className="klein">{[x.typ, x.absender, x.betrag_ct != null ? euro(x.betrag_ct) : null, x.objekt].filter(Boolean).join(' · ') || x.name}</span>
              <span className="klein hinweis">{analyseText(x.analyse) || datum(x.datum ?? x.erfasst)}</span>
              {x.duplikat_von && <span className="tag fehlertext">Duplikat</span>}
            </>}
            detail={(d) => (
              <div className="postfach-detail">
                <Vorschau key={d.id} datei={d.datei} id={d.id} />
                <DokumentFormular key={d.id + d.analyse} id={d.id} postfach onFertig={reload} />
              </div>
            )} />
        </>
      )}
      {korbOffen && <Papierkorb onClose={() => { setKorbOffen(false); reload(); ladeKorb(); }} />}
    </section>
  );
}

// Deleted documents: back to where they were, or removed for good; after 30 days they go by themselves.
function Papierkorb(props: { onClose: () => void }) {
  const [liste, reload] = useLoad<Row[]>(() => call('papierkorb'), []);
  const zurueck = async (ids: number[]) => { await call('dokumentWiederherstellen', ids); reload(); window.dispatchEvent(new Event('hv-daten')); };
  const weg = async (ids: number[]) => {
    if (!await bestaetigen(ids.length === 1 ? 'Dieses Dokument endgültig löschen? Die Datei ist dann weg.' : `${ids.length} Dokumente endgültig löschen? Die Dateien sind dann weg.`,
      { ja: 'Endgültig löschen' })) return;
    await call('dokumentEndgueltig', ids);
    reload();
  };
  return (
    <Dialog titel="Papierkorb" onClose={props.onClose} breit aktionen={liste?.length ? <button className="danger" onClick={() => weg(liste.map((x) => x.id))}>Papierkorb leeren</button> : null}>
      <p className="klein hinweis">Gelöschte Dokumente bleiben 30 Tage hier und lassen sich wiederherstellen; danach werden sie samt Datei entfernt.
        Lädt man dieselbe Datei erneut hoch, kommt sie von hier zurück.</p>
      {liste && !liste.length ? <Leer text="Der Papierkorb ist leer." /> : (
        <table className="liste">
          <thead><tr><th>Dokument</th><th>Gelöscht</th><th>Entfernt am</th><th /></tr></thead>
          <tbody>
            {liste?.map((x) => (
              <tr key={x.id}>
                <td><b>{x.titel}</b><div className="klein hinweis">{[x.typ, x.absender, x.betrag_ct != null ? euro(x.betrag_ct) : null, x.objekt, x.buchung_id ? 'gebucht' : null, x.geloescht_aus === 'postfach' ? 'aus dem Postfach' : 'aus dem Archiv'].filter(Boolean).join(' · ')}</div></td>
                <td>{datum(x.geloescht?.slice(0, 10))}</td>
                <td>{datum(x.endgueltig_am?.slice(0, 10))}</td>
                <td className="buttons"><button onClick={() => zurueck([x.id])}>Wiederherstellen</button><button className="link danger" onClick={() => weg([x.id])}>Endgültig löschen</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}

// Batch filing: assign object, unit, project or type to all selected documents at once.
function Stapel(props: { dokumente: Row[]; onFertig: () => void; onLoeschen: () => void }) {
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
        <button className="danger" onClick={props.onLoeschen} title="In den Papierkorb (30 Tage wiederherstellbar)">Löschen</button>
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
            <tr key={d.id} onClick={() => setOffen(d)} className={`klickbar${d.status === 'postfach' ? ' inaktiv' : ''}`} data-ziel={`dokument:${d.id}`} draggable
              onDragStart={(e) => { e.dataTransfer.setData('application/x-hv-dokument', String(d.id)); e.dataTransfer.effectAllowed = 'link'; }}>
              <td>{datum(d.datum ?? d.erfasst)}</td>
              <td><b>{d.titel}</b>{d.status === 'postfach' && <span className="tag">Postfach</span>}{d.buchung_id && <span className="tag art-weg">gebucht</span>}
                {d.treffer && <div className="klein treffer" dangerouslySetInnerHTML={{ __html: escHtml(d.treffer).replace(/\[/g, '<mark>').replace(/\]/g, '</mark>') }} />}</td>
              <td>{d.typ}</td>
              <td className="klein">
                {d.objekt_id && <L zu={{ objekt: d.objekt_id }}>{d.objekt}</L>}
                {d.einheit_id && <> · <L zu={{ einheit: d.einheit_id }}>{d.einheit}</L></>}
                {d.person_id && <> · <L zu={{ person: d.person_id }}>{d.person}</L></>}
                {d.absender && <span className="hinweis">{d.objekt_id || d.einheit_id || d.person_id ? ' · ' : ''}{d.absender}</span>}
              </td>
              <td className="num">{d.betrag_ct != null ? euro(d.betrag_ct) : ''}</td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      {liste?.length === 0 && (
        <Leer symbol="archiv" text={q || typ || jahr ? 'Nichts gefunden. Anderen Suchbegriff versuchen oder die Filter lockern.'
          : 'Noch keine Dokumente abgelegt. Dateien einfach ins Fenster ziehen – auf eine Person, eine Einheit oder eine Buchung gezogen, landen sie gleich dort.'} />
      )}
      {offen && <DokumentDialog id={offen.id} datei={offen.datei} onClose={() => { setOffen(null); reload(); }} />}
    </section>
  );
}

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function DokumentDialog(props: { id: number; datei?: string; onClose: () => void }) {
  // Links only know the id; the stored file name is looked up then.
  const [d] = useLoad<Row>(() => (props.datei ? Promise.resolve({ datei: props.datei }) : call('dokument', props.id)), [props.id, props.datei]);
  return (
    <Fenster onClose={props.onClose}>
      <div className="dialog sehrbreit">
        <div className="postfach-raster zwei">
          {d?.datei ? <Vorschau datei={d.datei} id={props.id} /> : <div className="vorschau leer">Dokument nicht gefunden.</div>}
          <div>
            <div className="toolbar"><FensterTitel className="sr-only">{d?.titel ?? 'Dokument'}</FensterTitel><span className="spacer" /><button onClick={props.onClose}>Schließen</button></div>
            <DokumentFormular id={props.id} onFertig={props.onClose} />
          </div>
        </div>
      </div>
    </Fenster>
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
    if (!o?.iban) return hinweis('Für Überweisungen bitte im Objekt die IBAN des Objektkontos hinterlegen.');
    // An invoice already in a transfer file (not booked as paid yet) would be paid twice.
    const vermerke: Record<string, Row> = await call('sepaVermerke', o.id, 'ueberweisung', inTagen(-60));
    const schon = fuerSepa.filter((r) => vermerke[`dokument:${r.id}`]);
    if (schon.length && !await bestaetigen(`${schon.length === 1 ? `„${schon[0].titel}“ ist` : `${schon.length} Rechnungen sind`} schon in einer Überweisungsdatei (${schon.map((r) => datum(vermerke[`dokument:${r.id}`].erstellt.slice(0, 10))).join(', ')}). Trotzdem noch einmal überweisen?`)) return;
    const xml = painUeberweisung({ auftraggeber: o.bezeichnung, iban: o.iban, bic: o.bic, ausfuehrung: heute(),
      posten: fuerSepa.map((r) => ({ name: r.absender ?? 'Empfänger', iban: r.iban, betrag_ct: r.betrag_ct, zweck: `Rechnung ${r.rechnungsnr ?? r.titel}`, e2e: `RE-${r.id}` })) });
    if (!await window.hv.speichern(xml, `Ueberweisungen ${o.bezeichnung} ${heute()}.xml`, { name: 'SEPA-XML', extensions: ['xml'] })) return;
    await call('sepaVermerken', o.id, 'ueberweisung', heute(), fuerSepa.map((r) => ({ schluessel: `dokument:${r.id}`, betrag_ct: r.betrag_ct })));
  }

  return (
    <section>
      <div className="toolbar">
        <h1>Rechnungen</h1>
        {props.objekt && <label className="check"><input type="checkbox" checked={nurObjekt} onChange={(e) => setNurObjekt(e.target.checked)} /> nur {props.objekt.bezeichnung}</label>}
        <select value={jahr} onChange={(e) => setJahr(e.target.value)}><option value="">alle Jahre</option>{Array.from({ length: 8 }, (_, i) => diesesJahr() - i).map((j) => <option key={j}>{j}</option>)}</select>
        <span className="spacer" />
        <BelegFoto onFertig={reload} />
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
                <td>{r.titel}{r.duplikat_von && <span className="tag fehlertext" title="Gleiche Rechnungsnummer, gleicher Betrag und Absender wie ein anderes Dokument">Duplikat?</span>}<div className="klein">{r.rechnungsnr}</div></td><td>{r.objekt_id ? <L zu={{ objekt: r.objekt_id }}>{r.objekt}</L> : ''}</td>
                <td className={s === 'überfällig' ? 'fehlertext' : ''}>{datum(r.faellig)}</td>
                <td className="num">{betrag(r.betrag_ct)}</td>
                <td><span className={`tag ${s === 'überfällig' ? 'fehlertext' : s === 'offen' ? '' : 'art-weg'}`}>{s}</span>{r.konto && <div className="klein"><L zu={{ konto: r.konto_id }}>{r.konto}</L></div>}</td>
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
