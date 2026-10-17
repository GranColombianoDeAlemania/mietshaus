// Detail pages for single records: person, unit, contract (tenancy or ownership) and account.
// Everything on them links on to the related records.
import { useEffect, useState, type ReactNode } from 'react';
import * as I from 'lucide-react';
import { betrag, call, datum, diesesJahr, euro, faelligText, fehler, heute, personName, zahl, type Row } from '../api';
import { useLoad } from '../useLoad';
import { L, usePfad, useNavi, type PfadTeil } from '../navi';
import { Chip, DetailKopf, Leer, Reiter, Saldo, Zeitraum, initialen } from '../ui';
import { FormDialog } from '../Form';
import { Galerie } from '../Galerie';
import { PERSON_FELDER } from './Personen';
import { EINHEIT_FELDER } from './Einheiten';
import { vertragFelder } from './Vertraege';
import { aktionSetzen, useAktion } from '../aktion';
import { dauerrechnung, Kuendigung, Ratenplan, RatenplanListe } from './Vertragsaktionen';
import { kontoauszugPdf } from './Konten';
import { ROLLEN } from './WegExtras';
import { BESCHEINIGUNGEN, musterbrief } from './Kommunikation';
import { sollNachfrage } from './Sollstellung';
import { EinheitKennzahlen, Kalender, MieterKennzahlen, SelbstnutzungDialog, Zahlungsverhalten } from './Kennzahlen';
import { euro0, prozent, Ring, RingZeile, ZONEN_KAUTION } from '../zeiger';

const monatKurz = (m: string | null | undefined) => (m && /^\d{4}-\d{2}/.test(m) ? `${m.slice(5, 7)}/${m.slice(2, 4)}` : datum(m));
const GRUND: Record<string, string> = {
  beginn: 'Vertragsbeginn', manuell: 'Manuell', staffel: 'Staffelmiete', index: 'Indexmiete', erhoehung: 'Mieterhöhung (§ 558)',
  nk_anpassung: 'Neue Vorauszahlungen', wirtschaftsplan: 'Wirtschaftsplan', modernisierung: 'Modernisierung (§ 559)',
};

// Balance of a contract as a chip: red when something is overdue, green when settled.
export function SaldoChip(props: { v: Row }) {
  const v = props.v;
  if (v.ueberfaellig_ct > 0) return <Chip art="rot" title={`offen: ${v.offene_monate?.map(monatKurz).join(', ')}`}>Rückstand {euro(v.ueberfaellig_ct)}</Chip>;
  if (v.saldo_ct < 0) return <Chip art="gruen">Guthaben {euro(-v.saldo_ct)}</Chip>;
  if (v.saldo_ct > 0) return <Chip>noch nicht fällig {euro(v.saldo_ct)}</Chip>;
  return <Chip art="gruen">ausgeglichen</Chip>;
}

const Panel = (props: { titel: ReactNode; children: ReactNode; aktion?: ReactNode; className?: string }) => (
  <section className={`panel${props.className ? ' ' + props.className : ''}`}>
    <div className="panelkopf"><h3>{props.titel}</h3>{props.aktion}</div>
    {props.children}
  </section>
);
const Fakt = (props: { l: ReactNode; children: ReactNode }) => <div className="fakt"><span>{props.l}</span><b>{props.children || '–'}</b></div>;

function Zeitleiste(props: { eintraege: Row[] }) {
  return (
    <ul className="zeitleiste">
      {props.eintraege.map((z, i) => <li key={i}><div className="datum">{datum(z.datum)}</div>{z.text}</li>)}
      {!props.eintraege.length && <li className="hinweis">Noch keine Ereignisse.</li>}
    </ul>
  );
}

const DokListe = (props: { doks: Row[] }) => props.doks.length ? (
  <ul className="liste">
    {props.doks.map((d) => (
      <li key={d.id}><L zu={{ dokument: d.id, datei: d.datei }}>{d.titel}</L><span className="klein hinweis">{[d.typ, datum(d.datum ?? d.erfasst)].filter(Boolean).join(' · ')}</span></li>
    ))}
  </ul>
) : <p className="hinweis klein">Keine Dokumente.</p>;

async function ablegen(opt: Row) {
  const r = await window.hv.dateienImportieren({ ...opt, status: 'abgelegt' });
  if (r.length) window.dispatchEvent(new Event('hv-daten'));
}

