import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../src/institution/ledger.mjs';

const config = {
  founderId: 'founder',
  actors: [
    { id: 'founder', roles: ['founder'], kind: 'human' },
    { id: 'builder', roles: ['executor'], kind: 'local-process' },
    { id: 'verifier', roles: ['observer'], kind: 'local-process' }
  ]
};

test('ledger state, events, and head fail closed after uncertain directory sync until reopen', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ngl-ledger-uncertain-read-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const ledger = await openLedger({
    directory,
    ...config,
    syncDirectory: async () => { throw new Error('injected directory sync failure'); }
  });
  const event = {
    id: 'claim-uncertain-1',
    type: 'claim',
    actor: 'founder',
    at: '2026-10-27T11:37:00.000Z',
    expectedRevision: 0,
    workId: 'work-uncertain-1',
    subject: { id: 'subject-uncertain-1', version: 1 },
    action: 'exercise uncertain commit read boundary'
  };

  await assert.rejects(ledger.append(event), { code: 'COMMIT_DURABILITY_UNCERTAIN' });
  assert.throws(() => ledger.state, { code: 'COMMIT_DURABILITY_UNCERTAIN' });
  assert.throws(() => ledger.events, { code: 'COMMIT_DURABILITY_UNCERTAIN' });
  assert.throws(() => ledger.head, { code: 'COMMIT_DURABILITY_UNCERTAIN' });

  await ledger.close();

  // The rename is visible in this process, but the failed directory sync did
  // not prove crash durability. Only a fresh open may validate and expose it.
  const reopened = await openLedger({ directory, ...config });
  try {
    assert.equal(reopened.state.revision, 1);
    assert.equal(reopened.events.length, 1);
    assert.equal(reopened.events[0].id, event.id);
    assert.match(reopened.head, /^[a-f0-9]{64}$/);
  } finally {
    await reopened.close();
  }
});
