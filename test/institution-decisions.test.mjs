import test from 'node:test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, readFile, writeFile, mkdir, rename, rm, symlink, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { canonicalStringify, artifactReceipt } from '../src/institution/kernel.mjs';

const decisionsModule = await import('../src/institution/decisions.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const founder = { id: 'damien', role: 'founder' };
const evaluator = { id: 'local-evaluator', role: 'executor' };
const witness = { id: 'witness:one', role: 'witness' };
const instant = Date.parse('2026-10-18T12:00:00.000Z');
const policy = { id: 'policy:synthetic', reviewWindowMs: 1000, basis: 'Synthetic unit-test interval; not an operational review window.' };
const digest = value => createHash('sha256').update(canonicalStringify(value)).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
function proposal(id = 'decision:one') {
  const bytes = '{"schema":"test.evaluation.v1","result":"fixture café 🌍"}';
  return { id, title: 'Synthetic packaging review', evaluation: { bytes, receipt: artifactReceipt(bytes) }, risks: ['Synthetic private risk'], rollback: 'git checkout fixture-baseline', proposedEffect: 'Record fixture M1 review only; no execution.' };
}
function request(action = 'APPROVE', overrides = {}) { return { decisionId: 'decision:one', expectedRevision: 1, requestId: 'request:one', action, ...overrides }; }
async function rejected(promise, code) { await assert.rejects(promise, error => error.code === code, `Expected ${code}`); }
async function fixture(t, { configured = true } = {}) {
  assert.equal(typeof decisionsModule.openDecisions, 'function', 'The durable decision service is not implemented');
  const directory = await mkdtemp(join(tmpdir(), 'ngl-decisions-'));
  let clock = instant;
  const store = await decisionsModule.openDecisions({ directory, now: () => clock });
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  if (configured) await store.setPolicy(founder, policy);
  return { store, directory, setClock: value => { clock = value; } };
}

test('starts unconfigured instead of inventing an operational policy or pending decision', async t => {
  const { store } = await fixture(t, { configured: false });
  const state = await store.snapshot(founder);
  assert.equal(state.policy, null);
  assert.deepEqual(state.decisions, []);
  assert.equal(state.revision, 0);
  await rejected(store.create(evaluator, proposal()), 'POLICY_UNCONFIGURED');
});

test('only the host-bound exact Founder identity can set a review policy', async t => {
  const { store } = await fixture(t, { configured: false });
  for (const actor of [witness, evaluator, { id: 'impostor', role: 'founder' }, { id: 'damien', role: 'executor' }]) {
    await rejected(store.setPolicy(actor, policy), 'FOUNDER_REQUIRED');
  }
  const saved = await store.setPolicy(founder, policy);
  assert.equal(saved.basis, policy.basis);
  assert.equal(saved.revision, 1);
  assert.equal(saved.setAt, new Date(instant).toISOString());
});

test('rejects missing, invented and excessively long policy fields', async t => {
  const { store } = await fixture(t, { configured: false });
  for (const invalid of [
    { ...policy, reviewWindowMs: 0 }, { ...policy, reviewWindowMs: -1 }, { ...policy, reviewWindowMs: 1.5 },
    { ...policy, reviewWindowMs: 30 * 86400000 + 1 }, { ...policy, basis: '   ' }, { ...policy, actor: founder },
    { ...policy, expiresAt: 'invented' }, { ...policy, id: '__proto__' },
  ]) await rejected(store.setPolicy(founder, invalid), 'INVALID_POLICY');
  assert.equal((await store.snapshot(founder)).revision, 0);
});

test('creates a real byte-bound proposal with server-derived time and captured policy', async t => {
  const { store } = await fixture(t);
  const created = await store.create(evaluator, proposal());
  assert.equal(created.status, 'PENDING');
  assert.equal(created.revision, 1);
  assert.equal(created.createdAt, new Date(instant).toISOString());
  assert.equal(created.expiresAt, new Date(instant + 1000).toISOString());
  assert.deepEqual(created.policy, { id: policy.id, revision: 1 });
  assert.deepEqual(created.evaluation, proposal().evaluation);
  assert.equal(created.disposition, null);
  await rejected(store.create(witness, proposal('decision:two')), 'CREATOR_REQUIRED');
  await rejected(store.create({ id: 'other', role: 'executor' }, proposal('decision:two')), 'CREATOR_REQUIRED');
});

test('verifies actual UTF-8 bytes, exact receipt schema and bounded proposal fields', async t => {
  const { store } = await fixture(t);
  const original = proposal();
  const malformed = [
    { ...original, actor: founder }, { ...original, createdAt: new Date(instant).toISOString() },
    { ...original, evaluation: { ...original.evaluation, html: '<b>fake result</b>' } },
    { ...original, evaluation: { ...original.evaluation, receipt: { ...original.evaluation.receipt, size: original.evaluation.bytes.length } } },
    { ...original, evaluation: { ...original.evaluation, bytes: 'altered' } },
    { ...original, evaluation: { bytes: 'a'.repeat(1024 * 1024 + 1), receipt: artifactReceipt('a'.repeat(1024 * 1024 + 1)) } },
    { ...original, rollback: '' }, { ...original, risks: 'all fine' }, { ...original, risks: [''] },
    { ...original, proposedEffect: '' },
  ];
  for (const item of malformed) await rejected(store.create(evaluator, item), 'INVALID_PROPOSAL');
  assert.equal((await store.snapshot(founder)).decisions.length, 0);
});

test('policy and proposal IDs are immutable, with exact duplicate creates idempotent', async t => {
  const { store } = await fixture(t);
  const first = await store.create(evaluator, proposal());
  assert.deepEqual(await store.create(evaluator, proposal()), first);
  await rejected(store.create(evaluator, { ...proposal(), title: 'replacement scope' }), 'DECISION_ID_REUSED');
  const revision = (await store.snapshot(founder)).revision;
  await store.setPolicy(founder, policy);
  assert.equal((await store.snapshot(founder)).revision, revision);
  await rejected(store.setPolicy(founder, { ...policy, reviewWindowMs: 2000 }), 'POLICY_ID_REUSED');
});

test('Founder disposition is explicit and records no automatic promotion or execution', async t => {
  const { store } = await fixture(t);
  await store.create(evaluator, proposal());
  for (const actor of [evaluator, witness, { id: 'impostor', role: 'founder' }]) await rejected(store.decide(actor, request()), 'FOUNDER_REQUIRED');
  const decided = await store.decide(founder, request());
  assert.equal(decided.status, 'APPROVED');
  assert.equal(decided.revision, 2);
  assert.deepEqual(decided.disposition, { action: 'APPROVE', actorId: founder.id, requestId: 'request:one', decidedAt: new Date(instant).toISOString() });
  assert.equal(Object.hasOwn(decided, 'executed'), false);
  assert.equal(decided.proposedEffect, proposal().proposedEffect);
});

test('serializes competing decisions so an exact expected revision permits only one winner', async t => {
  const { store } = await fixture(t);
  await store.create(evaluator, proposal());
  const settled = await Promise.allSettled([
    store.decide(founder, request('APPROVE', { requestId: 'request:approve' })),
    store.decide(founder, request('REJECT', { requestId: 'request:reject' })),
  ]);
  assert.equal(settled.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(settled.find(result => result.status === 'rejected').reason.code, 'REVISION_MISMATCH');
  const state = await store.snapshot(founder);
  assert.equal(state.decisions[0].status, 'APPROVED');
  assert.equal(state.audit.filter(event => event.type === 'decision-attempted').length, 2);
});

test('exact decision request retry returns the original result before expiry or revision checks', async t => {
  const { store, setClock } = await fixture(t);
  await store.create(evaluator, proposal());
  const first = await store.decide(founder, request());
  const revision = (await store.snapshot(founder)).revision;
  setClock(instant + 100000);
  assert.deepEqual(await store.decide(founder, request()), first);
  assert.equal((await store.snapshot(founder)).revision, revision);
  await rejected(store.decide(founder, request('REJECT')), 'REQUEST_ID_REUSED');
  await rejected(store.decide(founder, request('APPROVE', { decisionId: 'decision:other' })), 'REQUEST_ID_REUSED');
  await rejected(store.decide(founder, request('APPROVE', { expectedRevision: 2 })), 'REQUEST_ID_REUSED');
});

test('expiry is enforced exactly at the deadline and durably audits the rejected request', async t => {
  const { store, directory, setClock } = await fixture(t);
  await store.create(evaluator, proposal());
  setClock(instant + 1000);
  await rejected(store.decide(founder, request()), 'DECISION_EXPIRED');
  const state = await store.snapshot(founder);
  assert.equal(state.decisions[0].status, 'EXPIRED');
  assert.equal(state.decisions[0].revision, 2);
  assert.equal(state.decisions[0].disposition, null);
  const audit = state.audit.find(event => event.type === 'decision-attempted');
  assert.equal(audit.outcome.code, 'DECISION_EXPIRED');
  assert.equal(audit.at, new Date(instant + 1000).toISOString());
  await store.close();
  const reopened = await decisionsModule.openDecisions({ directory, now: () => instant + 2000 });
  try {
    await rejected(reopened.decide(founder, request()), 'DECISION_EXPIRED');
    assert.equal((await reopened.snapshot(founder)).revision, state.revision);
  } finally { await reopened.close(); }
});

test('snapshot observes expiry durably without inventing Founder intent', async t => {
  const { store, setClock } = await fixture(t);
  await store.create(evaluator, proposal());
  setClock(instant + 1001);
  const state = await store.snapshot(witness);
  assert.equal(state.decisions[0].status, 'EXPIRED');
  const full = await store.snapshot(founder);
  const expiry = full.audit.find(event => event.type === 'expiry-observed');
  assert.equal(expiry.actor.id, 'decision-service');
  assert.equal(expiry.at, new Date(instant + 1001).toISOString());
  assert.equal(full.decisions[0].disposition, null);
});

test('DEFER is terminal and never silently extends the authorized review window', async t => {
  const { store } = await fixture(t);
  await store.create(evaluator, proposal());
  const deferred = await store.decide(founder, request('DEFER'));
  assert.equal(deferred.status, 'DEFERRED');
  assert.equal(deferred.expiresAt, new Date(instant + 1000).toISOString());
  await rejected(store.decide(founder, request('APPROVE', { expectedRevision: 2, requestId: 'request:later' })), 'DECISION_TERMINAL');
});

test('policy changes do not rewrite deadlines or evidence on existing proposals', async t => {
  const { store, setClock } = await fixture(t);
  const first = await store.create(evaluator, proposal());
  setClock(instant + 20);
  await store.setPolicy(founder, { ...policy, id: 'policy:second', reviewWindowMs: 5000 });
  const second = await store.create(founder, proposal('decision:two'));
  assert.equal(second.expiresAt, new Date(instant + 5020).toISOString());
  assert.deepEqual((await store.snapshot(founder)).decisions[0], first);
});

test('redacts private policy basis, evidence bytes, scope, risks and rollback from non-Founder snapshots', async t => {
  const { store } = await fixture(t);
  await store.create(evaluator, proposal());
  for (const actor of [witness, evaluator]) {
    const publicState = await store.snapshot(actor);
    const serialized = JSON.stringify(publicState);
    for (const secret of [policy.basis, proposal().evaluation.bytes, proposal().risks[0], proposal().rollback, proposal().proposedEffect]) assert.equal(serialized.includes(secret), false);
    assert.equal(publicState.decisions[0].title, proposal().title);
    assert.equal(Object.hasOwn(publicState, 'audit'), false);
    assert.equal(Object.hasOwn(publicState.decisions[0], 'evaluation'), false);
  }
  await rejected(store.snapshot({ id: 'other', role: 'founder' }), 'ACTOR_REQUIRED');
});

test('durable restart replays policy, exact evaluation and disposition without relying on chat state', async t => {
  const { store, directory } = await fixture(t);
  await store.create(evaluator, proposal());
  await store.decide(founder, request('REJECT'));
  const before = await store.snapshot(founder);
  await store.close();
  const reopened = await decisionsModule.openDecisions({ directory, now: () => instant });
  try {
    assert.deepEqual(await reopened.snapshot(founder), before);
    assert.deepEqual(await reopened.decide(founder, request('REJECT')), before.decisions[0]);
  } finally { await reopened.close(); }
});

test('mutating caller inputs or returned snapshots cannot alter queued or durable authority', async t => {
  const { store } = await fixture(t);
  const input = proposal();
  const actor = copy(evaluator);
  const pending = store.create(actor, input);
  input.title = 'raced caller mutation'; input.evaluation.bytes = 'replaced'; actor.id = 'impostor';
  const created = await pending;
  assert.equal(created.title, proposal().title);
  created.evaluation.bytes = 'returned mutation';
  const state = await store.snapshot(founder);
  state.decisions[0].status = 'APPROVED';
  assert.equal((await store.snapshot(founder)).decisions[0].status, 'PENDING');
  assert.equal((await store.snapshot(founder)).decisions[0].evaluation.bytes, proposal().evaluation.bytes);
});

test('rejects a group/world-accessible decision directory before acquiring a writer lock', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-decisions-directory-mode-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await chmod(directory, 0o755);
  await assert.rejects(decisionsModule.openDecisions({ directory, now: () => instant }), error => error.code === 'INVALID_CONFIG');
  await assert.rejects(lstat(join(directory, '.decisions.lock')), { code: 'ENOENT' });
});

test('rejects symlinked ancestors before recursive directory creation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ngl-decisions-symlink-ancestor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, 'target');
  const alias = join(root, 'alias');
  await mkdir(target, { mode: 0o700 });
  await symlink(target, alias);
  const requested = join(alias, 'created', 'decisions');

  await assert.rejects(
    decisionsModule.openDecisions({ directory: requested, now: () => instant }),
    error => error.code === 'INVALID_CONFIG'
  );
  await assert.rejects(lstat(join(target, 'created')), { code: 'ENOENT' });
});

