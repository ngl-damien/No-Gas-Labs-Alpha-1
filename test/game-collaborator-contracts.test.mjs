import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCollaboratorPackets } from '../game/collaborator-contracts.mjs';

const founder = { id: 'founder-1', role: 'founder' };
const witness = { id: 'witness-1', role: 'witness' };
const at1 = '2026-10-29T04:00:00.000Z';
const at2 = '2026-10-29T04:01:00.000Z';
const at3 = '2026-10-29T04:02:00.000Z';

function researchWorld() {
  return {
    creations: [],
    events: [
      {
        id: 'proposal-event-1', type: 'moonshot-proposed', moonshotId: 'moonshot-1',
        actor: founder, at: at1, title: 'Bounded test', hypothesis: 'A claim holds under a stated condition.',
        falsifier: 'A repeatable counterexample', evidenceNeeded: 'An independently observed measurement',
        sourceCreationId: null, sourceVersion: null
      },
      {
        id: 'report-event-1', type: 'experiment-reported', reportId: 'report-1', moonshotId: 'moonshot-1',
        actor: witness, at: at2, procedure: 'Run the stated procedure once.',
        observation: 'The expected result did not occur.', reportedOutcome: 'failed',
        evidenceCreationId: null, evidenceVersion: null
      },
      {
        id: 'challenge-event-1', type: 'experiment-challenged', challengeId: 'challenge-1',
        reportId: 'report-1', moonshotId: 'moonshot-1', actor: founder, at: at3,
        challengeType: 'methodology', challengeText: 'The procedure omits a control.',
        evidenceCreationId: null, evidenceVersion: null
      }
    ]
  };
}

test('empty world exposes bounded roles but does not invent research inputs or packets', () => {
  const packets = projectCollaboratorPackets({ events: [], creations: [] });
  assert.deepEqual(packets.map(packet => packet.id), ['archivist', 'adversary', 'synthesizer', 'tutor']);
  assert.ok(packets.every(packet => packet.available === false && packet.prompt === null && packet.inputRefs.length === 0));
});

test('research packets bind to retained event IDs and declare zero authority and zero progress effects', () => {
  const world = researchWorld();
  const before = structuredClone(world);
  const packets = projectCollaboratorPackets(world);
  const byId = Object.fromEntries(packets.map(packet => [packet.id, packet]));

  assert.ok(byId.archivist.available);
  assert.ok(byId.adversary.available);
  assert.ok(byId.synthesizer.available);
  assert.ok(byId.tutor.available);
  assert.deepEqual(byId.adversary.inputRefs, ['proposal-event-1', 'report-event-1']);
  assert.match(byId.adversary.prompt, /A model assertion is not evidence/);
  assert.match(byId.adversary.prompt, /not authenticated to Alpha 1/);
  assert.match(byId.adversary.prompt, /challengeDraft/);

  for (const packet of packets) {
    const payload = JSON.parse(packet.packetJson);
    assert.equal(payload.mayWriteCanonicalState, false);
    assert.equal(payload.mayGrantAuthority, false);
    assert.equal(payload.mayAwardProgress, false);
    assert.equal(payload.mayCertifyTruthOrExecution, false);
    assert.ok(payload.inputRefs.every(id => world.events.some(event => event.id === id)));
  }
  assert.deepEqual(world, before);
});

test('synthesis reports omitted history instead of silently presenting a partial corpus as complete', () => {
  const world = researchWorld();
  for (let index = 0; index < 9; index += 1) {
    world.events.push({
      id: 'report-event-' + (index + 2), type: 'experiment-reported',
      reportId: 'report-' + (index + 2), moonshotId: 'moonshot-1',
      actor: index % 2 ? founder : witness, at: new Date(Date.parse(at3) + (index + 1) * 60_000).toISOString(),
      procedure: 'Repeat the procedure ' + index,
      observation: 'Observation ' + index,
      reportedOutcome: index % 3 ? 'inconclusive' : 'failed',
      evidenceCreationId: null, evidenceVersion: null
    });
  }
  const synthesis = projectCollaboratorPackets(world).find(packet => packet.id === 'synthesizer');
  const payload = JSON.parse(synthesis.packetJson);
  assert.equal(payload.omittedCount, 5);
  assert.equal(payload.inputRefs.length, 7);
  assert.equal(payload.omittedEventIds.length, 5);
  assert.match(synthesis.prompt, /disclose omitted history/i);
});

test('accessor-backed event data cannot execute getters or enter collaborator packets', () => {
  let getterCalls = 0;
  const hostile = { id: 'hostile-event', moonshotId: 'moonshot-hostile', actor: founder, at: at1 };
  Object.defineProperty(hostile, 'type', {
    enumerable: true,
    get() { getterCalls += 1; return 'moonshot-proposed'; }
  });
  const packets = projectCollaboratorPackets({ events: [hostile], creations: [] });
  assert.equal(getterCalls, 0);
  assert.ok(packets.every(packet => packet.available === false));
});
