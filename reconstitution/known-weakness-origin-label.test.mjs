import assert from "node:assert/strict";
import { reduce } from "../core.mjs";

const forged = reduce([{
  id:"forged-1", subject:"forge", state:"OBSERVED", actor:"agent-a",
  evidence:{ origin:"totally-independent-verifier", ref:"trust-me-with-a-different-label" }
}], {
  verifyEvidence: () => false
});

assert.equal(forged.ledger[0].accepted, false);
assert.equal(forged.ledger[0].reason, "EVIDENCE_NOT_VERIFIED");

const noVerifier = reduce([{
  id:"forged-2", subject:"forge", state:"OBSERVED", actor:"agent-a",
  evidence:{ origin:"verifier", ref:"sha256:anything" }
}]);

assert.equal(noVerifier.ledger[0].accepted, false);
assert.equal(noVerifier.ledger[0].reason, "VERIFIER_REQUIRED");

console.log("REGRESSION VERIFIED: evidence.origin is not authority; OBSERVED requires an external runtime verifier.");