test('rejects invalid UTF-8 in persisted decision envelopes before replay', async t => {
  const { store, directory } = await fixture(t);
  await store.create(evaluator, { ...proposal(), title: 'Synthetic packaging review \uFFFD' });
  await store.close();

  const file = join(directory, 'decisions.json');
  const original = await readFile(file);
  const marker = Buffer.from('\uFFFD', 'utf8');
  const index = original.indexOf(marker);
  assert.notEqual(index, -1, 'fixture must contain the UTF-8 replacement character');
  const malformed = Buffer.concat([
    original.subarray(0, index),
    Buffer.from([0xff]),
    original.subarray(index + marker.length)
  ]);
  await writeFile(file, malformed);

  await rejected(
    decisionsModule.openDecisions({ directory, now: () => instant }),
    'DECISIONS_TAMPERED'
  );
  await assert.rejects(lstat(join(directory, '.decisions.lock')), { code: 'ENOENT' });
});

test('rejects noncanonical persisted decision envelopes including duplicate schema keys', async t => {
  const { store, directory } = await fixture(t);
  await store.create(evaluator, proposal());
  await store.close();
  const file = join(directory, 'decisions.json');
  const canonical = await readFile(file, 'utf8');
  const ambiguous = canonical.replace('"schema":"ngl.decisions.store.v1"', '"schema":"wrong","schema":"ngl.decisions.store.v1"');
  assert.notEqual(ambiguous, canonical, 'fixture must contain a duplicate schema key');
  await writeFile(file, ambiguous);
  await rejected(decisionsModule.openDecisions({ directory, now: () => instant }), 'DECISIONS_TAMPERED');
  await assert.rejects(lstat(join(directory, '.decisions.lock')), { code: 'ENOENT' });
});

