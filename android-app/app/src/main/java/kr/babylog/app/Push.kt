package kr.babylog.app

import android.app.job.JobScheduler
import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

// 배우자가 다른 휴대폰에서 기록하면 위젯·잠금화면 타이머를 바로 바꾸는 부분.
// 1) 알림 서버(Cloudflare Worker)가 FCM 푸시로 요약을 보내 줌 (몇 초 안)
// 2) 앱 실행 시 웹앱의 Firestore 리스너가 누락 변경분을 받고 bridge가 위젯을 갱신.
// 정기 서버 조회 없음. FCM 지연 시 앱 실행 전까지 위젯 정보가 늦어질 수 있음.
// 설정(서버 주소, Firebase 값)은 저장소의 android-app/push-config.json을 인터넷에서 읽음. 없으면 이 기능만 꺼짐.
object Push {
    private const val CONFIG_URL = "https://leecornell0131-ux.github.io/babylog/android-app/push-config.json"
    private const val PREF = "babylog_push"
    private const val JOB_ID = 7101

    private fun p(ctx: Context) = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
    private fun config(ctx: Context): JSONObject? = p(ctx).getString("config", null)?.let { runCatching { JSONObject(it) }.getOrNull() }

    fun init(ctx: Context) {
        cancelLegacyPoll(ctx)
        val cfg = config(ctx) ?: return
        startFirebase(ctx, cfg)
    }

    fun token(ctx: Context): String? = p(ctx).getString("token", null)
    fun fid(ctx: Context): String? = p(ctx).getString("fid", null)

    // 앱을 열 때마다 설정을 다시 읽음 (서버를 처음 올렸거나 주소가 바뀐 경우)
    fun refreshConfig(ctx: Context) {
        val app = ctx.applicationContext
        thread {
            val txt = get("$CONFIG_URL?t=${System.currentTimeMillis()}") ?: return@thread
            val cfg = runCatching { JSONObject(txt) }.getOrNull() ?: return@thread
            if (cfg.optString("worker").isBlank() || cfg.optJSONObject("firebase") == null) return@thread
            if (cfg.toString() != config(app)?.toString()) p(app).edit().putString("config", cfg.toString()).apply()
            startFirebase(app, cfg)
            ensureRegistered(app)
        }
    }

    private fun startFirebase(ctx: Context, cfg: JSONObject) {
        val app = ctx.applicationContext
        try {
            if (FirebaseApp.getApps(app).isEmpty()) {
                val f = cfg.getJSONObject("firebase")
                FirebaseApp.initializeApp(
                    app,
                    FirebaseOptions.Builder()
                        .setApiKey(f.getString("apiKey"))
                        .setApplicationId(f.getString("appId"))
                        .setProjectId(f.getString("projectId"))
                        .setGcmSenderId(f.optString("senderId"))
                        .build()
                )
            }
            FirebaseMessaging.getInstance().token.addOnSuccessListener { onToken(app, it) }
        } catch (_: Exception) {
        }
    }

    fun onToken(ctx: Context, token: String) {
        p(ctx).edit().putString("token", token).apply()
        ensureRegistered(ctx)
    }

    // 이 휴대폰에서 기록이 바뀜: 지금 화면 상태가 가장 최신이므로 그보다 오래된 요약은 무시
    fun onLocal(ctx: Context, fid: String?) {
        val e = p(ctx).edit().putLong("appliedAt", System.currentTimeMillis())
        if (fid != p(ctx).getString("fid", null)) e.putString("fid", fid)
        e.apply()
        ensureRegistered(ctx)
        cancelLegacyPoll(ctx)
    }

    // 알림 서버에 "이 가족의 이 휴대폰"을 등록 (가족이나 푸시 주소가 바뀌었을 때만)
    private fun ensureRegistered(ctx: Context) {
        val pr = p(ctx)
        val worker = config(ctx)?.optString("worker")?.trimEnd('/') ?: return
        val token = pr.getString("token", null) ?: return
        val fid = pr.getString("fid", null)
        val regFid = pr.getString("regFid", null)
        val regToken = pr.getString("regToken", null)
        if (fid == regFid && token == regToken) return
        thread {
            // 예전 가족 등록을 지우지 못했으면 기록을 남겨 두고 다음에 다시 시도함
            val unOk = regFid == null || regToken == null ||
                post("$worker/unregister", JSONObject().put("fid", regFid).put("token", regToken))
            val regOk = fid == null || post("$worker/register", JSONObject().put("fid", fid).put("token", token))
            if (unOk && regOk) pr.edit().putString("regFid", fid).putString("regToken", token).apply()
            else if (regOk && fid == regFid) pr.edit().putString("regToken", token).apply()
        }
    }

    // 푸시로 받은 요약을 위젯·잠금화면에 반영
    fun apply(ctx: Context, s: JSONObject) {
        val at = s.optLong("at", 0)
        if (at <= p(ctx).getLong("appliedAt", 0)) return
        p(ctx).edit().putLong("appliedAt", at).apply()
        LiveNotify.update(ctx, s)
        Widgets.save(ctx, s)
    }

    fun poll(ctx: Context) {
        val worker = config(ctx)?.optString("worker")?.trimEnd('/') ?: return
        val fid = p(ctx).getString("fid", null) ?: return
        val txt = get("$worker/summary?fid=$fid") ?: return
        val s = runCatching { JSONObject(txt).optJSONObject("summary") }.getOrNull() ?: return
        apply(ctx, s)
    }

    private fun cancelLegacyPoll(ctx: Context) {
        // APK 업데이트 전에 예약된 작업도 제거. 기존 job ID는 바꾸지 않는다.
        ctx.getSystemService(JobScheduler::class.java).cancel(JOB_ID)
    }

    private fun get(url: String): String? = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 8000
        c.readTimeout = 8000
        c.useCaches = false
        if (c.responseCode == 200) c.inputStream.bufferedReader().readText() else null
    } catch (_: Exception) {
        null
    }

    private fun post(url: String, body: JSONObject): Boolean = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 8000
        c.readTimeout = 8000
        c.requestMethod = "POST"
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json")
        c.outputStream.use { it.write(body.toString().toByteArray()) }
        c.responseCode == 200
    } catch (_: Exception) {
        false
    }
}
