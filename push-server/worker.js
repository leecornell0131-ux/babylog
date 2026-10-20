// 아기로그 알림 서버 (Cloudflare Workers 무료 요금제, 카드 등록 없음)
// 한 휴대폰에서 기록하면 웹앱이 /notify로 요약을 보내고, 이 서버가 같은 가족의 갤럭시 앱에 FCM 푸시를 보내
// 홈 화면 위젯과 잠금화면 타이머를 몇 초 안에 바꿈. 기록 자체는 다루지 않고 위젯용 요약(시각 몇 개)만 받음.
//
// 저장(KV): t:<가족코드> = 갤럭시 앱 푸시 주소 목록, s:<가족코드> = 마지막 요약
// 보안: 가족코드(10자리 무작위)를 아는 사람만 쓸 수 있음. Firestore 규칙과 같은 기준.
//
// 비밀값(wrangler secret): FCM_SA = Firebase 서비스 계정 키 JSON 전체

const FID = /^[A-HJ-NP-Z2-9]{10}$/;
const NUM_KEYS = ['lastFeed', 'sleep', 'feed', 'at', 'feedGap', 'lastWake', 'lastDiaper', 'day', 'tFeeds', 'tMl', 'tPee', 'tPoo', 'tSleep'];
const STR_KEYS = ['lastFeedText', 'feedLabel', 'name', 'lastDiaperText', 'lastFeedAmt', 'lastFeedSub', 'birth'];
const MAX_TOKENS = 10;

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    try {
      if (req.method === 'GET' && url.pathname === '/') return json({ ok: true, app: 'babylog-push' }, 200, cors);

      // 15분마다 갤럭시 앱이 확인 (푸시가 늦거나 막혔을 때 대비)
      if (req.method === 'GET' && url.pathname === '/summary') {
        const fid = url.searchParams.get('fid') || '';
        if (!FID.test(fid)) return json({ error: 'fid' }, 400, cors);
        const s = await env.KV.get('s:' + fid, 'json');
        return json({ summary: s }, 200, cors);
      }

      if (req.method !== 'POST') return json({ error: 'method' }, 405, cors);
      const body = await req.json().catch(() => null);
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
        const prev = await env.KV.get('s:' + fid, 'json');
        // 순서가 뒤바뀌어 도착한 오래된 요약은 버림
        if (prev && prev.at > summary.at) return json({ ok: true, stale: true }, 200, cors);
        await env.KV.put('s:' + fid, JSON.stringify(summary));
        const except = cleanToken(body.except);
        const list = ((await env.KV.get('t:' + fid, 'json')) || []).filter(t => t !== except);
        if (!list.length) return json({ ok: true, sent: 0 }, 200, cors);
        const res = await sendAll(env, list, fid, summary);
        if (res.dead.length) {
          const all = (await env.KV.get('t:' + fid, 'json')) || [];
          await env.KV.put('t:' + fid, JSON.stringify(all.filter(t => !res.dead.includes(t))));
        }
        return json({ ok: true, sent: res.sent }, 200, cors);
      }

      return json({ error: 'not found' }, 404, cors);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500, cors);
    }
  },
};

function corsHeaders(req) {
  const o = req.headers.get('Origin') || '';
  const ok = o === 'https://leecornell0131-ux.github.io' || o.startsWith('http://localhost');
  return {
    'Access-Control-Allow-Origin': ok ? o : 'https://leecornell0131-ux.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(o, status, headers) {
  return new Response(JSON.stringify(o), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

function cleanToken(t) {
  return typeof t === 'string' && t.length > 20 && t.length < 400 && /^[\w:\-.]+$/.test(t) ? t : null;
}

export function cleanSummary(s) {
  if (!s || typeof s !== 'object') return null;
  const o = {};
  for (const k of NUM_KEYS) o[k] = Number.isFinite(s[k]) ? Math.round(s[k]) : null;
  for (const k of STR_KEYS) o[k] = typeof s[k] === 'string' ? s[k].slice(0, 40) : null;
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
  let sent = 0;
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
  }));
  return { sent, dead };
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
