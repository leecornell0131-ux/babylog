import AppIntents
import UIKit

// Siri 음성 기록. 갤럭시 음성 명령과 같은 말.
// "시리야, 아기로그 아기 깼어" / "시리야, 아기로그 수유 120"처럼 말하면 앱이 열리며 바로 기록되고, 결과("분유 120ml 기록했어요")를 Siri가 말해 줌.
// 앱 이름 없이 "시리야, 루나 깼어"처럼 부르는 단축어는 설정 > 음성 명령의 "Siri에 추가" 버튼으로 만듦 (VoiceSettings.swift)

struct VoiceSleepIntent: AppIntent {
    static var title: LocalizedStringResource = "아기잠듦"
    static var description = IntentDescription("잠든 시각 기록")
    static var openAppWhenRun: Bool = true
    func perform() async throws -> some IntentResult & ProvidesDialog { .result(dialog: "\(await VoiceRunner.run("sleep_start"))") }
}

struct VoiceWakeIntent: AppIntent {
    static var title: LocalizedStringResource = "아기깼어"
    static var description = IntentDescription("자는 기록 끝내기")
    static var openAppWhenRun: Bool = true
    func perform() async throws -> some IntentResult & ProvidesDialog { .result(dialog: "\(await VoiceRunner.run("stop_sleep"))") }
}

// 수유 양 (Siri가 말로 알아듣는 값은 10ml 단위 10~300)
enum FeedAmount: Int, AppEnum {
    case ml10 = 10
    case ml20 = 20
    case ml30 = 30
    case ml40 = 40
    case ml50 = 50
    case ml60 = 60
    case ml70 = 70
    case ml80 = 80
    case ml90 = 90
    case ml100 = 100
    case ml110 = 110
    case ml120 = 120
    case ml130 = 130
    case ml140 = 140
    case ml150 = 150
    case ml160 = 160
    case ml170 = 170
    case ml180 = 180
    case ml190 = 190
    case ml200 = 200
    case ml210 = 210
    case ml220 = 220
    case ml230 = 230
    case ml240 = 240
    case ml250 = 250
    case ml260 = 260
    case ml270 = 270
    case ml280 = 280
    case ml290 = 290
    case ml300 = 300

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "수유 양(ml)"
    static var caseDisplayRepresentations: [FeedAmount: DisplayRepresentation] = [
        .ml10: "10",
        .ml20: "20",
        .ml30: "30",
        .ml40: "40",
        .ml50: "50",
        .ml60: "60",
        .ml70: "70",
        .ml80: "80",
        .ml90: "90",
        .ml100: "100",
        .ml110: "110",
        .ml120: "120",
        .ml130: "130",
        .ml140: "140",
        .ml150: "150",
        .ml160: "160",
        .ml170: "170",
        .ml180: "180",
        .ml190: "190",
        .ml200: "200",
        .ml210: "210",
        .ml220: "220",
        .ml230: "230",
        .ml240: "240",
        .ml250: "250",
        .ml260: "260",
        .ml270: "270",
        .ml280: "280",
        .ml290: "290",
        .ml300: "300"
    ]
}

struct VoiceFeedIntent: AppIntent {
    static var title: LocalizedStringResource = "수유 기록"
    static var description = IntentDescription("지금 시각에 먹은 양으로 수유 기록 (종류는 지난번과 같게)")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "양(ml)", requestValueDialog: "몇 미리 먹었어요?")
    var amount: FeedAmount

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: "\(await VoiceRunner.run("feed_ml", ml: amount.rawValue))")
    }
}

struct VoicePeeIntent: AppIntent {
    static var title: LocalizedStringResource = "소변기록"
    static var description = IntentDescription("기저귀 소변 기록")
    static var openAppWhenRun: Bool = true
    func perform() async throws -> some IntentResult & ProvidesDialog { .result(dialog: "\(await VoiceRunner.run("pee"))") }
}

struct VoicePooIntent: AppIntent {
    static var title: LocalizedStringResource = "대변기록"
    static var description = IntentDescription("기저귀 대변 기록")
    static var openAppWhenRun: Bool = true
    func perform() async throws -> some IntentResult & ProvidesDialog { .result(dialog: "\(await VoiceRunner.run("poo"))") }
}

// Siri에 미리 등록되는 말 (설정 없이 바로 됨). 앱 이름이 꼭 들어가야 함
struct BabyShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: VoiceWakeIntent(), phrases: ["\(.applicationName) 아기 깼어", "\(.applicationName) 아기깼어", "\(.applicationName) 깼어"],
                    shortTitle: "아기깼어", systemImageName: "sun.max")
        AppShortcut(intent: VoiceSleepIntent(), phrases: ["\(.applicationName) 아기 잠듦", "\(.applicationName) 아기잠듦", "\(.applicationName) 잠들었어"],
                    shortTitle: "아기잠듦", systemImageName: "moon")
        AppShortcut(intent: VoiceFeedIntent(), phrases: ["\(.applicationName) 수유 \(\.$amount)", "\(.applicationName) 수유 \(\.$amount) 미리",
                                                          "\(.applicationName) 수유", "\(.applicationName) 수유 기록"],
                    shortTitle: "수유 기록", systemImageName: "drop")
        AppShortcut(intent: VoicePeeIntent(), phrases: ["\(.applicationName) 소변", "\(.applicationName) 소변 기록", "\(.applicationName) 소변기록"],
                    shortTitle: "소변기록", systemImageName: "drop.fill")
        AppShortcut(intent: VoicePooIntent(), phrases: ["\(.applicationName) 대변", "\(.applicationName) 대변 기록", "\(.applicationName) 대변기록"],
                    shortTitle: "대변기록", systemImageName: "circle.fill")
    }
}

// 음성으로 들어온 동작을 웹앱에 넣고, bridge.js가 돌려준 문구를 소리로 읽을 말로 바꿈
@MainActor
enum VoiceRunner {
    static var web: WebViewController? { (UIApplication.shared.delegate as? AppDelegate)?.window?.rootViewController as? WebViewController }

    static func run(_ action: String, ml: Int? = nil) async -> String {
        let at = Date()
        // 앱이 막 켜졌으면 웹앱이 준비될 때까지 기다림 (최대 10초)
        for _ in 0..<20 {
            if let r = await web?.tryAction(action, at: at, ml: ml) { return spoken(r.isEmpty ? "기록했어요" : r) }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        // 그래도 안 되면 웹앱이 열린 뒤 넣음
        web?.runAction(action, at: at, ml: ml)
        return "앱이 열리면 기록돼요"
    }

    // 화면 글자는 "1h 05m"이지만 소리로는 "1시간 5분" (갤럭시 Speak.say와 같음)
    static func spoken(_ text: String) -> String {
        guard let re = try? NSRegularExpression(pattern: "(\\d+)h (\\d+)m") else { return text }
        var out = text
        for m in re.matches(in: text, range: NSRange(text.startIndex..., in: text)).reversed() {
            guard let r = Range(m.range, in: text), let hr = Range(m.range(at: 1), in: text), let mr = Range(m.range(at: 2), in: text),
                  let h = Int(text[hr]), let mi = Int(text[mr]) else { continue }
            let said = [h > 0 ? "\(h)시간" : nil, (mi > 0 || h == 0) ? "\(mi)분" : nil].compactMap { $0 }.joined(separator: " ")
            out.replaceSubrange(r, with: said)
        }
        return out.replacingOccurrences(of: "ml", with: "미리")
    }
}
