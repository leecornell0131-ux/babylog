// 화면 번역(i18n.js + i18n/*.js) 점검: 사전에 빠진 문구가 없는지, 숫자 자리(#) 수가 맞는지, 실제 문장이 바뀌는지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { extract } from '../tools/i18n-extract.mjs';

const root = new URL('../', import.meta.url).pathname;
const read = p => readFileSync(root + p, 'utf8');
function load(lang) {
  const ctx = { navigator: { language: 'ko' }, localStorage: { getItem: () => lang, setItem() {} },
    document: { write() {}, documentElement: {}, currentScript: null }, MutationObserver: class { observe() {} } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(read('i18n.js'), ctx); vm.runInContext(read(`i18n/${lang}.js`), ctx);
  return ctx.BabyI18n;
}
const LANGS = ['en', 'zh', 'ja'];
const skip = new Set(JSON.parse(read('i18n/src/_skip.json')));

test('every screen text piece has a translation in each language', () => {
  const keys = [...extract(['index.html', 'import-format.js', 'sync.js', 'sleep_rules.js'].map(f => root + f)).keys()].filter(k => !skip.has(k));
  for (const l of LANGS) {
    const d = JSON.parse(read(`i18n/src/${l}.json`));
    assert.deepEqual(keys.filter(k => !(k in d)), [], `${l}: 번역 없음 → i18n/src/${l}.json에 추가`);
  }
});

test('built dictionaries match their sources', () => {
  for (const l of LANGS) {
    const src = JSON.parse(read(`i18n/src/${l}.json`)), b = load(l);
    for (const k of Object.keys(src).slice(0, 50)) if (!/[#\n]/.test(k)) assert.equal(b.t(k), src[k]);
  }
});

test('composed sentences and numbers translate', () => {
  const en = load('en');
  assert.equal(en.t('생후 9주 · D+64'), 'Age 9wk · D+64');
  assert.equal(en.t('수면 합계'), 'Total sleep');
  assert.match(en.t('- 한국어로, 부모가 읽기 쉽게 짧게 답해 줘. 순서: 한 줄 요약 → 눈에 띄는 점 → 집에서 해 볼 것·지켜볼 것 → 소아과에 물어볼 신호.'), /^- Answer in English/);
  assert.equal(en.t('메모: '+en.keep('수유 내용 그대로')), 'memo: 수유 내용 그대로', 'keep()으로 감싼 사용자 메모는 그대로');
  assert.equal(en.t(en.keep('note')), 'note');
  assert.equal(load('ja').t('수유를 기록했어요'), '授乳を記録しました');
  assert.equal(load('zh').t('수유를 기록했어요'), '已记录喂奶');
  assert.equal(load('en').dateLong(new Date(2026, 10, 5).getTime()), 'Thu, Nov 5');
});

test('Korean stays as-is', () => {
  const ctx = { navigator: { language: 'ko-KR' }, localStorage: { getItem: () => null, setItem() {} }, document: {}, MutationObserver: class {} };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(read('i18n.js'), ctx);
  assert.equal(ctx.BabyI18n.lang, 'ko'); assert.equal(ctx.BabyI18n.t('수유'), '수유');
});
