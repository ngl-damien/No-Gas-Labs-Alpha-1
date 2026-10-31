import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEvidenceArchive, renderInstitution, isInspectableWorldSnapshot, selectWorldSnapshot } from '../game/institution-view.mjs';

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

  renderInstitution(root, null, null, {
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

  renderInstitution(root, availableProjects, null, {
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
