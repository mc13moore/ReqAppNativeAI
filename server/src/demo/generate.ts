import {
  APPROVAL_STAGES,
  CATEGORIES,
  D365_LIFECYCLE,
  DEPARTMENTS,
  PEOPLE,
  PRIORITIES,
  VENDORS,
  hashString,
  pick,
  pickNumber,
  type ApprovalStage,
  type D365Stage,
  type Priority,
  type SyncState,
} from './reference.js';
import type {
  ActivityEvent,
  RequisitionDetailView,
  RequisitionLineView,
  RequisitionSummary,
  TimelineEvent,
} from './model.js';

/**
 * Demo requisitions are generated relative to a fixed reference date rather
 * than "now", so screenshots and recorded walkthroughs stay consistent. The
 * date is passed in by the caller so the server can still age the data
 * naturally against the real clock when that is preferable.
 */
const LINE_DESCRIPTIONS: Record<string, string[]> = {
  Computers: [
    'Surface Laptop Studio 2 - engineering spec',
    'Dell UltraSharp 32" 4K monitor',
    'Docking stations for hybrid workstations',
    'High-density server memory upgrade',
  ],
  'Office Supplies': [
    'Quarterly stationery replenishment',
    'Ergonomic chair replacement programme',
    'Printer consumables - west campus',
    'Whiteboards and meeting room supplies',
  ],
  'Professional Services': [
    'External audit readiness advisory',
    'Change management consulting - phase 2',
    'Contract negotiation support',
    'Process automation assessment',
  ],
  'Software Licenses': [
    'Annual ERP sandbox licence renewal',
    'Developer tooling subscription - 25 seats',
    'Data visualisation platform licences',
    'Endpoint security renewal',
  ],
  Facilities: [
    'HVAC preventative maintenance contract',
    'Warehouse racking replacement',
    'Security access control upgrade',
    'Lighting retrofit - building C',
  ],
  'Lab Equipment': [
    'Precision calibration instruments',
    'Environmental test chamber',
    'Spectrometer service contract',
    'Consumables for Q3 test programme',
  ],
  'Marketing Services': [
    'Trade show stand design and build',
    'Digital campaign production',
    'Customer research panel',
    'Brand photography and asset library',
  ],
  Travel: [
    'Regional sales kickoff travel',
    'Vendor site visit - logistics review',
    'Conference attendance - 6 delegates',
    'Executive briefing centre visits',
  ],
};

const UNITS = ['ea', 'box', 'case', 'hr', 'mo'];

function isoDaysAgo(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 86_400_000);
  return d.toISOString();
}

/** Derives the D365 lifecycle stage implied by an approval stage and sync state. */
function d365StageFor(approval: ApprovalStage, sync: SyncState, key: string): D365Stage {
  if (approval === 'Requested') return 'Draft';
  if (approval === 'Submitted' || approval === 'Manager Approval') return 'Submitted';
  if (approval === 'Purchasing') return 'Approved';
  if (sync === 'error') return 'Approved';
  if (sync === 'pending') return 'Sent to D365';
  // Approved and synced: some have progressed to a purchase order.
  return pickNumber(key, 'po', 0, 2) === 0
    ? 'Purchase Order Created'
    : 'Purchase Requisition Created';
}

function syncStateFor(approval: ApprovalStage, key: string): SyncState {
  if (approval === 'Requested') return 'local';
  const roll = pickNumber(key, 'sync', 0, 99);
  if (approval === 'Approved') {
    if (roll < 18) return 'error';
    if (roll < 40) return 'pending';
    return 'synced';
  }
  if (approval === 'Purchasing') {
    // Purchasing is where transfers are attempted, so failures surface here
    // too rather than only after final approval.
    if (roll < 12) return 'error';
    return roll < 34 ? 'pending' : 'local';
  }
  return roll < 12 ? 'pending' : 'local';
}

/** Builds a deterministic set of lines for one requisition. */
export function generateLines(
  requisitionNumber: string,
  category: string,
  vendor: string,
  now: Date,
): RequisitionLineView[] {
  const count = pickNumber(requisitionNumber, 'lines', 1, 5);
  const pool = LINE_DESCRIPTIONS[category] ?? LINE_DESCRIPTIONS['Office Supplies']!;

  return Array.from({ length: count }, (_, index) => {
    const salt = `line${index}`;
    const quantity = pickNumber(requisitionNumber, `${salt}qty`, 1, 40);
    const unitPrice =
      pickNumber(requisitionNumber, `${salt}price`, 1500, 480_000) / 100;

    return {
      lineNumber: index + 1,
      lineType: pickNumber(requisitionNumber, `${salt}type`, 0, 4) === 0 ? 'Category' : 'Item',
      itemNumber: `C${String(pickNumber(requisitionNumber, `${salt}item`, 1, 9999)).padStart(4, '0')}`,
      category,
      description: pool[index % pool.length]!,
      quantity,
      unit: pick(UNITS, requisitionNumber, `${salt}unit`),
      unitPrice,
      lineAmount: Math.round(quantity * unitPrice * 100) / 100,
      currency: 'USD',
      requestedDate: isoDaysAgo(now, -pickNumber(requisitionNumber, `${salt}due`, 3, 45)),
      vendor,
      warehouse: String(pickNumber(requisitionNumber, `${salt}wh`, 11, 24)),
      site: String(pickNumber(requisitionNumber, `${salt}site`, 1, 4)),
      requisitioner: String(pickNumber(requisitionNumber, `${salt}req`, 1, 40)).padStart(6, '0'),
    };
  });
}

