import type { FieldDef } from './types';

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
});

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const numberFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 4,
});

/** Renders a raw OData value for display, using the declared field type. */
export function formatValue(field: FieldDef, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';

  switch (field.type) {
    case 'date':
    case 'datetime': {
      const parsed = new Date(String(value));
      if (Number.isNaN(parsed.getTime())) return String(value);
      // D365 returns date-only fields as midnight UTC; showing a time there
      // would imply a precision the underlying field does not have.
      return field.type === 'date'
        ? dateFormatter.format(parsed)
        : dateTimeFormatter.format(parsed);
    }
    case 'number':
    case 'integer': {
      const n = Number(value);
      return Number.isFinite(n) ? numberFormatter.format(n) : String(value);
    }
    case 'boolean':
      return value ? 'Yes' : 'No';
    default:
      return String(value);
  }
}

/** Maps a D365 status string onto a badge tone. */
export function statusTone(status: unknown): string {
  const value = String(status ?? '').toLowerCase();
  if (value.includes('approv')) return 'ok';
  if (value.includes('reject') || value.includes('cancel')) return 'bad';
  if (value.includes('review') || value.includes('pending')) return 'warn';
  return 'neutral';
}

/** Today in the YYYY-MM-DD shape a native date input expects. */
export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
