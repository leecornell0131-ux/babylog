# 아이폰 앱 테스트 준비 (Mac 없이)

아이폰 앱 코드와 클라우드 빌드 설정은 만들어 두었어요. 아래는 **직접 하셔야 하는 일**이에요. 모두 PC 브라우저와 아이폰에서 버튼만 누르면 되고, 터미널은 쓰지 않아요.

## 먼저 알아 두실 것

- **돈이 드는 단계는 1번 하나예요.** Apple 개발자 프로그램 연 $99. 이게 없으면 아이폰에 직접 만든 앱을 설치할 방법이 없어요(Mac 없이 무료로 설치하는 길은 없어요). 나머지(Codemagic 빌드, TestFlight)는 무료예요.
- Codemagic 무료 구간은 한 달에 Mac 빌드 500분이에요. 한 번 빌드에 10~15분 정도라 넉넉해요. 화면은 웹앱이라 웹앱을 고칠 때는 다시 빌드할 필요가 없어요.
- 아이폰 앱은 Safari 웹앱과 기록 저장 공간이 따로예요. 앱을 처음 열면 빈 화면이니 **초대코드로 참여**하세요(갤럭시 앱 처음 열 때와 같아요).
- 아이폰 앱에서 아직 안 되는 것: 홈 화면 위젯, Siri, 잠금화면 타이머(Mac이 생기면 추가), 광고(스토어 출시 때 추가).

## 1. Apple 개발자 프로그램 가입 (연 $99, 결제)

1. 아이폰 App Store에서 **Apple Developer** 앱을 받아요.
2. 앱을 열고 로그인(평소 쓰는 Apple ID) → **계정** 탭 → **지금 등록하기**.
3. 개인(Individual)으로 진행하고, 이름·주소는 영문으로 신분증과 같게 적어요.
4. 결제는 앱 안에서 연간 구독으로 돼요. 승인까지 보통 하루 이틀 걸리고, 끝나면 메일이 와요.

> 결제 전에 한 번 더: 매년 자동 갱신돼요. 테스트만 하고 그만두려면 아이폰 설정 > Apple ID > 구독에서 자동 갱신을 꺼 두세요.

## 2. 앱 ID 등록 (developer.apple.com)

1. PC에서 https://developer.apple.com/account 접속 → **Certificates, IDs & Profiles** → **Identifiers** → 파란 **+**.
2. **App IDs** → **App** → Continue.
3. Description: `Babylog`, Bundle ID: **Explicit**에 `kr.babylog.app` → Continue → Register.
   - "이미 사용 중"이라고 나오면 저에게 알려 주세요. 다른 이름으로 바꿔 드릴게요.

## 3. App Store Connect에 앱 만들기

1. https://appstoreconnect.apple.com → **앱** → 왼쪽 위 **+** → **신규 앱**.
2. 플랫폼 iOS, 이름 `아기로그`(이미 있다고 하면 `아기로그 육아기록`처럼 바꿔요), 기본 언어 한국어, 번들 ID는 방금 만든 `kr.babylog.app`, SKU는 `babylog`, 사용자 액세스는 전체 → 생성.

## 4. API 키 만들기 (Codemagic이 대신 올리게 하는 열쇠)

1. App Store Connect → **사용자 및 액세스** → 위쪽 **통합** 탭 → **App Store Connect API** → **팀 키** → **+**(처음이면 "액세스 요청"을 먼저 눌러요).
2. 이름 `codemagic`, 액세스 **앱 관리(App Manager)** → 생성.
3. **API 키 다운로드**를 눌러 `.p8` 파일을 받아요. **딱 한 번만 받을 수 있어요.** 바탕화면에 잘 두세요.
4. 같은 화면의 **Issuer ID**와 방금 키의 **키 ID**를 메모장에 적어 두세요.

> 이 파일과 숫자는 비밀번호와 같아요. 채팅이나 프로젝트 파일에는 올리지 말고 Codemagic에만 넣어요.

## 5. Codemagic 가입과 저장소 연결 (무료)

1. https://codemagic.io/signup → **GitHub로 가입**(leecornell0131-ux 계정).
2. **Add application** → GitHub → 저장소 `babylog` 선택 → 프로젝트 종류 **Other**(또는 "codemagic.yaml 사용")를 골라요.

## 6. Codemagic에 API 키 넣기

1. Codemagic 왼쪽 아래 팀 이름 → **Team settings** → **Team integrations** → **Developer Portal** → **Connect**.
2. **이름은 꼭 `babylog`** (설정 파일이 이 이름을 찾아요). Issuer ID, Key ID를 붙여 넣고 `.p8` 파일을 올린 뒤 저장.

## 7. 서명 인증서 만들기 (Codemagic 화면에서)

1. Team settings → **codemagic.yaml settings** → **Code signing identities** → **iOS certificates**.
2. **Generate certificate** → 이름 `babylog-dist`, 종류 **Apple Distribution**, API 키는 `babylog` → Create.
3. 다운로드 창이 뜨면 받아 두기만 하면 돼요(Codemagic에 이미 저장돼요).

## 8. 배포용 프로필 만들기 (developer.apple.com)

1. https://developer.apple.com/account → **Profiles** → **+**.
2. Distribution 아래 **App Store Connect** → Continue → App ID `kr.babylog.app` → Continue.
3. 인증서는 7번에서 만든 것(오늘 날짜) 선택 → 이름 `babylog appstore` → Generate. 다운로드는 안 해도 돼요.
4. Codemagic으로 돌아가 Code signing identities → **iOS provisioning profiles** → **Fetch profiles** → `babylog appstore`에 체크 → 이름 `babylog-appstore` → **Download selected**.

## 9. 첫 빌드

1. Codemagic → babylog 앱 → **Start new build**.
2. 브랜치는 `main`(아직 PR이 합쳐지기 전이면 `claude/project-thread-uyw675`), 워크플로 **아이폰 TestFlight** → Start.
3. 15분쯤 뒤 초록 체크가 뜨면 App Store Connect에 올라간 거예요. Apple 쪽 처리에 10~30분 더 걸려요.
   - 빨간 X가 뜨면 화면을 캡처해서 보내 주세요. 원인을 찾아 고칠게요.

## 10. 아이폰에 설치 (TestFlight)

1. App Store Connect → 아기로그 → **TestFlight** 탭 → 왼쪽 **내부 테스트** 옆 **+** → 그룹 이름 `가족` → 본인을 테스터로 추가.
2. 아이폰에 TestFlight 초대 메일이 와요. 이미 깔아 둔 **TestFlight** 앱을 열면 아기로그가 보여요 → **설치**.
3. 앱을 열고 첫 화면에서 **초대코드로 참여**.

새 빌드를 올리면 TestFlight 앱에서 **업데이트**만 누르면 돼요. TestFlight 빌드는 90일 동안 쓸 수 있어요.

## 나중에 (참고)

- 배우자 Apple ID를 테스터로 넣으려면 App Store Connect **사용자 및 액세스**에서 초대하면 내부 테스터가 될 수 있어요. 배우자분은 갤럭시라 지금은 필요 없어요.
- 스토어 정식 출시 때는 Apple 심사가 있어요. 웹앱을 띄우기만 하는 앱은 거절될 수 있어서, 그 전에 위젯·알림 같은 아이폰 기능을 더해야 해요(이 부분은 Mac 확보와 같이 정해요).