test('rejects symlinked persisted decision envelopes and releases the lock', async t => {
  const { store, directory } = await fixture(t);
  await store.create(evaluator, proposal());
  await store.close();
  const file = join(directory, 'decisions.json');
  const target = join(directory, 'decisions-target.json');
  await rename(file, target);
  await symlink(target, file);
  await rejected(decisionsModule.openDecisions({ directory, now: () => instant }), 'DECISIONS_TAMPERED');
  await assert.rejects(lstat(join(directory, '.decisions.lock')), { code: 'ENOENT' });
});

test('rejects group/world-accessible decision envelopes and releases the lock', async t => {
  const { store, directory } = await fixture(t);
  await store.create(evaluator, proposal());
  await store.close();
  const file = join(directory, 'decisions.json');
  await chmod(file, 0o644);
  await rejected(decisionsModule.openDecisions({ directory, now: () => instant }), 'DECISIONS_TAMPERED');
  await assert.rejects(lstat(join(directory, '.decisions.lock')), { code: 'ENOENT' });
});

test('rejects oversized decision envelopes before allocating their contents', async t => {
  const { store, directory } = await fixture(t);
  await store.create(evaluator, proposal());
  await store.close();
  const file = join(directory, 'decisions.json');
  const handle = await open(file, 'r+');
  try { await handle.truncate(64 * 1024 * 1024 + 1); } finally { await handle.close(); }
  await rejected(decisionsModule.openDecisions({ directory, now: () => instant }), 'DECISIONS_TAMPERED');
  await assert.rejects(lstat(join(directory, '.decisions.lock')), { code: 'ENOENT' });
});

