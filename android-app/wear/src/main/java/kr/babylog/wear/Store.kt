package kr.babylog.wear

import android.app.Application
import android.content.ComponentName
import android.content.Context
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.flow.MutableStateFlow
import kr.babylog.app.Tr
import org.json.JSONObject
import java.util.UUID

class WearApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Tr.init(this)
        Store.load(this)
    }
}

// 휴대폰이 보내 주는 요약 (위젯과 같은 값, bridge.js summary). 시각은 1970년부터의 밀리초, 없으면 0
data class Sum(
    val at: Long = 0, val sleep: Long = 0, val feed: Long = 0, val feedLabel: String = "",
    val lastFeed: Long = 0, val lastFeedAmt: String = "", val lastFeedSub: String = "",
    val lastWake: Long = 0, val lastDiaper: Long = 0, val lastDiaperText: String = "",
    val has: Boolean = false,
) {
    fun json(): String = JSONObject().put("at", at).put("sleep", sleep).put("feed", feed).put("feedLabel", feedLabel)
        .put("lastFeed", lastFeed).put("lastFeedAmt", lastFeedAmt).put("lastFeedSub", lastFeedSub).put("lastWake", lastWake)
        .put("lastDiaper", lastDiaper).put("lastDiaperText", lastDiaperText).toString()

    companion object {
        fun parse(s: String?): Sum {
            val o = runCatching { JSONObject(s ?: return Sum()) }.getOrNull() ?: return Sum()
            fun n(k: String) = if (o.isNull(k)) 0L else o.optLong(k, 0)
            fun t(k: String) = if (o.isNull(k)) "" else o.optString(k, "")
            return Sum(n("at"), n("sleep"), n("feed"), t("feedLabel"), n("lastFeed"), t("lastFeedAmt"), t("lastFeedSub"),
                n("lastWake"), n("lastDiaper"), t("lastDiaperText"), true)
        }
    }
}

// 기록 보내기 상태 (확인 화면)
data class Sent(val id: String, val a: String, val at: Long, val label: String, val state: String) // waiting·sending·saved·queued·undone

object Store {
    private const val PREF = "babylog_wear"
    val sum = MutableStateFlow(Sum())
    val sent = MutableStateFlow<Sent?>(null)
    val left = MutableStateFlow(0)

    fun load(ctx: Context) {
        sum.value = Sum.parse(ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString("sum", null))
    }

    var ml: Int = 120
    var feedSub: String = "formula"
    fun loadFeed(ctx: Context) {
        val p = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        ml = p.getInt("ml", 0).takeIf { it > 0 } ?: sum.value.lastFeedAmt.removeSuffix("ml").toIntOrNull() ?: 120
        feedSub = p.getString("feedSub", null) ?: if (sum.value.lastFeedSub == "pump") "pump" else "formula"
    }

    // 더 새 요약만 받음 (방금 워치에서 누른 것보다 오래된 요약이 덮어쓰지 않게)
    fun take(ctx: Context, json: String) {
        val s = Sum.parse(json)
        if (s.at < sum.value.at) return
        save(ctx, s)
    }

    private fun save(ctx: Context, s: Sum) {
        sum.value = s
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString("sum", s.json()).apply()
        refreshSurfaces(ctx)
    }

    fun refreshSurfaces(ctx: Context) {
        runCatching { TileService.getUpdater(ctx).requestUpdate(BabyTile::class.java) }
        runCatching { ComplicationDataSourceUpdateRequester.create(ctx, ComponentName(ctx, AwakeComplication::class.java)).requestUpdateAll() }
    }

    fun newSent(a: String, label: String) = Sent(UUID.randomUUID().toString(), a, System.currentTimeMillis(), label, "waiting")

    // 휴대폰으로 보냄. 연결이 끊겨 있으면 구글 연결 서비스가 들고 있다가 이어질 때 전달 (누른 시각 그대로)
    fun send(ctx: Context, s: Sent) {
        sent.value = s.copy(state = "sending")
        patch(ctx, s)
        val r = PutDataMapRequest.create("/babylog/act/" + s.id)
        r.dataMap.putString("a", s.a)
        r.dataMap.putLong("at", s.at)
        Wearable.getDataClient(ctx).putDataItem(r.asPutDataRequest().setUrgent())
        // 몇 초 안에 휴대폰 답이 없으면 "폰과 연결되면 기록돼요"
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            if (sent.value?.id == s.id && sent.value?.state == "sending") sent.value = s.copy(state = "queued")
        }, 4000)
    }

    fun ack(id: String, r: String) {
        val cur = sent.value ?: return
        if (cur.id == id) sent.value = cur.copy(state = if (r == "ok") "saved" else "phone")
    }

    // 휴대폰 답을 기다리지 않고 워치 화면부터 바꿈
    private fun patch(ctx: Context, s: Sent) {
        val x = sum.value
        val p = s.a.split(":")
        val y = when (p[0]) {
            "sleep_start" -> x.copy(sleep = s.at)
            "stop_sleep" -> x.copy(sleep = 0, lastWake = s.at)
            "feed_start" -> x.copy(feed = s.at, feedLabel = mapOf("breastL" to "모유 왼쪽", "breastR" to "모유 오른쪽", "pump" to "유축 수유")[p.getOrNull(1)] ?: "분유")
            "stop_feed" -> x.copy(feed = 0, lastFeed = if (x.feed > 0) x.feed else x.lastFeed)
            "feed_ml" -> {
                ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit()
                    .putInt("ml", p.getOrNull(1)?.toIntOrNull() ?: 120).putString("feedSub", p.getOrNull(2) ?: "formula").apply()
                x.copy(lastFeed = s.at, lastFeedAmt = (p.getOrNull(1) ?: "") + "ml", lastFeedSub = p.getOrNull(2) ?: "formula", feed = 0)
            }
            "pee", "poo", "both" -> x.copy(lastDiaper = s.at, lastDiaperText = mapOf("pee" to "소변", "poo" to "대변", "both" to "소변+대변")[p[0]] ?: "")
            else -> x
        }
        save(ctx, y.copy(at = maxOf(x.at, s.at), has = true))
    }
}

class WearListener : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        for (e in events) {
            if (e.type != DataEvent.TYPE_CHANGED || e.dataItem.uri.path != "/babylog/summary") continue
            val m = DataMapItem.fromDataItem(e.dataItem).dataMap
            m.getString("lang")?.let { Tr.set(this, it) }
            m.getString("s")?.let { Store.take(this, it) }
        }
        events.release()
    }

    override fun onMessageReceived(e: MessageEvent) {
        if (e.path != "/babylog/ack") return
        val (id, r) = String(e.data).split(":").let { (it.getOrNull(0) ?: "") to (it.getOrNull(1) ?: "") }
        Store.ack(id, r)
    }
}

// "1h 05m" / "25m" (웹앱과 같은 표기)
fun dur(ms: Long): String {
    val m = maxOf(0L, ms / 60000)
    return if (m >= 60) "${m / 60}h " + String.format("%02dm", m % 60) else "${m}m"
}
