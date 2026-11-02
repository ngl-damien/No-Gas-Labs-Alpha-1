import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, generateKeyPairSync, sign, verify as verifySignature } from 'node:crypto';
import { chmod, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { approvalPayload, candidateTaskSpecificationPayload, makeInstallationProposal, proposalDigest, publicKeyFingerprint } from '../experiment-001/institutional-cycle.mjs';
import { candidateTaskSpecificationDigest, validateCandidateTaskSpecification } from '../experiment-001/candidate-program.mjs';
import { readBoundedRegularFile } from '../src/bounded-file-reader.mjs';

const script = fileURLToPath(new URL('../scripts/approve-install.mjs', import.meta.url));

async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-approval-reader-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function keyPair() {
  const pair = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  };
}

function proposalFor(executorPublicKeyPem) {
  return makeInstallationProposal({ executorPublicKeyPem, issuedAt: Date.now() - 1000, expiresAt: Date.now() + 60_000 });
}

function taskSpecificationFor() {
  return {
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
  };
}

function taskProgramFor() {
  return {
    op: 'add',
    left: {
      op: 'add',
      left: { op: 'multiply', left: { op: 'const', value: 3 }, right: { op: 'multiply', left: { op: 'input' }, right: { op: 'input' } } },
      right: { op: 'multiply', left: { op: 'const', value: 2 }, right: { op: 'input' } }
    },
    right: { op: 'const', value: -5 }
  };
}

function taskProposalFor(founder, executor, taskSignature = null) {
  const specification = taskSpecificationFor();
  const signature = taskSignature ?? sign(
    null,
    Buffer.from(candidateTaskSpecificationPayload(specification)),
    createPrivateKey(founder.privateKeyPem)
  ).toString('base64url');
  const issuedAt = Date.now() - 1000;
  const proposal = makeInstallationProposal({
    id: 'candidate-task-v5-cli',
    strategy: 'candidate-program-v5',
    program: taskProgramFor(),
    taskSpecification: specification,
    taskSpecificationSignature: signature,
    executorPublicKeyPem: executor.publicKeyPem,
    nonce: 'install-candidate-task-v5-cli',
    issuedAt,
    expiresAt: issuedAt + 5 * 60_000,
    maxUses: 1
  });
  return { specification, proposal };
}

function run(args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
}

test('bounded reader accepts valid UTF-8 across multiple chunks', async t => {
  const directory = await temp(t);
  const path = join(directory, 'input.txt');
  const expected = 'NGL-' + 'x'.repeat(50_000) + '-receipt';
  await writeFile(path, expected, { mode: 0o600 });
  assert.equal(await readBoundedRegularFile(path, 60_000, 'TEST'), expected);
});

test('bounded reader rejects symlink inputs without following them', async t => {
  const directory = await temp(t);
  const target = join(directory, 'target.txt');
  const alias = join(directory, 'alias.txt');
  await writeFile(target, 'safe', { mode: 0o600 });
  await symlink(target, alias);
  await assert.rejects(readBoundedRegularFile(alias, 100, 'TEST'), /TEST_NOT_REGULAR_FILE/);
});

test('bounded reader rejects an oversized sparse file before loading it', async t => {
  const directory = await temp(t);
  const path = join(directory, 'large.bin');
  await writeFile(path, '');
  await truncate(path, 1025);
  await assert.rejects(readBoundedRegularFile(path, 1024, 'TEST'), /TEST_FILE_TOO_LARGE/);
});

test('bounded reader rejects malformed UTF-8 instead of replacement-decoding it', async t => {
  const directory = await temp(t);
  const path = join(directory, 'invalid.txt');
  await writeFile(path, Buffer.from([0x41, 0xff, 0x42]), { mode: 0o600 });
  await assert.rejects(readBoundedRegularFile(path, 100, 'TEST'), /TEST_INVALID_UTF8/);
});

test('approval inspection still accepts a valid ephemeral-key proposal', async t => {
  const directory = await temp(t);
  const executor = keyPair();
  const proposal = proposalFor(executor.publicKeyPem);
  const path = join(directory, 'proposal.json');
  await writeFile(path, JSON.stringify(proposal, null, 2) + '\n', { mode: 0o600 });

  const result = run(['--inspect', path]);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.schema, 'ngl.founder-install-review.v1');
  assert.equal(receipt.proposalDigest, proposalDigest(proposal));
});

