# Independent observation trust boundary

## Canonical projection rule

An event's `observation_verification: "VERIFIED"` field is a claim, not proof. `projectWorld` and `projectQuest` require an allowed observation event type (`SYSTEM_EVENT` or `EXECUTION_ADJUDICATION`), a host-injected `verifyObservation(event)` callback that returns the boolean `true`, and artifact receipts whose bytes validate. Adjudication verification is accepted only for an `EXECUTION_ADJUDICATION` rejection or a `REVOCATION` event. Missing, throwing, false, or merely truthy verifiers do not grant progress. The event remains in history for review.

Rejections and revocations require a separate `verifyAdjudication(event)` callback. An unverified rejection or revocation remains history and cannot manufacture terminal state or revoke a grant.

Authorization is a separate trust boundary from observation. `projectWorld` requires a host-injected `verifyAuthorization(event)` callback that returns literal `true` for the exact execution event before any XP, inventory, quest completion, failure, or world effect is projected. `projectQuest` additionally requires a host-verified `QUEST_AUTHORIZED` event and requires each accepted execution to match that grant. A `QUEST_AUTHORIZED` label, Founder actor string, grant ID, observer signature, or artifact receipt is not authority on its own. Missing, throwing, false, or merely truthy authorization verifiers fail closed.

## Ed25519 adapter

`src/world/observation-attestation.js` verifies an Ed25519 signature over the canonical event payload (excluding only the attestation envelope). It requires a host-configured SHA-256 fingerprint of the DER SubjectPublicKeyInfo, a configured observer ID, and a configured expected audience. The signed event must carry that exact `audience`; a signature valid for one institution/ledger audience is rejected by a verifier configured for another. This prevents cross-context replay when an observer key is trusted by more than one context. The adapter also rejects wrong observers, wrong keys, malformed signatures, extra envelope fields, and modified signed payloads.

The world projector writes event-controlled keys with own data properties instead of prototype-sensitive assignment. Regression coverage includes `__proto__` and `constructor` keys in quest subjects, inventory items, and world effects. These keys remain data; they cannot mutate the projection object's prototype.

## Production limitation

The adapter is **not wired into `game/server.mjs`** and no separately controlled production observer key is provisioned here. The world/quest projection API also has no production authorization-verifier injection configured in this branch; without that separate host-controlled gate, canonical progress remains unavailable by design. The test suite generates ephemeral keys to verify the adapter's behavior; this does not establish real-world observer identity, actual independent observation, production security, or deployment. A production integration must supply the public key, fingerprint, observer ID, and expected audience from configuration controlled separately from the event producer. The observer's private key must remain outside this repository and outside the verifier process.

Until that integration exists, the correct status is: fail-closed projection API and tested verifier component; production trust root unresolved.
