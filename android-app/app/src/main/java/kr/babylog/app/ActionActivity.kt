package kr.babylog.app

import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.os.Bundle

// 위젯·알림 버튼, 음성 명령을 받으면 잠깐 거쳐 가는 보이지 않는 화면.
// 누른 시각을 붙여 MainActivity로 넘겨서, 같은 버튼 기록이 두 번 생기거나 빠지지 않게 함
class ActionActivity : Activity() {
    companion object {
        // 음성 명령용 이름표(AndroidManifest의 activity-alias). 빅스비·구글 어시스턴트에 "아기깼어 열어"처럼 말하면 이 이름으로 열림
        val VOICE = mapOf(
            "kr.babylog.app.VoiceSleep" to "sleep_start",
            "kr.babylog.app.VoiceWake" to "stop_sleep",
            "kr.babylog.app.VoiceFeed" to "feed_start",
            "kr.babylog.app.VoiceFeedEnd" to "stop_feed",
            "kr.babylog.app.VoicePee" to "pee",
            "kr.babylog.app.VoicePoo" to "poo",
        )
        val SAID = mapOf(
            "sleep_start" to "잠듦", "stop_sleep" to "깼어요", "feed_start" to "수유 시작",
            "stop_feed" to "수유 끝", "pee" to "소변", "poo" to "대변",
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val voice = VOICE[intent.component?.className]
        // 음성 이름표로 열렸으면 이름표에 정해진 동작만 씀 (다른 앱이 붙여 보낸 값은 무시)
        val a = voice ?: intent.getStringExtra(MainActivity.EXTRA_ACTION)
        val at = System.currentTimeMillis()
        if (a != null && voice != null && getSystemService(KeyguardManager::class.java).isKeyguardLocked) {
            // 잠금 상태에서 음성으로 부르면 앱을 열지 않고 기록 (잠금화면 "깼어요"와 같은 방식).
            // 끝낼 타이머가 없거나 이미 진행 중이면 기록하지 않고 그대로 말해 줌
            val d = Widgets.Data(this)
            val no = when {
                a == "stop_sleep" && d.sleep == 0L -> "자는 중인 기록이 없어요"
                a == "stop_feed" && d.feed == 0L -> "진행 중인 수유가 없어요"
                a == "sleep_start" && d.sleep > 0 -> "이미 자는 중이에요"
                a == "feed_start" && d.feed > 0 -> "이미 수유 중이에요"
                else -> null
            }
            if (no != null) Speak.say(this, no)
            else if (!StopReceiver.record(this, a, at, SAID[a] ?: "")) Speak.say(this, (SAID[a] ?: "") + " 저장했어요. 앱을 열면 기록돼요")
        } else if (a != null) {
            startActivity(
                Intent(this, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra(MainActivity.EXTRA_ACTION, a)
                    .putExtra(MainActivity.EXTRA_AT, at)
                    .putExtra(MainActivity.EXTRA_VOICE, voice != null)
            )
        }
        finish()
    }
}
