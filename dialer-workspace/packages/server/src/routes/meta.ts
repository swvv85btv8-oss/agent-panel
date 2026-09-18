import { Router } from 'express';
import { AGENTS, LIBRARY_GROUPS, POLICY, TEMPLATES } from '@dialer/shared';
import { getStore } from '../db/store';
import { asyncRoute } from '../lib/http';
import { computeUsage } from '../lib/usage';

export const metaRouter = Router();

/**
 * One call that gives the campaign form every library dropdown's options at once.
 * Without this the form would fire eight requests on mount, and `+ New` would have to
 * refetch a whole collection to add a single row.
 */
metaRouter.get(
  '/library',
  asyncRoute((_req, res) => {
    const store = getStore();
    const opt = (rows: Array<{ id: string; name: string; def?: boolean }>) =>
      rows.map((r) => ({ id: r.id, name: r.name, def: !!r.def }));
    res.json({
      groups: LIBRARY_GROUPS,
      disposition: opt(store.db.dispositionSets),
      csat: opt(store.db.surveys),
      dnd: opt(store.db.dndLists),
      quick: opt(store.db.transferDirectories),
      pause: opt(store.db.pauseCodeSets),
      skill: opt(store.db.skillLists),
      script: opt(store.db.agentScripts),
      leads: opt(store.db.leadLists),
    });
  }),
);

metaRouter.get(
  '/templates',
  asyncRoute((_req, res) => {
    res.json(
      Object.entries(TEMPLATES).map(([id, t]) => ({
        id,
        label: t.label,
        desc: t.desc,
        tag: t.tag,
      })),
    );
  }),
);

metaRouter.get(
  '/agents',
  asyncRoute((_req, res) => res.json(AGENTS)),
);

/** Exposed so the UI can explain which open decisions are currently in force. */
metaRouter.get(
  '/policy',
  asyncRoute((_req, res) => res.json(POLICY)),
);

metaRouter.get(
  '/usage',
  asyncRoute((_req, res) => res.json(computeUsage(getStore().db))),
);
