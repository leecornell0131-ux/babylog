// 웹앱(아이폰·갤럭시 앱 안 웹앱 공통)에서 기록을 가족에 올린 뒤 알림 서버에 요약을 보내는 함수.
// 웹앱 sync.js의 push()에서 b.commit() 성공 뒤에 한 줄 호출하면 됨:
//   import('./push-server/web-notify.js').then(m => m.notifyFamily(fid, App.state)).catch(() => {});
// 서버가 아직 없으면(push-config.json에 worker가 없으면) 아무것도 안 함. 실패해도 기록에는 영향 없음.
let cfgP = null;
let timer = null;

export function notifyFamily(fid, S) {
  if (!fid || !S || S.sample) return;
  // 연달아 저장될 때 한 번만 보냄 (알림 서버 무료 쓰기 한도 절약)
  clearTimeout(timer);
  timer = setTimeout(() => send(fid, summaryOf(S)), 1500);
}

// 위젯·잠금화면에 쓰는 요약. 갤럭시 앱 android-app/app/src/main/assets/bridge.js의 summary()와 똑같이 유지할 것
export function summaryOf(S) {
  const ev = S.events || [], now = Date.now();
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0); const day = +d0;
  const pick = (f) => ev.reduce((r, e) => (f(e) && (!r || e.start > r.start) ? e : r), null);
  const names = { formula: '분유', breastL: '모유 왼쪽', breastR: '모유 오른쪽', pump: '유축 수유' };
  const dn = { pee: '소변', poo: '대변', both: '소변+대변' };
  const ls = pick(e => e.type === 'sleep' && e.end === null);
  const lf = pick(e => e.type === 'feed' && e.end === null);
  const f = pick(e => e.type === 'feed' && e.start <= now);
  const dp = pick(e => e.type === 'diaper' && e.start <= now);
  // 최근 48시간 수유 간격 평균 (30분~8시간 사이만, 최근 8개)
  const fs = ev.filter(e => e.type === 'feed' && e.start <= now && e.start > now - 48 * 3600e3).map(e => e.start).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < fs.length; i++) { const g = fs[i] - fs[i - 1]; if (g >= 30 * 60e3 && g <= 8 * 3600e3) gaps.push(g); }
  const g8 = gaps.slice(-8);
  let wake = 0, tSleep = 0, tFeeds = 0, tMl = 0, tPee = 0, tPoo = 0;
  ev.forEach(e => {
    if (e.type === 'sleep' && e.end != null) {
      if (e.end <= now && e.end > wake) wake = e.end;
      tSleep += Math.max(0, Math.min(e.end, now) - Math.max(e.start, day));
    } else if (e.type === 'feed' && e.start >= day && e.start <= now) { tFeeds++; tMl += +e.ml || 0; }
    else if (e.type === 'diaper' && e.start >= day && e.start <= now) { if (e.sub !== 'poo') tPee++; if (e.sub !== 'pee') tPoo++; }
  });
  return {
    at: now,
    name: (S.baby && S.baby.name) || '아기',
    sleep: ls ? ls.start : null,
    feed: lf ? lf.start : null,
    feedLabel: lf ? (names[lf.sub] || '수유') : null,
    lastFeed: f ? f.start : null,
    lastFeedText: f ? (names[f.sub] || '수유') + (f.ml ? ' ' + f.ml + 'ml' : f.min ? ' ' + f.min + '분' : '') : null,
    feedGap: g8.length >= 2 ? Math.round(g8.reduce((a, b) => a + b, 0) / g8.length) : null,
    lastWake: ls || !wake ? null : wake,
    lastDiaper: dp ? dp.start : null,
    lastDiaperText: dp ? (dn[dp.sub] || '기저귀') : null,
    day, tFeeds, tMl, tPee, tPoo, tSleep,
  };
}

async function send(fid, summary) {
  try {
    cfgP = cfgP || fetch(new URL('../android-app/push-config.json', import.meta.url), { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null)).catch(() => null);
    const cfg = await cfgP;
    if (!cfg || !cfg.worker) return;
    // 갤럭시 앱 안에서 보낼 때는 자기 휴대폰에는 푸시를 보내지 않게
    const except = window.BabyNative && window.BabyNative.pushToken ? window.BabyNative.pushToken() : null;
    await fetch(cfg.worker.replace(/\/$/, '') + '/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fid, summary, except: except || null }),
      keepalive: true,
    });
  } catch (_) {}
}
