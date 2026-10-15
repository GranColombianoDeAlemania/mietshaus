import { useState } from 'react';
import { call, datum, euro, personName, type Modus, type Row } from '../api';
import { FormDialog, type Field } from '../Form';
import { useLoad } from '../useLoad';

// One screen for both contract kinds: tenancies (Miete) and ownership (WEG).
const ART = {
  miete: {
    table: 'mietverhaeltnisse',
    titel: 'Mieter',
    neu: 'Neues Mietverhältnis',
    person: 'Mieter',
    felder: [
      { key: 'kaltmiete_ct', label: 'Kaltmiete', type: 'money', section: 'Monatliche Zahlungen bei Vertragsbeginn (spätere Änderungen unter „Mietanpassungen“)' },
      { key: 'bk_vz_ct', label: 'Betriebskosten-Vorauszahlung', type: 'money' },
      { key: 'hk_vz_ct', label: 'Heizkosten-Vorauszahlung', type: 'money' },
      { key: 'sonstiges_ct', label: 'Sonstiges (z. B. Stellplatz)', type: 'money' },
      { key: 'faelligkeitstag', label: 'Fällig am (Tag des Monats)', type: 'number' },
      { key: 'kaution_ct', label: 'Kaution', type: 'money', section: 'Weitere Angaben' },
      { key: 'personen_anzahl', label: 'Personen im Haushalt', type: 'number' },
    ] as Field[],
    summe: (v: Row) => v.akt_kaltmiete_ct + v.akt_bk_vz_ct + v.akt_hk_vz_ct + v.akt_sonstiges_ct,
  },
  weg: {
    table: 'eigentum',
    titel: 'Eigentümer',
    neu: 'Neuer Eigentümer',
    person: 'Eigentümer',
    felder: [
      { key: 'hausgeld_ct', label: 'Hausgeld', type: 'money', section: 'Monatliche Zahlungen bei Beginn (spätere Änderungen über den Wirtschaftsplan)' },
      { key: 'ruecklage_ct', label: 'davon Erhaltungsrücklage', type: 'money' },
      { key: 'faelligkeitstag', label: 'Fällig am (Tag des Monats)', type: 'number' },
      { key: 'selbstnutzer', label: 'Bewohnt die Einheit selbst', type: 'check', section: 'Weitere Angaben' },
    ] as Field[],
    // The reserve share is part of the house money, not added on top.
    summe: (v: Row) => v.akt_hausgeld_ct,
  },
} as const;

