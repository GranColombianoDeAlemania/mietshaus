import { useEffect, useState, type ReactNode } from 'react';
import { call, parseZahl, type Row } from './api';
import { strasseTeilen, strasseVerbinden } from './adresse';
import { orteZurPlz } from './plz';
import { bestaetigen } from './frage';

export type Field = {
  key: string;
  label: string;
  // 'strasse': street and house number in two inputs, stored together in one column.
  // 'plz': a German postcode fills the place field named in `ort` (or offers its places).
  type?: 'text' | 'number' | 'money' | 'date' | 'select' | 'textarea' | 'check' | 'strasse' | 'plz';
  ort?: string;
  options?: [value: string | number, label: string][];
  required?: boolean;
  wide?: boolean;
  section?: string;
};

// Converts a stored row into editable strings; money is stored in cents and edited in euros.
function toForm(fields: Field[], row: Row): Row {
  const f: Row = {};
  for (const d of fields) {
    const v = row[d.key];
    if (d.type === 'check') f[d.key] = !!v;
    else if (d.type === 'money') f[d.key] = v == null ? '' : (v / 100).toFixed(2).replace('.', ',');
    else if (d.type === 'number') f[d.key] = v == null ? '' : String(v).replace('.', ',');
    else if (d.type === 'strasse') [f[d.key], f[`${d.key}_nr`]] = strasseTeilen(v);
    else f[d.key] = v ?? '';
  }
  return f;
}

function fromForm(fields: Field[], f: Row): Row {
  const r: Row = {};
  for (const d of fields) {
    const v = f[d.key] ?? '';
    if (d.type === 'check') r[d.key] = v ? 1 : 0;
    else if (d.type === 'money') r[d.key] = Math.round((parseZahl(v) ?? 0) * 100);
    else if (d.type === 'number') r[d.key] = parseZahl(v);
    else if (d.type === 'select') r[d.key] = v === '' ? null : isNaN(Number(v)) ? v : Number(v);
    else if (d.type === 'strasse') r[d.key] = strasseVerbinden(v, f[`${d.key}_nr`]);
    else r[d.key] = typeof v === 'string' ? v.trim() : v;
  }
  return r;
}

