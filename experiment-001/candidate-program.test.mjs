import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  candidateProgramHash,
  candidateTaskSpecificationDigest,
  evaluateCandidateProgram,
  validateCandidateProgram,
  validateCandidateTaskSpecification
} from './candidate-program.mjs';

const squareProgram = () => ({
  op: 'multiply',
  left: { op: 'input' },
  right: { op: 'input' }
});
const factoredSquareProgram = () => ({
  op: 'add',
  left: {
    op: 'multiply',
    left: { op: 'add', left: { op: 'input' }, right: { op: 'const', value: 1 } },
    right: { op: 'subtract', left: { op: 'input' }, right: { op: 'const', value: 1 } }
  },
  right: { op: 'const', value: 1 }
});
const quadraticTargetProgram = () => ({
  op: 'add',
  left: {
    op: 'subtract',
    left: { op: 'multiply', left: { op: 'const', value: 2 }, right: squareProgram() },
    right: { op: 'multiply', left: { op: 'const', value: 3 }, right: { op: 'input' } }
  },
  right: { op: 'const', value: 7 }
});
const callerDefinedTaskSpecification = () => ({
  schema: 'ngl.candidate-task-spec.v1',
  id: 'ngl.experiment-001.task:quadratic-3x2-plus-2x-minus-5:v1',
  inputMin: -1_000_000,
  inputMax: 1_000_000,
  proofMethod: 'exact-integer-polynomial-normal-form',
  limits: {
    maxAstDepth: 12,
    maxAstNodes: 63,
    maxPolynomialDegree: 32,
    maxCoefficientBits: 4096,
    maxSafeInteger: Number.MAX_SAFE_INTEGER
  },
  targetCoefficients: ['-5', '2', '3']
});
const callerDefinedTaskProgram = () => ({
  op: 'add',
  left: {
    op: 'add',
    left: { op: 'multiply', left: { op: 'const', value: 3 }, right: squareProgram() },
    right: { op: 'multiply', left: { op: 'const', value: 2 }, right: { op: 'input' } }
  },
  right: { op: 'const', value: -5 }
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

  const executor = pair();
  const invalidProposal = lib.makeInstallationProposal({
    id: 'candidate-overfit-v2',
    strategy: 'candidate-program-v2',
    program,
    executorPublicKeyPem: pem(executor)
  });
  assert.deepEqual(lib.validateInstallationProposal(invalidProposal, Date.now(), { allowLegacy: true }), {
    valid: false,
    reason: 'INSTALL_PROOF_INVALID'
  }, 'candidate v2 must not fall through to the built-in legacy proof path');
});