test('rejects tampered disk envelope even when an attacker recomputes the outer digest', async t => {
  const { store, directory } = await fixture(t);
  await store.create(evaluator, proposal());
  await store.close();
  const file = join(directory, 'decisions.json');
  const envelope = JSON.parse(await readFile(file, 'utf8'));
  envelope.payload.projection.decisions[0].status = 'APPROVED';
  envelope.digest = digest(envelope.payload);
  await writeFile(file, canonicalStringify(envelope));
  await rejected(decisionsModule.openDecisions({ directory, now: () => instant }), 'DECISIONS_TAMPERED');
});

test('rejects broken record-chain links and does not leave a lock after failed recovery', async t => {
  const { store, directory } = await fixture(t);
  await store.create(evaluator, proposal());
  await store.close();
  const file = join(directory, 'decisions.json');
  const original = await readFile(file, 'utf8');
  const envelope = JSON.parse(original);
  envelope.payload.records[1].previousHash = '0'.repeat(64);
  envelope.digest = digest(envelope.payload);
  await writeFile(file, canonicalStringify(envelope));
  await rejected(decisionsModule.openDecisions({ directory }), 'DECISIONS_TAMPERED');
  await writeFile(file, original);
  const recovered = await decisionsModule.openDecisions({ directory, now: () => instant });
  await recovered.close();
});


test('an interrupted writer-lease mutation guard blocks new writers until explicit offline recovery', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-decisions-stale-guard-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const guard = join(directory, '.decisions.lock.guard');
  await mkdir(guard, { mode: 0o700 });

  await rejected(decisionsModule.openDecisions({ directory, now: () => instant }), 'DECISIONS_LOCKED');
  await assert.rejects(lstat(join(directory, '.decisions.lock')), { code: 'ENOENT' });

  await rm(guard, { recursive: true, force: true });
  const recovered = await decisionsModule.openDecisions({ directory, now: () => instant });
  try {
    assert.equal((await recovered.snapshot(founder)).revision, 0);
  } finally {
    await recovered.close();
  }
  await assert.rejects(lstat(guard), { code: 'ENOENT' });
});

test('closing a decision store after its runtime directory is removed releases the retained lease handle', async t => {
  const { store, directory } = await fixture(t);
  await rm(directory, { recursive: true, force: true });

  await store.close();

  await mkdir(directory, { mode: 0o700 });
  const reopened = await decisionsModule.openDecisions({ directory, now: () => instant });
  try {
    assert.equal((await reopened.snapshot(founder)).revision, 0);
  } finally {
    await reopened.close();
  }
});