// "Zuletzt geändert von Erika am 3. Nov., 14:20" from the change columns of a record; the names are loaded once.
let namen: Promise<{ benutzer: Record<string, string>; geraete: Record<string, string> }> | null = null;
export function Geaendert(props: { row: Row }) {
  const [wer, setWer] = useState<string | null>(null);
  const r = props.row;
  useEffect(() => {
    if (!r.geaendert_am) return;
    namen ??= call('aenderungsNamen').catch(() => ({ benutzer: {}, geraete: {} }));
    namen.then((n) => setWer((r.geaendert_benutzer != null && n.benutzer[r.geaendert_benutzer]) || (r.geaendert_von && n.geraete[r.geaendert_von]) || null));
  }, [r.geaendert_am, r.geaendert_benutzer, r.geaendert_von]);
  if (!r.id || !r.geaendert_am) return null;
  const wann = new Date(r.geaendert_am).toLocaleString('de-DE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return <span className="klein hinweis geaendert">Zuletzt geändert{wer ? ` von ${wer}` : ''} am {wann}</span>;
}

export function FormDialog(props: {
  title: string;
  // A function lets the visible fields depend on what is currently entered.
  fields: Field[] | ((current: Row) => Field[]);
  row: Row;
  onSave: (row: Row) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
  onClose: () => void;
  // Extra content below the fields; a function gets the values as currently entered (as text) and can set some.
  extra?: ReactNode | ((current: Row, setze: (werte: Row) => void) => ReactNode);
}) {
  const felderFuer = (r: Row) => (typeof props.fields === 'function' ? props.fields(r) : props.fields);
  const [f0, setF] = useState(() => toForm(felderFuer(props.row), props.row));
  const [fehler, setFehler] = useState('');
  // Places offered for a postcode, by the key of the place field.
  const [orte, setOrte] = useState<Record<string, string[]>>({});
  // A field that appears later (e.g. once a date is entered) starts with the stored value.
  const fields = felderFuer({ ...props.row, ...f0 });
  const f: Row = { ...toForm(fields.filter((d) => !(d.key in f0)), props.row), ...f0 };

  const missing = fields.filter((d) => d.required && (f[d.key] === '' || f[d.key] == null));

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      props.onClose();
    } catch (e: any) {
      setFehler(String(e?.message ?? e).replace(/^Error invoking remote method 'db': (Error: )?/, ''));
    }
  }

  let section: string | undefined;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!missing.length) run(() => props.onSave({ ...(props.row.id ? { id: props.row.id } : {}), ...fromForm(fields, f) }));
        }}
      >
        <h2>{props.title}</h2>
        <div className="grid">
          {fields.flatMap((d) => {
            const out = [];
            if (d.section && d.section !== section) {
              section = d.section;
              out.push(<h3 key={'s' + d.key}>{d.section}</h3>);
            }
            const set = (v: unknown) => {
              setF({ ...f, [d.key]: v });
              if (d.type === 'plz' && d.ort) {
                const ort = d.ort;
                orteZurPlz(v).then((liste) => {
                  setOrte((o) => ({ ...o, [ort]: liste }));
                  if (liste.length === 1) setF((alt) => (String(alt[ort] ?? '').trim() ? alt : { ...alt, [ort]: liste[0] }));
                });
              }
            };
            const label = d.label + (d.required ? ' *' : '');
            let input;
            if (d.type === 'select')
              input = (
                <select value={f[d.key] ?? ''} onChange={(e) => set(e.target.value)}>
                  <option value="" disabled={d.required}>{d.required ? '– bitte wählen –' : '–'}</option>
                  {d.options!.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              );
            else if (d.type === 'strasse')
              input = (
                <span className="strasse-nr">
                  <input value={f[d.key] ?? ''} onChange={(e) => set(e.target.value)} />
                  <input aria-label="Hausnummer" placeholder="Nr." value={f[`${d.key}_nr`] ?? ''} onChange={(e) => setF({ ...f, [`${d.key}_nr`]: e.target.value })} />
                </span>
              );
            else if (d.type === 'textarea') input = <textarea rows={3} value={f[d.key] ?? ''} onChange={(e) => set(e.target.value)} />;
            else if (d.type === 'check')
              return [...out, (
                <label key={d.key} className="check">
                  <input type="checkbox" checked={!!f[d.key]} onChange={(e) => set(e.target.checked)} /> {d.label}
                </label>
              )];
            else
              input = (
                <input
                  type={d.type === 'date' ? 'date' : 'text'}
                  inputMode={d.type === 'money' || d.type === 'number' ? 'decimal' : d.type === 'plz' ? 'numeric' : undefined}
                  className={d.type === 'money' || d.type === 'number' ? 'num' : undefined}
                  value={f[d.key] ?? ''}
                  onChange={(e) => set(e.target.value)}
                  list={orte[d.key]?.length > 1 ? `orte-${d.key}` : undefined}
                />
              );
            if (orte[d.key]?.length > 1)
              input = <>{input}<datalist id={`orte-${d.key}`}>{orte[d.key].map((o) => <option key={o} value={o} />)}</datalist></>;
            return [...out, (
              <label key={d.key} className={d.wide || d.type === 'textarea' ? 'wide' : undefined}>
                <span>{label}{d.type === 'money' ? ' (€)' : d.type === 'strasse' ? ' und Hausnummer' : ''}</span>
                {input}
              </label>
            )];
          })}
        </div>
        {typeof props.extra === 'function' ? props.extra({ ...props.row, ...f }, (werte) => setF({ ...f, ...werte })) : props.extra}
        {fehler && <p className="fehler">{fehler}</p>}
        <div className="buttons">
          <Geaendert row={props.row} />
          {props.onDelete && props.row.id && (
            <button type="button" className="danger" onClick={async () => await bestaetigen('Wirklich löschen?') && run(props.onDelete!)}>
              Löschen
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={props.onClose}>Abbrechen</button>
          <button type="submit" className="primary" disabled={missing.length > 0} title={missing.length ? 'Pflichtfelder fehlen' : ''}>
            Speichern
          </button>
        </div>
      </form>
    </div>
  );
}
