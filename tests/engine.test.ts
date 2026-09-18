import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkAgentGate,
  collectInboundCandidates,
  decisionFromEvaluation,
  evaluateAgent,
  runAssignmentTick,
} from '../src/routing';
import { NOW, QUEUES, SKILL, agent, ctx, demand, waiting } from './fixtures';

/* ============================================================================
 * (a) AGENT CONCURRENCY + STATE GATE
 * ========================================================================== */
describe('gate: agent concurrency and state', () => {
  it('an agent holding a call is never a candidate, whatever the queue priority', () => {
    const a = agent({ currentCallId: 'call-999' });
    assert.equal(checkAgentGate(a), 'agent_has_active_call');

    // Highest-priority inbound queue is screaming and it still does not matter.
    const evaluation = evaluateAgent(a, ctx({ agents: [a], waitingCalls: [waiting('c1', 'in-gen', 300)] }));
    assert.equal(evaluation.eligible, false);
    assert.equal(evaluation.inboundCandidates.length, 0);
    assert.equal(evaluation.outboundCandidates.length, 0);
  });

  it('currentCallId beats status: an "available" agent with a call is still gated', () => {
    // Guards against a stale status field ever letting a second call through.
    assert.equal(checkAgentGate(agent({ status: 'available', currentCallId: 'c-1' })), 'agent_has_active_call');
  });

  for (const status of ['on_call', 'wrap_up', 'break', 'offline'] as const) {
    it(`status "${status}" is not a candidate`, () => {
      assert.equal(checkAgentGate(agent({ status })), `agent_status_${status}`);
    });
  }

  it('wrap_up gates exactly like break/offline do', () => {
    const wrapping = agent({
      status: 'wrap_up',
      wrapUpStartedAt: new Date(NOW.getTime() - 5000),
      wrapUpDeadline: new Date(NOW.getTime() + 25000),
    });
    const e = evaluateAgent(wrapping, ctx({ agents: [wrapping], waitingCalls: [waiting('c1', 'in-bill', 60)] }));
    assert.equal(e.eligible, false);
    assert.equal(e.gateReason, 'agent_status_wrap_up');
  });

  it('a call offered to a gated agent stays in its queue rather than being force-assigned', () => {
    const wrapping = agent({ status: 'wrap_up' });
    const context = ctx({ agents: [wrapping], waitingCalls: [waiting('c1', 'in-bill', 60)] });
    const tick = runAssignmentTick(context, 'inbound_call_arrival');
    assert.equal(tick.decisions.length, 1);
    assert.equal(tick.decisions[0].candidateType, 'none');
    assert.match(tick.decisions[0].reason, /work stays queued/);
    // The waiting call was never claimed.
    assert.equal(context.waitingCalls[0].id, 'c1');
  });

  it('an agent with no assigned queues is gated', () => {
    assert.equal(checkAgentGate(agent({ assignedQueues: [] })), 'no_assigned_queues');
  });

  it('an available agent with no call passes the gate', () => {
    assert.equal(checkAgentGate(agent()), null);
  });
});

/* ============================================================================
 * (b) INBOUND-BEFORE-OUTBOUND PRECEDENCE
 * ========================================================================== */
