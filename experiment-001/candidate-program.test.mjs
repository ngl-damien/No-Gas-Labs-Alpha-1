import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  candidateProgramHash,
  evaluateCandidateProgram,
  validateCandidateProgram
} from './candidate-program.mjs';

const squareProgram = () => ({
  op: 'multiply',
  left: { op: 'input' },
  right: { op: 'input' }
});
const overfitProgram = () => ({
  op: 'add',
  left: squareProgram(),
  right: {
    op: 'multiply',
    left: {
      op: 'multiply',
      left: { op: 'subtract', left: { op: 'input' }, right: { op: 'const', value: 2 } },
      right: { op: 'subtract', left: { op: 'input' }, right: { op: 'const', value: 3 } }
    },
    right: {
      op: 'multiply',
      left: { op: 'subtract', left: { op: 'input' }, right: { op: 'const', value: 5 } },
      right: { op: 'add', left: { op: 'input' }, right: { op: 'const', value: 4 } }
    }
  }
});
const pair = () => generateKeyPairSync('ed25519');
const pem = key => key.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const fingerprint = key => createHash('sha256')
  .update(createPublicKey(pem(key)).export({ type: 'spki', format: 'der' }))
  .digest('hex');

async function loadPinned(founder) {
  const previous = process.env.NGL_FOUNDER_KEY_FINGERPRINT;
  process.env.NGL_FOUNDER_KEY_FINGERPRINT = fingerprint(founder);
  try {
    return await import('./institutional-cycle.mjs?candidate-program=' + randomUUID());
  } finally {
    if (previous === undefined) delete process.env.NGL_FOUNDER_KEY_FINGERPRINT;
    else process.env.NGL_FOUNDER_KEY_FINGERPRINT = previous;
  }
}

