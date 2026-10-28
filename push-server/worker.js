// 아기로그 알림 서버 (Cloudflare Workers 무료 요금제, 카드 등록 없음)
// 한 휴대폰에서 기록하면 웹앱이 /notify로 요약을 보내고, 이 서버가 같은 가족의 갤럭시 앱에 FCM 푸시를 보내
// 홈 화면 위젯과 잠금화면 타이머를 몇 초 안에 바꿈. 기록 자체는 다루지 않고 위젯용 요약(시각 몇 개)만 받음.
//
// 저장: KV t:<가족코드> = 푸시 주소 목록. DB(D1) summaries = 마지막 요약, usage_req·usage_app = 가족별 하루 사용량(숫자만), usage_tester = 베타 테스터 번호별 하루 사용량(숫자만).
// DB 바인딩 없는 기존 배포는 KV s:<가족코드> 유지. D1 전환 시 옛 요약을 지우지 않고 이관.
// 보안: 가족코드(10자리 무작위)를 아는 사람만 쓸 수 있음. Firestore 규칙과 같은 기준.
//
// 비밀값(wrangler secret): FCM_SA = Firebase 서비스 계정 키 JSON 전체

const FID = /^[A-HJ-NP-Z2-9]{10}$/;
const NUM_KEYS = ['lastFeed', 'sleep', 'feed', 'at', 'feedGap', 'lastWake', 'lastDiaper', 'day', 'tFeeds', 'tMl', 'tPee', 'tPoo', 'tSleep'];
const STR_KEYS = ['lastFeedText', 'feedLabel', 'name', 'lastDiaperText', 'lastFeedAmt', 'lastFeedSub', 'birth', 'sleeps'];
const MAX_TOKENS = 10;
const DEV = /^[a-z0-9]{8,16}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEEP_DAYS = 60;
// 무료 한도 (공식 문서 기준). 대시보드·매일 점검이 이 값으로 몇 %인지 계산.
export const LIMITS = { fsReads: 50000, fsWrites: 20000, cfRequests: 100000 };

export default {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(req);
    const url = new URL(req.url);
    // 요청 수 세기. POST는 본문의 가족코드로 셈. 저장은 모아서 가끔 함(세기가 실패해도 위젯 기능엔 영향 없음).
    if (req.method !== 'POST') count(url.searchParams.get('fid'));
    const res = await handle(req, env, url, cors);
    const flush = flushCounts(env);
    if (ctx && ctx.waitUntil) ctx.waitUntil(flush); else await flush;
    return res;
  },
};

