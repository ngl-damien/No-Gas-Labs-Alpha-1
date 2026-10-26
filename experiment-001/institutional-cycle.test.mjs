import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign as signSignature } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pair = () => generateKeyPairSync('ed25519');
const pem = p => p.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const fingerprint = p => createHash('sha256').update(createPublicKey(pem(p)).export({ type: 'spki', format: 'der' })).digest('hex');
async function loadPinned(founder) {
  const previous = process.env.NGL_FOUNDER_KEY_FINGERPRINT;
  process.env.NGL_FOUNDER_KEY_FINGERPRINT = fingerprint(founder);
  try { return await import('./institutional-cycle.mjs?test=' + randomUUID()); }
  finally { if (previous === undefined) delete process.env.NGL_FOUNDER_KEY_FINGERPRINT; else process.env.NGL_FOUNDER_KEY_FINGERPRINT = previous; }
}
const openStore = (lib, dir, p) => lib.openInstitution(dir, pem(p));
const approve = (lib, d, key) => signSignature(null, Buffer.from(lib.approvalPayload(d)), key).toString('base64url');
const receipt = (lib, d, key) => signSignature(null, Buffer.from(lib.executionReceiptPayload(d)), key).toString('base64url');
const proposal = (lib, executor, extra = {}) => lib.makeInstallationProposal({ executorPublicKeyPem: pem(executor), nonce: 'install-nonce-000001', issuedAt: Date.now(), expiresAt: Date.now() + 60_000, maxUses: 2, ...extra });
async function temp(fn) { const dir = await mkdtemp(join(tmpdir(), 'ngl-approval-test-')); try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); } }

test('proposer cannot install without a separate Founder signature', () => temp(async dir => {
  const founder = pair(), executor = pair(), lib = await loadPinned(founder), store = await openStore(lib, join(dir, 'store'), founder), draft = proposal(lib, executor);
  await assert.rejects(() => store.commit(draft), /UNAUTHORIZED/);
  await assert.rejects(() => store.commit(draft, 'model-says-approved'), /UNAUTHORIZED/);
  assert.equal(store.snapshot().sequence, 0);
}));

test('approved install persists and can be reused in a separate Node process; replay is rejected', () => temp(async dir => {
  const founder = pair(), executor = pair(), lib = await loadPinned(founder), path = join(dir, 'store');
  const draft = proposal(lib, executor, { nonce: 'install-nonce-000002', maxUses: 1 });
  const store = await openStore(lib, path, founder);
  await store.commit(draft, approve(lib, draft, founder.privateKey));
  const use = { kind: 'REUSE', id: draft.id, nonce: 'reuse-nonce-000001', input: 9, output: 81 };
  const workerPath = new URL('./reuse-worker.mjs', import.meta.url).pathname;
  const child = spawnSync(process.execPath, [workerPath, path, pem(founder), JSON.stringify(use), receipt(lib, use, executor.privateKey)], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, NGL_FOUNDER_KEY_FINGERPRINT: fingerprint(founder) }
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const snapshot = JSON.parse(child.stdout.trim());
  assert.equal(snapshot.sequence, 2);
  assert.equal(snapshot.capabilities[draft.id].uses, 1);
  const reopened = await openStore(lib, path, founder);
  assert.equal(reopened.snapshot().capabilities[draft.id].uses, 1);
  await assert.rejects(() => reopened.commit(use, receipt(lib, use, executor.privateKey)), /REPLAY/);
}));

test('capability IDs that overlap inherited object names remain valid', () => temp(async dir => {
  const founder = pair(), lib = await loadPinned(founder), store = await openStore(lib, join(dir, 'store'), founder);
  for (const [i, id] of ['toString', 'constructor', 'hasOwnProperty'].entries()) {
    const executor = pair(), draft = proposal(lib, executor, { id, nonce: 'install-prototype-' + i + '-0001', maxUses: 1 });
    await store.commit(draft, approve(lib, draft, founder.privateKey));
    assert.equal(Object.hasOwn(store.snapshot().capabilities, id), true);
    const use = { kind: 'REUSE', id, nonce: 'reuse-prototype-' + i + '-0001', input: 3, output: 9 };
    await store.commit(use, receipt(lib, use, executor.privateKey));
    assert.equal(store.snapshot().capabilities[id].uses, 1);
  }
}));

test('invalid output and oversized input do not consume a grant', () => temp(async dir => {
  const founder = pair(), executor = pair(), lib = await loadPinned(founder), store = await openStore(lib, join(dir, 'store'), founder), draft = proposal(lib, executor, { nonce: 'install-nonce-000003', maxUses: 1 });
  await store.commit(draft, approve(lib, draft, founder.privateKey));
  const wrong = { kind: 'REUSE', id: draft.id, nonce: 'reuse-nonce-000003', input: 8, output: 63 };
  await assert.rejects(() => store.commit(wrong, receipt(lib, wrong, executor.privateKey)), /OUTPUT_MISMATCH/);
  const large = { kind: 'REUSE', id: draft.id, nonce: 'reuse-nonce-000004', input: 1_000_001, output: 1_000_002_000_001 };
  await assert.rejects(() => store.commit(large, receipt(lib, large, executor.privateKey)), /INPUT_OUT_OF_BOUNDS/);
  assert.equal(store.snapshot().capabilities[draft.id].uses, 0);
}));

