pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "babylog-android"
include(":app")
// 갤럭시워치(Wear OS) 앱. 휴대폰 앱과 같은 패키지 이름(kr.babylog.app)·같은 서명이어야 서로 이어짐
include(":wear")
