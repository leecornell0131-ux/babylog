// 가족 공유 (Firebase 무료 Spark 요금제, 서버 코드 없음)
// - 기록은 항상 기기에 먼저 저장하고, 바뀐 기록만 Firestore에 올림
// - 받을 때도 마지막으로 받은 시각 이후에 바뀐 기록만 받음 (읽기 횟수 절약)
// - 한도 초과·오프라인이면 동기화만 멈추고 앱은 그대로 동작
const V = '10.12.2';
const base = `https://www.gstatic.com/firebasejs/${V}/`;
const [{ initializeApp }, A, F] = await Promise.all([
  import(base + 'firebase-app.js'),
  import(base + 'firebase-auth.js'),
  import(base + 'firebase-firestore.js'),
]);

const cfg = window.FIREBASE_CONFIG;
const app = initializeApp(cfg);
const auth = A.getAuth(app);
const db = F.initializeFirestore(app, { ignoreUndefinedProperties: true });
if (cfg.emulator) {
  A.connectAuthEmulator(auth, 'http://' + cfg.emulator.auth, { disableWarnings: true });
  const [h, p] = cfg.emulator.firestore.split(':');
  F.connectFirestoreEmulator(db, h, +p);
}

const LS = 'babylog-sync-v1';
const META_KEYS = ['baby', 'items', 'gaps'];
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0/O, 1/I 제외
const App = window.BabyApp;

// fid: 가족 코드, cursor: 마지막으로 받은 서버 시각(ms), synced: 서버와 같은 상태로 확인된 기록 {id: 정렬JSON}
let st = { fid: null, cursor: 0, synced: {}, meta: null };
try { Object.assign(st, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (_) {}
const persist = () => { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (_) {} };

let state = 'off', error = '', busy = false, unsubs = [];

// ---------- 사용량 세기 (대략값) ----------
// Firebase 콘솔은 전체 합계만 보여 줘서, 이 휴대폰이 쓴 Firestore 읽기·쓰기를 스스로 세어 알림 서버에 몇 시간에 한 번 보냄.
// 보내는 것: 가족코드, 휴대폰 무작위 번호, 날짜, 읽기·쓰기 횟수뿐. 기록 내용·아기 정보는 보내지 않음.
// 하루 = UTC 날짜(한국 아침 9시 시작). 셈은 요금 규칙을 따라 대략 맞춤: 받은 문서 1개 = 읽기 1, 빈 결과도 읽기 1,
// 규칙의 가족 확인(exists) = 읽기 1, 올린 문서 1개 = 쓰기 1.
const UL = 'babylog-usage-v1';
const today = () => new Date().toISOString().slice(0, 10);
let use = { dev: null, day: today(), reads: 0, writes: 0, prev: null, sentAt: 0 };
try { Object.assign(use, JSON.parse(localStorage.getItem(UL) || '{}')); } catch (_) {}
if (!use.dev) { const a = new Uint32Array(2); crypto.getRandomValues(a); use.dev = Array.from(a, n => n.toString(36).padStart(7, '0').slice(-7)).join(''); }
let useTimer = null;
// 베타 테스터 번호(설정에서 코드를 넣은 휴대폰만). 테스터는 가족 공유를 안 써도 하루 기록 개수를 보냄
const testerNo = () => { const n = +localStorage.getItem('babylog-v1-tester'); return n >= 1 && n <= 99 ? n : 0; };
// 그 날(UTC) 이 휴대폰에서 남긴 기록 개수 (기록 내용은 보내지 않고 개수만)
function evCount(day) {
  const dev = localStorage.getItem('babylog-v1-device'), from = Date.parse(day + 'T00:00:00Z'), to = from + 864e5;
  return ((App.state && App.state.events) || []).filter(e => e.by === dev && e.start >= from && e.start < to).length;
}
function rollDay() {
  const d = today(); if (use.day === d) return;
  use.prev = use.reads || use.writes || testerNo() ? { day: use.day, reads: use.reads, writes: use.writes } : null;
  use.day = d; use.reads = 0; use.writes = 0; use.sentAt = 0;
}
function tally(reads, writes = 0) {
  rollDay();
  use.reads += reads; use.writes += writes;
  try { localStorage.setItem(UL, JSON.stringify(use)); } catch (_) {}
  clearTimeout(useTimer); useTimer = setTimeout(reportUsage, 5000);
}
async function reportUsage() {
  const fid = st.fid, tc = testerNo(); if (!fid && !tc) return;
  rollDay();
  const sends = [];
  if (use.prev) sends.push(use.prev);
  if ((use.reads || use.writes || tc) && Date.now() - use.sentAt > 3 * 3600e3) sends.push({ day: use.day, reads: use.reads, writes: use.writes });
  if (!sends.length) return;
  const m = await import('./push-server/web-notify.js').catch(() => null); if (!m || !m.sendUsage) return;
  for (const u of sends) {
    const extra = tc ? { tc, ev: evCount(u.day) } : {};
    if (!await m.sendUsage({ ...(fid ? { fid } : {}), dev: use.dev, ...u, ...extra }).catch(() => false)) return;
    if (u === use.prev) use.prev = null; else use.sentAt = Date.now();
    try { localStorage.setItem(UL, JSON.stringify(use)); } catch (_) {}
  }
}
const inflight = {}; // 올리는 중인 기록 {id: 정렬JSON}
const setState = (s, e = '') => { state = s; error = e; App.refresh(); };

const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x))
  ? Object.keys(x).sort().reduce((o, key) => (o[key] = x[key], o), {}) : x);
