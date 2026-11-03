import test from 'node:test';
import { createHash } from 'node:crypto';
import { sourceObservationRequestMaterial } from '../game/research-records.mjs';
import assert from 'node:assert/strict';
import { renderEvidenceArchive, renderInstitution } from '../game/institution-view.mjs';

function element(tag) {
  return {
    tagName: tag,
    children: [],
    dataset: {},
    textContent: '',
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this[name] = value; }
  };
}
function withDocument(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = { createElement: element };
  try { return run(); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  }
}
function walk(node) { return [node, ...(node.children || []).flatMap(walk)]; }
function textOf(node) { return walk(node).map(item => item.textContent || '').join('\n'); }
const projects = { projects: [], accomplishments: [], disputes: [], decisions: [], witnessParticipation: 0 };
const gate = { policy: null, decisions: [] };


function sourceObservationWorld({ claim = 'A model says the bridge is open.' } = {}) {
  const founder = { id: 'damien', name: 'Damien', role: 'founder' };
  const witness = { id: 'witness-1', name: 'Witness', role: 'witness' };
  const creationId = 'creation-observatory';
  const publishedAt = '2026-10-27T09:00:00.000Z';
  const note = {
    claim,
    sourceKind: 'model-assertion',
    source: 'Model output only; no primary source retrieved.',
    falsifier: 'A direct inspection finds it closed.',
    uncertainty: 'No independent observation.',
    nextTest: 'Inspect the bridge.'
  };
  const digest = createHash('sha256').update(sourceObservationRequestMaterial({
    actorId: founder.id, actorRole: founder.role, creationId, version: 1, ...note
  })).digest('hex');
  const observationId = 'source-observation-' + digest;
  const challengeId = 'source-challenge-1';
  const world = {
    creations: [{
      id: creationId, kind: 'observatory', title: 'Source Observatory',
      version: 1, publishedAt, versions: []
    }],
    events: [
      { id: 'publish-observatory', type: 'publish', creationId, version: 1, actor: founder, at: publishedAt },
      {
        id: 'source-observation-event', type: 'source-observation-recorded',
        observationId, creationId, version: 1, actor: founder, at: '2026-10-27T09:01:00.000Z',
        ...note, originSchema: 'ngl.source-observatory.v2', bindingMode: 'USER_SELECTED',
        sourceRetrieval: 'NOT_PERFORMED', independentVerification: 'NOT_PERFORMED',
        modelAssertions: 'LEADS_ONLY', execution: 'NOT_EXECUTED', normalizedRecordDigest: digest
      },
      {
        id: 'source-challenge-event', type: 'source-observation-challenged',
        challengeId, observationId, creationId, version: 1, actor: witness,
        at: '2026-10-27T09:02:00.000Z', challengeType: 'missing-evidence',
        challengeText: 'No retrievable primary source is attached.'
      }
    ],
    reports: [],
    contributions: [],
    discoveries: []
  };
  return { world, creationId, observationId, challengeId, founder, witness };
}



test('TownSquare renders actual canonical work stages and the exact-byte receipt with limitations', () => withDocument(() => {
  const digest = 'a'.repeat(64);
  const stages = [
    { id: 'e1', workId: 'work-1', type: 'claim', actor: 'local-forge', at: '2026-10-25T12:00:00.000Z', action: 'preserve-artifact-bytes', subject: { id: 'creation-1', version: 1 } },
    { id: 'e2', workId: 'work-1', type: 'authorize', actor: 'damien', at: '2026-10-25T12:00:01.000Z' },
    { id: 'e3', workId: 'work-1', type: 'execute', actor: 'local-forge', at: '2026-10-25T12:00:02.000Z' },
    { id: 'e4', workId: 'work-1', type: 'observe', actor: 'local-byte-verifier', at: '2026-10-25T12:00:03.000Z', passed: true },
    { id: 'e5', workId: 'work-1', type: 'adjudicate', actor: 'damien', at: '2026-10-25T12:00:04.000Z', decision: 'accept' }
  ];
  const kernel = {
    revision: 5, eventCount: 5, events: stages,
    accepted: [{
      workId: 'work-1', subject: { id: 'creation-1', version: 1 }, action: 'preserve-artifact-bytes',
      stage: 'accepted', outputs: [{ algorithm: 'sha256', digest, size: 42 }],
      executorId: 'local-forge', observerId: 'local-byte-verifier', adjudicatedBy: 'damien'
    }]
  };
  const root = element('div');
  renderInstitution(root, projects, gate, { kernel });
  const output = textOf(root);
  assert.match(output, /CANONICAL WORK RECEIPTS/);
  assert.match(output, /ACCEPTED/);
  assert.match(output, /creation-1 v1/);
  assert.match(output, new RegExp(digest));
  assert.match(output, /42 bytes/);
  assert.match(output, /CLAIM/);
  assert.match(output, /AUTHORIZE/);
  assert.match(output, /EXECUTE/);
  assert.match(output, /OBSERVE/);
  assert.match(output, /ADJUDICATE/);
  assert.match(output, /do not prove truth, usefulness, independent human review, demand, revenue or public deployment/);
  const cards = walk(root).filter(item => item.dataset?.recordType === 'KERNEL_WORK');
  assert.equal(cards.length, 1);
  assert.equal(walk(cards[0]).filter(item => item.tagName === 'li').length, 5);
}));