test('candidate-program-v3 proves exact polynomial equivalence and rejects unsupported or unsafe forms', async () => {
  const lib = await loadPinned(pair());
  const equivalent = factoredSquareProgram();
  const proof = lib.challenge('candidate-program-v3', equivalent);
  assert.equal(proof.total, 1);
  assert.equal(proof.passed, 1);
  assert.deepEqual(proof.failed, []);
  assert.equal(proof.implementationHash, candidateProgramHash(equivalent, 'v3'));
  assert.deepEqual(proof.certificate.coefficients, ['0', '0', '1']);
  assert.equal(proof.certificate.method, 'exact-integer-polynomial-normal-form');
  assert.equal(proof.certificate.inputMin, -1_000_000);
  assert.equal(proof.certificate.inputMax, 1_000_000);
  assert.deepEqual(proof.certificate.limits, {
    maxAstDepth: 12,
    maxAstNodes: 63,
    maxPolynomialDegree: 32,
    maxCoefficientBits: 4096,
    maxSafeInteger: Number.MAX_SAFE_INTEGER
  });
  assert.equal(proof.certificate.maxIntermediateAbsoluteBound, '1000000000001');
  assert.equal(proof.certificate.matchesSquare, true);
  const doubleNegated = lib.challenge('candidate-program-v3', {
    op: 'negate', arg: { op: 'negate', arg: equivalent }
  });
  assert.equal(doubleNegated.passed, 1);
  assert.deepEqual(doubleNegated.certificate.coefficients, ['0', '0', '1']);
  assert.notEqual(candidateProgramHash(equivalent, 'v2'), candidateProgramHash(equivalent, 'v3'));
  for (const input of [-1_000_000, -17, 0, 17, 1_000_000]) {
    assert.equal(evaluateCandidateProgram(equivalent, input), input * input);
  }

  const nonSquare = {
    op: 'add',
    left: squareProgram(),
    right: { op: 'const', value: 1 }
  };
  const mismatch = lib.challenge('candidate-program-v3', nonSquare);
  assert.equal(mismatch.passed, 0);
  assert.deepEqual(mismatch.failed, ['POLYNOMIAL_NOT_SQUARE']);
  assert.deepEqual(mismatch.certificate.coefficients, ['1', '0', '1']);

  const nonPolynomial = lib.challenge('candidate-program-v3', {
    op: 'abs', arg: { op: 'input' }
  });
  assert.equal(nonPolynomial.passed, 0);
  assert.deepEqual(nonPolynomial.failed, ['CANDIDATE_PROOF_UNSUPPORTED_OPERATOR']);

  const square = () => ({
    op: 'multiply', left: { op: 'input' }, right: { op: 'input' }
  });
  const fourthPower = () => ({
    op: 'multiply', left: square(), right: square()
  });
  const unsafeIntermediate = lib.challenge('candidate-program-v3', {
    op: 'add',
    left: { op: 'subtract', left: fourthPower(), right: fourthPower() },
    right: square()
  });
  assert.equal(unsafeIntermediate.passed, 0);
  assert.deepEqual(unsafeIntermediate.failed, ['CANDIDATE_PROOF_INTERMEDIATE_OUT_OF_BOUNDS']);

  const executor = pair();
  const rejected = lib.makeInstallationProposal({
    id: 'candidate-nonsquare-v3',
    strategy: 'candidate-program-v3',
    program: nonSquare,
    executorPublicKeyPem: pem(executor)
  });
  assert.equal(lib.validateInstallationProposal(rejected, Date.now(), { allowLegacy: true }).reason,
    'INSTALL_PROOF_INVALID');
});

test('signed candidate-program-v3 proof is reusable after a fresh-process restart', () => withTemp(async directory => {
  const founder = pair();
  const executor = pair();
  const lib = await loadPinned(founder);
  const issuedAt = Date.now();
  const program = factoredSquareProgram();
  const draft = lib.makeInstallationProposal({
    id: 'candidate-square-v3',
    strategy: 'candidate-program-v3',
    program,
    executorPublicKeyPem: pem(executor),
    nonce: 'install-candidate-program-v3',
    issuedAt,
    expiresAt: issuedAt + 60_000,
    maxUses: 1
  });
  assert.equal(draft.proof.total, 1);
  assert.equal(draft.proof.passed, 1);
  assert.deepEqual(draft.proof.certificate.coefficients, ['0', '0', '1']);
  assert.equal(draft.implementationHash, candidateProgramHash(program, 'v3'));

  const storePath = join(directory, 'store-v3');
  const store = await lib.openInstitution(storePath, pem(founder));
  const signature = sign(null, Buffer.from(lib.approvalPayload(draft)), founder.privateKey).toString('base64url');
  await store.commit(draft, signature);

  const use = { kind: 'REUSE', id: draft.id, nonce: 'reuse-candidate-program-v3', input: -17, output: 289 };
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
  assert.equal(snapshot.capabilities[draft.id].strategy, 'candidate-program-v3');
  assert.equal(snapshot.capabilities[draft.id].uses, 1);
  assert.deepEqual(snapshot.capabilities[draft.id].program, program);
  assert.deepEqual(snapshot.capabilities[draft.id].proof, draft.proof,
    'the signed symbolic certificate must survive fresh-process ledger replay');
  assert.equal(snapshot.capabilities[draft.id].implementationHash, draft.implementationHash);

  const reopened = await lib.openInstitution(storePath, pem(founder));
  assert.equal(reopened.snapshot().sequence, 2);
  assert.equal(reopened.snapshot().capabilities[draft.id].strategy, 'candidate-program-v3');
  assert.deepEqual(reopened.snapshot().capabilities[draft.id].proof, draft.proof);
  assert.equal(reopened.snapshot().capabilities[draft.id].implementationHash, draft.implementationHash);
}));

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
    strategy: 'candidate-program-v4',
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

