import SwiftUI
import WatchKit

// 베이비노트 애플워치 앱. 손목에서 탭 2번으로 수유·수면·기저귀 기록 (목업 design/워치_애플워치_목업.png).
@main
struct BabylogWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchDelegate.self) var delegate
    @StateObject private var m = WatchModel.shared
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            HomeView()
                .environmentObject(m)
                .onChange(of: phase) { _, p in if p == .active { m.refresh() } }
        }
    }
}

// 워치 연결은 앱이 뒤에서 깨어날 때(폰이 보낸 워치페이스용 요약)도 받아야 해서 앱이 켜지자마자 시작
final class WatchDelegate: NSObject, WKApplicationDelegate {
    func applicationDidFinishLaunching() {
        Task { @MainActor in WatchModel.shared.start() }
    }

    func handle(_ tasks: Set<WKRefreshBackgroundTask>) {
        for t in tasks {
            if let c = t as? WKWatchConnectivityRefreshBackgroundTask {
                // 받은 요약을 저장할 시간을 조금 줌
                Task { @MainActor in
                    WatchModel.shared.start()
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    c.setTaskCompletedWithSnapshot(false)
                }
            } else {
                t.setTaskCompletedWithSnapshot(false)
            }
        }
    }
}

// MARK: 색 (웹앱과 같은 계열)

extension Color {
    static let feed = Color(red: 0.96, green: 0.60, blue: 0.72)
    static let sleepC = Color(red: 0.56, green: 0.61, blue: 1.0)
    static let poo = Color(red: 0.69, green: 0.49, blue: 0.33)
    static let pee = Color(red: 0.96, green: 0.79, blue: 0.30)
    static let awake = Color(red: 0.49, green: 0.83, blue: 0.99)
    static let ok = Color(red: 0.43, green: 0.91, blue: 0.66)
    static let ink = Color(red: 0.16, green: 0.06, blue: 0.12)
}

// MARK: 첫 화면

struct HomeView: View {
    @EnvironmentObject var m: WatchModel
    @State private var path: [String] = []

    var body: some View {
        NavigationStack(path: $path) {
            TimelineView(.everyMinute) { tl in
                content(now: tl.date)
            }
            .navigationDestination(for: String.self) { k in
                if k == "feed" { FeedView(path: $path) } else { DiaperView(path: $path) }
            }
        }
        .sheet(item: Binding(get: { m.current.map { SheetID(id: $0.id) } }, set: { if $0 == nil { m.commitNow(); m.current = nil } })) { _ in
            DoneView()
        }
    }

    @ViewBuilder
    private func content(now: Date) -> some View {
        let s = m.s
        if let st = BabySummary.date(s?.sleep) {
            TimerScreen(icon: "😴", title: Tr.t("수면 중"), since: st, now: now, color: .sleepC,
                        button: Tr.t("👀 깼어요"), buttonColor: .awake) {
                m.record("stop_sleep", label: Tr.t("👀 깼어요"))
            }
        } else if let ft = BabySummary.date(s?.feed) {
            TimerScreen(icon: "🤱", title: Tr.f("{0} 중", Tr.v(s?.feedLabel ?? "수유") ?? ""), since: ft, now: now, color: .feed,
                        button: Tr.t("수유 끝"), buttonColor: .feed) {
                m.record("stop_feed", label: Tr.t("🍼 수유 끝"))
            }
        } else {
            ScrollView {
                VStack(spacing: 6) {
                    header(now: now)
                    BigButton(icon: "🍼", text: Tr.t("수유"), color: .feed) { path.append("feed") }
                    BigButton(icon: "😴", text: Tr.t("재우기"), color: .sleepC) {
                        m.record("sleep_start", label: Tr.t("🌙 잠듦"))
                    }
                    BigButton(icon: "💩", text: Tr.t("기저귀"), color: .poo) { path.append("diaper") }
                }
            }
            .navigationTitle(Tr.t("베이비노트"))
        }
    }

