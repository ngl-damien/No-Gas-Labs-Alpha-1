#!/usr/bin/env node
// INTERNAL AI qualification probe. All mutable application state is disposable.
// No environment key, private runtime directory, external service, or real record is used.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createGameServer } from '../../game/server.mjs';
import { openDecisions } from '../../src/institution/decisions.mjs';
import { canonicalStringify, artifactReceipt } from '../../src/institution/kernel.mjs';
import { createCourier, signEnvelope, payloadDigest } from '../../src/institution/courier.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = join(root, 'docs/institution/qualification/evidence/security-governance.json');
const startedAt = new Date().toISOString();
const temporary = await mkdtemp(join(tmpdir(), 'ngl-qualification-security-'));
const founder = { id: 'damien', role: 'founder' };
const evaluator = { id: 'local-evaluator', role: 'executor' };
const fakeKey = 'EXPLICIT-FAKE-QUALIFICATION-KEY-ONLY-0001';
const at = Date.parse('2026-10-18T12:00:00.000Z');
const evidence = [];
const digest = value => createHash('sha256').update(canonicalStringify(value)).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
let server;
function record(id, classification, result) { evidence.push({ id, classification, ...result }); }
function proposal(id = 'qualification:synthetic') {
  const bytes = 'SYNTHETIC PRIVATE EVALUATION: no actual Founder record';
  return { id, title: 'Disposable qualification proposal', evaluation: { bytes, receipt: artifactReceipt(bytes) }, risks: ['SYNTHETIC PRIVATE RISK'], rollback: 'Discard this disposable store', proposedEffect: 'No operational effect; qualification only' };
}
const policy = { id: 'qualification:policy', reviewWindowMs: 86400000, basis: 'Explicit synthetic qualification fixture; no operational deadline' };
async function rejects(promise, code) { await assert.rejects(promise, error => error.code === code); }
async function host(name) {
  server = await createGameServer({ dataDir: join(temporary, name), founderKey: fakeKey });
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  function client() {
    let cookie = '';
    return {
      get cookie() { return cookie; },
      async request(path, value, overrides = {}) {
        const response = await fetch(origin + path, {
          method: value === undefined ? 'GET' : 'POST',
          headers: { ...(cookie ? { cookie } : {}), ...(value === undefined ? {} : { 'content-type': 'application/json', origin }), ...overrides },
          ...(value === undefined ? {} : { body: JSON.stringify(value) }), signal: AbortSignal.timeout(10000)
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        const body = await response.json();
        return { status: response.status, body, setCookie };
      }
    };
  }
  return { origin, client };
}
async function closeHost() { await server?.closeGame(); server = undefined; }
async function httpBoundaries() {
  const { client } = await host('http');
  const f = client(), w = client();
  const initial = await w.request('/api/state');
  assert.equal(initial.body.viewer.role, 'witness');
  const checks = [];
  for (const [label, path, value, overrides, status, code] of [
    ['wrong-key', '/api/login', { key: 'EXPLICIT-FAKE-WRONG-KEY-0002' }, {}, 401, 'UNAUTHENTICATED'],
    ['payload-founder-spoof', '/api/login', { key: fakeKey, role: 'founder' }, {}, 400, 'INVALID_FIELDS'],
    ['witness-policy', '/api/decisions/policy', policy, {}, 403, 'FORBIDDEN'],
    ['witness-draft', '/api/action', { type: 'draft', kind: 'tool', title: 'Forbidden', intent: 'synthetic', html: '<p>synthetic</p>' }, {}, 403, 'FORBIDDEN'],
    ['cross-origin', '/api/login', { key: fakeKey }, { origin: 'http://hostile.invalid' }, 403, 'CROSS_ORIGIN'],
    ['null-origin', '/api/login', { key: fakeKey }, { origin: 'null' }, 403, 'CROSS_ORIGIN'],
    ['fetch-cross-site', '/api/login', { key: fakeKey }, { 'sec-fetch-site': 'cross-site' }, 403, 'CROSS_ORIGIN'],
    ['content-type', '/api/login', { key: fakeKey }, { 'content-type': 'text/plain' }, 415, 'CONTENT_TYPE'],
    ['oversized-body', '/api/login', { key: 'x'.repeat(262145) }, {}, 413, 'TOO_LARGE']
  ]) {
    const result = await w.request(path, value, overrides);
    assert.equal(result.status, status, label);
    assert.equal(result.body.error?.code, code, label);
    checks.push({ label, status: result.status, code: result.body.error.code });
  }
  record('HTTP-BOUNDARIES', 'CONFIRMED', { outcome: 'PASS', checks });
  const witnessCookie = f.cookie;
  const login = await f.request('/api/login', { key: fakeKey });
  assert.equal(login.body.viewer.role, 'founder');
  assert.ok(/HttpOnly/.test(login.setCookie) && /SameSite=Strict/.test(login.setCookie));
  assert.notEqual(f.cookie, witnessCookie);
  await f.request('/api/decisions/policy', policy);
  const created = await f.request('/api/decisions/proposals', proposal());
  assert.equal(created.status, 200);
  const draft = await f.request('/api/action', { type: 'draft', kind: 'custom', title: 'Synthetic private draft', intent: 'Private synthetic bytes', html: '<!doctype html><html><head><title>Synthetic qualification</title></head><body><p>SYNTHETIC-PRIVATE-DRAFT-MARKER</p></body></html>' });
  assert.equal(draft.status, 200);
  const privateDecision = await f.request('/api/decisions');
  const publicDecision = await w.request('/api/decisions');
  assert.equal(privateDecision.body.decisions[0].evaluation.bytes, proposal().evaluation.bytes);
  for (const field of ['evaluation', 'risks', 'rollback', 'proposedEffect']) assert.equal(Object.hasOwn(publicDecision.body.decisions[0], field), false, field);
  const exported = await w.request('/api/export');
  assert.equal(JSON.stringify(exported.body).includes('SYNTHETIC-PRIVATE-DRAFT-MARKER'), false);
  record('PRIVATE-REDACTION', 'CONFIRMED', { outcome: 'PASS', witnessDecisionFields: Object.keys(publicDecision.body.decisions[0]), privateEvaluationVisibleToFounder: true, witnessExportPrivateDraftAbsent: true });
  const authenticatedCookie = f.cookie;
  const logout = await f.request('/api/logout', {});
  assert.equal(logout.body.viewer.role, 'witness');
  const replay = await w.request('/api/decisions/policy', policy, { cookie: authenticatedCookie });
  assert.equal(replay.status, 403);
  record('LOGOUT-REVOCATION', 'CONFIRMED', { outcome: 'PASS', replayStatus: replay.status, replayCode: replay.body.error.code });
  const loginAgain = await f.request('/api/login', { key: fakeKey });
  assert.equal(loginAgain.status, 200);
  const beforeRestartCookie = f.cookie;
  await closeHost();
  const restarted = await host('http');
  const afterRestart = await restarted.client().request('/api/decisions/policy', policy, { cookie: beforeRestartCookie });
  assert.equal(afterRestart.status, 403);
  record('RESTART-REVOCATION', 'CONFIRMED', { outcome: 'PASS', staleCookieStatus: afterRestart.status });
  await closeHost();
}
async function sessionEviction() {
  const { client } = await host('eviction');
  const f = client();
  await f.request('/api/login', { key: fakeKey });
  const before = await f.request('/api/state');
  assert.equal(before.body.viewer.role, 'founder');
  let successful = 0;
  // Independent unauthenticated clients; no cookie is retained between requests.
  for (let i = 0; i < 512; i += 1) {
    const reply = await client().request('/api/state');
    assert.equal(reply.status, 200);
    successful += 1;
  }
  const after = await f.request('/api/state');
  assert.equal(after.body.viewer.role, 'witness');
  record('Q-SEC-001', 'REPRODUCED', { outcome: 'CONFIRMED_FAILURE', beforeRole: before.body.viewer.role, unauthenticatedSuccessfulRequests: successful, afterRole: after.body.viewer.role, failure: '512 cookie-less state reads evict an authenticated Founder session through the global 512-session FIFO' });
  await closeHost();
}
async function decisionsIntegrity() {
  const directory = join(temporary, 'decisions');
  let store = await openDecisions({ directory, now: () => at });
  await store.setPolicy(founder, policy);
  await store.create(evaluator, proposal());
  const file = join(directory, 'decisions.json');
  const pendingBytes = await readFile(file, 'utf8');
  const request = { decisionId: proposal().id, expectedRevision: 1, requestId: 'qualification:request', action: 'REJECT' };
  await store.decide(founder, request);
  const original = await store.snapshot(founder);
  assert.equal(original.decisions[0].status, 'REJECTED');
  await store.close();
  const rejectedBytes = await readFile(file, 'utf8');
  const projectionOnly = JSON.parse(rejectedBytes);
  projectionOnly.payload.projection.decisions[0].status = 'APPROVED';
  projectionOnly.digest = digest(projectionOnly.payload);
  await writeFile(file, canonicalStringify(projectionOnly));
  await rejects(openDecisions({ directory, now: () => at }), 'DECISIONS_TAMPERED');
  record('DECISION-PARTIAL-TAMPER', 'CONFIRMED', { outcome: 'PASS', code: 'DECISIONS_TAMPERED' });
  // Coherent tampering: no Founder key is supplied or read. Rebuild public hashes.
  const rewritten = JSON.parse(rejectedBytes);
  rewritten.payload.records.at(-1).event.input.action = 'APPROVE';
  const projection = rewritten.payload.projection;
  projection.decisions[0].status = 'APPROVED';
  projection.decisions[0].disposition.action = 'APPROVE';
  projection.requests[0].input.action = 'APPROVE';
  projection.requests[0].outcome.result.status = 'APPROVED';
  projection.requests[0].outcome.result.disposition.action = 'APPROVE';
  projection.audit.at(-1).action = 'APPROVE';
  projection.audit.at(-1).outcome.status = 'APPROVED';
  let previousHash = rewritten.payload.records[0].previousHash;
  for (const record of rewritten.payload.records) {
    record.previousHash = previousHash;
    record.hash = digest({ index: record.index, previousHash, event: record.event });
    previousHash = record.hash;
  }
  rewritten.digest = digest(rewritten.payload);
  await writeFile(file, canonicalStringify(rewritten));
  store = await openDecisions({ directory, now: () => at });
  const forged = await store.snapshot(founder);
  assert.equal(forged.decisions[0].status, 'APPROVED');
  assert.equal(forged.decisions[0].disposition.actorId, 'damien');
  record('Q-GOV-001', 'REPRODUCED', { outcome: 'CONFIRMED_FAILURE', originalDisposition: original.decisions[0].status, rewrittenDisposition: forged.decisions[0].status, attributedActor: forged.decisions[0].disposition.actorId, originalHead: original.head, rewrittenHead: forged.head, prerequisite: 'Offline write access to the decision envelope; no authentication key access needed', failure: 'Consistent hash-chain/projection rewrite changes a recorded Founder rejection into an accepted Founder approval' });
  await store.close();
  await writeFile(file, pendingBytes);
  store = await openDecisions({ directory, now: () => at });
  const rolledBack = await store.snapshot(founder);
  assert.equal(rolledBack.decisions[0].status, 'PENDING');
  record('Q-GOV-002', 'REPRODUCED', { outcome: 'CONFIRMED_FAILURE', oldRevision: original.revision, restoredRevision: rolledBack.revision, terminalDispositionLost: rolledBack.decisions[0].status, prerequisite: 'Restore an older valid envelope while service is stopped', failure: 'Restart accepts a valid pre-disposition snapshot without a monotonic external head check' });
  await store.close();
  await writeFile(file, rejectedBytes);
  store = await openDecisions({ directory, now: () => at });
  assert.equal((await store.snapshot(founder)).decisions[0].status, 'REJECTED');
  await store.close();
  record('DECISION-RECOVERY', 'CONFIRMED', { outcome: 'PASS', restoredKnownGoodDisposition: 'REJECTED' });
}
async function courierIntegrity() {
  // Both keypairs are fabricated in memory exclusively for this disposable probe.
  const a = generateKeyPairSync('ed25519'), b = generateKeyPairSync('ed25519');
  const publicA = a.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const publicB = b.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const directory = join(temporary, 'courier');
  const enrollment = [{ id: 'synthetic-provider', publicKey: publicA, capabilities: ['review'] }];
  const courier = await createCourier({ dataDir: directory, providers: enrollment, now: () => at + 2000 });
  await courier.dispatch({ requestId: 'qualification:dispatch', capability: 'review', input: { evidence: 'synthetic only' }, expiresAt: at + 10000 });
  const packet = await courier.exportDispatch('qualification:dispatch', 'synthetic-provider');
  const shared = { request: packet.payload, requestDigest: packet.digest, at: at + 2000 };
  const ack = { schema: 'ngl.courier.ack.v1', ...shared, accepted: true };
  const reply = { schema: 'ngl.courier.reply.v1', ...shared, output: { result: 'synthetic approval' }, dissent: null };
  await rejects(courier.acknowledge(signEnvelope(ack, b.privateKey)), 'INVALID_SIGNATURE');
  await courier.acknowledge(signEnvelope(ack, a.privateKey));
  await courier.respond(signEnvelope(reply, a.privateKey));
  record('COURIER-SIGNATURE-CONTROL', 'CONFIRMED', { outcome: 'PASS', wrongKey: 'INVALID_SIGNATURE', correctKey: 'RESPONDED' });
  const file = join(directory, 'courier.json');
  const original = await readFile(file, 'utf8');
  const rewritten = JSON.parse(original);
  rewritten.providers[0].publicKey = publicB;
  rewritten.providers[0].fingerprint = payloadDigest(publicB);
  const seat = rewritten.requests[0].seats[0];
  seat.acknowledgment = signEnvelope(seat.acknowledgment.payload, b.privateKey);
  seat.response = signEnvelope(seat.response.payload, b.privateKey);
  const { checksum: ignored, ...body } = rewritten;
  rewritten.checksum = payloadDigest(body);
  await writeFile(file, JSON.stringify(rewritten));
  // The already-open courier was configured with enrollment A, then disk changed.
  const acceptedWhileOpen = await courier.snapshot();
  assert.equal(acceptedWhileOpen.requests[0].status, 'RESPONDED');
  assert.equal(acceptedWhileOpen.providers[0].fingerprint, payloadDigest(publicB));
  const reopened = await createCourier({ dataDir: directory, now: () => at + 2000 });
  assert.equal((await reopened.snapshot()).requests[0].status, 'RESPONDED');
  await rejects(createCourier({ dataDir: directory, providers: enrollment, now: () => at + 2000 }), 'IDENTITY_CONFLICT');
  record('Q-SEC-002', 'REPRODUCED', { outcome: 'CONFIRMED_FAILURE', oldFingerprint: payloadDigest(publicA), acceptedFingerprint: acceptedWhileOpen.providers[0].fingerprint, existingConfiguredInstanceAcceptedRegistryDrift: true, reopeningWithoutExternalPins: 'RESPONDED', reopeningWithOriginalPins: 'IDENTITY_CONFLICT', prerequisite: 'Write access to courier.json and a newly generated attacker key; no enrolled private key access', failure: 'Enrollment and signed receipts can be replaced together; transaction validation uses mutable disk enrollment rather than the configured original registry' });
  await writeFile(file, original);
  const recovered = await createCourier({ dataDir: directory, providers: enrollment, now: () => at + 2000 });
  assert.equal((await recovered.snapshot()).providers[0].fingerprint, payloadDigest(publicA));
  record('COURIER-RECOVERY', 'CONFIRMED', { outcome: 'PASS', originalRegistryRestored: true });
}

let exitCode = 0;
let failure;
try {
  await httpBoundaries();
  await sessionEviction();
  await decisionsIntegrity();
  await courierIntegrity();
} catch (error) {
  exitCode = 1;
  failure = { code: error.code ?? error.name, message: error.message, stack: error.stack };
} finally {
  await closeHost().catch(error => { exitCode = 1; failure ??= { message: error.message }; });
  await rm(temporary, { recursive: true, force: true });
}
const result = {
  schema: 'ngl.qualification.security-governance.v1', type: 'INTERNAL_AI_ADVERSARIAL_QUALIFICATION',
  startedAt, completedAt: new Date().toISOString(), runtime: process.version,
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  command: 'node scripts/qualification/security-governance.mjs', exitCode,
  safety: { disposableStateRemoved: true, explicitFakeFounderKey: true, generatedInMemoryProviderKeys: true, externalRequests: 0, productionCodeModified: false },
  interpretation: 'A zero exit means the controls and bounded reproductions matched assertions; confirmed weaknesses remain failures of the tested claims.',
  checks: evidence, ...(failure ? { harnessFailure: failure } : {}),
  limits: ['No live records, real key files, deployment, third-party attacks or network exposure tested.', 'HTTP probes use Node fetch on a loopback server; browser/TLS/reverse-proxy behavior is untested.', 'Disk attacks assume write access to disposable state; this is not a remote unauthenticated exploit.', 'No independent human security or governance review; no certification claim.']
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ command: result.command, exitCode, evidence: output, checks: evidence.map(({ id, outcome }) => ({ id, outcome })), ...(failure ? { failure } : {}) }, null, 2));
process.exitCode = exitCode;
