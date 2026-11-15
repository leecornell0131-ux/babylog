package kr.babylog.wear

import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.delay
import kr.babylog.app.Tr
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

val FeedC = Color(0xFFF59AB8)
val SleepC = Color(0xFF8E9BFF)
val PooC = Color(0xFFB07E55)
val PeeC = Color(0xFFF5C94C)
val AwakeC = Color(0xFF7DD3FC)
val OkC = Color(0xFF6EE7A8)
val Ink = Color(0xFF2A1020)

// 베이비노트 갤럭시워치 앱 (목업 design/워치_갤럭시워치_목업.png). 탭 2번으로 수유·수면·기저귀 기록.
// 타일 버튼으로 열면 "go"에 화면 이름(feed·diaper·sleep)이 옴
class WearActivity : ComponentActivity() {
    private val go = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        go.value = intent.getStringExtra("go")
        setContent { MaterialTheme { App(go) } }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        go.value = intent.getStringExtra("go")
    }

    // 처음 깔았을 때 등: 휴대폰이 마지막으로 보낸 요약을 직접 꺼내 봄
    override fun onResume() {
        super.onResume()
        Wearable.getDataClient(this).dataItems.addOnSuccessListener { items ->
            for (i in items) {
                if (i.uri.path != "/babylog/summary") continue
                val m = DataMapItem.fromDataItem(i).dataMap
                m.getString("lang")?.let { Tr.set(this, it) }
                m.getString("s")?.let { Store.take(this, it) }
            }
            items.release()
        }
    }
}

fun buzz(ctx: android.content.Context) {
    runCatching { ctx.getSystemService(Vibrator::class.java).vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)) }
}

@Composable
fun App(go: MutableState<String?>) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val s by Store.sum.collectAsState()
    val sent by Store.sent.collectAsState()
    var screen by remember { mutableStateOf("home") }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(20_000) } }
    LaunchedEffect(go.value) {
        when (go.value) {
            "feed" -> screen = "feed"
            "diaper" -> screen = "diaper"
            "sleep" -> if (s.sleep == 0L) record(ctx, "sleep_start", Tr.t("🌙 잠듦"))
        }
        go.value = null
    }
    BackHandler(enabled = screen != "home" || sent != null) {
        if (sent != null) commitNow(ctx) else screen = "home"
    }

    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
        when {
            sent != null -> Done(ctx, sent!!)
            screen == "feed" -> Feed(ctx) { screen = "home" }
            screen == "diaper" -> Diaper(ctx) { screen = "home" }
            s.sleep > 0 -> Timer("😴 " + Tr.t("수면 중"), s.sleep, now, SleepC, Tr.t("👀 깼어요"), AwakeC) { record(ctx, "stop_sleep", Tr.t("👀 깼어요")) }
            s.feed > 0 -> Timer("🤱 " + Tr.f("{0} 중", Tr.v(s.feedLabel.ifEmpty { "수유" })), s.feed, now, FeedC, Tr.t("수유 끝"), FeedC) {
                record(ctx, "stop_feed", Tr.t("🍼 수유 끝"))
            }
            else -> Home(s, now, onFeed = { screen = "feed" }, onSleep = { record(ctx, "sleep_start", Tr.t("🌙 잠듦")) }, onDiaper = { screen = "diaper" })
        }
    }
}

// MARK 기록 (5초 동안 되돌릴 수 있게 기다렸다가 보냄)

private val ticker = android.os.Handler(android.os.Looper.getMainLooper())

fun record(ctx: android.content.Context, a: String, label: String) {
    Store.sent.value?.let { if (it.state == "waiting") Store.send(ctx, it) }
    ticker.removeCallbacksAndMessages(null)
    val s = Store.newSent(a, label)
    Store.sent.value = s
    Store.left.value = 5
    buzz(ctx)
    fun tick() {
        val cur = Store.sent.value
        if (cur?.id != s.id || cur.state != "waiting") return
        if (Store.left.value <= 1) { Store.send(ctx, cur); return }
        Store.left.value -= 1
        ticker.postDelayed({ tick() }, 1000)
    }
    ticker.postDelayed({ tick() }, 1000)
}

fun commitNow(ctx: android.content.Context) {
    val cur = Store.sent.value
    if (cur != null && cur.state == "waiting") { ticker.removeCallbacksAndMessages(null); Store.send(ctx, cur) }
    Store.sent.value = null
}

