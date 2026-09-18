import { Types } from 'mongoose';
import { KEYS, getRedis } from '../db/redis';
import { Agent, AgentDoc, CallQueueItem, CallSession, Lead } from '../models';
import { AgentStatus } from '../routing/types';
import { emit } from '../ws/bus';
import { withAgentLock } from './lock';
import { getWrapUpSeconds } from './settingsService';
import { incrQueueDepth } from './queueDepth';

/**
 * AGENT STATE MACHINE
 *
 *   offline/break  --(setStatus)-->  available
 *   available      --(assignment)-->  on_call        [currentCallId set]
 *   on_call        --(endCall)---->  wrap_up        [currentCallId cleared, timer armed]
 *   wrap_up        --(timer expiry OR endWrapUp)-->  available
 *   any            --(setStatus)-->  break | offline
 *
 * Only `available` with currentCallId == null is a candidate for assignment.
 * wrap_up is, as far as the routing engine is concerned, just another non-available state.
 */

export class AgentStateError extends Error {}

export interface AgentStatePayload {
  agentId: string;
  name: string;
  status: AgentStatus;
  currentCallId: string | null;
  wrapUpStartedAt: string | null;
  wrapUpDeadline: string | null;
  wrapUpRemainingSeconds: number | null;
}

export function toStatePayload(agent: AgentDoc | any): AgentStatePayload {
  const deadline = agent.wrapUpDeadline ? new Date(agent.wrapUpDeadline) : null;
  return {
    agentId: String(agent._id),
    name: agent.name,
    status: agent.status,
    currentCallId: agent.currentCallId ? String(agent.currentCallId) : null,
    wrapUpStartedAt: agent.wrapUpStartedAt ? new Date(agent.wrapUpStartedAt).toISOString() : null,
    wrapUpDeadline: deadline ? deadline.toISOString() : null,
    wrapUpRemainingSeconds: deadline
      ? Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / 1000))
      : null,
  };
}

function publish(agent: AgentDoc | any, transition: string): AgentStatePayload {
  const payload = toStatePayload(agent);
  emit('agent:state', { ...payload, transition });
  return payload;
}

async function loadAgent(agentId: string): Promise<AgentDoc> {
  const agent = await Agent.findById(agentId);
  if (!agent) throw new AgentStateError(`agent ${agentId} not found`);
  return agent;
}

/** login == "I'm at my desk": offline -> available. */
export async function login(agentId: string): Promise<AgentStatePayload> {
  const result = await withAgentLock(agentId, async () => {
    const agent = await loadAgent(agentId);
    if (agent.currentCallId) {
      // Already holding a call (e.g. page reload mid-call) — leave the state alone.
      return publish(agent, 'login:noop-active-call');
    }
    if (agent.status === 'wrap_up') return publish(agent, 'login:noop-wrap-up');
    agent.status = 'available';
    await agent.save();
    return publish(agent, 'login');
  });
  if (!result) throw new AgentStateError('agent is busy, try again');
  return result;
}

/**
 * Agent/supervisor-initiated status change. Only available|break|offline are settable
 * by hand — on_call and wrap_up are owned by the assignment/call lifecycle.
 */
export async function setStatus(
  agentId: string,
  status: 'available' | 'break' | 'offline',
): Promise<AgentStatePayload> {
  if (!['available', 'break', 'offline'].includes(status)) {
    throw new AgentStateError(`status "${status}" cannot be set manually`);
  }
  const result = await withAgentLock(agentId, async () => {
    const agent = await loadAgent(agentId);
    if (agent.currentCallId) {
      throw new AgentStateError(
        'agent has an active call; end the call before changing status',
      );
    }
    if (agent.status === 'wrap_up' && status !== 'available') {
      // Going on break straight out of wrap-up is fine, but the timer must be disarmed.
      await getRedis().del(KEYS.wrapUp(agentId));
      agent.wrapUpStartedAt = null;
      agent.wrapUpDeadline = null;
    }
    if (status === 'available' && agent.status === 'wrap_up') {
      return endWrapUpInternal(agent, 'manual');
    }
    agent.status = status;
    agent.wrapUpStartedAt = null;
    agent.wrapUpDeadline = null;
    await agent.save();
    return publish(agent, `setStatus:${status}`);
  });
  if (!result) throw new AgentStateError('agent is busy, try again');
  return result;
}

/**
 * End the active call. The agent ALWAYS lands in wrap_up with the timer armed —
 * they are not a candidate for anything again until it clears.
 */
