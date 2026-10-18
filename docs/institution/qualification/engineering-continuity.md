# Engineering and continuity qualification

Internal AI assessment under [FOUNDER-DIRECTIVE-001](FOUNDER-DIRECTIVE-001.md), 2026-10-18. The examined baseline is `3d8485a7a5bf592dbc30d64691848f63e54b2211`. This report does not certify professional adequacy, independent human review, human independence, fresh-cloud restoration, or launch readiness.

The public source archive executes, and present-but-corrupt durable files fail closed. The baseline silently replaced missing durable history; the independently tested inventory-guard candidate now contains that omission. A follow-on first-start configuration defect was discovered and then contained by the parent repair. The recovery diagnostic still accepts non-actionable continuity shapes, and generated exhibition metadata prevents byte-identical distribution rebuilds. These bounded repairs do not establish disaster recovery or all-domain qualification.

## Inventory and tested claims

| Implementation | Strongest supported capability | Critical dependency or assumption |
| --- | --- | --- |
| `scripts/recover-institution.mjs:7` | A separate Node process verifies declared repository-file SHA-256 values and prints retained work/authority context. | This is a static continuity-record check, not restoration of runtime data, source history, or a cloud environment. Record content is locally supplied and unauthenticated. |
| `scripts/build-game.mjs:14` | Builds portable game/exhibition and an allowlisted source ZIP with a per-member manifest. | Source delivery intentionally excludes runtime state and Founder credentials; private institutional recovery requires separate complete backups. |
| `game/service-store.mjs:9` | One writer, envelope integrity, schema/history validation through the server, file fsync and atomic replacement of world/kernel/artifact state. | Missing `service.json` means initialize; no aggregate institution inventory distinguishes accidental omission from first startup. Parent-directory fsync is absent here. |
| `src/institution/decisions.mjs:172` | Separate durable policy/disposition history, replay, exclusive writer, redaction, file and directory fsync, uncertainty fencing. | Missing `decisions.json` means initialize; storage owner/clock and complete backup remain trusted. |
| `game/server.mjs:149` | Starts both stores and uses authenticated sessions for ordinary Founder operations. | Both stores must open to start the server. Corrupt decisions prevent the public server from starting; this contains uncertain authority at an availability cost. |
| `docs/meteor/RECOVERY.md:28` | Describes stopping the owned service, copying its data directory, retaining `service.json` and separating the private key. | Does not enumerate the new `decisions/decisions.json` and `.decisions.lock` alongside older store/lock names. Full-directory copying is mentioned, so omission is a documentation gap, not an instruction to discard decisions. |

No credential files or live/private runtime directories were read. All HTTP operations used a literal `EXPLICITLY_FAKE_QUALIFICATION_FOUNDER_KEY` and disposable data. The harness archived the tracked baseline with `git archive`, built into temporary directories, extracted its actual ZIP, ran checks, and deleted its temporary tree. It did not alter production code, commit, deploy, spend, contact external providers, or change Founder authority.

## Requirements and professional basis

These are explicit acceptance criteria for the intended continuity/source-delivery use. Named public references explain their design basis; no external audit, exhaustive compliance review, or newly browsed interpretation is claimed.