test('candidate-program-v3 INSTALL rejects a signed certificate that widens its domain or resource limits', () => withTemp(async directory => {
  const founder = pair();
  const executor = pair();
  const lib = await loadPinned(founder);
  const issuedAt = Date.now();
  const draft = lib.makeInstallationProposal({
    id: 'candidate-square-v3-tampered-certificate',
    strategy: 'candidate-program-v3',
    program: factoredSquareProgram(),
    executorPublicKeyPem: pem(executor),
    nonce: 'install-v3-cert-tamper-0001',
    issuedAt,
    expiresAt: issuedAt + 60_000,
    maxUses: 1
  });

  // Even a valid signature over an altered certificate must not redefine the
  // verifier's declared input domain or resource budget.
  const tampered = structuredClone(draft);
  tampered.proof.certificate.inputMax = 1_000_001;
  tampered.proof.certificate.limits.maxAstNodes = 64;

  assert.deepEqual(lib.validateInstallationProposal(tampered), {
    valid: false,
    reason: 'INSTALL_PROOF_INVALID'
  });

  const store = await lib.openInstitution(join(directory, 'store-v3-tampered-certificate'), pem(founder));
  const signature = sign(null, Buffer.from(lib.approvalPayload(tampered)), founder.privateKey).toString('base64url');
  await assert.rejects(() => store.commit(tampered, signature), /INSTALL_PROOF_INVALID/);
  assert.equal(store.snapshot().sequence, 0, 'a signed but inconsistent proof certificate must not advance the ledger');
}));

const piecewiseOverfitProgram = () => ({
  op: 'add',
  left: squareProgram(),
  right: {
    op: 'max',
    left: { op: 'const', value: 0 },
    right: {
      op: 'subtract',
      left: { op: 'const', value: 1 },
      right: {
        op: 'abs',
        arg: { op: 'subtract', left: { op: 'input' }, right: { op: 'const', value: 42 } }
      }
    }
  }
});

test('candidate-program-v2 finite suite is overfit by a bounded piecewise bump that v3 conservatively rejects', async () => {
  const lib = await loadPinned(pair());
  const program = piecewiseOverfitProgram();
  const v2 = lib.challenge('candidate-program-v2', program);

  // max(0, 1 - abs(x - 42)) is zero at every one of the 15 v2
  // challenge inputs, but changes the result at x=42.
  assert.equal(v2.total, 15);
  assert.equal(v2.passed, 15);
  assert.deepEqual(v2.failed, []);
  assert.equal(evaluateCandidateProgram(program, 41), 41 * 41);
  assert.equal(evaluateCandidateProgram(program, 42), 42 * 42 + 1);

  const v3 = lib.challenge('candidate-program-v3', program);
  assert.equal(v3.passed, 0);
  assert.deepEqual(v3.failed, ['CANDIDATE_PROOF_UNSUPPORTED_OPERATOR'],
    'v3 must reject the non-polynomial abs/max proof language instead of treating finite samples as equivalence');
});


test('candidate-program-v4 proves a second fixed quadratic target with exact coefficients', async () => {
  const lib = await loadPinned(pair());
  const program = quadraticTargetProgram();
  const proof = lib.challenge('candidate-program-v4', program);

  assert.equal(proof.total, 1);
  assert.equal(proof.passed, 1);
  assert.deepEqual(proof.failed, []);
  assert.equal(proof.implementationHash, candidateProgramHash(program, 'v4'));
  assert.equal(proof.certificate.schema, 'ngl.candidate-program-proof.v2');
  assert.equal(proof.certificate.target, 'ngl.experiment-001.target:quadratic-2x2-minus-3x-plus-7:v1');
  assert.equal(proof.certificate.method, 'exact-integer-polynomial-normal-form');
  assert.deepEqual(proof.certificate.coefficients, ['7', '-3', '2']);
  assert.deepEqual(proof.certificate.targetCoefficients, ['7', '-3', '2']);
  assert.equal(proof.certificate.maxIntermediateAbsoluteBound, '2000003000007');
  assert.equal(proof.certificate.matchesTarget, true);

  for (const input of [-1_000_000, -17, 0, 17, 1_000_000]) {
    assert.equal(evaluateCandidateProgram(program, input), 2 * input * input - 3 * input + 7);
  }

  const nearMiss = structuredClone(program);
  nearMiss.right.value = 8;
  const mismatch = lib.challenge('candidate-program-v4', nearMiss);
  assert.equal(mismatch.passed, 0);
  assert.deepEqual(mismatch.failed, ['POLYNOMIAL_NOT_TARGET']);
  assert.deepEqual(mismatch.certificate.coefficients, ['8', '-3', '2']);

  const unsupported = lib.challenge('candidate-program-v4', piecewiseOverfitProgram());
  assert.equal(unsupported.passed, 0);
  assert.deepEqual(unsupported.failed, ['CANDIDATE_PROOF_UNSUPPORTED_OPERATOR']);
});

