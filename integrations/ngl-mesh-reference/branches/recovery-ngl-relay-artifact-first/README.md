# NGL Relay artifact-first recovery branch

This folder preserves the 40-file Android Relay recovery branch from `ngl-damien/ngl-mesh` at commit `e99319ecb07f379f182586de44bbbdc899d82ce0` and tree `4a785ebd7aeca3fa2a70d31624b68b5b046b1115`.

## What is preserved

- Android application shell and manifest
- Java artifact/case store and methodology engine
- Provider adapters for OpenAI, Gemini, Grok, and Claude
- Control-surface schema and documentation
- Recovery notes, forensic inventory, and the compressed DEX member inventory

## Exact-source verification

All 40 source files have matching source and target Git blob SHAs. See `SOURCE_MANIFEST.json` for every original path, source blob SHA, target path, and disposition. The original `ngl-mesh` repository is unchanged.

## Important limitations

- This is a **source-only reference**, not a runnable Alpha One integration or a verified Android build.
- The source branch contains `recovery/BUILD_BLOCKER.md`: Gradle was not installed and Android SDK environment/platforms were unavailable in the reported recovery environment. No build is claimed here.
- No `LICENSE` file exists in the preserved source tree; reuse license is unconfirmed.
- README and recovery notes contain historical observations and operator-reported claims. They are preserved as source material, not independently re-verified by this import.
- Live model-provider calls remain unverified until provider credentials are configured on a device. No credentials were copied.
- Do not promote source presence, a self-signed APK, or historical test-count claims into proof of current production readiness.
