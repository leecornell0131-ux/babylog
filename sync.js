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
  for (let i = 0; i < writes.length || (i === 0 && metaChanged); i += 400) {
    const chunk = writes.slice(i, i + 400), b = F.writeBatch(db);
    chunk.forEach(([id, c, data]) => { inflight[id] = c; b.set(F.doc(db, 'families', fid, 'events', id), data); });
    const withMeta = i === 0 && metaChanged;
    if (withMeta) { inflight.__meta = m; b.update(F.doc(db, 'families', fid), { meta: JSON.parse(m), mu: F.serverTimestamp(), mby: me }); }
    b.commit().then(() => {
      if (st.fid !== fid) return;
      chunk.forEach(([id, c]) => { st.synced[id] = c; if (inflight[id] === c) delete inflight[id]; });
      if (withMeta) { st.meta = m; if (inflight.__meta === m) delete inflight.__meta; }
      persist(); if (state !== 'on') setState('on');
      // 갤럭시 위젯·잠금화면 즉시 갱신용 알림 서버에 요약 전달 (서버 설정이 없으면 아무것도 안 함)
      import('./push-server/web-notify.js').then(m => m.notifyFamily(fid, App.state)).catch(() => {});
    }, e => {
      chunk.forEach(([id, c]) => { if (inflight[id] === c) delete inflight[id]; });
      if (withMeta && inflight.__meta === m) delete inflight.__meta;
      setState('err', errText(e));
    });
  }
}

// ---------- 받기 ----------
function listen() {
  unsubs.forEach(f => f()); unsubs = [];
  const fid = st.fid; if (!fid) return;
  // 서버 시각이 조금 어긋나도 놓치지 않도록 5분 겹쳐서 받음 (같은 기록은 다시 받아도 무해)
  const since = F.Timestamp.fromMillis(Math.max(0, st.cursor - 5 * 60000));
  const q = F.query(F.collection(db, 'families', fid, 'events'), F.where('u', '>', since), F.orderBy('u'));
  unsubs.push(F.onSnapshot(q, snap => {
    const changes = snap.docChanges().filter(ch => ch.type !== 'removed' && !ch.doc.metadata.hasPendingWrites);
    if (!changes.length) { if (!snap.metadata.fromCache && state !== 'on') setState('on'); return; }
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
          // 내가 올린 기록이 되돌아왔는데 그사이 이 휴대폰에서 또 고쳤으면 새 값을 지킴 (다음 올리기에서 반영)
          if (mine && localC && localC !== c && localC !== prev) continue;
          if (idx.has(id)) S.events[idx.get(id)] = ev; else S.events.push(ev);
        }
        idx.clear(); S.events.forEach((e, i) => idx.set(e.id, i));
      }
    });
    persist(); if (!snap.metadata.fromCache) setState('on');
  }, e => setState('err', errText(e))));
  unsubs.push(F.onSnapshot(F.doc(db, 'families', fid), snap => {
    const d = snap.data(); if (!d || !d.meta || snap.metadata.hasPendingWrites) return;
    const m = canon(d.meta); if (m === st.meta) return;
    st.meta = m; persist();
    App.applyRemote(S => { for (const k of META_KEYS) if (d.meta[k] !== undefined) S[k] = d.meta[k]; });
  }, e => setState('err', errText(e))));
}

async function begin(fid) {
  st = { fid, cursor: 0, synced: {}, meta: null }; persist();
  listen();
  push(App.state); // 이 휴대폰에 있던 기록도 가족에 올림
}

window.BabySync = {
  status: () => ({ fid: st.fid, state, error, busy }),
  local,
  async create() {
    busy = true; error = ''; App.refresh();
    try {
      const me = await uid(), fid = code(), S = App.state;
      await F.setDoc(F.doc(db, 'families', fid), { createdBy: me, createdAt: F.serverTimestamp(), meta: JSON.parse(metaOf(S)), mu: F.serverTimestamp(), mby: me });
      await F.setDoc(F.doc(db, 'families', fid, 'members', me), { joinedAt: F.serverTimestamp() });
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
      st = { fid, cursor: 0, synced: {}, meta: null };
      if (fam.exists() && fam.data().meta) {
        const meta = fam.data().meta; st.meta = canon(meta);
        App.applyRemote(S => { for (const k of META_KEYS) if (meta[k] !== undefined) S[k] = meta[k]; });
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
App.refresh();
