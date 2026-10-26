# Independent observation trust boundary

## Canonical projection rule

An event's `observation_verification: "VERIFIED"` field is a claim, not proof. `projectWorld` and `projectQuest` require an allowed observation event type (`SYSTEM_EVENT` or `EXECUTION_ADJUDICATION`), a host-injected `verifyObservation(event)` callback that returns the boolean `true`, and artifact receipts whose bytes validate. Adjudication verification is accepted only for an `EXECUTION_ADJUDICATION` rejection or a `REVOCATION` event. Missing, throwing, false, or merely truthy verifiers do not grant progress. The event remains in history for review.

Rejections and revocations require a separate `verifyAdjudication(event)` callback. An unverified rejection or revocation remains history and cannot manufacture terminal state or revoke a grant.

## Ed25519 adapter

`src/world/observation-attestation.js` verifies an Ed25519 signature over the canonical event payload (excluding only the attestation envelope). It requires a host-configured SHA-256 fingerprint of the DER SubjectPublicKeyInfo and a configured observer ID. It rejects wrong observers, wrong keys, malformed signatures, extra envelope fields, and modified signed payloads.

## Production limitation

The adapter is **not wired into `game/server.mjs`** and no separately controlled production observer key is provisioned here. The test suite generates ephemeral keys to verify the adapter's behavior; this does not establish real-world observer identity, actual independent observation, production security, or deployment. A production integration must supply the expected public key, fingerprint, and observer ID from configuration controlled separately from the event producer. The observer's private key must remain outside this repository and outside the verifier process.

Until that integration exists, the correct status is: fail-closed projection API and tested verifier component; production trust root unresolved.
