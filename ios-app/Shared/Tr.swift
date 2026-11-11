import Foundation

// 위젯·잠금화면(Live Activity)·앱 안 알림 창 글자의 언어 (한국어·English·简体中文·日本語).
// 갤럭시 앱 Tr.kt와 같은 사전. 웹앱(i18n.js) 설정 > 화면·언어에서 고르면 bridge.js가 setLang으로 알려 주고,
// 공유 키체인("lang")에 저장해 위젯도 같은 언어를 씀. 아직 안 받았으면 휴대폰 언어 (ko·ja·zh 말고는 영어).
// Siri 음성 명령은 한국어로 등록돼 있어서 그대로 둠.
enum Tr {
    // 위젯 프로세스가 오래 살아 있어도 언어를 바꾸면 따라가게 10초만 기억
    private static var cached: String?
    private static var cachedAt = Date.distantPast
    static var lang: String {
        if let c = cached, Date().timeIntervalSince(cachedAt) < 10 { return c }
        let saved = SharedStore.load(account: "lang").flatMap { String(data: $0, encoding: .utf8) }
        let sys = Locale.preferredLanguages.first?.lowercased() ?? "ko"
        let auto: String = sys.hasPrefix("ko") ? "ko" : sys.hasPrefix("ja") ? "ja" : sys.hasPrefix("zh") ? "zh" : "en"
        let l = saved ?? auto
        cached = l
        cachedAt = Date()
        return l
    }

    static func set(_ l: String) {
        guard ["ko", "en", "zh", "ja"].contains(l) else { return }
        SharedStore.save(Data(l.utf8), account: "lang")
        cached = l
        cachedAt = Date()
    }

    static var locale: Locale {
        switch lang {
        case "en": return Locale(identifier: "en_US")
        case "zh": return Locale(identifier: "zh_CN")
        case "ja": return Locale(identifier: "ja_JP")
        default: return Locale(identifier: "ko_KR")
        }
    }

    static func t(_ ko: String) -> String {
        let i: Int
        switch lang {
        case "en": i = 0
        case "zh": i = 1
        case "ja": i = 2
        default: return ko
        }
        return dict[ko]?[i] ?? ko
    }

    static func f(_ ko: String, _ args: String...) -> String {
        var s = t(ko)
        for (i, a) in args.enumerated() { s = s.replacingOccurrences(of: "{\(i)}", with: a) }
        return s
    }

    // 요약(bridge.js·알림 서버)에 한국어로 담겨 오는 값: 수유 종류·기저귀 종류·"15분"
    static func v(_ ko: String?) -> String? {
        guard let ko, lang != "ko", !ko.isEmpty else { return ko }
        var s = ko
        for k in vals { s = s.replacingOccurrences(of: k, with: t(k)) }
        if let re = try? NSRegularExpression(pattern: "(\\d+)분") {
            let r = NSRange(s.startIndex..., in: s)
            s = re.stringByReplacingMatches(in: s, range: r, withTemplate: "$1" + NSRegularExpression.escapedTemplate(for: t("분")))
        }
        return s
    }

    private static let vals: [String] = ["모유 왼쪽", "모유 오른쪽", "유축 수유", "소변+대변", "분유", "수유", "소변", "대변", "기저귀"]

