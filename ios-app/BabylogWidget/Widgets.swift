import SwiftUI
import WidgetKit

// 아기로그 아이폰 위젯. 갤럭시 위젯(android-app QuickWidget.kt, res/layout/widget_*.xml)과 종류·글자·색·버튼을 똑같이 맞춤.
// 데이터: 앱이 저장한 요약(공유 키체인) + 알림 서버의 최신 요약(배우자 기록) 중 최근 것.
// 버튼만 기록하고(BabyActionIntent, 갤럭시 위젯 버튼과 같은 동작 이름) 나머지 자리를 누르면 앱만 열림.

@main
struct BabylogWidgets: WidgetBundle {
    var body: some Widget {
        QuickWidget()
        FeedTimerWidget()
        LastFeedWidget()
        SleepWidget()
        DiaperWidget()
        TodayWidget()
        TimerLiveActivity()
    }
}

// 갤럭시 res/values/colors.xml 과 같은 색
enum Palette {
    static func hex(_ v: UInt32) -> Color {
        Color(red: Double(v >> 16 & 0xFF) / 255, green: Double(v >> 8 & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
    static let bg = Color.white
    static let ink = hex(0x1B1F3B)
    static let sub = hex(0x6A6F8A)
    static let band = hex(0x3B49B8)
    static let accent = hex(0x3B49B8)
    static let feed = hex(0xD6457A)
    static let feedBg = hex(0xFCE1EB)
    static let sleep = hex(0x7457D6)
    static let sleepBg = hex(0xECE5FB)
    static let diaper = hex(0x23917F)
    static let diaperBg = hex(0xDDF3EE)
    static let pooBg = hex(0xF3E6D8)
    static let wake = hex(0xB7791F)
    static let wakeBg = hex(0xFFF1D6)
}

struct BabyEntry: TimelineEntry {
    let date: Date
    let s: BabySummary
}

struct BabyProvider: TimelineProvider {
    func placeholder(in context: Context) -> BabyEntry { BabyEntry(date: Date(), s: .sample) }

    func getSnapshot(in context: Context, completion: @escaping (BabyEntry) -> Void) {
        completion(BabyEntry(date: Date(), s: context.isPreview ? .sample : (SharedStore.summary ?? .empty)))
    }

    // 1분마다 그림을 미리 만들어 두고("1h 05m 전" 같은 글자), 15분 뒤 다시 서버에서 받아 옴. 시계 숫자는 저절로 흘러감
    func getTimeline(in context: Context, completion: @escaping (Timeline<BabyEntry>) -> Void) {
        Task {
            let s = await RemoteSummary.newest() ?? .empty
            let now = Date()
            let start = Date(timeIntervalSince1970: floor(now.timeIntervalSince1970 / 60) * 60)
            let entries = (0..<90).map { BabyEntry(date: start.addingTimeInterval(Double($0) * 60), s: s) }
            completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(15 * 60))))
        }
    }
}

// MARK: 공통 계산 (갤럭시 Widgets.Data 와 같음)

extension BabySummary {
    static let empty = BabySummary(at: 0, name: nil, sleep: nil, feed: nil, feedLabel: nil, lastFeed: nil, lastFeedText: nil,
                                   lastFeedAmt: nil, lastFeedSub: nil, birth: nil, feedGap: nil, lastWake: nil, lastDiaper: nil,
                                   lastDiaperText: nil, day: nil, tFeeds: nil, tMl: nil, tPee: nil, tPoo: nil, tSleep: nil, fid: nil, sleeps: nil)

    var babyName: String { (name ?? "").isEmpty ? "아기" : name! }
    var feedName: String { (feedLabel ?? "").isEmpty ? "수유" : feedLabel! }
    var sleepAt: Date? { BabySummary.date(sleep) }
    var feedAt: Date? { BabySummary.date(feed) }
    var lastFeedAt: Date? { BabySummary.date(lastFeed) }
    var lastDiaperAt: Date? { BabySummary.date(lastDiaper) }
    var wakeAt: Date? { sleep == nil ? BabySummary.date(lastWake) : nil }

