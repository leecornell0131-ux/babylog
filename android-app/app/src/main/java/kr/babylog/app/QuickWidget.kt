package kr.babylog.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

// 홈 화면 위젯 5종이 함께 쓰는 저장값과 그리기 도구.
// 기록이 바뀌면(이 휴대폰 저장·배우자 푸시·15분 확인) save()가 모든 위젯을 새로 그림.
object Widgets {
    private const val PREF = "babylog_widget"
    // 웹앱 요약(bridge.js summary·web-notify.js summaryOf)에서 받는 값
    val NUM_KEYS = listOf("lastFeed", "sleep", "feed", "feedGap", "lastWake", "lastDiaper", "day", "tFeeds", "tMl", "tPee", "tPoo", "tSleep")
    val STR_KEYS = listOf("lastFeedText", "feedLabel", "lastDiaperText", "name")

    private val all get() = listOf(QuickWidget(), FeedWidget(), SleepWidget(), DiaperWidget(), TodayWidget())

    fun save(ctx: Context, o: JSONObject) {
        val e = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit()
        for (k in NUM_KEYS) e.putLong(k, o.optLongOrNull(k) ?: 0)
        for (k in STR_KEYS) e.putString(k, if (o.isNull(k)) "" else o.optString(k))
        e.apply()
        refresh(ctx)
    }

    // 잠금화면에서 "깼어요"·"끝"을 누르면 위젯도 바로 바꿈
    fun stopped(ctx: Context, act: String, at: Long) {
        val e = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit()
        if (act == "stop_sleep") e.putLong("sleep", 0).putLong("lastWake", at) else e.putLong("feed", 0)
        e.apply()
        refresh(ctx)
    }

    fun refresh(ctx: Context) {
        val m = AppWidgetManager.getInstance(ctx)
        for (w in all) {
            val ids = m.getAppWidgetIds(ComponentName(ctx, w.javaClass))
            if (ids.isNotEmpty()) m.updateAppWidget(ids, w.build(ctx, Data(ctx)))
        }
    }

    // 위젯이 그릴 값. 잠금화면에서 끝냈지만 아직 웹앱에 안 들어간 타이머는 끝난 것으로 봄
    class Data(ctx: Context) {
        private val p = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        private fun n(k: String) = p.getLong(k, 0)
        private fun s(k: String) = p.getString(k, "") ?: ""
        val now = System.currentTimeMillis()
        val sleep = n("sleep").let { if (it > 0 && StopReceiver.stopped(ctx, "stop_sleep", it)) 0L else it }
        val feed = n("feed").let { if (it > 0 && StopReceiver.stopped(ctx, "stop_feed", it)) 0L else it }
        val lastWake = if (sleep > 0) 0L else n("lastWake")
        val lastFeed = n("lastFeed")
        val lastFeedText = s("lastFeedText")
        val feedLabel = s("feedLabel").ifBlank { "수유" }
        val feedGap = n("feedGap")
        val lastDiaper = n("lastDiaper")
        val lastDiaperText = s("lastDiaperText")
        val name = s("name").ifBlank { "아기" }
        // 오늘 숫자는 저장한 날이 오늘일 때만 (자정이 지나면 0부터)
        private val today = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis
        private val fresh = n("day") == today
        val tFeeds = if (fresh) n("tFeeds") else 0
        val tMl = if (fresh) n("tMl") else 0
        val tPee = if (fresh) n("tPee") else 0
        val tPoo = if (fresh) n("tPoo") else 0
        val tSleep = (if (fresh) n("tSleep") else 0) + (if (sleep > 0) now - maxOf(sleep, today) else 0)
    }

    // 지난 시간이 계속 흘러가는 시계
    fun chrono(v: RemoteViews, id: Int, since: Long) =
        v.setChronometer(id, SystemClock.elapsedRealtime() - (System.currentTimeMillis() - since), null, true)

    fun hm(t: Long): String = SimpleDateFormat("HH:mm", Locale.KOREA).format(Date(t))

