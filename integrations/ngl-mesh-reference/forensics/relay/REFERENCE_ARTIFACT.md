# NGL Relay — Reference Artifact

This record anchors reconstruction of the observed executable artifact before source-level development proceeds.

## Observed artifact

- Drive name: `NGL Relay`
- Format: Android APK
- Size: 49,651 bytes
- SHA-256: `6cee7b1ea12c435cc7705510b5d61c85c63764dcd9658a00b6ea99c2311e9ffe`
- Byte-identical observed predecessor: `NGL_BUS.apk`

The APK itself is the behavioral reference. Reconstructed source is a hypothesis until its behavior is checked against this artifact.

## APK members

- `AndroidManifest.xml`
- `res/mipmap/ic_launcher.png`
- `resources.arsc`
- `classes.dex`
- `META-INF/NGLRELAY.SF`
- `META-INF/NGLRELAY.RSA`
- `META-INF/MANIFEST.MF`

## Observed DEX surface

Application/UI classes observed include:

- `ngl.relay.app.MainActivity`
- `ngl.relay.app.CaseActivity`
- `ngl.relay.app.CompareActivity`
- `ngl.relay.app.NodeRegistry`
- `ngl.relay.app.RelayApp`

Core classes observed include:

- `ngl.relay.core.MethodologyEngine`
- `ngl.relay.core.CaseStore`
- `ngl.relay.core.ContextBuilder`
- `ngl.relay.core.HttpNode`
- `ngl.relay.core.OpenAiNode`
- `ngl.relay.core.GeminiNode`
- `ngl.relay.core.GrokNode`
- `ngl.relay.core.ClaudeNode`

Stage identifiers observed in `classes.dex`:

- `STAGE_1_INDEPENDENT`
- `STAGE_2_CROSS`
- `STAGE_3_ITERATIVE`
- `STAGE_4_DELIBERATION`
- `STAGE_5_SYNTHESIS`

Provider defaults observed in `classes.dex`:

- OpenAI: `gpt-4o-mini`, base `https://api.openai.com/v1`
- Gemini: `gemini-2.0-flash`, base `https://generativelanguage.googleapis.com/v1beta`
- xAI: `grok-3-latest`, base `https://api.x.ai/v1`
- Anthropic: `claude-3-5-haiku-20241022`, base `https://api.anthropic.com/v1`

## Reconstruction rule

Do not silently replace observed behavior with intended behavior. For each reconstructed subsystem, record whether it is:

1. **Observed** directly in the reference APK,
2. **Inferred** from decompilation/static analysis,
3. **Corroborated** by historical source/archive material, or
4. **New** post-reconstruction development.

Historical ZIP/source material may clarify intent, names, and build configuration, but it does not supersede contradictory evidence from the reference APK without an explicit documented decision.