test('approval inspection rejects malformed UTF-8 inside an otherwise parseable proposal', async t => {
  const directory = await temp(t);
  const executor = keyPair();
  const proposal = proposalFor(executor.publicKeyPem);
  const path = join(directory, 'proposal.json');
  const bytes = Buffer.from(JSON.stringify(proposal, null, 2) + '\n', 'utf8');
  const marker = Buffer.from('BEGIN PUBLIC KEY', 'utf8');
  const index = bytes.indexOf(marker);
  assert.notEqual(index, -1, 'fixture must contain the public-key PEM marker');
  bytes[index] = 0xff;
  await writeFile(path, bytes, { mode: 0o600 });

  const result = run(['--inspect', path]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PROPOSAL_INVALID_UTF8/);
});

test('Founder approval still signs a valid proposal with a private owner-only key', async t => {
  const directory = await temp(t);
  const executor = keyPair();
  const founder = keyPair();
  const proposal = proposalFor(executor.publicKeyPem);
  const proposalPath = join(directory, 'proposal.json');
  const privateKeyPath = join(directory, 'founder-private.pem');
  await writeFile(proposalPath, JSON.stringify(proposal, null, 2) + '\n', { mode: 0o600 });
  await writeFile(privateKeyPath, founder.privateKeyPem, { mode: 0o600 });
  await chmod(privateKeyPath, 0o600);

  const result = run([
    '--confirm',
    proposalDigest(proposal),
    proposalPath,
    privateKeyPath
  ], { NGL_FOUNDER_KEY_FINGERPRINT: publicKeyFingerprint(founder.publicKeyPem) });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.schema, 'ngl.founder-install-approval.v1');
  assert.equal(receipt.proposalDigest, proposalDigest(proposal));
  assert.equal(receipt.keyFingerprint, publicKeyFingerprint(founder.publicKeyPem));
  assert.match(receipt.signature, /^[A-Za-z0-9_-]{86}$/);

  const signatureBytes = Buffer.from(receipt.signature, 'base64url');
  assert.equal(
    verifySignature(null, Buffer.from(approvalPayload(proposal)), founder.publicKeyPem, signatureBytes),
    true,
    'receipt signature must verify against the complete canonical proposal'
  );
  const tamperedProposal = { ...proposal, strategy: proposal.strategy === 'square' ? 'double' : 'square' };
  assert.equal(
    verifySignature(null, Buffer.from(approvalPayload(tamperedProposal)), founder.publicKeyPem, signatureBytes),
    false,
    'changing a signed proposal field must invalidate the receipt'
  );
});

