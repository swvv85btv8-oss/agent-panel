import { DialingMode } from '../routing/types';

/**
 * A pacing strategy answers exactly one question:
 *   "how many lines should this campaign put up right now, and when is it next due?"
 *
 * It does NOT choose agents. Agent choice happens downstream in the routing engine and
 * is identical for every mode — and only ever runs after the inbound-precedence check.
 */
export interface PacingStats {
  /** Agents assigned to this campaign who are available right now. */
  availableAgents: number;
  /** Agents assigned to this campaign, in any state. */
  totalAgents: number;
  /** Dials currently in flight for this campaign. */
  activeDials: number;
  /** Calls connected to an agent for this campaign. */
  connectedCalls: number;
  /** Rolling abandon rate 0..1 (dropped connects / total connects). */
  abandonRate: number;
  /** Leads still dialable in this campaign. */
  leadsRemaining: number;
}

export interface PacingInput {
  campaignId: string;
  config: Record<string, any>;
  stats: PacingStats;
  now: Date;
  /** dueAt from the previous decision, if any. */
  lastDueAt?: Date | null;
}

export interface PacingDecision {
  mode: DialingMode;
  /** How many lines to put up on this tick. 0 means "not due". */
  linesToDial: number;
  /** When this campaign is next due to dial. */
  nextDueAt: Date;
  /** Plain-English explanation, shown on the supervisor dashboard. */
  reason: string;
  /** Effective lines-per-available-agent this strategy is running at. */
  effectiveRatio: number;
}

export interface PacingStrategy {
  readonly mode: DialingMode;
  /** preview + manual offer the lead to the agent and wait for a confirm. */
  readonly requiresAgentConfirmation: boolean;
  /** manual only dials when an agent explicitly asks. */
  readonly autoDials: boolean;
  computeDialPlan(input: PacingInput): PacingDecision;
}

export function clampLines(lines: number, stats: PacingStats): number {
  const capped = Math.min(lines, stats.leadsRemaining);
  return Math.max(0, Math.floor(capped));
}
