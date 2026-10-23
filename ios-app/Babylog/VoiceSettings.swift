import AVFoundation
import Intents
import IntentsUI
import Speech
import SwiftUI
import UIKit

// 설정 > 음성 명령 (웹앱의 "사용법 보기"가 여기를 엶).
// "Siri에 추가"를 누르면 "루나 깼어"처럼 아기 이름으로 부르는 Siri 단축어를 만듦 (사용자는 "추가"만 누르면 됨).
// 이렇게 만든 단축어는 앱을 열어 기록하고 결과를 소리로 알려 줌. "루나 수유"는 앱이 "몇 미리 먹었어요?"라고 묻고 대답을 들음.

struct VoiceCommand: Identifiable {
    let action: String      // 웹앱 동작 (feed_ask는 양을 물어본 뒤 feed_ml)
    let words: String       // 아기 이름 뒤에 붙는 말
    let help: String
    var id: String { action }
    var activityType: String { "kr.babylog.app.voice." + action }

    static let all = [
        VoiceCommand(action: "stop_sleep", words: "깼어", help: "자는 기록 끝내기"),
        VoiceCommand(action: "sleep_start", words: "잠들었어", help: "잠든 시각 기록"),
        VoiceCommand(action: "feed_ask", words: "수유", help: "몇 미리 먹었는지 물어보고 기록"),
        VoiceCommand(action: "pee", words: "소변", help: "기저귀 소변 기록"),
        VoiceCommand(action: "poo", words: "대변", help: "기저귀 대변 기록"),
    ]

    static func find(_ activityType: String) -> VoiceCommand? { all.first { $0.activityType == activityType } }

    static var babyName: String {
        let n = SharedStore.summary?.name ?? ""
        return n.isEmpty ? "아기" : n
    }

    func activity() -> NSUserActivity {
        let a = NSUserActivity(activityType: activityType)
        a.title = Self.babyName + " " + words
        a.suggestedInvocationPhrase = Self.babyName + " " + words
        a.isEligibleForPrediction = true
        a.persistentIdentifier = activityType
        return a
    }

    // Siri 단축어로 앱이 열렸을 때 (AppDelegate)
    @MainActor
    func run() async {
        if action == "feed_ask" { FeedListener.shared.start(); return }
        Speaker.shared.say(await VoiceRunner.run(action))
    }
}

// MARK: 화면

enum VoiceSettings {
    @MainActor
    static func controller() -> UIViewController {
        let model = VoiceModel()
        let host = UIHostingController(rootView: VoiceSettingsView(model: model))
        model.host = host
        return host
    }
}

@MainActor
final class VoiceModel: NSObject, ObservableObject, INUIAddVoiceShortcutViewControllerDelegate, INUIEditVoiceShortcutViewControllerDelegate {
    weak var host: UIViewController?
    @Published var added: [String: INVoiceShortcut] = [:]   // activityType → 이미 만든 단축어

    func load() {
        INVoiceShortcutCenter.shared.getAllVoiceShortcuts { list, _ in
            var m: [String: INVoiceShortcut] = [:]
            for v in list ?? [] { if let t = v.shortcut.userActivity?.activityType { m[t] = v } }
            DispatchQueue.main.async { self.added = m }
        }
    }

    func add(_ c: VoiceCommand) {
        let vc: UIViewController
        if let v = added[c.activityType] {
            let e = INUIEditVoiceShortcutViewController(voiceShortcut: v)
            e.delegate = self
            vc = e
        } else {
            let a = INUIAddVoiceShortcutViewController(shortcut: INShortcut(userActivity: c.activity()))
            a.delegate = self
            vc = a
        }
        host?.present(vc, animated: true)
    }

    nonisolated func addVoiceShortcutViewController(_ controller: INUIAddVoiceShortcutViewController, didFinishWith voiceShortcut: INVoiceShortcut?, error: Error?) {
        Task { @MainActor in controller.dismiss(animated: true); self.load() }
    }

