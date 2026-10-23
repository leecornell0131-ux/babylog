import SwiftUI
import WidgetKit

// 아기로그 아이폰 위젯. 갤럭시 위젯(QuickWidget.kt)과 같은 요약을 씀.
// 데이터: 앱이 저장한 요약(공유 키체인) + 알림 서버의 최신 요약(배우자 기록) 중 최근 것.
// 버튼은 babylog://do/동작 으로 앱을 열어 기록함 (갤럭시 위젯 버튼과 같은 동작 이름).

@main
struct BabylogWidgets: WidgetBundle {
    var body: some Widget {
        LastFeedWidget()
        SleepWidget()
        TodayWidget()
        QuickWidget()
        TimerLiveActivity()
    }
}

enum Palette {
    static let feed = Color(red: 0.91, green: 0.38, blue: 0.55)
    static let sleep = Color(red: 0.36, green: 0.42, blue: 0.85)
    static let pee = Color(red: 0.85, green: 0.66, blue: 0.0)
    static let poo = Color(red: 0.55, green: 0.37, blue: 0.24)
    static let brand = Color(red: 0.23, green: 0.29, blue: 0.72)
}

struct BabyEntry: TimelineEntry {
    let date: Date
    let s: BabySummary?
}

struct BabyProvider: TimelineProvider {
    func placeholder(in context: Context) -> BabyEntry { BabyEntry(date: Date(), s: .sample) }

    func getSnapshot(in context: Context, completion: @escaping (BabyEntry) -> Void) {
        completion(BabyEntry(date: Date(), s: context.isPreview ? .sample : (SharedStore.summary ?? .sample)))
    }

    // 1분마다 그림을 미리 만들어 두고(지난 시간 표시), 15분 뒤 다시 서버에서 받아 옴
    func getTimeline(in context: Context, completion: @escaping (Timeline<BabyEntry>) -> Void) {
        Task {
            let s = await RemoteSummary.newest()
            let now = Date()
            let start = Date(timeIntervalSince1970: floor(now.timeIntervalSince1970 / 60) * 60)
            let entries = (0..<90).map { BabyEntry(date: start.addingTimeInterval(Double($0) * 60), s: s) }
            completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(15 * 60))))
        }
    }
}

// MARK: 공통 계산

extension BabySummary {
    func since(_ ms: Double?, _ now: Date) -> String? {
        BabySummary.date(ms).map { Fmt.dur(now.timeIntervalSince($0)) }
    }

    // 오늘 수면 합계 (진행 중인 잠은 오늘 0시 이후 부분만 더함)
    func todaySleep(_ now: Date) -> TimeInterval {
        guard isToday(now) else {
            if let st = BabySummary.date(sleep) { return now.timeIntervalSince(max(st, Calendar.current.startOfDay(for: now))) }
            return 0
        }
        var t = (tSleep ?? 0) / 1000
        if let st = BabySummary.date(sleep) { t += now.timeIntervalSince(max(st, Calendar.current.startOfDay(for: now))) }
        return t
    }

    func today(_ v: Double?, _ now: Date) -> Int { isToday(now) ? Int(v ?? 0) : 0 }
}

struct Pill: View {
    let title: String
    let color: Color
    let action: String

    var body: some View {
        Link(destination: BabyLink.url(action)) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, minHeight: 30)
                .background(color.opacity(0.18), in: RoundedRectangle(cornerRadius: 10))
                .foregroundStyle(color)
        }
    }
}

struct EmptyHint: View {
    var body: some View {
        Text("앱을 한 번 열면\n기록이 보여요").font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
    }
}

// MARK: 마지막 수유 (홈 화면 작은 크기 + 잠금화면)

struct LastFeedView: View {
    @Environment(\.widgetFamily) var family
    let e: BabyEntry