const strip = d => { const o = { ...d }; delete o.u; delete o.del; delete o.by; return o; };
const metaOf = S => canon(Object.fromEntries(META_KEYS.map(k => [k, S[k]])));

function errText(e) {
  const c = (e && e.code) || '';
  if (c.includes('resource-exhausted')) return '오늘 무료 사용량을 다 써서 동기화가 잠시 멈췄어요. 기록은 이 휴대폰에 저장돼요';
  if (c.includes('permission-denied')) return '이 가족에 접근할 수 없어요. 초대코드를 확인해 주세요';
  if (c.includes('unavailable') || c.includes('network')) return '인터넷 연결이 없어 동기화를 기다리는 중이에요';
  return '동기화 오류: ' + (c || (e && e.message) || '알 수 없음');
}

async function uid() {
  if (auth.currentUser) return auth.currentUser.uid;
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser.uid;
  return (await A.signInAnonymously(auth)).user.uid;
}

function code() {
  const a = new Uint32Array(10); crypto.getRandomValues(a);
  return Array.from(a, n => ALPHA[n % ALPHA.length]).join('');
}

// ---------- 올리기 ----------
let pushTimer = null;
function local(S) {
  if (testerNo() && !S.sample) { clearTimeout(useTimer); useTimer = setTimeout(reportUsage, 5000); }
  if (!st.fid || S.sample) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => push(S), 400);
}
async function push(S) {
  if (!st.fid) return;
  const me = await uid().catch(() => null); if (!me) return;
  const fid = st.fid, writes = [], seen = new Set();
  for (const ev of S.events) {
    seen.add(ev.id);
    const c = canon(ev);
    if (st.synced[ev.id] !== c && inflight[ev.id] !== c) writes.push([ev.id, c, { ...ev, u: F.serverTimestamp(), del: false, by: me }]);
  }
  // 지운 기록은 del 표시로 남김 (상대 기기에서도 지우도록)
  for (const id of Object.keys(st.synced)) {
    if (!seen.has(id) && st.synced[id] !== 'DEL' && inflight[id] !== 'DEL') writes.push([id, 'DEL', { id, u: F.serverTimestamp(), del: true, by: me }]);
  }
  const m = metaOf(S), metaChanged = st.meta !== m && inflight.__meta !== m;
  if (!writes.length && !metaChanged) return;
  const commits = [];
  for (let i = 0; i < writes.length || (i === 0 && metaChanged); i += 400) {
    const chunk = writes.slice(i, i + 400), b = F.writeBatch(db);
    chunk.forEach(([id, c, data]) => { inflight[id] = c; b.set(F.doc(db, 'families', fid, 'events', id), data); });
    const withMeta = i === 0 && metaChanged;
    if (withMeta) { inflight.__meta = m; b.update(F.doc(db, 'families', fid), { meta: JSON.parse(m), mu: F.serverTimestamp(), mby: me }); }
    tally(1); // 규칙의 가족 확인 (한 번에 올리는 묶음당 1번)
    commits.push(b.commit().then(() => {
      tally(0, chunk.length + (withMeta ? 1 : 0));
      if (st.fid !== fid) return;
      chunk.forEach(([id, c]) => { st.synced[id] = c; if (inflight[id] === c) delete inflight[id]; });
      if (withMeta) { st.meta = m; if (inflight.__meta === m) delete inflight.__meta; }
      persist(); if (state !== 'on') setState('on');
      return true;
    }, e => {
      chunk.forEach(([id, c]) => { if (inflight[id] === c) delete inflight[id]; });
      if (withMeta && inflight.__meta === m) delete inflight.__meta;
      setState('err', errText(e));
      return false;
    }));
  }
  // 여러 배치의 일부만 저장된 상태를 알리지 않음. 한 논리적 저장당 최대 한 번.
  Promise.all(commits).then(results => {
    if (st.fid !== fid || !results.every(Boolean)) return;
    import('./push-server/web-notify.js').then(m => {
      if (st.fid === fid) m.notifyFamily(fid, App.state);
    }).catch(() => {});
  });
}

