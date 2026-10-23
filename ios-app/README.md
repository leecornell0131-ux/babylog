# 아기로그 아이폰 앱 (TestFlight 테스트용)

갤럭시 앱과 같은 구조예요. 웹앱(https://leecornell0131-ux.github.io/babylog/)을 앱 안에 그대로 띄워요.

- **화면과 기록 기능은 웹앱과 100% 같아요.** 웹앱을 고치면 이 앱도 다시 빌드하지 않고 다음에 열 때 같이 바뀌어요.
- 가족 공유(초대코드)도 웹앱 코드 그대로라 갤럭시 앱·Safari 웹앱과 기록이 합쳐져요.
- 아이폰 앱에서 따로 챙긴 것
  - 웹앱의 확인 창(삭제할까요? 등)이 아이폰 기본 알림창으로 떠요.
  - 백업 파일 저장은 공유 창으로 떠서 "파일에 저장"이나 카톡으로 보낼 수 있어요.
  - 다른 사이트 링크는 Safari로 열려요. 인터넷이 없으면 "다시 열기" 화면이 떠요.
  - 앱으로 돌아올 때마다 `BabyApp.refresh()`로 배우자 기록을 다시 그려요.
- 위젯 (홈 화면을 길게 누르고 + → 아기로그)
  - 갤럭시 위젯 6종과 같은 종류·글자·색·버튼 (`Widgets.swift`가 `android-app` `QuickWidget.kt`·`widget_*.xml`을 따라감. 한쪽을 바꾸면 다른 쪽도)
  - 빠른 기록(중간), 수유 타이머(작은), 마지막 수유(작은), 수면·깨어 있는 시간(작은), 기저귀(중간, 갤럭시 4×1 대신), 오늘 요약(중간)
  - 버튼만 기록하고 나머지 자리를 누르면 앱만 열려요 (iOS 17 위젯 버튼 `BabyActionIntent` → 앱이 열리며 누른 시각으로 기록)
  - 잠금화면 위젯: 마지막 수유, 수면 (잠금화면을 길게 누르고 사용자화 → 잠금화면 → 위젯 추가)
- 잠금화면·다이내믹 아일랜드 타이머(Live Activity): 수면 중·수유 중이면 시간이 흘러가고 "깼어요"/"수유 끝" 버튼이 있어요. 버튼을 누르면 Face ID 뒤 앱이 열리며 그 시각으로 기록돼요.
- 배우자 기록: 앱을 열어 둘 때는 바로, 앱이 꺼져 있으면 위젯이 15분쯤마다 알림 서버(`push-server` `/summary`)에서 최신 요약을 받아 바뀌어요. 아이폰은 갤럭시처럼 푸시로 즉시 바꾸려면 Apple 푸시 키가 필요해서 지금은 이 방식이에요.
- **아직 없는 것**: Siri, 광고. 광고(AdMob)는 스토어 출시 때 붙여요.

## 주의: 기록 저장 공간이 Safari와 따로예요

아이폰은 Safari 웹앱과 이 앱의 저장 공간을 나눠요. 그래서 앱을 처음 열면 빈 화면이에요.
첫 화면에서 **초대코드로 참여**하면 Firebase에서 기록이 내려와요(갤럭시 앱을 처음 열었을 때와 같아요). 또는 Safari 웹앱에서 백업한 파일을 불러와도 돼요.

## 빌드하는 곳

- `codemagic.yaml`(저장소 맨 위): Codemagic 무료 구간(Mac 클라우드)에서 서명하고 TestFlight에 올려요. main에 아이폰 쪽 코드(`ios-app/`, `bridge.js`, `codemagic.yaml`)가 바뀌어 올라오면 자동으로 빌드해요. 웹앱만 바뀌면 빌드하지 않아요.
- `.github/workflows/ios.yml`: 코드가 빌드되는지만 GitHub Actions(공개 저장소라 무료)에서 확인해요. 서명·업로드는 안 해요.
- Xcode 프로젝트는 `project.yml`로 빌드할 때 만들어요(XcodeGen). 그래서 `.xcodeproj`는 저장소에 없어요.

번들 ID는 갤럭시 앱과 같은 `kr.babylog.app`이에요. Apple에서 이미 누가 쓰고 있다고 하면 `project.yml`과 `codemagic.yaml` 두 곳을 같이 바꿔요.

## 처음 준비 (사용자가 직접 할 일)

[SETUP.md](SETUP.md)에 가입부터 아이폰 설치까지 단계별로 정리돼 있어요.

## 웹앱과 연결되는 지점

갤럭시 앱과 같은 이름을 써요. 바꾸면 양쪽 앱이 같이 멈춰요.

| 웹앱 쪽 | 쓰는 곳 |
|---|---|
| `window.BabyApp.refresh()` | 앱으로 돌아올 때 화면 새로 그림 |
| `<a download>` 백업 저장 | 공유 창으로 넘김 |
| `alert`·`confirm`·`prompt` | 아이폰 알림창 |
| 사용자 에이전트 `BabylogIOS/빌드번호` | 웹앱이 아이폰 앱인지 알고 싶을 때 |

웹앱과 잇는 코드는 갤럭시 앱의 `android-app/app/src/main/assets/bridge.js`를 그대로 넣어요(빌드 때 같이 묶음). 아이폰 쪽 `window.BabyNative`는 `update`·`shareFile`·`shareText`·`copy`만 있어요(광고 `adZone`, 빅스비 `voiceHelp`는 없어서 웹앱이 그 메뉴를 숨김). bridge.js에서 `BabyNative`의 새 기능을 부르면 `WebViewController.swift`의 대역에도 넣어야 해요.

## 위젯 서명

위젯은 앱과 따로 App ID(`kr.babylog.app.widget`)와 배포 프로필이 필요해요. `codemagic.yaml`의 "위젯 서명 준비" 단계가 Codemagic에 연결한 API 키로 없으면 만들고 있으면 받아 써요. 앱과 위젯은 공유 키체인(`kr.babylog.shared`)으로 요약을 나눠서 App Group 설정이 필요 없어요.
