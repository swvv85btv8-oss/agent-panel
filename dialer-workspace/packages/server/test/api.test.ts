import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app';
import { buildSeed } from '../src/db/seed';
import { Store, setStore } from '../src/db/store';

let base = '';
let server: http.Server;

before(async () => {
  setStore(new Store(null)).reset(buildSeed()); // in-memory, no file
  server = http.createServer(createApp());
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => server.close());

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body: json as any };
}

const reseed = () => call('POST', '/api/dev/reseed');

describe('campaigns', () => {
  it('lists seeded campaigns with their queue counts', async () => {
    await reseed();
    const { status, body } = await call('GET', '/api/campaigns');
    assert.equal(status, 200);
    assert.equal(body.total, 3);
    const west = body.rows.find((c: any) => c.name === 'WEST HFC');
    assert.equal(west.queues, 2);
  });

  it('presents owned queues as children of the campaign', async () => {
    const list = await call('GET', '/api/campaigns');
    const west = list.body.rows.find((c: any) => c.name === 'WEST HFC');
    const { body } = await call('GET', `/api/campaigns/${west.id}`);
    assert.equal(body.values.queues.length, 2);
    // The client must not be able to tell queues are stored separately.
    assert.ok(!('campaignId' in body.values.queues[0]));
  });

  it('creates from a template with library names resolved to ids', async () => {
    const { status, body } = await call('POST', '/api/campaigns', { templateId: 'collections' });
    assert.equal(status, 201);
    assert.equal(body.values.dialMethod, 'Predictive');
    assert.equal(body.values.maxAbandon, '3');
    // "Standard outcomes" became a real id.
    assert.match(body.values.dispositionList, /^ds_/);
    assert.match(body.values.dndList, /^dnd_/);
  });

  it('rejects an unknown template', async () => {
    const { status } = await call('POST', '/api/campaigns', { templateId: 'nope' });
    assert.equal(status, 400);
  });

  it('refuses to publish an incomplete campaign with field-keyed 422 errors', async () => {
    const created = await call('POST', '/api/campaigns', { templateId: 'blank' });
    const { status, body } = await call('POST', `/api/campaigns/${created.body.id}/publish`);
    assert.equal(status, 422);
    const fields = body.errors.map((e: any) => e.field);
    assert.ok(fields.includes('name'));
    assert.ok(fields.includes('__leads'));
    assert.ok(body.errors.every((e: any) => e.section));
  });

  it('publishes once every blocking field is filled', async () => {
    await reseed();
    const lists = await call('GET', '/api/lead-lists');
    const dispos = await call('GET', '/api/disposition-sets');
    const created = await call('POST', '/api/campaigns', { templateId: 'sales' });
    const patch = await call('PATCH', `/api/campaigns/${created.body.id}`, {
      name: 'New sales push',
      callerId: ['1800 111 2222'],
      agentGroup: 'Retention',
      ringTimeout: '30',
      dispositionList: dispos.body.rows[0].id,
      leadLists: [lists.body.rows[0].id],
    });
    assert.equal(patch.status, 200);
    assert.deepEqual(patch.body.issues, []);
    const pub = await call('POST', `/api/campaigns/${created.body.id}/publish`);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.status, 'running');
    // Publishing snapshots the values, so nothing reads as dirty afterwards.
    assert.deepEqual(pub.body.published.name, pub.body.values.name);
  });

  it('caps lead lists at three', async () => {
    const lists = await call('GET', '/api/lead-lists');
    const created = await call('POST', '/api/campaigns', { templateId: 'blank' });
    const four = [...lists.body.rows.map((l: any) => l.id), 'll_extra'];
    const { status } = await call('PATCH', `/api/campaigns/${created.body.id}`, { leadLists: four });
    assert.equal(status, 400);
  });

  it('cascade-deletes owned queues and says which numbers went dead', async () => {
    await reseed();
    const list = await call('GET', '/api/campaigns');
    const west = list.body.rows.find((c: any) => c.name === 'WEST HFC');
    const { body } = await call('DELETE', `/api/campaigns/${west.id}`);
    assert.equal(body.cascadedQueues.length, 2);
    assert.ok(body.cascadedQueues[0].dids.length);
    const after = await call('GET', '/api/campaigns');
    assert.equal(after.body.total, 2);
  });
});

