import AppIntents
import UIKit

// Siri 음성 기록. 갤럭시 음성 명령(ActionActivity.VOICE, 빅스비 "아기깼어 열어")과 같은 6가지.
// "시리야, 아기로그 아기 깼어"처럼 말하면 앱이 열리며 바로 기록되고, 결과("수면 1시간 5분 기록했어요")를 Siri가 말해 줌.
// 단축어 앱에도 자동으로 생겨서, 이름을 "아기 깼어"로 바꾸면 "시리야, 아기 깼어"만 말해도 됨 (빅스비 빠른 명령어와 같음)

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

struct VoiceFeedIntent: AppIntent {
    static var title: LocalizedStringResource = "수유시작"
    static var description = IntentDescription("지난번과 같은 수유로 타이머 시작")
    static var openAppWhenRun: Bool = true
    func perform() async throws -> some IntentResult & ProvidesDialog { .result(dialog: "\(await VoiceRunner.run("feed_start"))") }
}

struct VoiceFeedEndIntent: AppIntent {
    static var title: LocalizedStringResource = "수유끝"
    static var description = IntentDescription("진행 중인 수유 끝내기")
    static var openAppWhenRun: Bool = true
    func perform() async throws -> some IntentResult & ProvidesDialog { .result(dialog: "\(await VoiceRunner.run("stop_feed"))") }
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
        AppShortcut(intent: VoiceFeedIntent(), phrases: ["\(.applicationName) 수유 시작", "\(.applicationName) 수유시작"],
                    shortTitle: "수유시작", systemImageName: "drop")
        AppShortcut(intent: VoiceFeedEndIntent(), phrases: ["\(.applicationName) 수유 끝", "\(.applicationName) 수유끝"],
                    shortTitle: "수유끝", systemImageName: "checkmark.circle")
        AppShortcut(intent: VoicePeeIntent(), phrases: ["\(.applicationName) 소변", "\(.applicationName) 소변 기록", "\(.applicationName) 소변기록"],
                    shortTitle: "소변기록", systemImageName: "drop.fill")
        AppShortcut(intent: VoicePooIntent(), phrases: ["\(.applicationName) 대변", "\(.applicationName) 대변 기록", "\(.applicationName) 대변기록"],
                    shortTitle: "대변기록", systemImageName: "circle.fill")
    }
}

// 음성으로 들어온 동작을 웹앱에 넣고, bridge.js가 돌려준 문구를 Siri가 읽을 말로 바꿈
@MainActor
enum VoiceRunner {
    static func run(_ action: String) async -> String {
        let at = Date()
        // 앱이 막 켜졌으면 웹앱이 준비될 때까지 기다림 (최대 10초)
        for _ in 0..<20 {
            if let vc = (UIApplication.shared.delegate as? AppDelegate)?.window?.rootViewController as? WebViewController,
               let r = await vc.tryAction(action, at: at) {
                return spoken(r.isEmpty ? "기록했어요" : r)
            }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        // 그래도 안 되면 웹앱이 열린 뒤 넣음
        ((UIApplication.shared.delegate as? AppDelegate)?.window?.rootViewController as? WebViewController)?.runAction(action, at: at)
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
        return out
    }
}
