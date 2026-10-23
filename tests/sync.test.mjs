import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../sync.js', import.meta.url), 'utf8');
const canonical = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const tick = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
async function fixture(shared = true) {
  const S = { baby: { name: '아기' }, items: {}, gaps: {}, events: [{ id: 'old', type: 'sleep', start: 1, end: null }] };
  const meta = canonical({ baby: S.baby, items: S.items, gaps: S.gaps });
  const saved = shared ? { fid: 'AAAAAAAAAA', cursor: 1000000, synced: { old: canonical(S.events[0]) }, meta } : {};
  const values = new Map([['babylog-sync-v1', JSON.stringify(saved)]]), timers = new Map();
  const snapshots = [], commits = [], notifications = [], observations = [];
  const app = { state: S, refresh() {}, applyRemote: f => f(S), toast() {} };
  const F = { Timestamp: { fromMillis: n => n }, serverTimestamp: () => 'SERVER',
    collection: (...args) => args.slice(1).join('/'), doc: (...args) => args.slice(1).join('/'),
    where: (...args) => args, orderBy: v => v, query: (...args) => args,
    onSnapshot(target, cb) { snapshots.push({ target, cb }); return () => {}; },
    writeBatch() { const writes = []; return { set: (ref, data) => writes.push({ ref, data }), update: (ref, data) => writes.push({ ref, data }),
      commit() { return new Promise((resolve, reject) => commits.push({ writes, resolve, reject })); } }; },
  };
  const context = { window: { BabyApp: app }, localStorage: { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) },
    A: {}, F, db: {}, auth: { currentUser: { uid: 'me' } }, crypto: globalThis.crypto,
    setTimeout(f) { const id = {}; timers.set(id, f); return id; }, clearTimeout: id => timers.delete(id),
    notifyModule: { notifyFamily: (...v) => notifications.push(v), observeFamily: (...v) => observations.push(v), retryPending() {} },
  };
  vm.runInNewContext(source.slice(source.indexOf("const LS = 'babylog-sync-v1'"))
    .replaceAll("import('./push-server/web-notify.js')", 'Promise.resolve(notifyModule)'), context);
  await tick();
  return { S, app, snapshots, commits, notifications, observations, usage: () => context.window.BabySync.usage(),
    async save() { context.window.BabySync.local(S); for (const [id, f] of [...timers]) { timers.delete(id); f(); } await tick(); } };
}
test('401 changed records notify once only after both batches succeed', async () => {
  const f = await fixture();
  for (let i = 0; i < 401; i++) f.S.events.push({ id: 'e' + i, type: 'diaper', start: i + 10 });
  await f.save(); assert.equal(f.commits.length, 2);
  f.commits[0].resolve(); await tick(); assert.equal(f.notifications.length, 0);
  f.commits[1].resolve(); await tick(); assert.equal(f.notifications.length, 1);
});
test('partial batch failure does not announce unsaved state', async () => {
  const f = await fixture();
  for (let i = 0; i < 401; i++) f.S.events.push({ id: 'e' + i, type: 'diaper', start: i + 10 });
  await f.save(); f.commits[0].resolve(); f.commits[1].reject({ code: 'unavailable' }); await tick();
  assert.equal(f.notifications.length, 0);
});
test('partner update invalidates widget comparison without uploading or sending', async () => {
  const f = await fixture();
  f.snapshots[0].cb({ metadata: { fromCache: false }, docChanges: () => [{ type: 'added', doc: { id: 'partner',
    metadata: { hasPendingWrites: false }, data: () => ({ id: 'partner', type: 'sleep', start: 20, end: null, by: 'them', u: { toMillis: () => 1000001 } }) } }] });
  await tick(); assert.equal(f.observations.length, 1); assert.equal(f.commits.length, 0); assert.equal(f.notifications.length, 0);
  assert.equal(f.S.events.find(e => e.id === 'partner').end, null);
});
test('old events stay local and deletion still uses the old tombstone contract', async () => {
  const f = await fixture(); f.S.events.push({ id: 'new', type: 'sleep', start: 100, end: null }); await f.save();
  assert.equal(f.S.events[0].id, 'old'); assert.equal(f.commits[0].writes[0].data.end, null);
  f.commits[0].resolve(); await tick(); f.S.events = f.S.events.filter(e => e.id !== 'old'); await f.save();
  assert.equal(f.commits[1].writes[0].data.del, true); assert.equal(f.commits[1].writes[0].data.id, 'old');
});
test('unshared save and UI refresh use no server paths', async () => {
  const f = await fixture(false); f.S.events.push({ id: 'local', start: 3, type: 'diaper' }); await f.save();
  for (let i = 0; i < 20; i++) f.app.refresh();
  assert.equal(f.snapshots.length, 0); assert.equal(f.commits.length, 0); assert.equal(f.notifications.length, 0);
});
test('usage counter: uploads count writes, server snapshots count reads, cache snapshots are free', async () => {
  const f = await fixture();
  f.snapshots[0].cb({ metadata: { fromCache: true }, docChanges: () => [] });
  f.snapshots[0].cb({ metadata: { fromCache: false }, docChanges: () => [] });
  f.S.events.push({ id: 'a', type: 'diaper', start: 5 }, { id: 'b', type: 'diaper', start: 6 }); await f.save();
  f.commits[0].resolve(); await tick();
  const u = f.usage();
  assert.equal(u.writes, 2);
  assert.equal(u.reads, 2 + 1); // 빈 첫 조회 1 + 규칙 확인 1, 올리기 규칙 확인 1
  assert.match(u.day, /^\d{4}-\d{2}-\d{2}$/);
});
