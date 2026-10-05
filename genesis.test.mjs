import assert from "node:assert/strict";
import { reduce } from "./core.mjs";
import { makeEvidence } from "./evidence.mjs";

const observedBytes = Buffer.from("forge execution observed");
const evidence = makeEvidence(observedBytes, "text/plain");

const events = [
  { id:"c1", subject:"forge", state:"OBSERVED", actor:"agent-a", evidence:{ ...evidence, digest:"0".repeat(64) } },
  { id:"o1", subject:"forge", state:"OBSERVED", actor:"agent-a", evidence }
];

const resolveEvidence = candidate =>
  candidate.digest === evidence.digest ? observedBytes : Buffer.from("forged");

const first = reduce(events, { resolveEvidence });
const second = reduce(events, { resolveEvidence });

assert.equal(first.ledger.length, 2);
assert.equal(first.ledger[0].accepted, false);
assert.equal(first.ledger[0].reason, "EVIDENCE_NOT_VERIFIED");
assert.equal(first.ledger[1].accepted, true);
assert.equal(first.canonical.forge.id, "o1");
assert.deepEqual(first, second);

console.log("GENESIS VERIFIED: OBSERVED is admitted only when resolved bytes reproduce the declared digest and size.");
