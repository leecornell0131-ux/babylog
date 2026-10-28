import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync } from 'node:crypto';

const source = await readFile(new URL('../push-server/worker.js', import.meta.url), 'utf8');
const { default: worker, cleanSummary, calibration } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const migration = (await readFile(new URL('../push-server/migrations/0001_summaries.sql', import.meta.url), 'utf8'))
  + (await readFile(new URL('../push-server/migrations/0002_usage.sql', import.meta.url), 'utf8'))
  + (await readFile(new URL('../push-server/migrations/0003_usage_actual.sql', import.meta.url), 'utf8'));
const fid = 'AAAAAAAAAA';
function fixture(d1 = true) {
  const values = new Map(), counts = { get: 0, put: 0 };
  const env = { USAGE_FLUSH_MS: 0, KV: {
    async get(k) { counts.get++; return JSON.parse(values.get(k) || 'null'); },
    async put(k, v) { counts.put++; values.set(k, v); },
  } };
  if (d1) {
    const sql = new DatabaseSync(':memory:');
    sql.exec(migration); sql.exec(migration); // 재배포 때 다시 실행해도 기존 행/테이블을 지우지 않음.
    env.DB = { prepare(query) { return { bind(...args) { return {
      async first() { return sql.prepare(query).get(...args) || null; },
      async run() { const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
      async all() { return { results: sql.prepare(query).all(...args) }; },
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

test('cleanSummary는 수면 구간 목록을 구간 단위로만 잘라 숫자가 바뀌지 않음', () => {
  const list = 'm:' + Array.from({ length: 90 }, (_, i) => `${1000 + i * 10}-${995 + i * 10}`).join(',');
  const o = cleanSummary({ at: 1, sleeps: list });
  assert.ok(o.sleeps.length <= 600);
  assert.ok(o.sleeps.slice(2).split(',').every(p => /^\d+-\d+$/.test(p) && list.includes(p)));
  assert.equal(cleanSummary({ at: 1, sleeps: 'm:1-2,bad,3-4' }).sleeps, 'm:1-2,3-4');
  assert.equal(cleanSummary({ at: 1 }).sleeps, null);
});

test('usage: requests counted per family, family code masked in report', async () => {
  const f = fixture();
  await f.notify(100); await f.request('/summary?fid=' + fid); await f.request('/summary?fid=' + fid);
  await f.request('/');
  const j = await (await f.request('/usage?fid=' + fid)).json();
  const today = j.days[0];
  assert.equal(today.families, 1); assert.equal(today.otherReq, 1);
  assert.equal(today.top[0].req, 3); assert.equal(today.top[0].me, true);
  assert.ok(!JSON.stringify(j).includes(fid), 'full family code must not be exposed');
  assert.equal(j.limits.fsReads, 50000);
});
test('usage: app reports keep the larger cumulative value and reject bad input', async () => {
  const f = fixture();
  const day = new Date().toISOString().slice(0, 10);
  const send = b => f.request('/usage', { fid, day, dev: 'abcd1234', reads: 10, writes: 2, ...b });
  assert.equal((await send({})).status, 200);
  await send({ reads: 40, writes: 1 });
  await send({ dev: 'zzzz9999', reads: 5, writes: 5 });
  assert.equal((await send({ day: '2020-01-01' })).status, 400);
  assert.equal((await send({ dev: 'BAD!' })).status, 400);
  assert.equal((await send({ reads: -1 })).status, 400);
  const t = (await (await f.request('/usage')).json()).days[0];
  assert.equal(t.est.reads, 45); assert.equal(t.est.writes, 7); assert.equal(t.reads, 68); assert.equal(t.top[0].devs, 2); assert.equal(t.sharedFamilies, 1);
});
test('usage counting never breaks the widget API when tables are missing', async () => {
  const f = fixture();
  const broken = { ...f.env, DB: { prepare(q) { if (/usage_/.test(q)) throw new Error('no such table'); return f.env.DB.prepare(q); } } };
  const r = await worker.fetch(new Request('https://test.invalid/summary?fid=' + fid), broken);
  assert.equal(r.status, 200);
});
test('usage: requests inside the wait window are saved without a later request (no loss on instance shutdown)', async () => {
  const f = fixture(); f.env.USAGE_FLUSH_MS = 50;
  const waits = [];
  const ctx = { waitUntil: p => waits.push(p) };
  const other = 'BBBBBBBBBB';
  const hit = () => worker.fetch(new Request('https://test.invalid/summary?fid=' + other), f.env, ctx);
  await hit(); await hit(); await hit();
  await Promise.all(waits); // 런타임은 응답 뒤에도 이 약속이 끝날 때까지 인스턴스를 유지함
  f.env.USAGE_FLUSH_MS = 0;
  const t = (await (await f.request('/usage?fid=' + other)).json()).days[0];
  assert.equal(t.top.find(x => x.me).req, 3);
});

test('usage: direct counts from Cloudflare/Firebase override and calibrate the self-counted numbers', async () => {
  const f = fixture();
  const day = i => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
  const send = (d, reads, writes) => f.request('/usage', { fid, day: d, dev: 'abcd1234', reads, writes });
  await send(day(1), 100, 20); await send(day(0), 50, 10);
  const q = (sql, ...a) => f.env.DB.prepare(sql).bind(...a).run();
  await q('INSERT INTO usage_actual (day, cf_req, fs_reads, fs_writes, at) VALUES (?1, ?2, ?3, ?4, ?5)', day(1), 300, 180, 30, 1);
  const j = await (await f.request('/usage')).json();
  const y = j.days.find(d => d.day === day(1)), t = j.days.find(d => d.day === day(0));
  assert.equal(y.reads, 180); assert.equal(y.writes, 30); assert.equal(y.req, 300); // 마감일: 직접 집계가 기준
  assert.equal(j.calib.reads, 1.8); assert.equal(j.calib.writes, 1.5);
  assert.equal(t.reads, 90); assert.equal(t.writes, 15); // 오늘: 자체 집계 × 어제 비율
  assert.equal(t.est.reads, 50);
});
test('calibration falls back to 1.5x for Firestore and clamps to 1..3', () => {
  assert.deepEqual(calibration([], {}, '2026-10-25'), { req: 1, reads: 1.5, writes: 1.5 });
  const c = calibration([{ day: '2026-10-24', req: 10, reads: 10, writes: 10 }], { '2026-10-24': { cf_req: 5, fs_reads: 100, fs_writes: null } }, '2026-10-25');
  assert.equal(c.req, 1); assert.equal(c.reads, 3); assert.equal(c.writes, 1.5);
});
