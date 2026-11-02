# Independent candidate evaluation report verification

Experiment 001 now has two offline report verifiers:

- Node: `npm run candidate:verify -- <synthesis-receipt.json> <evaluation-report.json>`
- Python: `npm run candidate:verify:independent -- <synthesis-receipt.json> <evaluation-report.json>`

The Python command is a separate standard-library implementation. It independently validates the synthesis receipt, canonical task-specification digest, bounded polynomial AST, exact coefficient proof, safe-integer bound, candidate implementation hash, single/range evaluation rows, and report/result digests. It uses bounded regular-file reads and rejects symlinks, duplicate JSON keys, invalid UTF-8, oversized inputs, and files that change while being read.

The hosted verification suite runs the Python regression file `test/test_candidate_report_verifier.py` as its own stage. Its tests generate fixtures with the Node synthesizer/evaluator, then compare the Python verifier's report digest, result digest, and implementation hash against the existing Node verifier. Negative tests cover altered outputs, task-context substitution, forged authority flags, incomplete/noncontiguous ranges, digest tampering, duplicate keys, proof tampering, symlinks, oversized reports, and boolean values masquerading as integer outputs.

## Use

```sh
npm run candidate:synthesize -- ./task-spec.json > ./synthesis-receipt.json
npm run candidate:evaluate -- ./synthesis-receipt.json --range -32 32 > ./evaluation-report.json
npm run candidate:verify -- ./synthesis-receipt.json ./evaluation-report.json
npm run candidate:verify:independent -- ./synthesis-receipt.json ./evaluation-report.json
```

Both verifiers are read-only. The Python result labels its method `python-stdlib-independent-ast-and-polynomial-replay`; the Node result labels its method `same-runtime-replay-plus-BigInt-target-check`. Matching digests and results establish cross-implementation agreement for the supplied bounded receipt/report, not an external attestation.

## Authority and limits

Neither verifier validates the task-specification Ed25519 signature or INSTALL approval, proves Damien's real-world identity or private-key custody, installs/reuses a capability, invokes a provider, changes the Experiment 001 ledger, or mutates canonical institutional/game state. The task still requires its separate Founder task-specification signature and INSTALL approval before installation. The Python implementation is independent code, not an independent trust root, human reviewer, production security certification, or proof of general AI discovery.

Bounds remain fixed by the candidate-program-v5 contract: AST depth 12, 63 nodes, polynomial degree 32, 4,096 coefficient bits, inputs in [-1,000,000, 1,000,000], at most 4,096 range evaluations, 64-KiB synthesis receipts, and 2-MiB evaluation reports.


## Cross-runtime JSON numeric parity

The Python implementation preserves the Node/ECMAScript JSON-number boundary in cases where the standard-library defaults differ:

- A syntactically valid integer token longer than CPython's configured `int()` digit limit is converted to a binary64 float only when that limit rejects the integer conversion. The verifier then rejects the non-finite or out-of-safe-range value as a domain error, matching Node's `JSON.parse` behavior instead of misclassifying valid JSON as malformed. The regression lowers `PYTHONINTMAXSTRDIGITS` to 640 and checks 700-digit values in both synthesis receipts and evaluation reports.
- JSON negative zero is preserved for both `-0` and `-0.0`. The Python verifier explicitly mirrors Node's deep strict comparison for single-report input/output values and range-row input/output values; those signed-zero fields are rejected with `EVALUATION_REPORT_MISMATCH` rather than being silently equated with positive zero by Python's ordinary numeric equality.
- Range metadata is also canonical: both verifiers reject `-0` and `-0.0` in `range.start` or `range.end` with `EVALUATION_REPORT_RANGE_INVALID`. Node's `String(-0)` and Python's `int(-0.0)` would otherwise erase the sign before replay; the explicit checks close that normalization path. Ordinary `0`, `0.0`, and integral exponent spellings remain accepted as the same ECMAScript Number value.
- Existing decimal/exponent parity tests continue to require matching implementation, report, and result digests for integral values such as `17.0` and `17e0`.

These checks establish deterministic agreement for the covered JSON numeric cases; they do not broaden the candidate task's safe-integer domain or confer signing, installation, or canonical-state authority.


## Cross-runtime string-length parity

The synthesis receipt's `instruction` field is bounded to 512 JavaScript string-length units. JavaScript counts UTF-16 code units, while Python's built-in `len(str)` counts Unicode code points. The independent verifier now computes the UTF-16 code-unit count explicitly, so astral characters count as two units and lone surrogates count as one, matching the Node verifier. Differential regressions cover ASCII, astral, mixed, and lone-surrogate strings at and just beyond the 512-unit boundary.


## Polynomial-shape parity corpus

The end-to-end Node/Python regression corpus now synthesizes, evaluates, and independently verifies zero and negative constants, a negative-slope linear polynomial, a sparse quadratic, coefficients that require bounded AST decomposition above the single-node constant limit, and a quadratic evaluated near the input-domain edge. For every case the tests compare the task digest, implementation hash, report digest, range-result digest, evaluation count, and authority-false result fields across both verifiers.

The near-safe-integer case uses coefficients `["0", "1", "9000"]` over inputs `-1,000,000` and `-999,999`. Its worst-case absolute polynomial bound is 9,000,000,001,000,000, below `Number.MAX_SAFE_INTEGER`. The advertised degree limit is a hard ceiling, not a claim that every degree is realizable under the tighter input-domain and safe-integer bounds; higher-degree candidates may be rejected by the intermediate-bound proof.
