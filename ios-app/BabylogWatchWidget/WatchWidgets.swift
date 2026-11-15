import SwiftUI
import WidgetKit

// 애플워치 워치페이스 칸(컴플리케이션)·스마트 스택. 누르면 워치 앱이 열림.
// 워치 앱이 저장한 요약(SharedStore)과 알림 서버의 가족 요약 중 새것을 씀 (아이폰 위젯과 같은 방식).
struct WEntry: TimelineEntry {
    let date: Date
    let s: BabySummary?
}

struct WProvider: TimelineProvider {
    func placeholder(in context: Context) -> WEntry { WEntry(date: Date(), s: .sample) }

    func getSnapshot(in context: Context, completion: @escaping (WEntry) -> Void) {
        completion(WEntry(date: Date(), s: SharedStore.summary ?? .sample))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<WEntry>) -> Void) {
        Task {
            let s = await RemoteSummary.newest()
            let now = Date()
            let start = Date(timeIntervalSince1970: floor(now.timeIntervalSince1970 / 60) * 60)
            // 5분마다 숫자를 바꿔 그림 (워치는 새로 그리는 횟수가 정해져 있어서 1분마다는 아님)
            let entries = (0..<36).map { WEntry(date: start.addingTimeInterval(Double($0) * 300), s: s) }
            completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(30 * 60))))
        }
    }
}

private let awakeC = Color(red: 0.49, green: 0.83, blue: 0.99)
private let sleepC = Color(red: 0.56, green: 0.61, blue: 1.0)
private let feedC = Color(red: 0.96, green: 0.60, blue: 0.72)

// "1h05" (칸이 좁아서)
private func short(_ sec: TimeInterval) -> String {
    let m = max(0, Int(sec / 60))
    return m >= 60 ? "\(m / 60)h" + String(format: "%02d", m % 60) : "\(m)m"
}

struct WView: View {
    @Environment(\.widgetFamily) var family
    let e: WEntry

    private var sleeping: Date? { BabySummary.date(e.s?.sleep) }
    private var woke: Date? { BabySummary.date(e.s?.lastWake) }
    private var fed: Date? { BabySummary.date(e.s?.lastFeed) }

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Text(sleeping != nil ? "😴" : "👀").font(.system(size: 14))
                    Text(main).font(.system(size: 13, weight: .bold)).minimumScaleFactor(0.6)
                }
            }
            .widgetAccentable()
        case .accessoryCorner:
            Text(sleeping != nil ? "😴" : "👀").font(.system(size: 20))
                .widgetLabel { Text(main) }
        case .accessoryInline:
            Text((sleeping != nil ? "😴 " : "👀 ") + main + (fed.map { " · 🍼 " + short(e.date.timeIntervalSince($0)) } ?? ""))
        default:
            VStack(alignment: .leading, spacing: 2) {
                Text(sleeping != nil ? Tr.f("😴 수면 중 {0}", Fmt.dur(e.date.timeIntervalSince(sleeping!)))
                     : woke.map { Tr.f("👀 깬 지 {0}", Fmt.dur(e.date.timeIntervalSince($0))) } ?? Tr.t("베이비노트"))
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(sleeping != nil ? sleepC : awakeC)
                if let f = fed {
                    Text("🍼 " + Tr.f("{0} 전", Fmt.dur(e.date.timeIntervalSince(f))) + (Tr.v(e.s?.lastFeedAmt).map { " · " + $0 } ?? ""))
                        .font(.system(size: 13)).foregroundStyle(feedC)
                }
                if let d = BabySummary.date(e.s?.lastDiaper) {
                    Text("💩 " + Tr.f("{0} 전", Fmt.dur(e.date.timeIntervalSince(d))) + (Tr.v(e.s?.lastDiaperText).map { " · " + $0 } ?? ""))
                        .font(.system(size: 13)).foregroundStyle(.secondary)
                }
                if e.s == nil { Text(Tr.t("폰 앱을 한 번 열어 주세요")).font(.system(size: 12)) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var main: String {
        if let st = sleeping { return short(e.date.timeIntervalSince(st)) }
        if let w = woke { return short(e.date.timeIntervalSince(w)) }
        return "--"
    }
}

@main
struct BabylogWatchWidgets: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "babylog.watch", provider: WProvider()) { e in
            WView(e: e).containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("BabyNote")
        .description(Tr.t("깨어 있는 시간"))
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
    }
}
