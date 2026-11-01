import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const preflight = packageJson.scripts['agent:preflight:ci'];

test('decision-store ACL, crash, and lock-diagnostic paths are in the portable preflight scope', () => {
  assert.equal(typeof preflight, 'string');
  for (const path of [
    'src/windows-acl.mjs',
    'src/institution/decisions.mjs',
    'src/institution/lock-inspector.mjs',
    'test/institution-decisions.test.mjs',
    'test/writer-lock-inspector.test.mjs',
    'test/windows-decision-store-acl.test.mjs',
    'test/windows-decision-store-preflight.test.mjs',
    '.github/workflows/windows-founder-key-ownership.yml'
  ]) {
    assert.ok(preflight.includes('--path ' + path), 'missing preflight target: ' + path);
  }
});