@Composable
fun Home(s: Sum, now: Long, onFeed: () -> Unit, onSleep: () -> Unit, onDiaper: () -> Unit) {
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxWidth().padding(top = 26.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            if (s.lastWake > 0) {
                Text(Tr.f("👀 깬 지 {0}", dur(now - s.lastWake)), color = AwakeC, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.background(AwakeC.copy(alpha = 0.18f), RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 2.dp))
            }
            val info = listOfNotNull(
                if (s.lastFeed > 0) "🍼 " + Tr.f("{0} 전", dur(now - s.lastFeed)) else null,
                if (s.lastDiaper > 0) "💩 " + Tr.f("{0} 전", dur(now - s.lastDiaper)) else null,
            ).joinToString("  ")
            Text(if (!s.has) Tr.t("폰 앱을 한 번 열어 주세요") else info, color = Color(0xFF9A95AD), fontSize = 12.sp,
                textAlign = TextAlign.Center, modifier = Modifier.padding(top = 3.dp, start = 20.dp, end = 20.dp))
        }
        Round("🍼", Tr.t("수유"), FeedC, Modifier.align(Alignment.Center).offset(x = (-50).dp, y = (-4).dp), onClick = onFeed)
        Round("💩", Tr.t("기저귀"), PooC, Modifier.align(Alignment.Center).offset(x = 50.dp, y = (-4).dp), onClick = onDiaper)
        Round("😴", Tr.t("재우기"), SleepC, Modifier.align(Alignment.Center).offset(y = 58.dp), onClick = onSleep)
    }
}

@Composable
fun Round(icon: String, text: String, c: Color, m: Modifier, size: Int = 74, onClick: () -> Unit) {
    Column(m.size(size.dp).background(c, CircleShape).clickable { onClick() },
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text(icon, fontSize = 26.sp)
        Text(text, color = Ink, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold)
    }
}

@Composable
fun Timer(title: String, since: Long, now: Long, c: Color, btn: String, btnC: Color, onClick: () -> Unit) {
    val hm = SimpleDateFormat("HH:mm", Locale.ROOT).format(Date(since))
    Column(Modifier.fillMaxSize().background(Brush.radialGradient(listOf(c.copy(alpha = 0.3f), Color.Black))),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text(title, color = c, fontSize = 14.sp)
        Text(Tr.f("{0}부터", hm), color = Color(0xFF9A95AD), fontSize = 12.sp)
        Text(dur(now - since), color = Color.White, fontSize = 38.sp, fontWeight = FontWeight.ExtraBold)
        Spacer(Modifier.height(8.dp))
        Text(btn, color = Ink, fontSize = 17.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center,
            modifier = Modifier.width(150.dp).background(btnC, RoundedCornerShape(50)).clickable { onClick() }.padding(vertical = 10.dp))
    }
}

@Composable
fun Feed(ctx: android.content.Context, back: () -> Unit) {
    LaunchedEffect(Unit) { Store.loadFeed(ctx) }
    var kind by remember { mutableStateOf(if (Store.feedSub == "pump") "pump" else "formula") }
    var ml by remember { mutableIntStateOf(Store.ml) }
    val focus = remember { FocusRequester() }
    var acc by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(kind) { if (kind != "breast") runCatching { focus.requestFocus() } }
    Column(
        Modifier.fillMaxSize()
            // 베젤(또는 터치 베젤)을 돌리면 10ml씩
            .onRotaryScrollEvent { e ->
                acc += e.verticalScrollPixels
                if (kotlin.math.abs(acc) > 40f) {
                    ml = (ml + if (acc > 0) 5 else -5).coerceIn(5, 300)
                    acc = 0f
                    buzz(ctx)
                }
                true
            }
            .focusRequester(focus).focusable(),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            listOf("formula" to Tr.t("분유"), "pump" to Tr.t("유축"), "breast" to Tr.t("모유")).forEach { (k, t) ->
                Text(t, color = if (kind == k) Ink else Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.background(if (kind == k) FeedC else Color(0xFF262626), RoundedCornerShape(50))
                        .clickable { kind = k }.padding(horizontal = 9.dp, vertical = 4.dp))
            }
        }
        if (kind == "breast") {
            Text(Tr.t("시작할 쪽을 골라 주세요"), color = Color(0xFF9A95AD), fontSize = 12.sp, modifier = Modifier.padding(vertical = 8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Round("🤱", Tr.t("왼쪽"), FeedC, Modifier, 66) { back(); record(ctx, "feed_start:breastL", "🤱 " + Tr.t("모유 왼쪽")) }
                Round("🤱", Tr.t("오른쪽"), FeedC, Modifier, 66) { back(); record(ctx, "feed_start:breastR", "🤱 " + Tr.t("모유 오른쪽")) }
            }
        } else {
            Row(verticalAlignment = Alignment.Bottom) {
                Text("−", color = FeedC, fontSize = 26.sp, modifier = Modifier.clickable { ml = (ml - 5).coerceAtLeast(5) }.padding(horizontal = 10.dp))
                // 베젤이 없는 워치: 숫자를 위아래로 밀어도 5ml씩
                Text("$ml", color = FeedC, fontSize = 46.sp, fontWeight = FontWeight.ExtraBold,
                    modifier = Modifier.pointerInput(Unit) {
                        var drag = 0f
                        detectVerticalDragGestures(onDragEnd = { drag = 0f }) { ch, dy ->
                            ch.consume()
                            drag += dy
                            if (kotlin.math.abs(drag) > 30f) {
                                ml = (ml + if (drag < 0) 5 else -5).coerceIn(5, 300)
                                drag = 0f
                                buzz(ctx)
                            }
                        }
                    })
                Text("ml", color = FeedC, fontSize = 16.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 8.dp))
                Text("+", color = FeedC, fontSize = 26.sp, modifier = Modifier.clickable { ml = (ml + 5).coerceAtMost(300) }.padding(horizontal = 10.dp))
            }
            Text(Tr.t("베젤을 돌리거나 위아래로 밀어 5ml씩"), color = Color(0xFF9A95AD), fontSize = 11.sp)
            Spacer(Modifier.height(6.dp))
            Text("✓ " + Tr.t("저장"), color = Ink, fontSize = 17.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center,
                modifier = Modifier.width(130.dp).background(FeedC, RoundedCornerShape(50)).clickable {
                    val name = if (kind == "pump") Tr.t("유축 수유") else Tr.t("분유")
                    back()
                    record(ctx, "feed_ml:$ml:$kind", "🍼 $name ${ml}ml")
                }.padding(vertical = 9.dp))
        }
    }
}

