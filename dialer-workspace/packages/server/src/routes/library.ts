import { Router } from 'express';
import {
  DndEntry,
  Survey,
  SurveyType,
  TransferDirectory,
  newVoiceSurvey,
  newWebSurvey,
  surveyEntryCount,
  surveyIssues,
} from '@dialer/shared';
import { getStore } from '../db/store';
import { asyncRoute, badRequest, notFound, paginate } from '../lib/http';
import { id } from '../lib/ids';
import { UsageMap, computeUsage, withUsage } from '../lib/usage';

/* ================================================================= surveys */

export const surveysRouter = Router();

function findSurvey(surveyId: string): Survey {
  const sv = getStore().db.surveys.find((s) => s.id === surveyId);
  if (!sv) throw notFound('Survey');
  return sv;
}

surveysRouter.get(
  '/',
  asyncRoute((req, res) => {
    const store = getStore();
    const q = String(req.query.q ?? '').toLowerCase();
    const usage = computeUsage(store.db);
    const rows = withUsage(
      store.db.surveys
        .filter((s) => (!q ? true : s.name.toLowerCase().includes(q)))
        .map((s) => ({ id: s.id, name: s.name, type: s.type, def: s.def, entries: surveyEntryCount(s) })),
      usage.surveys,
    );
    res.json(paginate(rows, req.query.page, req.query.perPage));
  }),
);

surveysRouter.post(
  '/',
  asyncRoute((req, res) => {
    const store = getStore();
    const type = req.body?.type as SurveyType;
    if (type !== 'voice' && type !== 'web') throw badRequest('type must be "voice" or "web"');
    // Type is chosen once and is immutable; there is no conversion endpoint by design.
    const sv =
      type === 'voice'
        ? newVoiceSurvey(id('sv'), id('e'), String(req.body?.name ?? ''))
        : newWebSurvey(id('sv'), id('q'), String(req.body?.name ?? ''));
    store.db.surveys.push(sv);
    store.save();
    res.status(201).json(sv);
  }),
);

surveysRouter.get(
  '/:id',
  asyncRoute((req, res) => {
    const sv = findSurvey(req.params.id);
    res.json({ ...sv, issues: surveyIssues(sv) });
  }),
);

surveysRouter.patch(
  '/:id',
  asyncRoute((req, res) => {
    const store = getStore();
    const sv = findSurvey(req.params.id);
    const body = { ...(req.body ?? {}) };
    // Converting would discard every type-specific setting, so the type is never writable.
    if (body.type && body.type !== sv.type) {
      throw badRequest('A survey type cannot be changed after creation');
    }
    delete body.type;
    delete body.id;
    Object.assign(sv, body);
    store.save();
    res.json({ ...sv, issues: surveyIssues(sv) });
  }),
);

surveysRouter.delete(
  '/:id',
  asyncRoute((req, res) => {
    const store = getStore();
    const sv = findSurvey(req.params.id);
    if (sv.def) throw badRequest('The seeded default cannot be deleted');
    store.db.surveys = store.db.surveys.filter((s) => s.id !== sv.id);
    store.save();
    res.json({ deleted: sv.id });
  }),
);

surveysRouter.post(
  '/:id/duplicate',
  asyncRoute((req, res) => {
    const store = getStore();
    const sv = findSurvey(req.params.id);
    const copy = { ...JSON.parse(JSON.stringify(sv)), id: id('sv'), name: `${sv.name} copy` };
    delete copy.def;
    store.db.surveys.push(copy);
    store.save();
    res.status(201).json(copy);
  }),
);

/* ================================================================ DND lists */

export const dndRouter = Router();

function findDnd(listId: string) {
  const l = getStore().db.dndLists.find((d) => d.id === listId);
  if (!l) throw notFound('DND list');
  return l;
}

const entriesOf = (listId: string): DndEntry[] => {
  const store = getStore();
  if (!store.db.dndEntries[listId]) store.db.dndEntries[listId] = [];
  return store.db.dndEntries[listId];
};

dndRouter.get(
  '/',
  asyncRoute((req, res) => {
    const store = getStore();
    const q = String(req.query.q ?? '').toLowerCase();
    const usage = computeUsage(store.db);
    const rows = withUsage(
      store.db.dndLists.filter((d) => (!q ? true : `${d.name} ${d.desc}`.toLowerCase().includes(q))),
      usage.dndLists,
    );
    res.json(paginate(rows, req.query.page, req.query.perPage));
  }),
);

dndRouter.post(
  '/',
  asyncRoute((req, res) => {
    const store = getStore();
    const list = { id: id('dnd'), name: String(req.body?.name ?? ''), desc: String(req.body?.desc ?? ''), count: 0 };
    store.db.dndLists.push(list);
    store.db.dndEntries[list.id] = [];
    store.save();
    res.status(201).json(list);
  }),
);

