import AppIntents
import Foundation

// 위젯 버튼 (iOS 17 버튼). 작은 위젯도 버튼만 눌리고 나머지 자리는 앱만 엶 (갤럭시 위젯과 같게).
// 누르면 동작을 저장하고 앱을 열고, 앱이 그 동작을 웹앱에 넣음 (AppDelegate.runPending)
struct BabyActionIntent: AppIntent {
    static var title: LocalizedStringResource = "아기로그 기록"
    static var openAppWhenRun = true
    static var isDiscoverable = false

    @Parameter(title: "동작") var action: String

    init() {}
    init(_ action: String) { self.action = action }

    func perform() async throws -> some IntentResult {
        PendingAction.save(action, at: Date())
        await MainActor.run { NotificationCenter.default.post(name: PendingAction.note, object: nil) }
        return .result()
    }
}
