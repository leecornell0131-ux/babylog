import ActivityKit
import BackgroundTasks
import Foundation
import WidgetKit

// 웹앱에서 기록이 바뀔 때마다 들어오는 요약으로 위젯과 잠금화면 타이머를 맞춤.
// 앱이 꺼져 있을 때는 iOS가 가끔 깨워 주는 백그라운드 새로고침에서 알림 서버의 최신 요약(배우자 기록)을 받아 맞춤.
enum NativeSync {
    static let refreshTask = "kr.babylog.app.refresh"
    private static var lastShown: BabySummary?

    // bridge.js가 보낸 요약 (가족코드 fid 포함)
    static func update(json: String, appActive: Bool) {
        guard let data = json.data(using: .utf8),
              let s = try? JSONDecoder().decode(BabySummary.self, from: data) else { return }
        SharedStore.summary = s
        apply(s, canStart: appActive)
    }

    static func apply(_ s: BabySummary, canStart: Bool) {
        // 같은 내용이면(만든 시각만 다르면) 위젯을 다시 그리지 않음
        var a = s, b = lastShown
        a.at = 0
        b?.at = 0
        if a != b { WidgetCenter.shared.reloadAllTimelines() }
        lastShown = s
        LiveTimers.sync(s, canStart: canStart)
    }

    // MARK: 백그라운드 새로고침

    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshTask, using: nil) { task in
            schedule()
            let work = Task {
                // 위젯이 먼저 받아 저장한 요약일 수도 있어서 새로 받았는지와 상관없이 맞춤 (같으면 아무것도 안 바뀜)
                if let s = await RemoteSummary.newest() { apply(s, canStart: false) }
                task.setTaskCompleted(success: true)
            }
            task.expirationHandler = { work.cancel() }
        }
    }

    static func schedule() {
        let r = BGAppRefreshTaskRequest(identifier: refreshTask)
        r.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(r)
    }
}

enum LiveTimers {
    static func sync(_ s: BabySummary, canStart: Bool) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let name = s.name ?? "아기"
        handle("sleep", start: s.sleep, label: "수면 중", name: name, canStart: canStart)
        handle("feed", start: s.feed, label: (s.feedLabel ?? "수유") + " 중", name: name, canStart: canStart)
    }

    private static func handle(_ kind: String, start: Double?, label: String, name: String, canStart: Bool) {
        let acts = Activity<BabyTimerAttributes>.activities.filter { $0.attributes.kind == kind }
        guard let start, let date = BabySummary.date(start) else {
            for a in acts { Task { await a.end(nil, dismissalPolicy: .immediate) } }
            return
        }
        let state = BabyTimerAttributes.ContentState(start: date, label: label)
        if let a = acts.first {
            if a.content.state != state { Task { await a.update(ActivityContent(state: state, staleDate: nil)) } }
            for extra in acts.dropFirst() { Task { await extra.end(nil, dismissalPolicy: .immediate) } }
            return
        }
        // 사용자가 밀어서 지운 타이머는 같은 기록으로 다시 띄우지 않음
        let key = "liveStarted." + kind
        guard canStart, UserDefaults.standard.double(forKey: key) != start else { return }
        UserDefaults.standard.set(start, forKey: key)
        _ = try? Activity.request(attributes: BabyTimerAttributes(kind: kind, name: name),
                                  content: ActivityContent(state: state, staleDate: nil), pushType: nil)
    }
}
