import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const kernel = await import('../src/institution/kernel.mjs').catch(() => ({}));
const ledgerModule = await import('../src/institution/ledger.mjs').catch(() => ({}));
const config = { founderId: 'founder', actors: [
  { id: 'founder', roles: ['founder'], kind: 'human' },
  { id: 'builder', roles: ['executor'], kind: 'local-process' },
  { id: 'verifier', roles: ['observer'], kind: 'local-process' },
  { id: 'other', roles: ['observer'], kind: 'local-process' },
] };
const at = '2026-10-17T12:00:00.000Z';
const bytes = Buffer.from('<!doctype html><button>Real bytes</button>');
function fixture() {
  const receipt = kernel.artifactReceipt(bytes);
  const subject = { id: 'creation:one', version: 1 };
  const common = { at, workId: 'work:one' };
  const bound = { grantId: 'grant:one', executionId: 'execution:one', subject, outputs: [receipt] };
  const events = [
    { ...common, id: 'claim:one', type: 'claim', actor: 'builder', expectedRevision: 0, subject, action: 'publish' },
    { ...common, id: 'authorize:one', type: 'authorize', actor: 'founder', expectedRevision: 1, grantId: bound.grantId, executorId: 'builder', observerId: 'verifier', scope: { subjectId: subject.id, subjectVersion: 1, action: 'publish' }, expiresAt: '2026-10-18T00:00:00.000Z' },
    { ...common, ...bound, id: 'execute:one', type: 'execute', actor: 'builder', expectedRevision: 2 },
    { ...common, ...bound, id: 'observe:one', type: 'observe', actor: 'verifier', expectedRevision: 3, passed: true, checks: [{ id: 'actual-bytes', passed: true }] },
    { ...common, ...bound, id: 'adjudicate:one', type: 'adjudicate', actor: 'founder', expectedRevision: 4, observationId: 'observe:one', decision: 'accept' },
  ];
  return { events, artifacts: new Map([[receipt.digest, bytes]]), receipt };
}
function through(count = 5) {
  const f = fixture();
  let state = kernel.createKernel(config);
  for (const event of f.events.slice(0, count)) state = kernel.applyEvent(state, event, f);
  return { ...f, state };
}
function rejectsCode(fn, code) { assert.throws(fn, error => error.code === code); }
async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-kernel-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('exports an executable institutional transition API', () => {
  assert.equal(typeof kernel.createKernel, 'function');
  assert.equal(typeof ledgerModule.openLedger, 'function');
});

test('five stages accept exact output bytes and replay canonically', () => {
  const { state, events, artifacts, receipt } = through();
  assert.equal(state.revision, 5);
  assert.equal(state.works['work:one'].stage, 'accepted');
  assert.equal(state.subjects['creation:one'].version, 1);
  assert.deepEqual(state.subjects['creation:one'].outputs, [receipt]);
  assert.equal(kernel.canonicalStringify(kernel.replayKernel(events, config, { artifacts })), kernel.canonicalStringify(state));
  assert.equal(kernel.canonicalStringify({ z: 1, a: 2 }), '{"a":2,"z":1}');
});

test('authority comes from configured roster rather than event role labels', () => {
  const { state, events } = through(1);
  rejectsCode(() => kernel.applyEvent(state, { ...events[1], actor: 'builder' }), 'FOUNDER_REQUIRED');
  rejectsCode(() => kernel.applyEvent(state, { ...events[1], actor: 'impostor' }), 'UNKNOWN_ACTOR');
  rejectsCode(() => kernel.applyEvent(state, { ...events[1], actor: { id: 'founder', role: 'founder' } }), 'INVALID_EVENT');
  rejectsCode(() => kernel.applyEvent(state, { ...events[1], type: 'toString' }), 'INVALID_EVENT');
});

test('grant must match the exact subject, version, action and separated roles', () => {
  const { state, events } = through(1);
  for (const scope of [{ subjectId: 'another' }, { subjectVersion: 2 }, { action: 'deploy' }]) {
    rejectsCode(() => kernel.applyEvent(state, { ...events[1], scope: { ...events[1].scope, ...scope } }), 'SCOPE_MISMATCH');
  }
  rejectsCode(() => kernel.applyEvent(state, { ...events[1], observerId: 'builder' }), 'SELF_OBSERVATION');
  rejectsCode(() => kernel.applyEvent(state, { ...events[1], executorId: 'other' }), 'ROLE_REQUIRED');
});

