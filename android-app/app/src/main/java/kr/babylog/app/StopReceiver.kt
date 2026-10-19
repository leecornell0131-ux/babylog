package kr.babylog.app

import android.app.Notification
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// 잠금화면 알림의 "깼어요"·"끝" 버튼.
// 화면을 여는 대신 방송(broadcast)으로 받아서, 지문·잠금 해제 없이 누른 시각으로 바로 기록함.
// 앱이 떠 있으면 바로 웹앱에 기록(가족 공유까지)하고, 꺼져 있으면 저장해 두었다가 앱을 열 때 그 시각으로 기록함.
class StopReceiver : BroadcastReceiver() {
    companion object {
        private const val PREF = "babylog"
        private const val KEY = "pendingStops"
        private const val ID_DONE = 3

        // 아직 웹앱에 넣지 못한 "끝" 기록들 [{a, at}]
        fun pending(ctx: Context): JSONArray =
            runCatching { JSONArray(ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString(KEY, "[]")) }.getOrDefault(JSONArray())

        private fun add(ctx: Context, a: String, at: Long) {
            val list = pending(ctx).put(JSONObject().put("a", a).put("at", at))
            ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString(KEY, list.toString()).commit()
        }

        // 웹앱에 넣고 나서야 지움 (넣기 전에 앱이 꺼져도 다음에 열 때 다시 넣음)
        fun done(ctx: Context, a: String, at: Long) {
            val src = pending(ctx)
            val out = JSONArray()
            for (i in 0 until src.length()) {
                val o = src.optJSONObject(i) ?: continue
                if (!(o.optString("a") == a && o.optLong("at") == at)) out.put(o)
            }
            ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString(KEY, out.toString()).apply()
        }

        // 이 시각에 시작한 수면·수유를 이미 잠금화면에서 끝냈으면 true (알림·위젯에 다시 띄우지 않게)
        fun stopped(ctx: Context, act: String, start: Long): Boolean {
            val a = pending(ctx)
            for (i in 0 until a.length()) {
                val o = a.optJSONObject(i) ?: continue
                if (o.optString("a") == act && o.optLong("at") >= start) return true
            }
            return false
        }
    }

    override fun onReceive(ctx: Context, intent: Intent) {
        val a = intent.getStringExtra(MainActivity.EXTRA_ACTION) ?: return
        val at = System.currentTimeMillis()
        // 먼저 저장해 두고, 앱이 떠 있으면 바로 넣음. 같은 "끝"을 두 번 넣어도 이미 끝난 기록은 그대로라 안전함
        add(ctx, a, at)
        val live = MainActivity.live?.get()
        live?.flushStops()
        // 누른 즉시 타이머 알림·위젯을 내리고, 기록했다는 짧은 알림을 띄움
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.cancel(if (a == "stop_feed") LiveNotify.ID_FEED else LiveNotify.ID_SLEEP)
        if (a == "stop_sleep") QuickWidget.clearSleep(ctx)
        val hm = SimpleDateFormat("HH:mm", Locale.KOREA).format(Date(at))
        val n = Notification.Builder(ctx, LiveNotify.CH)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle((if (a == "stop_feed") "수유 끝" else "깼어요") + " · $hm 기록")
            .setContentText(if (live != null) "가족에게도 올렸어요" else "앱을 열면 가족에게도 올라가요")
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setTimeoutAfter(60_000)
            .setContentIntent(LiveNotify.openApp(ctx))
            .build()
        try {
            nm.notify(ID_DONE, n)
        } catch (_: SecurityException) {
        }
    }
}
