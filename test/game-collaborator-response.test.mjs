import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCollaboratorPackets } from '../game/collaborator-contracts.mjs';
import { validateCollaboratorResponse } from '../game/collaborator-response.mjs';

const founder = { id: 'founder-1', role: 'founder' };
const witness = { id: 'witness-1', role: 'witness' };
const at1 = '2026-10-29T04:00:00.000Z';
const at2 = '2026-10-29T04:01:00.000Z';
const at3 = '2026-10-29T04:02:00.000Z';

function packetsForTest() {
  const world = {
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
  return Object.fromEntries(projectCollaboratorPackets(world).map(packet => [packet.id, packet]));
}

const validResponses = {
  archivist: {
    eventChainFindings: ['The proposal precedes the report in the supplied chain.'],
    claims: ['The report records a failed attempt.'],
    linkageIssues: [],
    unknowns: ['No independent observation is attached.'],
    nextChecks: ['Inspect the original source bytes.']
  },
  adversary: {
    targetEventId: 'report-event-1',
    challengeType: 'methodology',
    challengeDraft: 'The procedure does not specify a control condition.',
    distinctnessAssessment: 'This is a draft for human comparison with prior challenges.',
    duplicateOfEventIds: ['challenge-event-1'],
    counterexample: 'A controlled comparison could produce a different result.',
    evidenceNeeded: ['A retained controlled replication.'],
    unknowns: ['No independent measurement is supplied.']
  },
  synthesizer: {
    scope: {
      moonshotId: 'moonshot-1',
      includedEventIds: ['proposal-event-1', 'report-event-1', 'challenge-event-1'],
      omittedEventIds: []
    },
    recordedSupport: ['The attempt was retained as failed.'],
    contradictions: [],
    dissentPreserved: ['challenge-event-1'],
    unknowns: ['The report is self-reported.'],
    nextDiscriminatingExperiment: { procedure: 'Repeat with a defined control.', outcome: 'Compare observations.' }
  },
  tutor: {
    concepts: ['falsifiability'],
    prerequisites: ['distinguish observation from inference'],
    explanation: 'A falsifier specifies what observation would count against a claim.',
    questions: ['What result would contradict the hypothesis?'],
    answerKey: ['A repeatable observation matching the stated falsifier.'],
    whatRemainsUnproven: ['Whether the hypothesis survives a controlled replication.']
  }
};

test('accepts all four role schemas and labels them review-only', () => {
  const packets = packetsForTest();
  for (const role of Object.keys(validResponses)) {
    const result = validateCollaboratorResponse(packets[role], JSON.stringify(validResponses[role]));
    assert.equal(result.valid, true, role + ': ' + result.reason);
    assert.equal(result.status, 'valid-for-human-review');
    assert.equal(result.role, role);
    assert.equal(result.moonshotId, 'moonshot-1');
    assert.ok(result.sourceEventIds.length > 0);
    assert.equal(Object.hasOwn(result, 'authorized'), false);
    assert.equal(Object.hasOwn(result, 'worldEvent'), false);
  }
});

test('adversary response must target the exact retained report and only packet challenges', () => {
  const packets = packetsForTest();
  const wrongTarget = { ...validResponses.adversary, targetEventId: 'report-from-another-world' };
  assert.equal(validateCollaboratorResponse(packets.adversary, JSON.stringify(wrongTarget)).reason,
    'RESPONSE_SCHEMA_OR_SCOPE_INVALID');
  const wrongDuplicate = { ...validResponses.adversary, duplicateOfEventIds: ['not-in-packet'] };
  assert.equal(validateCollaboratorResponse(packets.adversary, JSON.stringify(wrongDuplicate)).valid, false);
});

test('synthesis scope cannot claim a different Moonshot or invented included/omitted IDs', () => {
  const packets = packetsForTest();
  const wrongMoonshot = structuredClone(validResponses.synthesizer);
  wrongMoonshot.scope.moonshotId = 'moonshot-elsewhere';
  assert.equal(validateCollaboratorResponse(packets.synthesizer, JSON.stringify(wrongMoonshot)).valid, false);
  const inventedSource = structuredClone(validResponses.synthesizer);
  inventedSource.scope.includedEventIds.push('event-not-in-packet');
  assert.equal(validateCollaboratorResponse(packets.synthesizer, JSON.stringify(inventedSource)).valid, false);
  const inventedOmission = structuredClone(validResponses.synthesizer);
  inventedOmission.scope.omittedEventIds.push('event-not-disclosed-as-omitted');
  assert.equal(validateCollaboratorResponse(packets.synthesizer, JSON.stringify(inventedOmission)).valid, false);
});

test('rejects unexpected authority claims and extra schema fields', () => {
  const packets = packetsForTest();
  const forged = { ...validResponses.tutor, authorized: true };
  assert.equal(validateCollaboratorResponse(packets.tutor, JSON.stringify(forged)).reason,
    'RESPONSE_SCHEMA_OR_SCOPE_INVALID');
});

test('rejects malformed JSON, empty text, and responses over the byte budget', () => {
  const packet = packetsForTest().tutor;
  assert.equal(validateCollaboratorResponse(packet, '').reason, 'RESPONSE_REQUIRED');
  assert.equal(validateCollaboratorResponse(packet, '{').reason, 'RESPONSE_JSON_INVALID');
  assert.equal(validateCollaboratorResponse(packet, 'x'.repeat(64 * 1024 + 1)).reason, 'RESPONSE_TOO_LARGE');
});

test('rejects unsafe nested JSON values and unbounded arrays', () => {
  const packet = packetsForTest().archivist;
  const reservedKey = '{"eventChainFindings":[{"constructor":"unsafe"}],"claims":[],"linkageIssues":[],"unknowns":[],"nextChecks":[]}';
  assert.equal(validateCollaboratorResponse(packet, reservedKey).reason, 'RESPONSE_VALUE_INVALID');
  const tooMany = { ...validResponses.archivist, claims: Array.from({ length: 65 }, () => 'bounded claim') };
  assert.equal(validateCollaboratorResponse(packet, JSON.stringify(tooMany)).reason, 'RESPONSE_VALUE_INVALID');
});

test('rejects copied, caller-constructed, or altered packets at the response boundary', () => {
  const packet = packetsForTest().adversary;
  const responseText = JSON.stringify(validResponses.adversary);
  assert.equal(validateCollaboratorResponse({ ...packet }, responseText).reason,
    'PACKET_INVALID_OR_UNAVAILABLE', 'even an unchanged clone is not the module-issued packet object');
  const alteredPayload = JSON.parse(packet.packetJson);
  alteredPayload.mayWriteCanonicalState = true;
  const alteredPacket = { ...packet, packetJson: JSON.stringify(alteredPayload) };
  assert.equal(validateCollaboratorResponse(alteredPacket, responseText).reason,
    'PACKET_INVALID_OR_UNAVAILABLE');
});

test('unavailable or cross-role packets cannot accept a response', () => {
  const packets = packetsForTest();
  const unavailable = { ...packets.tutor, available: false };
  assert.equal(validateCollaboratorResponse(unavailable, JSON.stringify(validResponses.tutor)).valid, false);
  assert.equal(validateCollaboratorResponse(packets.tutor, JSON.stringify(validResponses.adversary)).valid, false);
});

test('synthesis dissent references must name included challenge events only', () => {
  const packet = packetsForTest().synthesizer;
  const valid = validateCollaboratorResponse(packet, JSON.stringify(validResponses.synthesizer));
  assert.equal(valid.valid, true);

  const invented = structuredClone(validResponses.synthesizer);
  invented.dissentPreserved = ['challenge-from-another-world'];
  assert.equal(validateCollaboratorResponse(packet, JSON.stringify(invented)).valid, false);

  const wrongRecordType = structuredClone(validResponses.synthesizer);
  wrongRecordType.dissentPreserved = ['report-event-1'];
  assert.equal(validateCollaboratorResponse(packet, JSON.stringify(wrongRecordType)).valid, false);

  const duplicate = structuredClone(validResponses.synthesizer);
  duplicate.dissentPreserved = ['challenge-event-1', 'challenge-event-1'];
  assert.equal(validateCollaboratorResponse(packet, JSON.stringify(duplicate)).valid, false);
});
