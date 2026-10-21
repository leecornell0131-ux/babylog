import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync } from 'node:crypto';

const source = await readFile(new URL('../push-server/worker.js', import.meta.url), 'utf8');
const { default: worker } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const migration = await readFile(new URL('../push-server/migrations/0001_summaries.sql', import.meta.url), 'utf8');
const fid = 'AAAAAAAAAA';
function fixture(d1 = true) {
  const values = new Map(), counts = { get: 0, put: 0 };
  const env = { KV: {
    async get(k) { counts.get++; return JSON.parse(values.get(k) || 'null'); },
    async put(k, v) { counts.put++; values.set(k, v); },
  } };
  if (d1) {
    const sql = new DatabaseSync(':memory:');
    sql.exec(migration); sql.exec(migration); // 재배포 때 다시 실행해도 기존 행/테이블을 지우지 않음.
    env.DB = { prepare(query) { return { bind(...args) { return {
      async first() { return sql.prepare(query).get(...args) || null; },
      async run() { const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
    }; } }; } };
  }
  const request = (path, body, method = body ? 'POST' : 'GET') => worker.fetch(new Request('https://test.invalid' + path, {
    method, headers: { Origin: 'https://leecornell0131-ux.github.io', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env);
  const notify = (at, name = '아기') => request('/notify', { fid, summary: { at, name, sleep: 123, feed: null } });
  return { env, values, counts, request, notify };
}

test('D1 stores widget summaries without KV summary writes', async () => {
  const f = fixture();
  assert.equal((await f.notify(100)).status, 200);
  assert.equal(f.counts.put, 0);
  const j = await (await f.request('/summary?fid=' + fid)).json();
  assert.equal(j.summary.at, 100); assert.equal(j.summary.sleep, 123); assert.equal(j.summary.feed, null);
});
test('legacy KV summary is lazily migrated and old GET contract is unchanged', async () => {
  const f = fixture();
  f.values.set('s:' + fid, JSON.stringify({ at: 400, name: '기존 아기', sleep: 123 }));
  assert.equal((await (await f.request('/summary?fid=' + fid)).json()).summary.at, 400);
  f.values.delete('s:' + fid);
  assert.equal((await (await f.request('/summary?fid=' + fid)).json()).summary.at, 400);
  assert.equal(f.counts.put, 0);
});
test('late request cannot overwrite newer D1 row', async () => {
  const f = fixture(); await f.notify(200, '새 기록');
  assert.equal((await (await f.notify(100, '옛 기록')).json()).stale, true);
  assert.equal((await (await f.request('/summary?fid=' + fid)).json()).summary.name, '새 기록');
});
test('atomic D1 write preserves newest at when two handlers read the same old row', async () => {
  const f = fixture(); await f.notify(100);
  const [a, b] = await Promise.all([f.notify(300, '최신'), f.notify(200, '과거')]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal((await (await f.request('/summary?fid=' + fid)).json()).summary.at, 300);
});
test('new handler respects a newer legacy KV summary during migration', async () => {
  const f = fixture(); f.values.set('s:' + fid, JSON.stringify({ at: 500, name: '기존 최신' }));
  assert.equal((await (await f.notify(400)).json()).stale, true);
  assert.equal((await (await f.request('/summary?fid=' + fid)).json()).summary.at, 500);
});
test('D1 error is visible, never silently splits latest state into KV', async () => {
  const f = fixture(); f.env.DB = { prepare() { throw new Error('DB unavailable'); } };
  assert.equal((await f.notify(100)).status, 500); assert.equal(f.counts.put, 0);
});
test('without D1 binding the previous KV server remains usable', async () => {
  const f = fixture(false); assert.equal((await f.notify(100)).status, 200);
  assert.equal(f.counts.put, 1); assert.equal((await (await f.request('/summary?fid=' + fid)).json()).summary.at, 100);
});
test('legacy registration/unregistration contracts and token KV remain unchanged', async () => {
  const f = fixture(), body = { fid, token: 'x'.repeat(30) };
  await f.request('/register', body); await f.request('/register', body);
  assert.equal(f.counts.put, 1);
  await f.request('/unregister', body); assert.equal(f.counts.put, 2);
});
test('empty family and invalid code keep existing API responses', async () => {
  const f = fixture(); assert.deepEqual(await (await f.request('/summary?fid=' + fid)).json(), { summary: null });
  assert.equal((await f.request('/summary?fid=bad')).status, 400);
});
test('preflight can be cached and does not touch storage', async () => {
  const f = fixture(), r = await f.request('/notify', null, 'OPTIONS');
  assert.equal(r.status, 204); assert.equal(r.headers.get('Access-Control-Max-Age'), '86400');
  assert.deepEqual(f.counts, { get: 0, put: 0 });
});

test('transient FCM failure is not falsely acknowledged and same-at retry remains possible', async () => {
  const f = fixture(), { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  f.env.FCM_SA = JSON.stringify({ client_email: 'test@example.invalid', project_id: 'fake',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  f.values.set('t:' + fid, JSON.stringify(['x'.repeat(30)]));
  const original = globalThis.fetch; let sends = 0;
  globalThis.fetch = async url => {
    if (String(url).includes('oauth2.googleapis.com')) return Response.json({ access_token: 'fake', expires_in: 3600 });
    sends++;
    return sends === 1 ? new Response('temporary', { status: 503 }) : Response.json({ name: 'ok' });
  };
  try {
    assert.equal((await f.notify(100)).status, 503);
    const r = await f.notify(100); assert.equal(r.status, 200); assert.equal((await r.json()).sent, 1);
    assert.equal(sends, 2);
  } finally { globalThis.fetch = original; }
});
