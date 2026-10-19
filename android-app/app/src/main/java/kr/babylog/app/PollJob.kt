package kr.babylog.app

import android.app.job.JobParameters
import android.app.job.JobService
import kotlin.concurrent.thread

// 15분마다 알림 서버의 마지막 요약을 확인 (푸시가 늦거나 막혔을 때 대비)
class PollJob : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        thread {
            Push.poll(this)
            jobFinished(params, false)
        }
        return true
    }

    override fun onStopJob(params: JobParameters) = true
}
