// 사용량 점검 (GitHub Actions usage-check.yml이 매시간 실행).
// 1) Cloudflare·Firebase가 직접 센 하루 합계(UTC 날짜)를 읽어 알림 서버 DB(D1 usage_actual)에 넣음 → 대시보드가 이 숫자를 씀
// 2) 알림 서버 /usage로 한도 대비 %를 계산하고, ALERT=1(아침·저녁 점검)일 때 50%(지켜보기) 이상이면 usage-alert.md를 만들어
//    워크플로가 GitHub 이슈로 올림 → 저장소 주인에게 이메일이 감.
// 필요한 값: CLOUDFLARE_API_TOKEN·CLOUDFLARE_ACCOUNT_ID(요청 수 읽기·D1 쓰기), FCM_SA(Firebase 서비스 계정, 모니터링 뷰어 역할 필요),
// CODEMAGIC_API_TOKEN(이번 달 빌드 시간).
// 하나라도 없거나 권한이 없으면 그 부분만 건너뜀.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';
import { level, percents, worst, capacity } from './usage-levels.js';

const dayOf = i => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
const n = v => Math.round(v).toLocaleString('ko-KR');
const { CLOUDFLARE_API_TOKEN: cfToken, CLOUDFLARE_ACCOUNT_ID: cfAccount } = process.env;
const cfApi = (path, body) => fetch('https://api.cloudflare.com/client/v4' + path, {
  method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + cfToken, 'Content-Type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
}).then(x => x.json());

// Cloudflare가 센 Workers 요청 수 (한도 판정 기준과 같은 숫자). 토큰에 Account Analytics 읽기 권한이 있어야 함.
async function cloudflareReq(day) {
  if (!cfToken || !cfAccount) return null;
  try {
    const query = `query($a: String!, $d: Date!) { viewer { accounts(filter: {accountTag: $a}) {
      workersInvocationsAdaptive(limit: 100, filter: {date: $d}) { sum { requests } } } } }`;
    const j = await cfApi('/graphql', { query, variables: { a: cfAccount, d: day } });
    if (j.errors && j.errors.length) throw new Error(j.errors[0].message);
    return j.data.viewer.accounts[0].workersInvocationsAdaptive.reduce((s, r) => s + r.sum.requests, 0);
  } catch (e) { console.log('Cloudflare 실제값 건너뜀: ' + e.message); return null; }
}

// Firebase가 센 Firestore 읽기·쓰기 (그 UTC 날짜 0시~지금). 서비스 계정에 '모니터링 뷰어' 역할이 있어야 함.
let gToken;
async function firebaseCounts(day) {
  if (!process.env.FCM_SA) return null;
  try {
    const sa = JSON.parse(process.env.FCM_SA), now = Math.floor(Date.now() / 1000);
    if (!gToken) {
      const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
      const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/monitoring.read', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
      const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
      const tok = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + unsigned + '.' + sig }).then(x => x.json());
      if (!tok.access_token) throw new Error('토큰 발급 실패');
      gToken = tok.access_token;
    }
    const start = Date.parse(day + 'T00:00:00Z'), end = Math.min(Date.now(), start + 864e5);
    const sum = async metric => {
      const q = new URLSearchParams({ filter: `metric.type="firestore.googleapis.com/document/${metric}"`,
        'interval.startTime': new Date(start).toISOString(), 'interval.endTime': new Date(end).toISOString(),
        'aggregation.alignmentPeriod': Math.max(60, Math.round((end - start) / 1000)) + 's', 'aggregation.perSeriesAligner': 'ALIGN_SUM', 'aggregation.crossSeriesReducer': 'REDUCE_SUM' });
      const j = await fetch(`https://monitoring.googleapis.com/v3/projects/${sa.project_id}/timeSeries?` + q, { headers: { Authorization: 'Bearer ' + gToken } }).then(x => x.json());
      if (j.error) throw new Error(j.error.message);
      return (j.timeSeries || []).reduce((s, t) => s + (t.points || []).reduce((a, p) => a + Number(p.value.int64Value || 0), 0), 0);
    };
    return { reads: await sum('read_count'), writes: await sum('write_count') };
  } catch (e) { console.log('Firebase 실제값 건너뜀: ' + e.message + ' (서비스 계정에 모니터링 뷰어 역할이 필요해요)'); return null; }
}

