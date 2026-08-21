import { APPROVAL_STAGES } from './reference.js';
import type { Analytics, AnalyticsBucket, RequisitionSummary } from './model.js';

function rollup(
  items: RequisitionSummary[],
  keyOf: (r: RequisitionSummary) => string,
  limit?: number,
): AnalyticsBucket[] {
  const totals = new Map<string, { value: number; count: number }>();

  for (const item of items) {
    const key = keyOf(item);
    const current = totals.get(key) ?? { value: 0, count: 0 };
    current.value += item.totalAmount;
    current.count += 1;
    totals.set(key, current);
  }

  const buckets = [...totals.entries()]
    .map(([label, { value, count }]) => ({
      label,
      value: Math.round(value),
      count,
    }))
    .sort((a, b) => b.value - a.value);

  return limit ? buckets.slice(0, limit) : buckets;
}

// Formatted in UTC to match the UTC-derived sort key below. Mixing the two
// puts a date near a month boundary under one month's label but another
// month's sort key, which silently scrambles the order of the trend chart.
const MONTH_LABEL = new Intl.DateTimeFormat('en', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});

function byMonth(items: RequisitionSummary[]): AnalyticsBucket[] {
  const totals = new Map<string, { value: number; count: number; sort: string }>();

  for (const item of items) {
    const date = new Date(item.createdDate);
    if (Number.isNaN(date.getTime())) continue;
    const sort = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = MONTH_LABEL.format(date);
    const current = totals.get(label) ?? { value: 0, count: 0, sort };
    current.value += item.totalAmount;
    current.count += 1;
    totals.set(label, current);
  }

  // Chronological, not by size: a spend-over-time chart sorted by value is
  // meaningless.
  return [...totals.entries()]
    .sort((a, b) => a[1].sort.localeCompare(b[1].sort))
    .map(([label, { value, count }]) => ({ label, value: Math.round(value), count }));
}

/**
 * Flags requisitions whose value is far above the norm for their category.
 *
 * Uses a median multiple rather than a mean: a single very large requisition
 * drags a mean upward enough to hide itself, which is exactly the case this is
 * meant to surface.
 */
function findAnomalies(items: RequisitionSummary[]): Analytics['anomalies'] {
  const byCategory = new Map<string, number[]>();
  for (const item of items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item.totalAmount);
    byCategory.set(item.category, list);
  }

  const medians = new Map<string, number>();
  for (const [category, amounts] of byCategory) {
    const sorted = [...amounts].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
        : (sorted[mid] ?? 0);
    medians.set(category, median);
  }

  return items
    .filter((item) => {
      const median = medians.get(item.category) ?? 0;
      return median > 0 && item.totalAmount > median * 2.5;
    })
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 4)
    .map((item) => {
      const median = medians.get(item.category) ?? 1;
      const multiple = (item.totalAmount / median).toFixed(1);
      return {
        requisitionNumber: item.requisitionNumber,
        department: item.department,
        vendor: item.vendor,
        amount: item.totalAmount,
        reason: `${multiple}x the median ${item.category} requisition`,
      };
    });
}

/** Stages holding materially older work than the overall median age. */
function findBottlenecks(items: RequisitionSummary[]): Analytics['bottlenecks'] {
  const open = items.filter((i) => i.approvalStage !== 'Approved');
  const byStage = new Map<string, number[]>();

  for (const item of open) {
    const list = byStage.get(item.approvalStage) ?? [];
    list.push(item.ageDays);
    byStage.set(item.approvalStage, list);
  }

  return [...byStage.entries()]
    .map(([stage, ages]) => ({
      stage,
      count: ages.length,
      averageAgeDays: Math.round(ages.reduce((a, b) => a + b, 0) / ages.length),
    }))
    .filter((b) => b.averageAgeDays >= 10)
    .sort((a, b) => b.averageAgeDays - a.averageAgeDays);
}

export function computeAnalytics(items: RequisitionSummary[]): Analytics {
  const open = items.filter((i) => i.approvalStage !== 'Approved');
  const pending = items.filter(
    (i) => i.approvalStage === 'Manager Approval' || i.approvalStage === 'Purchasing',
  );
  const approved = items.filter((i) => i.approvalStage === 'Approved');

  const averageApprovalDays =
    approved.length > 0
      ? Math.round((approved.reduce((sum, i) => sum + i.ageDays, 0) / approved.length) * 10) / 10
      : 0;

  return {
    totals: {
      openRequisitions: open.length,
      pendingApproval: pending.length,
      totalRequestedSpend: Math.round(items.reduce((sum, i) => sum + i.totalAmount, 0)),
      averageApprovalDays,
      syncedCount: items.filter((i) => i.syncState === 'synced').length,
      pendingSyncCount: items.filter((i) => i.syncState === 'pending').length,
      errorSyncCount: items.filter((i) => i.syncState === 'error').length,
      currency: 'USD',
    },
    byStatus: rollup(items, (r) => r.status),
    byStage: APPROVAL_STAGES.map((stage) => {
      const inStage = items.filter((r) => r.approvalStage === stage);
      return {
        label: stage,
        value: Math.round(inStage.reduce((sum, r) => sum + r.totalAmount, 0)),
        count: inStage.length,
      };
    }),
    byDepartment: rollup(items, (r) => r.department),
    byVendor: rollup(items, (r) => r.vendor, 8),
    byCategory: rollup(items, (r) => r.category, 8),
    byMonth: byMonth(items),
    bottlenecks: findBottlenecks(items),
    anomalies: findAnomalies(items),
  };
}
