import assert from "node:assert/strict";
import { reduce } from "./core.mjs";

const events = [
  { id:"c1", subject:"forge", state:"OBSERVED", actor:"agent-a", evidence:{ origin:"agent-a", ref:"trust-me" } },
  { id:"o1", subject:"forge", state:"OBSERVED", actor:"agent-a", evidence:{ origin:"verifier", ref:"sha256:abc123" } }
];

const first = reduce(events);
const second = reduce(events);

assert.equal(first.ledger.length, 2);
assert.equal(first.ledger[0].accepted, false);
assert.equal(first.ledger[0].reason, "SELF_CERTIFICATION_FORBIDDEN");
assert.equal(first.ledger[1].accepted, true);
assert.equal(first.canonical.forge.id, "o1");
assert.deepEqual(first, second);

console.log("GENESIS VERIFIED: self-certification rejected; external observation accepted; history preserved; state deterministic.");
