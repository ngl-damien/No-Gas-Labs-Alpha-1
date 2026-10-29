import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { projectCollaboratorPackets } from '../game/collaborator-contracts.mjs';

const founder = { id: 'founder-1', role: 'founder' };
const witness = { id: 'witness-1', role: 'witness' };
const at1 = '2026-10-29T04:00:00.000Z';
const at2 = '2026-10-29T04:01:00.000Z';
const at3 = '2026-10-29T04:02:00.000Z';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function researchWorld() {
  return {
    id: 'world-test-1',
    revision: 3,
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
  assert.ok(packets.every(packet => packet.sourceSnapshot.status === 'incomplete'));
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
  assert.deepEqual(byId.adversary.inputRefs, ['proposal-event-1', 'report-event-1', 'challenge-event-1']);
  assert.match(byId.adversary.prompt, /A model assertion is not evidence/);
  assert.match(byId.adversary.prompt, /not authenticated to Alpha 1/);
  assert.match(byId.adversary.prompt, /challengeDraft/);
  assert.match(byId.adversary.prompt, /The procedure omits a control/);
  assert.match(byId.adversary.prompt, /do not repeat a supplied challenge verbatim/i);

  for (const packet of packets) {
    const payload = JSON.parse(packet.packetJson);
    assert.deepEqual(payload.sourceSnapshot, {
      status: 'identified', worldId: 'world-test-1', revision: 3, suppliedEventCount: 3
    });
    assert.match(packet.prompt, /Snapshot boundary: sourceSnapshot identifies the supplied world snapshot only/);
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
  world.revision += 9;
  const synthesis = projectCollaboratorPackets(world).find(packet => packet.id === 'synthesizer');
  const payload = JSON.parse(synthesis.packetJson);
  assert.equal(payload.omittedCount, 5);
  assert.equal(payload.inputRefs.length, 7);
  assert.equal(payload.omittedEventIds.length, 5);
  assert.equal(payload.omittedEventIdListTruncated, false);
  assert.match(synthesis.prompt, /disclose omitted history/i);
});

test('accessor-backed event data cannot execute getters or enter collaborator packets', () => {
  let getterCalls = 0;
  const hostile = { id: 'hostile-event', moonshotId: 'moonshot-hostile', actor: founder, at: at1 };
  Object.defineProperty(hostile, 'type', {
    enumerable: true,
    get() { getterCalls += 1; return 'moonshot-proposed'; }
  });
  const sourceWorld = { events: [hostile], creations: [] };
  Object.defineProperty(sourceWorld, 'id', { enumerable: true, get() { getterCalls += 1; return 'forged-world'; } });
  Object.defineProperty(sourceWorld, 'revision', { enumerable: true, get() { getterCalls += 1; return 99; } });
  const packets = projectCollaboratorPackets(sourceWorld);
  assert.equal(getterCalls, 0);
  assert.ok(packets.every(packet => packet.available === false && packet.sourceSnapshot.status === 'incomplete'));

  const metadataWorld = researchWorld();
  Object.defineProperty(metadataWorld, 'id', { enumerable: true, configurable: true, get() { getterCalls += 1; return 'forged-world'; } });
  Object.defineProperty(metadataWorld, 'revision', { enumerable: true, configurable: true, get() { getterCalls += 1; return 99; } });
  const metadataPackets = projectCollaboratorPackets(metadataWorld);
  assert.equal(getterCalls, 0);
  assert.ok(metadataPackets.every(packet => packet.available && packet.sourceSnapshot.status === 'incomplete'),
    'valid source records remain usable without executing metadata accessors, but no snapshot identity is asserted');
});

test('large synthesis slices explicitly disclose when the omitted-ID list is capped', () => {
  const world = researchWorld();
  for (let index = 0; index < 110; index += 1) {
    world.events.push({
      id: 'large-report-event-' + index, type: 'experiment-reported',
      reportId: 'large-report-' + index, moonshotId: 'moonshot-1',
      actor: index % 2 ? founder : witness,
      at: new Date(Date.parse(at3) + (index + 1) * 60_000).toISOString(),
      procedure: 'Bounded procedure ' + index,
      observation: 'Bounded observation ' + index,
      reportedOutcome: index % 3 ? 'inconclusive' : 'failed',
      evidenceCreationId: null, evidenceVersion: null
    });
  }
  world.revision += 110;
  const synthesis = projectCollaboratorPackets(world).find(packet => packet.id === 'synthesizer');
  const payload = JSON.parse(synthesis.packetJson);
  assert.equal(payload.omittedCount, 106);
  assert.equal(payload.omittedEventIds.length, 100);
  assert.equal(payload.omittedEventIdListTruncated, true);
  assert.equal(payload.inputRecords.length, 7);
});

test('playable client and bounded packet module pass the JavaScript parser', () => {
  for (const path of ['game/client.mjs', 'game/collaborator-contracts.mjs']) {
    const checked = spawnSync(process.execPath, ['--check', resolve(ROOT, path)], { encoding: 'utf8' });
    assert.equal(checked.status, 0, path + ': ' + (checked.stderr || checked.stdout || 'syntax check failed'));
  }
});