export async function endCall(
  agentId: string,
  disposition = 'completed',
): Promise<AgentStatePayload> {
  const result = await withAgentLock(agentId, async () => {
    const agent = await loadAgent(agentId);
    if (!agent.currentCallId) throw new AgentStateError('agent has no active call');

    const session = await CallSession.findById(agent.currentCallId);
    if (session) {
      session.endedAt = new Date();
      session.state = 'ended';
      session.disposition = disposition;
      await session.save();
      if (session.queueItemId) {
        await CallQueueItem.findByIdAndUpdate(session.queueItemId, { status: 'completed' });
      }
      if (session.leadId) {
        await Lead.findByIdAndUpdate(session.leadId, { status: 'contacted' });
      }
      emit('call:ended', {
        callId: String(session._id),
        agentId,
        disposition,
        direction: session.direction,
      });
    }

    const seconds = await getWrapUpSeconds();
    const now = new Date();
    agent.currentCallId = null;
    agent.status = 'wrap_up';
    agent.wrapUpStartedAt = now;
    agent.wrapUpDeadline = new Date(now.getTime() + seconds * 1000);
    await agent.save();

    // Redis TTL key drives the countdown server-side: no connected client required.
    await getRedis().set(KEYS.wrapUp(agentId), '1', 'EX', seconds);
    return publish(agent, `endCall:${disposition}->wrap_up(${seconds}s)`);
  });
  if (!result) throw new AgentStateError('agent is busy, try again');
  return result;
}

async function endWrapUpInternal(
  agent: AgentDoc,
  cause: 'manual' | 'timer',
): Promise<AgentStatePayload> {
  await getRedis().del(KEYS.wrapUp(String(agent._id)));
  agent.status = 'available';
  agent.wrapUpStartedAt = null;
  agent.wrapUpDeadline = null;
  await agent.save();
  return publish(agent, `endWrapUp:${cause}`);
}

/** The "I'm ready" button: leave wrap-up early. */
export async function endWrapUp(agentId: string): Promise<AgentStatePayload> {
  const result = await withAgentLock(agentId, async () => {
    const agent = await loadAgent(agentId);
    if (agent.status !== 'wrap_up') throw new AgentStateError('agent is not in wrap-up');
    return endWrapUpInternal(agent, 'manual');
  });
  if (!result) throw new AgentStateError('agent is busy, try again');
  return result;
}

/** Called by the Redis expiry listener / sweeper when the wrap-up timer runs out. */
export async function expireWrapUp(agentId: string): Promise<AgentStatePayload | null> {
  return withAgentLock(agentId, async () => {
    const agent = await Agent.findById(agentId);
    if (!agent || agent.status !== 'wrap_up') return null;
    if (agent.wrapUpDeadline && agent.wrapUpDeadline.getTime() > Date.now() + 250) {
      return null; // deadline moved (settings change); let the next sweep handle it
    }
    return endWrapUpInternal(agent, 'timer');
  }).then((r) => r ?? null);
}

/** Accept a preview/manual offer: the offering session becomes a connected call. */
export async function acceptCall(agentId: string): Promise<AgentStatePayload> {
  const result = await withAgentLock(agentId, async () => {
    const agent = await loadAgent(agentId);
    if (!agent.currentCallId) throw new AgentStateError('nothing offered to this agent');
    const session = await CallSession.findById(agent.currentCallId);
    if (!session || session.state !== 'offering') {
      throw new AgentStateError('no offer awaiting confirmation');
    }
    session.state = 'connected';
    session.startedAt = new Date();
    await session.save();
    if (session.queueItemId) {
      await CallQueueItem.findByIdAndUpdate(session.queueItemId, {
        status: 'assigned',
        assignedAgentId: new Types.ObjectId(agentId),
      });
    }
    emit('call:accepted', { callId: String(session._id), agentId });
    return publish(agent, 'acceptCall');
  });
  if (!result) throw new AgentStateError('agent is busy, try again');
  return result;
}

/**
 * Reject an offer. The lead goes straight back to 'waiting' in its queue — it is
 * never dropped — and the agent returns to available with no wrap-up.
 */
export async function rejectCall(agentId: string, reason = 'rejected'): Promise<AgentStatePayload> {
  const result = await withAgentLock(agentId, async () => {
    const agent = await loadAgent(agentId);
    if (!agent.currentCallId) throw new AgentStateError('nothing offered to this agent');
    const session = await CallSession.findById(agent.currentCallId);
    if (!session || session.state !== 'offering') {
      throw new AgentStateError('no offer awaiting confirmation');
    }
    session.state = 'ended';
    session.endedAt = new Date();
    session.disposition = reason;
    await session.save();
    if (session.queueItemId) {
      // Requeue, do not drop — and put the depth counter back, since the assignment
      // that took this item off the queue decremented it.
      await CallQueueItem.findByIdAndUpdate(session.queueItemId, {
        status: 'waiting',
        offeredToAgentId: null,
        assignedAgentId: null,
      });
      await incrQueueDepth(String(session.queueId));
    }
    if (session.leadId) {
      // Back to 'new' so the campaign can put this lead up again.
      await Lead.findByIdAndUpdate(session.leadId, { status: 'new' });
    }
    agent.currentCallId = null;
    agent.status = 'available';
    await agent.save();
    emit('call:rejected', { callId: String(session._id), agentId, reason });
    return publish(agent, 'rejectCall');
  });
  if (!result) throw new AgentStateError('agent is busy, try again');
  return result;
}

/** Supervisor-visible snapshot of every agent. */
export async function listAgentStates(): Promise<AgentStatePayload[]> {
  const agents = await Agent.find().lean();
  return agents.map(toStatePayload);
}
