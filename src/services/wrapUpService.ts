import { KEYS, ensureKeyspaceNotifications, getRedis, getRedisSubscriber } from '../db/redis';
import { Agent } from '../models';
import { emit } from '../ws/bus';
import { expireWrapUp, toStatePayload } from './agentService';

/**
 * The wrap-up countdown is driven server-side by a Redis TTL key
 * (`dialer:wrapup:<agentId>`), so it does not depend on any client staying connected.
 *
 *  - primary:  keyspace expiry notification flips the agent to available
 *  - safety net: a 1s sweeper catches expiries missed while the process was down,
 *    and emits the per-second countdown ticks the dashboards render.
 */
let sweeper: NodeJS.Timeout | null = null;

export async function startWrapUpWatcher(): Promise<void> {
  await ensureKeyspaceNotifications();

  const sub = getRedisSubscriber();
  const db = (getRedis().options.db ?? 0) as number;
  await sub.psubscribe(`__keyevent@${db}__:expired`);
  sub.on('pmessage', async (_pattern, _channel, key: string) => {
    if (!key.startsWith('dialer:wrapup:')) return;
    const agentId = key.substring('dialer:wrapup:'.length);
    const state = await expireWrapUp(agentId);
    if (state) console.log(`[wrapup] ${state.name} auto-returned to available (timer expired)`);
  });

  sweeper = setInterval(tickWrapUps, 1000);
  console.log('[wrapup] watcher started (redis expiry + 1s sweeper)');
}

/** Emits countdown ticks and force-expires anything the notification missed. */
export async function tickWrapUps(): Promise<void> {
  try {
    const agents = await Agent.find({ status: 'wrap_up' }).lean();
    const now = Date.now();
    for (const agent of agents) {
      const deadline = agent.wrapUpDeadline ? new Date(agent.wrapUpDeadline).getTime() : 0;
      const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
      emit('wrapup:tick', {
        agentId: String(agent._id),
        name: agent.name,
        remainingSeconds: remaining,
        deadline: agent.wrapUpDeadline,
      });
      if (deadline && deadline <= now) {
        const state = await expireWrapUp(String(agent._id));
        if (state) emit('agent:state', { ...state, transition: 'wrapUp:swept' });
      }
    }
  } catch (e: any) {
    console.error('[wrapup] sweeper error', e.message);
  }
}

export function stopWrapUpWatcher(): void {
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
}

export { toStatePayload, KEYS };
