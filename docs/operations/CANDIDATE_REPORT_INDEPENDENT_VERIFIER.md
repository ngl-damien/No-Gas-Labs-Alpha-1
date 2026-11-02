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
