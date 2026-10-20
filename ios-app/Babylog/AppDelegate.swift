import UIKit

// 아기로그 아이폰 앱.
// 화면은 갤럭시 앱과 똑같이 웹앱(GitHub Pages)을 그대로 띄움.
// 그래서 웹앱을 고치면 이 앱도 다시 설치하지 않고 다음에 열 때 같이 바뀜.
@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.rootViewController = WebViewController()
        w.makeKeyAndVisible()
        window = w
        return true
    }
}
