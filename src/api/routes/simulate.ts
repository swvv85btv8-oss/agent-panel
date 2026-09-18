import { Router } from 'express';
import {
  injectInboundCall,
  isSimulatorEnabled,
  runCampaignTick,
  setInboundRate,
  getInboundRates,
  setSimulatorEnabled,
} from '../../simulator';
import { runAssignmentPass } from '../../services/assignmentService';

export const simulateRouter = Router();

function handle(res: any, fn: () => Promise<any>) {
  return fn()
    .then((data) => res.json({ ok: true, data }))
    .catch((e: any) => res.status(400).json({ ok: false, error: e.message }));
}

/** POST /simulate/inbound-call  { queueId, callerNumber? } */
simulateRouter.post('/inbound-call', (req, res) =>
  handle(res, async () => {
    const { queueId, callerNumber } = req.body ?? {};
    if (!queueId) throw new Error('queueId is required');
    const item = await injectInboundCall(queueId, callerNumber);
    return { itemId: String(item._id), queueId, callerNumber: item.callerNumber };
  }),
);

/** POST /simulate/campaign-tick  { campaignId, lines? }  — lines only used by manual mode */
simulateRouter.post('/campaign-tick', (req, res) =>
  handle(res, async () => {
    const { campaignId, lines } = req.body ?? {};
    if (!campaignId) throw new Error('campaignId is required');
    return runCampaignTick(campaignId, true, Number(lines ?? 1));
  }),
);

/** Force an assignment pass without generating any new work. */
simulateRouter.post('/assignment-tick', (_req, res) =>
  handle(res, async () => {
    const { tick, results } = await runAssignmentPass('periodic_tick');
    return {
      decisions: tick.decisions.map((d, i) => ({
        agent: d.agentName,
        candidateType: d.candidateType,
        queue: d.chosenQueueName ?? null,
        committed: results[i]?.committed ?? false,
        rejectedReason: results[i]?.rejectedReason ?? null,
        reason: d.reason,
        trace: d.evaluation.trace,
      })),
    };
  }),
);

simulateRouter.post('/toggle', (req, res) =>
  handle(res, async () => ({ enabled: setSimulatorEnabled(Boolean(req.body?.enabled)) })),
);

simulateRouter.post('/inbound-rate', (req, res) =>
  handle(res, async () => {
    const { queueId, callsPerMinute } = req.body ?? {};
    if (!queueId) throw new Error('queueId is required');
    setInboundRate(queueId, Number(callsPerMinute ?? 0));
    return getInboundRates();
  }),
);

simulateRouter.get('/state', (_req, res) =>
  handle(res, async () => ({ enabled: isSimulatorEnabled(), inboundRates: getInboundRates() })),
);
