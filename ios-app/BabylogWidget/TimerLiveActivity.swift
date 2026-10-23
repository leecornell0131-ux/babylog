import ActivityKit
import SwiftUI
import WidgetKit

// 잠금화면·다이내믹 아일랜드 타이머 (수면 중·수유 중). 앱이 시작·끝을 맞춤 (NativeSync.swift)
struct TimerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: BabyTimerAttributes.self) { ctx in
            HStack(spacing: 12) {
                Text(ctx.attributes.icon).font(.system(size: 30))
                VStack(alignment: .leading, spacing: 2) {
                    Text(ctx.attributes.name + " · " + ctx.state.label).font(.subheadline).foregroundStyle(.secondary)
                    timer(ctx.state.start).font(.system(size: 32, weight: .bold)).foregroundStyle(color(ctx.attributes))
                    Text(Fmt.clock(ctx.state.start) + "부터").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Link(destination: BabyLink.url(ctx.attributes.stopAction)) {
                    Text(ctx.attributes.stopTitle)
                        .font(.system(size: 15, weight: .bold))
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(color(ctx.attributes).opacity(0.25), in: Capsule())
                }
            }
            .padding(16)
            .activityBackgroundTint(Color(.systemBackground).opacity(0.85))
        } dynamicIsland: { ctx in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(ctx.attributes.icon + " " + ctx.state.label).font(.subheadline)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    timer(ctx.state.start).font(.title3.bold()).foregroundStyle(color(ctx.attributes))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Link(destination: BabyLink.url(ctx.attributes.stopAction)) {
                        Text(ctx.attributes.stopTitle).font(.headline).frame(maxWidth: .infinity).padding(.vertical, 6)
                            .background(color(ctx.attributes).opacity(0.3), in: Capsule())
                    }
                }
            } compactLeading: {
                Text(ctx.attributes.icon)
            } compactTrailing: {
                timer(ctx.state.start).frame(maxWidth: 56).foregroundStyle(color(ctx.attributes))
            } minimal: {
                Text(ctx.attributes.icon)
            }
            .widgetURL(URL(string: "babylog://open"))
        }
    }

    func timer(_ start: Date) -> some View {
        Text(timerInterval: start...Date.distantFuture, countsDown: false).monospacedDigit()
    }

    func color(_ a: BabyTimerAttributes) -> Color { a.kind == "sleep" ? Palette.sleep : Palette.feed }
}
