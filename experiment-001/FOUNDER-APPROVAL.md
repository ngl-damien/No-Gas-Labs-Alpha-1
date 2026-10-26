# Offline Founder INSTALL approval

`scripts/approve-install.mjs` is a small operator-invoked signer for Experiment 001. It validates one serialized INSTALL proposal and produces a detached Ed25519 signature over the exact canonical decision. The proposal handler and ledger runtime do not receive the private key through this interface.

## Use

1. Obtain the INSTALL proposal JSON from the proposer and inspect its strategy, executor public key, nonce, validity window, use limit and proof.
2. On a trusted operator-controlled machine, provision the Founder Ed25519 private key in a regular file readable only by the operator (POSIX mode `0600`). Do not put it in the repository, an issue, a pull request, or a command-line argument. The key file must not be a symlink.
3. Configure `NGL_FOUNDER_KEY_FINGERPRINT` independently from the proposal handler, using the already-established trust anchor for the Founder public key. The signer refuses to run if the configured SHA-256 fingerprint of DER SubjectPublicKeyInfo does not match the public key derived from the private key.
4. Run:

```sh
NGL_FOUNDER_KEY_FINGERPRINT=<independently-provisioned-64-character-hex-fingerprint> \
  node scripts/approve-install.mjs ./proposal.json /secure/path/founder-private.pem > ./approval.json
```

5. Review the JSON receipt. It contains `proposalDigest`, `keyFingerprint` and `signature`. The ledger's `commit(decision, signature)` expects the detached `signature` string, not the whole receipt. Compare `proposalDigest` with the proposal being approved before passing that signature to the ledger.

The signer rejects malformed/expired proposals, unknown or invalid strategies, a non-Ed25519 key, an absent/malformed trust pin, a fingerprint mismatch, oversized/non-regular files, and group/world-readable private-key files on POSIX. It never writes to the ledger, installs a capability, deploys code, or awards XP.

## Security boundary and limits

- This is a usable **offline signing helper**, not proof that Damien personally operated it or consented. A valid signature proves possession of the corresponding private key.
- File permission checks reduce accidental exposure; they do not protect a key from a compromised account, host, Node runtime, malicious checkout, backups, or privileged process. Review and pin the signer code before using a real key. For stronger custody, use a separately controlled hardware-backed signer or signing service and independently provision its public-key fingerprint.
- The repository contains no real Founder key. Tests generate ephemeral keys only. No production key, approval, or signature is supplied by this change.
- The environment fingerprint is a trust pin, not a human identity service. Do not derive or silently replace the runtime's trust pin from an untrusted proposal or from whatever key the proposer presents.
- The CLI emits an audit receipt to stdout and a limitation warning to stderr. Keep the receipt with the proposal's evidence, but do not treat it as an independent observation or a claim that the capability has executed.

## Exact acceptance claim

The tests can establish that the CLI validates a proposal, signs its canonical payload with a matching Ed25519 private key, refuses a mismatched trust pin or expired proposal, and rejects overly broad POSIX key-file permissions. They cannot establish real-world identity, safe production custody, independent human review, or successful capability installation.
