import { Types } from 'mongoose';
import {
  Agent,
  CallQueueItem,
  CallSession,
  Campaign,
  Lead,
  Queue,
  RoutingDecisionLog,
} from '../models';
import { getPacingStrategy } from '../pacing';
import {
  AgentSnapshot,
  OutboundDemandSnapshot,
  QueueSnapshot,
  RoutingContext,
  RoutingDecision,
  TickResult,
  TriggerType,
  WaitingCallSnapshot,
  checkAgentGate,
  runAssignmentTick,
} from '../routing';
import { emit } from '../ws/bus';
import { withAgentLock } from './lock';
import { decrQueueDepth, getQueueDepths } from './queueDepth';
import { toStatePayload } from './agentService';

/* ------------------------------------------------------------------ snapshots */

/** Load the whole world the engine needs, as plain snapshots. */
export async function loadRoutingContext(now = new Date()): Promise<RoutingContext> {
  const [agentDocs, queueDocs, waitingDocs, campaignDocs] = await Promise.all([
    Agent.find().lean(),
    Queue.find().lean(),
    CallQueueItem.find({ status: 'waiting' }).sort({ queuedAt: 1 }).lean(),
    Campaign.find({ active: true }).lean(),
  ]);

  const agents: AgentSnapshot[] = agentDocs.map((a) => ({
    id: String(a._id),
    name: a.name,
    status: a.status,
    currentCallId: a.currentCallId ? String(a.currentCallId) : null,
    wrapUpStartedAt: a.wrapUpStartedAt ?? null,
    wrapUpDeadline: a.wrapUpDeadline ?? null,
    lastAssignedAt: a.lastAssignedAt ?? null,
    skills: (a.skills ?? []).map((s) => ({
      skillId: String(s.skillId),
      proficiency: s.proficiency,
    })),
    assignedQueues: (a.assignedQueues ?? []).map((q) => ({
      queueId: String(q.queueId),
      type: q.type,
      rankOverride: q.rankOverride ?? null,
    })),
  }));

  const queues: QueueSnapshot[] = queueDocs.map((q) => ({
    id: String(q._id),
    name: q.name,
    type: q.type,
    priority: q.priority,
    requiredSkillId: q.requiredSkillId ? String(q.requiredSkillId) : null,
    minProficiency: q.minProficiency ?? 1,
    campaignId: q.campaignId ? String(q.campaignId) : null,
  }));

  const waitingCalls: WaitingCallSnapshot[] = waitingDocs
    .filter((c) => c.direction === 'inbound')
    .map((c) => ({
      id: String(c._id),
      queueId: String(c.queueId),
      callerNumber: c.callerNumber ?? null,
      leadId: null,
      queuedAt: new Date(c.queuedAt),
      matchedSkillId: c.matchedSkillId ? String(c.matchedSkillId) : null,
    }));

  // Outbound demand = the lines each campaign's pacing strategy has already put up.
  const campaignByQueue = new Map(campaignDocs.map((c) => [String(c.queueId), c]));
  const outboundByQueue = new Map<string, OutboundDemandSnapshot>();
  for (const item of waitingDocs) {
    if (item.direction !== 'outbound') continue;
    const queueId = String(item.queueId);
    const campaign = campaignByQueue.get(queueId);
    if (!campaign) continue;
    const strategy = getPacingStrategy(campaign.dialingMode);
    let demand = outboundByQueue.get(queueId);
    if (!demand) {
      demand = {
        campaignId: String(campaign._id),
        queueId,
        dialingMode: campaign.dialingMode,
        linesRequested: 0,
        items: [],
        dueAt: new Date(item.queuedAt),
        requiresAgentConfirmation: strategy.requiresAgentConfirmation,
      };
      outboundByQueue.set(queueId, demand);
    }
    demand.items.push({
      itemId: String(item._id),
      leadId: item.leadId ? String(item.leadId) : null,
      phone: item.callerNumber ?? null,
      queuedAt: new Date(item.queuedAt),
    });
    demand.linesRequested = demand.items.length;
  }

  return { now, agents, queues, waitingCalls, outboundDemand: [...outboundByQueue.values()] };
}

