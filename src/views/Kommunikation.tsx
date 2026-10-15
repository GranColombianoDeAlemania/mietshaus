// Letters and mail merge from templates, document archive, cases and appointments.
import { useState } from 'react';
import { anrede, briefName, call, datum, euro, fehler, heute, personName, type Modus, type Row } from '../api';
import { useLoad } from '../useLoad';
import { Liste } from '../Liste';
import { Dialog, Tabs } from '../ui';
import { FormDialog, type Field } from '../Form';
import { absaetze, absenderAus, alsPdf, brief, esc } from '../dokument';

export const PLATZHALTER: [string, string][] = [
  ['anrede', 'Briefanrede („Sehr geehrte Frau …,“)'], ['name', 'Vollständiger Name'], ['vorname', 'Vorname'], ['nachname', 'Nachname'],
  ['strasse', 'Straße des Empfängers'], ['plz_ort', 'PLZ und Ort des Empfängers'],
  ['objekt', 'Objektbezeichnung'], ['objekt_anschrift', 'Anschrift des Objekts'], ['einheit', 'Einheit'], ['lage', 'Lage der Einheit'],
  ['flaeche', 'Wohnfläche'], ['beginn', 'Vertrags-/Eigentumsbeginn'], ['ende', 'Vertragsende'],
  ['kaltmiete', 'Kaltmiete'], ['bk_vz', 'BK-Vorauszahlung'], ['hk_vz', 'HK-Vorauszahlung'], ['gesamtmiete', 'Gesamtmiete'],
  ['hausgeld', 'Hausgeld'], ['ruecklage', 'Rücklagenanteil'], ['datum', 'Heutiges Datum'], ['verwalter', 'Name des Verwalters'],
];

const STANDARDVORLAGEN = [
  { titel: 'Wohnungsgeberbestätigung (§ 19 BMG)', kategorie: 'Miete', betreff: 'Wohnungsgeberbestätigung nach § 19 Bundesmeldegesetz',
    text: 'Hiermit bestätige ich als Wohnungsgeber den Einzug folgender Person(en):\n\n{name}\n\nin die Wohnung {einheit} ({lage}), {objekt_anschrift}.\n\nDatum des Einzugs: {beginn}\n\nName und Anschrift des Wohnungsgebers: {verwalter}\n\nIch bestätige, dass die oben genannte Person in die Wohnung tatsächlich eingezogen ist. Es ist verboten, eine Wohnanschrift für eine Anmeldung anzubieten oder zur Verfügung zu stellen, wenn ein tatsächlicher Bezug der Wohnung weder stattfindet noch beabsichtigt ist (§ 19 Abs. 6 BMG).' },
  { titel: 'Mietbescheinigung', kategorie: 'Miete', betreff: 'Mietbescheinigung',
    text: 'hiermit bestätigen wir, dass {name} seit dem {beginn} die Wohnung {einheit} im Objekt {objekt_anschrift} mit einer Wohnfläche von {flaeche} m² gemietet hat.\n\nDie monatliche Miete setzt sich wie folgt zusammen:\nKaltmiete: {kaltmiete}\nBetriebskostenvorauszahlung: {bk_vz}\nHeizkostenvorauszahlung: {hk_vz}\nGesamtmiete: {gesamtmiete}' },
  { titel: 'Ankündigung Zählerablesung', kategorie: 'Allgemein', betreff: 'Ankündigung der Zählerablesung',
    text: 'am [Datum] zwischen [Uhrzeit] werden die Zählerstände in Ihrer Wohnung {einheit} abgelesen. Bitte ermöglichen Sie den Zugang zu den Zählern oder hinterlegen Sie einen Schlüssel bei einer Vertrauensperson.\n\nVielen Dank für Ihre Mithilfe.' },
  { titel: 'Hausmitteilung', kategorie: 'Allgemein', betreff: 'Information für alle Bewohner – {objekt}',
    text: 'wir möchten Sie über Folgendes informieren:\n\n[Text]\n\nBei Fragen erreichen Sie uns gerne.' },
  { titel: 'Ankündigung Erhaltungsmaßnahme (§ 555a BGB)', kategorie: 'Miete', betreff: 'Ankündigung von Erhaltungsmaßnahmen',
    text: 'hiermit kündigen wir Ihnen folgende Erhaltungsmaßnahme an:\n\nArt der Arbeiten: [Beschreibung]\nVoraussichtlicher Beginn: [Datum]\nVoraussichtliche Dauer: [Dauer]\n\nWir bitten Sie, den Handwerkern Zugang zur Wohnung {einheit} zu gewähren, und bemühen uns, die Beeinträchtigungen so gering wie möglich zu halten.' },
];

