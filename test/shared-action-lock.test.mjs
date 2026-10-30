import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHARED_ACTION_LOCK_NAME,
  runSerializedSharedAction
} from '../game/shared-action-lock.mjs';

const founder = { id: 'damien', role: 'founder' };

function makeLockManager() {
  const held = new Set();
  return {
    request(name, options, callback) {
      assert.equal(name, SHARED_ACTION_LOCK_NAME);
      assert.deepEqual(options, { mode: 'exclusive', ifAvailable: true });
      if (held.has(name)) return Promise.resolve().then(() => callback(null));
      held.add(name);
      return Promise.resolve().then(() => callback({ name })).finally(() => held.delete(name));
    }
  };
}

function makeHarness({ lockManager = makeLockManager(), pending = null } = {}) {
  const store = { pending: pending ? structuredClone(pending) : null };
  const reads = [];
  const saves = [];
  const submissions = [];
  let sequence = 0;
  const run = (action, submit, actor = founder) => runSerializedSharedAction({
    lockManager,
    action,
    actor,
    readPending() {
      reads.push(store.pending ? structuredClone(store.pending) : null);
      return store.pending ? structuredClone(store.pending) : null;
    },
    savePending(receipt) {
      saves.push(structuredClone(receipt));
      store.pending = structuredClone(receipt);
    },
    async submit(receipt) {
      submissions.push(structuredClone(receipt));
      if (submit) return submit(receipt, store);
      store.pending = null;
      return { requestId: receipt.requestId };
    },
    createRequestId: () => 'request-' + (++sequence)
  });
  return { store, reads, saves, submissions, run, get sequence() { return sequence; } };
}

test('shared writes fail closed when Web Locks is unavailable without touching the receipt', async () => {
  const h = makeHarness({ lockManager: null });
  await assert.rejects(
    h.run({ type: 'contribute', creationId: 'c1', version: 1, text: 'Keep dissent.' }),
    error => error.code === 'SHARED_ACTION_LOCK_UNAVAILABLE'
  );
  assert.equal(h.reads.length, 0);
  assert.equal(h.saves.length, 0);
  assert.equal(h.submissions.length, 0);
});

test('a second tab cannot overwrite the first tab receipt while a shared write is in flight', async () => {
  const h = makeHarness();
  let releaseFirst;
  const firstMayFinish = new Promise(resolve => { releaseFirst = resolve; });
  const first = h.run(
    { type: 'contribute', creationId: 'c1', version: 1, text: 'First tab action.' },
    async (_receipt, store) => {
      await firstMayFinish;
      store.pending = null;
      return { committed: true };
    }
  );
  await Promise.resolve();
  assert.equal(h.store.pending?.action.text, 'First tab action.');
  await assert.rejects(
    h.run({ type: 'report', creationId: 'c2', version: 1, text: 'Second tab action.' }),
    error => error.code === 'SHARED_ACTION_BUSY'
  );
  assert.equal(h.reads.length, 1, 'the busy tab must not read or replace the active receipt');
  assert.equal(h.saves.length, 1, 'the busy tab must not save a competing receipt');
  assert.equal(h.submissions.length, 1, 'the busy tab must not send a second write');
  assert.equal(h.store.pending?.action.text, 'First tab action.');
  releaseFirst();
  assert.deepEqual(await first, { committed: true });
  assert.equal(h.store.pending, null);
});

test('an uncertain receipt blocks a different action and remains intact', async () => {
  const h = makeHarness();
  const original = { type: 'contribute', creationId: 'c1', version: 1, text: 'Preserve dissent.' };
  await assert.rejects(
    h.run(original, async () => { throw new Error('simulated lost response'); }),
    /simulated lost response/
  );
  const saved = structuredClone(h.store.pending);
  await assert.rejects(
    h.run({ type: 'publish', draftId: 'draft-2', expectedVersion: 0 }),
    /previous shared action has an uncertain outcome/
  );
  assert.deepEqual(h.store.pending, saved);
  assert.equal(h.submissions.length, 1);
  assert.equal(h.saves.length, 1);
});

test('retrying the same action reuses the exact request ID even when object key order differs', async () => {
  const h = makeHarness();
  const first = { type: 'contribute', creationId: 'c1', version: 1, text: 'Preserve dissent.' };
  await assert.rejects(
    h.run(first, async () => { throw new Error('simulated lost response'); }),
    /simulated lost response/
  );
  const requestId = h.store.pending.requestId;
  const recovered = await h.run({ text: 'Preserve dissent.', version: 1, creationId: 'c1', type: 'contribute' });
  assert.deepEqual(recovered, { requestId });
  assert.equal(h.submissions.length, 2);
  assert.equal(h.submissions[0].requestId, requestId);
  assert.equal(h.submissions[1].requestId, requestId);
  assert.equal(h.sequence, 1);
  assert.equal(h.store.pending, null);
});

test('a different actor cannot consume an uncertain shared-action receipt', async () => {
  const h = makeHarness();
  const action = { type: 'report', creationId: 'c1', version: 1, text: 'A source-bound report.' };
  await assert.rejects(
    h.run(action, async () => { throw new Error('simulated lost response'); }),
    /simulated lost response/
  );
  const saved = structuredClone(h.store.pending);
  await assert.rejects(
    h.run(action, undefined, { id: 'witness-2', role: 'witness' }),
    /different session/
  );
  assert.deepEqual(h.store.pending, saved);
  assert.equal(h.submissions.length, 1);
});
