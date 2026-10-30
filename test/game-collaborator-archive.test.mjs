import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorld, applyAction, validateWorld } from '../game/model.mjs';
import { projectCollaboratorPackets } from '../game/collaborator-contracts.mjs';
import { getQuestTrail } from '../game/quests.mjs';

const founder = { id: 'founder-1', name: 'Damien', role: 'founder' };
const witness = { id: 'witness-1', name: 'Field witness', role: 'witness' };
const start = '2026-10-29T12:00:00.000Z';

async function fixture() {
  let world = createWorld({ id: 'guild-archive-world', now: start });
  const proposal = await applyAction(world, {
    type: 'propose-moonshot',
    title: 'A bounded question for the lab',
    hypothesis: 'A retained process may produce a repeatable result.',
    falsifier: 'A second controlled run fails to reproduce it.',
    evidenceNeeded: 'A retained procedure and independently inspectable output.',
    sourceCreationId: null,
    sourceVersion: null
  }, founder, { now: '2026-10-29T12:00:01.000Z' });
  world = proposal.world;
  const report = await applyAction(world, {
    type: 'report-experiment',
    moonshotId: proposal.result.moonshotId,
    procedure: 'Repeat the stated process under the same recorded conditions.',
    observation: 'The second run did not reproduce the reported behavior.',
    reportedOutcome: 'failed',
    evidenceCreationId: null,
    evidenceVersion: null
  }, witness, { now: '2026-10-29T12:00:02.000Z' });
  world = report.world;
  const packet = projectCollaboratorPackets(world).find(item => item.id === 'adversary');
  assert.ok(packet?.available);
  const reportEvent = world.events.find(event => event.type === 'experiment-reported');
  const responseText = JSON.stringify({
    targetEventId: reportEvent.id,
    challengeType: 'reproducibility',
    challengeDraft: 'The report does not describe a control that distinguishes process failure from an environmental difference.',
    distinctnessAssessment: 'This is a falsifiable control question, not a claim that the result is false.',
    duplicateOfEventIds: [],
    counterexample: 'A controlled repeat under the same environment produces the reported behavior.',
    evidenceNeeded: ['A second run with recorded environmental conditions.'],
    unknowns: ['Whether the second run used identical conditions.']
  });
  return { world, packet, responseText };
}

function archiveAction(packet, responseText) {
  return {
    type: 'record-collaborator-response',
    role: packet.id,
    moonshotId: packet.moonshotId,
    packetJson: packet.packetJson,
    sourceEventIds: [...packet.inputRefs],
    responseText
  };
}

test('a bounded collaborator response is revalidated and preserved as attributed untrusted history', async () => {
  const { world, packet, responseText } = await fixture();
  const beforeXP = world.xp;
  const beforeEvents = world.events.length;
  const outcome = await applyAction(world, archiveAction(packet, responseText), witness, {
    now: '2026-10-29T12:00:03.000Z',
    requestId: 'archive-response-1',
    actionFingerprint: 'a'.repeat(64)
  });

  assert.equal(outcome.result.validationStatus, 'valid-for-human-review');
  assert.match(outcome.result.responseId, /^collaborator-response-/);
  assert.equal(outcome.world.events.length, beforeEvents + 1);
  assert.equal(outcome.world.xp, beforeXP);
  assert.equal(outcome.world.creations.length, 0);

  const archived = outcome.world.events.at(-1);
  assert.equal(archived.type, 'collaborator-response-recorded');
  assert.equal(archived.actor.id, witness.id);
  assert.equal(archived.actor.role, 'witness');
  assert.equal(archived.packetJson, packet.packetJson);
  assert.equal(archived.responseText, responseText);
  assert.equal(archived.sourceEventIds.join(','), packet.inputRefs.join(','));
  assert.equal(archived.packetReceipt.algorithm, 'sha256');
  assert.equal(archived.responseReceipt.algorithm, 'sha256');
  assert.equal(archived.validationReason, null);
  assert.equal(archived.validator, 'ngl.collaborator-response.v1');
  assert.equal(await validateWorld(outcome.world).then(() => true), true);

  const objective = getQuestTrail(outcome.world, witness).find(item => item.id === 'witness-guild-response');
  assert.equal(objective.complete, true);
  assert.equal(objective.progress, 1);
  assert.match(objective.interpretation, /not truth/);
});

test('a rejected external response is preserved without becoming a successful claim', async () => {
  const { world, packet } = await fixture();
  const outcome = await applyAction(world, archiveAction(packet, '{'), witness, {
    now: '2026-10-29T12:00:03.000Z'
  });
  assert.equal(outcome.result.validationStatus, 'rejected');
  const archived = outcome.world.events.at(-1);
  assert.equal(archived.validationStatus, 'rejected');
  assert.equal(archived.validationReason, 'RESPONSE_JSON_INVALID');
  assert.equal(archived.responseText, '{');
  assert.equal(outcome.world.xp, 0);
  assert.equal(await validateWorld(outcome.world).then(() => true), true);
});

test('the archive refuses a modified packet, invented source references, and stale snapshots', async () => {
  const { world, packet, responseText } = await fixture();
  const modified = JSON.parse(packet.packetJson);
  modified.mayWriteCanonicalState = true;
  await assert.rejects(
    applyAction(world, { ...archiveAction(packet, responseText), packetJson: JSON.stringify(modified) }, witness),
    error => error.code === 'STALE_COLLABORATOR_PACKET' && error.status === 409
  );
  await assert.rejects(
    applyAction(world, { ...archiveAction(packet, responseText), sourceEventIds: ['invented-event'] }, witness),
    error => error.code === 'INVALID_COLLABORATOR_SOURCES'
  );
  const changed = await applyAction(world, { type: 'discover', locationId: 'river' }, witness, {
    now: '2026-10-29T12:00:03.000Z'
  });
  await assert.rejects(
    applyAction(changed.world, archiveAction(packet, responseText), witness, {
      now: '2026-10-29T12:00:04.000Z'
    }),
    error => error.code === 'STALE_COLLABORATOR_PACKET' && error.status === 409
  );
  assert.equal(world.events.length, 2, 'failed archive attempts do not mutate the source world');
});

test('archive integrity rejects changed packet or response bytes and fabricated authority flags', async () => {
  const { world, packet, responseText } = await fixture();
  const outcome = await applyAction(world, archiveAction(packet, responseText), witness, {
    now: '2026-10-29T12:00:03.000Z'
  });
  const changedResponse = structuredClone(outcome.world);
  changedResponse.events.at(-1).responseText += ' ';
  await assert.rejects(validateWorld(changedResponse), error => error.code === 'INVALID_WORLD');
  const changedPacket = structuredClone(outcome.world);
  const payload = JSON.parse(changedPacket.events.at(-1).packetJson);
  payload.mayAwardProgress = true;
  const packetJson = JSON.stringify(payload);
  changedPacket.events.at(-1).packetJson = packetJson;
  changedPacket.events.at(-1).packetReceipt = {
    algorithm: 'sha256',
    digest: createHash('sha256').update(packetJson, 'utf8').digest('hex'),
    size: Buffer.byteLength(packetJson)
  };
  await assert.rejects(validateWorld(changedPacket), error => error.code === 'INVALID_WORLD');
});
