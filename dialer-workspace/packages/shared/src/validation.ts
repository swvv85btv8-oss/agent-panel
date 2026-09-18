import { PACING, SECTIONS, orderedSections } from './campaign-fields';
import { QUEUE_SECTIONS } from './queue-fields';
import { POLICY } from './policy';
import { schemaSignature } from './lead-lists';
import {
  CampaignValues,
  DialMethod,
  FieldDef,
  InboundQueue,
  Issue,
  LeadList,
  SectionDef,
  ValidationError,
} from './types';

/**
 * ONE validation implementation, imported by the client for live feedback and by the
 * server for the real gate. The client's copy is a convenience; the server's 422 is
 * authoritative. They cannot drift because they are the same function.
 */

export function isEmpty(x: unknown): boolean {
  return x === '' || x == null || (Array.isArray(x) && x.length === 0);
}

/** A field with a `when` predicate that fails is hidden AND excluded from validation. */
export function visible(field: FieldDef, values: Record<string, unknown>): boolean {
  return !field.when || field.when(values);
}

export interface FieldWithSection extends FieldDef {
  sec: string;
  secTitle: string;
  pacing?: boolean;
}

/** Every campaign field, including the pacing fields the current dial method reveals. */
export function allCampaignFields(values: CampaignValues): FieldWithSection[] {
  const out: FieldWithSection[] = [];
  orderedSections().forEach((s) => {
    s.fields.forEach((f) => out.push({ ...f, sec: s.id, secTitle: s.title }));
    if (s.dialing) {
      (PACING[values.dialMethod as DialMethod]?.fields ?? []).forEach((f) =>
        out.push({ ...f, sec: s.id, secTitle: s.title, pacing: true }),
      );
    }
  });
  return out;
}

/* ------------------------------------------------------------------- queues */

export function queueFieldVisible(field: FieldDef, queue: InboundQueue): boolean {
  return !field.when || field.when(queue as unknown as Record<string, unknown>);
}

export function queueIssues(queue: InboundQueue): Issue[] {
  const out: Issue[] = [];
  QUEUE_SECTIONS.forEach((s) =>
    s.fields.forEach((f) => {
      if (f.kind === 'agents') {
        if (!queue.agents.length) {
          out.push({ id: 'agents', label: 'At least one agent', sec: s.id, secTitle: s.title });
        }
        return;
      }
      if (f.req && queueFieldVisible(f, queue) && isEmpty(queue[f.id])) {
        out.push({ id: f.id, label: f.label ?? f.id, sec: s.id, secTitle: s.title });
      }
    }),
  );
  return out;
}

export interface ExternalDid {
  /** Queue that already claims this number. */
  queueName: string;
  campaignName: string;
}

/**
 * A DID may point at only ONE queue account-wide. `externalDids` carries the numbers
 * already claimed elsewhere so the error can name the other queue — the client passes
 * what it knows, the server passes the authoritative set.
 */
export function didConflicts(
  queues: InboundQueue[],
  externalDids: Map<string, ExternalDid> = new Map(),
): Issue[] {
  const out: Issue[] = [];
  const seen = new Map<string, InboundQueue>();

  queues.forEach((q) =>
    q.dids.forEach((didRaw) => {
      const did = normalizeDid(didRaw);
      const other = seen.get(did);
      if (other) {
        out.push({
          id: 'dids',
          label: `${didRaw} is already pointed at ${other.name || 'another queue'}`,
          sec: 'qbasics',
          secTitle: 'Queue basics',
          qid: q.id,
          qname: q.name || 'Untitled queue',
          dup: true,
        });
        return;
      }
      const external = externalDids.get(did);
      if (external) {
        out.push({
          id: 'dids',
          label: `${didRaw} already reaches ${external.queueName} on ${external.campaignName}`,
          sec: 'qbasics',
          secTitle: 'Queue basics',
          qid: q.id,
          qname: q.name || 'Untitled queue',
          dup: true,
        });
        return;
      }
      seen.set(did, q);
    }),
  );
  return out;
}

/** Numbers are compared without spacing so "1800 209 5000" and "18002095000" collide. */
export function normalizeDid(did: string): string {
  return String(did).replace(/[\s\-()]/g, '');
}

/**
 * §10.2 is undecided, so this is reported at whatever scope POLICY names and is
 * non-blocking by default.
 */
