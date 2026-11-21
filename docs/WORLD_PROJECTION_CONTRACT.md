# World Projection Contract

The game world is a projection, not an authority source.

## Boundary

Input is an append-only event sequence. A world consequence is admitted only when the event is simultaneously:

- `admission: ACCEPTED`
- `authority: AUTHORIZED`
- `execution: EXECUTED`
- `evidence: OBSERVED`
- `outcome: SUCCEEDED`
- backed by at least one receipt reference.

Claims and proposals may create visible quests, but cannot award XP, inventory, completion, or world mutations.

Failures, refutations, and rejected candidates remain in history.

Replay is idempotent by `event_id`.

## Chronology and replay

- The retained event array position defines sequence. Replay must not sort events by wall-clock timestamp.
- Every event timestamp remains individually validated as strict normalized UTC metadata. A valid clock correction does not reorder an already appended event.
- `world.updatedAt` is a wall-clock high-water mark: it never moves backward when a later appended event carries an earlier timestamp.
- Only explicitly append-ordered action/event families may be appended below the current high-water mark: Source Observatory observation/challenge/response actions and Combat Yard encounter-start/move actions. All other world actions/events remain chronology-gated and reject timestamp regression.
- This exception changes neither actor authorization nor the admission/evidence requirements above. It does not create XP, truth, authority, approval, or a successful outcome.

Verified revocations are replayed in event order. They block later executions using the revoked grant, and the quest projector applies the same boundary as the world reducer. A revocation does not silently erase earlier verified outcomes; the original event and its consequence remain auditable in history.

## Source Observation snapshot binding

A retained Source Observation distinguishes an author-declared snapshot reference from a server-validated session receipt:

- `USER_SELECTED` is a participant-entered reference. It carries no server receipt digest and is not proof that the participant viewed, retrieved, or independently checked the referenced bytes.
- `SERVER_SESSION_RECEIPT` is admitted only after the shared server validates the opaque receipt against the authenticated session, expiry, and exact snapshot revision. Canonical history stores the nonnegative `sourceSnapshotRevision` and a lowercase SHA-256 `sourceSnapshotReceiptDigest`; it never stores the bearer token.
- The server's stored-history validator, model import validator, and read-only research projection use the same binding predicate. A server-session binding without its revision and 64-hex digest is malformed; an author-selected binding carrying a server receipt digest is also malformed.
- The digest establishes byte identity of the ephemeral token, not authorship, a distinct human, reading or understanding, source retrieval, independent verification, claim truth, approval, authority, or XP.

The event's research limits remain explicit: `sourceRetrieval: NOT_PERFORMED`, `independentVerification: NOT_PERFORMED`, `modelAssertions: LEADS_ONLY`, and `execution: NOT_EXECUTED`. A receipt changes provenance of the selected snapshot only; it does not upgrade the epistemic status of the note.

## Donor alignment

This seam is intentionally compatible with the recovered NGL direction, with provenance boundaries:

- **RAE (executable source inspected):** bounded no-follow byte reads, deterministic observation IDs, structured predicates, self-integrity receipts, and signed operation-scoped capability grants. Its verifier deliberately leaves model claims `PROPOSED` even when a receipt validates; a receipt establishes artifact identity/self-integrity, not claim semantics.
- **Mesh/Relay (executable source inspected):** artifact identity, append-only external lineage, and a separate Ed25519 grant for consequential transitions. An imported report does not create a human decision or methodology stage.
- **RuneUX (provenance unresolved):** retained as a founder-referenced design label for world/quest/XP/inventory/interaction grammar, but no NGL-owned executable RuneUX source was recovered in this audit. The public `adrianjonmiller/runeux` repository describes itself as a JavaScript function-trampoline utility, not an MMORPG UI or world runtime; it is not implementation evidence.
- **Guild/Command Center (interface patterns only):** useful collaboration and operational-surface concepts. The recovered Guild demo simulates task outcomes/metrics, including random values; Command Center Node-Gate hook state is not signed authority or canonical progression.
- **TownSquare (not an executable donor in the recovered copy):** the active `No_Gas_Labs-Omnichain_TownSquare` repository contains a README describing a one-file/two-line archive; no executable MMORPG runtime was recovered there.
- **AGP/VoxScript (publication and drafting patterns only):** AGP's demo backend uses in-memory state and random metrics; VoxScript uses heuristic satire scoring, a hardcoded compliance score, and a placeholder fact-checking integration. These outputs are not evidence, approval, or verification.
- **Decision Chamber (Alpha-1 module, not a separate donor repository):** the current authority module verifies exact scoped ECDSA P-256 Founder decisions with fingerprint, nonce, and expiry checks. The repository's Founder trust anchor remains `NOT_ENROLLED`; tests use `TEST_ONLY` keys.

The reducer does not claim these donor systems are already wired into Alpha 1. It creates the boundary through which independently inspectable mechanisms may be adapted without allowing the game UI, a model assertion, a demo metric, or an imported report to manufacture canonical state.
