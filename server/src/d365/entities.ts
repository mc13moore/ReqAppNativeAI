import { config } from '../config.js';

/**
 * ---------------------------------------------------------------------------
 * THE ONE FILE YOU WILL EDIT
 * ---------------------------------------------------------------------------
 * Public entity and field names for purchase requisitions differ between F&O
 * versions, and any ISV or in-house extension can add or rename fields. The
 * definitions below are the common out-of-the-box names, but treat them as a
 * starting point, not gospel.
 *
 * To confirm against your own instance, sign in to the running app and open
 *   /api/metadata/entities?search=requisition
 *   /api/metadata/entities/PurchaseRequisitionHeaders
 * or hit those endpoints directly. They read the live $metadata document and
 * report the real property names and EDM types. Correct this file to match and
 * both the API and the UI follow automatically -- the tables, the detail view,
 * and the create forms are all generated from these descriptors.
 */

export type FieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'enum';

export interface FieldDef {
  /** OData property name, exactly as it appears in $metadata. */
  name: string;
  /** Human label shown in the UI. */
  label: string;
  type: FieldType;
  /** Part of the entity key. Keys are never editable after creation. */
  key?: boolean;
  /** Server-maintained; never sent on create. */
  readOnly?: boolean;
  /** Required by the create form. */
  required?: boolean;
  /** Show as a column in the list view. */
  inList?: boolean;
  /** Allowed values for enum fields, as D365 spells them. */
  options?: string[];
  /** Helper text rendered under the input. */
  hint?: string;
}

export interface EntityDef {
  entitySet: string;
  /** Singular noun used in UI copy. */
  label: string;
  fields: FieldDef[];
}

/**
 * Confirmed against armanino-train by reading an actual record from
 * /data/PurchaseRequisitionHeaders. Note the absence of dataAreaId: this entity
 * does not expose it, so it is neither a key nor filterable, and selecting it
 * returns HTTP 400.
 */
export const headerEntity: EntityDef = {
  entitySet: config.D365_HEADER_ENTITY,
  label: 'Requisition',
  fields: [
    {
      name: 'RequisitionNumber',
      label: 'Requisition number',
      type: 'string',
      key: true,
      // Assigned by the F&O number sequence, never keyed in.
      readOnly: true,
      inList: true,
    },
    {
      name: 'RequisitionName',
      label: 'Name',
      type: 'string',
      required: true,
      inList: true,
    },
    {
      name: 'RequisitionPurpose',
      label: 'Purpose',
      type: 'enum',
      options: ['Consumption', 'Replenishment'],
      // Always Consumption for requisitions raised here; set server-side.
      readOnly: true,
      inList: true,
    },
    {
      name: 'RequisitionStatus',
      label: 'Status',
      type: 'enum',
      options: ['Draft', 'InReview', 'Approved', 'Rejected', 'Cancelled', 'Closed'],
      readOnly: true,
      inList: true,
    },
    {
      name: 'PreparerPersonnelNumber',
      label: 'Preparer',
      type: 'string',
      // Resolved from the signed-in user when the requisition is created.
      readOnly: true,
      inList: true,
    },
    {
      name: 'ProjectBuyingLegalEntityId',
      label: 'Project legal entity',
      type: 'string',
      // Backed by CompanyInfoDefault, which D365 will only accept alongside a
      // project. Never written by this application.
      readOnly: true,
      inList: true,
    },
    {
      name: 'DefaultAccountingDate',
      label: 'Accounting date',
      type: 'date',
      // Mirrors the requested date; set server-side rather than entered.
      readOnly: true,
    },
    {
      name: 'DefaultRequestedDate',
      label: 'Requested date',
      type: 'date',
      required: true,
      hint: 'Also used as the accounting date.',
    },
    {
      name: 'DefaultBusinessJustificationCode',
      label: 'Business justification code',
      type: 'string',
      // Not captured on creation; shown only if D365 populates it.
      readOnly: true,
    },
    {
      name: 'DefaultBusinessJustificationDetails',
      label: 'Business justification',
      type: 'string',
      // Not captured on creation; shown only if D365 populates it.
      readOnly: true,
    },
    {
      name: 'IsPurchaseRequisitionOnHold',
      label: 'On hold',
      type: 'enum',
      options: ['Yes', 'No'],
      readOnly: true,
    },
    {
      name: 'OnHoldExplanation',
      label: 'On-hold explanation',
      type: 'string',
      readOnly: true,
    },
    {
      name: 'DefaultProjectId',
      label: 'Project',
      type: 'string',
      // Not captured on creation; shown only if D365 populates it.
      readOnly: true,
    },
  ],
};

/**
 * Confirmed against armanino-train by reading a complete live record. Like the
 * header, this entity has no dataAreaId.
 *
 * The entity exposes around eighty properties, most of them delivery-address
 * and project-accounting detail. Only the ones a requisition actually turns on
 * are declared here -- listing everything would produce a create form nobody
 * could fill in. Add more from the live record as they are needed; the tables
 * and forms follow automatically.
 */
