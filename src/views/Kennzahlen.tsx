// Key figure tiles: cockpit (K1–K9), tenant profile (M1–M7), unit (E1–E4, M5), self-use (N1, N4) and the house view (E5).
import { useState, type ReactNode } from 'react';
import * as I from 'lucide-react';
import { call, datum, euro, heute, zahl, type Modus, type Row } from '../api';
import { useLoad } from '../useLoad';
import { L, useNavi } from '../navi';
import { FormDialog, type Field } from '../Form';
import {
  Balken, euro0, Kennzahl, KzListe, MiniRing, monatName, prozent, qm, Ring, Ringdiagramm, RingZeile, Skala, Sparkline, Stapel, Vorschau, Weiter,
  Zahlungskalender, Zeitstrahl, ZONEN_KAUTION, ZONEN_QUOTE, ZONEN_SCORE, type Zonen,
} from '../zeiger';

const nachname = (name: string | null | undefined) => (name ?? '').split(',')[0].trim();
const MONAT_LANG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const ZONEN_BELEGUNG: Zonen = [[89.999, 'rot'], [96.999, 'gelb'], [100, 'gruen']];
const ALTER_FARBEN = ['var(--gelb)', 'var(--k2)', 'var(--rot)', 'var(--c1)'];
const wenig = (x: number) => x.toLocaleString('de-DE', { maximumFractionDigits: x < 10 ? 2 : x < 100 ? 1 : 0 });
const aenderung = (x: number | null | undefined, gut: boolean) => x == null ? null
  : <span className={gut ? 'plus' : 'minus'}>{x >= 0 ? '▲' : '▼'} {prozent(Math.abs(x), Math.abs(x) < 10 ? 1 : 0)}</span>;

