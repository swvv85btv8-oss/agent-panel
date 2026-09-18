import { Router } from 'express';
import {
  CAMPAIGN_DEFAULTS,
  CampaignValues,
  InboundQueue,
  MAX_LEAD_LISTS,
  POLICY,
  TEMPLATES,
  didConflicts,
  newQueue,
  queueIssues,
  toValidationErrors,
} from '@dialer/shared';
import { getStore } from '../db/store';
import { ApiError, asyncRoute, badRequest, conflict, notFound, paginate } from '../lib/http';
import { id } from '../lib/ids';
import { assertPublishable, externalDids, validateCampaign, warnCampaign } from '../lib/validate';

export const campaignsRouter = Router();

function findCampaign(campaignId: string) {
  const store = getStore();
  const stored = store.db.campaigns.find((c) => c.id === campaignId);
  if (!stored) throw notFound('Campaign');
  return stored;
}

/**
 * Templates hold library objects by NAME because they are authored by hand; ids are
 * assigned at seed time. Resolving happens here, on create, so the stored campaign
 * always holds ids (build prompt §3).
 */
function resolveTemplateValues(values: Record<string, unknown>): Record<string, unknown> {
  const store = getStore();
  const lookup: Record<string, Array<{ id: string; name: string }>> = {
    dispositionList: store.db.dispositionSets,
    csatSurvey: store.db.surveys,
    pauseCodeList: store.db.pauseCodeSets,
    skillList: store.db.skillLists,
    dndList: store.db.dndLists,
    agentScript: store.db.agentScripts,
    quickTransfer: store.db.transferDirectories,
  };
  const out = { ...values };
  Object.entries(lookup).forEach(([field, collection]) => {
    const raw = out[field];
    if (typeof raw !== 'string' || !raw) return;
    if (collection.some((x) => x.id === raw)) return; // already an id
    const match = collection.find((x) => x.name === raw);
    out[field] = match ? match.id : '';
  });
  return out;
}

/* -------------------------------------------------------------------- list */

campaignsRouter.get(
  '/',
  asyncRoute((req, res) => {
    const store = getStore();
    const q = String(req.query.q ?? '').toLowerCase();
    const all = store.db.campaigns
      .map((c) => store.campaignWithQueues(c))
      .filter((c) =>
        !q ? true : [c.name, c.desc, c.method, c.agents].join(' ').toLowerCase().includes(q),
      )
      .map(({ values: _v, published: _p, ...summary }) => summary);
    res.json(paginate(all, req.query.page, req.query.perPage));
  }),
);

/* ------------------------------------------------------------------ create */

