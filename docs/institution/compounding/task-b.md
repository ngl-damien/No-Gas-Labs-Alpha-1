# Task B — T.R.U. temporal evidence workbench

Task B repairs a real bounded NGL tool: inspect temporal/source history and compare reported candidate results without turning labels into authority. Its acceptance profile was frozen in commit `137c9c7` before new machinery implementation. This worker read the revised institutional thesis, the frozen profile and T.R.U. source; it did not read the component exporter implementation, the machinery worker's results or external providers. It changed only the five declared T.R.U. profile files and this report. No commit, push, promotion or deployment was performed by this worker.

## Behavior delivered

The case validator now checks case IDs, candidate roles and baseline uniqueness, bounded text and metadata, strict timestamp/digest types, unique evidence-reference arrays and nonempty rollback. Unknown candidate/event references to evidence remain visible ERROR flags so broken cases can be inspected. A referenced non-evidence ID does not satisfy the reference.

Comparisons require a declared shared workload and identical nonempty test identities. Equal pass totals across different tests cannot establish comparability; duplicate test IDs/names cannot inflate totals. Imported INDEPENDENT/AUTHENTICATED assurance never increments verified witness counts, establishes REVIEWABLE confidence or yields REVIEW. Packets remain explicitly unauthorized, unauthenticated and `reviewable: false`, including packets that retain structural ERROR flags for inspection.

Canonical JSON uses code-unit key ordering, including integer-like keys; local SHA-256 does not certify execution. Equal-time events sort deterministically by ID, and equivalent uppercase/lowercase digest encodings trigger reuse warnings. Imported assurance values appear as imported labels in the manifest.

The browser clears output and disables packet download on reset, deadline changes and import attempts, including failed imports. It captures immutable snapshots and uses revision guards across hashing/file-read awaits so older work cannot repaint or enable a stale packet. Failed imports repaint retained current state after cancelling earlier renders. This also keeps an assessment fingerprint paired with its own assessment.

## Observed verification

All commands ran locally on 2026-10-18, with no additional dependencies or provider calls.

- Baseline: `node --test experiments/AOTA-FEATHERSTONIAN-ENGINE/TRU/test.mjs` executed the original **14/14 passing** cases.
- Kernel RED run: **29 tests, 14 passing, 15 failing**. Failures covered case ID, roles, reference arrays and missing event references, bounded/type-checked text, rollback, imported assurance, unequal test/workload identity, duplicate tests, ERROR-blocked reviewability, locale ordering, tied-event ordering, digest casing and metadata limits. Raw output: `/tmp/tru-task-b-red.txt`.
- Browser-handler RED run after kernel fixes: **36 tests, 29 passing, 7 failing**. The failures were stale visible output after import, deadline edit, reset during second packet hash, failed import, overlapping file reads, mixed assessment revisions and an older render repainting a newer case. Raw output: `/tmp/tru-task-b-ui-red.txt`.
- Focused later RED cases caught integer-like canonical key ordering, undeclared equal workloads, and a failed import cancelling a reset render without repainting retained state. Each was reproduced before its fix. The retained-state regression output is `/tmp/tru-task-b-retained-red.txt`.
- Lineage example RED check failed because the required example did not yet exist. After generation from actual pinned Git blobs, the import and untrusted-history assertions passed.
- Final focused Node run: **40/40 passing, zero failed/skipped/cancelled**. The 14 original tests remain unchanged; no original expectation was weakened. Raw output: `/tmp/tru-task-b-green.txt`. The added tests include a minimal DOM adapter running the actual inline browser handlers, with controllable SHA promises to reproduce races.
- Actual Python Playwright with `/usr/bin/chromium` **154.0.8037.57**: **13/13 checks passed**, zero page JavaScript errors. A worker-owned temporary HTTP server served exact T.R.U. source and was stopped afterward. Desktop checks exercised original fictional content, real-lineage import/no deadline, zero authenticated witnesses, synthetic-time packet staging, downloaded packet equality, assessment/case fingerprint binding, deadline/import/failed-import invalidation, and reset while actual WebCrypto hashing was held. A separate 390px touch-capable browser context imported the case without horizontal overflow. Evidence: `/tmp/tru-task-b-browser.py`, `/tmp/tru-task-b-browser.json`, `/tmp/tru-task-b-browser.png`.

The browser harness initially failed while restoring its monkeypatched WebCrypto function because Playwright tried to invoke an expression-returned function; the harness was corrected and rerun. This was a probe error, not an application pass or a hidden skipped check. No full repository suite ran in this worker; parent integration owns cross-component checks and packaging evaluation.

## Pinned lineage artifact

`experiments/AOTA-FEATHERSTONIAN-ENGINE/TRU/examples/real-lineage.case.json` is an importable untrusted source-history case. The following raw bytes were retrieved with `git show <commit>:<path>` and independently hashed with Python SHA-256 while authoring the case:

| Commit / Git committer timestamp | Source / Git blob ID | Bytes / SHA-256 |
| --- | --- | --- |
| `facee282ae0c0a56031e7bf00a038eac3ebe4926` / `2026-10-08T17:51:51-05:00` | `README.md` / `72e8702f1306652e42fb4af94f18236e6d3ef43e` | 1403 / `ecfd3a1a322b54f4fbc8dff3a2b969a71875886bc04401357b2350ade88f529e` |
| `cab8dfb0d6ae41626db8010ae300210ccd0ca7a2` / `2026-10-17T23:56:00Z` | `docs/meteor/REPORT.md` / `ff4d770b80b9b277d3c60d29fc8fb424dce09a72` | 9697 / `1f8392600c0c4d8cd3fd0c90c7496618009674685079f1daadf01f125fad214e` |
| `a9d4389fa9c3431c561311399980d6504f7b530a` / `2026-10-18T01:39:25-05:00` | `experiments/AOTA-FEATHERSTONIAN-ENGINE/ALPHA1-INSTITUTIONAL-THESIS.md` / `704866f4a08ce05572f95f5aafea4abd95626728` | 9762 / `6ce32dbac55b2fc25215bab6add49d8b55aba5a75913e483c220db6ea71ca7a7` |

The case's REPORTED events use the corresponding Git committer times, not authenticated observation times. All three source artifacts carry UNVERIFIED assurance. Its frozen shared workload contains only UNKNOWN outcomes; it claims no fresh reproduction of the historical Meteor report, signatures, independent Witnesses or Founder deadline. The browser does not fetch or verify Git blobs; source references enable later reproduction by a reviewer. The original 2041 fictional example remains intact and is still explicitly bounded as fiction.

## Closure and limits

The workbench is created and locally tested. Packaging acceptance, fresh extraction and the held-out M0/M1 comparison remain the parent's independent work; this worker makes no transfer-success or burden-reduction claim. Local browser checks are not public hosting, remote HTTPS reachability, physical-phone validation or a live Gate. There is no trusted witness authentication path, provider enrollment, operational deadline enforcement, deployment action or source promotion here. Unknown/unequal workloads and imported claims remain uncertainty, even when their JSON and hashes are well formed.

The observed environment already supplied Node, Python, Playwright and Chromium; this scoped development workflow required no dependency or reusable environment-configuration changes.
