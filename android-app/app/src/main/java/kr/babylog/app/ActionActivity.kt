package kr.babylog.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle

// 위젯·알림 버튼을 누르면 잠깐 거쳐 가는 보이지 않는 화면.
// 누른 시각을 붙여 MainActivity로 넘겨서, 같은 버튼 기록이 두 번 생기거나 빠지지 않게 함
class ActionActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent.getStringExtra(MainActivity.EXTRA_ACTION)?.let { a ->
            startActivity(
                Intent(this, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra(MainActivity.EXTRA_ACTION, a)
                    .putExtra(MainActivity.EXTRA_AT, System.currentTimeMillis())
            )
        }
        finish()
    }
}
