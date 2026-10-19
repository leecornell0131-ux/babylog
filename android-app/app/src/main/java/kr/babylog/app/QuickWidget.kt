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

// 홈 화면 위젯: 마지막 수유 후 지난 시간(계속 흘러감), 수면 중이면 수면 시간, 버튼 4개.
// 버튼을 누르면 앱이 열리면서 바로 기록되고, 가족 공유로 배우자 휴대폰에도 올라감.
class QuickWidget : AppWidgetProvider() {
    companion object {
        private const val PREF = "babylog_widget"

        fun save(ctx: Context, o: JSONObject) {
            ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit()
                .putLong("lastFeed", o.optLongOrNull("lastFeed") ?: 0)
                .putString("lastFeedText", if (o.isNull("lastFeedText")) "" else o.optString("lastFeedText"))
                .putLong("sleep", o.optLongOrNull("sleep") ?: 0)
                .apply()
            val m = AppWidgetManager.getInstance(ctx)
            val ids = m.getAppWidgetIds(ComponentName(ctx, QuickWidget::class.java))
            if (ids.isNotEmpty()) render(ctx, m, ids)
        }

        private fun render(ctx: Context, m: AppWidgetManager, ids: IntArray) {
            val p = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            val lastFeed = p.getLong("lastFeed", 0)
            val sleep = p.getLong("sleep", 0)
            val v = RemoteViews(ctx.packageName, R.layout.widget_quick)
            val now = System.currentTimeMillis()
            val el = SystemClock.elapsedRealtime()
            if (lastFeed > 0) {
                v.setViewVisibility(R.id.feed_timer, View.VISIBLE)
                v.setViewVisibility(R.id.feed_none, View.GONE)
                v.setChronometer(R.id.feed_timer, el - (now - lastFeed), null, true)
                val t = p.getString("lastFeedText", "") ?: ""
                v.setTextViewText(R.id.feed_label, if (t.isBlank()) "마지막 수유 후" else "마지막 수유 후 · $t")
            } else {
                v.setViewVisibility(R.id.feed_timer, View.GONE)
                v.setViewVisibility(R.id.feed_none, View.VISIBLE)
            }
            if (sleep > 0) {
                v.setViewVisibility(R.id.sleep_box, View.VISIBLE)
                v.setChronometer(R.id.sleep_timer, el - (now - sleep), null, true)
                v.setTextViewText(R.id.b_sleep, "깸")
            } else {
                v.setViewVisibility(R.id.sleep_box, View.GONE)
                v.setTextViewText(R.id.b_sleep, "잠듦")
            }
            v.setOnClickPendingIntent(R.id.root, open(ctx, null, 100))
            v.setOnClickPendingIntent(R.id.b_feed, open(ctx, "feed", 101))
            v.setOnClickPendingIntent(R.id.b_pee, open(ctx, "pee", 102))
            v.setOnClickPendingIntent(R.id.b_poo, open(ctx, "poo", 103))
            v.setOnClickPendingIntent(R.id.b_sleep, open(ctx, "sleep", 104))
            m.updateAppWidget(ids, v)
        }

        private fun open(ctx: Context, action: String?, req: Int): PendingIntent {
            val i = Intent(ctx, if (action != null) ActionActivity::class.java else MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            if (action != null) i.putExtra(MainActivity.EXTRA_ACTION, action)
            return PendingIntent.getActivity(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
    }

    override fun onUpdate(ctx: Context, m: AppWidgetManager, ids: IntArray) = render(ctx, m, ids)
}
