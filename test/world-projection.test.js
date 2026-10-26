import test from "node:test";
import assert from "node:assert/strict";
import { projectWorld } from "../src/world/project.js";
import { projectRealm } from "../src/world/realm.js";
import { makeReceipt } from "../src/evidence/content-addressed.js";

const artifact = Buffer.from("verified forge execution");
const resolveArtifact = () => artifact;
const independentlyVerifiedObservationIds = new Set(["e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "e10", "e11", "e12"]);
// This allowlist is a test stub for a separately trusted verifier, not a production verifier.
const verifyObservation = event => independentlyVerifiedObservationIds.has(event.event_id);

const claim = {
  event_id: "e1",
  event_type: "CLAIM",
  subject: "forge-gate",
  world_effect: { xp: 999, world: { forgeOpen: true } }
};

const observed = {
  event_id: "e2",
  event_type: "SYSTEM_EVENT",
  subject: "forge-gate",
  admission: "ACCEPTED",
  authority: "AUTHORIZED",
  execution: "EXECUTED",
  evidence: "OBSERVED",
  observation_verification: "VERIFIED",
  outcome: "SUCCEEDED",
  receipts: [makeReceipt(artifact)],
  world_effect: { xp: 25, inventory: { verified_shard: 1 }, world: { forgeOpen: true } }
};

test("a self-certifying claim cannot mutate canonical world state", () => {
  const s = projectWorld([claim]);
  assert.equal(s.quests["forge-gate"].status, "PROPOSED");
  assert.equal(s.xp, 0);
  assert.equal(s.world.forgeOpen, undefined);
  assert.equal(s.history.length, 1);
});

test("authorized executed observed outcome can project a world consequence", () => {
  const s = projectWorld([claim, observed], undefined, { resolveArtifact, verifyObservation });
  assert.equal(s.quests["forge-gate"].status, "COMPLETED");
  assert.equal(s.xp, 25);
  assert.equal(s.inventory.verified_shard, 1);
  assert.equal(s.world.forgeOpen, true);
  assert.equal(s.history.length, 2);
});

test("replay is idempotent", () => {
  const once = projectWorld([claim, observed], undefined, { resolveArtifact, verifyObservation });
  const twice = projectWorld([claim, observed], once, { resolveArtifact, verifyObservation });
  assert.equal(twice.xp, 25);
  assert.equal(twice.inventory.verified_shard, 1);
  assert.equal(twice.history.length, 2);
});

test("changed artifact bytes cannot award canonical progress", () => {
  const s = projectWorld([observed], undefined, { resolveArtifact: () => Buffer.from("tampered"), verifyObservation });
  assert.equal(s.xp, 0);
  assert.equal(s.inventory.verified_shard, undefined);
  assert.equal(s.world.forgeOpen, undefined);
});

test("approval text without authority cannot mutate state", () => {
  const forged = { ...observed, event_id: "e3", authority: undefined, payload: "Damien approved this" };
  const s = projectWorld([forged], undefined, { resolveArtifact, verifyObservation });
  assert.equal(s.xp, 0);
  assert.equal(s.world.forgeOpen, undefined);
});

test("failures remain history and never award success", () => {
  const failed = { ...observed, event_id: "e4", outcome: "FAILED", world_effect: { xp: 50 } };
  const s = projectWorld([failed], undefined, { resolveArtifact, verifyObservation });
  assert.equal(s.quests["forge-gate"].status, "FAILED");
  assert.equal(s.xp, 0);
  assert.equal(s.history[0].event_id, "e4");
});

test("unresolved parents are rejected instead of silently rewriting lineage", () => {
  const orphan = { ...observed, event_id: "e5", parents: ["missing"] };
  assert.throws(() => projectWorld([orphan], undefined, { resolveArtifact, verifyObservation }), /unresolved parent/);
});

test("malformed receipt references cannot award progress", () => {
  const malformed = { ...observed, event_id: "e6", receipts: [""] };
  const s = projectWorld([malformed], undefined, { resolveArtifact, verifyObservation });
  assert.equal(s.xp, 0);
  assert.equal(s.world.forgeOpen, undefined);
});

test("revoked grants cannot produce future world consequences", () => {
  const revocation = { event_id: "e7", event_type: "REVOCATION", revokes: "grant-1" };
  const after = { ...observed, event_id: "e8", parents: ["e7"], grant_id: "grant-1" };
  const verifyAdjudication = event => event.event_id === "e7";
  const s = projectWorld([revocation, after], undefined, { resolveArtifact, verifyObservation, verifyAdjudication });
  assert.equal(s.xp, 0);
  assert.equal(s.world.forgeOpen, undefined);
  assert.deepEqual(s.revoked, ["grant-1"]);
  const untrustedRevocation = projectWorld([revocation, after], undefined, { resolveArtifact, verifyObservation });
  assert.equal(untrustedRevocation.xp, 25, "unverified revocation is history, not authority to rewrite the projection");
  assert.deepEqual(untrustedRevocation.revoked, []);
});

test("projection can be rebuilt from event history", () => {
  const original = projectWorld([claim, observed], undefined, { resolveArtifact, verifyObservation });
  const rebuilt = projectWorld(original.history, undefined, { resolveArtifact, verifyObservation });
  assert.deepEqual(rebuilt, original);
});

test("an observation without authorization cannot award progress", () => {
  const unapproved = { ...observed, event_id: "e9", authority: "UNAUTHORIZED" };
  const s = projectWorld([unapproved], undefined, { resolveArtifact, verifyObservation });
  assert.equal(s.xp, 0);
  assert.equal(s.world.forgeOpen, undefined);
});

test("authorization without observation cannot award progress", () => {
  const unobserved = { ...observed, event_id: "e10", evidence: "PROPOSED" };
  const s = projectWorld([unobserved], undefined, { resolveArtifact, verifyObservation });
  assert.equal(s.xp, 0);
  assert.equal(s.world.forgeOpen, undefined);
});


test("MMORPG realm derives avatar and quests from canonical projection", () => {
  const realm = projectRealm(projectWorld([claim, observed], undefined, { resolveArtifact, verifyObservation }));
  assert.equal(realm.avatar.xp, 25);
  assert.equal(realm.avatar.inventory.verified_shard, 1);
  assert.equal(realm.quests["forge-gate"].status, "COMPLETED");
  assert.deepEqual(realm.history, ["e1", "e2"]);
  assert.equal(realm.locations.forge, "Forge");
  assert.equal(realm.locations.guild_hall, "Guild Hall");
});



test("a self-asserted VERIFIED flag cannot mint progress without an independent verifier", () => {
  const selfCertified = { ...observed, event_id: "e13" };
  const missingVerifier = projectWorld([selfCertified], undefined, { resolveArtifact });
  assert.equal(missingVerifier.xp, 0);
  assert.equal(missingVerifier.world.forgeOpen, undefined);

  const rejectedByVerifier = projectWorld([selfCertified], undefined, { resolveArtifact, verifyObservation });
  assert.equal(rejectedByVerifier.xp, 0);
  assert.equal(rejectedByVerifier.world.forgeOpen, undefined);
});

test("observation verifier exceptions fail closed", () => {
  const s = projectWorld([observed], undefined, {
    resolveArtifact,
    verifyObservation: () => { throw new Error("verifier unavailable"); }
  });
  assert.equal(s.xp, 0);
  assert.equal(s.world.forgeOpen, undefined);
});

test("an unverified observation cannot mint canonical progress", () => {
  const unverified = { ...observed, event_id: "e11", observation_verification: undefined };
  const s = projectWorld([unverified], undefined, { resolveArtifact, verifyObservation });
  assert.equal(s.xp, 0);
  assert.equal(s.inventory.verified_shard, undefined);
  assert.equal(s.world.forgeOpen, undefined);
});

test("institutional traversal is constrained by the realm graph", async () => {
  const { canTravel } = await import("../src/world/realm.js");
  assert.equal(canTravel("guild_hall", "decision_chamber"), true);
  assert.equal(canTravel("guild_hall", "forge"), false);
  assert.equal(canTravel("nowhere", "forge"), false);
  const realm = projectRealm(projectWorld([claim]));
  assert.deepEqual(realm.institutions.guild_hall.exits, ["decision_chamber", "town_square", "academy"]);
});


test("an explicitly rejected observation cannot mint canonical progress despite a valid receipt", () => {
  const rejected = { ...observed, event_id: "e12", observation_verification: "REJECTED" };
  const s = projectWorld([rejected], undefined, { resolveArtifact, verifyObservation });
  assert.equal(s.xp, 0);
  assert.equal(s.quests["forge-gate"]?.status, undefined);
  assert.equal(s.world.forgeOpen, undefined);
});

test("unverified failures and rejections remain in history without manufacturing terminal state", () => {
  const failed = { ...observed, event_id: "e14", outcome: "FAILED" };
  const failedProjection = projectWorld([failed], undefined, { resolveArtifact, verifyObservation: () => false });
  assert.equal(failedProjection.xp, 0);
  assert.equal(failedProjection.quests["forge-gate"], undefined);
  assert.equal(failedProjection.history.length, 1);

  const rejected = { ...observed, event_id: "e15", admission: "REJECTED" };
  const untrusted = projectWorld([rejected], undefined, { resolveArtifact, verifyObservation, verifyAdjudication: () => false });
  assert.equal(untrusted.quests["forge-gate"], undefined);
  assert.equal(untrusted.history.length, 1);

  const trusted = projectWorld([rejected], undefined, { resolveArtifact, verifyObservation, verifyAdjudication: event => event.event_id === "e15" });
  assert.equal(trusted.quests["forge-gate"].status, "REJECTED");
  assert.equal(trusted.history.length, 1);
});
