import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { projectCollaboratorPackets } from '../game/collaborator-contracts.mjs';
import { renderEvidenceArchive, renderInstitution, isInspectableWorldSnapshot, selectWorldSnapshot, projectAdversaryReviewDrafts } from '../game/institution-view.mjs';
import { projectDecisionDocket } from '../game/quests.mjs';

function element(tag) {
  return {
    tagName: tag,
    children: [],
    dataset: {},
    textContent: '',
    append(...children) { this.children.push(...children); },
    focus() { this.focused = true; },
    select() { this.selected = true; },
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
const gate = {
  schema: 'ngl.decisions.snapshot.v1',
  revision: 0,
  head: 'a'.repeat(64),
  policy: null,
  decisions: [],
  counts: { PENDING: 0, APPROVED: 0, REJECTED: 0, DEFERRED: 0, EXPIRED: 0 }
};

function renderView(container, projects, gateSnapshot, options = {}) {
  return renderInstitution(container, projects, gateSnapshot, {
    ...options,
    decisionProjection: options.decisionProjection ?? projectDecisionDocket(gateSnapshot)
  });
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
  renderView(root, projects, gate, { kernel });
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
  renderView(root, projects, gate, { kernel: { revision: 0, eventCount: 1, events: [], accepted: [] } });
  const output = textOf(root);
  assert.match(output, /No canonical work events are recorded/);
  assert.match(output, /Record count mismatch/);
  assert.match(output, /These records do not award game XP/);
}));


test('TownSquare keeps project records visible when canonical kernel history is unavailable', () => withDocument(() => {
  const root = element('div');
  const availableProjects = { ...projects, projects: [{ title: 'Preserved project record', status: 'OPEN' }] };
  renderView(root, availableProjects, gate, { kernelUnavailable: true });
  const output = textOf(root);
  assert.match(output, /Canonical work receipts could not be loaded/);
  assert.match(output, /Preserved project record/);
  assert.doesNotMatch(output, /No canonical work events are recorded/);
}));

