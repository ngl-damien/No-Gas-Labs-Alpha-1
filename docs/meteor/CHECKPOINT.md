# Meteor continuation checkpoint

Mission remains active: complete the Meteor Commission, including the playable world and one-button Caveman Launchpad. Founder: Damien Featherstone. Branch `meteor/2026-10-17`. Starting baseline `facee282ae0c0a56031e7bf00a038eac3ebe4926` had59 passing tests. Core mechanisms are committed at `dcfd734`; contracts/baseline at `9c115e8`. The commit containing this checkpoint preserves the remaining integration work as work in progress, not as fully verified completion.

## What survived and what ran

- `src/institution/{kernel,ledger,courier}.mjs`, `src/forge/runner.mjs`, actual CLI fixtures, tests and independent review are committed. Review found and owners fixed receipt rebinding, stale-lock lost writes, symlink output containment and child-verifier assertion tampering. See `REVIEW.md`.
- Game/server/launch/packaging/source are present under `game/`, `scripts/` and new tests. Six original comic JPEGs were recovered unchanged; private archive key material was not opened or imported. See `ASSET_PROVENANCE.md`.
- Earlier integrated `npm run verify` passed142 tests, built the package, executed a signed local courier fixture, actual correct/wrong/timeout candidates,124 tests in an isolated copied repository, and a five-stage report-byte preservation. Raw run `.runtime/verification-vGeY02`; this is historical evidence for that tree, not the final changed tree.
- `WEB_REVIEW.md` closes six targeted source/package issues with actual Chromium probes: network-denying private previews and nested exhibition, demotion DOM privacy, quota-failed import retains shared SSE, runtime JSON exclusion, extracted Forge demo and source-save comic transfer. These do not replace the remaining root browser acceptance.
- Saved cloud startup instructions now describe the new workflow and preserve older notes as historical. Draft save succeeded; environment publication/fresh-task restoration were not performed.

## Exact pending blocker

`python3 scripts/verify-browser.py --standalone` intermittently loses the first Play click when moving rapidly from comic preview/publication into Loom preview, on phone and occasionally desktop. The score input handler runs, but the click lands on the outer iframe owner rather than entering the child; no AudioContext starts. A later retry works. There was also old route arrival stealing modal focus; renderer now cancels/pause routes while a modal is open.

Current `game/client.mjs` creates a fresh iframe per opening and gates pointer interaction on load plus two animation frames. This last candidate fix was written before a worker hit its usage limit; it still needs the unchanged fast browser journey, a real touch check, and a modal-route regression. Do not relax the `Playing 8 Unicode notes.` assertion or hide the problem with arbitrary sleeps. Inspect actual trusted events/frame lifecycle. Preserve the opaque sandbox and trusted CSP; no unsafe-eval/same-origin permission.

## Resume actions

1. Read current Git status and this file. Existing checkout is isolated; preserve source and historical artifacts.
2. Finish/review the frame lifecycle fix. Run unchanged `basic()` from `scripts/verify-browser.py` repeatedly at390px and desktop, plus actual touch. Then run the complete browser command with `--standalone`.
3. Direct `file://` navigation is blocked by managed Chromium administrator policy. Do not bypass it. Script separately tests exact packaged bytes over disposable HTTP with no added CSP; report direct-file check BLOCKED, not passed.
4. Run `npm run verify` on the final tree. Read actual test counts and outcomes. It exercises the full suite, distribution, actual local institutional mechanisms and copied repository tests. Inspect `.runtime/verification-*/report.json` plus raw logs. No external AI provider is configured or called.
5. Once source is stable, run `node scripts/measure-forge.mjs`. It compares identical source bytes across two alternating sequential/parallel trials; if source changes, it intentionally refuses comparison. No human baseline or3600× claim.
6. Run `node scripts/preserve-evidence.mjs <verification-dir> <browser-dir> <throughput.json>` to archive successful local evidence, then write `docs/meteor/REPORT.md`, complete `PERFORMANCE.md`, rebuild and independently verify/extract the ZIP. Verify excluded runtime/private files and per-file hashes.
7. Commit verified integration and evidence. Keep the branch; no remote push/merge/public deployment has been authorized or done. Provide `dist/play.html`, `dist/exhibition.html`, sourceZIP, exact commit IDs, evidence and limitations.

## Scope and authority

Do not reduce the institution to the RPG or a provenance demo. The kernel/courier/Forge are independently executable mechanisms. The world is their institutional interface and a working digital-production surface. Local process roles/fixture signatures do not establish independent humans or25 external Council seats. Game XP grants no institutional authority. Public hosting and live provider enrollment remain separate Founder decisions.

No scheduling tool was exposed when capabilities were inventoried; no automatic five-hour Codex continuation is claimed. The user has now explicitly resumed work. Native background processes must never be presented as a scheduled future model turn.
