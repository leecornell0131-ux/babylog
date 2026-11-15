plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// 갤럭시워치(Wear OS) 앱. 휴대폰 앱과 같은 applicationId·같은 서명이어야 둘이 서로 찾고 Play에 한 앱으로 올라감.
// 버전 번호는 휴대폰 앱과 같게 하되, Play는 같은 번호를 두 번 못 받아서 워치는 +100000
val buildNo = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
val store = (findProperty("store") as String?) == "true"
val uploadKey = System.getenv("PLAY_UPLOAD_KEYSTORE_FILE")

android {
    namespace = "kr.babylog.wear"
    compileSdk = 36

    defaultConfig {
        applicationId = "kr.babylog.app"
        minSdk = 30
        targetSdk = 34
        versionCode = 100000 + buildNo
        versionName = "0.1.$buildNo"
    }

    signingConfigs {
        create("test") {
            storeFile = file("../app/babylog-test.jks")
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
        debug { signingConfig = signingConfigs.getByName("test") }
    }

    buildFeatures { compose = true }

    // 글자 사전(Tr.kt)은 휴대폰 앱과 같은 파일
    sourceSets["main"].java.srcDir("../shared")

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("com.google.android.gms:play-services-wearable:19.0.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.wear.compose:compose-material:1.4.0")
    implementation("androidx.wear.compose:compose-foundation:1.4.0")
    // 타일(워치 화면을 옆으로 넘기면 나오는 카드)
    implementation("androidx.wear.tiles:tiles:1.4.1")
    implementation("androidx.wear.protolayout:protolayout:1.2.1")
    implementation("androidx.wear.protolayout:protolayout-material:1.2.1")
    implementation("com.google.guava:guava:33.3.1-android")
    // 워치페이스 칸(컴플리케이션)
    implementation("androidx.wear.watchface:watchface-complications-data-source-ktx:1.2.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
}
