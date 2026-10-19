package kr.babylog.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Bundle
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// 진행 중인 수면·수유를 잠금화면과 알림창에 시간이 흘러가는 알림으로 보여 줌.
// Android 16 이상(One UI 8)에서는 "실시간 정보"로 올려 달라고 요청함 (기기 설정에 따라 다름).
object LiveNotify {
    const val CH = "live_timer"
    const val ID_SLEEP = 1
    const val ID_FEED = 2

    fun ensureChannel(ctx: Context) {
        val ch = NotificationChannel(CH, "진행 중 타이머", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "수유·수면이 진행 중일 때 지난 시간을 잠금화면과 알림창에 보여줘요"
            setSound(null, null)
            enableVibration(false)
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        nm(ctx).createNotificationChannel(ch)
    }

    fun update(ctx: Context, o: JSONObject) {
        val name = if (o.isNull("name")) "아기" else o.optString("name", "아기")
        show(ctx, ID_SLEEP, o.optLongOrNull("sleep"), "$name 수면 중", "깼어요", "stop_sleep")
        val feedLabel = if (o.isNull("feedLabel")) "수유" else o.optString("feedLabel").ifBlank { "수유" }
        show(ctx, ID_FEED, o.optLongOrNull("feed"), "$name $feedLabel 중", "끝", "stop_feed")
    }

    private fun show(ctx: Context, id: Int, start: Long?, title: String, actLabel: String, act: String) {
        // 잠금화면에서 이미 끝냈는데 아직 앱에 반영 안 된 것은 다시 띄우지 않음
        if (start == null || StopReceiver.stopped(ctx, act, start)) {
            nm(ctx).cancel(id)
            return
        }
        val since = SimpleDateFormat("HH:mm", Locale.KOREA).format(Date(start)) + "부터"
        val b = Notification.Builder(ctx, CH)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title)
            .setContentText(since)
            .setWhen(start)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setCategory(Notification.CATEGORY_STOPWATCH)
            .setContentIntent(openApp(ctx))
            // 화면을 열지 않는 방송이라 잠금화면에서 지문 확인 없이 바로 눌림
            .addAction(Notification.Action.Builder(null, actLabel, stop(ctx, act, id + 10)).build())
            // Android 16 실시간 정보(Live Updates) 요청. 그 아래 버전에서는 무시됨
            .addExtras(Bundle().apply { putBoolean("android.requestPromotedOngoing", true) })
        try {
            nm(ctx).notify(id, b.build())
        } catch (_: SecurityException) {
            // 알림 권한이 없으면 조용히 넘어감
        }
    }

    fun openApp(ctx: Context): PendingIntent =
        PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun stop(ctx: Context, action: String, req: Int): PendingIntent {
        val i = Intent(ctx, StopReceiver::class.java).putExtra(MainActivity.EXTRA_ACTION, action)
        return PendingIntent.getBroadcast(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun nm(ctx: Context) = ctx.getSystemService(NotificationManager::class.java)
}

fun JSONObject.optLongOrNull(k: String): Long? = if (isNull(k)) null else optLong(k)
