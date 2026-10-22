// 웹앱(아이폰·갤럭시 앱 안 웹앱 공통)에서 기록을 가족에 올린 뒤 알림 서버에 요약을 보내는 함수.
// 웹앱 sync.js의 push()에서 b.commit() 성공 뒤에 한 줄 호출하면 됨:
//   import('./push-server/web-notify.js').then(m => m.notifyFamily(fid, App.state)).catch(() => {});
// 서버가 아직 없으면(push-config.json에 worker가 없으면) 아무것도 안 함. 실패해도 기록에는 영향 없음.
let cfgP = null;
let queue = null;

export function notifyFamily(fid, S) {
  if (!fid || !S || S.sample) return;
  getQueue().notify(fid, summaryOf(S));
}

// 상대 기록 후 같은 내용으로 되돌리는 저장도 알릴 수 있게 성공 비교값을 무효화.
export function observeFamily(fid, S) {
  if (fid && S && !S.sample) getQueue().observe(fid, summaryOf(S));
}

export function retryPending() { return getQueue().flush(); }

function getQueue() {
  if (!queue) queue = createNotifier({
    storage: {
      getItem: k => localStorage.getItem(k),
      setItem: (k, v) => localStorage.setItem(k, v),
    },
    isActive: fid => {
      try { return JSON.parse(localStorage.getItem('babylog-sync-v1') || '{}').fid === fid; }
      catch (_) { return false; }
    },
    post: send,
  });
  return queue;
}

// 원본 기록과 분리된 소량의 전송 상태. 실패한 최신 요약만 보관하며 정기 조회는 하지 않음.
export function createNotifier({ storage, isActive, post, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const key = 'babylog-notify-v1';
  let saved = { fid: null, lastKey: null, pending: null, generation: 0 }, timer = null, running = false;
  try {
    const parsed = JSON.parse(storage.getItem(key) || 'null');
    if (parsed && typeof parsed === 'object') Object.assign(saved, parsed);
  } catch (_) {}
  const persist = () => { try { storage.setItem(key, JSON.stringify(saved)); } catch (_) {} };
  const contentKey = s => JSON.stringify(Object.keys(s).filter(k => k !== 'at').sort().map(k => [k, s[k]]));
  const schedule = () => { clearTimer(timer); timer = setTimer(flush, 1500); };
  function notify(fid, summary) {
    if (!isActive(fid)) return;
    if (saved.fid !== fid) saved = { fid, lastKey: null, pending: null, generation: 0 };
    const fingerprint = contentKey(summary);
    if (!saved.pending && saved.lastKey === fingerprint) return;
    saved.pending = { fid, summary, key: fingerprint }; persist(); schedule();
  }
  function observe(fid, summary) {
    if (saved.fid !== fid) return;
    const fingerprint = contentKey(summary);
    if (saved.pending ? saved.pending.key === fingerprint : saved.lastKey === fingerprint) return;
    saved.lastKey = null; saved.generation++;
    if (saved.pending) {
      saved.pending = { fid, summary, key: fingerprint };
      schedule();
    }
    persist();
  }
  async function flush() {
    if (running || !saved.pending) return;
    const pending = saved.pending, generation = saved.generation;
    if (!isActive(pending.fid)) { saved.pending = null; saved.lastKey = null; persist(); return; }
    running = true;
    try {
      const result = await post(pending.fid, pending.summary);
      if (!result || !result.ok) throw new Error('notify not accepted');
      if (saved.fid === pending.fid) {
        if (saved.generation === generation) saved.lastKey = result.stale ? null : pending.key;
        if (saved.pending === pending) saved.pending = null;
        persist();
      }
    } catch (_) {
      // 실패를 성공으로 처리하지 않는다. 다음 저장/온라인/화면 복귀 때 재시도.
    } finally {
      running = false;
    }
    // 요청 도중 새 기록이 생겼다면 그 최신값만 이어서 보냄. 같은 실패를 무한 재시도하지 않음.
    if (saved.pending && saved.pending !== pending) await flush();
  }
  return { notify, observe, flush };
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => retryPending());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) retryPending(); });
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
  const fs = ev.filter(e => e.type === 'feed' && e.start <= now && e.start > now - 50 * 3600e3).map(e => e.start).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < fs.length; i++) { const g = fs[i] - fs[i - 1]; if (g >= 30 * 60e3 && g <= 8 * 3600e3) gaps.push(g); }
  const g8 = gaps.slice(-8);
  // 최근 50시간 안에 시작해 끝난 수면. 시작·끝이 지금부터 몇 분 전인지 "m:600-120,900-780" 꼴로 보내
  // 위젯이 '어제 수면'(어제 아침 7시~오늘 아침 7시에 시작한 잠)을 계산함 (진행 중 수면은 sleep으로 따로 감)
  const w0 = now - 50 * 3600e3;
  // 분 단위로 내린 시각끼리 빼서 정확한 정수로 보냄 (반올림하면 7시 정각 잠이 경계를 넘나들 수 있음). 위젯도 at을 분 단위로 내려 되돌림
  const mAgo = t => Math.floor(now / 60e3) - Math.floor(t / 60e3);
  const sl = ev.filter(e => e.type === 'sleep' && e.end != null && e.start >= w0 && e.start < now)
    .sort((x, y) => y.start - x.start)  // 최근 것부터 (길면 서버가 오래된 쪽을 버림)
    .map(e => mAgo(e.start) + '-' + mAgo(Math.min(e.end, now)));
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
    lastFeedAmt: f ? (f.ml ? f.ml + 'ml' : f.min ? f.min + '분' : (names[f.sub] || '수유')) : null,
    lastFeedSub: f ? (f.sub || null) : null,
    birth: (S.baby && S.baby.birth) || null,
    feedGap: g8.length >= 2 ? Math.round(g8.reduce((a, b) => a + b, 0) / g8.length) : null,
    lastWake: ls || !wake ? null : wake,
    lastDiaper: dp ? dp.start : null,
    lastDiaperText: dp ? (dn[dp.sub] || '기저귀') : null,
    day, tFeeds, tMl, tPee, tPoo, tSleep,
    sleeps: 'm:' + sl.join(','),
  };
}

async function send(fid, summary) {
  cfgP = cfgP || fetch(new URL('../android-app/push-config.json', import.meta.url), { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : null)).catch(() => null);
  const cfg = await cfgP;
  if (!cfg || !cfg.worker) { cfgP = null; throw new Error('push config unavailable'); }
  // 갤럭시 앱 안에서 보낼 때는 자기 휴대폰에는 푸시를 보내지 않게
  const except = window.BabyNative && window.BabyNative.pushToken ? window.BabyNative.pushToken() : null;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(cfg.worker.replace(/\/$/, '') + '/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fid, summary, except: except || null }),
      keepalive: true,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('notify HTTP ' + response.status);
    return await response.json();
  } finally { clearTimeout(timeout); }
}
