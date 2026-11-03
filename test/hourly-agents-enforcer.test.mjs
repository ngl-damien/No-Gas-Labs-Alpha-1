import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../.github/workflows/hourly-agents-enforcer.yml', import.meta.url), 'utf8');
const registry = JSON.parse(await readFile(new URL('../docs/operations/hourly-agents/REGISTRY.json', import.meta.url), 'utf8'));

test('hourly enforcer has read-only repository permissions and a bounded job', () => {
  assert.ok(workflow.includes('permissions:\n  contents: read'));
  assert.match(workflow, /timeout-minutes:\s*5/);
});

test('hourly enforcer requires every preflight target to exist before invoking the validator', () => {
  assert.ok(workflow.includes('for target in \\'));
  assert.ok(workflow.includes('if ! test -f "$target"; then'));
  assert.ok(workflow.includes('missing preflight target: $target'));
  assert.ok(workflow.includes('exit 1'));
});

test('hourly enforcer preflights every governed input with a unique receipt', () => {
  for (const path of [
    '.github/workflows/hourly-agents-enforcer.yml',
    'test/hourly-agents-enforcer.test.mjs',
    'docs/operations/hourly-agents/REGISTRY.json',
    'docs/operations/hourly-agents/STUTTER_STEP_STEERING.md',
    'docs/operations/hourly-agents/FORENSIC_AUDIT_STEERING.md',
    'docs/operations/hourly-agents/DO_NOT_DELETE.md',
    'src/authority/decision.js',
    'game/server.mjs'
  ]) {
    assert.ok(workflow.includes('--path ' + path), 'missing preflight target: ' + path);
  }
  assert.ok(workflow.includes('--checkpoint docs/operations/LATEST_CHECKPOINT.md'));
  assert.ok(workflow.includes('--receipt ".runtime/hourly-agents-enforcer-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.json"'));
  assert.ok(workflow.includes('if: always()'));
  assert.ok(workflow.includes('include-hidden-files: true'));
  assert.ok(workflow.includes('actions/upload-artifact@v4'));
});

test('push path filter reruns the enforcer when its workflow or regression changes', () => {
  const pushSection = workflow.split('  schedule:')[0];
  assert.ok(pushSection.includes("'.github/workflows/hourly-agents-enforcer.yml'"));
  assert.ok(pushSection.includes("'test/hourly-agents-enforcer.test.mjs'"));
});

test('registry preserves both scheduled workers exactly once and every entry is non-deletable', () => {
  assert.ok(Array.isArray(registry.agents));
  const ids = registry.agents.map(agent => agent.id);
  assert.equal(ids.length, new Set(ids).size, 'registry IDs must be unique');
  for (const id of [
    '6ac6c77de7ac81918e446a49ea330eb6',
    '6ac307e1e9bc8191ae21d22f94743802'
  ]) {
    assert.equal(ids.filter(candidate => candidate === id).length, 1, 'required worker must appear exactly once: ' + id);
  }
  for (const agent of registry.agents) {
    assert.equal(agent.do_not_delete, true, 'registry entry must preserve do_not_delete: ' + agent.id);
  }
});

test('authority diagnostic distinguishes an isolated helper flag from live-route integration', () => {
  assert.ok(workflow.includes('HELPER-LEVEL FLAG PRESENT'));
  assert.ok(workflow.includes('this is not a demonstrated live-route exploit'));
  assert.ok(workflow.includes('No direct server import of the isolated helper observed.'));
  assert.ok(workflow.includes('presence alone does not establish identity, custody, or production trust.'));
});
