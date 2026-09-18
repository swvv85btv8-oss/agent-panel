import {
  AgentEvaluation,
  AgentSnapshot,
  GateReason,
  InboundCandidate,
  OutboundCandidate,
  OutboundDemandSnapshot,
  QueueSnapshot,
  RoutingContext,
  RoutingDecision,
  TickResult,
  TriggerType,
  WaitingCallSnapshot,
} from './types';

/**
 * ---------------------------------------------------------------------------
 * THE ASSIGNMENT ALGORITHM, IN ORDER. The order is the whole point:
 *
 *   STEP 1  Agent concurrency + state gate
 *           currentCallId set            -> not a candidate, full stop
 *           status != 'available'        -> not a candidate (on_call/wrap_up/break/offline)
 *
 *   STEP 2  Inbound precedence
 *           Look at EVERY inbound queue the agent is assigned to. If ANY of them
 *           has a waiting call the agent is skilled for, the answer is inbound.
 *           Outbound is not even loaded into the comparison.
 *
 *   STEP 3a Within the inbound scale
 *           lowest priority number wins; tie -> longest-waiting call wins.
 *
 *   STEP 3b Within the outbound scale (reached ONLY if step 2 found nothing)
 *           lowest priority number wins; tie -> agent's rankOverride (lower wins,
 *           unset ranks last); still tied -> earliest campaign dueAt.
 *
 * Inbound priority numbers and outbound priority numbers are never compared with
 * each other. They are two separate scales that happen to use the same datatype.
 * ---------------------------------------------------------------------------
 */

const NON_AVAILABLE_GATE: Record<string, GateReason> = {
  on_call: 'agent_status_on_call',
  wrap_up: 'agent_status_wrap_up',
  break: 'agent_status_break',
  offline: 'agent_status_offline',
};

function indexById<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

/** STEP 1 — the hard gate. Nothing downstream runs if this fails. */
export function checkAgentGate(agent: AgentSnapshot): GateReason | null {
  // Concurrency first and unconditionally: one active call per agent, always.
  if (agent.currentCallId) return 'agent_has_active_call';
  if (agent.status !== 'available') {
    return NON_AVAILABLE_GATE[agent.status] ?? 'agent_status_offline';
  }
  if (!agent.assignedQueues || agent.assignedQueues.length === 0) return 'no_assigned_queues';
  return null;
}

/** Skill gate for one queue. A queue with no requiredSkillId is open to everyone. */
export function agentHasSkillForQueue(agent: AgentSnapshot, queue: QueueSnapshot): boolean {
  if (!queue.requiredSkillId) return true;
  const min = queue.minProficiency ?? 1;
  return agent.skills.some(
    (s) => String(s.skillId) === String(queue.requiredSkillId) && s.proficiency >= min,
  );
}

/**
 * STEP 2 + 3a — inbound candidates for one agent, best-first.
 * `claimedCallIds` lets a single tick assign each waiting call at most once.
 */
export function collectInboundCandidates(
  agent: AgentSnapshot,
  queues: Map<string, QueueSnapshot>,
  waitingCalls: WaitingCallSnapshot[],
  now: Date,
  claimedCallIds: Set<string> = new Set(),
): InboundCandidate[] {
  const candidates: InboundCandidate[] = [];

  for (const assignment of agent.assignedQueues) {
    if (assignment.type !== 'inbound') continue;
    const queue = queues.get(String(assignment.queueId));
    if (!queue || queue.type !== 'inbound') continue;
    if (!agentHasSkillForQueue(agent, queue)) continue;

    // Longest-waiting call first within the queue.
    const head = waitingCalls
      .filter((c) => String(c.queueId) === queue.id && !claimedCallIds.has(c.id))
      .sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime())[0];
    if (!head) continue;

    candidates.push({
      queueId: queue.id,
      queueName: queue.name,
      priority: queue.priority,
      callId: head.id,
      queuedAt: head.queuedAt,
      waitMs: now.getTime() - head.queuedAt.getTime(),
    });
  }

  // Inbound scale: priority asc, then longest wait.
  return candidates.sort(
    (a, b) => a.priority - b.priority || b.waitMs - a.waitMs || a.queueId.localeCompare(b.queueId),
  );
}