describe('inbound queues', () => {
  let campaignId = '';
  before(async () => {
    await reseed();
    const list = await call('GET', '/api/campaigns');
    campaignId = list.body.rows.find((c: any) => c.name === 'WEST HFC').id;
  });

  it('refuses a DID already used by another queue on the same campaign', async () => {
    const { status, body } = await call('POST', `/api/campaigns/${campaignId}/queues`, {
      name: 'Third queue',
      dids: ['1800 209 5000'],
    });
    assert.equal(status, 409);
    assert.match(body.error, /already pointed at WEST HFC collections/);
  });

  it('refuses a DID already used by a queue on another campaign, naming it', async () => {
    const others = await call('GET', '/api/campaigns');
    const other = others.body.rows.find((c: any) => c.name === 'North Collections Q3');
    const { status, body } = await call('POST', `/api/campaigns/${other.id}/queues`, {
      name: 'North returns',
      dids: ['1800 209 5000'],
    });
    assert.equal(status, 409);
    assert.match(body.error, /already reaches WEST HFC collections on WEST HFC/);
  });

  it('compares numbers ignoring spacing', async () => {
    const { status } = await call('POST', `/api/campaigns/${campaignId}/queues`, {
      name: 'Spaced', dids: ['18002095000'],
    });
    assert.equal(status, 409);
  });

  it('accepts a free number and reports what is still unfinished', async () => {
    const { status, body } = await call('POST', `/api/campaigns/${campaignId}/queues`, {
      name: 'Overflow', dids: ['1800 300 4000'],
    });
    assert.equal(status, 201);
    // No agents yet, so the queue is not complete.
    assert.ok(body.issues.some((i: any) => i.id === 'agents'));
  });

  it('warns which numbers go dead when a queue is deleted', async () => {
    const c = await call('GET', `/api/campaigns/${campaignId}`);
    const queue = c.body.values.queues[0];
    const { body } = await call('DELETE', `/api/campaigns/${campaignId}/queues/${queue.id}`);
    assert.deepEqual(body.orphanedDids, queue.dids);
    assert.match(body.warning, /will stop reaching WEST HFC/);
  });

  it('frees a DID for reuse once its queue is gone', async () => {
    const { status } = await call('POST', `/api/campaigns/${campaignId}/queues`, {
      name: 'Reuse', dids: ['1800 209 5000'],
    });
    assert.equal(status, 201);
  });
});

