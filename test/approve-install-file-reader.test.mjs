import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { chmod, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeInstallationProposal, proposalDigest, publicKeyFingerprint } from '../experiment-001/institutional-cycle.mjs';
import { readBoundedRegularFile } from '../scripts/bounded-file-reader.mjs';

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