    @ViewBuilder
    private func header(now: Date) -> some View {
        let s = m.s
        VStack(spacing: 2) {
            if let w = BabySummary.date(s?.lastWake) {
                Text(Tr.f("👀 깬 지 {0}", Fmt.dur(now.timeIntervalSince(w))))
                    .font(.system(size: 17, weight: .bold)).foregroundStyle(Color.awake)
                    .padding(.horizontal, 10).padding(.vertical, 3)
                    .background(Color.awake.opacity(0.18), in: Capsule())
            }
            HStack(spacing: 8) {
                if let f = BabySummary.date(s?.lastFeed) { Text("🍼 " + Tr.f("{0} 전", Fmt.dur(now.timeIntervalSince(f)))) }
                if let d = BabySummary.date(s?.lastDiaper) { Text("💩 " + Tr.f("{0} 전", Fmt.dur(now.timeIntervalSince(d)))) }
            }
            .font(.system(size: 13)).foregroundStyle(.secondary)
            if s == nil {
                Text(Tr.t("폰 앱을 한 번 열어 주세요")).font(.system(size: 13)).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
        }
        .padding(.bottom, 2)
    }
}

struct SheetID: Identifiable { let id: String }

struct BigButton: View {
    let icon: String
    let text: String
    let color: Color
    var height: CGFloat = 52
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Text(icon).font(.system(size: 26))
                Text(text).font(.system(size: 20, weight: .heavy))
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: height)
            .foregroundStyle(Color.ink)
            .background(color, in: RoundedRectangle(cornerRadius: 18))
        }
        .buttonStyle(.plain)
    }
}

// 재우는 중·모유 수유 중
struct TimerScreen: View {
    let icon: String
    let title: String
    let since: Date
    let now: Date
    let color: Color
    let button: String
    let buttonColor: Color
    let action: () -> Void

    var body: some View {
        VStack(spacing: 6) {
            Text(icon + " " + title).font(.system(size: 15)).foregroundStyle(color)
            Text(Tr.f("{0}부터", Fmt.clock(since))).font(.system(size: 13)).foregroundStyle(.secondary)
            Text(Fmt.dur(now.timeIntervalSince(since)))
                .font(.system(size: 40, weight: .heavy, design: .rounded)).minimumScaleFactor(0.6).lineLimit(1)
            Spacer(minLength: 2)
            Button(action: action) {
                Text(button).font(.system(size: 19, weight: .heavy)).foregroundStyle(Color.ink)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(buttonColor, in: RoundedRectangle(cornerRadius: 18))
            }
            .buttonStyle(.plain)
        }
        .background(
            RadialGradient(colors: [color.opacity(0.25), .clear], center: .top, startRadius: 5, endRadius: 160)
                .ignoresSafeArea()
        )
    }
}

// MARK: 수유