// ===================================================================================================
// Person
// ===================================================================================================
export function PersonSeite(props: { id: number }) {
  const navi = useNavi();
  const [a, reload] = useLoad<Row>(() => call('personAkte', props.id), [props.id]);
  const [tab, setTab] = useState<'uebersicht' | 'zahlungen' | 'dokumente' | 'vorgaenge' | 'verlauf'>('uebersicht');
  const [edit, setEdit] = useState(false);
  const [kzVertrag, setKzVertrag] = useState<number | null>(null);
  useAktion('person-bearbeiten', () => setEdit(true));
  const aktuell = a?.vertraege.filter((v: Row) => v.aktuell || v.zukuenftig) ?? [];
  const erster = aktuell[0] ?? a?.vertraege[0];
  usePfad(a ? [
    ...(erster ? [{ label: erster.objekt, ziel: { objekt: erster.objekt_id } }, { label: erster.einheit, ziel: { einheit: erster.einheit_id } }] as PfadTeil[] : [{ label: 'Adressbuch', ziel: { seite: 'personen' } }] as PfadTeil[]),
    { label: personName(a.person) },
  ] : null, [a]);
  if (!a) return null;
  const p = a.person;
  const rueckstand = aktuell.reduce((s: number, v: Row) => s + (v.ueberfaellig_ct ?? 0), 0);
  // Tenant profile for the main tenancy (the largest current one, otherwise the latest), switchable when there are more.
  const mieten = a.vertraege.filter((v: Row) => v.typ === 'miete');
  const laufend = mieten.filter((v: Row) => v.aktuell).sort((x: Row, y: Row) => y.monatlich_ct - x.monatlich_ct);
  const kzListe = laufend.length ? laufend : mieten.slice(0, 1);
  const kzId = kzListe.some((v: Row) => v.id === kzVertrag) ? kzVertrag : kzListe[0]?.id ?? null;

  return (
    <section className="detailseite">
      <DetailKopf
        bild={<div className="avatar">{initialen(p.name)}</div>}
        eyebrow={[p.firma && p.vorname ? 'Person · ' + p.firma : 'Person', ...a.rollen.map((r: Row) => ROLLEN.find(([x]) => x === r.rolle)?.[1] ?? r.rolle)].join(' · ')}
        titel={[p.titel, p.vorname, p.nachname].filter(Boolean).join(' ') || p.firma || p.name}
        chips={<>
          {aktuell.map((v: Row) => (
            <Chip key={v.typ + v.id} art={v.typ === 'weg' ? 'weg' : 'miete'}>
              {v.typ === 'weg' ? 'Eigentum' : v.zukuenftig ? 'Mieter ab ' + datum(v.beginn) : 'Mieter'} · <L zu={{ einheit: v.einheit_id }}>{v.einheit}</L>
            </Chip>
          ))}
          {aktuell.length > 0 && (rueckstand > 0 ? <Chip art="rot">Rückstand {euro(rueckstand)}</Chip> : <Chip art="gruen">Konten ausgeglichen</Chip>)}
          {!a.vertraege.length && <Chip>keine Verträge</Chip>}
        </>}
        aktionen={<>
          {p.email && <button className="icon" onClick={() => window.hv.extern(`mailto:${p.email}`)}><I.Mail size={15} />E-Mail</button>}
          {erster && <button className="icon" onClick={() => { sessionStorage.setItem('briefAn', JSON.stringify([`${erster.typ === 'weg' ? 'e' : 'm'}${erster.id}`])); navi.zu({ seite: 'briefe', objektId: erster.objekt_id, modus: erster.typ === 'weg' ? 'weg' : 'miete' }); }}><I.FileText size={15} />Brief</button>}
          <button className="icon" onClick={() => ablegen({ person_id: p.id, objekt_id: erster?.objekt_id ?? null })}><I.FilePlus2 size={15} />Dokument</button>
          <button className="icon" onClick={() => setEdit(true)}><I.Pencil size={15} />Bearbeiten</button>
        </>}
      />
      <Reiter value={tab} onChange={setTab} tabs={[['uebersicht', 'Übersicht'], ['zahlungen', 'Zahlungen', a.zahlungen.length],
        ['dokumente', 'Dokumente', a.dokumente.length], ['vorgaenge', 'Vorgänge & Termine', a.vorgaenge.length + a.termine.length], ['verlauf', 'Verlauf']]} />

      {tab === 'uebersicht' && kzId != null && (
        <MieterKennzahlen key={kzId} vertragId={kzId} titel={kzListe.length > 1 || !laufend.length ? (
          <div className="toolbar klein">
            <span className="hinweis">{laufend.length ? 'Kennzahlen für' : 'Kennzahlen des früheren Mietverhältnisses'}</span>
            {kzListe.length > 1 && <div className="tabs">{kzListe.map((v: Row) => <button key={v.id} className={v.id === kzId ? 'active' : ''} onClick={() => setKzVertrag(v.id)}>{v.einheit}</button>)}</div>}
          </div>) : undefined} />
      )}
      {tab === 'uebersicht' && (
        <div className="raster2">
          <div className="spalte">
            {a.vertraege.map((v: Row) => (
              <Panel key={v.typ + v.id} className={v.aktuell || v.zukuenftig ? '' : 'vergangen'}
                titel={v.typ === 'weg' ? 'Eigentum' : v.aktuell ? 'Mietverhältnis' : v.zukuenftig ? 'Künftiges Mietverhältnis' : 'Früheres Mietverhältnis'}
                aktion={<L zu={{ vertrag: v.id, typ: v.typ }}>{v.typ === 'weg' ? 'Eigentum öffnen' : 'Vertrag öffnen'} →</L>}>
                <div className="fakten">
                  <Fakt l="Einheit"><L zu={{ einheit: v.einheit_id }}>{v.einheit}</L> · <L zu={{ objekt: v.objekt_id }}>{v.objekt}</L></Fakt>
                  <Fakt l="Zeitraum">{v.ende ? `${datum(v.beginn)} – ${datum(v.ende)}` : `seit ${datum(v.beginn)}`}</Fakt>
                  <Fakt l={v.typ === 'weg' ? 'Hausgeld / Monat' : 'Monatlich'}>{euro(v.monatlich_ct)}</Fakt>
                  {v.konto && <Fakt l="Konto"><L zu={{ konto: v.konto.id }}>{v.konto.nr}</L> <SaldoChip v={v} /></Fakt>}
                </div>
                {v.offene_posten?.filter((o: Row) => o.verzug >= 1).length > 0 && (
                  <table className="kompakt">
                    <thead><tr><th>Fällig</th><th>Monat</th><th className="num">offen</th><th>Status</th></tr></thead>
                    <tbody>{v.offene_posten.filter((o: Row) => o.verzug >= 1).map((o: Row) => (
                      <tr key={o.id}><td>{datum(o.datum)}</td><td>{o.text}</td><td className="num">{euro(o.offen_ct)}</td>
                        <td><Chip art={o.status === 'nicht bezahlt' ? 'rot' : 'gelb'}>{o.status}</Chip></td></tr>
                    ))}</tbody>
                  </table>
                )}
              </Panel>
            ))}
            {!a.vertraege.length && <Leer text="Diese Person ist keinem Miet- oder Eigentumsverhältnis zugeordnet." />}
          </div>
          <div className="spalte">
            <Panel titel="Kontakt">
              <div className="fakten einspaltig">
                <Fakt l="Anschrift">{[p.strasse, [p.plz, p.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</Fakt>
                <Fakt l="Telefon">{[p.telefon, p.mobil].filter(Boolean).join(' · ')}</Fakt>
                <Fakt l="E-Mail">{p.email}</Fakt>
                <Fakt l="IBAN">{p.iban}</Fakt>
                {p.geburtsdatum && <Fakt l="Geburtsdatum">{datum(p.geburtsdatum)}</Fakt>}
              </div>
              {p.notiz && <p className="notiz">{p.notiz}</p>}
            </Panel>
            {a.rollen.length > 0 && (
              <Panel titel="Rollen">
                <ul className="liste">{a.rollen.map((r: Row, i: number) => <li key={i}>{ROLLEN.find(([x]) => x === r.rolle)?.[1] ?? r.rolle}<L zu={{ objekt: r.objekt_id }}>{r.objekt}</L></li>)}</ul>
              </Panel>
            )}
            {a.schluessel.length > 0 && (
              <Panel titel="Schlüssel">
                <ul className="liste">{a.schluessel.map((k: Row, i: number) => (
                  <li key={i} className={k.rueckgabe ? 'vergangen' : ''}><span>{k.anzahl}× {k.bezeichnung} {k.nummer}</span>
                    <span className="klein hinweis">{k.rueckgabe ? `zurück ${datum(k.rueckgabe)}` : `seit ${datum(k.ausgabe)}`}</span></li>
                ))}</ul>
              </Panel>
            )}
          </div>
        </div>
      )}
      {tab === 'zahlungen' && (
        <Panel titel="Letzte Zahlungen">
          {a.zahlungen.length ? (
            <table className="kompakt">
              <thead><tr><th>Datum</th><th>Text</th><th className="num">Betrag</th></tr></thead>
              <tbody>{a.zahlungen.map((z: Row, i: number) => (
                <tr key={i}><td>{datum(z.datum)}</td><td className="klein">{z.text}</td>
                  <td className={`num ${z.richtung === 'aus' ? 'negativ' : ''}`}>{z.richtung === 'aus' ? '−' : ''}{euro(z.betrag_ct)}</td></tr>
              ))}</tbody>
            </table>
          ) : <p className="hinweis">Noch keine Zahlungen.</p>}
          <div className="buttons">{a.vertraege.filter((v: Row) => v.konto).map((v: Row) => (
            <L key={v.typ + v.id} zu={{ konto: v.konto.id }}>Kontoauszug {v.konto.nr} ({v.einheit}) →</L>
          ))}</div>
        </Panel>
      )}
      {tab === 'dokumente' && <Galerie filter={{ person_id: p.id }} ablage={{ person_id: p.id, objekt_id: erster?.objekt_id ?? null }} hinweis={personName(p)} />}
      {tab === 'vorgaenge' && (
        <div className="raster2">
          <Panel titel="Vorgänge">
            {a.vorgaenge.length ? <ul className="liste">{a.vorgaenge.map((v: Row) => (
              <li key={v.id} className={v.status === 'erledigt' ? 'vergangen' : ''}><L zu={{ vorgang: v.id, objektId: v.objekt_id }}>{v.titel}</L>
                <span className="klein hinweis">{[v.status, datum(v.faellig), v.objekt].filter(Boolean).join(' · ')}</span></li>
            ))}</ul> : <p className="hinweis klein">Keine Vorgänge.</p>}
          </Panel>
          <Panel titel="Termine">
            {a.termine.length ? <ul className="liste">{a.termine.map((t: Row) => (
              <li key={t.id} className={t.erledigt ? 'vergangen' : ''}><span>{t.titel}</span><span className="klein hinweis">{datum(t.datum)} {t.uhrzeit ?? ''}</span></li>
            ))}</ul> : <p className="hinweis klein">Keine Termine.</p>}
          </Panel>
        </div>
      )}
      {tab === 'verlauf' && <Panel titel="Verlauf"><Zeitleiste eintraege={a.zeitleiste} /></Panel>}

      {edit && <FormDialog title="Person bearbeiten" row={p} fields={PERSON_FELDER}
        onSave={(r) => call('save', 'personen', r)} onClose={() => { setEdit(false); reload(); }} />}
    </section>
  );
}

// ===================================================================================================
// Unit
// ===================================================================================================
export function EinheitSeite(props: { id: number }) {
  const navi = useNavi();
  const [a, reload] = useLoad<Row>(() => call('einheitAkte', props.id), [props.id]);
  const [tab, setTab] = useState<'uebersicht' | 'dokumente' | 'verlauf'>('uebersicht');
  const [edit, setEdit] = useState(false);
  const [selbstEdit, setSelbstEdit] = useState<Row | null>(null);
  useEffect(() => { if (a?.einheit) navi.setzeObjekt(a.einheit.objekt_id); }, [a?.einheit?.objekt_id]);
  usePfad(a ? [{ label: a.einheit.objekt, ziel: { objekt: a.einheit.objekt_id } }, { label: 'Einheiten', ziel: { seite: 'einheiten', objektId: a.einheit.objekt_id } },
    { label: a.einheit.bezeichnung }] : null, [a]);
  if (!a) return null;
  const e = a.einheit;
  const mieter = a.mieter.find((v: Row) => v.aktuell);
  const kuenftig = a.mieter.find((v: Row) => v.zukuenftig);
  const eigner = a.eigentum.filter((v: Row) => v.aktuell);
  // Self-use: the landlord's own (period with household size) or an owner who lives in the unit.
  const eigen = a.selbst;
  const selbst = eigen ?? eigner.find((v: Row) => v.selbstnutzer);
  const zeigeMiete = e.objekt_art !== 'weg';
  const zeigeWeg = e.objekt_art !== 'miete';
  const b = mieter?.betraege;
  const status = mieter ? <Chip art="miete">vermietet</Chip> : selbst ? <Chip art="weg">selbst genutzt</Chip> : zeigeMiete ? <Chip art="gelb">leer</Chip> : null;
  const selbstNeu = () => setSelbstEdit({ beginn: heute(), personen: 1 });

  return (
    <section className="detailseite">
      <DetailKopf
        bild={<div className="avatar eckig"><I.DoorOpen size={26} /></div>}
        eyebrow={<>Einheit {e.nr} · <L zu={{ objekt: e.objekt_id }}>{e.objekt}</L></>}
        titel={e.bezeichnung}
        chips={<>
          <Chip>{e.art}</Chip>
          {e.wohnflaeche ? <Chip>{zahl(e.wohnflaeche)} m²</Chip> : <Chip art="gelb">Fläche fehlt</Chip>}
          {e.zimmer ? <Chip>{zahl(e.zimmer)} Zimmer</Chip> : null}
          {e.lage && <Chip>{e.lage}</Chip>}
          {zeigeWeg && e.mea ? <Chip art="weg">MEA {zahl(e.mea)} / {zahl(e.mea_gesamt)}</Chip> : null}
          {status}
        </>}
        aktionen={<>
          <button className="icon" onClick={() => ablegen({ objekt_id: e.objekt_id, einheit_id: e.id })}><I.ImagePlus size={15} />Fotos & Dokumente</button>
          <button className="icon" onClick={() => navi.zu({ seite: 'zaehler', objektId: e.objekt_id })}><I.Gauge size={15} />Zählerstand</button>
          {zeigeMiete && !mieter && !eigen && <button className="icon" title="Die Einheit selbst bewohnen: zählt nicht als Leerstand, eigener Anteil in der Betriebskostenabrechnung, Anlage V nur für den vermieteten Teil" onClick={selbstNeu}><I.House size={15} />Selbst nutzen</button>}
          <button className="icon" onClick={() => setEdit(true)}><I.Pencil size={15} />Bearbeiten</button>
        </>}
      />
      <Reiter value={tab} onChange={setTab} tabs={[['uebersicht', 'Übersicht'], ['dokumente', 'Fotos & Dokumente', a.dokumente.length], ['verlauf', 'Verlauf']]} />

      {tab === 'uebersicht' && zeigeMiete && <EinheitKennzahlen key={e.id} einheit={e} selbstnutzung={a.selbstnutzung} reload={reload} />}
      {tab === 'uebersicht' && (
        <div className="raster2">
          <div className="spalte">
            <Panel titel="Wer wohnt hier">
              <div className="fakten einspaltig">
                {zeigeMiete && (mieter ? (
                  <Fakt l="Mieter"><L zu={{ person: mieter.person_id }}>{mieter.name}</L>{mieter.person2 && <> und <L zu={{ person: mieter.person2.id }}>{mieter.person2.name}</L></>}
                    {' '}<span className="klein hinweis">seit {datum(mieter.beginn)}</span></Fakt>
                ) : eigen ? (
                  <Fakt l="Selbst genutzt">seit {datum(eigen.beginn)}{eigen.ende ? ` bis ${datum(eigen.ende)}` : ''} · {zahl(eigen.personen)} {eigen.personen === 1 ? 'Person' : 'Personen'}{' '}
                    <button className="link klein" onClick={() => setSelbstEdit(eigen)}>ändern</button></Fakt>
                ) : <Fakt l="Mieter">{selbst ? 'selbst genutzt' : 'leer'}</Fakt>)}
                {zeigeMiete && !eigen && a.selbst_kuenftig && <Fakt l="Selbstnutzung">ab {datum(a.selbst_kuenftig.beginn)} <button className="link klein" onClick={() => setSelbstEdit(a.selbst_kuenftig)}>ändern</button></Fakt>}
                {mieter && <Fakt l="Mietkonto"><L zu={{ vertrag: mieter.id, typ: 'miete' }}>Mietverhältnis öffnen</L> <SaldoChip v={mieter} /></Fakt>}
                {mieter?.ende && <Fakt l="Mietende"><span className="negativ">{datum(mieter.ende)}</span></Fakt>}
                {kuenftig && <Fakt l="Nachmieter"><L zu={{ person: kuenftig.person_id }}>{kuenftig.name}</L> ab {datum(kuenftig.beginn)}</Fakt>}
                {zeigeWeg && eigner.map((g: Row) => (
                  <Fakt key={g.id} l="Eigentum"><L zu={{ person: g.person_id }}>{g.name}</L> <L zu={{ vertrag: g.id, typ: 'weg' }}>Hausgeld {euro(g.monatlich_ct)}</L> <SaldoChip v={g} /></Fakt>
                ))}
                {zeigeWeg && !eigner.length && <Fakt l="Eigentum">kein Eigentümer erfasst</Fakt>}
              </div>
            </Panel>
            {zeigeMiete && (
              <Panel titel="Miete heute" aktion={mieter ? <L zu={{ seite: 'anpassung', objektId: e.objekt_id }}>Mietanpassungen →</L> : undefined}>
                {b ? (
                  <div className="fakten">
                    <Fakt l="Kaltmiete">{euro(b.kaltmiete_ct)}{e.wohnflaeche ? <span className="klein hinweis"> · {betrag(Math.round((b.kaltmiete_ct ?? 0) / e.wohnflaeche))} €/m²</span> : null}</Fakt>
                    {mieter.bk_art === 'inklusiv' ? <Fakt l="Betriebskosten">in der Kaltmiete enthalten</Fakt>
                      : <Fakt l={mieter.bk_art === 'pauschale' ? 'BK-Pauschale' : 'BK-Vorauszahlung'}>{euro(b.bk_vz_ct)}</Fakt>}
                    <Fakt l="HK-Vorauszahlung">{euro(b.hk_vz_ct)}</Fakt>
                    {b.sonstiges_ct ? <Fakt l="Sonstiges">{euro(b.sonstiges_ct)}</Fakt> : null}
                    {mieter.ust_ct ? <Fakt l={`USt ${zahl(mieter.ust_satz)} %`}>{euro(mieter.ust_ct)}</Fakt> : null}
                    <Fakt l="Gesamt / Monat">{euro(mieter.monatlich_ct)}</Fakt>
                  </div>
                ) : <p className="hinweis klein">{eigen ? 'Du nutzt die Einheit selbst – es wird keine Miete gefordert.' : selbst ? 'Die Einheit wird vom Eigentümer selbst genutzt.' : 'Zurzeit nicht vermietet.'}</p>}
                {a.anpassungen.length > 0 && (
                  <table className="kompakt">
                    <thead><tr><th>Gültig ab</th><th>Grund</th><th className="num">Kaltmiete</th></tr></thead>
                    <tbody>{a.anpassungen.filter((x: Row) => x.kaltmiete_ct != null).map((x: Row) => (
                      <tr key={x.id}><td>{datum(x.gueltig_ab)}</td><td>{GRUND[x.grund] ?? x.grund}</td><td className="num">{euro(x.kaltmiete_ct)}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </Panel>
            )}
            {zeigeMiete && (
              <Panel titel={a.selbstnutzung.length ? 'Nutzung' : 'Mieterhistorie'} aktion={<span className="klein hinweis">{a.leertage ? `${a.leertage} Tage leer in ${diesesJahr()}` : `kein Leerstand in ${diesesJahr()}`}</span>}>
                {a.mieter.length || a.selbstnutzung.length ? (
                  <ul className="liste">{[...a.mieter.map((v: Row) => ({ ...v, art: 'miete' })), ...a.selbstnutzung.map((x: Row) => ({ ...x, art: 'selbst' }))]
                    .sort((x: Row, y: Row) => (x.beginn < y.beginn ? 1 : -1)).map((v: Row) => v.art === 'miete' ? (
                      <li key={'m' + v.id} className={v.aktuell || v.zukuenftig ? '' : 'vergangen'}>
                        <span><L zu={{ person: v.person_id }}>{v.name}</L> <span className="klein hinweis">{v.ende ? `${datum(v.beginn)} – ${datum(v.ende)}` : `seit ${datum(v.beginn)}`}</span></span>
                        <L zu={{ vertrag: v.id, typ: 'miete' }}>Vertrag</L>
                      </li>
                    ) : (
                      <li key={'s' + v.id} className={!v.ende || v.ende >= heute() ? '' : 'vergangen'}>
                        <span>selbst genutzt <span className="klein hinweis">{v.ende ? `${datum(v.beginn)} – ${datum(v.ende)}` : `seit ${datum(v.beginn)}`} · {zahl(v.personen)} Pers.</span></span>
                        <button className="link klein" onClick={() => setSelbstEdit(v)}>Bearbeiten</button>
                      </li>
                    ))}</ul>
                ) : <p className="hinweis klein">Noch keine Mietverhältnisse.</p>}
              </Panel>
            )}
            {zeigeWeg && a.eigentum.length > 1 && (
              <Panel titel="Eigentümerhistorie">
                <ul className="liste">{a.eigentum.map((v: Row) => (
                  <li key={v.id} className={v.aktuell ? '' : 'vergangen'}><span><L zu={{ person: v.person_id }}>{v.name}</L> <span className="klein hinweis">{v.ende ? `${datum(v.beginn)} – ${datum(v.ende)}` : `seit ${datum(v.beginn)}`}</span></span>
                    <L zu={{ vertrag: v.id, typ: 'weg' }}>Eigentum</L></li>
                ))}</ul>
              </Panel>
            )}
          </div>
          <div className="spalte">
            <Panel titel="Zähler" aktion={<L zu={{ seite: 'zaehler', objektId: e.objekt_id }}>Alle Zähler →</L>}>
              {a.zaehler.length ? <ul className="liste">{a.zaehler.map((z: Row) => (
                <li key={z.id} className={z.ausbau ? 'vergangen' : ''}><span>{z.art} <span className="klein hinweis">{z.nummer}</span></span>
                  <span className="klein">{z.letzter_stand != null ? `${zahl(z.letzter_stand)} ${z.einheit ?? ''} am ${datum(z.letztes_datum)}` : 'noch kein Stand'}</span></li>
              ))}</ul> : <p className="hinweis klein">Keine Zähler in dieser Einheit.</p>}
            </Panel>
            <Panel titel="Schlüssel" aktion={<L zu={{ seite: 'schluesselv', objektId: e.objekt_id }}>Schlüsselverwaltung →</L>}>
              {a.schluessel.length ? <ul className="liste">{a.schluessel.map((k: Row, i: number) => (
                <li key={i} className={k.rueckgabe ? 'vergangen' : ''}><span>{k.anzahl}× {k.bezeichnung} {k.nummer}</span>
                  <span className="klein">bei <L zu={{ person: k.person_id }}>{k.name}</L>{k.rueckgabe ? `, zurück ${datum(k.rueckgabe)}` : ''}</span></li>
              ))}</ul> : <p className="hinweis klein">Keine ausgegebenen Schlüssel.</p>}
            </Panel>
            <Panel titel="Vorgänge" aktion={<L zu={{ seite: 'vorgaenge', objektId: e.objekt_id }}>Alle →</L>}>
              {a.vorgaenge.length ? <ul className="liste">{a.vorgaenge.map((v: Row) => (
                <li key={v.id} className={v.status === 'erledigt' ? 'vergangen' : ''}><L zu={{ vorgang: v.id, objektId: v.objekt_id }}>{v.titel}</L>
                  <span className="klein hinweis">{[v.status, v.faellig && `fällig ${datum(v.faellig)}`].filter(Boolean).join(' · ')}</span></li>
              ))}</ul> : <p className="hinweis klein">Keine Vorgänge.</p>}
            </Panel>
            {zeigeMiete && (
              <Panel titel="Übergaben" aktion={<L zu={{ seite: 'uebergabe', objektId: e.objekt_id }}>Übergaben →</L>}>
                {a.uebergaben.length ? <ul className="liste">{a.uebergaben.map((u: Row) => (
                  <li key={u.id}><span>{u.art === 'einzug' ? 'Einzug' : 'Auszug'} am {datum(u.datum)}</span>
                    {u.dokument_id ? <L zu={{ dokument: u.dokument_id }}>Protokoll</L> : <span className="klein hinweis">{u.abgeschlossen ? 'abgeschlossen' : 'offen'}</span>}</li>
                ))}</ul> : <p className="hinweis klein">Noch keine Übergaben.</p>}
              </Panel>
            )}
            {zeigeMiete && !mieter && !selbst && (
              <Panel titel="Vermietung" aktion={<L zu={{ seite: 'vermietung', objektId: e.objekt_id }}>Vermietung →</L>}>
                <p className="klein"><button className="link" onClick={selbstNeu}>Oder selbst nutzen …</button></p>
                <p className="klein">{a.angebot ? `Angebot: ${euro(a.angebot.kaltmiete_ct)} kalt${a.angebot.frei_ab ? `, frei ab ${datum(a.angebot.frei_ab)}` : ''}` : 'Noch kein Angebot.'}</p>
                <p className="klein hinweis">{a.interessenten.length} Interessent(en) im Gespräch.</p>
              </Panel>
            )}
          </div>
        </div>
      )}
      {tab === 'dokumente' && <Galerie filter={{ objekt_id: e.objekt_id, einheit_id: e.id }} hinweis={`${e.objekt}, ${e.bezeichnung}`} />}
      {tab === 'verlauf' && <Panel titel="Verlauf"><Zeitleiste eintraege={a.zeitleiste} /></Panel>}

      {edit && <FormDialog title="Einheit bearbeiten" row={e} fields={EINHEIT_FELDER}
        onSave={(r) => call('save', 'einheiten', { ...r, objekt_id: e.objekt_id })} onClose={() => { setEdit(false); reload(); }} />}
      {selbstEdit && <SelbstnutzungDialog einheitId={e.id} row={selbstEdit} onClose={() => { setSelbstEdit(null); reload(); }} />}
    </section>
  );
}

// ===================================================================================================
// Contract (tenancy or ownership)
// ===================================================================================================
export function VertragSeite(props: { typ: 'miete' | 'weg'; id: number }) {
  const navi = useNavi();
  const [a, reload] = useLoad<Row>(() => call('vertragAkte', props.typ, props.id), [props.typ, props.id]);
  const [zv] = useLoad<Row | null>(() => call('zahlungsverhalten', props.typ, props.id), [props.typ, props.id, a]);
  const [einheiten] = useLoad<Row[]>(() => (a ? call('einheiten', a.einheit.objekt_id) : Promise.resolve([])), [a?.einheit?.objekt_id]);
  const [personen] = useLoad<Row[]>(() => call('personen'), []);
  const [tab, setTab] = useState<'uebersicht' | 'konto' | 'dokumente'>('uebersicht');
  const [edit, setEdit] = useState(false);
  const [kuendigung, setKuendigung] = useState(false);
  const [raten, setRaten] = useState(false);
  useAktion('vertrag-kuendigung', () => setKuendigung(true));
  useAktion('vertrag-raten', () => setRaten(true));
  useEffect(() => { if (a?.einheit) navi.setzeObjekt(a.einheit.objekt_id); }, [a?.einheit?.objekt_id]);
  const weg = props.typ === 'weg';
  usePfad(a ? [{ label: a.einheit.objekt, ziel: { objekt: a.einheit.objekt_id } }, { label: a.einheit.bezeichnung, ziel: { einheit: a.einheit.id } },
    { label: `${weg ? 'Eigentum' : 'Mietverhältnis'} ${a.vertrag.name}` }] : null, [a]);
  if (!a) return null;
  const v = a.vertrag;
  const e = a.einheit;
  const op = a.op;
  const offen = op?.offen.filter((o: Row) => o.verzug >= 1) ?? [];
  const nochNicht = op?.offen.filter((o: Row) => o.verzug < 1) ?? [];
  const felder = weg ? [['hausgeld_ct', 'Hausgeld'], ['ruecklage_ct', 'davon Rücklage']]
    : [['kaltmiete_ct', v.bk_art === 'inklusiv' ? 'Kaltmiete inkl. BK' : 'Kaltmiete'], ...(v.bk_art === 'inklusiv' ? [] : [['bk_vz_ct', v.bk_art === 'pauschale' ? 'BK-Pauschale' : 'BK-VZ']]),
      ['hk_vz_ct', 'HK-VZ'], ['sonstiges_ct', 'Sonstiges']];
  const aktivePlaene = a.ratenplaene.filter((r: Row) => r.status === 'aktiv');

  return (
    <section className="detailseite">
      <DetailKopf
        bild={<div className="avatar eckig"><I.FileSignature size={26} /></div>}
        eyebrow={<>{weg ? 'Eigentum' : 'Mietverhältnis'} · Konto {v.konto_id ? <L zu={{ konto: v.konto_id }}>{v.konto_nr}</L> : '–'}</>}
        titel={<><L zu={{ person: v.person_id }}>{v.name}</L>{v.person2 && <> &amp; <L zu={{ person: v.person2.id }}>{v.person2.name}</L></>} · <L zu={{ einheit: e.id }}>{e.bezeichnung}</L></>}
        chips={<>
          <Chip>{v.ende ? `${datum(v.beginn)} – ${datum(v.ende)}` : `seit ${datum(v.beginn)}${weg ? '' : ', unbefristet'}`}</Chip>
          {!v.aktuell && !v.zukuenftig && <Chip>beendet</Chip>}
          {v.zukuenftig ? <Chip art="akzent">beginnt {datum(v.beginn)}</Chip> : null}
          <Chip>{v.lastschrift ? 'SEPA-Lastschrift' : 'Überweisung'}</Chip>
          {!weg && v.ust_satz > 0 && <Chip art="akzent">zzgl. {zahl(v.ust_satz)} % USt</Chip>}
          {weg && v.selbstnutzer ? <Chip art="weg">selbst genutzt</Chip> : null}
          <SaldoChip v={v} />
          {aktivePlaene.length > 0 && <Chip art="gelb">Ratenzahlung läuft</Chip>}
          {a.kuendigung?.kuendigung_zum && <Chip art="rot">gekündigt zum {datum(a.kuendigung.kuendigung_zum)}</Chip>}
        </>}
        aktionen={<>
          {v.konto_id && <button className="icon" onClick={() => { sessionStorage.setItem('buchungVorlage', JSON.stringify({ art: 'einnahme', gegen_id: v.konto_id, text: `Zahlung ${v.name}` })); aktionSetzen('neue-buchung'); navi.zu({ seite: 'buchen', objektId: e.objekt_id }); }}><I.BookOpen size={15} />Zahlung buchen</button>}
          {offen.length > 0 && <button className="icon" onClick={() => navi.zu({ seite: 'op', objektId: e.objekt_id, modus: weg ? 'weg' : 'miete' })}><I.BadgeEuro size={15} />Mahnen</button>}
          {offen.length > 0 && <button className="icon" onClick={() => setRaten(true)}><I.CalendarClock size={15} />Ratenzahlung</button>}
          {!weg && v.aktuell && !a.kuendigung?.kuendigung_zum ? <button className="icon" onClick={() => setKuendigung(true)}><I.LogOut size={15} />Kündigung</button> : null}
          {!weg && v.ust_satz > 0 && <button className="icon" onClick={async () => { try { await dauerrechnung(v, e); reload(); } catch (x) { fehler(x); } }}><I.ReceiptText size={15} />Dauerrechnung</button>}
          <button className="icon" onClick={async () => {
            const wahl = await window.hv.kontextmenue([...(!weg ? BESCHEINIGUNGEN.map((t) => ({ id: t, label: `${t} …` })) : []), ...(!weg ? ['-' as const] : []),
              { id: 'brief', label: 'Anderen Brief schreiben …' }]);
            if (wahl === 'brief') {
              sessionStorage.setItem('briefAn', JSON.stringify([`${weg ? 'e' : 'm'}${v.id}`]));
              navi.zu({ seite: 'briefe', objektId: e.objekt_id, modus: weg ? 'weg' : 'miete' });
            } else if (wahl) await musterbrief(wahl, props.typ, v);
          }}><I.Mail size={15} />Brief</button>
          <button className="icon" onClick={() => setEdit(true)}><I.Pencil size={15} />Bearbeiten</button>
        </>}
      />
      <Reiter value={tab} onChange={setTab} tabs={[['uebersicht', 'Übersicht'], ['konto', 'Kontoauszug', a.kontoauszug?.zeilen.length], ['dokumente', 'Dokumente', a.dokumente.length]]} />

      {tab === 'uebersicht' && zv && zv.faellig > 0 && (
        <div className="kz-raster"><Zahlungsverhalten z={zv} breite={4} /><Kalender z={zv} breite={8} /></div>
      )}
      {tab === 'uebersicht' && (
        <div className="raster2">
          <div className="spalte">
            <Panel titel={`Offene Monate · Stichtag ${datum(heute())}`} aktion={offen.length ? <L zu={{ seite: 'op', objektId: e.objekt_id, modus: weg ? 'weg' : 'miete' }}>Offene Posten →</L> : undefined}>
              {offen.length ? (
                <table className="kompakt">
                  <thead><tr><th>Fällig am</th><th>Forderung</th><th className="num">offen</th><th>Status</th><th className="num">Verzug</th></tr></thead>
                  <tbody>{offen.map((o: Row) => (
                    <tr key={o.id}><td>{datum(o.datum)}</td>
                      <td>{o.text}<div className="klein hinweis">{euro(o.soll_ct)}{o.bezahlt_ct ? `, davon bezahlt ${euro(o.bezahlt_ct)}` : ''}</div></td>
                      <td className="num"><b>{euro(o.offen_ct)}</b></td><td><Chip art={o.status === 'nicht bezahlt' ? 'rot' : 'gelb'}>{o.status === 'nicht bezahlt' ? 'nicht bezahlt' : 'teilweise'}</Chip></td><td className="num">{o.verzug} T.</td></tr>
                  ))}</tbody>
                  <tfoot><tr><td colSpan={2}>Rückstand{op.guthaben_ct > 0 ? ` (abzgl. Guthaben ${euro(op.guthaben_ct)})` : ''}</td><td className="num"><b>{euro(v.ueberfaellig_ct)}</b></td><td colSpan={2} /></tr></tfoot>
                </table>
              ) : <p className="hinweis klein">{v.zukuenftig ? `Der Vertrag beginnt am ${datum(v.beginn)} – bis dahin ist nichts fällig.` : 'Nichts überfällig.'}
                {op?.guthaben_ct > 0 ? ` Guthaben ${euro(op.guthaben_ct)} – es wird mit der nächsten Forderung verrechnet.` : ''}</p>}
              {nochNicht.length > 0 && <p className="klein hinweis">Heute fällig (noch kein Verzug): {nochNicht.map((o: Row) => `${o.text} ${euro(o.offen_ct)}`).join(', ')}.</p>}
              {a.soll_abweichend > 0 && <p className="klein fehlertext">Die gebuchten Forderungen von {a.soll_abweichend === 1 ? 'einem Monat' : `${a.soll_abweichend} Monaten`} passen nicht zum Vertrag.{' '}
                <button className="link" onClick={() => sollNachfrage(props.typ, v.id).then(reload)}>Forderungen prüfen</button></p>}
              {a.naechste && <p className="klein hinweis">Nächste Fälligkeit: <b>{datum(a.naechste.datum)}</b> · {euro(a.naechste.betrag_ct)}
                {op?.guthaben_ct > 0 ? ` (davon durch Guthaben gedeckt: ${euro(Math.min(op.guthaben_ct, a.naechste.betrag_ct))})` : ''}</p>}
              {a.ratenplaene.length > 0 && <RatenplanListe plaene={a.ratenplaene} onAenderung={reload} />}
            </Panel>
            <Panel titel="Beträge im Zeitverlauf" aktion={!weg ? <L zu={{ seite: 'anpassung', objektId: e.objekt_id }}>Mietanpassung →</L> : <L zu={{ seite: 'wipl', objektId: e.objekt_id, modus: 'weg' }}>Wirtschaftsplan →</L>}>
              <table className="kompakt">
                <thead><tr><th>Gültig ab</th>{felder.map(([k, l]) => <th key={k} className="num">{l}</th>)}<th>Grund</th></tr></thead>
                <tbody>{a.verlauf.map((x: Row, i: number) => (
                  <tr key={i}><td>{datum(x.gueltig_ab)}</td>{felder.map(([k]) => <td key={k} className="num">{euro(x[k])}</td>)}<td className="klein">{GRUND[x.grund] ?? x.grund}</td></tr>
                ))}</tbody>
              </table>
              <p className="klein hinweis">
                {weg ? `Hausgeld heute ${euro(v.monatlich_ct)}, fällig ${faelligText(v.faelligkeitstag)}.`
                  : `Heute zu zahlen: ${euro(v.monatlich_ct)}${v.ust_ct ? ` (inkl. ${euro(v.ust_ct)} USt)` : ''}, fällig ${faelligText(v.faelligkeitstag)}.`}
                {' '}{mietmonatText(v, weg ? 'weg' : 'miete', a.mietmonat?.erste)}
              </p>
              {a.mietmonat?.doppelt && <p className="klein fehlertext">{datum(a.mietmonat.doppelt.von)} bis {datum(a.mietmonat.doppelt.bis)} wird doppelt gefordert – auch {a.mietmonat.doppelt.name} zahlt diesen Monat voll
                (Auszug {datum(a.mietmonat.doppelt.ende)}). Unter „Bearbeiten“ „erst ab dem Folgemonat“ wählen, wenn das nicht vereinbart ist.</p>}
            </Panel>
            {a.abrechnungen.length > 0 && (
              <Panel titel={weg ? 'Jahresabrechnungen' : 'Betriebskostenabrechnungen'}>
                <ul className="liste">{a.abrechnungen.map((x: Row) => (
                  <li key={x.id}><L zu={{ seite: weg ? 'wegabr' : 'nk', objektId: e.objekt_id, modus: weg ? 'weg' : 'miete' }}>{x.titel ?? `${datum(x.von)} – ${datum(x.bis)}`}</L>
                    <span className={x.ergebnis_ct > 0 ? 'negativ' : ''}>{x.ergebnis_ct > 0 ? `Nachzahlung ${euro(x.ergebnis_ct)}` : x.ergebnis_ct < 0 ? `Guthaben ${euro(-x.ergebnis_ct)}` : 'ausgeglichen'}</span></li>
                ))}</ul>
              </Panel>
            )}
          </div>
          <div className="spalte">
            <Panel titel="Beteiligt">
              <div className="fakten einspaltig">
                <Fakt l={weg ? 'Eigentümer' : 'Mieter'}><L zu={{ person: v.person_id }}>{v.name}</L>{v.person2 && <> und <L zu={{ person: v.person2.id }}>{v.person2.name}</L></>}</Fakt>
                <Fakt l="Kontakt">{[v.telefon || v.mobil, v.email].filter(Boolean).join(' · ')}</Fakt>
                <Fakt l="Einheit"><L zu={{ einheit: e.id }}>{e.bezeichnung}</L> · <L zu={{ objekt: e.objekt_id }}>{e.objekt}</L></Fakt>
                {!weg && a.eigentuemer && <Fakt l="Eigentum"><L zu={{ person: a.eigentuemer.id }}>{a.eigentuemer.name}</L></Fakt>}
                {!weg && <Fakt l="Personen im Haushalt">{zahl(v.personen_anzahl)}</Fakt>}
                {v.lastschrift ? <Fakt l="Mandat">{v.sepa_mandat || <span className="negativ">Mandatsreferenz fehlt</span>}</Fakt> : null}
              </div>
            </Panel>
            {!weg && (
              <Panel titel="Kaution" aktion={<L zu={{ seite: 'kaution', objektId: e.objekt_id }}>Kautionen →</L>}>
                {v.kaution_ct > 0 ? (
                  <RingZeile ring={<Ring wert={Math.min(100, (a.kaution?.bestand_ct ?? 0) / v.kaution_ct * 100)} zonen={ZONEN_KAUTION}
                    text={prozent(Math.floor(Math.min(100, (a.kaution?.bestand_ct ?? 0) / v.kaution_ct * 100)))} />}
                    wert={<>{euro0(a.kaution?.bestand_ct ?? 0)}<small>von {euro0(v.kaution_ct)} erfasst</small></>}>
                    {a.kaution?.bank && <div className="kz-text">Angelegt bei {a.kaution.bank}</div>}
                  </RingZeile>
                ) : <p className="hinweis klein">Keine Kaution vereinbart.</p>}
              </Panel>
            )}
            {a.kuendigung && (a.kuendigung.kuendigung_eingang || a.kuendigung.kuendigung_zum) && (
              <Panel titel="Kündigung" aktion={<L zu={{ seite: 'uebergabe', objektId: e.objekt_id }}>Mieterwechsel →</L>}>
                <div className="fakten einspaltig">
                  <Fakt l="Durch">{a.kuendigung.kuendigung_durch === 'vermieter' ? 'Vermieter' : a.kuendigung.kuendigung_durch === 'aufhebung' ? 'Aufhebungsvertrag' : 'Mieter'}</Fakt>
                  <Fakt l="Eingegangen am">{datum(a.kuendigung.kuendigung_eingang)}</Fakt>
                  <Fakt l="Zum">{datum(a.kuendigung.kuendigung_zum)}</Fakt>
                  {a.kuendigung.dokument_id && <Fakt l="Schreiben"><L zu={{ dokument: a.kuendigung.dokument_id }}>Bestätigung öffnen</L></Fakt>}
                </div>
              </Panel>
            )}
            {a.mahnungen.length > 0 && (
              <Panel titel="Mahnungen">
                <ul className="liste">{a.mahnungen.map((m: Row) => (
                  <li key={m.id}><span>{['Zahlungserinnerung', '1. Mahnung', '2. Mahnung', 'Letzte Mahnung'][Math.min(m.stufe, 3)]} am {datum(m.datum)}</span>
                    <span className="klein">{euro(m.offen_ct)}{m.gebuehr_ct ? ` + ${euro(m.gebuehr_ct)} Gebühr` : ''}</span></li>
                ))}</ul>
              </Panel>
            )}
            {a.uebergaben.length > 0 && (
              <Panel titel="Übergaben">
                <ul className="liste">{a.uebergaben.map((u: Row) => (
                  <li key={u.id}><span>{u.art === 'einzug' ? 'Einzug' : 'Auszug'} am {datum(u.datum)}</span>
                    {u.dokument_id ? <L zu={{ dokument: u.dokument_id }}>Protokoll</L> : <span className="klein hinweis">offen</span>}</li>
                ))}</ul>
              </Panel>
            )}
          </div>
        </div>
      )}
      {tab === 'konto' && (v.konto_id ? <KontoauszugTabelle kontoId={v.konto_id} /> : <Leer text="Zu diesem Vertrag gibt es noch kein Konto." />)}
      {tab === 'dokumente' && <Panel titel="Dokumente"><DokListe doks={a.dokumente} />
        <div className="buttons"><button className="icon" onClick={() => ablegen({ person_id: v.person_id, objekt_id: e.objekt_id, einheit_id: e.id })}><I.FilePlus2 size={15} />Dokument ablegen</button></div></Panel>}

      {edit && einheiten && personen && (
        <FormDialog title={weg ? 'Eigentum bearbeiten' : 'Mietverhältnis bearbeiten'} row={v} fields={(f) => vertragFelder(weg ? 'weg' : 'miete', einheiten, personen, f)}
          extra={(f, setze) => <MietbeginnHinweis f={f} modus={weg ? 'weg' : 'miete'} setze={setze} />}
          onSave={async (r) => {
            const id = await call('save', weg ? 'eigentum' : 'mietverhaeltnisse', r);
            setTimeout(() => sollNachfrage(props.typ, id, { fruehereMonate: r.beginn !== v.beginn }).then(reload), 0);
            return id;
          }} onClose={() => { setEdit(false); reload(); }} />
      )}
      {kuendigung && <Kuendigung vertrag={v} einheit={e} onClose={() => { setKuendigung(false); reload(); }} />}
      {raten && v.konto_id && <Ratenplan vertrag={v} einheit={e} kontoId={v.konto_id} rueckstand={v.ueberfaellig_ct} onClose={() => { setRaten(false); reload(); }} />}
    </section>
  );
}

const monatName = (monat: string) => new Date(Date.UTC(Number(monat.slice(0, 4)), Number(monat.slice(5, 7)) - 1, 1))
  .toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const BK_TEXT: Record<string, string> = { vorauszahlung: 'Vorauszahlung', pauschale: 'Pauschale (keine Abrechnung)', inklusiv: 'in der Kaltmiete enthalten' };

// How a contract is charged, in one sentence for its page: rent month, month of moving in, operating costs.
export function mietmonatText(v: Row, typ: 'miete' | 'weg', erste?: Row | null) {
  const mitte = !String(v.beginn ?? '').endsWith('-01');
  const tag = Number(String(v.beginn ?? '').slice(8, 10));
  if (typ === 'weg') return `Hausgeld immer für volle Monate${mitte && v.teilmonat_beginn === 'folgemonat' ? ', erster Monat erst ab dem Folgemonat' : ''}.`;
  const mietmonat = v.mietmonat_ab === 'einzug' && tag > 1 ? `Mietmonat vom ${tag}. bis zum ${tag - 1}. des Folgemonats` : 'Mietmonat = Kalendermonat';
  const einzug = mitte && v.mietmonat_ab !== 'einzug' ? (v.teilmonat_beginn === 'folgemonat' ? ', Einzugsmonat erst ab dem Folgemonat' : ', Ein- und Auszugsmonat voll') : ', Auszugsmonat voll';
  const bk = `Betriebskosten: ${BK_TEXT[v.bk_art] ?? BK_TEXT.vorauszahlung}${v.bk_art === 'vorauszahlung' || !v.bk_art
    ? `, abgerechnet ${v.bk_abrechnung === 'wohntage' ? 'nach Wohntagen' : `nach Mietmonaten${erste ? ` (ab ${datum(erste.von)})` : ''}`}` : ''}.`;
  return `${mietmonat}${einzug}. ${bk}`;
}

// Live note in the contract form: what the first payment is and when it is due (rent is a monthly amount, never a
// share by day), from when operating costs are settled, and whether the previous contract pays the same month.
export function MietbeginnHinweis(props: { f: Row; modus: 'miete' | 'weg'; setze?: (werte: Row) => void }) {
  const f = props.f;
  const gueltig = /^\d{4}-\d{2}-\d{2}$/.test(f.beginn ?? '');
  const eingabe = { id: f.id ?? null, einheit_id: f.einheit_id || null, beginn: f.beginn, ende: /^\d{4}-\d{2}-\d{2}$/.test(f.ende ?? '') ? f.ende : null,
    mietmonat_ab: f.mietmonat_ab || 'erster', teilmonat_beginn: f.teilmonat_beginn || 'voll', faelligkeitstag: f.faelligkeitstag === '' || f.faelligkeitstag == null ? 0 : Number(f.faelligkeitstag) };
  const [info] = useLoad<Row | null>(() => (gueltig ? call('mietbeginnInfo', props.modus, eingabe) : Promise.resolve(null)), [props.modus, JSON.stringify(eingabe)]);
  if (!gueltig || !info?.erste) return null;
  const ct = (k: string) => Math.round((Number(String(f[k] ?? '').replace(/\./g, '').replace(',', '.')) || 0) * 100);
  const monat = props.modus === 'weg' ? ct('hausgeld_ct') : ct('kaltmiete_ct') + (f.bk_art === 'inklusiv' ? 0 : ct('bk_vz_ct')) + ct('hk_vz_ct') + ct('sonstiges_ct');
  const e = info.erste, d = info.doppelt;
  const mitte = !f.beginn.endsWith('-01');
  const zeitraum = e.anker > 1 ? `${datum(e.von)} – ${datum(e.bis)}` : monatName(e.monat);
  const naechster = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 7);
  return (
    <div className="hinweisbox">
      <p>Erste {props.modus === 'weg' ? 'Hausgeldzahlung' : 'Miete'}: <b>{euro(monat)}</b> für {zeitraum}, fällig am {datum(e.datum)}.
        {mitte && e.anker === 1 && e.monat === f.beginn.slice(0, 7) ? ` ${props.modus === 'weg' ? 'Das Hausgeld' : 'Die Miete'} ist ein Monatsbetrag: auch bei Beginn am ${datum(f.beginn)} wird der volle Monat gefordert.` : ''}
        {mitte && e.monat !== f.beginn.slice(0, 7) ? ` Für ${monatName(f.beginn.slice(0, 7))} wird nichts gefordert.` : ''}</p>
      {props.modus === 'miete' && f.bk_art !== 'pauschale' && f.bk_art !== 'inklusiv' && (
        <p>Betriebskosten werden ab {datum(f.bk_abrechnung === 'wohntage' ? f.beginn : e.von)} abgerechnet{f.bk_abrechnung === 'wohntage' ? ' (nach Wohntagen)' : ' (nach Mietmonaten)'}.</p>
      )}
      {props.modus === 'miete' && (f.bk_art === 'pauschale' || f.bk_art === 'inklusiv') && (
        <p>Keine Betriebskostenabrechnung für diesen Vertrag – abgerechnet werden nur Heizung und Warmwasser (Heizkostenverordnung).</p>
      )}
      {d && (
        <p className="fehlertext">{d.name} zieht am {datum(d.ende)} aus und zahlt {d.von.slice(0, 7) === d.bis.slice(0, 7) && d.von.endsWith('-01') ? monatName(d.monat) : `bis ${datum(d.bis)}`} voll –
          {' '}{datum(d.von)} bis {datum(d.bis)} würde doppelt gefordert.{' '}
          {d.folgemonat && props.setze && <button type="button" className="link" onClick={() => props.setze!({ teilmonat_beginn: 'folgemonat' })}>Erst ab {monatName(naechster(f.beginn.slice(0, 7)))} fordern</button>}</p>
      )}
    </div>
  );
}

// ===================================================================================================
// Account
// ===================================================================================================
export function KontoSeite(props: { id: number }) {
  const navi = useNavi();
  const [von, setVon] = useState(`${diesesJahr()}-01-01`);
  const [bis, setBis] = useState(`${diesesJahr()}-12-31`);
  const [a] = useLoad<Row>(() => call('kontoAkte', props.id, von, bis), [props.id, von, bis]);
  useEffect(() => { if (a?.konto) navi.setzeObjekt(a.konto.objekt_id); }, [a?.konto?.objekt_id]);
  usePfad(a ? [{ label: a.konto.objekt, ziel: { objekt: a.konto.objekt_id } }, { label: 'Konten', ziel: { seite: 'konten', objektId: a.konto.objekt_id } },
    { label: `${a.konto.nr} ${a.konto.bezeichnung}` }] : null, [a]);
  if (!a) return null;
  const k = a.konto;
  return (
    <section className="detailseite">
      <DetailKopf
        bild={<div className="avatar eckig"><I.Landmark size={26} /></div>}
        eyebrow={<>Konto {k.nr} · <L zu={{ objekt: k.objekt_id }}>{k.objekt}</L></>}
        titel={k.bezeichnung}
        chips={<>
          <Chip>Saldo <Saldo ct={a.auszug.ende_ct} /></Chip>
          {a.vertrag && <Chip art={k.vertrag_typ === 'weg' ? 'weg' : 'miete'}><L zu={{ vertrag: a.vertrag.id, typ: k.vertrag_typ }}>{k.vertrag_typ === 'weg' ? 'Eigentum' : 'Mietverhältnis'}</L> · <L zu={{ person: a.vertrag.person_id }}>{a.vertrag.name}</L></Chip>}
          {k.umlagefaehig ? <Chip art="miete">umlagefähig</Chip> : null}
          {k.inaktiv ? <Chip>inaktiv</Chip> : null}
        </>}
      />
      <div className="toolbar"><Zeitraum von={von} bis={bis} onChange={(x, y) => { setVon(x); setBis(y); }} /><span className="spacer" />
        <button className="icon" onClick={() => kontoauszugPdf(k, k.objekt, von, bis)}><I.FileDown size={15} />Als PDF</button></div>
      <KontoauszugTabelle kontoId={k.id} von={von} bis={bis} />
    </section>
  );
}

// Statement table with links to the counter account and the receipt.
export function KontoauszugTabelle(props: { kontoId: number; von?: string; bis?: string }) {
  const von = props.von ?? `${diesesJahr() - 1}-01-01`;
  const bis = props.bis ?? '9999-12-31';
  const [a] = useLoad<Row>(() => call('kontoauszug', props.kontoId, von, bis), [props.kontoId, von, bis]);
  if (!a) return null;
  return (
    <table>
      <thead><tr><th>Datum</th><th>Beleg</th><th>Text</th><th>Gegenkonto</th><th className="num">Soll</th><th className="num">Haben</th><th className="num">Saldo</th></tr></thead>
      <tbody>
        <tr className="zwischen"><td colSpan={6}>Anfangssaldo {datum(von)}</td><td className="num"><Saldo ct={a.anfang_ct} /></td></tr>
        {a.zeilen.map((r: Row) => (
          <tr key={r.id}>
            <td>{datum(r.datum)}</td>
            <td>{r.dok_id ? <L zu={{ dokument: r.dok_id, datei: r.dok_datei }}>{r.beleg || 'Beleg'}</L> : r.beleg}</td>
            <td>{r.text}</td>
            <td className="klein"><L zu={{ konto: r.gegen_id }}>{r.gegen}</L></td>
            <td className="num">{r.soll_ct ? betrag(r.soll_ct) : ''}</td>
            <td className="num">{r.haben_ct ? betrag(r.haben_ct) : ''}</td>
            <td className="num"><Saldo ct={r.saldo_ct} /></td>
          </tr>
        ))}
        {!a.zeilen.length && <tr><td colSpan={7} className="hinweis">Keine Buchungen im Zeitraum.</td></tr>}
      </tbody>
      <tfoot><tr><td colSpan={6}>Endsaldo</td><td className="num"><Saldo ct={a.ende_ct} fett /></td></tr></tfoot>
    </table>
  );
}

export { fehler };
