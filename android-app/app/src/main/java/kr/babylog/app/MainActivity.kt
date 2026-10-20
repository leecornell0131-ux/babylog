package kr.babylog.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.view.WindowInsets
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import org.json.JSONObject
import java.io.File

// 아기로그 안드로이드 앱.
// 화면은 아이폰과 같은 웹앱(GitHub Pages)을 그대로 띄우고, 위젯·잠금화면 타이머만 안드로이드 기능으로 덧붙임.
// 그래서 웹앱을 고치면 이 앱도 다시 설치하지 않고 같이 바뀜.
class MainActivity : Activity() {
    companion object {
        const val START_URL = "https://leecornell0131-ux.github.io/babylog/"
        const val HOST = "leecornell0131-ux.github.io"
        const val EXTRA_ACTION = "babylog_action"
        const val EXTRA_AT = "babylog_at"
        private const val REQ_FILE = 41
        // 떠 있는 화면 (잠금화면 "깼어요"를 바로 웹앱에 넣을 때 씀)
        var live: java.lang.ref.WeakReference<MainActivity>? = null
        private const val REQ_NOTIFY = 42
        // 같은 기록을 다시 저장해서 bridge.js가 잠금화면 알림·위젯을 새로 그리게 함
        private const val RESEND = "(function(){var v=localStorage.getItem('babylog-v1');if(v)localStorage.setItem('babylog-v1',v)})()"
    }

    private lateinit var web: WebView
    private val pending = mutableListOf<Pair<String, Long>>() // 페이지가 준비되기 전에 들어온 위젯·알림 동작 (동작, 누른 시각)
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        LiveNotify.ensureChannel(this)
        live = java.lang.ref.WeakReference(this)

