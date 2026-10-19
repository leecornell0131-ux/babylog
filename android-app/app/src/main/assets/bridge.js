// 웹앱(index.html)과 안드로이드를 잇는 연결 코드. 페이지가 열릴 때마다 앱이 넣어 줌.
// 웹앱은 고치지 않고, 웹앱이 이미 가진 연결점만 씀:
//   localStorage 'babylog-v1'(기록 저장), window.BabyApp(state·applyRemote·toast), window.BabySync.local(가족 공유 올리기), #bFeed(수유 버튼)
(function () {
  if (window.__babyNative) return;
  window.__babyNative = true;
  var N = window.BabyNative, KEY = 'babylog-v1';

  // 기록이 저장될 때마다 안드로이드에 알려 줌 (잠금화면 타이머·위젯 갱신)
  function send(raw) {
    try {
      var S = JSON.parse(raw || localStorage.getItem(KEY) || 'null');
      if (!S) return;
      var ev = S.events || [], now = Date.now();
      var live = function (t) { var r = null; ev.forEach(function (e) { if (e.type === t && e.end === null && (!r || e.start > r.start)) r = e; }); return r; };
      var last = function (t) { var r = null; ev.forEach(function (e) { if (e.type === t && e.start <= now && (!r || e.start > r.start)) r = e; }); return r; };
      var names = { formula: '분유', breastL: '모유 왼쪽', breastR: '모유 오른쪽', pump: '유축 수유' };
      var ls = live('sleep'), lf = live('feed'), f = last('feed');
      N.update(JSON.stringify({
        name: (S.baby && S.baby.name) || '아기',
        sleep: ls ? ls.start : null,
        feed: lf ? lf.start : null,
        feedLabel: lf ? (names[lf.sub] || '수유') : null,
        lastFeed: f ? f.start : null,
        lastFeedText: f ? (names[f.sub] || '수유') + (f.ml ? ' ' + f.ml + 'ml' : f.min ? ' ' + f.min + '분' : '') : null
      }));
    } catch (e) { console.warn('BabyNative.update', e); }
  }
  var setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    setItem.apply(this, arguments);
    if (this === localStorage && k === KEY) send(v);
  };
  send();

  // 위젯·알림 버튼으로 들어온 동작
  window.__babyQuick = function (a) {
    var A = window.BabyApp;
    if (!A) return 'notready';
    if (A.state.sample || A.state.onboarded === false) { A.toast('먼저 앱에서 아기 정보를 넣어 주세요'); return 'ok'; }
    if (a === 'feed') { var b = document.getElementById('bFeed'); if (b) b.click(); return 'ok'; }
    var now = Date.now(), msg = '';
    var id = now.toString(36) + Math.random().toString(36).slice(2, 7);
    A.applyRemote(function (S) {
      var live = function (t) { var r = null; S.events.forEach(function (e) { if (e.type === t && e.end === null && (!r || e.start > r.start)) r = e; }); return r; };
      if (a === 'pee' || a === 'poo' || a === 'both') {
        S.events.push({ id: id, type: 'diaper', sub: a, start: now, note: '' });
        msg = '기저귀를 기록했어요';
      } else if (a === 'sleep' || a === 'stop_sleep') {
        var ls = live('sleep');
        if (ls) { ls.end = Math.max(now, ls.start + 60000); msg = '수면 ' + Math.round((ls.end - ls.start) / 60000) + '분 기록했어요'; }
        else if (a === 'sleep') { S.events.push({ id: id, type: 'sleep', start: now, end: null }); msg = '수면 시작을 기록했어요'; }
      } else if (a === 'stop_feed') {
        // 진행 중 수유(end가 null인 feed)를 웹앱이 지원하게 되면 그대로 끝냄
        var lf = live('feed');
        if (lf) { lf.end = Math.max(now, lf.start + 60000); if (!lf.ml) lf.min = Math.round((lf.end - lf.start) / 60000); msg = '수유를 기록했어요'; }
      }
    });
    try { if (window.BabySync) window.BabySync.local(A.state); } catch (e) {}
    if (msg) A.toast(msg);
    return 'ok';
  };

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
