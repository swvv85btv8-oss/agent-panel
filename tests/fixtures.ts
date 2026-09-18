import {
  AgentSnapshot,
  OutboundDemandSnapshot,
  QueueSnapshot,
  RoutingContext,
  WaitingCallSnapshot,
} from '../src/routing';

export const NOW = new Date('2026-09-18T10:00:00.000Z');

export const SKILL = { support: 'skill-support', billing: 'skill-billing', sales: 'skill-sales' };

/** Inbound scale: 1 > 2 > 3. */
export const QUEUES: QueueSnapshot[] = [
  { id: 'in-vip', name: 'VIP Support', type: 'inbound', priority: 1, requiredSkillId: SKILL.support, minProficiency: 4 },
  { id: 'in-gen', name: 'General Support', type: 'inbound', priority: 2, requiredSkillId: SKILL.support, minProficiency: 2 },
  { id: 'in-bill', name: 'Billing', type: 'inbound', priority: 3, requiredSkillId: SKILL.billing, minProficiency: 2 },
  // Outbound scale restarts at 1 — a SEPARATE scale, never compared with the above.
  { id: 'out-coll', name: 'Collections', type: 'outbound', priority: 1, requiredSkillId: SKILL.billing, minProficiency: 2 },
  { id: 'out-win', name: 'Winback', type: 'outbound', priority: 2, requiredSkillId: SKILL.sales, minProficiency: 2 },
  { id: 'out-kyc', name: 'KYC', type: 'outbound', priority: 3, requiredSkillId: null, minProficiency: 1 },
];

export function agent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: 'agent-1',
    name: 'Rahul Verma',
    status: 'available',
    currentCallId: null,
    skills: [
      { skillId: SKILL.support, proficiency: 3 },
      { skillId: SKILL.billing, proficiency: 4 },
      { skillId: SKILL.sales, proficiency: 3 },
    ],
    assignedQueues: [
      { queueId: 'in-gen', type: 'inbound' },
      { queueId: 'in-bill', type: 'inbound' },
      { queueId: 'out-coll', type: 'outbound' },
      { queueId: 'out-win', type: 'outbound' },
    ],
    ...overrides,
  };
}

export function waiting(
  id: string,
  queueId: string,
  secondsWaited: number,
): WaitingCallSnapshot {
  return {
    id,
    queueId,
    callerNumber: `+9198000${id}`,
    queuedAt: new Date(NOW.getTime() - secondsWaited * 1000),
  };
}

export function demand(
  overrides: Partial<OutboundDemandSnapshot> & Pick<OutboundDemandSnapshot, 'queueId' | 'campaignId'>,
): OutboundDemandSnapshot {
  const items = overrides.items ?? [
    { itemId: `item-${overrides.queueId}`, leadId: 'lead-1', phone: '+919800000001', queuedAt: NOW },
  ];
  return {
    dialingMode: 'progressive',
    linesRequested: items.length,
    dueAt: NOW,
    requiresAgentConfirmation: false,
    ...overrides,
    items,
  };
}

export function ctx(overrides: Partial<RoutingContext> = {}): RoutingContext {
  return {
    now: NOW,
    agents: [agent()],
    queues: QUEUES,
    waitingCalls: [],
    outboundDemand: [],
    ...overrides,
  };
}
