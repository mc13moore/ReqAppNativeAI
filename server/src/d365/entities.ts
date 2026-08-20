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

export const headerEntity: EntityDef = {
  entitySet: config.D365_HEADER_ENTITY,
  label: 'Requisition',
  fields: [
    {
      name: 'dataAreaId',
      label: 'Company',
      type: 'string',
      key: true,
      readOnly: true,
      inList: true,
    },
    {
      name: 'RequisitionNumber',
      label: 'Requisition number',
      type: 'string',
      key: true,
      inList: true,
      hint: 'Leave blank if the number sequence assigns it automatically.',
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
      required: true,
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
      name: 'RequesterPersonnelNumber',
      label: 'Requester personnel number',
      type: 'string',
      required: true,
      inList: true,
      hint: 'Worker ID of the person the requisition is raised for.',
    },
    {
      name: 'PreparerPersonnelNumber',
      label: 'Preparer personnel number',
      type: 'string',
      hint: 'Defaults to the requester when omitted.',
    },
    {
      name: 'RequestingLegalEntityId',
      label: 'Requesting legal entity',
      type: 'string',
    },
    {
      name: 'AccountingDate',
      label: 'Accounting date',
      type: 'date',
    },
  ],
};

export const lineEntity: EntityDef = {
  entitySet: config.D365_LINE_ENTITY,
  label: 'Requisition line',
  fields: [
    {
      name: 'dataAreaId',
      label: 'Company',
      type: 'string',
      key: true,
      readOnly: true,
    },
    {
      name: 'RequisitionNumber',
      label: 'Requisition number',
      type: 'string',
      key: true,
      readOnly: true,
    },
    {
      name: 'LineNumber',
      label: 'Line',
      type: 'number',
      key: true,
      inList: true,
      hint: 'Leave blank to append to the end of the requisition.',
    },
    {
      name: 'ItemNumber',
      label: 'Item number',
      type: 'string',
      inList: true,
      hint: 'Supply either an item number or a procurement category.',
    },
    {
      name: 'ProcurementCategoryName',
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
      name: 'RequestedQuantity',
      label: 'Quantity',
      type: 'number',
      required: true,
      inList: true,
    },
    { name: 'UnitSymbol', label: 'Unit', type: 'string', inList: true },
    { name: 'UnitPrice', label: 'Unit price', type: 'number', inList: true },
    {
      name: 'RequestedDeliveryDate',
      label: 'Requested delivery date',
      type: 'date',
      required: true,
      inList: true,
    },
    {
      name: 'BuyingLegalEntityId',
      label: 'Buying legal entity',
      type: 'string',
    },
    {
      name: 'ReceivingOperationalSiteId',
      label: 'Site',
      type: 'string',
    },
    {
      name: 'ReceivingWarehouseId',
      label: 'Warehouse',
      type: 'string',
    },
    {
      name: 'RequisitionLineStatus',
      label: 'Line status',
      type: 'enum',
      options: ['Draft', 'InReview', 'Approved', 'Rejected', 'Cancelled'],
      readOnly: true,
      inList: true,
    },
  ],
};

/** Field name on the line entity that points back at its header. */
export const LINE_PARENT_FIELD = 'RequisitionNumber';

export const listFields = (entity: EntityDef): string[] =>
  entity.fields.filter((f) => f.inList || f.key).map((f) => f.name);

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
