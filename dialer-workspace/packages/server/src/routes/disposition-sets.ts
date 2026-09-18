import { Router } from 'express';
import {
  DispositionNode,
  actionNodes,
  bulkMerge,
  codeProblems,
  collectCodes,
  conflicts,
  countNodes,
  maxDepth,
  MAX_DEPTH,
} from '@dialer/shared';
import { getStore } from '../db/store';
import { asyncRoute, badRequest, notFound, paginate, unprocessable } from '../lib/http';
import { id } from '../lib/ids';
import { computeUsage, withUsage } from '../lib/usage';

export const dispositionSetsRouter = Router();

function findSet(setId: string) {
  const set = getStore().db.dispositionSets.find((d) => d.id === setId);
  if (!set) throw notFound('Disposition set');
  return set;
}

/** Summary stats the list view shows without pulling the whole tree per row. */
function summarise(set: { id: string; name: string; def?: boolean; tree: DispositionNode[] }) {
  const actions = actionNodes(set.tree);
  return {
    id: set.id,
    name: set.name,
    def: set.def,
    dispositions: countNodes(set.tree),
    levels: maxDepth(set.tree),
    actions: actions.length,
    dndActions: actions.filter((a) => a.node.action?.type === 'dnd').length,
    conflicts: conflicts(set.tree).length,
  };
}

dispositionSetsRouter.get(
  '/',
  asyncRoute((req, res) => {
    const store = getStore();
    const q = String(req.query.q ?? '').toLowerCase();
    const usage = computeUsage(store.db);
    const rows = withUsage(
      store.db.dispositionSets.filter((d) => (!q ? true : d.name.toLowerCase().includes(q))).map(summarise),
      usage.dispositionSets,
    );
    res.json(paginate(rows, req.query.page, req.query.perPage));
  }),
);

dispositionSetsRouter.post(
  '/',
  asyncRoute((req, res) => {
    const store = getStore();
    const set = { id: id('ds'), name: String(req.body?.name ?? ''), tree: [] as DispositionNode[] };
    store.db.dispositionSets.push(set);
    store.save();
    res.status(201).json(set);
  }),
);

dispositionSetsRouter.get(
  '/:id',
  asyncRoute((req, res) => {
    const set = findSet(req.params.id);
    res.json({
      ...set,
      ...summarise(set),
      tree: set.tree,
      conflictDetail: conflicts(set.tree).map((c) => ({
        path: c.path.map((p) => p.name),
        type: c.type,
        sources: c.sources,
      })),
    });
  }),
);

dispositionSetsRouter.patch(
  '/:id',
  asyncRoute((req, res) => {
    const store = getStore();
    const set = findSet(req.params.id);
    if (req.body?.name !== undefined) set.name = String(req.body.name);
    store.save();
    res.json(summarise(set));
  }),
);

dispositionSetsRouter.delete(
  '/:id',
  asyncRoute((req, res) => {
    const store = getStore();
    const set = findSet(req.params.id);
    if (set.def) throw badRequest('The seeded default cannot be deleted');
    store.db.dispositionSets = store.db.dispositionSets.filter((d) => d.id !== set.id);
    store.save();
    res.json({ deleted: set.id });
  }),
);

dispositionSetsRouter.post(
  '/:id/duplicate',
  asyncRoute((req, res) => {
    const store = getStore();
    const set = findSet(req.params.id);
    const reid = (nodes: DispositionNode[]): DispositionNode[] =>
      nodes.map((n) => ({ ...n, id: id('n'), children: reid(n.children) }));
    const copy = { id: id('ds'), name: `${set.name} copy`, tree: reid(set.tree) };
    store.db.dispositionSets.push(copy);
    store.save();
    res.status(201).json(copy);
  }),
);

/* ------------------------------------------------------------- whole tree */

function depthOf(nodes: DispositionNode[], depth = 1): number {
  let max = 0;
  nodes.forEach((n) => {
    max = Math.max(max, depth, depthOf(n.children, depth + 1));
  });
  return max;
}

/** Whole-tree save. Validates depth <= 5 and unique 3-character codes. */
dispositionSetsRouter.put(
  '/:id/tree',
  asyncRoute((req, res) => {
    const store = getStore();
    const set = findSet(req.params.id);
    const tree = (req.body?.tree ?? []) as DispositionNode[];
    if (!Array.isArray(tree)) throw badRequest('tree must be an array');

    if (depthOf(tree) > MAX_DEPTH) {
      throw badRequest(`A disposition tree can be at most ${MAX_DEPTH} levels deep`);
    }

    // Codes already in the stored set are grandfathered (POLICY.legacyCodes).
    const legacy = collectCodes(set.tree);
    const problems = codeProblems(tree, legacy);
    if (problems.length) {
      throw unprocessable(
        problems.map((p) => ({
          field: `code:${p.nodeId}`,
          message:
            p.reason === 'duplicate'
              ? `Code "${p.code}" is already used in this set`
              : p.reason === 'too-long'
                ? `Code "${p.code}" is longer than 3 characters`
                : `"${p.name || 'Untitled'}" needs a code`,
        })),
      );
    }

    set.tree = tree;
    store.save();
    res.json({
      ...summarise(set),
      tree: set.tree,
      conflictDetail: conflicts(set.tree).map((c) => ({
        path: c.path.map((p) => p.name),
        type: c.type,
        sources: c.sources,
      })),
    });
  }),
);

/** Path-per-line bulk upload for the whole tree, one file instead of one per level. */
dispositionSetsRouter.post(
  '/:id/bulk',
  asyncRoute((req, res) => {
    const store = getStore();
    const set = findSet(req.params.id);
    const text = String(req.body?.text ?? '');
    if (!text.trim()) throw badRequest('text is required');

    const result = bulkMerge(set.tree, text, () => id('n'));
    store.save();
    res.json({ ...result, ...summarise(set), tree: set.tree });
  }),
);
