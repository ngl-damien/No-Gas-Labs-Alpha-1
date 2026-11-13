import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { projectCollaboratorPackets, getCollaboratorRecordTargets } from '../game/collaborator-contracts.mjs';

const founder = { id: 'founder-1', role: 'founder' };
const witness = { id: 'witness-1', role: 'witness' };
const at1 = '2026-10-29T04:00:00.000Z';
const at2 = '2026-10-29T04:01:00.000Z';
const at3 = '2026-10-29T04:02:00.000Z';
const at4 = '2026-10-29T04:03:00.000Z';
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

function worldWithAuthorResponse() {
  const world = researchWorld();
  world.events.push({
    id: 'response-event-1', type: 'experiment-challenge-responded', responseId: 'response-1',
    challengeId: 'challenge-1', reportId: 'report-1', moonshotId: 'moonshot-1',
    actor: witness, at: at4,
    responseText: 'The missing control is a valid limitation; the attempt was not reproduced.'
  });
  world.revision = world.events.length;
  return world;
}

function addLaterReports(world, count) {
  for (let index = 0; index < count; index += 1) {
    const minute = String(4 + index).padStart(2, '0');
    const reportNumber = index + 2;
    world.events.push({
      id: `report-event-${reportNumber}`,
      type: 'experiment-reported',
      reportId: `report-${reportNumber}`,
      moonshotId: 'moonshot-1',
      actor: witness,
      at: `2026-10-29T04:${minute}:00.000Z`,
      procedure: 'Run the bounded procedure with the stated control.',
      observation: `Later retained observation ${reportNumber}.`,
      reportedOutcome: 'inconclusive',
      evidenceCreationId: null,
      evidenceVersion: null
    });
  }
  world.revision = world.events.length;
  return world;
}

test('Archivist scope targets bind exact retained proposal, attempt, and dissent records without entering the hand-off packet', () => {
  const world = researchWorld();
  const before = structuredClone(world);
  const packets = projectCollaboratorPackets(world);
  const archivist = packets.find(packet => packet.id === 'archivist');
  assert.deepEqual(getCollaboratorRecordTargets(archivist), [
    { eventId: 'proposal-event-1', moonshotId: 'moonshot-1', recordType: 'moonshot-proposed', activityId: null },
    { eventId: 'report-event-1', moonshotId: 'moonshot-1', recordType: 'experiment-reported', activityId: 'report-1' },
    { eventId: 'challenge-event-1', moonshotId: 'moonshot-1', recordType: 'experiment-challenged', activityId: 'challenge-1' }
  ]);
  assert.deepEqual(getCollaboratorRecordTargets(packets.find(packet => packet.id === 'adversary')), []);
  assert.deepEqual(getCollaboratorRecordTargets({ ...archivist }), [], 'caller-constructed packet copies receive no trusted navigation targets');
  assert.equal(JSON.parse(archivist.packetJson).recordTargets, undefined, 'navigation metadata is not disclosed to the external collaborator');
  assert.deepEqual(world, before, 'target projection does not mutate retained history');

  const legacyArchivist = projectCollaboratorPackets(world, { legacyArchivist: true }).find(packet => packet.id === 'archivist');
  assert.equal(legacyArchivist.available, true);
  assert.deepEqual(getCollaboratorRecordTargets(legacyArchivist), [], 'legacy v1 packets do not receive v2 scope navigation targets');

  const orphan = structuredClone(world);
  orphan.events[2].reportId = 'missing-report';
  const orphanTargets = getCollaboratorRecordTargets(projectCollaboratorPackets(orphan).find(packet => packet.id === 'archivist'));
  assert.ok(!orphanTargets.some(target => target.eventId === 'challenge-event-1'), 'an orphaned challenge must not receive a focus target');

  const duplicateEvent = structuredClone(world);
  duplicateEvent.events.push({ ...duplicateEvent.events[1], at: '2026-10-29T04:03:00.000Z' });
  const duplicateTargets = getCollaboratorRecordTargets(projectCollaboratorPackets(duplicateEvent).find(packet => packet.id === 'archivist'));
  assert.ok(!duplicateTargets.some(target => target.eventId === 'report-event-1'), 'duplicate event IDs must not receive a focus target');
  assert.ok(!duplicateTargets.some(target => target.eventId === 'challenge-event-1'), 'a challenge bound to an ambiguous report must not receive a focus target');

  const duplicateReport = structuredClone(world);
  duplicateReport.events.push({
    ...duplicateReport.events[1], id: 'report-event-duplicate', reportId: 'report-1',
    at: '2026-10-29T04:03:00.000Z'
  });
  const duplicateReportTargets = getCollaboratorRecordTargets(projectCollaboratorPackets(duplicateReport).find(packet => packet.id === 'archivist'));
  assert.ok(!duplicateReportTargets.some(target => target.recordType === 'experiment-reported'), 'ambiguous report IDs must not receive focus targets');
  assert.ok(!duplicateReportTargets.some(target => target.recordType === 'experiment-challenged'), 'dissent must not bind to an ambiguous report');
});

