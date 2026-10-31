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
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
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
  const verify = createVerifier({
    resolveProposal: () => { proposalLookups += 1; return proposal; },
    resolveQuest: () => { questLookups += 1; return quest; }
  });
  const valid = signedEventFor(payload);
  const tampered = { ...valid, signature: "A" + valid.signature.slice(1) };
  assert.equal(verify(tampered), false);
  assert.equal(proposalLookups, 0);
  assert.equal(questLookups, 0);
});

test("resolver failures and accessor-backed canonical records fail closed without invoking getters", () => {
  const event = signedEventFor(payload);
  assert.equal(createVerifier({ resolveProposal: () => { throw new Error("ledger unavailable"); } })(event), false);

  let getterCalls = 0;
  const hostileProposal = { event_id: proposal.event_id, type: "PROPOSAL", quest_id: quest.quest_id };
  Object.defineProperty(hostileProposal, "capability", {
    enumerable: true,
    get() { getterCalls += 1; return "repository.write"; }
  });
  assert.equal(createVerifier({ resolveProposal: () => hostileProposal })(event), false);
  assert.equal(getterCalls, 0);
});

test("context-bound verifier requires trusted synchronous proposal and quest resolvers", () => {
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
    resolveQuest: () => quest
  }), /FOUNDER_CONTEXT_TRUST_CONFIGURATION_INVALID/);
});
