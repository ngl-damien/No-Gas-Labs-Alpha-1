import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as signSignature } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { approvalPayload, executionReceiptPayload, makeInstallationProposal, openInstitution, publicKeyFingerprint } from './institutional-cycle.mjs';

const pair = () => generateKeyPairSync('ed25519');
const pem = p => p.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const pin = p => publicKeyFingerprint(pem(p));
const openStore = (dir, p) => openInstitution(dir, pem(p), pin(p));
const approve = (decision, key) => signSignature(null, Buffer.from(approvalPayload(decision)), key).toString('base64url');
const receipt = (decision, key) => signSignature(null, Buffer.from(executionReceiptPayload(decision)), key).toString('base64url');
const proposal = (executor, extra = {}) => makeInstallationProposal({ executorPublicKeyPem: pem(executor), nonce: 'install-nonce-000001', issuedAt: Date.now(), expiresAt: Date.now() + 60_000, maxUses: 2, ...extra });
async function temp(fn) { const dir = await mkdtemp(join(tmpdir(), 'ngl-approval-test-')); try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); } }

test('proposer cannot install without a separate Founder signature', () => temp(async dir => {
  const founder = pair(), executor = pair(), store = await openStore(join(dir, 'store'), founder);
  const draft = proposal(executor);
  await assert.rejects(() => store.commit(draft), /UNAUTHORIZED/);
  await assert.rejects(() => store.commit(draft, 'model-says-approved'), /UNAUTHORIZED/);
  assert.equal(store.snapshot().sequence, 0);
}));

test('approved install and signed reuse survive reopening; replay is rejected', () => temp(async dir => {
  const founder = pair(), executor = pair(), path = join(dir, 'store');
  const draft = proposal(executor, { nonce: 'install-nonce-000002', maxUses: 1 });
  const store = await openStore(path, founder);
  await store.commit(draft, approve(draft, founder.privateKey));
  const use = { kind: 'REUSE', id: draft.id, nonce: 'reuse-nonce-000001', input: 9, output: 81 };
  await store.commit(use, receipt(use, executor.privateKey));
  const reopened = await openStore(path, founder);
  assert.equal(reopened.snapshot().capabilities[draft.id].uses, 1);
  await assert.rejects(() => reopened.commit(use, receipt(use, executor.privateKey)), /REPLAY/);
}));

test('capability IDs that overlap inherited object names remain valid', () => temp(async dir => {
  const founder = pair(), store = await openStore(join(dir, 'store'), founder);
  for (const [i, id] of ['toString', 'constructor', 'hasOwnProperty'].entries()) {
    const executor = pair(), draft = proposal(executor, { id, nonce: 'install-prototype-' + i + '-0001', maxUses: 1 });
    await store.commit(draft, approve(draft, founder.privateKey));
    assert.equal(Object.hasOwn(store.snapshot().capabilities, id), true);
    const use = { kind: 'REUSE', id, nonce: 'reuse-prototype-' + i + '-0001', input: 3, output: 9 };
    await store.commit(use, receipt(use, executor.privateKey));
    assert.equal(store.snapshot().capabilities[id].uses, 1);
  }
}));

test('invalid output and oversized input do not consume a grant', () => temp(async dir => {
  const founder = pair(), executor = pair(), store = await openStore(join(dir, 'store'), founder);
  const draft = proposal(executor, { nonce: 'install-nonce-000003', maxUses: 1 });
  await store.commit(draft, approve(draft, founder.privateKey));
  const wrong = { kind: 'REUSE', id: draft.id, nonce: 'reuse-nonce-000003', input: 8, output: 63 };
  await assert.rejects(() => store.commit(wrong, receipt(wrong, executor.privateKey)), /OUTPUT_MISMATCH/);
  const large = { kind: 'REUSE', id: draft.id, nonce: 'reuse-nonce-000004', input: 1_000_001, output: 1_000_002_000_001 };
  await assert.rejects(() => store.commit(large, receipt(large, executor.privateKey)), /INPUT_OUT_OF_BOUNDS/);
  assert.equal(store.snapshot().capabilities[draft.id].uses, 0);
}));

test('Founder key requires an independently supplied matching fingerprint', () => temp(async dir => {
  const founder = pair(), attacker = pair();
  await assert.rejects(() => openInstitution(join(dir, 'store'), pem(founder), pin(attacker)), /FOUNDER_KEY_FINGERPRINT_MISMATCH/);
  await assert.rejects(() => openInstitution(join(dir, 'store'), pem(founder)), /FOUNDER_KEY_FINGERPRINT_REQUIRED/);
}));