// ===================================================================================================
// Cockpit
// ===================================================================================================
export function CockpitKpis(props: { c: Row; weg: boolean }) {
  const { eingang: e, vermietung: v, rueckstaende: r, vergleich: j } = props.c;
  const monat = MONAT_LANG[Number(e.monat.slice(5, 7)) - 1];
  return (
    <div className="kz-raster">
      <Kennzahl titel={`${props.weg ? 'Hausgeld' : 'Mieteingang'} ${monat}`} breite={props.weg ? 4 : 3} fuss={<Weiter zu={{ seite: 'op' }}>Offene Posten</Weiter>}>
        {e.soll_ct > 0 ? (
          <RingZeile ring={<Ring wert={e.quote * 100} zonen={ZONEN_QUOTE} text={prozent(Math.floor(e.quote * 100))} titel={`${prozent(e.quote * 100, 1)} des Solls bezahlt`} />}
            wert={<>{euro0(e.ist_ct)}<small>von {euro0(e.soll_ct)}</small></>}>
            <div className="kz-text">{e.offen.length ? <>noch offen: {e.offen.slice(0, 4).map((x: Row, i: number) => (
              <span key={x.vertrag_id}>{i ? ', ' : ''}<L zu={{ vertrag: x.vertrag_id, typ: x.typ }} title={`${x.name} (${x.einheit}): ${euro(x.offen_ct)}, fällig ${datum(x.faellig)}`}>{nachname(x.name)}</L>{x.ueberfaellig ? '' : ' (noch nicht fällig)'}</span>
            ))}{e.offen.length > 4 ? ` und ${e.offen.length - 4} weitere` : ''}</> : 'alles bezahlt'}</div>
          </RingZeile>
        ) : <p className="kz-text">Für {monat} ist noch nichts gefordert.</p>}
      </Kennzahl>
      {v && (
        <Kennzahl titel="Vermietet (12 Monate)" breite={3} fuss={<Weiter zu={{ seite: 'vermietung' }}>Vermietung</Weiter>}>
          <RingZeile ring={<Ring wert={v.quote == null ? null : v.quote * 100} zonen={ZONEN_BELEGUNG} text={v.quote == null ? '–' : prozent(Math.floor(v.quote * 1000) / 10, v.quote < 1 ? 1 : 0)}
            titel="Vermietete Fläche über die letzten 12 Monate, tagegenau; selbst genutzte Flächen zählen nicht mit" />}
            wert={<>{v.vermietet}<small>von {v.einheiten} vermietet</small></>}>
            <div className="kz-text">{[v.selbst ? `${v.selbst} selbst genutzt` : '', v.leer ? `${v.leer} leer` : 'keine leer'].filter(Boolean).join(' · ')}</div>
          </RingZeile>
          <div className="kz-text">{v.leerstand_ct > 0
            ? <>Leerstand kostete <b>{euro0(v.leerstand_ct)}</b> Kaltmiete ({v.luecken.slice(0, 2).map((l: Row) => `${l.einheit}, ${l.tage} Tage`).join('; ')}).</>
            : 'Kein Leerstand in den letzten 12 Monaten.'}{v.selbst ? ' Selbst genutzt zählt nicht als Leerstand.' : ''}</div>
        </Kennzahl>
      )}
      <Kennzahl titel="Rückstände nach Alter" breite={props.weg ? 4 : 3} fuss={r.summe_ct > 0 ? <Weiter zu={{ seite: 'op' }}>Offene Posten</Weiter> : undefined}>
        <div className="kz-wert">{euro0(r.summe_ct)}{r.konten.length ? <small>{r.konten.length} {r.konten.length === 1 ? 'Konto' : 'Konten'}</small> : null}</div>
        {r.summe_ct > 0 ? <Stapel teile={r.stufen.map((s: Row, i: number) => ({ label: s.label, ct: s.ct, farbe: ALTER_FARBEN[i] }))} />
          : <p className="kz-text">Keine Rückstände – alle fälligen Forderungen sind bezahlt.</p>}
        {r.p543.map((p: Row) => (
          <div key={p.vertrag_id} className="kz-text" title="Zahlungsverzug mit zwei Monatsmieten (oder zwei Terminen in Folge mit mehr als einer Monatsmiete): Grund für eine fristlose Kündigung nach § 543 Abs. 2 Nr. 3 BGB – vorher rechtlich prüfen.">
            <span className="chip rot">§ 543</span> <L zu={{ vertrag: p.vertrag_id, typ: 'miete' }}>{nachname(p.name)}</L>: {zahl(Math.round(p.monatsmieten * 10) / 10)} Monatsmieten offen
          </div>
        ))}
      </Kennzahl>
      <Kennzahl titel={`Jan–${MONAT_LANG[Number(j.bis.slice(5, 7)) - 1].slice(0, 3)} gegen Vorjahr`} breite={props.weg ? 4 : 3}>
        <KzListe zeilen={j.zeilen.map((x: Row, i: number) => [x.label, <>{euro0(x.ct)} {aenderung(x.aenderung, x.gut)}</>, i === 2 ? 'summe' : undefined])} />
        <div className="kz-text">bis {datum(j.bis)}, nach Zahlungseingang und Buchungsdatum</div>
      </Kennzahl>
    </div>
  );
}

export function CockpitVorschau(props: { c: Row }) {
  const v = props.c.vorschau;
  const f = props.c.fristen;
  return (
    <div className="kz-raster">
      <Kennzahl titel="Kontostand – Vorschau 90 Tage" breite={7}>
        <div className="kz-zeile">
          <span className="kz-wert">{euro0(v.start_ct)}<small>heute</small></span>
          <span className="kz-text">tiefster Stand <b className={v.tief.ct < 0 ? 'negativ' : ''}>{euro0(v.tief.ct)}</b> am {datum(v.tief.datum)}{v.tief.gruende.length ? ` (${v.tief.gruende.join(', ')})` : ''}</span>
        </div>
        <Vorschau punkte={v.punkte} tief={v.tief} />
        <details className="kz-details">
          <summary className="kz-text">Erwartet: {euro0(v.ein_ct)} Eingänge (nach bisherigem Zahlungsverhalten), {euro0(v.aus_ct)} Ausgänge (Darlehen, Versicherungen, wiederkehrende Kosten wie im Vorjahr)</summary>
          <KzListe zeilen={v.ereignisse.map((x: Row) => [<><span className="datumchip">{datum(x.datum).slice(0, 6)}</span>{x.text}</>, <span className={x.ct < 0 ? 'minus' : 'plus'}>{x.ct < 0 ? '−' : '+'}{euro0(Math.abs(x.ct))}</span>])} />
        </details>
      </Kennzahl>
      <Kennzahl titel="Fristen in den nächsten 90 Tagen" breite={5}>
        {f.length ? (
          <ul className="kz-liste">{f.map((x: Row, i: number) => (
            <li key={i}><span><span className="datumchip">{datum(x.datum).slice(0, 6)}</span>{x.ziel ? <L zu={x.ziel}>{x.text}</L> : x.text}</span>
              {x.wichtig ? <span className="chip rot">wichtig</span> : <span className="chip">in {x.tage} T.</span>}</li>
          ))}</ul>
        ) : <p className="kz-text">Keine Fristen in den nächsten 90 Tagen.</p>}
      </Kennzahl>
    </div>
  );
}