async function handle(req, env, url, cors) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  try {
    if (req.method === 'GET' && url.pathname === '/') return json({ ok: true, app: 'babylog-push', summaryStorage: env.DB ? 'd1' : 'kv' }, 200, cors);

    // 구버전 갤럭시의 15분 조회 API도 그대로 유지.
    if (req.method === 'GET' && url.pathname === '/summary') {
      const fid = url.searchParams.get('fid') || '';
      if (!FID.test(fid)) return json({ error: 'fid' }, 400, cors);
      const s = await readSummary(env, fid);
      return json({ summary: s }, 200, cors);
    }

    // 대시보드용. 가족코드는 앞 2자리만 보여 줌(코드 전체를 알아야 기록에 접근 가능).
    if (req.method === 'GET' && url.pathname === '/usage') {
      if (!env.DB) return json({ error: 'no db' }, 503, cors);
      return json(await usageReport(env, Math.min(31, Math.max(1, +url.searchParams.get('days') || 14)), url.searchParams.get('fid') || ''), 200, cors);
    }

    // 베타 테스터별 사용량 (운영자 화면 testers.html). 테스터 번호와 숫자뿐, 가족코드는 공유 여부만 알려 줌.
    if (req.method === 'GET' && url.pathname === '/testers') {
      if (!env.DB) return json({ error: 'no db' }, 503, cors);
      return json(await testerReport(env, Math.min(60, Math.max(1, +url.searchParams.get('days') || 28))), 200, cors);
    }

    if (req.method !== 'POST') return json({ error: 'method' }, 405, cors);
    const body = await req.json().catch(() => null);
    count(body && body.fid);
    if (body && url.pathname === '/usage') return postUsage(env, body, cors);
    if (!body || !FID.test(body.fid || '')) return json({ error: 'fid' }, 400, cors);
    const fid = body.fid;

    if (url.pathname === '/register') {
      const token = cleanToken(body.token);
      if (!token) return json({ error: 'token' }, 400, cors);
      const list = (await env.KV.get('t:' + fid, 'json')) || [];
      if (!list.includes(token)) {
        list.push(token);
        await env.KV.put('t:' + fid, JSON.stringify(list.slice(-MAX_TOKENS)));
      }
      return json({ ok: true }, 200, cors);
    }

    if (url.pathname === '/unregister') {
      const token = cleanToken(body.token);
      const list = (await env.KV.get('t:' + fid, 'json')) || [];
      if (token && list.includes(token)) await env.KV.put('t:' + fid, JSON.stringify(list.filter(t => t !== token)));
      return json({ ok: true }, 200, cors);
    }

    if (url.pathname === '/notify') {
      const summary = cleanSummary(body.summary);
      if (!summary) return json({ error: 'summary' }, 400, cors);
      const prev = await readSummary(env, fid);
      // 순서가 뒤바뀌어 도착한 오래된 요약은 버림
      if (prev && prev.at > summary.at) return json({ ok: true, stale: true }, 200, cors);
      // 읽은 직후 더 최신 요청이 들어와도 SQL 조건으로 역순 덮어쓰기를 막음.
      if (!await writeSummary(env, fid, summary)) return json({ ok: true, stale: true }, 200, cors);
      const except = cleanToken(body.except);
      const list = ((await env.KV.get('t:' + fid, 'json')) || []).filter(t => t !== except);
      if (!list.length) return json({ ok: true, sent: 0 }, 200, cors);
      const res = await sendAll(env, list, fid, summary);
      if (res.dead.length) {
        const all = (await env.KV.get('t:' + fid, 'json')) || [];
        await env.KV.put('t:' + fid, JSON.stringify(all.filter(t => !res.dead.includes(t))));
      }
      // 실패를 성공으로 응답하면 웹 전송 큐가 재시도를 포기하므로 일시 실패를 구분.
      if (res.failed) return json({ ok: false, error: 'push unavailable', sent: res.sent }, 503, cors);
      return json({ ok: true, sent: res.sent }, 200, cors);
    }

    return json({ error: 'not found' }, 404, cors);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500, cors);
  }
}

