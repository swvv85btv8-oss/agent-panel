/**
 * Exercises the per-agent Redis lock for real. Skipped automatically when no Redis
 * is reachable at REDIS_URL, so `npm test` stays green on a bare checkout.
 */
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import Redis from 'ioredis';
import { env } from '../src/config/env';

let available = false;
before(async () => {
  const probe = new Redis(env.redisUrl, { lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 1 });
  try {
    await probe.connect();
    await probe.ping();
    available = true;
  } catch {
    available = false;
  } finally {
    probe.disconnect();
  }
});

describe('per-agent assignment lock', () => {
  after(async () => {
    if (!available) return;
    const { closeRedis } = await import('../src/db/redis');
    await closeRedis();
  });

  it('only one of two concurrent holders gets the lock', async (t) => {
    if (!available) return t.skip('no redis at ' + env.redisUrl);
    const { acquireAgentLock, releaseAgentLock } = await import('../src/services/lock');
    const agentId = 'test-agent-' + Date.now();
    const [a, b] = await Promise.all([acquireAgentLock(agentId), acquireAgentLock(agentId)]);
    assert.equal([a, b].filter(Boolean).length, 1);
    await releaseAgentLock(agentId, (a ?? b)!);
  });

  it('the lock is reusable once released', async (t) => {
    if (!available) return t.skip('no redis');
    const { acquireAgentLock, releaseAgentLock } = await import('../src/services/lock');
    const agentId = 'test-agent-reuse-' + Date.now();
    const first = await acquireAgentLock(agentId);
    assert.ok(first);
    await releaseAgentLock(agentId, first!);
    const second = await acquireAgentLock(agentId);
    assert.ok(second);
    await releaseAgentLock(agentId, second!);
  });

  it('a stale token cannot release somebody else\'s lock', async (t) => {
    if (!available) return t.skip('no redis');
    const { acquireAgentLock, releaseAgentLock } = await import('../src/services/lock');
    const agentId = 'test-agent-steal-' + Date.now();
    const token = await acquireAgentLock(agentId);
    await releaseAgentLock(agentId, 'not-the-real-token');
    // Still held, so a second acquire must fail.
    assert.equal(await acquireAgentLock(agentId), null);
    await releaseAgentLock(agentId, token!);
  });

  it('withAgentLock serialises the whole check-assign-commit sequence', async (t) => {
    if (!available) return t.skip('no redis');
    const { withAgentLock } = await import('../src/services/lock');
    const agentId = 'test-agent-race-' + Date.now();
    // Two triggers racing to "assign" the same agent; only one may see a free slot.
    let currentCallId: string | null = null;
    const assign = (callId: string) =>
      withAgentLock(agentId, async () => {
        if (currentCallId) return 'rejected';
        await new Promise((r) => setTimeout(r, 20)); // widen the window on purpose
        currentCallId = callId;
        return 'assigned';
      });
    const results = await Promise.all([assign('call-A'), assign('call-B')]);
    // One assigns; the other is either locked out (null) or sees the taken slot.
    assert.equal(results.filter((r) => r === 'assigned').length, 1);
    assert.ok(currentCallId);
  });
});
