package kr.babylog.app

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

// 알림 서버가 보낸 요약 푸시를 받음 (앱이 꺼져 있어도 옴)
class PushService : FirebaseMessagingService() {
    override fun onMessageReceived(msg: RemoteMessage) {
        val d = msg.data
        if (d["kind"] != "summary") return
        // 가족 공유를 바꾸기 전에 보낸 푸시는 무시
        if (d["fid"] == null || d["fid"] != Push.fid(this)) return
        val o = JSONObject()
        for (k in Widgets.NUM_KEYS + "at") o.put(k, d[k]?.toLongOrNull() ?: JSONObject.NULL)
        for (k in Widgets.STR_KEYS) o.put(k, d[k] ?: JSONObject.NULL)
        Push.apply(this, o)
    }

    override fun onNewToken(token: String) = Push.onToken(this, token)
}