test('signed candidate-program-v4 INSTALL is reusable after a fresh-process restart', () => withTemp(async directory => {
  const founder = pair();
  const executor = pair();
  const lib = await loadPinned(founder);
  const issuedAt = Date.now();
  const draft = lib.makeInstallationProposal({
    id: 'candidate-quadratic-v4',
    strategy: 'candidate-program-v4',
    program: quadraticTargetProgram(),
    executorPublicKeyPem: pem(executor),
    nonce: 'install-candidate-program-v4',
    issuedAt,
    expiresAt: issuedAt + 5 * 60_000,
    maxUses: 1
  });
  assert.equal(draft.proof.total, 1);
  assert.equal(draft.proof.passed, 1);
  assert.equal(lib.validateInstallationProposal(draft).valid, true);

  const storePath = join(directory, 'store-v4');
  const store = await lib.openInstitution(storePath, pem(founder));
  const signature = sign(null, Buffer.from(lib.approvalPayload(draft)), founder.privateKey).toString('base64url');
  await store.commit(draft, signature);

  const use = { kind: 'REUSE', id: draft.id, nonce: 'reuse-candidate-program-v4', input: -17, output: 636 };
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
  assert.equal(snapshot.capabilities[draft.id].strategy, 'candidate-program-v4');
  assert.equal(snapshot.capabilities[draft.id].uses, 1);
  assert.deepEqual(snapshot.capabilities[draft.id].program, draft.program);
  assert.equal(snapshot.capabilities[draft.id].implementationHash, draft.implementationHash);

  const reopened = await lib.openInstitution(storePath, pem(founder));
  assert.equal(reopened.snapshot().sequence, 2);
  assert.equal(reopened.snapshot().capabilities[draft.id].strategy, 'candidate-program-v4');
  assert.equal(reopened.snapshot().capabilities[draft.id].implementationHash, draft.implementationHash);
}));

test('candidate-program-v4 INSTALL rejects a signed certificate that changes the verifier target', () => withTemp(async directory => {
  const founder = pair();
  const executor = pair();
  const lib = await loadPinned(founder);
  const issuedAt = Date.now();
  const draft = lib.makeInstallationProposal({
    id: 'candidate-quadratic-v4-tampered',
    strategy: 'candidate-program-v4',
    program: quadraticTargetProgram(),
    executorPublicKeyPem: pem(executor),
    nonce: 'install-candidate-program-v4-tamper',
    issuedAt,
    expiresAt: issuedAt + 5 * 60_000,
    maxUses: 1
  });

  const tampered = structuredClone(draft);
  tampered.proof.certificate.targetCoefficients[0] = '8';
  tampered.proof.certificate.target = 'ngl.experiment-001.target:attacker-controlled:v1';

  assert.deepEqual(lib.validateInstallationProposal(tampered), {
    valid: false,
    reason: 'INSTALL_PROOF_INVALID'
  });

  const store = await lib.openInstitution(join(directory, 'store-v4-tampered'), pem(founder));
  const signature = sign(null, Buffer.from(lib.approvalPayload(tampered)), founder.privateKey).toString('base64url');
  await assert.rejects(() => store.commit(tampered, signature), /INSTALL_PROOF_INVALID/);
  assert.equal(store.snapshot().sequence, 0);
}));


