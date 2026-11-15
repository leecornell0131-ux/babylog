package kr.babylog.wear

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.CountUpTimeReference
import androidx.wear.watchface.complications.data.LongTextComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.data.TimeDifferenceComplicationText
import androidx.wear.watchface.complications.data.TimeDifferenceStyle
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kr.babylog.app.Tr
import java.time.Instant

// 타일: 깨어 있는 시간(자는 중이면 잠든 지) + 수유·재우기·기저귀 버튼. 누르면 워치 앱의 그 화면이 열림
class BabyTile : TileService() {
    override fun onTileRequest(req: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        Store.load(this)
        val s = Store.sum.value
        val now = System.currentTimeMillis()
        val head = when {
            s.sleep > 0 -> Tr.f("😴 수면 중 {0}", dur(now - s.sleep))
            s.lastWake > 0 -> Tr.f("👀 깬 지 {0}", dur(now - s.lastWake))
            !s.has -> Tr.t("폰 앱을 한 번 열어 주세요")
            else -> Tr.t("베이비노트")
        }
        val sub = if (s.lastFeed > 0) "🍼 " + Tr.f("{0} 전", dur(now - s.lastFeed)) else ""
        val col = LayoutElementBuilders.Column.Builder()
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .addContent(text(head, 16f, if (s.sleep > 0) 0xFF8E9BFF.toInt() else 0xFF7DD3FC.toInt(), true))
            .addContent(text(sub, 13f, 0xFFF59AB8.toInt(), false))
            .addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(10f)).build())
            .addContent(
                LayoutElementBuilders.Row.Builder()
                    .addContent(btn("🍼", 0xFFF59AB8.toInt(), "feed"))
                    .addContent(LayoutElementBuilders.Spacer.Builder().setWidth(dp(8f)).build())
                    .addContent(btn(if (s.sleep > 0) "👀" else "😴", 0xFF8E9BFF.toInt(), "sleep"))
                    .addContent(LayoutElementBuilders.Spacer.Builder().setWidth(dp(8f)).build())
                    .addContent(btn("💩", 0xFFB07E55.toInt(), "diaper"))
                    .build()
            )
            .build()
        val root = LayoutElementBuilders.Box.Builder().setWidth(expand()).setHeight(expand())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
            .addContent(col).build()
        val tile = TileBuilders.Tile.Builder()
            .setResourcesVersion("1")
            // 숫자가 너무 낡지 않게 5분마다 다시 그림 (기록이 바뀌면 바로)
            .setFreshnessIntervalMillis(5 * 60_000L)
            .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(root))
            .build()
        return Futures.immediateFuture(tile)
    }

    override fun onTileResourcesRequest(req: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
        Futures.immediateFuture(ResourceBuilders.Resources.Builder().setVersion("1").build())

    private fun text(t: String, size: Float, color: Int, bold: Boolean) = LayoutElementBuilders.Text.Builder()
        .setText(t)
        .setMaxLines(2)
        .setFontStyle(
            LayoutElementBuilders.FontStyle.Builder().setSize(androidx.wear.protolayout.DimensionBuilders.sp(size))
                .setColor(argb(color))
                .setWeight(if (bold) LayoutElementBuilders.FONT_WEIGHT_BOLD else LayoutElementBuilders.FONT_WEIGHT_NORMAL)
                .build()
        ).build()

    private fun btn(icon: String, color: Int, go: String): LayoutElementBuilders.LayoutElement {
        val launch = ActionBuilders.LaunchAction.Builder().setAndroidActivity(
            ActionBuilders.AndroidActivity.Builder()
                .setPackageName(packageName)
                .setClassName(WearActivity::class.java.name)
                .addKeyToExtraMapping("go", ActionBuilders.AndroidStringExtra.Builder().setValue(go).build())
                .build()
        ).build()
        return LayoutElementBuilders.Box.Builder()
            .setWidth(dp(48f)).setHeight(dp(48f))
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setBackground(
                        ModifiersBuilders.Background.Builder().setColor(argb(color))
                            .setCorner(ModifiersBuilders.Corner.Builder().setRadius(dp(24f)).build()).build()
                    )
                    .setClickable(ModifiersBuilders.Clickable.Builder().setId(go).setOnClick(launch).build())
                    .build()
            )
            .addContent(text(icon, 20f, 0xFFFFFFFF.toInt(), false))
            .build()
    }
}

// 워치페이스 칸: 깨어 있는 시간이 저절로 늘어남 (자는 중이면 잠든 지). 누르면 워치 앱이 열림
class AwakeComplication : SuspendingComplicationDataSourceService() {
    override fun getPreviewData(type: ComplicationType): ComplicationData? = build(type, Sum(lastWake = System.currentTimeMillis() - 65 * 60_000L, has = true))

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
        Store.load(this)
        return build(request.complicationType, Store.sum.value)
    }

    private fun build(type: ComplicationType, s: Sum): ComplicationData? {
        val since = if (s.sleep > 0) s.sleep else s.lastWake
        val icon = if (s.sleep > 0) "😴" else "👀"
        val open = android.app.PendingIntent.getActivity(this, 0,
            android.content.Intent(this, WearActivity::class.java), android.app.PendingIntent.FLAG_IMMUTABLE)
        val desc = PlainComplicationText.Builder(Tr.t("깨어 있는 시간")).build()
        val txt = if (since > 0)
            TimeDifferenceComplicationText.Builder(TimeDifferenceStyle.SHORT_DUAL_UNIT, CountUpTimeReference(Instant.ofEpochMilli(since)))
                .setText("$icon ^1").build()
        else PlainComplicationText.Builder("$icon --").build()
        return when (type) {
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(txt, desc).setTapAction(open).build()
            ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(txt, desc).setTapAction(open).build()
            else -> null
        }
    }
}
