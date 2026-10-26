# World trust roots: signed authorization, observation, and adjudication

This adapter binds the world projection's existing host callbacks to three separately pinned Ed25519 public keys. It does not itself grant authority, create evidence, or establish that a human performed the action.

## Required host configuration

`createWorldTrustFromEnv()` requires all ten values:

- `NGL_OBSERVER_PUBLIC_KEY_PEM`, `NGL_OBSERVER_KEY_SHA256`, `NGL_OBSERVER_ID`
- `NGL_AUTHORIZER_PUBLIC_KEY_PEM`, `NGL_AUTHORIZER_KEY_SHA256`, `NGL_AUTHORIZER_ID`
- `NGL_ADJUDICATOR_PUBLIC_KEY_PEM`, `NGL_ADJUDICATOR_KEY_SHA256`, `NGL_ADJUDICATOR_ID`
- `NGL_WORLD_TRUST_AUDIENCE` — a stable, host-controlled identifier unique to this world/institution context

All three role roots must use the same configured audience. Do not reuse the audience across separate institutions, tenants, or environments. Each incoming event must carry that exact `audience` value; it is part of the canonical signed payload. A valid signature created for another audience is rejected even if the same key is accidentally trusted in both contexts.

Fingerprints are SHA-256 of DER SubjectPublicKeyInfo and must be pinned through a channel separate from the incoming event. The module rejects missing configuration, non-Ed25519 keys, fingerprint mismatch, reused fingerprints, reused role identities, and inconsistent audiences. It never generates production keys or trusts a fingerprint supplied by an event.

## Signed event format

Each role signs the same canonical event payload. The payload excludes the three signature envelopes so the signatures do not depend on one another. Each envelope contains exactly `schema`, `algorithm`, `keyFingerprint`, and `signature`; the role-specific identity field remains inside the signed payload.

- Observer: `observer_id` + `observation_attestation`
- Authorizer: `authorizer_id` + `authorization_attestation`
- Adjudicator: `adjudicator_id` + `adjudication_attestation`

The verifier callbacks can be passed to `projectWorld`, `projectQuest`, or `replayInstitution`. They return literal booleans and fail closed on malformed payloads, mismatched identities, signatures, schemas, or keys.

## Limits and deployment gate

Tests generate ephemeral keys solely for regression testing. No production trust root or private signing key is provisioned by this change. The adapter is not yet wired into `game/server.mjs`; no live gameplay transition is claimed to use these signatures. Before production use, the keys and fingerprints must be provisioned independently, their custody/rotation/revocation documented, and the server's actual mutation path wired to these callbacks. Until then, canonical consequential progress must remain unavailable wherever host verification is absent.
