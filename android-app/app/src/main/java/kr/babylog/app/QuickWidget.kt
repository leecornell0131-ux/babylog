package kr.babylog.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.SizeF
import android.util.TypedValue
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
    val STR_KEYS = listOf("lastFeedText", "feedLabel", "lastDiaperText", "name", "lastFeedAmt", "lastFeedSub", "birth")

    private val all get() = listOf(QuickWidget(), FeedWidget(), FeedCardWidget(), SleepWidget(), DiaperWidget(), TodayWidget())

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
        var any = false
        for (w in all) {
            val ids = m.getAppWidgetIds(ComponentName(ctx, w.javaClass))
            if (ids.isNotEmpty()) {
                any = true
                val d = Data(ctx)
                for (id in ids) m.updateAppWidget(id, views(ctx, w, d, m.getAppWidgetOptions(id)))
            }
        }
        if (any) tick(ctx)
    }

    // "4시간 10분 전"·오늘 수면 합계 같은 글자는 1분마다 다시 그림.
    // 깨우지 않는 알람이라 화면이 꺼져 있을 때는 미뤄져서 배터리를 거의 안 씀
    private fun tick(ctx: Context) {
        val pi = PendingIntent.getBroadcast(ctx, 0, Intent(ctx, TickReceiver::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val next = (System.currentTimeMillis() / 60_000 + 1) * 60_000
        ctx.getSystemService(AlarmManager::class.java).set(AlarmManager.RTC, next, pi)
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
        val lastFeedAmt = s("lastFeedAmt")
        val lastFeedSub = s("lastFeedSub")
        val birth = s("birth")
        // 오늘 숫자는 저장한 날이 오늘일 때만 (자정이 지나면 0부터)
        private val today = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis
        private val fresh = n("day") == today
        val tFeeds = if (fresh) n("tFeeds") else 0
        val tMl = if (fresh) n("tMl") else 0
        val tPee = if (fresh) n("tPee") else 0
        val tPoo = if (fresh) n("tPoo") else 0
        val tSleep = (if (fresh) n("tSleep") else 0) + (if (sleep > 0) now - maxOf(sleep, today) else 0)
    }

    // 위젯을 길게 눌러 크게 늘리면 작은 글씨와 버튼도 같은 비율로 커짐 (최대 1.5배).
    // 큰 시계 숫자는 원래 커서 그대로 둠 (2×2에서 가로가 넘치지 않게).
    // Android 12 이상은 런처가 알려 준 크기마다 따로 그려서 가로·세로 화면 어느 쪽도 넘치지 않음
    private fun views(ctx: Context, w: BabyWidget, d: Data, o: Bundle): RemoteViews {
        if (Build.VERSION.SDK_INT >= 31) {
            @Suppress("DEPRECATION")
            val sizes = o.getParcelableArrayList<SizeF>(AppWidgetManager.OPTION_APPWIDGET_SIZES)
            if (!sizes.isNullOrEmpty())
                return RemoteViews(sizes.take(16).associateWith { z -> w.build(ctx, d).also { fit(it, w, z.width, z.height) } })
        }
        // 크기 목록이 없으면 가장 좁은 폭·가장 낮은 높이로 맞춤 (어느 방향에서도 넘치지 않게)
        return w.build(ctx, d).also {
            fit(it, w, o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH).toFloat(), o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT).toFloat())
        }
    }

    private fun fit(v: RemoteViews, w: BabyWidget, wd: Float, ht: Float) {
        if (wd <= 0 || ht <= 0) return
        val s = minOf(wd / w.baseW, ht / w.baseH).coerceIn(1f, 1.5f)
        for ((id, sp) in w.texts) v.setTextViewTextSize(id, TypedValue.COMPLEX_UNIT_SP, sp * s)
        if (Build.VERSION.SDK_INT >= 31) for ((id, dp) in w.rows) v.setViewLayoutHeight(id, dp * s, TypedValue.COMPLEX_UNIT_DIP)
    }

    // 지난 시간이 계속 흘러가는 시계
    fun chrono(v: RemoteViews, id: Int, since: Long) =
        v.setChronometer(id, SystemClock.elapsedRealtime() - (System.currentTimeMillis() - since), null, true)

    fun hm(t: Long): String = SimpleDateFormat("HH:mm", Locale.KOREA).format(Date(t))

    // 걸린 시간은 웹앱과 같은 "1h 05m" 꼴 (웹앱 durS)
    fun dur(ms: Long): String {
        val m = Math.round(ms / 60_000.0)
        return "${m / 60}h " + String.format(Locale.ROOT, "%02d", m % 60) + "m"
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

    // 생후 "3개월 24일" (태어난 날이 없으면 빈칸)
    fun age(birth: String): String {
        val b = runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).parse(birth) }.getOrNull() ?: return ""
        val today = Calendar.getInstance()
        fun plus(m: Int) = Calendar.getInstance().apply { time = b; add(Calendar.MONTH, m) }
        var months = 0
        while (!plus(months + 1).after(today)) months++
        val days = ((today.timeInMillis - plus(months).timeInMillis) / 86_400_000L).toInt()
        return if (months == 0) "생후 ${days}일" else "${months}개월 ${days}일"
    }

    fun ago(t: Long): String {
        val ms = System.currentTimeMillis() - t
        return if (ms < 60_000) "방금" else dur(ms) + " 전"
    }

    fun show(v: RemoteViews, id: Int, on: Boolean) = v.setViewVisibility(id, if (on) View.VISIBLE else View.GONE)
}