    func today(_ v: Double?, _ now: Date) -> Int { isToday(now) ? Int(v ?? 0) : 0 }

    // 오늘 수면 합계(초). 진행 중인 잠은 오늘 0시 이후 부분만 더함
    func todaySleep(_ now: Date) -> TimeInterval {
        var t = isToday(now) ? (tSleep ?? 0) / 1000 : 0
        if let st = sleepAt { t += now.timeIntervalSince(max(st, Calendar.current.startOfDay(for: now))) }
        return t
    }

    // 어제 수면(초): 어제 아침 7시~오늘 아침 7시에 시작한 잠의 합. 그 사이 시작한 잠이 아직 이어지면 live
    func yesterdaySleep(_ now: Date) -> (total: TimeInterval, live: Bool)? {
        guard let list = sleeps, list.hasPrefix("m:") else { return nil }
        let cal = Calendar.current
        var b1 = cal.date(bySettingHour: 7, minute: 0, second: 0, of: now)!
        if cal.component(.hour, from: now) < 7 { b1 = cal.date(byAdding: .day, value: -1, to: b1)! }
        let b0 = cal.date(byAdding: .day, value: -1, to: b1)!
        let ref = floor(at / 60_000) * 60   // 요약을 만든 시각(초, 분 단위로 내림)
        var sum: TimeInterval = 0
        for p in list.dropFirst(2).split(separator: ",") {
            let ab = p.split(separator: "-")
            guard ab.count == 2, let a = Double(ab[0]), let b = Double(ab[1]) else { continue }
            let st = Date(timeIntervalSince1970: ref - a * 60), en = Date(timeIntervalSince1970: ref - b * 60)
            if st >= b0 && st < b1 { sum += max(0, en.timeIntervalSince(st)) }
        }
        let live = sleepAt.map { $0 >= b0 && $0 < b1 } ?? false
        return (sum + (live ? now.timeIntervalSince(sleepAt!) : 0), live)
    }
}

// 갤럭시 위젯과 같은 글자 꼴
enum WFmt {
    // "0h 25m" (갤럭시 Widgets.dur)
    static func dur(_ sec: TimeInterval) -> String {
        let m = Int((max(0, sec) / 60).rounded())
        return "\(m / 60)h " + String(format: "%02dm", m % 60)
    }

    static func ago(_ d: Date, _ now: Date) -> String {
        now.timeIntervalSince(d) < 60 ? "방금" : dur(now.timeIntervalSince(d)) + " 전"
    }

    private static let hmF: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ko_KR")
        f.dateFormat = "HH:mm"
        return f
    }()

    static func hm(_ d: Date) -> String { hmF.string(from: d) }

    // "생후 24일" / "3개월 24일" (갤럭시 Widgets.age)
    static func age(_ birth: String?, _ now: Date) -> String? {
        guard let birth else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        guard let b = f.date(from: String(birth.prefix(10))) else { return nil }
        let cal = Calendar.current
        var months = 0
        while let n = cal.date(byAdding: .month, value: months + 1, to: b), n <= now { months += 1 }
        let base = cal.date(byAdding: .month, value: months, to: b) ?? b
        let days = Int(now.timeIntervalSince(base) / 86_400)
        return months == 0 ? "생후 \(days)일" : "\(months)개월 \(days)일"
    }
}

// MARK: 공통 모양

// 계속 흘러가는 시계 (갤럭시 Chronometer 처럼 12:34 / 1:23:45)
struct TickClock: View {
    let since: Date
    let size: CGFloat
    var align: TextAlignment = .leading

    var body: some View {
        Text(timerInterval: since...Date.distantFuture, countsDown: false)
            .font(.system(size: size, weight: .bold)).monospacedDigit()
            .foregroundStyle(Palette.ink)
            .multilineTextAlignment(align)
            .lineLimit(1).minimumScaleFactor(0.6)
    }
}