/** STEP 3b — outbound candidates for one agent, best-first. Only called when inbound is empty. */
export function collectOutboundCandidates(
  agent: AgentSnapshot,
  queues: Map<string, QueueSnapshot>,
  demand: OutboundDemandSnapshot[],
  claimedCampaignLines: Map<string, number> = new Map(),
): OutboundCandidate[] {
  const candidates: OutboundCandidate[] = [];

  for (const assignment of agent.assignedQueues) {
    if (assignment.type !== 'outbound') continue;
    const queue = queues.get(String(assignment.queueId));
    if (!queue || queue.type !== 'outbound') continue;
    if (!agentHasSkillForQueue(agent, queue)) continue;

    const d = demand.find((x) => String(x.queueId) === queue.id);
    if (!d) continue;
    // Lines already handed out earlier in this same tick are off the table.
    const alreadyTaken = claimedCampaignLines.get(String(d.campaignId)) ?? 0;
    const item = d.items[alreadyTaken];
    if (!item || d.linesRequested - alreadyTaken <= 0) continue;

    candidates.push({
      campaignId: String(d.campaignId),
      queueId: queue.id,
      queueName: queue.name,
      priority: queue.priority,
      dialingMode: d.dialingMode,
      dueAt: d.dueAt,
      rankOverride:
        assignment.rankOverride === undefined || assignment.rankOverride === null
          ? null
          : assignment.rankOverride,
      requiresAgentConfirmation: d.requiresAgentConfirmation,
      itemId: item.itemId,
      leadId: item.leadId ?? null,
      phone: item.phone ?? null,
    });
  }

  // Outbound scale: priority asc, then rankOverride asc (unset last), then dueAt asc.
  return candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const ra = a.rankOverride ?? Number.POSITIVE_INFINITY;
    const rb = b.rankOverride ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a.dueAt.getTime() - b.dueAt.getTime() || a.queueId.localeCompare(b.queueId);
  });
}

/**
 * Evaluate a single agent. Pure: same inputs -> same output, no side effects.
 */
export function evaluateAgent(
  agent: AgentSnapshot,
  ctx: RoutingContext,
  claimedCallIds: Set<string> = new Set(),
  claimedCampaignLines: Map<string, number> = new Map(),
): AgentEvaluation {
  const trace: string[] = [];
  const evaluation: AgentEvaluation = {
    agentId: agent.id,
    agentName: agent.name,
    status: agent.status,
    eligible: false,
    inboundCandidates: [],
    outboundCandidates: [],
    trace,
  };

  // STEP 1 — gate.
  const gate = checkAgentGate(agent);
  if (gate) {
    evaluation.gateReason = gate;
    trace.push(
      gate === 'agent_has_active_call'
        ? `gate: agent holds active call ${agent.currentCallId} -> not a candidate`
        : `gate: ${gate} -> not a candidate`,
    );
    return evaluation;
  }
  evaluation.eligible = true;
  trace.push('gate: available, no active call -> candidate');

  const queues = indexById(ctx.queues);

  // STEP 2 / 3a — inbound first, always.
  evaluation.inboundCandidates = collectInboundCandidates(
    agent,
    queues,
    ctx.waitingCalls,
    ctx.now,
    claimedCallIds,
  );
  const inboundQueueCount = agent.assignedQueues.filter((a) => a.type === 'inbound').length;
  trace.push(
    `inbound: checked ${inboundQueueCount} assigned inbound queue(s), ` +
      `${evaluation.inboundCandidates.length} with a waiting skill-matched call`,
  );

  if (evaluation.inboundCandidates.length > 0) {
    const best = evaluation.inboundCandidates[0];
    trace.push(
      `inbound wins: queue "${best.queueName}" (inbound priority ${best.priority}, ` +
        `waited ${Math.round(best.waitMs / 1000)}s) — outbound not evaluated`,
    );
    return evaluation;
  }

  // STEP 3b — only now may outbound be looked at.
  trace.push('inbound: nothing waiting -> outbound is now eligible for evaluation');
  evaluation.outboundCandidates = collectOutboundCandidates(
    agent,
    queues,
    ctx.outboundDemand,
    claimedCampaignLines,
  );
  trace.push(
    `outbound: ${evaluation.outboundCandidates.length} campaign(s) due to dial for this agent`,
  );
  if (evaluation.outboundCandidates.length > 0) {
    const best = evaluation.outboundCandidates[0];
    trace.push(
      `outbound wins: campaign queue "${best.queueName}" (outbound priority ${best.priority}, ` +
        `rankOverride ${best.rankOverride ?? 'unset'}, mode ${best.dialingMode})`,
    );
  }
  return evaluation;
}

