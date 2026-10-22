# Signed file courier and Council receipts

The courier durably dispatches exact input to enrolled Ed25519 keys, imports signed acknowledgments and replies, and preserves every seat's output and dissent. It uses Node built-ins and actual local files. Dispatch leaves work `DISPATCHED`; only a verified reply after a verified acknowledgment produces `RESPONDED` for that seat. There are no model-provider calls, invented external agents, provider charges, majority approval, or Founder permission grants.

A signature authenticates the enrolled key. It does not establish a human identity, independent reasoning, execution of a remote model, or factual truth. Enroll each public key through a separately trusted process; the courier does not discover or certify key owners. A caller with write access to the enrollment configuration determines its trust roots.

## Reproduce the checks

From the repository root, with Node 24:

```sh
node --test test/institution-courier.test.mjs
node scripts/courier.mjs demo --data-dir /tmp/ngl-courier-fresh-demo --out /tmp/ngl-courier-fixture-receipts.json
node scripts/courier.mjs status --data-dir /tmp/ngl-courier-fresh-demo
```

Use a new demo directory and a new output filename each run. `demo` generates a disposable Ed25519 key in memory, starts an actual Node child process, sends the dispatch and fixture private key through its stdin, and imports that child's signed ack and reply. The child canonicalizes and SHA256-hashes the actual input. JSON output identifies `LOCAL_SIGNED_FIXTURE`, records the real child PID and input hash, and explicitly sets `externalProviderExecuted:false`. No private key is written to disk or committed. Reusing that store with a newly generated key correctly rejects an identity conflict. Status reopens the public enrollment and verifies persisted signed receipts without needing the disposed private key.

The focused suite was observed RED before the module/CLI existed, then GREEN with 16 tests. Added regression tests also observed expiry revision mismatch, excessive envelope bounding, queued option mutation, persisted cross-request/cross-seat receipt rebinding, and unsafe automatic stale-lock recovery before their fixes. It exercises wrong-key signatures, signed-content tampering, cross-request and provider/capability/nonce/expiry changes, reply-before-ack, conflicting receipts, independent dissent, unavailable seats, expiry/failure, private file modes, repeat/restart, concurrent mutations, persisted tampering, full-size inputs, real CLI file handoff, and the actual child worker. The root integration owner runs the full repository suite.

## API

```js
import {createCourier, canonicalJSON, payloadDigest, signEnvelope}
  from './src/institution/courier.mjs';

const courier = await createCourier({
  dataDir: '/private/path/courier',
  providers: [{
    id: 'review-seat',
    publicKey: '-----BEGIN PUBLIC KEY-----\n...Ed25519 SPKI PEM...\n-----END PUBLIC KEY-----\n',
    capabilities: ['review'],
    available: true,
  }],
});
const request = await courier.dispatch({
  requestId: 'request-001', // optional; generated if omitted
  capability: 'review',
  input: {proposal: 'Exact JSON input'},
  providerIds: ['review-seat'], // optional; all enrolled matching seats
  expiresAt: Date.now() + 60000, // optional; defaults to five minutes
});
const packet = await courier.exportDispatch(request.requestId, 'review-seat');
// Deliver packet using an independently arranged file handoff.
await courier.acknowledge(actualSignedAck);
await courier.respond(actualSignedReply);
const snapshot = await courier.snapshot();
```

`createCourier`, `dispatch`, `exportDispatch`, `acknowledge`, `respond`, `fail`, and `snapshot` are asynchronous. `canonicalJSON`, `payloadDigest`, and `signEnvelope` are synchronous utilities. `now:()=>integerMilliseconds` is an optional constructor clock for deterministic tests. Omit `providers` when reopening an existing registry; supplying a different registry rejects `IDENTITY_CONFLICT`. Key rotation requires an explicitly separate store and a new enrollment process; this implementation has no automatic rotation or key revocation workflow.

Input and reply output each accept at most 131072 UTF-8 bytes of finite, acyclic plain JSON with nesting at most 64. Receipt envelopes accept at most 524288 UTF-8 bytes. IDs, capabilities and nonces match `[A-Za-z0-9._:-]{1,100}`. At most 64 providers/seats are supported; request lifetime is at most seven days. No request text becomes a shell command. Errors include a stable `code` such as `INVALID_SIGNATURE`, `REQUEST_MISMATCH`, `CONFLICT`, `ACK_REQUIRED`, `EXPIRED`, `IDENTITY_CONFLICT`, or `CORRUPT_STATE`.

## Wire format and signing

An exported packet has this exact shape:

```js
{
  schema: 'ngl.courier.packet.v1',
  payload: {
    schema: 'ngl.courier.dispatch.v1',
    requestId, providerId, capability, nonce, input, issuedAt, expiresAt
  },
  digest // SHA256 hex over UTF-8 canonicalJSON(payload)
}
```

