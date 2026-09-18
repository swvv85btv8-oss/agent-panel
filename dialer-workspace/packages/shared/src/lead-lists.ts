import { CustomColumn, FixedColumn, LeadList } from './types';
import { POLICY } from './policy';

/** 6 fixed + up to 34 custom = 40 columns maximum. */
export const FIXED_COUNT = 6;
export const MAX_CUSTOM = 34;
export const MAX_COLUMNS = FIXED_COUNT + MAX_CUSTOM;

/**
 * `phone` is the number that gets dialed and `altphone` is a second real number —
 * masking either would break dialing or hide a number the agent may legitimately need,
 * so neither can ever be marked sensitive.
 */
export const FIXED_COLUMNS: Array<Omit<FixedColumn, 'sensitive'>> = [
  { key: 'phone', label: 'Phone Number', note: 'Field 0 · the number that gets dialed', lock: true, nosens: true },
  { key: 'name', label: 'Name', note: 'Field 1' },
  { key: 'email', label: 'Email Id', note: 'Field 2' },
  { key: 'address', label: 'Address', note: 'Field 3' },
  { key: 'company', label: 'Company Name', note: 'Field 4' },
  { key: 'altphone', label: 'Alternate Phone Number', note: 'Field 5', nosens: true },
];

export function newFixedColumns(): FixedColumn[] {
  return FIXED_COLUMNS.map((f) => ({ ...f, sensitive: false }));
}

export interface VisibleColumn {
  key: string;
  label: string;
  sensitive: boolean;
  /** Phone-shaped values mask differently from names and emails. */
  phone?: boolean;
  custom?: boolean;
}

/** Hidden custom columns are excluded from the agent panel AND the sample CSV. */
export function visibleColumns(list: LeadList): VisibleColumn[] {
  return [
    ...list.fixed.map((f) => ({
      key: f.key,
      label: f.label,
      sensitive: f.sensitive,
      phone: f.key === 'phone' || f.key === 'altphone',
    })),
    ...list.custom
      .filter((c) => !c.hidden)
      .map((c) => ({ key: c.id, label: c.label || 'Untitled', sensitive: c.sensitive, custom: true })),
  ];
}

export function columnCount(list: LeadList): number {
  return FIXED_COUNT + list.custom.length;
}

/** The sample CSV is generated from the schema, so the template always matches. */
export function sampleCsvHeader(list: LeadList): string {
  return visibleColumns(list)
    .map((c) => c.label)
    .join(', ');
}

/** Two lists share a schema when their custom columns match by label. */
export function schemaSignature(list: LeadList): string {
  return list.custom
    .map((c) => c.label.trim().toLowerCase())
    .sort()
    .join('|');
}

export function schemasMatch(lists: LeadList[]): boolean {
  const sigs = new Set(lists.map(schemaSignature));
  return sigs.size <= 1;
}

export function canAddCustom(list: LeadList): boolean {
  return list.custom.length < MAX_CUSTOM;
}

export function customColumnRoom(list: LeadList): number {
  return MAX_CUSTOM - list.custom.length;
}

/** Masking. Only applied where POLICY.sensitiveScope says it should be. */
export function maskValue(value: string, isPhone = false): string {
  const t = String(value ?? '');
  if (!t) return '';
  if (isPhone || /^\+?\d[\d\s]{6,}$/.test(t)) return t.slice(0, 5) + 'XXXXXX' + t.slice(-2);
  if (t.includes('@')) {
    const [a, b] = t.split('@');
    return a.slice(0, 2) + '••••@' + b;
  }
  return t.slice(0, 2) + '•'.repeat(Math.max(4, Math.min(8, t.length - 2)));
}

export type MaskContext = 'agent' | 'admin';

export function shouldMask(column: VisibleColumn, context: MaskContext): boolean {
  if (!column.sensitive) return false;
  if (context === 'agent') return true;
  return POLICY.sensitiveScope === 'both';
}

export function newCustomColumn(id: string, label = ''): CustomColumn {
  return { id, label, sensitive: false, hidden: false };
}
