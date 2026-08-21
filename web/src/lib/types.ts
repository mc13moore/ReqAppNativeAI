/* ---------------------------------------------------------------------------
   Schema-driven form and table descriptors (served by /api/schema).
   These mirror the D365 entity definitions on the server.
   --------------------------------------------------------------------------- */

export type FieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'enum';

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  key?: boolean;
  readOnly?: boolean;
  required?: boolean;
  inList?: boolean;
  options?: string[];
  hint?: string;
}

export interface EntityDef {
  entitySet: string;
  label: string;
  fields: FieldDef[];
}

export interface Schema {
  header: EntityDef;
  line: EntityDef;
}

export type Record365 = Record<string, unknown>;

export interface AppConfig {
  defaultCompany: string;
  headerEntitySet: string;
  lineEntitySet: string;
  authEnabled: boolean;
  demoMode: 'auto' | 'on' | 'off';
  signedIn: boolean;
}

export interface AppUser {
  id: string;
  name: string;
  provider: string;
  roles: string[];
}

/* ---------------------------------------------------------------------------
   Workspace projections
   --------------------------------------------------------------------------- */

export type SyncState = 'synced' | 'pending' | 'error' | 'local';
export type DataSource = 'd365' | 'demo' | 'blended';

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
  ageDays: number;
  priority: string;
  approvalStage: string;
  d365Stage: string;
  syncState: SyncState;
  syncMessage?: string;
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
  raw?: Record365;
  source: DataSource;
  liveError?: string;
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
  bottlenecks: { stage: string; count: number; averageAgeDays: number }[];
  anomalies: {
    requisitionNumber: string;
    department: string;
    vendor: string;
    amount: number;
    reason: string;
  }[];
}

export interface WorkspaceListResponse {
  value: RequisitionSummary[];
  count: number;
  total: number;
  source: DataSource;
  liveCount: number;
  demoCount: number;
  liveError?: string;
  facets: {
    departments: string[];
    vendors: string[];
    statuses: string[];
    stages: string[];
  };
}

export interface AnalyticsResponse {
  analytics: Analytics;
  source: DataSource;
  liveCount: number;
  demoCount: number;
  liveError?: string;
}

export interface ApprovalsResponse {
  value: RequisitionSummary[];
  count: number;
  totalValue: number;
  source: DataSource;
}

/* ---------------------------------------------------------------------------
   Assistant
   --------------------------------------------------------------------------- */

export type AssistantIntent =
  | 'summarize'
  | 'why-waiting'
  | 'similar'
  | 'suggest-vendor'
  | 'unusual-spend'
  | 'approval-summary'
  | 'freeform';

export interface AssistantReply {
  intent: string;
  headline: string;
  body: string[];
  facts: { label: string; value: string }[];
  suggestions: string[];
  groundedOn: string[];
}

/* ---------------------------------------------------------------------------
   Diagnostics
   --------------------------------------------------------------------------- */

export interface PropertyInfo {
  name: string;
  type: string;
  nullable: boolean;
  isKey: boolean;
}

export interface D365Health {
  status: string;
  environment?: string;
  elapsedMs?: number;
  credential?: { mode: string; tenantId?: string; clientId?: string };
}
