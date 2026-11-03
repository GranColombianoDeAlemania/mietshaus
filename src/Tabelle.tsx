// Shared table for long lists (TanStack Table + Virtual): sorting by a click on the heading, a quick filter, arrow keys
// to move between rows and Enter to open one. From 200 rows on only the visible rows are drawn, so a journal with
// thousands of postings scrolls smoothly.
import { useMemo, useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Row } from './api';

export type TSpalte<T> = {
  id: string;
  titel: ReactNode;
  wert: (r: T) => ReactNode;
  // Value to sort by; without it the column does not sort.
  sortWert?: (r: T) => string | number | null | undefined;
  klasse?: string;
};

const falten = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
const AB = 200;

export function Tabelle<T extends Row>(props: {
  zeilen: T[] | undefined;
  spalten: TSpalte<T>[];
  // Text the quick filter searches in; default: all sort values.
  suchText?: (r: T) => string;
  suche?: string;
  zeilenProps?: (r: T) => HTMLAttributes<HTMLTableRowElement> & Record<`data-${string}`, string>;
  aktionen?: (r: T) => ReactNode;
  onOeffnen?: (r: T) => void;
  leer?: ReactNode;
  className?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [fokus, setFokus] = useState(-1);
  const behaelter = useRef<HTMLDivElement>(null);
  const spalten = props.spalten;
  const columns = useMemo<ColumnDef<T>[]>(() => spalten.map((s) => ({
    id: s.id,
    accessorFn: (r: T) => s.sortWert?.(r) ?? null,
    enableSorting: !!s.sortWert,
    sortUndefined: 'last',
    sortingFn: (a, b, id) => {
      const x = a.getValue(id) as string | number | null, y = b.getValue(id) as string | number | null;
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'de', { numeric: true });
    },
  })), [spalten]);
  const such = (r: T) => falten(props.suchText ? props.suchText(r) : spalten.map((s) => s.sortWert?.(r) ?? '').join(' '));
  const table = useReactTable({
    data: props.zeilen ?? [],
    columns,
    state: { sorting, globalFilter: props.suche ?? '' },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _id, f: string) => !f || such(row.original).includes(falten(f)),
    getRowId: (r, i) => String(r.id ?? i),
  });
  const rows = table.getRowModel().rows;
  const virtuell = rows.length > AB;
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => behaelter.current, estimateSize: () => 37, overscan: 12, enabled: virtuell });
  const items = virtuell ? v.getVirtualItems() : null;
  const sichtbar = items ? items.map((i) => ({ row: rows[i.index], pos: i.index })) : rows.map((row, pos) => ({ row, pos }));
  const oben = items?.[0]?.start ?? 0;
  const unten = items?.length ? v.getTotalSize() - items[items.length - 1].end : 0;

  // Arrow keys move between rows, Home/End jump, Enter opens.
  const taste = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, select, textarea, button, a')) return;
    const n = e.key === 'ArrowDown' ? fokus + 1 : e.key === 'ArrowUp' ? fokus - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : null;
    if (n != null) {
      e.preventDefault();
      const z = Math.max(0, Math.min(rows.length - 1, n));
      setFokus(z);
      if (virtuell) v.scrollToIndex(z, { align: 'auto' });
      requestAnimationFrame(() => behaelter.current?.querySelector<HTMLElement>(`tr[data-pos="${z}"]`)?.focus());
    } else if (e.key === 'Enter' && fokus >= 0 && props.onOeffnen) {
      e.preventDefault();
      props.onOeffnen(rows[fokus].original);
    }
  };

  return (
    <div ref={behaelter} className={`tabelle${virtuell ? ' virtuell' : ''}`}>
      <table className={props.className}>
        <thead>
          <tr>
            {table.getHeaderGroups()[0].headers.map((h, i) => {
              const s = spalten[i];
              const richtung = h.column.getIsSorted();
              return (
                <th key={h.id} className={`${s.klasse ?? ''}${s.sortWert ? ' sortierbar' : ''}`} aria-sort={richtung === 'asc' ? 'ascending' : richtung === 'desc' ? 'descending' : undefined}
                  onClick={s.sortWert ? h.column.getToggleSortingHandler() : undefined}>
                  {s.titel}{richtung === 'asc' ? <ChevronUp size={12} aria-hidden="true" /> : richtung === 'desc' ? <ChevronDown size={12} aria-hidden="true" /> : null}
                </th>
              );
            })}
            {props.aktionen && <th />}
          </tr>
        </thead>
        <tbody onKeyDown={taste}>
          {oben > 0 && <tr aria-hidden="true" style={{ height: oben }} />}
          {sichtbar.map(({ row, pos }) => {
            const zp = props.zeilenProps?.(row.original) ?? {};
            return (
              <tr key={row.id} {...zp} data-pos={pos} tabIndex={pos === fokus || (fokus < 0 && pos === 0) ? 0 : -1} onFocus={() => setFokus(pos)}
                onDoubleClick={props.onOeffnen ? () => props.onOeffnen!(row.original) : zp.onDoubleClick}>
                {spalten.map((s) => <td key={s.id} className={s.klasse}>{s.wert(row.original)}</td>)}
                {props.aktionen && <td className="aktionen">{props.aktionen(row.original)}</td>}
              </tr>
            );
          })}
          {unten > 0 && <tr aria-hidden="true" style={{ height: unten }} />}
          {props.zeilen && !rows.length && <tr><td colSpan={spalten.length + 1} className="hinweis">{props.leer ?? 'Keine Einträge.'}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
