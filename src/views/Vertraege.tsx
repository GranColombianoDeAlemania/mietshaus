import { useRef, useState } from 'react';
import { call, datum, euro, personName, zahl, type Modus, type Row } from '../api';
import { FormDialog, type Field } from '../Form';
import { useLoad } from '../useLoad';
import { L, useNavi } from '../navi';
import { Leer, SortTh, sortiere, type Sortierung } from '../ui';
import { SaldoChip, MietbeginnHinweis } from './Akten';
import { sollNachfrage } from './Sollstellung';
import { PERSON_FELDER } from './Personen';
import { QmMini, ZahlungMini } from './Kennzahlen';

const FAELLIG: [number, string][] = [[0, '3. Werktag (gesetzlich, § 556b BGB)'], ...Array.from({ length: 28 }, (_, i) => [i + 1, `am ${i + 1}. des Monats`] as [number, string])];

export const BK_ART: [string, string][] = [['vorauszahlung', 'Vorauszahlung (wird jährlich abgerechnet)'], ['pauschale', 'Pauschale (keine Abrechnung)'],
  ['inklusiv', 'in der Kaltmiete enthalten (Bruttokaltmiete)']];
const mitteImMonat = (f: Row) => /^\d{4}-\d{2}-\d{2}$/.test(f.beginn ?? '') && !String(f.beginn).endsWith('-01');
// Moving out before the end of a month (a rent month from another day ends on other days, so it is always offered there).
const endeImMonat = (f: Row) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.ende ?? '')) return false;
  const [y, m, d] = String(f.ende).split('-').map(Number);
  return f.mietmonat_ab === 'einzug' || d < new Date(Date.UTC(y, m, 0)).getUTCDate();
};

