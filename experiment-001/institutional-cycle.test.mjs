import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign as signSignature } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
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

test('canonical rejects lossy JavaScript shapes without invoking getters', async () => {
  const lib = await loadPinned(pair());
  const hiddenObject = { visible: 1 };
  Object.defineProperty(hiddenObject, 'hidden', { value: 2, enumerable: false });
  const hiddenArray = [1];
  Object.defineProperty(hiddenArray, 'hidden', { value: 2, enumerable: false });
  const symbolObject = { visible: 1 };
  symbolObject[Symbol('unserialized')] = 2;
  const sparseArray = [];
  sparseArray.length = 1;
  const decoratedArray = [1];
  decoratedArray.extra = 2;
  let getterCalls = 0;
  const accessorObject = {};
  Object.defineProperty(accessorObject, 'value', {
    enumerable: true,
    get() { getterCalls++; return 1; }
  });

  for (const value of [hiddenObject, hiddenArray, symbolObject, sparseArray, decoratedArray, accessorObject]) {
    assert.throws(() => lib.canonical(value), /NON_CANONICAL_VALUE/);
  }
  assert.equal(getterCalls, 0, 'canonical validation must inspect descriptors, not execute accessors');
  assert.equal(lib.canonical({ z: 1, a: 2 }), '{"a":2,"z":1}');
  assert.equal(lib.canonical([1, { a: 2 }]), '[1,{"a":2}]');
});

