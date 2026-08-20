import { formatValue, statusTone } from '../lib/format';
import type { FieldDef, Record365 } from '../lib/types';
import { Badge, EmptyState } from './Feedback';

interface DataTableProps {
  fields: FieldDef[];
  rows: Record365[];
  /** Makes rows activatable by mouse and keyboard. */
  onRowActivate?: (row: Record365) => void;
  emptyTitle: string;
  emptyHint?: string;
}

/** Generic table driven by field descriptors rather than fixed columns. */
export function DataTable({
  fields,
  rows,
  onRowActivate,
  emptyTitle,
  emptyHint,
}: DataTableProps) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {fields.map((field) => (
              <th
                key={field.name}
                scope="col"
                className={isNumeric(field) ? 'table__cell--numeric' : undefined}
              >
                {field.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const key =
              fields
                .filter((f) => f.key)
                .map((f) => String(row[f.name] ?? ''))
                .join('|') || String(index);

            return (
              <tr
                key={key}
                className={onRowActivate ? 'table__row--clickable' : undefined}
                // Rows stay reachable by keyboard when they are activatable;
                // without this the detail view would be mouse-only. The row
                // keeps its native row role so the table structure survives
                // for screen readers.
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
                {fields.map((field) => (
                  <td
                    key={field.name}
                    className={isNumeric(field) ? 'table__cell--numeric' : undefined}
                    data-label={field.label}
                  >
                    {isStatus(field) ? (
                      <Badge tone={statusTone(row[field.name])}>
                        {formatValue(field, row[field.name])}
                      </Badge>
                    ) : (
                      formatValue(field, row[field.name])
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const isNumeric = (field: FieldDef) => field.type === 'number' || field.type === 'integer';
const isStatus = (field: FieldDef) => field.type === 'enum' && /status/i.test(field.name);