test('ordering and global revisions reject stale writes', () => {
  const { state, events, artifacts } = through(1);
  rejectsCode(() => kernel.applyEvent(state, { ...events[2], expectedRevision: 1 }, { artifacts }), 'INVALID_STAGE');
  rejectsCode(() => kernel.applyEvent(state, { ...events[1], expectedRevision: 0 }), 'STALE_REVISION');
});

test('identical event retry is idempotent and conflicting IDs reject', () => {
  const { state, events } = through(1);
  assert.deepEqual(kernel.applyEvent(state, structuredClone(events[0])), state);
  rejectsCode(() => kernel.applyEvent(state, { ...events[0], action: 'other' }), 'EVENT_ID_CONFLICT');
});

test('execution requires actual bytes matching every receipt', () => {
  const { state, events, receipt } = through(2);
  rejectsCode(() => kernel.applyEvent(state, events[2]), 'ARTIFACT_MISSING');
  rejectsCode(() => kernel.applyEvent(state, events[2], { artifacts: { [receipt.digest]: Buffer.from('tampered') } }), 'ARTIFACT_MISMATCH');
  rejectsCode(() => kernel.applyEvent(state, { ...events[2], actor: 'founder' }, { artifacts: { [receipt.digest]: bytes } }), 'EXECUTOR_MISMATCH');
});

test('observation rejects self-observation and swapped execution, subject, grant or outputs', () => {
  const { state, events, artifacts } = through(3);
  rejectsCode(() => kernel.applyEvent(state, { ...events[3], actor: 'builder' }, { artifacts }), 'SELF_OBSERVATION');
  for (const change of [{ executionId: 'other' }, { grantId: 'other' }, { subject: { id: 'creation:one', version: 2 } }, { outputs: [kernel.artifactReceipt(Buffer.from('other'))] }]) {
    rejectsCode(() => kernel.applyEvent(state, { ...events[3], ...change }, { artifacts }), 'BINDING_MISMATCH');
  }
  rejectsCode(() => kernel.applyEvent(state, { ...events[3], actor: 'other' }, { artifacts }), 'OBSERVER_MISMATCH');
  rejectsCode(() => kernel.applyEvent(state, events[3]), 'ARTIFACT_MISSING');
});

test('adjudication requires the exact observation and positive observation for acceptance', () => {
  const { state, events, artifacts } = through(4);
  rejectsCode(() => kernel.applyEvent(state, { ...events[4], observationId: 'made-up' }, { artifacts }), 'BINDING_MISMATCH');
  let negative = through(3).state;
  negative = kernel.applyEvent(negative, { ...events[3], passed: false }, { artifacts });
  rejectsCode(() => kernel.applyEvent(negative, events[4], { artifacts }), 'OBSERVATION_FAILED');
  const rejected = kernel.applyEvent(negative, { ...events[4], decision: 'reject' }, { artifacts });
  assert.equal(rejected.works['work:one'].stage, 'rejected');
  assert.equal(rejected.subjects['creation:one'], undefined);
});

test('expired and revoked grants cannot execute', () => {
  const { state, events, artifacts } = through(2);
  rejectsCode(() => kernel.applyEvent(state, { ...events[2], at: '2026-10-18T00:00:00.000Z' }, { artifacts }), 'GRANT_EXPIRED');
  const revoked = kernel.applyEvent(state, { id: 'revoke:one', type: 'revoke', actor: 'founder', at, expectedRevision: 2, workId: 'work:one', grantId: 'grant:one', reason: 'Withdrawn' });
  rejectsCode(() => kernel.applyEvent(revoked, { ...events[2], expectedRevision: 3 }, { artifacts }), 'GRANT_REVOKED');
});

