import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const SCHEMA = 'temporal.retrieval-benchmark.v1';
export const RECEIPT_SCHEMA = 'temporal.retrieval-receipt.v1';
const ZERO_DIGEST = '0'.repeat(64);
const MAX_RECORDS = 10000;
const MAX_PAYLOAD_BYTES = 4096;
const UTC_INSTANT = /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/;

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, expected, label) {
  if (!plainObject(value)) throw new TypeError(label + ' must be a plain object');
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(label + ' has missing or unknown fields');
  }
}

function identifier(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(value)) {
    throw new TypeError(label + ' must be a bounded identifier');
  }
}

function instant(value, label) {
  if (typeof value !== 'string' || !UTC_INSTANT.test(value)) throw new TypeError(label + ' must be a millisecond UTC instant');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new TypeError(label + ' is not a valid UTC instant');
  return time;
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON rejects non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (!plainObject(value)) throw new TypeError('canonical JSON accepts only JSON primitives, arrays and plain objects');
  const keys = Object.keys(value).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  return '{' + keys.map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value), 'utf8').digest('hex');
}

function recordBody(record) {
  const { digest, ...body } = record;
  return body;
}

function rootDigest(dataset) {
  return sha256({
    schema: dataset.schema,
    datasetId: dataset.datasetId,
    protocolVersion: dataset.protocolVersion,
    recordCount: dataset.recordCount,
    headDigest: dataset.records.at(-1)?.digest ?? ZERO_DIGEST
  });
}

export function sealDataset({ datasetId, protocolVersion = 'stage-a-1', records }) {
  identifier(datasetId, 'datasetId');
  identifier(protocolVersion, 'protocolVersion');
  if (!Array.isArray(records) || records.length < 1 || records.length > MAX_RECORDS) {
    throw new TypeError('records must contain 1..' + MAX_RECORDS + ' entries');
  }
  const seen = new Set();
  let previousDigest = ZERO_DIGEST;
  const sealed = records.map((input, sequence) => {
    exactKeys(input, ['id', 'occurredAt', 'availableAt', 'stateId', 'relation', 'payload'], 'record');
    identifier(input.id, 'record.id');
    identifier(input.stateId, 'record.stateId');
    identifier(input.relation, 'record.relation');
    if (seen.has(input.id)) throw new TypeError('duplicate record id: ' + input.id);
    seen.add(input.id);
    const occurred = instant(input.occurredAt, 'record.occurredAt');
    const available = instant(input.availableAt, 'record.availableAt');
    if (available < occurred) throw new TypeError('record.availableAt cannot precede occurredAt');
    const payloadText = canonicalJson(input.payload);
    if (Buffer.byteLength(payloadText, 'utf8') > MAX_PAYLOAD_BYTES) throw new TypeError('record payload exceeds byte limit');
    const body = {
      id: input.id,
      sequence,
      occurredAt: input.occurredAt,
      availableAt: input.availableAt,
      stateId: input.stateId,
      relation: input.relation,
      payload: input.payload,
      previousDigest
    };
    const digest = sha256(body);
    previousDigest = digest;
    return { ...body, digest };
  });
  const dataset = {
    schema: SCHEMA,
    datasetId,
    protocolVersion,
    recordCount: sealed.length,
    records: sealed
  };
  dataset.rootDigest = rootDigest(dataset);
  return validateDataset(dataset);
}

