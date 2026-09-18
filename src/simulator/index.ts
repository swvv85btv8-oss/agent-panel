import { Types } from 'mongoose';
import { env } from '../config/env';
import { Agent, CallQueueItem, CallSession, Campaign, Lead, Queue } from '../models';
import { PacingStats, getPacingStrategy } from '../pacing';
import { emit } from '../ws/bus';
import { endCall } from '../services/agentService';
import { runAssignmentPass } from '../services/assignmentService';
import { incrQueueDepth } from '../services/queueDepth';

/**
 * CALL SIMULATOR — stands in for SIP/Asterisk, which is out of scope for the POC.
 *  - synthesises inbound calls onto inbound queues at a configurable rate
 *  - runs each campaign's pacing strategy on a tick and puts up the lines it asks for
 *  - ages connected calls and ends them, which drives the wrap-up path for real
 */

function randomPhone(): string {
  return `+9198${Math.floor(10000000 + Math.random() * 89999999)}`;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

/* ----------------------------------------------------------- inbound arrivals */

/** Inject a synthetic inbound call. Also used directly by POST /simulate/inbound-call. */
export async function injectInboundCall(
  queueId: string,
  callerNumber = randomPhone(),
): Promise<any> {
  const queue = await Queue.findById(queueId).lean();
  if (!queue) throw new Error(`queue ${queueId} not found`);
  if (queue.type !== 'inbound') throw new Error(`queue ${queue.name} is not an inbound queue`);

  const item = await CallQueueItem.create({
    queueId: queue._id,
    direction: 'inbound',
    callerNumber,
    queuedAt: new Date(),
    matchedSkillId: queue.requiredSkillId ?? null,
    status: 'waiting',
  });
  await incrQueueDepth(String(queue._id));
  emit('call:queued', {
    itemId: String(item._id),
    queueId: String(queue._id),
    queueName: queue.name,
    direction: 'inbound',
    callerNumber,
    priority: queue.priority,
  });

  // An arrival is itself a routing trigger.
  await runAssignmentPass('inbound_call_arrival');
  return item;
}

/** Each inbound queue has an arrival rate (calls/minute) held in a module-level map. */
const inboundRates = new Map<string, number>();

export function setInboundRate(queueId: string, callsPerMinute: number): void {
  inboundRates.set(String(queueId), Math.max(0, callsPerMinute));
}

export function getInboundRates(): Record<string, number> {
  return Object.fromEntries(inboundRates);
}

async function inboundTick(): Promise<void> {
  const queues = await Queue.find({ type: 'inbound' }).lean();
  for (const q of queues) {
    const perMinute = inboundRates.get(String(q._id)) ?? 4;
    // Probability of one arrival in this tick window.
    const p = (perMinute / 60) * (env.simulatorInboundTickMs / 1000);
    if (Math.random() < p) {
      await injectInboundCall(String(q._id)).catch((e) =>
        console.error('[sim] inbound inject failed', e.message),
      );
    }
  }
}

/* ------------------------------------------------------------ campaign pacing */

async function pacingStatsFor(campaign: any): Promise<PacingStats> {
  const queueId = campaign.queueId;
  const [assignedAgents, activeDials, connectedCalls, leadsRemaining] = await Promise.all([
    Agent.find({ 'assignedQueues.queueId': queueId }).lean(),
    CallQueueItem.countDocuments({
      queueId,
      direction: 'outbound',
      status: { $in: ['waiting', 'offered'] },
    }),
    CallSession.countDocuments({ campaignId: campaign._id, state: 'connected', endedAt: null }),
    Lead.countDocuments({ campaignId: campaign._id, status: 'new', dncFlag: false }),
  ]);

  const available = assignedAgents.filter(
    (a) => a.status === 'available' && !a.currentCallId,
  ).length;

  // Rolling abandon rate over the campaign's finished sessions.
  const [total, abandoned] = await Promise.all([
    CallSession.countDocuments({ campaignId: campaign._id, endedAt: { $ne: null } }),
    CallSession.countDocuments({ campaignId: campaign._id, disposition: 'abandoned' }),
  ]);

  return {
    availableAgents: available,
    totalAgents: assignedAgents.length,
    activeDials,
    connectedCalls,
    abandonRate: total > 0 ? abandoned / total : 0,
    leadsRemaining,
  };
}

/**
 * Run one campaign's pacing strategy and put up the lines it asks for.
 * `force` bypasses the nextDueAt gate (used by POST /simulate/campaign-tick).
 */
export async function runCampaignTick(campaignId: string, force = false, manualLines = 0) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);
  const now = new Date();
  if (!force && campaign.nextDueAt && campaign.nextDueAt.getTime() > now.getTime()) {
    return { campaignId, skipped: true, reason: 'not due yet', nextDueAt: campaign.nextDueAt };
  }

  const strategy = getPacingStrategy(campaign.dialingMode);
  const stats = await pacingStatsFor(campaign);
  const config = { ...(campaign.pacingConfig ?? {}) };
  const decision = strategy.computeDialPlan({
    campaignId: String(campaign._id),
    config,
    stats,
    now,
    lastDueAt: campaign.nextDueAt,
  });

  // manual mode dials only when an agent (or the demo endpoint) explicitly asks.
  const lines = campaign.dialingMode === 'manual' ? manualLines : decision.linesToDial;

  const created: string[] = [];
  for (let i = 0; i < lines; i += 1) {
    const lead = await Lead.findOneAndUpdate(
      { campaignId: campaign._id, status: 'new', dncFlag: false },
      { status: 'dialing', lastAttemptAt: now },
      { new: true, sort: { createdAt: 1 } },
    );
    if (!lead) break;
    const item = await CallQueueItem.create({
      queueId: campaign.queueId,
      direction: 'outbound',
      leadId: lead._id,
      campaignId: campaign._id,
      callerNumber: lead.phone,
      queuedAt: new Date(),
      status: 'waiting',
    });
    await incrQueueDepth(String(campaign.queueId));
    created.push(String(item._id));
  }

  campaign.pacingConfig = config; // predictive writes its adapted ratio back
  campaign.markModified('pacingConfig');
  campaign.nextDueAt = decision.nextDueAt;
  campaign.lastPacingDecision = { ...decision, linesPlaced: created.length, stats, at: now };
  await campaign.save();

  emit('campaign:pacing', {
    campaignId: String(campaign._id),
    name: campaign.name,
    dialingMode: campaign.dialingMode,
    linesRequested: lines,
    linesPlaced: created.length,
    effectiveRatio: decision.effectiveRatio,
    reason: decision.reason,
    stats,
    nextDueAt: decision.nextDueAt,
  });

  if (created.length > 0) await runAssignmentPass('campaign_tick');
  return { campaignId, decision, linesPlaced: created.length, stats, created };
}

