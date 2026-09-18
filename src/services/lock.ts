import { randomUUID } from 'crypto';
import { KEYS, getRedis } from '../db/redis';

/**
 * Per-agent lock around the whole "check eligibility -> assign -> set currentCallId"
 * sequence. Two concurrent triggers (an inbound arrival and a campaign tick, say) can
 * therefore never both hand a call to the same agent.
 */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export async function acquireAgentLock(agentId: string, ttlMs = 5000): Promise<string | null> {
  const token = randomUUID();
  const ok = await getRedis().set(KEYS.agentLock(agentId), token, 'PX', ttlMs, 'NX');
  return ok === 'OK' ? token : null;
}

export async function releaseAgentLock(agentId: string, token: string): Promise<void> {
  // Compare-and-delete so a lock that already expired isn't stolen from its new owner.
  await getRedis().eval(RELEASE_SCRIPT, 1, KEYS.agentLock(agentId), token);
}

/** Run `fn` while holding the agent lock. Returns null if the lock was not obtainable. */
export async function withAgentLock<T>(
  agentId: string,
  fn: () => Promise<T>,
  ttlMs = 5000,
): Promise<T | null> {
  const token = await acquireAgentLock(agentId, ttlMs);
  if (!token) return null;
  try {
    return await fn();
  } finally {
    await releaseAgentLock(agentId, token);
  }
}