/* ------------------------------------------------------------------- the tick */

export interface CommitResult {
  decision: RoutingDecision;
  committed: boolean;
  /** Why a decision that the engine made could not be committed. */
  rejectedReason?: string;
  callSessionId?: string;
}

/**
 * One assignment pass: load snapshots -> run the pure engine -> commit each decision
 * under that agent's Redis lock, re-checking the gate against fresh state.
 */
export async function runAssignmentPass(
  triggerType: TriggerType = 'periodic_tick',
  onlyAgentIds?: string[],
): Promise<{ tick: TickResult; results: CommitResult[] }> {
  const ctx = await loadRoutingContext();
  const tick = runAssignmentTick(ctx, triggerType, onlyAgentIds);
  const results: CommitResult[] = [];

  for (const decision of tick.decisions) {
    if (decision.candidateType === 'none') {
      results.push({ decision, committed: false });
      continue;
    }
    results.push(await commitDecision(decision));
  }

  const committed = results.filter((r) => r.committed);
  // Log every decision that either assigned work or explains why an agent was skipped
  // while work was waiting — this is the feed the supervisor dashboard renders.
  const loggable = tick.decisions.filter(
    (d) =>
      d.candidateType !== 'none' ||
      (d.evaluation.gateReason && (ctx.waitingCalls.length > 0 || ctx.outboundDemand.length > 0)),
  );
  await Promise.all(loggable.map((d) => logDecision(d, results)));

  if (committed.length > 0) {
    emit('queue:depth', await getQueueDepths());
  }
  return { tick, results };
}

/**
 * Commit a single decision. Everything between the re-check and the currentCallId write
 * happens inside the per-agent Redis lock, so two concurrent triggers cannot both win.
 */
export async function commitDecision(decision: RoutingDecision): Promise<CommitResult> {
  const agentId = decision.agentId;
  const result = await withAgentLock(agentId, async (): Promise<CommitResult> => {
    // 1. Re-read the agent and re-apply the gate against fresh state.
    const agentDoc = await Agent.findById(agentId);
    if (!agentDoc) return { decision, committed: false, rejectedReason: 'agent_disappeared' };
    const fresh: AgentSnapshot = {
      id: String(agentDoc._id),
      name: agentDoc.name,
      status: agentDoc.status,
      currentCallId: agentDoc.currentCallId ? String(agentDoc.currentCallId) : null,
      skills: [],
      assignedQueues: agentDoc.assignedQueues.map((q) => ({
        queueId: String(q.queueId),
        type: q.type,
      })),
    };
    const gate = checkAgentGate(fresh);
    if (gate) {
      // The work stays exactly where it is and is re-evaluated next tick.
      return { decision, committed: false, rejectedReason: gate };
    }

    // 2. Claim the queue item atomically: only one winner can flip it out of 'waiting'.
    const requiresConfirm = decision.requiresAgentConfirmation === true;
    const item = await CallQueueItem.findOneAndUpdate(
      { _id: decision.chosenCallId, status: 'waiting' },
      {
        status: requiresConfirm ? 'offered' : 'assigned',
        offeredToAgentId: new Types.ObjectId(agentId),
        assignedAgentId: requiresConfirm ? null : new Types.ObjectId(agentId),
      },
      { new: true },
    );
    if (!item) return { decision, committed: false, rejectedReason: 'call_already_taken' };

    // 3. Open the call session and take the agent out of candidacy.
    const session = await CallSession.create({
      direction: decision.candidateType,
      queueId: item.queueId,
      agentId: agentDoc._id,
      campaignId: item.campaignId ?? null,
      leadId: item.leadId ?? null,
      queueItemId: item._id,
      dialingMode: decision.dialingMode ?? null,
      callerNumber: item.callerNumber ?? null,
      state: requiresConfirm ? 'offering' : 'connected',
      startedAt: new Date(),
    });

    agentDoc.currentCallId = session._id as Types.ObjectId;
    agentDoc.status = 'on_call';
    agentDoc.lastAssignedAt = new Date();
    await agentDoc.save();

    if (item.leadId) {
      // The campaign tick already reserved the lead as 'dialing'; record the attempt.
      await Lead.findByIdAndUpdate(item.leadId, {
        lastAttemptAt: new Date(),
        $inc: { attemptCount: 1 },
      });
    }
    await decrQueueDepth(String(item.queueId));

    const payload = {
      callId: String(session._id),
      agentId,
      agentName: decision.agentName,
      direction: decision.candidateType,
      queueId: decision.chosenQueueId,
      queueName: decision.chosenQueueName,
      campaignId: decision.campaignId ?? null,
      dialingMode: decision.dialingMode ?? null,
      callerNumber: item.callerNumber ?? null,
      reason: decision.reason,
    };
    emit(requiresConfirm ? 'call:offered' : 'call:assigned', payload);
    emit('agent:state', { ...toStatePayload(agentDoc), transition: 'assigned' });

    return { decision, committed: true, callSessionId: String(session._id) };
  });

  return result ?? { decision, committed: false, rejectedReason: 'agent_locked' };
}