test('Founder approval rejects malformed UTF-8 in the private-key file', async t => {
  const directory = await temp(t);
  const executor = keyPair();
  const founder = keyPair();
  const proposal = proposalFor(executor.publicKeyPem);
  const proposalPath = join(directory, 'proposal.json');
  const privateKeyPath = join(directory, 'founder-private.pem');
  await writeFile(proposalPath, JSON.stringify(proposal, null, 2) + '\n', { mode: 0o600 });
  const bytes = Buffer.from(founder.privateKeyPem, 'utf8');
  const marker = Buffer.from('BEGIN PRIVATE KEY', 'utf8');
  const index = bytes.indexOf(marker);
  assert.notEqual(index, -1, 'fixture must contain the private-key PEM marker');
  bytes[index] = 0xff;
  await writeFile(privateKeyPath, bytes, { mode: 0o600 });

  const result = run([
    '--confirm',
    proposalDigest(proposal),
    proposalPath,
    privateKeyPath
  ], { NGL_FOUNDER_KEY_FINGERPRINT: publicKeyFingerprint(founder.publicKeyPem) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FOUNDER_KEY_INVALID_UTF8/);
});

test('approval inspection rejects duplicate JSON keys before digest confirmation', async t => {
  const directory = await temp(t);
  const executor = keyPair();
  const proposal = proposalFor(executor.publicKeyPem);
  const path = join(directory, 'proposal.json');
  let serialized = JSON.stringify(proposal, null, 2) + '\n';
  const strategy = '"strategy": "square",';
  assert.ok(serialized.includes(strategy), 'fixture must contain the strategy field');
  serialized = serialized.replace(strategy, '"strategy": "double",\n  "strategy": "square",');
  await writeFile(path, serialized, { mode: 0o600 });

  const result = run(['--inspect', path]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PROPOSAL_DUPLICATE_JSON_KEY/);
});

test('approval inspection bounds nested JSON depth before schema validation', async t => {
  const directory = await temp(t);
  const executor = keyPair();
  const proposal = proposalFor(executor.publicKeyPem);
  const path = join(directory, 'proposal.json');
  const nested = '['.repeat(160) + '0' + ']'.repeat(160);
  const serialized = JSON.stringify(proposal).replace('{', '{"extra":' + nested + ',');
  await writeFile(path, serialized, { mode: 0o600 });

  const result = run(['--inspect', path]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PROPOSAL_JSON_TOO_DEEP/);
});


test('approval rejects missing trust pin before attempting to open the private key path', async t => {
  const directory = await temp(t);
  const executor = keyPair();
  const proposal = proposalFor(executor.publicKeyPem);
  const proposalPath = join(directory, 'proposal.json');
  const missingPrivateKeyPath = join(directory, 'does-not-exist.pem');
  await writeFile(proposalPath, JSON.stringify(proposal, null, 2) + '\n', { mode: 0o600 });

  const result = run([
    '--confirm',
    proposalDigest(proposal),
    proposalPath,
    missingPrivateKeyPath
  ], { NGL_FOUNDER_KEY_FINGERPRINT: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FOUNDER_KEY_FINGERPRINT_REQUIRED/);
  assert.doesNotMatch(result.stderr, /ENOENT|NOT_FOUND/);
});

test('Founder approval rejects a private-key file with group/world permissions', async t => {
  if (process.platform === 'win32') return t.skip('POSIX permission bits are not enforced on Windows');
  const directory = await temp(t);
  const executor = keyPair();
  const founder = keyPair();
  const proposal = proposalFor(executor.publicKeyPem);
  const proposalPath = join(directory, 'proposal.json');
  const privateKeyPath = join(directory, 'founder-private.pem');
  await writeFile(proposalPath, JSON.stringify(proposal, null, 2) + '\n', { mode: 0o600 });
  await writeFile(privateKeyPath, founder.privateKeyPem, { mode: 0o644 });
  await chmod(privateKeyPath, 0o644);

  const result = run([
    '--confirm',
    proposalDigest(proposal),
    proposalPath,
    privateKeyPath
  ], { NGL_FOUNDER_KEY_FINGERPRINT: publicKeyFingerprint(founder.publicKeyPem) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FOUNDER_KEY_PERMISSIONS_TOO_BROAD/);
});

test('approval inspection rejects duplicate keys when one spelling uses a Unicode escape', async t => {
  const directory = await temp(t);
  const executor = keyPair();
  const proposal = proposalFor(executor.publicKeyPem);
  const path = join(directory, 'proposal.json');
  let serialized = JSON.stringify(proposal, null, 2) + '\n';
  const strategy = '"strategy": "square",';
  assert.ok(serialized.includes(strategy), 'fixture must contain the strategy field');
  serialized = serialized.replace(strategy, '"strategy": "double",\n  "\\u0073trategy": "square",');
  await writeFile(path, serialized, { mode: 0o600 });

  const result = run(['--inspect', path]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PROPOSAL_DUPLICATE_JSON_KEY/);
});


test('approval rejects a changed proposal digest before attempting to open the private key path', async t => {
  const directory = await temp(t);
  const executor = keyPair();
  const founder = keyPair();
  const proposal = proposalFor(executor.publicKeyPem);
  const proposalPath = join(directory, 'proposal.json');
  const missingPrivateKeyPath = join(directory, 'does-not-exist.pem');
  const wrongDigest = '0'.repeat(64);
  assert.notEqual(wrongDigest, proposalDigest(proposal));
  await writeFile(proposalPath, JSON.stringify(proposal, null, 2) + '\n', { mode: 0o600 });

  const result = run([
    '--confirm',
    wrongDigest,
    proposalPath,
    missingPrivateKeyPath
  ], { NGL_FOUNDER_KEY_FINGERPRINT: publicKeyFingerprint(founder.publicKeyPem) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PROPOSAL_CONFIRMATION_MISMATCH/);
  assert.doesNotMatch(result.stderr, /ENOENT|NOT_FOUND/);
  assert.equal(result.stdout, '');
});

test('approval refuses to sign when the configured trust fingerprint does not match the private key', async t => {
  const directory = await temp(t);
  const executor = keyPair();
  const founder = keyPair();
  const proposal = proposalFor(executor.publicKeyPem);
  const proposalPath = join(directory, 'proposal.json');
  const privateKeyPath = join(directory, 'founder-private.pem');
  await writeFile(proposalPath, JSON.stringify(proposal, null, 2) + '\n', { mode: 0o600 });
  await writeFile(privateKeyPath, founder.privateKeyPem, { mode: 0o600 });
  const wrongFingerprint = '0'.repeat(64);
  assert.notEqual(wrongFingerprint, publicKeyFingerprint(founder.publicKeyPem));

  const result = run([
    '--confirm',
    proposalDigest(proposal),
    proposalPath,
    privateKeyPath
  ], { NGL_FOUNDER_KEY_FINGERPRINT: wrongFingerprint });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FOUNDER_KEY_FINGERPRINT_MISMATCH/);
  assert.equal(result.stdout, '');
});


test('bounded reader rejects unsafe configured limits before filesystem access', async t => {
  const directory = await temp(t);
  const missingPath = join(directory, 'does-not-exist.txt');
  await assert.rejects(
    readBoundedRegularFile(missingPath, 16 * 1024 * 1024 + 1, 'TEST'),
    /BOUNDED_FILE_READER_INVALID_CONFIG/
  );
});


test('candidate task-spec inspection returns a normalized digest without opening a key', async t => {
  const directory = await temp(t);
  const specification = taskSpecificationFor();
  const path = join(directory, 'task-spec.json');
  await writeFile(path, JSON.stringify(specification, null, 2) + '\n', { mode: 0o600 });
  const result = run(['--inspect-task-spec', path]);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.schema, 'ngl.founder-candidate-task-specification-review.v1');
  assert.equal(receipt.taskSpecificationDigest, candidateTaskSpecificationDigest(specification));
  assert.deepEqual(receipt.taskSpecification, validateCandidateTaskSpecification(specification));
  assert.match(receipt.instruction, /separate --confirm-task-spec invocation/);
});

test('candidate task-spec signing requires the exact digest and emits the domain-separated signature', async t => {
  const directory = await temp(t);
  const founder = keyPair();
  const specification = taskSpecificationFor();
  const specificationPath = join(directory, 'task-spec.json');
  const privateKeyPath = join(directory, 'founder-private.pem');
  await writeFile(specificationPath, JSON.stringify(specification, null, 2) + '\n', { mode: 0o600 });
  await writeFile(privateKeyPath, founder.privateKeyPem, { mode: 0o600 });
  await chmod(privateKeyPath, 0o600);
  const result = run([
    '--confirm-task-spec',
    candidateTaskSpecificationDigest(specification),
    specificationPath,
    privateKeyPath
  ], { NGL_FOUNDER_KEY_FINGERPRINT: publicKeyFingerprint(founder.publicKeyPem) });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.schema, 'ngl.founder-candidate-task-specification-signature.v1');
  assert.equal(receipt.taskSpecificationDigest, candidateTaskSpecificationDigest(specification));
  assert.equal(receipt.taskSpecificationId, specification.id);
  assert.equal(receipt.keyFingerprint, publicKeyFingerprint(founder.publicKeyPem));
  const signature = Buffer.from(receipt.signature, 'base64url');
  assert.equal(verifySignature(null, Buffer.from(candidateTaskSpecificationPayload(specification)), founder.publicKeyPem, signature), true);
  assert.equal(verifySignature(null, Buffer.from(approvalPayload({ kind: 'INSTALL' })), founder.publicKeyPem, signature), false);
});

test('candidate task-spec digest mismatch is rejected before the private-key path is opened', async t => {
  const directory = await temp(t);
  const founder = keyPair();
  const specification = taskSpecificationFor();
  const specificationPath = join(directory, 'task-spec.json');
  const missingPrivateKeyPath = join(directory, 'missing-private.pem');
  await writeFile(specificationPath, JSON.stringify(specification, null, 2) + '\n', { mode: 0o600 });
  const result = run([
    '--confirm-task-spec',
    '0'.repeat(64),
    specificationPath,
    missingPrivateKeyPath
  ], { NGL_FOUNDER_KEY_FINGERPRINT: publicKeyFingerprint(founder.publicKeyPem) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TASK_SPEC_CONFIRMATION_MISMATCH/);
  assert.doesNotMatch(result.stderr, /ENOENT|NOT_FOUND/);
  assert.equal(result.stdout, '');
});

test('candidate task-spec inspection rejects duplicate JSON keys and non-canonical coefficients', async t => {
  const directory = await temp(t);
  const specification = taskSpecificationFor();
  const duplicatePath = join(directory, 'duplicate-task-spec.json');
  const duplicate = JSON.stringify(specification).replace(
    '"schema":"ngl.candidate-task-spec.v1"',
    '"schema":"bad","schema":"ngl.candidate-task-spec.v1"'
  );
  await writeFile(duplicatePath, duplicate, { mode: 0o600 });
  const duplicateResult = run(['--inspect-task-spec', duplicatePath]);
  assert.equal(duplicateResult.status, 1);
  assert.match(duplicateResult.stderr, /TASK_SPEC_DUPLICATE_JSON_KEY/);
  const invalidPath = join(directory, 'invalid-task-spec.json');
  await writeFile(invalidPath, JSON.stringify({ ...specification, targetCoefficients: ['-05', '2', '3'] }), { mode: 0o600 });
  const invalidResult = run(['--inspect-task-spec', invalidPath]);
  assert.equal(invalidResult.status, 1);
  assert.match(invalidResult.stderr, /TASK_SPEC_INVALID/);
});

test('candidate-program-v5 proposal inspection verifies its task signature against a pinned public key', async t => {
  const directory = await temp(t);
  const founder = keyPair();
  const executor = keyPair();
  const { specification, proposal } = taskProposalFor(founder, executor);
  const proposalPath = join(directory, 'proposal-v5.json');
  const publicKeyPath = join(directory, 'founder-public.pem');
  await writeFile(proposalPath, JSON.stringify(proposal, null, 2) + '\n', { mode: 0o600 });
  await writeFile(publicKeyPath, founder.publicKeyPem, { mode: 0o600 });
  const missingKey = run(['--inspect', proposalPath]);
  assert.equal(missingKey.status, 1);
  assert.match(missingKey.stderr, /FOUNDER_PUBLIC_KEY_PATH_REQUIRED/);
  const wrongPin = run(['--inspect', proposalPath, publicKeyPath], { NGL_FOUNDER_KEY_FINGERPRINT: '0'.repeat(64) });
  assert.equal(wrongPin.status, 1);
  assert.match(wrongPin.stderr, /FOUNDER_KEY_FINGERPRINT_MISMATCH/);
  const result = run(['--inspect', proposalPath, publicKeyPath], {
    NGL_FOUNDER_KEY_FINGERPRINT: publicKeyFingerprint(founder.publicKeyPem)
  });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.proposalDigest, proposalDigest(proposal));
  assert.equal(receipt.proposal.taskSpecificationDigest, candidateTaskSpecificationDigest(specification));
  assert.equal(receipt.proposal.taskSpecificationVerifiedAgainstFingerprint, publicKeyFingerprint(founder.publicKeyPem));
});

test('candidate-program-v5 INSTALL confirmation verifies task signature before emitting approval', async t => {
  const directory = await temp(t);
  const founder = keyPair();
  const executor = keyPair();
  const { proposal } = taskProposalFor(founder, executor);
  const proposalPath = join(directory, 'proposal-v5.json');
  const privateKeyPath = join(directory, 'founder-private.pem');
  await writeFile(proposalPath, JSON.stringify(proposal, null, 2) + '\n', { mode: 0o600 });
  await writeFile(privateKeyPath, founder.privateKeyPem, { mode: 0o600 });
  const result = run([
    '--confirm',
    proposalDigest(proposal),
    proposalPath,
    privateKeyPath
  ], { NGL_FOUNDER_KEY_FINGERPRINT: publicKeyFingerprint(founder.publicKeyPem) });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.schema, 'ngl.founder-install-approval.v1');
  assert.equal(receipt.proposalDigest, proposalDigest(proposal));
  assert.equal(verifySignature(null, Buffer.from(approvalPayload(proposal)), founder.publicKeyPem, Buffer.from(receipt.signature, 'base64url')), true);
});

test('candidate-program-v5 INSTALL confirmation rejects a task signature from another key', async t => {
  const directory = await temp(t);
  const founder = keyPair();
  const attacker = keyPair();
  const executor = keyPair();
  const specification = taskSpecificationFor();
  const attackerSignature = sign(
    null,
    Buffer.from(candidateTaskSpecificationPayload(specification)),
    createPrivateKey(attacker.privateKeyPem)
  ).toString('base64url');
  const { proposal } = taskProposalFor(founder, executor, attackerSignature);
  const proposalPath = join(directory, 'proposal-v5-untrusted.json');
  const privateKeyPath = join(directory, 'founder-private.pem');
  await writeFile(proposalPath, JSON.stringify(proposal, null, 2) + '\n', { mode: 0o600 });
  await writeFile(privateKeyPath, founder.privateKeyPem, { mode: 0o600 });
  const result = run([
    '--confirm',
    proposalDigest(proposal),
    proposalPath,
    privateKeyPath
  ], { NGL_FOUNDER_KEY_FINGERPRINT: publicKeyFingerprint(founder.publicKeyPem) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CANDIDATE_TASK_SPEC_SIGNATURE_INVALID/);
  assert.equal(result.stdout, '');
});
