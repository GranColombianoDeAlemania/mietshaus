// Object tiles (cockpit), the object fact sheet, the person file and the loans page.
import { useState } from 'react';
import * as I from 'lucide-react';
import { call, datum, euro, heute, OBJEKT_ART, parseZahl, zahl, type Modus, type Row } from '../api';
import { useLoad } from '../useLoad';
import { Chip, DetailKopf, Dialog, Leer } from '../ui';
import { FormDialog, type Field } from '../Form';
import { dokUrl } from './Archiv';
import { Galerie } from '../Galerie';
import { L, useNavi } from '../navi';
import { ROLLEN } from './WegExtras';

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

export function Steckbrief(props: { objekt: Row; oeffne: (seite: string, id?: number) => void; modus: Modus }) {
  const navi = useNavi();
  const [s, reload] = useLoad<Row>(() => call('objektSteckbrief', props.objekt.id), [props.objekt.id]);
  const [einheiten] = useLoad<Row[]>(() => call('einheiten', props.objekt.id), [props.objekt.id]);
  const [bilder] = useLoad<Row[]>(() => call('galerie', { objekt_id: props.objekt.id, nur_bilder: true }), [props.objekt.id]);
  const [waehlen, setWaehlen] = useState(false);
  if (!s) return null;
  const o = s.objekt;
  const miete = o.art !== 'weg', weg = o.art !== 'miete';
  return (
    <section className="detailseite">
      <DetailKopf
        bild={<div className="titelbild klickbar" onClick={() => setWaehlen(true)} title="Titelbild wählen"
          style={o.titelbild ? { backgroundImage: `url("${dokUrl(o.titelbild)}")` } : undefined}>{!o.titelbild && <I.ImagePlus size={22} />}</div>}
        eyebrow={`Objekt · ${OBJEKT_ART[o.art]}`}
        titel={o.bezeichnung}
        chips={<>
          {(o.strasse || o.ort) && <Chip>{[o.strasse, [o.plz, o.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</Chip>}
          {o.baujahr && <Chip>Baujahr {o.baujahr}</Chip>}
          <Chip>{s.einheiten} Einheiten{s.flaeche ? ` · ${zahl(s.flaeche)} m²` : ''}</Chip>
          {weg && <Chip art="weg">MEA {zahl(s.mea)}</Chip>}
        </>}
        aktionen={<button className="icon" onClick={() => props.oeffne('objekte')}><I.Pencil size={15} />Stammdaten</button>}
      />
      <div className="kacheln">
        {miete && <button className="kachel klickbar" onClick={() => navi.zu({ seite: 'op', objektId: o.id, modus: 'miete' })}>
          <div className={`wert${s.rueckstand_miete_ct > 0 ? ' negativ' : ''}`}>{euro(s.rueckstand_miete_ct)}</div><div className="label">Mietrückstände</div></button>}
        {weg && <button className="kachel klickbar" onClick={() => navi.zu({ seite: 'op', objektId: o.id, modus: 'weg' })}>
          <div className={`wert${s.rueckstand_weg_ct > 0 ? ' negativ' : ''}`}>{euro(s.rueckstand_weg_ct)}</div><div className="label">Hausgeldrückstände</div></button>}
        {miete && <div className="kachel"><div className="wert">{euro(s.kaltmiete_ct)}</div><div className="label">Kaltmiete / Monat ({s.mieter} Mietverhältnisse)</div></div>}
        {s.geld.filter((g: Row, i: number) => i === 0 || g.saldo_ct !== 0).map((g: Row) => <button key={g.id} className="kachel klickbar" onClick={() => navi.zu({ konto: g.id })}><div className="wert">{euro(g.saldo_ct)}</div><div className="label">{g.bezeichnung}</div></button>)}
      </div>
      <div className="panel">
        <div className="panelkopf"><h3>Einheiten</h3><L zu={{ seite: 'einheiten', objektId: o.id }}>Alle Einheiten →</L></div>
        <div className="einheitenraster">
          {einheiten?.map((e) => (
            <div key={e.id} className="einheitkarte klickbar" data-ziel={`einheit:${e.id}`} onClick={() => navi.zu({ einheit: e.id })}>
              <div className="kopf"><L zu={{ einheit: e.id }}>{e.bezeichnung}</L><span className="klein hinweis">{e.art}{e.wohnflaeche ? ` · ${zahl(e.wohnflaeche)} m²` : ''}</span></div>
              {miete && <div className="zeile"><span className="klein hinweis">Mieter</span>{e.mieter ? <L zu={{ person: e.mieter_id }}>{e.mieter}</L> : <i className="hinweis">{e.selbstgenutzt ? 'selbst genutzt' : 'leer'}</i>}</div>}
              {weg && <div className="zeile"><span className="klein hinweis">Eigentum</span>{e.eigentuemer ? <L zu={{ person: e.eigentuemer_id }}>{e.eigentuemer}</L> : <i className="hinweis">–</i>}</div>}
            </div>
          ))}
          {einheiten && !einheiten.length && <Leer text="Noch keine Einheiten." aktion={<button onClick={() => navi.zu({ seite: 'einheiten', objektId: o.id })}>Einheiten anlegen</button>} />}
        </div>
      </div>
      <div className="raster2">
        <div className="spalte">
          <div className="panel">
            <div className="panelkopf"><h3>Offene Vorgänge</h3><L zu={{ seite: 'vorgaenge', objektId: o.id }}>Alle →</L></div>
            {s.vorgaenge.length ? <ul className="liste">{s.vorgaenge.map((v: Row) => (
              <li key={v.id}><L zu={{ vorgang: v.id, objektId: o.id }}>{v.titel}</L><span className="klein hinweis">{v.faellig ? `fällig ${datum(v.faellig)}` : v.status}</span></li>
            ))}</ul> : <p className="hinweis klein">Keine.</p>}
          </div>
          <div className="panel">
            <div className="panelkopf"><h3>Letzte Dokumente</h3><L zu={{ seite: 'archiv', objektId: o.id }}>Archiv →</L></div>
            <ul className="liste">{s.dokumente.map((d: Row) => (
              <li key={d.id}><L zu={{ dokument: d.id, datei: d.datei }}>{d.titel}</L><span className="klein hinweis">{[d.typ, datum(d.datum ?? d.erfasst)].filter(Boolean).join(' · ')}</span></li>
            ))}</ul>
          </div>
          <div className="panel"><div className="panelkopf"><h3>Zeitleiste</h3></div><Zeitleiste eintraege={s.zeitleiste} /></div>
        </div>
        <div className="spalte">
          <div className="panel">
            <div className="panelkopf"><h3>Ansprechpartner</h3><L zu={{ seite: 'kontakte', objektId: o.id }}>Bearbeiten →</L></div>
            {s.kontakte.length ? <ul className="liste">{s.kontakte.map((k: Row, i: number) => (
              <li key={i}><span><L zu={{ person: k.person_id }}>{k.name}</L> <span className="klein hinweis">{ROLLEN.find(([r]) => r === k.rolle)?.[1] ?? k.rolle}</span></span><span className="klein">{[k.telefon || k.mobil, k.email].filter(Boolean).join(' · ')}</span></li>
            ))}</ul> : <p className="hinweis klein">Noch keine (z. B. Hausmeister, Beirat, Handwerker).</p>}
          </div>
          {s.versicherungen.length > 0 && <div className="panel">
            <div className="panelkopf"><h3>Versicherungen & Verträge</h3><L zu={{ seite: 'versicherungen', objektId: o.id }}>Alle →</L></div>
            <ul className="liste">{s.versicherungen.map((v: Row, i: number) => <li key={i}><span>{v.art} <span className="klein hinweis">{v.gesellschaft}</span></span>
              <span className="klein">{v.beitrag_ct != null ? `${euro(v.beitrag_ct)} / Jahr` : ''}{v.kuendbar_bis ? ` · kündbar bis ${datum(v.kuendbar_bis)}` : ''}</span></li>)}</ul></div>}
          {s.darlehen.length > 0 && <div className="panel">
            <div className="panelkopf"><h3>Finanzierung</h3><L zu={{ seite: 'darlehen', objektId: o.id }}>Darlehen →</L></div>
            <ul className="liste">{s.darlehen.map((d: Row) => <li key={d.id}><span>{d.bank} · {euro(d.betrag_ct)} zu {zahl(d.zinssatz)} %</span>
              <span className="klein hinweis">{d.zinsbindung_bis ? `Zinsbindung bis ${datum(d.zinsbindung_bis)}` : ''}</span></li>)}</ul></div>}
          {s.projekte.length > 0 && <div className="panel"><div className="panelkopf"><h3>Laufende Projekte</h3></div>
            <ul className="liste">{s.projekte.map((p: Row) => <li key={p.id}><L zu={{ projekt: p.id }}>{p.titel}</L><span className="klein hinweis">{p.status}</span></li>)}</ul></div>}
          <div className="panel"><div className="panelkopf"><h3>Kennzahlen</h3></div>
            <div className="fakten einspaltig">
              {s.zaehler ? <div className="fakt"><span>Zähler</span><b><L zu={{ seite: 'zaehler', objektId: o.id }}>{s.zaehler} Zähler</L></b></div> : null}
              {o.kaufpreis_ct ? <div className="fakt"><span>Kaufpreis</span><b>{euro(o.kaufpreis_ct)}{o.kaufdatum ? ` (${o.kaufdatum.slice(0, 4)})` : ''}</b></div> : null}
              {o.iban ? <div className="fakt"><span>Objektkonto</span><b>{o.iban}</b></div> : null}
              {weg && <div className="fakt"><span>Eigentümer</span><b>{s.eigentuemer}</b></div>}
            </div>
          </div>
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
    </section>
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
      <div className="toolbar"><h1>Darlehen</h1><span className="spacer" />
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