@Composable
fun Diaper(ctx: android.content.Context, back: () -> Unit) {
    Box(Modifier.fillMaxSize()) {
        Text(Tr.t("기저귀"), color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold, modifier = Modifier.align(Alignment.TopCenter).padding(top = 22.dp))
        Round("💦", Tr.t("소변"), PeeC, Modifier.align(Alignment.Center).offset(x = (-50).dp, y = (-8).dp)) { back(); record(ctx, "pee", "💦 " + Tr.t("소변")) }
        Round("💩", Tr.t("대변"), PooC, Modifier.align(Alignment.Center).offset(x = 50.dp, y = (-8).dp)) { back(); record(ctx, "poo", "💩 " + Tr.t("대변")) }
        Round("💦💩", Tr.t("둘 다"), PeeC, Modifier.align(Alignment.Center).offset(y = 58.dp)) { back(); record(ctx, "both", "💦💩 " + Tr.t("소변+대변")) }
    }
}

@Composable
fun Done(ctx: android.content.Context, s: Sent) {
    val left by Store.left.collectAsState()
    LaunchedEffect(s.state) {
        if (s.state in listOf("saved", "queued", "phone", "undone")) { delay(1600); if (Store.sent.value?.id == s.id) Store.sent.value = null }
    }
    val undone = s.state == "undone"
    Column(Modifier.fillMaxSize().padding(horizontal = 18.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text(if (undone) "↶" else "✓", color = if (undone) Color.Gray else OkC, fontSize = 34.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center,
            modifier = Modifier.size(62.dp).background((if (undone) Color.Gray else OkC).copy(alpha = 0.18f), CircleShape).wrapContentHeight())
        Text(s.label, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
        Text(when (s.state) {
            "waiting" -> Tr.t("곧 저장돼요")
            "sending" -> Tr.t("폰에 보내는 중")
            "saved" -> Tr.t("저장했어요")
            "phone" -> Tr.t("앱을 열면 가족에게도 올라가요")
            "undone" -> Tr.t("기록하지 않았어요")
            else -> Tr.t("폰과 연결되면 기록돼요")
        }, color = Color(0xFF9A95AD), fontSize = 12.sp, textAlign = TextAlign.Center)
        if (s.state == "waiting") {
            Text("↶ " + Tr.f("되돌리기 {0}초", left.toString()), color = Color(0xFFDDDDDD), fontSize = 14.sp, fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 8.dp).width(140.dp).background(Color(0xFF262626), RoundedCornerShape(50))
                    .clickable { ticker.removeCallbacksAndMessages(null); Store.sent.value = s.copy(state = "undone") }.padding(vertical = 7.dp))
        }
    }
}
