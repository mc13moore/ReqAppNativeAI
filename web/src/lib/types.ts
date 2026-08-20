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
  signedIn: boolean;
}

export interface AppUser {
  id: string;
  name: string;
  provider: string;
  roles: string[];
}

export interface ListResponse {
  value: Record365[];
  count: number;
  company: string;
  top: number;
  skip: number;
}

export interface RequisitionDetail {
  header: Record365;
  lines: Record365[];
}

export interface PropertyInfo {
  name: string;
  type: string;
  nullable: boolean;
  isKey: boolean;
}
