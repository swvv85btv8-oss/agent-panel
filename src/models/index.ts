import { Schema, model, Document, Types } from 'mongoose';
import { AgentStatus, DialingMode, QueueDirection } from '../routing/types';

/* ------------------------------------------------------------------ settings */
/** System-level config. Single-document-per-key; extendable to per-queue later. */
export interface SettingDoc extends Document {
  key: string;
  value: any;
  updatedAt: Date;
}
const settingSchema = new Schema<SettingDoc>(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true, collection: 'settings' },
);
export const Setting = model<SettingDoc>('Setting', settingSchema);

/* -------------------------------------------------------------------- skills */
export interface SkillDoc extends Document {
  name: string;
}
const skillSchema = new Schema<SkillDoc>(
  { name: { type: String, required: true, unique: true } },
  { timestamps: true, collection: 'skills' },
);
export const Skill = model<SkillDoc>('Skill', skillSchema);

/* -------------------------------------------------------------------- agents */
/**
 * skills and assignedQueues are EMBEDDED: they are never read without the agent and
 * are rewritten wholesale by admin actions. currentCallId / wrapUp* live on the agent
 * document itself because the assignment gate reads them on every single tick.
 */
export interface AgentDoc extends Document {
  name: string;
  extension: string;
  status: AgentStatus;
  currentCallId: Types.ObjectId | null;
  wrapUpStartedAt: Date | null;
  wrapUpDeadline: Date | null;
  lastAssignedAt: Date | null;
  skills: { skillId: Types.ObjectId; proficiency: number }[];
  assignedQueues: { queueId: Types.ObjectId; type: QueueDirection; rankOverride: number | null }[];
}
const agentSchema = new Schema<AgentDoc>(
  {
    name: { type: String, required: true },
    extension: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['available', 'on_call', 'wrap_up', 'break', 'offline'],
      default: 'offline',
      index: true,
    },
    // Hard one-call-at-a-time marker. Set at assignment, cleared at end-call.
    currentCallId: { type: Schema.Types.ObjectId, ref: 'CallSession', default: null },
    wrapUpStartedAt: { type: Date, default: null },
    wrapUpDeadline: { type: Date, default: null },
    lastAssignedAt: { type: Date, default: null },
    skills: [
      {
        _id: false,
        skillId: { type: Schema.Types.ObjectId, ref: 'Skill', required: true },
        proficiency: { type: Number, min: 1, max: 5, default: 3 },
      },
    ],
    assignedQueues: [
      {
        _id: false,
        queueId: { type: Schema.Types.ObjectId, ref: 'Queue', required: true },
        // Denormalised so the gate can split inbound/outbound without loading queues.
        type: { type: String, enum: ['inbound', 'outbound'], required: true },
        // Outbound tie-break only. Lower wins. Never compared across directions.
        rankOverride: { type: Number, default: null },
      },
    ],
  },
  { timestamps: true, collection: 'agents' },
);
export const Agent = model<AgentDoc>('Agent', agentSchema);

/* -------------------------------------------------------------------- queues */
export interface QueueDoc extends Document {
  name: string;
  type: QueueDirection;
  /** Scoped WITHIN type. Lower = higher priority. Inbound and outbound never compared. */
  priority: number;
  requiredSkillId: Types.ObjectId | null;
  minProficiency: number;
  campaignId: Types.ObjectId | null;
}
const queueSchema = new Schema<QueueDoc>(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ['inbound', 'outbound'], required: true, index: true },
    priority: { type: Number, required: true },
    requiredSkillId: { type: Schema.Types.ObjectId, ref: 'Skill', default: null },
    minProficiency: { type: Number, default: 1 },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },
  },
  { timestamps: true, collection: 'queues' },
);
// Priority uniqueness is per-direction, which is exactly the "two separate scales" rule.
queueSchema.index({ type: 1, priority: 1 });
export const Queue = model<QueueDoc>('Queue', queueSchema);

/* ----------------------------------------------------------------- campaigns */
export interface CampaignDoc extends Document {
  name: string;
  queueId: Types.ObjectId;
  dialingMode: DialingMode;
  pacingConfig: Record<string, any>;
  active: boolean;
  nextDueAt: Date | null;
  lastPacingDecision: Record<string, any> | null;
}
const campaignSchema = new Schema<CampaignDoc>(
  {
    name: { type: String, required: true },
    queueId: { type: Schema.Types.ObjectId, ref: 'Queue', required: true },
    dialingMode: {
      type: String,
      enum: ['predictive', 'progressive', 'preview', 'power', 'ratio', 'manual'],
      required: true,
    },
    pacingConfig: { type: Schema.Types.Mixed, default: {} },
    active: { type: Boolean, default: true },
    nextDueAt: { type: Date, default: null },
    lastPacingDecision: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: 'campaigns' },
);
export const Campaign = model<CampaignDoc>('Campaign', campaignSchema);

/* --------------------------------------------------------------------- leads */
export type LeadStatus = 'new' | 'dialing' | 'contacted' | 'failed' | 'dnc';
export interface LeadDoc extends Document {
  campaignId: Types.ObjectId;
  phone: string;
  name: string;
  status: LeadStatus;
  attemptCount: number;
  dncFlag: boolean;
  lastAttemptAt: Date | null;
}
const leadSchema = new Schema<LeadDoc>(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    phone: { type: String, required: true },
    name: { type: String, default: '' },
    status: {
      type: String,
      enum: ['new', 'dialing', 'contacted', 'failed', 'dnc'],
      default: 'new',
      index: true,
    },
    attemptCount: { type: Number, default: 0 },
    // Stored but NOT enforced — real DNC/TRAI compliance is out of scope for the POC.
    dncFlag: { type: Boolean, default: false },
    lastAttemptAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'leads' },
);
export const Lead = model<LeadDoc>('Lead', leadSchema);