export function validateDataset(dataset) {
  exactKeys(dataset, ['schema', 'datasetId', 'protocolVersion', 'recordCount', 'records', 'rootDigest'], 'dataset');
  if (dataset.schema !== SCHEMA) throw new TypeError('unsupported temporal dataset schema');
  identifier(dataset.datasetId, 'datasetId');
  identifier(dataset.protocolVersion, 'protocolVersion');
  if (!Number.isSafeInteger(dataset.recordCount) || dataset.recordCount < 1 || dataset.recordCount > MAX_RECORDS
      || !Array.isArray(dataset.records) || dataset.records.length !== dataset.recordCount) {
    throw new TypeError('recordCount does not match bounded records');
  }
  let previousDigest = ZERO_DIGEST;
  let previousTime = -Infinity;
  let previousId = '';
  const seen = new Set();
  for (let index = 0; index < dataset.records.length; index += 1) {
    const record = dataset.records[index];
    exactKeys(record, ['id', 'sequence', 'occurredAt', 'availableAt', 'stateId', 'relation', 'payload', 'previousDigest', 'digest'], 'record');
    identifier(record.id, 'record.id');
    identifier(record.stateId, 'record.stateId');
    identifier(record.relation, 'record.relation');
    if (seen.has(record.id)) throw new TypeError('duplicate record id: ' + record.id);
    seen.add(record.id);
    if (record.sequence !== index) throw new TypeError('record sequence is missing, duplicated or reordered');
    const occurred = instant(record.occurredAt, 'record.occurredAt');
    const available = instant(record.availableAt, 'record.availableAt');
    if (available < occurred) throw new TypeError('record.availableAt cannot precede occurredAt');
    if (occurred < previousTime || (occurred === previousTime && record.id <= previousId)) {
      throw new TypeError('records are not in canonical temporal order');
    }
    if (record.previousDigest !== previousDigest) throw new TypeError('record hash chain is broken');
    const payloadText = canonicalJson(record.payload);
    if (Buffer.byteLength(payloadText, 'utf8') > MAX_PAYLOAD_BYTES) throw new TypeError('record payload exceeds byte limit');
    if (typeof record.digest !== 'string' || !/^[a-f0-9]{64}$/.test(record.digest)
        || sha256(recordBody(record)) !== record.digest) {
      throw new TypeError('record digest mismatch: ' + record.id);
    }
    previousDigest = record.digest;
    previousTime = occurred;
    previousId = record.id;
  }
  if (typeof dataset.rootDigest !== 'string' || !/^[a-f0-9]{64}$/.test(dataset.rootDigest)
      || rootDigest(dataset) !== dataset.rootDigest) {
    throw new TypeError('dataset root digest mismatch');
  }
  return dataset;
}

function validateQuery(query) {
  if (!plainObject(query)) throw new TypeError('query must be a plain object');
  identifier(query.id, 'query.id');
  instant(query.asOf, 'query.asOf');
  if (query.mode === 'event-id') {
    exactKeys(query, ['id', 'mode', 'asOf', 'eventId'], 'event-id query');
    identifier(query.eventId, 'query.eventId');
  } else if (query.mode === 'state-relation') {
    exactKeys(query, ['id', 'mode', 'asOf', 'stateId', 'relation'], 'state-relation query');
    identifier(query.stateId, 'query.stateId');
    identifier(query.relation, 'query.relation');
  } else if (query.mode === 'temporal-window') {
    const keys = ['id', 'mode', 'asOf', 'from', 'to'];
    if (Object.hasOwn(query, 'stateId')) keys.push('stateId');
    if (Object.hasOwn(query, 'relation')) keys.push('relation');
    exactKeys(query, keys, 'temporal-window query');
    const from = instant(query.from, 'query.from');
    const to = instant(query.to, 'query.to');
    if (from > to) throw new TypeError('query.from must not follow query.to');
    if (query.stateId !== undefined) identifier(query.stateId, 'query.stateId');
    if (query.relation !== undefined) identifier(query.relation, 'query.relation');
  } else {
    throw new TypeError('unsupported temporal query mode');
  }
  return query;
}

export function retrieve(dataset, query) {
  validateDataset(dataset);
  validateQuery(query);
  const asOf = Date.parse(query.asOf);
  const eligible = dataset.records.filter(record => Date.parse(record.availableAt) <= asOf);
  const excludedFutureCount = dataset.records.length - eligible.length;
  let matches;
  if (query.mode === 'event-id') {
    matches = eligible.filter(record => record.id === query.eventId);
  } else if (query.mode === 'state-relation') {
    matches = eligible.filter(record => record.stateId === query.stateId && record.relation === query.relation);
  } else {
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    matches = eligible.filter(record => {
      const occurred = Date.parse(record.occurredAt);
      return occurred >= from && occurred <= to
        && (query.stateId === undefined || record.stateId === query.stateId)
        && (query.relation === undefined || record.relation === query.relation);
    });
  }
  return { ids: matches.map(record => record.id), excludedFutureCount };
}

export function runBenchmark(dataset, queries) {
  validateDataset(dataset);
  if (!Array.isArray(queries) || queries.length < 1 || queries.length > 1000) {
    throw new TypeError('queries must contain 1..1000 entries');
  }
  const seen = new Set();
  let exactMatches = 0;
  let totalLatency = 0;
  const results = queries.map(query => {
    const { expectedIds, ...querySpec } = query;
    validateQuery(querySpec);
    if (seen.has(query.id)) throw new TypeError('duplicate query id: ' + query.id);
    seen.add(query.id);
    if (!Array.isArray(expectedIds) || expectedIds.some(id => typeof id !== 'string')
        || new Set(expectedIds).size !== expectedIds.length) {
      throw new TypeError('each benchmark query requires unique expectedIds');
    }
    const started = performance.now();
    const result = retrieve(dataset, querySpec);
    totalLatency += performance.now() - started;
    const expected = [...expectedIds];
    const correct = result.ids.length === expected.length && result.ids.every((id, index) => id === expected[index]);
    if (correct) exactMatches += 1;
    return {
      queryId: query.id,
      returnedIds: result.ids,
      expectedIds: expected,
      correct,
      excludedFutureCount: result.excludedFutureCount
    };
  });
  const resultDigest = sha256(results);
  const receipt = {
    schema: RECEIPT_SCHEMA,
    datasetDigest: dataset.rootDigest,
    protocolVersion: dataset.protocolVersion,
    queryCount: queries.length,
    exactMatches,
    accuracy: Number((exactMatches / queries.length).toFixed(6)),
    latencyMs: Number(totalLatency.toFixed(3)),
    resultDigest
  };
  return { results, receipt };
}