function werte(p: Row, v: Row | null, b: Row | null, objekt: Row, einst: Row): Record<string, string> {
  return {
    anrede: anrede(p), name: briefName(p) || p.firma || '', vorname: p.vorname ?? '', nachname: p.nachname ?? '',
    strasse: p.strasse ?? '', plz_ort: [p.plz, p.ort].filter(Boolean).join(' '),
    objekt: objekt.bezeichnung, objekt_anschrift: [objekt.strasse, [objekt.plz, objekt.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    einheit: v?.einheit ?? '', lage: v?.lage ?? '', flaeche: v?.wohnflaeche != null ? String(v.wohnflaeche).replace('.', ',') : '',
    beginn: datum(v?.beginn), ende: datum(v?.ende),
    kaltmiete: b ? euro(b.kaltmiete_ct) : '', bk_vz: b ? euro(b.bk_vz_ct) : '', hk_vz: b ? euro(b.hk_vz_ct) : '',
    gesamtmiete: b && b.kaltmiete_ct != null ? euro((b.kaltmiete_ct ?? 0) + (b.bk_vz_ct ?? 0) + (b.hk_vz_ct ?? 0) + (b.sonstiges_ct ?? 0)) : '',
    hausgeld: b?.hausgeld_ct != null ? euro(b.hausgeld_ct) : '', ruecklage: b?.ruecklage_ct != null ? euro(b.ruecklage_ct) : '',
    datum: datum(heute()), verwalter: [einst.verwalter_name, einst.verwalter_strasse, [einst.verwalter_plz, einst.verwalter_ort].filter(Boolean).join(' ')].filter(Boolean).join(', '),
  };
}
const ersetze = (t: string, w: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k) => (k in w ? w[k] : m));

export function Briefe(props: { objekt: Row; modus: Modus }) {
  const [tab, setTab] = useState<'schreiben' | 'vorlagen'>('schreiben');
  return (
    <section>
      <div className="toolbar">
        <h1>Briefe & Serienbriefe – {props.objekt.bezeichnung}</h1>
        <Tabs tabs={[['schreiben', 'Brief schreiben'], ['vorlagen', 'Vorlagen']]} value={tab} onChange={setTab} />
      </div>
      {tab === 'schreiben' ? <Schreiben objekt={props.objekt} modus={props.modus} /> : <Vorlagen />}
    </section>
  );
}

function Schreiben(props: { objekt: Row; modus: Modus }) {
  const [vorlagen] = useLoad<Row[]>(() => call('liste', 'vorlagen', {}, 'titel'), []);
  const [mieter] = useLoad<Row[]>(() => call('vertraege', 'mietverhaeltnisse', props.objekt.id), [props.objekt.id]);
  const [eigner] = useLoad<Row[]>(() => call('vertraege', 'eigentum', props.objekt.id), [props.objekt.id]);
  const [kontakte] = useLoad<Row[]>(() => call('rollenListe', props.objekt.id), [props.objekt.id]);
  const [betreff, setBetreff] = useState('');
  const [text, setText] = useState('');
  const [auswahl, setAuswahl] = useState<Record<string, boolean>>({});

  const empfaenger = [
    ...(props.objekt.art !== 'weg' ? (mieter ?? []).filter((v) => v.aktuell).map((v) => ({ key: `m${v.id}`, typ: 'miete', v, person_id: v.person_id, label: `${v.name} – ${v.einheit}`, gruppe: 'Mieter' })) : []),
    ...(props.objekt.art !== 'miete' ? (eigner ?? []).filter((v) => v.aktuell).map((v) => ({ key: `e${v.id}`, typ: 'weg', v, person_id: v.person_id, label: `${v.name} – ${v.einheit}`, gruppe: 'Eigentümer' })) : []),
    ...(kontakte ?? []).map((k) => ({ key: `r${k.id}`, typ: null, v: null, person_id: k.person_id, label: `${k.name} (${k.rolle})`, gruppe: 'Ansprechpartner' })),
  ];
  const gewaehlt = empfaenger.filter((e) => auswahl[e.key]);
  const gruppeWaehlen = (g: string, an: boolean) => setAuswahl({ ...auswahl, ...Object.fromEntries(empfaenger.filter((e) => e.gruppe === g).map((e) => [e.key, an])) });

  async function erstellen() {
    try {
      const einst = await call('einstellungen');
      const seiten = [];
      for (const e of gewaehlt) {
        const p = await call('get', 'personen', e.person_id);
        let v: Row | null = null, b: Row | null = null;
        if (e.v) {
          const einheit = await call('get', 'einheiten', e.v.einheit_id);
          v = { ...e.v, lage: einheit.lage, wohnflaeche: einheit.wohnflaeche };
          b = await call('betraege', e.typ, e.v.id, heute());
        }
        const w = werte(p, v, b, props.objekt, einst);
        const rumpf = ersetze(text, w);
        // Templates may start with the salutation themselves; otherwise it is added.
        const mitAnrede = /^\s*\{anrede\}/.test(text) || /^Sehr geehrte/.test(rumpf) ? rumpf : `${w.anrede}\n\n${rumpf}`;
        seiten.push(brief({ absender: absenderAus(einst), empfaenger: p, betreff: ersetze(betreff, w), info: [['Objekt', props.objekt.bezeichnung], ...(v ? [['Einheit', v.einheit] as [string, string]] : [])],
          inhalt: `${absaetze(mitAnrede)}<p class="unterschrift">Mit freundlichen Grüßen<br><br>${esc(einst.verwalter_name ?? '')}</p>` }));
      }
      await alsPdf(seiten, `${ersetze(betreff, {}) || 'Brief'} ${props.objekt.bezeichnung}`);
    } catch (e) {
      fehler(e);
    }
  }

  async function email() {
    const mails = (await Promise.all(gewaehlt.map((e) => call('get', 'personen', e.person_id)))).map((p) => p.email).filter(Boolean);
    if (!mails.length) return alert('Keiner der gewählten Empfänger hat eine E-Mail-Adresse.');
    // Recipients go into BCC so they do not see each other's addresses.
    window.hv.extern(`mailto:?bcc=${encodeURIComponent(mails.join(','))}&subject=${encodeURIComponent(ersetze(betreff, { objekt: props.objekt.bezeichnung }))}&body=${encodeURIComponent(ersetze(text, { objekt: props.objekt.bezeichnung, anrede: 'Guten Tag,' }))}`);
  }

  return (
    <div className="zweispaltig">
      <div className="panel">
        <div className="maske">
          <label className="breit">Vorlage
            <select defaultValue="" onChange={(e) => { const v = vorlagen?.find((x) => x.id === Number(e.target.value)); if (v) { setBetreff(v.betreff ?? ''); setText(v.text ?? ''); } }}>
              <option value="">– freier Brief –</option>
              {vorlagen?.map((v) => <option key={v.id} value={v.id}>{v.titel}</option>)}
            </select>
          </label>
          <label className="breit">Betreff<input value={betreff} onChange={(e) => setBetreff(e.target.value)} /></label>
        </div>
        <textarea className="brieftext" rows={16} value={text} onChange={(e) => setText(e.target.value)} placeholder="Brieftext. Platzhalter wie {name}, {einheit} oder {kaltmiete} werden je Empfänger ersetzt." />
        <details className="klein"><summary>Platzhalter</summary>{PLATZHALTER.map(([k, l]) => <div key={k}><code>{`{${k}}`}</code> {l}</div>)}</details>
      </div>
      <div className="panel">
        <h3>Empfänger ({gewaehlt.length})</h3>
        {['Mieter', 'Eigentümer', 'Ansprechpartner'].map((g) => {
          const es = empfaenger.filter((e) => e.gruppe === g);
          if (!es.length) return null;
          return (
            <div key={g} className="block">
              <label className="check"><input type="checkbox" checked={es.every((e) => auswahl[e.key])} onChange={(ev) => gruppeWaehlen(g, ev.target.checked)} /> <b>Alle {g}</b></label>
              {es.map((e) => <label key={e.key} className="check eingerueckt"><input type="checkbox" checked={!!auswahl[e.key]} onChange={(ev) => setAuswahl({ ...auswahl, [e.key]: ev.target.checked })} /> {e.label}</label>)}
            </div>
          );
        })}
        <div className="buttons">
          <button disabled={!gewaehlt.length} onClick={email}>Als E-Mail…</button>
          <span className="spacer" />
          <button className="primary" disabled={!gewaehlt.length || !text.trim()} onClick={erstellen}>{gewaehlt.length > 1 ? `${gewaehlt.length} Briefe` : 'Brief'} als PDF</button>
        </div>
      </div>
    </div>
  );
}

function Vorlagen() {
  return (
    <Liste titel="" table="vorlagen" order="titel" neuLabel="Neue Vorlage"
      kopf={(rows, reload) => !rows.some((r) => r.titel === STANDARDVORLAGEN[0].titel) && (
        <button onClick={async () => { for (const v of STANDARDVORLAGEN) await call('save', 'vorlagen', v); reload(); }}>Standardvorlagen anlegen</button>)}
      spalten={[['Titel', (r) => r.titel], ['Kategorie', (r) => r.kategorie], ['Betreff', (r) => r.betreff]]}
      fields={[{ key: 'titel', label: 'Titel', required: true }, { key: 'kategorie', label: 'Kategorie' }, { key: 'betreff', label: 'Betreff', wide: true },
        { key: 'text', label: 'Text (Platzhalter in geschweiften Klammern, z. B. {name})', type: 'textarea' }]} />
  );
}

export function Dokumente(props: { objekt: Row }) {
  const [rows, reload] = useLoad<Row[]>(() => call('dokumenteListe', props.objekt.id), [props.objekt.id]);
  const [einheiten] = useLoad<Row[]>(() => call('einheiten', props.objekt.id), [props.objekt.id]);
  const [personen] = useLoad<Row[]>(() => call('personen'), []);
  const [edit, setEdit] = useState<Row | null>(null);
  const [suche, setSuche] = useState('');
  const KAT = ['Mietvertrag', 'Kaufvertrag / Teilungserklärung', 'Rechnung', 'Abrechnung', 'Protokoll', 'Schriftverkehr', 'Foto', 'Plan / Grundriss', 'Versicherung', 'Sonstiges'];

  const felder: Field[] = [
    { key: 'titel', label: 'Titel', required: true, wide: true }, { key: 'kategorie', label: 'Kategorie', type: 'select', options: KAT.map((k) => [k, k]) },
    { key: 'datum', label: 'Datum', type: 'date' },
    { key: 'einheit_id', label: 'Einheit', type: 'select', options: (einheiten ?? []).map((e) => [e.id, `${e.nr} – ${e.bezeichnung}`]) },
    { key: 'person_id', label: 'Person', type: 'select', options: (personen ?? []).map((p) => [p.id, personName(p)]) },
    { key: 'notiz', label: 'Notiz', type: 'textarea' },
  ];

  async function ablegen() {
    const dateien = await window.hv.dokumentAblegen();
    for (const d of dateien) await call('save', 'dokumente', { objekt_id: props.objekt.id, titel: d.name.replace(/\.[^.]+$/, ''), datei: d.datei, name: d.name, groesse: d.groesse, datum: heute() });
    reload();
  }

  const q = suche.toLowerCase();
  return (
    <section>
      <div className="toolbar">
        <h1>Dokumente – {props.objekt.bezeichnung}</h1>
        <input className="suche" placeholder="Suchen…" value={suche} onChange={(e) => setSuche(e.target.value)} />
        <span className="spacer" />
        <button className="primary" onClick={ablegen}>Dateien ablegen…</button>
      </div>
      <p className="hinweis klein">Abgelegte Dateien werden in den Programmordner kopiert und mit der Datensicherung zusammen aufbewahrt (Ordner „dokumente“ mitsichern).</p>
      <table>
        <thead><tr><th>Datum</th><th>Titel</th><th>Kategorie</th><th>Einheit</th><th>Person</th><th>Datei</th><th /></tr></thead>
        <tbody>
          {rows?.filter((r) => !q || [r.titel, r.kategorie, r.name, r.person, r.einheit, r.notiz].some((x) => x?.toLowerCase().includes(q))).map((r) => (
            <tr key={r.id} onDoubleClick={() => window.hv.dokumentOeffnen(r.datei)}>
              <td>{datum(r.datum)}</td><td>{r.titel}</td><td>{r.kategorie}</td><td>{r.einheit}</td><td>{r.person}</td>
              <td className="klein">{r.name} ({Math.max(1, Math.round((r.groesse ?? 0) / 1024))} KB)</td>
              <td className="aktionen"><button onClick={() => window.hv.dokumentOeffnen(r.datei)}>Öffnen</button><button onClick={() => setEdit(r)}>Bearbeiten</button></td>
            </tr>
          ))}
          {rows && !rows.length && <tr><td colSpan={7} className="hinweis">Noch keine Dokumente abgelegt.</td></tr>}
        </tbody>
      </table>
      {edit && <FormDialog title="Dokument" row={edit} fields={felder} onSave={(r) => call('save', 'dokumente', r)}
        onDelete={async () => { await call('remove', 'dokumente', edit.id); await window.hv.dokumentLoeschen(edit.datei); }}
        onClose={() => { setEdit(null); reload(); }} />}
    </section>
  );
}

const STATUS: [string, string][] = [['offen', 'offen'], ['in_arbeit', 'in Arbeit'], ['wartet', 'wartet auf Rückmeldung'], ['erledigt', 'erledigt']];
const ARTEN: [string, string][] = [['notiz', 'Notiz'], ['anruf', 'Anruf'], ['email', 'E-Mail'], ['brief', 'Brief'], ['termin', 'Termin vor Ort'], ['auftrag', 'Auftrag erteilt']];

export function Vorgaenge(props: { objekt: Row }) {
  const [nurOffen, setNurOffen] = useState(true);
  const [rows, reload] = useLoad<Row[]>(() => call('vorgaengeListe', props.objekt.id, nurOffen), [props.objekt.id, nurOffen]);
  const [einheiten] = useLoad<Row[]>(() => call('einheiten', props.objekt.id), [props.objekt.id]);
  const [personen] = useLoad<Row[]>(() => call('personen'), []);
  const [edit, setEdit] = useState<Row | null>(null);
  const [offen, setOffen] = useState<Row | null>(null);
  const felder: Field[] = [
    { key: 'titel', label: 'Titel', required: true, wide: true },
    { key: 'kategorie', label: 'Kategorie', type: 'select', options: ['Schaden / Reparatur', 'Mieteranfrage', 'Eigentümeranfrage', 'Beschwerde', 'Vermietung', 'Verwaltung', 'Sonstiges'].map((k) => [k, k]) },
    { key: 'status', label: 'Status', type: 'select', required: true, options: STATUS },
    { key: 'prioritaet', label: 'Priorität', type: 'select', required: true, options: [[1, 'hoch'], [2, 'normal'], [3, 'niedrig']] },
    { key: 'faellig', label: 'Fällig / Wiedervorlage', type: 'date' },
    { key: 'einheit_id', label: 'Einheit', type: 'select', options: (einheiten ?? []).map((e) => [e.id, `${e.nr} – ${e.bezeichnung}`]) },
    { key: 'person_id', label: 'Person', type: 'select', options: (personen ?? []).map((p) => [p.id, personName(p)]) },
    { key: 'beschreibung', label: 'Beschreibung', type: 'textarea' },
  ];
  return (
    <section>
      <div className="toolbar">
        <h1>Vorgänge – {props.objekt.bezeichnung}</h1>
        <span className="spacer" />
        <label className="check"><input type="checkbox" checked={nurOffen} onChange={(e) => setNurOffen(e.target.checked)} /> nur offene</label>
        <button className="primary" onClick={() => setEdit({ objekt_id: props.objekt.id, status: 'offen', prioritaet: 2 })}>Neuer Vorgang</button>
      </div>
      <table>
        <thead><tr><th>Fällig</th><th>Titel</th><th>Kategorie</th><th>Einheit / Person</th><th>Status</th><th className="num">Einträge</th><th /></tr></thead>
        <tbody>
          {rows?.map((r) => (
            <tr key={r.id} className={r.status === 'erledigt' ? 'inaktiv' : ''} onDoubleClick={() => setOffen(r)}>
              <td className={r.faellig && r.faellig < heute() && r.status !== 'erledigt' ? 'fehlertext' : ''}>{datum(r.faellig)}</td>
              <td>{r.prioritaet === 1 && <span className="tag fehlertext">!</span>}{r.titel}</td><td>{r.kategorie}</td>
              <td className="klein">{[r.einheit, r.person].filter(Boolean).join(' · ')}</td>
              <td>{STATUS.find(([s]) => s === r.status)?.[1]}</td><td className="num">{r.eintraege}</td>
              <td className="aktionen"><button onClick={() => setOffen(r)}>Öffnen</button><button onClick={() => setEdit(r)}>Bearbeiten</button></td>
            </tr>
          ))}
          {rows && !rows.length && <tr><td colSpan={7} className="hinweis">Keine Vorgänge.</td></tr>}
        </tbody>
      </table>
      {edit && <FormDialog title={edit.id ? 'Vorgang bearbeiten' : 'Neuer Vorgang'} row={edit} fields={felder}
        onSave={(r) => call('save', 'vorgaenge', { ...r, objekt_id: props.objekt.id })} onDelete={() => call('remove', 'vorgaenge', edit.id)}
        onClose={() => { setEdit(null); reload(); }} />}
      {offen && <Vorgang v={offen} onClose={() => { setOffen(null); reload(); }} />}
    </section>
  );
}

function Vorgang(props: { v: Row; onClose: () => void }) {
  const [eintraege, reload] = useLoad<Row[]>(() => call('liste', 'vorgangseintraege', { vorgang_id: props.v.id }, 'datum DESC, id DESC'), [props.v.id]);
  const [neu, setNeu] = useState({ art: 'notiz', text: '', datum: heute() });
  return (
    <Dialog titel={props.v.titel} onClose={props.onClose} breit aktionen={
      props.v.status !== 'erledigt' && <button onClick={async () => { await call('save', 'vorgaenge', { id: props.v.id, status: 'erledigt' }); props.onClose(); }}>Als erledigt markieren</button>}>
      {props.v.beschreibung && <p>{props.v.beschreibung}</p>}
      <div className="toolbar">
        <input type="date" value={neu.datum} onChange={(e) => setNeu({ ...neu, datum: e.target.value })} />
        <select value={neu.art} onChange={(e) => setNeu({ ...neu, art: e.target.value })}>{ARTEN.map(([a, l]) => <option key={a} value={a}>{l}</option>)}</select>
        <input style={{ flex: 1 }} className="suche" placeholder="Was ist passiert?" value={neu.text} onChange={(e) => setNeu({ ...neu, text: e.target.value })} />
        <button className="primary" disabled={!neu.text.trim()} onClick={async () => { await call('save', 'vorgangseintraege', { ...neu, vorgang_id: props.v.id }); setNeu({ ...neu, text: '' }); reload(); }}>Eintragen</button>
      </div>
      <table>
        <tbody>{eintraege?.map((e) => (
          <tr key={e.id}><td>{datum(e.datum)}</td><td><span className="tag">{ARTEN.find(([a]) => a === e.art)?.[1]}</span></td><td>{e.text}</td>
            <td className="aktionen"><button onClick={async () => { await call('remove', 'vorgangseintraege', e.id); reload(); }}>×</button></td></tr>
        ))}</tbody>
      </table>
    </Dialog>
  );
}

export function Termine(props: { objekte: Row[] }) {
  const [von, setVon] = useState(heute());
  const bis = new Date(Date.parse(von) + 90 * 864e5).toISOString().slice(0, 10);
  const [rows, reload] = useLoad<Row[]>(() => call('termineListe', von, bis), [von]);
  const [personen] = useLoad<Row[]>(() => call('personen'), []);
  const [edit, setEdit] = useState<Row | null>(null);
  const felder: Field[] = [
    { key: 'titel', label: 'Titel', required: true, wide: true }, { key: 'datum', label: 'Datum', type: 'date', required: true },
    { key: 'uhrzeit', label: 'Uhrzeit (z. B. 14:30)' }, { key: 'dauer_min', label: 'Dauer (Minuten)', type: 'number' }, { key: 'ort', label: 'Ort' },
    { key: 'objekt_id', label: 'Objekt', type: 'select', options: props.objekte.map((o) => [o.id, o.bezeichnung]) },
    { key: 'person_id', label: 'Person', type: 'select', options: (personen ?? []).map((p) => [p.id, personName(p)]) },
    { key: 'erledigt', label: 'Erledigt', type: 'check' }, { key: 'notiz', label: 'Notiz', type: 'textarea' },
  ];
  const tage = [...new Set((rows ?? []).map((r) => r.datum))];
  return (
    <section>
      <div className="toolbar">
        <h1>Termine</h1>
        <label>ab <input type="date" value={von} onChange={(e) => setVon(e.target.value)} /></label>
        <span className="hinweis klein">die nächsten 90 Tage</span>
        <span className="spacer" />
        <button className="primary" onClick={() => setEdit({ datum: heute() })}>Neuer Termin</button>
      </div>
      {tage.map((t) => (
        <div key={t} className="block">
          <h3>{new Date(t + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</h3>
          <table>
            <tbody>{rows!.filter((r) => r.datum === t).map((r) => (
              <tr key={r.id} className={r.erledigt ? 'inaktiv' : ''} onDoubleClick={() => setEdit(r)}>
                <td style={{ width: 80 }}>{r.uhrzeit}</td><td><b>{r.titel}</b>{r.ort && <span className="klein"> · {r.ort}</span>}</td>
                <td className="klein">{[r.objekt, r.person].filter(Boolean).join(' · ')}</td>
                <td className="aktionen"><button onClick={() => setEdit(r)}>Bearbeiten</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
      {rows && !rows.length && <p className="hinweis">Keine Termine in diesem Zeitraum.</p>}
      {edit && <FormDialog title={edit.id ? 'Termin bearbeiten' : 'Neuer Termin'} row={edit} fields={felder}
        onSave={(r) => call('save', 'termine', r)} onDelete={() => call('remove', 'termine', edit.id)} onClose={() => { setEdit(null); reload(); }} />}
    </section>
  );
}