// One screen for both contract kinds: tenancies (Miete) and ownership (WEG). Rent and house money are monthly
// amounts: a month of moving in or out is charged in full, never by day. The fields depend on what is entered.
const ART = {
  miete: {
    table: 'mietverhaeltnisse',
    titel: 'Mieter',
    neu: 'Neues Mietverhältnis',
    person: 'Mieter',
    felder: (f: Row): Field[] => [
      { key: 'kaltmiete_ct', label: f.bk_art === 'inklusiv' ? 'Kaltmiete inkl. Betriebskosten' : 'Kaltmiete', type: 'money',
        section: 'Monatliche Zahlungen bei Vertragsbeginn (spätere Änderungen unter „Mietanpassungen“)' },
      { key: 'bk_art', label: 'Betriebskosten', type: 'select', required: true, options: BK_ART },
      ...(f.bk_art === 'inklusiv' ? [] : [{ key: 'bk_vz_ct', label: f.bk_art === 'pauschale' ? 'Betriebskostenpauschale' : 'Betriebskosten-Vorauszahlung', type: 'money' } as Field]),
      { key: 'hk_vz_ct', label: 'Heizkosten-Vorauszahlung', type: 'money' },
      { key: 'sonstiges_ct', label: 'Sonstiges (z. B. Stellplatz)', type: 'money' },
      { key: 'faelligkeitstag', label: 'Fällig', type: 'select', required: true, options: FAELLIG },
      { key: 'ust_satz', label: 'Umsatzsteuer (nur Gewerbe mit Option)', type: 'select', required: true, options: [[0, 'keine'], [19, 'zzgl. 19 %'], [7, 'zzgl. 7 %']] },
      ...(mitteImMonat(f) ? [
        { key: 'mietmonat_ab', label: 'Mietmonat läuft', type: 'select', required: true, section: 'Ein- und Auszug mitten im Monat – die Miete ist ein voller Monatsbetrag, außer du wählst „anteilig“',
          options: [['erster', 'vom 1. bis zum Monatsende'], ['einzug', `vom ${Number(String(f.beginn).slice(8, 10))}. bis zum ${Number(String(f.beginn).slice(8, 10)) - 1}. des Folgemonats`]] } as Field,
        ...(f.mietmonat_ab === 'einzug' ? [] : [{ key: 'teilmonat_beginn', label: 'Einzugsmonat', type: 'select', required: true,
          options: [['voll', 'voller Monat'], ['teilbetrag', 'anteilig bis Monatsende'], ['folgemonat', 'erst ab dem Folgemonat']] } as Field]),
        ...(f.mietmonat_ab !== 'einzug' && f.teilmonat_beginn === 'teilbetrag'
          ? [{ key: 'teilbetrag_beginn_ct', label: 'Vereinbarter Betrag Einzugsmonat (leer = nach Tagen)', type: 'money' } as Field] : []),
      ] : []),
      ...(endeImMonat(f) ? [{ key: 'teilmonat_ende', label: 'Auszugsmonat', type: 'select', required: true, section: mitteImMonat(f) ? undefined : 'Auszug mitten im Monat',
        options: [['voll', 'voller Monat'], ['teilbetrag', 'anteilig bis zum Auszugstag']] } as Field] : []),
      { key: 'bk_abrechnung', label: 'Betriebskostenabrechnung', type: 'select', required: true, section: mitteImMonat(f) || endeImMonat(f) ? undefined : 'Betriebskostenabrechnung',
        options: [['mietmonate', 'nach Mietmonaten (Standard)'], ['wohntage', 'nach Wohntagen (ab Einzugstag, bis Auszugstag)']] },
      { key: 'kaution_ct', label: 'Kaution', type: 'money', section: 'Weitere Angaben' },
      { key: 'personen_anzahl', label: 'Personen im Haushalt', type: 'number' },
    ],
    summe: (v: Row) => v.akt_kaltmiete_ct + v.akt_bk_vz_ct + v.akt_hk_vz_ct + v.akt_sonstiges_ct + (v.akt_ust_ct ?? 0),
  },
  weg: {
    table: 'eigentum',
    titel: 'Eigentümer',
    neu: 'Neuer Eigentümer',
    person: 'Eigentümer',
    felder: (f: Row): Field[] => [
      { key: 'hausgeld_ct', label: 'Hausgeld', type: 'money', section: 'Monatliche Zahlungen bei Beginn (spätere Änderungen über den Wirtschaftsplan)' },
      { key: 'ruecklage_ct', label: 'davon Erhaltungsrücklage', type: 'money' },
      { key: 'faelligkeitstag', label: 'Fällig', type: 'select', required: true, options: FAELLIG },
      ...(mitteImMonat(f) ? [{ key: 'teilmonat_beginn', label: 'Monat des Eigentumsübergangs', type: 'select', required: true,
        section: 'Wechsel mitten im Monat – das Hausgeld ist immer ein voller Monatsbetrag', options: [['voll', 'voller Monat'], ['folgemonat', 'erst ab dem Folgemonat']] } as Field] : []),
      { key: 'selbstnutzer', label: 'Bewohnt die Einheit selbst', type: 'check', section: 'Weitere Angaben' },
    ],
    // The reserve share is part of the house money, not added on top.
    summe: (v: Row) => v.akt_hausgeld_ct,
  },
} as const;

// Contract form fields, shared by this list and the contract page; `f` are the values as currently entered.
// objekte: a new contract may be for another house (its units follow the choice); neuePerson: tenants and owners not
// yet in the address book are created from the form itself.
export function vertragFelder(modus: Modus, einheiten: Row[], personen: Row[], f: Row = {},
  opt: { objekte?: Row[]; neuePerson?: (key: string, text: string) => void } = {}): Field[] {
  const a = ART[modus === 'weg' ? 'weg' : 'miete'];
  const personOpts: [number, string][] = personen.map((p) => [p.id, personName(p)]);
  const neu = (key: string) => (opt.neuePerson ? { label: `Neuer ${a.person} (ins Adressbuch)`, onClick: (text: string) => opt.neuePerson!(key, text) } : undefined);
  return [
    ...(opt.objekte && opt.objekte.length > 1 && !f.id ? [{ key: 'objekt_id', label: 'Objekt', type: 'select', required: true,
      options: opt.objekte.map((o) => [o.id, o.bezeichnung] as [number, string]) } as Field] : []),
    { key: 'einheit_id', label: 'Einheit', type: 'select', required: true, options: einheiten.map((e) => [e.id, `${e.nr} – ${e.bezeichnung}`]) },
    { key: 'person_id', label: a.person, type: 'select', required: true, options: personOpts, neu: neu('person_id') },
    { key: 'person2_id', label: `Weiterer ${a.person}`, type: 'select', options: personOpts, neu: neu('person2_id') },
    { key: 'beginn', label: 'Beginn', type: 'date', required: true },
    { key: 'ende', label: 'Ende', type: 'date' },
    ...a.felder(f),
    { key: 'lastschrift', label: 'Zahlt per SEPA-Lastschrift', type: 'check', section: 'Zahlungsweg' },
    { key: 'sepa_mandat', label: 'Mandatsreferenz' },
    { key: 'notiz', label: 'Notiz', type: 'textarea' },
  ];
}

