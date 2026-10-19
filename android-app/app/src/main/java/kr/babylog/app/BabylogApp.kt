package kr.babylog.app

import android.app.Application

class BabylogApp : Application() {
    override fun onCreate() {
        super.onCreate()
        LiveNotify.ensureChannel(this)
        // 푸시가 앱이 꺼진 상태에서 와도 받을 수 있게 Firebase를 먼저 켬 (설정을 받아 둔 경우만)
        Push.init(this)
    }
}
