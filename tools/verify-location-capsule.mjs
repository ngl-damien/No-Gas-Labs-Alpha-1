#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { verifyLocationCapsule } from '../src/location/capsule.js';
if (process.argv.length !== 3) { console.error('Usage: node tools/verify-location-capsule.mjs <capsule.json>'); process.exit(2); }
try {
  const capsule = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const verdict = verifyLocationCapsule(capsule);
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.integrity === 'MATCH' ? 0 : 1);
} catch (error) {
  console.error('REJECTED: ' + error.message);
  process.exit(1);
}
