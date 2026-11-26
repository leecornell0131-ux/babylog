import UIKit
import GoogleMobileAds

// 화면 맨 위 배너 광고 (AdMob). 갤럭시 앱 Ads.kt와 같은 규칙:
// - 띄워도 되는 화면인지는 bridge.js(갤럭시와 같은 파일)가 adZone으로 알려 줌:
//   "오늘"·"기록"·"내보내기" 탭의 맨 위에서만, 입력 창이 열려 있지 않을 때, 광고를 끄지 않았을 때
//   (개발자 모드에서 끔·얼리버드 테스터 코드 = 웹앱 localStorage 'babylog-v1-ads' = '0')
// - 밤(21시~7시)에는 끔 (bridge.js가 1분마다 다시 물어봐서 밤이 되면 내려감)
// - 건강 기록으로 맞춤 광고하지 않게 비맞춤(npa=1)으로만 요청. 그래서 추적 허용 팝업(ATT)도 띄우지 않음
// - 광고 내용 등급은 전체 이용가(G)까지만
enum Ads {
    // App Store에서 받은 앱에서만 실제 광고. TestFlight(애플 심사 포함)에서는 구글 테스트 배너(눌러도 문제없음).
    // 그래서 빌드 하나로 TestFlight 확인 → 그대로 심사 제출이 됨. 갤럭시는 Ads.kt의 USE_REAL 스위치(Play 정식 출시 전이라 아직 false)
    static let useReal: Bool = Bundle.main.appStoreReceiptURL?.lastPathComponent != "sandboxReceipt"
    private static let testUnit = "ca-app-pub-3940256099942544/2934735716" // 구글 공식 아이폰 테스트 배너
    private static let realUnit = "ca-app-pub-7474055336195838/1068578544" // AdMob: BabyNote(iOS) home_banner
    static var unit: String { useReal ? realUnit : testUnit }
    private static var started = false

    static func night() -> Bool {
        let h = Calendar.current.component(.hour, from: Date())
        return h >= 21 || h < 7
    }

    // 광고를 처음 띄울 때 한 번만 시작 (광고를 안 보는 사람은 SDK도 안 깨움)
    static func start() {
        guard !started else { return }
        started = true
        MobileAds.shared.requestConfiguration.maxAdContentRating = .general
        MobileAds.shared.start()
    }
}

// 웹앱 위에 붙는 광고 칸 (평소엔 숨김). 광고를 받아 온 뒤에만 보여서, 못 받으면 빈 칸이 생기지 않음
final class AdBar: UIView, BannerViewDelegate {
    private let banner = BannerView(adSize: AdSizeBanner)
    private var requested = false
    private var received = false
    private var zone = false

    init(root: UIViewController) {
        super.init(frame: .zero)
        backgroundColor = .systemBackground
        isHidden = true
        banner.adUnitID = Ads.unit
        banner.rootViewController = root
        banner.delegate = self
        banner.translatesAutoresizingMaskIntoConstraints = false
        addSubview(banner)
        NSLayoutConstraint.activate([
            banner.centerXAnchor.constraint(equalTo: centerXAnchor),
            banner.topAnchor.constraint(equalTo: topAnchor),
            banner.widthAnchor.constraint(equalToConstant: 320),
            banner.heightAnchor.constraint(equalToConstant: 50),
            heightAnchor.constraint(equalToConstant: 50),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    // zone: 웹앱이 지금 광고를 띄워도 되는 화면인지 (bridge.js가 알려 줌)
    func show(_ zone: Bool) {
        self.zone = zone && !Ads.night()
        if self.zone && !requested {
            requested = true
            Ads.start()
            let req = Request()
            let extras = Extras()
            extras.additionalParameters = ["npa": "1"]
            req.register(extras)
            banner.load(req)
        }
        isHidden = !(self.zone && received)
    }

    func bannerViewDidReceiveAd(_ bannerView: BannerView) {
        received = true
        isHidden = !zone
    }

    // 못 받았으면 숨기고, 다음에 광고 자리로 돌아올 때 다시 요청
    func bannerView(_ bannerView: BannerView, didFailToReceiveAdWithError error: Error) {
        requested = false
        isHidden = true
    }
}
