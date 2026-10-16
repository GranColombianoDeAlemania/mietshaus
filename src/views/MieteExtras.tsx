// Deposits, rent adjustments (index, stepped, increase), keys and insurance policies.
import { useState } from 'react';
import { anrede, call, datum, euro, fehler, heute, parseZahl, personName, zahl, type Row } from '../api';
import { useLoad } from '../useLoad';
import { L } from '../navi';
import { Liste } from '../Liste';
import { Dialog, Tabs } from '../ui';
import { FormDialog, type Field } from '../Form';
import { AnpassungBrief } from './Mietbriefe';
import { absaetze, absenderAus, alsPdf, brief, esc, tabelle, empfaengerVon } from '../dokument';

const KAUTION_ARTEN: [string, string][] = [['konto', 'Kautionskonto (Sparbuch)'], ['bar', 'Barkaution'], ['buergschaft', 'Bankbürgschaft'], ['verpfaendung', 'Verpfändetes Konto']];
const BEWEGUNGEN: [string, string][] = [['einzahlung', 'Einzahlung'], ['zinsen', 'Zinsen'], ['verrechnung', 'Verrechnung mit Forderungen'], ['auszahlung', 'Auszahlung an Mieter']];

export function Kautionen(props: { objekt: Row }) {
  const [rows, reload] = useLoad<Row[]>(() => call('kautionen', props.objekt.id), [props.objekt.id]);
  const [offen, setOffen] = useState<Row | null>(null);
  return (
    <section>
      <div className="toolbar"><h1>Kautionen</h1></div>
      <p className="hinweis klein">Die vereinbarte Kaution steht im Mietverhältnis. Hier werden Anlage, Einzahlungen, Zinsen und die Abrechnung beim Auszug geführt.</p>
      <table>
        <thead><tr><th>Einheit</th><th>Mieter</th><th>Mietzeit</th><th>Anlage</th><th className="num">Vereinbart</th><th className="num">Bestand</th><th /></tr></thead>
        <tbody>
          {rows?.map((r) => (
            <tr key={r.vertrag_id} className={r.ende && r.ende < heute() && !r.ist_ct ? 'inaktiv' : ''} data-ziel={`vertrag:miete:${r.vertrag_id}`}>
              <td><L zu={{ einheit: r.einheit_id }}>{r.einheit}</L></td><td><L zu={{ vertrag: r.vertrag_id, typ: 'miete' }}>{r.name}</L></td><td>{datum(r.beginn)} – {datum(r.ende)}</td>
              <td>{KAUTION_ARTEN.find(([k]) => k === r.art)?.[1] ?? '–'}</td>
              <td className="num">{euro(r.soll_ct)}</td>
              <td className={`num ${r.ist_ct < r.soll_ct && (!r.ende || r.ende >= heute()) ? 'fehlertext' : ''}`}>{euro(r.ist_ct)}</td>
              <td className="aktionen"><button onClick={async () => { const id = await call('kautionAnlegen', r.vertrag_id); setOffen({ ...r, kaution_id: id }); }}>Verwalten</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {offen && <KautionDetail k={offen} objekt={props.objekt} onClose={() => { setOffen(null); reload(); }} />}
    </section>
  );
}

function KautionDetail(props: { k: Row; objekt: Row; onClose: () => void }) {
  const [k, ladeK] = useLoad<Row>(() => call('get', 'kautionen', props.k.kaution_id), [props.k.kaution_id]);
  const [bew, reload] = useLoad<Row[]>(() => call('kautionsbewegungen', props.k.kaution_id), [props.k.kaution_id]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [anlage, setAnlage] = useState(false);
  const stand = (bew ?? []).reduce((s, b) => s + (['einzahlung', 'zinsen'].includes(b.art) ? b.betrag_ct : -b.betrag_ct), 0);

  async function abrechnung() {
    const einst = await call('einstellungen');
    const v = await call('get', 'mietverhaeltnisse', props.k.vertrag_id);
    const p = await empfaengerVon(v);
    const z = (bew ?? []).map((b) => [datum(b.datum), esc(BEWEGUNGEN.find(([a]) => a === b.art)?.[1] ?? b.art), esc(b.text ?? ''),
      `#r${euro(['einzahlung', 'zinsen'].includes(b.art) ? b.betrag_ct : -b.betrag_ct)}`]);
    await alsPdf([brief({ absender: absenderAus(einst), empfaenger: p, betreff: `Kautionsabrechnung – ${props.objekt.bezeichnung}, ${props.k.einheit}`,
      info: [['Objekt', props.objekt.bezeichnung], ['Einheit', props.k.einheit]],
      inhalt: `<p>${esc(anrede(p))}</p><p>wir rechnen Ihre Mietkaution wie folgt ab:</p>${tabelle(['Datum', 'Vorgang', 'Text', '#rBetrag'], z, { summe: ['', '', 'Verbleibender Betrag', `#r${euro(stand)}`] })}
        ${absaetze(stand > 0 ? `Den verbleibenden Betrag von ${euro(stand)} überweisen wir auf Ihr Konto${p.iban ? ` (IBAN ${p.iban})` : ''}.` : 'Es verbleibt kein auszuzahlender Betrag.')}
        <p class="unterschrift">Mit freundlichen Grüßen<br><br>${esc(einst.verwalter_name ?? '')}</p>` })], `Kautionsabrechnung ${props.k.name}`);
  }

  return (
    <Dialog titel={`Kaution ${props.k.name} – ${props.k.einheit}`} onClose={props.onClose} breit aktionen={<>
      <button onClick={() => setAnlage(true)}>Anlage bearbeiten</button>
      <button onClick={abrechnung}>Kautionsabrechnung (PDF)</button>
      <button className="primary" onClick={() => setEdit({ kaution_id: props.k.kaution_id, datum: heute(), art: 'einzahlung' })}>Bewegung erfassen</button></>}>
      <p>Vereinbart: <b>{euro(props.k.soll_ct)}</b> · Bestand: <b>{euro(stand)}</b>
        {k?.bank && <> · {KAUTION_ARTEN.find(([a]) => a === k.art)?.[1]} bei {k.bank} {k.iban}</>}{k?.zinssatz ? ` · Zinssatz ${zahl(k.zinssatz)} %` : ''}</p>
      <table>
        <thead><tr><th>Datum</th><th>Vorgang</th><th>Text</th><th className="num">Betrag</th></tr></thead>
        <tbody>
          {bew?.map((b) => (
            <tr key={b.id} onDoubleClick={() => setEdit(b)}>
              <td>{datum(b.datum)}</td><td>{BEWEGUNGEN.find(([a]) => a === b.art)?.[1]}</td><td>{b.text}</td>
              <td className="num">{euro(['einzahlung', 'zinsen'].includes(b.art) ? b.betrag_ct : -b.betrag_ct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {k?.zinssatz ? <button onClick={async () => {
        const z = await call('kautionZinsVorschlag', props.k.kaution_id, heute());
        if (z > 0) setEdit({ kaution_id: props.k.kaution_id, datum: heute(), art: 'zinsen', betrag_ct: z, text: `Zinsen ${zahl(k.zinssatz)} %` });
        else alert('Keine Zinsen seit der letzten Buchung.');
      }}>Zinsen bis heute berechnen</button> : null}
      {edit && <FormDialog title="Kautionsbewegung" row={edit} fields={[
        { key: 'datum', label: 'Datum', type: 'date', required: true }, { key: 'art', label: 'Vorgang', type: 'select', required: true, options: BEWEGUNGEN },
        { key: 'betrag_ct', label: 'Betrag', type: 'money', required: true }, { key: 'text', label: 'Text', wide: true }]}
        onSave={(r) => call('save', 'kautionsbewegungen', { ...r, kaution_id: props.k.kaution_id })}
        onDelete={() => call('remove', 'kautionsbewegungen', edit.id)} onClose={() => { setEdit(null); reload(); }} />}
      {anlage && k && <FormDialog title="Anlage der Kaution" row={k} fields={[
        { key: 'art', label: 'Art', type: 'select', required: true, options: KAUTION_ARTEN }, { key: 'bank', label: 'Bank' },
        { key: 'iban', label: 'IBAN Kautionskonto' }, { key: 'zinssatz', label: 'Zinssatz % p. a.', type: 'number' }, { key: 'notiz', label: 'Notiz', type: 'textarea' }]}
        onSave={(r) => call('save', 'kautionen', r)} onClose={() => { setAnlage(false); ladeK(); }} />}
    </Dialog>
  );
}

const GRUENDE: Record<string, string> = { manuell: 'Manuell', staffel: 'Staffelmiete', index: 'Indexmiete', erhoehung: 'Mieterhöhung (§ 558)', nk_anpassung: 'Neue Vorauszahlungen', wirtschaftsplan: 'Wirtschaftsplan', modernisierung: 'Modernisierung (§ 559)' };

export function Mietanpassung(props: { objekt: Row }) {
  const [tab, setTab] = useState<'vertraege' | 'index'>('vertraege');
  const [vertraege] = useLoad<Row[]>(() => call('vertraege', 'mietverhaeltnisse', props.objekt.id), [props.objekt.id]);
  const [offen, setOffen] = useState<Row | null>(null);
  return (
    <section>
      <div className="toolbar">
        <h1>Mietanpassungen</h1>
        <Tabs tabs={[['vertraege', 'Mietverhältnisse'], ['index', 'Verbraucherpreisindex']]} value={tab} onChange={setTab} />
      </div>
      {tab === 'index' ? <Indexwerte /> : (
        <>
          <p className="hinweis klein">Hier hinterlegst du Staffel- und Indexmieten sowie Mieterhöhungen. Jede Änderung gilt ab ihrem Datum und fließt automatisch in die Sollstellung ein.</p>
          <table>
            <thead><tr><th>Einheit</th><th>Mieter</th><th>Beginn</th><th className="num">Kaltmiete bei Vertragsbeginn</th><th className="num">Kaltmiete heute</th><th /></tr></thead>
            <tbody>
              {vertraege?.filter((v) => v.aktuell).map((v) => (
                <tr key={v.id} data-ziel={`vertrag:miete:${v.id}`}><td><L zu={{ einheit: v.einheit_id }}>{v.einheit}</L></td><td><L zu={{ vertrag: v.id, typ: 'miete' }}>{v.name}</L></td><td>{datum(v.beginn)}</td><td className="num">{euro(v.kaltmiete_ct)}</td><td className="num"><b>{euro(v.akt_kaltmiete_ct)}</b></td>
                  <td className="aktionen"><button onClick={() => setOffen(v)}>Anpassungen</button></td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {offen && <Anpassungen vertrag={offen} objekt={props.objekt} onClose={() => setOffen(null)} />}
    </section>
  );
}

function Anpassungen(props: { vertrag: Row; objekt: Row; onClose: () => void }) {
  const v = props.vertrag;
  const [liste, reload] = useLoad<Row[]>(() => call('anpassungen', 'miete', v.id), [v.id]);
  const [modell, ladeModell] = useLoad<Row | null>(() => call('mietmodell', v.id), [v.id]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [index, setIndex] = useState<Row | null>(null);
  const [pruefung, setPruefung] = useState<Row | null>(null);
  const [briefFuer, setBriefFuer] = useState<Row | null>(null);

  const felder: Field[] = [
    { key: 'gueltig_ab', label: 'Gültig ab', type: 'date', required: true },
    { key: 'grund', label: 'Grund', type: 'select', required: true, options: Object.entries(GRUENDE) },
    { key: 'kaltmiete_ct', label: 'Neue Kaltmiete', type: 'money' },
    { key: 'bk_vz_ct', label: 'Neue BK-Vorauszahlung', type: 'money' },
    { key: 'hk_vz_ct', label: 'Neue HK-Vorauszahlung', type: 'money' },
    { key: 'sonstiges_ct', label: 'Neue sonstige Miete', type: 'money' },
    { key: 'notiz', label: 'Notiz', type: 'textarea' },
  ];

  async function indexPruefen() {
    try { setIndex(await call('indexBerechnung', v.id)); } catch (e) { fehler(e); }
  }

  return (
    <Dialog titel={`Anpassungen ${v.name} – ${v.einheit}`} onClose={props.onClose} breit aktionen={
      <button className="primary" onClick={() => setEdit({ gueltig_ab: heute(), grund: modell?.art ?? 'manuell' })}>Anpassung erfassen</button>}>
      <div className="toolbar">
        <label>Mietart
          <select value={modell?.art ?? ''} onChange={async (e) => {
            await call('mietmodellSetzen', v.id, e.target.value ? { art: e.target.value, basis_monat: modell?.basis_monat ?? v.beginn.slice(0, 7) } : null);
            ladeModell();
          }}>
            <option value="">normale Miete</option><option value="staffel">Staffelmiete</option><option value="index">Indexmiete</option>
          </select>
        </label>
        {modell?.art === 'index' && (
          <>
            <label>Basis-Indexmonat <input type="month" value={modell.basis_monat ?? ''} onChange={async (e) => { await call('mietmodellSetzen', v.id, { ...modell, basis_monat: e.target.value }); ladeModell(); }} /></label>
            <button onClick={indexPruefen}>Indexanpassung berechnen</button>
          </>
        )}
      </div>
      {index && (
        <div className="panel">
          <p>Index {index.basis_monat}: <b>{zahl(index.basis_wert)}</b> → {index.neu_monat}: <b>{zahl(index.neu_wert)}</b> ({zahl(+index.aenderung_prozent.toFixed(2))} %)</p>
          <p>Kaltmiete {euro(index.alte_miete_ct)} → <b>{euro(index.neue_miete_ct)}</b>, frühestens ab {datum(index.frueheste_wirkung)}.</p>
          <button className="primary" onClick={() => { setEdit({ gueltig_ab: index.frueheste_wirkung, grund: 'index', kaltmiete_ct: index.neue_miete_ct, notiz: `Index ${index.neu_monat}: ${index.neu_wert} (Basis ${index.basis_monat}: ${index.basis_wert})` }); setIndex(null); }}>Als Anpassung übernehmen</button>
        </div>
      )}
      {pruefung && (
        <p className={pruefung.kappung_ok && pruefung.frist_ok ? 'meldung' : 'fehler'}>
          Erhöhung um {zahl(+pruefung.erhoehung_prozent.toFixed(1))} % gegenüber vor 3 Jahren ({euro(pruefung.basis_ct)}); Kappungsgrenze {euro(pruefung.grenze_ct)}{pruefung.kappung_ok ? ' eingehalten' : ' überschritten'}.
          {' '}Letzte Änderung {datum(pruefung.letzte_aenderung)}: Sperrfrist von 15 Monaten {pruefung.frist_ok ? 'eingehalten' : 'nicht eingehalten'}.
        </p>
      )}
      <table>
        <thead><tr><th>Gültig ab</th><th>Grund</th><th className="num">Kaltmiete</th><th className="num">BK-VZ</th><th className="num">HK-VZ</th><th>Notiz</th><th /></tr></thead>
        <tbody>
          <tr className="zwischen"><td>{datum(v.beginn)}</td><td>Vertragsbeginn</td><td className="num">{euro(v.kaltmiete_ct)}</td><td className="num">{euro(v.bk_vz_ct)}</td><td className="num">{euro(v.hk_vz_ct)}</td><td /><td /></tr>
          {liste?.map((a) => (
            <tr key={a.id} onDoubleClick={() => setEdit(a)}>
              <td>{datum(a.gueltig_ab)}</td><td>{GRUENDE[a.grund] ?? a.grund}</td>
              <td className="num">{a.kaltmiete_ct != null ? euro(a.kaltmiete_ct) : ''}</td><td className="num">{a.bk_vz_ct != null ? euro(a.bk_vz_ct) : ''}</td>
              <td className="num">{a.hk_vz_ct != null ? euro(a.hk_vz_ct) : ''}</td><td className="klein">{a.notiz}</td>
              <td className="aktionen">{(a.kaltmiete_ct != null || a.bk_vz_ct != null || a.hk_vz_ct != null) && <button onClick={() => setBriefFuer(a)}>Brief</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {briefFuer && <AnpassungBrief v={v} a={briefFuer} objekt={props.objekt} anpassungen={liste ?? []} onClose={() => setBriefFuer(null)} onGeaendert={reload} />}
      {edit && <FormDialog title="Anpassung" row={edit} fields={felder}
        onSave={async (r) => {
          if (r.grund === 'erhoehung' && r.kaltmiete_ct) {
            const p = await call('mieterhoehungPruefen', v.id, r.kaltmiete_ct, r.gueltig_ab);
            setPruefung(p);
          }
          return call('save', 'anpassungen', { ...r, vertrag_typ: 'miete', vertrag_id: v.id });
        }}
        onDelete={() => call('remove', 'anpassungen', edit.id)} onClose={() => { setEdit(null); reload(); }} />}
    </Dialog>
  );
}


function Indexwerte() {
  const [rows, reload] = useLoad<Row[]>(() => call('indexwerte'), []);
  const [neu, setNeu] = useState({ monat: new Date().toISOString().slice(0, 7), wert: '' });
  const [text, setText] = useState('');
  return (
    <>
      <p className="hinweis klein">
        Verbraucherpreisindex für Deutschland (Basis 2020 = 100), veröffentlicht vom Statistischen Bundesamt (Destatis, Tabelle 61111-0002).
        Einzelne Werte eintragen oder mehrere Zeilen im Format „2025-09;122,0“ einfügen.
      </p>
      <div className="toolbar">
        <input type="month" value={neu.monat} onChange={(e) => setNeu({ ...neu, monat: e.target.value })} />
        <input className="kurz num" placeholder="Wert" value={neu.wert} onChange={(e) => setNeu({ ...neu, wert: e.target.value })} />
        <button className="primary" disabled={parseZahl(neu.wert) == null} onClick={async () => { await call('indexwerteSetzen', [[neu.monat, parseZahl(neu.wert)]]); setNeu({ ...neu, wert: '' }); reload(); }}>Speichern</button>
      </div>
      <div className="toolbar">
        <textarea rows={3} style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'2025-08;121,8\n2025-09;122,0'} />
        <button disabled={!text.trim()} onClick={async () => {
          const liste = text.split(/\n/).map((z) => z.split(/[;\t]/)).filter((z) => /^\d{4}-\d{2}$/.test(z[0]?.trim()) && parseZahl(z[1]) != null).map((z) => [z[0].trim(), parseZahl(z[1])]);
          await call('indexwerteSetzen', liste);
          setText('');
          reload();
        }}>Zeilen übernehmen</button>
      </div>
      <table>
        <thead><tr><th>Monat</th><th className="num">Index</th><th /></tr></thead>
        <tbody>{rows?.map((r) => <tr key={r.monat}><td>{r.monat}</td><td className="num">{zahl(r.wert)}</td>
          <td className="aktionen"><button onClick={async () => { await call('indexwertLoeschen', r.monat); reload(); }}>Löschen</button></td></tr>)}</tbody>
      </table>
    </>
  );
}

export function Schluesselverwaltung(props: { objekt: Row }) {
  const [offen, setOffen] = useState<Row | null>(null);
  return (
    <>
      <Liste titel="Schlüssel" table="schluessel" filter={{ objekt_id: props.objekt.id }}
        laden={() => call('schluesselListe', props.objekt.id)} neuLabel="Neuer Schlüssel"
        spalten={[['Bezeichnung', (r) => r.bezeichnung], ['Nummer', (r) => r.nummer], ['Bestand', (r) => r.anzahl, 'num'],
          ['Ausgegeben', (r) => r.ausgegeben, 'num'], ['Verfügbar', (r) => r.anzahl - r.ausgegeben, 'num']]}
        fields={[{ key: 'bezeichnung', label: 'Bezeichnung (z. B. Haustür, Keller)', required: true }, { key: 'nummer', label: 'Schlüsselnummer' },
          { key: 'anzahl', label: 'Anzahl insgesamt', type: 'number', required: true }, { key: 'notiz', label: 'Notiz', type: 'textarea' }]}
        neu={{ anzahl: 1 }} aktionen={(r) => <button onClick={() => setOffen(r)}>Ausgaben</button>} />
      {offen && <Schluesselausgaben schluessel={offen} onClose={() => setOffen(null)} />}
    </>
  );
}

function Schluesselausgaben(props: { schluessel: Row; onClose: () => void }) {
  const [personen] = useLoad<Row[]>(() => call('personen'), []);
  return (
    <Dialog titel={`Ausgaben: ${props.schluessel.bezeichnung} ${props.schluessel.nummer ?? ''}`} onClose={props.onClose} breit>
      <Liste titel="" table="schluesselausgaben" filter={{ schluessel_id: props.schluessel.id }} laden={() => call('schluesselausgabenListe', props.schluessel.id)}
        neuLabel="Schlüssel ausgeben" neu={{ ausgabe: heute(), anzahl: 1 }}
        zeilenKlasse={(r) => (r.rueckgabe ? 'inaktiv' : '')}
        spalten={[['Empfänger', (r) => <L zu={{ person: r.person_id }}>{r.name}</L>], ['Anzahl', (r) => r.anzahl, 'num'], ['Ausgabe', (r) => datum(r.ausgabe)], ['Rückgabe', (r) => datum(r.rueckgabe)], ['Notiz', (r) => r.notiz]]}
        fields={[{ key: 'person_id', label: 'Empfänger', type: 'select', required: true, options: (personen ?? []).map((p) => [p.id, personName(p)]) },
          { key: 'anzahl', label: 'Anzahl', type: 'number', required: true }, { key: 'ausgabe', label: 'Ausgegeben am', type: 'date', required: true },
          { key: 'rueckgabe', label: 'Zurückgegeben am', type: 'date' }, { key: 'notiz', label: 'Notiz', type: 'textarea' }]} />
    </Dialog>
  );
}

export function Versicherungen(props: { objekt: Row }) {
  const bald = (d?: string) => d && d <= new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10) && d >= heute();
  return (
    <Liste titel="Versicherungen & Verträge" table="versicherungen" filter={{ objekt_id: props.objekt.id }} order="art"
      neuLabel="Neuer Vertrag"
      spalten={[['Art', (r) => r.art], ['Gesellschaft', (r) => r.gesellschaft], ['Police', (r) => r.police], ['Beitrag/Jahr', (r) => (r.beitrag_ct != null ? euro(r.beitrag_ct) : ''), 'num'],
        ['Fällig', (r) => datum(r.faellig)], ['Kündbar bis', (r) => <span className={bald(r.kuendbar_bis) ? 'fehlertext' : ''}>{datum(r.kuendbar_bis)}</span>], ['Ablauf', (r) => datum(r.ablauf)]]}
      fields={[{ key: 'art', label: 'Art (z. B. Wohngebäude, Haftpflicht, Wartung Heizung)', required: true, wide: true }, { key: 'gesellschaft', label: 'Gesellschaft / Firma' },
        { key: 'police', label: 'Policen-/Vertragsnummer' }, { key: 'beitrag_ct', label: 'Beitrag pro Jahr', type: 'money' }, { key: 'faellig', label: 'Nächste Fälligkeit', type: 'date' },
        { key: 'kuendbar_bis', label: 'Kündbar bis', type: 'date' }, { key: 'ablauf', label: 'Vertragsablauf', type: 'date' }, { key: 'notiz', label: 'Notiz', type: 'textarea' }]} />
  );
}

