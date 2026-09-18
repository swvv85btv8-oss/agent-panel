import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CAMPAIGN_DEFAULTS,
  MAX_COLUMNS,
  MAX_CUSTOM,
  POLICY,
  QUEUE_SECTIONS,
  allQueueIssues,
  campaignIssues,
  campaignWarnings,
  didConflicts,
  essentialCount,
  hasDependents,
  isEssential,
  makeDirtyCheck,
  maskValue,
  newCustomColumn,
  newFixedColumns,
  newQueue,
  queueIssues,
  sampleCsvHeader,
  schemasMatch,
  sectionChanges,
  sectionSummary,
  shouldMask,
  surveyIssues,
  totalChanges,
  transferCodeConflicts,
  visibleColumns,
  newVoiceSurvey,
  newWebSurvey,
  toValidationErrors,
} from '../src';
import { SECTIONS } from '../src/campaign-fields';
import { InboundQueue, LeadList } from '../src/types';

const values = (over: Record<string, unknown> = {}) => ({ ...CAMPAIGN_DEFAULTS, ...over }) as any;

const list = (name: string, custom: string[] = []): LeadList => ({
  id: 'l-' + name,
  name,
  desc: '',
  records: 100,
  updated: '13 Aug',
  fixed: newFixedColumns(),
  custom: custom.map((c, i) => newCustomColumn('c' + i, c)),
});

const ready = (over: Partial<InboundQueue> = {}): InboundQueue => ({
  ...newQueue('q1', 'Queue one'),
  dids: ['1800 209 5000'],
  agents: ['Kimi'],
  ...over,
});

/* ===================================================== inbound queue rules */
describe('inbound queue', () => {
  it('requires a name, a DID, an agent and the routing basics', () => {
    const ids = queueIssues(newQueue('q1')).map((i) => i.id);
    assert.ok(ids.includes('name'));
    assert.ok(ids.includes('dids'));
    assert.ok(ids.includes('agents'));
  });

  it('accepts a fully configured queue', () => {
    assert.deepEqual(queueIssues(ready()), []);
  });

  it('reveals the sticky sub-settings only when sticky is Yes', () => {
    assert.deepEqual(queueIssues(ready({ sticky: 'No' })), []);
    const ids = queueIssues(ready({ sticky: 'Yes' })).map((i) => i.id);
    assert.ok(ids.includes('stickyTimeFormat'));
    assert.ok(ids.includes('stickyFailover'));
  });

  it('reveals callback sub-settings only when a callback is offered', () => {
    assert.deepEqual(queueIssues(ready({ callback: false })), []);
    const ids = queueIssues(ready({ callback: true, dtmf: '' })).map((i) => i.id);
    assert.ok(ids.includes('dtmf'));
  });

  it('reveals the queue-limit sub-settings only when the cap is on', () => {
    const ids = queueIssues(ready({ queueLimit: true })).map((i) => i.id);
    assert.ok(ids.includes('maxCallers'));
  });

  it('models fallback as three tiers rather than a per-agent integer', () => {
    const q = ready({ agents: ['Kimi', 'Aakriti'], priority: true, tiers: { Kimi: 1, Aakriti: 2 } });
    assert.equal(q.tiers.Aakriti, 2);
    assert.ok(!QUEUE_SECTIONS.flatMap((s) => s.fields).some((f) => f.id === 'agentPriority'));
  });

  it('twins four fields with the campaign without inheriting them', () => {
    const twinned = QUEUE_SECTIONS.flatMap((s) => s.fields).filter((f) => f.cmp);
    assert.deepEqual(
      twinned.map((f) => f.id).sort(),
      ['agentRingTimeout', 'moh', 'smsReceived'].sort(),
    );
    // A fresh queue does not pick up the campaign's values.
    const q = newQueue('q1');
    assert.equal(q.moh, '');
    assert.equal(q.agentRingTimeout, '30'); // its own default, not the campaign's
  });
});