// ---------- 사용량 ----------
// 요청마다 D1에 쓰면 D1 무료 쓰기(하루 10만 행)를 요청 수만큼 써 버림 → 이 서버 인스턴스 안에서 최대 20초 모았다가 가족별 한 줄씩 저장.
// 응답 뒤에도 저장이 끝날 때까지 인스턴스를 붙잡아 둠(waitUntil, 최대 30초 허용). 예전처럼 10분씩 모으면 그사이 인스턴스가
// 내려가 숫자를 잃어 Cloudflare 대시보드보다 40%쯤 적게 나왔음(10/25 확인).
const pend = new Map();
let lastFlush = 0, waiting = null;
export const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
function count(fid) {
  const k = FID.test(fid || '') ? fid : '-';
  pend.set(k, (pend.get(k) || 0) + 1);
}
function flushCounts(env) { // USAGE_FLUSH_MS는 시험용
  if (!env.DB || !pend.size) return Promise.resolve();
  const every = env.USAGE_FLUSH_MS ?? 20e3, left = lastFlush + every - Date.now();
  if (left <= 0) return writeCounts(env);
  // 곧 저장할 예정이 이미 있으면 그걸 같이 기다림 (이 요청 숫자도 그때 함께 저장됨)
  if (!waiting) waiting = new Promise(r => setTimeout(r, left)).then(() => { waiting = null; return writeCounts(env); });
  return waiting;
}
async function writeCounts(env) {
  if (!pend.size) return;
  lastFlush = Date.now();
  const day = utcDay(lastFlush), rows = [...pend]; pend.clear();
  try {
    const st = env.DB.prepare(`INSERT INTO usage_req (day, fid, req) VALUES (?1, ?2, ?3)
      ON CONFLICT(day, fid) DO UPDATE SET req = req + excluded.req`);
    const stmts = rows.map(([fid, n]) => st.bind(day, fid, n));
    if (env.DB.batch) await env.DB.batch(stmts); else for (const x of stmts) await x.run();
  } catch (_) {
    // 표가 아직 없거나 D1이 잠시 실패: 다음 저장 때 다시 시도 (한 인스턴스 안에서 가족 수만큼만 쌓임)
    for (const [fid, n] of rows) pend.set(fid, (pend.get(fid) || 0) + n);
  }
}
// 휴대폰이 센 하루 사용량. 가족 공유 휴대폰은 가족코드와 함께(usage_app),
// 베타 테스터 코드를 넣은 휴대폰은 테스터 번호(tc)와 그날 남긴 기록 개수(ev)도 함께(usage_tester, 가족 공유 안 해도 보냄).
async function postUsage(env, body, cors) {
  const fid = String(body.fid || ''), shared = FID.test(fid), tc = Math.round(+body.tc);
  const isTester = Number.isInteger(tc) && tc >= 1 && tc <= 99;
  if (!shared && !(isTester && !body.fid)) return json({ error: 'fid' }, 400, cors);
  if (!env.DB) return json({ ok: true, stored: false }, 200, cors);
  const day = String(body.day || ''), dev = String(body.dev || '');
  const reads = Math.round(+body.reads), writes = Math.round(+body.writes), ev = Math.round(+(body.ev || 0));
  const ok = n => Number.isFinite(n) && n >= 0 && n < 1e7;
  // 이틀 넘게 지난 날짜나 미래 날짜는 받지 않음 (휴대폰 시계가 틀린 경우)
  const age = (Date.parse(utcDay()) - Date.parse(day)) / 864e5;
  if (!DAY.test(day) || !DEV.test(dev) || !ok(reads) || !ok(writes) || !ok(ev) || !(age >= 0 && age <= 2)) return json({ error: 'usage' }, 400, cors);
  // 같은 날 여러 번 보내면 누적값이라 큰 값만 남김
  if (shared) await env.DB.prepare(`INSERT INTO usage_app (day, fid, dev, reads, writes, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(day, fid, dev) DO UPDATE SET reads = MAX(reads, excluded.reads), writes = MAX(writes, excluded.writes), at = excluded.at`)
    .bind(day, fid, dev, reads, writes, Date.now()).run();
  if (isTester) await env.DB.prepare(`INSERT INTO usage_tester (day, tc, dev, fam, ev, reads, writes, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT(day, tc, dev) DO UPDATE SET fam = excluded.fam, ev = MAX(ev, excluded.ev), reads = MAX(reads, excluded.reads), writes = MAX(writes, excluded.writes), at = excluded.at`)
    .bind(day, tc, dev, shared ? fid.slice(0, 2) : '', ev, reads, writes, Date.now()).run().catch(() => null);
  if (Math.random() < 0.02) await prune(env);
  return json({ ok: true }, 200, cors);
}
// 테스터 번호별: 쓴 날짜 목록(날짜마다 기록 개수·읽기·쓰기), 휴대폰 수, 마지막으로 보낸 시각, 가족 공유(가족코드 앞 2자리)
export async function testerReport(env, days) {
  const from = utcDay(Date.now() - (days - 1) * 864e5);
  let rows = [];
  try { rows = (await env.DB.prepare('SELECT day, tc, dev, fam, ev, reads, writes, at FROM usage_tester WHERE day >= ?1').bind(from).all()).results || []; } catch (_) {}
  const by = {};
  for (const r of rows) {
    const t = by[r.tc] || (by[r.tc] = { tc: r.tc, devs: new Set(), fam: '', last: 0, days: {} });
    t.devs.add(r.dev); if (r.fam) t.fam = r.fam; t.last = Math.max(t.last, r.at);
    const d = t.days[r.day] || (t.days[r.day] = { day: r.day, ev: 0, reads: 0, writes: 0 });
    d.ev += r.ev; d.reads += r.reads; d.writes += r.writes;
  }
  const testers = Object.values(by).sort((a, b) => a.tc - b.tc).map(t => ({
    tc: t.tc, devs: t.devs.size, fam: t.fam, last: t.last,
    days: Object.values(t.days).sort((a, b) => (a.day < b.day ? 1 : -1)),
  }));
  return { now: Date.now(), today: utcDay(), from, testers };
}
async function prune(env) {
  const old = utcDay(Date.now() - KEEP_DAYS * 864e5);
  try {
    await env.DB.prepare('DELETE FROM usage_req WHERE day < ?1').bind(old).run();
    await env.DB.prepare('DELETE FROM usage_app WHERE day < ?1').bind(old).run();
    await env.DB.prepare('DELETE FROM usage_tester WHERE day < ?1').bind(old).run();
  } catch (_) {}
}
// 날짜별 합계 + 날짜별 가족 목록(가족코드는 앞 2자리만). fid를 주면 그 가족 줄에 me 표시.
export async function usageReport(env, days, myFid) {
  const from = utcDay(Date.now() - (days - 1) * 864e5);
  const [req, app] = await Promise.all([
    env.DB.prepare('SELECT day, fid, req FROM usage_req WHERE day >= ?1').bind(from).all(),
    env.DB.prepare('SELECT day, fid, COUNT(*) AS devs, SUM(reads) AS reads, SUM(writes) AS writes FROM usage_app WHERE day >= ?1 GROUP BY day, fid').bind(from).all(),
  ]);
  const byDay = {};
  const row = (day, fid) => {
    const d = byDay[day] || (byDay[day] = { day, req: 0, reads: 0, writes: 0, families: {} });
    return d.families[fid] || (d.families[fid] = { fid, req: 0, reads: 0, writes: 0, devs: 0 });
  };
  for (const r of req.results || []) { row(r.day, r.fid).req += r.req; byDay[r.day].req += r.req; }
  for (const r of app.results || []) {
    const f = row(r.day, r.fid); f.reads += r.reads; f.writes += r.writes; f.devs += r.devs;
    byDay[r.day].reads += r.reads; byDay[r.day].writes += r.writes;
  }
  const out = Object.values(byDay).sort((a, b) => (a.day < b.day ? 1 : -1)).map(d => {
    const fams = Object.values(d.families).filter(f => f.fid !== '-');
    const other = d.families['-'];
    return {
      day: d.day, req: d.req, reads: d.reads, writes: d.writes,
      families: fams.length, sharedFamilies: fams.filter(f => f.reads || f.writes).length,
      otherReq: other ? other.req : 0,
      top: fams.sort((a, b) => (b.reads + b.writes * 2.5 + b.req / 2) - (a.reads + a.writes * 2.5 + a.req / 2)).slice(0, 30)
        .map(f => ({ id: f.fid.slice(0, 2) + '········', me: !!myFid && f.fid === myFid, req: f.req, reads: f.reads, writes: f.writes, devs: f.devs })),
    };
  });
  return { now: Date.now(), today: utcDay(), limits: LIMITS, days: out };
}

