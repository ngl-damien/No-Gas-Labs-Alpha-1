# Android Alpha-1 shell

The first Android package is a native application shell around the existing Common Ground game. It packages the current `game/` directory into the APK and serves it through AndroidX `WebViewAssetLoader` at the stable HTTPS origin `appassets.androidplatform.net`. It does not use `file://` URLs.

## What this build demonstrates

- The actual Common Ground entry page, JavaScript modules, styles and local assets are bundled in the APK.
- Private play opens without a remote server. The existing private-world save remains in WebView DOM storage under the appassets origin.
- The native back button closes an open creation or sheet before leaving the activity.
- The Journal's world JSON import/export uses Android's system document picker. The same bounded bridge saves HTML artifact and exhibition downloads without broad storage permissions.
- Imported bytes are passed to the existing in-world validator and can only replace the device-local private world; they do not create shared authority or canonical server state.
- File/content URL access, mixed content, external navigation and external WebView requests are blocked.
- A shared-world `/api/*` request receives an explicit 503 response. The app does not fabricate a shared session, silently switch modes, or grant Founder authority.

This is an Android package and an offline private-world acceptance boundary, not a fully native rendering rewrite or a deployed multiplayer client.

## Build and verify

From the repository root with JDK 17, Android SDK platform 35 and Gradle 8.9 available:

```sh
gradle -p android :app:assembleDebug
gradle -p android :app:connectedDebugAndroidTest
```

The debug package is written to `android/app/build/outputs/apk/debug/app-debug.apk`. The Android Alpha-1 workflow builds that package and runs the instrumented offline-world journey on an API 35 emulator.

## Deliberate limits

- The shared service URL is not configured in this build; shared mode fails closed with 503.
- The game UI is still web-rendered inside a native Android activity. This is the first packaging/integration boundary, not a claim that the full RPG has native views.
- Android backup remains disabled. Export important private work from the Journal before clearing app data or uninstalling; imports are size-bounded, UTF-8 checked, and then validated by the game before replacing the private save.
- No GPS permission, native location feature, production deployment, or physical Android-device acceptance is claimed. Emulator acceptance is not physical-device acceptance.
