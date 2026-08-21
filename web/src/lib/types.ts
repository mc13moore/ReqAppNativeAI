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
  /** Personnel number recorded as preparer on everything this app creates. */
  preparerPersonnelNumber: string;
  signedIn: boolean;
}

export interface LookupOption {
  value: string;
  label: string;
}

export interface LookupAttempt {
  entity: string;
  outcome: 'ok' | 'not-found' | 'rejected' | 'empty' | 'no-matching-field';
  detail?: string;
  sampleFields?: string[];
}

export interface LookupResult {
  kind: string;
  options: LookupOption[];
  /**
   * 'entity' is a proper reference list; 'observed' means the options are only
   * the values already present on existing requisition lines.
   */
  source: 'entity' | 'observed' | 'none';
  entity?: string;
  valueField?: string;
  labelField?: string;
  /** Every entity tried, with what D365 said about each. */
  attempts: LookupAttempt[];
  truncated?: boolean;
}

export interface CreateWithLinesResult {
  header: Record365;
  requisitionNumber: string;
  company: string;
  linesCreated: number;
  linesRequested: number;
  failures: { index: number; message: string; errors?: string[] }[];
}

export interface AppUser {
  id: string;
  name: string;
  provider: string;
  roles: string[];
}

/* ---------------------------------------------------------------------------
   Workspace projections
   Every field maps to a Dynamics 365 requisition header or line. Nothing is
   generated: where D365 has no value, the interface shows none.
   --------------------------------------------------------------------------- */

export interface RequisitionSummary {
  requisitionNumber: string;
  name: string;
  status: string;
  purpose: string;
  company: string;
  preparerPersonnelNumber: string;
  requestedDate: string;
  accountingDate: string;
  onHold: boolean;
  onHoldExplanation: string;
  projectId: string;
  justificationCode: string;
  totalAmount: number;
  currency: string;
  lineCount: number;
  vendors: string[];
  categories: string[];
  hasLineData: boolean;
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
  accountingDate: string;
  vendor: string;
  warehouse: string;
  site: string;
  requisitioner: string;
  projectId: string;
  justificationCode: string;
  justificationDetails: string;
  deliveryAddress: string;
}

export interface RequisitionDetailView {
  summary: RequisitionSummary;
  lines: RequisitionLineView[];
  attributes: { label: string; value: string }[];
  raw?: Record365;
}

export interface AnalyticsBucket {
  label: string;
  value: number;
  count?: number;
}

export interface Analytics {
  totals: {
    requisitions: number;
    openRequisitions: number;
    onHold: number;
    totalRequestedSpend: number;
    averageValue: number;
    lineCount: number;
    currency: string;
    withoutLineData: number;
  };
  byStatus: AnalyticsBucket[];
  byCategory: AnalyticsBucket[];
  byVendor: AnalyticsBucket[];
  byLegalEntity: AnalyticsBucket[];
  byPreparer: AnalyticsBucket[];
  byMonth: AnalyticsBucket[];
  outliers: {
    requisitionNumber: string;
    category: string;
    amount: number;
    medianAmount: number;
    multiple: number;
  }[];
}

export interface WorkspaceListResponse {
  value: RequisitionSummary[];
  count: number;
  total: number;
  headerCount: number;
  lineCount: number;
  lineError?: string;
  facets: {
    statuses: string[];
    companies: string[];
    vendors: string[];
    categories: string[];
  };
}

export interface AnalyticsResponse {
  analytics: Analytics;
  headerCount: number;
  lineCount: number;
  lineError?: string;
}

/* ---------------------------------------------------------------------------
   Assistant
   --------------------------------------------------------------------------- */

export type AssistantIntent =
  | 'summarize'
  | 'similar'
  | 'spend-profile'
  | 'outliers'
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
