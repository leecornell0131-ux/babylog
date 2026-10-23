# 아기로그 알림 서버 (Cloudflare Workers 무료)

배우자가 다른 휴대폰에서 기록하면 갤럭시 앱의 홈 화면 위젯과 잠금화면 타이머를 몇 초 안에 바꿔 주는 작은 서버예요.

## 어떻게 동작하나

1. 휴대폰(아이폰 웹앱이나 갤럭시 앱)에서 기록하면 웹앱이 가족 공유(Firestore)에 올린 뒤, 이 서버의 `/notify`로 **위젯용 요약**(마지막 수유 시각, 수면 중인지 등 몇 가지)만 보내요. 기록 내용 전체는 보내지 않아요.
2. 서버는 같은 가족코드로 등록된 갤럭시 앱에 FCM 푸시를 보내요. 갤럭시 앱은 앱이 꺼져 있어도 위젯과 잠금화면 타이머를 바로 바꿔요.
3. 푸시가 늦거나 막혔을 때를 대비해 갤럭시 앱은 15분마다 `/summary`로 마지막 요약을 확인해요.

## 사용량 보기 (가족별)

- 서버는 받은 요청 수를 가족코드별로 1분씩 모아 D1 `usage_req`에 저장해요.
- 각 휴대폰(웹앱 `sync.js`)은 자기가 쓴 Firestore 읽기·쓰기를 세어 몇 시간에 한 번 `/usage`로 보내요(`usage_app`, 숫자만, 60일 뒤 삭제).
- 대시보드: https://leecornell0131-ux.github.io/babylog/usage.html (`GET /usage`, 가족코드는 앞 2자리만)
- 매일 점검: `.github/workflows/usage-check.yml`이 한국 9:15·20:00에 확인하고, 한도의 50%를 넘으면 "사용량 경보" 이슈를 올려 이메일이 와요. 단계와 계산은 `usage-levels.js`.

## 비용: 0원 (카드 등록 없음)

| 서비스 | 무료 한도 (공식 문서) | 우리 사용량 |
|---|---|---|
| Cloudflare Workers Free | 하루 요청 100,000회, 요청당 CPU 10ms ([Limits](https://developers.cloudflare.com/workers/platform/limits/)) | 하루 기록 30~50번 + 15분 확인 96번 정도 |
| Workers KV Free | 하루 읽기 100,000회, 쓰기 1,000회, 저장 1GB ([KV Limits](https://developers.cloudflare.com/kv/platform/limits/)) | 기록 1번당 쓰기 1번 (하루 50번 안팎) |
| Firebase Cloud Messaging | Spark 요금제에서 무료 ([Firebase 요금](https://firebase.google.com/pricing)) | 기록 1번당 푸시 1~2개 |

카드를 등록하지 않았으므로 한도를 넘어도 돈이 나가지 않고, 그날만 위젯이 늦게(15분 확인이나 앱을 열 때) 바뀌어요.

## 처음 한 번 설정하기

아침설정 안내 파일을 따라 하면 돼요: 프로젝트 파일 `guide/알림서버_아침설정.md`.
설정값을 넣고 GitHub Actions의 **Push server** 워크플로를 실행하면 서버를 올리고 `android-app/push-config.json`을 만들어요. 갤럭시 앱은 이 파일을 인터넷에서 읽으므로 APK를 다시 설치할 필요가 없어요.

## 파일

| 파일 | 내용 |
|---|---|
| `worker.js` | 서버 코드 (`/register`, `/unregister`, `/notify`, `/summary`) |
| `wrangler.toml` | 배포 설정 (KV id는 배포 때 채움) |
| `android-config.mjs` | 배포 때 Firebase에서 갤럭시 앱 설정을 가져와 `push-config.json`을 만듦 |
| `web-notify.js` | 웹앱이 기록을 올린 뒤 부르는 함수 (`notifyFamily(fid, state)`), 사용량 보내기 (`sendUsage`) |
| `usage-levels.js` | 경보 단계·수용 인원 계산 (대시보드와 매일 점검이 같이 씀) |
| `usage-check.mjs` | 매일 점검 스크립트 |

## 보안

가족코드(10자리 무작위)를 아는 사람만 이 가족의 요약을 쓰고 읽을 수 있어요. Firestore 가족 공유 규칙과 같은 기준이에요. Firebase 서비스 계정 키는 GitHub 저장소 Secrets와 Cloudflare 비밀값에만 들어가고 코드에는 없어요.