describe('lead lists', () => {
  let listId = '';
  before(async () => {
    await reseed();
    const lists = await call('GET', '/api/lead-lists');
    listId = lists.body.rows.find((l: any) => l.name === 'WEST_HFC_JUL').id;
  });

  it('returns usage counts in the list payload, not per row', async () => {
    const { body } = await call('GET', '/api/lead-lists');
    const west = body.rows.find((l: any) => l.name === 'WEST_HFC_JUL');
    assert.equal(west.usedByCampaigns, 2); // WEST HFC and North Collections Q3
    assert.ok(body.rows.every((r: any) => typeof r.usedByCampaigns === 'number'));
  });

  it('paginates records and searches server-side', async () => {
    const page = await call('GET', `/api/lead-lists/${listId}/records?page=2&perPage=10`);
    assert.equal(page.body.rows.length, 10);
    assert.equal(page.body.page, 2);
    assert.equal(page.body.total, 240);
    const first = page.body.rows[0];
    const search = await call(
      'GET',
      `/api/lead-lists/${listId}/records?q=${encodeURIComponent(first.phone)}`,
    );
    assert.ok(search.body.total >= 1);
  });

  it('rejects more than 34 custom columns', async () => {
    const custom = Array.from({ length: 35 }, (_, i) => ({ id: '', label: `Col ${i}` }));
    const { status } = await call('PATCH', `/api/lead-lists/${listId}/schema`, { custom });
    assert.equal(status, 400);
  });

  it('never lets phone or altphone be marked sensitive', async () => {
    const { body } = await call('PATCH', `/api/lead-lists/${listId}/schema`, {
      fixed: [
        { key: 'phone', sensitive: true },
        { key: 'altphone', sensitive: true },
        { key: 'name', sensitive: true },
      ],
    });
    assert.equal(body.fixed.find((f: any) => f.key === 'phone').sensitive, false);
    assert.equal(body.fixed.find((f: any) => f.key === 'altphone').sensitive, false);
    assert.equal(body.fixed.find((f: any) => f.key === 'name').sensitive, true);
  });

  it('reports the record count when a populated column is dropped', async () => {
    const schema = await call('GET', `/api/lead-lists/${listId}/schema`);
    const keep = schema.body.custom.slice(0, 3);
    const { body } = await call('PATCH', `/api/lead-lists/${listId}/schema`, { custom: keep });
    assert.equal(body.removedColumns.length, 1);
    assert.equal(body.affectedRecords, 240);
  });

  it('generates the sample CSV from the schema', async () => {
    const res = await fetch(`${base}/api/lead-lists/${listId}/sample.csv`);
    const text = await res.text();
    assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(text, /^Phone Number, Name, Email Id, Address, Company Name, Alternate Phone Number/);
  });

  it('excludes hidden columns from the sample CSV', async () => {
    const schema = await call('GET', `/api/lead-lists/${listId}/schema`);
    const custom = schema.body.custom.map((c: any, i: number) => ({ ...c, hidden: i === 0 }));
    await call('PATCH', `/api/lead-lists/${listId}/schema`, { custom });
    const text = await (await fetch(`${base}/api/lead-lists/${listId}/sample.csv`)).text();
    assert.ok(!text.includes(custom[0].label));
  });

  describe('upload duplicate handling', () => {
    const rows = [
      { phone: '+919000000001', name: 'Fresh One' },
      { phone: '+919000000002', name: 'Fresh Two' },
    ];

    it('skips duplicates by default', async () => {
      await reseed();
      const lists = await call('GET', '/api/lead-lists');
      const lid = lists.body.rows[0].id;
      await call('POST', `/api/lead-lists/${lid}/records/upload`, { rows });
      const again = await call('POST', `/api/lead-lists/${lid}/records/upload`, {
        rows,
        duplicateMode: 'skip',
      });
      assert.equal(again.body.added, 0);
      assert.equal(again.body.skipped, 2);
    });

    it('overwrites in place when asked', async () => {
      const lists = await call('GET', '/api/lead-lists');
      const lid = lists.body.rows[0].id;
      const r = await call('POST', `/api/lead-lists/${lid}/records/upload`, {
        rows: [{ phone: '+919000000001', name: 'Renamed' }],
        duplicateMode: 'overwrite',
      });
      assert.equal(r.body.overwritten, 1);
      const found = await call('GET', `/api/lead-lists/${lid}/records?q=Renamed`);
      assert.equal(found.body.total, 1);
    });

    it('clones when asked, keeping both copies', async () => {
      const lists = await call('GET', '/api/lead-lists');
      const lid = lists.body.rows[0].id;
      const before = (await call('GET', `/api/lead-lists/${lid}/records`)).body.total;
      const r = await call('POST', `/api/lead-lists/${lid}/records/upload`, {
        rows: [{ phone: '+919000000001', name: 'Copy' }],
        duplicateMode: 'clone',
      });
      assert.equal(r.body.cloned, 1);
      const after = (await call('GET', `/api/lead-lists/${lid}/records`)).body.total;
      assert.equal(after, before + 1);
    });

    it('honours account-wide dedupe scope', async () => {
      await reseed();
      const lists = await call('GET', '/api/lead-lists');
      const a = lists.body.rows[0].id;
      const b = lists.body.rows[1].id;
      await call('POST', `/api/lead-lists/${a}/records/upload`, {
        rows: [{ phone: '+919111111111', name: 'In list A' }],
      });
      const scoped = await call('POST', `/api/lead-lists/${b}/records/upload`, {
        rows: [{ phone: '+919111111111', name: 'Same person' }],
        dedupeScope: 'all',
      });
      assert.equal(scoped.body.added, 0);
      assert.equal(scoped.body.skipped, 1);

      const unscoped = await call('POST', `/api/lead-lists/${b}/records/upload`, {
        rows: [{ phone: '+919111111111', name: 'Same person' }],
        dedupeScope: 'list',
      });
      assert.equal(unscoped.body.added, 1);
    });

    it('rejects rows with no phone number', async () => {
      const lists = await call('GET', '/api/lead-lists');
      const r = await call('POST', `/api/lead-lists/${lists.body.rows[0].id}/records/upload`, {
        rows: [{ name: 'Nobody' }],
      });
      assert.equal(r.body.rejected, 1);
    });
  });
});