// 알림 서버 DB에 직접 집계 저장 (Cloudflare D1 HTTP API, 배포에 쓰는 토큰 그대로)
async function saveActual(day, req, fs) {
  if (!cfToken || !cfAccount || (req == null && !fs)) return;
  try {
    const list = await cfApi(`/accounts/${cfAccount}/d1/database?name=babylog-widget-summaries`);
    const db = (list.result || []).find(d => d.name === 'babylog-widget-summaries');
    if (!db) throw new Error('D1을 못 찾음');
    const r = await cfApi(`/accounts/${cfAccount}/d1/database/${db.uuid}/query`, {
      // est_req = 이 순간 서버가 센 요청 수. 오늘 숫자를 '직접 집계 + 그 뒤로 더 센 만큼'으로 이어 붙일 때 씀.
      sql: `INSERT INTO usage_actual (day, cf_req, fs_reads, fs_writes, at, est_req)
        VALUES (?1, ?2, ?3, ?4, ?5, (SELECT SUM(req) FROM usage_req WHERE day = ?1))
        ON CONFLICT(day) DO UPDATE SET cf_req = COALESCE(excluded.cf_req, cf_req), fs_reads = COALESCE(excluded.fs_reads, fs_reads),
        fs_writes = COALESCE(excluded.fs_writes, fs_writes), at = excluded.at,
        est_req = CASE WHEN excluded.cf_req IS NULL THEN est_req ELSE excluded.est_req END`,
      params: [day, req, fs ? fs.reads : null, fs ? fs.writes : null, Date.now()],
    });
    if (!r.success) throw new Error(JSON.stringify(r.errors).slice(0, 200));
  } catch (e) { console.log('직접 집계 저장 실패: ' + e.message); }
}

for (const day of [dayOf(1), dayOf(0)]) {
  const req = await cloudflareReq(day), fs = await firebaseCounts(day);
  console.log(`${day} 직접 집계: Cloudflare 요청 ${req ?? '-'} · Firebase 읽기 ${fs ? fs.reads : '-'} · 쓰기 ${fs ? fs.writes : '-'}`);
  await saveActual(day, req, fs);
}

// Codemagic 이번 달 빌드 시간 (무료 개인 계정 월 500분, mac_mini_m2). 저장소 Secret CODEMAGIC_API_TOKEN이 있어야 함.
async function codemagicMonth() {
  const token = process.env.CODEMAGIC_API_TOKEN;
  if (!token) { console.log('Codemagic 건너뜀: CODEMAGIC_API_TOKEN 없음'); return null; }
  try {
    const month = new Date().toISOString().slice(0, 7), from = Date.parse(month + '-01T00:00:00Z');
    let seconds = 0, count = 0, skip = 0;
    for (let page = 0; page < 20; page++) {
      const j = await fetch(`https://api.codemagic.io/builds?skip=${skip}`, { headers: { 'x-auth-token': token } }).then(x => x.json());
      const builds = j.builds || [];
      if (!builds.length) break;
      let older = false;
      for (const b of builds) {
        const st = Date.parse(b.startedAt || b.createdAt || 0);
        if (st < from) { older = true; continue; }
        if (!b.startedAt) continue;
        // Codemagic 결제 화면은 빌드 시간(초)을 다 더한 뒤 분 단위로 내림해서 보여 줌 (10/28 콘솔 133분과 대조)
        const end = Date.parse(b.finishedAt || new Date().toISOString());
        seconds += Math.max(0, end - st) / 1e3; count++;
      }
      if (older) break;
      skip += builds.length;
    }
    return { month, minutes: Math.floor(seconds / 60), count };
  } catch (e) { console.log('Codemagic 건너뜀: ' + e.message); return null; }
}
async function saveMonthly(m) {
  if (!m || !cfToken || !cfAccount) return;
  try {
    const list = await cfApi(`/accounts/${cfAccount}/d1/database?name=babylog-widget-summaries`);
    const db = (list.result || []).find(d => d.name === 'babylog-widget-summaries');
    const r = await cfApi(`/accounts/${cfAccount}/d1/database/${db.uuid}/query`, {
      sql: `INSERT INTO usage_monthly (month, kind, used, count, at) VALUES (?1, 'codemagic', ?2, ?3, ?4)
        ON CONFLICT(month, kind) DO UPDATE SET used = excluded.used, count = excluded.count, at = excluded.at`,
      params: [m.month, m.minutes, m.count, Date.now()],
    });
    if (!r.success) throw new Error(JSON.stringify(r.errors).slice(0, 200));
  } catch (e) { console.log('Codemagic 저장 실패: ' + e.message); }
}
const cm = await codemagicMonth();
if (cm) console.log(`${cm.month} Codemagic 빌드 ${cm.count}번 · ${cm.minutes}분`);
await saveMonthly(cm);

