import { useState, type ReactNode } from 'react';
import { parseZahl, type Row } from './api';
import { bestaetigen } from './frage';

export type Field = {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'money' | 'date' | 'select' | 'textarea' | 'check';
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
    else r[d.key] = typeof v === 'string' ? v.trim() : v;
  }
  return r;
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
            const set = (v: unknown) => setF({ ...f, [d.key]: v });
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
                  inputMode={d.type === 'money' || d.type === 'number' ? 'decimal' : undefined}
                  className={d.type === 'money' || d.type === 'number' ? 'num' : undefined}
                  value={f[d.key] ?? ''}
                  onChange={(e) => set(e.target.value)}
                />
              );
            return [...out, (
              <label key={d.key} className={d.wide || d.type === 'textarea' ? 'wide' : undefined}>
                <span>{label}{d.type === 'money' ? ' (€)' : ''}</span>
                {input}
              </label>
            )];
          })}
        </div>
        {typeof props.extra === 'function' ? props.extra({ ...props.row, ...f }, (werte) => setF({ ...f, ...werte })) : props.extra}
        {fehler && <p className="fehler">{fehler}</p>}
        <div className="buttons">
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
