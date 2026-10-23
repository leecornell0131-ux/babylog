// 매일 사용량 점검 (GitHub Actions usage-check.yml이 실행). 알림 서버 /usage를 읽어 한도 대비 %를 계산하고,
// 50%(지켜보기) 이상이면 usage-alert.md를 만들어 워크플로가 GitHub 이슈로 올림 → 저장소 주인에게 이메일이 감.
// FCM_SA(Firebase 서비스 계정 키)가 있으면 Firebase가 직접 센 실제 읽기·쓰기(최근 24시간)도 함께 봄. 권한이 없으면 건너뜀.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';
import { level, percents, worst, capacity } from './usage-levels.js';

const cfg = JSON.parse(await readFile(new URL('../android-app/push-config.json', import.meta.url), 'utf8'));
const r = await fetch(cfg.worker.replace(/\/$/, '') + '/usage?days=3', { cache: 'no-store' }).catch(e => ({ ok: false, status: e.message }));
// 서버를 못 읽는 것 자체도 알림 (배포가 안 됐거나 D1 한도 초과일 수 있음)
if (!r.ok) { console.log('::warning::사용량을 못 읽었어요: ' + r.status); process.exit(1); }
const data = await r.json(), L = data.limits;
const dayOf = i => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
const get = k => data.days.find(d => d.day === k) || { day: k, req: 0, reads: 0, writes: 0, families: 0, sharedFamilies: 0, top: [] };
const today = get(dayOf(0)), yday = get(dayOf(1));
const n = v => Math.round(v).toLocaleString('ko-KR');

async function firebaseActual() {
  if (!process.env.FCM_SA) return null;
  try {
    const sa = JSON.parse(process.env.FCM_SA), now = Math.floor(Date.now() / 1000);
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/monitoring.read', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
    const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
    const tok = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + unsigned + '.' + sig }).then(x => x.json());
    if (!tok.access_token) return null;
    const sum = async metric => {
      const q = new URLSearchParams({ filter: `metric.type="firestore.googleapis.com/document/${metric}"`,
        'interval.startTime': new Date(Date.now() - 864e5).toISOString(), 'interval.endTime': new Date().toISOString(),
        'aggregation.alignmentPeriod': '86400s', 'aggregation.perSeriesAligner': 'ALIGN_SUM', 'aggregation.crossSeriesReducer': 'REDUCE_SUM' });
      const j = await fetch(`https://monitoring.googleapis.com/v3/projects/${sa.project_id}/timeSeries?` + q, { headers: { Authorization: 'Bearer ' + tok.access_token } }).then(x => x.json());
      if (j.error) throw new Error(j.error.message);
      return (j.timeSeries || []).reduce((s, t) => s + (t.points || []).reduce((a, p) => a + Number(p.value.int64Value || 0), 0), 0);
    };
    return { reads: await sum('read_count'), writes: await sum('write_count') };
  } catch (e) { console.log('Firebase 실제값 건너뜀: ' + e.message); return null; }
}

const real = await firebaseActual();
const lines = [];
const row = (label, d) => {
  const p = percents(d, L), lv = level(worst(p));
  lines.push(`| ${label} ${d.day} | ${n(d.reads)} (${Math.round(p.reads)}%) | ${n(d.writes)} (${Math.round(p.writes)}%) | ${n(d.req)} (${Math.round(p.req)}%) | ${d.sharedFamilies || 0} | **${lv.name}** |`);
  return { p, lv };
};
lines.push('| 하루 | Firebase 읽기 | Firebase 쓰기 | 알림 서버 요청 | 공유 가족 | 단계 |', '|---|---|---|---|---|---|');
const y = row('어제(마감)', yday), t = row('오늘(진행 중)', today);
if (real) {
  const rr = real.reads / L.fsReads * 100, rw = real.writes / L.fsWrites * 100;
  lines.push('', `Firebase가 직접 센 최근 24시간: 읽기 **${n(real.reads)}** (${Math.round(rr)}%) · 쓰기 **${n(real.writes)}** (${Math.round(rw)}%)`);
  real.level = level(Math.max(rr, rw));
}
const cap = capacity(yday.families ? yday : today, L);
if (cap) lines.push('', `지금 방식이면 **약 ${n(cap.safe)}가족**까지(여유 20%), 먼저 막히는 곳: ${cap.bottleneck}. 가족당 하루 읽기 ${n(cap.per.reads)} · 쓰기 ${n(cap.per.writes)} · 요청 ${n(cap.per.req)}.`);
const worstLv = [y.lv, t.lv, real && real.level].filter(Boolean).reduce((a, b) => (b.min > a.min ? b : a));
lines.push('', `**지금 단계: ${worstLv.name}** — ${worstLv.act}`, '', '대시보드: https://leecornell0131-ux.github.io/babylog/usage.html');
const body = lines.join('\n');
console.log(body);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, body + '\n');
if (worstLv.min >= 50) await writeFile('usage-alert.md', body + '\n\n대응 방법: 프로젝트 파일 guide/사용량_넘칠때_대응.md의 "' + worstLv.name + '" 단계를 보세요.\n');
