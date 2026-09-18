import { PacingDecision, PacingInput, PacingStrategy, clampLines } from './strategy';

const DEFAULT_INTERVAL_MS = 3000;

function nextDue(input: PacingInput, ms?: number): Date {
  const interval = Number(input.config?.intervalMs ?? ms ?? DEFAULT_INTERVAL_MS);
  return new Date(input.now.getTime() + interval);
}

/**
 * PREDICTIVE — over-dials relative to available agents and corrects itself from
 * abandon-rate feedback. config: { initialRatio, maxRatio, minRatio, targetAbandonRate, step }
 */
export const predictiveStrategy: PacingStrategy = {
  mode: 'predictive',
  requiresAgentConfirmation: false,
  autoDials: true,
  computeDialPlan(input: PacingInput): PacingDecision {
    const cfg = input.config ?? {};
    const minRatio = Number(cfg.minRatio ?? 1);
    const maxRatio = Number(cfg.maxRatio ?? 3);
    const step = Number(cfg.step ?? 0.2);
    const target = Number(cfg.targetAbandonRate ?? 0.03);
    const current = Number(cfg.currentRatio ?? cfg.initialRatio ?? 1.5);

    // Abandon-rate feedback loop: too many drops -> back off, headroom -> lean in.
    let ratio = current;
    let feedback: string;
    if (input.stats.abandonRate > target) {
      ratio = Math.max(minRatio, current - step);
      feedback = `abandon ${(input.stats.abandonRate * 100).toFixed(1)}% > target ${(target * 100).toFixed(1)}% -> ratio ${current.toFixed(2)}→${ratio.toFixed(2)}`;
    } else {
      ratio = Math.min(maxRatio, current + step / 2);
      feedback = `abandon ${(input.stats.abandonRate * 100).toFixed(1)}% <= target ${(target * 100).toFixed(1)}% -> ratio ${current.toFixed(2)}→${ratio.toFixed(2)}`;
    }
    // Persist the adapted ratio back onto the config the caller owns.
    cfg.currentRatio = ratio;

    const want = input.stats.availableAgents * ratio - input.stats.activeDials;
    const lines = clampLines(want, input.stats);
    return {
      mode: 'predictive',
      linesToDial: lines,
      nextDueAt: nextDue(input),
      effectiveRatio: ratio,
      reason: `predictive: ${input.stats.availableAgents} available x ${ratio.toFixed(2)} - ${input.stats.activeDials} in flight = ${lines} line(s); ${feedback}`,
    };
  },
};

/** PROGRESSIVE — strict 1:1, auto-connects, never over-dials. */
export const progressiveStrategy: PacingStrategy = {
  mode: 'progressive',
  requiresAgentConfirmation: false,
  autoDials: true,
  computeDialPlan(input: PacingInput): PacingDecision {
    const want = input.stats.availableAgents - input.stats.activeDials;
    const lines = clampLines(want, input.stats);
    return {
      mode: 'progressive',
      linesToDial: lines,
      nextDueAt: nextDue(input),
      effectiveRatio: 1,
      reason: `progressive: strict 1:1 — ${input.stats.availableAgents} available agent(s) minus ${input.stats.activeDials} in flight = ${lines} line(s)`,
    };
  },
};

/** PREVIEW — one lead per available agent, but the agent confirms before the dial. */
export const previewStrategy: PacingStrategy = {
  mode: 'preview',
  requiresAgentConfirmation: true,
  autoDials: false,
  computeDialPlan(input: PacingInput): PacingDecision {
    const want = input.stats.availableAgents - input.stats.activeDials;
    const lines = clampLines(want, input.stats);
    return {
      mode: 'preview',
      linesToDial: lines,
      nextDueAt: nextDue(input),
      effectiveRatio: 1,
      reason: `preview: offering ${lines} lead(s) for agent confirmation before any dial is placed`,
    };
  },
};

function fixedRatioPlan(mode: 'power' | 'ratio', input: PacingInput): PacingDecision {
  const ratio = Number(input.config?.ratio ?? (mode === 'power' ? 2 : 2));
  const want = input.stats.availableAgents * ratio - input.stats.activeDials;
  const lines = clampLines(want, input.stats);
  return {
    mode,
    linesToDial: lines,
    nextDueAt: nextDue(input),
    effectiveRatio: ratio,
    reason: `${mode}: fixed ${ratio}:1 — ${input.stats.availableAgents} available x ${ratio} - ${input.stats.activeDials} in flight = ${lines} line(s)`,
  };
}

/** POWER — fixed N:1, no feedback loop. */
export const powerStrategy: PacingStrategy = {
  mode: 'power',
  requiresAgentConfirmation: false,
  autoDials: true,
  computeDialPlan: (input) => fixedRatioPlan('power', input),
};

/** RATIO — same shape as power; kept separate so it can diverge (e.g. per-list ratios). */
export const ratioStrategy: PacingStrategy = {
  mode: 'ratio',
  requiresAgentConfirmation: false,
  autoDials: true,
  computeDialPlan: (input) => fixedRatioPlan('ratio', input),
};

/** MANUAL — never auto-dials; a line only exists when an agent explicitly triggers one. */
export const manualStrategy: PacingStrategy = {
  mode: 'manual',
  requiresAgentConfirmation: true,
  autoDials: false,
  computeDialPlan(input: PacingInput): PacingDecision {
    return {
      mode: 'manual',
      linesToDial: 0,
      nextDueAt: nextDue(input),
      effectiveRatio: 0,
      reason: 'manual: no automatic pacing — a dial exists only when an agent triggers one',
    };
  },
};