function corsHeaders(req) {
  const o = req.headers.get('Origin') || '';
  const ok = o === 'https://leecornell0131-ux.github.io' || o.startsWith('http://localhost');
  return {
    'Access-Control-Allow-Origin': ok ? o : 'https://leecornell0131-ux.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(o, status, headers) {
  return new Response(JSON.stringify(o), { status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

async function writeSummary(env, fid, summary) {
  if (!env.DB) {
    await env.KV.put('s:' + fid, JSON.stringify(summary));
    return true;
  }
  const result = await env.DB.prepare(`INSERT INTO summaries (fid, at, payload) VALUES (?1, ?2, ?3)
    ON CONFLICT(fid) DO UPDATE SET at = excluded.at, payload = excluded.payload
    WHERE excluded.at >= summaries.at`).bind(fid, summary.at, JSON.stringify(summary)).run();
  return result.meta.changes > 0;
}

async function readSummary(env, fid) {
  if (!env.DB) return env.KV.get('s:' + fid, 'json');
  const row = await env.DB.prepare('SELECT payload FROM summaries WHERE fid = ?1').bind(fid).first();
  if (row) return JSON.parse(row.payload);
  const legacy = await env.KV.get('s:' + fid, 'json');
  if (!legacy) return null;
  // 최초 한 번만 이관. 동시에 새 저장이 들어와도 옛 값으로 덮어쓰지 않음.
  await writeSummary(env, fid, legacy);
  const latest = await env.DB.prepare('SELECT payload FROM summaries WHERE fid = ?1').bind(fid).first();
  return latest ? JSON.parse(latest.payload) : legacy;
}

function cleanToken(t) {
  return typeof t === 'string' && t.length > 20 && t.length < 400 && /^[\w:\-.]+$/.test(t) ? t : null;
}

export function cleanSummary(s) {
  if (!s || typeof s !== 'object') return null;
  const o = {};
  for (const k of NUM_KEYS) o[k] = Number.isFinite(s[k]) ? Math.round(s[k]) : null;
  for (const k of STR_KEYS) o[k] = typeof s[k] === 'string' ? s[k].slice(0, 40) : null;
  // sleeps는 최근 50시간 수면 구간 목록이라 길게 두되, 구간 하나가 중간에 잘려 다른 숫자가 되지 않게 구간 단위로 자름
  if (typeof s.sleeps === 'string' && s.sleeps.startsWith('m:')) {
    let out = 'm:';
    for (const p of s.sleeps.slice(2).split(',')) {
      if (!/^\d{1,5}-\d{1,5}$/.test(p)) continue;
      const next = out === 'm:' ? out + p : out + ',' + p;
      if (next.length > 600) break;
      out = next;
    }
    o.sleeps = out;
  }
  if (!o.at) return null;
  return o;
}

// ---------- FCM (HTTP v1) ----------
let cachedToken = null; // {token, exp, sa}

async function accessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken;
  const sa = JSON.parse(env.FCM_SA);
  const enc = o => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ alg: 'RS256', typ: 'JWT' });
  const claim = enc({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  });
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + claim));
  const jwt = head + '.' + claim + '.' + b64url(new Uint8Array(sig));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('oauth: ' + JSON.stringify(j).slice(0, 200));
  cachedToken = { token: j.access_token, exp: now + (j.expires_in || 3600), project: sa.project_id };
  return cachedToken;
}

async function sendAll(env, tokens, fid, summary) {
  const t = await accessToken(env);
  const data = { kind: 'summary', fid };
  for (const [k, v] of Object.entries(summary)) if (v !== null) data[k] = String(v);
  let sent = 0, failed = 0;
  const dead = [];
  await Promise.all(tokens.map(async token => {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${t.project}/messages:send`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token, data, android: { priority: 'HIGH', ttl: '900s', collapse_key: fid } } }),
    });
    if (r.ok) { sent++; return; }
    const txt = await r.text();
    // 앱을 지웠거나 주소가 바뀐 휴대폰은 목록에서 뺌
    if (r.status === 404 || txt.includes('UNREGISTERED') || txt.includes('INVALID_ARGUMENT')) dead.push(token);
    else failed++;
  }));
  return { sent, dead, failed };
}

function pemToDer(pem) {
  const b = atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
  return Uint8Array.from(b, c => c.charCodeAt(0)).buffer;
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