test('accepted subject version cannot be claimed again and history cannot go backward in time', () => {
  const { state, events } = through();
  rejectsCode(() => kernel.applyEvent(state, { ...events[0], id: 'claim:two', workId: 'work:two', expectedRevision: 5 }), 'STALE_SUBJECT');
  rejectsCode(() => kernel.applyEvent(state, { ...events[0], id: 'claim:two', workId: 'work:two', subject: { id: 'creation:one', version: 2 }, expectedRevision: 5, at: '2026-10-16T00:00:00.000Z' }), 'TIME_REGRESSION');
});

test('canonical input rejects undefined, nonfinite values and prototype keys', () => {
  rejectsCode(() => kernel.canonicalStringify({ x: undefined }), 'INVALID_JSON');
  rejectsCode(() => kernel.canonicalStringify({ x: NaN }), 'INVALID_JSON');
  rejectsCode(() => kernel.canonicalStringify(JSON.parse('{"__proto__":{"bad":true}}')), 'INVALID_JSON');
});

test('canonical input rejects non-enumerable own properties instead of silently omitting them', () => {
  const hiddenObject = { visible: 1 };
  Object.defineProperty(hiddenObject, 'hidden', { value: 2, enumerable: false });
  rejectsCode(() => kernel.canonicalStringify(hiddenObject), 'INVALID_JSON');

  const hiddenArray = [1];
  Object.defineProperty(hiddenArray, 'hidden', { value: 2, enumerable: false });
  rejectsCode(() => kernel.canonicalStringify(hiddenArray), 'INVALID_JSON');

  assert.equal(kernel.canonicalStringify([1, { a: 2 }]), '[1,{"a":2}]',
    'ordinary dense JSON arrays remain supported');
});

test('ordinary IDs that overlap inherited object methods remain valid own records', () => {
  const { events, artifacts } = fixture();
  let state = kernel.createKernel(config);
  for (const event of events) {
    const changed = { ...event, workId: 'toString' };
    if (changed.subject) changed.subject = { ...changed.subject, id: 'hasOwnProperty' };
    if (changed.scope) changed.scope = { ...changed.scope, subjectId: 'hasOwnProperty' };
    state = kernel.applyEvent(state, changed, { artifacts });
  }
  assert.equal(state.works.toString.stage, 'accepted');
  assert.equal(state.subjects.hasOwnProperty.version, 1);
});

test('competing subject claims cannot both accept the same next version', () => {
  const first = fixture();
  const second = first.events.map(event => {
    const changed = { ...event, id: `${event.id}:two`, workId: 'work:two' };
    if (changed.grantId) changed.grantId = 'grant:two';
    if (changed.executionId) changed.executionId = 'execution:two';
    if (changed.observationId) changed.observationId = 'observe:one:two';
    return changed;
  });
  let state = kernel.createKernel(config);
  for (const event of [...first.events.slice(0, 4), ...second.slice(0, 4)]) state = kernel.applyEvent(state, { ...event, expectedRevision: state.revision }, first);
  state = kernel.applyEvent(state, { ...first.events[4], expectedRevision: state.revision }, first);
  rejectsCode(() => kernel.applyEvent(state, { ...second[4], expectedRevision: state.revision }, first), 'STALE_SUBJECT');
});

test('durable ledger serializes concurrent appends, persists bytes and replays after restart', async t => {
  const directory = await temp(t);
  let ledger = await ledgerModule.openLedger({ directory, ...config });
  const { events, artifacts, receipt } = fixture();
  const results = await Promise.all(events.map(event => ledger.append(event, { artifacts })));
  assert.deepEqual(results.map(state => state.revision), [1, 2, 3, 4, 5]);
  assert.deepEqual(await ledger.getArtifact(receipt.digest), bytes);
  const before = ledger.state;
  before.revision = 999;
  assert.equal(ledger.state.revision, 5);
  await ledger.append(events[0]);
  assert.equal(ledger.events.length, 5);
  await ledger.close();
  ledger = await ledgerModule.openLedger({ directory, ...config });
  assert.equal(ledger.state.works['work:one'].stage, 'accepted');
  assert.equal(ledger.state.revision, 5);
  await ledger.close();
});

test('ledger rejects competing writers and rejects use after close', async t => {
  const directory = await temp(t);
  const ledger = await ledgerModule.openLedger({ directory, ...config });
  await assert.rejects(ledgerModule.openLedger({ directory, ...config }), error => error.code === 'LEDGER_LOCKED');
  await ledger.close();
  await assert.rejects(ledger.append(fixture().events[0]), error => error.code === 'LEDGER_CLOSED');
});

