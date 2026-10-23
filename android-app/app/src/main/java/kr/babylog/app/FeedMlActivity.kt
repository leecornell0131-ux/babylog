package kr.babylog.app

import android.Manifest
import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.Gravity
import android.widget.Button
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.TextView

// 음성 명령 "수유기록": "몇 미리 먹었어요?"라고 묻고 숫자를 들어 지금 시각 수유로 기록.
// 빅스비·구글 어시스턴트는 "열어" 명령에 숫자를 넘겨주지 못해서, 앱이 직접 한 번 더 들음.
// 말이 안 들리거나 마이크 권한이 없으면 큰 ml 버튼을 눌러도 됨. 잠금 상태에서도 열림
class FeedMlActivity : Activity() {
    companion object {
        private const val REQ_MIC = 7

        // "120", "120미리", "백이십", "백 이십 밀리" → 120. 5~400ml만 받음
        fun parseMl(s: String): Int? {
            Regex("\\d{1,3}").find(s)?.value?.toIntOrNull()?.let { return it.takeIf { n -> n in 5..400 } }
            val dig = mapOf('일' to 1, '이' to 2, '삼' to 3, '사' to 4, '오' to 5, '육' to 6, '칠' to 7, '팔' to 8, '구' to 9)
            // "백이십이요"·"백이요"처럼 끝에 붙는 "이요/요/예요"는 숫자가 아님 (안 떼면 122·102로 읽힘)
            val t = s.trim().replace(Regex("\\s*(이에요|이예요|이요|예요|에요|요)$"), "")
            var total = 0; var cur = 0; var any = false
            for (c in t) {
                when {
                    c in dig -> { cur = dig.getValue(c); any = true }
                    c == '백' -> { total += (if (cur == 0) 1 else cur) * 100; cur = 0; any = true }
                    c == '십' -> { total += (if (cur == 0) 1 else cur) * 10; cur = 0; any = true }
                    c == ' ' -> {}
                    any -> break
                }
            }
            total += cur
            return total.takeIf { any && it in 5..400 }
        }
    }