// 기록 버튼 (갤럭시 WidgetBtn: 둥근 색 상자, 진한 글자)
struct WButton: View {
    let title: String
    let bg: Color
    let action: String
    var size: CGFloat = 14

    var body: some View {
        Button(intent: BabyActionIntent(action)) {
            Text(title)
                .font(.system(size: size, weight: .bold))
                .foregroundStyle(Palette.ink)
                .lineLimit(1).minimumScaleFactor(0.6)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(bg, in: RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }
}

extension View {
    func babyCard() -> some View {
        self.containerBackground(for: .widget) { Palette.bg }
            .widgetURL(URL(string: "babylog://open"))
    }

    func wLabel(_ color: Color) -> some View {
        self.font(.system(size: 13, weight: .bold)).foregroundStyle(color).lineLimit(1)
    }
}

// MARK: 1) 빠른 기록: 마지막 수유 후 시간 + 진행 중 수면·수유 + 수유·소변·대변·수면 버튼

struct QuickView: View {
    let e: BabyEntry

    var body: some View {
        let s = e.s
        VStack(spacing: 8) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text((s.lastFeedText ?? "").isEmpty ? "마지막 수유 후" : "마지막 수유 후 · " + s.lastFeedText!).wLabel(Palette.feed)
                    if let lf = s.lastFeedAt { TickClock(since: lf, size: 28) }
                    else { Text("앱을 한 번 열어 주세요").font(.system(size: 15)).foregroundStyle(Palette.ink) }
                }
                Spacer(minLength: 4)
                if let live = s.feedAt ?? s.sleepAt {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(s.feedAt != nil ? s.feedName + " 중" : "수면 중").wLabel(Palette.sleep)
                        TickClock(since: live, size: 20, align: .trailing).frame(maxWidth: 110, alignment: .trailing)
                    }
                }
            }
            .frame(maxHeight: .infinity)
            HStack(spacing: 6) {
                WButton(title: s.feedAt != nil ? "🍼 수유 끝" : "🍼 수유", bg: Palette.feedBg, action: s.feedAt != nil ? "stop_feed" : "feed")
                WButton(title: "💧 소변", bg: Palette.diaperBg, action: "pee")
                WButton(title: "💩 대변", bg: Palette.pooBg, action: "poo")
                WButton(title: s.sleepAt != nil ? "☀️ 깼어요" : "🌙 잠듦", bg: Palette.sleepBg, action: "sleep")
            }
            .frame(height: 44)
        }
        .padding(12)
    }
}

struct QuickWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Quick", provider: BabyProvider()) { e in
            QuickView(e: e).babyCard()
        }
        .configurationDisplayName("빠른 기록")
        .description("마지막 수유 후 지난 시간과 소변·대변·수면 버튼")
        .supportedFamilies([.systemMedium])
        .contentMarginsDisabled()
    }
}

// MARK: 2) 수유 타이머: 마지막 수유 후 시간을 크게, 평소 간격으로 본 다음 수유 시각

struct FeedTimerView: View {
    let e: BabyEntry

