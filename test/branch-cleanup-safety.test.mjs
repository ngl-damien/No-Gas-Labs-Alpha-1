import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../.github/workflows/branch-cleanup.yml', import.meta.url), 'utf8');

test('legacy branch inventory is manual-only and has no automatic triggers', () => {
  const trigger = workflow.slice(0, workflow.indexOf('permissions:'));
  assert.match(trigger, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(trigger, /^  (push|pull_request):/m);
  assert.doesNotMatch(trigger, /confirmation|DELETE-ONLY-MANIFESTED-BRANCHES/);
});

test('legacy inventory has exactly one read-only preview job and no deletion job', () => {
  assert.match(workflow, /^jobs:\n  preview:/m);
  assert.doesNotMatch(workflow, /^  delete:/m);
  assert.doesNotMatch(workflow, /\b(deleteRef|createRef|updateRef)\b/);
  assert.match(workflow, /mode: 'preview-only'/);
  assert.match(workflow, /No branches were deleted/);
});

test('inventory must be dispatched from the default branch', () => {
  assert.match(workflow, /const defaultRef = 'refs\/heads\/' \+ repository\.data\.default_branch/);
  assert.match(workflow, /context\.ref !== defaultRef/);
});

test('preview reports only exact-baseline, unprotected refs without open pull requests', () => {
  for (const marker of [
    'candidates.length !== 80',
    'branch.protected',
    'branch.commit.sha !== baseline',
    'openHeads.has(name)',
    'name === repository.data.default_branch',
    "mode: 'preview-only'"
  ]) assert.ok(workflow.includes(marker), 'missing preview guard: ' + marker);
  assert.match(workflow, /eligible\.join\('\\n'\)/);
  assert.match(workflow, /skipped\.join\('\\n'\)/);
});

test('read-only branch inventory requests only read permissions', () => {
  const match = workflow.match(/^permissions:\\n((?:  [^\\n]+\\n)+)/m);
  assert.ok(match, 'workflow must declare explicit permissions');
  const permissions = match[1].trim().split('\\n').map(line => line.trim()).sort();
  assert.deepEqual(permissions, ['contents: read', 'pull-requests: read']);
});
