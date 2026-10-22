# AOTA local evidence inspector

This Python standard-library tool inventories local artifact bytes against an untrusted claims manifest. It is useful for finding missing files, changed bytes, duplicate evidence, unsupported claim labels and dependency problems in a handoff. It is **not** the Founder Gate, a test runner, an attestation service or a source of institutional authority.

Requires Python 3.9 or later on a POSIX system with `O_NOFOLLOW`, directory descriptors and `dir_fd` support. Tested with Python 3.12 in the managed Codex environment. No pip packages, API credentials, network access or Git metadata are needed.

## Run from a repository or extracted component package

Keep the component's repository-relative directory intact, then run:

```sh
cd experiments/AOTA-FEATHERSTONIAN-ENGINE
python3 -m unittest -v test_engine.py
python3 engine.py example_claims.json --root .
```

The supplied example contains a real digest for `engine.py`: `local-inspector-source` should have ceiling `BUILT`. The original empty-evidence examples remain and should have ceiling `PLANNED`. Editing the engine changes its digest; update the manifest deliberately, rather than ignoring a mismatch. A matching example is a byte-identity demonstration, not proof that the engine is correct.

The CLI writes a JSON report to stdout and exits 0 when an inventory was completed, including when artifacts fail checks. Invalid manifests, dependency errors and unreadable inputs exit 2 with a diagnostic on stderr. A zero exit status therefore **does not mean all claims passed**: inspect `results`, `artifact_checks` and the warning.

## Manifest and output

The manifest must be a UTF-8 JSON object with only a `claims` list. Each claim has a unique nonempty string `id`, a `declared` level, and optional `dependencies` and `evidence` lists. Evidence records contain `kind`, `path` and an exact 64-character hexadecimal `sha256` string. Paths use `/`, relative to `--root`; absolute paths, `..`, `.`, empty path segments, backslashes, colons and actual NUL characters are rejected. Uppercase hexadecimal digests are accepted.

Levels retain the prototype vocabulary: `PLANNED`, `BUILT`, `VERIFIED`, `OPERATIONAL`, `EXTERNALLY_CONFIRMED`. The inspector computes a **local inventory ceiling** from distinct labeled files and dependency ceilings; it never raises a claim above its declared level. One inode or identical byte sequence cannot supply two evidence kinds within a claim, even through hardlinks or separate copied files. Reusing an artifact in a different claim is allowed.

The field `missing_verified_kinds` is retained for compatibility; its values describe missing **untrusted labels**. Even a ceiling of `EXTERNALLY_CONFIRMED` does not establish external confirmation. Anyone able to create four files can attach all four labels. `source`, `test`, `runtime` and `external` are never authenticated by this tool.

## Bounds and trust limits

- Claims manifest: at most 1 MiB, 1,000 claims, 256 evidence records per claim, 64 levels of JSON nesting and 128 dependency edges in a chain. Duplicate JSON keys, nonfinite JSON constants, overflowing numeric exponents, malformed JSON and dependency cycles fail closed. Direct API inputs must also contain finite JSON values; output encoding rejects nonfinite values. Invalid object/array field types are replaced by null in diagnostic fields rather than echoed.
- Artifact: at most 16 MiB. Reads use bounded file-descriptor operations; the tool checks regular-file type, size and before/after inode metadata. FIFOs are opened nonblocking and rejected. The manifest has the same regular-file and mutation checks.
- Artifact traversal holds directory descriptors and opens each component with no-follow protection. Intermediate and final symlinks are rejected. Duplicate inode identity and byte digests are recorded independently.
- These checks do not establish a coherent snapshot across files. A filesystem owner can replace content before inspection, mutate directories or restore a different complete inventory; detected read-time mutations fail closed, but this is not a hostile-OS sandbox or an authenticated provenance mechanism. File metadata is not a cryptographic execution receipt.
- A digest match proves local byte integrity only. It cannot establish that a test ran, a witness is independent, a statement is true, a decision was authorized or a provider executed work. Attach this report to the institution's separately authenticated execution and decision records when those exist.

## Verification history

The imported package preserved 21 original test methods but could not import because `engine.py` contained literal `\n` text in executable source. A syntax-only repair exposed the double-escaped SHA-256 regex and additional input-boundary failures. This revision retains those 21 cases and adds 26 regressions, including a genuine NUL path, hardlinks, intermediate symlinks, malformed/bounded CLI input, FIFO handling, detected mutation, numeric overflow, deep invalid fields and input-order-independent dependency bounds. The recorded local run passed **47 tests**; see `docs/institution/compounding/task-a.md` in the full repository for the execution trace. This statement reports one local run, not independent certification.

Read `CODEX-MISSION.md`, `ALPHA1-INSTITUTIONAL-THESIS.md` and `RECONCILIATION-CONTRACT.md` in the full handoff for the wider institutional experiment. They are not required to execute this standalone component.