test('stale queued append rejects without poisoning the serialized writer', async t => {
  const directory = await temp(t);
  const ledger = await ledgerModule.openLedger({ directory, ...config });
  const { events } = fixture();
  const competing = { ...events[0], id: 'claim:two', workId: 'work:two' };
  const outcomes = await Promise.allSettled([ledger.append(events[0]), ledger.append(competing)]);
  assert.equal(outcomes[0].status, 'fulfilled');
  assert.equal(outcomes[1].reason.code, 'STALE_REVISION');
  await ledger.append(events[1]);
  assert.equal(ledger.state.revision, 2);
  await ledger.close();
});

test('a ledger directory-sync failure after rename blocks later appends until validated reopen', async t => {
  const directory = await temp(t);
  let failNextSync = true;
  const syncDirectory = async path => {
    if (failNextSync) {
      failNextSync = false;
      throw new Error('injected directory-sync failure');
    }
    const parent = await open(path, 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  };
  const ledger = await ledgerModule.openLedger({ directory, ...config, syncDirectory });
  const first = fixture().events[0];

  await assert.rejects(ledger.append(first), error => error.code === 'COMMIT_DURABILITY_UNCERTAIN');
  assert.equal(ledger.state.revision, 0);
  assert.equal(ledger.events.length, 0);
  await assert.rejects(
    ledger.append({ ...first, id: 'claim:two', workId: 'work:two' }),
    error => error.code === 'COMMIT_DURABILITY_UNCERTAIN'
  );

  // The ledger rename already happened. Reopen validates whichever complete
  // envelope is present; the live writer must not overwrite it from stale memory.
  const saved = JSON.parse(await readFile(join(directory, 'ledger.json'), 'utf8'));
  assert.equal(saved.records.length, 1);
  assert.equal(saved.records[0].event.id, first.id);
  await ledger.close();

  const reopened = await ledgerModule.openLedger({ directory, ...config });
  assert.equal(reopened.state.revision, 1);
  assert.equal(reopened.events[0].id, first.id);
  await reopened.close();
});

test('durable append failure never adopts an uncommitted projection', async t => {
  const directory = await temp(t);
  const ledger = await ledgerModule.openLedger({ directory, ...config });
  await mkdir(join(directory, 'ledger.json'));
  await assert.rejects(ledger.append(fixture().events[0]));
  assert.equal(ledger.state.revision, 0);
  assert.equal(ledger.events.length, 0);
  await ledger.close();
});

test('load rejects event-chain tampering and does not trust saved projection', async t => {
  const directory = await temp(t);
  const ledger = await ledgerModule.openLedger({ directory, ...config });
  await ledger.append(fixture().events[0]);
  await ledger.close();
  const file = join(directory, 'ledger.json');
  const original = JSON.parse(await readFile(file, 'utf8'));
  const changed = structuredClone(original);
  changed.records[0].event.action = 'deploy';
  await writeFile(file, JSON.stringify(changed));
  await assert.rejects(ledgerModule.openLedger({ directory, ...config }), error => error.code === 'LEDGER_TAMPERED');
  const projection = structuredClone(original);
  projection.projection.revision = 80;
  await writeFile(file, JSON.stringify(projection));
  await assert.rejects(ledgerModule.openLedger({ directory, ...config }), error => error.code === 'PROJECTION_MISMATCH');
});

test('load verifies persisted artifact bytes and trusted roster', async t => {
  const directory = await temp(t);
  const ledger = await ledgerModule.openLedger({ directory, ...config });
  const { events, artifacts, receipt } = fixture();
  for (const event of events.slice(0, 3)) await ledger.append(event, { artifacts });
  await ledger.close();
  await assert.rejects(ledgerModule.openLedger({ directory, ...config, actors: config.actors.map(actor => ({ ...actor, name: actor.id })) }), error => error.code === 'CONFIG_MISMATCH');
  await writeFile(join(directory, 'blobs', receipt.digest), 'corrupt');
  await assert.rejects(ledgerModule.openLedger({ directory, ...config }), error => error.code === 'ARTIFACT_MISMATCH');
});
