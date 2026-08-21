/**
 * Presentation model for the requisition workspace.
 *
 * Every field here comes from a Dynamics 365 purchase requisition header or
 * line. Nothing is generated, inferred from a name, or filled in to make a
 * screen look busier: where D365 has no value, the interface shows none.
 *
 * Totals, vendors and categories are the one exception to "straight from the
 * header", and they are still real -- the header entity carries no total, so
 * they are aggregated from that requisition's own lines.
 */

export interface RequisitionSummary {
  /** RequisitionNumber */
  requisitionNumber: string;
  /** RequisitionName */
  name: string;
  /** RequisitionStatus, verbatim from D365. */
  status: string;
  /** RequisitionPurpose */
  purpose: string;
  /** ProjectBuyingLegalEntityId */
  company: string;
  /** PreparerPersonnelNumber -- a worker ID, not a display name. */
  preparerPersonnelNumber: string;
  /** DefaultRequestedDate */
  requestedDate: string;
  /** DefaultAccountingDate */
  accountingDate: string;
  /** IsPurchaseRequisitionOnHold */
  onHold: boolean;
  /** OnHoldExplanation */
  onHoldExplanation: string;
  /** DefaultProjectId */
  projectId: string;
  /** DefaultBusinessJustificationCode */
  justificationCode: string;

  /* --- aggregated from this requisition's own lines --- */

  /** Sum of LineAmount. Zero when no lines have been read. */
  totalAmount: number;
  /** CurrencyCode from the lines. */
  currency: string;
  /** Number of lines found. */
  lineCount: number;
  /** Distinct VendorAccountNumber values across the lines. */
  vendors: string[];
  /** Distinct ProcurementProductCategoryName values across the lines. */
  categories: string[];
  /** True when line data was available to aggregate. */
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
  /** Only entries D365 actually populated. */
  attributes: { label: string; value: string }[];
  /** Verbatim D365 header record. */
  raw?: Record<string, unknown>;
}

export interface AnalyticsBucket {
  label: string;
  value: number;
  count?: number;
}

export interface Analytics {
  totals: {
    /** Requisitions read from D365. */
    requisitions: number;
    /** Requisitions whose status is not a closed or cancelled state. */
    openRequisitions: number;
    /** Requisitions flagged on hold in D365. */
    onHold: number;
    /** Sum of LineAmount across every line read. */
    totalRequestedSpend: number;
    /** Mean requisition value, over requisitions that have lines. */
    averageValue: number;
    /** Total lines read. */
    lineCount: number;
    currency: string;
    /** How many requisitions had no line data available. */
    withoutLineData: number;
  };
  byStatus: AnalyticsBucket[];
  byCategory: AnalyticsBucket[];
  byVendor: AnalyticsBucket[];
  byLegalEntity: AnalyticsBucket[];
  byPreparer: AnalyticsBucket[];
  byMonth: AnalyticsBucket[];
  /**
   * Requisitions far above the median for their category.
   *
   * Suppressed unless a category holds enough records for a median to mean
   * anything -- flagging an "anomaly" against two data points would be noise
   * presented as insight.
   */
  outliers: {
    requisitionNumber: string;
    category: string;
    amount: number;
    medianAmount: number;
    multiple: number;
  }[];
}