// Most tenancies start on the 1st: a new contract suggests the 1st of next month.
const ersterNaechsterMonat = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1)).toISOString().slice(0, 10);
};

// What a new contract starts with.
export const neuerVertrag = (modus: Modus, x: Row = {}): Row => ({ beginn: ersterNaechsterMonat(), faelligkeitstag: modus === 'weg' ? 1 : 0, personen_anzahl: 1,
  teilmonat_beginn: 'voll', teilmonat_ende: 'voll', ust_satz: 0, ...(modus === 'weg' ? {} : { mietmonat_ab: 'erster', bk_abrechnung: 'mietmonate', bk_art: 'vorauszahlung' }), ...x });

// The contract form: new or existing tenancy/ownership. The tenant can be entered right here (a person form on top,
// saved into the address book), and a new contract can be for any house of the mode with its units.
export function VertragDialog(props: { modus: Modus; objekt: Row; objekte?: Row[]; edit: Row; onClose: (gespeichert: { id: number; objekt_id: number } | null) => void }) {
  const typ = props.modus === 'weg' ? 'weg' : 'miete';
  const a = ART[typ];
  const objekte = props.edit.id ? [props.objekt] : (props.objekte?.length ? props.objekte : [props.objekt]);
  const [einheiten] = useLoad<Record<number, Row[]>>(async () => Object.fromEntries(await Promise.all(objekte.map(async (o) => [o.id, await call('einheiten', o.id)]))),
    [objekte.map((o) => o.id).join(',')]);
  const [personen, ladePersonen] = useLoad<Row[]>(() => call('personen'), []);
  const [personNeu, setPersonNeu] = useState<{ key: string; text: string } | null>(null);
  const setzeRef = useRef<((werte: Row) => void) | null>(null);
  const gespeichert = useRef<{ id: number; objekt_id: number } | null>(null);
  const neuePersonId = useRef<number | null>(null);
  const objektVon = (f: Row) => Number(f.objekt_id) || props.objekt.id;
  // A typed name becomes the surname (or the company, if it looks like one).
  const vorbelegt = (text: string): Row => (/\b(gmbh|ag|kg|ug|e\.?\s?v\.?|gbr|ohg)\b/i.test(text) ? { anrede: 'Firma', firma: text } : { nachname: text });
  return (
    <>
      <FormDialog
        title={props.edit.id ? `${a.person} bearbeiten` : a.neu}
        fields={(f) => vertragFelder(props.modus, einheiten?.[objektVon(f)] ?? [], personen ?? [], f,
          { objekte, neuePerson: (key, text) => setPersonNeu({ key, text }) })}
        row={{ objekt_id: props.objekt.id, ...props.edit }}
        extra={(f, setze) => { setzeRef.current = setze; return <MietbeginnHinweis f={f} modus={typ} setze={setze} />; }}
        onSave={async (r) => {
          if (r.ende && r.ende < r.beginn) throw new Error('Das Ende liegt vor dem Beginn.');
          const objektId = Number(r.objekt_id) || props.objekt.id;
          const { objekt_id: _o, ...zeile } = r;
          if (!(einheiten?.[objektId] ?? []).some((e) => e.id === zeile.einheit_id)) throw new Error('Bitte eine Einheit dieses Objekts wählen.');
          const id = await call('save', a.table, zeile);
          gespeichert.current = { id, objekt_id: objektId };
          // Once the form has closed: charges that no longer fit, and months before the automatic charging.
          setTimeout(() => sollNachfrage(typ, id, { fruehereMonate: !props.edit.id || props.edit.beginn !== r.beginn }), 0);
          return id;
        }}
        onDelete={props.edit.id ? () => call('remove', a.table, props.edit.id) : undefined}
        onClose={() => props.onClose(gespeichert.current)}
      />
      {personNeu && (
        <FormDialog title={`Neuer ${a.person}`} fields={PERSON_FELDER} row={vorbelegt(personNeu.text)}
          extra={<p className="hinweis klein">Wird im Adressbuch gespeichert und gleich in den Vertrag übernommen.</p>}
          onSave={async (r) => { neuePersonId.current = await call('save', 'personen', r); return neuePersonId.current; }}
          onClose={() => {
            const id = neuePersonId.current, key = personNeu.key;
            neuePersonId.current = null;
            setPersonNeu(null);
            if (id) { ladePersonen(); setzeRef.current?.({ [key]: String(id) }); }
          }} />
      )}
    </>
  );
}