test('TownSquare states when no canonical work is recorded and flags inconsistent event counts', () => withDocument(() => {
  const root = element('div');
  renderInstitution(root, projects, gate, { kernel: { revision: 0, eventCount: 1, events: [], accepted: [] } });
  const output = textOf(root);
  assert.match(output, /No canonical work events are recorded/);
  assert.match(output, /Record count mismatch/);
  assert.match(output, /These records do not award game XP/);
}));


test('TownSquare keeps project records visible when canonical kernel history is unavailable', () => withDocument(() => {
  const root = element('div');
  const availableProjects = { ...projects, projects: [{ title: 'Preserved project record', status: 'OPEN' }] };
  renderInstitution(root, availableProjects, gate, { kernelUnavailable: true });
  const output = textOf(root);
  assert.match(output, /Canonical work receipts could not be loaded/);
  assert.match(output, /Preserved project record/);
  assert.doesNotMatch(output, /No canonical work events are recorded/);
}));

test('TownSquare warns about ungrouped events and accepted work without history even when event counts match', () => withDocument(() => {
  const root = element('div');
  renderInstitution(root, projects, gate, {
    kernel: {
      revision: 2,
      eventCount: 2,
      events: [
        { id: 'e1', workId: 'work-1', type: 'claim', actor: 'local-forge', at: '2026-10-25T12:00:00.000Z', action: 'preserve-artifact-bytes', subject: { id: 'creation-1', version: 1 } },
        { id: 'e2', type: 'execute', actor: 'local-forge', at: '2026-10-25T12:00:02.000Z' }
      ],
      accepted: [{ workId: 'orphan-work', stage: 'accepted', outputs: [] }]
    }
  });
  const output = textOf(root);
  assert.match(output, /1 retained event\(s\) have no valid work ID/);
  assert.match(output, /1 accepted work record\(s\) have no retained event history/);
}));



