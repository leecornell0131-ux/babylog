import { test } from 'node:test';
import assert from 'node:assert/strict';

test('browser entry retries HTTP failure on online event and memo-only save makes no POST', async () => {
  const names = ['window', 'document', 'localStorage', 'fetch', 'setTimeout', 'clearTimeout'];
  const originals = new Map(names.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const values = new Map([['babylog-sync-v1', JSON.stringify({ fid: 'AAAAAAAAAA' })]]), events = {}, timers = new Map();
  let id = 0, posts = 0, configs = 0;
  globalThis.window = { addEventListener: (k, fn) => { events[k] = fn; } };
  globalThis.document = { hidden: false, addEventListener: (k, fn) => { events[k] = fn; } };
  globalThis.localStorage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  globalThis.setTimeout = fn => { timers.set(++id, fn); return id; };
  globalThis.clearTimeout = n => timers.delete(n);
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/android-app/push-config.json')) { configs++; return Response.json({ worker: 'https://test.invalid' }); }
    assert.equal(url, 'https://test.invalid/notify'); assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body); assert.equal(body.fid, 'AAAAAAAAAA'); assert.equal(body.except, null);
    posts++; return posts === 1 ? new Response('temporary', { status: 503 }) : Response.json({ ok: true, sent: 1 });
  };
  try {
    const m = await import('../push-server/web-notify.js?transport-test');
    const state = { baby: { name: '아기' }, events: [{ id: 'feed', type: 'feed', sub: 'formula', ml: 100, start: Date.now() - 1000 }] };
    m.notifyFamily('AAAAAAAAAA', state); await m.retryPending();
    assert.equal(posts, 1); assert.ok(JSON.parse(values.get('babylog-notify-v1')).pending);
    await events.online(); assert.equal(posts, 2); assert.equal(JSON.parse(values.get('babylog-notify-v1')).pending, null);
    state.events[0].note = '메모만 변경'; m.notifyFamily('AAAAAAAAAA', state); await m.retryPending();
    assert.equal(posts, 2); assert.equal(configs, 1);
    await events.visibilitychange(); assert.equal(posts, 2);
  } finally {
    for (const [k, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, k, descriptor); else delete globalThis[k];
    }
  }
});
