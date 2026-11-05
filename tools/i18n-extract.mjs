// 화면 문구 뽑기: 소스의 문자열 안에서 한국어 조각(태그·${}로 나뉜 부분)을 모아 i18n/keys.json으로 저장.
// 사용: node tools/i18n-extract.mjs  → 번역 사전(i18n/en.js 등)에 빠진 조각을 보여줌
import { readFileSync, writeFileSync } from 'node:fs';
const KO = /[가-힣]/;
export const NUM = /\d+(?:[.,:/~]\d+)*/g;
export const norm = s => s.replace(NUM, '#');
function lexStrings(src) { // JS 문자열·템플릿의 "글자 부분" 목록 (주석·정규식 건너뜀)
  const out = []; let i = 0, last = '';
  const readStr = q => { let s = ''; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') { s += src[i + 1]; i += 2; continue } s += src[i++] } i++; return s };
  const readTpl = () => { const parts = []; let s = ''; i++;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { s += src[i + 1]; i += 2; continue }
      if (src[i] === '$' && src[i + 1] === '{') { parts.push(s); s = ''; i += 2; let d = 1; const st = i;
        // 중첩 코드는 재귀로 문자열 뽑기
        while (i < src.length && d) { const c = src[i];
          if (c === '`') { const sub = readTpl(); out.push(...sub); continue }
          if (c === '"' || c === "'") { out.push([readStr(c)]); continue }
          if (c === '{') d++; else if (c === '}') d--; i++ }
        continue }
      s += src[i++] }
    parts.push(s); i++; return [parts] };
  while (i < src.length) { const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; continue }
    if (c === '/' && /[(,=:[!&|?{};+\n]/.test(last)) { i++; let cls = false; while (i < src.length) { const d = src[i]; if (d === '\\') { i += 2; continue } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; i++ } i++; last = 'x'; continue }
    if (c === '"' || c === "'") { out.push([readStr(c)]); last = 'x'; continue }
    if (c === '`') { out.push(...readTpl()); last = 'x'; continue }
    if (!/\s/.test(c)) last = c; i++ }
  return out;
}
function pieces(str) { // 태그 사이 글자 + 태그 안 속성값 (${}로 잘린 태그 조각도 처리)
  const res = [], attrs = t => t.replace(/(?:placeholder|aria-label|title|alt|value)="([^"]*)"/g, (_, v) => { res.push(v); return '' });
  const a = str.indexOf('>'), b = str.indexOf('<');
  if (a >= 0 && (b < 0 || a < b) && /"$|^\S*$/.test(str.slice(0, a))) { const head = str.slice(0, a); str = str.slice(a + 1);
    const q = head.indexOf('"'); if (q >= 0) res.push(head.slice(0, q)); attrs(head) }
  const lt = str.lastIndexOf('<');
  if (lt >= 0 && str.indexOf('>', lt) < 0) { const tail = str.slice(lt); str = str.slice(0, lt);
    const rest = attrs(tail), m = rest.match(/="([^"]*)$/); if (m) res.push(m[1]) }
  str.replace(/<[^>]*>/g, tag => { attrs(tag); return '\u0000' })
    .split('\u0000').forEach(p => res.push(p));
  return res.flatMap(p => p.split(/&[a-z]+;|\n/)).map(s => s.trim()).filter(s => KO.test(s));
}
export function extract(files) {
  const keys = new Map();
  for (const f of files) { let src = readFileSync(f, 'utf8');
    let js = src, html = '';
    if (f.endsWith('.html')) { js = ''; src.replace(/<script[^>]*>([\s\S]*?)<\/script>/g, (_, b) => { js += b + '\n'; return '' });
      html = src.replace(/<script[^>]*>[\s\S]*?<\/script>|<style[^>]*>[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '') }
    const add = s => { const k = norm(s); if (!keys.has(k)) keys.set(k, f) };
    lexStrings(js).forEach(parts => parts.forEach(p => pieces(p).forEach(add)));
    if (html) pieces(html).forEach(add);
  }
  return keys;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const files = ['index.html', 'import-format.js', 'sync.js', 'sleep_rules.js'];
  const keys = extract(files);
  writeFileSync('tools/i18n-keys.json', JSON.stringify([...keys.keys()], null, 0).replace(/","/g, '",\n"'));
  console.log(keys.size, 'keys');
}
