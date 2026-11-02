# Offline Founder INSTALL approval

`scripts/approve-install.mjs` is an operator-invoked signer for Experiment 001. It validates one serialized INSTALL proposal and produces a detached Ed25519 signature over the exact canonical decision. The proposal handler and ledger runtime do not receive the private key through this interface.

## Two-step use

1. Obtain the INSTALL proposal JSON from the proposer.
2. Inspect the exact proposal without loading a private key:

```sh
node scripts/approve-install.mjs --inspect ./proposal.json
```

Review the full digest, capability ID, strategy, executor-key fingerprint, nonce, issue/expiry timestamps, use limit and challenge proof. For candidate-program proposals, the review output also displays the exact candidate program AST and its implementation hash; compare both with the proof before signing. For v5, also inspect the separately signed task specification and confirm that its verified fingerprint is the independently provisioned trust pin. This command validates the proposal and emits no signature.

3. On a trusted operator-controlled machine, provision the Founder Ed25519 private key in a regular file readable only by the operator (POSIX mode `0600`). Do not put it in the repository, an issue, a pull request, or a command-line argument. The key file must not be a symlink.
4. Configure `NGL_FOUNDER_KEY_FINGERPRINT` independently from the proposal handler, using the already-established trust anchor for the Founder public key. The signer refuses to run if the configured SHA-256 fingerprint of DER SubjectPublicKeyInfo does not match the public key derived from the private key.
5. After reviewing the inspection output, consciously supply its **entire** `proposalDigest` in a separate signing invocation:

```sh
NGL_FOUNDER_KEY_FINGERPRINT=<independently-provisioned-64-character-hex-fingerprint> \
  node scripts/approve-install.mjs --confirm <full-proposal-digest> ./proposal.json /secure/path/founder-private.pem > ./approval.json
```

The signer re-reads and revalidates the proposal and refuses a digest mismatch. The resulting JSON receipt contains `proposalDigest`, `keyFingerprint` and `signature`. The ledger's `commit(decision, signature)` expects the detached `signature` string, not the whole receipt. Compare the digest again before passing that signature to the ledger.

The signer rejects malformed/expired proposals, unknown or invalid strategies, a non-Ed25519 key, an absent/malformed trust pin, a fingerprint mismatch, oversized/non-regular files, and group/world-readable private-key files on POSIX. It never writes to the ledger, installs a capability, deploys code, or awards XP.

## Security boundary and limits

- The separate digest-confirmation step reduces accidental signing and binds the approval to the exact reviewed proposal. It is not proof that a human read the proposal: a caller able to invoke the CLI can also supply the digest.
- This is a usable **offline signing helper**, not proof that Damien personally operated it or consented. A valid signature proves possession of the corresponding private key.
- File permission checks reduce accidental exposure; they do not protect a key from a compromised account, host, Node runtime, malicious checkout, backups, or privileged process. Review and pin the signer code before using a real key. For stronger custody, use a separately controlled hardware-backed signer or signing service and independently provision its public-key fingerprint.
- The repository contains no real Founder key. Tests generate ephemeral keys only. No production key, approval, or signature is supplied by this change.
- The environment fingerprint is a trust pin, not a human identity service. Do not derive or silently replace the runtime's trust pin from an untrusted proposal or from whatever key the proposer presents.
- The CLI emits an audit receipt to stdout and a limitation warning to stderr. Keep the receipt with the proposal's evidence, but do not treat it as an independent observation or a claim that the capability has executed.

## Exact acceptance claim

The tests can establish that review mode exposes the digest and decision fields without signing; signing requires an exact digest confirmation; the detached signature verifies against the canonical proposal; and mismatched pins, expired proposals and overly broad POSIX key-file permissions are rejected. They cannot establish real-world identity, safe production custody, independent human review, or successful capability installation.


## Candidate task specifications (candidate-program-v5)

A v5 INSTALL has two distinct signatures under the same configured Founder key: one signature authorizes the normalized task specification, and the existing INSTALL signature authorizes the exact capability proposal. The signatures use separate domains. This is not a second trust root and does not prove the human operator's identity.

