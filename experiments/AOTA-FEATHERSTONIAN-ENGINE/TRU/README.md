# T.R.U. — Temporal Reconnaissance Unit / Evidence Workbench

A dependency-free JavaScript tool for inspecting temporal claims, pinned source lineage and reported incumbent/candidate results. The browser stages **unauthorized local proposals**. It does not authenticate witnesses or operate the Founder Gate.

## Run and import

Use Node 24+ from this directory:

```sh
node --test test.mjs
python -m http.server 8765 --bind 127.0.0.1
```

The Python command serves the browser entry point, `index.html`, over local HTTP. Python is needed only for that static server; no package installation, external API or provider account is required. Stop the server when finished.

Use **Import JSON** to select `examples/real-lineage.case.json`. It reconstructs source history from pinned Git commits `facee282ae0c0a56031e7bf00a038eac3ebe4926`, `cab8dfb0d6ae41626db8010ae300210ccd0ca7a2` and `a9d4389fa9c3431c561311399980d6504f7b530a`. Each source reference includes its repository path, Git blob identifier, byte length and raw-blob SHA-256. Event times are Git committer timestamps. The browser does not fetch, authenticate or rerun those sources. Imported evidence is UNVERIFIED, evaluation outcomes are UNKNOWN, and the case supplies no operational deadline.

Reset restores the original authored example. Its 2041 activation remains **fictional future history**. It is compatible with the stricter schema, but its undeclared workload and different reported test names intentionally produce comparison errors.

## Case and comparison contract

`tru.case.v1` requires a bounded `caseId`, a nonempty rollback description, and `events`, `evidence` and `candidates` arrays. Identifiers use 1–80 ASCII letters, digits or `._:-`; event, evidence and candidate IDs are globally unique. A case permits at most 500 events, 500 evidence entries and 30 candidates. Candidate roles are INCUMBENT or CANDIDATE, with at most one incumbent. An absent incumbent is an assessment ERROR.

Candidate `evidenceIds` must be a unique array of evidence identifiers; events may also carry this array. Unknown references remain inspectable assessment ERRORs. A referenced event/candidate ID cannot stand in for an evidence ID. Names, descriptions, timestamps, assurance values and SHA-256 fields are type checked. Text fields and extension metadata are bounded; the kernel also limits nesting, node count and total text. The browser rejects files larger than 1 MB. Rollback must describe a proposed recovery action; it never runs automatically.

A comparable evaluation requires the same explicit `workloadId` and the same nonempty set of test identities on incumbent and candidate. A test identity includes its optional `id` and its `name`. Legacy name-only rows remain readable. Duplicate IDs or names are rejected. Missing workloads, unequal test identities, or missing references produce ERROR flags; matching pass counts do not repair them. Imported workload declarations and PASS/FAIL/UNKNOWN outcomes are still claims, not verified executions.

Canonical JSON sorts object keys by UTF-16 code units, including integer-like keys; arrays retain their order. SHA-256 fingerprints bind the resulting local bytes, not authenticity. Timeline ties sort by event identifier. Digest-reuse detection normalizes hexadecimal casing.

## Local outputs and limits

- Export a case or an assessment with a case fingerprint.
- Inspect reported PASS/FAIL/UNKNOWN counts, comparable workload status and evidence references.
- Enter a proposed UTC review time and stage a packet in `tru.founder-decision-packet.v1`. The time is user input, not an enforced Founder deadline.
- Imported INDEPENDENT and AUTHENTICATED assurance values are explicitly untrusted labels. Verified independent witness counts remain zero. With no trusted authentication path, this tool never produces a REVIEW/REVIEWABLE result; packets carry `reviewable: false`.
- Reset, deadline edits and import attempts clear the visible packet and disable its download. Revision guards discard stale asynchronous imports, renders, assessments and packet hashes. Failed imports retain and repaint the previous valid case.

A packet may preserve ERROR flags to support inspection, but it cannot be a reviewable authorization record. A recorded failure can justify a local REJECT recommendation; an imported label cannot establish authenticated independent evidence. No local hash, source reference, role name, assertion or packet grants XP, authority, approval or a state transition.

The required live Founder Gate remains a separate institutional milestone: verified remotely reachable HTTPS, authenticated Founder controls, an actual pending time-sensitive decision, server validation, durable audit history and independently reproducible evidence. This static workbench does not satisfy that milestone. No real time travel, external AI participation, external Witness adoption or public deployment is claimed.

## Validation

The focused Node suite contains the unchanged 14 original tests plus regressions for malformed data, workload/test identity mismatches, label trust, deterministic hashing, browser-handler races and the importable pinned-lineage case. Run the command above on the delivered files. Browser-handler tests execute the actual inline module through a minimal DOM adapter with controllable SHA promises; they complement actual Chromium checks, not physical-device or cross-engine validation.

See `docs/institution/compounding/task-b.md` in the repository for the observed RED/GREEN results, source-byte receipts, actual Chromium checks and remaining limits. Component packaging and cross-task transfer evaluation belong to the parent experiment and are not established by these component tests.