export function verifyReplay(dataset, queries, receipt) {
  exactKeys(receipt, ['schema', 'datasetDigest', 'protocolVersion', 'queryCount', 'exactMatches', 'accuracy', 'latencyMs', 'resultDigest'], 'receipt');
  if (receipt.schema !== RECEIPT_SCHEMA) throw new TypeError('unsupported benchmark receipt schema');
  if (!/^[a-f0-9]{64}$/.test(receipt.datasetDigest) || !/^[a-f0-9]{64}$/.test(receipt.resultDigest)
      || !Number.isSafeInteger(receipt.queryCount) || receipt.queryCount < 1
      || !Number.isSafeInteger(receipt.exactMatches) || receipt.exactMatches < 0 || receipt.exactMatches > receipt.queryCount
      || typeof receipt.accuracy !== 'number' || receipt.accuracy < 0 || receipt.accuracy > 1
      || typeof receipt.latencyMs !== 'number' || !Number.isFinite(receipt.latencyMs) || receipt.latencyMs < 0) {
    throw new TypeError('benchmark receipt fields are invalid');
  }
  const replay = runBenchmark(dataset, queries);
  const valid = receipt.datasetDigest === replay.receipt.datasetDigest
    && receipt.protocolVersion === replay.receipt.protocolVersion
    && receipt.queryCount === replay.receipt.queryCount
    && receipt.exactMatches === replay.receipt.exactMatches
    && receipt.accuracy === replay.receipt.accuracy
    && receipt.resultDigest === replay.receipt.resultDigest;
  return { valid, datasetDigest: replay.receipt.datasetDigest, resultDigest: replay.receipt.resultDigest };
}

export function createStageAFixture() {
  const dataset = sealDataset({
    datasetId: 'stage-a-synthetic-001',
    protocolVersion: 'stage-a-1',
    records: [
      { id: 'event-001', occurredAt: '2026-11-05T12:00:00.000Z', availableAt: '2026-11-05T12:00:00.000Z', stateId: 'state-alpha', relation: 'initialized', payload: { marker: 'baseline' } },
      { id: 'event-002', occurredAt: '2026-11-05T12:01:00.000Z', availableAt: '2026-11-05T12:01:00.000Z', stateId: 'state-alpha', relation: 'linked', payload: { marker: 'bridge' } },
      { id: 'event-003', occurredAt: '2026-11-05T12:02:00.000Z', availableAt: '2026-11-05T12:05:00.000Z', stateId: 'state-beta', relation: 'linked', payload: { marker: 'delayed' } },
      { id: 'event-004', occurredAt: '2026-11-05T12:03:00.000Z', availableAt: '2026-11-05T12:03:00.000Z', stateId: 'state-beta', relation: 'verified', payload: { marker: 'control' } }
    ]
  });
  const queries = [
    { id: 'q-event-id', mode: 'event-id', asOf: '2026-11-05T12:00:30.000Z', eventId: 'event-001', expectedIds: ['event-001'] },
    { id: 'q-state-relation', mode: 'state-relation', asOf: '2026-11-05T12:04:00.000Z', stateId: 'state-beta', relation: 'verified', expectedIds: ['event-004'] },
    { id: 'q-temporal-window', mode: 'temporal-window', asOf: '2026-11-05T12:04:00.000Z', from: '2026-11-05T12:01:00.000Z', to: '2026-11-05T12:03:00.000Z', expectedIds: ['event-002', 'event-004'] },
    { id: 'q-future-inaccessible', mode: 'event-id', asOf: '2026-11-05T12:04:00.000Z', eventId: 'event-003', expectedIds: [] }
  ];
  return { dataset, queries };
}

async function main() {
  const { dataset, queries } = createStageAFixture();
  const { results, receipt } = runBenchmark(dataset, queries);
  process.stdout.write(JSON.stringify({ dataset, queries, results, receipt }, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