// ---------- 받기 ----------
function recoverWidget(fid, remote = false) {
  import('./push-server/web-notify.js').then(m => {
    if (st.fid !== fid) return;
    if (remote) m.observeFamily(fid, App.state);
    m.retryPending();
  }).catch(() => {});
}
function listen() {
  unsubs.forEach(f => f()); unsubs = [];
  const fid = st.fid; if (!fid) return;
  // 서버 시각이 조금 어긋나도 놓치지 않도록 5분 겹쳐서 받음 (같은 기록은 다시 받아도 무해)
  const since = F.Timestamp.fromMillis(Math.max(0, st.cursor - 5 * 60000));
  const q = F.query(F.collection(db, 'families', fid, 'events'), F.where('u', '>', since), F.orderBy('u'));
  let firstEv = true, firstMeta = true;
  unsubs.push(F.onSnapshot(q, snap => {
    if (!snap.metadata.fromCache) {
      const n = snap.docChanges().filter(ch => !ch.doc.metadata.hasPendingWrites).length;
      tally(firstEv ? Math.max(1, n) + 1 : n); firstEv = false;
    }
    const changes = snap.docChanges().filter(ch => ch.type !== 'removed' && !ch.doc.metadata.hasPendingWrites);
    if (!changes.length) {
      if (!snap.metadata.fromCache) { if (state !== 'on') setState('on'); recoverWidget(fid); }
      return;
    }
    let keep = false;
    App.applyRemote(S => {
      const idx = new Map(S.events.map((e, i) => [e.id, i]));
      for (const ch of changes) {
        const d = ch.doc.data(), id = ch.doc.id;
        if (d.u) st.cursor = Math.max(st.cursor, d.u.toMillis());
        if (d.del) {
          if (idx.has(id)) S.events = S.events.filter(e => e.id !== id);
          st.synced[id] = 'DEL';
        } else {
          const ev = strip(d), c = canon(ev);
          const mine = auth.currentUser && d.by === auth.currentUser.uid;
          const localC = idx.has(id) ? canon(S.events[idx.get(id)]) : null;
          const prev = st.synced[id];
          st.synced[id] = c;
          // 같은 잠·수유를 두 휴대폰이 각자 '깼어요'·'끝'으로 끝낸 경우: 먼저 누른 시각이 맞음.
          // 늦게 바뀌는 화면·위젯(아이폰 위젯은 15분쯤 늦음)을 보고 이미 끝난 잠에 또 '깼어요'를 누르면 더 늦은 시각이 오는데,
          // 버튼은 진행 중일 때만 누를 수 있으니 이미 끝난 기록보다 늦은 버튼 시각은 버림 (기록 수정으로 바꾼 시각은 tap이 없어 그대로 받음)
          const lo = idx.has(id) ? S.events[idx.get(id)] : null, same = lo && lo.start === ev.start && lo.end != null && ev.end != null;
          if (same && ev.tap === ev.end && lo.end < ev.end) { keep = true; continue; }
          const localTapLater = same && lo.tap === lo.end && ev.end < lo.end;
          // 이 휴대폰에서 고친 뒤 아직 못 올린 기록이면 이 휴대폰 값을 지킴 (다음 올리기에서 반영).
          // 예전엔 내가 올린 기록만 지켜서, 밤에 갤럭시가 절전으로 늦게 올리는 사이 다른 휴대폰이 같은 수면을 고치면
          // 갤럭시에서 누른 '깼어요' 시각이 말없이 사라졌음. 이제는 마지막으로 고쳐서 올린 쪽으로 양쪽이 맞춰짐
          if (!localTapLater && localC && localC !== c && localC !== prev && (mine || prev !== undefined)) { keep = true; continue; }
          if (idx.has(id)) S.events[idx.get(id)] = ev; else S.events.push(ev);
        }
        idx.clear(); S.events.forEach((e, i) => idx.set(e.id, i));
      }
    }, 'sync');
    persist(); if (keep) local(App.state); if (!snap.metadata.fromCache) setState('on');
    // 같은 로그인 ID를 공유하는 다른 탭의 변경도 비교. 내용 동일한 자기 echo는 큐가 무시.
    if (!snap.metadata.fromCache) recoverWidget(fid, true);
  }, e => setState('err', errText(e))));
  unsubs.push(F.onSnapshot(F.doc(db, 'families', fid), snap => {
    if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) { tally(firstMeta ? 2 : 1); firstMeta = false; }
    const d = snap.data(); if (!d || !d.meta || snap.metadata.hasPendingWrites) return;
    const m = canon(d.meta); if (m === st.meta) return;
    st.meta = m; persist();
    App.applyRemote(S => { for (const k of META_KEYS) if (d.meta[k] !== undefined) S[k] = d.meta[k]; }, 'sync');
    if (!snap.metadata.fromCache) recoverWidget(fid, true);
  }, e => setState('err', errText(e))));
}