    var body: some View {
        if let s = e.s {
            switch family {
            case .accessoryInline:
                Text("🍼 " + inline(s))
            case .accessoryCircular:
                VStack(spacing: 0) {
                    Text("🍼").font(.system(size: 14))
                    Text(s.feed != nil ? "수유중" : (s.since(s.lastFeed, e.date) ?? "-"))
                        .font(.system(size: 12, weight: .semibold)).minimumScaleFactor(0.6).lineLimit(1)
                }
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 1) {
                    Text("🍼 " + inline(s)).font(.headline).lineLimit(1)
                    if let lf = BabySummary.date(s.lastFeed) {
                        Text(Fmt.clock(lf) + (s.lastFeedText.map { " · " + $0 } ?? "")).font(.caption).lineLimit(1)
                    }
                    if let next = nextFeed(s) { Text("다음 수유 " + Fmt.clock(next) + "쯤").font(.caption2).lineLimit(1) }
                }
            default:
                small(s)
            }
        } else {
            EmptyHint()
        }
    }

    func inline(_ s: BabySummary) -> String {
        if let f = s.since(s.feed, e.date) { return "수유 중 " + f }
        guard let t = s.since(s.lastFeed, e.date) else { return "수유 기록 없음" }
        return t + " 전" + (s.lastFeedAmt.map { " · " + $0 } ?? "")
    }

    func nextFeed(_ s: BabySummary) -> Date? {
        guard s.feed == nil, let lf = BabySummary.date(s.lastFeed), let g = s.feedGap else { return nil }
        return lf.addingTimeInterval(g / 1000)
    }

    func small(_ s: BabySummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text([s.name ?? "아기", Fmt.age(s.birth, at: e.date)].compactMap { $0 }.joined(separator: " · "))
                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 0)
            if let f = s.since(s.feed, e.date) {
                Text("수유 중").font(.caption).foregroundStyle(Palette.feed)
                Text(f).font(.system(size: 30, weight: .bold)).foregroundStyle(Palette.feed).minimumScaleFactor(0.6).lineLimit(1)
            } else if let lf = BabySummary.date(s.lastFeed) {
                Text("마지막 수유 " + Fmt.clock(lf)).font(.caption).lineLimit(1).minimumScaleFactor(0.8)
                Text(Fmt.dur(e.date.timeIntervalSince(lf)) + " 전")
                    .font(.system(size: 28, weight: .bold)).foregroundStyle(Palette.feed).minimumScaleFactor(0.6).lineLimit(1)
                if let amt = s.lastFeedText { Text(amt).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            } else {
                Text("수유 기록 없음").font(.headline)
            }
            Spacer(minLength: 0)
            if let next = nextFeed(s) {
                Text("다음 " + Fmt.clock(next) + "쯤").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

struct LastFeedWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LastFeed", provider: BabyProvider()) { e in
            LastFeedView(e: e).containerBackground(for: .widget) { Color(.systemBackground) }
                .widgetURL(URL(string: "babylog://open"))
        }
        .configurationDisplayName("마지막 수유")
        .description("마지막 수유 뒤 지난 시간과 양, 다음 수유 예상 시각")
        .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryInline, .accessoryCircular])
    }
}

// MARK: 수면 (자는 중이면 잔 시간, 깨어 있으면 깬 뒤 시간)

struct SleepView: View {
    @Environment(\.widgetFamily) var family
    let e: BabyEntry

    var body: some View {
        if let s = e.s {
            let asleep = BabySummary.date(s.sleep)
            switch family {
            case .accessoryInline:
                Text(line(s))
            case .accessoryCircular:
                VStack(spacing: 0) {
                    Text(asleep != nil ? "😴" : "👀").font(.system(size: 14))
                    Text((asleep != nil ? s.since(s.sleep, e.date) : s.since(s.lastWake, e.date)) ?? "-")
                        .font(.system(size: 12, weight: .semibold)).minimumScaleFactor(0.6).lineLimit(1)
                }
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 1) {
                    Text(line(s)).font(.headline).lineLimit(1)
                    if let st = asleep { Text(Fmt.clock(st) + "에 잠듦").font(.caption) }
                    else if let w = BabySummary.date(s.lastWake) { Text(Fmt.clock(w) + "에 깸").font(.caption) }
                    Text("오늘 수면 " + Fmt.dur(s.todaySleep(e.date))).font(.caption2)
                }
            default:
                VStack(alignment: .leading, spacing: 4) {
                    Text(asleep != nil ? "😴 자는 중" : "👀 깨어 있음").font(.caption).foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                    Text((asleep != nil ? s.since(s.sleep, e.date) : s.since(s.lastWake, e.date)) ?? "-")
                        .font(.system(size: 30, weight: .bold)).foregroundStyle(Palette.sleep).minimumScaleFactor(0.6).lineLimit(1)
                    Text("오늘 " + Fmt.dur(s.todaySleep(e.date))).font(.caption2).foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                    Pill(title: asleep != nil ? "깼어요" : "잠들었어요", color: Palette.sleep, action: asleep != nil ? "stop_sleep" : "sleep_start")
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .widgetURL(Self.tapURL(e))
            }
        } else {
            EmptyHint()
        }
    }