test('symlinked and non-directory decision guards fail closed without writing through them', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ngl-decisions-guard-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const linkedDirectory = join(root, 'linked-decisions');
  const target = join(root, 'target');
  await mkdir(linkedDirectory, { mode: 0o700 });
  await mkdir(target, { mode: 0o700 });
  await symlink(target, join(linkedDirectory, '.decisions.lock.guard'));

  await rejected(
    decisionsModule.openDecisions({ directory: linkedDirectory, now: () => instant }),
    'DECISIONS_LOCKED'
  );
  assert.deepEqual(await readdir(target), [], 'a symlinked guard must not receive an owner receipt');
  await assert.rejects(lstat(join(linkedDirectory, '.decisions.lock')), { code: 'ENOENT' });

  const fileDirectory = join(root, 'file-decisions');
  await mkdir(fileDirectory, { mode: 0o700 });
  const guardFile = join(fileDirectory, '.decisions.lock.guard');
  await writeFile(guardFile, 'pre-existing non-directory guard', { mode: 0o600 });

  await rejected(
    decisionsModule.openDecisions({ directory: fileDirectory, now: () => instant }),
    'DECISIONS_LOCKED'
  );
  assert.equal(await readFile(guardFile, 'utf8'), 'pre-existing non-directory guard');
  await assert.rejects(lstat(join(fileDirectory, '.decisions.lock')), { code: 'ENOENT' });
});

test('independent Node processes contend for one decision-writer lease and preserve the durable ledger', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-decisions-cross-process-'));
  const moduleUrl = new URL('../src/institution/decisions.mjs', import.meta.url).href;
  const workerScript = `
    import { openDecisions } from ${JSON.stringify(moduleUrl)};
    import { createInterface } from 'node:readline';
    const directory = process.env.NGL_DECISIONS_TEST_DIR;
    try {
      const store = await openDecisions({ directory, now: () => ${instant} });
      console.log('ACQUIRED');
      for await (const line of createInterface({ input: process.stdin })) {
        if (line === 'commit') {
          await store.setPolicy(${JSON.stringify(founder)}, ${JSON.stringify(policy)});
          console.log('COMMITTED');
        } else if (line === 'close') {
          await store.close();
          console.log('RELEASED');
          break;
        }
      }
    } catch (error) {
      console.log('ERROR:' + (error.code || error.name || 'UNKNOWN'));
      process.exitCode = 0;
    }
  `;

  const workers = [];
  const bounded = (promise, label) => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), 7000);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  };
  const startWorker = () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', workerScript], {
      env: { ...process.env, NGL_DECISIONS_TEST_DIR: directory },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    child.stdin.on('error', () => {}); // A worker may exit before the parent closes its pipe.
    const lines = [];
    const waiters = [];
    let stderr = '';
    const reader = createInterface({ input: child.stdout });
    reader.on('line', line => {
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else lines.push(line);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    const exit = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal, stderr })));
    const nextLine = () => lines.length
      ? Promise.resolve(lines.shift())
      : new Promise((resolve, reject) => {
          waiters.push(resolve);
          child.once('error', reject);
        });
    const worker = { child, nextLine, exit, get stderr() { return stderr; } };
    workers.push(worker);
    return worker;
  };

  try {
    // Launch both independently so the filesystem's exclusive hard-link
    // publication, rather than an in-process queue, decides who owns the lease.
    const first = startWorker();
    const second = startWorker();
    const outcomes = await bounded(Promise.all([first.nextLine(), second.nextLine()]), 'workers did not report lease outcomes');
    assert.deepEqual(
      [...outcomes].sort(),
      ['ACQUIRED', 'ERROR:DECISIONS_LOCKED'].sort(),
      'exactly one process must acquire the writer lease'
    );

    const owner = outcomes[0] === 'ACQUIRED' ? first : second;
    const contender = owner === first ? second : first;
    // The rejected worker never enters its stdin command loop; close that pipe
    // so Node can exit instead of keeping the test runner alive indefinitely.
    contender.child.stdin.end();
    const rejected = await bounded(contender.exit, 'rejected contender did not exit');
    assert.equal(rejected.code, 0, rejected.stderr);
    assert.match(contender.stderr, /^$/);
    // The rejected contender must not remove or replace the winner's live lease.
    const liveLock = await lstat(join(directory, '.decisions.lock'));
    assert.equal(liveLock.isFile(), true);
    const filesAfterRace = await readdir(directory);
    assert.equal(filesAfterRace.some(name => name.startsWith('.decisions-lock-') && name.endsWith('.tmp')), false,
      'failed contender must remove its temporary lease file');

    owner.child.stdin.write('commit\n');
    assert.equal(await bounded(owner.nextLine(), 'winning worker did not commit'), 'COMMITTED', owner.stderr);
    owner.child.stdin.end('close\n');
    assert.equal(await bounded(owner.nextLine(), 'winning worker did not release'), 'RELEASED', owner.stderr);
    const ownerExit = await bounded(owner.exit, 'winning worker did not exit');
    assert.equal(ownerExit.code, 0, ownerExit.stderr);

    // Reopen in the parent process: the single winning writer's committed
    // policy must survive process exit and release of the lock.
    const recovered = await decisionsModule.openDecisions({ directory, now: () => instant });
    try {
      const state = await recovered.snapshot(founder);
      assert.equal(state.policy.id, policy.id);
      assert.equal(state.revision, 1);
    } finally {
      await recovered.close();
    }
  } finally {
    for (const worker of workers) {
      if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL');
    }
    await Promise.allSettled(workers.map(worker => worker.exit));
    await rm(directory, { recursive: true, force: true });
  }
});

