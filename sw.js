// 앱 파일을 기기에 저장해 두고 인터넷 없이도 열리게 함. 파일을 바꾸면 VERSION을 올릴 것.
const VERSION = 'babylog-0.3.22';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'firebase-config.js', 'sync.js', 'who_lms.js', 'sleep_rules.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 같은 주소의 파일만: 네트워크 먼저, 안 되면 저장본 (업데이트가 바로 반영되도록)
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match('index.html'))));
});
