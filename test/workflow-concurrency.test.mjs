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