    var body: some View {
        let s = e.s
        let since = s.feedAt ?? s.lastFeedAt
        VStack(alignment: .leading, spacing: 6) {
            VStack(alignment: .leading, spacing: 2) {
                Text(s.feedAt != nil ? s.feedName + " 중" : "마지막 수유 후").wLabel(Palette.feed)
                if let since { TickClock(since: since, size: 30) }
                else { Text("아직 기록이 없어요").font(.system(size: 15)).foregroundStyle(Palette.ink) }
                Text(sub(s)).font(.system(size: 13)).foregroundStyle(Palette.sub).lineLimit(2).minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            WButton(title: s.feedAt != nil ? "🍼 수유 끝" : "🍼 수유 기록", bg: Palette.feedBg, action: s.feedAt != nil ? "stop_feed" : "feed", size: 15)
                .frame(height: 40)
        }
        .padding(12)
    }

    func sub(_ s: BabySummary) -> String {
        if let f = s.feedAt { return WFmt.hm(f) + "부터" }
        if let lf = s.lastFeedAt, let g = s.feedGap, g > 0 {
            return "평소 \(WFmt.dur(g / 1000)) 간격 · \(WFmt.hm(lf.addingTimeInterval(g / 1000)))쯤"
        }
        return s.lastFeedText ?? ""
    }
}

struct FeedTimerWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FeedTimer", provider: BabyProvider()) { e in
            FeedTimerView(e: e).babyCard()
        }
        .configurationDisplayName("수유 타이머")
        .description("마지막 수유 후 지난 시간을 크게, 평소 간격으로 본 다음 수유 시각")
        .supportedFamilies([.systemSmall])
        .contentMarginsDisabled()
    }
}

// MARK: 3) 마지막 수유: 아기 이름·월령 띠, 마지막 수유 시각과 양, 몇 시간 전 (+ 잠금화면 위젯)

struct LastFeedView: View {
    @Environment(\.widgetFamily) var family
    let e: BabyEntry

    var body: some View {
        let s = e.s
        switch family {
        case .accessoryInline:
            Text("🍼 " + inline(s))
        case .accessoryCircular:
            VStack(spacing: 0) {
                Text("🍼").font(.system(size: 14))
                Text(s.feedAt != nil ? "수유중" : (s.lastFeedAt.map { Fmt.dur(e.date.timeIntervalSince($0)) } ?? "-"))
                    .font(.system(size: 12, weight: .semibold)).minimumScaleFactor(0.6).lineLimit(1)
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text("🍼 " + inline(s)).font(.headline).lineLimit(1)
                if let lf = s.lastFeedAt {
                    Text(Fmt.clock(lf) + (s.lastFeedText.map { " · " + $0 } ?? "")).font(.caption).lineLimit(1)
                }
            }
        default:
            card(s)
        }
    }

    func inline(_ s: BabySummary) -> String {
        if let f = s.feedAt { return s.feedName + " 중 " + Fmt.dur(e.date.timeIntervalSince(f)) }
        guard let lf = s.lastFeedAt else { return "수유 기록 없음" }
        return Fmt.dur(e.date.timeIntervalSince(lf)) + " 전" + (s.lastFeedAmt.map { " · " + $0 } ?? "")
    }

    func card(_ s: BabySummary) -> some View {
        let breast = s.lastFeedSub == "breastL" || s.lastFeedSub == "breastR"
        let at = s.feedAt ?? s.lastFeedAt
        return VStack(spacing: 0) {
            VStack(spacing: 0) {
                Text(s.babyName).font(.system(size: 14)).lineLimit(1)
                if let age = WFmt.age(s.birth, e.date) { Text(age).font(.system(size: 14)).lineLimit(1) }
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(Palette.band)
            HStack(spacing: 10) {
                Text(breast ? "🤱" : "🍼").font(.system(size: 20))
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(Palette.feedBg))
                    .overlay(Circle().stroke(Palette.feed, lineWidth: 1.5))
                VStack(alignment: .leading, spacing: 0) {
                    Text(at.map { Fmt.clock($0) } ?? "수유 기록 없음")
                        .font(.system(size: 20, weight: .bold)).foregroundStyle(Palette.ink).lineLimit(1).minimumScaleFactor(0.6)
                    let amt = s.feedAt != nil ? s.feedName + " 중" : (s.lastFeedAmt ?? "")
                    if !amt.isEmpty {
                        Text(amt).font(.system(size: 18, weight: .bold)).foregroundStyle(Palette.feed).lineLimit(1).minimumScaleFactor(0.6)
                    }
                }
            }
            .padding(.horizontal, 10)
            .frame(maxHeight: .infinity)
            Text(ago(s)).font(.system(size: 16, weight: .bold)).foregroundStyle(Palette.accent).lineLimit(1).minimumScaleFactor(0.7)
                .padding(.bottom, 10)
        }
    }