async function withTemp(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-candidate-program-'));
  try { await fn(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('candidate AST computes the square contract without evaluating JavaScript source', () => {
  const program = squareProgram();
  assert.deepEqual(validateCandidateProgram(program), program);
  for (const [input, expected] of [[-4, 16], [0, 0], [1, 1], [5, 25]]) {
    assert.equal(evaluateCandidateProgram(program, input), expected);
  }
  const expectedHash = createHash('sha256')
    .update('ngl-experiment-001:candidate-program:v1\n' + JSON.stringify(program))
    .digest('hex');
  assert.equal(candidateProgramHash(program), expectedHash);
  assert.notEqual(candidateProgramHash(program), candidateProgramHash({
    op: 'multiply', left: { op: 'input' }, right: { op: 'const', value: 2 }
  }));
});

test('candidate-program-v2 rejects an arithmetic interpolant that passes every v1 challenge case', async () => {
  const founder = pair();
  const lib = await loadPinned(founder);
  const program = overfitProgram();
  const v1 = lib.challenge('candidate-program-v1', program);
  const v2 = lib.challenge('candidate-program-v2', program);
  const squareV2 = lib.challenge('candidate-program-v2', squareProgram());

  assert.deepEqual([v1.total, v1.passed], [4, 4]);
  assert.equal(v2.total, 15);
  assert.equal(v2.passed, 4);
  assert.equal(v2.failed.length, 11);
  assert.ok(v2.failed.includes(0), 'the wider suite must challenge points outside the four v1 examples');
  assert.ok(v2.failed.includes(1_000_000), 'the wider suite must challenge the declared input boundary');
  assert.equal(squareV2.passed, squareV2.total);
  assert.notEqual(v1.implementationHash, v2.implementationHash, 'proof versions must have distinct implementation identities');
});

test('candidate AST rejects accessors, hidden properties, symbols, and custom prototypes', () => {
  let getterCalls = 0;
  const accessor = { op: 'input' };
  Object.defineProperty(accessor, 'extra', {
    enumerable: true,
    get() { getterCalls += 1; return 1; }
  });
  const hidden = { op: 'input' };
  Object.defineProperty(hidden, 'hidden', { value: true, enumerable: false });
  const symbolic = { op: 'input', [Symbol('unserialized')]: true };
  const inherited = Object.assign(Object.create({ op: 'input' }), {});
  for (const value of [accessor, hidden, symbolic, inherited]) {
    assert.throws(() => validateCandidateProgram(value), /CANDIDATE_PROGRAM_INVALID/);
  }
  assert.equal(getterCalls, 0, 'validation must inspect descriptors without invoking getters');
});

test('candidate AST rejects unknown operators, excessive depth, and unsafe arithmetic', () => {
  assert.throws(() => validateCandidateProgram({ op: 'eval', source: 'process.exit()' }),
    /CANDIDATE_PROGRAM_INVALID/);
  let deep = { op: 'input' };
  for (let i = 0; i < 14; i += 1) deep = { op: 'negate', arg: deep };
  assert.throws(() => validateCandidateProgram(deep), /CANDIDATE_PROGRAM_LIMIT_EXCEEDED/);
  const huge = {
    op: 'multiply',
    left: { op: 'multiply', left: { op: 'input' }, right: { op: 'input' } },
    right: { op: 'multiply', left: { op: 'input' }, right: { op: 'input' } }
  };
  assert.throws(() => evaluateCandidateProgram(huge, 1_000_000), /CANDIDATE_RESULT_OUT_OF_BOUNDS/);
  assert.throws(() => evaluateCandidateProgram({ op: 'input' }, 1_000_001),
    /CANDIDATE_INPUT_OUT_OF_BOUNDS/);
});

test('signed candidate program is challenged, persisted, and reused by a fresh process', () => withTemp(async directory => {
  const founder = pair();
  const executor = pair();
  const lib = await loadPinned(founder);
  const storePath = join(directory, 'store');
  const draft = lib.makeInstallationProposal({
    id: 'candidate-square-v1',
    strategy: 'candidate-program-v1',
    program: squareProgram(),
    executorPublicKeyPem: pem(executor),
    nonce: 'install-candidate-program-01',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    maxUses: 1
  });
  assert.equal(draft.proof.passed, draft.proof.total);
  assert.equal(draft.proof.total, 4);
  assert.equal(draft.implementationHash, candidateProgramHash(draft.program));

  const store = await lib.openInstitution(storePath, pem(founder));
  await store.commit(draft, sign(null, Buffer.from(lib.approvalPayload(draft)), founder.privateKey).toString('base64url'));

  const use = { kind: 'REUSE', id: draft.id, nonce: 'reuse-candidate-program-01', input: 9, output: 81 };
  const receipt = sign(null, Buffer.from(lib.executionReceiptPayload(use)), executor.privateKey).toString('base64url');
  const workerPath = new URL('./reuse-worker.mjs', import.meta.url).pathname;
  const child = spawnSync(process.execPath, [
    workerPath, storePath, pem(founder), JSON.stringify(use), receipt
  ], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, NGL_FOUNDER_KEY_FINGERPRINT: fingerprint(founder) }
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const snapshot = JSON.parse(child.stdout.trim());
  assert.equal(snapshot.sequence, 2);
  assert.equal(snapshot.capabilities[draft.id].uses, 1);
  assert.deepEqual(snapshot.capabilities[draft.id].program, draft.program);

  const reopened = await lib.openInstitution(storePath, pem(founder));
  assert.equal(reopened.snapshot().sequence, 2);
  assert.equal(reopened.snapshot().capabilities[draft.id].implementationHash, draft.implementationHash);
}));

test('signed candidate-program-v2 INSTALL is reusable after a fresh-process restart', () => withTemp(async directory => {
  const founder = pair();
  const executor = pair();
  const lib = await loadPinned(founder);
  const issuedAt = Date.now();
  const draft = lib.makeInstallationProposal({
    id: 'candidate-square-v2',
    strategy: 'candidate-program-v2',
    program: squareProgram(),
    executorPublicKeyPem: pem(executor),
    nonce: 'install-candidate-program-v2',
    issuedAt,
    expiresAt: issuedAt + 60_000,
    maxUses: 1
  });
  assert.equal(draft.proof.total, 15);
  assert.equal(draft.proof.passed, 15);
  assert.equal(lib.validateInstallationProposal(draft).valid, true);

  const storePath = join(directory, 'store-v2');
  const store = await lib.openInstitution(storePath, pem(founder));
  const signature = sign(null, Buffer.from(lib.approvalPayload(draft)), founder.privateKey).toString('base64url');
  await store.commit(draft, signature);

  const use = { kind: 'REUSE', id: draft.id, nonce: 'reuse-candidate-program-v2', input: -17, output: 289 };
  const receipt = sign(null, Buffer.from(lib.executionReceiptPayload(use)), executor.privateKey).toString('base64url');
  const workerPath = new URL('./reuse-worker.mjs', import.meta.url).pathname;
  const child = spawnSync(process.execPath, [
    workerPath, storePath, pem(founder), JSON.stringify(use), receipt
  ], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, NGL_FOUNDER_KEY_FINGERPRINT: fingerprint(founder) }
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const snapshot = JSON.parse(child.stdout.trim());
  assert.equal(snapshot.sequence, 2);
  assert.equal(snapshot.capabilities[draft.id].strategy, 'candidate-program-v2');
  assert.equal(snapshot.capabilities[draft.id].uses, 1);
  assert.deepEqual(snapshot.capabilities[draft.id].program, draft.program);
  assert.equal(snapshot.capabilities[draft.id].implementationHash, draft.implementationHash);

  const reopened = await lib.openInstitution(storePath, pem(founder));
  assert.equal(reopened.snapshot().sequence, 2);
  assert.equal(reopened.snapshot().capabilities[draft.id].strategy, 'candidate-program-v2');
  assert.equal(reopened.snapshot().capabilities[draft.id].implementationHash, draft.implementationHash);
}));

test('changing a candidate program after approval cannot install the altered capability', () => withTemp(async directory => {
  const founder = pair();
  const executor = pair();
  const lib = await loadPinned(founder);
  const store = await lib.openInstitution(join(directory, 'store'), pem(founder));
  const draft = lib.makeInstallationProposal({
    id: 'candidate-square-tamper-v1',
    strategy: 'candidate-program-v1',
    program: squareProgram(),
    executorPublicKeyPem: pem(executor),
    nonce: 'install-candidate-tamper-01',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    maxUses: 1
  });
  const signature = sign(null, Buffer.from(lib.approvalPayload(draft)), founder.privateKey).toString('base64url');
  const altered = structuredClone(draft);
  altered.program.right = { op: 'const', value: 2 };
  await assert.rejects(() => store.commit(altered, signature), /UNAUTHORIZED/);
  assert.equal(store.snapshot().sequence, 0);
}));


test('candidate challenge converts arithmetic overflow into failed cases and rejects installation', async () => {
  const founder = pair();
  const executor = pair();
  const lib = await loadPinned(founder);
  const overflowingProgram = {
    op: 'multiply',
    left: { op: 'const', value: 1_000_000 },
    right: {
      op: 'multiply',
      left: { op: 'const', value: 1_000_000 },
      right: { op: 'const', value: 1_000_000 }
    }
  };
  const proof = lib.challenge('candidate-program-v1', overflowingProgram);
  assert.equal(proof.passed, 0);
  assert.equal(proof.failed.length, proof.total);
  const draft = lib.makeInstallationProposal({
    id: 'candidate-overflow-v1',
    strategy: 'candidate-program-v1',
    program: overflowingProgram,
    executorPublicKeyPem: pem(executor),
    nonce: 'install-candidate-overflow-01',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    maxUses: 1
  });
  assert.equal(lib.validateInstallationProposal(draft).valid, false);
  assert.equal(lib.validateInstallationProposal(draft).reason, 'INSTALL_PROOF_INVALID');
});


test('candidate AST enforces the exact 63-node budget before evaluation', () => {
  function balanced(depth) {
    if (depth === 0) return { op: 'const', value: 0 };
    return { op: 'add', left: balanced(depth - 1), right: balanced(depth - 1) };
  }
  const atLimit = balanced(5);
  assert.equal(evaluateCandidateProgram(atLimit, 0), 0);
  const overLimit = { op: 'negate', arg: atLimit };
  assert.throws(() => validateCandidateProgram(overLimit), /CANDIDATE_PROGRAM_LIMIT_EXCEEDED/);
});


test('candidate AST payload is required only for the candidate-program strategy', async () => {
  const founder = pair();
  const executor = pair();
  const lib = await loadPinned(founder);

  assert.throws(() => lib.makeInstallationProposal({
    strategy: 'candidate-program-v1',
    executorPublicKeyPem: pem(executor)
  }), /CANDIDATE_PROGRAM_INVALID/);

  assert.throws(() => lib.makeInstallationProposal({
    strategy: 'candidate-program-v2',
    executorPublicKeyPem: pem(executor)
  }), /CANDIDATE_PROGRAM_INVALID/);

  assert.throws(() => lib.makeInstallationProposal({
    strategy: 'square',
    program: squareProgram(),
    executorPublicKeyPem: pem(executor)
  }), /PROGRAM_NOT_ALLOWED_FOR_STRATEGY/);

  const square = lib.makeInstallationProposal({ executorPublicKeyPem: pem(executor) });
  const smuggledProgram = { ...square, program: squareProgram() };
  assert.deepEqual(lib.validateInstallationProposal(smuggledProgram), {
    valid: false,
    reason: 'INSTALL_SCHEMA_INVALID'
  });

  const candidate = lib.makeInstallationProposal({
    strategy: 'candidate-program-v1',
    program: squareProgram(),
    executorPublicKeyPem: pem(executor)
  });
  const missingProgram = { ...candidate };
  delete missingProgram.program;
  assert.deepEqual(lib.validateInstallationProposal(missingProgram), {
    valid: false,
    reason: 'INSTALL_SCHEMA_INVALID'
  });
});