/**
 * Derives every presentation attribute for a requisition number.
 *
 * Used both for generated demo records and to enrich real D365 records, so the
 * dashboard looks the same whether the underlying data is live or not. The
 * `live` flag on the result is what the UI badges, so the two are never
 * confused.
 */
export function deriveSummary(
  requisitionNumber: string,
  now: Date,
  overrides: Partial<RequisitionSummary> = {},
): RequisitionSummary {
  const key = requisitionNumber;
  const person = pick(PEOPLE, key, 'person');
  const category = overrides.category ?? pick(CATEGORIES, key, 'category');

  // Supplier follows the category. Picking the two independently produced
  // combinations no procurement audience would believe -- travel booked
  // through an office-supplies vendor -- which undermines the data long
  // before anyone questions the interface.
  const vendor =
    VENDORS.find((v) => v.category === category) ?? pick(VENDORS, key, 'vendor');
  const department = overrides.department ?? person.department ?? pick(DEPARTMENTS, key, 'dept');

  // Days waiting in the current stage: drives ageing, SLA and queue ordering.
  const ageDays = pickNumber(key, 'age', 0, 38);
  // Spread creation across three quarters so the spend-by-month trend has
  // enough points to read as a trend rather than a bar or two.
  const createdDaysAgo = pickNumber(key, 'created', 0, 268);
  const approvalStage =
    overrides.approvalStage ?? (pick(APPROVAL_STAGES, key, 'stage') as ApprovalStage);
  const syncState = overrides.syncState ?? syncStateFor(approvalStage, key);

  const lines = generateLines(requisitionNumber, category, vendor.name, now);
  const totalAmount =
    overrides.totalAmount ?? Math.round(lines.reduce((sum, l) => sum + l.lineAmount, 0) * 100) / 100;

  const priority: Priority =
    overrides.priority ??
    (totalAmount > 120_000
      ? 'Critical'
      : totalAmount > 60_000
        ? 'High'
        : (pick(PRIORITIES.slice(0, 3), key, 'prio') as Priority));

  return {
    requisitionNumber,
    name: overrides.name ?? `${category} request - ${department}`,
    status:
      overrides.status ??
      (approvalStage === 'Approved'
        ? 'Approved'
        : approvalStage === 'Requested'
          ? 'Draft'
          : 'InReview'),
    purpose: overrides.purpose ?? (pickNumber(key, 'purpose', 0, 3) === 0 ? 'Replenishment' : 'Consumption'),
    company: overrides.company ?? 'USMF',
    department,
    requester: {
      name: person.name,
      initials: person.initials,
      title: person.title,
      personnelNumber: String(pickNumber(key, 'pn', 1, 60)).padStart(6, '0'),
    },
    vendor: overrides.vendor ?? vendor.name,
    category,
    totalAmount,
    currency: 'USD',
    lineCount: overrides.lineCount ?? lines.length,
    requestedDate: overrides.requestedDate ?? isoDaysAgo(now, -pickNumber(key, 'req', 5, 60)),
    createdDate: overrides.createdDate ?? isoDaysAgo(now, createdDaysAgo),
    ageDays,
    priority,
    approvalStage,
    d365Stage: overrides.d365Stage ?? d365StageFor(approvalStage, syncState, key),
    syncState,
    syncMessage:
      syncState === 'error'
        ? 'Number sequence unavailable in target legal entity. Retry queued.'
        : syncState === 'pending'
          ? 'Queued for transfer to Dynamics 365 Finance & Operations.'
          : undefined,
    live: overrides.live ?? false,
  };
}

/** Builds the approval timeline implied by the current stage. */
export function buildApprovalTimeline(summary: RequisitionSummary, now: Date): TimelineEvent[] {
  const currentIndex = APPROVAL_STAGES.indexOf(summary.approvalStage);

  return APPROVAL_STAGES.map((stage, index) => {
    const state: TimelineEvent['state'] =
      index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'pending';

    const daysBack = Math.max(0, summary.ageDays - index * 2);

    return {
      stage,
      state,
      actor:
        index === 0
          ? summary.requester.name
          : index === 4
            ? 'Grace Chen'
            : index === 3
              ? 'Nina Kowalski'
              : index === 2
                ? 'Marcus Reed'
                : summary.requester.name,
      timestamp: index <= currentIndex ? isoDaysAgo(now, daysBack) : undefined,
      note:
        index === currentIndex && summary.ageDays > 12
          ? `Waiting ${summary.ageDays - currentIndex * 2} days at this stage`
          : undefined,
    };
  });
}

