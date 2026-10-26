import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  verify as verifySignature
} from 'node:crypto';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  approvalPayload,
  makeInstallationProposal,
  proposalDigest,
  publicKeyFingerprint
} from './institutional-cycle.mjs';

const cli = fileURLToPath(new URL('../scripts/approve-install.mjs', import.meta.url));
const pem = key => key.export({ type: 'spki', format: 'pem' }).toString();
const fingerprint = key => createHash('sha256')
  .update(createPublicKey(pem(key)).export({ type: 'spki', format: 'der' }))
  .digest('hex');

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-founder-approval-'));
  try {
    const founder = generateKeyPairSync('ed25519');
    const executor = generateKeyPairSync('ed25519');
    const now = Date.now();
    const proposal = makeInstallationProposal({
      id: 'offline-approval-test',
      executorPublicKeyPem: pem(executor.publicKey),
      nonce: 'install-cli-test-0001',
      issuedAt: now - 1000,
      expiresAt: now + 60_000,
      maxUses: 1
    });
    const proposalPath = join(directory, 'proposal.json');
    const privateKeyPath = join(directory, 'founder-private.pem');
    await writeFile(proposalPath, JSON.stringify(proposal, null, 2), { mode: 0o600 });
    await writeFile(privateKeyPath, founder.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    await chmod(privateKeyPath, 0o600);
    return await run({ directory, founder, proposal, proposalPath, privateKeyPath });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function inspectProposal(proposalPath) {
  return spawnSync(process.execPath, [cli, '--inspect', proposalPath], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env }
  });
}
function runCli(proposalPath, privateKeyPath, pin, digest) {
  return spawnSync(process.execPath, [cli, '--confirm', digest, proposalPath, privateKeyPath], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, NGL_FOUNDER_KEY_FINGERPRINT: pin }
  });
}

test('review mode shows the exact digest and decision fields without signing', async () => fixture(async ({ proposal, proposalPath }) => {
  const child = inspectProposal(proposalPath);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const review = JSON.parse(child.stdout);
  assert.equal(review.schema, 'ngl.founder-install-review.v1');
  assert.equal(review.proposalDigest, proposalDigest(proposal));
  assert.equal(review.proposal.id, proposal.id);
  assert.equal(review.proposal.strategy, proposal.strategy);
  assert.equal(review.proposal.maxUses, proposal.maxUses);
  assert.match(review.instruction, /separate --confirm invocation/);
  assert.equal('signature' in review, false);
}));

test('offline signer emits a detached signature only after exact-digest confirmation', async () => fixture(async ({ founder, proposal, proposalPath, privateKeyPath }) => {
  const review = inspectProposal(proposalPath);
  assert.equal(review.status, 0, review.stderr || review.stdout);
  const digest = JSON.parse(review.stdout).proposalDigest;
  const pin = publicKeyFingerprint(pem(founder.publicKey));
  const child = runCli(proposalPath, privateKeyPath, pin, digest);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const receipt = JSON.parse(child.stdout);
  assert.equal(receipt.schema, 'ngl.founder-install-approval.v1');
  assert.equal(receipt.proposalDigest, digest);
  assert.equal(receipt.keyFingerprint, pin);
  assert.match(receipt.signature, /^[A-Za-z0-9_-]{86}$/);
  assert.equal(verifySignature(null, Buffer.from(approvalPayload(proposal)), founder.publicKey, Buffer.from(receipt.signature, 'base64url')), true);
  assert.match(child.stderr, /proves key possession only/);
}));

test('signature does not authorize a modified proposal', async () => fixture(async ({ founder, proposal, proposalPath, privateKeyPath }) => {
  const digest = proposalDigest(proposal);
  const child = runCli(proposalPath, privateKeyPath, fingerprint(founder.publicKey), digest);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const receipt = JSON.parse(child.stdout);
  const modified = { ...proposal, maxUses: proposal.maxUses + 1 };
  assert.notEqual(proposalDigest(modified), receipt.proposalDigest);
  assert.equal(verifySignature(null, Buffer.from(approvalPayload(modified)), founder.publicKey, Buffer.from(receipt.signature, 'base64url')), false);
}));

test('signer refuses a digest that does not match the reviewed proposal', async () => fixture(async ({ founder, proposalPath, privateKeyPath }) => {
  const child = runCli(proposalPath, privateKeyPath, fingerprint(founder.publicKey), '0'.repeat(64));
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /PROPOSAL_CONFIRMATION_MISMATCH/);
  assert.equal(child.stdout, '');
}));

test('signer fails closed when configured fingerprint differs from the private key', async () => fixture(async ({ founder, proposal, proposalPath, privateKeyPath }) => {
  const child = runCli(proposalPath, privateKeyPath, '0'.repeat(64), proposalDigest(proposal));
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /FOUNDER_KEY_FINGERPRINT_MISMATCH/);
  assert.equal(child.stdout, '');
}));

test('expired proposal is not signed', async () => fixture(async ({ founder, proposal, proposalPath, privateKeyPath }) => {
  const expired = { ...proposal, issuedAt: Date.now() - 120_000, expiresAt: Date.now() - 60_000 };
  await writeFile(proposalPath, JSON.stringify(expired), { mode: 0o600 });
  const child = runCli(proposalPath, privateKeyPath, fingerprint(founder.publicKey), proposalDigest(expired));
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /INSTALL_TIME_INVALID/);
  assert.equal(child.stdout, '');
}));

test('signer rejects group/world-readable private-key files on POSIX', async t => fixture(async ({ founder, proposal, proposalPath, privateKeyPath }) => {
  if (process.platform === 'win32') return t.skip('POSIX permission bits are not available on Windows');
  await chmod(privateKeyPath, 0o644);
  const child = runCli(proposalPath, privateKeyPath, fingerprint(founder.publicKey), proposalDigest(proposal));
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /FOUNDER_KEY_PERMISSIONS_TOO_BROAD/);
  assert.equal(child.stdout, '');
}));


test('signer rejects a symlinked private-key path', async t => fixture(async ({ founder, proposal, proposalPath, privateKeyPath, directory }) => {
  if (process.platform === 'win32') return t.skip('Symlink behavior is platform-dependent on Windows');
  const linkPath = join(directory, 'founder-key-link.pem');
  await symlink(privateKeyPath, linkPath);
  const child = runCli(proposalPath, linkPath, fingerprint(founder.publicKey), proposalDigest(proposal));
  assert.notEqual(child.status, 0);
  assert.equal(child.stdout, '');
}));
