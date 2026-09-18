/** Smoke-test the Express wiring that does not need a database. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import http from 'node:http';
import { createApp } from '../src/api/server';

function listen(): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer(createApp());
    server.listen(0, () => {
      const { port } = server.address() as any;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

describe('http app', () => {
  it('serves /health', async () => {
    const s = await listen();
    const res = await fetch(s.url + '/health');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    s.close();
  });

  it('serves the two POC frontends', async () => {
    const s = await listen();
    for (const page of ['/agent.html', '/supervisor.html']) {
      const res = await fetch(s.url + page);
      assert.equal(res.status, 200, page);
      assert.match(await res.text(), /socket\.io/);
    }
    s.close();
  });

  it('rejects a simulate call with no queueId', async () => {
    const s = await listen();
    const res = await fetch(s.url + '/simulate/inbound-call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /queueId is required/);
    s.close();
  });
});