async function campaignTick(): Promise<void> {
  const campaigns = await Campaign.find({ active: true }).lean();
  for (const c of campaigns) {
    await runCampaignTick(String(c._id)).catch((e) =>
      console.error(`[sim] campaign ${c.name} tick failed`, e.message),
    );
  }
}

/* ------------------------------------------------------- ageing active calls */

/** Hang up synthetic calls once they have run their (random) talk time. */
async function ageCalls(): Promise<void> {
  const sessions = await CallSession.find({ state: 'connected', endedAt: null }).lean();
  const now = Date.now();
  for (const s of sessions) {
    const talkMs = simTalkTime(String(s._id));
    if (now - new Date(s.startedAt).getTime() >= talkMs) {
      await endCall(String(s.agentId), 'completed').catch((e) =>
        console.error('[sim] endCall failed', e.message),
      );
      talkTimes.delete(String(s._id));
    }
  }
}

const talkTimes = new Map<string, number>();
function simTalkTime(sessionId: string): number {
  let t = talkTimes.get(sessionId);
  if (!t) {
    t = randomBetween(env.simCallMinMs, env.simCallMaxMs);
    talkTimes.set(sessionId, t);
  }
  return t;
}

/* -------------------------------------------------------------- lifecycle */

let inboundLoop: NodeJS.Timeout | null = null;
let campaignLoop: NodeJS.Timeout | null = null;
let ageLoop: NodeJS.Timeout | null = null;
let enabled = false;

export function startSimulator(): void {
  if (inboundLoop) return;
  enabled = true;
  inboundLoop = setInterval(() => {
    if (enabled) inboundTick().catch((e) => console.error('[sim] inbound tick', e.message));
  }, env.simulatorInboundTickMs);
  campaignLoop = setInterval(() => {
    if (enabled) campaignTick().catch((e) => console.error('[sim] campaign tick', e.message));
  }, env.simulatorCampaignTickMs);
  ageLoop = setInterval(() => {
    if (enabled) ageCalls().catch((e) => console.error('[sim] age calls', e.message));
  }, 1000);
  console.log('[sim] call simulator started');
}

export function setSimulatorEnabled(value: boolean): boolean {
  enabled = value;
  emit('simulator:state', { enabled });
  return enabled;
}

export function isSimulatorEnabled(): boolean {
  return enabled;
}

export function stopSimulator(): void {
  [inboundLoop, campaignLoop, ageLoop].forEach((t) => t && clearInterval(t));
  inboundLoop = campaignLoop = ageLoop = null;
  enabled = false;
}

export { randomPhone };
export type { Types };