describe('precedence: inbound always beats outbound', () => {
  it('picks inbound even when the lowest-priority inbound queue competes with the best outbound queue', () => {
    // in-bill is inbound priority 3 (the worst inbound queue this agent has).
    // out-coll is outbound priority 1 (the best outbound queue this agent has).
    const context = ctx({
      waitingCalls: [waiting('c1', 'in-bill', 2)],
      outboundDemand: [demand({ queueId: 'out-coll', campaignId: 'camp-coll', dialingMode: 'predictive' })],
    });
    const e = evaluateAgent(agent(), context);
    assert.equal(e.inboundCandidates.length, 1);
    // Outbound is not merely out-ranked — it is never even collected.
    assert.equal(e.outboundCandidates.length, 0);
    assert.ok(e.trace.some((t) => t.includes('outbound not evaluated')));

    const d = decisionFromEvaluation(e, 'periodic_tick');
    assert.equal(d.candidateType, 'inbound');
    assert.equal(d.chosenQueueId, 'in-bill');
  });

  it('a 1-second-old inbound call beats an outbound campaign that has been due for an hour', () => {
    const context = ctx({
      waitingCalls: [waiting('c1', 'in-bill', 1)],
      outboundDemand: [
        demand({
          queueId: 'out-coll',
          campaignId: 'camp-coll',
          dueAt: new Date(NOW.getTime() - 3600_000),
        }),
      ],
    });
    assert.equal(decisionFromEvaluation(evaluateAgent(agent(), context), 'periodic_tick').candidateType, 'inbound');
  });

  it('outbound is only consulted when every assigned inbound queue is empty', () => {
    const context = ctx({
      waitingCalls: [],
      outboundDemand: [demand({ queueId: 'out-coll', campaignId: 'camp-coll' })],
    });
    const e = evaluateAgent(agent(), context);
    assert.equal(e.inboundCandidates.length, 0);
    assert.equal(e.outboundCandidates.length, 1);
    assert.equal(decisionFromEvaluation(e, 'periodic_tick').candidateType, 'outbound');
  });

  it('a call waiting in an inbound queue the agent is NOT assigned to does not block outbound', () => {
    // in-vip is inbound priority 1 but this agent is not assigned to it.
    const context = ctx({
      waitingCalls: [waiting('c1', 'in-vip', 600)],
      outboundDemand: [demand({ queueId: 'out-coll', campaignId: 'camp-coll' })],
    });
    const d = decisionFromEvaluation(evaluateAgent(agent(), context), 'periodic_tick');
    assert.equal(d.candidateType, 'outbound');
  });

  it('a call the agent lacks the skill for does not block outbound', () => {
    // Assigned to in-vip, but it needs support>=4 and this agent has 3.
    const a = agent({
      assignedQueues: [
        { queueId: 'in-vip', type: 'inbound' },
        { queueId: 'out-coll', type: 'outbound' },
      ],
    });
    const context = ctx({
      agents: [a],
      waitingCalls: [waiting('c1', 'in-vip', 600)],
      outboundDemand: [demand({ queueId: 'out-coll', campaignId: 'camp-coll' })],
    });
    const d = decisionFromEvaluation(evaluateAgent(a, context), 'periodic_tick');
    assert.equal(d.candidateType, 'outbound');
  });
});

/* ============================================================================
 * (c) WITHIN-SCALE PRIORITY AND TIE-BREAKS
 * ========================================================================== */
describe('inbound scale: priority then longest wait', () => {
  it('higher-priority inbound queue wins even with a much shorter wait', () => {
    const context = ctx({
      waitingCalls: [waiting('old', 'in-bill', 600), waiting('new', 'in-gen', 1)],
    });
    const d = decisionFromEvaluation(evaluateAgent(agent(), context), 'periodic_tick');
    assert.equal(d.chosenQueueId, 'in-gen'); // priority 2 beats priority 3
    assert.equal(d.chosenCallId, 'new');
  });

  it('ties on priority are broken by the longest-waiting call', () => {
    const queues = QUEUES.map((q) => (q.id === 'in-bill' ? { ...q, priority: 2 } : q));
    const context = ctx({
      queues,
      waitingCalls: [waiting('gen', 'in-gen', 30), waiting('bill', 'in-bill', 120)],
    });
    const d = decisionFromEvaluation(evaluateAgent(agent(), context), 'periodic_tick');
    assert.equal(d.chosenQueueId, 'in-bill');
    assert.equal(d.chosenCallId, 'bill');
  });

  it('within one queue the longest-waiting call is taken first', () => {
    const context = ctx({
      waitingCalls: [waiting('young', 'in-gen', 5), waiting('old', 'in-gen', 90)],
    });
    const cands = collectInboundCandidates(agent(), new Map(QUEUES.map((q) => [q.id, q])), context.waitingCalls, NOW);
    assert.equal(cands[0].callId, 'old');
  });

  it('inbound priority numbers are compared only against other inbound numbers', () => {
    // Outbound priority 1 exists and is numerically "better" than inbound 3 — irrelevant.
    const context = ctx({
      waitingCalls: [waiting('c1', 'in-bill', 5)],
      outboundDemand: [demand({ queueId: 'out-coll', campaignId: 'camp' })],
    });
    const e = evaluateAgent(agent(), context);
    assert.equal(e.inboundCandidates[0].priority, 3);
    assert.equal(e.outboundCandidates.length, 0);
  });
});

