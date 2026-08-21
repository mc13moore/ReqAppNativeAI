import type { Analytics, AnalyticsBucket, RequisitionSummary } from './model.js';

/**
 * Statuses that mean the requisition is no longer in flight.
 *
 * Matched loosely because F&O status vocabulary varies by version; anything
 * unrecognised counts as open, which is the safer default for a figure labelled
 * "open requisitions".
 */
const CLOSED_STATUSES = ['closed', 'cancelled', 'canceled', 'rejected', 'complete'];

const isClosed = (status: string): boolean => {
  const value = status.toLowerCase();
  return CLOSED_STATUSES.some((closed) => value.includes(closed));
};

function rollup(
  items: RequisitionSummary[],
  keysOf: (r: RequisitionSummary) => string[],
  limit?: number,
): AnalyticsBucket[] {
  const totals = new Map<string, { value: number; count: number }>();

  for (const item of items) {
    const keys = keysOf(item).filter((k) => k.trim());
    if (keys.length === 0) continue;

    // A requisition spanning several vendors or categories would double-count
    // if its full value were added to each. Splitting it evenly keeps the
    // chart total equal to the real total.
    const share = item.totalAmount / keys.length;

    for (const key of keys) {
      const current = totals.get(key) ?? { value: 0, count: 0 };
      current.value += share;
      current.count += 1;
      totals.set(key, current);
    }
  }

  const buckets = [...totals.entries()]
    .map(([label, { value, count }]) => ({ label, value: Math.round(value), count }))
    .sort((a, b) => b.value - a.value);

  return limit ? buckets.slice(0, limit) : buckets;
}

// Formatted in UTC to match the UTC-derived sort key, so a date near a month
// boundary cannot land under one month's label and another month's sort key.
const MONTH_LABEL = new Intl.DateTimeFormat('en', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});

function byMonth(items: RequisitionSummary[]): AnalyticsBucket[] {
  const totals = new Map<string, { value: number; count: number; sort: string }>();

  for (const item of items) {
    // Requested date is the business date on the header; accounting date is
    // the fallback when a requisition has no requested date recorded.
    const source = item.requestedDate || item.accountingDate;
    if (!source) continue;

    const date = new Date(source);
    if (Number.isNaN(date.getTime())) continue;

    const sort = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = MONTH_LABEL.format(date);
    const current = totals.get(label) ?? { value: 0, count: 0, sort };
    current.value += item.totalAmount;
    current.count += 1;
    totals.set(label, current);
  }

  return [...totals.entries()]
    .sort((a, b) => a[1].sort.localeCompare(b[1].sort))
    .map(([label, { value, count }]) => ({ label, value: Math.round(value), count }));
}

/** Minimum records in a category before a median is worth comparing against. */
const MIN_SAMPLE_FOR_OUTLIERS = 6;
const OUTLIER_MULTIPLE = 2.5;

function findOutliers(items: RequisitionSummary[]): Analytics['outliers'] {
  const byCategory = new Map<string, RequisitionSummary[]>();

  for (const item of items) {
    if (!item.hasLineData) continue;
    // Only single-category requisitions: comparing a mixed requisition against
    // one category's median would not be a like-for-like comparison.
    const category = item.categories.length === 1 ? item.categories[0]! : '';
    if (!category) continue;
    const list = byCategory.get(category) ?? [];
    list.push(item);
    byCategory.set(category, list);
  }

  const outliers: Analytics['outliers'] = [];

  for (const [category, group] of byCategory) {
    if (group.length < MIN_SAMPLE_FOR_OUTLIERS) continue;

    const sorted = group.map((g) => g.totalAmount).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
        : (sorted[mid] ?? 0);

    if (median <= 0) continue;

    for (const item of group) {
      if (item.totalAmount > median * OUTLIER_MULTIPLE) {
        outliers.push({
          requisitionNumber: item.requisitionNumber,
          category,
          amount: item.totalAmount,
          medianAmount: Math.round(median),
          multiple: Math.round((item.totalAmount / median) * 10) / 10,
        });
      }
    }
  }

  return outliers.sort((a, b) => b.amount - a.amount).slice(0, 5);
}

export function computeAnalytics(items: RequisitionSummary[]): Analytics {
  const withLines = items.filter((i) => i.hasLineData);
  const totalSpend = Math.round(items.reduce((sum, i) => sum + i.totalAmount, 0));

  return {
    totals: {
      requisitions: items.length,
      openRequisitions: items.filter((i) => !isClosed(i.status)).length,
      onHold: items.filter((i) => i.onHold).length,
      totalRequestedSpend: totalSpend,
      averageValue: withLines.length > 0 ? Math.round(totalSpend / withLines.length) : 0,
      lineCount: items.reduce((sum, i) => sum + i.lineCount, 0),
      currency: items.find((i) => i.currency)?.currency ?? 'USD',
      withoutLineData: items.length - withLines.length,
    },
    byStatus: rollup(items, (r) => (r.status ? [r.status] : [])),
    byCategory: rollup(items, (r) => r.categories, 10),
    byVendor: rollup(items, (r) => r.vendors, 10),
    byLegalEntity: rollup(items, (r) => (r.company ? [r.company] : [])),
    byPreparer: rollup(
      items,
      (r) => (r.preparerPersonnelNumber ? [r.preparerPersonnelNumber] : []),
      8,
    ),
    byMonth: byMonth(items),
    outliers: findOutliers(items),
  };
}