test('candidate task specifications are exact, canonical, and verifier-bounded', () => {
  const specification = callerDefinedTaskSpecification();
  const normalized = validateCandidateTaskSpecification(specification);
  assert.deepEqual(normalized, specification);
  assert.equal(candidateTaskSpecificationDigest(specification), candidateTaskSpecificationDigest({
    targetCoefficients: [...specification.targetCoefficients],
    limits: { ...specification.limits },
    proofMethod: specification.proofMethod,
    inputMax: specification.inputMax,
    inputMin: specification.inputMin,
    id: specification.id,
    schema: specification.schema
  }), 'field ordering must not change the task identity');

  const widened = structuredClone(specification);
  widened.limits.maxAstNodes = 64;
  assert.throws(() => validateCandidateTaskSpecification(widened), /CANDIDATE_TASK_SPEC_INVALID/);
  const nonCanonical = structuredClone(specification);
  nonCanonical.targetCoefficients[0] = '-05';
  assert.throws(() => validateCandidateTaskSpecification(nonCanonical), /CANDIDATE_TASK_SPEC_INVALID/);
  const trailingZero = structuredClone(specification);
  trailingZero.targetCoefficients.push('0');
  assert.throws(() => validateCandidateTaskSpecification(trailingZero), /CANDIDATE_TASK_SPEC_INVALID/);
  const outOfRange = structuredClone(specification);
  outOfRange.targetCoefficients = ['9007199254740992'];
  assert.throws(() => validateCandidateTaskSpecification(outOfRange), /CANDIDATE_TASK_SPEC_INVALID/);

  let getterCalls = 0;
  const accessor = { ...specification };
  Object.defineProperty(accessor, 'id', {
    enumerable: true,
    configurable: true,
    get() { getterCalls += 1; return specification.id; }
  });
  assert.throws(() => validateCandidateTaskSpecification(accessor), /CANDIDATE_TASK_SPEC_INVALID/);
  assert.equal(getterCalls, 0, 'task-spec validation must not execute accessor-backed fields');
});

test('candidate-program-v5 proves a separately Founder-signed caller-defined polynomial task', async () => {
  const founder = pair();
  const lib = await loadPinned(founder);
  const specification = callerDefinedTaskSpecification();
  const program = callerDefinedTaskProgram();
  const specificationSignature = sign(
    null,
    Buffer.from(lib.candidateTaskSpecificationPayload(specification)),
    founder.privateKey
  ).toString('base64url');

  const proof = lib.challenge('candidate-program-v5', program, specification);
  assert.equal(proof.total, 1);
  assert.equal(proof.passed, 1);
  assert.deepEqual(proof.failed, []);
  assert.equal(proof.certificate.schema, 'ngl.candidate-program-proof.v3');
  assert.equal(proof.certificate.taskSpecificationId, specification.id);
  assert.equal(proof.certificate.taskSpecificationDigest, candidateTaskSpecificationDigest(specification));
  assert.deepEqual(proof.certificate.coefficients, ['-5', '2', '3']);
  assert.deepEqual(proof.certificate.targetCoefficients, ['-5', '2', '3']);
  assert.equal(proof.certificate.maxIntermediateAbsoluteBound, '3000002000005');
  assert.equal(proof.certificate.matchesTask, true);

  const nearMiss = structuredClone(program);
  nearMiss.right.value = -4;
  const mismatch = lib.challenge('candidate-program-v5', nearMiss, specification);
  assert.equal(mismatch.passed, 0);
  assert.deepEqual(mismatch.failed, ['POLYNOMIAL_NOT_TASK']);

  const unsupported = lib.challenge('candidate-program-v5', piecewiseOverfitProgram(), specification);
  assert.equal(unsupported.passed, 0);
  assert.deepEqual(unsupported.failed, ['CANDIDATE_PROOF_UNSUPPORTED_OPERATOR']);

  const executor = pair();
  const draft = lib.makeInstallationProposal({
    id: 'candidate-task-v5',
    strategy: 'candidate-program-v5',
    program,
    taskSpecification: specification,
    taskSpecificationSignature: specificationSignature,
    executorPublicKeyPem: pem(executor),
    nonce: 'install-candidate-task-v5',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 5 * 60_000,
    maxUses: 1
  });
  assert.equal(draft.implementationHash, candidateProgramHash(program, 'v5', specification));
  assert.equal(lib.validateInstallationProposal(draft, Date.now(), {
    founderPublicKey: createPublicKey(pem(founder))
  }).valid, true);
  assert.deepEqual(lib.validateInstallationProposal(draft), {
    valid: false,
    reason: 'CANDIDATE_TASK_SPEC_SIGNATURE_INVALID'
  }, 'the task spec must be checked against the configured Founder key, not a caller-selected key');
});

