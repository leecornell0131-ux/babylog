package kr.babylog.app

import android.content.Context
import android.net.Uri
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject

// 갤럭시워치와 잇는 곳 (워치 앱: android-app/wear).
// 폰 → 워치: 위젯과 같은 요약(JSON)과 화면 언어를 "/babylog/summary"로 (워치가 꺼져 있으면 켜질 때 받음).
// 워치 → 폰: 누른 기록을 "/babylog/act/<id>"로 보내 옴. 연결이 끊겨 있으면 구글 연결 서비스가 들고 있다가 이어지면 전달.
//   잠금화면 "깼어요"와 같은 줄(StopReceiver 저장분)에 넣어서, 앱이 떠 있으면 바로 웹앱에 넣고(가족 공유까지)
//   앱이 꺼져 있으면 앱을 열 때 누른 시각 그대로 넣음.
object WatchSync {
    private const val PREF = "babylog_watch"

    fun sendSummary(ctx: Context, o: JSONObject) {
        val app = ctx.applicationContext
        app.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString("last", o.toString()).apply()
        put(app, o.toString())
    }

    // 언어를 바꾸면 마지막 요약을 새 언어 표시와 함께 다시 보냄
    fun resend(ctx: Context) {
        val last = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString("last", null) ?: return
        put(ctx.applicationContext, last)
    }

    private fun put(app: Context, json: String) {
        try {
            val r = PutDataMapRequest.create("/babylog/summary")
            r.dataMap.putString("s", json)
            r.dataMap.putString("lang", Tr.lang)
            Wearable.getDataClient(app).putDataItem(r.asPutDataRequest().setUrgent())
        } catch (_: Throwable) {
            // 구글 플레이 서비스가 없는 휴대폰 등: 워치 없이 그대로
        }
    }

    fun handle(ctx: Context, a: String, at: Long): Boolean {
        if (!MainActivity.isAction(a)) return false
        if (!StopReceiver.has(ctx, a, at)) StopReceiver.add(ctx, a, at)
        val live = MainActivity.live?.get()
        live?.flushStops()
        if (a == "stop_sleep" || a == "stop_feed") {
            ctx.getSystemService(android.app.NotificationManager::class.java)
                .cancel(if (a == "stop_feed") LiveNotify.ID_FEED else LiveNotify.ID_SLEEP)
            Widgets.stopped(ctx, a, at)
        }
        return live != null
    }
}

class WatchService : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        val done = mutableListOf<Pair<Uri, String>>()
        for (e in events) {
            if (e.type != DataEvent.TYPE_CHANGED) continue
            val item = e.dataItem
            val path = item.uri.path ?: continue
            if (!path.startsWith("/babylog/act/")) continue
            val m = DataMapItem.fromDataItem(item).dataMap
            val a = m.getString("a") ?: continue
            val at = m.getLong("at")
            val live = WatchSync.handle(this, a, at)
            done.add(item.uri to (if (live) "ok" else "queued"))
        }
        events.release()
        for ((uri, r) in done) {
            // 처리한 기록은 지우고(다시 오지 않게), 워치에 결과를 알려 줌
            Wearable.getDataClient(this).deleteDataItems(uri)
            val id = uri.lastPathSegment ?: continue
            val node = uri.host ?: continue
            Wearable.getMessageClient(this).sendMessage(node, "/babylog/ack", "$id:$r".toByteArray())
        }
    }
}