/* ============================================================ DID collisions */
describe('DID collisions', () => {
  it('catches the same number on two queues of one campaign, naming the other queue', () => {
    const a = ready({ id: 'qa', name: 'Collections', dids: ['1800 209 5000'] });
    const b = { ...ready({ id: 'qb', name: 'Escalations', dids: ['1800 209 5000'] }) };
    const c = didConflicts([a, b]);
    assert.equal(c.length, 1);
    assert.match(c[0].label, /already pointed at Collections/);
    assert.equal(c[0].qid, 'qb');
  });

  it('compares numbers ignoring spacing and punctuation', () => {
    const a = ready({ id: 'qa', name: 'A', dids: ['1800 209 5000'] });
    const b = ready({ id: 'qb', name: 'B', dids: ['18002095000'] });
    assert.equal(didConflicts([a, b]).length, 1);
  });

  it('catches a number already used by another campaign account-wide', () => {
    const q = ready({ dids: ['022 6178 0155'] });
    const external = new Map([
      ['02261780155', { queueName: 'North returns', campaignName: 'North Collections' }],
    ]);
    const c = didConflicts([q], external);
    assert.equal(c.length, 1);
    assert.match(c[0].label, /already reaches North returns on North Collections/);
  });

  it('allows distinct numbers', () => {
    const a = ready({ id: 'qa', dids: ['111'] });
    const b = ready({ id: 'qb', dids: ['222'] });
    assert.deepEqual(didConflicts([a, b]), []);
  });

  it('blocks publish when a campaign has a collision', () => {
    const v = values({
      inbound: true,
      queues: [
        ready({ id: 'qa', name: 'A', dids: ['111'] }),
        ready({ id: 'qb', name: 'B', dids: ['111'] }),
      ],
    });
    assert.ok(campaignIssues(v).some((i) => i.dup));
  });
});

/* ======================================================= transfer codes §10.2 */
describe('transfer code uniqueness (open decision)', () => {
  it('detects a duplicate code within a campaign', () => {
    const a = ready({ id: 'qa', name: 'A', transferCode: '101' });
    const b = ready({ id: 'qb', name: 'B', transferCode: '101' });
    assert.equal(transferCodeConflicts([a, b]).length, 1);
  });

  it('is a warning, not a publish blocker, while the scope is undecided', () => {
    assert.equal(POLICY.transferCodeBlocking, false);
    const v = values({
      inbound: true,
      queues: [
        ready({ id: 'qa', name: 'A', transferCode: '101' }),
        ready({ id: 'qb', name: 'B', transferCode: '101' }),
      ],
    });
    assert.ok(!campaignIssues(v).some((i) => i.id === 'transferCode'));
    assert.ok(campaignWarnings(v).some((i) => i.id === 'transferCode'));
  });

  it('ignores queues with no transfer code', () => {
    assert.deepEqual(transferCodeConflicts([ready({ id: 'qa' }), ready({ id: 'qb' })]), []);
  });
});

/* ================================================================ lead lists */
describe('lead lists', () => {
  it('allows 6 fixed plus 34 custom columns', () => {
    assert.equal(MAX_CUSTOM, 34);
    assert.equal(MAX_COLUMNS, 40);
  });

  it('never lets phone or altphone be masked', () => {
    const fixed = newFixedColumns();
    assert.ok(fixed.find((f) => f.key === 'phone')!.nosens);
    assert.ok(fixed.find((f) => f.key === 'altphone')!.nosens);
  });

  it('excludes hidden columns from the visible set and the sample CSV', () => {
    const l = list('A', ['Bucket', 'Branch']);
    l.custom[1].hidden = true;
    const cols = visibleColumns(l).map((c) => c.label);
    assert.ok(cols.includes('Bucket'));
    assert.ok(!cols.includes('Branch'));
    assert.ok(!sampleCsvHeader(l).includes('Branch'));
  });

  it('generates the sample CSV header from the schema so it always matches', () => {
    const l = list('A', ['Loan Account No']);
    assert.equal(
      sampleCsvHeader(l),
      'Phone Number, Name, Email Id, Address, Company Name, Alternate Phone Number, Loan Account No',
    );
  });

  it('detects mismatched schemas across attached lists', () => {
    assert.ok(schemasMatch([list('A', ['Bucket']), list('B', ['Bucket'])]));
    assert.ok(!schemasMatch([list('A', ['Bucket']), list('B', ['Branch'])]));
  });

  it('warns but does not block on mixed schemas (open decision §10.4)', () => {
    assert.equal(POLICY.mixedLeadSchemas, 'warn');
    const ctx = { leadLists: [list('A', ['Bucket']), list('B', ['Branch'])] };
    const v = values({ leadLists: ['l-A', 'l-B'] });
    assert.ok(!campaignIssues(v, ctx).some((i) => /same columns/.test(i.label)));
    assert.ok(campaignWarnings(v, ctx).some((i) => /different columns/.test(i.label)));
  });

  it('masks phones, emails and free text differently', () => {
    assert.equal(maskValue('+919876543210', true), '+9198XXXXXX10');
    assert.match(maskValue('rahul.sharma@gmail.com'), /^ra••••@gmail\.com$/);
    assert.match(maskValue('Rahul Sharma'), /^Ra•+$/);
  });

  it('masks for agents always, and for admins per policy §10.5', () => {
    const col = { key: 'c0', label: 'Loan', sensitive: true };
    assert.equal(shouldMask(col, 'agent'), true);
    assert.equal(shouldMask(col, 'admin'), POLICY.sensitiveScope === 'both');
    assert.equal(shouldMask({ ...col, sensitive: false }, 'agent'), false);
  });
});

