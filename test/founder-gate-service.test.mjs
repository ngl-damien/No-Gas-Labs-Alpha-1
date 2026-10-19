import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDecisions } from '../src/institution/decisions.mjs';
import { artifactReceipt } from '../src/institution/kernel.mjs';

const service = await import('../src/institution/founder-gate.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const founder = { id: 'damien', name: 'Damien Featherstone', role: 'founder' };
const witness = { id: 'witness:one', name: 'Witness', role: 'witness' };
const founderCore = { id: 'damien', role: 'founder' };
const instant = Date.parse('2026-10-18T17:00:00.000Z');
const reviewWindowMs = 600000;
const root = fileURLToPath(new URL('../', import.meta.url));
function proposal() {
  const bytes = 'Private qualification fixture: café 🌍';
  return {
    id: 'qualification:fixture', title: 'Founders Day · Alpha 1 qualification',
    evaluation: { bytes, receipt: artifactReceipt(bytes) }, risks: ['Private fixture risk'],
    rollback: 'Preserve the fixture baseline.', proposedEffect: 'Authorize controlled external specialist review only; no deployment or automatic promotion.',
  };
}
function request(action = 'APPROVE', extra = {}) { return { expectedRevision: 1, requestId: 'request:fixture', action, ...extra }; }
async function reject(promise, code) { await assert.rejects(promise, error => error.code === code, `Expected ${code}`); }
function gate(options) {
  assert.equal(typeof service.createFounderGate, 'function', 'The Founder Gate service has not been implemented');
  return service.createFounderGate(options);
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-founder-gate-'));
  let clock = instant;
  let store = await openDecisions({ directory, now: () => clock });
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  return {
    directory, get store() { return store; },
    get gate() { return gate({ decisions: store, proposal: proposal(), now: () => clock }); },
    setClock(value) { clock = value; },
    async restart() { await store.close(); store = await openDecisions({ directory, now: () => clock }); },
  };
}

test('status is prepared without starting a policy or proposal, with explicit ceremony and choices', async t => {
  const f = await fixture(t);
  const before = await readFile(join(f.directory, 'decisions.json'), 'utf8');
  const page = await f.gate.status(founder);
  assert.equal(page.schema, 'ngl.founder-gate-page.v1');
  assert.equal(page.serverNow, new Date(instant).toISOString());
  assert.equal(page.reviewWindowMs, reviewWindowMs);
  assert.deepEqual(page.viewer, founder);
  assert.equal(page.ready, false);
  assert.equal(page.blockedReason, null);
  assert.equal(page.decision, null);
  assert.deepEqual(page.proposal, proposal());
  assert.deepEqual(page.ceremony, { title: 'Inaugural Founders Day', date: '2026-10-18', timezone: 'America/Chicago', location: 'Carter Lake, Iowa', status: 'PREPARED' });
  assert.deepEqual(page.choices.map(choice => choice.action), ['APPROVE', 'DEFER', 'REJECT']);
  assert.match(page.choices[0].label, /controlled external specialist review/i);
  assert.equal(await readFile(join(f.directory, 'decisions.json'), 'utf8'), before);
});

test('validates and copies bounded byte-bound proposal before operational initialization', async t => {
  const f = await fixture(t);
  const original = proposal();
  const copied = gate({ decisions: f.store, proposal: original, now: () => instant });
  original.title = 'MUTATED';
  original.evaluation.bytes = 'MUTATED';
  assert.deepEqual((await copied.status(founder)).proposal, proposal());
  const malformed = [
    { ...proposal(), unexpected: true }, { ...proposal(), id: '__proto__' },
    { ...proposal(), title: 'x'.repeat(1001) }, { ...proposal(), risks: [''] },
    { ...proposal(), risks: Array(51).fill('risk') }, { ...proposal(), rollback: '' },
    { ...proposal(), proposedEffect: '' },
    { ...proposal(), evaluation: { ...proposal().evaluation, bytes: 'altered' } },
    { ...proposal(), evaluation: { ...proposal().evaluation, receipt: { ...proposal().evaluation.receipt, size: '41' } } },
    { ...proposal(), evaluation: { bytes: 'x'.repeat(1024 * 1024 + 1), receipt: artifactReceipt('x'.repeat(1024 * 1024 + 1)) } },
  ];
  for (const value of malformed) assert.throws(() => gate({ decisions: f.store, proposal: value }), error => error.code === 'INVALID_PROPOSAL');
  assert.equal((await f.store.snapshot(founderCore)).revision, 0);
});

test('only exact host-bound Founder can activate or choose, and Witness views redact private material', async t => {
  const f = await fixture(t);
  const g = f.gate;
  for (const actor of [witness, { id: 'other', role: 'founder' }, { id: 'damien', role: 'witness' }, { id: 'local-evaluator', role: 'executor' }]) {
    await reject(g.activate(actor), 'FOUNDER_REQUIRED');
    await reject(g.choose(actor, request()), 'FOUNDER_REQUIRED');
  }
  const publicPage = await g.status(witness, { ready: true, blockedReason: null });
  assert.deepEqual(publicPage.proposal, { id: proposal().id, title: proposal().title });
  assert.equal(publicPage.viewer.role, 'witness');
  await g.activate(founder);
  const page = await g.status(witness);
  const serialized = JSON.stringify(page);
  for (const secret of [proposal().evaluation.bytes, proposal().risks[0], proposal().rollback, proposal().proposedEffect]) assert.equal(serialized.includes(secret), false);
  assert.equal(Object.hasOwn(page.decision, 'evaluation'), false);
});

test('activation creates exactly one ten-minute proposal and repeated activation preserves its deadline', async t => {
  const f = await fixture(t);
  const first = await f.gate.activate(founder);
  assert.equal(first.id, proposal().id);
  assert.equal(first.status, 'PENDING');
  assert.equal(first.disposition, null);
  assert.equal(Date.parse(first.expiresAt) - Date.parse(first.createdAt), reviewWindowMs);
  const original = await f.store.snapshot(founderCore);
  assert.equal(original.policies.length, 1);
  assert.equal(original.policies[0].reviewWindowMs, reviewWindowMs);
  assert.match(original.policies[0].basis, /Founder.*10.minute.*qualification.*2026-10-18/i);
  f.setClock(instant + 120000);
  assert.deepEqual(await f.gate.activate(founder), first);
  const repeated = await f.store.snapshot(founderCore);
  assert.equal(repeated.revision, original.revision);
  assert.equal(repeated.policies.length, 1);
  await f.restart();
  assert.deepEqual(await f.gate.activate(founder), first);
});

test('expiry occurs exactly at ten minutes and survives restart without default approval or clock extension', async t => {
  const f = await fixture(t);
  const created = await f.gate.activate(founder);
  f.setClock(instant + reviewWindowMs - 1);
  assert.equal((await f.gate.status(founder)).decision.status, 'PENDING');
  f.setClock(instant + reviewWindowMs);
  await reject(f.gate.choose(founder, request()), 'DECISION_EXPIRED');
  await f.restart();
  const expired = await f.gate.activate(founder);
  assert.equal(expired.status, 'EXPIRED');
  assert.equal(expired.expiresAt, created.expiresAt);
  assert.equal(expired.disposition, null);
  await reject(f.gate.choose(founder, request()), 'DECISION_EXPIRED');
});

test('choose preserves core retry identity, revision rejection, and terminal DEFER behavior', async t => {
  const f = await fixture(t);
  await f.gate.activate(founder);
  await reject(f.gate.choose(founder, request('APPROVE', { expectedRevision: 2, requestId: 'request:stale' })), 'REVISION_MISMATCH');
  const deferred = await f.gate.choose(founder, request('DEFER'));
  assert.equal(deferred.status, 'DEFERRED');
  f.setClock(instant + reviewWindowMs + 1);
  assert.deepEqual(await f.gate.choose(founder, request('DEFER')), deferred);
  await reject(f.gate.choose(founder, request('APPROVE')), 'REQUEST_ID_REUSED');
  await reject(f.gate.choose(founder, request('APPROVE', { expectedRevision: 2, requestId: 'request:later' })), 'DECISION_TERMINAL');
  assert.equal((await f.gate.status(founder)).decision.expiresAt, deferred.expiresAt);
});

test('input guards reject coerced types, caller decision IDs, invalid actors and readiness metadata', async t => {
  const f = await fixture(t);
  const g = f.gate;
  await reject(g.choose(founder, request()), 'DECISION_NOT_FOUND');
  for (const input of [null, {}, request(undefined, { action: undefined }), request('approve'), request('APPROVE', { expectedRevision: '1' }), request('APPROVE', { expectedRevision: 0 }), request('APPROVE', { decisionId: proposal().id }), request('APPROVE', { requestId: 12 })]) await reject(g.choose(founder, input), 'INVALID_DECISION');
  for (const actor of [null, { ...founder, authenticated: true }, { ...founder, name: 123 }, { id: 'damien', role: ['founder'] }]) await reject(g.status(actor), 'ACTOR_REQUIRED');
  for (const options of [{ ready: 'true' }, { blockedReason: 1 }, { ready: false, blockedReason: 'x'.repeat(1001) }, { ready: true, unknown: true }]) await reject(g.status(founder, options), 'INVALID_CONFIG');
  assert.throws(() => gate({ decisions: f.store, proposal: proposal(), now: 1 }), error => error.code === 'INVALID_CONFIG');
  await reject(gate({ decisions: f.store, proposal: proposal(), now: () => NaN }).status(founder), 'INVALID_CLOCK');
});

test('conflicting existing proposal bytes or effect fails closed without changing durable policy', async t => {
  const f = await fixture(t);
  await f.store.setPolicy(founderCore, { id: 'policy:earlier', reviewWindowMs, basis: 'Fixture ten-minute authorization.' });
  await f.store.create(founderCore, { ...proposal(), proposedEffect: 'Deploy altered scope.' });
  const before = await f.store.snapshot(founderCore);
  await reject(f.gate.activate(founder), 'GATE_CONFLICT');
  await reject(f.gate.choose(founder, request()), 'GATE_CONFLICT');
  assert.deepEqual(await f.store.snapshot(founderCore), before);
});

test('a matching existing proposal captured under a 24-hour policy is never relabeled ten-minute', async t => {
  const f = await fixture(t);
  await f.store.setPolicy(founderCore, { id: 'policy:first-machinery', reviewWindowMs: 86400000, basis: 'Separate first-machinery fixture authorization.' });
  await f.store.create(founderCore, proposal());
  const before = await f.store.snapshot(founderCore);
  await reject(f.gate.activate(founder), 'GATE_CONFLICT');
  await reject(f.gate.choose(founder, request()), 'GATE_CONFLICT');
  assert.deepEqual(await f.store.snapshot(founderCore), before);
});

test('qualification policy is explicit and leaves the immutable earlier policy and decision intact', async t => {
  const f = await fixture(t);
  await f.store.setPolicy(founderCore, { id: 'policy:first-machinery', reviewWindowMs: 86400000, basis: 'Separate first-machinery fixture authorization.' });
  const earlier = await f.store.create(founderCore, { ...proposal(), id: 'first-machinery:fixture' });
  await f.gate.activate(founder);
  const state = await f.store.snapshot(founderCore);
  assert.deepEqual(state.decisions.find(item => item.id === earlier.id), earlier);
  assert.equal(state.policies.length, 2);
  assert.equal(state.policies[0].reviewWindowMs, 86400000);
  assert.equal(state.policies[1].reviewWindowMs, reviewWindowMs);
});

test('a historical Gate policy cannot silently capture a different current policy on retry', async t => {
  const f = await fixture(t);
  const activated = await f.gate.activate(founder);
  const gatePolicy = (await f.store.snapshot(founderCore)).policy;
  const otherDirectory = await mkdtemp(join(tmpdir(), 'ngl-gate-partial-'));
  const other = await openDecisions({ directory: otherDirectory, now: () => instant });
  t.after(async () => { await other.close(); await rm(otherDirectory, { recursive: true, force: true }); });
  await other.setPolicy(founderCore, { id: gatePolicy.id, basis: gatePolicy.basis, reviewWindowMs });
  await other.setPolicy(founderCore, { id: 'policy:changed', basis: 'Different current policy fixture.', reviewWindowMs: 86400000 });
  const before = await other.snapshot(founderCore);
  await reject(gate({ decisions: other, proposal: proposal(), now: () => instant }).activate(founder), 'GATE_CONFLICT');
  assert.deepEqual(await other.snapshot(founderCore), before);
  await f.store.setPolicy(founderCore, { id: 'policy:changed', basis: 'Different current policy fixture.', reviewWindowMs: 86400000 });
  assert.deepEqual(await f.gate.activate(founder), activated);
});

test('loads only the fixed qualification manifest and REPORT bytes and verifies the real receipt', async () => {
  assert.equal(typeof service.loadQualificationProposal, 'function', 'The qualification proposal loader has not been implemented');
  const loaded = await service.loadQualificationProposal({ root });
  const manifest = JSON.parse(await readFile(join(root, 'docs/institution/qualification/FOUNDER-DECISION-PROPOSAL.json'), 'utf8'));
  assert.equal(loaded.id, manifest.decisionId);
  assert.equal(loaded.title, 'Founders Day · Alpha 1 qualification');
  assert.deepEqual(loaded.evaluation.receipt, artifactReceipt(loaded.evaluation.bytes));
  assert.deepEqual(loaded.evaluation.receipt, manifest.evaluation.receipt);
  assert.deepEqual(loaded.risks, manifest.risks);
  assert.equal(loaded.rollback, manifest.rollback);
  assert.match(loaded.proposedEffect, /controlled external specialist review/i);
  assert.match(loaded.proposedEffect, /no deployment/i);
});

test('qualification loader fails closed for modified receipts, arbitrary paths, oversized files and symlinks', async t => {
  assert.equal(typeof service.loadQualificationProposal, 'function', 'The qualification proposal loader has not been implemented');
  const directory = await mkdtemp(join(tmpdir(), 'ngl-qualification-loader-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const qualification = join(directory, 'docs/institution/qualification');
  await mkdir(qualification, { recursive: true });
  const manifestFile = join(qualification, 'FOUNDER-DECISION-PROPOSAL.json');
  const reportFile = join(qualification, 'REPORT.md');
  const manifest = JSON.parse(await readFile(join(root, 'docs/institution/qualification/FOUNDER-DECISION-PROPOSAL.json'), 'utf8'));
  await writeFile(reportFile, 'changed bytes');
  await writeFile(manifestFile, JSON.stringify(manifest));
  await reject(service.loadQualificationProposal({ root: directory }), 'INVALID_PROPOSAL');
  await writeFile(manifestFile, JSON.stringify({ ...manifest, evaluation: { ...manifest.evaluation, path: '/etc/passwd' } }));
  await reject(service.loadQualificationProposal({ root: directory }), 'INVALID_PROPOSAL');
  await writeFile(manifestFile, JSON.stringify(manifest));
  await writeFile(reportFile, 'x'.repeat(1024 * 1024 + 1));
  await reject(service.loadQualificationProposal({ root: directory }), 'INVALID_PROPOSAL');
  await rm(reportFile);
  await symlink(resolve(root, 'docs/institution/qualification/REPORT.md'), reportFile);
  await reject(service.loadQualificationProposal({ root: directory }), 'INVALID_PROPOSAL');
});

test('qualification receipt includes the actual UTF-8 BOM bytes rather than silently stripping them', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-qualification-bom-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const qualification = join(directory, 'docs/institution/qualification');
  await mkdir(qualification, { recursive: true });
  const manifest = JSON.parse(await readFile(join(root, 'docs/institution/qualification/FOUNDER-DECISION-PROPOSAL.json'), 'utf8'));
  const bytes = '\uFEFFExact report bytes';
  await writeFile(join(qualification, 'REPORT.md'), bytes);
  manifest.evaluation.receipt = artifactReceipt(bytes.slice(1));
  await writeFile(join(qualification, 'FOUNDER-DECISION-PROPOSAL.json'), JSON.stringify(manifest));
  await reject(service.loadQualificationProposal({ root: directory }), 'INVALID_PROPOSAL');
  manifest.evaluation.receipt = artifactReceipt(bytes);
  await writeFile(join(qualification, 'FOUNDER-DECISION-PROPOSAL.json'), JSON.stringify(manifest));
  const loaded = await service.loadQualificationProposal({ root: directory });
  assert.equal(loaded.evaluation.bytes, bytes);
  assert.deepEqual(loaded.evaluation.receipt, artifactReceipt(bytes));
});