    nonisolated func addVoiceShortcutViewControllerDidCancel(_ controller: INUIAddVoiceShortcutViewController) {
        Task { @MainActor in controller.dismiss(animated: true) }
    }

    nonisolated func editVoiceShortcutViewController(_ controller: INUIEditVoiceShortcutViewController, didUpdate voiceShortcut: INVoiceShortcut?, error: Error?) {
        Task { @MainActor in controller.dismiss(animated: true); self.load() }
    }

    nonisolated func editVoiceShortcutViewController(_ controller: INUIEditVoiceShortcutViewController, didDeleteVoiceShortcutWithIdentifier deletedVoiceShortcutIdentifier: UUID) {
        Task { @MainActor in controller.dismiss(animated: true); self.load() }
    }

    nonisolated func editVoiceShortcutViewControllerDidCancel(_ controller: INUIEditVoiceShortcutViewController) {
        Task { @MainActor in controller.dismiss(animated: true) }
    }
}

struct VoiceSettingsView: View {
    @ObservedObject var model: VoiceModel
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(VoiceCommand.all) { c in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\"" + (model.added[c.activityType]?.invocationPhrase ?? VoiceCommand.babyName + " " + c.words) + "\"").font(.headline)
                                Text(c.help).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button(model.added[c.activityType] != nil ? "추가됨 ✓" : "Siri에 추가") { model.add(c) }
                                .buttonStyle(.bordered)
                                .tint(model.added[c.activityType] != nil ? .green : .accentColor)
                        }
                    }
                } header: {
                    Text("아기 이름으로 부르기")
                } footer: {
                    Text("\"Siri에 추가\"를 누르고 다음 화면에서 \"추가\"만 누르면 돼요. 그다음부터 \"시리야, \(VoiceCommand.babyName) 깼어\"처럼 말하면 앱이 열리며 기록되고 소리로 알려 줘요. \"\(VoiceCommand.babyName) 수유\"라고 하면 \"몇 미리 먹었어요?\"라고 물어봐요. 120처럼 대답하면 돼요.")
                }

                Section("설정 없이 바로 되는 말") {
                    Text("\"시리야, 아기로그 아기 깼어\"").font(.subheadline)
                    Text("\"시리야, 아기로그 수유 120\"").font(.subheadline)
                    Text("아기 잠듦 · 소변 · 대변도 같아요. 앞에 \"아기로그\"를 붙여요.").font(.caption).foregroundStyle(.secondary)
                }

                Section("부르는 말 바꾸기") {
                    Text("위에서 \"추가됨 ✓\"을 누르면 말을 바꾸거나 지울 수 있어요.")
                    Text("단축어 앱 > 나의 단축어에서 그 단축어를 길게 누르고 \"이름 변경\"을 눌러도 돼요. 바꾼 이름이 곧 부르는 말이에요.")
                }
                .font(.subheadline)

                Section("알아 둘 점") {
                    Text("화면이 잠겨 있으면 Face ID로 잠금을 풀어야 기록돼요.")
                    Text("수유는 종류를 지난번과 같게(분유·유축) 기록해요. 수유 타이머가 돌고 있으면 그 양으로 끝내요.")
                    Text("\"\(VoiceCommand.babyName) 수유\"는 처음 한 번 마이크·음성 인식 허용을 물어봐요.")
                }
                .font(.subheadline)
            }
            .navigationTitle("음성 명령")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("닫기") { dismiss() } } }
        }
        .onAppear { model.load() }
    }
}

// MARK: 소리로 알려 주기 (갤럭시 Speak.say와 같음)

@MainActor
final class Speaker: NSObject, AVSpeechSynthesizerDelegate {
    static let shared = Speaker()
    private let synth = AVSpeechSynthesizer()
    private var after: (() -> Void)?

    override init() {
        super.init()
        synth.delegate = self
    }

