plugins {
    id("com.android.application")
}

android {
    namespace = "labs.nogas.commonground"
    compileSdk = 35

    defaultConfig {
        applicationId = "labs.nogas.commonground"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/gameAssets"))
}

val projectStateSnapshot = layout.buildDirectory.file("generated/project-state/project-state.json")

val captureProjectStateSnapshot = tasks.register<Exec>("captureProjectStateSnapshot") {
    val outputFile = projectStateSnapshot.get().asFile
    doFirst { outputFile.parentFile.mkdirs() }
    commandLine(
        "node",
        rootProject.projectDir.parentFile.resolve("scripts/capture-project-state.mjs").absolutePath,
        "--out",
        outputFile.absolutePath
    )
    outputs.file(projectStateSnapshot)
    outputs.upToDateWhen { false }
}

val syncGameAssets = tasks.register<Sync>("syncGameAssets") {
    from(rootProject.projectDir.parentFile.resolve("game")) {
        exclude(".runtime/**")
        exclude("**/.DS_Store")
        exclude("**/node_modules/**")
    }
    // The generated snapshot is copied after the checked-in unavailable placeholder.
    from(projectStateSnapshot)
    into(layout.buildDirectory.dir("generated/gameAssets/game"))
    dependsOn(captureProjectStateSnapshot)
}

tasks.named("preBuild").configure {
    dependsOn(syncGameAssets)
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")

    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:rules:1.6.1")
}