async function begin(fid) {
  st = { fid, cursor: 0, synced: {}, meta: null }; persist();
  listen();
  push(App.state); // 이 휴대폰에 있던 기록도 가족에 올림
}

window.BabySync = {
  status: () => ({ fid: st.fid, state, error, busy }),
  usage: () => ({ day: use.day, reads: use.reads, writes: use.writes, prev: use.prev, sentAt: use.sentAt }),
  local,
  async create() {
    busy = true; error = ''; App.refresh();
    try {
      const me = await uid(), fid = code(), S = App.state;
      await F.setDoc(F.doc(db, 'families', fid), { createdBy: me, createdAt: F.serverTimestamp(), meta: JSON.parse(metaOf(S)), mu: F.serverTimestamp(), mby: me });
      await F.setDoc(F.doc(db, 'families', fid, 'members', me), { joinedAt: F.serverTimestamp() });
      tally(1, 2);
      await begin(fid); st.meta = metaOf(S); persist();
      App.toast('가족을 만들었어요. 초대코드를 배우자에게 보내세요');
    } catch (e) { error = errText(e); state = 'err'; }
    busy = false; App.refresh();
  },
  async join(raw) {
    const fid = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (fid.length !== 10) { error = '초대코드는 10자리예요'; App.refresh(); return; }
    busy = true; error = ''; App.refresh();
    try {
      const me = await uid();
      await F.setDoc(F.doc(db, 'families', fid, 'members', me), { joinedAt: F.serverTimestamp() });
      // 가족의 아기 정보를 먼저 받아 이 휴대폰 값으로 덮어쓰지 않게 함
      const fam = await F.getDoc(F.doc(db, 'families', fid));
      tally(3, 1);
      st = { fid, cursor: 0, synced: {}, meta: null };
      if (fam.exists() && fam.data().meta) {
        const meta = fam.data().meta; st.meta = canon(meta);
        App.applyRemote(S => { for (const k of META_KEYS) if (meta[k] !== undefined) S[k] = meta[k]; }, 'sync');
      }
      persist(); listen(); push(App.state);
      App.toast('가족에 참여했어요. 기록을 맞추는 중이에요');
    } catch (e) {
      error = (e && e.code || '').includes('permission-denied') ? '그런 초대코드가 없어요. 다시 확인해 주세요' : errText(e);
    }
    busy = false; App.refresh();
  },
  async leave() {
    const fid = st.fid; unsubs.forEach(f => f()); unsubs = [];
    st = { fid: null, cursor: 0, synced: {}, meta: null }; persist(); state = 'off';
    try { const me = await uid(); await F.deleteDoc(F.doc(db, 'families', fid, 'members', me)); } catch (_) {}
  },
};

if (st.fid) { state = 'off'; listen(); push(App.state); }
setTimeout(reportUsage, 8000);
App.refresh();