test('one-writer lock is exclusive and stale locks require explicit manual recovery', async t => {
  const { store, directory } = await fixture(t);
  await rejected(decisionsModule.openDecisions({ directory }), 'DECISIONS_LOCKED');
  await store.close();
  await writeFile(join(directory, '.decisions.lock'), JSON.stringify({ pid: 2147483647, owner: 'synthetic-stale-owner' }));
  await rejected(decisionsModule.openDecisions({ directory }), 'DECISIONS_LOCKED');
  await rm(join(directory, '.decisions.lock'));
  const recovered = await decisionsModule.openDecisions({ directory, now: () => instant });
  await recovered.close();
});

test('failed persistence does not expose a committed decision and fences the writer until recovery', async t => {
  const { store, directory } = await fixture(t);
  await store.create(evaluator, proposal());
  const file = join(directory, 'decisions.json');
  const backup = join(directory, 'backup.json');
  await rename(file, backup);
  await mkdir(file);
  await rejected(store.decide(founder, request()), 'DECISION_PERSISTENCE_FAILED');
  await rejected(store.snapshot(founder), 'DECISIONS_UNCERTAIN');
  await rm(file, { recursive: true });
  await rename(backup, file);
  await store.close();
  const recovered = await decisionsModule.openDecisions({ directory, now: () => instant });
  try {
    assert.equal((await recovered.snapshot(founder)).decisions[0].status, 'PENDING');
    assert.equal((await recovered.decide(founder, request())).status, 'APPROVED');
  } finally { await recovered.close(); }
});

test('clock rollback cannot reopen a deadline and malformed requests cannot expand action scope', async t => {
  const { store, setClock } = await fixture(t);
  await store.create(evaluator, proposal());
  for (const malformed of [request('EXECUTE'), request('APPROVE', { expectedRevision: 0 }), { ...request(), actor: founder }, { ...request(), expiresAt: 'later' }]) await rejected(store.decide(founder, malformed), 'INVALID_DECISION');
  setClock(instant - 1);
  await rejected(store.decide(founder, request()), 'CLOCK_REGRESSION');
  setClock(instant + 1001);
  await rejected(store.decide(founder, request()), 'DECISION_EXPIRED');
});

test('close waits for accepted queued work and rejects later writes or reads', async t => {
  const { store } = await fixture(t);
  const creating = store.create(evaluator, proposal());
  const closing = store.close();
  assert.equal((await creating).status, 'PENDING');
  await closing;
  await rejected(store.create(evaluator, proposal('decision:two')), 'DECISIONS_CLOSED');
  await rejected(store.snapshot(founder), 'DECISIONS_CLOSED');
});

test('receipt algorithm, digest and byte size are verified rather than trusting a positive label', async t => {
  const { store } = await fixture(t);
  for (const receipt of [
    { ...proposal().evaluation.receipt, algorithm: 'verified' },
    { ...proposal().evaluation.receipt, digest: '0'.repeat(64) },
    { ...proposal().evaluation.receipt, size: -1 },
    { ...proposal().evaluation.receipt, assurance: 'independent' },
  ]) await rejected(store.create(evaluator, { ...proposal(), evaluation: { ...proposal().evaluation, receipt } }), 'INVALID_PROPOSAL');
  assert.equal((await store.snapshot(founder)).decisions.length, 0);
});

test('a failed revision request is durably idempotent and cannot later change its action', async t => {
  const { store, directory, setClock } = await fixture(t);
  await store.create(evaluator, proposal());
  const stale = request('APPROVE', { expectedRevision: 99 });
  await rejected(store.decide(founder, stale), 'REVISION_MISMATCH');
  const revision = (await store.snapshot(founder)).revision;
  await store.close();
  const reopened = await decisionsModule.openDecisions({ directory, now: () => instant + 10 });
  try {
    await rejected(reopened.decide(founder, stale), 'REVISION_MISMATCH');
    assert.equal((await reopened.snapshot(founder)).revision, revision);
    await rejected(reopened.decide(founder, { ...stale, action: 'REJECT' }), 'REQUEST_ID_REUSED');
    assert.equal((await reopened.snapshot(founder)).decisions[0].status, 'PENDING');
  } finally { await reopened.close(); }
  setClock(instant + 20);
});

test('replay checks event authority even if all chain and outer hashes are recalculated', async t => {
  const { store, directory } = await fixture(t);
  await store.create(evaluator, proposal());
  await store.close();
  const file = join(directory, 'decisions.json');
  const envelope = JSON.parse(await readFile(file, 'utf8'));
  envelope.payload.records[0].event.actor = evaluator;
  let previousHash = envelope.payload.records[0].previousHash;
  for (const record of envelope.payload.records) {
    record.previousHash = previousHash;
    record.hash = digest({ index: record.index, previousHash, event: record.event });
    previousHash = record.hash;
  }
  envelope.digest = digest(envelope.payload);
  await writeFile(file, canonicalStringify(envelope));
  await rejected(decisionsModule.openDecisions({ directory, now: () => instant }), 'DECISIONS_TAMPERED');
});

test('does not follow a symbolic-link envelope to load another private file', async t => {
  const { store, directory } = await fixture(t);
  await store.close();
  const path = join(directory, 'decisions.json');
  const original = join(directory, 'fixture-original.json');
  await rename(path, original);
  await symlink(original, path);
  await rejected(decisionsModule.openDecisions({ directory, now: () => instant }), 'DECISIONS_TAMPERED');
  assert.equal(JSON.parse(await readFile(original, 'utf8')).schema, 'ngl.decisions.store.v1');
});

