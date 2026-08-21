import { config } from '../config.js';
import { getHeader, listHeaders, listLines, type Record365 } from '../d365/requisitions.js';
import { computeAnalytics } from './analytics.js';
import {
  buildDetail,
  deriveSummary,
  generateActivity,
  generateRequisitions,
} from './generate.js';
import type {
  ActivityEvent,
  Analytics,
  RequisitionDetailView,
  RequisitionLineView,
  RequisitionSummary,
} from './model.js';

export type DataSource = 'd365' | 'demo' | 'blended';

export interface WorkspaceResult<T> {
  data: T;
  source: DataSource;
  /** Present when D365 was attempted and failed. */
  liveError?: string;
  liveCount: number;
  demoCount: number;
}

const DEMO_POPULATION = 48;

/** Demo records are generated once per process so the data is stable. */
let cachedDemo: RequisitionSummary[] | null = null;

function demoPopulation(now: Date): RequisitionSummary[] {
  cachedDemo ??= generateRequisitions(DEMO_POPULATION, now);
  return cachedDemo;
}

/**
 * Maps a raw D365 header onto the presentation model.
 *
 * D365 does not carry department, vendor, approval stage or sync state on the
 * requisition header, so those are derived deterministically from the
 * requisition number. Everything D365 *does* provide wins over the derived
 * value, and the record is flagged `live` so the UI can distinguish it.
 */
function mapLiveHeader(record: Record365, now: Date): RequisitionSummary {
  const number = String(record['RequisitionNumber'] ?? '').trim() || 'UNKNOWN';

  const derived = deriveSummary(number, now, { live: true });

  const name = record['RequisitionName'];
  const status = record['RequisitionStatus'];
  const purpose = record['RequisitionPurpose'];
  const preparer = record['PreparerPersonnelNumber'];
  const legalEntity = record['ProjectBuyingLegalEntityId'];
  const requested = record['DefaultRequestedDate'];

  return {
    ...derived,
    live: true,
    name: typeof name === 'string' && name.trim() ? name : derived.name,
    status: typeof status === 'string' && status.trim() ? status : derived.status,
    purpose: typeof purpose === 'string' && purpose.trim() ? purpose : derived.purpose,
    company: typeof legalEntity === 'string' && legalEntity.trim() ? legalEntity : derived.company,
    requestedDate:
      typeof requested === 'string' && requested.trim() ? requested : derived.requestedDate,
    requester: {
      ...derived.requester,
      personnelNumber:
        typeof preparer === 'string' && preparer.trim()
          ? preparer
          : derived.requester.personnelNumber,
    },
  };
}

function mapLiveLine(record: Record365, fallbackCurrency: string): RequisitionLineView {
  const num = (value: unknown): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  const str = (value: unknown, fallback = ''): string =>
    typeof value === 'string' && value.trim() ? value : fallback;

  const quantity = num(record['RequestedPurchaseQuantity']);
  const unitPrice = num(record['PurchasePrice']);
  const lineAmount = num(record['LineAmount']) || Math.round(quantity * unitPrice * 100) / 100;

  return {
    lineNumber: num(record['RequisitionLineNumber']),
    lineType: str(record['LineType'], 'Item'),
    itemNumber: str(record['ItemNumber']),
    category: str(record['ProcurementProductCategoryName']),
    description: str(record['LineDescription'], '—'),
    quantity,
    unit: str(record['PurchaseUnitSymbol']),
    unitPrice,
    lineAmount,
    currency: str(record['CurrencyCode'], fallbackCurrency),
    requestedDate: str(record['RequestedDate']),
    vendor: str(record['VendorAccountNumber']),
    warehouse: str(record['ReceivingWarehouseId']),
    site: str(record['ReceivingSiteId']),
    requisitioner: str(record['RequisitionerPersonnelNumber']),
  };
}

function demoEnabled(): boolean {
  return config.DEMO_MODE !== 'off';
}

/**
 * Loads the requisition population.
 *
 * In 'auto' mode live D365 records are used when available and topped up with
 * demo records so the dashboards stay legible during a demonstration; a live
 * failure degrades to demo data rather than an empty screen. The result always
 * reports which sources contributed, and never presents demo records as live.
 */
export async function loadRequisitions(now = new Date()): Promise<WorkspaceResult<RequisitionSummary[]>> {
  let live: RequisitionSummary[] = [];
  let liveError: string | undefined;

  if (config.DEMO_MODE !== 'on') {
    try {
      const result = await listHeaders({ top: 200 });
      live = result.value.map((record) => mapLiveHeader(record, now));
    } catch (err) {
      liveError = err instanceof Error ? err.message : String(err);
    }
  }

  if (!demoEnabled()) {
    return { data: live, source: 'd365', liveError, liveCount: live.length, demoCount: 0 };
  }

  const liveNumbers = new Set(live.map((r) => r.requisitionNumber));
  const demo = demoPopulation(now).filter((r) => !liveNumbers.has(r.requisitionNumber));

  const data = [...live, ...demo].sort((a, b) =>
    b.createdDate.localeCompare(a.createdDate),
  );

  return {
    data,
    source: live.length > 0 ? 'blended' : 'demo',
    liveError,
    liveCount: live.length,
    demoCount: demo.length,
  };
}

export async function loadAnalytics(now = new Date()): Promise<WorkspaceResult<Analytics>> {
  const result = await loadRequisitions(now);
  return { ...result, data: computeAnalytics(result.data) };
}

export async function loadActivity(now = new Date()): Promise<WorkspaceResult<ActivityEvent[]>> {
  const result = await loadRequisitions(now);
  return { ...result, data: generateActivity(result.data, now) };
}

/**
 * Loads one requisition in detail, preferring D365 and falling back to the
 * demo population when the record is not live.
 */
export async function loadRequisitionDetail(
  company: string,
  requisitionNumber: string,
  now = new Date(),
): Promise<WorkspaceResult<RequisitionDetailView> | null> {
  let liveError: string | undefined;

  if (config.DEMO_MODE !== 'on') {
    try {
      const [header, lines] = await Promise.all([
        getHeader(company, requisitionNumber),
        listLines(company, requisitionNumber).catch(() => ({ value: [] as Record365[] })),
      ]);

      const summary = mapLiveHeader(header, now);
      const mapped = lines.value.map((line) => mapLiveLine(line, summary.currency));

      if (mapped.length > 0) {
        summary.lineCount = mapped.length;
        summary.totalAmount =
          Math.round(mapped.reduce((sum, l) => sum + l.lineAmount, 0) * 100) / 100;
      }

      return {
        data: buildDetail(summary, now, header, mapped),
        source: 'd365',
        liveCount: 1,
        demoCount: 0,
      };
    } catch (err) {
      liveError = err instanceof Error ? err.message : String(err);
    }
  }

  if (!demoEnabled()) return null;

  const demo = demoPopulation(now).find((r) => r.requisitionNumber === requisitionNumber);
  const summary = demo ?? deriveSummary(requisitionNumber, now);

  return {
    data: buildDetail(summary, now),
    source: 'demo',
    liveError,
    liveCount: 0,
    demoCount: 1,
  };
}
