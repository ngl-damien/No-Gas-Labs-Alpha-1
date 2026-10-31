import { readFileSync } from 'node:fs';

// Capture output primitives and consume the unpredictable parent challenge before
// loading candidate code. Candidate changes to console/stdout/JSON cannot forge it.
const write = process.stdout.write.bind(process.stdout);
const stringify = JSON.stringify;
const challenge = JSON.parse(readFileSync(0, 'utf8'));
const { values, iterations, challengeId } = challenge;
const { sum } = await import('./candidate.mjs');
let checksum = 0;
for (let iteration = 0; iteration < iterations; iteration++) checksum += sum(values);
write(stringify({
  schema: 'ngl.forge-benchmark.v1',
  challengeId,
  workload: 'vector-sum-v1',
  iterations,
  length: values.length,
  checksum
}) + '\n');