1. Prepare a JSON task specification using schema `ngl.candidate-task-spec.v1`, a versioned ID such as `ngl.experiment-001.task:quadratic-3x2-plus-2x-minus-5:v1`, the fixed input interval `[-1000000, 1000000]`, proof method `exact-integer-polynomial-normal-form`, the exact verifier limits, and ascending canonical decimal `targetCoefficients`.
2. Inspect and normalize it without opening a key:

```sh
node scripts/approve-install.mjs --inspect-task-spec ./task-spec.json
```

3. Review the complete normalized specification and digest. On a trusted operator-controlled machine, sign only that exact digest:

```sh
NGL_FOUNDER_KEY_FINGERPRINT=<independently-provisioned-64-character-hex-fingerprint> \
  node scripts/approve-install.mjs --confirm-task-spec <full-task-spec-digest> ./task-spec.json /secure/path/founder-private.pem > ./task-spec-signature.json
```

The receipt contains the task-specification digest, versioned task ID, key fingerprint, and detached signature. It is not an INSTALL approval.

4. Put the exact normalized task specification and its signature in the v5 proposal. To inspect a v5 proposal, supply the independently provisioned public key whose fingerprint matches the trust pin:

```sh
NGL_FOUNDER_KEY_FINGERPRINT=<independently-provisioned-64-character-hex-fingerprint> \
  node scripts/approve-install.mjs --inspect ./proposal.json /secure/path/founder-public.pem
```

5. Confirm the full proposal digest and sign the INSTALL as in the existing two-step flow. For v5, the signer derives the public key from the explicitly supplied private key and verifies the task-specification signature against that key before emitting the separate INSTALL signature.

The CLI never creates, enrolls, rotates, exports, or stores a Founder key. Both signatures still depend on the same configured key and trust pin. A valid signature proves key possession only. Tests use ephemeral keys; no real Founder key or approval is present.


Within one institutional ledger, a task-specification ID is immutable: multiple capability installations may reference the same ID and digest, but a different normalized specification under an existing ID is rejected with `CANDIDATE_TASK_SPEC_ID_CONFLICT` before the ledger advances.


## Evaluate a synthesized candidate without installing it

The synthesis receipt can be checked and exercised offline before any signing or installation:

```sh
npm run candidate:synthesize -- ./task-spec.json > ./candidate.json
npm run candidate:evaluate -- ./candidate.json 17
```

The evaluator reads a bounded regular file, rejects duplicate JSON keys and unexpected fields, recomputes the task-specification digest and exact polynomial proof, validates the restricted AST, and compares its output with an independent BigInt evaluation of the signed-target coefficients. It accepts only canonical integer inputs inside the declared interval and emits the implementation hash with a machine-readable result.

For a bounded inclusive sweep, use:

```sh
npm run candidate:evaluate -- ./candidate.json --range -32 32
```

Range mode evaluates every integer in the requested interval, rejects reversed or out-of-domain ranges, and caps one invocation at 4,096 inputs. It emits each input/output comparison plus a deterministic SHA-256 result digest. The digest is an integrity checksum, not a signature or proof of who ran the command. The polynomial proof remains the exact all-domain mathematical claim; range rows are runtime cross-checks only.

A saved single-input or range report can be replayed against its original synthesis receipt:

```sh
npm run candidate:evaluate -- ./candidate.json --range -32 32 > ./candidate-evaluation.json
npm run candidate:verify -- ./candidate.json ./candidate-evaluation.json
```

The verifier checks the report schema and authority boundary, reopens and validates the synthesis receipt, recomputes every reported input/output pair, and verifies the range result digest. It emits a deterministic verification receipt. This is same-runtime replay plus an independent BigInt target recalculation, not a separate implementation, signature, proof of who ran the command, Founder approval, capability installation, or canonical-state mutation.

This is an unsigned local evaluation only. It does not verify a task-specification signature or INSTALL approval, install or reuse a capability, read a Founder key, or change canonical state. A successful evaluation is not evidence of Founder authorization or real-world identity.
