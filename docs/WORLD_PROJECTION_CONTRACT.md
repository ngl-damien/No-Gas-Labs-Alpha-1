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

## Source Archive failure objects

- A `source-archive-attempt-failed` event is appended by the shared Source Archive service only after it observes a retrieval/build failure. Clients cannot submit this event as an action. The retained event binds a unique attempt, request/action digests, repository, commit, path, failure code and retryability, and identifies `shared-source-archive-service`; raw request IDs and action fingerprints are not retained.
- Evidence Archive owns the complete paginated failure history. Moonshot Field may mirror a bounded newest-first subset as research blockers, using the same strict projection. This mirror does not change the failure's canonical Evidence Archive location.
- Opening a failure card, following its exact Chronicle event, or opening a prefilled Source Observatory lead is read-only. A lead is not an observation until explicitly submitted and server-validated. These actions create no event, XP, truth verdict, approval or authority.
- Later successful retrieval does not erase an earlier failed attempt. Partial, stale, invalid and unavailable projections must be distinguished; missing or unseen history is never interpreted as proof that no failure exists.

Replay is idempotent by `event_id`.

## Snapshot identity and navigation/inspection

- Opening World Chronicle with an explicit accepted snapshot pins the view to that snapshot's revision and retained event set. A newer accepted world snapshot does not silently replace an explicitly pinned view; it is reported as `revision-mismatch` until the player explicitly refreshes.
- Explicit Chronicle refresh adopts only the already accepted in-memory world snapshot. The refresh action is a read-only re-projection: it does not fetch shared state, append a world event, award XP, create evidence, grant approval, or change authority.
- Disconnected, unavailable, or regressed snapshot state remains stale and fails closed; refresh is not offered until a newer accepted snapshot is available.
- Bounded projections such as Moonshot Field must disclose partial scope and unseen-event count. A visible subset is not a global total and does not establish newest-order completeness. Evidence Archive remains the complete paginated owner.
- Route arrival may append legitimate `discover` events. Preserve those events in history. After the post-arrival snapshot is captured, opening or reading an NPC card and inspecting its linked Chronicle event is read-only. Acceptance tests must separate route-discovery effects from the subsequent read-only NPC interaction rather than comparing against a pre-route snapshot.
- Selecting/tapping a map landmark is navigation, not institution entry. The explicit nearby Interact action opens the institutional sheet. Acceptance tests must assert that the sheet is visible before inspecting its contents; a retained title in hidden DOM is not proof of entry.
- **Runtime enforcement (Run 297):** `PixelWorldView.handlePointer` now routes every institution landmark tap, including taps made while already nearby; it never opens the room from the map click. Only the explicit nearby `#interact-button` performs entry. Unit and 320px/390px Council acceptance exercise the distinction.

## Chronology and replay

- The retained event array position defines sequence. Replay must not sort events by wall-clock timestamp.
- Every event timestamp remains individually validated as strict normalized UTC metadata. A valid clock correction does not reorder an already appended event.
- `world.updatedAt` is a wall-clock high-water mark: it never moves backward when a later appended event carries an earlier timestamp.
- Only explicitly append-ordered action/event families may be appended below the current high-water mark: Source Observatory observation/challenge/response actions and Combat Yard encounter-start/move actions. All other world actions/events remain chronology-gated and reject timestamp regression.
- This exception changes neither actor authorization nor the admission/evidence requirements above. It does not create XP, truth, authority, approval, or a successful outcome.

Verified revocations are replayed in event order. They block later executions using the revoked grant, and the quest projector applies the same boundary as the world reducer. A revocation does not silently erase earlier verified outcomes; the original event and its consequence remain auditable in history.

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
