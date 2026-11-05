import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createStageAFixture, retrieve, runBenchmark, sealDataset, validateDataset, verifyReplay
} from '../experiments/AOTA-FEATHERSTONIAN-ENGINE/TRU/temporal-retrieval-benchmark.mjs';

test('Stage A fixture is a sealed, deterministic synthetic event sequence', () => {
  const first = createStageAFixture();
  const second = createStageAFixture();
  assert.equal(validateDataset(first.dataset), first.dataset);
  assert.equal(first.dataset.rootDigest, second.dataset.rootDigest);
  assert.equal(first.dataset.recordCount, 4);
  assert.ok(first.dataset.records.every(record => /^[a-f0-9]{64}$/.test(record.digest)));
});

test('retrieval supports event identity, state relation and bounded temporal windows', () => {
  const { dataset, queries } = createStageAFixture();
  const querySpec = query => { const { expectedIds, ...spec } = query; return spec; };
  assert.deepEqual(retrieve(dataset, querySpec(queries[0])).ids, ['event-001']);
  assert.deepEqual(retrieve(dataset, querySpec(queries[1])).ids, ['event-004']);
  assert.deepEqual(retrieve(dataset, querySpec(queries[2])).ids, ['event-002', 'event-004']);
});

test('future-inaccessible records are excluded even when their event time is inside the query window', () => {
  const { dataset, queries } = createStageAFixture();
  const { expectedIds, ...querySpec } = queries[3];
  const result = retrieve(dataset, querySpec);
  assert.deepEqual(result.ids, []);
  assert.equal(result.excludedFutureCount, 1);
});

test('missing records are rejected by the declared count and root digest', () => {
  const { dataset } = createStageAFixture();
  const missing = structuredClone(dataset);
  missing.records.pop();
  assert.throws(() => validateDataset(missing), /recordCount/);
});

test('duplicate record identities are rejected before a dataset can be sealed', () => {
  const { dataset } = createStageAFixture();
  const duplicate = dataset.records.map(({ id, occurredAt, availableAt, stateId, relation, payload }) => ({
    id, occurredAt, availableAt, stateId, relation, payload
  }));
  duplicate[1].id = duplicate[0].id;
  assert.throws(() => sealDataset({ datasetId: 'duplicate-case', records: duplicate }), /duplicate record id/);
});

test('reordered records fail the sequence and hash-chain contract', () => {
  const { dataset } = createStageAFixture();
  const reordered = structuredClone(dataset);
  [reordered.records[1], reordered.records[2]] = [reordered.records[2], reordered.records[1]];
  assert.throws(() => validateDataset(reordered), /sequence|hash chain|temporal order/);
});

test('payload corruption is detected by the record digest', () => {
  const { dataset } = createStageAFixture();
  const corrupted = structuredClone(dataset);
  corrupted.records[0].payload.marker = 'rewritten';
  assert.throws(() => validateDataset(corrupted), /digest mismatch/);
});

test('a benchmark receipt binds the dataset and deterministic result set', () => {
  const { dataset, queries } = createStageAFixture();
  const { results, receipt } = runBenchmark(dataset, queries);
  assert.equal(results.length, 4);
  assert.equal(receipt.exactMatches, 4);
  assert.equal(receipt.accuracy, 1);
  assert.equal(receipt.datasetDigest, dataset.rootDigest);
  assert.equal(verifyReplay(dataset, queries, receipt).valid, true);
});

test('serialized artifacts replay successfully in a fresh Node process', async () => {
  const { dataset, queries } = createStageAFixture();
  const { receipt } = runBenchmark(dataset, queries);
  const directory = await mkdtemp(join(tmpdir(), 'ngl-temporal-replay-'));
  const artifactPath = join(directory, 'benchmark.json');
  try {
    await writeFile(artifactPath, JSON.stringify({ dataset, queries, receipt }), 'utf8');
    const moduleUrl = pathToFileURL(fileURLToPath(new URL('../experiments/AOTA-FEATHERSTONIAN-ENGINE/TRU/temporal-retrieval-benchmark.mjs', import.meta.url))).href;
    const script = `import { readFile } from 'node:fs/promises';
import { verifyReplay } from ${JSON.stringify(moduleUrl)};
const artifact = JSON.parse(await readFile(process.argv[1], 'utf8'));
process.stdout.write(JSON.stringify(verifyReplay(artifact.dataset, artifact.queries, artifact.receipt)));
`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, artifactPath], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(JSON.parse(child.stdout).valid, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('malformed query windows and duplicate query IDs fail closed', () => {
  const { dataset, queries } = createStageAFixture();
  const reversed = structuredClone(queries);
  reversed[2].from = '2026-11-05T12:04:00.000Z';
  assert.throws(() => runBenchmark(dataset, reversed), /from must not follow/);
  const duplicate = structuredClone(queries);
  duplicate[1].id = duplicate[0].id;
  assert.throws(() => runBenchmark(dataset, duplicate), /duplicate query id/);
});
