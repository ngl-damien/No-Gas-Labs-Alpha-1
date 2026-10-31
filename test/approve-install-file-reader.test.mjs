import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify as verifySignature } from 'node:crypto';
import { chmod, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { approvalPayload, makeInstallationProposal, proposalDigest, publicKeyFingerprint } from '../experiment-001/institutional-cycle.mjs';
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


const boundedReaderUrl = new URL('../src/bounded-file-reader.mjs', import.meta.url).href;

function runOwnershipCheck(path, setup, expectedError) {
  const code = `
    import { readBoundedRegularFile } from ${JSON.stringify(boundedReaderUrl)};
    ${setup}
    try {
      await readBoundedRegularFile(${JSON.stringify(path)}, 100, 'TEST', { requireCurrentUserOwnership: true });
      process.exitCode = 1;
    } catch (error) {
      if (error?.message !== ${JSON.stringify(expectedError)}) {
        console.error(error);
        process.exitCode = 2;
      }
    }
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
    timeout: 5000
  });
}

test('bounded reader fails closed when current-user ownership verification is unavailable', async t => {
  const directory = await temp(t);
  const path = join(directory, 'private.txt');
  await writeFile(path, 'private', { mode: 0o600 });
  const setup = `Object.defineProperty(process, 'getuid', { configurable: true, writable: true, value: undefined });`;
  const result = runOwnershipCheck(path, setup, 'TEST_OWNER_VERIFICATION_UNAVAILABLE');
  assert.equal(result.status, 0, result.stderr);
});

test('bounded reader rejects a file owned by a different process user when ownership is required', async t => {
  if (typeof process.getuid !== 'function') return t.skip('POSIX process UID ownership is unavailable');
  const directory = await temp(t);
  const path = join(directory, 'private.txt');
  await writeFile(path, 'private', { mode: 0o600 });
  const setup = `const actualGetuid = process.getuid.bind(process); Object.defineProperty(process, 'getuid', { configurable: true, writable: true, value: () => actualGetuid() + 1 });`;
  const result = runOwnershipCheck(path, setup, 'TEST_OWNER_MISMATCH');
  assert.equal(result.status, 0, result.stderr);
});


test('bounded reader fails closed when current-user ownership lookup throws', async t => {
  const directory = await temp(t);
  const path = join(directory, 'private.txt');
  await writeFile(path, 'private', { mode: 0o600 });
  const setup = `Object.defineProperty(process, 'getuid', { configurable: true, writable: true, value: () => { throw new Error('OS_UID_LOOKUP_FAILED'); } });`;
  const result = runOwnershipCheck(path, setup, 'TEST_OWNER_VERIFICATION_FAILED');
  assert.equal(result.status, 0, result.stderr);
});

test('bounded reader fails closed when current-user ownership lookup returns an invalid UID', async t => {
  const directory = await temp(t);
  const path = join(directory, 'private.txt');
  await writeFile(path, 'private', { mode: 0o600 });
  const setup = `Object.defineProperty(process, 'getuid', { configurable: true, writable: true, value: () => Number.NaN });`;
  const result = runOwnershipCheck(path, setup, 'TEST_OWNER_VERIFICATION_FAILED');
  assert.equal(result.status, 0, result.stderr);
});

test('Founder CLI refuses to sign when current-user ownership verification is unavailable', async t => {
  const directory = await temp(t);
  const executor = keyPair();
  const founder = keyPair();
  const proposal = proposalFor(executor.publicKeyPem);
  const proposalPath = join(directory, 'proposal.json');
  const privateKeyPath = join(directory, 'founder-private.pem');
  const preloadPath = join(directory, 'disable-getuid.cjs');
  await writeFile(proposalPath, JSON.stringify(proposal, null, 2) + '\n', { mode: 0o600 });
  await writeFile(privateKeyPath, founder.privateKeyPem, { mode: 0o600 });
  await chmod(privateKeyPath, 0o600);
  await writeFile(preloadPath, `Object.defineProperty(process, 'getuid', { configurable: true, writable: true, value: undefined });\n`);

  const result = run([
    '--confirm',
    proposalDigest(proposal),
    proposalPath,
    privateKeyPath
  ], {
    NGL_FOUNDER_KEY_FINGERPRINT: publicKeyFingerprint(founder.publicKeyPem),
    NODE_OPTIONS: `--require=${JSON.stringify(preloadPath)}`
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /FOUNDER_KEY_OWNER_VERIFICATION_UNAVAILABLE/);
  assert.equal(result.stdout, '');
});
