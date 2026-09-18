import { Router } from 'express';
import {
  CustomColumn,
  DedupeScope,
  DuplicateMode,
  LeadRecord,
  MAX_CUSTOM,
  columnCount,
  newCustomColumn,
  newFixedColumns,
  sampleCsvHeader,
  visibleColumns,
} from '@dialer/shared';
import { getStore } from '../db/store';
import { asyncRoute, badRequest, notFound, paginate } from '../lib/http';
import { id } from '../lib/ids';
import { computeUsage, withUsage } from '../lib/usage';

export const leadListsRouter = Router();

function findList(listId: string) {
  const list = getStore().db.leadLists.find((l) => l.id === listId);
  if (!list) throw notFound('Lead list');
  return list;
}

function records(listId: string): LeadRecord[] {
  const store = getStore();
  if (!store.db.leadRecords[listId]) store.db.leadRecords[listId] = [];
  return store.db.leadRecords[listId];
}

/* --------------------------------------------------------------------- list */

leadListsRouter.get(
  '/',
  asyncRoute((req, res) => {
    const store = getStore();
    const q = String(req.query.q ?? '').toLowerCase();
    // Usage counts come with the payload — never one query per row.
    const usage = computeUsage(store.db);
    const rows = withUsage(
      store.db.leadLists.filter((l) =>
        !q ? true : `${l.name} ${l.desc}`.toLowerCase().includes(q),
      ),
      usage.leadLists,
    ).map((l) => ({ ...l, columns: columnCount(l) }));
    res.json(paginate(rows, req.query.page, req.query.perPage));
  }),
);

leadListsRouter.post(
  '/',
  asyncRoute((req, res) => {
    const store = getStore();
    const list = {
      id: id('ll'),
      name: String(req.body?.name ?? ''),
      desc: String(req.body?.desc ?? ''),
      records: 0,
      updated: new Date().toISOString().slice(0, 10),
      fixed: newFixedColumns(),
      custom: [] as CustomColumn[],
    };
    store.db.leadLists.push(list);
    store.db.leadRecords[list.id] = [];
    store.save();
    res.status(201).json(list);
  }),
);

leadListsRouter.get(
  '/:id',
  asyncRoute((req, res) => {
    const list = findList(req.params.id);
    res.json({ ...list, columns: columnCount(list), visibleColumns: visibleColumns(list) });
  }),
);

leadListsRouter.patch(
  '/:id',
  asyncRoute((req, res) => {
    const store = getStore();
    const list = findList(req.params.id);
    if (req.body?.name !== undefined) list.name = String(req.body.name);
    if (req.body?.desc !== undefined) list.desc = String(req.body.desc);
    store.save();
    res.json(list);
  }),
);

leadListsRouter.delete(
  '/:id',
  asyncRoute((req, res) => {
    const store = getStore();
    const list = findList(req.params.id);
    const usedBy = store.db.campaigns.filter((c) =>
      ((c.values.leadLists as string[]) ?? []).includes(list.id),
    );
    store.db.leadLists = store.db.leadLists.filter((l) => l.id !== list.id);
    delete store.db.leadRecords[list.id];
    // A shared object: detach it from every campaign rather than leaving a dangling id.
    usedBy.forEach((c) => {
      c.values.leadLists = ((c.values.leadLists as string[]) ?? []).filter((x) => x !== list.id);
    });
    store.save();
    res.json({ deleted: list.id, detachedFrom: usedBy.map((c) => c.name) });
  }),
);

leadListsRouter.post(
  '/:id/duplicate',
  asyncRoute((req, res) => {
    const store = getStore();
    const list = findList(req.params.id);
    // Copies the structure, leaves the records behind.
    const copy = {
      ...JSON.parse(JSON.stringify(list)),
      id: id('ll'),
      name: `${list.name} copy`,
      records: 0,
    };
    copy.custom = copy.custom.map((c: CustomColumn) => ({ ...c, id: id('c') }));
    store.db.leadLists.push(copy);
    store.db.leadRecords[copy.id] = [];
    store.save();
    res.status(201).json(copy);
  }),
);

/* ------------------------------------------------------------------ schema */

leadListsRouter.get(
  '/:id/schema',
  asyncRoute((req, res) => {
    const list = findList(req.params.id);
    res.json({
      fixed: list.fixed,
      custom: list.custom,
      maxCustom: MAX_CUSTOM,
      room: MAX_CUSTOM - list.custom.length,
      visibleColumns: visibleColumns(list),
    });
  }),
);

leadListsRouter.patch(
  '/:id/schema',
  asyncRoute((req, res) => {
    const store = getStore();
    const list = findList(req.params.id);
    const nextCustom = (req.body?.custom ?? list.custom) as CustomColumn[];

    if (nextCustom.length > MAX_CUSTOM) {
      throw badRequest(`A lead list can have at most ${MAX_CUSTOM} custom columns`);
    }

    if (req.body?.fixed) {
      // phone and altphone can never be marked sensitive, whatever the client sends.
      (req.body.fixed as Array<{ key: string; sensitive: boolean }>).forEach((incoming) => {
        const col = list.fixed.find((f) => f.key === incoming.key);
        if (!col || col.nosens) return;
        col.sensitive = !!incoming.sensitive;
      });
    }

    const removed = list.custom.filter((c) => !nextCustom.some((n) => n.id === c.id));
    list.custom = nextCustom.map((c) => ({
      ...newCustomColumn(c.id || id('c'), c.label ?? ''),
      sensitive: !!c.sensitive,
      hidden: !!c.hidden,
    }));

    // Drop the data of a removed column rather than leaving orphan keys on every record.
    if (removed.length) {
      records(list.id).forEach((row) => removed.forEach((c) => delete row[c.id]));
    }
    store.save();
    res.json({
      fixed: list.fixed,
      custom: list.custom,
      removedColumns: removed.map((c) => ({ id: c.id, label: c.label })),
      /** The client warns with this count before a destructive schema change. */
      affectedRecords: removed.length ? list.records : 0,
      visibleColumns: visibleColumns(list),
    });
  }),
);

