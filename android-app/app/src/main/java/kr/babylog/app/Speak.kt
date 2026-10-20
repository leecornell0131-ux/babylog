package kr.babylog.app

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

// 음성 명령으로 기록했을 때 "깼어요 기록했어요"처럼 소리로 알려 줌 (휴대폰 기본 음성, 무료)
object Speak {
    private var tts: TextToSpeech? = null

    fun say(ctx: Context, text: String) {
        if (text.isBlank()) return
        tts?.shutdown()
        var t: TextToSpeech? = null
        t = TextToSpeech(ctx.applicationContext) { st ->
            val s = t ?: return@TextToSpeech
            if (st != TextToSpeech.SUCCESS) return@TextToSpeech
            s.language = Locale.KOREAN
            s.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(id: String?) {}
                override fun onDone(id: String?) { s.shutdown(); if (tts === s) tts = null }
                @Deprecated("old") override fun onError(id: String?) { s.shutdown(); if (tts === s) tts = null }
            })
            s.speak(text, TextToSpeech.QUEUE_FLUSH, null, "babylog")
        }
        tts = t
    }
}