test('signed candidate-program-v5 INSTALL persists its trusted task spec across a fresh-process REUSE', () => withTemp(async directory => {
  const founder = pair();
  const executor = pair();
  const lib = await loadPinned(founder);
  const specification = callerDefinedTaskSpecification();
  const specificationSignature = sign(
    null,
    Buffer.from(lib.candidateTaskSpecificationPayload(specification)),
    founder.privateKey
  ).toString('base64url');
  const issuedAt = Date.now();
  const draft = lib.makeInstallationProposal({
    id: 'candidate-task-v5-restart',
    strategy: 'candidate-program-v5',
    program: callerDefinedTaskProgram(),
    taskSpecification: specification,
    taskSpecificationSignature: specificationSignature,
    executorPublicKeyPem: pem(executor),
    nonce: 'install-candidate-task-v5-restart',
    issuedAt,
    expiresAt: issuedAt + 5 * 60_000,
    maxUses: 1
  });
  assert.equal(draft.proof.passed, 1);
  assert.equal(lib.validateInstallationProposal(draft, Date.now(), {
    founderPublicKey: createPublicKey(pem(founder))
  }).valid, true);

  const storePath = join(directory, 'store-v5');
  const store = await lib.openInstitution(storePath, pem(founder));
  await store.commit(draft, sign(
    null,
    Buffer.from(lib.approvalPayload(draft)),
    founder.privateKey
  ).toString('base64url'));

  const use = { kind: 'REUSE', id: draft.id, nonce: 'reuse-candidate-task-v5', input: 17, output: 896 };
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
  assert.equal(snapshot.capabilities[draft.id].strategy, 'candidate-program-v5');
  assert.equal(snapshot.capabilities[draft.id].uses, 1);
  assert.deepEqual(snapshot.capabilities[draft.id].taskSpecification, specification);
  assert.equal(snapshot.capabilities[draft.id].taskSpecificationSignature, specificationSignature);
  assert.deepEqual(snapshot.capabilities[draft.id].program, draft.program);
  assert.equal(snapshot.capabilities[draft.id].implementationHash, draft.implementationHash);

  const reopened = await lib.openInstitution(storePath, pem(founder));
  assert.equal(reopened.snapshot().sequence, 2);
  assert.deepEqual(reopened.snapshot().capabilities[draft.id].taskSpecification, specification);
  assert.equal(reopened.snapshot().capabilities[draft.id].implementationHash, draft.implementationHash);
}));

test('candidate-program-v5 rejects an untrusted or changed task spec even when INSTALL is Founder-signed', () => withTemp(async directory => {
  const founder = pair();
  const attacker = pair();
  const executor = pair();
  const lib = await loadPinned(founder);
  const specification = callerDefinedTaskSpecification();
  const store = await lib.openInstitution(join(directory, 'store-v5-signature'), pem(founder));
  const issuedAt = Date.now();

  const attackerSignature = sign(
    null,
    Buffer.from(lib.candidateTaskSpecificationPayload(specification)),
    attacker.privateKey
  ).toString('base64url');
  const untrusted = lib.makeInstallationProposal({
    id: 'candidate-task-v5-untrusted',
    strategy: 'candidate-program-v5',
    program: callerDefinedTaskProgram(),
    taskSpecification: specification,
    taskSpecificationSignature: attackerSignature,
    executorPublicKeyPem: pem(executor),
    nonce: 'install-candidate-task-v5-untrusted',
    issuedAt,
    expiresAt: issuedAt + 60_000,
    maxUses: 1
  });
  const founderApproval = sign(null, Buffer.from(lib.approvalPayload(untrusted)), founder.privateKey).toString('base64url');
  await assert.rejects(() => store.commit(untrusted, founderApproval), /CANDIDATE_TASK_SPEC_SIGNATURE_INVALID/);
  assert.equal(store.snapshot().sequence, 0);

  const trustedSignature = sign(
    null,
    Buffer.from(lib.candidateTaskSpecificationPayload(specification)),
    founder.privateKey
  ).toString('base64url');
  const changedSpecification = structuredClone(specification);
  changedSpecification.targetCoefficients = ['-4', '2', '3'];
  const changed = lib.makeInstallationProposal({
    id: 'candidate-task-v5-changed-spec',
    strategy: 'candidate-program-v5',
    program: callerDefinedTaskProgram(),
    taskSpecification: changedSpecification,
    taskSpecificationSignature: trustedSignature,
    executorPublicKeyPem: pem(executor),
    nonce: 'install-candidate-task-v5-changed',
    issuedAt,
    expiresAt: issuedAt + 60_000,
    maxUses: 1
  });
  const changedApproval = sign(null, Buffer.from(lib.approvalPayload(changed)), founder.privateKey).toString('base64url');
  await assert.rejects(() => store.commit(changed, changedApproval), /CANDIDATE_TASK_SPEC_SIGNATURE_INVALID/);
  assert.equal(store.snapshot().sequence, 0);
}));