export const lineEntity: EntityDef = {
  entitySet: config.D365_LINE_ENTITY,
  label: 'Requisition line',
  fields: [
    {
      name: 'RequisitionNumber',
      label: 'Requisition number',
      type: 'string',
      key: true,
      readOnly: true,
    },
    {
      name: 'RequisitionLineNumber',
      label: 'Line',
      type: 'number',
      key: true,
      inList: true,
      hint: 'Leave blank to append to the end of the requisition.',
    },
    {
      name: 'LineType',
      label: 'Line type',
      type: 'enum',
      options: ['Item', 'Category'],
      hint: 'Item lines need an item number; category lines need a procurement category.',
    },
    {
      name: 'ItemNumber',
      label: 'Item number',
      type: 'string',
      inList: true,
      hint: 'Supply either an item number or a procurement category.',
    },
    {
      name: 'ProcurementProductCategoryName',
      label: 'Procurement category',
      type: 'string',
      inList: true,
    },
    {
      name: 'LineDescription',
      label: 'Description',
      type: 'string',
      required: true,
      inList: true,
    },
    {
      name: 'RequestedPurchaseQuantity',
      label: 'Quantity',
      type: 'number',
      required: true,
      inList: true,
    },
    { name: 'PurchaseUnitSymbol', label: 'Unit', type: 'string', inList: true },
    {
      name: 'PurchasePrice',
      label: 'Unit price',
      type: 'number',
      inList: true,
    },
    {
      name: 'LineAmount',
      label: 'Line amount',
      type: 'number',
      // Calculated by F&O from price, quantity and discounts.
      readOnly: true,
      inList: true,
    },
    { name: 'CurrencyCode', label: 'Currency', type: 'string' },
    {
      name: 'RequestedDate',
      label: 'Requested delivery date',
      type: 'date',
      required: true,
      inList: true,
    },
    {
      name: 'RequisitionerPersonnelNumber',
      label: 'Requisitioner',
      type: 'string',
      required: true,
      hint: 'Worker ID the line is requested for.',
    },
    {
      name: 'AccountingDate',
      label: 'Accounting date',
      type: 'date',
    },
    {
      name: 'VendorAccountNumber',
      label: 'Vendor',
      type: 'string',
    },
    {
      name: 'BuyingLegalEntityId',
      label: 'Buying legal entity',
      type: 'string',
    },
    {
      name: 'ReceivingSiteId',
      label: 'Site',
      type: 'string',
    },
    {
      name: 'ReceivingWarehouseId',
      label: 'Warehouse',
      type: 'string',
    },
    {
      name: 'BusinessJustificationCode',
      label: 'Business justification code',
      type: 'string',
    },
    {
      name: 'BusinessJustificationDetails',
      label: 'Business justification',
      type: 'string',
    },
    {
      name: 'IsPartialDeliveryPrevented',
      label: 'Prevent partial delivery',
      type: 'enum',
      options: ['Yes', 'No'],
    },
    { name: 'ProjectId', label: 'Project', type: 'string' },
    {
      name: 'LineDiscountAmount',
      label: 'Line discount',
      type: 'number',
    },
    {
      name: 'LineStatus',
      label: 'Line status',
      type: 'enum',
      options: ['Draft', 'InReview', 'Approved', 'Rejected', 'Cancelled', 'Closed'],
      readOnly: true,
      inList: true,
    },
    {
      name: 'FormattedDeliveryAddress',
      label: 'Delivery address',
      type: 'string',
      readOnly: true,
    },
  ],
};

/** Field name on the line entity that points back at its header. */
export const LINE_PARENT_FIELD = 'RequisitionNumber';

/**
 * Line ordinal field. Named separately because it is not simply "LineNumber":
 * sorting and next-number selection both reference it, and getting it wrong
 * fails the whole query rather than degrading gracefully.
 */
export const LINE_NUMBER_FIELD = 'RequisitionLineNumber';

export const listFields = (entity: EntityDef): string[] =>
  entity.fields.filter((f) => f.inList || f.key).map((f) => f.name);

export const keyFields = (entity: EntityDef): FieldDef[] =>
  entity.fields.filter((f) => f.key);

/** F&O's legal-entity discriminator, where the entity exposes one. */
export const COMPANY_FIELD = 'dataAreaId';

/**
 * Not every F&O data entity is scoped by dataAreaId, and the ones that are not
 * reject any reference to it with HTTP 400 -- in a $select, a $filter, or a key
 * predicate. Everything company-related is therefore conditional on the field
 * actually being declared for the entity.
 */
export const hasCompanyField = (entity: EntityDef): boolean =>
  entity.fields.some((f) => f.name === COMPANY_FIELD);

export const writableFields = (entity: EntityDef): FieldDef[] =>
  entity.fields.filter((f) => !f.readOnly);

/**
 * Coerces a value from the JSON request body into what OData expects for the
 * declared field type. Empty strings become undefined so that blank optional
 * inputs are omitted from the payload rather than sent as an empty string --
 * F&O rejects empty strings on typed fields.
 */
export function coerceValue(field: FieldDef, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;

  switch (field.type) {
    case 'number':
    case 'integer': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) {
        throw new Error(`${field.label} must be a number.`);
      }
      return field.type === 'integer' ? Math.trunc(n) : n;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : value === 'true' || value === '1';
    case 'date': {
      // F&O exposes date-only fields as Edm.DateTimeOffset, so a bare
      // YYYY-MM-DD from a date input must be widened to midnight UTC.
      const s = String(value);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00Z`;
      return new Date(s).toISOString();
    }
    case 'datetime':
      return new Date(String(value)).toISOString();
    default:
      return String(value);
  }
}

/** Builds an OData payload from a request body, dropping unknown fields. */
export function buildPayload(
  entity: EntityDef,
  body: Record<string, unknown>,
): { payload: Record<string, unknown>; errors: string[] } {
  const payload: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const field of writableFields(entity)) {
    try {
      const coerced = coerceValue(field, body[field.name]);
      if (coerced !== undefined) payload[field.name] = coerced;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  for (const field of entity.fields) {
    if (field.required && payload[field.name] === undefined) {
      errors.push(`${field.label} is required.`);
    }
  }

  return { payload, errors };
}
