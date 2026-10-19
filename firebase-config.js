// 가족 공유(Firebase 무료 Spark 요금제) 설정.
// 비워 두면(null) 가족 공유가 꺼지고 기록은 이 기기에만 저장돼요.
// Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹)에서 나오는 값을 그대로 붙여넣으세요. 이 값은 공개돼도 괜찮아요(보안은 firestore.rules가 담당).
window.FIREBASE_CONFIG = null;
/* 예시
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "babylog-xxxx.firebaseapp.com",
  projectId: "babylog-xxxx",
  appId: "1:123:web:abc"
};
*/