test('installed candidate task IDs cannot be rebound to new targets; a new version is allowed', () => withTemp(async directory => {
  const founder = pair();
  const executor = pair();
  const lib = await loadPinned(founder);
  const store = await lib.openInstitution(join(directory, 'store-v5-task-id'), pem(founder));
  const issuedAt = Date.now();
  const originalSpecification = callerDefinedTaskSpecification();
  const originalSignature = sign(
    null,
    Buffer.from(lib.candidateTaskSpecificationPayload(originalSpecification)),
    founder.privateKey
  ).toString('base64url');
  const original = lib.makeInstallationProposal({
    id: 'candidate-task-v5-original',
    strategy: 'candidate-program-v5',
    program: callerDefinedTaskProgram(),
    taskSpecification: originalSpecification,
    taskSpecificationSignature: originalSignature,
    executorPublicKeyPem: pem(executor),
    nonce: 'install-candidate-task-v5-original',
    issuedAt,
    expiresAt: issuedAt + 5 * 60_000,
    maxUses: 1
  });
  await store.commit(original, sign(
    null,
    Buffer.from(lib.approvalPayload(original)),
    founder.privateKey
  ).toString('base64url'));

  const changedSpecification = structuredClone(originalSpecification);
  changedSpecification.targetCoefficients = ['-4', '2', '3'];
  const changedProgram = structuredClone(callerDefinedTaskProgram());
  changedProgram.right.value = -4;
  const changedSignature = sign(
    null,
    Buffer.from(lib.candidateTaskSpecificationPayload(changedSpecification)),
    founder.privateKey
  ).toString('base64url');
  const conflicting = lib.makeInstallationProposal({
    id: 'candidate-task-v5-redefinition',
    strategy: 'candidate-program-v5',
    program: changedProgram,
    taskSpecification: changedSpecification,
    taskSpecificationSignature: changedSignature,
    executorPublicKeyPem: pem(executor),
    nonce: 'install-candidate-task-v5-redefine',
    issuedAt,
    expiresAt: issuedAt + 5 * 60_000,
    maxUses: 1
  });
  assert.equal(conflicting.proof.passed, 1, 'the new candidate genuinely matches the changed signed target');
  await assert.rejects(() => store.commit(conflicting, sign(
    null,
    Buffer.from(lib.approvalPayload(conflicting)),
    founder.privateKey
  ).toString('base64url')), /CANDIDATE_TASK_SPEC_ID_CONFLICT/);
  assert.equal(store.snapshot().sequence, 1);

  const versionedSpecification = {
    ...changedSpecification,
    id: changedSpecification.id.replace(':v1', ':v2')
  };
  const versionedSignature = sign(
    null,
    Buffer.from(lib.candidateTaskSpecificationPayload(versionedSpecification)),
    founder.privateKey
  ).toString('base64url');
  const versioned = lib.makeInstallationProposal({
    id: 'candidate-task-v5-version-two',
    strategy: 'candidate-program-v5',
    program: changedProgram,
    taskSpecification: versionedSpecification,
    taskSpecificationSignature: versionedSignature,
    executorPublicKeyPem: pem(executor),
    nonce: 'install-candidate-task-v5-version2',
    issuedAt,
    expiresAt: issuedAt + 5 * 60_000,
    maxUses: 1
  });
  await store.commit(versioned, sign(
    null,
    Buffer.from(lib.approvalPayload(versioned)),
    founder.privateKey
  ).toString('base64url'));
  assert.equal(store.snapshot().sequence, 2);
  assert.equal(store.snapshot().capabilities[versioned.id].taskSpecification.id, versionedSpecification.id);
}));