describe('disposition sets', () => {
  let setId = '';
  before(async () => {
    await reseed();
    const sets = await call('GET', '/api/disposition-sets');
    setId = sets.body.rows.find((s: any) => s.name === 'SMFG').id;
  });

  it('summarises depth, action and conflict counts without sending the tree', async () => {
    const { body } = await call('GET', '/api/disposition-sets');
    const smfg = body.rows.find((s: any) => s.name === 'SMFG');
    assert.equal(smfg.levels, 5);
    assert.equal(smfg.dndActions, 2);
    assert.ok(!('tree' in smfg));
  });

  it('returns the full tree on the detail endpoint', async () => {
    const { body } = await call('GET', `/api/disposition-sets/${setId}`);
    assert.ok(Array.isArray(body.tree));
    assert.equal(body.levels, 5);
  });

  it('rejects a tree deeper than five levels', async () => {
    const deep = (n: number): any =>
      n === 0 ? [] : [{ id: 'x' + n, name: 'L' + n, code: 'L' + n, status: 'Enabled', action: null, children: deep(n - 1) }];
    const { status, body } = await call('PUT', `/api/disposition-sets/${setId}/tree`, { tree: deep(6) });
    assert.equal(status, 400);
    assert.match(body.error, /at most 5 levels/);
  });

  it('rejects duplicate codes with a per-node error', async () => {
    const tree = [
      { id: 'a', name: 'A', code: 'Dup', status: 'Enabled', action: null, children: [] },
      { id: 'b', name: 'B', code: 'Dup', status: 'Enabled', action: null, children: [] },
    ];
    const { status, body } = await call('PUT', `/api/disposition-sets/${setId}/tree`, { tree });
    assert.equal(status, 422);
    assert.match(body.errors[0].field, /^code:/);
  });

  it('grandfathers the existing 4-5 character codes', async () => {
    // Pytd and Plcyi are already in the seeded SMFG set and must survive a save.
    const current = await call('GET', `/api/disposition-sets/${setId}`);
    const { status } = await call('PUT', `/api/disposition-sets/${setId}/tree`, {
      tree: current.body.tree,
    });
    assert.equal(status, 200);
  });

  it('merges a bulk upload, matching existing branches by name', async () => {
    const before = (await call('GET', `/api/disposition-sets/${setId}`)).body.dispositions;
    const { body } = await call('POST', `/api/disposition-sets/${setId}/bulk`, {
      text: 'Connected > Interested > Ready to pay [Rdy]\nConnected > Deferred | callback',
    });
    assert.ok(body.matched >= 2);
    assert.ok(body.added >= 2);
    assert.equal(body.dispositions, before + body.added);
  });

  it('reports lines that exceed five levels instead of truncating them', async () => {
    const { body } = await call('POST', `/api/disposition-sets/${setId}/bulk`, {
      text: 'a > b > c > d > e > f',
    });
    assert.equal(body.tooDeep, 1);
    assert.match(body.errors[0], /exceeds the maximum of 5/);
  });
});