test('every concurrent close caller waits until the writer lease is actually released', async t => {
  const { store, directory } = await fixture(t);
  const firstClose = store.close();
  await store.close();
  await assert.rejects(readFile(join(directory, '.decisions.lock')), error => error.code === 'ENOENT');
  await firstClose;
  const reopened = await decisionsModule.openDecisions({ directory, now: () => instant });
  await reopened.close();
});


test('decision store preserves COMMIT_DURABILITY_UNCERTAIN after post-rename directory-sync failure', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-decisions-post-rename-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let failNextSync = false;
  const syncDirectory = async location => {
    if (failNextSync) {
      failNextSync = false;
      throw Object.assign(new Error('injected directory sync failure after rename'), { code: 'EIO' });
    }
    const handle = await open(location, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  };
  const store = await decisionsModule.openDecisions({ directory, now: () => instant, syncDirectory });
  await store.setPolicy(founder, policy);
  await store.create(evaluator, proposal());
  failNextSync = true;

  await assert.rejects(
    store.decide(founder, request()),
    error => error.code === 'COMMIT_DURABILITY_UNCERTAIN' && error.status === 503
  );
  await assert.rejects(
    store.snapshot(founder),
    error => error.code === 'COMMIT_DURABILITY_UNCERTAIN' && error.status === 503
  );
  await assert.rejects(
    store.decide(founder, request('REJECT')),
    error => error.code === 'COMMIT_DURABILITY_UNCERTAIN' && error.status === 503
  );

  const retained = JSON.parse(await readFile(join(directory, 'decisions.json'), 'utf8'));
  assert.equal(retained.payload.projection.decisions[0].status, 'APPROVED',
    'rename may expose the replacement even though directory durability was not confirmed');
  await store.close();

  const reopened = await decisionsModule.openDecisions({ directory, now: () => instant + 1 });
  try {
    assert.equal((await reopened.snapshot(founder)).decisions[0].status, 'APPROVED',
      'only a fresh validated open may expose the retained decision projection');
  } finally {
    await reopened.close();
  }
});

test('initial decision-envelope rename reports uncertain durability and releases the writer lock', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-decisions-initial-uncertain-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(
    decisionsModule.openDecisions({
      directory,
      now: () => instant,
      syncDirectory: async () => { throw Object.assign(new Error('injected initial directory sync failure'), { code: 'EIO' }); }
    }),
    error => error.code === 'COMMIT_DURABILITY_UNCERTAIN' && error.status === 503
  );

  const retained = JSON.parse(await readFile(join(directory, 'decisions.json'), 'utf8'));
  assert.equal(retained.schema, 'ngl.decisions.store.v1');
  assert.deepEqual(retained.payload.records, []);
  await assert.rejects(lstat(join(directory, '.decisions.lock')), { code: 'ENOENT' });

  const reopened = await decisionsModule.openDecisions({ directory, now: () => instant });
  try {
    assert.equal((await reopened.snapshot(founder)).revision, 0);
  } finally {
    await reopened.close();
  }
});