test('caller-supplied key and extra fingerprint cannot replace the startup pin', () => temp(async dir => {
  const founder = pair(), untrusted = pair(), lib = await loadPinned(founder);
  await assert.rejects(
    () => lib.openInstitution(join(dir, 'untrusted'), pem(untrusted), fingerprint(untrusted)),
    /FOUNDER_KEY_FINGERPRINT_MISMATCH/
  );
  await assert.doesNotReject(() => lib.openInstitution(join(dir, 'founder'), pem(founder)));
}));

test('missing startup pin fails closed in a clean child process', () => {
  const moduleUrl = new URL('./institutional-cycle.mjs', import.meta.url).href;
  const script = "import { openInstitution } from " + JSON.stringify(moduleUrl) + "; try { await openInstitution('/tmp/ngl-unconfigured-test', '-----BEGIN PUBLIC KEY-----\\ninvalid\\n-----END PUBLIC KEY-----'); process.exit(3); } catch (error) { process.exit(error.message === 'FOUNDER_KEY_FINGERPRINT_REQUIRED' ? 0 : 2); }";
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, NGL_FOUNDER_KEY_FINGERPRINT: '' }
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test('modified proof is rejected even when the modified proposal is signed', () => temp(async dir => {
  const founder = pair(), executor = pair(), lib = await loadPinned(founder), store = await openStore(lib, join(dir, 'store'), founder), draft = proposal(lib, executor);
  draft.proof = { ...draft.proof, passed: draft.proof.passed - 1 };
  await assert.rejects(() => store.commit(draft, approve(lib, draft, founder.privateKey)), /INSTALL_PROOF_INVALID/);
  assert.equal(store.snapshot().sequence, 0);
}));

test('an INSTALL signature cannot be reused after the capability identity changes', () => temp(async dir => {
  const founder = pair(), executor = pair(), lib = await loadPinned(founder), store = await openStore(lib, join(dir, 'store'), founder), draft = proposal(lib, executor);
  const signature = approve(lib, draft, founder.privateKey);
  const changed = { ...draft, id: 'other-capability' };
  await assert.rejects(() => store.commit(changed, signature), /UNAUTHORIZED/);
  assert.equal(store.snapshot().sequence, 0);
}));

test('REUSE for an unknown capability ID is rejected without consuming the installed grant', () => temp(async dir => {
  const founder = pair(), executor = pair(), lib = await loadPinned(founder), store = await openStore(lib, join(dir, 'store'), founder);
  const draft = proposal(lib, executor, { nonce: 'install-nonce-000006', maxUses: 1 });
  await store.commit(draft, approve(lib, draft, founder.privateKey));
  const wrongId = { kind: 'REUSE', id: 'missing-capability', nonce: 'reuse-nonce-000006', input: 4, output: 16 };
  await assert.rejects(() => store.commit(wrongId, receipt(lib, wrongId, executor.privateKey)), /CAPABILITY_NOT_FOUND/);
  assert.equal(store.snapshot().capabilities[draft.id].uses, 0);
  assert.equal(store.snapshot().sequence, 1);
}));


test('concurrent independent store instances preserve a valid ledger and bounded use count', () => temp(async dir => {
  const founder = pair(), executor = pair(), lib = await loadPinned(founder), path = join(dir, 'store');
  const draft = proposal(lib, executor, { nonce: 'install-concurrent-0001', maxUses: 2 });
  const first = await openStore(lib, path, founder);
  await first.commit(draft, approve(lib, draft, founder.privateKey));
  const second = await openStore(lib, path, founder);
  const decisions = [
    { kind: 'REUSE', id: draft.id, nonce: 'reuse-concurrent-0001', input: 7, output: 49 },
    { kind: 'REUSE', id: draft.id, nonce: 'reuse-concurrent-0002', input: 8, output: 64 }
  ];
  const outcomes = await Promise.allSettled([
    first.commit(decisions[0], receipt(lib, decisions[0], executor.privateKey)),
    second.commit(decisions[1], receipt(lib, decisions[1], executor.privateKey))
  ]);
  const accepted = outcomes.filter(result => result.status === 'fulfilled').length;
  const rejected = outcomes.filter(result => result.status === 'rejected');
  assert.ok(accepted >= 1, 'at least one concurrent writer should commit');
  assert.ok(rejected.every(result => /LEDGER_LOCKED/.test(result.reason?.message ?? '')),
    'only explicit lock contention may reject a concurrent writer');
  for (let i = 0; i < outcomes.length; i++) {
    if (outcomes[i].status === 'rejected') {
      const store = i === 0 ? first : second;
      await store.commit(decisions[i], receipt(lib, decisions[i], executor.privateKey));
    }
  }
  const reopened = await openStore(lib, path, founder);
  assert.equal(reopened.snapshot().sequence, 3);
  assert.equal(reopened.snapshot().capabilities[draft.id].uses, 2);
  assert.deepEqual(reopened.snapshot().records.slice(1).map(record => record.decision.nonce).sort(),
    ['reuse-concurrent-0001', 'reuse-concurrent-0002']);
}));

test('stale lock fails closed and is not silently deleted as crash recovery', () => temp(async dir => {
  const founder = pair(), executor = pair(), lib = await loadPinned(founder), path = join(dir, 'store');
  const draft = proposal(lib, executor, { nonce: 'install-stale-lock-01', maxUses: 1 });
  const store = await openStore(lib, path, founder);
  await store.commit(draft, approve(lib, draft, founder.privateKey));
  const lockPath = join(path, 'institution.json.lock');
  const { writeFile, readFile } = await import('node:fs/promises');
  await writeFile(lockPath, 'simulated prior-process lock', { flag: 'wx', mode: 0o600 });
  const decision = { kind: 'REUSE', id: draft.id, nonce: 'reuse-stale-lock-01', input: 6, output: 36 };
  await assert.rejects(() => store.commit(decision, receipt(lib, decision, executor.privateKey)), /LEDGER_LOCKED/);
  assert.equal(await readFile(lockPath, 'utf8'), 'simulated prior-process lock');
  assert.equal(store.snapshot().sequence, 1);
}));


test('versioned implementation identities are stable semantic IDs, not source-text hashes', () => temp(async dir => {
  const founder = pair(), lib = await loadPinned(founder);
  assert.equal(lib.implementationHash('square'), createHash('sha256').update('ngl-experiment-001:strategy:square:v1').digest('hex'));
  assert.equal(lib.implementationHash('double'), createHash('sha256').update('ngl-experiment-001:strategy:double:v1').digest('hex'));
  assert.notEqual(lib.implementationHash('square'), lib.legacyImplementationHash('square'));
  assert.equal(lib.legacyImplementationHash('square'), createHash('sha256').update('function square(n) { return n * n; }').digest('hex'));
  assert.equal(lib.legacyImplementationHash('double'), createHash('sha256').update('function double(n) { return n * 2; }').digest('hex'));
}));

test('legacy source-hash ledger replays and reuses while new legacy INSTALL is rejected', () => temp(async dir => {
  const founder = pair(), executor = pair(), lib = await loadPinned(founder), path = join(dir, 'store');
  const draft = proposal(lib, executor, { id: 'legacy-square', nonce: 'install-legacy-record-01', maxUses: 2 });
  const legacyHash = lib.legacyImplementationHash(draft.strategy);
  draft.implementationHash = legacyHash;
  draft.proof = { ...draft.proof, implementationHash: legacyHash };
  const timestamp = Date.now();
  const signature = approve(lib, draft, founder.privateKey);
  const record = { sequence: 1, previous: 'GENESIS', timestamp, decision: draft, signature };
  record.hash = createHash('sha256').update(lib.canonical({
    sequence: record.sequence,
    previous: record.previous,
    timestamp: record.timestamp,
    decision: record.decision,
    signature: record.signature ?? null
  })).digest('hex');
  const legacyState = {
    version: 2,
    sequence: 1,
    previous: record.hash,
    records: [record],
    capabilities: {
      [draft.id]: {
        id: draft.id,
        strategy: draft.strategy,
        proof: draft.proof,
        implementationHash: legacyHash,
        installedAt: timestamp,
        issuedAt: draft.issuedAt,
        expiresAt: draft.expiresAt,
        maxUses: draft.maxUses,
        uses: 0,
        installationNonce: draft.nonce,
        executorPublicKeyPem: draft.executorPublicKeyPem
      }
    },
    used: [],
    installationNonces: [draft.nonce]
  };
  await mkdir(path, { recursive: true, mode: 0o700 });
  await writeFile(join(path, 'institution.json'), lib.canonical(legacyState), { mode: 0o600 });

  const store = await openStore(lib, path, founder);
  assert.equal(store.snapshot().sequence, 1);
  assert.equal(store.snapshot().capabilities[draft.id].implementationHash, legacyHash);

  const secondExecutor = pair();
  const newLegacyDraft = proposal(lib, secondExecutor, { id: 'legacy-new-install', nonce: 'install-legacy-new-0001', maxUses: 1 });
  newLegacyDraft.implementationHash = legacyHash;
  newLegacyDraft.proof = { ...newLegacyDraft.proof, implementationHash: legacyHash };
  await assert.rejects(() => store.commit(newLegacyDraft, approve(lib, newLegacyDraft, founder.privateKey)), /INSTALL_PROOF_INVALID/);
  assert.equal(store.snapshot().sequence, 1);

  const use = { kind: 'REUSE', id: draft.id, nonce: 'reuse-legacy-record-01', input: 3, output: 9 };
  await store.commit(use, receipt(lib, use, executor.privateKey));
  const reopened = await openStore(lib, path, founder);
  assert.equal(reopened.snapshot().sequence, 2);
  assert.equal(reopened.snapshot().capabilities[draft.id].uses, 1);
}));
