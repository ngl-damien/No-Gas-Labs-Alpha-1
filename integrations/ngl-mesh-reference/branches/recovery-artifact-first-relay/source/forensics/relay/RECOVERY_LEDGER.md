# NGL Relay — Artifact-First Recovery Ledger

Status: active reconstruction branch.

## Ground truth

The current Drive artifact named `NGL Relay` is 49,651 bytes and has SHA-256:

`6cee7b1ea12c435cc7705510b5d61c85c63764dcd9658a00b6ea99c2311e9ffe`

The `NGL™.zip` historical archive contains an embedded `NGL_BUS.apk` with the same SHA-256 and a byte-for-byte comparison against the current Drive artifact succeeds. This makes the archive useful as corroborating evidence without changing the rule that the executable is ground truth.

The same archive contains:

- `ngl_apk_extract/AndroidManifest.xml`
- `ngl_apk_extract/classes.dex`
- `ngl_apk_extract/resources.arsc`
- signing metadata under `ngl_apk_extract/META-INF/`
- `kernel_dexdump.txt`
- the byte-identical `NGL_BUS.apk`
- a separate `android_mesh_project/` Kotlin/Gradle project

The separate `apk.zip` also contains `android_mesh_project/`, including source, tests, Gradle files, JNI sources, and build outputs. That project uses the `com.nogaslabs.mesh` package and must not be silently treated as the source of the `ngl.relay` APK.

## Tooling pivot

A missing local JADX/apktool installation is no longer treated as a blocker. The historical archive already preserves an Android `dexdump` of the exact byte-identical Relay DEX. Recovery therefore proceeds in two lanes:

1. **Artifact lane:** inspect the exact APK/DEX, hashes, manifest surface, strings, class/method metadata, storage names, network endpoints, and methodology constants.
2. **Corroboration lane:** compare the separate historical Kotlin project only after an observed Relay behavior or structure has been recorded.

A full Java decompiler remains useful, but it is an acceleration tool rather than a prerequisite for continued reconstruction.

## Directly observed DEX facts

The DEX is version `037` and contains 71 `ngl.relay.*` classes including synthetic classes. Original source filenames embedded in DEX metadata include:

- `Artifact.java`
- `CaseStore.java`
- `ContextBuilder.java`
- `CoreJson.java`
- `Iso8601.java`
- `MethodologyEngine.java`
- `Node.java`
- `HttpNode.java`
- `OpenAiNode.java`
- `GeminiNode.java`
- `GrokNode.java`
- `ClaudeNode.java`
- `RelayApp.java`
- `NodeRegistry.java`
- `MainActivity.java`
- `CaseActivity.java`
- `CompareActivity.java`
- `ArtifactActivity.java`
- `SettingsActivity.java`

Observed stage constants are numbered 1 through 5: `INDEPENDENT`, `CROSS`, `ITERATIVE`, `DELIBERATION`, `SYNTHESIS`.

Observed storage and provenance strings include `record.jsonl`, `case.json`, `case.json.tmp`, `artifact_id`, `original_input_artifact_id`, `methodology_stage`, `context_compact`, and explicit immutability/hash-mismatch error strings.

Observed configuration strings include a default timeout of 90,000 ms and a context budget of 24,000 characters.

Observed provider defaults in this artifact are:

| Provider | Model | Base URL |
| --- | --- | --- |
| OpenAI | `gpt-4o-mini` | `https://api.openai.com/v1` |
| Gemini | `gemini-2.0-flash` | `https://generativelanguage.googleapis.com/v1beta` |
| xAI | `grok-3-latest` | `https://api.x.ai/v1` |
| Anthropic | `claude-3-5-haiku-20241022` | `https://api.anthropic.com/v1` |

API-key UI text explicitly states that keys are stored in app-private storage and not in APK/artifacts. This is an observed string, not yet a runtime security verification.

## Methodology prompts recovered as static constants

The DEX preserves complete stage instructions. Stage 1 explicitly instructs a node to answer the original input independently and states that it has not seen other analyses. Stage 2 explicitly asks nodes to critique, compare, corroborate, and contradict preserved independent outputs. Stage 3 asks nodes to interrogate the accumulated record further without merely repeating established material. Stage 4 requires structured deliberation across agreements, disagreements, contradictions, uncertainties, missing information, competing interpretations, and unresolved questions. Stage 5 produces an actionable human-facing synthesis while explicitly stating that the synthesis is a derived artifact rather than verified truth.

## Recovery boundary

The following are not yet claimed:

- exact original Java source text;
- exact Gradle/build configuration that produced the 49,651-byte APK;
- behavioral equivalence of any reconstructed source;
- runtime correctness of key storage or all persistence semantics;
- that `android_mesh_project/` is a direct ancestor of the Relay APK.

Those require reconstruction plus build/runtime checks.

## Next reconstruction target

Recover `Artifact`, `CaseStore`, `Node`, `HttpNode`, `NodeRegistry`, and `MethodologyEngine` first. They define the canonical record, transport boundary, configuration surface, and five-stage behavior. UI activities follow after those contracts are stable.