/** The sample CSV is generated from the schema, so the template always matches. */
leadListsRouter.get(
  '/:id/sample.csv',
  asyncRoute((req, res) => {
    const list = findList(req.params.id);
    res.type('text/csv');
    res.attachment(`${list.name || 'lead-list'}-sample.csv`);
    res.send(sampleCsvHeader(list) + '\n');
  }),
);

/* ----------------------------------------------------------------- records */

leadListsRouter.get(
  '/:id/records',
  asyncRoute((req, res) => {
    const list = findList(req.params.id);
    const q = String(req.query.q ?? '').toLowerCase();
    const cols = visibleColumns(list);
    // Server-side search across the visible columns.
    const rows = records(list.id).filter((r) =>
      !q ? true : cols.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q)),
    );
    res.json({ ...paginate(rows, req.query.page, req.query.perPage), columns: cols });
  }),
);

leadListsRouter.post(
  '/:id/records',
  asyncRoute((req, res) => {
    const store = getStore();
    const list = findList(req.params.id);
    const row: LeadRecord = { ...(req.body ?? {}), id: id('r') };
    if (!row.phone) throw badRequest('phone is required');
    records(list.id).push(row);
    list.records = records(list.id).length;
    store.save();
    res.status(201).json(row);
  }),
);

leadListsRouter.patch(
  '/:id/records/:rid',
  asyncRoute((req, res) => {
    const store = getStore();
    const list = findList(req.params.id);
    const row = records(list.id).find((r) => r.id === req.params.rid);
    if (!row) throw notFound('Record');
    Object.assign(row, req.body ?? {}, { id: row.id });
    store.save();
    res.json(row);
  }),
);

leadListsRouter.delete(
  '/:id/records/:rid',
  asyncRoute((req, res) => {
    const store = getStore();
    const list = findList(req.params.id);
    const before = records(list.id).length;
    store.db.leadRecords[list.id] = records(list.id).filter((r) => r.id !== req.params.rid);
    if (store.db.leadRecords[list.id].length === before) throw notFound('Record');
    list.records = store.db.leadRecords[list.id].length;
    store.save();
    res.json({ deleted: req.params.rid, records: list.records });
  }),
);

leadListsRouter.post(
  '/:id/records/clear',
  asyncRoute((req, res) => {
    const store = getStore();
    const list = findList(req.params.id);
    const cleared = list.records;
    // Empties the list but keeps the columns, so it can be reloaded next month.
    store.db.leadRecords[list.id] = [];
    list.records = 0;
    store.save();
    res.json({ cleared, columns: columnCount(list) });
  }),
);

/* ------------------------------------------------------------------ upload */

interface UploadBody {
  rows?: LeadRecord[];
  duplicateMode?: DuplicateMode;
  dedupeScope?: DedupeScope;
}

/**
 * Upload. Accepts parsed rows (the POC posts JSON rather than multipart, so the
 * duplicate rules are exercised without a CSV parser in the way).
 */
leadListsRouter.post(
  '/:id/records/upload',
  asyncRoute((req, res) => {
    const store = getStore();
    const list = findList(req.params.id);
    const body = (req.body ?? {}) as UploadBody;
    const mode: DuplicateMode = body.duplicateMode ?? 'skip';
    const scope: DedupeScope = body.dedupeScope ?? 'list';
    const incoming = body.rows ?? [];
    if (!Array.isArray(incoming)) throw badRequest('rows must be an array');

    const norm = (p: unknown) => String(p ?? '').replace(/[\s\-()]/g, '');

    // Dedupe scope decides which existing numbers count as a duplicate.
    const existingPhones = new Map<string, { listId: string; row: LeadRecord }>();
    const scanned = scope === 'all' ? Object.keys(store.db.leadRecords) : [list.id];
    scanned.forEach((lid) => {
      (store.db.leadRecords[lid] ?? []).forEach((r) => {
        const key = norm(r.phone);
        if (key && !existingPhones.has(key)) existingPhones.set(key, { listId: lid, row: r });
      });
    });

    let added = 0;
    let skipped = 0;
    let overwritten = 0;
    let cloned = 0;
    const rejected: Array<{ row: LeadRecord; reason: string }> = [];

    incoming.forEach((raw) => {
      const phone = norm(raw.phone);
      if (!phone) {
        rejected.push({ row: raw, reason: 'no phone number' });
        return;
      }
      const dupe = existingPhones.get(phone);
      if (!dupe) {
        const row = { ...raw, id: id('r') };
        records(list.id).push(row);
        existingPhones.set(phone, { listId: list.id, row });
        added++;
        return;
      }
      if (mode === 'skip') {
        skipped++;
        return;
      }
      if (mode === 'overwrite') {
        // Only overwrite inside this list; a row in another list is not ours to edit.
        if (dupe.listId === list.id) {
          Object.assign(dupe.row, raw, { id: dupe.row.id });
          overwritten++;
        } else {
          skipped++;
        }
        return;
      }
      const row = { ...raw, id: id('r') };
      records(list.id).push(row);
      cloned++;
    });

    list.records = records(list.id).length;
    list.updated = new Date().toISOString().slice(0, 10);
    store.save();
    res.json({
      added,
      skipped,
      overwritten,
      cloned,
      rejected: rejected.length,
      rejectedRows: rejected.slice(0, 20),
      duplicateMode: mode,
      dedupeScope: scope,
      records: list.records,
    });
  }),
);
