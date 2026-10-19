package kr.babylog.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

// 새 버전 확인. 화면(웹앱)은 저절로 최신이 되고, 안드로이드 쪽(위젯·알림)이 바뀐 경우에만 새 APK를 받아야 함.
// GitHub 저장소의 최신 릴리스(android-빌드번호)를 하루 한 번 확인해서 이 앱보다 새것이면 알려 줌.
object Updater {
    private const val API = "https://api.github.com/repos/leecornell0131-ux/babylog/releases/latest"

    fun check(a: Activity) {
        val p = a.getSharedPreferences("babylog", Activity.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        if (now - p.getLong("updateCheckedAt", 0) < 6 * 3600_000L) return
        thread {
            try {
                val c = URL(API).openConnection() as HttpURLConnection
                c.connectTimeout = 8000
                c.readTimeout = 8000
                c.setRequestProperty("Accept", "application/vnd.github+json")
                if (c.responseCode != 200) return@thread
                val j = JSONObject(c.inputStream.bufferedReader().readText())
                p.edit().putLong("updateCheckedAt", now).apply()
                val latest = j.optString("tag_name").removePrefix("android-").toIntOrNull() ?: return@thread
                if (latest <= BuildConfig.VERSION_CODE) return@thread
                val assets = j.optJSONArray("assets")
                var url = j.optString("html_url")
                for (i in 0 until (assets?.length() ?: 0)) {
                    val o = assets!!.getJSONObject(i)
                    if (o.optString("name").endsWith(".apk")) url = o.optString("browser_download_url")
                }
                val notes = j.optString("body").lines().filter { it.startsWith("- ") }.take(5).joinToString("\n")
                a.runOnUiThread {
                    if (a.isFinishing) return@runOnUiThread
                    AlertDialog.Builder(a)
                        .setTitle("새 버전이 있어요")
                        .setMessage("위젯이나 잠금화면 기능이 바뀐 새 버전이에요. 받은 파일을 열어 설치하면 기록은 그대로 남아요." + if (notes.isNotBlank()) "\n\n$notes" else "")
                        .setPositiveButton("받기") { _, _ -> a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                        .setNegativeButton("나중에", null)
                        .show()
                }
            } catch (_: Exception) {
            }
        }
    }
}
