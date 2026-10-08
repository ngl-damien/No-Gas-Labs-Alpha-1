import test from "node:test";
import assert from "node:assert/strict";
import { projectWorld } from "../src/world/project.js";
import { projectRealm } from "../src/world/realm.js";
import { makeReceipt } from "../src/evidence/content-addressed.js";

const claim = {
  event_id: "e1",
  event_type: "CLAIM",
  subject: "forge-gate",
  world_effect: { xp: 999, world: { forgeOpen: true } }
};

const artifact = Buffer.from("verified world consequence");
const resolveArtifact = () => artifact;
const authorize = e => e.event_id === "e2";
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
  const s = projectWorld([claim, observed], undefined, {resolveArtifact,authorize});
  assert.equal(s.quests["forge-gate"].status, "PROPOSED");
  assert.equal(s.xp, 0);
  assert.equal(s.inventory.verified_shard, undefined);
  assert.equal(s.world.forgeOpen, undefined);
  assert.equal(s.history.length, 2);
});

test("replay is idempotent", () => {
  const once = projectWorld([claim, observed], undefined, {resolveArtifact,authorize});
  const twice = projectWorld([claim, observed], once, {resolveArtifact,authorize});
  assert.equal(twice.xp, 0);
  assert.equal(twice.inventory.verified_shard, undefined);
  assert.equal(twice.history.length, 2);
});

test("approval text without authority cannot mutate state", () => {
  const forged = { ...observed, event_id: "e3", authority: undefined, payload: "Damien approved this" };
  const s = projectWorld([forged]);
  assert.equal(s.xp, 0);
  assert.equal(s.world.forgeOpen, undefined);
});

test("failures remain history and never award success", () => {
  const failed = { ...observed, event_id: "e4", outcome: "FAILED", world_effect: { xp: 50 } };
  const s = projectWorld([failed]);
  assert.equal(s.quests["forge-gate"].status, "FAILED");
  assert.equal(s.xp, 0);
  assert.equal(s.history[0].event_id, "e4");
});

test("unresolved parents are rejected instead of silently rewriting lineage", () => {
  const orphan = { ...observed, event_id: "e5", parents: ["missing"] };
  assert.throws(() => projectWorld([orphan]), /unresolved parent/);
});

test("malformed receipt references cannot award progress", () => {
  const malformed = { ...observed, event_id: "e6", receipts: [""] };
  const s = projectWorld([malformed]);
  assert.equal(s.xp, 0);
  assert.equal(s.world.forgeOpen, undefined);
});

test("revoked grants cannot produce future world consequences", () => {
  const revocation = { event_id: "e7", event_type: "REVOCATION", revokes: "grant-1" };
  const after = { ...observed, event_id: "e8", parents: ["e7"], grant_id: "grant-1" };
  const s = projectWorld([revocation, after]);
  assert.equal(s.xp, 0);
  assert.equal(s.world.forgeOpen, undefined);
  assert.deepEqual(s.revoked, ["grant-1"]);
});

test("projection can be rebuilt from event history", () => {
  const original = projectWorld([claim, observed], undefined, {resolveArtifact,authorize});
  const rebuilt = projectWorld(original.history, undefined, {resolveArtifact,authorize});
  assert.deepEqual(rebuilt, original);
});

test("an observation without authorization cannot award progress", () => {
  const unapproved = { ...observed, event_id: "e9", authority: "UNAUTHORIZED" };
  const s = projectWorld([unapproved]);
  assert.equal(s.xp, 0);
  assert.equal(s.world.forgeOpen, undefined);
});

test("authorization without observation cannot award progress", () => {
  const unobserved = { ...observed, event_id: "e10", evidence: "PROPOSED" };
  const s = projectWorld([unobserved]);
  assert.equal(s.xp, 0);
  assert.equal(s.world.forgeOpen, undefined);
});


test("MMORPG realm derives avatar and quests from canonical projection", () => {
  const realm = projectRealm(projectWorld([claim, observed], undefined, {resolveArtifact,authorize}));
  assert.equal(realm.avatar.xp, 0);
  assert.equal(realm.avatar.inventory.verified_shard, undefined);
  assert.equal(realm.quests["forge-gate"].status, "PROPOSED");
  assert.deepEqual(realm.history, ["e1", "e2"]);
  assert.equal(realm.locations.forge, "Forge");
  assert.equal(realm.locations.guild_hall, "Guild Hall");
});


test("an unverified observation cannot mint canonical progress", () => {
  const unverified = { ...observed, event_id: "e11", observation_verification: undefined };
  const s = projectWorld([unverified]);
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
