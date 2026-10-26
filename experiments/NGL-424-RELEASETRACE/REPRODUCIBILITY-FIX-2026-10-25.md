# NGL-424 RELEASETRACE — Reproducibility correction

**Observed on:** 2026-10-25  
**Repository:** `ngl-damien/No-Gas-Labs-Alpha-1`  
**Purpose:** Preserve a source-linked public research record for a bounded test/packaging correction. This record does not publish the RELEASETRACE executable.

## Finding

An independent run of the supplied NGL-424 package passed the 370-case JavaScript/Python differential suite and the controlled Chromium smoke test. The first clean rebuild after running the browser test did not match the original ZIP.

File-level comparison isolated the difference to `assets/preview_390.png` and its dependent package manifest. The browser test wrote a screenshot directly over the packaged preview asset. In this runtime the file changed from 567,109 bytes to 567,102 bytes.

## Repair

Package revision 1.0.1 changes the browser smoke harness to write screenshots into a temporary directory. It records the preview's SHA-256 before the test and asserts that the packaged asset remains unchanged afterward.

The application engine remains RELEASETRACE/1.0.0. Version 1.0.1 identifies the test/packaging correction, not a new legal or content-analysis capability.

## Post-fix verification observed locally

- JavaScript/Python differential cases: 370; disagreements: 0.
- Input-order invariance checks: 100.
- Asset-hash mismatch checks: 50.
- Stale/tampered receipt rejection checks: 100.
- Controlled Chromium assertions: 14 at widths 320, 390, 768, and 1440 pixels.
- Browser runtime errors: 0 observed.
- External requests: 0 observed.
- Horizontal overflow: 0 observed.
- Demo disposition: BLOCK, with one BLOCK and one HOLD.
- Independent Python replay: matched the included demo receipt.
- Packaged preview unchanged after browser test: PASS.
- Rebuild after tests: byte-identical to the preceding build.
- Revised package SHA-256: `a9c1b69437e474731b006164f7a6f6bc3a4669b946cdcc6858960ecf186e107d`.

These are local execution observations for the supplied package, not CI results from this repository.

## Boundaries and distribution

- No legal applicability, publisher identity, evidence semantics, C2PA data, or real-world compliance was authenticated.
- No buyer trials, public executable release, marketplace listing, checkout, sales, or revenue are established.
- The revised ZIP and test outputs are available as downloadable conversation artifacts. Persistent Library upload was attempted and rejected by the Library storage limit; no existing files were deleted.
- The current persistent Library index observed in this pass is `NGL_Catalog_Index_071-420.json`. A newer 352-entry local index includes NGL-421 through NGL-424, but its persistent upload/readback is not established. Visible folder names do not prove the corresponding artifacts are archived.

## Why this record exists

A reproducibility claim is meaningful only if the test process itself preserves the bytes it is supposed to verify. This correction converts a hidden test side effect into an explicit regression condition. It does not establish external product demand or justify a commercial pass.
