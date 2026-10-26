# NGL Repository Stutter-Step Checkpoint

Updated: 2026-10-25 local / 2026-10-26 UTC. Evidence-bound handoff; no merge, deployment, XP award, external release, or spending performed.

## Fresh state observed

- Primary repository: `ngl-damien/No-Gas-Labs-Alpha-1`.
- `main`: `0969df84cce7748d4f0db8e79ec06d13ad826a31` — `Connect Common Ground quests to recorded activity`.
- Open PRs observed: #21 (draft), #25 (draft), #26 (draft), #27 (ready for review).
- PR #25 head `fc7f025400f0a75d58c56afe7f8d7eacad326c96`; `verify` run [40256041852](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40256041852) and `Genesis Evidence Invariant` run [40256041862](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40256041862) succeeded.
- PR #26 head `2b7e3c108983849a27ce418922d8af832ae746cd`; `verify` run [40259013270](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40259013270) and `Genesis Evidence Invariant` run [40259013346](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40259013346) succeeded.
- PR #27 head `12a4f4a4ba7ba2f190b727b7ac48e46a268188ee`; `verify` run [40255483069](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40255483069) and `Genesis Evidence Invariant` run [40255483306](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/actions/runs/40255483306) succeeded.
- PR #16 is closed unmerged; its original self-signing-flow finding is superseded by PR #18, merged as `213f3b5c7771da24b36f9ce6ebdde871d22e4602`. The replacement verifies detached Ed25519 signatures against a configured fingerprint, but that is not proof Damien controls the private key or personally approved a proposal.
- Issue #17 remains open for real key custody, concurrency, crash recovery, and integration boundaries. PR #25 addresses cross-process contention coverage; PR #26 adds a host-injected observation-verifier boundary; PR #27 exposes canonical local work receipts in TownSquare.
- The private linked repository `ngl-damien/Damien-Featherstone` was not modified.

## Stutter-step A — inspect and rank

1. **Highest leverage:** provide a separately invoked, offline Founder signing workflow that signs the exact validated INSTALL decision without putting the private key into the proposal handler.
2. **Next:** resolve PR #26's real trust-root and integration boundary; its test callbacks are not production identity or an external observer.
3. **Next:** retain PR #25's cross-process contention regression and separately address crash/stale-lock recovery.
4. **Next:** review PR #27's user-facing work receipts and exact-head CI. Do not merge any PR without Damien's authorization.

## Stutter-step B — challenge the priority against fresh source

Re-read `experiment-001/institutional-cycle.mjs`, its tests, `package.json`, `scripts/verify.mjs`, current PR metadata, and the existing checkpoint. The current source already exports canonical `approvalPayload`, `proposalDigest`, `publicKeyFingerprint`, and `validateInstallationProposal`; no approval CLI existed. The runtime requires a startup fingerprint and detached signature, while `experiment-001/INSTITUTIONAL-CYCLE.md` explicitly says no separate signer or real Founder key is included. This made an offline signer the most direct independent capability addition. The initial implementation would have signed immediately on invocation; a second inspection caught that missing explicit review boundary, so it was replaced before PR creation.

## Stutter-step C — implementation on safe branch

Branch: `codex/founder-offline-approval-cli-20261025`, created from the observed `main` SHA above. No main-branch writes.

- `da2fad58d6533d7b80e327f448bf5ff6264b7ad2` — require a separate `--inspect` step and full proposal-digest confirmation before signing. Bound input reads; reject non-regular/oversized files, malformed or expired proposals, non-Ed25519 keys, absent/mismatched trust pin, and group/world-readable private-key files on POSIX.
- `bd6b5d56d46f6713acc260a8cab755a16ae98407` — add regression coverage for review-only output, detached signature verification, altered-payload rejection, explicit digest mismatch, wrong fingerprint, expired proposal, and unsafe POSIX key permissions.
- `7408011c8c6ff70983669cc6bd0c6f609164a673` — document the two-step workflow and its limits in `experiment-001/FOUNDER-APPROVAL.md`.

Current acceptance status at this checkpoint: **implementation and tests are committed to the feature branch; exact-head CI is pending.** No local execution is claimed. GitHub Actions must establish the result before this is called verified.

## Security and evidence limits

- The CLI only produces a detached signature; it does not commit to the ledger, install a capability, deploy code, or award XP.
- The digest-confirmation step reduces accidental signing and binds the signature to the exact proposal, but is not proof a human reviewed it. A caller with CLI access can supply the digest.
- Tests use ephemeral keys. No real Founder key, real approval, or human identity proof exists. A file-based signer is not hardware-backed key custody; a compromised host or malicious checkout can still expose the key. Review and pin signer code before any real key use.
- `src/world/project.js` on `main` still trusts event-supplied `observation_verification: "VERIFIED"` plus byte receipts; PR #26 proposes the missing host verifier boundary. Its allowlists are test stubs, and its Ed25519 adapter is not wired into `game/server.mjs`. Do not treat the test boundary as production verification.
- `game/server.mjs`'s current institution view describes its observer as a distinct local process identity, not an independent human or AI. The byte receipt proves preserved bytes, not truth or usefulness.
- `experiment-001/institutional-cycle.mjs` derives implementation hashes from `Function.toString()` and revalidates historical INSTALL proofs against current code. Upgrade compatibility remains a source-derived risk, not a reproduced failure.

## Next prioritized steps

1. Open a draft PR for this branch and inspect the exact-head `verify` and `Genesis Evidence Invariant` runs; fix any failures and re-check after every change.
2. If green, refresh this checkpoint with the exact final head and run IDs; keep the PR draft pending founder review.
3. Establish genuinely separate, operator-controlled signing custody (prefer hardware-backed signer or isolated signing service) and provision its public-key fingerprint independently. Do not use a real key in CI.
4. Reassess PR #26 integration against the actual runtime and prevent canonical world/quest consequences without an externally controlled observer trust root.
5. Define and exercise crash-safe lock/ledger recovery; preserve `COMMIT_DURABILITY_UNCERTAIN` semantics.
6. Design a backward-compatible versioned capability identity / ledger migration policy before changing the `Function.toString()` hash scheme.