describe('outbound scale: priority, then rankOverride, then dueAt', () => {
  it('higher-priority outbound queue wins', () => {
    const context = ctx({
      outboundDemand: [
        demand({ queueId: 'out-win', campaignId: 'camp-win' }),
        demand({ queueId: 'out-coll', campaignId: 'camp-coll' }),
      ],
    });
    const d = decisionFromEvaluation(evaluateAgent(agent(), context), 'periodic_tick');
    assert.equal(d.chosenQueueId, 'out-coll'); // outbound priority 1
  });

  it("a tie is broken by the agent's own rankOverride (lower wins)", () => {
    const queues = QUEUES.map((q) => (q.id === 'out-win' ? { ...q, priority: 1 } : q));
    const a = agent({
      assignedQueues: [
        { queueId: 'out-coll', type: 'outbound', rankOverride: 5 },
        { queueId: 'out-win', type: 'outbound', rankOverride: 1 },
      ],
    });
    const context = ctx({
      agents: [a],
      queues,
      outboundDemand: [
        demand({ queueId: 'out-coll', campaignId: 'camp-coll' }),
        demand({ queueId: 'out-win', campaignId: 'camp-win' }),
      ],
    });
    const d = decisionFromEvaluation(evaluateAgent(a, context), 'periodic_tick');
    assert.equal(d.chosenQueueId, 'out-win');
  });

  it('an explicit rankOverride outranks an unset one', () => {
    const queues = QUEUES.map((q) => (q.id === 'out-win' ? { ...q, priority: 1 } : q));
    const a = agent({
      assignedQueues: [
        { queueId: 'out-coll', type: 'outbound', rankOverride: null },
        { queueId: 'out-win', type: 'outbound', rankOverride: 9 },
      ],
    });
    const context = ctx({
      agents: [a],
      queues,
      outboundDemand: [
        demand({ queueId: 'out-coll', campaignId: 'camp-coll' }),
        demand({ queueId: 'out-win', campaignId: 'camp-win' }),
      ],
    });
    assert.equal(decisionFromEvaluation(evaluateAgent(a, context), 'periodic_tick').chosenQueueId, 'out-win');
  });

  it('with no rankOverride anywhere, the earliest campaign dueAt wins', () => {
    const queues = QUEUES.map((q) => (q.id === 'out-win' ? { ...q, priority: 1 } : q));
    const a = agent({
      assignedQueues: [
        { queueId: 'out-coll', type: 'outbound' },
        { queueId: 'out-win', type: 'outbound' },
      ],
    });
    const context = ctx({
      agents: [a],
      queues,
      outboundDemand: [
        demand({ queueId: 'out-coll', campaignId: 'camp-coll', dueAt: new Date(NOW.getTime() - 1000) }),
        demand({ queueId: 'out-win', campaignId: 'camp-win', dueAt: new Date(NOW.getTime() - 9000) }),
      ],
    });
    assert.equal(decisionFromEvaluation(evaluateAgent(a, context), 'periodic_tick').chosenQueueId, 'out-win');
  });

  it('rankOverride never leaks across the inbound/outbound boundary', () => {
    // A brilliant outbound rankOverride cannot pull outbound ahead of inbound.
    const a = agent({
      assignedQueues: [
        { queueId: 'in-bill', type: 'inbound' },
        { queueId: 'out-coll', type: 'outbound', rankOverride: -100 },
      ],
    });
    const context = ctx({
      agents: [a],
      waitingCalls: [waiting('c1', 'in-bill', 1)],
      outboundDemand: [demand({ queueId: 'out-coll', campaignId: 'camp-coll' })],
    });
    assert.equal(decisionFromEvaluation(evaluateAgent(a, context), 'periodic_tick').candidateType, 'inbound');
  });

  it('carries the dialing mode and confirmation requirement through to the decision', () => {
    const context = ctx({
      outboundDemand: [
        demand({
          queueId: 'out-coll',
          campaignId: 'camp-coll',
          dialingMode: 'preview',
          requiresAgentConfirmation: true,
        }),
      ],
    });
    const d = decisionFromEvaluation(evaluateAgent(agent(), context), 'periodic_tick');
    assert.equal(d.dialingMode, 'preview');
    assert.equal(d.requiresAgentConfirmation, true);
  });
});