    // 작은 위젯은 버튼(Link)을 따로 누를 수 없어서 위젯 전체가 "깼어요/잠들었어요" 버튼 (잠금화면 위젯은 앱만 엶)
    static func tapURL(_ e: BabyEntry) -> URL? {
        guard let s = e.s else { return URL(string: "babylog://open") }
        return BabyLink.url(BabySummary.date(s.sleep) != nil ? "stop_sleep" : "sleep_start")
    }

    func line(_ s: BabySummary) -> String {
        if let t = s.since(s.sleep, e.date) { return "😴 자는 중 " + t }
        if let t = s.since(s.lastWake, e.date) { return "👀 깬 지 " + t }
        return "😴 수면 기록 없음"
    }
}

struct SleepWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Sleep", provider: BabyProvider()) { e in
            SleepView(e: e).containerBackground(for: .widget) { Color(.systemBackground) }
        }
        .configurationDisplayName("수면")
        .description("자는 중이면 잔 시간, 깨어 있으면 깬 뒤 지난 시간")
        .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryInline, .accessoryCircular])
    }
}

// MARK: 오늘 요약

struct TodayView: View {
    let e: BabyEntry

    var body: some View {
        if let s = e.s {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("오늘 · " + (s.name ?? "아기")).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    if let t = s.since(s.lastFeed, e.date) { Text("🍼 " + t + " 전").font(.caption).foregroundStyle(Palette.feed) }
                }
                HStack(spacing: 8) {
                    cell("수유", "\(s.today(s.tFeeds, e.date))회", s.today(s.tMl, e.date) > 0 ? "\(s.today(s.tMl, e.date))ml" : " ", Palette.feed)
                    cell("수면", Fmt.dur(s.todaySleep(e.date)), BabySummary.date(s.sleep) != nil ? "자는 중" : " ", Palette.sleep)
                    cell("소변", "\(s.today(s.tPee, e.date))회", " ", Palette.pee)
                    cell("대변", "\(s.today(s.tPoo, e.date))회", " ", Palette.poo)
                }
            }
        } else {
            EmptyHint()
        }
    }

    func cell(_ title: String, _ value: String, _ sub: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(color)
            Text(value).font(.system(size: 17, weight: .bold)).minimumScaleFactor(0.6).lineLimit(1)
            Text(sub).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Today", provider: BabyProvider()) { e in
            TodayView(e: e).containerBackground(for: .widget) { Color(.systemBackground) }
        }
        .configurationDisplayName("오늘 요약")
        .description("오늘 수유 횟수·양, 수면 합계, 소변·대변 횟수")
        .supportedFamilies([.systemMedium])
    }
}

// MARK: 빠른 기록 (버튼을 누르면 앱이 열리며 바로 기록)

struct QuickView: View {
    let e: BabyEntry

    var body: some View {
        let s = e.s
        let asleep = BabySummary.date(s?.sleep) != nil
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                if let s, let f = s.since(s.feed, e.date) {
                    Text("🍼 수유 중 " + f).foregroundStyle(Palette.feed)
                } else if let s, let t = s.since(s.lastFeed, e.date) {
                    Text("🍼 " + t + " 전").foregroundStyle(Palette.feed)
                } else {
                    Text("🍼 수유 기록 없음")
                }
                Spacer()
                if let s, asleep, let t = s.since(s.sleep, e.date) { Text("😴 " + t).foregroundStyle(Palette.sleep) }
            }
            .font(.system(size: 15, weight: .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            Spacer(minLength: 0)
            HStack(spacing: 6) {
                Pill(title: "🍼 수유", color: Palette.feed, action: "feed")
                Pill(title: "💧 소변", color: Palette.pee, action: "pee")
                Pill(title: "💩 대변", color: Palette.poo, action: "poo")
                Pill(title: asleep ? "깼어요" : "😴 잠듦", color: Palette.sleep, action: asleep ? "stop_sleep" : "sleep_start")
            }
        }
    }
}

struct QuickWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Quick", provider: BabyProvider()) { e in
            QuickView(e: e).containerBackground(for: .widget) { Color(.systemBackground) }
        }
        .configurationDisplayName("빠른 기록")
        .description("수유·소변·대변·수면 버튼. 누르면 앱이 열리며 바로 기록돼요")
        .supportedFamilies([.systemMedium])
    }
}