test('commit rejects noncanonical original decisions before structuredClone can erase them', () => temp(async dir => {
  const founder = pair(), executor = pair(), lib = await loadPinned(founder);
  const store = await openStore(lib, join(dir, 'store'), founder);
  const hidden = proposal(lib, executor, { nonce: 'install-hidden-prop-0001' });
  const hiddenSignature = approve(lib, hidden, founder.privateKey);
  Object.defineProperty(hidden, 'notInSignature', { value: 'hidden payload', enumerable: false });
  await assert.rejects(() => store.commit(hidden, hiddenSignature), /NON_CANONICAL_VALUE/);
  assert.equal(store.snapshot().sequence, 0);

  const accessor = proposal(lib, executor, { nonce: 'install-accessor-0001' });
  const accessorSignature = approve(lib, accessor, founder.privateKey);
  let getterCalls = 0;
  Object.defineProperty(accessor, 'strategy', {
    enumerable: true,
    configurable: true,
    get() { getterCalls++; return 'square'; }
  });
  await assert.rejects(() => store.commit(accessor, accessorSignature), /NON_CANONICAL_VALUE/);
  assert.equal(getterCalls, 0);
  assert.equal(store.snapshot().sequence, 0, 'rejected decisions must not advance the ledger');
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

test('installation schema rejects NUL collisions, hidden keys, and accessors', async () => {
  const founder = pair(), executor = pair(), lib = await loadPinned(founder);

  const collision = proposal(lib, executor, { nonce: 'install-nul-collision-0001' });
  delete collision.expiresAt;
  delete collision.id;
  collision['expiresAt\0id'] = 'square-v1';
  assert.equal(lib.validateInstallationProposal(collision).reason, 'INSTALL_SCHEMA_INVALID');

  const hidden = proposal(lib, executor, { nonce: 'install-hidden-schema-0001' });
  Object.defineProperty(hidden, 'unlisted', { value: true, enumerable: false });
  assert.equal(lib.validateInstallationProposal(hidden).reason, 'INSTALL_SCHEMA_INVALID');

  const accessor = proposal(lib, executor, { nonce: 'install-accessor-schema-0001' });
  let getterCalls = 0;
  Object.defineProperty(accessor, 'id', {
    enumerable: true,
    configurable: true,
    get() { getterCalls++; return 'square-v1'; }
  });
  assert.equal(lib.validateInstallationProposal(accessor).reason, 'INSTALL_SCHEMA_INVALID');
  assert.equal(getterCalls, 0, 'schema validation must not execute accessor-backed fields');
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


test('directory-sync failure latches the live store and permits recovery only after validated reopen', () => temp(async dir => {
  const moduleUrl = new URL('./institutional-cycle.mjs', import.meta.url).href;
  const storePath = join(dir, 'uncertain-store');
  const script = [
    "import { open } from 'node:fs/promises';",
    "import { createHash, generateKeyPairSync, sign } from 'node:crypto';",
    "const founder = generateKeyPairSync('ed25519');",
    "const executor = generateKeyPairSync('ed25519');",
    "const publicPem = founder.publicKey.export({ type: 'spki', format: 'pem' }).toString();",
    "process.env.NGL_FOUNDER_KEY_FINGERPRINT = createHash('sha256').update(founder.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');",
    "const probe = await open(process.cwd(), 'r');",
    "const prototype = Object.getPrototypeOf(probe);",
    "await probe.close();",
    "const originalSync = prototype.sync;",
    "let injected = false;",
    "prototype.sync = async function (...args) { const stat = await this.stat(); if (!injected && stat.isDirectory()) { injected = true; const error = new Error('INJECTED_DIRECTORY_SYNC_FAILURE'); error.code = 'EIO'; throw error; } return originalSync.apply(this, args); };",
    "const lib = await import(" + JSON.stringify(moduleUrl) + " + '?fault=' + Date.now());",
    "const store = await lib.openInstitution(" + JSON.stringify(storePath) + ", publicPem);",
    "const proposal = lib.makeInstallationProposal({ executorPublicKeyPem: executor.publicKey.export({ type: 'spki', format: 'pem' }).toString(), nonce: 'install-fsync-fail-0001', issuedAt: Date.now(), expiresAt: Date.now() + 60000, maxUses: 2 });",
    "const signature = sign(null, Buffer.from(lib.approvalPayload(proposal)), founder.privateKey).toString('base64url');",
    "let firstError = null; try { await store.commit(proposal, signature); } catch (error) { firstError = error.message; }",
    "let snapshotError = null; try { store.snapshot(); } catch (error) { snapshotError = error.message; }",
    "const reuse = { kind: 'REUSE', id: proposal.id, nonce: 'reuse-after-fsync-fail-0001', input: 3, output: 9 };",
    "const receipt = sign(null, Buffer.from(lib.executionReceiptPayload(reuse)), executor.privateKey).toString('base64url');",
    "let secondError = null; try { await store.commit(reuse, receipt); } catch (error) { secondError = error.message; }",
    "const reopened = await lib.openInstitution(" + JSON.stringify(storePath) + ", publicPem);",
    "const reopenedSequence = reopened.snapshot().sequence;",
    "const recovery = { kind: 'REUSE', id: proposal.id, nonce: 'reuse-after-reopen-0001', input: 4, output: 16 };",
    "const recoveryReceipt = sign(null, Buffer.from(lib.executionReceiptPayload(recovery)), executor.privateKey).toString('base64url');",
    "let recoveryError = null; try { await reopened.commit(recovery, recoveryReceipt); } catch (error) { recoveryError = error.message; }",
    "const recoveredSequence = reopened.snapshot().sequence;",
    "console.log(JSON.stringify({ firstError, snapshotError, secondError, reopenedSequence, recoveryError, recoveredSequence, injected }));",
    "if (firstError !== 'COMMIT_DURABILITY_UNCERTAIN' || snapshotError !== 'COMMIT_DURABILITY_UNCERTAIN' || secondError !== 'COMMIT_DURABILITY_UNCERTAIN' || reopenedSequence !== 1 || recoveryError !== null || recoveredSequence !== 2 || !injected) process.exitCode = 1;"
  ].join('\n');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, NGL_FOUNDER_KEY_FINGERPRINT: '' }
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const outcome = JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1));
  assert.deepEqual(outcome, {
    firstError: 'COMMIT_DURABILITY_UNCERTAIN',
    snapshotError: 'COMMIT_DURABILITY_UNCERTAIN',
    secondError: 'COMMIT_DURABILITY_UNCERTAIN',
    reopenedSequence: 1,
    recoveryError: null,
    recoveredSequence: 2,
    injected: true
  });
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


test('two independent processes contend safely and preserve both INSTALL records', () => temp(async dir => {
  const founder = pair(), executorA = pair(), executorB = pair(), lib = await loadPinned(founder), path = join(dir, 'store');
  await openStore(lib, path, founder);
  const drafts = [
    proposal(lib, executorA, { id: 'process-install-a', nonce: 'install-process-a-0001', maxUses: 1 }),
    proposal(lib, executorB, { id: 'process-install-b', nonce: 'install-process-b-0001', maxUses: 1 })
  ];
  const signatures = drafts.map(draft => approve(lib, draft, founder.privateKey));
  const startWorker = index => {
    const child = spawn(process.execPath, [
      new URL('./commit-worker.mjs', import.meta.url).pathname,
      path,
      pem(founder),
      JSON.stringify(drafts[index]),
      signatures[index]
    ], {
      env: { ...process.env, NGL_FOUNDER_KEY_FINGERPRINT: fingerprint(founder) },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '', readySettled = false, resolveReady, rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const done = new Promise(resolve => {
      child.stdout.on('data', chunk => {
        stdout += chunk.toString();
        if (!readySettled && stdout.includes('READY\n')) {
          readySettled = true;
          resolveReady();
        }
      });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.once('error', error => {
        if (!readySettled) { readySettled = true; rejectReady(error); }
      });
      child.once('close', (code, signal) => {
        if (!readySettled) {
          readySettled = true;
          rejectReady(new Error('Worker exited before readiness: code=' + code + ' stderr=' + stderr + ' stdout=' + stdout));
        }
        resolve({ code, signal, stdout, stderr });
      });
    });
    return { child, ready, done };
  };

  const workers = [startWorker(0), startWorker(1)];
  await Promise.all(workers.map(worker => worker.ready));
  for (const worker of workers) worker.child.stdin.end('GO\n');
  const completed = await Promise.all(workers.map(worker => worker.done));
  const outcomes = completed.map((result, index) => {
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const lines = result.stdout.trim().split(/\r?\n/);
    return { ...JSON.parse(lines.at(-1)), index };
  });
  assert.ok(outcomes.every(outcome =>
    outcome.outcome === 'committed' ||
    (outcome.outcome === 'rejected' && outcome.error === 'LEDGER_LOCKED')
  ), JSON.stringify(outcomes));

  const rejected = outcomes.find(outcome => outcome.outcome === 'rejected');
  if (rejected) {
    const retry = startWorker(rejected.index);
    await retry.ready;
    retry.child.stdin.end('GO\n');
    const result = await retry.done;
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const retryOutcome = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(retryOutcome.outcome, 'committed', JSON.stringify(retryOutcome));
  }

  const reopened = await openStore(lib, path, founder);
  const snapshot = reopened.snapshot();
  assert.equal(snapshot.sequence, 2);
  assert.deepEqual(snapshot.records.map(record => record.decision.id).sort(), drafts.map(draft => draft.id).sort());
  assert.deepEqual(Object.keys(snapshot.capabilities).sort(), drafts.map(draft => draft.id).sort());
}));


test('ledger reader rejects a symlinked institution ledger before reading its target', () => temp(async dir => {
  const founder = pair(), lib = await loadPinned(founder), storeDir = join(dir, 'store');
  await mkdir(storeDir, { recursive: true, mode: 0o700 });
  const target = join(dir, 'target.json');
  await writeFile(target, '{}', { mode: 0o600 });
  await symlink(target, join(storeDir, 'institution.json'));
  await assert.rejects(() => openStore(lib, storeDir, founder), /LEDGER_NOT_REGULAR_FILE/);
}));

test('institution directory rejects a symlinked ancestor before creating the store path', () => temp(async dir => {
  const founder = pair(), lib = await loadPinned(founder);
  const targetParent = join(dir, 'real-parent');
  await mkdir(targetParent, { recursive: true, mode: 0o700 });
  const linkedParent = join(dir, 'linked-parent');
  await symlink(targetParent, linkedParent);
  const storeDir = join(linkedParent, 'nested', 'store');

  await assert.rejects(() => openStore(lib, storeDir, founder), /INSTITUTION_PATH_SYMLINK/);
  await assert.rejects(() => lstat(join(targetParent, 'nested')), { code: 'ENOENT' });
}));