/* =================================================================== surveys */
describe('surveys', () => {
  it('requires a name and content for a voice survey', () => {
    const sv = newVoiceSurvey('s1', 'e1');
    const iss = surveyIssues(sv);
    assert.ok(iss.includes('A name'));
    assert.ok(iss.some((x) => /recording for entry 1/.test(x)));
    assert.ok(iss.includes('An invalid-input recording'));
    assert.ok(iss.includes('A timeout recording'));
  });

  it('requires at least two options for choice questions only', () => {
    const sv = newWebSurvey('s1', 'q1', 'Named');
    sv.questions[0].text = 'Rate the call';
    sv.questions[0].options = ['Good', ''];
    assert.ok(surveyIssues(sv).some((x) => /at least 2 options/.test(x)));

    sv.questions[0].rtype = 'Short answer';
    sv.questions[0].options = [];
    assert.deepEqual(surveyIssues(sv), []);
  });
});

/* ====================================================== essentials & dirty */
describe('essentials mode and dirty tracking', () => {
  const clean = makeDirtyCheck(values(), values());

  it('counts far fewer essential fields than the full inventory', () => {
    const n = essentialCount(values(), clean);
    assert.ok(n > 0 && n < 30, `expected a small essentials set, got ${n}`);
  });

  it('treats a required field as essential and a plain toggle as not', () => {
    const outcomes = SECTIONS.find((s) => s.id === 'outcomes')!;
    const dispo = outcomes.fields.find((f) => f.id === 'dispositionList')!;
    const compliance = SECTIONS.find((s) => s.id === 'compliance')!;
    const mask = compliance.fields.find((f) => f.id === 'maskLead')!;
    assert.equal(isEssential(outcomes, dispo, values(), clean), true);
    assert.equal(isEssential(compliance, mask, values(), clean), false);
  });

  it('promotes a toggle to essential once it gates a required visible field', () => {
    const agents = SECTIONS.find((s) => s.id === 'agents')!;
    const toggle = agents.fields.find((f) => f.id === 'skillRouting')!;
    assert.equal(isEssential(agents, toggle, values(), clean), false);
    assert.equal(isEssential(agents, toggle, values({ skillRouting: true }), clean), true);
  });

  it('promotes any changed field to essential', () => {
    const compliance = SECTIONS.find((s) => s.id === 'compliance')!;
    const mask = compliance.fields.find((f) => f.id === 'maskLead')!;
    const dirty = makeDirtyCheck(values({ maskLead: true }), values());
    assert.equal(isEssential(compliance, mask, values({ maskLead: true }), dirty), true);
  });

  it('identifies toggles that reveal something, which stay in the main grid', () => {
    const transfers = SECTIONS.find((s) => s.id === 'transfers')!;
    const allow = transfers.fields.find((f) => f.id === 'allowTransfer')!;
    const compliance = SECTIONS.find((s) => s.id === 'compliance')!;
    const feedback = compliance.fields.find((f) => f.id === 'feedbackRec')!;
    assert.equal(hasDependents(transfers, allow), true);
    assert.equal(hasDependents(compliance, feedback), false);
  });

  it('counts changes per section and in total', () => {
    const v = values({ maskLead: true, wrapUp: '60' });
    const dirty = makeDirtyCheck(v, values());
    assert.equal(sectionChanges(SECTIONS.find((s) => s.id === 'compliance')!, v, dirty), 1);
    assert.equal(totalChanges(v, dirty), 2);
  });

  it('ignores changes to a field that is currently hidden', () => {
    // popupUrl changed but the popup toggle is off, so it is not counted.
    const v = values({ popupUrl: 'https://x' });
    const dirty = makeDirtyCheck(v, values());
    assert.equal(sectionChanges(SECTIONS.find((s) => s.id === 'outcomes')!, v, dirty), 0);
  });

  it('summarises a collapsed section in one line', () => {
    const v = values({ name: 'WEST HFC', leadLists: ['a'], callerId: ['1800'] });
    assert.equal(sectionSummary(SECTIONS.find((s) => s.id === 'basics')!, v), 'WEST HFC · 1 lead list · 1 caller ID');
    assert.equal(sectionSummary(SECTIONS.find((s) => s.id === 'inbound')!, v), 'Off');
  });
});

/* ================================================================ 422 shape */
describe('server error shape', () => {
  it('keys errors by field so the client can attach them to inputs', () => {
    const errs = toValidationErrors(campaignIssues(values({ enableCsat: true })));
    const survey = errs.find((e) => e.field === 'csatSurvey');
    assert.ok(survey);
    assert.equal(survey!.section, 'outcomes');
  });

  it('tags queue errors with the queue they belong to', () => {
    const q = newQueue('qz');
    const errs = toValidationErrors(allQueueIssues([q]));
    assert.ok(errs.every((e) => e.queueId === 'qz'));
  });
});
