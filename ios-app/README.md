# 아기로그 아이폰 앱 (TestFlight 테스트용)

갤럭시 앱과 같은 구조예요. 웹앱(https://leecornell0131-ux.github.io/babylog/)을 앱 안에 그대로 띄워요.

- **화면과 기록 기능은 웹앱과 100% 같아요.** 웹앱을 고치면 이 앱도 다시 빌드하지 않고 다음에 열 때 같이 바뀌어요.
- 가족 공유(초대코드)도 웹앱 코드 그대로라 갤럭시 앱·Safari 웹앱과 기록이 합쳐져요.
- 아이폰 앱에서 따로 챙긴 것
  - 웹앱의 확인 창(삭제할까요? 등)이 아이폰 기본 알림창으로 떠요.
  - 백업 파일 저장은 공유 창으로 떠서 "파일에 저장"이나 카톡으로 보낼 수 있어요.
  - 다른 사이트 링크는 Safari로 열려요. 인터넷이 없으면 "다시 열기" 화면이 떠요.
  - 앱으로 돌아올 때마다 `BabyApp.refresh()`로 배우자 기록을 다시 그려요.
- **아직 없는 것**: 홈 화면 위젯, Siri, 잠금화면 타이머(Live Activity), 광고. 위젯·Siri·Live Activity는 Mac에서 Xcode로 만들어야 해서 Mac 확보 전까지 보류예요. 광고(AdMob)는 스토어 출시 때 붙여요.

## 주의: 기록 저장 공간이 Safari와 따로예요

아이폰은 Safari 웹앱과 이 앱의 저장 공간을 나눠요. 그래서 앱을 처음 열면 빈 화면이에요.
첫 화면에서 **초대코드로 참여**하면 Firebase에서 기록이 내려와요(갤럭시 앱을 처음 열었을 때와 같아요). 또는 Safari 웹앱에서 백업한 파일을 불러와도 돼요.

## 빌드하는 곳

- `codemagic.yaml`(저장소 맨 위): Codemagic 무료 구간(Mac 클라우드)에서 서명하고 TestFlight에 올려요. 자동 시작은 꺼 두었어요. 아이폰 쪽 코드(`ios-app/`)가 바뀔 때만 Codemagic에서 "Start new build"를 누르면 돼요.
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