/* ============================================================================
 * TICK-LEVEL BEHAVIOUR
 * ========================================================================== */
describe('assignment tick', () => {
  it('never hands the same waiting call to two agents', () => {
    const a1 = agent({ id: 'a1', name: 'A1' });
    const a2 = agent({ id: 'a2', name: 'A2' });
    const context = ctx({ agents: [a1, a2], waitingCalls: [waiting('only', 'in-gen', 10)] });
    const tick = runAssignmentTick(context, 'inbound_call_arrival');
    const inbound = tick.decisions.filter((d) => d.candidateType === 'inbound');
    assert.equal(inbound.length, 1);
    assert.equal(inbound[0].chosenCallId, 'only');
    // The second agent is eligible but finds nothing left.
    const other = tick.decisions.find((d) => d.agentId !== inbound[0].agentId)!;
    assert.equal(other.candidateType, 'none');
    assert.match(other.reason, /no inbound or outbound work/);
  });

  it('spreads a multi-line campaign across agents without reusing a line', () => {
    const a1 = agent({ id: 'a1', name: 'A1' });
    const a2 = agent({ id: 'a2', name: 'A2' });
    const context = ctx({
      agents: [a1, a2],
      outboundDemand: [
        demand({
          queueId: 'out-coll',
          campaignId: 'camp-coll',
          items: [
            { itemId: 'line-1', leadId: 'l1', phone: '+911', queuedAt: NOW },
            { itemId: 'line-2', leadId: 'l2', phone: '+912', queuedAt: NOW },
          ],
        }),
      ],
    });
    const tick = runAssignmentTick(context, 'campaign_tick');
    const lines = tick.decisions.filter((d) => d.candidateType === 'outbound').map((d) => d.chosenCallId);
    assert.deepEqual(lines.sort(), ['line-1', 'line-2']);
  });

  it('stops handing out lines once the campaign runs out of them', () => {
    const agents = ['a1', 'a2', 'a3'].map((id) => agent({ id, name: id }));
    const context = ctx({
      agents,
      outboundDemand: [
        demand({
          queueId: 'out-coll',
          campaignId: 'camp-coll',
          items: [{ itemId: 'line-1', leadId: 'l1', phone: '+911', queuedAt: NOW }],
        }),
      ],
    });
    const tick = runAssignmentTick(context, 'campaign_tick');
    assert.equal(tick.decisions.filter((d) => d.candidateType === 'outbound').length, 1);
  });

  it('gives the longest-idle agent first pick', () => {
    const busyRecently = agent({ id: 'a1', name: 'Recent', lastAssignedAt: new Date(NOW.getTime() - 1000) });
    const idleLonger = agent({ id: 'a2', name: 'Idle', lastAssignedAt: new Date(NOW.getTime() - 60000) });
    const context = ctx({ agents: [busyRecently, idleLonger], waitingCalls: [waiting('c1', 'in-gen', 10)] });
    const tick = runAssignmentTick(context, 'periodic_tick');
    const winner = tick.decisions.find((d) => d.candidateType === 'inbound')!;
    assert.equal(winner.agentId, 'a2');
  });

  it('can be restricted to a subset of agents', () => {
    const a1 = agent({ id: 'a1', name: 'A1' });
    const a2 = agent({ id: 'a2', name: 'A2' });
    const context = ctx({ agents: [a1, a2], waitingCalls: [waiting('c1', 'in-gen', 10)] });
    const tick = runAssignmentTick(context, 'agent_state_change', ['a2']);
    assert.equal(tick.decisions.length, 1);
    assert.equal(tick.decisions[0].agentId, 'a2');
  });

  it('records a trace for every agent, including the skipped ones', () => {
    const wrapping = agent({ id: 'a1', name: 'Wrapping', status: 'wrap_up' });
    const ready = agent({ id: 'a2', name: 'Ready' });
    const context = ctx({ agents: [wrapping, ready], waitingCalls: [waiting('c1', 'in-gen', 10)] });
    const tick = runAssignmentTick(context, 'periodic_tick');
    assert.equal(tick.evaluations.length, 2);
    tick.evaluations.forEach((e) => assert.ok(e.trace.length > 0));
  });
});

