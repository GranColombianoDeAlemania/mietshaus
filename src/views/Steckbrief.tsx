// Object tiles (cockpit), the object fact sheet, the person file and the loans page.
import { useState } from 'react';
import * as I from 'lucide-react';
import { call, datum, euro, heute, OBJEKT_ART, parseZahl, zahl, type Modus, type Row } from '../api';
import { useLoad } from '../useLoad';
import { Dialog } from '../ui';
import { FormDialog, type Field } from '../Form';
import { DokumentDialog, dokUrl } from './Archiv';
import { Galerie } from '../Galerie';

export function ObjektKacheln(props: { modus: Modus; oeffne: (seite: string, id?: number) => void }) {
  const [liste] = useLoad<Row[]>(() => call('objektKacheln', props.modus), [props.modus]);
  if (!liste?.length) return null;
  return (
    <div className="objektkacheln">
      {liste.map((o) => (
        <div key={o.id} className="objektkachel" onClick={() => props.oeffne('steckbrief', o.id)}>
          <div className="foto" style={o.titelbild ? { backgroundImage: `url("${dokUrl(o.titelbild)}")` } : undefined}>
            {!o.titelbild && <I.Building2 size={46} />}
          </div>
          <div className="text">
            <b>{o.bezeichnung}</b>
            <span className="klein hinweis">{[o.strasse, o.ort].filter(Boolean).join(', ')} · {o.einheiten} Einheiten{o.flaeche ? ` · ${zahl(o.flaeche)} m²` : ''}</span>
            <div className="ampeln">
              {o.rueckstand_ct > 0 ? <span className="ampel rot">Rückstand {euro(o.rueckstand_ct)}</span> : <span className="ampel gruen">keine Rückstände</span>}
              {o.leer > 0 && <span className="ampel orange">{o.leer} {props.modus === 'weg' ? 'ohne Eigentümer' : 'leer'}</span>}
              {o.vorgaenge > 0 && <span className="ampel">{o.vorgaenge} offene Vorgänge</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const Zeitleiste = ({ eintraege }: { eintraege: Row[] }) => (
  <ul className="zeitleiste">
    {eintraege.map((z, i) => <li key={i}><div className="datum">{datum(z.datum)}</div>{z.text}</li>)}
    {!eintraege.length && <li className="hinweis">Noch keine Ereignisse.</li>}
  </ul>
);

export function Steckbrief(props: { objekt: Row; oeffne: (seite: string, id?: number) => void }) {
  const [s, reload] = useLoad<Row>(() => call('objektSteckbrief', props.objekt.id), [props.objekt.id]);
  const [bilder] = useLoad<Row[]>(() => call('galerie', { objekt_id: props.objekt.id, nur_bilder: true }), [props.objekt.id]);
  const [waehlen, setWaehlen] = useState(false);
  const [dok, setDok] = useState<Row | null>(null);
  if (!s) return null;
  const o = s.objekt;
  const fakt = (l: string, w: React.ReactNode) => <div><span>{l}</span><b>{w || '–'}</b></div>;
  return (
    <section>
      <div className="toolbar">
        <h1>{o.bezeichnung}</h1><span className={`tag art-${o.art}`}>{OBJEKT_ART[o.art]}</span>
        <span className="spacer" />
        <button className="icon" onClick={() => props.oeffne('objekte')}><I.Pencil size={15} />Stammdaten bearbeiten</button>
      </div>
      <div className="steckbrief-kopf">
        <div className="titelbild klickbar" onClick={() => setWaehlen(true)} title="Titelbild wählen"
          style={o.titelbild ? { backgroundImage: `url("${dokUrl(o.titelbild)}")` } : undefined}>
          {!o.titelbild && <span><I.ImagePlus size={28} /><br />Titelbild wählen</span>}
        </div>
        <div className="fakten">
          {fakt('Anschrift', [o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '))}
          {fakt('Baujahr', o.baujahr)}
          {fakt('Einheiten', s.einheiten)}
          {fakt('Fläche', s.flaeche ? `${zahl(s.flaeche)} m²` : null)}
          {o.art !== 'miete' && fakt('Miteigentumsanteile', zahl(s.mea))}
          {o.art !== 'weg' && fakt('Mietverhältnisse', s.mieter)}
          {o.art !== 'weg' && fakt('Kaltmiete / Monat', euro(s.kaltmiete_ct))}
          {o.art !== 'miete' && fakt('Eigentümer', s.eigentuemer)}
          <div><span>Rückstände</span><b className={s.rueckstand_ct > 0 ? 'negativ' : ''}>{euro(s.rueckstand_ct)}</b></div>
          {s.geld.map((g: Row) => <div key={g.id}><span>{g.bezeichnung}</span><b>{euro(g.saldo_ct)}</b></div>)}
          {fakt('Zähler', s.zaehler)}
          {o.kaufpreis_ct ? fakt('Kaufpreis', `${euro(o.kaufpreis_ct)}${o.kaufdatum ? ` (${o.kaufdatum.slice(0, 4)})` : ''}`) : null}
          {o.iban ? fakt('Objektkonto', o.iban) : null}
        </div>
      </div>
      <div className="cockpit-raster">
        <div>
          <div className="panel">
            <h3>Offene Vorgänge</h3>
            {s.vorgaenge.length ? <ul className="hinweisliste">{s.vorgaenge.map((v: Row) => (
              <li key={v.id} className="klickbar" onClick={() => props.oeffne('vorgaenge', o.id)}><div className="inhalt">{v.titel}<div className="klein hinweis">{v.faellig ? `fällig ${datum(v.faellig)}` : v.status}</div></div></li>
            ))}</ul> : <p className="hinweis">Keine.</p>}
          </div>
          <div className="panel">
            <h3>Letzte Dokumente</h3>
            <ul className="hinweisliste">{s.dokumente.map((d: Row) => (
              <li key={d.id} className="klickbar" onClick={() => setDok(d)}><div className="inhalt">{d.titel}<div className="klein hinweis">{[d.typ, datum(d.datum ?? d.erfasst)].filter(Boolean).join(' · ')}</div></div></li>
            ))}</ul>
            <button className="link" onClick={() => props.oeffne('archiv')}>Alle im Archiv →</button>
          </div>
          <div className="panel">
            <h3>Zeitleiste</h3>
            <Zeitleiste eintraege={s.zeitleiste} />
          </div>
        </div>
        <div>
          {(s.kontakte.length > 0) && <div className="panel"><h3>Ansprechpartner</h3>
            <ul className="hinweisliste">{s.kontakte.map((k: Row, i: number) => <li key={i}><div className="inhalt"><b>{k.name}</b> <span className="klein hinweis">{k.rolle}</span>
              <div className="klein">{[k.telefon || k.mobil, k.email].filter(Boolean).join(' · ')}</div></div></li>)}</ul></div>}
          {(s.versicherungen.length > 0) && <div className="panel"><h3>Versicherungen & Verträge</h3>
            <ul className="hinweisliste">{s.versicherungen.map((v: Row, i: number) => <li key={i}><div className="inhalt">{v.art} <span className="klein hinweis">{v.gesellschaft}</span>
              <div className="klein">{v.beitrag_ct != null ? `${euro(v.beitrag_ct)} / Jahr` : ''}{v.kuendbar_bis ? ` · kündbar bis ${datum(v.kuendbar_bis)}` : ''}</div></div></li>)}</ul></div>}
          {(s.darlehen.length > 0) && <div className="panel"><h3>Finanzierung</h3>
            <ul className="hinweisliste">{s.darlehen.map((d: Row) => <li key={d.id} className="klickbar" onClick={() => props.oeffne('darlehen', o.id)}><div className="inhalt">{d.bank} · {euro(d.betrag_ct)} zu {zahl(d.zinssatz)} %
              <div className="klein hinweis">{d.zinsbindung_bis ? `Zinsbindung bis ${datum(d.zinsbindung_bis)}` : ''}</div></div></li>)}</ul></div>}
          {(s.projekte.length > 0) && <div className="panel"><h3>Laufende Projekte</h3>
            <ul className="hinweisliste">{s.projekte.map((p: Row) => <li key={p.id}><div className="inhalt">{p.titel}<div className="klein hinweis">{p.status}</div></div></li>)}</ul></div>}
        </div>
      </div>
      <h3>Fotos & Dokumente</h3>
      <Galerie filter={{ objekt_id: o.id }} hinweis={o.bezeichnung} />
      {waehlen && (
        <Dialog titel="Titelbild wählen" onClose={() => setWaehlen(false)} breit>
          {!bilder?.length && <p className="hinweis">Noch keine Fotos – zuerst unten in „Fotos & Dokumente“ eins hineinziehen.</p>}
          <div className="galerie">{bilder?.map((b) => (
            <div key={b.id} className="kachelbild" onClick={async () => { await call('save', 'objekte', { id: o.id, titelbild_id: b.id }); setWaehlen(false); reload(); }}>
              <div className="bild" style={{ backgroundImage: `url("${dokUrl(b.datei)}")` }} /><div className="titel">{b.titel}</div>
            </div>
          ))}</div>
        </Dialog>
      )}
      {dok && <DokumentDialog id={dok.id} datei={dok.datei} onClose={() => setDok(null)} />}
    </section>
  );
}

export function PersonAkte(props: { personId: number; onClose: () => void; oeffne?: (seite: string, id?: number) => void }) {
  const [a] = useLoad<Row>(() => call('personAkte', props.personId), [props.personId]);
  const [edit, setEdit] = useState(false);
  const [dok, setDok] = useState<Row | null>(null);
  if (!a) return null;
  const p = a.person;
  return (
    <Dialog titel={`Akte: ${p.name}`} onClose={props.onClose} breit aktionen={<>
      {p.email && <button className="icon" onClick={() => window.hv.extern(`mailto:${p.email}`)}><I.Mail size={15} />E-Mail</button>}
      <button className="icon" onClick={() => setEdit(true)}><I.Pencil size={15} />Bearbeiten</button></>}>
      <div className="fakten" style={{ marginBottom: 14 }}>
        <div><span>Anschrift</span><b>{[p.strasse, [p.plz, p.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '–'}</b></div>
        <div><span>Telefon</span><b>{p.telefon || p.mobil || '–'}</b></div>
        <div><span>E-Mail</span><b>{p.email || '–'}</b></div>
        <div><span>IBAN</span><b>{p.iban || '–'}</b></div>
        {a.rollen.map((r: Row, i: number) => <div key={i}><span>Rolle</span><b>{r.rolle} · {r.objekt}</b></div>)}
      </div>
      <div className="cockpit-raster">
        <div>
          <h3>Verträge</h3>
          <table>
            <thead><tr><th>Art</th><th>Objekt / Einheit</th><th>Zeitraum</th><th className="num">Monatlich</th><th className="num">Kontostand</th></tr></thead>
            <tbody>{a.vertraege.map((v: Row) => (
              <tr key={v.typ + v.id} className={v.ende && v.ende < heute() ? 'inaktiv' : ''}>
                <td>{v.typ === 'weg' ? 'Eigentum' : 'Miete'}</td><td>{v.objekt} · {v.einheit}</td><td className="klein">{datum(v.beginn)} – {datum(v.ende)}</td>
                <td className="num">{euro(v.monatlich_ct)}</td>
                <td className={`num ${v.saldo_ct > 0 ? 'negativ' : ''}`}>{v.saldo_ct > 0 ? `Rückstand ${euro(v.saldo_ct)}` : v.saldo_ct < 0 ? `Guthaben ${euro(-v.saldo_ct)}` : 'ausgeglichen'}</td>
              </tr>
            ))}{!a.vertraege.length && <tr><td colSpan={5} className="hinweis">Keine Verträge.</td></tr>}</tbody>
          </table>
          {a.zahlungen.length > 0 && <>
            <h3>Letzte Zahlungen</h3>
            <table><tbody>{a.zahlungen.map((z: Row, i: number) => <tr key={i}><td>{datum(z.datum)}</td><td className="klein">{z.text}</td>
              <td className={`num ${z.richtung === 'aus' ? 'negativ' : ''}`}>{z.richtung === 'aus' ? '−' : ''}{euro(z.betrag_ct)}</td></tr>)}</tbody></table>
          </>}
          {a.dokumente.length > 0 && <>
            <h3>Dokumente</h3>
            <ul className="hinweisliste">{a.dokumente.map((d: Row) => <li key={d.id} className="klickbar" onClick={() => setDok(d)}>
              <div className="inhalt">{d.titel}<div className="klein hinweis">{[d.typ, datum(d.datum ?? d.erfasst)].filter(Boolean).join(' · ')}</div></div></li>)}</ul>
          </>}
        </div>
        <div>
          {a.vorgaenge.length > 0 && <><h3>Vorgänge</h3><ul className="hinweisliste">{a.vorgaenge.map((v: Row) => <li key={v.id}>
            <div className="inhalt">{v.titel}<div className="klein hinweis">{v.status}{v.faellig ? ` · ${datum(v.faellig)}` : ''}{v.objekt ? ` · ${v.objekt}` : ''}</div></div></li>)}</ul></>}
          {a.schluessel.length > 0 && <><h3>Schlüssel</h3><ul className="hinweisliste">{a.schluessel.map((k: Row, i: number) => <li key={i}>
            <div className="inhalt">{k.anzahl}× {k.bezeichnung} {k.nummer}<div className="klein hinweis">ausgegeben {datum(k.ausgabe)}{k.rueckgabe ? ` · zurück ${datum(k.rueckgabe)}` : ''}</div></div></li>)}</ul></>}
          <h3>Zeitleiste</h3>
          <Zeitleiste eintraege={a.zeitleiste} />
        </div>
      </div>
      {edit && <FormDialog title="Person bearbeiten" row={p} fields={[
        { key: 'anrede', label: 'Anrede', type: 'select', options: ['Herr', 'Frau', 'Divers', 'Firma', 'Eheleute'].map((x) => [x, x]) },
        { key: 'titel', label: 'Titel' }, { key: 'vorname', label: 'Vorname' }, { key: 'nachname', label: 'Nachname' }, { key: 'firma', label: 'Firma', wide: true },
        { key: 'strasse', label: 'Straße', wide: true }, { key: 'plz', label: 'PLZ' }, { key: 'ort', label: 'Ort' },
        { key: 'telefon', label: 'Telefon' }, { key: 'mobil', label: 'Mobil' }, { key: 'email', label: 'E-Mail', wide: true },
        { key: 'iban', label: 'IBAN' }, { key: 'bic', label: 'BIC' }, { key: 'notiz', label: 'Notiz', type: 'textarea' }]}
        onSave={(r) => call('save', 'personen', r)} onClose={() => setEdit(false)} />}
      {dok && <DokumentDialog id={dok.id} datei={dok.datei} onClose={() => setDok(null)} />}
    </Dialog>
  );
}

const DARLEHEN_FELDER: Field[] = [
  { key: 'bank', label: 'Bank', required: true }, { key: 'vertragsnr', label: 'Vertragsnummer' },
  { key: 'betrag_ct', label: 'Darlehensbetrag', type: 'money', required: true }, { key: 'auszahlung', label: 'Auszahlung am', type: 'date' },
  { key: 'zinssatz', label: 'Sollzins % p. a.', type: 'number', required: true }, { key: 'tilgung_satz', label: 'Anfängliche Tilgung % p. a.', type: 'number' },
  { key: 'rate_ct', label: 'Monatsrate (leer = aus Zins + Tilgung)', type: 'money' }, { key: 'erste_rate', label: 'Erste Rate am', type: 'date', required: true },
  { key: 'zinsbindung_bis', label: 'Zinsbindung bis', type: 'date' }, { key: 'sondertilgung_ct', label: 'Sondertilgung möglich pro Jahr', type: 'money' },
  { key: 'notiz', label: 'Notiz', type: 'textarea' },
];

export function Darlehen(props: { objekt: Row }) {
  const [liste, reload] = useLoad<Row[]>(() => call('darlehenListe', props.objekt.id), [props.objekt.id]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [plan, setPlan] = useState<Row | null>(null);
  return (
    <section>
      <div className="toolbar"><h1>Darlehen – {props.objekt.bezeichnung}</h1><span className="spacer" />
        <button className="primary" onClick={() => setEdit({ zinssatz: 3.5, tilgung_satz: 2, erste_rate: heute() })}>Neues Darlehen</button></div>
      <p className="hinweis klein">
        Raten, die du im Bankimport dem Darlehenskonto zuordnest, werden automatisch in Zinsen (Werbungskosten, Anlage V) und Tilgung aufgeteilt.
        Vor dem Ende der Zinsbindung meldet sich das Cockpit.
      </p>
      <table>
        <thead><tr><th>Bank</th><th className="num">Betrag</th><th className="num">Zins</th><th className="num">Rate</th><th className="num">Restschuld lt. Plan</th><th className="num">Restschuld lt. Buchhaltung</th><th>Zinsbindung</th><th /></tr></thead>
        <tbody>
          {liste?.map((d) => (
            <tr key={d.id} onDoubleClick={() => setEdit(d)}>
              <td><b>{d.bank}</b><div className="klein">{d.vertragsnr}</div></td><td className="num">{euro(d.betrag_ct)}</td><td className="num">{zahl(d.zinssatz)} %</td>
              <td className="num">{euro(d.rate_berechnet_ct)}</td><td className="num">{euro(d.rest_plan_ct)}</td>
              <td className="num">{d.rest_ist_ct != null ? euro(d.rest_ist_ct) : '–'}</td><td>{datum(d.zinsbindung_bis)}</td>
              <td className="aktionen">
                <button onClick={async () => setPlan(await call('tilgungsplan', d.id))}>Tilgungsplan</button>
                <button onClick={async () => { const g = (await call('konten', props.objekt.id, 'geld'))[0]; if (g && confirm(`Auszahlung von ${euro(d.betrag_ct)} auf ${g.bezeichnung} buchen?`)) { await call('darlehenAuszahlungBuchen', d.id, g.id); reload(); } }}>Auszahlung buchen</button>
              </td>
            </tr>
          ))}
          {liste && !liste.length && <tr><td colSpan={8} className="hinweis">Keine Darlehen.</td></tr>}
        </tbody>
      </table>
      {edit && <FormDialog title={edit.id ? 'Darlehen bearbeiten' : 'Neues Darlehen'} row={edit} fields={DARLEHEN_FELDER}
        onSave={(r) => call('darlehenSpeichern', { ...r, objekt_id: props.objekt.id, zinssatz: parseZahl(r.zinssatz), tilgung_satz: parseZahl(r.tilgung_satz) })}
        onDelete={() => call('remove', 'darlehen', edit.id)} onClose={() => { setEdit(null); reload(); }} />}
      {plan && (
        <Dialog titel={`Tilgungsplan ${plan.darlehen.bank}`} onClose={() => setPlan(null)} breit>
          <p>Monatsrate {euro(plan.rate_ct)} · Laufzeit {Math.floor(plan.laufzeit_monate / 12)} Jahre {plan.laufzeit_monate % 12} Monate
            {plan.rest_zinsbindung_ct != null && ` · Restschuld bei Ende der Zinsbindung: ${euro(plan.rest_zinsbindung_ct)}`}</p>
          <table>
            <thead><tr><th>Jahr</th><th className="num">Zinsen</th><th className="num">Tilgung</th><th className="num">Restschuld Jahresende</th></tr></thead>
            <tbody>{plan.jahre.map((j: Row) => <tr key={j.jahr} className={plan.darlehen.zinsbindung_bis && j.jahr > plan.darlehen.zinsbindung_bis.slice(0, 4) ? 'inaktiv' : ''}>
              <td>{j.jahr}</td><td className="num">{euro(j.zins_ct)}</td><td className="num">{euro(j.tilgung_ct)}</td><td className="num">{euro(j.rest_ct)}</td></tr>)}</tbody>
          </table>
          <p className="klein hinweis">Kursiv: nach Ende der Zinsbindung – angenommen zum gleichen Zins.</p>
        </Dialog>
      )}
    </section>
  );
}
