import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runPreflight } from '../scripts/validate-agent-governance.mjs';

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


test('preflight content-addresses the institutional record projector on the combined game stack', async () => {
  const result = await runPreflight({
    paths: ['game/institution-record-objects.mjs'],
    checkpoint: 'docs/operations/LATEST_CHECKPOINT.md',
  });
  assert.equal(result.status, 'ready', JSON.stringify(result.failures));

  const record = result.files.find(item => item.path === 'game/institution-record-objects.mjs');
  assert.ok(record, 'the projector must be present in the actual preflight receipt');
  assert.equal(record.kind, 'target');

  const source = await readFile(new URL('../game/institution-record-objects.mjs', import.meta.url));
  assert.equal(record.bytes, source.byteLength);
  assert.equal(record.sha256, createHash('sha256').update(source).digest('hex'));

  const checkpoint = result.files.find(item => item.path === 'docs/operations/LATEST_CHECKPOINT.md');
  assert.equal(checkpoint?.kind, 'durable-checkpoint');
});
