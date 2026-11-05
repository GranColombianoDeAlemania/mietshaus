// Inventory of a house or one unit: kitchens, appliances, building services with purchase, warranty, invoice and photo.
// Items for a rented unit are written off over their useful life (Rendite & Steuer → Anlage V).
import { useState } from 'react';
import { call, datum, euro, fehler, heute, type Row } from '../api';
import { useLoad } from '../useLoad';
import { Tabelle } from '../Tabelle';
import { FormDialog, type Field } from '../Form';
import { Chip } from '../ui';
import { L } from '../navi';
import { handy } from '../Foto';
import { dokUrl } from './Archiv';

const alsEuro = (ct?: number | null) => (ct == null ? '' : (ct / 100).toFixed(2).replace('.', ','));

export function Inventar(props: { objekt: Row; einheit?: Row; ohneKopf?: boolean }) {
  const o = props.objekt;
  const [rows, reload] = useLoad<Row[]>(() => call('inventar', o.id, props.einheit?.id ?? null), [o.id, props.einheit?.id]);
  const [kategorien] = useLoad<[string, string, number][]>(() => call('inventarKategorien'), []);
  const [einheiten] = useLoad<Row[]>(() => call('einheiten', o.id), [o.id]);
  const [rechnungen] = useLoad<Row[]>(() => call('rechnungen', { objekt_id: o.id }), [o.id]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [suche, setSuche] = useState('');

  const felder: Field[] = [
    { key: 'bezeichnung', label: 'Bezeichnung', required: true, wide: true },
    ...(props.einheit ? [] : [{ key: 'einheit_id', label: 'Einheit (leer = Haustechnik des Hauses)', type: 'select', options: (einheiten ?? []).map((e) => [e.id, e.bezeichnung]) } as Field]),
    { key: 'kategorie', label: 'Art', type: 'select', options: (kategorien ?? []).map(([k, l]) => [k, l]) },
    { key: 'hersteller', label: 'Hersteller / Händler' }, { key: 'modell', label: 'Modell' }, { key: 'seriennr', label: 'Seriennummer' },
    { key: 'kaufdatum', label: 'Gekauft am', type: 'date', section: 'Kauf und Abschreibung' },
    { key: 'preis_ct', label: 'Anschaffungskosten (brutto; netto bei Vorsteuerabzug)', type: 'money' },
    { key: 'nutzungsdauer_jahre', label: 'Nutzungsdauer in Jahren', type: 'number' },
    { key: 'garantie_bis', label: 'Garantie bis', type: 'date' },
    { key: 'dokument_id', label: 'Rechnung', type: 'select', options: (rechnungen ?? []).map((d) => [d.id, `${d.titel}${d.datum ? ` · ${datum(d.datum)}` : ''}${d.betrag_ct ? ` · ${euro(d.betrag_ct)}` : ''}`]), wide: true },
    { key: 'abgang_am', label: 'Ausgebaut / verkauft am', type: 'date' },
    { key: 'abgang_art', label: 'Abgang', type: 'select', options: [['entsorgt', 'entsorgt / verschrottet (Restwert absetzbar)'], ['verkauft', 'verkauft (Restwert nicht absetzbar)']] },
    { key: 'notiz', label: 'Notiz', type: 'textarea' },
  ];

  async function foto(r: Row) {
    const opt = { objekt_id: o.id, einheit_id: r.einheit_id ?? undefined, status: 'abgelegt', typ: 'Foto' };
    try {
      const x = await window.hv[handy() ? 'fotoAufnehmen' : 'dateienImportieren'](opt);
      if (!x?.length) return;
      await call('dokumentSpeichern', { id: x[0].id, titel: `Typenschild ${r.bezeichnung}` });
      await call('save', 'inventar', { id: r.id, foto_id: x[0].id });
      reload();
    } catch (e) { fehler(e); }
  }

  const garantie = (r: Row) => (!r.garantie_bis ? '' : r.garantie_bis >= heute() ? <Chip art="gruen">bis {datum(r.garantie_bis)}</Chip> : <span className="hinweis klein">abgelaufen</span>);

  return (
    <section>
      {!props.ohneKopf && (
        <div className="toolbar">
          <h1>Inventar{props.einheit ? ` ${props.einheit.bezeichnung}` : ''}</h1>
          <span className="spacer" />
          {(rows?.length ?? 0) > 12 && <input className="suche" placeholder="Filtern…" aria-label="Inventar filtern" value={suche} onChange={(e) => setSuche(e.target.value)} />}
          <button className="primary" onClick={() => setEdit({ objekt_id: o.id, einheit_id: props.einheit?.id ?? null, nutzungsdauer_jahre: 10 })}>Neues Teil</button>
        </div>
      )}
      {!props.ohneKopf && <p className="hinweis klein">Einbauküchen, Geräte und Haustechnik mit Kauf, Garantie und Rechnung. Was für eine vermietete Einheit gekauft wurde, wird über die Nutzungsdauer abgeschrieben (Rendite & Steuer); bis 800 € netto sofort voll. Buche die Rechnung dazu auf das Konto „Anschaffungen“. Fest eingebaute Haustechnik ist Teil des Gebäudes und wird als Instandhaltung gebucht.</p>}
      {props.ohneKopf && <div className="toolbar"><span className="spacer" /><button onClick={() => setEdit({ objekt_id: o.id, einheit_id: props.einheit?.id ?? null, nutzungsdauer_jahre: 10 })}>Neues Teil</button></div>}
      <Tabelle zeilen={rows} suche={suche} leer="Noch nichts erfasst – z. B. die Einbauküche oder die Waschmaschine." onOeffnen={(r) => setEdit(r)}
        zeilenProps={(r) => ({ className: r.abgang_am ? 'inaktiv' : '' })}
        spalten={[
          { id: 'foto', titel: '', wert: (r) => (r.foto_datei ? <img className="inventar-foto" src={dokUrl(r.foto_datei)} alt="" /> : null) },
          { id: 'bez', titel: 'Bezeichnung', wert: (r) => <span>{r.bezeichnung}{r.hersteller || r.modell ? <span className="klein hinweis"> · {[r.hersteller, r.modell].filter(Boolean).join(' ')}</span> : null}</span>, sortWert: (r) => r.bezeichnung },
          ...(props.einheit ? [] : [{ id: 'einheit', titel: 'Einheit', wert: (r: Row) => (r.einheit_id ? <L zu={{ einheit: r.einheit_id }}>{r.einheit}</L> : <span className="hinweis klein">Haus</span>), sortWert: (r: Row) => r.einheit ?? '' }]),
          { id: 'kauf', titel: 'Gekauft', wert: (r) => datum(r.kaufdatum), sortWert: (r) => r.kaufdatum },
          { id: 'preis', titel: 'Preis', wert: (r) => (r.preis_ct != null ? euro(r.preis_ct) : ''), sortWert: (r) => r.preis_ct, klasse: 'num' },
          { id: 'rest', titel: 'Restwert', wert: (r) => (r.restwert_ct != null ? (r.gwg ? <span className="hinweis klein" title="Geringwertiges Wirtschaftsgut: im Kaufjahr voll abgeschrieben">GWG</span> : euro(r.restwert_ct)) : ''), klasse: 'num' },
          { id: 'garantie', titel: 'Garantie', wert: garantie, sortWert: (r) => r.garantie_bis },
          { id: 'rechnung', titel: 'Rechnung', wert: (r) => (r.rechnung_datei ? <a href={dokUrl(r.rechnung_datei)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>öffnen</a> : '') },
        ]}
        aktionen={(r) => <button onClick={(e) => { e.stopPropagation(); foto(r); }}>{handy() ? 'Foto' : 'Foto …'}</button>} />
      {edit && (
        <FormDialog title={edit.id ? edit.bezeichnung : 'Neues Teil'} fields={felder} row={edit}
          onSave={(r) => call('save', 'inventar', { objekt_id: o.id, ...(props.einheit ? { einheit_id: props.einheit.id } : {}), ...r })}
          onDelete={edit.id ? () => call('remove', 'inventar', edit.id) : undefined}
          onClose={() => { setEdit(null); reload(); }}
          extra={(f, setze) => (
            <div className="toolbar">
              {f.dokument_id && <button type="button" onClick={async () => {
                try {
                  const d = await call<Row>('inventarAusRechnung', Number(f.dokument_id));
                  setze({ ...(f.kaufdatum ? {} : { kaufdatum: d.kaufdatum ?? '' }), ...(f.preis_ct ? {} : { preis_ct: alsEuro(d.preis_ct) }), ...(f.hersteller ? {} : { hersteller: d.hersteller ?? '' }) });
                } catch (e) { fehler(e); }
              }}>Datum, Betrag und Händler aus der Rechnung</button>}
              {f.kategorie === 'haustechnik' ? <span className="klein hinweis">Fest eingebaut ist das ein Teil des Gebäudes: Den Ersatz buchst du als Instandhaltung (sofort absetzbar) – hier nur für Garantie und Wartung.</span>
                : f.kategorie && <span className="klein hinweis">Übliche Nutzungsdauer: {kategorien?.find(([k]) => k === f.kategorie)?.[2] ?? 10} Jahre</span>}
            </div>
          )} />
      )}
    </section>
  );
}