test('Evidence Archive queues only uniquely linked unanswered Source Observation challenges and opens the exact version', () => withDocument(() => {
  const claim = '<img src=x onerror=alert(1)> A model says the bridge is open.';
  const { world, creationId } = sourceObservationWorld({ claim });
  const before = structuredClone(world);
  const opened = [];
  const root = element('div');
  renderEvidenceArchive(root, {
    world, shared: true,
    onOpenArtifact: (id, version) => opened.push([id, version])
  });
  const output = textOf(root);
  assert.match(output, /SOURCE OBSERVATORY · AUTHOR RESPONSE QUEUE/);
  assert.match(output, /SOURCE OBSERVATION REGISTER/);
  assert.match(output, /1 uniquely linked source observation/);
  assert.match(output, /1 linked challenge/);
  assert.match(output, /0 uniquely linked response record/);
  assert.match(output, /Model output only; no primary source retrieved\./);
  assert.match(output, /A direct inspection finds it closed\./);
  assert.match(output, /No independent observation\./);
  assert.match(output, /Inspect the bridge\./);
  assert.match(output, /Source retrieval NOT_PERFORMED/);
  assert.match(output, /independent verification NOT_PERFORMED/);
  assert.match(output, /model assertions LEADS_ONLY/);
  assert.match(output, /execution NOT_EXECUTED/);
  assert.match(output, /1 uniquely linked challenge\(s\) await an author response/);
  assert.match(output, /Only the original note author can respond/);
  assert.match(output, /not a verdict, independent evidence, or authority/);
  assert.match(output, /<img src=x onerror=alert\(1\)>/);
  assert.equal(walk(root).filter(item => item.tagName === 'img').length, 0,
    'claim and source text must be rendered as text, never parsed as markup');
  const registerCards = walk(root).filter(item => item.dataset?.sourceObservationRegisterRecord);
  assert.equal(registerCards.length, 1);
  assert.equal(registerCards[0].dataset.sourceObservationRegisterRecord.startsWith('source-observation-'), true);
  const registerButton = walk(root).find(item => item.dataset?.sourceObservationRegisterOpen);
  assert.ok(registerButton);
  assert.equal(registerButton.dataset.creationId, creationId);
  assert.equal(registerButton.dataset.version, '1');
  registerButton.onclick();
  const buttons = walk(root).filter(item => item.dataset?.sourceObservationPendingChallenge);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].dataset.creationId, creationId);
  assert.equal(buttons[0].dataset.version, '1');
  buttons[0].onclick();
  assert.deepEqual(opened, [[creationId, 1], [creationId, 1]]);
  assert.deepEqual(world, before, 'opening the register and docket does not mutate world state');
}));

test('answered source challenges leave the response queue but remain in the Chronicle', () => withDocument(() => {
  const { world, founder, creationId, observationId, challengeId } = sourceObservationWorld();
  world.events.push({
    id: 'source-response-event', type: 'source-observation-challenge-responded',
    responseId: 'source-response-1', challengeId, observationId, creationId, version: 1,
    actor: founder, at: '2026-10-27T09:03:00.000Z',
    responseText: 'The note is a lead only; retrieval remains outstanding.'
  });
  const root = element('div');
  renderEvidenceArchive(root, { world, shared: true });

  const output = textOf(root);
  assert.equal(walk(root).filter(item => item.dataset?.sourceObservationPendingChallenge).length, 0);
  assert.match(output, /No unanswered Source Observation challenges/);
  assert.match(output, /SOURCE OBSERVATION REGISTER/);
  assert.match(output, /AUTHOR RESPONSE RETAINED/);
  assert.match(output, /The note is a lead only; retrieval remains outstanding\./);
  assert.match(output, /Author response to source challenge/);
  assert.match(output, /DISSENT & RESPONSE/);
}));

test('Evidence Archive register retains an unchallenged Source Observation as a research object', () => withDocument(() => {
  const { world, creationId } = sourceObservationWorld();
  world.events = world.events.filter(event => event.type !== 'source-observation-challenged');
  const before = structuredClone(world);
  const opened = [];
  const root = element('div');
  renderEvidenceArchive(root, {
    world, shared: true,
    onOpenArtifact: (id, version) => opened.push([id, version])
  });
  const output = textOf(root);
  assert.match(output, /SOURCE OBSERVATION REGISTER/);
  assert.match(output, /1 uniquely linked source observation/);
  assert.match(output, /No challenge is retained against this observation yet/);
  assert.match(output, /Source retrieval NOT_PERFORMED/);
  assert.equal(walk(root).filter(item => item.dataset?.sourceObservationPendingChallenge).length, 0);
  const button = walk(root).find(item => item.dataset?.sourceObservationRegisterOpen);
  assert.ok(button);
  button.onclick();
  assert.deepEqual(opened, [[creationId, 1]]);
  assert.deepEqual(world, before, 'register inspection is read-only');
}));

test('unlinked retained challenge events are not silently described as an empty response queue', () => withDocument(() => {
  const { world, founder } = sourceObservationWorld();
  world.events[2].actor = founder;
  const root = element('div');
  renderEvidenceArchive(root, { world, shared: true });
  const output = textOf(root);
  assert.equal(walk(root).filter(item => item.dataset?.sourceObservationPendingChallenge).length, 0);
  assert.match(output, /retained challenge event\(s\) could not be uniquely linked/);
  assert.match(output, /No uniquely linked unanswered challenge is actionable/);
  assert.doesNotMatch(output, /No unanswered Source Observation challenges/);
  assert.match(output, /Source observation challenged/);
}));

