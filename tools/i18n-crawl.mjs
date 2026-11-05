// 번역 빠진 문구 찾기: 예시 데이터로 앱을 열고 탭·버튼을 차례로 눌러 보며 사전에 없는 한국어를 모음
// 사용: (저장소 폴더에서 python3 -m http.server 8765 를 켠 뒤) node tools/i18n-crawl.mjs en [출력파일] [깊이 1|2]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { writeFileSync } from 'node:fs';
const lang = process.argv[2] || 'en', out = process.argv[3] || `i18n-miss-${lang}.txt`, depth = +(process.argv[4] || 2);
const URL = 'http://localhost:8765/index.html';
const SKIP = /famLeave|wipe|reset|sample|devOff|backup|journal|import|share/i;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const miss = new Set(), seen = new Set();
let state = null;
async function fresh(tab) {
  const p = await ctx.newPage();
  await p.addInitScript(([l, st]) => { localStorage.setItem('babylog-v1-lang', l); if (st) localStorage.setItem('babylog-v1', st); localStorage.setItem('babylog-v1-dev', '1') }, [lang, state]);
  await p.goto(URL); await p.waitForTimeout(120);
  if (tab) { await p.click(`#tabs [data-tab="${tab}"]`); await p.waitForTimeout(60) }
  return p;
}
async function grab(p) { try { (await p.evaluate(() => [...BabyI18n.miss])).forEach(m => miss.add(m)) } catch (_) {} }
async function list(p) { return p.$$eval('button', bs => bs.map((b, i) => [i, b.offsetParent !== null || !!b.closest('#sheetRoot'), (b.dataset.act || b.dataset.tab || '') + '|' + b.textContent.trim().slice(0, 30)]).filter(x => x[1]).map(x => [x[0], x[2]])) }
async function clickAt(p, i) { const x = await p.$$('button'); if (x[i]) await x[i].click({ timeout: 800 }); await p.waitForTimeout(120) }
const p0 = await fresh(); await grab(p0);
await p0.click('[data-act="sample"]'); await p0.waitForTimeout(200);
state = await p0.evaluate(() => localStorage.getItem('babylog-v1')); await grab(p0); await p0.close();
for (const tab of ['today', 'week', 'growth', 'export', 'settings']) {
  let p = await fresh(tab); await grab(p);
  const bs = await list(p); await p.close();
  for (const [i, label] of bs) {
    if (SKIP.test(label)) continue;
    const key = tab + '/' + label; if (seen.has(key)) continue; seen.add(key);
    p = await fresh(tab);
    try { await clickAt(p, i); await grab(p);
      if (depth > 1) { const before = new Set(bs.map(b => b[1]));
        const inner = (await list(p)).filter(([j, l]) => !before.has(l)).slice(0, 30);
        for (const [j, l2] of inner) { const k2 = key + '>' + l2; if (seen.has(k2) || SKIP.test(l2)) continue; seen.add(k2);
          const q = await fresh(tab);
          try { await clickAt(q, i); await clickAt(q, j); await grab(q) } catch (_) {}
          await q.close() } }
    } catch (_) {}
    await p.close();
  }
  console.error(tab, 'done', miss.size);
}
writeFileSync(out, [...miss].sort().join('\n'));
console.log(miss.size, 'missing →', out);
await browser.close();
