import type { FieldDef } from './types';

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  timeZone: 'UTC',
});

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });

/** Full currency, for line amounts and totals. */
export function money(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Abbreviated currency for KPI tiles.
 *
 * A headline figure is there to be grasped, not audited; the exact number is
 * always a click away on the record itself.
 */
export function moneyShort(value: number, currency = 'USD'): string {
  const abs = Math.abs(value);
  const symbol = currency === 'USD' ? '$' : '';
  if (abs >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${symbol}${Math.round(value / 1_000)}K`;
  return `${symbol}${Math.round(value)}`;
}

export function count(value: number): string {
  return Math.round(value).toLocaleString();
}

export function days(value: number): string {
  return `${value.toFixed(1)}d`;
}

export function formatDate(value: string | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

export function formatDateTime(value: string | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateTimeFormatter.format(parsed);
}

/** Compact relative time: "3d ago", "2h ago", "just now". */
export function formatRelative(value: string | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  const diffMs = Date.now() - parsed.getTime();
  const minutes = Math.round(diffMs / 60_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const dayCount = Math.round(hours / 24);
  if (dayCount < 31) return `${dayCount}d ago`;

  const months = Math.round(dayCount / 30);
  return `${months}mo ago`;
}

/** Renders a raw OData value for display, using the declared field type. */
export function formatValue(field: FieldDef, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';

  switch (field.type) {
    case 'date':
      return formatDate(String(value));
    case 'datetime':
      return formatDateTime(String(value));
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

/** Today in the YYYY-MM-DD shape a native date input expects. */
export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