describe('surveys', () => {
  it('refuses to change a survey type after creation', async () => {
    await reseed();
    const list = await call('GET', '/api/surveys');
    const voice = list.body.rows.find((s: any) => s.type === 'voice');
    const { status, body } = await call('PATCH', `/api/surveys/${voice.id}`, { type: 'web' });
    assert.equal(status, 400);
    assert.match(body.error, /cannot be changed after creation/);
  });

  it('creates each type with its own starting shape', async () => {
    const v = await call('POST', '/api/surveys', { type: 'voice', name: 'V' });
    assert.ok(v.body.entries.length);
    assert.ok(v.body.digitTimeout);
    const w = await call('POST', '/api/surveys', { type: 'web', name: 'W' });
    assert.ok(w.body.questions.length);
    assert.ok(!('entries' in w.body));
  });

  it('rejects a survey with no type', async () => {
    const { status } = await call('POST', '/api/surveys', { name: 'X' });
    assert.equal(status, 400);
  });
});

describe('DND lists', () => {
  it('classifies short entries as prefixes and long ones as numbers', async () => {
    await reseed();
    const lists = await call('GET', '/api/dnd-lists');
    const dnd = lists.body.rows[0].id;
    const prefix = await call('POST', `/api/dnd-lists/${dnd}/entries`, { value: '+9170' });
    const number = await call('POST', `/api/dnd-lists/${dnd}/entries`, { value: '+919876543210' });
    assert.equal(prefix.body.type, 'Prefix');
    assert.equal(number.body.type, 'Number');
  });

  it('skips duplicates on upload', async () => {
    const lists = await call('GET', '/api/dnd-lists');
    const dnd = lists.body.rows[0].id;
    const r = await call('POST', `/api/dnd-lists/${dnd}/entries/upload`, {
      rows: [{ value: '+919876543210' }, { value: '+919000000999' }],
    });
    assert.equal(r.body.skipped, 1);
    assert.equal(r.body.added, 1);
  });

  it('counts a DND list used indirectly through a disposition action', async () => {
    await reseed();
    const { body } = await call('GET', '/api/dnd-lists');
    // WEST HFC names DND directly; the Standard outcomes / SMFG trees also add to it.
    assert.ok(body.rows[0].usedByCampaigns >= 2);
  });

  it('protects the seeded default from deletion', async () => {
    const { body } = await call('GET', '/api/dnd-lists');
    const def = body.rows.find((d: any) => d.def);
    const { status } = await call('DELETE', `/api/dnd-lists/${def.id}`);
    assert.equal(status, 400);
  });
});

describe('meta', () => {
  it('hands the campaign form every library dropdown in one call', async () => {
    await reseed();
    const { body } = await call('GET', '/api/meta/library');
    ['disposition', 'csat', 'dnd', 'quick', 'pause', 'skill', 'script', 'leads'].forEach((k) => {
      assert.ok(Array.isArray(body[k]), `${k} missing`);
      assert.ok(body[k].length, `${k} is empty — a new account must have a working default`);
    });
    assert.equal(body.groups.length, 4);
  });

  it('ships a seeded default in every library collection', async () => {
    const { body } = await call('GET', '/api/meta/library');
    ['disposition', 'csat', 'dnd', 'quick', 'pause', 'skill', 'script'].forEach((k) => {
      assert.ok(body[k].some((x: any) => x.def), `${k} has no seeded default`);
    });
  });
});