struct FeedView: View {
    @EnvironmentObject var m: WatchModel
    @Binding var path: [String]
    @State private var kind = "formula"   // formula·pump·breast
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 4) {
                chip("formula", Tr.t("분유"))
                chip("pump", Tr.t("유축"))
                chip("breast", Tr.t("모유"))
            }
            if kind == "breast" {
                Text(Tr.t("시작할 쪽을 골라 주세요")).font(.system(size: 13)).foregroundStyle(.secondary)
                HStack(spacing: 6) {
                    side("breastL", Tr.t("왼쪽"), Tr.t("모유 왼쪽"))
                    side("breastR", Tr.t("오른쪽"), Tr.t("모유 오른쪽"))
                }
            } else {
                Text("\(Int(m.ml))")
                    .font(.system(size: 50, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color.feed)
                    + Text(" ml").font(.system(size: 18, weight: .bold)).foregroundStyle(Color.feed)
                Text(Tr.t("크라운을 돌려 양 조절")).font(.system(size: 12)).foregroundStyle(.secondary)
                Button {
                    let n = Int(m.ml)
                    let name = kind == "pump" ? Tr.t("유축 수유") : Tr.t("분유")
                    m.feedSub = kind
                    path.removeAll()
                    m.record("feed_ml:\(n):\(kind)", label: "🍼 \(name) \(n)ml")
                } label: {
                    Text("✓ " + Tr.t("저장")).font(.system(size: 19, weight: .heavy)).foregroundStyle(Color.ink)
                        .frame(maxWidth: .infinity, minHeight: 46)
                        .background(Color.feed, in: RoundedRectangle(cornerRadius: 18))
                }
                .buttonStyle(.plain)
            }
        }
        .focusable(kind != "breast")
        .focused($focused)
        .digitalCrownRotation($m.ml, from: 10, through: 300, by: 10, sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
        .onAppear {
            kind = m.feedSub == "pump" ? "pump" : "formula"
            focused = true
        }
        .navigationTitle(Tr.t("수유"))
    }

    private func chip(_ k: String, _ t: String) -> some View {
        Button { kind = k; if k != "breast" { focused = true } } label: {
            Text(t).font(.system(size: 13, weight: .bold))
                .foregroundStyle(kind == k ? Color.ink : .white)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(kind == k ? Color.feed : Color.white.opacity(0.15), in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private func side(_ sub: String, _ t: String, _ label: String) -> some View {
        Button {
            path.removeAll()
            m.record("feed_start:\(sub)", label: "🤱 " + label)
        } label: {
            Text(t).font(.system(size: 18, weight: .heavy)).foregroundStyle(Color.ink)
                .frame(maxWidth: .infinity, minHeight: 64)
                .background(Color.feed, in: RoundedRectangle(cornerRadius: 18))
        }
        .buttonStyle(.plain)
    }
}

// MARK: 기저귀

struct DiaperView: View {
    @EnvironmentObject var m: WatchModel
    @Binding var path: [String]

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                BigButton(icon: "💦", text: Tr.t("소변"), color: .pee, height: 56) { go("pee", "💦 " + Tr.t("소변")) }
                BigButton(icon: "💩", text: Tr.t("대변"), color: .poo, height: 56) { go("poo", "💩 " + Tr.t("대변")) }
                BigButton(icon: "💦💩", text: Tr.t("둘 다"), color: .pee, height: 56) { go("both", "💦💩 " + Tr.t("소변+대변")) }
            }
        }
        .navigationTitle(Tr.t("기저귀"))
    }

    private func go(_ a: String, _ label: String) {
        path.removeAll()
        m.record(a, label: label)
    }
}

// MARK: 저장 확인 (5초 안에 되돌리기)

struct DoneView: View {
    @EnvironmentObject var m: WatchModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: m.state == .undone ? "arrow.uturn.backward" : "checkmark")
                .font(.system(size: 34, weight: .heavy))
                .foregroundStyle(m.state == .undone ? Color.secondary : Color.ok)
                .frame(width: 66, height: 66)
                .background((m.state == .undone ? Color.gray : Color.ok).opacity(0.18), in: Circle())
            Text(m.current?.label ?? "").font(.system(size: 17, weight: .heavy)).multilineTextAlignment(.center)
            Text(status).font(.system(size: 13)).foregroundStyle(.secondary).multilineTextAlignment(.center)
            if case .waiting(let n) = m.state {
                Button { m.undo() } label: {
                    Text("↶ " + Tr.f("되돌리기 {0}초", String(n))).font(.system(size: 15, weight: .bold))
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .background(Color.white.opacity(0.15), in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
            }
        }
        .task(id: m.state) {
            // 저장·취소가 끝나면 잠깐 보여 주고 닫음
            switch m.state {
            case .saved, .undone, .queued:
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                if !Task.isCancelled { m.current = nil; dismiss() }
            default: break
            }
        }
    }

    private var status: String {
        switch m.state {
        case .waiting: return Tr.t("곧 저장돼요")
        case .sending: return Tr.t("폰에 보내는 중")
        case .saved: return Tr.t("저장했어요")
        case .queued: return Tr.t("폰과 연결되면 기록돼요")
        case .undone: return Tr.t("기록하지 않았어요")
        }
    }
}
