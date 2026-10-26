import test from 'node:test';
import assert from 'node:assert/strict';
import { renderInstitution, renderDissentDocket } from '../game/institution-view.mjs';

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

test('TownSquare preserves version-bound dissent as unadjudicated and opens the exact retained version', () => withDocument(() => {
  const world = {
    creations: [{ id: 'creation-1', title: 'The Observatory', version: 2, versions: [{ version: 1 }] }],
    reports: [{
      id: 'report-1', creationId: 'creation-1', version: 1,
      text: 'The first version omits its source.',
      actor: { id: 'witness-1', name: 'Witness One' },
      at: '2026-10-25T12:00:00.000Z'
    }]
  };
  const root = element('div');
  let opened = null;
  renderDissentDocket(root, world, { onOpenReport: report => { opened = report; } });
  const output = textOf(root);
  assert.match(output, /FIELD DISSENT & FAILURE REPORTS/);
  assert.match(output, /UNADJUDICATED REPORT · The Observatory v1/);
  assert.match(output, /The first version omits its source/);
  assert.match(output, /Filed under display name Witness One · actor ID witness-1/);
  assert.match(output, /not a verified finding, adjudication or truth claim/);
  const card = walk(root).find(item => item.dataset?.recordType === 'FIELD_REPORT');
  assert.ok(card);
  assert.equal(card.dataset.status, 'UNADJUDICATED REPORT');
  const inspect = walk(card).find(item => item.tagName === 'button');
  assert.equal(inspect.textContent, 'Inspect exact version →');
  inspect.onclick();
  assert.equal(opened.id, 'report-1');
  assert.equal(opened.version, 1);
}));

test('TownSquare keeps orphaned reports visible without inventing an inspection target', () => withDocument(() => {
  const root = element('div');
  renderDissentDocket(root, {
    creations: [],
    reports: [{
      id: 'orphan', creationId: 'missing', version: 8, text: 'Do not erase this.',
      actor: { id: 'witness-2', name: 'Witness Two' }, at: 'not-a-date'
    }]
  }, { onOpenReport: () => assert.fail('orphan must not open') });
  const output = textOf(root);
  assert.match(output, /UNADJUDICATED REPORT · Unknown creation v8/);
  assert.match(output, /Do not erase this/);
  assert.match(output, /cannot be opened from this docket/);
  assert.equal(walk(root).filter(item => item.tagName === 'button').length, 0);
}));

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
