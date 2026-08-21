/**
 * Reference data and deterministic generation helpers for the demo layer.
 *
 * Everything here is presentation detail that the D365 purchase requisition
 * entities do not carry -- department, approval stage, sync state, priority.
 * It exists so the executive screens look populated during a demonstration
 * without inventing anything that pretends to be a real D365 field.
 *
 * Generation is seeded rather than random so that the same requisition always
 * renders with the same vendor, department and stage. A demo that reshuffles
 * itself on every page load undermines the story it is trying to tell.
 */

export interface Person {
  name: string;
  initials: string;
  department: string;
  title: string;
}

export const DEPARTMENTS = [
  'Finance',
  'Information Technology',
  'Operations',
  'Marketing',
  'Human Resources',
  'Facilities',
  'Legal',
  'Research & Development',
] as const;

export const VENDORS = [
  { name: 'Contoso Electronics', account: 'US-101', category: 'Computers' },
  { name: 'Fabrikam Supplies', account: 'US-104', category: 'Office Supplies' },
  { name: 'Northwind Traders', account: 'US-111', category: 'Facilities' },
  { name: 'Adventure Works', account: 'US-118', category: 'Lab Equipment' },
  { name: 'Litware Consulting', account: 'US-122', category: 'Professional Services' },
  { name: 'Proseware Software', account: 'US-127', category: 'Software Licenses' },
  { name: 'Tailwind Traders', account: 'US-133', category: 'Marketing Services' },
  { name: 'Woodgrove Logistics', account: 'US-140', category: 'Travel' },
] as const;

export const CATEGORIES = [
  'Computers',
  'Office Supplies',
  'Professional Services',
  'Software Licenses',
  'Facilities',
  'Lab Equipment',
  'Marketing Services',
  'Travel',
] as const;

export const PEOPLE: Person[] = [
  { name: 'Sara Thomas', initials: 'ST', department: 'Finance', title: 'Financial Analyst' },
  { name: 'Marcus Reed', initials: 'MR', department: 'Information Technology', title: 'IT Manager' },
  { name: 'Priya Nair', initials: 'PN', department: 'Operations', title: 'Operations Lead' },
  { name: 'Daniel Okafor', initials: 'DO', department: 'Marketing', title: 'Brand Manager' },
  { name: 'Elena Vasquez', initials: 'EV', department: 'Human Resources', title: 'HR Business Partner' },
  { name: 'James Whitfield', initials: 'JW', department: 'Facilities', title: 'Facilities Coordinator' },
  { name: 'Aisha Rahman', initials: 'AR', department: 'Legal', title: 'Counsel' },
  { name: 'Tobias Lindqvist', initials: 'TL', department: 'Research & Development', title: 'Principal Engineer' },
  { name: 'Grace Chen', initials: 'GC', department: 'Finance', title: 'Controller' },
  { name: 'Omar Haddad', initials: 'OH', department: 'Information Technology', title: 'Infrastructure Architect' },
  { name: 'Nina Kowalski', initials: 'NK', department: 'Operations', title: 'Procurement Specialist' },
  { name: 'Victor Alvarez', initials: 'VA', department: 'Research & Development', title: 'Lab Director' },
];

/** Approval stages a requisition moves through inside this application. */
export const APPROVAL_STAGES = [
  'Requested',
  'Submitted',
  'Manager Approval',
  'Purchasing',
  'Approved',
] as const;
export type ApprovalStage = (typeof APPROVAL_STAGES)[number];

/**
 * The D365 integration lifecycle.
 *
 * This is the part that matters most to a Dynamics audience: it shows the app
 * is a front end over a real business process, not a standalone mock.
 */
export const D365_LIFECYCLE = [
  'Draft',
  'Submitted',
  'Approved',
  'Sent to D365',
  'Purchase Requisition Created',
  'Purchase Order Created',
] as const;
export type D365Stage = (typeof D365_LIFECYCLE)[number];

export type SyncState = 'synced' | 'pending' | 'error' | 'local';

export const PRIORITIES = ['Low', 'Normal', 'High', 'Critical'] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * Small deterministic hash. Maps a requisition number to a stable number so
 * every derived attribute is reproducible from the record's own identity.
 */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/** Deterministic pick from a list, keyed by a string and a salt. */
export function pick<T>(items: readonly T[], key: string, salt = ''): T {
  const index = hashString(`${key}:${salt}`) % items.length;
  return items[index] as T;
}

/** Deterministic integer in [min, max]. */
export function pickNumber(key: string, salt: string, min: number, max: number): number {
  const span = max - min + 1;
  return min + (hashString(`${key}#${salt}`) % span);
}