    func ago(_ s: BabySummary) -> String {
        if let f = s.feedAt { return WFmt.ago(f, e.date).replacingOccurrences(of: " 전", with: "째") }
        if let lf = s.lastFeedAt { return WFmt.ago(lf, e.date) }
        return "누르면 앱이 열려요"
    }
}

struct LastFeedWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LastFeed", provider: BabyProvider()) { e in
            LastFeedView(e: e).babyCard()
        }
        .configurationDisplayName("마지막 수유")
        .description("아기 이름·월령과 마지막 수유 시각·양, 몇 시간 전인지")
        .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryInline, .accessoryCircular])
        .contentMarginsDisabled()
    }
}

// MARK: 4) 수면·깨어 있는 시간: 자는 중이면 수면 시간, 깨어 있으면 깬 뒤 지난 시간 (+ 잠금화면 위젯)

struct SleepView: View {
    @Environment(\.widgetFamily) var family
    let e: BabyEntry

    var body: some View {
        let s = e.s
        let since = s.sleepAt ?? s.wakeAt
        switch family {
        case .accessoryInline:
            Text(line(s))
        case .accessoryCircular:
            VStack(spacing: 0) {
                Text(s.sleepAt != nil ? "😴" : "👀").font(.system(size: 14))
                Text(since.map { Fmt.dur(e.date.timeIntervalSince($0)) } ?? "-")
                    .font(.system(size: 12, weight: .semibold)).minimumScaleFactor(0.6).lineLimit(1)
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(line(s)).font(.headline).lineLimit(1)
                if !sub(s).isEmpty { Text(sub(s)).font(.caption) }
            }
        default:
            VStack(alignment: .leading, spacing: 6) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(s.sleepAt != nil ? s.babyName + " 수면 중" : "깨어 있는 시간").wLabel(Palette.sleep)
                    if let since { TickClock(since: since, size: 30) }
                    else { Text("아직 기록이 없어요").font(.system(size: 15)).foregroundStyle(Palette.ink) }
                    Text(sub(s)).font(.system(size: 13)).foregroundStyle(Palette.sub).lineLimit(2)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                WButton(title: s.sleepAt != nil ? "☀️ 깼어요" : "🌙 잠듦", bg: Palette.sleepBg, action: "sleep", size: 15)
                    .frame(height: 40)
            }
            .padding(12)
        }
    }

    func sub(_ s: BabySummary) -> String {
        if let st = s.sleepAt { return WFmt.hm(st) + "에 잠듦" }
        if let w = s.wakeAt { return WFmt.hm(w) + "에 깸" }
        return ""
    }

    func line(_ s: BabySummary) -> String {
        if let st = s.sleepAt { return "😴 수면 중 " + Fmt.dur(e.date.timeIntervalSince(st)) }
        if let w = s.wakeAt { return "👀 깬 지 " + Fmt.dur(e.date.timeIntervalSince(w)) }
        return "😴 수면 기록 없음"
    }
}

struct SleepWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Sleep", provider: BabyProvider()) { e in
            SleepView(e: e).babyCard()
        }
        .configurationDisplayName("수면·깨어 있는 시간")
        .description("자는 중이면 수면 시간, 깨어 있으면 깬 뒤 지난 시간과 잠듦·깼어요 버튼")
        .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryInline, .accessoryCircular])
        .contentMarginsDisabled()
    }
}

// MARK: 5) 기저귀: 마지막 기저귀 후 시간 + 소변·대변·둘 다 버튼

struct DiaperView: View {
    let e: BabyEntry