test('Synthesis receives and navigates only uniquely linked original-author responses', () => {
  const world = worldWithAuthorResponse();
  const before = structuredClone(world);
  const packets = projectCollaboratorPackets(world);
  const synthesis = packets.find(packet => packet.id === 'synthesizer');
  const payload = JSON.parse(synthesis.packetJson);
  assert.deepEqual(synthesis.inputRefs, [
    'proposal-event-1', 'report-event-1', 'challenge-event-1', 'response-event-1'
  ]);
  assert.deepEqual(payload.inputRecords.at(-1), {
    eventId: 'response-event-1',
    type: 'experiment-challenge-responded',
    at: at4,
    actor: { id: witness.id, role: witness.role },
    moonshotId: 'moonshot-1',
    responseId: 'response-1',
    challengeId: 'challenge-1',
    reportId: 'report-1',
    responseText: 'The missing control is a valid limitation; the attempt was not reproduced.',
    targetReportStatus: 'linked',
    targetChallengeStatus: 'linked',
    truncatedFields: []
  });
  assert.deepEqual(getCollaboratorRecordTargets(synthesis), [
    { eventId: 'proposal-event-1', moonshotId: 'moonshot-1', recordType: 'moonshot-proposed', activityId: null },
    { eventId: 'report-event-1', moonshotId: 'moonshot-1', recordType: 'experiment-reported', activityId: 'report-1' },
    { eventId: 'challenge-event-1', moonshotId: 'moonshot-1', recordType: 'experiment-challenged', activityId: 'challenge-1' },
    { eventId: 'response-event-1', moonshotId: 'moonshot-1', recordType: 'experiment-challenge-responded', activityId: 'response-1' }
  ]);
  assert.equal(payload.recordTargets, undefined, 'focus targets remain module-private and are not sent to the collaborator');
  assert.deepEqual(getCollaboratorRecordTargets({ ...synthesis }), [], 'a copied packet cannot acquire navigation authority');
  assert.ok(!packets.find(packet => packet.id === 'adversary').inputRefs.includes('response-event-1'),
    'the Adversary packet remains scoped to reports and prior challenges');
  assert.ok(getCollaboratorRecordTargets(packets.find(packet => packet.id === 'archivist'))
    .some(target => target.eventId === 'response-event-1' && target.activityId === 'response-1'));

  const legacy = projectCollaboratorPackets(world, { legacyArchivist: true }).find(packet => packet.id === 'archivist');
  assert.deepEqual(legacy.inputRefs, ['proposal-event-1', 'report-event-1', 'challenge-event-1'],
    'legacy v1 Archivist reconstruction must not retroactively include response records');
  const legacyPayload = JSON.parse(legacy.packetJson);
  assert.equal(legacyPayload.sourceSnapshot.suppliedEventCount, 4);
  assert.equal(legacyPayload.inputRecords.some(record => record.type === 'experiment-challenge-responded'), false);
  assert.deepEqual(getCollaboratorRecordTargets(legacy), []);

  const duplicate = structuredClone(world);
  duplicate.events.push({ ...duplicate.events[3], id: 'response-event-duplicate', at: '2026-10-29T04:04:00.000Z' });
  duplicate.revision = duplicate.events.length;
  const duplicatePacket = projectCollaboratorPackets(duplicate).find(packet => packet.id === 'synthesizer');
  assert.ok(!duplicatePacket.inputRefs.includes('response-event-1'), 'duplicate response/challenge identities remain in history but are not collaborator inputs');
  assert.ok(!getCollaboratorRecordTargets(duplicatePacket).some(target => target.recordType === 'experiment-challenge-responded'));

  const orphan = structuredClone(world);
  orphan.events[3].challengeId = 'missing-challenge';
  const orphanPacket = projectCollaboratorPackets(orphan).find(packet => packet.id === 'synthesizer');
  assert.ok(!orphanPacket.inputRefs.includes('response-event-1'), 'an unlinked response cannot become a source target');
  assert.deepEqual(world, before, 'packet and focus-target projection are read-only');
});

