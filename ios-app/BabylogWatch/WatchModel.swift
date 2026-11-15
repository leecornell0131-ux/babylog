import Foundation
import WatchConnectivity
import WatchKit
import WidgetKit

// 애플워치 쪽 데이터.
// - 화면에 보이는 요약은 아이폰 앱이 보내 주는 것(위젯과 같은 BabySummary)과, 알림 서버의 가족 최신 요약 중 새것.
// - 누른 기록은 5초 동안 되돌릴 수 있게 기다렸다가 아이폰 앱으로 보냄 (아이폰 앱이 웹앱에 넣어 가족과 공유).
//   폰이 멀리 있으면 워치가 들고 있다가 연결되면 보냄(transferUserInfo). 누른 시각은 그대로.
struct WatchItem: Equatable {
    let id: String
    let a: String          // bridge.js 동작 이름 (WebViewController.valid)
    let at: Date
    let label: String      // "🍼 분유 120ml"
}

enum SendState: Equatable {
    case waiting(Int)      // 되돌리기 남은 초
    case sending
    case saved
    case queued            // 폰과 연결되면 기록됨
    case undone
}

@MainActor
final class WatchModel: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchModel()

    @Published var s: BabySummary? = SharedStore.summary
    @Published var current: WatchItem?
    @Published var state: SendState = .saved
    // 수유 양: 지난번 분유·유축 양
    @Published var ml: Double = 120
    @Published var feedSub: String = "formula"

    private var countdown: Task<Void, Never>?

    override init() {
        super.init()
        let d = UserDefaults.standard
        if d.integer(forKey: "ml") > 0 { ml = Double(d.integer(forKey: "ml")) }
        else if let amt = s?.lastFeedAmt, amt.hasSuffix("ml"), let n = Int(amt.dropLast(2)) { ml = Double(n) }
        if let sub = d.string(forKey: "feedSub") { feedSub = sub }
        else if s?.lastFeedSub == "pump" { feedSub = "pump" }
    }

    func start() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    // 화면을 열 때: 폰에 최신 요약을 묻고, 알림 서버의 가족 요약도 받아 봄
    func refresh() {
        let ses = WCSession.default
        if ses.activationState == .activated, ses.isReachable {
            ses.sendMessage(["want": "summary"], replyHandler: { r in
                Task { @MainActor in self.take(r) }
            }, errorHandler: nil)
        }
        Task {
            if let r = await RemoteSummary.newest() { self.merge(r) }
        }
    }

    // MARK: 기록

    func record(_ a: String, label: String) {
        // 앞의 기록이 아직 되돌리기 시간이면 그건 바로 보냄
        if let c = current, case .waiting = state { send(c) }
        countdown?.cancel()
        let item = WatchItem(id: UUID().uuidString, a: a, at: Date(), label: label)
        current = item
        state = .waiting(5)
        WKHaptic.click()
        countdown = Task {
            for left in stride(from: 4, through: 0, by: -1) {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                if Task.isCancelled { return }
                if left > 0 { state = .waiting(left) }
            }
            if current == item { send(item) }
        }
    }

    func undo() {
        countdown?.cancel()
        state = .undone
    }

    // 5초 기다리지 않고 바로 (확인 화면을 닫을 때)
    func commitNow() {
        guard let c = current, case .waiting = state else { return }
        countdown?.cancel()
        send(c)
    }

    private func send(_ i: WatchItem) {
        state = .sending
        patch(i)
        WKHaptic.success()
        let msg: [String: Any] = ["id": i.id, "a": i.a, "at": i.at.timeIntervalSince1970 * 1000]
        let ses = WCSession.default
        guard ses.activationState == .activated else { state = .queued; return }
        if ses.isReachable {
            ses.sendMessage(msg, replyHandler: { r in
                Task { @MainActor in
                    if self.current == i { self.state = (r["ok"] as? Bool) == true ? .saved : .queued }
                }
            }, errorHandler: { _ in
                // 바로 못 보내면 들고 있다가 연결될 때 보냄 (폰이 같은 id는 한 번만 넣음)
                ses.transferUserInfo(msg)
                Task { @MainActor in if self.current == i { self.state = .queued } }
            })
        } else {
            ses.transferUserInfo(msg)
            state = .queued
        }
    }

    // 폰 답을 기다리지 않고 워치 화면부터 바꿈 (폰이 새 요약을 보내면 그걸로 바뀜)
    private func patch(_ i: WatchItem) {
        var x = s ?? BabySummary.blank
        let ms = i.at.timeIntervalSince1970 * 1000
        let parts = i.a.split(separator: ":").map(String.init)
        switch parts[0] {
        case "sleep_start": x.sleep = ms
        case "stop_sleep": x.sleep = nil; x.lastWake = ms
        case "feed_start":
            x.feed = ms
            x.feedLabel = ["breastL": "모유 왼쪽", "breastR": "모유 오른쪽", "pump": "유축 수유"][parts.count > 1 ? parts[1] : ""] ?? "분유"
        case "stop_feed": if let f = x.feed { x.lastFeed = f; x.lastFeedAmt = nil }; x.feed = nil
        case "feed_ml":
            x.lastFeed = ms
            x.lastFeedAmt = (parts.count > 1 ? parts[1] : "") + "ml"
            x.lastFeedSub = parts.count > 2 ? parts[2] : "formula"
            x.feed = nil
            if let n = Int(parts.count > 1 ? parts[1] : "") {
                UserDefaults.standard.set(n, forKey: "ml")
                UserDefaults.standard.set(x.lastFeedSub, forKey: "feedSub")
            }
        case "pee", "poo", "both":
            x.lastDiaper = ms
            x.lastDiaperText = ["pee": "소변", "poo": "대변", "both": "소변+대변"][parts[0]]
        default: break
        }
        x.at = max(x.at, ms)
        save(x)
    }

    // MARK: 요약 받기

    private func take(_ d: [String: Any]) {
        if let l = d["lang"] as? String { Tr.set(l) }
        if let data = d["summary"] as? Data, let r = try? JSONDecoder().decode(BabySummary.self, from: data) { merge(r) }
    }

    // 더 새 요약만 받음 (방금 워치에서 누른 것보다 오래된 요약이 덮어쓰지 않게)
    private func merge(_ r: BabySummary) {
        if let cur = s, r.at < cur.at { return }
        var r = r
        if r.fid == nil { r.fid = s?.fid }
        save(r)
    }

    private func save(_ x: BabySummary) {
        s = x
        SharedStore.summary = x
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: WCSessionDelegate (워치 연결은 다른 스레드에서 불림)

    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        let ctx = session.receivedApplicationContext
        Task { @MainActor in
            self.take(ctx)
            self.refresh()
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext ctx: [String: Any]) {
        Task { @MainActor in self.take(ctx) }
    }

    // 워치페이스 칸용으로 폰이 보낸 요약
    nonisolated func session(_ session: WCSession, didReceiveUserInfo info: [String: Any]) {
        Task { @MainActor in self.take(info) }
    }
}

extension BabySummary {
    static let blank = BabySummary(at: 0, name: nil, sleep: nil, feed: nil, feedLabel: nil, lastFeed: nil, lastFeedText: nil,
                                   lastFeedAmt: nil, lastFeedSub: nil, birth: nil, feedGap: nil, lastWake: nil, lastDiaper: nil,
                                   lastDiaperText: nil, day: nil, tFeeds: nil, tMl: nil, tPee: nil, tPoo: nil, tSleep: nil, fid: nil, sleeps: nil)
}

enum WKHaptic {
    static func click() { WKInterfaceDevice.current().play(.click) }
    static func success() { WKInterfaceDevice.current().play(.success) }
}
