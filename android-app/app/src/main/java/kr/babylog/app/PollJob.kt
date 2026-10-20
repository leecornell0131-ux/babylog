package kr.babylog.app

import android.app.job.JobParameters
import android.app.job.JobService

// 구버전에서 예약된 job을 안전하게 끝내기 위해 클래스/manifest 항목은 유지.
// 새 APK는 이 job을 예약하지 않으며 여기서 네트워크를 사용하지 않는다.
class PollJob : JobService() {
    override fun onStartJob(params: JobParameters): Boolean = false
    override fun onStopJob(params: JobParameters) = false
}
