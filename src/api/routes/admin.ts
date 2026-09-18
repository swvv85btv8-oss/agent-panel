import { Router } from 'express';
import { Agent, Campaign, Queue, RoutingDecisionLog, Skill } from '../../models';
import { getAllSettings, getWrapUpSeconds, setWrapUpSeconds } from '../../services/settingsService';
import { getQueueDepths } from '../../services/queueDepth';
import { listPacingStrategies } from '../../pacing';
import { listAgentStates } from '../../services/agentService';

export const adminRouter = Router();

function handle(res: any, fn: () => Promise<any>) {
  return fn()
    .then((data) => res.json({ ok: true, data }))
    .catch((e: any) => res.status(400).json({ ok: false, error: e.message }));
}

adminRouter.get('/settings', (_req, res) =>
  handle(res, async () => ({
    ...(await getAllSettings()),
    wrapUpDurationSeconds: await getWrapUpSeconds(),
  })),
);

adminRouter.put('/settings/wrap-up', (req, res) =>
  handle(res, async () => ({
    wrapUpDurationSeconds: await setWrapUpSeconds(Number(req.body?.seconds)),
  })),
);

/** Live queue depths, split by direction with each scale's own ranking. */
adminRouter.get('/queues', (_req, res) =>
  handle(res, async () => {
    const [queues, depths] = await Promise.all([Queue.find().lean(), getQueueDepths()]);
    const rows = queues.map((q) => ({
      queueId: String(q._id),
      name: q.name,
      type: q.type,
      priority: q.priority,
      depth: depths[String(q._id)] ?? 0,
      requiredSkillId: q.requiredSkillId ? String(q.requiredSkillId) : null,
      minProficiency: q.minProficiency,
      campaignId: q.campaignId ? String(q.campaignId) : null,
    }));
    return {
      inbound: rows.filter((r) => r.type === 'inbound').sort((a, b) => a.priority - b.priority),
      outbound: rows.filter((r) => r.type === 'outbound').sort((a, b) => a.priority - b.priority),
    };
  }),
);

adminRouter.get('/campaigns', (_req, res) =>
  handle(res, async () => {
    const campaigns = await Campaign.find().lean();
    const queues = await Queue.find({ type: 'outbound' }).lean();
    return campaigns.map((c) => ({
      campaignId: String(c._id),
      name: c.name,
      dialingMode: c.dialingMode,
      active: c.active,
      queueId: String(c.queueId),
      queueName: queues.find((q) => String(q._id) === String(c.queueId))?.name ?? null,
      priority: queues.find((q) => String(q._id) === String(c.queueId))?.priority ?? null,
      pacingConfig: c.pacingConfig,
      nextDueAt: c.nextDueAt,
      lastPacingDecision: c.lastPacingDecision,
    }));
  }),
);

adminRouter.get('/agents', (_req, res) => handle(res, () => listAgentStates()));

adminRouter.get('/skills', (_req, res) =>
  handle(res, async () =>
    (await Skill.find().lean()).map((s) => ({ skillId: String(s._id), name: s.name })),
  ),
);

/** The routing decision feed — the audit trail that makes the rules visible. */
adminRouter.get('/decisions', (req, res) =>
  handle(res, async () => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const rows = await RoutingDecisionLog.find().sort({ createdAt: -1 }).limit(limit).lean();
    return rows.map((r) => ({
      id: String(r._id),
      createdAt: r.createdAt,
      triggerType: r.triggerType,
      candidateType: r.candidateType,
      reason: r.reason,
      agentName: r.evaluatedAgents?.[0]?.agentName ?? null,
      agentStatus: r.evaluatedAgents?.[0]?.status ?? null,
      committed: Boolean(r.chosenAgentId),
      trace: r.evaluatedAgents?.[0]?.trace ?? [],
    }));
  }),
);

/** Which dialing modes exist right now — populated purely from the strategy registry. */
adminRouter.get('/dialing-modes', (_req, res) =>
  handle(res, async () =>
    listPacingStrategies().map((s) => ({
      mode: s.mode,
      autoDials: s.autoDials,
      requiresAgentConfirmation: s.requiresAgentConfirmation,
    })),
  ),
);

/** Assign/unassign an agent to a queue — handy for demoing the precedence rule live. */
adminRouter.put('/agents/:id/queues', (req, res) =>
  handle(res, async () => {
    const assignments = req.body?.assignedQueues;
    if (!Array.isArray(assignments)) throw new Error('assignedQueues[] required');
    const agent = await Agent.findByIdAndUpdate(
      req.params.id,
      { assignedQueues: assignments },
      { new: true },
    );
    if (!agent) throw new Error('agent not found');
    return agent.assignedQueues;
  }),
);