    func say(_ text: String, then: (() -> Void)? = nil) {
        guard !text.isEmpty else { then?(); return }
        try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        after = then
        synth.stopSpeaking(at: .immediate)
        let u = AVSpeechUtterance(string: VoiceRunner.spoken(text))
        u.voice = AVSpeechSynthesisVoice(language: "ko-KR")
        synth.speak(u)
    }

    nonisolated func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            let f = self.after
            self.after = nil
            f?()
        }
    }
}

// MARK: "루나 수유" → "몇 미리 먹었어요?" → "120" → 기록

@MainActor
final class FeedListener {
    static let shared = FeedListener()
    private var engine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var heard = ""
    private var finished = true
    private var at = Date()

    func start() {
        guard finished else { return }
        finished = false
        heard = ""
        at = Date()
        SFSpeechRecognizer.requestAuthorization { st in
            AVAudioApplication.requestRecordPermission { mic in
                Task { @MainActor in
                    guard st == .authorized, mic else { return self.fallback("마이크나 음성 인식이 꺼져 있어요. 화면에서 양을 골라 주세요") }
                    Speaker.shared.say("몇 미리 먹었어요?") { self.listen() }
                }
            }
        }
    }

    private func listen() {
        guard let rec = SFSpeechRecognizer(locale: Locale(identifier: "ko-KR")), rec.isAvailable else {
            return fallback("지금은 말을 알아들을 수 없어요. 화면에서 양을 골라 주세요")
        }
        let engine = AVAudioEngine()
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        let input = engine.inputNode
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buf, _ in req.append(buf) }
        engine.prepare()
        guard (try? engine.start()) != nil else { return fallback("마이크를 쓸 수 없어요. 화면에서 양을 골라 주세요") }
        self.engine = engine
        request = req
        task = rec.recognitionTask(with: req) { r, err in
            Task { @MainActor in
                if let r { self.heard = r.bestTranscription.formattedString }
                if r?.isFinal == true || err != nil { return self.finish() }
                // 숫자를 알아들었고 1.2초 동안 더 바뀌지 않으면 끝냄 ("백" 다음에 "이십"이 이어질 수 있어서)
                let now = self.heard
                if FeedListener.amount(in: now) != nil {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in if self?.heard == now { self?.finish() } }
                }
            }
        }
        // 6초 안에 대답이 없으면 끝냄
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in self?.finish() }
    }

    private func finish() {
        guard !finished else { return }
        finished = true
        engine?.stop()
        engine?.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        engine = nil; request = nil; task = nil
        guard let ml = Self.amount(in: heard) else { return fallback("양을 알아듣지 못했어요. 화면에서 골라 주세요") }
        Task { Speaker.shared.say(await VoiceRunner.run("feed_ml", ml: ml)) }
    }

    // 알아듣지 못하면 수유 입력 창을 열어 줌 (위젯 "수유" 버튼과 같음)
    private func fallback(_ msg: String) {
        finished = true
        VoiceRunner.web?.runAction("feed", at: Date())
        Speaker.shared.say(msg)
    }

    // "120", "120미리", "백이십", "이백 미리" → 120 / 200 (1~500만)
    static func amount(in text: String) -> Int? {
        if let r = text.range(of: "\\d+", options: .regularExpression), let n = Int(text[r]) { return (1...500).contains(n) ? n : nil }
        let digit: [Character: Int] = ["일": 1, "이": 2, "삼": 3, "사": 4, "오": 5, "육": 6, "칠": 7, "팔": 8, "구": 9]
        var total = 0, cur = 0, seen = false
        for ch in text {
            if let d = digit[ch] { cur = d; seen = true }
            else if ch == "십" { total += max(cur, 1) * 10; cur = 0; seen = true }
            else if ch == "백" { total += max(cur, 1) * 100; cur = 0; seen = true }
            else if seen && ch != " " { break }
        }
        total += cur
        return seen && (1...500).contains(total) ? total : nil
    }
}