/** Builds the D365 integration lifecycle for a requisition. */
export function buildD365Timeline(summary: RequisitionSummary, now: Date): TimelineEvent[] {
  const currentIndex = D365_LIFECYCLE.indexOf(summary.d365Stage);

  return D365_LIFECYCLE.map((stage, index) => {
    let state: TimelineEvent['state'] =
      index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'pending';

    // A failed transfer stalls at the point it failed rather than showing an
    // in-progress step, which would misrepresent the integration state.
    if (summary.syncState === 'error' && index === currentIndex + 1) state = 'blocked';

    return {
      stage,
      state,
      timestamp: index <= currentIndex ? isoDaysAgo(now, Math.max(0, summary.ageDays - index)) : undefined,
      note:
        state === 'blocked'
          ? summary.syncMessage
          : stage === 'Purchase Order Created' && state === 'complete'
            ? 'PO generated in Dynamics 365'
            : undefined,
    };
  });
}

const ATTACHMENT_NAMES = [
  'Vendor quotation.pdf',
  'Budget approval memo.docx',
  'Statement of work.pdf',
  'Comparison matrix.xlsx',
];

export function buildDetail(
  summary: RequisitionSummary,
  now: Date,
  raw?: Record<string, unknown>,
  liveLines?: RequisitionLineView[],
): RequisitionDetailView {
  const lines =
    liveLines && liveLines.length > 0
      ? liveLines
      : generateLines(summary.requisitionNumber, summary.category, summary.vendor, now);

  const attachmentCount = pickNumber(summary.requisitionNumber, 'att', 0, 3);

  return {
    summary,
    lines,
    approvalTimeline: buildApprovalTimeline(summary, now),
    d365Timeline: buildD365Timeline(summary, now),
    financialDimensions: [
      { label: 'Business Unit', value: `BU-${pickNumber(summary.requisitionNumber, 'bu', 10, 90)}` },
      { label: 'Cost Center', value: `CC-${pickNumber(summary.requisitionNumber, 'cc', 100, 999)}` },
      { label: 'Department', value: summary.department },
      { label: 'Project', value: pickNumber(summary.requisitionNumber, 'proj', 0, 2) === 0 ? '—' : `PRJ-${pickNumber(summary.requisitionNumber, 'p2', 1000, 9999)}` },
    ],
    attachments: Array.from({ length: attachmentCount }, (_, i) => ({
      name: ATTACHMENT_NAMES[i % ATTACHMENT_NAMES.length]!,
      sizeKb: pickNumber(summary.requisitionNumber, `att${i}`, 40, 3200),
      uploadedBy: summary.requester.name,
      uploadedOn: isoDaysAgo(now, Math.max(0, summary.ageDays - i)),
    })),
    raw,
  };
}

/** Generates the demo requisition population. */
export function generateRequisitions(count: number, now: Date): RequisitionSummary[] {
  return Array.from({ length: count }, (_, index) => {
    const number = String(100_000 + index * 7 + (hashString(String(index)) % 5)).slice(-6);
    return deriveSummary(number, now);
  });
}

const ACTIVITY_TEMPLATES: { kind: ActivityEvent['kind']; message: (r: RequisitionSummary) => string }[] = [
  { kind: 'created', message: (r) => `raised ${r.requisitionNumber} for ${r.department}` },
  { kind: 'submitted', message: (r) => `submitted ${r.requisitionNumber} for approval` },
  { kind: 'approved', message: (r) => `approved ${r.requisitionNumber}` },
  { kind: 'synced', message: (r) => `${r.requisitionNumber} synced to Dynamics 365` },
  { kind: 'sync-failed', message: (r) => `${r.requisitionNumber} failed to sync to Dynamics 365` },
  { kind: 'comment', message: (r) => `commented on ${r.requisitionNumber}` },
];

export function generateActivity(
  requisitions: RequisitionSummary[],
  now: Date,
  limit = 18,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const req of requisitions) {
    const template =
      req.syncState === 'error'
        ? ACTIVITY_TEMPLATES[4]!
        : req.syncState === 'synced'
          ? ACTIVITY_TEMPLATES[3]!
          : ACTIVITY_TEMPLATES[
              pickNumber(req.requisitionNumber, 'act', 0, ACTIVITY_TEMPLATES.length - 1)
            ]!;

    events.push({
      id: `${req.requisitionNumber}-${template.kind}`,
      requisitionNumber: req.requisitionNumber,
      kind: template.kind,
      actor: req.requester.name,
      initials: req.requester.initials,
      message: template.message(req),
      timestamp: isoDaysAgo(now, req.ageDays * 0.4),
    });
  }

  return events
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}
