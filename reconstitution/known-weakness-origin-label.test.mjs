import assert from "node:assert/strict";
import { reduce } from "../core.mjs";
import { makeEvidence } from "../evidence.mjs";

const realBytes = Buffer.from("observed artifact");
const evidence = makeEvidence(realBytes);

const renamedOrigin = reduce([{
  id:"forged-origin", subject:"forge", state:"OBSERVED", actor:"agent-a",
  evidence:{ ...evidence, origin:"totally-independent-verifier" }
}], { resolveEvidence: () => Buffer.from("different artifact") });

assert.equal(renamedOrigin.ledger[0].accepted, false);
assert.equal(renamedOrigin.ledger[0].reason, "EVIDENCE_NOT_VERIFIED");

const forgedDigest = reduce([{
  id:"forged-digest", subject:"forge", state:"OBSERVED", actor:"agent-a",
  evidence:{ ...evidence, digest:"f".repeat(64) }
}], { resolveEvidence: () => realBytes });

assert.equal(forgedDigest.ledger[0].accepted, false);
assert.equal(forgedDigest.ledger[0].reason, "EVIDENCE_NOT_VERIFIED");

const noResolver = reduce([{
  id:"no-resolver", subject:"forge", state:"OBSERVED", actor:"agent-a", evidence
}]);

assert.equal(noResolver.ledger[0].accepted, false);
assert.equal(noResolver.ledger[0].reason, "EVIDENCE_RESOLVER_REQUIRED");

const verified = reduce([{
  id:"verified", subject:"forge", state:"OBSERVED", actor:"agent-a", evidence
}], { resolveEvidence: () => realBytes });

assert.equal(verified.ledger[0].accepted, true);

console.log("REGRESSION VERIFIED: labels, claimed digests, and missing resolvers cannot manufacture OBSERVED state.");
