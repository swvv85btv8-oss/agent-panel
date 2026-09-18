import { Router } from 'express';
import {
  AgentStateError,
  acceptCall,
  endCall,
  endWrapUp,
  listAgentStates,
  login,
  rejectCall,
  setStatus,
  toStatePayload,
} from '../../services/agentService';
import { runAssignmentPass } from '../../services/assignmentService';
import { runCampaignTick } from '../../simulator';
import { Agent, CallSession, Campaign, Queue } from '../../models';

export const agentsRouter = Router();

function handle(res: any, fn: () => Promise<any>) {
  return fn()
    .then((data) => res.json({ ok: true, data }))
    .catch((e: any) => {
      const code = e instanceof AgentStateError ? 409 : 400;
      res.status(code).json({ ok: false, error: e.message });
    });
}

/** Roster for the POC agent-picker. */
agentsRouter.get('/', (_req, res) => handle(res, () => listAgentStates()));

/** Full agent view: state + active call + assigned queues. */
agentsRouter.get('/:id', (req, res) =>
  handle(res, async () => {
    const agent = await Agent.findById(req.params.id).lean();
    if (!agent) throw new Error('agent not found');
    const call = agent.currentCallId
      ? await CallSession.findById(agent.currentCallId).lean()
      : null;
    const queue = call ? await Queue.findById(call.queueId).lean() : null;
    return {
      ...toStatePayload(agent),
      activeCall: call
        ? {
            callId: String(call._id),
            direction: call.direction,
            state: call.state,
            awaitingConfirmation: call.state === 'offering',
            queueName: queue?.name ?? null,
            callerNumber: call.callerNumber,
            dialingMode: call.dialingMode,
            startedAt: call.startedAt,
          }
        : null,
    };
  }),
);

/**
 * "My assigned queues", split into the two independent priority scales.
 * Deliberately two separate ranked lists — they are never merged into one ordering.
 */
agentsRouter.get('/:id/my-queues', (req, res) =>
  handle(res, async () => {
    const agent = await Agent.findById(req.params.id).lean();
    if (!agent) throw new Error('agent not found');
    const queues = await Queue.find({
      _id: { $in: agent.assignedQueues.map((q) => q.queueId) },
    }).lean();
    const campaigns = await Campaign.find({
      queueId: { $in: queues.filter((q) => q.type === 'outbound').map((q) => q._id) },
    }).lean();

    const decorate = (type: 'inbound' | 'outbound') =>
      agent.assignedQueues
        .filter((a) => a.type === type)
        .map((a) => {
          const q = queues.find((x) => String(x._id) === String(a.queueId));
          const campaign = campaigns.find((c) => String(c.queueId) === String(a.queueId));
          return {
            queueId: String(a.queueId),
            name: q?.name ?? '(unknown)',
            priority: q?.priority ?? null,
            rankOverride: a.rankOverride ?? null,
            requiredSkillId: q?.requiredSkillId ? String(q.requiredSkillId) : null,
            minProficiency: q?.minProficiency ?? 1,
            campaign: campaign
              ? {
                  campaignId: String(campaign._id),
                  name: campaign.name,
                  dialingMode: campaign.dialingMode,
                  pacingConfig: campaign.pacingConfig,
                }
              : null,
          };
        })
        // Each list is sorted on its OWN scale.
        .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

    return {
      agentId: String(agent._id),
      name: agent.name,
      // Two separate scales: inbound ranks are only comparable to inbound ranks.
      inbound: decorate('inbound'),
      outbound: decorate('outbound'),
      note: 'inbound is always checked first; outbound is only consulted when every inbound queue above is empty',
    };
  }),
);

agentsRouter.post('/:id/login', (req, res) => handle(res, () => login(req.params.id)));

agentsRouter.post('/:id/status', (req, res) =>
  handle(res, async () => {
    const state = await setStatus(req.params.id, req.body?.status);
    if (state.status === 'available') await runAssignmentPass('agent_state_change', [req.params.id]);
    return state;
  }),
);

agentsRouter.post('/:id/accept', (req, res) => handle(res, () => acceptCall(req.params.id)));

agentsRouter.post('/:id/reject', (req, res) =>
  handle(res, async () => {
    const state = await rejectCall(req.params.id, req.body?.reason ?? 'rejected');
    await runAssignmentPass('agent_state_change');
    return state;
  }),
);

agentsRouter.post('/:id/end-call', (req, res) =>
  handle(res, async () => {
    const state = await endCall(req.params.id, req.body?.disposition ?? 'completed');
    // The freed call may now go to somebody else, but NOT to this agent — they're in wrap-up.
    await runAssignmentPass('agent_state_change');
    return state;
  }),
);

agentsRouter.post('/:id/end-wrap-up', (req, res) =>
  handle(res, async () => {
    const state = await endWrapUp(req.params.id);
    await runAssignmentPass('agent_state_change', [req.params.id]);
    return state;
  }),
);

/** Manual mode: the agent explicitly asks for one line. */
agentsRouter.post('/:id/manual-dial', (req, res) =>
  handle(res, async () => {
    const campaignId = req.body?.campaignId;
    if (!campaignId) throw new Error('campaignId is required');
    const result = await runCampaignTick(campaignId, true, 1);
    await runAssignmentPass('manual_dial', [req.params.id]);
    return result;
  }),
);
