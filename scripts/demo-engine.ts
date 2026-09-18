/**
 * Infra-free walkthrough of the routing engine: no Mongo, no Redis, no HTTP.
 * Runs the exact scenarios from the README and prints the engine's own trace.
 *
 *   npm run demo:engine
 */
import {
  AgentSnapshot,
  QueueSnapshot,
  RoutingContext,
  decisionFromEvaluation,
  evaluateAgent,
} from '../src/routing';

const NOW = new Date('2026-09-18T10:00:00.000Z');
const SKILL = { support: 'sk-support', billing: 'sk-billing', sales: 'sk-sales' };

const queues: QueueSnapshot[] = [
  // INBOUND scale
  { id: 'in-vip', name: 'VIP Support', type: 'inbound', priority: 1, requiredSkillId: SKILL.support, minProficiency: 4 },
  { id: 'in-gen', name: 'General Support', type: 'inbound', priority: 2, requiredSkillId: SKILL.support, minProficiency: 2 },
  { id: 'in-bill', name: 'Billing', type: 'inbound', priority: 3, requiredSkillId: SKILL.billing, minProficiency: 2 },
  // OUTBOUND scale — restarts at 1, never compared with the numbers above
  { id: 'out-coll', name: 'Collections', type: 'outbound', priority: 1, requiredSkillId: SKILL.billing, minProficiency: 2 },
  { id: 'out-win', name: 'Winback', type: 'outbound', priority: 2, requiredSkillId: SKILL.sales, minProficiency: 2 },
];

const rahul = (overrides: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  id: 'a-rahul',
  name: 'Rahul Verma',
  status: 'available',
  currentCallId: null,
  skills: [
    { skillId: SKILL.support, proficiency: 3 },
    { skillId: SKILL.billing, proficiency: 4 },
    { skillId: SKILL.sales, proficiency: 3 },
  ],
  assignedQueues: [
    { queueId: 'in-gen', type: 'inbound' },
    { queueId: 'in-bill', type: 'inbound' },
    { queueId: 'out-coll', type: 'outbound' },
    { queueId: 'out-win', type: 'outbound' },
  ],
  ...overrides,
});

const call = (id: string, queueId: string, waitedSeconds: number, now = NOW) => ({
  id,
  queueId,
  callerNumber: `+9198000000${id}`,
  queuedAt: new Date(now.getTime() - waitedSeconds * 1000),
});

const line = (queueId: string, campaignId: string, mode: any) => ({
  campaignId,
  queueId,
  dialingMode: mode,
  linesRequested: 1,
  items: [{ itemId: `line-${queueId}`, leadId: 'lead-1', phone: '+919800000001', queuedAt: NOW }],
  dueAt: NOW,
  requiresAgentConfirmation: mode === 'preview' || mode === 'manual',
});

function scenario(title: string, agent: AgentSnapshot, ctx: Partial<RoutingContext>, now = NOW) {
  const context: RoutingContext = {
    now,
    agents: [agent],
    queues,
    waitingCalls: [],
    outboundDemand: [],
    ...ctx,
  };
  const evaluation = evaluateAgent(agent, context);
  const decision = decisionFromEvaluation(evaluation, 'periodic_tick');
  console.log(`\n\x1b[1m${title}\x1b[0m`);
  console.log(`  agent      : ${agent.name} (${agent.status}${agent.currentCallId ? ', holding a call' : ''})`);
  console.log(`  waiting    : ${context.waitingCalls.map((c) => c.queueId).join(', ') || '(none)'}`);
  console.log(`  outbound   : ${context.outboundDemand.map((d) => d.queueId).join(', ') || '(none)'}`);
  evaluation.trace.forEach((t) => console.log(`    · ${t}`));
  const verdict =
    decision.candidateType === 'none'
      ? '\x1b[31mNOTHING ASSIGNED — work stays queued\x1b[0m'
      : `\x1b[32m${decision.candidateType.toUpperCase()} → ${decision.chosenQueueName}\x1b[0m`;
  console.log(`  => ${verdict}`);
  console.log(`     ${decision.reason}`);
}

console.log('='.repeat(78));
console.log('WORKED EXAMPLE 1 — one agent, 2 inbound queues + 2 outbound queues');
console.log('='.repeat(78));

scenario('1a. Calls waiting in BOTH inbound queues', rahul(), {
  waitingCalls: [call('G', 'in-gen', 20), call('B', 'in-bill', 200)],
  outboundDemand: [line('out-coll', 'camp-coll', 'predictive'), line('out-win', 'camp-win', 'progressive')],
});

scenario('1b. Only the LOWEST-priority inbound queue has a call', rahul(), {
  waitingCalls: [call('B', 'in-bill', 3)],
  outboundDemand: [line('out-coll', 'camp-coll', 'predictive'), line('out-win', 'camp-win', 'progressive')],
});

scenario('1c. Both inbound queues empty — outbound is finally consulted', rahul(), {
  outboundDemand: [line('out-coll', 'camp-coll', 'predictive'), line('out-win', 'camp-win', 'progressive')],
});

scenario(
  "1d. rankOverride does NOT beat outbound priority — Collections (p1) still wins",
  rahul({
    assignedQueues: [
      { queueId: 'in-gen', type: 'inbound' },
      { queueId: 'out-coll', type: 'outbound', rankOverride: 5 },
      { queueId: 'out-win', type: 'outbound', rankOverride: 1 },
    ],
  }),
  { outboundDemand: [line('out-coll', 'camp-coll', 'predictive'), line('out-win', 'camp-win', 'progressive')] },
);

scenario(
  "1e. Same agent, but the two campaigns TIE on outbound priority — now rankOverride decides",
  rahul({
    assignedQueues: [
      { queueId: 'in-gen', type: 'inbound' },
      { queueId: 'out-coll', type: 'outbound', rankOverride: 5 },
      { queueId: 'out-win', type: 'outbound', rankOverride: 1 },
    ],
  }),
  {
    // Winback promoted to outbound priority 1, tying with Collections.
    queues: queues.map((q) => (q.id === 'out-win' ? { ...q, priority: 1 } : q)),
    outboundDemand: [line('out-coll', 'camp-coll', 'predictive'), line('out-win', 'camp-win', 'progressive')],
  },
);

console.log('\n' + '='.repeat(78));
console.log('WORKED EXAMPLE 2 — a call arrives while the agent is mid-wrap-up');
console.log('='.repeat(78));

scenario(
  '2a. t+0s: VIP-less General Support call arrives, agent is 10s into a 30s wrap-up',
  rahul({
    status: 'wrap_up',
    wrapUpStartedAt: new Date(NOW.getTime() - 10_000),
    wrapUpDeadline: new Date(NOW.getTime() + 20_000),
  }),
  { waitingCalls: [call('C', 'in-gen', 0)] },
);

scenario(
  '2b. t+20s: the wrap-up timer expired, the agent is available, the call is still there',
  rahul({ status: 'available' }),
  { waitingCalls: [call('C', 'in-gen', 20, new Date(NOW.getTime() + 20_000))] },
  new Date(NOW.getTime() + 20_000),
);

console.log('\n' + '='.repeat(78));
console.log('WORKED EXAMPLE 3 — the one-call-at-a-time gate');
console.log('='.repeat(78));

scenario(
  '3a. Agent already holds a call; the top inbound queue is backed up',
  rahul({ currentCallId: 'call-in-progress' }),
  { waitingCalls: [call('X', 'in-gen', 300)] },
);

scenario('3b. Agent is on a break; the same call is still waiting', rahul({ status: 'break' }), {
  waitingCalls: [call('X', 'in-gen', 300)],
});

console.log('');