/** Turn an evaluation into a decision (or a 'none' decision explaining why not). */
export function decisionFromEvaluation(
  evaluation: AgentEvaluation,
  triggerType: TriggerType,
): RoutingDecision {
  const base = {
    triggerType,
    agentId: evaluation.agentId,
    agentName: evaluation.agentName,
    evaluation,
  };

  if (!evaluation.eligible) {
    return {
      ...base,
      candidateType: 'none',
      reason: `agent skipped (${evaluation.gateReason}); work stays queued for the next tick`,
    };
  }

  const inbound = evaluation.inboundCandidates[0];
  if (inbound) {
    return {
      ...base,
      candidateType: 'inbound',
      chosenQueueId: inbound.queueId,
      chosenQueueName: inbound.queueName,
      chosenCallId: inbound.callId,
      reason:
        `inbound precedence: queue "${inbound.queueName}" (priority ${inbound.priority}) ` +
        `had the longest-waiting skill-matched call (${Math.round(inbound.waitMs / 1000)}s)`,
    };
  }

  const outbound = evaluation.outboundCandidates[0];
  if (outbound) {
    return {
      ...base,
      candidateType: 'outbound',
      chosenQueueId: outbound.queueId,
      chosenQueueName: outbound.queueName,
      chosenCallId: outbound.itemId,
      campaignId: outbound.campaignId,
      dialingMode: outbound.dialingMode,
      leadId: outbound.leadId,
      phone: outbound.phone,
      requiresAgentConfirmation: outbound.requiresAgentConfirmation,
      reason:
        `no inbound work in any assigned inbound queue; outbound queue "${outbound.queueName}" ` +
        `(priority ${outbound.priority}, rankOverride ${outbound.rankOverride ?? 'unset'}) won the ` +
        `outbound scale in ${outbound.dialingMode} mode`,
    };
  }

  return { ...base, candidateType: 'none', reason: 'agent eligible but no inbound or outbound work available' };
}

/**
 * Run one assignment pass over a set of agents.
 * Each waiting call is claimed at most once and each campaign's requested lines are
 * consumed, so a single tick can never double-assign.
 */
export function runAssignmentTick(
  ctx: RoutingContext,
  triggerType: TriggerType,
  onlyAgentIds?: string[],
): TickResult {
  const claimedCallIds = new Set<string>();
  const claimedCampaignLines = new Map<string, number>();
  const decisions: RoutingDecision[] = [];
  const evaluations: AgentEvaluation[] = [];

  const agents = onlyAgentIds
    ? ctx.agents.filter((a) => onlyAgentIds.includes(a.id))
    : [...ctx.agents];

  // Fairness: longest-idle agent gets first pick.
  agents.sort((a, b) => (a.lastAssignedAt?.getTime() ?? 0) - (b.lastAssignedAt?.getTime() ?? 0));

  for (const agent of agents) {
    const evaluation = evaluateAgent(agent, ctx, claimedCallIds, claimedCampaignLines);
    evaluations.push(evaluation);
    const decision = decisionFromEvaluation(evaluation, triggerType);

    if (decision.candidateType === 'inbound' && decision.chosenCallId) {
      claimedCallIds.add(decision.chosenCallId);
    }
    if (decision.candidateType === 'outbound' && decision.campaignId) {
      claimedCampaignLines.set(
        decision.campaignId,
        (claimedCampaignLines.get(decision.campaignId) ?? 0) + 1,
      );
    }
    decisions.push(decision);
  }

  return { triggerType, at: ctx.now, decisions, evaluations };
}

export * from './types';
