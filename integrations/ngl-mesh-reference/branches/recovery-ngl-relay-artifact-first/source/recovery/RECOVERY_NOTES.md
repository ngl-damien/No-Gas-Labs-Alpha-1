# NGL Relay — artifact-first recovery notes

## Reference identity

The baseline is the most recent Google Drive file `/Google Drive/NGL Relay`, acquired 2026-09-17 UTC as an Android package of 49,651 bytes.

* SHA-256 `6cee7b1ea12c435cc7705510b5d61c85c63764dcd9658a00b6ea99c2311e9ffe`
* SHA-1 `e164c69efd5b43b4197048e084753a23492dc5bf`
* MD5 `4c0498e3b2be808220085fb783f63a9d`
* package `ngl.relay`; version `0.1.0` / versionCode 1
* compile/target SDK 34; min SDK 24

`jarsigner` verifies the embedded v1 JAR signature. The APK Signing Block contains v2 (`0x7109871a`) and v3 (`0xf05368c0`) signer records plus verity padding. The certificate is self-signed as `CN=NGL Relay Self-Signed, OU=Build, O=NGL Relay Project, C=US` and has SHA-256 fingerprint `72:DC:D4:E7:C9:B5:78:B3:86:C2:25:4D:99:63:B5:77:C8:8E:11:02:F7:18:82:4A:AE:28:8F:20:7E:C9:FB:16`.

## Knowledge labels

**OBSERVED** means extracted directly from APK bytes or signing/ZIP structures. **RECONSTRUCTED-STRONG** means source was manually translated from DEX instruction flow and constants. **INFERRED/PARTIAL** means semantics are supported but the current clean source is not yet instruction-equivalent.

### OBSERVED

The manifest has only INTERNET and ACCESS_NETWORK_STATE permissions; no services, receivers, or providers. `MainActivity` is exported for launcher, SEND text/plain, and PROCESS_TEXT text/plain. Case/Artifact/Compare/Settings activities are non-exported. `RelayApp` uses app-private `filesDir/ngl`. Shared preferences are `ngl_relay_prefs`.

DEX contains 986 strings, 180 types, 232 prototypes, 205 fields, 589 methods, 71 class definitions. The complete NGL member inventory, including compiler-generated classes, is stored as `dex-member-inventory.txt.gz`.

The four configured slots are OpenAI, Gemini, Grok, Claude. Timeout default is 90,000 ms and is clamped to at least 5,000 ms. Context budget default is 24,000 characters and is clamped to at least 4,000.

Storage strings and bytecode establish per-case directories, `case.json`, temp `case.json.tmp`, append-only `record.jsonl`, artifact `.json` files and `.json.tmp` atomic-write paths. `CaseMeta` fields are caseId, title, createdAt, updatedAt, originalInputArtifactId, methodologyStage, and humanDecision. Artifact fields include id, caseId, type, stage, createdAt, provider, nodeId, model, status, contentType, content, error, hash, and parents.

### RECONSTRUCTED-STRONG

Provider endpoint construction, auth headers, request bodies, defaults, HTTP status handling, timeout use, UTF-8 POST transport and response extraction are translated from DEX into readable Java.

`Iso8601`, artifact identity/defaults/type wires, artifact JSON field order, content SHA-256 behavior, immutable parent lists, and app-private append-only case storage have now been translated into the recovery source. `CaseStore` enforces artifact immutability, content-hash checks, parent-before-child provenance, temp-file writes, per-artifact JSON, and append-only `record.jsonl` events.

All five methodology prompt constants are recovered verbatim. Stage 1 creates a NODE_REQUEST parented by original input and then NODE_RESPONSE or ERROR. Later stages assemble prior-record context; stage 2 requires preserved stage-1 NODE_RESPONSE artifacts and cross-exposes other-node outputs; stage 3 iterates over accumulated prior stages; stage 4 produces structured deliberation; stage 5 produces synthesis prefixed as a derived artifact and explicitly not verified truth. Failure artifacts preserve raw error bodies.

`RelayApp` now reconstructs the observed `filesDir/ngl` root and refreshes `CaseStore`/`MethodologyEngine` using the saved context budget and timeout.

### RECONSTRUCTED BUT NOT YET INSTRUCTION-EQUIVALENT

`ContextBuilder` implements the observed protective-artifact / compacted-entry strategy and 1,000-character minimum budget, but exact compaction ordering and final truncation behavior still require instruction-level verification.

`CoreJson` reproduces observed string escaping, hashing, object/list parsing surface and accessors; parser edge-case behavior has not yet been exhaustively compared with the DEX implementation.

The clean `MainActivity` and `SettingsActivity` reproduce the visible control vocabulary and provider settings layout but are not yet DEX-instruction-equivalent. Case, Artifact and Compare activities remain deliberately marked placeholders rather than falsely presented as recovered.

`MethodologyEngine.java` has the recovered constants, constructor substrate and stage model, but the complete persisted-artifact orchestration for stages 1–5 still has to be translated from disassembly. This is now the principal baseline gap.

## Historical corroboration performed after artifact reconstruction

`apk.zip` is not the source tree for this 49,651-byte Relay. It contains a distinct `com.nogaslabs.mesh` Kotlin project with Room/cognition/RPG/native components. Its `MethodologyEngine.kt` is corroborating lineage, not executable provenance for package `ngl.relay`.

The newer ~42.6 MB `NGL™.zip` contains build products for that `com.nogaslabs.mesh` project and an `ngl_apk_extract/AndroidManifest.xml`, supporting that the Relay artifact had previously been extracted during the mesh campaign. It does not silently supersede the APK-derived reconstruction.

## Build status

The current execution environment has JDK 21 and **no `gradle` executable, no Android SDK, no `ANDROID_HOME`, and network package installation fails DNS resolution**. Therefore producing a rebuilt APK here is objectively blocked by missing Android build tooling, not by an APK-analysis limitation.

A host-JDK provider fixture was compiled and passed earlier in this recovery. An artifact/JSON fixture has been added to the repository for execution in the next environment that can compile the updated source tree. Android packaging still requires SDK 34 plus Gradle/AGP resolution.

## Baseline gate

Do not merge modernization into the recovery baseline until full `MethodologyEngine` orchestration and all Activity flows have been translated, deterministic fixtures pass against the clean reconstruction, and a rebuilt APK has been behaviorally compared against reference SHA-256 `6cee7b1ea12c435cc7705510b5d61c85c63764dcd9658a00b6ea99c2311e9ffe`.

Provider abstraction modernization belongs in a later branch/commit series and must not contaminate this baseline.
