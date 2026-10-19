plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// GitHub Actions 빌드 번호가 버전 번호가 됨 (앱 안 새 버전 확인에 씀)
val buildNo = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "kr.babylog.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "kr.babylog.app"
        minSdk = 26
        targetSdk = 35
        versionCode = buildNo
        versionName = "0.1.$buildNo"
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
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("test")
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
