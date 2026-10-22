import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as web from '../push-server/web-notify.js';

function fixture(previous) {
  assert.equal(typeof web.createNotifier, 'function', 'testable persistent notification queue is implemented');
  const values = previous || new Map(), calls = [], timers = new Map(); let id = 0, active = 'AAAAAAAAAA';
  const storage = { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v) };
  let handler = async () => ({ ok: true });
  const q = web.createNotifier({ storage, isActive: fid => fid === active,
    post: async (...args) => { calls.push(args); return handler(...args); },
    setTimer: fn => { timers.set(++id, fn); return id; }, clearTimer: n => timers.delete(n),
  });
  return { q, values, calls, setHandler: h => { handler = h; }, setFamily: f => { active = f; },
    async tick() { for (const [n, fn] of [...timers]) { timers.delete(n); await fn(); } } };
}
const fid = 'AAAAAAAAAA', summary = at => ({ at, name: '아기', day: 123, sleep: 10, feed: null, tFeeds: 1 });
test('same widget content across saves/reload skips sends but changed content sends', async () => {
  const f = fixture(); f.q.notify(fid, summary(100)); await f.tick(); assert.equal(f.calls.length, 1);
  f.q.notify(fid, summary(200)); await f.tick(); assert.equal(f.calls.length, 1);
  const g = fixture(f.values); g.q.notify(fid, summary(300)); await g.tick(); assert.equal(g.calls.length, 0);
  g.q.notify(fid, { ...summary(400), sleep: null }); await g.tick(); assert.equal(g.calls.length, 1);
});
test('failed send remains queued across restart and is retried on explicit recovery', async () => {
  const f = fixture(); f.setHandler(async () => { throw Error('offline'); });
  f.q.notify(fid, summary(100)); await f.tick(); assert.equal(f.calls.length, 1);
  const g = fixture(f.values); await g.q.flush(); assert.equal(g.calls.length, 1);
  await g.q.flush(); assert.equal(g.calls.length, 1);
});
test('rapid changes collapse to newest summary', async () => {
  const f = fixture(); f.q.notify(fid, summary(100)); f.q.notify(fid, { ...summary(200), tFeeds: 2 });
  await f.tick(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0][1].tFeeds, 2);
});
test('new save while request is in flight is sent after the first request', async () => {
  const f = fixture(); let release;
  f.setHandler(() => new Promise(r => { release = r; }));
  f.q.notify(fid, summary(100)); const first = f.q.flush();
  f.q.notify(fid, { ...summary(200), tFeeds: 2 });
  f.setHandler(async () => ({ ok: true })); release({ ok: true }); await first;
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1][1].tFeeds, 2);
});
test('family switch never sends the old pending family', async () => {
  const f = fixture(); f.q.notify(fid, summary(100)); f.setFamily('BBBBBBBBBB'); await f.tick();
  assert.equal(f.calls.length, 0);
  f.q.notify('BBBBBBBBBB', summary(200)); await f.tick(); assert.equal(f.calls[0][0], 'BBBBBBBBBB');
});
test('receiving partner changes invalidates an old success fingerprint', async () => {
  const f = fixture(); f.q.notify(fid, summary(100)); await f.tick();
  f.q.observe(fid, { ...summary(200), tFeeds: 2 });
  f.q.notify(fid, summary(300)); await f.tick(); assert.equal(f.calls.length, 2);
});
test('partner change refreshes an unsent summary without creating a new send on its own', async () => {
  const f = fixture(); f.q.observe(fid, summary(100)); await f.tick(); assert.equal(f.calls.length, 0);
  f.q.notify(fid, summary(200)); f.q.observe(fid, { ...summary(300), tFeeds: 2 });
  await f.tick(); assert.equal(f.calls[0][1].tFeeds, 2);
});
test('stale response is not remembered as successful content', async () => {
  const f = fixture(); f.setHandler(async () => ({ ok: true, stale: true }));
  f.q.notify(fid, summary(100)); await f.tick(); f.q.notify(fid, summary(200)); await f.tick();
  assert.equal(f.calls.length, 2);
});
test('observing the same server content does not defeat deduplication', async () => {
  const f = fixture(); f.q.notify(fid, summary(100)); await f.tick();
  f.q.observe(fid, summary(200)); f.q.notify(fid, summary(300)); await f.tick();
  assert.equal(f.calls.length, 1);
});
test('storage denied still allows an in-memory send', async () => {
  assert.equal(typeof web.createNotifier, 'function');
  let sent = 0;
  const q = web.createNotifier({ storage: { getItem() { throw Error(); }, setItem() { throw Error(); } },
    isActive: () => true, post: async () => { sent++; return { ok: true }; }, setTimer: () => 0, clearTimer() {} });
  q.notify(fid, summary(100)); await q.flush(); assert.equal(sent, 1);
});
test('sleeps written as minutes-ago count as the same content when only time passed', async () => {
  const f = fixture(), m = 60e3, t = 1000 * m;
  f.q.notify(fid, { ...summary(t), sleeps: 'm:60-30' }); await f.tick(); assert.equal(f.calls.length, 1);
  f.q.notify(fid, { ...summary(t + m + 5), sleeps: 'm:61-31' }); await f.tick(); assert.equal(f.calls.length, 1);
  f.q.notify(fid, { ...summary(t + 2 * m), sleeps: 'm:62-20' }); await f.tick(); assert.equal(f.calls.length, 2);
});
