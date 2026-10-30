import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflows = [
  '.github/workflows/verify.yml',
  '.github/workflows/genesis.yml',
  '.github/workflows/browser-acceptance.yml'
];
const expectedGroup = 'group: ${{ github.workflow }}-${{ github.event.pull_request.head.repo.full_name || github.repository }}-${{ github.event.pull_request.head.ref || github.ref_name }}';

test('validation workflows isolate cancellation by workflow, source repository, and branch with read-only permissions', async () => {
  for (const path of workflows) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.ok(source.includes(expectedGroup), `${path} must scope concurrency by source repository to avoid cross-fork cancellation`);
    assert.ok(source.includes('cancel-in-progress: true'), `${path} must cancel superseded runs`);
    assert.match(source, /^permissions:\s*\n\s+contents:\s*read/m, `${path} must grant only read access to repository contents`);
  }
});

function sectionAfterTopLevel(source, heading) {
  const lines = source.split(String.fromCharCode(10)).map(line =>
    line.endsWith("\r") ? line.slice(0, -1) : line
  );
  const start = lines.findIndex(line => line === heading + ":");
  assert.notEqual(start, -1, `missing top-level ${heading} section`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length > 0 && !line.startsWith(" ") && line.endsWith(":")) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

test("validation workflows run push checks only on main while retaining pull-request checks", async () => {
  for (const path of workflows) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    const triggers = sectionAfterTopLevel(source, 'on');
    const pushIndex = triggers.findIndex(line => line === '  push:');
    const pullRequestIndex = triggers.findIndex(line => line === '  pull_request:');
    assert.notEqual(pushIndex, -1, `${path} must retain push validation`);
    assert.ok(pullRequestIndex > pushIndex, `${path} must retain pull_request validation after push`);
    const pushBlock = triggers.slice(pushIndex + 1, pullRequestIndex);
    const pushBranches = pushBlock
      .filter(line => line.startsWith('      - '))
      .map(line => line.slice(8).trim());
    assert.deepEqual(pushBranches, ['main'], `${path} must not run the full suite on every feature-branch push`);
  }
});
