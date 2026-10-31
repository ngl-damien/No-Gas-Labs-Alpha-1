import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { defineQuest } from "../src/quest/engine.js";
import { proposeGuildAction } from "../src/world/guild-hall.js";
import {
  makeDecisionPayload,
  decisionDigest,
  verifyFounderDecision,
  authorizationEvent,
  createContextBoundFounderAuthorizationVerifier
} from "../src/authority/decision.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicKeyJwk = publicKey.export({ format: "jwk" });
const expectedFingerprint = createHash("sha256")
  .update(publicKey.export({ type: "spki", format: "der" }))
  .digest("hex");
const expectedAudience = "ngl-alpha-1-context-test";
const quest = defineQuest({
  quest_id: "quest-context",
  title: "Context binding",
  objective: "Produce a reviewed repository packet",
  acceptance: ["packet-reviewed", "source-linked"],
  capabilities: ["repository.write"]
});
const proposal = proposeGuildAction({
  quest_id: quest.quest_id,
  proposal_id: "proposal-context",
  actor: "guild",
  summary: "Produce a reviewed repository packet",
  capability: "repository.write"
});
const payload = makeDecisionPayload({
  proposal,
  quest,
  capabilities: ["repository.write"],
  outputs: ["review-packet"],
  acceptance: [...quest.acceptance],
  expires_at: "2099-01-01T00:00:00.000Z",
  audience: expectedAudience
});
const canonical = value => Array.isArray(value)
  ? "[" + value.map(canonical).join(",") + "]"
  : value && typeof value === "object"
    ? "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}"
    : JSON.stringify(value);

function signedEventFor(value) {
  const signed = {
    payload_sha256: decisionDigest(value),
    key_fingerprint: expectedFingerprint,
    signature: sign("sha256", Buffer.from(canonical(value)), {
      key: privateKey,
      dsaEncoding: "ieee-p1363"
    }).toString("base64url")
  };
  const verification = verifyFounderDecision({
    signed,
    payload: value,
    public_key_jwk: publicKeyJwk,
    expected_fingerprint: expectedFingerprint,
    expected_audience: expectedAudience
  });
  assert.deepEqual(verification, { valid: true, reason: null });
  return authorizationEvent({ signed, payload: value, verification });
}

function createVerifier(overrides = {}) {
  return createContextBoundFounderAuthorizationVerifier({
    public_key_jwk: publicKeyJwk,
    expected_fingerprint: expectedFingerprint,
    expected_audience: expectedAudience,
    resolveProposal: id => id === proposal.event_id ? proposal : null,
    resolveQuest: id => id === quest.quest_id ? quest : null,
    resolveOutputs: (proposalId, questId, capability) =>
      proposalId === proposal.event_id && questId === quest.quest_id && capability === "repository.write"
        ? ["review-packet"] : null,
    ...overrides
  });
}

test("context-bound verifier accepts a signed decision matching canonical proposal and quest", () => {
  assert.equal(createVerifier()(signedEventFor(payload)), true);
});

test("a valid signature cannot authorize a capability outside the canonical proposal and quest", () => {
  const policyMismatch = { ...payload, capabilities: ["repository.admin"] };
  const event = signedEventFor(policyMismatch);
  assert.equal(createVerifier()(event), false);
});

test("a valid signature cannot weaken or replace canonical quest acceptance", () => {
  const policyMismatch = { ...payload, acceptance: ["only-one-check"] };
  const event = signedEventFor(policyMismatch);
  assert.equal(createVerifier()(event), false);
});

test("unknown proposal and mismatched quest references fail closed", () => {
  assert.equal(createVerifier()(signedEventFor({ ...payload, proposal_id: "proposal-unknown" })), false);
  assert.equal(createVerifier()(signedEventFor({ ...payload, quest_id: "quest-unknown" })), false);
});

test("context lookup is not attempted until the event signature has passed", () => {
  let proposalLookups = 0;
  let questLookups = 0;
  let outputLookups = 0;
  const verify = createVerifier({
    resolveProposal: () => { proposalLookups += 1; return proposal; },
    resolveQuest: () => { questLookups += 1; return quest; },
    resolveOutputs: () => { outputLookups += 1; return ["review-packet"]; }
  });
  const valid = signedEventFor(payload);
  const replacement = valid.signature[0] === "A" ? "B" : "A";
  const tampered = { ...valid, signature: replacement + valid.signature.slice(1) };
  assert.equal(verify(tampered), false);
  assert.equal(proposalLookups, 0);
  assert.equal(questLookups, 0);
  assert.equal(outputLookups, 0);
});

