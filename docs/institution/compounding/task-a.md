# Task A — usable local evidence inventory

## Scope and disposition

Task A adapts the existing AOTA Python inspector into a usable, bounded standard-library component. It retains the original schema and level vocabulary, all 21 original test-method bodies, and the two original empty-evidence examples. It adds a real source-byte example and input/filesystem regressions. No T.R.U. source, constitutional invariant, Founder authority or external provider integration was changed by this worker.

Files: `experiments/AOTA-FEATHERSTONIAN-ENGINE/engine.py`, `test_engine.py`, `example_claims.json`, `README.md`. The source reference is the parent branch's eventual integration commit; this worker did not commit or push independently.

## Observed baseline and RED → GREEN

The imported `engine.py` failed to parse: executable line 54 contained literal `\n` sequences. `python3 -m unittest -v test_engine.py` exited 1 before importing tests. This is an import failure, not 21 executed failures. The parent preserved the untouched baseline logs under `.runtime/compounding-lobtLU/baseline*`.

After adding regression tests and performing only the syntax repair, the actual suite ran 39 methods and reported **24 failures and 1 error**. The double-escaped SHA-256 regex rejected legitimate digests and accepted the wrong suffix; the real NUL path was not rejected at validation; CLI JSON errors leaked tracebacks; size/count limits and input-order-safe depth bounds were absent. Raw output: `.runtime/compounding-lobtLU/task-a-red.log`.

The first bounded implementation passed every case except the not-yet-completed example manifest (one error out of 39). A further regression showed that reversing the order of a long dependency chain bypassed a traversal-only depth limit: **1 actual failing test**, then **1 passing test** after memoized chain-depth validation. Additional existing-behavior regressions exercise detected real file mutation and nonblocking manifest handling.

The initial repaired source-tree execution with Python **3.12.14** passed **43/43 tests**, exit 0, 0.471 seconds reported by unittest. The original 21 method bodies were compared by AST against the imported Git version and were all unchanged. Logs: `.runtime/compounding-lobtLU/task-a-green.log`; first intermediate run retained in `task-a-green-first.log`.

Independent review then identified a real JSON overflow defect: `parse_constant` rejects literal `Infinity`, but valid JSON numeric syntax `1e309` becomes Python infinity and could be echoed as invalid bare `Infinity`. Two regression methods first failed (four failing assertions including direct-API subcases). The correction validates all input fields through finite JSON encoding and uses `allow_nan=False` for final output inside the CLI's clean-error boundary. Both focused methods passed, then the complete **45/45-test** suite passed in **0.446 seconds**, exit 0. Raw evidence: `task-a-nonfinite-red.log`, `task-a-nonfinite-green.log`, `task-a-final-tests.log`. All 21 original methods remain unchanged.

A second review case exposed nested invalid `kind`/`path` objects being echoed into diagnostics, creating serialization amplification or recursion errors. Two more regression methods first failed (three failing assertions), then passed after a 64-level iterative nesting bound and diagnostic-field type sanitization. Final complete source execution passed **47/47 tests in 0.626 seconds**; another fresh four-file copy passed **47/47 in 0.573 seconds**, and its real example CLI exited 0. Raw evidence: `task-a-nesting-{red,green}.log`, `task-a-reviewed-final-tests.log`, `task-a-reviewed-fresh-tests.log`, `task-a-reviewed-fresh-cli.json`, `task-a-reviewed-receipt.json`. The latter receipt confirms all 21 original test-method bodies remain unchanged.

## Implemented behavior

- Strict hexadecimal SHA-256 matching, including uppercase digests and rejection of newline or literal `\Z` suffixes. Actual NUL characters, nonportable path ambiguity, missing files and traversal fail closed.
- Held directory-descriptor traversal with no-follow opens rejects intermediate and final artifact symlinks. File descriptors are checked for regular-file type before bounded reads. FIFOs use nonblocking open and fail without hanging.
- Artifact reads are bounded to 16 MiB; manifest reads to 1 MiB. Before/after `fstat` checks reject detected size, mode, inode and timestamp changes. A deterministic syscall scheduling test appends to a real file during its actual read and verifies rejection even when the final read bytes match the claimed digest.
- Duplicate inode identity or identical byte digest cannot satisfy a second evidence kind within the same claim. Separate claims may refer to the same artifact.
- At most 1,000 claims, 256 evidence records per claim, 64 levels of JSON nesting and 128 dependency edges in a chain. Dependency depth is checked independently of input ordering. Duplicate IDs, unknown dependencies and cycles remain rejected. Unsupported object/array types in diagnostic kind/path fields are replaced by null, not echoed.
- UTF-8 and JSON decoding are bounded and produce clean exit-2 diagnostics for malformed input, duplicate JSON keys, nonfinite constants, overflowing numeric exponents and invalid envelopes. Direct API input also rejects nonfinite JSON values before they can be echoed. Successful inventory exits 0 even if individual claims fail; the README explicitly requires inspecting the report.
- Source, test, runtime and external labels remain untrusted. Hashes cannot attest execution, corroboration, truth, identity or authorization. Legacy `VERIFIED` and `EXTERNALLY_CONFIRMED` ceiling labels do not certify those properties.

## Actual CLI and fresh-copy reproduction

```sh
cd experiments/AOTA-FEATHERSTONIAN-ENGINE
python3 -m unittest -v test_engine.py
python3 engine.py example_claims.json --root .
```

The example CLI exited 0 and returned `ngl.aota.local-artifact-ceiling.v3`: `local-inspector-source=BUILT`, `meteor-local-source=PLANNED`, `external-ai-execution=PLANNED`. Its warning explicitly disclaims execution and authority. Raw report: `.runtime/compounding-lobtLU/task-a-cli.json`.

The four declared component files were copied into a new temporary directory preserving their repository-relative path, with no Git metadata or project dependencies. The initial same commands passed 43/43 tests, exit 0, and the CLI exited 0 (0.436 seconds). After the review correction, a second fresh copy passed **45/45 tests** in **0.462 seconds**, exit 0, and the CLI exited 0. This is a fresh-directory/process check, not yet an M1 ZIP acceptance result or a fresh cloud restoration. Final raw outputs: `task-a-final-fresh-tests.log`, `task-a-final-fresh-cli.json`; final source digests and original-method comparison: `task-a-final-receipt.json` in the same runtime directory. Earlier outputs remain preserved. The parent experiment separately evaluates both actual package alternatives.

Engine SHA-256 at final reviewed handoff: `f1ddf4ff9416045e09deaf4bc6b8d0a1b42bbe4e7870a45743a1a02146cca4c4`. The supplied example records this digest; modifying the engine requires an explicit example update. Superseded intermediate engine digests were `6f8e4d51fe977a557c0b6f0fe23a18a78c9020ad2b64728da8ebb86b6386e059` and `88a859bc947411a1f29838524b36f0bddda996051556942b29b384597e08b472`.

## Remaining limits

The tool requires supported POSIX no-follow descriptor APIs; Windows was not tested. Descriptor traversal and read-time checks do not freeze a filesystem or create a coherent snapshot across artifacts. A filesystem/OS owner can replace an entire inventory, manipulate directory placement, or present different complete bytes before inspection. The tool does not defend against a hostile kernel or authenticated-provenance forgery because it establishes neither a kernel trust boundary nor authenticated provenance.

These are same-machine, self-recorded execution results from Codex's available Python process, not an independent human witness or external AI execution. No public deployment, outside adoption, Founder-burden benefit, machinery transfer or institutional success is established by Task A alone. The parent will run full repository checks; this worker ran the component's full Python suite and real CLI only, as assigned.
