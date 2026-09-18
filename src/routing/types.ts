/**
 * Pure domain types for the routing/assignment engine.
 *
 * NOTE: nothing in src/routing/* imports mongoose, redis, express or socket.io.
 * The engine is a pure function over plain snapshots so it can be unit-tested
 * without any infrastructure. The service layer (src/services/assignmentService.ts)
 * is responsible for loading snapshots, taking locks and persisting results.
 */

export type AgentStatus = 'available' | 'on_call' | 'wrap_up' | 'break' | 'offline';
export type QueueDirection = 'inbound' | 'outbound';
export type DialingMode =
  | 'predictive'
  | 'progressive'
  | 'preview'
  | 'power'
  | 'ratio'
  | 'manual';

export interface AgentSkillSnapshot {
  skillId: string;
  proficiency: number; // 1..5
}

export interface AgentQueueAssignmentSnapshot {
  queueId: string;
  type: QueueDirection;
  /**
   * Per-agent override used ONLY as the outbound tie-break (lower wins).
   * It never crosses the inbound/outbound boundary and never changes queue priority.
   */
  rankOverride?: number | null;
}

export interface AgentSnapshot {
  id: string;
  name: string;
  status: AgentStatus;
  /** Hard concurrency gate: if set, the agent is not a candidate for anything. */
  currentCallId: string | null;
  wrapUpStartedAt?: Date | null;
  wrapUpDeadline?: Date | null;
  skills: AgentSkillSnapshot[];
  assignedQueues: AgentQueueAssignmentSnapshot[];
  /** Used only as a fairness ordering hint when iterating agents in a tick. */
  lastAssignedAt?: Date | null;
}

export interface QueueSnapshot {
  id: string;
  name: string;
  type: QueueDirection;
  /**
   * Priority is scoped WITHIN type. Lower number = higher priority.
   * Inbound priorities are only ever compared to other inbound priorities,
   * outbound priorities only to other outbound priorities.
   */
  priority: number;
  requiredSkillId?: string | null;
  minProficiency?: number | null;
  campaignId?: string | null;
}

/** A call waiting in an inbound queue (a row of callQueueItems with status 'waiting'). */
export interface WaitingCallSnapshot {
  id: string;
  queueId: string;
  callerNumber?: string | null;
  leadId?: string | null;
  queuedAt: Date;
  matchedSkillId?: string | null;
}

/** One line the pacing strategy has already put up, waiting for an agent. */
export interface OutboundDialItem {
  itemId: string;
  leadId?: string | null;
  phone?: string | null;
  queuedAt: Date;
}

/**
 * Outbound demand produced by a campaign's pacing strategy: "this campaign has put up
 * these lines and is due to work them". The engine never computes pacing itself —
 * it only consumes the strategy's output.
 */
export interface OutboundDemandSnapshot {
  campaignId: string;
  queueId: string;
  dialingMode: DialingMode;
  /** Lines the pacing strategy still wants worked on this tick (== items.length). */
  linesRequested: number;
  /** Concrete lines, oldest first. Each is handed to at most one agent per tick. */
  items: OutboundDialItem[];
  /** When this campaign became due to dial; used as the final outbound tie-break. */
  dueAt: Date;
  /** preview/manual modes offer the lead to the agent instead of auto-dialling. */
  requiresAgentConfirmation: boolean;
}

export interface RoutingContext {
  now: Date;
  agents: AgentSnapshot[];
  queues: QueueSnapshot[];
  waitingCalls: WaitingCallSnapshot[];
  outboundDemand: OutboundDemandSnapshot[];
}

export type TriggerType =
  | 'inbound_call_arrival'
  | 'agent_state_change'
  | 'campaign_tick'
  | 'periodic_tick'
  | 'manual_dial';

/** Why an agent was not considered at all. */
export type GateReason =
  | 'agent_has_active_call'
  | 'agent_status_on_call'
  | 'agent_status_wrap_up'
  | 'agent_status_break'
  | 'agent_status_offline'
  | 'no_assigned_queues';

export interface InboundCandidate {
  queueId: string;
  queueName: string;
  priority: number;
  callId: string;
  queuedAt: Date;
  waitMs: number;
}

export interface OutboundCandidate {
  campaignId: string;
  queueId: string;
  queueName: string;
  priority: number;
  dialingMode: DialingMode;
  dueAt: Date;
  rankOverride: number | null;
  requiresAgentConfirmation: boolean;
  itemId: string;
  leadId?: string | null;
  phone?: string | null;
}

export interface AgentEvaluation {
  agentId: string;
  agentName: string;
  status: AgentStatus;
  eligible: boolean;
  gateReason?: GateReason;
  /** Inbound candidates the agent is skilled for, best-first. */
  inboundCandidates: InboundCandidate[];
  /** Only populated when there were zero inbound candidates. */
  outboundCandidates: OutboundCandidate[];
  /** Human-readable trace of the decision path, surfaced in routingDecisionLogs. */
  trace: string[];
}

export interface RoutingDecision {
  triggerType: TriggerType;
  candidateType: QueueDirection | 'none';
  agentId: string;
  agentName: string;
  chosenQueueId?: string;
  chosenQueueName?: string;
  /** callQueueItem id for inbound, or the synthetic dial id for outbound. */
  chosenCallId?: string;
  campaignId?: string;
  dialingMode?: DialingMode;
  leadId?: string | null;
  phone?: string | null;
  requiresAgentConfirmation?: boolean;
  reason: string;
  evaluation: AgentEvaluation;
}

export interface TickResult {
  triggerType: TriggerType;
  at: Date;
  decisions: RoutingDecision[];
  evaluations: AgentEvaluation[];
}