test("resolver failures and accessor-backed context fail closed without invoking getters", () => {
  const event = signedEventFor(payload);
  assert.equal(createVerifier({ resolveProposal: () => { throw new Error("ledger unavailable"); } })(event), false);
  assert.equal(createVerifier({ resolveOutputs: () => { throw new Error("output policy unavailable"); } })(event), false);

  let getterCalls = 0;
  const hostileProposal = { event_id: proposal.event_id, type: "PROPOSAL", quest_id: quest.quest_id };
  Object.defineProperty(hostileProposal, "capability", {
    enumerable: true,
    get() { getterCalls += 1; return "repository.write"; }
  });
  assert.equal(createVerifier({ resolveProposal: () => hostileProposal })(event), false);

  const hostileOutputs = [];
  Object.defineProperty(hostileOutputs, "0", {
    enumerable: true,
    get() { getterCalls += 1; return "review-packet"; }
  });
  hostileOutputs.length = 1;
  assert.equal(createVerifier({ resolveOutputs: () => hostileOutputs })(event), false);
  assert.equal(getterCalls, 0);
});

test("acceptance ordering may change but the exact canonical set cannot", () => {
  const reordered = { ...payload, acceptance: [...payload.acceptance].reverse() };
  assert.equal(createVerifier()(signedEventFor(reordered)), true);
});

test("a change to the current canonical quest invalidates an otherwise valid signed decision", () => {
  const event = signedEventFor(payload);
  const changedQuest = { ...quest, capabilities: ["repository.admin"] };
  assert.equal(createVerifier({
    resolveQuest: id => id === quest.quest_id ? changedQuest : null
  })(event), false);
});

test("outputs must equal the canonical output set for the proposal and quest", () => {
  const event = signedEventFor(payload);
  assert.equal(createVerifier({
    resolveOutputs: (proposalId, questId, capability) => {
      assert.deepEqual([proposalId, questId, capability], [
        proposal.event_id, quest.quest_id, "repository.write"
      ]);
      return ["review-packet"];
    }
  })(event), true);
  assert.equal(createVerifier({ resolveOutputs: () => ["admin-export"] })(event), false);
  assert.equal(createVerifier({ resolveOutputs: () => ["review-packet", "admin-export"] })(event), false);
});

test("a change to the canonical output set invalidates an otherwise valid signed decision", () => {
  const event = signedEventFor(payload);
  assert.equal(createVerifier({ resolveOutputs: () => ["different-output"] })(event), false);
});

test("an asynchronous output resolver is rejected rather than awaited implicitly", () => {
  const event = signedEventFor(payload);
  assert.equal(createVerifier({ resolveOutputs: async () => ["review-packet"] })(event), false);
});

test("context-bound verifier requires trusted synchronous proposal, quest, and output resolvers", () => {
  assert.throws(() => createContextBoundFounderAuthorizationVerifier({
    public_key_jwk: publicKeyJwk,
    expected_fingerprint: expectedFingerprint,
    expected_audience: expectedAudience
  }), /FOUNDER_CONTEXT_TRUST_CONFIGURATION_INVALID/);
  assert.throws(() => createContextBoundFounderAuthorizationVerifier({
    public_key_jwk: publicKeyJwk,
    expected_fingerprint: expectedFingerprint,
    expected_audience: expectedAudience,
    resolveProposal: true,
    resolveQuest: () => quest,
    resolveOutputs: () => ["review-packet"]
  }), /FOUNDER_CONTEXT_TRUST_CONFIGURATION_INVALID/);
  assert.throws(() => createContextBoundFounderAuthorizationVerifier({
    public_key_jwk: publicKeyJwk,
    expected_fingerprint: expectedFingerprint,
    expected_audience: expectedAudience,
    resolveProposal: () => proposal,
    resolveQuest: () => quest,
    resolveOutputs: true
  }), /FOUNDER_CONTEXT_TRUST_CONFIGURATION_INVALID/);
});