    var body: some View {
        let s = e.s
        HStack(spacing: 6) {
            VStack(alignment: .leading, spacing: 2) {
                Text((s.lastDiaperText ?? "").isEmpty ? "마지막 기저귀 후" : "마지막 \(s.lastDiaperText!) 후").wLabel(Palette.diaper)
                if let d = s.lastDiaperAt { TickClock(since: d, size: 20) }
                else { Text("아직 기록이 없어요").font(.system(size: 15)).foregroundStyle(Palette.ink).lineLimit(1).minimumScaleFactor(0.7) }
            }
            .padding(.leading, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .layoutPriority(1)
            HStack(spacing: 6) {
                WButton(title: "💧 소변", bg: Palette.diaperBg, action: "pee")
                WButton(title: "💩 대변", bg: Palette.pooBg, action: "poo")
                WButton(title: "둘 다", bg: Palette.diaperBg, action: "both")
            }
            .frame(height: 44)
            .frame(maxWidth: .infinity)
        }
        .padding(12)
        .frame(maxHeight: .infinity)
    }
}

struct DiaperWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Diaper", provider: BabyProvider()) { e in
            DiaperView(e: e).babyCard()
        }
        .configurationDisplayName("기저귀")
        .description("마지막 기저귀 후 지난 시간과 소변·대변·둘 다 버튼")
        .supportedFamilies([.systemMedium])
        .contentMarginsDisabled()
    }
}

// MARK: 6) 오늘 요약: 오늘 수유 횟수·양, 최근 수유한 지, 어제 수면 합계, 최근 깬 지

struct TodayView: View {
    let e: BabyEntry

    var body: some View {
        let s = e.s
        let ml = s.today(s.tMl, e.date)
        let y = s.yesterdaySleep(e.date)
        let slept = y?.total ?? s.todaySleep(e.date)
        let sleepLive = y.map { $0.live } ?? (s.sleepAt != nil)
        let since = s.sleepAt ?? s.wakeAt
        VStack(alignment: .leading, spacing: 4) {
            Text("오늘 · " + s.babyName).font(.system(size: 14, weight: .bold)).foregroundStyle(Palette.ink).lineLimit(1)
                .padding(.leading, 4)
            HStack(spacing: 8) {
                tile("🍼 오늘 수유", Palette.feed, Palette.feedBg) {
                    value("\(s.today(s.tFeeds, e.date))회" + (ml > 0 ? " · \(ml)ml" : ""))
                }
                tile("⏱ 최근 수유한 지", Palette.feed, Palette.feedBg) {
                    if let lf = s.lastFeedAt { TickClock(since: lf, size: 17) } else { value("기록 없음") }
                }
            }
            HStack(spacing: 8) {
                tile(y != nil ? "🌙 어제 수면" : "🌙 오늘 수면", Palette.sleep, Palette.sleepBg) {
                    value(slept > 0 ? WFmt.dur(slept) + (sleepLive ? " 💤" : "") : "기록 없음")
                }
                tile(s.sleepAt != nil ? "🌙 잠든 지" : "👀 최근 깬 지", Palette.wake, Palette.wakeBg) {
                    value(since.map { WFmt.dur(e.date.timeIntervalSince($0)) } ?? "기록 없음")
                }
            }
        }
        .padding(8)
    }

    func value(_ t: String) -> some View {
        Text(t).font(.system(size: 17, weight: .bold)).foregroundStyle(Palette.ink).lineLimit(1).minimumScaleFactor(0.6)
    }

    func tile<V: View>(_ title: String, _ color: Color, _ bg: Color, @ViewBuilder _ content: () -> V) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.system(size: 12, weight: .bold)).foregroundStyle(color).lineLimit(1)
            content()
        }
        .padding(.leading, 12).padding(.trailing, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(bg, in: RoundedRectangle(cornerRadius: 16))
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "Today", provider: BabyProvider()) { e in
            TodayView(e: e).babyCard()
        }
        .configurationDisplayName("오늘 요약")
        .description("오늘 수유 횟수·양, 수면 합계, 마지막 수유 후 시간")
        .supportedFamilies([.systemMedium])
        .contentMarginsDisabled()
    }
}