abstract class BabyWidget : AppWidgetProvider() {
    abstract fun build(ctx: Context, d: Widgets.Data): RemoteViews
    // 크기 맞춤(Widgets.fit)용: 기본 크기(위젯 정보 xml의 minWidth·minHeight, dp),
    // 키울 글자(레이아웃의 sp 그대로)와 버튼 줄 높이(dp)
    abstract val baseW: Float
    abstract val baseH: Float
    abstract val texts: Map<Int, Float>
    open val rows: Map<Int, Float> = emptyMap()
    // 위젯을 새로 놓거나 30분 주기 갱신 때: 전부 다시 그리고 1분 갱신도 다시 걸어 둠
    override fun onUpdate(ctx: Context, m: AppWidgetManager, ids: IntArray) = Widgets.refresh(ctx)
    // 위젯 크기를 바꾸면 글씨도 다시 맞춤
    override fun onAppWidgetOptionsChanged(ctx: Context, m: AppWidgetManager, id: Int, o: Bundle) = Widgets.refresh(ctx)
}

// 1) 빠른 기록 (4×2): 마지막 수유 후 시간 + 진행 중 수면·수유 + 수유·소변·대변·수면 버튼
class QuickWidget : BabyWidget() {
    override val baseW = 250f
    override val baseH = 110f
    override val texts = mapOf(R.id.feed_label to 13f, R.id.feed_none to 15f, R.id.live_label to 13f, R.id.live_timer to 20f,
        R.id.b_feed to 14f, R.id.b_pee to 14f, R.id.b_poo to 14f, R.id.b_sleep to 14f)
    override val rows = mapOf(R.id.btn_row to 44f)
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
        v.setTextViewText(R.id.b_feed, if (d.feed > 0) "🍼 수유 끝" else "🍼 수유")
        v.setTextViewText(R.id.b_sleep, if (d.sleep > 0) "☀️ 깼어요" else "🌙 잠듦")
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
    override val baseW = 110f
    override val baseH = 110f
    override val texts = mapOf(R.id.w_label to 13f, R.id.w_none to 15f, R.id.w_sub to 13f, R.id.w_btn to 15f)
    override val rows = mapOf(R.id.w_btn to 40f)
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
        v.setTextViewText(R.id.w_btn, if (d.feed > 0) "🍼 수유 끝" else "🍼 수유 기록")
        v.setOnClickPendingIntent(R.id.root, Widgets.open(ctx))
        v.setOnClickPendingIntent(R.id.w_btn, Widgets.act(ctx, this, if (d.feed > 0) "stop_feed" else "feed"))
        return v
    }
}