export function transferCodeConflicts(
  queues: InboundQueue[],
  externalCodes: Map<string, ExternalDid> = new Map(),
): Issue[] {
  if (POLICY.transferCodeScope === 'off') return [];
  const out: Issue[] = [];
  const seen = new Map<string, InboundQueue>();

  queues.forEach((q) => {
    const code = String(q.transferCode ?? '').trim();
    if (!code) return;
    const other = seen.get(code);
    if (other) {
      out.push({
        id: 'transferCode',
        label: `Transfer code ${code} is also used by ${other.name || 'another queue'}`,
        sec: 'qbasics',
        secTitle: 'Queue basics',
        qid: q.id,
        qname: q.name || 'Untitled queue',
        dup: true,
      });
      return;
    }
    if (POLICY.transferCodeScope === 'account') {
      const external = externalCodes.get(code);
      if (external) {
        out.push({
          id: 'transferCode',
          label: `Transfer code ${code} is also used by ${external.queueName} on ${external.campaignName}`,
          sec: 'qbasics',
          secTitle: 'Queue basics',
          qid: q.id,
          qname: q.name || 'Untitled queue',
          dup: true,
        });
        return;
      }
    }
    seen.set(code, q);
  });
  return out;
}

/** Every queue issue on a campaign, tagged with which queue it came from. */
export function allQueueIssues(
  queues: InboundQueue[],
  externalDids?: Map<string, ExternalDid>,
  externalCodes?: Map<string, ExternalDid>,
): Issue[] {
  const out: Issue[] = [];
  queues.forEach((q) =>
    queueIssues(q).forEach((i) => out.push({ ...i, qid: q.id, qname: q.name || 'Untitled queue' })),
  );
  out.push(...didConflicts(queues, externalDids));
  if (POLICY.transferCodeBlocking) out.push(...transferCodeConflicts(queues, externalCodes));
  return out;
}

/* ---------------------------------------------------------------- campaign */

export interface ValidationContext {
  externalDids?: Map<string, ExternalDid>;
  externalCodes?: Map<string, ExternalDid>;
  /** Attached lead lists, needed only for the mixed-schema rule. */
  leadLists?: LeadList[];
}

/** Everything that blocks publish. */
export function campaignIssues(values: CampaignValues, ctx: ValidationContext = {}): Issue[] {
  const out: Issue[] = [];

  // Required fields, skipping the two synthetic kinds which have their own rules.
  allCampaignFields(values).forEach((f) => {
    if (!f.req) return;
    if (f.kind === 'leads' || f.kind === 'queue') return;
    if (!visible(f, values)) return;
    if (isEmpty(values[f.id])) {
      out.push({ id: f.id, label: f.label ?? f.id, sec: f.sec, secTitle: f.secTitle });
    }
  });

  // At least one lead list.
  if (!values.leadLists.length) {
    out.push({ id: '__leads', label: 'Lead list', sec: 'basics', secTitle: 'Campaign basics' });
  }

  // Inbound on means at least one queue, and every queue must itself be complete.
  if (values.inbound) {
    if (!values.queues.length) {
      out.push({
        id: 'queues',
        label: 'At least one inbound queue',
        sec: 'inbound',
        secTitle: 'Inbound calls',
      });
    }
    allQueueIssues(values.queues, ctx.externalDids, ctx.externalCodes).forEach((x) =>
      out.push({ ...x, sec: 'inbound', secTitle: 'Inbound calls', label: `${x.label} — ${x.qname}` }),
    );
  }

  // §10.4: mixed lead-list schemas block only if the policy says so.
  if (POLICY.mixedLeadSchemas === 'block' && ctx.leadLists && ctx.leadLists.length > 1) {
    const sigs = new Set(ctx.leadLists.map(schemaSignature));
    if (sigs.size > 1) {
      out.push({
        id: '__leads',
        label: 'Attached lead lists must share the same columns',
        sec: 'basics',
        secTitle: 'Campaign basics',
      });
    }
  }

  return out;
}

/** Non-blocking advisories shown next to the thing they concern. */
export function campaignWarnings(values: CampaignValues, ctx: ValidationContext = {}): Issue[] {
  const out: Issue[] = [];

  if (POLICY.mixedLeadSchemas === 'warn' && ctx.leadLists && ctx.leadLists.length > 1) {
    const sigs = new Set(ctx.leadLists.map(schemaSignature));
    if (sigs.size > 1) {
      out.push({
        id: '__leads',
        label:
          'These lists have different columns, so agents will see a different layout depending on who they are calling',
        sec: 'basics',
        secTitle: 'Campaign basics',
      });
    }
  }

  if (!POLICY.transferCodeBlocking && values.inbound) {
    out.push(...transferCodeConflicts(values.queues, ctx.externalCodes));
  }

  return out;
}

/** 422 body: field-keyed so the client can attach each message to the right input. */
export function toValidationErrors(issues: Issue[]): ValidationError[] {
  return issues.map((i) => ({
    field: i.id,
    message: i.label,
    section: i.sec,
    queueId: i.qid,
  }));
}

/* --------------------------------------------------------------- counting */

export function sectionById(id: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.id === id);
}

/** Fields that would block publish, per section — drives the rail dots. */
export function issuesBySection(issues: Issue[]): Record<string, number> {
  const out: Record<string, number> = {};
  issues.forEach((i) => {
    out[i.sec] = (out[i.sec] ?? 0) + 1;
  });
  return out;
}
