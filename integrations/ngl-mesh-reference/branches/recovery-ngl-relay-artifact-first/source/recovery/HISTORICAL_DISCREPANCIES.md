# Historical material vs executable reality

| Claim/material | APK reality | Disposition |
|---|---|---|
| `apk.zip/android_mesh_project` is NGL source | Package is `com.nogaslabs.mesh`; Relay package is `ngl.relay` | Different descendant/parallel project; evidence only |
| Mesh `MethodologyEngine.kt` represents installed Relay implementation | Relay DEX contains `ngl.relay.core.MethodologyEngine` compiled from `MethodologyEngine.java` | Do not substitute mesh engine for Relay engine |
| Mesh provider layer includes broader adapters | Relay DEX has four concrete slots: OpenAI, Gemini, Grok, Claude | Broader adapters are modernization/lineage, not baseline |
| Native `libngl_engine.so` is part of Relay | 49,651-byte Relay APK has exactly seven ZIP entries and no native libraries | Native engine absent from installed Relay |
| Room persistence is Relay storage | Relay DEX uses app-private files, `case.json`, `record.jsonl`, per-artifact JSON and SharedPreferences | Room belongs to mesh lineage, not this Relay baseline |
