import Foundation
import Security

// 위젯·잠금화면 타이머에 쓰는 요약. 웹앱 페이지에 넣는 bridge.js(갤럭시 앱과 같은 파일)의 summary()가 만들고,
// 알림 서버(push-server) /summary도 같은 모양으로 돌려줌. 시각은 모두 1970년부터의 밀리초.
struct BabySummary: Codable, Equatable {
    var at: Double
    var name: String?
    var sleep: Double?          // 진행 중 수면 시작
    var feed: Double?           // 진행 중 수유 시작
    var feedLabel: String?
    var lastFeed: Double?
    var lastFeedText: String?
    var lastFeedAmt: String?
    var lastFeedSub: String?
    var birth: String?          // "2026-08-01"
    var feedGap: Double?        // 평소 수유 간격(밀리초)
    var lastWake: Double?
    var lastDiaper: Double?
    var lastDiaperText: String?
    var day: Double?            // 요약을 만든 날의 0시 (오늘 합계가 어느 날 것인지)
    var tFeeds: Double?
    var tMl: Double?
    var tPee: Double?
    var tPoo: Double?
    var tSleep: Double?
    var fid: String?            // 가족코드 (가족 공유를 켰을 때만)

    static func date(_ ms: Double?) -> Date? { ms.map { Date(timeIntervalSince1970: $0 / 1000) } }

    // 요약을 만든 날과 오늘이 다르면 오늘 합계는 0으로 봄
    func isToday(_ now: Date) -> Bool {
        guard let day else { return false }
        return abs(day / 1000 - Calendar.current.startOfDay(for: now).timeIntervalSince1970) < 3600
    }

    static let sample = BabySummary(
        at: Date().timeIntervalSince1970 * 1000, name: "아기", sleep: nil, feed: nil, feedLabel: nil,
        lastFeed: (Date().timeIntervalSince1970 - 5400) * 1000, lastFeedText: "분유 120ml", lastFeedAmt: "120ml",
        lastFeedSub: "formula", birth: nil, feedGap: 3 * 3600 * 1000, lastWake: (Date().timeIntervalSince1970 - 2700) * 1000,
        lastDiaper: (Date().timeIntervalSince1970 - 3600) * 1000, lastDiaperText: "소변",
        day: Calendar.current.startOfDay(for: Date()).timeIntervalSince1970 * 1000,
        tFeeds: 5, tMl: 600, tPee: 4, tPoo: 1, tSleep: 6 * 3600 * 1000, fid: nil)
}

// 앱과 위젯이 같이 읽는 저장소.
// App Group은 Apple 개발자 사이트에서 손으로 만들어야 해서, 설정 없이 되는 공유 키체인(같은 팀 앱끼리)을 씀.
// 두 타깃의 entitlements에 keychain-access-groups 하나만 넣어 그게 기본 그룹이 되게 함.
enum SharedStore {
    private static let service = "kr.babylog.shared"

    static func save(_ data: Data, account: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: account]
        let attrs: [String: Any] = [kSecValueData as String: data,
                                    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]
        if SecItemUpdate(q as CFDictionary, attrs as CFDictionary) == errSecItemNotFound {
            SecItemAdd(q.merging(attrs) { $1 } as CFDictionary, nil)
        }
    }

    static func load(account: String) -> Data? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: account,
                                kSecReturnData as String: true,
                                kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
    }

    static var summary: BabySummary? {
        get { load(account: "summary").flatMap { try? JSONDecoder().decode(BabySummary.self, from: $0) } }
        set { if let v = newValue, let d = try? JSONEncoder().encode(v) { save(d, account: "summary") } }
    }
}

// 배우자가 다른 휴대폰에서 기록한 것은 알림 서버에 올라간 최신 요약을 받아서 반영 (서버는 가족코드로만 조회)
enum RemoteSummary {
    static let worker = "https://babylog-push.leecornell0131.workers.dev"

    static func fetch(fid: String) async -> BabySummary? {
        var c = URLComponents(string: worker + "/summary")!
        c.queryItems = [URLQueryItem(name: "fid", value: fid)]
        guard let url = c.url else { return nil }
        struct Wrap: Decodable { let summary: BabySummary? }
        guard let r = try? await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 8)),
              (r.1 as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return (try? JSONDecoder().decode(Wrap.self, from: r.0))?.summary
    }

    // 이 휴대폰 것과 서버 것 중 더 최근 것. 서버 것이 새로우면 저장해 둠 (가족코드는 이 휴대폰 것을 이어 씀)
    static func newest() async -> BabySummary? {
        let local = SharedStore.summary
        guard let fid = local?.fid, !fid.isEmpty, var remote = await fetch(fid: fid) else { return local }
        // 받는 사이에 앱이 더 새 기록을 저장했거나 가족코드가 바뀌었을 수 있으니 다시 읽어 확인
        let now = SharedStore.summary
        guard now?.fid == fid, remote.at > (now?.at ?? 0) else { return now }
        remote.fid = fid
        SharedStore.summary = remote
        return remote
    }
}

// 시간 표기: 웹앱과 같은 "1h 05m" / "25m"
enum Fmt {
    static func dur(_ sec: TimeInterval) -> String {
        let m = max(0, Int(sec / 60))
        return m >= 60 ? "\(m / 60)h " + String(format: "%02dm", m % 60) : "\(m)m"
    }

    private static let clockF: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ko_KR")
        f.dateFormat = "a h:mm"
        return f
    }()

    static func clock(_ d: Date) -> String { clockF.string(from: d) }

    // 생후 N일(100일 전까지) / N개월
    static func age(_ birth: String?, at now: Date) -> String? {
        guard let birth else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        guard let b = f.date(from: String(birth.prefix(10))) else { return nil }
        let cal = Calendar.current
        let days = (cal.dateComponents([.day], from: cal.startOfDay(for: b), to: cal.startOfDay(for: now)).day ?? 0) + 1
        if days < 100 { return "\(days)일" }
        return "\(cal.dateComponents([.month], from: b, to: now).month ?? 0)개월"
    }
}