test('bounded Archivist and Synthesis packets retain the linked challenge/report context for included author replies', () => {
  const archivistWorld = addLaterReports(worldWithAuthorResponse(), 2);
  const archivist = projectCollaboratorPackets(archivistWorld).find(packet => packet.id === 'archivist');
  const archivistPayload = JSON.parse(archivist.packetJson);
  assert.ok(archivist.inputRefs.includes('response-event-1'));
  assert.ok(archivist.inputRefs.includes('challenge-event-1'));
  assert.ok(archivist.inputRefs.includes('report-event-1'));
  assert.deepEqual(archivistPayload.inputRecords.filter(record =>
    ['experiment-challenge-responded', 'experiment-challenged', 'experiment-reported'].includes(record.type)
  ).map(record => record.eventId), [
    'report-event-1', 'challenge-event-1', 'response-event-1', 'report-event-2', 'report-event-3'
  ]);
  assert.equal(archivist.omittedCount, 0, 'linked context is included, not misreported as omitted');

  const synthesisWorld = addLaterReports(worldWithAuthorResponse(), 5);
  const synthesis = projectCollaboratorPackets(synthesisWorld).find(packet => packet.id === 'synthesizer');
  const synthesisPayload = JSON.parse(synthesis.packetJson);
  assert.ok(synthesis.inputRefs.includes('response-event-1'));
  assert.ok(synthesis.inputRefs.includes('challenge-event-1'), 'the challenge remains beside its reply even when outside the newest-activity slice');
  assert.ok(synthesis.inputRefs.includes('report-event-1'), 'the original report remains beside the challenge/reply pair');
  assert.equal(synthesis.omittedCount, 0, 'required linked context is not counted as omitted history');
  assert.equal(synthesisPayload.inputRecords.filter(record => record.type === 'experiment-challenge-responded').length, 1);
  assert.equal(synthesisPayload.inputRecords.filter(record => record.type === 'experiment-challenged').length, 1);
  assert.equal(synthesisPayload.inputRecords.filter(record => record.type === 'experiment-reported').length, 6);
  assert.ok(getCollaboratorRecordTargets(synthesis).some(target =>
    target.eventId === 'response-event-1' && target.activityId === 'response-1'
  ));

  const legacy = projectCollaboratorPackets(archivistWorld, { legacyArchivist: true }).find(packet => packet.id === 'archivist');
  assert.ok(!legacy.inputRefs.includes('response-event-1'), 'legacy v1 remains report/challenge-only');
});

test('empty world exposes bounded roles but does not invent research inputs or packets', () => {
  const packets = projectCollaboratorPackets({ events: [], creations: [] });
  assert.deepEqual(packets.map(packet => packet.id), ['archivist', 'adversary', 'synthesizer', 'tutor']);
  assert.ok(packets.every(packet => packet.available === false && packet.prompt === null && packet.inputRefs.length === 0));
  assert.ok(packets.every(packet => packet.sourceSnapshot.status === 'incomplete'));
});