| Requirement | Acceptance criterion and design basis | Result |
| --- | --- | --- |
| ENG-R1 complete recovery | A previously initialized institution must detect an omitted required store before exposing replacement history as successful startup. Reopening a complete stopped-store copy must preserve both histories. This operationalizes backup completeness and recovery testing in NIST SP 800-53 Rev. 5 controls CP-9, CP-10 and CP-4 ([publication](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)). It does not require a particular storage product. | FAIL omission; PASS complete-copy control. |
| ENG-R2 actionable continuity | A successful continuity result must validate nonempty actionable assignment/authority/rollback text and the declared machinery/decision structures, or explicitly confine success to reference integrity. JSON truthiness is insufficient. JSON Schema's `type`, `required` and collection constraints provide a concrete validation model ([2020-12 validation specification](https://json-schema.org/draft/2020-12/json-schema-validation)); no schema library is mandated. | FAIL malformed shapes. |
| ENG-R3 reproducible release | A byte-reproducible distribution must either control clock/ID inputs or preserve them as declared rebuild inputs. Independent same-input builds must produce identical intended release bytes, following the [Reproducible Builds definition](https://reproducible-builds.org/docs/definition/). This is a proposed qualification requirement for reproducible release verification, not an existing deterministic-build promise. | FAIL whole ZIP; static source and original artifact bytes stable. |
| ENG-R4 source execution | Delivered source must include the code/data required for the advertised local tests and continuity entrypoint, and member sizes/hashes must match delivered bytes. This follows directly from an executable distribution claim: checking the producer tree alone cannot establish consumer execution. | PASS 168-member distribution, zero manifest mismatches, recovery, 238 Node tests and 47 Python tests. |
| ENG-R5 corrupt state containment | Present inconsistent durable state must be rejected rather than silently regenerated; failures must remain inspectable and complete backups must enable recovery. This follows from integrity and recovery objectives underlying CP-9/CP-10. | PASS tested world-digest and decision-JSON corruption. Power-loss durability remains untested. |

## Evidence and reproduction

Run from the repository with Node 24+, Python 3 and Git/tar available:

```sh
node scripts/qualification/engineering-continuity.mjs \
  3d8485a7a5bf592dbc30d64691848f63e54b2211 \
  /tmp/engineering-continuity-repeat.json
```

The default output is [evidence/engineering-continuity.json](evidence/engineering-continuity.json). The source tar SHA-256 is `f954eb3acf450c9239f996468afadcc8715241b61c2078a89e80df8659f75592`; the receipt also retains the harness hash, runtime version, commands, exits, real test output, malformed input, before/after history counts, build hashes and changed members. Harness exit zero means the experiment executed; `qualificationPassed:false` records the open findings. A negative probe accepted by the application is a reproduced finding, not a passing requirement.

| Probe | Observed result |
| --- | --- |
| Q-ENG-P01 | Canonical continuity recovery exit 0; 11 focused continuity/package/HTTP-decision tests passed. |
| Q-ENG-P02 | Malformed but truthy continuity fields accepted, exit 0, `passed:true`. |
| Q-ENG-P03 | Changed declared reference digest rejected, exit 1. |
| Q-ENG-P04 | Two builds of the exact source differ in `exhibition.html`, `launch-checks.json`, and `manifest.json`; no manifest-member hash mismatch. |
| Q-ENG-P05 | Actual ZIP extraction: recovery exit 0; 238/238 Node and 47/47 Python tests passed, none skipped in reported counts. This refutes the tested source-omission concern for these targets. |
| Q-ENG-P06 | Populated stopped-copy missing decisions: startup succeeds; world revision 2/one published creation remains; decision revision 3/one REJECTED decision becomes revision 0/no decisions. Replacement file written. |
| Q-ENG-P07 | Populated stopped-copy missing world: startup succeeds; world revision 2/one published creation becomes revision 0/no creations; REJECTED decision remains. Replacement file written. |
| Q-ENG-P08/P10 | Present corrupt decisions JSON and inconsistent world digest each reject startup. |
| Q-ENG-P09 | Complete stopped-store same-host copy preserves world revision 2/one creation and decision revision 3/REJECTED. |

The first exploratory draft fixture used an unsupported recipe, so that attempt did not establish populated-world recovery. The retained harness corrects the fixture to `custom`, publishes it, rejects every unexpected HTTP status, and asserts the populated preconditions before omission. Only the corrected run supports Q-ENG-P07.

## Q-ENG-001 — Omitted durable store silently replaces history

**Classification:** REPRODUCED. **Severity:** HIGH for institutional continuity. **Affected disciplines:** software reliability, backup/recovery, governance evidence preservation. **Requirement:** ENG-R1.

**Claim tested:** Startup of an existing institution detects incomplete durable state before presenting a usable reconstructed institution. **Assumption falsified:** A missing world/decision envelope reliably indicates a genuinely new instance. In reality both initialization paths treat ENOENT as permission to create initial state. `game/service-store.mjs:31` initializes world state; `src/institution/decisions.mjs:191` onward initializes the independent decision store. `game/server.mjs:149` opens both without a shared store inventory or identity.

**Reproduction:** Q-ENG-P06/P07 perform real fake-key HTTP actions to create one published artifact, set a test policy, and record an explicit REJECT disposition. They stop the server, copy only their own disposable directory, delete exactly one copied envelope, and restart. Each omitted history disappears without startup failure. The unaffected history and complete-copy control isolate missing inventory detection from corruption, bad authentication, incomplete writes, or absent source. This is not an external authorization exploit, and no real decision was removed.

**Impact and triggering conditions:** An incomplete backup, selective restore or accidental deletion can lose either accepted artifact history or Founder decisions while the service appears healthy. The copy from which state was removed remains evidence; the restarted copy creates new initial bytes and can obscure the cause if operators keep writing. A complete malicious rewrite by the filesystem owner is outside this experiment. Starting from a wholly empty directory intentionally creates a new institution; that behavior alone is not the finding.

**Detectability:** Existing digest/replay checks detect present corruption but do not detect absence. A separately retained expected institution ID, required-file inventory, revisions and trusted heads could expose the loss. Operators can currently notice count/history changes only if they retained expectations externally.

**Recovery:** Stop the affected writer; preserve the incomplete directory, generated replacements and logs; compare with a trusted complete stopped backup; restore both envelopes together and validate histories before resuming. Without another copy, deleted decisions/artifact bytes cannot be reconstructed from hashes or chat assertions. Do not erase evidence by silently calling the replacement instance recovered.

**Competing repairs:**

1. Add an aggregate institution identity and required-store catalog, initialized explicitly; ordinary reopen refuses any missing member. Preserve existing-store migration through an explicit operator procedure. This is smaller than merging ledgers, retains modular stores, and makes partial restore detectable; catalog/member bootstrap and catalog loss require tests.
2. Put world and decisions in one versioned transactional envelope, or restore through an authenticated complete backup manifest that verifies all required member bytes before service startup. One envelope improves consistency but increases migration/coupling cost; a backup manifest alone needs ordinary startup enforcement to catch later deletion.
3. Documentation-only enumeration of `service.json`, `decisions/decisions.json`, separate private key, expected histories and `.decisions.lock` improves operator recovery but does not satisfy automatic absence detection. This is supplementary containment, not a technical cure.

**Evaluation/disposition:** Alternatives compared by design reasoning; no repair implementation or comparative repair test was authorized to this worker. OPEN; parent integration agent selects reversible repair scope, and Founder retains consequential institutional disposition. Retain the immutable baseline finding after repair. Rollback of a future repair must preserve existing store formats/copies and must not normalize the lost history.

**Gates:** A = NOT ASSESSED: no repaired candidate evaluated. B = FAIL for complete-recovery use under ENG-R1. C = PARTIAL: present corruption is contained and complete-copy recovery works, but omitted histories are neither automatically detected nor recoverable without backup. No gate is inferred from passing tests elsewhere.

## Q-ENG-002 — Continuity diagnostic accepts unusable responsibility structures

**Classification:** REPRODUCED. **Severity:** MEDIUM diagnostic false-success. **Affected disciplines:** schema validation, operational continuity. **Requirement:** ENG-R2.

**Claim tested:** A `passed:true` continuity result contains actionable recovered assignments, authority, machinery, next action, rollback and Founder-decision state. **Assumption falsified:** Truthy presence validates those semantics. Q-ENG-P02 supplies `assignments:[null]`, boolean authority/nextAction/rollback/taskB/founderDecision and `{M0:true,M1:true}` with one genuine public `package.json` hash. `scripts/recover-institution.mjs:9` accepts the object and line 12 prints `passed:true`. Changed-reference control P03 is rejected, so the failure is semantic shape checking, not broken hashing.

**Impact/trigger:** A malformed locally supplied continuity record can pass automation yet leave the next operator without responsibility or a usable rollback. This entrypoint only prints a diagnostic; it neither restores service stores nor grants Founder authority. No impersonation/authentication bypass is claimed. The canonical retained STATE is well formed in the tested run.

**Detection/recovery:** Validate exact supported shapes, nonempty fields and operational prerequisites before consuming the output; retain the rejected record and restore the last well-formed version from tracked source. Human inspection detects obvious booleans/null but is an additional burden rather than a programmatic invariant.

**Competing repairs:** (1) Version the continuity schema and validate nested actionable fields and prerequisite/status consistency, retaining clear actionable errors. This preserves a broad recovery claim but incurs schema migration maintenance. (2) Narrow the diagnostic contract to `referenceIntegrityPassed` and explicitly mark all copied contextual fields unvalidated, with a separate strict semantic validator. This reduces misleading success without pretending generic hashes validate responsibilities; consumers must adopt the narrower result. Neither approach authenticates the state file.

**Evaluation/disposition/rollback:** Root cause and controls reproduced; alternatives evaluated by scope/cost reasoning only. OPEN for parent selection; no production change in this worker. Rollback keeps prior schema reader and durable record copies until consumers migrate. **Limits:** Exact language adequacy and real authority still need authenticated human/source evidence beyond shape validation.

**Gates:** A = NOT ASSESSED. B = FAIL for ENG-R2's actionable-continuity result; reference integrity alone passes its scoped control. C = PARTIAL: source history can restore the canonical record, but malformed accepted context is not automatically detected by the entrypoint.

## Q-ENG-003 — Generated exhibition inputs prevent byte-reproducible ZIPs

**Classification:** REPRODUCED reproducibility limitation. **Severity:** LOW; no functional defect or advertised deterministic-build promise established. **Affected disciplines:** build reproducibility, release verification. **Requirement:** ENG-R3 when byte-reproducible releases are claimed or required.

**Claim tested:** Same source, runtime and declared build inputs produce the same distribution bytes. **Assumption falsified:** Source-only manifest integrity implies reproducible rebuild identity. Q-ENG-P04 calls the actual builder twice against the same frozen source. Only exhibition HTML, generated launch checks, and the derived manifest differ. `scripts/build-exhibit.mjs:14` creates fresh world/action IDs and the live clock flows into launch report metadata. Receipt evidence contains both generated summaries: creation IDs/timestamps differ while original and portable artifact hashes match.

**Impact/trigger:** Two benign builds cannot be compared by ZIP digest to identify unexpected release changes. Hashes still verify each generated member, and the extracted distribution's tests pass; nondeterminism does not demonstrate tampering, truth failure, or missing functionality. Timing/UUID inputs are implicit instead of rebuild inputs.

**Detection/recovery:** Compare per-member manifests and generated provenance rather than assuming equal source means equal ZIP. Preserve the released ZIP and its manifest for exact recovery. Rebuilding from source recovers executable functionality in the tested environment but does not recreate the same entire archive bytes.

**Competing repairs:** (1) Build a deterministic fixture exhibition with an explicit stable clock/identifier source limited to build mode; test repeated ZIP equality without weakening runtime IDs. (2) Separate variable launch rehearsal receipts from the reproducible source archive, explicitly preserve generated input/output provenance, and verify deterministic source members separately. The second preserves real observation times but changes artifact packaging and claim scope. Neither was implemented/evaluated as a candidate here.

**Disposition/rollback/limits:** OPEN reproducibility limitation for parent release-policy selection, not a standalone public-exposure blocker. Preserve existing ZIPs before any packaging change; no content or history is overwritten. No cross-platform, independent host, toolchain perturbation, power-loss or browser portability experiment was executed.

**Gates:** A = NOT ASSESSED. B = FAIL only for a byte-reproducible whole-release requirement; PASS observed member integrity/execution. C = PARTIAL: difference is detectable via manifests and exact retained ZIPs are recoverable; independent same-byte reconstruction remains unestablished.

## Qualification boundary

The source-delivery and ordinary complete-copy controls support bounded local development/examination. They do not establish durable disaster recovery. Parent integration must preserve this dossier and receipt in its final evidence index/continuity reference inventory; the frozen compounding STATE and existing public-source export do not automatically discover this new qualification directory.

Store completeness needs hardening or explicit operational containment before relying on unattended recovery of a consequential institution. The shared store's missing parent-directory fsync, hard-crash/stale-lock recovery, independent backup retention, trusted-head rollback detection, complete media loss and provider/environment migration remain untested here. The decision service's directory fsync and uncertain-writer fencing demonstrate a stronger local pattern, but code inspection is not evidence of power-loss survival. Absence of independent human specialist review prevents a certification claim even after selected local repairs pass.

## Independent internal repair evaluation — Q-ENG-001

After the baseline receipt was frozen, the parent integration agent selected the inventory-anchor alternative and added `game/runtime-layout.mjs`, called before opening stores. This worker reviewed that separate implementation and executed the same populated-store omission/copy/corruption probes against a disposable baseline archive overlaid with exactly four public candidate files. [engineering-continuity-after.json](evidence/engineering-continuity-after.json) records SHA-256 values for `game/server.mjs`, `game/runtime-layout.mjs`, `scripts/build-game.mjs`, and `test/runtime-layout.test.mjs`. Each matched the corresponding working file immediately after execution; no claim is made about concurrently edited unrelated files or the eventual final tree.

```sh
node scripts/qualification/engineering-continuity.mjs \
  3d8485a7a5bf592dbc30d64691848f63e54b2211 \
  /tmp/engineering-continuity-candidate.json candidate
```

The original [baseline receipt](evidence/engineering-continuity.json) remains unchanged (SHA-256 `d6d82bc603fbdb1782d032d1b454855bdf7fc62aef53695cc0f1f83028ae87b6`). Its historical harness hash precedes candidate-mode support in the current harness. Both receipts retain the actual executed commands and output; the candidate receipt identifies the current harness hash.

Both original omission probes now reject with `INCOMPLETE_RUNTIME`, and neither writes a replacement for the missing file. The complete stopped-store copy still restores world revision 2/one creation and the revision-3 REJECTED decision. Both present-corruption controls still reject startup. The actual candidate ZIP extraction passes recovery, 241 Node tests (the original 238 plus three layout tests), and 47 Python tests. This establishes targeted Gate A improvement under the same original omission conditions and no observed regression in those retained execution checks. It supports ENG-R1 absence detection for these cases; backup loss, valid-store rollback, crash recovery, coordinated writer races and a fresh cloud environment remain outside the evidence.

Integration review caught that the new server import also required adding `game/runtime-layout.mjs` to the source export allowlist. The parent corrected that explicit allowlist before the recorded candidate snapshot. This was a review-detected integration risk, not a demonstrated baseline defect or an executed broken candidate export. The passing extracted candidate tests include the corrected allowlist.

### Q-ENG-004 — First-start configuration error leaves an incomplete anchor

**Classification:** REPRODUCED in the recorded candidate; **severity:** LOW availability/recovery burden; **discipline:** initialization failure isolation. **Evidence:** candidate Q-ENG-P11. **Claim tested:** correcting a rejected initial configuration permits a normal retry without manual storage recovery. A fresh disposable `createGameServer({dataDir,founderKey:'short'})` creates `runtime-layout.json` and then rejects key length. A second call with a valid explicit fake key rejects `INCOMPLETE_RUNTIME` because neither store was created. The anchor remains. No history was destroyed; the guard fails closed, but an ordinary configuration mistake now needs an offline intervention.

**Root cause:** The inventory anchor is committed before validation of supplied Founder-key shape. **Trigger:** invalid explicitly supplied first-start key; no credentials or process crashes were needed. **Detectability:** the initial validation error and subsequent incomplete-layout error are observable; the latter does not explain that a failed initial attempt created the anchor. **Recovery:** establish that the failed bootstrap has no stores/history and no owner, preserve the incomplete directory/anchor, then explicitly reset only that disposable/new bootstrap or use an authorized initialization procedure. Deleting an anchor in a populated institution is not an acceptable generic fix.

**Competing repairs:** (1) Validate the explicit key's shape before creating the anchor; this prevents this concrete trigger and preserves fail-closed detection of truly missing stores. (2) Introduce an explicit INITIALIZING-to-READY lifecycle and a safe resume policy under an exclusive initialization lease; this covers broader interruption cases at greater complexity. Do not automatically discard an incomplete anchor merely because files are absent, which would recreate Q-ENG-001. **Disposition:** reported immediately to the parent for selected repair; no implementation by this worker. **Rollback:** retain incomplete-bootstrap evidence, original guard behavior and populated-store copies before changing ordering. **Limits:** other startup interruptions and active races were not executed. **Gates:** A original omission fix still improves detection; B initialization retry criterion fails in this candidate; C contains loss but recovery remains manual. This does not reopen the reproduced silent-history-loss condition.

### Final short verification and current disposition

The parent selected Q-ENG-004's first alternative: supplied-key shape and institution-report projection are validated before the inventory or stores are written. [engineering-continuity-final.json](evidence/engineering-continuity-final.json) preserves a distinct final receipt; neither earlier receipt was overwritten. Two direct fixtures reject an invalid explicit fake key and an invalid report with **no inventory anchor created**, then successfully start after correcting the configuration. The four root layout tests plus the session-capacity test passed **5/5**. Five module/test SHA-256 values were recorded before execution and verified unchanged afterward. No full-suite or extracted-source rerun was performed for this final ordering/session change; the parent owns final integrated verification.

The session-capacity implementation was separately inspected: at the 512-session limit it selects only the Witness with the oldest `lastSeen` as a victim; if no Witness exists, it returns 429. The executed pressure test creates 512 anonymous sessions while retaining an authenticated fake-key Founder session. This supports that specific preservation claim. It is not a claim of comprehensive denial-of-service protection, independent authentication assurance, or a test of long-term expired-session reclamation.

**Current bounded disposition:** Q-ENG-001 original missing-store condition is contained in the recorded candidate; Q-ENG-004 invalid-initial-configuration retry condition is contained in the final recorded module hashes. Q-ENG-002 and Q-ENG-003 remain open in the frozen examined recovery/build implementation. Q-ENG-001's targeted Gate A improvement and local absence-detection portion of Gate B have supporting evidence; Gate C remains bounded to preserved local failure receipts and stopped-store copy/recovery. Unexecuted fresh-cloud, crash/media-loss and external review conditions remain unqualified. Parent integration retains authority over the final source disposition; Founder authority and consequential authorization are unchanged.