const cfg = JSON.parse(await readFile(new URL('../android-app/push-config.json', import.meta.url), 'utf8'));
const r = await fetch(cfg.worker.replace(/\/$/, '') + '/usage?days=3', { cache: 'no-store' }).catch(e => ({ ok: false, status: e.message }));
// 서버를 못 읽는 것 자체도 알림 (배포가 안 됐거나 D1 한도 초과일 수 있음)
if (!r.ok) { console.log('::warning::사용량을 못 읽었어요: ' + r.status); process.exit(1); }
const data = await r.json(), L = data.limits;
const get = k => data.days.find(d => d.day === k) || { day: k, req: 0, reads: 0, writes: 0, families: 0, sharedFamilies: 0, top: [] };
const today = get(dayOf(0)), yday = get(dayOf(1));

const lines = ['| 하루 | Firebase 읽기 | Firebase 쓰기 | 알림 서버 요청 | 공유 가족 | 단계 |', '|---|---|---|---|---|---|'];
const row = (label, d) => {
  const p = percents(d, L), lv = level(worst(p));
  lines.push(`| ${label} ${d.day} | ${n(d.reads)} (${Math.round(p.reads)}%) | ${n(d.writes)} (${Math.round(p.writes)}%) | ${n(d.req)} (${Math.round(p.req)}%) | ${d.sharedFamilies || 0} | **${lv.name}** |`);
  return lv;
};
const lvs = [row('어제(마감)', yday), row('오늘(진행 중)', today)];
const src = d => (d.actual ? `직접 집계(${['req', 'reads', 'writes'].filter(k => d.actual[k] != null).map(k => ({ req: '요청', reads: '읽기', writes: '쓰기' })[k]).join('·') || '없음'})` : '자체 집계×보정');
lines.push('', `숫자 출처: 어제 ${src(yday)}, 오늘 ${src(today)}. 보정 비율 읽기 ${data.calib ? data.calib.reads.toFixed(2) : '-'}배 · 쓰기 ${data.calib ? data.calib.writes.toFixed(2) : '-'}배 · 요청 ${data.calib ? data.calib.req.toFixed(2) : '-'}배.`);
const cap = capacity(yday.families ? yday : today, L);
if (cap) lines.push('', `지금 방식이면 **약 ${n(cap.safe)}가족**까지(여유 20%), 먼저 막히는 곳: ${cap.bottleneck}. 가족당 하루 읽기 ${n(cap.per.reads)} · 쓰기 ${n(cap.per.writes)} · 요청 ${n(cap.per.req)}.`);
if (cm) {
  const p = cm.minutes / L.codemagicMinutes * 100;
  lvs.push(level(p));
  lines.push('', `Codemagic 이번 달 빌드 ${cm.count}번 · **${n(cm.minutes)}분** / ${n(L.codemagicMinutes)}분 (${Math.round(p)}%)`);
}
const worstLv = lvs.reduce((a, b) => (b.min > a.min ? b : a));
lines.push('', `**지금 단계: ${worstLv.name}** — ${worstLv.act}`, '', '대시보드: https://leecornell0131-ux.github.io/babylog/usage.html');
const body = lines.join('\n');
console.log(body);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, body + '\n');
if (process.env.ALERT === 'true' && worstLv.min >= 50) await writeFile('usage-alert.md', body + '\n\n대응 방법: 프로젝트 파일 guide/사용량_넘칠때_대응.md의 "' + worstLv.name + '" 단계를 보세요.\n');
