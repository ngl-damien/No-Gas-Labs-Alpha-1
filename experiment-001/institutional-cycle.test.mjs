import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign as signSignature } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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

test('approved install and signed reuse survive reopening; replay is rejected', () => temp(async dir => {
  const founder = pair(), executor = pair(), lib = await loadPinned(founder), path = join(dir, 'store'), draft = proposal(lib, executor, { nonce: 'install-nonce-000002', maxUses: 1 });
  const store = await openStore(lib, path, founder);
  await store.commit(draft, approve(lib, draft, founder.privateKey));
  const use = { kind: 'REUSE', id: draft.id, nonce: 'reuse-nonce-000001', input: 9, output: 81 };
  await store.commit(use, receipt(lib, use, executor.privateKey));
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
