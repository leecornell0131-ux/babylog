// i18n/src/<언어>.json(사전 원본) → i18n/<언어>.js (앱이 읽는 파일). 사용: node tools/i18n-build.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
for (const f of readdirSync('i18n/src').filter(f => f.endsWith('.json') && !f.startsWith('_'))) {
  const lang = f.replace('.json', ''), d = JSON.parse(readFileSync('i18n/src/' + f, 'utf8'));
  writeFileSync(`i18n/${lang}.js`, `// 자동 생성 파일: i18n/src/${f}을 고치고 node tools/i18n-build.mjs\nBabyI18n.load(${JSON.stringify(lang)},${JSON.stringify(d, null, 0).replace(/","/g, '",\n"')});\n`);
  console.log(lang, Object.keys(d).length);
}