/* ============================================================================
 * WORKED EXAMPLES FROM THE README
 * ========================================================================== */
describe('worked example: 2 inbound + 2 outbound queues', () => {
  const context = (waitingCalls: any[]) =>
    ctx({
      waitingCalls,
      outboundDemand: [
        demand({ queueId: 'out-coll', campaignId: 'camp-coll', dialingMode: 'predictive' }),
        demand({ queueId: 'out-win', campaignId: 'camp-win', dialingMode: 'progressive' }),
      ],
    });

  it('step 1: General Support (p2) and Billing (p3) both waiting -> General Support wins', () => {
    const d = decisionFromEvaluation(
      evaluateAgent(agent(), context([waiting('g', 'in-gen', 20), waiting('b', 'in-bill', 200)])),
      'periodic_tick',
    );
    assert.equal(d.chosenQueueName, 'General Support');
  });

  it('step 2: only Billing waiting -> Billing wins, outbound still untouched', () => {
    const d = decisionFromEvaluation(evaluateAgent(agent(), context([waiting('b', 'in-bill', 3)])), 'periodic_tick');
    assert.equal(d.chosenQueueName, 'Billing');
    assert.equal(d.candidateType, 'inbound');
  });

  it('step 3: both inbound queues empty -> Collections (outbound p1) wins', () => {
    const d = decisionFromEvaluation(evaluateAgent(agent(), context([])), 'periodic_tick');
    assert.equal(d.chosenQueueName, 'Collections');
    assert.equal(d.candidateType, 'outbound');
  });
});

describe('worked example: a call arrives mid-wrap-up', () => {
  it('the call waits, then goes to the same agent once wrap-up ends', () => {
    const call = waiting('c1', 'in-gen', 0);

    // t+0: call arrives while the agent is 10s into a 30s wrap-up.
    const wrapping = agent({
      status: 'wrap_up',
      wrapUpStartedAt: new Date(NOW.getTime() - 10_000),
      wrapUpDeadline: new Date(NOW.getTime() + 20_000),
    });
    const t0 = runAssignmentTick(ctx({ agents: [wrapping], waitingCalls: [call] }), 'inbound_call_arrival');
    assert.equal(t0.decisions[0].candidateType, 'none');
    assert.equal(t0.decisions[0].evaluation.gateReason, 'agent_status_wrap_up');

    // t+20: the wrap-up timer expired and the agent is available again.
    const afterWrapUp = agent({ status: 'available' });
    const t1 = runAssignmentTick(
      ctx({ now: new Date(NOW.getTime() + 20_000), agents: [afterWrapUp], waitingCalls: [call] }),
      'agent_state_change',
    );
    assert.equal(t1.decisions[0].candidateType, 'inbound');
    assert.equal(t1.decisions[0].chosenCallId, 'c1');
    // The call was never dropped: it waited the full 20 seconds.
    assert.ok(t1.decisions[0].evaluation.inboundCandidates[0].waitMs >= 20_000);
  });
});
