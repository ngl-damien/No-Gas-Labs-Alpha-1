# Android Alpha-1 shell

The first Android package is a native application shell around the Common Ground game. It packages the current `game/` directory into the APK and serves it through AndroidX `WebViewAssetLoader` at the stable HTTPS origin `appassets.androidplatform.net`. It does not use `file://` URLs.

## What this build demonstrates

- The actual Common Ground entry page, JavaScript modules, styles and local assets are bundled in the APK.
- Private play opens without a remote server. The existing private-world save remains in WebView DOM storage under the appassets origin.
- The native back button closes an open creation or sheet before leaving the activity.
- The Journal's private save envelope carries the world and the character's last map coordinates through Android's system document picker. Import validates both and opens only a private world; the previous local backup keeps its matching coordinates. Shared exports remain role-filtered and never carry private character position. The same bounded bridge saves HTML artifact and exhibition downloads without broad storage permissions.
- Imported bytes are passed to the existing in-world validator and can only replace the device-local private world; they do not create shared authority or canonical server state.
- The native APK remains offline-first: it has no `INTERNET` permission, external navigation and external WebView requests remain blocked, and shared `/api/*` requests receive an explicit 503.
- During the Gradle build, `captureProjectStateSnapshot` uses bounded, unauthenticated public GitHub GETs on the build runner and bundles a minimal, timestamped snapshot into the APK. It requests only public PR titles/branches, issue titles/status, and workflow-run metadata; it stores no tokens, bodies, comments, or logs.
- In the Guild Hall, talking to the Synthesis Clerk opens that bundled snapshot. The panel shows capture time, APK source SHA/ref, source availability, and a SHA-256 receipt. It is explicitly **not live**. An unavailable source remains unavailable; the UI does not infer an empty queue or award XP, evidence, approval, or authority.
- The SHA-256 receipt identifies the exact canonical payload bytes only. It does not independently verify the GitHub response, the truth of a claim, execution, or Founder disposition.
- The live GitHub Founder Gate remains a separate browser/online surface in the Decision Chamber; this native snapshot does not silently grant Android network access.

This is an Android package and an offline private-world acceptance boundary, not a fully native rendering rewrite or a deployed multiplayer client.

## Build and verify

The build runner needs Node.js 24 in `PATH`, JDK 17, Android SDK platform 35, and Gradle 8.9. The Gradle asset-sync task invokes the snapshot capture script before packaging:

```sh
gradle -p android :app:assembleDebug
gradle -p android :app:connectedDebugAndroidTest
```

The debug package is written to `android/app/build/outputs/apk/debug/app-debug.apk`. The build-time snapshot is also written to `android/app/build/generated/project-state/project-state.json`. The Android Alpha-1 workflow preserves both artifacts and runs the instrumented offline-world journey on an API 35 emulator.

## Deliberate limits

- The shared service URL is not configured in this build; shared mode fails closed with 503.
- The project-state panel is a build-time public snapshot, not a live native connection. Install a newer APK to receive a newer bundled capture.
- The game UI is still web-rendered inside a native Android activity. This is the first packaging/integration boundary, not a claim that the full RPG has native views.
- Android cloud backup remains disabled. Export important private work from the Journal before clearing app data or uninstalling. Device-local recovery pairs the previous private world with its matching character coordinates; legacy world-only backups remain readable at the original spawn point. Imports are size-bounded, UTF-8 checked, and validated by the game before replacing the private save.
- No GPS permission, native location feature, production deployment, or physical Android-device acceptance is claimed. Emulator acceptance is not physical-device acceptance.