test('process death after atomic rename keeps the decision store fenced until explicit offline recovery', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-decisions-process-crash-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const moduleUrl = new URL('../src/institution/decisions.mjs', import.meta.url).href;
  const workerScript = `
    import { openDecisions } from ${JSON.stringify(moduleUrl)};
    import { open } from 'node:fs/promises';
    import { createInterface } from 'node:readline';
    const directory = process.env.NGL_DECISIONS_TEST_DIR;
    const founder = ${JSON.stringify(founder)};
    const policy = ${JSON.stringify(policy)};
    let directorySyncs = 0;
    const syncDirectory = async location => {
      directorySyncs += 1;
      if (directorySyncs === 1) {
        const handle = await open(location, 'r');
        try { await handle.sync(); } finally { await handle.close(); }
        return;
      }
      if (directorySyncs === 2) {
        await new Promise((resolve, reject) => {
          if (typeof process.send !== 'function') return reject(new Error('IPC channel is unavailable'));
          process.send('AFTER_RENAME_BEFORE_DIRECTORY_SYNC', error => error ? reject(error) : resolve());
        });
        process.kill(process.pid, 'SIGKILL');
      }
    };
    const store = await openDecisions({ directory, now: () => ${instant}, syncDirectory });
    process.send('READY');
    for await (const line of createInterface({ input: process.stdin })) {
      if (line === 'commit') await store.setPolicy(founder, policy);
    }
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', workerScript], {
    env: { ...process.env, NGL_DECISIONS_TEST_DIR: directory },
    stdio: ['pipe', 'ignore', 'pipe', 'ipc']
  });
  child.stdin.on('error', () => {});
  child.stderr.setEncoding('utf8');
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const messages = [];
  const waiters = [];
  child.on('message', message => {
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else messages.push(message);
  });
  const nextMessage = () => messages.length
    ? Promise.resolve(messages.shift())
    : new Promise(resolve => waiters.push(resolve));
  const exit = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  const bounded = (promise, label) => {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + (stderr ? ': ' + stderr : ''))), 7000); })
    ]).finally(() => clearTimeout(timer));
  };

  try {
    assert.equal(await bounded(nextMessage(), 'crash worker did not open the decision store'), 'READY');
    child.stdin.end('commit\n');
    assert.equal(
      await bounded(nextMessage(), 'crash worker did not reach the post-rename boundary'),
      'AFTER_RENAME_BEFORE_DIRECTORY_SYNC'
    );
    const stopped = await bounded(exit, 'crash worker did not terminate');
    assert.equal(stopped.signal, 'SIGKILL');

    const lockPath = join(directory, '.decisions.lock');
    assert.equal((await lstat(lockPath)).isFile(), true, 'process death must leave the writer lease visible');
    await assert.rejects(lstat(join(directory, '.decisions.lock.guard')), { code: 'ENOENT' });
    const retained = JSON.parse(await readFile(join(directory, 'decisions.json'), 'utf8'));
    assert.equal(retained.payload.projection.policy.id, policy.id,
      'the rename is already visible even though directory durability was not confirmed');

    await rejected(decisionsModule.openDecisions({ directory, now: () => instant }), 'DECISIONS_LOCKED');

    // Test-only offline recovery: the child has exited, and the fixture operator
    // explicitly removes the stale lease before a fresh validated open.
    await rm(lockPath);
    const recovered = await decisionsModule.openDecisions({ directory, now: () => instant });
    try {
      const state = await recovered.snapshot(founder);
      assert.equal(state.policy.id, policy.id);
      assert.equal(state.revision, 1);
    } finally {
      await recovered.close();
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.allSettled([exit]);
  }
});


test('process death before atomic rename leaves the canonical envelope unchanged and requires explicit offline recovery', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-decisions-pre-rename-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const moduleUrl = new URL('../src/institution/decisions.mjs', import.meta.url).href;
  const workerScript = `
    import { openDecisions } from ${JSON.stringify(moduleUrl)};
    import { rename } from 'node:fs/promises';
    import { createInterface } from 'node:readline';
    const directory = process.env.NGL_DECISIONS_TEST_DIR;
    const founder = ${JSON.stringify(founder)};
    const policy = ${JSON.stringify(policy)};
    let renameCalls = 0;
    const renameFile = async (pending, target) => {
      renameCalls += 1;
      if (renameCalls === 1) return rename(pending, target);
      await new Promise((resolve, reject) => {
        if (typeof process.send !== 'function') return reject(new Error('IPC channel is unavailable'));
        process.send('BEFORE_RENAME', error => error ? reject(error) : resolve());
      });
      await new Promise(() => {});
    };
    const store = await openDecisions({ directory, now: () => ${instant}, renameFile });
    process.send('READY');
    for await (const line of createInterface({ input: process.stdin })) {
      if (line === 'commit') await store.setPolicy(founder, policy);
    }
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', workerScript], {
    env: { ...process.env, NGL_DECISIONS_TEST_DIR: directory },
    stdio: ['pipe', 'ignore', 'pipe', 'ipc']
  });
  child.stdin.on('error', () => {});
  child.stderr.setEncoding('utf8');
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const messages = [];
  const waiters = [];
  child.on('message', message => {
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else messages.push(message);
  });
  const nextMessage = () => messages.length
    ? Promise.resolve(messages.shift())
    : new Promise(resolve => waiters.push(resolve));
  const exit = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  const bounded = (promise, label) => {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + (stderr ? ': ' + stderr : ''))), 7000); })
    ]).finally(() => clearTimeout(timer));
  };

  try {
    assert.equal(await bounded(nextMessage(), 'pre-rename worker did not open the decision store'), 'READY');
    child.stdin.end('commit\\n');
    assert.equal(
      await bounded(nextMessage(), 'pre-rename worker did not reach the durable temporary-file boundary'),
      'BEFORE_RENAME'
    );
    const stopped = await bounded(exit.then(value => value), 'pre-rename worker did not terminate').catch(async error => {
      child.kill('SIGKILL');
      throw error;
    });
    assert.equal(stopped.signal, 'SIGKILL');

    const lockPath = join(directory, '.decisions.lock');
    assert.equal((await lstat(lockPath)).isFile(), true, 'process death must leave the writer lease visible');
    const pendingFiles = (await readdir(directory)).filter(name => /^\\.decisions-[a-f0-9-]+\\.tmp$/.test(name));
    assert.equal(pendingFiles.length, 1, 'the fully written temporary envelope must remain visible after SIGKILL');
    const retained = JSON.parse(await readFile(join(directory, 'decisions.json'), 'utf8'));
    assert.deepEqual(retained.payload.records, [], 'the canonical envelope must remain at its previous revision');
    await rejected(decisionsModule.openDecisions({ directory, now: () => instant }), 'DECISIONS_LOCKED');

    // Explicit test-only offline recovery: remove the stale lease and orphaned
    // temporary envelope only after the writer process has exited.
    await rm(lockPath);
    await rm(join(directory, pendingFiles[0]));
    const recovered = await decisionsModule.openDecisions({ directory, now: () => instant });
    try {
      assert.equal((await recovered.snapshot(founder)).revision, 0);
    } finally {
      await recovered.close();
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.allSettled([exit]);
  }
});
