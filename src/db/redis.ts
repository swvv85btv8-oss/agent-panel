import Redis from 'ioredis';
import { env } from '../config/env';

let client: Redis | null = null;
let subscriber: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
    client.on('error', (e) => console.error('[redis] error', e.message));
  }
  return client;
}

/** Separate connection: a client in subscribe mode cannot run normal commands. */
export function getRedisSubscriber(): Redis {
  if (!subscriber) {
    subscriber = new Redis(env.redisUrl, { maxRetriesPerRequest: null });
    subscriber.on('error', (e) => console.error('[redis-sub] error', e.message));
  }
  return subscriber;
}

/** Best-effort: we need key-expiry events for the wrap-up countdown. */
export async function ensureKeyspaceNotifications(): Promise<void> {
  try {
    await getRedis().config('SET', 'notify-keyspace-events', 'Ex');
  } catch (e: any) {
    console.warn(
      `[redis] could not enable keyspace notifications (${e.message}); ` +
        'falling back to the wrap-up sweeper only',
    );
  }
}

export async function closeRedis(): Promise<void> {
  await Promise.all([client?.quit(), subscriber?.quit()].filter(Boolean) as Promise<any>[]);
  client = null;
  subscriber = null;
}

export const KEYS = {
  agentLock: (agentId: string) => `dialer:lock:agent:${agentId}`,
  wrapUp: (agentId: string) => `dialer:wrapup:${agentId}`,
  queueDepth: (queueId: string) => `dialer:queuedepth:${queueId}`,
  queueDepthAll: 'dialer:queuedepth:*',
};