    fun dur(ms: Long): String {
        val m = ms / 60_000
        return if (m >= 60) "${m / 60}시간" + (if (m % 60 > 0) " ${m % 60}분" else "") else "${m}분"
    }

    // 위젯 버튼: 앱이 열리면서 바로 기록 (ActionActivity가 누른 시각을 붙임)
    fun act(ctx: Context, owner: Any, action: String): PendingIntent {
        val i = Intent(ctx, ActionActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(MainActivity.EXTRA_ACTION, action)
        return PendingIntent.getActivity(ctx, (owner.javaClass.simpleName + action).hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun open(ctx: Context): PendingIntent =
        PendingIntent.getActivity(ctx, 100, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    fun show(v: RemoteViews, id: Int, on: Boolean) = v.setViewVisibility(id, if (on) View.VISIBLE else View.GONE)
}

abstract class BabyWidget : AppWidgetProvider() {
    abstract fun build(ctx: Context, d: Widgets.Data): RemoteViews
    override fun onUpdate(ctx: Context, m: AppWidgetManager, ids: IntArray) = m.updateAppWidget(ids, build(ctx, Widgets.Data(ctx)))
}

// 1) 빠른 기록 (4×2): 마지막 수유 후 시간 + 진행 중 수면·수유 + 수유·소변·대변·수면 버튼
class QuickWidget : BabyWidget() {
    override fun build(ctx: Context, d: Widgets.Data): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_quick)
        Widgets.show(v, R.id.feed_timer, d.lastFeed > 0)
        Widgets.show(v, R.id.feed_none, d.lastFeed == 0L)
        if (d.lastFeed > 0) {
            Widgets.chrono(v, R.id.feed_timer, d.lastFeed)
            v.setTextViewText(R.id.feed_label, if (d.lastFeedText.isBlank()) "마지막 수유 후" else "마지막 수유 후 · ${d.lastFeedText}")
        }
        val live = if (d.feed > 0) d.feed else d.sleep
        Widgets.show(v, R.id.live_box, live > 0)
        if (live > 0) {
            v.setTextViewText(R.id.live_label, if (d.feed > 0) "${d.feedLabel} 중" else "수면 중")
            Widgets.chrono(v, R.id.live_timer, live)
        }
        v.setTextViewText(R.id.b_feed, if (d.feed > 0) "수유 끝" else "수유")
        v.setTextViewText(R.id.b_sleep, if (d.sleep > 0) "깼어요" else "잠듦")
        v.setOnClickPendingIntent(R.id.root, Widgets.open(ctx))
        v.setOnClickPendingIntent(R.id.b_feed, Widgets.act(ctx, this, if (d.feed > 0) "stop_feed" else "feed"))
        v.setOnClickPendingIntent(R.id.b_pee, Widgets.act(ctx, this, "pee"))
        v.setOnClickPendingIntent(R.id.b_poo, Widgets.act(ctx, this, "poo"))
        v.setOnClickPendingIntent(R.id.b_sleep, Widgets.act(ctx, this, "sleep"))
        return v
    }
}

// 2) 수유 타이머 (2×2): 마지막 수유 후 시간을 크게, 평소 간격으로 본 다음 수유 시각
class FeedWidget : BabyWidget() {
    override fun build(ctx: Context, d: Widgets.Data): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_feed)
        val since = if (d.feed > 0) d.feed else d.lastFeed
        Widgets.show(v, R.id.w_timer, since > 0)
        Widgets.show(v, R.id.w_none, since == 0L)
        if (since > 0) Widgets.chrono(v, R.id.w_timer, since)
        v.setTextViewText(R.id.w_label, if (d.feed > 0) "${d.feedLabel} 중" else "마지막 수유 후")
        v.setTextViewText(
            R.id.w_sub,
            when {
                d.feed > 0 -> Widgets.hm(d.feed) + "부터"
                d.lastFeed > 0 && d.feedGap > 0 -> "평소 ${Widgets.dur(d.feedGap)} 간격 · ${Widgets.hm(d.lastFeed + d.feedGap)}쯤"
                else -> d.lastFeedText
            }
        )
        v.setTextViewText(R.id.w_btn, if (d.feed > 0) "수유 끝" else "수유 기록")
        v.setOnClickPendingIntent(R.id.root, Widgets.open(ctx))
        v.setOnClickPendingIntent(R.id.w_btn, Widgets.act(ctx, this, if (d.feed > 0) "stop_feed" else "feed"))
        return v
    }
}

