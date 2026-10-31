import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../.github/workflows/branch-cleanup.yml', import.meta.url), 'utf8');
const previewStart = workflow.indexOf('  preview:');
const deleteStart = workflow.indexOf('  delete:');
assert.ok(previewStart >= 0 && deleteStart > previewStart, 'preview and delete jobs must both exist');
const preview = workflow.slice(previewStart, deleteStart);
const deletion = workflow.slice(deleteStart);

test('branch cleanup is manual-only and blank confirmation is preview-only', () => {
  const trigger = workflow.slice(0, workflow.indexOf('\npermissions:'));
  assert.match(trigger, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(trigger, /^  (push|pull_request):/m);
  assert.match(trigger, /default: ""/);
  assert.match(trigger, /Leave blank for a read-only preview/);
});

test('the preview script has no Git-ref mutation calls and the existing token scope is preserved', () => {
  assert.match(workflow, /^permissions:\n  contents: write\n  pull-requests: read/m);
  assert.doesNotMatch(preview, /\b(deleteRef|createRef|updateRef)\b/);
  assert.match(preview, /mode: 'preview-only'/);
});

test('preview and deletion require dispatch from the repository default branch', () => {
  assert.equal(workflow.split("const defaultRef = 'refs/heads/' + repository.data.default_branch").length - 1, 2);
  assert.equal(workflow.split('context.ref !== defaultRef').length - 1, 2);
});

test('the deletion job requires the exact manual confirmation and a successful preview', () => {
  assert.match(deletion, /if: \$\{\{ success\(\) && inputs\.confirmation == 'DELETE-ONLY-MANIFESTED-BRANCHES' \}\}/);
  assert.match(deletion, /context\.eventName !== 'workflow_dispatch'/);
  assert.match(deletion, /context\.payload\.inputs\?\.confirmation !== confirmation/);
  assert.doesNotMatch(deletion, /permissions:/, 'no job-level permission changes are proposed');
});

test('deletion rechecks live protection, open PRs and default branch immediately before each delete', () => {
  const loopStart = deletion.indexOf('for (const name of candidates)');
  const loopEnd = deletion.indexOf('\n            }\n            core.info', loopStart);
  assert.ok(loopStart >= 0 && loopEnd > loopStart, 'deletion candidate loop must be present');
  const candidateLoop = deletion.slice(loopStart, loopEnd);
  const checks = [
    "github.rest.git.getRef({ owner, repo, ref: 'heads/' + name })",
    'github.rest.repos.getBranch({ owner, repo, branch: name })',
    "github.rest.pulls.list, { owner, repo, state: 'open', per_page: 100 }",
    'github.rest.repos.get({ owner, repo })',
    'liveBranch.data.protected',
    'hasOpenPullRequest',
    'latestRepository.data.default_branch === name'
  ];
  const deleteAt = candidateLoop.indexOf('github.rest.git.deleteRef');
  assert.ok(deleteAt >= 0, 'candidate loop must perform the guarded deletion');
  for (const check of checks) {
    const at = candidateLoop.indexOf(check);
    assert.ok(at >= 0 && at < deleteAt, 'live eligibility check must precede deletion: ' + check);
  }
});

test('deletion retains the manifest, exact-baseline, open-PR, protection and live-ref guards', () => {
  for (const marker of [
    'candidates.length !== 80',
    'branch.protected',
    'branch.commit.sha !== baseline',
    'openHeads.has(name)',
    'name === repository.data.default_branch',
    "ref: 'heads/' + name",
    'live.data.object.sha !== baseline',
    'github.rest.git.deleteRef'
  ]) assert.ok(deletion.includes(marker), 'missing deletion safety guard: ' + marker);
});
