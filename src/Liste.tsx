// Generic list page: table of rows plus add/edit dialog, for the simpler record types.
import { useState, type ReactNode } from 'react';
import { call, type Row } from './api';
import { FormDialog, type Field } from './Form';
import { useLoad } from './useLoad';

export type Spalte = [titel: string, wert: (r: Row) => ReactNode, klasse?: string];

export function Liste(props: {
  titel: string;
  table: string;
  laden?: () => Promise<Row[]>;
  filter?: Row;
  order?: string;
  spalten: Spalte[];
  fields: Field[] | ((r: Row) => Field[]);
  neu?: Row;
  neuLabel?: string;
  hinweis?: ReactNode;
  aktionen?: (r: Row, reload: () => void) => ReactNode;
  kopf?: (rows: Row[], reload: () => void) => ReactNode;
  zeilenKlasse?: (r: Row) => string;
}) {
  const [rows, reload] = useLoad<Row[]>(
    () => props.laden?.() ?? call('liste', props.table, props.filter ?? {}, props.order ?? 'id'),
    [props.table, JSON.stringify(props.filter ?? {})],
  );
  const [edit, setEdit] = useState<Row | null>(null);
  return (
    <section>
      <div className="toolbar">
        <h1>{props.titel}</h1>
        <span className="spacer" />
        {props.kopf?.(rows ?? [], reload)}
        <button className="primary" onClick={() => setEdit({ ...(props.filter ?? {}), ...(props.neu ?? {}) })}>{props.neuLabel ?? 'Neu'}</button>
      </div>
      {props.hinweis && <p className="hinweis klein">{props.hinweis}</p>}
      <table>
        <thead><tr>{props.spalten.map(([t, , k]) => <th key={t} className={k}>{t}</th>)}{props.aktionen && <th />}</tr></thead>
        <tbody>
          {rows?.map((r) => (
            <tr key={r.id} className={props.zeilenKlasse?.(r)} onDoubleClick={() => setEdit(r)}>
              {props.spalten.map(([t, f, k]) => <td key={t} className={k}>{f(r)}</td>)}
              {props.aktionen && <td className="aktionen">{props.aktionen(r, reload)}</td>}
            </tr>
          ))}
          {rows && !rows.length && <tr><td colSpan={props.spalten.length + 1} className="hinweis">Noch keine Einträge.</td></tr>}
        </tbody>
      </table>
      {edit && (
        <FormDialog
          title={edit.id ? 'Bearbeiten' : props.neuLabel ?? 'Neu'}
          fields={props.fields}
          row={edit}
          onSave={(r) => call('save', props.table, { ...(props.filter ?? {}), ...r })}
          onDelete={() => call('remove', props.table, edit.id)}
          onClose={() => { setEdit(null); reload(); }}
        />
      )}
    </section>
  );
}
