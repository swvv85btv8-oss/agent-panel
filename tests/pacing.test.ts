import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PacingStats,
  PacingStrategy,
  getPacingStrategy,
  listPacingStrategies,
  registerPacingStrategy,
} from '../src/pacing';

const NOW = new Date('2026-09-18T10:00:00.000Z');

function stats(overrides: Partial<PacingStats> = {}): PacingStats {
  return {
    availableAgents: 4,
    totalAgents: 6,
    activeDials: 0,
    connectedCalls: 0,
    abandonRate: 0,
    leadsRemaining: 500,
    ...overrides,
  };
}

const plan = (mode: any, config: Record<string, any> = {}, s: Partial<PacingStats> = {}) =>
  getPacingStrategy(mode).computeDialPlan({
    campaignId: 'c1',
    config,
    stats: stats(s),
    now: NOW,
  });

describe('pacing strategies', () => {
  it('registers all six dialing modes', () => {
    const modes = listPacingStrategies().map((s) => s.mode).sort();
    assert.deepEqual(modes, ['manual', 'power', 'predictive', 'preview', 'progressive', 'ratio']);
  });

  it('progressive is strictly 1:1 and never over-dials', () => {
    assert.equal(plan('progressive').linesToDial, 4);
    assert.equal(plan('progressive', {}, { activeDials: 3 }).linesToDial, 1);
    assert.equal(plan('progressive', {}, { availableAgents: 0 }).linesToDial, 0);
  });

  it('power/ratio use a fixed N:1 with no feedback', () => {
    assert.equal(plan('power', { ratio: 3 }).linesToDial, 12);
    assert.equal(plan('ratio', { ratio: 2 }, { activeDials: 2 }).linesToDial, 6);
  });

  it('predictive backs off when the abandon rate is above target', () => {
    const config = { currentRatio: 2, minRatio: 1, maxRatio: 3, step: 0.4, targetAbandonRate: 0.03 };
    const decision = plan('predictive', config, { abandonRate: 0.12 });
    assert.equal(config.currentRatio, 1.6); // adapted ratio written back
    assert.equal(decision.effectiveRatio, 1.6);
    assert.match(decision.reason, /abandon 12\.0% > target/);
  });

  it('predictive leans in when the abandon rate is within target', () => {
    const config = { currentRatio: 1.5, minRatio: 1, maxRatio: 3, step: 0.4, targetAbandonRate: 0.03 };
    plan('predictive', config, { abandonRate: 0.01 });
    assert.equal(config.currentRatio, 1.7);
  });

  it('predictive respects min and max ratio bounds', () => {
    const low = { currentRatio: 1, minRatio: 1, maxRatio: 3, step: 1, targetAbandonRate: 0.03 };
    plan('predictive', low, { abandonRate: 0.9 });
    assert.equal(low.currentRatio, 1);
    const high = { currentRatio: 3, minRatio: 1, maxRatio: 3, step: 1, targetAbandonRate: 0.03 };
    plan('predictive', high, { abandonRate: 0 });
    assert.equal(high.currentRatio, 3);
  });

  it('preview asks for lines but requires the agent to confirm before dialling', () => {
    assert.equal(getPacingStrategy('preview').requiresAgentConfirmation, true);
    assert.equal(getPacingStrategy('preview').autoDials, false);
    assert.equal(plan('preview').linesToDial, 4);
  });

  it('manual never auto-dials', () => {
    assert.equal(plan('manual', {}, { availableAgents: 10 }).linesToDial, 0);
    assert.equal(getPacingStrategy('manual').autoDials, false);
  });

  it('no strategy ever asks for more lines than there are leads', () => {
    assert.equal(plan('power', { ratio: 5 }, { leadsRemaining: 3 }).linesToDial, 3);
    assert.equal(plan('progressive', {}, { leadsRemaining: 0 }).linesToDial, 0);
  });

  it('a new dialing mode can be plugged in without touching the engine', () => {
    const burst: PacingStrategy = {
      mode: 'burst' as any,
      requiresAgentConfirmation: false,
      autoDials: true,
      computeDialPlan: ({ stats: s, now }) => ({
        mode: 'burst' as any,
        linesToDial: s.availableAgents * 10,
        nextDueAt: new Date(now.getTime() + 1000),
        effectiveRatio: 10,
        reason: 'burst: 10:1',
      }),
    };
    registerPacingStrategy(burst);
    assert.equal(getPacingStrategy('burst' as any).computeDialPlan({
      campaignId: 'c', config: {}, stats: stats(), now: NOW,
    }).linesToDial, 40);
  });

  it('an unknown dialing mode fails loudly', () => {
    assert.throws(() => getPacingStrategy('telepathy' as any), /No pacing strategy registered/);
  });
});
