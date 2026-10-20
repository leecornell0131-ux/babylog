# 외부 공유·자동 위젯의 신뢰성과 삐요로그 운영 증거

조사 기준: 2026-10-20. 공식 자료만 사용. 제안은 구현·배포 승인과 다르다.

## 외부 공유와 위젯 자동 갱신에 Cloudflare가 필수인가?

### Takeaway
Cloudflare라는 회사는 필수가 아니다. 상대가 앱을 닫거나 오프라인이어도 기록을 저장하고 나중에 전달하려면 항상 접근 가능한 중간 저장·전달 서비스가 현실적이다. 이는 외부 공유와 위젯 자동 갱신 컨셉을 유지하기 위한 기술 판단이다.

### Cited Findings
- WebRTC 연결은 별도의 신호 교환 채널을 사용하고 ICE에서 STUN/TURN 같은 외부 연결 보조 서비스를 사용한다. 단순 기기간 직접 전송만으로 서버 사용을 완전히 없앤다고 볼 수 없다. — [WebRTC 공식 연결 설명](https://webrtc.org/getting-started/peer-connections)
- Firebase Spark는 결제정보 없이 시작 가능하고 FCM은 무료 제품이다. Cloud Functions 사용은 Blaze 영역이며, Firebase 중심으로 통합한다고 반드시 결제수단 없는 운영이 되는 것은 아니다. — [Firebase 요금제 공식 설명](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- 현재 로컬 인계 문서는 아이폰 Safari/PWA와 배우자 기존 갤럭시 APK를 실제 사용 중이라고 명시한다. D1/중복 생략/15분 조회 제거 개선은 미배포이며, 원격 및 절전 실기기 전달 검증은 남아 있다. 위젯 마지막 동기화 시각도 아직 추가하지 않았다. — [프로젝트 인계 문서](../../docs/CLAUDE_SYNC_HANDOFF.md)

### Inferences
- Firebase Spark + Cloudflare 무료 Worker/D1 + FCM은 결제 없는 파일럿 후보이다. 무료 quota 내에서 중간 서버를 쓰는 것이며, 중간 서버가 없는 구조는 아니다.
- Firebase/FCM의 발송용 관리자 자격증명을 휴대폰/웹에 넣지 않고 서버에서 보관해야 한다. 무료 CF Worker는 이런 신뢰할 수 있는 발송 주체 역할을 한다. 통합 서버의 선택은 바꿀 수 있다.
- NAS/집 PC는 외부 클라우드 청구서를 대체할 수 있지만 전기·하드웨어·회선·보안 업데이트·백업·장애 대응이 있으므로 무비용으로 분류하면 안 된다. 고객마다 직접 Firebase 프로젝트/서버를 만들게 하는 방식은 사용자 설정·지원 부담과 가족별 관리 때문에 일반 소비자 사업 기본안으로 적합하지 않다.
- 앱을 열 때만 받기나 같은 와이파이 동기화는 요구를 낮추므로 후보에서 제외한다. 주기 조회를 전부 없애는 것은 신뢰성 근거를 확보한 뒤 결정해야 한다.

### Gaps
- 이 조사에서는 현재 실서비스 quota/실기기 전달성·실제 가구당 서버 원가를 새로 측정하지 않았다. 유료 서버도 단말 OS 제약을 없애지 못한다.

## 자동 갱신을 유지하면서 무엇을 약속할 수 있나?

### Takeaway
자동 동기화는 기본 기능으로 유지하되 모든 상황의 100% 즉시 갱신은 보장할 수 없다. 비용이 0원이든 유료든 마지막 수신 시각, 실패 재전송, 오프라인 복구, 잠금·절전 실기기 검증이 필요하다.

### Cited Findings
- Android FCM normal 메시지는 Doze에서 늦어질 수 있다. high는 즉시 전달을 시도하고 제한된 처리를 허용하지만 시간에 민감한 사용자 표시 알림을 위한 것이다. 사용자에게 알림을 보여주지 않는 high 반복 패턴은 기기별 최근 7일 행동에 따라 normal로 강등될 수 있다. — [Firebase Android 메시지 우선순위](https://firebase.google.com/docs/cloud-messaging/android-message-priority)
- FCM 수신 핸들러의 실행 시간은 수초 수준이다. 긴 추가 작업에는 WorkManager 등의 수명 연장이 필요하다. 따라서 수신 후 비동기 네트워크 작업을 그냥 시작하는 것은 누락 위험이 있다. — [Firebase Android 메시지 처리](https://firebase.google.com/docs/cloud-messaging/android-message-priority)
- WidgetKit 위젯 확장은 화면에 보여도 상시 실행되지 않는다. 자주 보는 위젯의 통상 reload budget은 하루 40~70회이며, 이는 고정 보장 횟수나 정확한 주기를 뜻하지 않는다. 예측 가능한 경과 시간은 dynamic date/timeline을 활용할 수 있다. — [Apple 위젯 최신화 문서](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date)
- Apple은 WWDC25에서 APNs를 통한 WidgetKit push 업데이트를 소개했다. 다른 기기/서버 변경에 적합하지만 push도 budget 적용을 받으며 기회적으로 실행되고 일반 알림이나 timeline의 완전한 대체가 아니다. 현재 자료에는 iOS26 맥락의 기능으로 설명된다. — [Apple WWDC25: What’s new in widgets, 18:12 이후](https://developer.apple.com/videos/play/wwdc2025/278/)
- iOS/iPadOS16.4 이상 홈 화면 웹 앱은 사용자 동작에 따라 권한을 받고 Web Push 및 배지를 쓸 수 있고, Web Push에 Apple Developer Program 가입은 필수가 아니다. 이 기능은 WidgetKit 홈 화면 위젯과 다르다. — [WebKit 공식 Web Push 안내](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- Firestore는 오프라인 변경을 재연결 후 동기화하며 같은 문서에 복수 변경은 last-write-wins다. 이것만으로 업무 의미에 맞는 충돌 정책이 자동 완성되는 것은 아니다. — [Firestore 오프라인 데이터](https://firebase.google.com/docs/firestore/manage-data/enable-offline)

### Inferences
- 조용한 Android 위젯용 high 푸시만 믿고 모든 복구 조회를 없애는 것을 검증 없이 확정 추천하지 말아야 한다. 신규 APK의 poll 제거는 저전력·잠금·네트워크 복귀·푸시 강등/누락 상황에서 검증해야 한다.
- 권장 사용자 경험: 위젯에 마지막 수신 시각 표시, 수동 새로고침 제공, 이벤트 재시도·앱 복귀 동기화, 허용 가능한 보조 복구 경로 검토. 이는 앱을 열 때만 갱신하자는 뜻이 아니라 자동 갱신 실패를 복구하는 장치다.
- iPhone에도 진짜 홈 화면 위젯을 상품 기본 요구로 제공하려면 네이티브 앱+WidgetKit 확장 개발을 따로 고려해야 한다. 현재 PWA에 이미 iOS 위젯이 제공됐다고 쓰지 말 것. 두 플랫폼 전체로 같은 범위를 약속하려면 추가 개발이 필요하다.
- 기록별 고유 ID, 서버 기준 버전/수정 시각, 삭제 tombstone, 재시도 중복 방지, 오래된 위젯 요약 거부를 갖추는 방향을 권장한다. 현재 인계의 클라이언트 at 비교는 시계 오차까지 해결한 것이 아니다.
- 사용자 삐요로그 동시입력 오류 경험은 그 앱 원인 분석이 아니며, 우리 앱에서 같은 오류를 허용한다는 승인도 아니다. 가족이 삭제·재입력하게 만들지 않는 충돌 처리가 필요하다.

### Gaps
- iOS WidgetKit 전용 push의 구체적 최소 OS/개발 entitlement와 구버전 호환 설계는 API availability/구현 단계 재검증 필요. 이 조사에서는 실기기 latency를 측정하지 않았다.
- OS별 자동 갱신을 엄격히 실시간으로 표현할 수 없다. 서버 월 지출 유무와 독립적인 제약이다.

## 삐요로그는 무료 동기화만으로 어떻게 운영되는가?

### Takeaway
공식 자료에서 원격 실시간 공유, 광고, 프리미엄 구독이 함께 확인된다. 따라서 무료 사용자에게 핵심 공유를 제공하면서 광고·유료 기능을 병행하는 모델의 실재 사례이지만, 공개 자료만으로 수익·원가·서버 구조는 알 수 없다.

### Cited Findings
- 공식 사이트는 일/외출로 떨어져 있을 때도 파트너가 기록을 실시간으로 공유할 수 있다고 설명한다. Siri/Alexa, 그래프, PDF 기능도 소개한다. — [삐요로그 공식](https://www.piyolog.com/)
- 개인정보처리방침은 광고 배포 목적과 AdMob 사용 및 광고 이벤트 정보를 명시한다. — [삐요로그 개인정보처리방침](https://www.piyolog.com/privacy.html)
- Apple 공식 앱 소개는 유료 구독으로 제한 테마 색/아이콘, 일기 동영상 업로드 등을 제공한다고 설명한다. — [Apple 공식 삐요로그 소개](https://apps.apple.com/jp/iphone/story/id1584275683)
- 일본 App Store 개발자 등록 페이지에는 프리미엄 월간 ¥400, 연간 ¥3,800이 표시된다. 일본 시장 가격이므로 원화 환산으로 한국 판매가처럼 쓰지 않는다. — [삐요로그 일본 App Store](https://apps.apple.com/jp/app/id1252857347)
- 현재 Google Play 등록 페이지는 프리미엄 대상 이미지 기록(연락장 스크린샷/손글씨 기록 사진 인식) 추가를 공지한다. — [삐요로그 Google Play](https://play.google.com/store/apps/details?id=jp.co.sakabou.piyolog&hl=ja)
- 공식 데이터피드 문서는 무료 1개 feed/24시간/90일 만료와 premium 5개/최대28일/무기한 선택을 구분한다. 일반 부부 동기화의 제한이 아닌 별도 읽기전용 외부 연계 기능이다. — [삐요로그 공식 데이터피드](https://www.piyolog.com/app/piyolog/data_feed/en/index.html)

### Inferences
- 무료 핵심 공유+광고+선택 프리미엄은 가능한 사업 설계 방향이다. 다만 프리미엄도 가진 회사 사례를 광고만으로 흑자를 입증한 것으로 해석하면 안 된다.
- 우리 월2,900원 후보는 시장 검증 가격이 아니다. 삐요로그가 이미 음성/통계/PDF 등을 제공하므로 해당 단어만으로 차별화라 단정할 수 없다.
- 위젯을 자주 쓰는 사람은 앱 내 광고를 덜 볼 수 있으므로 광고 노출을 실제로 측정하고, 구독은 가족 단위 혜택·보호자용 꾸미기/보고서 같은 부가가치로 검증하는 편이 적합하다.

### Gaps
- 한국 App Store 페이지는 도구에서 열리지 않아 현재 한국 원화 가격은 확인하지 못했다. 일본 가격을 한국 가격으로 대체하지 않는다.
- 광고 매출, 구독 전환율, 순이익, 운영비, DB/호스팅 vendor 등은 공식 공개 자료에서 확인하지 못했다.

### 실제 브랜치 FCM 코드 추가 확인 (2026-10-20, 소스만 확인)
- `push-server/worker.js:172`: 모든 summary 발송에 data payload, android HIGH, ttl 900s, collapse_key fid 사용.
- `PushService.kt`: summary이고 가족 ID가 일치하면 Push.apply 호출.
- `Push.kt:102-107`: appliedAt이 오래된 요약은 거부, 최신은 LiveNotify.update와 Widgets.save 호출.
- `LiveNotify.kt`: 진행 중 수면/수유가 있을 때에는 사용자에게 보이는 무음 ongoing 알림을 생성한다. 진행 중 항목이 없거나 이미 종료 처리된 경우에는 기존 알림을 취소한다. 알림 권한 오류는 무시한다.
- 따라서 '이 앱은 모든 푸시가 silent이고 사용자 알림이 전혀 없다'고 단정하면 잘못이다. 반대로 기저귀/과거 기록 수정/타이머 종료/알림 권한 거절 상황까지 모든 HIGH 메시지가 visible 알림을 만든다고도 할 수 없다. 구글이 위젯만 갱신을 어떻게 판정하는지나 실제 강등 유무는 이 소스로 확인되지 않는다. 공식 정책에 맞는 우선순위 구분과 실제 deliveredPriority/절전 전달성 측정이 필요하다.
- 위 정책 위험은 소스 발견이며 실제 장애나 회귀가 재현됐다는 뜻이 아니다. 실사용 배포 상태도 이 연구에서는 확인하지 않았다.
