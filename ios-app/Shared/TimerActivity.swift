import ActivityKit
import Foundation

// 잠금화면·다이내믹 아일랜드 타이머 (갤럭시 잠금화면 알림 타이머에 해당)
struct BabyTimerAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var start: Date
        var label: String
    }

    var kind: String   // "sleep" 또는 "feed"
    var name: String

    var stopAction: String { kind == "sleep" ? "stop_sleep" : "stop_feed" }
    var stopTitle: String { kind == "sleep" ? "깼어요" : "수유 끝" }
    var icon: String { kind == "sleep" ? "😴" : "🍼" }
}

// 위젯·잠금화면 버튼이 앱을 여는 주소. 앱이 열리면 웹앱에 그 기록을 넣음 (갤럭시 위젯 버튼과 같은 동작 이름)
enum BabyLink {
    static func url(_ action: String) -> URL { URL(string: "babylog://do/\(action)")! }
}