test('TownSquare warns about ungrouped events and accepted work without history even when event counts match', () => withDocument(() => {
  const root = element('div');
  renderView(root, projects, gate, {
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


test('institution view preserves the last world chronicle but marks failed shared registers unavailable', () => withDocument(() => {
  const root = element('div');
  const world = {
    creations: [],
    events: [{
      id: 'draft-before-disconnect',
      type: 'draft',
      actor: { id: 'damien', name: 'Damien' },
      at: '2026-10-30T08:00:00.000Z'
    }],
    reports: [],
    contributions: []
  };

  renderView(root, null, null, {
    world,
    worldSnapshotStale: true,
    projectsUnavailable: true,
    decisionsUnavailable: true,
    kernelUnavailable: true
  });

  const output = textOf(root);
  assert.match(output, /last snapshot received by this session; it may be stale/i);
  assert.match(output, /Private draft created/);
  assert.match(output, /No empty register is inferred from missing data/);
  assert.match(output, /Decision ledger unavailable or malformed/);
  assert.match(output, /Canonical work receipts could not be loaded/);
  assert.doesNotMatch(output, /No retained record is installed/);
  assert.doesNotMatch(output, /No operational review policy is activated/);
}));

test('institution view keeps available project records when the decision ledger is unavailable', () => withDocument(() => {
  const root = element('div');
  const availableProjects = {
    ...projects,
    projects: [{ title: 'Recovered project register', status: 'OPEN' }]
  };
  const world = { creations: [], events: [], reports: [], contributions: [] };
  const kernel = { revision: 0, eventCount: 0, events: [], accepted: [] };

  renderView(root, availableProjects, null, {
    world,
    kernel,
    decisionsUnavailable: true
  });

  const output = textOf(root);
  assert.match(output, /Recovered project register/);
  assert.match(output, /Decision ledger unavailable or malformed/);
  assert.doesNotMatch(output, /No operational review policy is activated/);
  assert.doesNotMatch(output, /Project, accomplishment, dispute and decision-status registers are unavailable/);
}));


function pendingDecisionSnapshot() {
  return {
    schema: 'ngl.decisions.snapshot.v1',
    revision: 2,
    head: 'b'.repeat(64),
    policy: {
      id: 'policy-1',
      reviewWindowMs: 3600000,
      revision: 1,
      setAt: '2026-10-31T12:00:00.000Z'
    },
    decisions: [{
      id: 'decision-1',
      title: 'A bounded human-gated proposal',
      status: 'PENDING',
      revision: 1,
      createdAt: '2026-10-31T12:00:00.000Z',
      createdBy: 'damien',
      expiresAt: '2026-10-31T13:00:00.000Z',
      expiredAt: null,
      policy: { id: 'policy-1', revision: 1 },
      disposition: null,
      evaluation: { bytes: 'PRIVATE DECISION EVALUATION' },
      risks: ['PRIVATE DECISION RISK'],
      rollback: 'PRIVATE DECISION ROLLBACK',
      proposedEffect: 'PRIVATE DECISION EFFECT'
    }],
    counts: { PENDING: 1, APPROVED: 0, REJECTED: 0, DEFERRED: 0, EXPIRED: 0 }
  };
}

test('only the full Decision Chamber presentation exposes Founder disposition controls', () => withDocument(() => {
  const snapshot = pendingDecisionSnapshot();
  const guildHall = element('div');
  renderView(guildHall, projects, snapshot, {
    founder: true,
    decisionPresentation: 'summary'
  });
  const guildText = textOf(guildHall);
  assert.match(guildText, /Status-only decision register/);
  assert.match(guildText, /Disposition controls are available only in the Decision Chamber/);
  assert.doesNotMatch(guildText, /PRIVATE DECISION EVALUATION|PRIVATE DECISION RISK|PRIVATE DECISION ROLLBACK|PRIVATE DECISION EFFECT/);
  assert.equal(walk(guildHall).filter(item => item.dataset?.gateAction).length, 0);

  const chamber = element('div');
  renderView(chamber, projects, snapshot, {
    founder: true,
    decisionPresentation: 'full',
    onChoice: () => {}
  });
  const actions = walk(chamber).filter(item => item.dataset?.gateAction).map(item => item.dataset.gateAction);
  assert.deepEqual(actions, ['APPROVE', 'REJECT', 'DEFER']);
  assert.match(textOf(chamber), /PRIVATE DECISION EVALUATION/);
  const card = walk(chamber).find(item => item.dataset?.decisionId === 'decision-1');
  assert.equal(card?.tabIndex, -1, 'the exact decision card must be programmatically focusable');

  const hidden = element('div');
  renderView(hidden, projects, snapshot, {
    founder: true,
    decisionPresentation: 'hidden'
  });
  assert.doesNotMatch(textOf(hidden), /FOUNDER GATE|DECISION SERVICE · STATUS/);
  assert.equal(walk(hidden).filter(item => item.dataset?.gateAction).length, 0);
}));

test('Witness Decision Chamber views never expose Founder-only evaluation bytes or controls', () => withDocument(() => {
  const root = element('div');
  renderView(root, projects, pendingDecisionSnapshot(), {
    founder: false,
    decisionPresentation: 'full'
  });
  assert.match(textOf(root), /Witness view: private evaluation bytes and controls are withheld/);
  assert.doesNotMatch(textOf(root), /PRIVATE DECISION EVALUATION|PRIVATE DECISION RISK|PRIVATE DECISION ROLLBACK|PRIVATE DECISION EFFECT/);
  assert.equal(walk(root).filter(item => item.dataset?.gateAction).length, 0);
}));

function validWorldSnapshot(overrides = {}) {
  const at = '2026-10-30T10:00:00.000Z';
  return {
    schema: 'ngl.world.v2',
    id: 'world-test',
    founderName: 'Damien Featherstone',
    revision: 0,
    xp: 0,
    createdAt: at,
    updatedAt: at,
    creations: [],
    drafts: [],
    events: [],
    contributions: [],
    reports: [],
    discoveries: [],
    methods: [],
    ...overrides
  };
}

test('world snapshot selection accepts a complete envelope without claiming canonical truth', () => {
  const candidate = validWorldSnapshot();
  assert.equal(isInspectableWorldSnapshot(candidate), true);
  const selected = selectWorldSnapshot(candidate, null);
  assert.equal(selected.world, candidate);
  assert.equal(selected.stale, false);
  assert.equal(selected.unavailable, false);
});

test('malformed shared world response falls back to the last inspectable snapshot as stale', () => {
  const previous = validWorldSnapshot({ revision: 4, events: [
    { id: 'event-before-outage', type: 'draft', at: '2026-10-30T09:00:00.000Z' }
  ] });
  const selected = selectWorldSnapshot({ world: {} }, previous);
  assert.equal(selected.world, previous);
  assert.equal(selected.stale, true);
  assert.equal(selected.unavailable, false);
});

test('missing or malformed world snapshots are unavailable rather than fresh empty worlds', () => {
  for (const malformed of [
    null,
    {},
    { ...validWorldSnapshot(), events: undefined },
    { ...validWorldSnapshot(), createdAt: '2026-02-30T00:00:00Z' },
    { ...validWorldSnapshot(), creations: Array(1) }
  ]) {
    assert.equal(isInspectableWorldSnapshot(malformed), false);
    const selected = selectWorldSnapshot(malformed, null);
    assert.equal(selected.world, null);
    assert.equal(selected.stale, true);
    assert.equal(selected.unavailable, true);
  }
});


function sha256Receipt(value) {
  const bytes = Buffer.from(value, 'utf8');
  return {
    algorithm: 'sha256',
    digest: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength
  };
}

function worldWithAdversaryResponse() {
  const founder = { id: 'founder-1', name: 'Founder', role: 'founder' };
  const witness = { id: 'witness-1', name: 'Witness', role: 'witness' };
  const at1 = '2026-10-29T04:00:00.000Z';
  const at2 = '2026-10-29T04:01:00.000Z';
  const at3 = '2026-10-29T04:02:00.000Z';
  const at4 = '2026-10-29T04:03:00.000Z';
  const world = validWorldSnapshot({
    id: 'world-test-1',
    founderName: 'Damien Featherstone',
    revision: 3,
    createdAt: at1,
    updatedAt: at3,
    events: [
      {
        id: 'proposal-event-1', type: 'moonshot-proposed', moonshotId: 'moonshot-1',
        actor: founder, at: at1, title: 'Bounded test',
        hypothesis: 'A claim holds under a stated condition.',
        falsifier: 'A repeatable counterexample',
        evidenceNeeded: 'An independently observed measurement',
        sourceCreationId: null, sourceVersion: null
      },
      {
        id: 'report-event-1', type: 'experiment-reported', reportId: 'report-1',
        moonshotId: 'moonshot-1', actor: witness, at: at2,
        procedure: 'Run the stated procedure once.',
        observation: 'The expected result did not occur.',
        reportedOutcome: 'failed', evidenceCreationId: null, evidenceVersion: null
      },
      {
        id: 'challenge-event-1', type: 'experiment-challenged',
        challengeId: 'challenge-1', reportId: 'report-1', moonshotId: 'moonshot-1',
        actor: founder, at: at3, challengeType: 'methodology',
        challengeText: 'The procedure omits a control condition.',
        evidenceCreationId: null, evidenceVersion: null
      }
    ]
  });
  const packet = projectCollaboratorPackets(world).find(item => item.id === 'adversary');
  assert.ok(packet?.available);
  const responseText = JSON.stringify({
    targetEventId: 'report-event-1',
    challengeType: 'methodology',
    challengeDraft: 'The procedure does not specify a control condition.',
    distinctnessAssessment: 'Compare this draft with the retained challenge before submission.',
    duplicateOfEventIds: ['challenge-event-1'],
    counterexample: 'A controlled comparison could produce a different result.',
    evidenceNeeded: ['A retained controlled replication.'],
    unknowns: ['No independent measurement is supplied.']
  });
  world.events.push({
    id: 'response-event-1',
    type: 'collaborator-response-recorded',
    responseId: 'response-1',
    role: 'adversary',
    moonshotId: 'moonshot-1',
    actor: founder,
    at: at4,
    sourceEventIds: [...packet.inputRefs],
    packetJson: packet.packetJson,
    packetReceipt: sha256Receipt(packet.packetJson),
    responseText,
    responseReceipt: sha256Receipt(responseText),
    validationStatus: 'valid-for-human-review',
    validationReason: null,
    validator: 'ngl.collaborator-response.v1'
  });
  world.revision = 4;
  world.updatedAt = at4;
  return { world, responseText };
}

test('Evidence Archive projects a source-bound Adversary draft without creating world state', () => {
  const { world, responseText } = worldWithAdversaryResponse();
  const before = structuredClone(world);
  const projection = projectAdversaryReviewDrafts(world);
  assert.equal(projection.available, true);
  assert.equal(projection.drafts.length, 1);
  assert.equal(projection.unavailableCount, 0);
  assert.equal(projection.omittedCount, 0);
  assert.equal(projection.drafts[0].responseId, 'response-1');
  assert.equal(projection.drafts[0].draft.reportId, 'report-1');
  assert.equal(projection.drafts[0].draft.targetEventId, 'report-event-1');
  assert.equal(projection.drafts[0].draft.challengeText,
    'The procedure does not specify a control condition.');
  assert.equal(Object.hasOwn(projection.drafts[0].draft, 'worldEvent'), false);
  assert.deepEqual(world, before);
  assert.equal(responseText.length > 0, true);
});

test('Adversary drafts survive unrelated appends but disappear when their retained source changes', () => {
  const { world } = worldWithAdversaryResponse();
  const appended = structuredClone(world);
  appended.events.push({
    id: 'later-note-1', type: 'draft', actor: { id: 'founder-1', role: 'founder' },
    at: '2026-10-29T04:04:00.000Z', semantics: 'Unrelated local note.'
  });
  appended.revision = 5;
  appended.updatedAt = '2026-10-29T04:04:00.000Z';
  assert.equal(projectAdversaryReviewDrafts(appended).drafts.length, 1);

  const changed = structuredClone(world);
  changed.events[1].observation = 'A changed observation invalidates the archived packet binding.';
  assert.equal(projectAdversaryReviewDrafts(changed).drafts.length, 0);
});

test('Rejected or accessor-backed Adversary responses never become editable drafts', () => {
  const { world } = worldWithAdversaryResponse();
  const rejected = structuredClone(world);
  rejected.events[3].validationStatus = 'rejected';
  rejected.events[3].validationReason = 'RESPONSE_SCHEMA_OR_SCOPE_INVALID';
  assert.equal(projectAdversaryReviewDrafts(rejected).drafts.length, 0);

  const hostile = structuredClone(world);
  let reads = 0;
  Object.defineProperty(hostile.events[3], 'responseText', {
    enumerable: true,
    get() { reads += 1; return 'untrusted'; }
  });
  assert.equal(projectAdversaryReviewDrafts(hostile).drafts.length, 0);
  assert.equal(reads, 0);
});

test('Evidence Archive routes an edited Adversary draft to its exact retained challenge encounter', () => withDocument(() => {
  const { world } = worldWithAdversaryResponse();
  const before = structuredClone(world);
  const root = element('div');
  let opened = null;
  renderEvidenceArchive(root, {
    world,
    viewer: { id: 'founder-1', role: 'founder' },
    onOpenChallenge: draft => { opened = draft; }
  });
  const cards = walk(root).filter(item => item.dataset?.recordType === 'ADVERSARY_DRAFT');
  assert.equal(cards.length, 1);
  assert.match(textOf(cards[0]), /human review/);
  assert.match(textOf(cards[0]), /must review and submit the challenge yourself/);
  assert.match(textOf(cards[0]), /No event, XP, evidence, approval or authority is created until you submit/);
  const editor = walk(cards[0]).find(item => item.tagName === 'textarea');
  assert.equal(editor.value, 'The procedure does not specify a control condition.');
  const select = walk(cards[0]).find(item => item.dataset?.adversaryDraftSelect === 'response-1');
  assert.ok(select);
  select.onclick();
  assert.equal(editor.focused, true);
  assert.equal(editor.selected, true);
  editor.value = 'Founder-edited counterargument; verify the missing control condition.';
  const review = walk(cards[0]).find(item => item.dataset?.adversaryDraftReview === 'response-1');
  assert.ok(review);
  review.onclick();
  assert.deepEqual(opened, {
    reportId: 'report-1',
    targetEventId: 'report-event-1',
    moonshotId: 'moonshot-1',
    challengeType: 'methodology',
    challengeText: 'Founder-edited counterargument; verify the missing control condition.'
  });
  assert.deepEqual(world, before, 'opening the review form cannot append or mutate world history');
}));

test('Evidence Archive withholds the challenge handoff from the report author', () => withDocument(() => {
  const { world } = worldWithAdversaryResponse();
  const root = element('div');
  renderEvidenceArchive(root, {
    world,
    viewer: { id: 'witness-1', role: 'witness' },
    onOpenChallenge: () => assert.fail('the report author must not receive a self-challenge handoff')
  });
  const card = walk(root).find(item => item.dataset?.recordType === 'ADVERSARY_DRAFT');
  assert.ok(card);
  assert.equal(walk(card).some(item => item.dataset?.adversaryDraftReview === 'response-1'), false);
}));

test('world snapshot envelope rejects accessor-backed fields without executing getters', () => {
  let reads = 0;
  const hostile = validWorldSnapshot();
  Object.defineProperty(hostile, 'events', {
    enumerable: true,
    get() { reads += 1; return []; }
  });
  assert.equal(isInspectableWorldSnapshot(hostile), false);
  assert.equal(reads, 0);
});