    private var rec: SpeechRecognizer? = null
    private var done = false
    private lateinit var status: TextView
    private val ui = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)

        val d = Widgets.Data(this)
        val last = Regex("\\d+").find(d.lastFeedAmt)?.value?.toIntOrNull()?.takeIf { it in 10..400 } ?: 100
        val base = (last + 5) / 10 * 10
        val night = resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK == android.content.res.Configuration.UI_MODE_NIGHT_YES
        val ink = if (night) Color.WHITE else Color.parseColor("#2B2B2B")
        val bg = if (night) Color.parseColor("#1C1B1F") else Color.WHITE
        val pink = Color.parseColor(if (night) "#5A2E44" else "#FCE4EF")
        val pinkInk = Color.parseColor(if (night) "#FFB3D1" else "#C2185B")
        val dp = resources.displayMetrics.density

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setBackgroundColor(bg)
            setPadding((20 * dp).toInt(), (48 * dp).toInt(), (20 * dp).toInt(), (24 * dp).toInt())
        }
        root.addView(TextView(this).apply {
            text = "🍼 몇 ml 먹었나요?"; textSize = 30f; setTextColor(ink); typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
        })
        status = TextView(this).apply {
            text = "숫자를 말하거나 아래를 눌러 주세요"; textSize = 18f; setTextColor(ink); gravity = Gravity.CENTER
            setPadding(0, (12 * dp).toInt(), 0, (20 * dp).toInt())
        }
        root.addView(status)

        // 지난번 양을 가운데에 두고 10ml 간격 9개
        val grid = GridLayout(this).apply { columnCount = 3 }
        for (i in -4..4) {
            val ml = base + i * 10
            if (ml < 10) continue
            grid.addView(Button(this).apply {
                text = "$ml"; textSize = 28f; isAllCaps = false; typeface = Typeface.DEFAULT_BOLD
                setTextColor(if (i == 0) Color.WHITE else pinkInk)
                background = GradientDrawable().apply {
                    cornerRadius = 18 * dp; setColor(if (i == 0) Color.parseColor("#E0457B") else pink)
                }
                setOnClickListener { save(ml) }
            }, GridLayout.LayoutParams(GridLayout.spec(GridLayout.UNDEFINED, 1f), GridLayout.spec(GridLayout.UNDEFINED, 1f)).apply {
                width = 0; height = (84 * dp).toInt(); setMargins((6 * dp).toInt(), (6 * dp).toInt(), (6 * dp).toInt(), (6 * dp).toInt())
            })
        }
        root.addView(grid, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        root.addView(Button(this).apply {
            text = "취소"; textSize = 20f; setTextColor(ink); setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (64 * dp).toInt()).apply { topMargin = (12 * dp).toInt() })
        setContentView(root)

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) ask()
        else if (!getSystemService(KeyguardManager::class.java).isKeyguardLocked) requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
        else status.text = "아래를 눌러 주세요 (말로 넣으려면 잠금을 풀고 한 번 마이크를 허용해 주세요)"
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        if (requestCode == REQ_MIC && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) ask()
        else status.text = "아래를 눌러 주세요"
    }

    // 먼저 묻고, 말이 끝나면 듣기 시작 (안 그러면 앱 목소리를 숫자로 알아들을 수 있음)
    private fun ask() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { status.text = "아래를 눌러 주세요"; return }
        Speak.say(this, "몇 미리 먹었어요?") { ui.post { listen(2) } }
    }

    private fun listen(tries: Int) {
        if (done || isFinishing) return
        rec?.destroy()
        val r = SpeechRecognizer.createSpeechRecognizer(this)
        rec = r
        status.text = "🎤 듣고 있어요…"
        r.setRecognitionListener(object : RecognitionListener {
            override fun onResults(b: Bundle?) {
                val said = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
                val ml = said.firstNotNullOfOrNull { parseMl(it) }
                if (ml != null) save(ml) else retry(tries, said.firstOrNull())
            }
            override fun onError(error: Int) = retry(tries, null)
            override fun onReadyForSpeech(p: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(v: Float) {}
            override fun onBufferReceived(b: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(b: Bundle?) {}
            override fun onEvent(t: Int, b: Bundle?) {}
        })
        r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR")
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5))
    }

    private fun retry(tries: Int, heard: String?) {
        if (done || isFinishing) return
        if (tries > 1) {
            status.text = if (heard != null) "\"$heard\"… 다시 말해 주세요" else "다시 말해 주세요"
            ui.postDelayed({ listen(tries - 1) }, 300)
        } else status.text = "잘 안 들렸어요. 아래를 눌러 주세요"
    }

    private fun save(ml: Int) {
        if (done) return
        done = true
        rec?.destroy(); rec = null
        val a = "feed_ml:$ml"
        val at = System.currentTimeMillis()
        status.text = "✓ ${ml}ml 기록했어요"
        if (getSystemService(KeyguardManager::class.java).isKeyguardLocked) {
            // 잠금 상태: 앱을 열지 않고 저장 (잠금화면 "깼어요"와 같은 방식)
            if (!StopReceiver.record(this, a, at, "수유 ${ml}ml")) Speak.say(this, "수유 ${ml}미리 저장했어요. 앱을 열면 기록돼요")
        } else {
            startActivity(Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra(MainActivity.EXTRA_ACTION, a)
                .putExtra(MainActivity.EXTRA_AT, at)
                .putExtra(MainActivity.EXTRA_VOICE, true))
        }
        ui.postDelayed({ finish() }, 600)
    }

    override fun onDestroy() {
        rec?.destroy(); rec = null
        ui.removeCallbacksAndMessages(null)
        super.onDestroy()
    }
}
