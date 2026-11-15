import UIKit
import WatchConnectivity
import WidgetKit

// 애플워치와 잇는 곳 (워치 앱: BabylogWatch).
// 워치 → 폰: 워치에서 누른 기록 {id, a, at}. 위젯·Siri와 같은 길(bridge.js __babyQuick)로 웹앱에 넣어서
//   가족 공유·위젯·잠금화면 타이머가 휴대폰에서 누른 것과 똑같이 움직임.
//   폰 앱이 꺼져 있으면 iOS가 앱을 뒤에서 깨워 주고, 그래도 웹앱이 준비 안 되면 모아 뒀다가 앱을 열 때 누른 시각 그대로 넣음.
// 폰 → 워치: 위젯과 같은 요약(BabySummary)과 화면 언어.
final class WatchLink: NSObject, WCSessionDelegate {
    static let shared = WatchLink()

    private struct Item: Codable, Equatable { let id: String; let a: String; let at: Double }
    private let qKey = "watchQueue", doneKey = "watchDone"
    private var draining = false
    private var lastSent: Data?
    private var lastComplication = Date.distantPast

    func start() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    private var ready: Bool {
        let s = WCSession.default
        return WCSession.isSupported() && s.activationState == .activated && s.isPaired && s.isWatchAppInstalled
    }

    // MARK: 폰 → 워치

    func sendSummary() {
        DispatchQueue.main.async { self.pushContext() }
    }

    private func pushContext() {
        guard ready, let s = SharedStore.summary, let data = try? JSONEncoder().encode(s) else { return }
        var cmp = s
        cmp.at = 0
        let key = (try? JSONEncoder().encode(cmp)).map { $0 + Data(Tr.lang.utf8) }
        guard key != lastSent else { return }
        lastSent = key
        let ctx: [String: Any] = ["summary": data, "lang": Tr.lang]
        try? WCSession.default.updateApplicationContext(ctx)
        // 워치페이스 칸이 켜져 있으면 워치를 깨워 바로 그리게 함 (하루 횟수 제한이 있어 5분에 한 번까지만)
        let s2 = WCSession.default
        if s2.isComplicationEnabled, s2.remainingComplicationUserInfoTransfers > 5, Date().timeIntervalSince(lastComplication) > 300 {
            lastComplication = Date()
            s2.transferCurrentComplicationUserInfo(ctx)
        }
    }

    // MARK: 워치 → 폰

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        if message["want"] as? String == "summary" {
            var r: [String: Any] = ["lang": Tr.lang]
            if let s = SharedStore.summary, let d = try? JSONEncoder().encode(s) { r["summary"] = d }
            replyHandler(r)
            return
        }
        guard let item = item(message) else { replyHandler(["ok": false]); return }
        enqueue(item)
        DispatchQueue.main.async {
            self.drainNow(wait: 12) { left in
                replyHandler(["ok": !left.contains(item), "queued": left.contains(item)])
            }
        }
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        guard let item = item(userInfo) else { return }
        enqueue(item)
        DispatchQueue.main.async { self.drainNow(wait: 20) { _ in } }
    }

    private func item(_ m: [String: Any]) -> Item? {
        guard let id = m["id"] as? String, let a = m["a"] as? String, let at = m["at"] as? Double,
              WebViewController.valid(a) else { return nil }
        return Item(id: id, a: a, at: at)
    }

    // MARK: 모아 둔 워치 기록

    private var queue: [Item] {
        get { UserDefaults.standard.data(forKey: qKey).flatMap { try? JSONDecoder().decode([Item].self, from: $0) } ?? [] }
        set { UserDefaults.standard.set(try? JSONEncoder().encode(newValue), forKey: qKey) }
    }

    // 같은 기록이 두 번 오면(바로 보내기 실패 뒤 다시 보냄) 한 번만 넣음
    private var done: [String] {
        get { UserDefaults.standard.stringArray(forKey: doneKey) ?? [] }
        set { UserDefaults.standard.set(Array(newValue.suffix(100)), forKey: doneKey) }
    }

    private func enqueue(_ i: Item) {
        DispatchQueue.main.async {
            guard !self.done.contains(i.id), !self.queue.contains(where: { $0.id == i.id }) else { return }
            // 하루 넘게 못 넣은 것은 버림
            self.queue = self.queue.filter { Date().timeIntervalSince1970 - $0.at / 1000 < 86400 } + [i]
        }
    }

    // 앱이 열리거나 웹앱이 준비됐을 때
    func drain() {
        DispatchQueue.main.async { self.drainNow(wait: 0) { _ in } }
    }

    private var bgTask: UIBackgroundTaskIdentifier = .invalid

    // 웹앱이 준비될 때까지 최대 wait초 기다리며 넣음. 끝나면 남은 것을 돌려줌
    private func drainNow(wait: Double, then: @escaping ([Item]) -> Void) {
        guard !draining else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.drainNow(wait: max(0, wait - 0.5), then: then) }
            return
        }
        guard !queue.isEmpty else { then([]); return }
        draining = true
        if bgTask == .invalid {
            bgTask = UIApplication.shared.beginBackgroundTask(withName: "babylog.watch") { [weak self] in self?.endBg() }
        }
        Task { @MainActor in
            let until = Date().addingTimeInterval(wait)
            var wrote = false
            while true {
                for i in self.queue {
                    guard let web = VoiceRunner.web,
                          await web.tryAction(i.a, at: Date(timeIntervalSince1970: i.at / 1000)) != nil else { break }
                    self.queue = self.queue.filter { $0.id != i.id }
                    self.done = self.done + [i.id]
                    wrote = true
                }
                if self.queue.isEmpty || Date() >= until { break }
                try? await Task.sleep(nanoseconds: 500_000_000)
            }
            self.draining = false
            let left = self.queue
            then(left)
            if wrote {
                // 가족에게 바로 올리고, 올리는 동안 잠깐 더 깨어 있음
                VoiceRunner.web?.flushSync()
                try? await Task.sleep(nanoseconds: 6_000_000_000)
            }
            self.endBg()
        }
    }

    private func endBg() {
        guard bgTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(bgTask)
        bgTask = .invalid
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        if state == .activated { sendSummary() }
    }

    func sessionWatchStateDidChange(_ session: WCSession) {
        lastSent = nil
        sendSummary()
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    // 다른 워치로 바꾸면 다시 연결
    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
}
