package kr.babylog.app

import android.content.Context
import java.util.Locale

// 위젯·잠금화면·알림 글자의 언어 (한국어·English·简体中文·日本語). 웹앱 i18n.js와 같은 언어를 씀.
// - 웹앱 설정 > 화면·언어에서 고르면 bridge.js가 setLang으로 알려 줌 (이 기기에만 저장)
// - 아직 안 받았으면 휴대폰 언어로 고름 (웹앱과 같은 규칙: ko·ja·zh 말고는 영어)
// - 음성 명령(빅스비·음성 안내·몇 ml 묻는 화면)은 한국어로만 동작해서 그대로 둠
// 사용: Tr.t("마지막 수유 후"), Tr.f("평소 {0} 간격 · {1}쯤", a, b), Tr.v("분유 120ml") (요약에 담겨 온 한국어 값)
object Tr {
    private const val PREF = "babylog_lang"
    private var app: Context? = null
    fun init(ctx: Context) { app = ctx.applicationContext }

    fun set(ctx: Context, l: String) {
        if (l in listOf("ko", "en", "zh", "ja")) ctx.applicationContext.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString("lang", l).apply()
    }

    val lang: String
        get() {
            val saved = app?.getSharedPreferences(PREF, Context.MODE_PRIVATE)?.getString("lang", null)
            if (saved != null) return saved
            val l = Locale.getDefault().language
            return when (l) { "ko" -> "ko"; "ja" -> "ja"; "zh" -> "zh"; else -> "en" }
        }

    val locale: Locale get() = when (lang) { "en" -> Locale.US; "zh" -> Locale.SIMPLIFIED_CHINESE; "ja" -> Locale.JAPAN; else -> Locale.KOREA }

    fun t(ko: String): String {
        val l = lang
        if (l == "ko") return ko
        return M[ko]?.get(IDX[l] ?: return ko) ?: ko
    }

    fun f(ko: String, vararg a: Any?): String {
        var s = t(ko)
        a.forEachIndexed { i, v -> s = s.replace("{$i}", v?.toString() ?: "") }
        return s
    }

    // 요약(bridge.js·알림 서버)에 한국어로 담겨 오는 값: 수유 종류·기저귀 종류·"아기"·"15분"
    fun v(ko: String): String {
        if (lang == "ko" || ko.isBlank()) return ko
        var s = ko
        for (k in VALS) s = s.replace(k, t(k))
        return Regex("(\\d+)분").replace(s) { it.groupValues[1] + t("분") }
    }

    private val IDX = mapOf("en" to 0, "zh" to 1, "ja" to 2)
    private val VALS = listOf("모유 왼쪽", "모유 오른쪽", "유축 수유", "소변+대변", "분유", "수유", "소변", "대변", "기저귀")

