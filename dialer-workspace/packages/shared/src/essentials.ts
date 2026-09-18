import { PACING, orderedSections } from './campaign-fields';
import { isEmpty, visible } from './validation';
import { CampaignValues, DialMethod, FieldDef, SectionDef } from './types';

/**
 * ESSENTIALS VS ALL SETTINGS.
 *
 * The default view shows only fields that block publish, have been changed, or gate
 * something essential. On a typical campaign that is roughly 19 of 55. Sections with
 * nothing essential are hidden entirely rather than shown empty.
 */

export type DirtyCheck = (fieldId: string) => boolean;

/** Toggles that reveal another field in the same section stay in the main grid. */
export function hasDependents(section: SectionDef, toggle: FieldDef): boolean {
  return section.fields.some(
    (f) => f.id !== toggle.id && (f.dependsOn ?? []).includes(toggle.id),
  );
}

export function dependentsOf(section: SectionDef, toggle: FieldDef): FieldDef[] {
  return section.fields.filter(
    (f) => f.id !== toggle.id && (f.dependsOn ?? []).includes(toggle.id),
  );
}

/** A field is essential if it blocks publish, has been touched, or gates something essential. */
export function isEssential(
  section: SectionDef,
  field: FieldDef,
  values: CampaignValues,
  isDirty: DirtyCheck,
): boolean {
  if (field.kind === 'leads' || field.kind === 'queue') return true;
  if (field.req) return true;
  if (field.label && isDirty(field.id)) return true;
  if (field.kind === 'toggle' && hasDependents(section, field)) {
    return dependentsOf(section, field).some(
      (d) => visible(d, values) && (d.req || isDirty(d.id)),
    );
  }
  return false;
}

export function essentialFields(
  section: SectionDef,
  values: CampaignValues,
  isDirty: DirtyCheck,
): FieldDef[] {
  return section.fields
    .filter((f) => visible(f, values))
    .filter((f) => isEssential(section, f, values, isDirty));
}

export function essentialCount(values: CampaignValues, isDirty: DirtyCheck): number {
  let n = 0;
  orderedSections().forEach((s) => {
    n += essentialFields(s, values, isDirty).length;
  });
  (PACING[values.dialMethod as DialMethod]?.fields ?? []).forEach((f) => {
    if (f.req || isDirty(f.id)) n++;
  });
  return n;
}

export function totalFieldCount(values: CampaignValues): number {
  let n = 0;
  orderedSections().forEach((s) => {
    n += s.fields.filter((f) => f.label).length;
  });
  n += (PACING[values.dialMethod as DialMethod]?.fields ?? []).filter((f) => f.label).length;
  return n;
}

/* --------------------------------------------------------- dirty tracking */

/** Per-field diff against the last published values. */
export function makeDirtyCheck(values: CampaignValues, published: CampaignValues): DirtyCheck {
  return (fieldId: string) =>
    JSON.stringify(values[fieldId]) !== JSON.stringify(published[fieldId]);
}

export function sectionChanges(
  section: SectionDef,
  values: CampaignValues,
  isDirty: DirtyCheck,
): number {
  let n = 0;
  section.fields.forEach((f) => {
    if (f.kind === 'leads') {
      if (isDirty('leadLists')) n++;
    } else if (f.kind === 'queue') {
      if (isDirty('queues')) n++;
    } else if (visible(f, values) && isDirty(f.id)) {
      n++;
    }
  });
  if (section.dialing) {
    (PACING[values.dialMethod as DialMethod]?.fields ?? []).forEach((f) => {
      if (isDirty(f.id)) n++;
    });
  }
  return n;
}

export function totalChanges(values: CampaignValues, isDirty: DirtyCheck): number {
  return orderedSections().reduce((a, s) => a + sectionChanges(s, values, isDirty), 0);
}

/* ---------------------------------------------------------- value summary */

export function formatValue(v: unknown): string {
  if (v === true) return 'On';
  if (v === false) return 'Off';
  if (Array.isArray(v)) return v.length ? `${v.length} selected` : 'none';
  if (v === '' || v == null) return '—';
  return String(v);
}

/** The one-line summary a collapsed section shows in place of its fields. */
export function sectionSummary(section: SectionDef, values: CampaignValues): string {
  if (section.id === 'basics') {
    const n = values.leadLists.length;
    const ids = (values.callerId as string[] | undefined) ?? [];
    return `${formatValue(values.name)} · ${n} lead list${n === 1 ? '' : 's'} · ${ids.length} caller ID${ids.length === 1 ? '' : 's'}`;
  }
  if (section.id === 'inbound') {
    return values.inbound
      ? `${values.queues.length} queue${values.queues.length === 1 ? '' : 's'}`
      : 'Off';
  }
  if (section.dialing) return `${values.dialMethod} · wrap ${formatValue(values.wrapUp)}s`;
  const set = section.fields.filter(
    (f) => visible(f, values) && f.label && !isEmpty(values[f.id]) && values[f.id] !== false,
  );
  const parts = set.slice(0, 3).map((f) => `${f.label}: ${formatValue(values[f.id])}`);
  return parts.length ? parts.join(' · ') : 'Nothing set';
}
