// 배포 워크플로에서 실행: Firebase 서비스 계정 키로 갤럭시 앱(kr.babylog.app)의 Firebase 설정을 가져와
// android-app/push-config.json을 만듦. 앱은 이 파일을 인터넷에서 읽어 푸시를 켜므로 APK를 다시 만들 필요가 없음.
// 사용: FCM_SA='<키 JSON>' WORKER_URL=https://... node android-config.mjs <출력 파일>
// Firebase 콘솔에 안드로이드 앱이 없으면 만들어 봄. 권한이 없어 실패하면 FIREBASE_ANDROID_APP_ID 값을 씀.
import { readFileSync, writeFileSync } from 'node:fs';

const PKG = 'kr.babylog.app';
const sa = JSON.parse(process.env.FCM_SA);
const pid = sa.project_id;
const api = 'https://firebase.googleapis.com/v1beta1/';

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
async function token() {
  const now = Math.floor(Date.now() / 1000);
  const enc = o => b64url(JSON.stringify(o));
  const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  });
  const der = Buffer.from(sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + unsigned + '.' + b64url(sig),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('oauth ' + JSON.stringify(j));
  return j.access_token;
}

async function call(t, path, opts = {}) {
  const r = await fetch(api + path, { ...opts, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${path}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

async function androidApp(t) {
  const list = await call(t, `projects/${pid}/androidApps`);
  const found = (list.apps || []).find(a => a.packageName === PKG);
  if (found) return found.appId;
  console.log('Firebase에 안드로이드 앱이 없어 새로 등록해요');
  let op = await call(t, `projects/${pid}/androidApps`, { method: 'POST', body: JSON.stringify({ packageName: PKG, displayName: '아기로그 안드로이드' }) });
  for (let i = 0; i < 30 && !op.done; i++) {
    await new Promise(r => setTimeout(r, 2000));
    op = await call(t, op.name);
  }
  if (!op.done || !op.response) throw new Error('안드로이드 앱 등록이 끝나지 않았어요');
  return op.response.appId;
}

let cfg = null;
try {
  const t = await token();
  const appId = await androidApp(t);
  const c = await call(t, `projects/${pid}/androidApps/${appId}/config`);
  const gs = JSON.parse(Buffer.from(c.configFileContents, 'base64').toString());
  const client = gs.client.find(x => x.client_info.android_client_info.package_name === PKG);
  cfg = {
    apiKey: client.api_key[0].current_key,
    appId: client.client_info.mobilesdk_app_id,
    projectId: gs.project_info.project_id,
    senderId: gs.project_info.project_number,
  };
} catch (e) {
  console.log('서비스 계정으로 안드로이드 설정을 못 가져왔어요: ' + e.message);
  const appId = process.env.FIREBASE_ANDROID_APP_ID;
  if (!appId) throw new Error('FIREBASE_ANDROID_APP_ID 값을 GitHub 저장소 Variables에 넣어 주세요 (Firebase 콘솔 > 프로젝트 설정 > 내 앱 > Android 앱 ID)');
  // 웹앱 설정의 apiKey를 같이 씀
  const js = readFileSync(new URL('../firebase-config.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const apiKey = (js.match(/apiKey\s*:\s*["']([^"']+)/) || [])[1];
  if (!apiKey) throw new Error('firebase-config.js에서 apiKey를 못 찾았어요');
  cfg = { apiKey, appId, projectId: pid, senderId: appId.split(':')[1] };
}

const out = { worker: process.env.WORKER_URL, firebase: cfg };
writeFileSync(process.argv[2], JSON.stringify(out, null, 2) + '\n');
console.log('push-config.json:', JSON.stringify({ ...out, firebase: { ...cfg, apiKey: cfg.apiKey.slice(0, 6) + '…' } }));
