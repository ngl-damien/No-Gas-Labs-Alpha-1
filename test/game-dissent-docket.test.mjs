import test from 'node:test';
import assert from 'node:assert/strict';
import { projectDissentDocket } from '../game/dissent-docket.mjs';

const world = {
  creations: [{
    id: 'creation-1',
    title: 'The Observatory',
    version: 2,
    versions: [{ version: 1, html: '<p>earlier</p>' }]
  }],
  reports: [
    { id: 'r-old', creationId: 'creation-1', version: 1, text: 'The first version omits a source.', actor: { id: 'w1', name: 'Witness One' }, at: '2026-10-25T12:00:00.000Z' },
    { id: 'r-new', creationId: 'creation-1', version: 2, text: 'The current method is ambiguous.', actor: { id: 'w2', name: 'Witness Two' }, at: '2026-10-26T12:00:00.000Z' },
    { id: 'r-orphan', creationId: 'missing-creation', version: 7, text: 'Keep this contradiction visible.', actor: { id: 'w3', name: 'Witness Three' }, at: '2026-10-27T12:00:00.000Z' }
  ]
};

test('docket keeps reports newest-first, attributed and explicitly unadjudicated', () => {
  const before = structuredClone(world);
  const docket = projectDissentDocket(world);
  assert.deepEqual(docket.map(report => report.id), ['r-orphan', 'r-new', 'r-old']);
  assert.ok(docket.every(report => report.status === 'UNADJUDICATED REPORT'));
  assert.equal(docket[1].creationTitle, 'The Observatory');
  assert.equal(docket[1].actorName, 'Witness Two');
  assert.equal(docket[1].version, 2);
  assert.match(docket[1].text, /ambiguous/);
  assert.deepEqual(world, before, 'projection must not mutate the world');
});

test('docket opens only a creation version that actually exists and never drops an orphan report', () => {
  const docket = projectDissentDocket(world);
  const orphan = docket.find(report => report.id === 'r-orphan');
  const retained = docket.find(report => report.id === 'r-old');
  assert.equal(orphan.inspectable, false);
  assert.match(orphan.limitation, /remains visible/i);
  assert.equal(retained.inspectable, true);
  assert.equal(retained.limitation, null);
});

test('empty or malformed inputs fail closed to an empty or non-openable docket', () => {
  assert.deepEqual(projectDissentDocket(null), []);
  const docket = projectDissentDocket({ reports: [{ text: 'Keep the text', at: 'not-a-date' }] });
  assert.equal(docket.length, 1);
  assert.equal(docket[0].status, 'UNADJUDICATED REPORT');
  assert.equal(docket[0].inspectable, false);
  assert.equal(docket[0].text, 'Keep the text');
});
