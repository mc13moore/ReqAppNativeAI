import {
  getHeader,
  listAllLines,
  listHeaders,
  listLines,
  type Record365,
} from '../d365/requisitions.js';
import type {
  RequisitionDetailView,
  RequisitionLineView,
  RequisitionSummary,
} from './model.js';

/* ---------------------------------------------------------------------------
   Field readers
   --------------------------------------------------------------------------- */

const str = (record: Record365, field: string, fallback = ''): string => {
  const value = record[field];
  return typeof value === 'string' && value.trim() ? value : fallback;
};

const num = (record: Record365, field: string): number => {
  const value = record[field];
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** D365 exposes these as the strings "Yes" and "No" rather than booleans. */
const bool = (record: Record365, field: string): boolean => {
  const value = record[field];
  if (typeof value === 'boolean') return value;
  return String(value ?? '').toLowerCase() === 'yes';
};

export function mapLine(record: Record365): RequisitionLineView {
  const quantity = num(record, 'RequestedPurchaseQuantity');
  const unitPrice = num(record, 'PurchasePrice');
  // LineAmount is what D365 calculated. Falling back to quantity x price only
  // when it is absent keeps the displayed total the one D365 itself holds.
  const lineAmount = num(record, 'LineAmount') || Math.round(quantity * unitPrice * 100) / 100;

  return {
    lineNumber: num(record, 'RequisitionLineNumber'),
    lineType: str(record, 'LineType'),
    itemNumber: str(record, 'ItemNumber'),
    category: str(record, 'ProcurementProductCategoryName'),
    description: str(record, 'LineDescription'),
    quantity,
    unit: str(record, 'PurchaseUnitSymbol'),
    unitPrice,
    lineAmount,
    currency: str(record, 'CurrencyCode'),
    requestedDate: str(record, 'RequestedDate'),
    accountingDate: str(record, 'AccountingDate'),
    vendor: str(record, 'VendorAccountNumber'),
    warehouse: str(record, 'ReceivingWarehouseId'),
    site: str(record, 'ReceivingSiteId'),
    requisitioner: str(record, 'RequisitionerPersonnelNumber'),
    projectId: str(record, 'ProjectId'),
    justificationCode: str(record, 'BusinessJustificationCode'),
    justificationDetails: str(record, 'BusinessJustificationDetails'),
    deliveryAddress: str(record, 'FormattedDeliveryAddress'),
  };
}

/** Combines a header with its own lines. No value is invented. */
export function mapHeader(record: Record365, lines: RequisitionLineView[]): RequisitionSummary {
  const totalAmount = Math.round(lines.reduce((sum, l) => sum + l.lineAmount, 0) * 100) / 100;

  const distinct = (values: string[]): string[] =>
    [...new Set(values.filter((v) => v.trim()))].sort();

  return {
    requisitionNumber: str(record, 'RequisitionNumber'),
    name: str(record, 'RequisitionName'),
    status: str(record, 'RequisitionStatus'),
    purpose: str(record, 'RequisitionPurpose'),
    company: str(record, 'ProjectBuyingLegalEntityId'),
    preparerPersonnelNumber: str(record, 'PreparerPersonnelNumber'),
    requestedDate: str(record, 'DefaultRequestedDate'),
    accountingDate: str(record, 'DefaultAccountingDate'),
    onHold: bool(record, 'IsPurchaseRequisitionOnHold'),
    onHoldExplanation: str(record, 'OnHoldExplanation'),
    projectId: str(record, 'DefaultProjectId'),
    justificationCode: str(record, 'DefaultBusinessJustificationCode'),
    totalAmount,
    currency: lines.find((l) => l.currency)?.currency ?? '',
    lineCount: lines.length,
    vendors: distinct(lines.map((l) => l.vendor)),
    categories: distinct(lines.map((l) => l.category)),
    hasLineData: lines.length > 0,
  };
}

/* ---------------------------------------------------------------------------
   Loaders
   --------------------------------------------------------------------------- */

export interface LoadResult<T> {
  data: T;
  /** How many header records D365 returned. */
  headerCount: number;
  /** How many line records D365 returned. */
  lineCount: number;
  /** Set when lines could not be read; totals are then zero rather than wrong. */
  lineError?: string;
}

/**
 * Loads the requisition population from D365.
 *
 * Headers and lines are two reads, not one per requisition: the line entity is
 * fetched in bulk and grouped in memory. A failure to read lines is reported
 * rather than hidden -- the requisitions still list, but every total is zero
 * and the interface says so instead of showing a confident wrong number.
 */
export async function loadRequisitions(
  options: { top?: number; lineTop?: number } = {},
): Promise<LoadResult<RequisitionSummary[]>> {
  const headerResult = await listHeaders({ top: options.top ?? 200 });

  let linesByRequisition = new Map<string, RequisitionLineView[]>();
  let lineError: string | undefined;
  let lineCount = 0;

  try {
    const lineResult = await listAllLines(options.lineTop ?? 2000);
    lineCount = lineResult.value.length;

    linesByRequisition = lineResult.value.reduce((map, record) => {
      const key = str(record, 'RequisitionNumber');
      if (!key) return map;
      const list = map.get(key) ?? [];
      list.push(mapLine(record));
      map.set(key, list);
      return map;
    }, new Map<string, RequisitionLineView[]>());
  } catch (err) {
    lineError = err instanceof Error ? err.message : String(err);
  }

  const data = headerResult.value.map((record) => {
    const number = str(record, 'RequisitionNumber');
    return mapHeader(record, linesByRequisition.get(number) ?? []);
  });

  return { data, headerCount: headerResult.value.length, lineCount, lineError };
}

/** Loads one requisition with its own lines, read directly from D365. */
export async function loadRequisitionDetail(
  company: string,
  requisitionNumber: string,
): Promise<RequisitionDetailView> {
  const [header, lineResult] = await Promise.all([
    getHeader(company, requisitionNumber),
    listLines(company, requisitionNumber),
  ]);

  const lines = lineResult.value
    .map(mapLine)
    .sort((a, b) => a.lineNumber - b.lineNumber);

  const summary = mapHeader(header, lines);

  // Only attributes D365 actually populated. Rendering blank rows for every
  // possible field makes a sparse record look like a broken screen.
  const candidates: { label: string; value: string }[] = [
    { label: 'Purpose', value: summary.purpose },
    { label: 'Legal entity', value: summary.company },
    { label: 'Preparer', value: summary.preparerPersonnelNumber },
    { label: 'Project', value: summary.projectId },
    { label: 'Justification code', value: summary.justificationCode },
    { label: 'On-hold reason', value: summary.onHoldExplanation },
    { label: 'Delivery address', value: lines.find((l) => l.deliveryAddress)?.deliveryAddress ?? '' },
    { label: 'Site', value: lines.find((l) => l.site)?.site ?? '' },
    { label: 'Warehouse', value: lines.find((l) => l.warehouse)?.warehouse ?? '' },
  ];

  return {
    summary,
    lines,
    attributes: candidates.filter((a) => a.value.trim()),
    raw: header,
  };
}
