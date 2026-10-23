import UIKit
import WebKit

// 웹앱을 띄우는 화면. 갤럭시 앱 MainActivity와 같은 역할.
// 웹앱은 고치지 않고, 웹앱이 이미 가진 연결점(window.BabyApp 등)만 씀.
class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
    static let startURL = URL(string: "https://leecornell0131-ux.github.io/babylog/")!
    static let host = "leecornell0131-ux.github.io"

    private var web: WKWebView!
    private var downloadNames: [ObjectIdentifier: URL] = [:]
    private var pending: [(String, Date, Int?)] = [] // 페이지가 준비되기 전에 들어온 위젯·잠금화면 버튼

    // 갤럭시 앱의 BabyNative(안드로이드 기능)를 아이폰 쪽으로 이어 주는 대역.
    // bridge.js(갤럭시와 같은 파일)가 부르는 이름만 받음. 광고(adZone)처럼 아이폰에 없는 기능은
    // 이름이 없어야 웹앱이 해당 메뉴를 숨김. 음성 명령(voiceHelp)은 아이폰에선 Siri 사용법 (platform 'ios'로 웹앱이 문구를 바꿈)
    private static let shim = """
    if (location.host === '\(host)' && !window.BabyNative) (function () {
      var post = function (m) { window.webkit.messageHandlers.babyNative.postMessage(m); };
      var impl = {
        update: function (s) { post({ t: 'update', s: String(s) }); },
        shareFile: function (name, type, b64) { post({ t: 'shareFile', name: String(name), b64: String(b64) }); },
        shareText: function (text) { post({ t: 'shareText', text: String(text) }); },
        copy: function (text) { post({ t: 'copy', text: String(text) }); },
        reload: function () { post('reload'); },
        voiceHelp: function () { post('voiceHelp'); },
        platform: 'ios'
      };
      window.BabyNative = impl;
    })();
    """

    override func loadView() {
        let config = WKWebViewConfiguration()
        // 기록(localStorage)이 앱을 껐다 켜도 남게 기본 저장소를 씀 (앱을 지우면 같이 지워짐)
        config.websiteDataStore = .default()
        config.userContentController.add(self, name: "babyNative")
        config.userContentController.addUserScript(WKUserScript(source: Self.shim, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        if let f = Bundle.main.url(forResource: "bridge", withExtension: "js"), let js = try? String(contentsOf: f, encoding: .utf8) {
            let guarded = "if (location.host === '\(Self.host)') {\n" + js + "\n}"
            config.userContentController.addUserScript(WKUserScript(source: guarded, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        let ver = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        config.applicationNameForUserAgent = "BabylogIOS/\(ver)"

        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        web.isOpaque = false
        web.backgroundColor = .systemBackground
        // 아래쪽 여백(홈 바)은 웹앱이 env(safe-area-inset-bottom)으로 직접 처리
        web.scrollView.contentInsetAdjustmentBehavior = .never

        let root = UIView()
        root.backgroundColor = .systemBackground
        web.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(web)
        NSLayoutConstraint.activate([
            // 위쪽은 시계·다이내믹 아일랜드와 겹치지 않게 안전 영역부터
            web.topAnchor.constraint(equalTo: root.safeAreaLayoutGuide.topAnchor),
            web.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: root.trailingAnchor),
        ])
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        web.load(URLRequest(url: Self.startURL))
        NotificationCenter.default.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    // 다른 휴대폰에서 바뀐 기록이 있으면 화면을 새로 그림 (가족 공유는 웹앱이 처리)
    @objc private func becameActive() {
        web.evaluateJavaScript("window.BabyApp&&BabyApp.refresh()", completionHandler: nil)
    }

    // MARK: 위젯·잠금화면 버튼 → 웹앱에 기록 (갤럭시 앱 runAction과 같음)

    static let actions: Set<String> = ["feed", "feed_start", "stop_feed", "feed_ml", "sleep", "sleep_start", "stop_sleep", "pee", "poo", "both"]

    // ml: 음성 "수유 120"(feed_ml)의 양
    private func quick(_ action: String, _ at: Date, _ ml: Int?) -> String {
        "window.__babyQuick?__babyQuick('\(action)',\(Int64(at.timeIntervalSince1970 * 1000)),\(ml.map(String.init) ?? "null")):'notready'"
    }

    func runAction(_ action: String, at: Date, ml: Int? = nil) {
        guard Self.actions.contains(action), isViewLoaded else { return }
        web.evaluateJavaScript(quick(action, at, ml)) { [weak self] r, _ in
            if (r as? String) ?? "notready" == "notready" { self?.pending.append((action, at, ml)) }
        }
    }

    // 음성 명령용: 웹앱이 준비됐으면 기록하고 결과 문구("수면 1h 05m 기록했어요")를, 아직이면 nil
    func tryAction(_ action: String, at: Date, ml: Int? = nil) async -> String? {
        guard Self.actions.contains(action), isViewLoaded else { return nil }
        let js = quick(action, at, ml)
        let r: String = await withCheckedContinuation { c in
            web.evaluateJavaScript(js) { r, _ in
                c.resume(returning: (r as? String) ?? "notready")
            }
        }
        if r == "notready" { return nil }
        // 'ok'만 오면 아기 정보를 아직 안 넣어서 기록하지 않은 것 (bridge.js)
        if r == "ok" { return "먼저 앱에서 아기 정보를 넣어 주세요" }
        return r.hasPrefix("ok:") ? String(r.dropFirst(3)) : ""
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView.url?.host == Self.host else { return }
        let todo = pending
        pending.removeAll()
        // 웹앱이 기록을 다 불러올 때까지 잠깐 기다렸다가 넣음
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
            todo.forEach { self?.runAction($0.0, at: $0.1, ml: $0.2) }
        }
    }

    // MARK: 페이지 이동

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // 백업 파일 저장(<a download>)은 내려받기로 처리
        if action.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        let scheme = url.scheme ?? ""
        if url.host == Self.host || scheme == "file" || scheme == "blob" || scheme == "data" || scheme == "about" {
            return decisionHandler(.allow)
        }
        // 다른 사이트 링크는 Safari로 엶 (Firebase 등 페이지 안에서 부르는 주소는 이동이 아니라 여기 안 옴)
        if action.targetFrame?.isMainFrame ?? true {
            UIApplication.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showOffline(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showOffline(error)
    }

    private func showOffline(_ error: Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return } // 내려받기로 넘어간 것
        if let f = Bundle.main.url(forResource: "offline", withExtension: "html") {
            web.loadFileURL(f, allowingReadAccessTo: f)
        }
    }

    // 웹앱이 다시 그려야 할 때 (메모리가 부족해 웹 화면이 꺼졌을 때)
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // MARK: 오프라인 화면의 "다시 열기"

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.body as? String == "reload" {
            web.load(URLRequest(url: Self.startURL))
            return
        }
        if message.body as? String == "voiceHelp" {
            guard presentedViewController == nil else { return }
            present(VoiceSettings.controller(), animated: true)
            return
        }
        guard let m = message.body as? [String: Any], let t = m["t"] as? String else { return }
        switch t {
        case "update":
            if let s = m["s"] as? String { NativeSync.update(json: s, appActive: UIApplication.shared.applicationState == .active) }
        case "shareFile":
            guard let b64 = m["b64"] as? String, let data = Data(base64Encoded: b64) else { return }
            let name = (m["name"] as? String).flatMap { $0.isEmpty ? nil : ($0 as NSString).lastPathComponent } ?? "babylog.json"
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let file = dir.appendingPathComponent(name)
            guard (try? data.write(to: file)) != nil else { return }
            share([file])
        case "shareText":
            if let text = m["text"] as? String { share([text]) }
        case "copy":
            UIPasteboard.general.string = m["text"] as? String
        default:
            break
        }
    }

    private func share(_ items: [Any]) {
        guard presentedViewController == nil else { return }
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        present(sheet, animated: true)
    }

    // MARK: 백업 파일 저장 → 공유 창(파일 앱에 저장, 카톡 보내기 등)

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent(suggestedFilename.isEmpty ? "babylog-backup.json" : suggestedFilename)
        downloadNames[ObjectIdentifier(download)] = dest
        completionHandler(dest)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloadNames.removeValue(forKey: ObjectIdentifier(download)) else { return }
        share([file])
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadNames.removeValue(forKey: ObjectIdentifier(download))
    }

    // MARK: 웹앱의 alert·confirm·prompt (없으면 아이폰 앱에서 "삭제할까요?" 같은 확인 창이 안 뜸)

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler() })
        presentOr(a) { completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler(true) })
        presentOr(a) { completionHandler(false) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
        presentOr(a) { completionHandler(nil) }
    }

    // 다른 창이 이미 떠 있으면 확인 창을 못 띄우므로 바로 취소로 돌려줌 (웹앱이 멈추지 않게)
    private func presentOr(_ a: UIAlertController, fallback: () -> Void) {
        if presentedViewController == nil { present(a, animated: true) } else { fallback() }
    }

    // target="_blank" 링크는 Safari로
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { UIApplication.shared.open(url) }
        return nil
    }
}