test('Synthesis Clerk waits for one linked experiment report or challenge before preparing a packet', () => {
  const source = researchWorld();
  const [proposal, report] = source.events;
  const proposalOnly = { ...source, events: [proposal] };
  const waiting = projectCollaboratorPackets(proposalOnly).find(packet => packet.id === 'synthesizer');
  assert.equal(waiting.available, false);
  assert.deepEqual(waiting.inputRefs, []);
  assert.match(waiting.reason, /at least one linked experiment report or challenge/i);

  const proposalAndReport = { ...source, events: [proposal, report] };
  const ready = projectCollaboratorPackets(proposalAndReport).find(packet => packet.id === 'synthesizer');
  assert.equal(ready.available, true);
  assert.deepEqual(ready.inputRefs, ['proposal-event-1', 'report-event-1']);

  const newerProposalWithoutActivity = {
    ...proposal,
    id: 'proposal-event-2',
    moonshotId: 'moonshot-2',
    at: '2026-10-29T04:03:00.000Z',
    title: 'Newer proposal without an attempt'
  };
  const olderReady = projectCollaboratorPackets({
    ...source,
    events: [proposal, report, newerProposalWithoutActivity]
  }).find(packet => packet.id === 'synthesizer');
  assert.equal(olderReady.moonshotId, 'moonshot-1',
    'the Synthesis Clerk selects the newest proposal that actually has a linked activity');
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

test('collaborator packets select the newest eligible research chain from append-only history', () => {
  const world = researchWorld();
  world.events.push({
    id: 'proposal-event-2', type: 'moonshot-proposed', moonshotId: 'moonshot-2',
    actor: founder, at: '2026-10-29T03:50:00.000Z',
    title: 'Newer proposal', hypothesis: 'A newer claim under a stated condition.',
    falsifier: 'A repeatable counterexample to the newer claim.',
    evidenceNeeded: 'An independently observed measurement.',
    sourceCreationId: null, sourceVersion: null
  });
  world.events.push({
    id: 'report-event-2', type: 'experiment-reported', reportId: 'report-2', moonshotId: 'moonshot-2',
    actor: witness, at: '2026-10-29T03:51:00.000Z',
    procedure: 'Run the newer procedure once.',
    observation: 'The newer attempt did not support the prediction.',
    reportedOutcome: 'failed', evidenceCreationId: null, evidenceVersion: null
  });
  for (let index = 1; index <= 8; index += 1) {
    world.events.push({
      id: 'challenge-event-' + (index + 1),
      type: 'experiment-challenged',
      challengeId: 'challenge-' + (index + 1),
      reportId: 'report-2',
      moonshotId: 'moonshot-2',
      actor: founder,
      at: new Date(Date.parse('2026-10-29T03:51:00.000Z') + index * 60_000).toISOString(),
      challengeType: 'methodology',
      challengeText: 'Distinct control concern ' + index,
      evidenceCreationId: null,
      evidenceVersion: null
    });
  }
  world.revision += 10;

  const packets = Object.fromEntries(projectCollaboratorPackets(world).map(packet => [packet.id, packet]));
  assert.equal(packets.archivist.moonshotId, 'moonshot-2');
  assert.deepEqual(packets.archivist.inputRefs, [
    'proposal-event-2', 'report-event-2', 'challenge-event-7', 'challenge-event-8', 'challenge-event-9'
  ]);
  const archivistPayload = JSON.parse(packets.archivist.packetJson);
  assert.equal(archivistPayload.archivistScopeVersion, 2);
  assert.equal(archivistPayload.omittedCount, 5);
  assert.deepEqual(archivistPayload.omittedEventIds, [
    'challenge-event-2', 'challenge-event-3', 'challenge-event-4', 'challenge-event-5', 'challenge-event-6'
  ]);
  assert.equal(archivistPayload.omittedEventIdListTruncated, false);
  assert.match(packets.archivist.prompt, /do not claim exhaustive chronology/i);

  assert.equal(packets.adversary.moonshotId, 'moonshot-2');
  assert.deepEqual(packets.adversary.inputRefs, [
    'proposal-event-2', 'report-event-2',
    'challenge-event-9', 'challenge-event-8', 'challenge-event-7',
    'challenge-event-6', 'challenge-event-5', 'challenge-event-4'
  ]);
  const adversaryPayload = JSON.parse(packets.adversary.packetJson);
  assert.equal(adversaryPayload.omittedCount, 2);

  assert.equal(packets.synthesizer.moonshotId, 'moonshot-2');
  assert.deepEqual(packets.synthesizer.inputRefs, [
    'proposal-event-2', 'challenge-event-4', 'challenge-event-5',
    'challenge-event-6', 'challenge-event-7', 'challenge-event-8', 'challenge-event-9'
  ]);
  assert.equal(packets.tutor.moonshotId, 'moonshot-2');
  assert.deepEqual(packets.tutor.inputRefs, ['proposal-event-2']);
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
  assert.ok(packets.every(packet => getCollaboratorRecordTargets(packet).length === 0),
    'accessor-backed event records must not produce retained-record navigation targets');

  const metadataWorld = researchWorld();
  Object.defineProperty(metadataWorld, 'id', { enumerable: true, configurable: true, get() { getterCalls += 1; return 'forged-world'; } });
  Object.defineProperty(metadataWorld, 'revision', { enumerable: true, configurable: true, get() { getterCalls += 1; return 99; } });
  const metadataPackets = projectCollaboratorPackets(metadataWorld);
  assert.equal(getterCalls, 0);
  assert.ok(metadataPackets.every(packet => packet.available && packet.sourceSnapshot.status === 'incomplete'),
    'valid source records remain usable without executing metadata accessors, but no snapshot identity is asserted');
  assert.equal(getCollaboratorRecordTargets(metadataPackets.find(packet => packet.id === 'archivist')).length, 3);
  assert.equal(getterCalls, 0, 'target projection must not execute world metadata accessors');
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
  assert.equal(payload.omittedEventIds.length, 64);
  assert.equal(payload.omittedEventIdListTruncated, true);
  assert.equal(payload.inputRecords.length, 7);
});

test('oversized source text is clipped with explicit field-level disclosure and a hard packet budget', () => {
  const world = researchWorld();
  const report = world.events.find(event => event.id === 'report-event-1');
  report.procedure = 'P'.repeat(90_000);
  report.observation = 'O'.repeat(90_000);
  const before = structuredClone(world);

  const packet = projectCollaboratorPackets(world).find(item => item.id === 'adversary');
  assert.equal(packet.available, true);
  assert.ok(new TextEncoder().encode(packet.packetJson).byteLength <= 64 * 1024);
  assert.ok(new TextEncoder().encode(packet.prompt).byteLength <= 72 * 1024);

  const payload = JSON.parse(packet.packetJson);
  const compactReport = payload.inputRecords.find(record => record.eventId === 'report-event-1');
  assert.deepEqual(compactReport.truncatedFields, ['procedure', 'observation']);
  assert.ok(compactReport.procedure.endsWith(' …[truncated]'));
  assert.ok(compactReport.observation.endsWith(' …[truncated]'));
  assert.equal(payload.truncatedContentFieldCount, 2);
  assert.match(packet.prompt, /request the full source before detailed or exhaustive conclusions/i);
  assert.deepEqual(world, before, 'packet clipping must not mutate retained source data');
});

test('overlong event identifiers are excluded instead of being truncated into false references', () => {
  const world = researchWorld();
  world.events[0].id = 'p'.repeat(129);
  const packets = projectCollaboratorPackets(world);
  assert.ok(packets.every(packet => packet.available === false));
  assert.ok(packets.every(packet => packet.packetJson === null && packet.prompt === null));
});

test('hard byte budget fails closed when clipped multibyte text still exceeds the packet limit', () => {
  const world = researchWorld();
  const oversized = '🧪'.repeat(3000);
  world.events[1].procedure = oversized;
  world.events[1].observation = oversized;
  for (let index = 0; index < 5; index += 1) {
    world.events.push({
      id: 'unicode-report-event-' + index,
      type: 'experiment-reported',
      reportId: 'unicode-report-' + index,
      moonshotId: 'moonshot-1',
      actor: witness,
      at: new Date(Date.parse(at3) + (index + 1) * 60_000).toISOString(),
      procedure: oversized,
      observation: oversized,
      reportedOutcome: 'inconclusive',
      evidenceCreationId: null,
      evidenceVersion: null
    });
  }
  world.revision += 5;

  const synthesis = projectCollaboratorPackets(world).find(packet => packet.id === 'synthesizer');
  assert.equal(synthesis.available, false);
  assert.match(synthesis.reason, /hard size budget/i);
  assert.equal(synthesis.packetJson, null);
  assert.equal(synthesis.prompt, null);
});

test('snapshot event count excludes sparse slots and accessor-backed entries without invoking getters', () => {
  const world = researchWorld();
  const original = world.events;
  const events = [];
  let getterCalls = 0;
  events.length = 5;
  events[0] = original[0];
  Object.defineProperty(events, '1', {
    enumerable: true,
    get() { getterCalls += 1; return original[1]; }
  });
  events[2] = 'not an event record';
  events[3] = original[1];
  events[4] = original[2];
  world.events = events;

  const packets = projectCollaboratorPackets(world);
  assert.equal(getterCalls, 0);
  assert.ok(packets.every(packet => packet.available));
  assert.ok(packets.every(packet => packet.sourceSnapshot.status === 'identified'));
  assert.ok(packets.every(packet => packet.sourceSnapshot.suppliedEventCount === 3),
    'snapshot marker counts own data object entries, not the array length of five');
});

test('playable client and bounded packet module pass the JavaScript parser', () => {
  for (const path of ['game/client.mjs', 'game/collaborator-contracts.mjs']) {
    const checked = spawnSync(process.execPath, ['--check', resolve(ROOT, path)], { encoding: 'utf8' });
    assert.equal(checked.status, 0, path + ': ' + (checked.stderr || checked.stdout || 'syntax check failed'));
  }
});

test('collaborator prompt discloses the actual omitted-ID cap', () => {
  const packets = projectCollaboratorPackets(researchWorld());
  for (const packet of packets) {
    assert.equal(packet.available, true, packet.id);
    assert.match(packet.prompt, /omittedEventIds lists at most 64 omitted event IDs/);
    assert.doesNotMatch(packet.prompt, /omittedEventIds lists at most 100 omitted event IDs/);
    const payload = JSON.parse(packet.packetJson);
    assert.ok(payload.omittedEventIds.length <= 64, packet.id);
  }
});