    // 한국어 → [English, 中文, 日本語]
    private val M: Map<String, List<String>> = mapOf(
        "아기" to listOf("Baby", "宝宝", "赤ちゃん"),
        "수유" to listOf("Feed", "喂奶", "授乳"),
        "분유" to listOf("Formula", "配方奶", "ミルク"),
        "모유 왼쪽" to listOf("Breast (left)", "母乳（左）", "母乳（左）"),
        "모유 오른쪽" to listOf("Breast (right)", "母乳（右）", "母乳（右）"),
        "유축 수유" to listOf("Pumped milk", "瓶喂母乳", "搾乳した母乳"),
        "소변" to listOf("Pee", "小便", "おしっこ"),
        "대변" to listOf("Poop", "大便", "うんち"),
        "소변+대변" to listOf("Pee+Poop", "小便+大便", "おしっこ+うんち"),
        "기저귀" to listOf("Diaper", "尿布", "おむつ"),
        "분" to listOf(" min", "分钟", "分"),
        "생후 {0}일" to listOf("Day {0}", "出生{0}天", "生後{0}日"),
        "{0}개월 {1}일" to listOf("{0} mo {1} d", "{0}个月{1}天", "{0}か月{1}日"),
        "방금" to listOf("just now", "刚刚", "たった今"),
        "{0} 전" to listOf("{0} ago", "{0}前", "{0}前"),
        "{0}째" to listOf("{0} so far", "已{0}", "{0}経過"),
        "마지막 수유 후" to listOf("Since last feed", "距上次喂奶", "最後の授乳から"),
        "마지막 수유 후 · {0}" to listOf("Since last feed · {0}", "距上次喂奶 · {0}", "最後の授乳から · {0}"),
        "{0} 중" to listOf("{0} in progress", "{0}中", "{0}中"),
        "수면 중" to listOf("Sleeping", "睡眠中", "睡眠中"),
        "{0} 수면 중" to listOf("{0} sleeping", "{0}睡眠中", "{0} 睡眠中"),
        "🍼 수유 끝" to listOf("🍼 End feed", "🍼 喂奶结束", "🍼 授乳終了"),
        "🍼 수유" to listOf("🍼 Feed", "🍼 喂奶", "🍼 授乳"),
        "🍼 수유 기록" to listOf("🍼 Log feed", "🍼 记录喂奶", "🍼 授乳を記録"),
        "☀️ 깼어요" to listOf("☀️ Woke up", "☀️ 醒了", "☀️ 起きた"),
        "🌙 잠듦" to listOf("🌙 Asleep", "🌙 入睡", "🌙 寝た"),
        "{0}부터" to listOf("since {0}", "{0}起", "{0}から"),
        "평소 {0} 간격 · {1}쯤" to listOf("Usually every {0} · ~{1}", "平时间隔{0} · 约{1}", "いつも{0}間隔 · {1}ごろ"),
        "수유 기록 없음" to listOf("No feeds yet", "没有喂奶记录", "授乳記録なし"),
        "누르면 앱이 열려요" to listOf("Tap to open the app", "点击打开应用", "タップでアプリを開く"),
        "깨어 있는 시간" to listOf("Awake time", "清醒时间", "起きている時間"),
        "{0}에 잠듦" to listOf("asleep at {0}", "{0}入睡", "{0}に就寝"),
        "{0}에 깸" to listOf("woke at {0}", "{0}醒来", "{0}に起床"),
        "마지막 기저귀 후" to listOf("Since last diaper", "距上次换尿布", "最後のおむつから"),
        "마지막 {0} 후" to listOf("Since last {0}", "距上次{0}", "最後の{0}から"),
        "오늘 · {0}" to listOf("Today · {0}", "今天 · {0}", "今日 · {0}"),
        "{0}회" to listOf("{0}×", "{0}次", "{0}回"),
        "🌙 어제 수면" to listOf("🌙 Sleep yesterday", "🌙 昨天睡眠", "🌙 昨日の睡眠"),
        "🌙 오늘 수면" to listOf("🌙 Sleep today", "🌙 今天睡眠", "🌙 今日の睡眠"),
        "기록 없음" to listOf("No records", "没有记录", "記録なし"),
        "🌙 잠든 지" to listOf("🌙 Asleep for", "🌙 已睡", "🌙 寝てから"),
        "👀 최근 깬 지" to listOf("👀 Awake for", "👀 已醒", "👀 起きてから"),
        "아직 기록이 없어요" to listOf("No records yet", "还没有记录", "まだ記録がありません"),
        "💧 소변" to listOf("💧 Pee", "💧 小便", "💧 おしっこ"),
        "💩 대변" to listOf("💩 Poop", "💩 大便", "💩 うんち"),
        "둘 다" to listOf("Both", "都有", "両方"),
        "앱을 한 번 열어 주세요" to listOf("Open the app once", "请先打开一次应用", "アプリを一度開いてください"),
        "오늘" to listOf("Today", "今天", "今日"),
        "🍼 오늘 수유" to listOf("🍼 Feeds today", "🍼 今天喂奶", "🍼 今日の授乳"),
        "⏱ 최근 수유한 지" to listOf("⏱ Since last feed", "⏱ 距上次喂奶", "⏱ 最後の授乳から"),
        // 잠금화면·알림
        "진행 중 타이머" to listOf("Running timers", "进行中的计时", "進行中のタイマー"),
        "수유·수면이 진행 중일 때 지난 시간을 잠금화면과 알림창에 보여줘요" to listOf("Shows elapsed time on the lock screen and in notifications while a feed or sleep is in progress", "喂奶·睡眠进行中时，在锁屏和通知栏显示已过时间", "授乳・睡眠の進行中、経過時間をロック画面と通知に表示します"),
        "🌙 {0} 수면 중" to listOf("🌙 {0} sleeping", "🌙 {0}睡眠中", "🌙 {0} 睡眠中"),
        "🍼 {0} {1} 중" to listOf("🍼 {0} · {1} in progress", "🍼 {0} {1}中", "🍼 {0} {1}中"),
        "깼어요" to listOf("Woke up", "醒了", "起きた"),
        "수유 끝" to listOf("End feed", "喂奶结束", "授乳終了"),
        "{0} · {1} 기록" to listOf("{0} · logged at {1}", "{0} · {1} 已记录", "{0} · {1} 記録"),
        "가족에게도 올렸어요" to listOf("Shared with your family too", "已同步给家人", "家族にも共有しました"),
        "앱을 열면 가족에게도 올라가요" to listOf("Open the app to share with your family", "打开应用后会同步给家人", "アプリを開くと家族にも共有されます"),
        // 앱 안 안내 창
        "홈 화면 위젯" to listOf("Home screen widgets", "主屏幕小组件", "ホーム画面ウィジェット"),
        "홈 화면에 위젯을 두면 마지막 수유 후 지난 시간이 보이고, 버튼 한 번으로 소변·대변·수면을 기록할 수 있어요." to listOf("Put a widget on your home screen to see the time since the last feed and log pee, poop or sleep with one tap.", "在主屏幕放置小组件，就能看到距上次喂奶的时间，一键记录小便·大便·睡眠。", "ホーム画面にウィジェットを置くと、最後の授乳からの時間が見られ、ボタン1つでおしっこ・うんち・睡眠を記録できます。"),
        "나중에" to listOf("Later", "以后", "あとで"),
        "확인" to listOf("OK", "确定", "OK"),
        "홈 화면을 길게 누르고 위젯 > 아기로그를 골라 주세요" to listOf("Long-press the home screen, then pick Widgets > BabyLog", "长按主屏幕，然后选择 小组件 > BabyLog", "ホーム画面を長押しして ウィジェット > BabyLog を選んでください"),
        "백업 파일 저장·보내기" to listOf("Save·send backup file", "保存·发送备份文件", "バックアップファイルを保存・送信"),
        "보내기" to listOf("Send", "发送", "送る"),
        "새 버전이 있어요" to listOf("A new version is available", "有新版本", "新しいバージョンがあります"),
        "위젯이나 잠금화면 기능이 바뀐 새 버전이에요. 받은 파일을 열어 설치하면 기록은 그대로 남아요." to listOf("This version changes widget or lock screen features. Open the downloaded file to install; your records stay as they are.", "这是小组件或锁屏功能有变化的新版本。打开下载的文件安装，记录会保留。", "ウィジェットやロック画面の機能が変わった新しいバージョンです。ダウンロードしたファイルを開いてインストールしても記録はそのまま残ります。"),
        "받기" to listOf("Download", "下载", "ダウンロード"),
    )
}
