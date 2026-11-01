// 베타 테스터별 사용량: 가족 공유 없이도 테스터 번호로 저장, 가족 공유면 가족 표에도 그대로 저장
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const source = await readFile(new URL('../push-server/worker.js', import.meta.url), 'utf8');
const { default: worker, utcDay } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const dir = new URL('../push-server/migrations/', import.meta.url);
const migration = (await Promise.all(['0001_summaries.sql', '0002_usage.sql', '0006_usage_tester.sql'].map(f => readFile(new URL(f, dir), 'utf8')))).join('\n');

function fixture() {
  const sql = new DatabaseSync(':memory:'); sql.exec(migration);
  const env = { USAGE_FLUSH_MS: 0, KV: { async get() { return null; }, async put() {} }, DB: { prepare(q) { return { bind(...a) { return {
    async first() { return sql.prepare(q).get(...a) || null; },
    async run() { const r = sql.prepare(q).run(...a); return { success: true, meta: { changes: Number(r.changes) } }; },
    async all() { return { results: sql.prepare(q).all(...a) }; },
  }; } }; } } };
  const call = (path, body) => worker.fetch(new Request('https://t.invalid' + path, {
    method: body ? 'POST' : 'GET', headers: { Origin: 'https://leecornell0131-ux.github.io', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env);
  return { sql, call };
}
const day = utcDay();

test('가족 공유 없는 테스터도 번호로 저장', async () => {
  const { sql, call } = fixture();
  assert.equal((await call('/usage', { dev: 'abcdefgh12', day, reads: 0, writes: 0, tc: 7, ev: 12 })).status, 200);
  assert.equal((await call('/usage', { dev: 'abcdefgh12', day, reads: 0, writes: 0, tc: 7, ev: 9 })).status, 200);
  const r = sql.prepare('SELECT * FROM usage_tester').all();
  assert.equal(r.length, 1); assert.equal(r[0].ev, 12); assert.equal(r[0].fam, '');
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM usage_app').get().n, 0);
  const rep = await (await call('/testers')).json();
  assert.equal(rep.testers[0].tc, 7); assert.equal(rep.testers[0].days[0].ev, 12);
});

test('테스터 번호도 가족코드도 없으면 거절, 가족 공유 테스터는 두 표에 저장', async () => {
  const { sql, call } = fixture();
  assert.equal((await call('/usage', { dev: 'abcdefgh12', day, reads: 1, writes: 1 })).status, 400);
  assert.equal((await call('/usage', { dev: 'abcdefgh12', day, reads: 1, writes: 1, tc: 300 })).status, 400);
  assert.equal((await call('/usage', { fid: 'BBBBBBBBBB', dev: 'abcdefgh12', day, reads: 5, writes: 2, tc: 3, ev: 4 })).status, 200);
  assert.equal(sql.prepare('SELECT reads FROM usage_app').get().reads, 5);
  assert.equal(sql.prepare('SELECT fam FROM usage_tester').get().fam, 'BB');
  // 예전 휴대폰(테스터 아님)은 그대로
  assert.equal((await call('/usage', { fid: 'BBBBBBBBBB', dev: 'zzzzzzzz99', day, reads: 1, writes: 0 })).status, 200);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM usage_tester').get().n, 1);
});