test('oversized Source Observation snapshots fail closed instead of presenting an empty queue', () => withDocument(() => {
  const root = element('div');
  renderEvidenceArchive(root, {
    world: { events: new Array(100_001), creations: [] },
    shared: true
  });
  const output = textOf(root);
  assert.match(output, /exceeds the bounded projection limit/);
  assert.doesNotMatch(output, /No unanswered Source Observation challenges/);
}));

test('ambiguous Source Observation response history is visible but never offered as a new response action', () => withDocument(() => {
  const { world, founder, creationId, observationId, challengeId } = sourceObservationWorld();
  for (let index = 1; index <= 2; index += 1) {
    world.events.push({
      id: 'ambiguous-response-event-' + index,
      type: 'source-observation-challenge-responded',
      responseId: 'ambiguous-response-' + index,
      challengeId, observationId, creationId, version: 1, actor: founder,
      at: '2026-10-27T09:0' + (2 + index) + ':00.000Z',
      responseText: 'An independently retained response ' + index + '.'
    });
  }
  const root = element('div');
  renderEvidenceArchive(root, { world, shared: true });
  const output = textOf(root);
  assert.equal(walk(root).filter(item => item.dataset?.sourceObservationPendingChallenge).length, 0);
  assert.equal(walk(root).filter(item => item.dataset?.sourceObservationAmbiguousChallenge).length, 1);
  assert.match(output, /ambiguous response history/i);
  assert.match(output, /No response is selected or counted/);
  assert.match(output, /Source observation challenged/);
}));

test('Evidence Archive exposes retained failed observations and rejected decisions as inspectable objects', () => withDocument(() => {
  const root = element('div');
  const world = {
    creations: [{ id: 'creation-1', title: 'Source Observatory', version: 1, versions: [] }],
    events: [{
      id: 'publish-v1', type: 'publish', creationId: 'creation-1', version: 1,
      actor: { id: 'damien', name: 'Damien' }, at: '2026-10-27T09:00:00.000Z'
    }],
    reports: [], contributions: []
  };
  const subject = { id: 'creation-1', version: 1 };
  const kernel = {
    revision: 3, eventCount: 3, works: {},
    events: [
      { id: 'claim-1', workId: 'work-1', type: 'claim', actor: 'local-forge', at: '2026-10-27T09:01:00.000Z', subject },
      { id: 'observe-1', workId: 'work-1', type: 'observe', actor: 'local-byte-verifier', at: '2026-10-27T09:02:00.000Z', passed: false, subject },
      { id: 'adjudicate-1', workId: 'work-1', type: 'adjudicate', actor: 'damien', at: '2026-10-27T09:03:00.000Z', decision: 'reject', subject }
    ]
  };
  renderEvidenceArchive(root, { world, kernel, shared: true, onOpenArtifact: () => {} });
  const output = textOf(root);
  assert.match(output, /CANONICAL INSTITUTIONAL HISTORY/);
  assert.match(output, /Local byte check: failed/);
  assert.match(output, /Decision: reject/);
  assert.match(output, /not a truth verdict or independent-human review/);
  assert.match(output, /revocations remain inspectable/);
  const kernelCards = walk(root).filter(item => item.dataset?.eventSource === 'kernel');
  assert.equal(kernelCards.length, 3);
  const inspectableKernelEvents = kernelCards.reduce((total, card) => total + walk(card).filter(item => item.tagName === 'button' && item.dataset?.chronicleTarget === 'creation-1').length, 0);
  assert.equal(inspectableKernelEvents, 3);
}));

test('Evidence Archive does not mistake unavailable canonical history for an empty institution', () => withDocument(() => {
  const root = element('div');
  const world = {
    creations: [],
    events: [{ id: 'draft-1', type: 'draft', actor: { id: 'damien', name: 'Damien' }, at: '2026-10-27T09:00:00.000Z' }],
    reports: [], contributions: []
  };
  renderEvidenceArchive(root, { world, kernel: null, kernelUnavailable: true, shared: true });
  const output = textOf(root);
  assert.match(output, /Canonical institutional history could not be loaded/);
  assert.match(output, /not being treated as empty/);
  assert.match(output, /Private draft created/);
}));
