import type { ApprovalStage, D365Stage, Priority, SyncState } from './reference.js';

/**
 * The shape every requisition screen consumes.
 *
 * Deliberately separate from the raw D365 entity: the presentation layer needs
 * a stable contract, while the underlying OData property names are still being
 * confirmed per environment. Mapping happens in one place, so a field rename in
 * D365 changes the mapper rather than every component.
 */
export interface RequisitionSummary {
  requisitionNumber: string;
  name: string;
  status: string;
  purpose: string;
  company: string;
  department: string;
  requester: {
    name: string;
    initials: string;
    title: string;
    personnelNumber: string;
  };
  vendor: string;
  category: string;
  totalAmount: number;
  currency: string;
  lineCount: number;
  requestedDate: string;
  createdDate: string;
  /** Whole days since the requisition was raised. Drives ageing and SLA views. */
  ageDays: number;
  priority: Priority;
  approvalStage: ApprovalStage;
  d365Stage: D365Stage;
  syncState: SyncState;
  syncMessage?: string;
  /** True when the record came from D365 rather than the demo generator. */
  live: boolean;
}

export interface RequisitionLineView {
  lineNumber: number;
  lineType: string;
  itemNumber: string;
  category: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineAmount: number;
  currency: string;
  requestedDate: string;
  vendor: string;
  warehouse: string;
  site: string;
  requisitioner: string;
}

export interface TimelineEvent {
  stage: string;
  state: 'complete' | 'current' | 'pending' | 'blocked';
  actor?: string;
  timestamp?: string;
  note?: string;
}

export interface RequisitionDetailView {
  summary: RequisitionSummary;
  lines: RequisitionLineView[];
  approvalTimeline: TimelineEvent[];
  d365Timeline: TimelineEvent[];
  financialDimensions: { label: string; value: string }[];
  attachments: { name: string; sizeKb: number; uploadedBy: string; uploadedOn: string }[];
  /** Raw D365 record, when this requisition came from D365. */
  raw?: Record<string, unknown>;
}

export interface ActivityEvent {
  id: string;
  requisitionNumber: string;
  kind: 'created' | 'submitted' | 'approved' | 'rejected' | 'synced' | 'sync-failed' | 'comment';
  actor: string;
  initials: string;
  message: string;
  timestamp: string;
}

export interface AnalyticsBucket {
  label: string;
  value: number;
  /** Optional secondary measure, for example a count alongside a total. */
  count?: number;
}

export interface Analytics {
  totals: {
    openRequisitions: number;
    pendingApproval: number;
    totalRequestedSpend: number;
    averageApprovalDays: number;
    syncedCount: number;
    pendingSyncCount: number;
    errorSyncCount: number;
    currency: string;
  };
  byStatus: AnalyticsBucket[];
  byStage: AnalyticsBucket[];
  byDepartment: AnalyticsBucket[];
  byVendor: AnalyticsBucket[];
  byCategory: AnalyticsBucket[];
  byMonth: AnalyticsBucket[];
  /** Requisitions sitting in one stage far longer than the median. */
  bottlenecks: { stage: string; count: number; averageAgeDays: number }[];
  /** Lines whose amount is a large multiple of the category norm. */
  anomalies: {
    requisitionNumber: string;
    department: string;
    vendor: string;
    amount: number;
    reason: string;
  }[];
}
