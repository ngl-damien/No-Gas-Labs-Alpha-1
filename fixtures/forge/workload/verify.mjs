import { readFileSync } from 'node:fs';

// Capture I/O, primitive serializers and the challenge before loading candidate code.
// The host independently checks every response value; child assertions grant nothing.
const write = process.stdout.write.bind(process.stdout);
const numberText = String;
const finite = Number.isFinite;
const challenge = JSON.parse(readFileSync(0, 'utf8'));
const cases = challenge.cases;
const challengeId = challenge.challengeId;
const encode = value => typeof value === 'number' && finite(value) ? numberText(value) : 'null';
const { sum } = await import('./candidate.mjs');
let failed = false;
let response = '{"schema":"ngl.forge-verification.v2","challengeId":"' + challengeId + '","cases":[';
for (let index = 0; index < cases.length; index++) {
  const { values, expected } = cases[index];
  const length = values.length;
  let before = '';
  for (let j = 0; j < length; j++) before += (j ? ',' : '') + encode(values[j]);
  const result = sum(values);
  let after = '';
  for (let j = 0; j < values.length; j++) after += (j ? ',' : '') + encode(values[j]);
  if (result !== expected || values.length !== length || before !== after) failed = true;
  response += (index ? ',' : '') + '{"result":' + encode(result) + ',"values":[' + after + ']}';
}
write(response + ']}\n');
if (failed) process.exitCode = 1;
