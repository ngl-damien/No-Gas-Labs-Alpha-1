import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, applyAction, validateWorld } from '../game/model.mjs';

const founder = { id: 'founder-1', name: 'Damien', role: 'founder' };
const witness = { id: 'witness-1', name: 'Witness', role: 'witness' };
const futureOffset = '2026-10-27T00:30:00-02:00'; // 2026-10-27T02:30:00.000Z

async function publishedSource() {
  const world = createWorld({ id: 'instant-order-world', now: '2026-10-27T00:00:00.000Z' });
  const draft = await applyAction(world, {
    type: 'draft', kind: 'loom', title: 'Temporal source', intent: 'A retained source for chronology tests.'
  }, founder, { now: '2026-10-27T00:00:01.000Z' });
  return applyAction(draft.world, {
    type: 'publish', draftId: draft.result.draftId, expectedVersion: 0
  }, founder, { now: '2026-10-27T00:00:02.000Z' });
}

function proposal(sourceCreationId = null, sourceVersion = null) {
  return {
    type: 'propose-moonshot',
    title: 'Offset chronology check',
    hypothesis: 'A retained source predates the proposal.',
    falsifier: 'The source was published later in real time.',
    evidenceNeeded: 'A source version with an unambiguous publication instant.',
    sourceCreationId,
    sourceVersion
  };
}

test('a source-bound proposal rejects a version published later in real time even if its offset string sorts earlier', async () => {
  const published = await publishedSource();
  const source = published.world.creations[0];
  source.publishedAt = futureOffset;

  await assert.rejects(
    applyAction(published.world, proposal(source.id, 1), witness, { now: '2026-10-27T01:00:00.000Z' }),
    error => error.code === 'STALE_VERSION'
  );
});

test('world import rejects a source-bound proposal whose retained version is later in real time', async () => {
  const published = await publishedSource();
  const proposed = await applyAction(published.world, proposal(), witness, { now: '2026-10-27T01:00:00.000Z' });
  const forged = structuredClone(proposed.world);
  forged.creations[0].publishedAt = futureOffset;
  const proposalEvent = forged.events.at(-1);
  proposalEvent.sourceCreationId = forged.creations[0].id;
  proposalEvent.sourceVersion = 1;

  await assert.rejects(validateWorld(forged), error => error.code === 'INVALID_WORLD');
});

test('an experiment report cannot cite a version published after the report instant', async () => {
  const published = await publishedSource();
  published.world.creations[0].publishedAt = futureOffset;
  const proposed = await applyAction(published.world, proposal(), witness, { now: '2026-10-27T01:00:00.000Z' });

  await assert.rejects(
    applyAction(proposed.world, {
      type: 'report-experiment',
      moonshotId: proposed.result.moonshotId,
      procedure: 'Compare the source against the stated condition.',
      observation: 'The source was not yet available at the report instant.',
      reportedOutcome: 'inconclusive',
      evidenceCreationId: published.result.creationId,
      evidenceVersion: 1
    }, witness, { now: '2026-10-27T01:30:00.000Z' }),
    error => error.code === 'STALE_VERSION'
  );
});

test('world import rejects event history that moves backward in real time despite increasing timestamp text', async () => {
  const start = createWorld({ id: 'offset-event-world', now: '2026-10-27T00:00:00.000Z' });
  const first = await applyAction(start, { type: 'discover', locationId: 'river' }, witness, { now: '2026-10-27T00:00:01.000Z' });
  const second = await applyAction(first.world, { type: 'discover', locationId: 'river' }, witness, { now: '2026-10-27T00:00:02.000Z' });
  const forged = structuredClone(second.world);
  forged.events[0].at = futureOffset;
  forged.discoveries[0].at = futureOffset;
  forged.events[1].at = '2026-10-27T01:00:00.000Z';
  forged.updatedAt = forged.events[1].at;

  await assert.rejects(validateWorld(forged), error => error.code === 'INVALID_WORLD');
});

test('world import binds each published version timestamp to exactly one publication event', async () => {
  const published = await publishedSource();
  const forged = structuredClone(published.world);
  forged.creations[0].publishedAt = '2026-10-26T23:00:02.000Z';

  await assert.rejects(validateWorld(forged), error => error.code === 'INVALID_WORLD');
});