/* ---------------------------------------------------------------- decision log */

async function logDecision(decision: RoutingDecision, results: CommitResult[]): Promise<void> {
  const commit = results.find((r) => r.decision === decision);
  const reason = commit?.committed
    ? decision.reason
    : commit?.rejectedReason
      ? `${decision.reason} — NOT committed (${commit.rejectedReason}); work stays queued`
      : decision.reason;

  const doc = await RoutingDecisionLog.create({
    triggerType: decision.triggerType,
    candidateType: decision.candidateType,
    evaluatedAgents: [
      {
        agentId: Types.ObjectId.isValid(decision.agentId)
          ? new Types.ObjectId(decision.agentId)
          : null,
        agentName: decision.agentName,
        status: decision.evaluation.status,
        eligible: decision.evaluation.eligible,
        gateReason: decision.evaluation.gateReason,
        inboundCandidateCount: decision.evaluation.inboundCandidates.length,
        outboundCandidateCount: decision.evaluation.outboundCandidates.length,
        trace: decision.evaluation.trace,
      },
    ],
    chosenAgentId:
      commit?.committed && Types.ObjectId.isValid(decision.agentId)
        ? new Types.ObjectId(decision.agentId)
        : null,
    chosenQueueId:
      commit?.committed && decision.chosenQueueId ? new Types.ObjectId(decision.chosenQueueId) : null,
    chosenCallId:
      commit?.committed && decision.chosenCallId ? new Types.ObjectId(decision.chosenCallId) : null,
    reason,
  });

  emit('routing:decision', {
    id: String(doc._id),
    createdAt: doc.createdAt,
    triggerType: decision.triggerType,
    candidateType: decision.candidateType,
    agentName: decision.agentName,
    agentStatus: decision.evaluation.status,
    queueName: decision.chosenQueueName ?? null,
    committed: commit?.committed ?? false,
    reason,
    trace: decision.evaluation.trace,
  });
}

/* ------------------------------------------------------------- the tick loop */

let loop: NodeJS.Timeout | null = null;
let running = false;

export function startAssignmentLoop(intervalMs: number): void {
  if (loop) return;
  loop = setInterval(async () => {
    if (running) return; // never overlap passes
    running = true;
    try {
      await runAssignmentPass('periodic_tick');
    } catch (e: any) {
      console.error('[assignment] pass failed', e.message);
    } finally {
      running = false;
    }
  }, intervalMs);
  console.log(`[assignment] loop started (every ${intervalMs}ms)`);
}

export function stopAssignmentLoop(): void {
  if (loop) clearInterval(loop);
  loop = null;
}
