import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const preflightCommand = packageJson.scripts['agent:preflight:ci'];

test('hosted preflight fingerprints the institutional record projector and its regression', async () => {
  assert.equal(typeof preflightCommand, 'string');
  const tokens = preflightCommand.split(' ');
  const targets = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index] === '--path') targets.push(tokens[index + 1]);
  }

  assert.ok(targets.includes('game/institution-record-objects.mjs'));
  assert.ok(targets.includes('test/chronicle.test.mjs'));
  assert.ok(targets.includes('test/institution-record-preflight-contract.test.mjs'));
  assert.equal(new Set(targets).size, targets.length, 'hosted preflight targets must remain unique');

  const projectorSource = await readFile(
    new URL('../game/institution-record-objects.mjs', import.meta.url),
    'utf8',
  );
  assert.ok(projectorSource.includes('projectInstitutionRecordWorldObjects'));
});