campaignsRouter.post(
  '/',
  asyncRoute((req, res) => {
    const store = getStore();
    const templateId = String(req.body?.templateId ?? 'blank');
    const template = TEMPLATES[templateId];
    if (!template) throw badRequest(`Unknown template "${templateId}"`);

    const values = {
      ...CAMPAIGN_DEFAULTS,
      ...resolveTemplateValues(template.values as Record<string, unknown>),
      ...(req.body?.values ?? {}),
    } as CampaignValues;
    const { queues, ...rest } = values;

    const stored = {
      id: id('c'),
      name: String(values.name ?? ''),
      desc: String(values.description ?? '') || '—',
      status: 'draft' as const,
      values: rest as any,
      // A new campaign has never been published, so everything reads as changed.
      published: JSON.parse(JSON.stringify(CAMPAIGN_DEFAULTS)),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    delete (stored.published as any).queues;
    store.db.campaigns.push(stored);
    (queues ?? []).forEach((qq) => store.db.queues.push({ ...qq, campaignId: stored.id }));
    store.save();
    res.status(201).json(store.campaignWithQueues(stored));
  }),
);

/* --------------------------------------------------------------------- get */

campaignsRouter.get(
  '/:id',
  asyncRoute((req, res) => {
    const store = getStore();
    const stored = findCampaign(req.params.id);
    const campaign = store.campaignWithQueues(stored);
    res.json({
      ...campaign,
      issues: validateCampaign(store.db, stored.id, campaign.values),
      warnings: warnCampaign(store.db, stored.id, campaign.values),
    });
  }),
);

/* ------------------------------------------------------------- draft save */

campaignsRouter.patch(
  '/:id',
  asyncRoute((req, res) => {
    const store = getStore();
    const stored = findCampaign(req.params.id);
    const current = store.campaignWithQueues(stored).values;
    const next = { ...current, ...(req.body ?? {}) } as CampaignValues;

    if ((next.leadLists ?? []).length > MAX_LEAD_LISTS) {
      throw badRequest(`A campaign can attach at most ${MAX_LEAD_LISTS} lead lists`);
    }
    // A draft save never rejects incomplete work — only genuinely ambiguous routing.
    const dupes = didConflicts(next.queues ?? [], externalDids(store.db, stored.id));
    if (dupes.length) {
      throw conflict(dupes[0].label, { errors: toValidationErrors(dupes) });
    }

    store.writeCampaignValues(stored.id, next);
    const campaign = store.campaignWithQueues(stored);
    res.json({
      ...campaign,
      issues: validateCampaign(store.db, stored.id, campaign.values),
      warnings: warnCampaign(store.db, stored.id, campaign.values),
    });
  }),
);

/* ----------------------------------------------------------------- publish */

campaignsRouter.post(
  '/:id/publish',
  asyncRoute((req, res) => {
    const store = getStore();
    const stored = findCampaign(req.params.id);
    if (req.body?.values) store.writeCampaignValues(stored.id, req.body.values as CampaignValues);

    const campaign = store.campaignWithQueues(stored);
    // Authoritative gate. The client's identical check is only a convenience.
    assertPublishable(store.db, stored.id, campaign.values);

    store.publish(stored.id);
    res.json({
      ...store.campaignWithQueues(stored),
      issues: [],
      warnings: warnCampaign(store.db, stored.id, campaign.values),
    });
  }),
);

/* ------------------------------------------------------------------ delete */

campaignsRouter.delete(
  '/:id',
  asyncRoute((req, res) => {
    const store = getStore();
    const stored = findCampaign(req.params.id);
    const owned = store.queuesFor(stored.id);
    store.deleteCampaign(stored.id);
    res.json({
      deleted: stored.id,
      // Cascade is part of the contract: say what went with it.
      cascadedQueues: owned.map((q) => ({ id: q.id, name: q.name, dids: q.dids })),
    });
  }),
);

campaignsRouter.post(
  '/:id/duplicate',
  asyncRoute((req, res) => {
    const store = getStore();
    const stored = findCampaign(req.params.id);
    const copy = {
      ...JSON.parse(JSON.stringify(stored)),
      id: id('c'),
      name: `${stored.name} copy`,
      status: 'draft' as const,
    };
    copy.values.name = copy.name;
    store.db.campaigns.push(copy);
    // Owned queues are copied too — they cannot be shared, so the copy gets its own.
    // DIDs are deliberately NOT copied: a number may point at only one queue.
    store.queuesFor(stored.id).forEach((q) => {
      store.db.queues.push({ ...JSON.parse(JSON.stringify(q)), id: id('q'), dids: [], campaignId: copy.id });
    });
    store.save();
    res.status(201).json(store.campaignWithQueues(copy));
  }),
);

/* ============================================================ owned queues */

function findQueue(campaignId: string, queueId: string) {
  const store = getStore();
  const q = store.db.queues.find((x) => x.id === queueId && x.campaignId === campaignId);
  if (!q) throw notFound('Queue');
  return q;
}

campaignsRouter.post(
  '/:id/queues',
  asyncRoute((req, res) => {
    const store = getStore();
    const stored = findCampaign(req.params.id);
    const queue: InboundQueue = { ...newQueue(id('q')), ...(req.body ?? {}) };
    const existing = store.queuesFor(stored.id);
    const dupes = didConflicts([...existing, queue], externalDids(store.db, stored.id));
    if (dupes.some((d) => d.qid === queue.id)) {
      throw conflict(dupes.find((d) => d.qid === queue.id)!.label);
    }
    store.db.queues.push({ ...queue, campaignId: stored.id });
    store.save();
    res.status(201).json({ ...queue, issues: queueIssues(queue) });
  }),
);

campaignsRouter.patch(
  '/:id/queues/:qid',
  asyncRoute((req, res) => {
    const store = getStore();
    const stored = findCampaign(req.params.id);
    const existing = findQueue(stored.id, req.params.qid);
    const next = { ...existing, ...(req.body ?? {}), id: existing.id, campaignId: stored.id };

    const siblings = store.queuesFor(stored.id).filter((q) => q.id !== existing.id);
    const dupes = didConflicts([...siblings, next], externalDids(store.db, stored.id));
    const mine = dupes.find((d) => d.qid === next.id);
    if (mine) throw conflict(mine.label);

    Object.assign(existing, next);
    store.save();
    const { campaignId: _c, publishedSnapshot: _p, ...clean } = existing;
    res.json({ ...clean, issues: queueIssues(clean) });
  }),
);

campaignsRouter.delete(
  '/:id/queues/:qid',
  asyncRoute((req, res) => {
    const store = getStore();
    const stored = findCampaign(req.params.id);
    const queue = findQueue(stored.id, req.params.qid);

    // §10.3 is undecided: by default the numbers are released and go dead, and the
    // response names them so the UI can warn. Under the other policy the delete refuses.
    if (POLICY.orphanedDids === 'block-until-reassigned' && queue.dids.length) {
      throw new ApiError(
        409,
        `Move ${queue.dids.join(', ')} to another queue before deleting this one`,
        undefined,
        { orphanedDids: queue.dids },
      );
    }

    store.db.queues = store.db.queues.filter((q) => q.id !== queue.id);
    store.save();
    res.json({
      deleted: queue.id,
      /** These numbers stop reaching the campaign entirely. */
      orphanedDids: queue.dids,
      warning: queue.dids.length
        ? `${queue.dids.join(', ')} will stop reaching ${stored.name}`
        : undefined,
    });
  }),
);