// 3) 수면 (2×2): 자는 중이면 수면 시간, 깨어 있으면 깨어 있는 시간 (낮잠 타이밍 보기용)
class SleepWidget : BabyWidget() {
    override fun build(ctx: Context, d: Widgets.Data): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_sleep)
        val since = if (d.sleep > 0) d.sleep else d.lastWake
        Widgets.show(v, R.id.w_timer, since > 0)
        Widgets.show(v, R.id.w_none, since == 0L)
        if (since > 0) Widgets.chrono(v, R.id.w_timer, since)
        v.setTextViewText(R.id.w_label, if (d.sleep > 0) "${d.name} 수면 중" else "깨어 있는 시간")
        v.setTextViewText(R.id.w_sub, if (d.sleep > 0) Widgets.hm(d.sleep) + "에 잠듦" else if (d.lastWake > 0) Widgets.hm(d.lastWake) + "에 깸" else "")
        v.setTextViewText(R.id.w_btn, if (d.sleep > 0) "깼어요" else "잠듦")
        v.setOnClickPendingIntent(R.id.root, Widgets.open(ctx))
        v.setOnClickPendingIntent(R.id.w_btn, Widgets.act(ctx, this, "sleep"))
        return v
    }
}

// 4) 기저귀 (4×1): 마지막 기저귀 후 시간 + 소변·대변·둘 다 버튼
class DiaperWidget : BabyWidget() {
    override fun build(ctx: Context, d: Widgets.Data): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_diaper)
        Widgets.show(v, R.id.w_timer, d.lastDiaper > 0)
        Widgets.show(v, R.id.w_none, d.lastDiaper == 0L)
        if (d.lastDiaper > 0) Widgets.chrono(v, R.id.w_timer, d.lastDiaper)
        v.setTextViewText(R.id.w_label, if (d.lastDiaperText.isBlank()) "마지막 기저귀 후" else "마지막 ${d.lastDiaperText} 후")
        v.setOnClickPendingIntent(R.id.root, Widgets.open(ctx))
        v.setOnClickPendingIntent(R.id.b_pee, Widgets.act(ctx, this, "pee"))
        v.setOnClickPendingIntent(R.id.b_poo, Widgets.act(ctx, this, "poo"))
        v.setOnClickPendingIntent(R.id.b_both, Widgets.act(ctx, this, "both"))
        return v
    }
}

// 5) 오늘 요약 (4×2): 수유 횟수·양, 수면 합계, 소변·대변 횟수, 마지막 수유 후 시간
class TodayWidget : BabyWidget() {
    override fun build(ctx: Context, d: Widgets.Data): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_today)
        v.setTextViewText(R.id.w_title, "오늘 · ${d.name}")
        v.setTextViewText(R.id.t_feed, "${d.tFeeds}회" + if (d.tMl > 0) " · ${d.tMl}ml" else "")
        v.setTextViewText(R.id.t_sleep, if (d.tSleep > 0) Widgets.dur(d.tSleep) + (if (d.sleep > 0) " (자는 중)" else "") else "기록 없음")
        v.setTextViewText(R.id.t_diaper, "소 ${d.tPee} · 대 ${d.tPoo}")
        Widgets.show(v, R.id.w_timer, d.lastFeed > 0)
        Widgets.show(v, R.id.w_none, d.lastFeed == 0L)
        if (d.lastFeed > 0) Widgets.chrono(v, R.id.w_timer, d.lastFeed)
        v.setOnClickPendingIntent(R.id.root, Widgets.open(ctx))
        return v
    }
}