export function Vertraege(props: { modus: Modus; objekt: Row; objekte?: Row[] }) {
  const navi = useNavi();
  const typ = props.modus === 'weg' ? 'weg' : 'miete';
  const a = ART[typ];
  const [rows, reload] = useLoad<Row[]>(() => call('vertraege', a.table, props.objekt.id), [props.objekt.id, a.table]);
  const [einheiten] = useLoad<Row[]>(() => call('einheiten', props.objekt.id), [props.objekt.id]);
  // Small gauges per tenancy: payment behaviour and cold rent per m².
  const [kz, ladeKz] = useLoad<Row | null>(() => (typ === 'miete' ? call('listenKennzahlen', props.objekt.id) : Promise.resolve(null)), [props.objekt.id, typ]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [nurAktuell, setNurAktuell] = useState(true);
  const [sort, setSort] = useState<Sortierung>(null);

  const sichtbar = sortiere(rows?.filter((v) => !nurAktuell || v.aktuell || v.zukuenftig), sort, (v, k) => (k === 'monatlich' ? a.summe(v) : k === 'saldo' ? v.ueberfaellig_ct : v[k]));
  const gesamt = sichtbar.filter((v) => v.aktuell).reduce((s, v) => s + a.summe(v), 0);
  const neu = () => setEdit(neuerVertrag(props.modus));

  return (
    <section>
      <div className="toolbar">
        <h1>{a.titel}</h1>
        <span className="spacer" />
        <label className="check">
          <input type="checkbox" checked={nurAktuell} onChange={(e) => setNurAktuell(e.target.checked)} /> nur aktuelle
        </label>
        <button className="primary" disabled={!einheiten?.length && (props.objekte?.length ?? 0) < 2} title={!einheiten?.length ? 'Zuerst Einheiten anlegen' : ''} onClick={neu}>
          {a.neu}
        </button>
      </div>
      {einheiten && !einheiten.length && <Leer text="Dieses Objekt hat noch keine Einheiten." aktion={<button onClick={() => navi.zu({ seite: 'einheiten', objektId: props.objekt.id })}>Einheiten anlegen</button>} />}
      {rows && !!einheiten?.length && sichtbar.length === 0 && (
        <Leer symbol="mieter" text={`Noch keine ${nurAktuell ? 'aktuellen ' : ''}${a.titel} für dieses Objekt.`} aktion={<button className="primary" onClick={neu}>{a.neu}</button>} />
      )}
      {sichtbar.length > 0 && (
        <table>
          <thead>
            <tr>
              <SortTh k="einheit_nr" s={sort} set={setSort}>Einheit</SortTh><SortTh k="name" s={sort} set={setSort}>{a.person}</SortTh>
              <SortTh k="beginn" s={sort} set={setSort}>Beginn</SortTh><SortTh k="ende" s={sort} set={setSort}>Ende</SortTh>
              {typ === 'miete' ? (
                <><th className="num">Kaltmiete</th><th className="num">BK-VZ</th><th className="num">HK-VZ</th></>
              ) : (
                <><th className="num">Hausgeld</th><th className="num">Rücklage</th></>
              )}
              <SortTh k="monatlich" s={sort} set={setSort} className="num">Monatlich</SortTh>
              {typ === 'miete' && <th title="Zahlungsverhalten der letzten 24 Monate (0–100)">Zahlung</th>}
              {typ === 'miete' && <th className="num" title="Kaltmiete je m² und Monat; gelb unter, rot über der Spanne des Mietspiegels">€/m²</th>}
              <SortTh k="saldo" s={sort} set={setSort}>Konto</SortTh>
            </tr>
          </thead>
          <tbody>
            {sichtbar.map((v) => (
              <tr key={v.id} className={`klickbar${v.aktuell || v.zukuenftig ? '' : ' inaktiv'}`} data-ziel={`vertrag:${typ}:${v.id}`}
                onClick={() => navi.zu({ vertrag: v.id, typ })} title="Vertrag öffnen">
                <td><L zu={{ einheit: v.einheit_id }}>{v.einheit_nr} – {v.einheit}</L></td>
                <td><L zu={{ person: v.person_id }}>{v.name}</L>{v.zukuenftig ? <span className="klein hinweis"> · ab {datum(v.beginn)}</span> : null}</td>
                <td>{datum(v.beginn)}</td>
                <td>{datum(v.ende)}</td>
                {typ === 'miete' ? (
                  <><td className="num">{euro(v.akt_kaltmiete_ct)}</td>
                    <td className="num">{v.bk_art === 'inklusiv' ? <span className="klein hinweis" title="Betriebskosten in der Kaltmiete enthalten">inkl.</span>
                      : <>{euro(v.akt_bk_vz_ct)}{v.bk_art === 'pauschale' && <div className="klein hinweis">Pauschale</div>}</>}</td>
                    <td className="num">{euro(v.akt_hk_vz_ct)}</td></>
                ) : (
                  <><td className="num">{euro(v.akt_hausgeld_ct)}</td><td className="num">{euro(v.akt_ruecklage_ct)}</td></>
                )}
                <td className="num"><b>{euro(a.summe(v))}</b>
                  {v.ust_satz > 0 ? <div className="klein hinweis">inkl. {zahl(v.ust_satz)} % USt</div> : v.angepasst ? <div className="klein hinweis" title="Durch Mietanpassung, Wirtschaftsplan oder neue Vorauszahlungen geändert">angepasst</div> : null}</td>
                {typ === 'miete' && <td>{v.aktuell || v.zukuenftig ? <ZahlungMini x={kz?.vertraege[v.id]} /> : null}</td>}
                {typ === 'miete' && <td className="num">{v.aktuell || v.zukuenftig ? <QmMini x={kz?.vertraege[v.id]} /> : null}</td>}
                <td>{v.aktuell || v.ueberfaellig_ct ? <SaldoChip v={v} /> : null}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={typ === 'miete' ? 7 : 6}>Summe Soll pro Monat (aktuelle Verträge)</td>
              <td className="num"><b>{euro(gesamt)}</b></td>{typ === 'miete' && <><td /><td /></>}<td />
            </tr>
          </tfoot>
        </table>
      )}
      {sichtbar.length > 0 && <p className="hinweis klein">Klick auf eine Zeile öffnet den Vertrag, Klick auf Namen oder Einheit deren Steckbrief.</p>}
      {edit && (
        <VertragDialog modus={props.modus} objekt={props.objekt} objekte={props.objekte} edit={edit} onClose={(g) => {
          setEdit(null);
          // A new contract for another house: go there, so it shows up.
          if (g && g.objekt_id !== props.objekt.id) navi.zu({ seite: 'vertraege', objektId: g.objekt_id });
          reload();
          ladeKz();
        }} />
      )}
    </section>
  );
}