// 2-1) 수유 카드 (2×2): 아기 이름·월령 띠, 마지막 수유 시각과 양, 몇 시간 전 (삐요로그 위젯처럼 한눈에)
class FeedCardWidget : BabyWidget() {
    override val baseW = 110f
    override val baseH = 110f
    // 가운데 시각·양 줄은 이미 2×2 가로를 거의 채워서 위아래 줄만 키움
    override val texts = mapOf(R.id.c_name to 14f, R.id.c_age to 14f, R.id.c_ago to 16f)
    override fun build(ctx: Context, d: Widgets.Data): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_card)
        v.setTextViewText(R.id.c_name, d.name)
        val age = Widgets.age(d.birth)
        Widgets.show(v, R.id.c_age, age.isNotBlank())
        v.setTextViewText(R.id.c_age, age)
        v.setTextViewText(R.id.c_icon, if (d.lastFeedSub == "breastL" || d.lastFeedSub == "breastR") "🤱" else "🍼")
        if (d.feed > 0) {
            v.setTextViewText(R.id.c_time, SimpleDateFormat("a h:mm", Locale.KOREA).format(Date(d.feed)))
            v.setTextViewText(R.id.c_amt, "${d.feedLabel} 중")
            v.setTextViewText(R.id.c_ago, Widgets.ago(d.feed).replace(" 전", "째"))
        } else if (d.lastFeed > 0) {
            v.setTextViewText(R.id.c_time, SimpleDateFormat("a h:mm", Locale.KOREA).format(Date(d.lastFeed)))
            v.setTextViewText(R.id.c_amt, d.lastFeedAmt)
            v.setTextViewText(R.id.c_ago, Widgets.ago(d.lastFeed))
        } else {
            v.setTextViewText(R.id.c_time, "수유 기록 없음")
            v.setTextViewText(R.id.c_amt, "")
            v.setTextViewText(R.id.c_ago, "누르면 앱이 열려요")
        }
        v.setOnClickPendingIntent(R.id.root, Widgets.open(ctx))
        return v
    }
}

class TickReceiver : android.content.BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) = Widgets.refresh(ctx)
}

// 3) 수면 (2×2): 자는 중이면 수면 시간, 깨어 있으면 깨어 있는 시간 (낮잠 타이밍 보기용)
class SleepWidget : BabyWidget() {
    override val baseW = 110f
    override val baseH = 110f
    override val texts = mapOf(R.id.w_label to 13f, R.id.w_none to 15f, R.id.w_sub to 13f, R.id.w_btn to 15f)
    override val rows = mapOf(R.id.w_btn to 40f)
    override fun build(ctx: Context, d: Widgets.Data): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_sleep)
        val since = if (d.sleep > 0) d.sleep else d.lastWake
        Widgets.show(v, R.id.w_timer, since > 0)
        Widgets.show(v, R.id.w_none, since == 0L)
        if (since > 0) Widgets.chrono(v, R.id.w_timer, since)
        v.setTextViewText(R.id.w_label, if (d.sleep > 0) "${d.name} 수면 중" else "깨어 있는 시간")
        v.setTextViewText(R.id.w_sub, if (d.sleep > 0) Widgets.hm(d.sleep) + "에 잠듦" else if (d.lastWake > 0) Widgets.hm(d.lastWake) + "에 깸" else "")
        v.setTextViewText(R.id.w_btn, if (d.sleep > 0) "☀️ 깼어요" else "🌙 잠듦")
        v.setOnClickPendingIntent(R.id.root, Widgets.open(ctx))
        v.setOnClickPendingIntent(R.id.w_btn, Widgets.act(ctx, this, "sleep"))
        return v
    }
}

// 4) 기저귀 (4×1): 마지막 기저귀 후 시간 + 소변·대변·둘 다 버튼
class DiaperWidget : BabyWidget() {
    override val baseW = 250f
    override val baseH = 50f
    override val texts = mapOf(R.id.w_label to 13f, R.id.w_timer to 20f, R.id.w_none to 15f, R.id.b_pee to 14f, R.id.b_poo to 14f, R.id.b_both to 14f)
    override val rows = mapOf(R.id.btn_row to 44f)
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
    override val baseW = 250f
    override val baseH = 120f
    override val texts = mapOf(R.id.w_title to 14f, R.id.l_feed to 12f, R.id.l_gap to 12f, R.id.l_diaper to 12f, R.id.l_sleep to 12f,
        R.id.t_feed to 17f, R.id.w_timer to 17f, R.id.w_none to 17f, R.id.t_diaper to 17f, R.id.t_sleep to 17f)
    override fun build(ctx: Context, d: Widgets.Data): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_today)
        v.setTextViewText(R.id.w_title, "오늘 · ${d.name}")
        v.setTextViewText(R.id.t_feed, "${d.tFeeds}회" + if (d.tMl > 0) " · ${d.tMl}ml" else "")
        v.setTextViewText(R.id.t_sleep, if (d.tSleep > 0) Widgets.dur(d.tSleep) + (if (d.sleep > 0) " 💤" else "") else "기록 없음")
        v.setTextViewText(R.id.t_diaper, "소 ${d.tPee} · 대 ${d.tPoo}")
        Widgets.show(v, R.id.w_timer, d.lastFeed > 0)
        Widgets.show(v, R.id.w_none, d.lastFeed == 0L)
        if (d.lastFeed > 0) Widgets.chrono(v, R.id.w_timer, d.lastFeed)
        v.setOnClickPendingIntent(R.id.root, Widgets.open(ctx))
        return v
    }
}
