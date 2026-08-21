import { useMemo, useState, type ReactNode } from 'react';
import { EmptyState } from './primitives';

export interface Column<T> {
  key: string;
  header: string;
  /** Rendered cell content. */
  render: (row: T) => ReactNode;
  /** Value used for client-side sorting; omit to make the column unsortable. */
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right';
  width?: string;
}

interface DataGridProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowActivate?: (row: T) => void;
  emptyTitle?: string;
  emptyHint?: string;
  /** Initial sort column key. */
  defaultSort?: string;
  defaultDirection?: 'asc' | 'desc';
}

/**
 * Sortable table.
 *
 * Sorting is client-side over the rows already supplied; the server handles
 * filtering and paging. That split keeps interaction instant for the page in
 * view without pulling the whole data set forward.
 */
export function DataGrid<T>({
  columns,
  rows,
  rowKey,
  onRowActivate,
  emptyTitle = 'Nothing to show',
  emptyHint,
  defaultSort,
  defaultDirection = 'desc',
}: DataGridProps<T>) {
  const [sortKey, setSortKey] = useState<string | undefined>(defaultSort);
  const [direction, setDirection] = useState<'asc' | 'desc'>(defaultDirection);

  const sorted = useMemo(() => {
    const column = columns.find((c) => c.key === sortKey);
    if (!column?.sortValue) return rows;

    const factor = direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = column.sortValue!(a);
      const right = column.sortValue!(b);
      if (typeof left === 'number' && typeof right === 'number') {
        return (left - right) * factor;
      }
      return String(left).localeCompare(String(right)) * factor;
    });
  }, [rows, columns, sortKey, direction]);

  const toggle = (key: string) => {
    if (sortKey === key) {
      setDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setDirection('desc');
    }
  };

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={column.align === 'right' ? 'num' : undefined}
                style={column.width ? { width: column.width } : undefined}
                aria-sort={
                  sortKey === column.key
                    ? direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                {column.sortValue ? (
                  <button type="button" onClick={() => toggle(column.key)}>
                    {column.header}
                    <span
                      className={`sort-arrow${sortKey === column.key ? ' sort-arrow--active' : ''}`}
                      aria-hidden="true"
                    >
                      {sortKey === column.key && direction === 'asc' ? '↑' : '↓'}
                    </span>
                  </button>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowActivate ? 'clickable' : undefined}
              tabIndex={onRowActivate ? 0 : undefined}
              onClick={onRowActivate ? () => onRowActivate(row) : undefined}
              onKeyDown={
                onRowActivate
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onRowActivate(row);
                      }
                    }
                  : undefined
              }
            >
              {columns.map((column) => (
                <td key={column.key} className={column.align === 'right' ? 'num' : undefined}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
