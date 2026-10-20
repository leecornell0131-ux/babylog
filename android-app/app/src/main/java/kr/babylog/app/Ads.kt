package kr.babylog.app

import android.app.Activity
import android.os.Bundle
import android.view.View
import com.google.ads.mediation.admob.AdMobAdapter
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.RequestConfiguration
import java.util.Calendar

// 화면 맨 위 배너 광고 (AdMob).
// 규칙: 기록·성장·오늘 탭과 기록 입력 창에는 안 띄움. "기록"(주간·이전 기록) 탭과 "내보내기" 탭에서만,
// 밤(21시~7시)에는 끔, 건강 기록으로 맞춤 광고하지 않게 비맞춤(npa=1)으로만 요청.
// 개발자 모드에서 광고를 끄면(웹앱 localStorage 'babylog-v1-ads' = '0') 안 띄움.
object Ads {
    // 구글 테스트 배너 ID. 스토어 출시 때 AdMob에서 받은 실제 ID로 바꿈
    private const val UNIT = "ca-app-pub-3940256099942544/6300978111"
    private var started = false
    private var loaded = false

    fun night(): Boolean {
        val h = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        return h >= 21 || h < 7
    }

    fun create(a: Activity): AdView {
        if (!started) {
            started = true
            MobileAds.setRequestConfiguration(
                RequestConfiguration.Builder()
                    .setMaxAdContentRating(RequestConfiguration.MAX_AD_CONTENT_RATING_G)
                    .build()
            )
            Thread { MobileAds.initialize(a) {} }.start()
        }
        loaded = false // 화면이 새로 만들어지면 새 광고 칸에 다시 불러옴
        return AdView(a).apply {
            setAdUnitId(UNIT)
            setAdSize(AdSize.BANNER)
            visibility = View.GONE
        }
    }

    // zone: 웹앱이 지금 광고를 띄워도 되는 화면인지 (bridge.js가 알려 줌)
    fun show(v: AdView, zone: Boolean) {
        val on = zone && !night()
        if (on && !loaded) {
            loaded = true
            val extras = Bundle().apply { putString("npa", "1") }
            v.loadAd(AdRequest.Builder().addNetworkExtrasBundle(AdMobAdapter::class.java, extras).build())
        }
        v.visibility = if (on) View.VISIBLE else View.GONE
    }
}
