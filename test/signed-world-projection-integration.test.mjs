import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { projectWorld } from "../src/world/project.js";
import { makeReceipt } from "../src/evidence/content-addressed.js";
import {
  canonicalAttestationPayload,
  createWorldTrust,
  worldTrustKeyFingerprint
} from "../src/world/signed-attestation.js";

const artifact = Buffer.from("independently attested forge execution");
const audience = "ngl-alpha1:integration-test-world";
const profiles = {
  observation: {
    field: "observation_attestation",
    identityField: "observer_id",
    schema: "ngl.observation-attestation.v1",
    identity: "observer-integration"
  },
  authorization: {
    field: "authorization_attestation",
    identityField: "authorizer_id",
    schema: "ngl.authorization-attestation.v1",
    identity: "authorizer-integration"
  },
  adjudication: {
    field: "adjudication_attestation",
    identityField: "adjudicator_id",
    schema: "ngl.adjudication-attestation.v1",
    identity: "adjudicator-integration"
  }
};

function signedWorldEvent() {
  const configs = {};
  const keys = {};
  for (const [role, profile] of Object.entries(profiles)) {
    const pair = generateKeyPairSync("ed25519");
    const expectedFingerprint = worldTrustKeyFingerprint(pair.publicKey);
    keys[role] = pair;
    configs[role] = {
      publicKey: pair.publicKey,
      expectedFingerprint,
      expectedIdentity: profile.identity,
      expectedAudience: audience
    };
  }

  const event = {
    event_id: "signed-observation-1",
    event_type: "SYSTEM_EVENT",
    subject: "forge-gate",
    grant_id: "grant-integration",
    admission: "ACCEPTED",
    authority: "AUTHORIZED",
    execution: "EXECUTED",
    evidence: "OBSERVED",
    observation_verification: "VERIFIED",
    outcome: "SUCCEEDED",
    receipts: [makeReceipt(artifact)],
    world_effect: { xp: 25, inventory: { verified_shard: 1 }, world: { forgeOpen: true } },
    audience
  };
  for (const [role, profile] of Object.entries(profiles)) {
    event[profile.identityField] = profile.identity;
  }

  const trust = createWorldTrust(configs);
  for (const [role, profile] of Object.entries(profiles)) {
    const signature = sign(null, canonicalAttestationPayload(event), keys[role].privateKey)
      .toString("base64url");
    event[profile.field] = {
      schema: profile.schema,
      algorithm: "Ed25519",
      keyFingerprint: configs[role].expectedFingerprint,
      signature
    };
  }
  return { event, trust };
}

const claim = {
  event_id: "claim",
  event_type: "CLAIM",
  subject: "forge-gate",
  world_effect: { xp: 999, world: { forgeOpen: true } }
};

test("real Ed25519 trust adapter authorizes the mainline world projection", () => {
  const { event, trust } = signedWorldEvent();
  const projected = projectWorld([claim, event], undefined, {
    ...trust,
    resolveArtifact: () => artifact
  });
  assert.equal(projected.quests["forge-gate"].status, "COMPLETED");
  assert.equal(projected.xp, 25);
  assert.equal(projected.inventory.verified_shard, 1);
  assert.equal(projected.world.forgeOpen, true);
});

test("a signed event replayed into another audience cannot award progress", () => {
  const { event, trust } = signedWorldEvent();
  event.audience = "ngl-alpha1:other-world";
  const projected = projectWorld([claim, event], undefined, {
    ...trust,
    resolveArtifact: () => artifact
  });
  assert.equal(projected.xp, 0);
  assert.equal(projected.inventory.verified_shard, undefined);
  assert.equal(projected.world.forgeOpen, undefined);
  assert.equal(projected.history.length, 2);
});

test("post-signature world-effect tampering cannot award progress", () => {
  const { event, trust } = signedWorldEvent();
  event.world_effect.xp = 999999;
  const projected = projectWorld([claim, event], undefined, {
    ...trust,
    resolveArtifact: () => artifact
  });
  assert.equal(projected.xp, 0);
  assert.equal(projected.inventory.verified_shard, undefined);
  assert.equal(projected.world.forgeOpen, undefined);
});
