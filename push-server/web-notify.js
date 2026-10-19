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

export function summaryOf(S) {
  const ev = S.events || [], now = Date.now();
  const pick = (f) => ev.reduce((r, e) => (f(e) && (!r || e.start > r.start) ? e : r), null);
  const names = { formula: '분유', breastL: '모유 왼쪽', breastR: '모유 오른쪽', pump: '유축 수유' };
  const ls = pick(e => e.type === 'sleep' && e.end === null);
  const lf = pick(e => e.type === 'feed' && e.end === null);
  const f = pick(e => e.type === 'feed' && e.start <= now);
  return {
    at: now,
    name: (S.baby && S.baby.name) || '아기',
    sleep: ls ? ls.start : null,
    feed: lf ? lf.start : null,
    feedLabel: lf ? (names[lf.sub] || '수유') : null,
    lastFeed: f ? f.start : null,
    lastFeedText: f ? (names[f.sub] || '수유') + (f.ml ? ' ' + f.ml + 'ml' : f.min ? ' ' + f.min + '분' : '') : null,
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