dndRouter.get(
  '/:id',
  asyncRoute((req, res) => {
    const list = findDnd(req.params.id);
    res.json(list);
  }),
);

dndRouter.patch(
  '/:id',
  asyncRoute((req, res) => {
    const store = getStore();
    const list = findDnd(req.params.id);
    if (req.body?.name !== undefined) list.name = String(req.body.name);
    if (req.body?.desc !== undefined) list.desc = String(req.body.desc);
    store.save();
    res.json(list);
  }),
);

dndRouter.delete(
  '/:id',
  asyncRoute((req, res) => {
    const store = getStore();
    const list = findDnd(req.params.id);
    if (list.def) throw badRequest('The seeded default cannot be deleted');
    store.db.dndLists = store.db.dndLists.filter((d) => d.id !== list.id);
    delete store.db.dndEntries[list.id];
    store.save();
    res.json({ deleted: list.id });
  }),
);

dndRouter.get(
  '/:id/entries',
  asyncRoute((req, res) => {
    const list = findDnd(req.params.id);
    const q = String(req.query.q ?? '').replace(/\s/g, '');
    const rows = entriesOf(list.id).filter((e) => (!q ? true : e.value.replace(/\s/g, '').includes(q)));
    res.json(paginate(rows, req.query.page, req.query.perPage));
  }),
);

dndRouter.post(
  '/:id/entries',
  asyncRoute((req, res) => {
    const store = getStore();
    const list = findDnd(req.params.id);
    const value = String(req.body?.value ?? '').trim();
    if (!value) throw badRequest('value is required');
    // Short digit strings are treated as a prefix: a prefix blocks a whole series.
    const type: DndEntry['type'] =
      req.body?.type === 'Prefix' || req.body?.type === 'Number'
        ? req.body.type
        : value.replace(/\D/g, '').length <= 6
          ? 'Prefix'
          : 'Number';
    const entry: DndEntry = { id: id('de'), value, type };
    entriesOf(list.id).unshift(entry);
    list.count = entriesOf(list.id).length;
    store.save();
    res.status(201).json(entry);
  }),
);

dndRouter.delete(
  '/:id/entries/:eid',
  asyncRoute((req, res) => {
    const store = getStore();
    const list = findDnd(req.params.id);
    store.db.dndEntries[list.id] = entriesOf(list.id).filter((e) => e.id !== req.params.eid);
    list.count = store.db.dndEntries[list.id].length;
    store.save();
    res.json({ deleted: req.params.eid, count: list.count });
  }),
);

dndRouter.post(
  '/:id/entries/upload',
  asyncRoute((req, res) => {
    const store = getStore();
    const list = findDnd(req.params.id);
    const rows = (req.body?.rows ?? []) as Array<{ value: string; type?: DndEntry['type'] }>;
    if (!Array.isArray(rows)) throw badRequest('rows must be an array');
    const existing = new Set(entriesOf(list.id).map((e) => e.value.replace(/\s/g, '')));
    let added = 0;
    let skipped = 0;
    rows.forEach((r) => {
      const value = String(r.value ?? '').trim();
      if (!value) return;
      if (existing.has(value.replace(/\s/g, ''))) {
        skipped++;
        return;
      }
      entriesOf(list.id).push({
        id: id('de'),
        value,
        type: r.type ?? (value.replace(/\D/g, '').length <= 6 ? 'Prefix' : 'Number'),
      });
      existing.add(value.replace(/\s/g, ''));
      added++;
    });
    list.count = entriesOf(list.id).length;
    store.save();
    res.json({ added, skipped, count: list.count });
  }),
);

dndRouter.post(
  '/:id/entries/clear',
  asyncRoute((req, res) => {
    const store = getStore();
    const list = findDnd(req.params.id);
    const cleared = list.count;
    store.db.dndEntries[list.id] = [];
    list.count = 0;
    store.save();
    res.json({ cleared });
  }),
);

/* ==================================================== transfer directories */

export const transferRouter = Router();

function findDir(dirId: string): TransferDirectory {
  const d = getStore().db.transferDirectories.find((x) => x.id === dirId);
  if (!d) throw notFound('Transfer directory');
  return d;
}

transferRouter.get(
  '/',
  asyncRoute((req, res) => {
    const store = getStore();
    const q = String(req.query.q ?? '').toLowerCase();
    const usage = computeUsage(store.db);
    const rows = withUsage(
      store.db.transferDirectories
        .filter((d) => (!q ? true : `${d.name} ${d.desc}`.toLowerCase().includes(q)))
        .map((d) => ({ ...d, destinations: d.entries.length })),
      usage.transferDirectories,
    );
    res.json(paginate(rows, req.query.page, req.query.perPage));
  }),
);

