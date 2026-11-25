import test from 'node:test';
import assert from 'node:assert/strict';
import { institutionActivityCount } from '../game/world-view.mjs';

test('canonical Alpha 1 events light up the institutions that perform their functions', () => {
  const world = { xp: 0, events: [
    { id: 'draft-1', type: 'draft' },
    { id: 'repair-1', type: 'repair' },
    { id: 'publish-1', type: 'publish' },
    { id: 'contribute-1', type: 'contribute' },
    { id: 'report-1', type: 'report' },
    { id: 'study-1', type: 'study' },
    { id: 'review-1', type: 'study-reviewed' },
    { id: 'moonshot-1', type: 'moonshot-proposed' },
    { id: 'experiment-1', type: 'experiment-reported' },
    { id: 'challenge-1', type: 'experiment-challenged' },
    { id: 'transfer-offer-1', type: 'field-item-transfer-offered' },
    { id: 'transfer-cancel-1', type: 'field-item-transfer-cancelled' },
    { id: 'transfer-refusal-1', type: 'field-item-transfer-declined', actor: { id: 'witness-1', role: 'witness' }, at: '2026-11-25T07:00:00.000Z' },
    { id: 'transfer-complete-1', type: 'field-item-transferred' },
    { id: 'source-archive-failure-1', type: 'source-archive-attempt-failed', failureCode: 'GITHUB_SOURCE_UNAVAILABLE', retryable: true },
    { id: 'policy-1', type: 'policy-set' },
    { id: 'proposal-created-1', type: 'proposal-created' },
    { id: 'decision-attempted-1', type: 'decision-attempted' },
    { id: 'expiry-1', type: 'expiry-observed' },
    { id: 'revocation-1', type: 'revocation' },
    { event_id: 'public-comment-1', event_type: 'PUBLIC_COMMENT' },
  ] };
  const before = structuredClone(world);

  // Forge retains the full handoff lifecycle; Evidence Archive separately
  // retains refusal as dissent. Both are read-only views of one event stream.
  assert.equal(institutionActivityCount('guild_hall', world), 3);
  assert.equal(institutionActivityCount('forge', world), 7,
    'Forge must expose offers, cancellations, refusals, and completed transfers alongside artifact/equipment events');
  assert.equal(institutionActivityCount('evidence_archive', world), 9,
    'failed retrievals and explicit transfer refusals remain inspectable in Evidence Archive history');
  assert.equal(institutionActivityCount('decision_chamber', world), 5);
  assert.equal(institutionActivityCount('town-square', world), 6);
  assert.equal(institutionActivityCount('academy', world), 2);
  assert.equal(institutionActivityCount('moonshot_field', world), 3);
  assert.equal(institutionActivityCount('publication_house', world), 1);

  assert.deepEqual(world, before);
  assert.equal(world.xp, 0);
});
