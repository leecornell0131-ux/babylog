// 웹앱(index.html)과 안드로이드를 잇는 연결 코드. 페이지가 열릴 때마다 앱이 넣어 줌.
// 웹앱은 고치지 않고, 웹앱이 이미 가진 연결점만 씀:
//   localStorage 'babylog-v1'(기록 저장), window.BabyApp(state·applyRemote·toast), window.BabySync.local(가족 공유 올리기), #bFeed(수유 버튼)
(function () {
  if (window.__babyNative) return;
  window.__babyNative = true;
  var N = window.BabyNative, KEY = 'babylog-v1';

  // 위젯·잠금화면에 쓰는 요약. push-server/web-notify.js의 summaryOf()와 똑같이 유지할 것
  function summary(S) {
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

  // 기록이 저장될 때마다 안드로이드에 알려 줌 (잠금화면 타이머·위젯 갱신)
  function send(raw) {
    try {
      var S = JSON.parse(raw || localStorage.getItem(KEY) || 'null');
      if (!S) return;
      var o = summary(S);
      o.fid = null;
      try { o.fid = (JSON.parse(localStorage.getItem('babylog-sync-v1') || '{}') || {}).fid || null; } catch (e) {}
      N.update(JSON.stringify(o));
    } catch (e) { console.warn('BabyNative.update', e); }
  }
  var setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    setItem.apply(this, arguments);
    if (this === localStorage && k === KEY) send(v);
    // 가족 공유를 켜거나 끄면(가족코드가 바뀌면) 바로 알림 서버 등록을 바꿈
    else if (this === localStorage && k === 'babylog-sync-v1') send();
  };
  send();

  // 위젯·알림 버튼으로 들어온 동작
  // at: 버튼을 누른 시각 (잠금화면에서 누르고 나중에 앱을 연 경우 그 시각으로 기록)
  // ml: 'feed_ml'(음성 "수유 120")에서 먹은 양
  window.__babyQuick = function (a, at, ml) {
    // "feed_ml:120"처럼 양을 동작 이름에 붙여 보내도 같음
    if (/^feed_ml:\d+$/.test(a)) { ml = +a.slice(8); a = 'feed_ml'; }
    var A = window.BabyApp;
    if (!A) return 'notready';
    if (A.state.sample || A.state.onboarded === false) { A.toast('먼저 앱에서 아기 정보를 넣어 주세요'); return 'ok'; }
    if (a === 'feed') { var b = document.getElementById('bFeed'); if (b) b.click(); return 'ok:'; }
    var now = at || Date.now(), msg = '';
    var id = now.toString(36) + Math.random().toString(36).slice(2, 7);
    A.applyRemote(function (S) {
      var live = function (t) { var r = null; S.events.forEach(function (e) { if (e.type === t && e.end === null && (!r || e.start > r.start)) r = e; }); return r; };
      if (a === 'pee' || a === 'poo' || a === 'both') {
        S.events.push({ id: id, type: 'diaper', sub: a, start: now, note: '' });
        msg = '기저귀를 기록했어요';
      } else if (a === 'sleep_start') {
        // 음성 명령 "아기잠듦": 이미 자는 중이면 그대로 둠 (위젯 '잠듦' 버튼처럼 끝내지 않음)
        if (live('sleep')) msg = '이미 자는 중이에요';
        else { S.events.push({ id: id, type: 'sleep', start: now, end: null }); msg = '수면 시작을 기록했어요'; }
      } else if (a === 'sleep' || a === 'stop_sleep') {
        var ls = live('sleep');
        if (ls && a === 'stop_sleep' && ls.start > now) ls = null; // 누른 뒤에 새로 시작한 수면은 끝내지 않음
        if (ls) { ls.end = Math.max(now, ls.start + 60000); var sm = Math.round((ls.end - ls.start) / 60000); msg = '수면 ' + Math.floor(sm / 60) + 'h ' + String(sm % 60).padStart(2, '0') + 'm 기록했어요'; }
        else if (a === 'sleep') { S.events.push({ id: id, type: 'sleep', start: now, end: null }); msg = '수면 시작을 기록했어요'; }
        else msg = '자는 중인 기록이 없어요';
      } else if (a === 'feed_start') {
        // 음성 명령 "수유 시작": 마지막 수유와 같은 종류·양으로 타이머 시작 (끝날 때 "수유 끝")
        var lf0 = live('feed'), last = null;
        S.events.forEach(function (e) { if (e.type === 'feed' && (!last || e.start > last.start)) last = e; });
        if (lf0) msg = '이미 수유 중이에요';
        else {
          var fe = { id: id, type: 'feed', sub: (last && last.sub) || 'formula', start: now, end: null, note: '' };
          if (last && last.ml && !/^breast/.test(fe.sub)) fe.ml = last.ml;
          S.events.push(fe);
          msg = '수유 시작을 기록했어요';
        }
      } else if (a === 'feed_ml') {
        // 음성 "수유 120": 지금 시각에 그 양으로 끝난 수유 하나. 종류는 지난번 분유·유축과 같게(모유였으면 분유).
        // 수유 타이머가 돌고 있으면 그걸 그 양으로 끝냄
        var n = Math.round(+ml), lf2 = live('feed'), prev = null;
        S.events.forEach(function (e) { if (e.type === 'feed' && e.end !== null && (!prev || e.start > prev.start)) prev = e; });
        var sub = prev && (prev.sub === 'formula' || prev.sub === 'pump') ? prev.sub : 'formula';
        var nm = { formula: '분유', pump: '유축 수유', breastL: '모유', breastR: '모유' };
        var dup = S.events.some(function (e) { return e.type === 'feed' && e.start === now && +e.ml === n; });
        if (!(n >= 1 && n <= 500)) msg = '수유 양을 알아듣지 못했어요';
        else if (dup) msg = '이미 기록했어요'; // 같은 기록이 두 번 넘어온 것 (갤럭시 잠금 상태 저장분)
        else if (lf2 && lf2.start <= now) {
          lf2.end = Math.max(now, lf2.start + 60000); lf2.ml = n; delete lf2.min;
          msg = (nm[lf2.sub] || '수유') + ' ' + n + 'ml 기록했어요';
        } else {
          S.events.push({ id: id, type: 'feed', sub: sub, start: now, ml: n, note: '' });
          msg = nm[sub] + ' ' + n + 'ml 기록했어요';
        }
      } else if (a === 'stop_feed') {
        // 진행 중 수유(end가 null인 feed)를 웹앱이 지원하게 되면 그대로 끝냄
        var lf = live('feed');
        if (lf && lf.start > now) lf = null;
        if (lf) { lf.end = Math.max(now, lf.start + 60000); if (!lf.ml) lf.min = Math.round((lf.end - lf.start) / 60000); msg = '수유를 기록했어요'; }
        else msg = '진행 중인 수유가 없어요';
      }
    });
    try { if (window.BabySync) window.BabySync.local(A.state); } catch (e) {}
    if (msg) A.toast(msg);
    return 'ok:' + msg;
  };

  // 광고: "오늘"(맨 위, 기록 버튼과 먼 곳)·"기록"·"내보내기" 탭에서만, 입력 창이 열려 있지 않고, 개발자 모드에서 끄지 않았을 때 (밤 시간은 앱이 막음)
  var lastZone = null;
  function adZone() {
    if (!N.adZone) return;
    var A = window.BabyApp, cur = document.querySelector('#tabs button[aria-current="page"]');
    var sheet = document.getElementById('sheetRoot');
    var on = !!(A && A.ads !== false && A.state && A.state.onboarded !== false &&
      !document.body.classList.contains('nodock') && cur && (cur.dataset.tab === 'today' || cur.dataset.tab === 'week' || cur.dataset.tab === 'export') &&
      !(sheet && sheet.innerHTML.trim()));
    if (on !== lastZone) { lastZone = on; N.adZone(on); }
  }
  var adTimer = null;
  function adLater() { clearTimeout(adTimer); adTimer = setTimeout(adZone, 150); }
  try {
    new MutationObserver(adLater).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-current', 'class'] });
  } catch (e) {}
  addEventListener('babylog-ads', adLater);
  setInterval(function () { lastZone = null; adZone(); }, 60000); // 밤 시간이 되면 내리기
  adZone();

  // 공유·복사: 안드로이드 웹뷰에는 없어서 앱 기능으로 대신함
  navigator.canShare = function (d) { return !!d; };
  navigator.share = function (d) {
    return new Promise(function (resolve, reject) {
      if (d && d.files && d.files.length) {
        var f = d.files[0], r = new FileReader();
        r.onload = function () { N.shareFile(f.name || 'babylog.json', f.type || 'application/octet-stream', String(r.result).split(',')[1] || ''); resolve(); };
        r.onerror = function () { reject(r.error); };
        r.readAsDataURL(f);
      } else {
        N.shareText([d && d.title, d && d.text, d && d.url].filter(Boolean).join('\n'));
        resolve();
      }
    });
  };
  try {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: function (t) { N.copy(String(t)); return Promise.resolve(); } }
    });
  } catch (e) {}
})();