/* ------------------------------------------------------------ callQueueItems */
export type CallQueueItemStatus = 'waiting' | 'offered' | 'assigned' | 'completed' | 'abandoned';
export interface CallQueueItemDoc extends Document {
  queueId: Types.ObjectId;
  direction: QueueDirection;
  callerNumber: string | null;
  leadId: Types.ObjectId | null;
  campaignId: Types.ObjectId | null;
  queuedAt: Date;
  matchedSkillId: Types.ObjectId | null;
  status: CallQueueItemStatus;
  offeredToAgentId: Types.ObjectId | null;
  assignedAgentId: Types.ObjectId | null;
}
const callQueueItemSchema = new Schema<CallQueueItemDoc>(
  {
    queueId: { type: Schema.Types.ObjectId, ref: 'Queue', required: true, index: true },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    callerNumber: { type: String, default: null },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },
    queuedAt: { type: Date, default: () => new Date(), index: true },
    matchedSkillId: { type: Schema.Types.ObjectId, ref: 'Skill', default: null },
    status: {
      type: String,
      enum: ['waiting', 'offered', 'assigned', 'completed', 'abandoned'],
      default: 'waiting',
      index: true,
    },
    offeredToAgentId: { type: Schema.Types.ObjectId, ref: 'Agent', default: null },
    assignedAgentId: { type: Schema.Types.ObjectId, ref: 'Agent', default: null },
  },
  { timestamps: true, collection: 'callQueueItems' },
);
// The engine's hot read: "waiting items in these queues, oldest first".
callQueueItemSchema.index({ status: 1, queueId: 1, queuedAt: 1 });
export const CallQueueItem = model<CallQueueItemDoc>('CallQueueItem', callQueueItemSchema);

/* -------------------------------------------------------------- callSessions */
export interface CallSessionDoc extends Document {
  direction: QueueDirection;
  queueId: Types.ObjectId;
  agentId: Types.ObjectId;
  campaignId: Types.ObjectId | null;
  leadId: Types.ObjectId | null;
  queueItemId: Types.ObjectId | null;
  dialingMode: DialingMode | null;
  callerNumber: string | null;
  /** 'offering' = preview/manual offer awaiting accept/reject; it still occupies the agent. */
  state: 'offering' | 'connected' | 'ended';
  startedAt: Date;
  endedAt: Date | null;
  disposition: string | null;
}
const callSessionSchema = new Schema<CallSessionDoc>(
  {
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    queueId: { type: Schema.Types.ObjectId, ref: 'Queue', required: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', default: null },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
    queueItemId: { type: Schema.Types.ObjectId, ref: 'CallQueueItem', default: null },
    dialingMode: { type: String, default: null },
    callerNumber: { type: String, default: null },
    state: { type: String, enum: ['offering', 'connected', 'ended'], default: 'connected' },
    startedAt: { type: Date, default: () => new Date() },
    endedAt: { type: Date, default: null },
    disposition: { type: String, default: null },
  },
  { timestamps: true, collection: 'callSessions' },
);
export const CallSession = model<CallSessionDoc>('CallSession', callSessionSchema);

/* ------------------------------------------------------- routingDecisionLogs */
/**
 * The audit trail the supervisor dashboard streams. evaluatedAgents is embedded
 * because it is only ever read together with its decision.
 */
export interface RoutingDecisionLogDoc extends Document {
  triggerType: string;
  candidateType: 'inbound' | 'outbound' | 'none';
  evaluatedAgents: {
    agentId: Types.ObjectId | null;
    agentName: string;
    status: string;
    eligible: boolean;
    gateReason?: string;
    inboundCandidateCount: number;
    outboundCandidateCount: number;
    trace: string[];
  }[];
  chosenAgentId: Types.ObjectId | null;
  chosenQueueId: Types.ObjectId | null;
  chosenCallId: Types.ObjectId | null;
  reason: string;
  createdAt: Date;
}
const routingDecisionLogSchema = new Schema<RoutingDecisionLogDoc>(
  {
    triggerType: { type: String, required: true },
    candidateType: { type: String, enum: ['inbound', 'outbound', 'none'], required: true },
    evaluatedAgents: [
      {
        _id: false,
        agentId: { type: Schema.Types.ObjectId, ref: 'Agent', default: null },
        agentName: String,
        status: String,
        eligible: Boolean,
        gateReason: String,
        inboundCandidateCount: Number,
        outboundCandidateCount: Number,
        trace: [String],
      },
    ],
    chosenAgentId: { type: Schema.Types.ObjectId, ref: 'Agent', default: null },
    chosenQueueId: { type: Schema.Types.ObjectId, ref: 'Queue', default: null },
    chosenCallId: { type: Schema.Types.ObjectId, default: null },
    reason: { type: String, required: true },
  },
  { timestamps: true, collection: 'routingDecisionLogs' },
);
routingDecisionLogSchema.index({ createdAt: -1 });
export const RoutingDecisionLog = model<RoutingDecisionLogDoc>(
  'RoutingDecisionLog',
  routingDecisionLogSchema,
);
