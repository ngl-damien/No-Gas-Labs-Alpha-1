import assert from "node:assert/strict";
import { reduce } from "../core.mjs";

// Adversarial specimen: the current reducer trusts the caller-controlled
// evidence.origin label. This test intentionally records the vulnerability
// without pretending it is fixed.
const forged = reduce([{
  id:"forged-1", subject:"forge", state:"OBSERVED", actor:"agent-a",
  evidence:{ origin:"totally-independent-verifier", ref:"trust-me-with-a-different-label" }
}]);

assert.equal(
  forged.ledger[0].accepted,
  true,
  "Current Alpha 1 accepts a forged external-origin label; preserve until verifier-backed evidence replaces label trust."
);
console.log("KNOWN WEAKNESS REPRODUCED: evidence.origin is a label, not independent verification.");