export function CockpitRadar(props: { c: Row; children?: ReactNode }) {
  const navi = useNavi();
  const r = props.c.radar;
  const k = props.c.kosten;
  const teile = k.gruppen.length > 6 ? [...k.gruppen.slice(0, 5), { label: 'Übrige', ct: k.gruppen.slice(5).reduce((s: number, g: Row) => s + g.ct, 0) }] : k.gruppen;
  const vorbereiten = (x: Row) => {
    sessionStorage.setItem('anpassungVorlage', JSON.stringify({ vertrag_id: x.vertrag_id, gueltig_ab: x.ab, grund: x.art === '558' ? 'erhoehung' : 'index', kaltmiete_ct: x.neu_ct, notiz: x.notiz ?? null }));
    navi.zu({ seite: 'anpassung', objektId: x.objekt_id });
  };
  return (
    <div className="kz-raster">
      {r ? (
        <Kennzahl titel="Mieterhöhungs-Radar" breite={7} fuss={<Weiter zu={{ seite: 'anpassung' }}>Mietanpassungen</Weiter>}>
          <div className="kz-zeile"><span className="kz-wert">+{euro0(r.summe_ct)}<small>pro Monat möglich</small></span>
            {r.eintraege.length > 0 && <span className="chip akzent">{r.eintraege.length} {r.eintraege.length === 1 ? 'Mietverhältnis' : 'Mietverhältnisse'}</span>}</div>
          {r.eintraege.length > 0 && <ul className="kz-liste">{r.eintraege.map((x: Row) => (
            <li key={x.vertrag_id + x.art}>
              <span><L zu={{ einheit: x.einheit_id }}>{x.einheit}</L> <L zu={{ vertrag: x.vertrag_id, typ: 'miete' }}>{nachname(x.name)}</L> · {x.text}, ab {datum(x.ab)}</span>
              <span className="kz-aktion"><b className="plus">+{euro(x.plus_ct)}</b>
                {x.automatisch ? <span className="chip">automatisch</span> : <button className="klein" title="Mietanpassung mit diesen Werten anlegen – danach den geprüften Brief schreiben" onClick={() => vorbereiten(x)}>Vorbereiten</button>}</span>
            </li>
          ))}</ul>}
          <div className="kz-text">{r.ohne_vergleich > 0 ? `Für ${r.ohne_vergleich === 1 ? 'ein Mietverhältnis' : `${r.ohne_vergleich} Mietverhältnisse`} fehlt die ortsübliche Vergleichsmiete – beim Objekt oder der Einheit eintragen.`
            : 'Mit Sperrfristen, Kappungsgrenze und Zugang in drei Tagen gerechnet; der Brief wird vor dem Versand geprüft.'}</div>
        </Kennzahl>
      ) : props.children}
      <Kennzahl titel={`Kosten ${k.jahr} nach Art`} breite={5}>
        <div className="kz-wert">{euro0(k.summe_ct)}<small>bis {datum(k.bis)}</small></div>
        <Ringdiagramm teile={teile} />
        {k.summe_ct > 0 && <div className="kz-text">Umlagefähig {prozent((k.umlagefaehig_anteil ?? 0) * 100)}{k.nicht_umlagefaehig_qm_ct != null ? ` · nicht umlagefähig ${qm(k.nicht_umlagefaehig_qm_ct)} bisher` : ''}</div>}
      </Kennzahl>
      {r && props.children}
    </div>
  );
}