        web = WebView(this)
        // 웹뷰는 자기 padding을 무시하고 그려서, 바깥 틀에 여백을 줌.
        // Android 15부터 앱이 상태 표시줄·내비게이션 바 밑까지 그려지므로 그만큼 비워 둬야 시계와 겹치지 않고 하단 탭이 눌림
        val root = FrameLayout(this)
        root.addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)
        // 상태 표시줄·내비게이션 바·키보드 아래로 화면이 들어가지 않게
        root.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val i = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                v.setPadding(i.left, i.top, i.right, i.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            // 여백은 여기서 다 줬으니 웹뷰가 같은 여백을 또 넣지 않게 막음
            if (Build.VERSION.SDK_INT >= 30) WindowInsets.CONSUMED else insets
        }

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            @Suppress("DEPRECATION")
            databaseEnabled = true
            userAgentString = "$userAgentString BabylogAndroid/${BuildConfig.VERSION_CODE}"
        }
        web.addJavascriptInterface(Bridge(), "BabyNative")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val u = req.url
                if (u.host == HOST || u.scheme == "file") return false
                // 다른 사이트 링크는 휴대폰 브라우저로 엶
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, u)) }
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (Uri.parse(url).host != HOST) return
                view.evaluateJavascript(assets.open("bridge.js").bufferedReader().readText(), null)
                // 앱이 꺼져 있을 때 잠금화면에서 누른 "깼어요"·"끝"도 누른 시각으로 넣음
                flushStops()
                val todo = pending.toList()
                pending.clear()
                todo.forEach { (a, at) -> runAction(a, at) }
            }

            override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                if (req.isForMainFrame) view.loadUrl("file:///android_asset/offline.html")
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            // 웹앱의 "불러오기"(백업·삐요로그 파일 고르기)
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = cb
                return try {
                    startActivityForResult(params.createIntent().apply { type = "*/*" }, REQ_FILE)
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    false
                }
            }
        }

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(START_URL)
        takeAction(intent)

        Updater.check(this)
        Push.refreshConfig(this)
        offerWidgetOnce()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        takeAction(intent)
    }

    override fun onResume() {
        super.onResume()
        // 다른 휴대폰에서 바뀐 기록이 있으면 화면을 새로 그림 (가족 공유는 웹앱이 처리)
        web.evaluateJavascript("window.BabyApp&&BabyApp.refresh()", null)
        // 휴대폰 설정에서 알림을 막 켜고 돌아왔을 때도 진행 중 타이머 알림이 바로 뜨게 다시 보냄
        web.evaluateJavascript(RESEND, null)
    }

    // 위젯·알림 버튼은 ActionActivity를 거쳐 누른 시각(EXTRA_AT)과 함께 들어옴.
    // 이미 처리한 시각 이후의 것만 실행해서, 앱이 다시 만들어지거나 최근 앱 목록에서 열릴 때 같은 기록이 또 생기지 않게 함
    private fun takeAction(i: Intent?) {
        val a = i?.getStringExtra(EXTRA_ACTION) ?: return
        val at = i.getLongExtra(EXTRA_AT, 0)
        i.removeExtra(EXTRA_ACTION)
        val p = getSharedPreferences("babylog", MODE_PRIVATE)
        if (at <= p.getLong("lastActionAt", 0) || System.currentTimeMillis() - at > 60_000) return
        p.edit().putLong("lastActionAt", at).apply()
        runAction(a, at)
    }

    // 잠금화면에서 누른 "깼어요"·"끝"을 웹앱에 넣고, 들어간 것만 저장 목록에서 지움
    fun flushStops() = runOnUiThread {
        val stops = StopReceiver.pending(this)
        for (i in 0 until stops.length()) {
            val o = stops.optJSONObject(i) ?: continue
            val a = o.optString("a")
            val at = o.optLong("at")
            web.evaluateJavascript("window.__babyQuick?__babyQuick('$a',$at):'notready'") { r ->
                if (r?.contains("ok") == true) StopReceiver.done(this, a, at)
            }
        }
    }

    private fun runAction(a: String, at: Long) {
        web.evaluateJavascript("window.__babyQuick?__babyQuick('$a',$at):'notready'") { r ->
            if (r?.contains("notready") != false) pending.add(a to at) // 페이지가 아직 안 열렸으면 열린 뒤 실행
        }
    }

    override fun onDestroy() {
        if (live?.get() === this) live = null
        super.onDestroy()
    }

    @Deprecated("Activity API")
    override fun onBackPressed() {
        // 열린 입력 창이 있으면 닫고, 없으면 앱을 뒤로 보냄
        web.evaluateJavascript("(function(){var s=document.getElementById('sheetRoot');if(s&&s.innerHTML){s.innerHTML='';return 1}return 0})()") { r ->
            if (r != "1") moveTaskToBack(true)
        }
    }

    @Deprecated("Activity API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_FILE) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
            return
        }
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
    }

    // 처음 한 번만 홈 화면 위젯을 추가할지 물어봄
    private fun offerWidgetOnce() {
        val p = getSharedPreferences("babylog", MODE_PRIVATE)
        if (p.getBoolean("widgetOffered", false)) return
        p.edit().putBoolean("widgetOffered", true).apply()
        val m = getSystemService(AppWidgetManager::class.java)
        if (!m.isRequestPinAppWidgetSupported) return
        android.app.AlertDialog.Builder(this)
            .setTitle("홈 화면 위젯")
            .setMessage("홈 화면에 위젯을 두면 마지막 수유 후 지난 시간이 보이고, 버튼 한 번으로 소변·대변·수면을 기록할 수 있어요.")
            .setPositiveButton("위젯 추가") { _, _ -> m.requestPinAppWidget(ComponentName(this, QuickWidget::class.java), null, null) }
            .setNegativeButton("나중에", null)
            .show()
    }

    private fun askNotifyPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFY)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_NOTIFY) web.evaluateJavascript(RESEND, null)
    }

    // 웹앱에서 부르는 안드로이드 기능 (window.BabyNative)
    inner class Bridge {
        @JavascriptInterface
        fun update(json: String) {
            val o = JSONObject(json)
            runOnUiThread {
                // 타이머가 처음 시작될 때 알림 권한을 물어봄
                if (!o.isNull("sleep") || !o.isNull("feed")) askNotifyPermission()
                LiveNotify.update(this@MainActivity, o)
                Widgets.save(this@MainActivity, o)
                Push.onLocal(this@MainActivity, if (o.isNull("fid")) null else o.optString("fid"))
            }
        }

        // 웹앱이 알림 서버에 요약을 보낼 때 이 휴대폰은 빼도록 알려 줌
        @JavascriptInterface
        fun pushToken(): String = Push.token(this@MainActivity) ?: ""

        @JavascriptInterface
        fun shareFile(name: String, mime: String, base64: String) {
            val safe = name.replace(Regex("[^\\w.\\-가-힣]"), "_")
            val dir = File(cacheDir, "share").apply { mkdirs() }
            File(dir, safe).writeBytes(Base64.decode(base64, Base64.DEFAULT))
            val uri = Uri.parse("content://kr.babylog.app.share/$safe")
            val send = Intent(Intent.ACTION_SEND).apply {
                type = mime
                putExtra(Intent.EXTRA_STREAM, uri)
                clipData = ClipData.newRawUri(safe, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            runOnUiThread { startActivity(Intent.createChooser(send, "백업 파일 저장·보내기")) }
        }

        @JavascriptInterface
        fun shareText(text: String) {
            val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }
            runOnUiThread { startActivity(Intent.createChooser(send, "보내기")) }
        }

        @JavascriptInterface
        fun copy(text: String) {
            runOnUiThread {
                (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("아기로그", text))
            }
        }

        @JavascriptInterface
        fun reload() = runOnUiThread { web.loadUrl(START_URL) }

        @JavascriptInterface
        fun version(): Int = BuildConfig.VERSION_CODE

        // 홈 화면에 위젯 추가 창 띄우기
        @JavascriptInterface
        fun pinWidget() = runOnUiThread {
            val m = getSystemService(AppWidgetManager::class.java)
            if (m.isRequestPinAppWidgetSupported) m.requestPinAppWidget(ComponentName(this@MainActivity, QuickWidget::class.java), null, null)
            else Toast.makeText(this@MainActivity, "홈 화면을 길게 누르고 위젯 > 아기로그를 골라 주세요", Toast.LENGTH_LONG).show()
        }
    }
}