export function Vertraege(props: { modus: Modus; objekt: Row }) {
  const a = ART[props.modus === 'weg' ? 'weg' : 'miete'];
  const [rows, reload] = useLoad<Row[]>(() => call('vertraege', a.table, props.objekt.id), [props.objekt.id, a.table]);
  const [einheiten] = useLoad<Row[]>(() => call('einheiten', props.objekt.id), [props.objekt.id]);
  const [personen, ladePersonen] = useLoad<Row[]>(() => call('personen'), []);
  const [edit, setEdit] = useState<Row | null>(null);
  const [nurAktuell, setNurAktuell] = useState(true);

  const personOpts: [number, string][] = (personen ?? []).map((p) => [p.id, personName(p)]);
  const felder: Field[] = [
    {
      key: 'einheit_id', label: 'Einheit', type: 'select', required: true,
      options: (einheiten ?? []).map((e) => [e.id, `${e.nr} – ${e.bezeichnung}`]),
    },
    { key: 'person_id', label: a.person, type: 'select', required: true, options: personOpts },
    { key: 'person2_id', label: `Weiterer ${a.person}`, type: 'select', options: personOpts },
    { key: 'beginn', label: 'Beginn', type: 'date', required: true },
    { key: 'ende', label: 'Ende', type: 'date' },
    ...a.felder,
    { key: 'lastschrift', label: 'Zahlt per SEPA-Lastschrift', type: 'check', section: 'Zahlungsweg' },
    { key: 'sepa_mandat', label: 'Mandatsreferenz' },
    { key: 'notiz', label: 'Notiz', type: 'textarea' },
  ];

  const sichtbar = rows?.filter((v) => !nurAktuell || v.aktuell) ?? [];
  const gesamt = sichtbar.filter((v) => v.aktuell).reduce((s, v) => s + a.summe(v), 0);

  return (
    <section>
      <div className="toolbar">
        <h1>{a.titel} – {props.objekt.bezeichnung}</h1>
        <span className="spacer" />
        <label className="check">
          <input type="checkbox" checked={nurAktuell} onChange={(e) => setNurAktuell(e.target.checked)} /> nur aktuelle
        </label>
        <button
          className="primary"
          disabled={!einheiten?.length || !personen?.length}
          title={!personen?.length ? 'Zuerst Personen im Adressbuch anlegen' : !einheiten?.length ? 'Zuerst Einheiten anlegen' : ''}
          onClick={() => setEdit({ beginn: new Date().toISOString().slice(0, 10), faelligkeitstag: props.modus === 'weg' ? 1 : 3, personen_anzahl: 1 })}
        >
          {a.neu}
        </button>
      </div>
      {!personen?.length && <p className="hinweis">Lege zuerst die Personen im Adressbuch an; hier ordnest du sie dann einer Einheit zu.</p>}
      {rows && !!personen?.length && sichtbar.length === 0 ? (
        <p className="hinweis">Keine {nurAktuell ? 'aktuellen ' : ''}Einträge für dieses Objekt.</p>
      ) : null}
      {sichtbar.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Einheit</th><th>{a.person}</th><th>Beginn</th><th>Ende</th>
              {props.modus === 'miete' ? (
                <><th className="num">Kaltmiete</th><th className="num">BK-VZ</th><th className="num">HK-VZ</th></>
              ) : (
                <><th className="num">Hausgeld</th><th className="num">Rücklage</th></>
              )}
              <th className="num">Monatlich</th>
            </tr>
          </thead>
          <tbody>
            {sichtbar.map((v) => (
              <tr key={v.id} className={v.aktuell ? '' : 'inaktiv'} onDoubleClick={() => setEdit(v)}>
                <td>{v.einheit_nr} – {v.einheit}</td>
                <td>{v.name}</td>
                <td>{datum(v.beginn)}</td>
                <td>{datum(v.ende)}</td>
                {props.modus === 'miete' ? (
                  <><td className="num">{euro(v.akt_kaltmiete_ct)}</td><td className="num">{euro(v.akt_bk_vz_ct)}</td><td className="num">{euro(v.akt_hk_vz_ct)}</td></>
                ) : (
                  <><td className="num">{euro(v.akt_hausgeld_ct)}</td><td className="num">{euro(v.akt_ruecklage_ct)}</td></>
                )}
                <td className="num"><b>{euro(a.summe(v))}</b>{v.angepasst ? <div className="klein hinweis" title="Durch Mietanpassung, Wirtschaftsplan oder neue Vorauszahlungen geändert">angepasst</div> : null}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={props.modus === 'miete' ? 7 : 6}>Summe Soll pro Monat (aktuelle Verträge)</td>
              <td className="num"><b>{euro(gesamt)}</b></td>
            </tr>
          </tfoot>
        </table>
      )}
      {edit && (
        <FormDialog
          title={edit.id ? `${a.person} bearbeiten` : a.neu}
          fields={felder}
          row={edit}
          onSave={async (r) => {
            if (r.ende && r.ende < r.beginn) throw new Error('Das Ende liegt vor dem Beginn.');
            return call('save', a.table, r);
          }}
          onDelete={() => call('remove', a.table, edit.id)}
          onClose={() => {
            setEdit(null);
            reload();
            ladePersonen();
          }}
        />
      )}
    </section>
  );
}