// ===================================================================================================
// House view (E5)
// ===================================================================================================
const STATUS_TEXT: Record<string, string> = { vermietet: 'vermietet', rueckstand: 'Rückstand', gekuendigt: 'gekündigt', selbst: 'selbst genutzt', leer: 'frei' };
export function Hausansicht(props: { etagen: Row[]; mini?: boolean; weg?: boolean }) {
  const navi = useNavi();
  if (!props.etagen?.length) return null;
  return (
    <div className={`haus${props.mini ? ' mini' : ''}`} aria-label="Einheiten nach Stockwerk">
      {props.etagen.map((s) => (
        <div key={s.name} className="etage">
          <span className="etage-name">{s.name}</span>
          <div className="einheiten">
            {s.einheiten.map((e: Row) => (
              <button key={e.id} type="button" className={`we st-${e.status}`} data-ziel={`einheit:${e.id}`}
                title={`${e.bezeichnung}: ${STATUS_TEXT[e.status] ?? ''}${e.text && e.status !== 'selbst' && e.status !== 'leer' ? ` · ${e.text}` : ''}${e.betrag_ct ? ` · ${euro(e.betrag_ct)}` : ''}`}
                onClick={(ev) => { ev.stopPropagation(); navi.zu({ einheit: e.id }); }}>
                <b>{e.bezeichnung}</b>
                {!props.mini && <span>{e.status === 'rueckstand' ? `${nachname(e.text)} · ${euro0(e.betrag_ct)}` : e.status === 'vermietet' || e.status === 'gekuendigt' ? e.text.replace(/^([^,]+),[^·]*/, '$1') : e.text}</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
      {!props.mini && (
        <div className="legende klein">
          <span><i style={{ background: 'var(--c1-hell)' }} />{props.weg ? 'Eigentum' : 'vermietet'}</span><span><i style={{ background: 'var(--rot)' }} />Rückstand</span>
          {!props.weg && <span><i style={{ background: 'var(--gelb)' }} />gekündigt</span>}{!props.weg && <span><i style={{ background: 'var(--weg-ton)' }} />selbst genutzt</span>}
          <span><i style={{ border: '1px dashed var(--line-stark)', background: 'transparent' }} />{props.weg ? 'ohne Eigentümer' : 'frei'}</span>
        </div>
      )}
    </div>
  );
}

// ===================================================================================================
// Tenant profile (M1–M7)
// ===================================================================================================
export function Zahlungsverhalten(props: { z: Row | null; breite?: number }) {
  const z = props.z;
  if (!z) return null;
  const formel = 'Jeder fällige Monat zählt: pünktlich 100 Punkte, verspätet 4 Punkte weniger je Tag (ab 25 Tagen 0), offen 0. '
    + 'Vom Durchschnitt gehen je noch offenem Monat 15 Punkte ab, je Mahnung und je Rücklastschrift 10 Punkte. Zeitraum: die letzten 24 Monate.';
  return (
    <Kennzahl titel="Zahlungsverhalten" breite={props.breite ?? 3}>
      <RingZeile ring={<Ring wert={z.score} zonen={ZONEN_SCORE} titel={formel} />} wert={z.label}>
        <div className="kz-text">{z.faellig ? `${z.puenktlich} von ${z.faellig} Monaten pünktlich` : 'noch kein Monat fällig'}</div>
      </RingZeile>
      <div className="kz-text">{z.verspaetet ? `${z.verspaetet}× verspätet (Ø ${zahl(z.schnitt_tage)} Tage)` : 'nie verspätet'} · {z.offen ? `${z.offen} offen` : 'nichts offen'} · {z.mahnungen} Mahnungen · {z.ruecklastschriften} Rücklastschriften</div>
      <details className="kz-details"><summary className="kz-text">Wie wird gerechnet?</summary><p className="kz-text">{formel}</p></details>
    </Kennzahl>
  );
}

export function Kalender(props: { z: Row | null; breite?: number }) {
  if (!props.z) return null;
  return <Kennzahl titel={`Zahlungskalender (${props.z.monate.length} Monate)`} breite={props.breite ?? 6}><Zahlungskalender monate={props.z.monate} /></Kennzahl>;
}

export function KautionKz(props: { k: Row; breite?: number }) {
  const k = props.k;
  return (
    <Kennzahl titel="Kaution" breite={props.breite ?? 3} fuss={<Weiter zu={{ seite: 'kaution' }}>Kautionen</Weiter>}>
      {k.vereinbart_ct > 0 ? (
        <RingZeile ring={<Ring wert={(k.quote ?? 0) * 100} zonen={ZONEN_KAUTION} text={prozent(Math.floor((k.quote ?? 0) * 100))} />}
          wert={<>{euro0(k.bestand_ct)}<small>von {euro0(k.vereinbart_ct)}</small></>}>
          <div className="kz-text">{k.raten ? `${k.raten} ${k.raten === 1 ? 'Zahlung' : 'Raten'}` : 'noch nichts eingezahlt'}{k.bank ? ` · ${k.bank}` : ''}</div>
          {k.zinsen_vorjahr_ct > 0 && <div className="kz-text">Zinsen {k.vorjahr}: {euro(k.zinsen_vorjahr_ct)}</div>}
        </RingZeile>
      ) : <p className="kz-text">Keine Kaution vereinbart.</p>}
    </Kennzahl>
  );
}

export function MieteQm(props: { v: Row | null; titel?: string; breite?: number; leer?: string }) {
  const v = props.v;
  if (!v) return null;
  const hatSpiegel = v.von_ct != null && v.bis_ct != null;
  return (
    <Kennzahl titel={props.titel ?? 'Miete je m² im Vergleich'} breite={props.breite ?? 3}>
      {v.qm_ct != null ? (
        <>
          <div className="kz-wert">{qm(v.qm_ct)}<small>kalt</small></div>
          <Skala von={v.von_ct} bis={v.bis_ct} mitte={v.mittel_ct} format={(x) => (x / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            marken={[{ wert: v.qm_ct, label: 'diese Wohnung', haupt: true }, { wert: v.haus_ct, label: 'Haus Ø' }]} />
          <div className="kz-text">{v.haus_ct != null ? `Haus Ø ${qm(v.haus_ct)}` : ''}{hatSpiegel ? ` · Mietspiegel ${qm(v.von_ct).replace(' €/m²', '')}–${qm(v.bis_ct)}` : ''}
            {v.mittel_ct != null ? ` (Mitte ${qm(v.mittel_ct).replace(' €/m²', '')})` : ''}{!hatSpiegel && v.mittel_ct == null ? ' · Mietspiegel beim Objekt eintragen' : ''}</div>
        </>
      ) : <p className="kz-text">{props.leer ?? 'Keine Kaltmiete oder keine Fläche.'}{v.mittel_ct != null ? ` Vergleichsmiete ${qm(v.mittel_ct)}.` : ''}</p>}
    </Kennzahl>
  );
}

export function MieterKennzahlen(props: { vertragId: number; titel?: ReactNode }) {
  const [k] = useLoad<Row | null>(() => call('mieterKennzahlen', props.vertragId), [props.vertragId]);
  if (!k) return null;
  const f = k.fakten;
  const letzter = k.verlauf.at(-1)?.ct ?? 0;
  const hoch = Math.max(0, ...k.verlauf.map((p: Row) => p.ct));
  return (
    <>
      {props.titel}
      <div className="kz-raster">
        <Zahlungsverhalten z={k.zahlung} />
        <Kalender z={k.zahlung} />
        <KautionKz k={k.kaution} />
        <Kennzahl titel="Kontoverlauf" breite={4}>
          <div className="kz-wert">{letzter > 0 ? <>{euro0(letzter)}<small>offen heute</small></> : letzter < 0 ? <>{euro0(-letzter)}<small>Guthaben</small></> : <>0 €<small>ausgeglichen</small></>}</div>
          <Sparkline punkte={k.verlauf} />
          <div className="kz-text">{hoch > 0 ? `höchster Rückstand seit ${datum(k.verlauf[0].datum)}: ${euro0(hoch)}` : `seit ${datum(k.verlauf[0]?.datum)} nie im Rückstand am Monatsende`}</div>
        </Kennzahl>
        <Kennzahl titel="Mietverhältnis in Zahlen" breite={5}>
          <div className="fakten kz-fakten">
            <div className="fakt"><span>Mietdauer</span><b>{f.jahre} J. {f.monate} M.</b></div>
            <div className="fakt"><span>Gezahlt seit Beginn</span><b>{euro0(f.gezahlt_ct)}</b></div>
            <div className="fakt"><span>Kaltmiete seit Beginn</span><b>{f.kalt_aenderung == null ? '–' : `${f.kalt_aenderung >= 0 ? '+' : '−'}${prozent(Math.abs(f.kalt_aenderung), 1)}`}</b></div>
            <div className="fakt"><span>Kündigungsfrist Vermieter</span><b>{f.frist_monate} Monate</b></div>
          </div>
          {f.schritte.length > 0 && <ul className="kz-liste">{f.schritte.map((s: Row, i: number) => (
            <li key={i}><span>{s.datum ? <span className="datumchip">{datum(s.datum).slice(0, 6) + s.datum.slice(2, 4)}</span> : <span className="datumchip">jetzt</span>}{s.text}</span></li>
          ))}</ul>}
        </Kennzahl>
        <MieteQm v={k.vergleich} />
      </div>
    </>
  );
}

// ===================================================================================================
// Unit (E1–E4, M5) and self-use (N1, N4)
// ===================================================================================================
export const SELBST_FELDER: Field[] = [
  { key: 'beginn', label: 'Selbst genutzt ab', type: 'date', required: true },
  { key: 'ende', label: 'bis (leer = offen)', type: 'date' },
  { key: 'personen', label: 'Personen im Haushalt', type: 'number', required: true },
  { key: 'notiz', label: 'Notiz', type: 'textarea' },
];

export function SelbstnutzungDialog(props: { einheitId: number; row: Row; onClose: () => void }) {
  return (
    <FormDialog title={props.row.id ? 'Selbstnutzung bearbeiten' : 'Einheit selbst nutzen'} row={props.row} fields={SELBST_FELDER}
      extra={<p className="hinweisbox">Die Einheit gilt dann nicht als leer. In der Betriebskostenabrechnung trägt sie ihren Anteil selbst (nach Personen mit dieser Haushaltsgröße),
        und in der Anlage V zählt nur der vermietete Teil des Hauses. Überschneidungen mit einem Mietvertrag meldet der Prüfbericht.</p>}
      onSave={(r) => {
        if (r.ende && r.ende < r.beginn) throw new Error('Das Ende liegt vor dem Beginn.');
        return call('save', 'selbstnutzung', { ...r, einheit_id: props.einheitId });
      }}
      onDelete={props.row.id ? () => call('remove', 'selbstnutzung', props.row.id) : undefined} onClose={props.onClose} />
  );
}

export function EinheitKennzahlen(props: { einheit: Row; selbstnutzung: Row[]; reload: () => void }) {
  const e = props.einheit;
  const [k, laden] = useLoad<Row | null>(() => call('einheitKennzahlen', e.id), [e.id]);
  const [edit, setEdit] = useState<Row | null>(null);
  if (!k) return null;
  const b = k.belegung;
  const w = k.wechsel;
  const s = k.selbst;
  const aktuell = props.selbstnutzung.find((x) => x.beginn <= heute() && (!x.ende || x.ende >= heute()));
  const schliessen = () => { setEdit(null); laden(); props.reload(); };
  return (
    <div className="kz-raster">
      <Kennzahl titel={b.seit ? `Belegung seit ${b.seit.slice(0, 4)}` : 'Belegung'} breite={s ? 12 : 8}>
        <Zeitstrahl segmente={b.segmente} von={b.seit ?? heute()} bis={b.bis} />
        <div className="kz-text">{b.seit ? <>Belegt {prozent((b.quote ?? 0) * 100, 1)} seit {datum(b.seit)} · {b.wechsel} Mieterwechsel · Leerstand {b.jahr}: {b.leer_jahr} Tage</> : 'Noch kein Mietverhältnis und keine Selbstnutzung erfasst.'}</div>
        {b.segmente.filter((x: Row) => x.art === 'leer').slice(-3).reverse().map((x: Row) => (
          <div key={x.von} className="kz-text"><span className="chip rot">leer</span> {datum(x.von)} – {datum(x.bis)}: {x.tage} Tage{x.entgangen_ct ? `, ${euro0(x.entgangen_ct)} Kaltmiete entgangen` : ''}</div>
        ))}
      </Kennzahl>
      {!s && (
        <Kennzahl titel="Mieterwechsel" breite={4}>
          {w.posten.length ? (
            <>
              <div className="kz-wert">{euro0(w.summe_ct)}<small>{w.laufend ? `Leerstand seit ${datum(w.seit)}` : 'letzter Wechsel'}</small></div>
              <KzListe zeilen={[...w.posten.map((p: Row) => [p.label, euro0(p.ct)] as [ReactNode, ReactNode]), ...(w.schnitt_jahre != null ? [['Ø Mietdauer', `${zahl(Math.round(w.schnitt_jahre * 10) / 10)} J.`] as [ReactNode, ReactNode]] : [])]} />
              <div className="kz-text">{w.laufend ? `nach ${nachname(w.von_name)}; bisher entgangene Kaltmiete und Kosten` : `${nachname(w.von_name)} → ${nachname(w.nach_name)}; Kosten mit dieser Einheit gebucht`}</div>
            </>
          ) : <p className="kz-text">{w.schnitt_jahre != null ? `Noch kein Wechsel. Mietdauer bisher ${zahl(Math.round(w.schnitt_jahre * 10) / 10)} Jahre.` : 'Noch kein Mieterwechsel.'}</p>}
        </Kennzahl>
      )}
      {s && (
        <>
          <Kennzahl titel="Selbst genutzt" breite={4} aktion={aktuell ? <button className="link klein" onClick={() => setEdit(aktuell)}>Ändern</button> : undefined}>
            <div className="chips"><span className="chip weg">seit {datum(s.seit)}{s.bis ? ` bis ${datum(s.bis)}` : ''}</span><span className="chip">{zahl(s.personen)} {s.personen === 1 ? 'Person' : 'Personen'} im Haushalt</span></div>
            <div className="kz-text">Zählt nicht als Leerstand und nicht in Vermietung, Mieteingang und Mieterhöhungs-Radar. Betriebskosten: Eigenanteil nach deiner Haushaltsgröße;
              Anlage V: nur der vermietete Teil – <L zu={{ seite: 'auswertung', objektId: e.objekt_id }}>Rendite & Steuer</L>.</div>
          </Kennzahl>
          <Kennzahl titel="Was die eigene Wohnung kostet" breite={4}>
            <div className="kz-wert">{euro0(s.monat_ct)}<small>pro Monat</small></div>
            <KzListe zeilen={s.posten.map((p: Row) => [p.label, euro0(p.ct)])} />
            {s.fiktiv_ct != null && <div className="kz-zeile"><span className="kz-text">Vermietet brächte sie etwa</span><b>{euro0(s.fiktiv_ct)} kalt</b></div>}
            {s.fiktiv_ct != null && <div className="kz-text">{zahl(s.flaeche)} m² × {qm(s.qm_ct)} {s.quelle === 'haus' ? 'Hausdurchschnitt' : 'Vergleichsmiete'}</div>}
          </Kennzahl>
        </>
      )}
      {(!s || k.ertrag.some((x: Row) => x.soll_ct || x.ist_ct)) && <Kennzahl titel="Ertrag je Jahr" breite={s ? 4 : 5}>
        <Balken gruppen={k.ertrag.map((x: Row) => ({ label: String(x.jahr), werte: [x.soll_ct, x.ist_ct, x.kosten_ct] }))}
          reihen={[{ label: 'Kaltmiete Soll', farbe: 'var(--c1-hell)' }, { label: 'gezahlt', farbe: 'var(--c1)' }, { label: 'Kosten der Einheit', farbe: 'var(--k2)' }]} />
        <div className="legende klein"><span><i style={{ background: 'var(--c1-hell)' }} />Soll</span><span><i style={{ background: 'var(--c1)' }} />gezahlt</span><span><i style={{ background: 'var(--k2)' }} />Kosten der Einheit</span></div>
      </Kennzahl>}
      <Kennzahl titel="Verbrauch je m²" breite={4} fuss={<Weiter zu={{ seite: 'zaehler', objektId: e.objekt_id }}>Zähler</Weiter>}>
        {k.verbrauch.length ? (
          <KzListe zeilen={k.verbrauch.map((v: Row) => [`${v.label} ${v.jahr}`,
            v.wert == null ? <span className="hinweis">keine Ablesung</span>
              : <>{v.qm != null ? `${wenig(v.qm)} ${v.einheit}/m²` : `${wenig(v.wert)} ${v.einheit}`}{v.haus_qm != null && v.qm != null ? <span className="hinweis"> · Haus {wenig(v.haus_qm)}</span> : null}
                {v.aenderung != null ? <span className={Math.abs(v.aenderung) >= 40 ? 'minus' : 'hinweis'}> · {v.aenderung > 0 ? '+' : '−'}{prozent(Math.abs(v.aenderung))}</span> : null}</>])} />
        ) : <p className="kz-text">Keine Zähler in dieser Einheit.</p>}
        {k.verbrauch.some((v: Row) => v.aenderung != null) && <div className="kz-text">Änderung gegenüber dem Vorjahr; ab ± 40 % erscheint ein Hinweis im Cockpit.</div>}
      </Kennzahl>
      {!s && <MieteQm v={k.vergleich} breite={3} titel={k.vergleich_quelle === 'angebot' ? 'Angebot je m² im Vergleich' : undefined} leer="Zurzeit nicht vermietet." />}
      {edit && <SelbstnutzungDialog einheitId={e.id} row={edit} onClose={schliessen} />}
    </div>
  );
}

// Small key figures for the lists (Z1).
export const ZahlungMini = (props: { x: Row | undefined }) => <MiniRing wert={props.x?.score ?? null} zonen={ZONEN_SCORE} titel={props.x?.label ? `Zahlungsverhalten: ${props.x.label} (${props.x.score} von 100)` : undefined} />;
export const BelegungMini = (props: { x: Row | undefined }) => props.x?.belegung == null ? <span className="hinweis">–</span>
  : <MiniRing wert={props.x.belegung * 100} zonen={ZONEN_BELEGUNG} text={prozent(Math.floor(props.x.belegung * 100))} titel={`Belegt in den letzten 12 Monaten${props.x.selbst ? ' (selbst genutzt)' : ''}`} />;
export function QmMini(props: { x: Row | undefined }) {
  const x = props.x;
  if (x?.qm_ct == null) return <span className="hinweis">–</span>;
  const lage = x.von_ct != null && x.bis_ct != null ? (x.qm_ct < x.von_ct ? 'unter dem Mietspiegel' : x.qm_ct > x.bis_ct ? 'über dem Mietspiegel' : 'im Mietspiegel') : null;
  return <span className={lage === 'unter dem Mietspiegel' ? 'qm-unter' : lage === 'über dem Mietspiegel' ? 'qm-ueber' : ''} title={lage ? `${qm(x.qm_ct)} – ${lage} (${qm(x.von_ct).replace(' €/m²', '')}–${qm(x.bis_ct)})` : undefined}>{qm(x.qm_ct).replace(' €/m²', '')}</span>;
}