    // 한국어 → [English, 中文, 日本語]
    private static let dict: [String: [String]] = [
        "아기": ["Baby", "宝宝", "赤ちゃん"],
        "수유": ["Feed", "喂奶", "授乳"],
        "분유": ["Formula", "配方奶", "ミルク"],
        "모유 왼쪽": ["Breast (left)", "母乳（左）", "母乳（左）"],
        "모유 오른쪽": ["Breast (right)", "母乳（右）", "母乳（右）"],
        "유축 수유": ["Pumped milk", "瓶喂母乳", "搾乳した母乳"],
        "소변": ["Pee", "小便", "おしっこ"],
        "대변": ["Poop", "大便", "うんち"],
        "소변+대변": ["Pee+Poop", "小便+大便", "おしっこ+うんち"],
        "기저귀": ["Diaper", "尿布", "おむつ"],
        "분": [" min", "分钟", "分"],
        "생후 {0}일": ["Day {0}", "出生{0}天", "生後{0}日"],
        "{0}개월 {1}일": ["{0} mo {1} d", "{0}个月{1}天", "{0}か月{1}日"],
        "방금": ["just now", "刚刚", "たった今"],
        "{0} 전": ["{0} ago", "{0}前", "{0}前"],
        "{0}째": ["{0} so far", "已{0}", "{0}経過"],
        "마지막 수유 후": ["Since last feed", "距上次喂奶", "最後の授乳から"],
        "마지막 수유 후 · {0}": ["Since last feed · {0}", "距上次喂奶 · {0}", "最後の授乳から · {0}"],
        "{0} 중": ["{0} in progress", "{0}中", "{0}中"],
        "수면 중": ["Sleeping", "睡眠中", "睡眠中"],
        "{0} 수면 중": ["{0} sleeping", "{0}睡眠中", "{0} 睡眠中"],
        "🍼 수유 끝": ["🍼 End feed", "🍼 喂奶结束", "🍼 授乳終了"],
        "🍼 수유": ["🍼 Feed", "🍼 喂奶", "🍼 授乳"],
        "🍼 수유 기록": ["🍼 Log feed", "🍼 记录喂奶", "🍼 授乳を記録"],
        "☀️ 깼어요": ["☀️ Woke up", "☀️ 醒了", "☀️ 起きた"],
        "🌙 잠듦": ["🌙 Asleep", "🌙 入睡", "🌙 寝た"],
        "{0}부터": ["since {0}", "{0}起", "{0}から"],
        "평소 {0} 간격 · {1}쯤": ["Usually every {0} · ~{1}", "平时间隔{0} · 约{1}", "いつも{0}間隔 · {1}ごろ"],
        "수유 기록 없음": ["No feeds yet", "没有喂奶记录", "授乳記録なし"],
        "누르면 앱이 열려요": ["Tap to open the app", "点击打开应用", "タップでアプリを開く"],
        "깨어 있는 시간": ["Awake time", "清醒时间", "起きている時間"],
        "{0}에 잠듦": ["asleep at {0}", "{0}入睡", "{0}に就寝"],
        "{0}에 깸": ["woke at {0}", "{0}醒来", "{0}に起床"],
        "마지막 기저귀 후": ["Since last diaper", "距上次换尿布", "最後のおむつから"],
        "마지막 {0} 후": ["Since last {0}", "距上次{0}", "最後の{0}から"],
        "오늘 · {0}": ["Today · {0}", "今天 · {0}", "今日 · {0}"],
        "{0}회": ["{0}×", "{0}次", "{0}回"],
        "🌙 어제 수면": ["🌙 Sleep yesterday", "🌙 昨天睡眠", "🌙 昨日の睡眠"],
        "🌙 오늘 수면": ["🌙 Sleep today", "🌙 今天睡眠", "🌙 今日の睡眠"],
        "기록 없음": ["No records", "没有记录", "記録なし"],
        "🌙 잠든 지": ["🌙 Asleep for", "🌙 已睡", "🌙 寝てから"],
        "👀 최근 깬 지": ["👀 Awake for", "👀 已醒", "👀 起きてから"],
        "아직 기록이 없어요": ["No records yet", "还没有记录", "まだ記録がありません"],
        "💧 소변": ["💧 Pee", "💧 小便", "💧 おしっこ"],
        "💩 대변": ["💩 Poop", "💩 大便", "💩 うんち"],
        "둘 다": ["Both", "都有", "両方"],
        "앱을 한 번 열어 주세요": ["Open the app once", "请先打开一次应用", "アプリを一度開いてください"],
        "오늘": ["Today", "今天", "今日"],
        "🍼 오늘 수유": ["🍼 Feeds today", "🍼 今天喂奶", "🍼 今日の授乳"],
        "⏱ 최근 수유한 지": ["⏱ Since last feed", "⏱ 距上次喂奶", "⏱ 最後の授乳から"],
        "진행 중 타이머": ["Running timers", "进行中的计时", "進行中のタイマー"],
        "수유·수면이 진행 중일 때 지난 시간을 잠금화면과 알림창에 보여줘요": ["Shows elapsed time on the lock screen and in notifications while a feed or sleep is in progress", "喂奶·睡眠进行中时，在锁屏和通知栏显示已过时间", "授乳・睡眠の進行中、経過時間をロック画面と通知に表示します"],
        "🌙 {0} 수면 중": ["🌙 {0} sleeping", "🌙 {0}睡眠中", "🌙 {0} 睡眠中"],
        "🍼 {0} {1} 중": ["🍼 {0} · {1} in progress", "🍼 {0} {1}中", "🍼 {0} {1}中"],
        "깼어요": ["Woke up", "醒了", "起きた"],
        "수유 끝": ["End feed", "喂奶结束", "授乳終了"],
        "{0} · {1} 기록": ["{0} · logged at {1}", "{0} · {1} 已记录", "{0} · {1} 記録"],
        "가족에게도 올렸어요": ["Shared with your family too", "已同步给家人", "家族にも共有しました"],
        "앱을 열면 가족에게도 올라가요": ["Open the app to share with your family", "打开应用后会同步给家人", "アプリを開くと家族にも共有されます"],
        "홈 화면 위젯": ["Home screen widgets", "主屏幕小组件", "ホーム画面ウィジェット"],
        "홈 화면에 위젯을 두면 마지막 수유 후 지난 시간이 보이고, 버튼 한 번으로 소변·대변·수면을 기록할 수 있어요.": ["Put a widget on your home screen to see the time since the last feed and log pee, poop or sleep with one tap.", "在主屏幕放置小组件，就能看到距上次喂奶的时间，一键记录小便·大便·睡眠。", "ホーム画面にウィジェットを置くと、最後の授乳からの時間が見られ、ボタン1つでおしっこ・うんち・睡眠を記録できます。"],
        "나중에": ["Later", "以后", "あとで"],
        "확인": ["OK", "确定", "OK"],
        "홈 화면을 길게 누르고 위젯 > 베이비노트를 골라 주세요": ["Long-press the home screen, then pick Widgets > BabyNote", "长按主屏幕，然后选择 小组件 > BabyNote", "ホーム画面を長押しして ウィジェット > BabyNote を選んでください"],
        "백업 파일 저장·보내기": ["Save·send backup file", "保存·发送备份文件", "バックアップファイルを保存・送信"],
        "보내기": ["Send", "发送", "送る"],
        "새 버전이 있어요": ["A new version is available", "有新版本", "新しいバージョンがあります"],
        "위젯이나 잠금화면 기능이 바뀐 새 버전이에요. 받은 파일을 열어 설치하면 기록은 그대로 남아요.": ["This version changes widget or lock screen features. Open the downloaded file to install; your records stay as they are.", "这是小组件或锁屏功能有变化的新版本。打开下载的文件安装，记录会保留。", "ウィジェットやロック画面の機能が変わった新しいバージョンです。ダウンロードしたファイルを開いてインストールしても記録はそのまま残ります。"],
        "받기": ["Download", "下载", "ダウンロード"],
        "빠른 기록": ["Quick log", "快速记录", "クイック記録"],
        "마지막 수유 후 지난 시간과 소변·대변·수면 버튼": ["Time since the last feed and Pee·Poop·Sleep buttons", "距上次喂奶的时间和小便·大便·睡眠按钮", "最後の授乳からの時間とおしっこ・うんち・睡眠ボタン"],
        "수유 타이머": ["Feed timer", "喂奶计时", "授乳タイマー"],
        "마지막 수유 후 지난 시간을 크게, 평소 간격으로 본 다음 수유 시각": ["Time since the last feed, big, and the next feed time based on your usual interval", "大字显示距上次喂奶的时间，以及按平时间隔推算的下次喂奶时间", "最後の授乳からの時間を大きく、いつもの間隔から見た次の授乳時刻"],
        "마지막 수유": ["Last feed", "上次喂奶", "最後の授乳"],
        "아기 이름·월령과 마지막 수유 시각·양, 몇 시간 전인지": ["Baby name·age and last feed time·amount, how long ago", "宝宝名字·月龄和上次喂奶的时间·量，以及多久以前", "赤ちゃんの名前・月齢と最後の授乳の時刻・量、何時間前か"],
        "수면·깨어 있는 시간": ["Sleep·awake time", "睡眠·清醒时间", "睡眠・起きている時間"],
        "자는 중이면 수면 시간, 깨어 있으면 깬 뒤 지난 시간과 잠듦·깼어요 버튼": ["Sleep time while asleep, time since waking while awake, with Asleep·Woke up buttons", "睡着时显示睡眠时间，醒着时显示醒来后的时间，附入睡·醒了按钮", "寝ているときは睡眠時間、起きているときは起きてからの時間と寝た・起きたボタン"],
        "마지막 기저귀 후 지난 시간과 소변·대변·둘 다 버튼": ["Time since the last diaper with Pee·Poop·Both buttons", "距上次换尿布的时间和小便·大便·都有按钮", "最後のおむつからの時間とおしっこ・うんち・両方ボタン"],
        "오늘 요약": ["Today summary", "今日摘要", "今日のまとめ"],
        "오늘 수유 횟수·양, 수면 합계, 마지막 수유 후 시간": ["Today's feed count·amount, total sleep, time since last feed", "今天喂奶次数·量、睡眠合计、距上次喂奶时间", "今日の授乳回数・量、睡眠合計、最後の授乳からの時間"],
        "수유중": ["Feeding", "喂奶中", "授乳中"],
        "{0} 중 {1}": ["{0} {1}", "{0}中 {1}", "{0}中 {1}"],
        "{0} 전{1}": ["{0} ago{1}", "{0}前{1}", "{0}前{1}"],
        "😴 수면 중 {0}": ["😴 Sleeping {0}", "😴 睡眠中 {0}", "😴 睡眠中 {0}"],
        "👀 깬 지 {0}": ["👀 Awake {0}", "👀 已醒 {0}", "👀 起きてから {0}"],
        "😴 수면 기록 없음": ["😴 No sleep records", "😴 没有睡眠记录", "😴 睡眠記録なし"],
        "{0}일": ["Day {0}", "第{0}天", "{0}日目"],
        "{0}개월": ["{0} mo", "{0}个月", "{0}か月"],
        "수면": ["Sleep", "睡眠", "睡眠"],
        "먼저 앱에서 아기 정보를 넣어 주세요": ["Enter your baby's info in the app first", "请先在应用中填写宝宝信息", "まずアプリで赤ちゃんの情報を入れてください"],
        "취소": ["Cancel", "取消", "キャンセル"]
    ]
}