Acknowledgment payload:

```js
{
  schema: 'ngl.courier.ack.v1',
  request: packet.payload,
  requestDigest: packet.digest,
  at: Date.now(),
  accepted: true
}
```

Reply payload:

```js
{
  schema: 'ngl.courier.reply.v1',
  request: packet.payload,
  requestDigest: packet.digest,
  at: Date.now(),
  output: {actualResult: 'provider output'},
  dissent: null // or a preserved dissent string, at most 16000 characters
}
```

A signed envelope is `{payload,signature}`. Sign the UTF-8 bytes of `canonicalJSON(payload)` with Ed25519, then encode the 64-byte signature as standard base64. `signEnvelope(payload,privateKey)` implements this for a provider holding its own private key. Canonical JSON sorts object keys lexicographically, preserves array order and Unicode strings, uses JSON number/string encoding, and rejects undefined, nonfinite numbers, cycles and non-JSON objects. Matching digest alone is insufficient: the courier also compares the entire embedded dispatch and verifies the signature against that exact seat's enrolled public key.

Acknowledgments and replies must arrive before expiry, have timestamps from issuance through expiry (exclusive), and not claim a future time. A reply must follow its seat's signed acknowledgment and have a timestamp at least as late. Exact duplicates are idempotent, including already accepted receipts retried after expiry. Conflicting duplicates reject. Expiry affects pending seats on the next courier operation; there is no background daemon. New receipts for expired seats reject even if they were purportedly signed earlier.

## File handoff CLI

Prepare `providers.json` containing the public provider array and `request.json` containing the `dispatch` arguments above, then:

```sh
node scripts/courier.mjs dispatch --data-dir /private/path/courier --providers providers.json --request request.json
node scripts/courier.mjs export --data-dir /private/path/courier --request-id request-001 --provider-id review-seat --out dispatch-packet.json
node scripts/courier.mjs import --data-dir /private/path/courier --file actual-signed-ack.json
node scripts/courier.mjs import --data-dir /private/path/courier --file actual-signed-reply.json
node scripts/courier.mjs status --data-dir /private/path/courier
```

`dispatch --out path` also writes the pending packet (or an array for multiple seats). `export` exports pending delivery packets. Output files use exclusive creation so an existing destination is not overwritten. This CLI transports files; it does not provide a network endpoint, authenticated delivery service, automatic retry daemon, or external provider worker. Imports must come from actual key holders. The standalone fixture never establishes an enrolled external provider's execution.

## State and authority

Each request keeps separate seats with `DISPATCHED`, `ACKNOWLEDGED`, `RESPONDED`, `FAILED`, `EXPIRED`, or `UNAVAILABLE`. The aggregate becomes `RESPONDED` only when every targeted seat responded. A mixture of completed and unavailable/failed seats stays visibly incomplete. An empty provider selection is `UNAVAILABLE`. `fail({requestId,providerId,reason})` records an operator-observed transport failure and cannot fabricate a response. Terminal seats cannot change. No response is reduced to a binding Council vote, and no API in this module grants Founder authority.

State is stored in `dataDir/courier.json`; the directory is mode 0700 and created files are mode 0600. Mutations serialize in-process and use an exclusive cross-process lock. Writes use a private temporary file, fsync, atomic rename and directory fsync. State is reloaded and validated for every operation, including schema, checksum, enrollments, request/receipt bindings, all historical signatures, and exact binding of each historical receipt to its enclosing request and provider seat. A previous store is revalidated on restart. State has a 16 MiB limit and no automatic compaction.

The checksum detects accidental edits; it is not an independent signature over the entire store. A malicious operating-system user who controls the state and enrollment files can replace the trust roots or roll back the complete store. Keep the directory outside public static exports, source archives and shared writable paths. This implementation has no external monotonic witness, encrypted storage, delivery guarantee, or hostile-host defense. Receipt signatures remain independently verifiable when their original public enrollment is retained.

## Recover an abandoned lock

A detected dead owner produces `STALE_LOCK`; the courier never automatically removes another process's lock. Multiple automatic recoverers could otherwise unlink a new owner's lock and silently break serialization. A malformed or still-live owner eventually produces `BUSY`. These errors preserve the store and lock.

If a courier process crashed while holding the lock, first stop every courier/API/CLI process using that store and prevent new clients from starting. Verify those processes have stopped. Only then explicitly remove that store's `.courier.lock` and restart clients. Do not delete a lock while any courier process may be running. Restart reads and validates the last atomic state before further work. This manual recovery is required for an abandoned lock; a normal clean restart needs no recovery.

The focused regression starts six actual clients against a stale lock, verifies all fail with the lock and state unchanged, then explicitly recovers after all six stop and verifies six ordinary clients each persist their dispatch.
