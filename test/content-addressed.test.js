import test from "node:test";
import assert from "node:assert/strict";
import { digestBytes, makeReceipt, verifyReceipt } from "../src/evidence/content-addressed.js";
import { projectWorld } from "../src/world/project.js";

test("receipt verification resolves against a detached frozen snapshot", () => {
  const bytes = Buffer.from("retained artifact bytes");
  const receipt = makeReceipt(bytes);
  let received;

  assert.equal(verifyReceipt(receipt, snapshot => {
    received = snapshot;
    return bytes;
  }), true);
  assert.notStrictEqual(received, receipt);
  assert.deepEqual(received, receipt);
  assert.equal(Object.isFrozen(received), true);
});

test("resolver mutation cannot rewrite the receipt being verified", () => {
  const authentic = Buffer.from("authentic retained bytes");
  const substitute = Buffer.from("different bytes");
  const receipt = { ...makeReceipt(authentic) };
  const original = { ...receipt };

  const accepted = verifyReceipt(receipt, () => {
    // A resolver must not be able to replace the expected digest and size
    // after validation but before the final comparison.
    receipt.digest = digestBytes(substitute);
    receipt.size = substitute.byteLength;
    return substitute;
  });

  assert.equal(accepted, false);
  assert.deepEqual(original, {
    algorithm: "sha256",
    digest: digestBytes(authentic),
    size: authentic.byteLength
  });
});

test("malformed receipts, accessor fields, non-byte results and resolver errors fail closed", () => {
  const bytes = Buffer.from("valid");
  const valid = makeReceipt(bytes);
  let getterCalls = 0;
  const accessor = { algorithm: "sha256", size: bytes.length };
  Object.defineProperty(accessor, "digest", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return valid.digest;
    }
  });

  assert.equal(verifyReceipt(accessor, () => bytes), false);
  assert.equal(getterCalls, 0);
  assert.equal(verifyReceipt({ ...valid, extra: true }, () => bytes), false);
  assert.equal(verifyReceipt({ ...valid, size: Number.MAX_SAFE_INTEGER + 1 }, () => bytes), false);
  assert.equal(verifyReceipt(valid, () => "valid"), false);
  assert.equal(verifyReceipt(valid, () => { throw new Error("artifact store unavailable"); }), false);
});

test("a resolver cannot mutate an event receipt to award forged canonical XP", () => {
  const authentic = Buffer.from("authentic execution bytes");
  const substitute = Buffer.from("substitute execution bytes");
  const event = {
    event_id: "receipt-mutation-attempt",
    event_type: "SYSTEM_EVENT",
    subject: "forge-gate",
    grant_id: "grant-1",
    admission: "ACCEPTED",
    authority: "AUTHORIZED",
    execution: "EXECUTED",
    evidence: "OBSERVED",
    observation_verification: "VERIFIED",
    outcome: "SUCCEEDED",
    receipts: [{ ...makeReceipt(authentic) }],
    world_effect: { xp: 500 }
  };

  const projected = projectWorld([event], undefined, {
    resolveArtifact: () => {
      event.receipts[0].digest = digestBytes(substitute);
      event.receipts[0].size = substitute.byteLength;
      return substitute;
    },
    verifyObservation: () => true,
    verifyAuthorization: () => true
  });

  assert.equal(projected.xp, 0);
  assert.equal(projected.world.forgeOpen, undefined);
  assert.equal(projected.quests["forge-gate"], undefined);
});
