# Recovery and continuity

The constitution and original source remain in Git. The Meteor Commission uses a separate branch, `meteor/2026-10-17`; no remote push, merge, public deployment or paid account is performed by the build. Prior uncommitted RPG files were absent after environment restoration, so this build commits reviewed source and supplies a portable archive rather than relying on chat memory.

## Reproduce from source

Use Node24 or newer. No runtime dependency install is required. In the repository or extracted public-source ZIP:

```sh
npm run verify
npm start
```

The verification pipeline writes actual command output and timing under `.runtime/verification-*`. It executes the complete Node suite, creates the distribution, exchanges signed receipts with a real local fixture worker, runs correct/wrong/nonterminating candidates, runs copied repository tests, and records a five-stage exact-report-byte preservation event. It does not call an external AI provider or public service. The copied repository workload omits the Forge's own tests to avoid recursive workspace copying; the main suite includes them.

`npm run build` produces `dist/play.html`, `dist/exhibition.html`, generated technical launch checks, a standard ZIP source distribution, and a per-file size/SHA-256 manifest. ZIP contains public application source, tests, fixture programs, original comic images and the standalone game/exhibition. It excludes runtime directories, credential paths, repository metadata, recovery archives and general JSON state files. It does not include the Founder's runtime key or shared world. A hash proves byte identity, not trust or truth.

Gitless extracted source uses Forge's bounded public-source snapshot mode and records `head:null`; a corrupt existing `.git` remains an error. Historical repository artifacts stay in the actual repository rather than being silently deleted or included in a public release.

## Preserve a private workshop

Use Journal → Export world JSON before clearing browser data, moving devices or changing browser policies. Private exports include the complete private world and the character's last map coordinates. The game keeps the immediately previous private save as a backup. Journal → Import validates schema, exact current and retained artifact bytes, version structure, defined game rewards and any included map coordinates, then opens the save privately. It cannot grant shared authority. A failed import leaves the shared mode and stream intact. Source-generated comic documents retain their original bytes; standalone presentation can resolve their known image paths from the embedded artwork.

Private imports may contain code. They execute only inside opaque sandbox frames with a host-supplied network-denying policy. Receipt verification alone does not make imported content useful or its claims true. The launch exhibition retains original receipts and separately identifies transformed portable-package bytes.

## Preserve and recover the shared institution

Stop only the service you own before copying its configured `NGL_DATA_DIR`. Preserve `service.json` privately; it contains world history, private drafts, kernel events, exact published artifact blobs and bindings. The service replays and validates those bindings on startup. Retain the private Founder key separately in secure operator storage; never include it in public exhibitions or source packages. The default key is `.runtime/founder.key`; no tool should print it. A new key can secure a restored world without changing its accepted historical records.

The service holds `.service.lock`, the kernel ledger holds `.writer.lock`, and the courier uses `.courier.lock`. A stale lock fails closed. Confirm every process using that exact store is stopped, preserve the store and lock for diagnosis, then remove only that specific stale lock under operator control. Never race multiple automatic recovery attempts or delete an active writer's lock. Restart and validate before writing again. The service and institutional ledger synchronize the temporary envelope before rename and the containing directory afterward. If directory synchronization fails after rename, the operation returns `COMMIT_DURABILITY_UNCERTAIN`, keeps the live in-memory projection unchanged, and blocks later writes until a validated reopen. The replacement may already be visible on disk; do not roll it back or assume either state is crash-durable until reopen validates the complete envelope. Shared action retries are separate: the Field Journal can resend the exact locally retained request ID and action, and the server returns the original result if the event committed. Do not create a new request ID for an uncertain action or automatically replay pending writes after reload.

These local stores trust the operating-system owner. Retained chain heads/checksums expose mismatches relative to trusted evidence; they do not prevent an owner rewriting the complete store and recomputing all hashes or rolling it back. External anchoring and independently authenticated observations remain future work.

## Restore a cloud environment

Use the existing checkout; do not create a worktree merely for onboarding. Inspect Git status and instructions before touching files. Start processes again in each task; they do not survive environment publication. Local commits, saved startup instructions, a published environment snapshot and a successful fresh-task restoration are distinct events. This commission supplies reviewable local commits and source artifacts; fresh-task restoration is not claimed until actually tested.

Earlier instructions named `/workspace/Damien-Featherstone` and scratch smoke helpers. Those paths are historical and were absent in this instance; do not assume they exist or replace the verified Alpha1 workflow with that earlier application.
