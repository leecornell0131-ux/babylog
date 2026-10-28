plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// GitHub Actions 빌드 번호가 버전 번호가 됨 (앱 안 새 버전 확인에 씀)
val buildNo = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
// Play 스토어용 빌드(-Pstore=true): 비공개 업로드 키로 서명하고, 앱 안 새 APK 확인을 끔.
// 업로드 키는 저장소에 없고 GitHub Secrets(PLAY_UPLOAD_KEYSTORE·PLAY_UPLOAD_PASSWORD)에서 워크플로가 꺼내 줌
val store = (findProperty("store") as String?) == "true"
val uploadKey = System.getenv("PLAY_UPLOAD_KEYSTORE_FILE")

android {
    namespace = "kr.babylog.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "kr.babylog.app"
        minSdk = 26
        targetSdk = 36
        versionCode = buildNo
        versionName = "0.1.$buildNo"
        buildConfigField("boolean", "STORE", store.toString())
    }

    // 테스트용 서명 키. 매번 같은 키로 서명해야 새 APK를 지우지 않고 덮어 설치할 수 있음.
    // 공개 저장소에 있으므로 Play 스토어 출시 때는 따로 만든 비공개 키를 써야 함.
    signingConfigs {
        create("test") {
            storeFile = file("babylog-test.jks")
            storePassword = "babylog-test"
            keyAlias = "babylog"
            keyPassword = "babylog-test"
        }
        if (store && uploadKey != null) create("upload") {
            storeFile = file(uploadKey)
            storePassword = System.getenv("PLAY_UPLOAD_PASSWORD")
            keyAlias = "upload"
            keyPassword = System.getenv("PLAY_UPLOAD_PASSWORD")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName(if (store && uploadKey != null) "upload" else "test")
        }
        debug {
            signingConfig = signingConfigs.getByName("test")
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    // 알림 서버가 보내는 푸시(FCM)를 받아 위젯·잠금화면 타이머를 바로 바꿈
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")
    // 광고 (AdMob 배너, 비맞춤). 지금은 구글 테스트 광고 ID라 수익 없음
    implementation("com.google.android.gms:play-services-ads:23.6.0")
}