transferRouter.post(
  '/',
  asyncRoute((req, res) => {
    const store = getStore();
    const dir: TransferDirectory = {
      id: id('td'),
      name: String(req.body?.name ?? ''),
      desc: String(req.body?.desc ?? ''),
      entries: [],
    };
    store.db.transferDirectories.push(dir);
    store.save();
    res.status(201).json(dir);
  }),
);

transferRouter.get(
  '/:id',
  asyncRoute((req, res) => res.json(findDir(req.params.id))),
);

transferRouter.patch(
  '/:id',
  asyncRoute((req, res) => {
    const store = getStore();
    const dir = findDir(req.params.id);
    if (req.body?.name !== undefined) dir.name = String(req.body.name);
    if (req.body?.desc !== undefined) dir.desc = String(req.body.desc);
    if (Array.isArray(req.body?.entries)) {
      dir.entries = req.body.entries.map((e: any) => ({
        id: e.id || id('t'),
        name: String(e.name ?? ''),
        number: String(e.number ?? ''),
      }));
    }
    store.save();
    res.json(dir);
  }),
);

transferRouter.delete(
  '/:id',
  asyncRoute((req, res) => {
    const store = getStore();
    const dir = findDir(req.params.id);
    if (dir.def) throw badRequest('The seeded default cannot be deleted');
    store.db.transferDirectories = store.db.transferDirectories.filter((d) => d.id !== dir.id);
    store.save();
    res.json({ deleted: dir.id });
  }),
);

transferRouter.post(
  '/:id/duplicate',
  asyncRoute((req, res) => {
    const store = getStore();
    const dir = findDir(req.params.id);
    const copy: TransferDirectory = {
      ...JSON.parse(JSON.stringify(dir)),
      id: id('td'),
      name: `${dir.name} copy`,
      entries: dir.entries.map((e) => ({ ...e, id: id('t') })),
    };
    delete copy.def;
    store.db.transferDirectories.push(copy);
    store.save();
    res.status(201).json(copy);
  }),
);

/* ============================ pause codes / skill lists / agent scripts ==== */

type SimpleKey = 'pauseCodeSets' | 'skillLists' | 'agentScripts';

export function simpleRouter(collection: SimpleKey, usageKey: keyof UsageMap, label: string): Router {
  const router = Router();

  const find = (itemId: string) => {
    const item = getStore().db[collection].find((x) => x.id === itemId);
    if (!item) throw notFound(label);
    return item;
  };

  router.get(
    '/',
    asyncRoute((req, res) => {
      const store = getStore();
      const q = String(req.query.q ?? '').toLowerCase();
      const usage = computeUsage(store.db);
      const rows = withUsage(
        store.db[collection]
          .filter((x) => (!q ? true : x.name.toLowerCase().includes(q)))
          .map((x) => ({ ...x, entries: x.codes.length })),
        usage[usageKey],
      );
      res.json(paginate(rows, req.query.page, req.query.perPage));
    }),
  );

  router.post(
    '/',
    asyncRoute((req, res) => {
      const store = getStore();
      const item = {
        id: id(collection.slice(0, 2)),
        name: String(req.body?.name ?? ''),
        codes: (req.body?.codes ?? []).map((c: unknown) => String(c)).filter(Boolean),
      };
      store.db[collection].push(item);
      store.save();
      res.status(201).json(item);
    }),
  );

  router.get(
    '/:id',
    asyncRoute((req, res) => res.json(find(req.params.id))),
  );

  router.patch(
    '/:id',
    asyncRoute((req, res) => {
      const store = getStore();
      const item = find(req.params.id);
      if (req.body?.name !== undefined) item.name = String(req.body.name);
      if (Array.isArray(req.body?.codes)) {
        item.codes = req.body.codes.map((c: unknown) => String(c)).filter(Boolean);
      }
      store.save();
      res.json(item);
    }),
  );

  router.delete(
    '/:id',
    asyncRoute((req, res) => {
      const store = getStore();
      const item = find(req.params.id);
      if (item.def) throw badRequest('The seeded default cannot be deleted');
      store.db[collection] = store.db[collection].filter((x) => x.id !== item.id);
      store.save();
      res.json({ deleted: item.id });
    }),
  );

  router.post(
    '/:id/duplicate',
    asyncRoute((req, res) => {
      const store = getStore();
      const item = find(req.params.id);
      const copy = { id: id(collection.slice(0, 2)), name: `${item.name} copy`, codes: [...item.codes] };
      store.db[collection].push(copy);
      store.save();
      res.status(201).json(copy);
    }),
  );

  return router;
}
