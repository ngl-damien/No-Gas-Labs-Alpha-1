import test from "node:test";
import assert from "node:assert/strict";
import { projectWorld, isVerifiedAuthorization, hasVerifiedObservation, isVerifiedAdjudication } from "../src/world/project.js";
import { projectRealm } from "../src/world/realm.js";
import { makeReceipt } from "../src/evidence/content-addressed.js";

const artifact = Buffer.from("verified forge execution");
const resolveArtifact = () => artifact;
const verifiedObservationIds = new Set(["e2", "e4", "e8", "e9", "e10", "e11", "e12", "e17"]);
const verifyObservation = event => verifiedObservationIds.has(event.event_id);
const verifyAuthorization = event =>
  event.grant_id === "grant-1" && event.authority === "AUTHORIZED";
const verifyAdjudication = event =>
  (event.event_type === "REVOCATION" && event.revokes === "grant-1") ||
  (event.event_type === "EXECUTION_ADJUDICATION" && event.admission === "REJECTED" && event.event_id === "e13");
const trusted = { resolveArtifact, verifyObservation, verifyAuthorization, verifyAdjudication };

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
  grant_id: "grant-1",
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

test("host-verified authorization, observation and bytes can project a world consequence", () => {
  const s = projectWorld([claim, observed], undefined, trusted);
  assert.equal(s.quests["forge-gate"].status, "COMPLETED");
  assert.equal(s.xp, 25);
  assert.equal(s.inventory.verified_shard, 1);
  assert.equal(s.world.forgeOpen, true);
  assert.equal(s.history.length, 2);
});

test("event labels and a valid byte receipt are insufficient without host verifiers", () => {
  const s = projectWorld([observed], undefined, { resolveArtifact });
  assert.equal(s.xp, 0);
  assert.equal(s.inventory.verified_shard, undefined);
  assert.equal(s.world.forgeOpen, undefined);
  assert.equal(s.history.length, 1);
});

test("verifiers must return literal true and thrown errors fail closed", () => {
  const nonBoolean = projectWorld([observed], undefined, {
    resolveArtifact, verifyObservation: () => 1, verifyAuthorization: () => true
  });
  assert.equal(nonBoolean.xp, 0);
  const throwing = projectWorld([observed], undefined, {
    resolveArtifact, verifyObservation: () => { throw new Error("offline"); },
    verifyAuthorization: () => true
  });
  assert.equal(throwing.xp, 0);
});

test("replay is idempotent and revalidates the supplied projection seed", () => {
  const once = projectWorld([claim, observed], undefined, trusted);
  const twice = projectWorld([claim, observed], once, trusted);
  assert.equal(twice.xp, 25);
  assert.equal(twice.inventory.verified_shard, 1);
  assert.equal(twice.history.length, 2);
  assert.throws(() => projectWorld([], { ...once, xp: 999 }, trusted), /seed projection differs/);
});

test("changed artifact bytes cannot award canonical progress", () => {
  const s = projectWorld([observed], undefined, {
    ...trusted, resolveArtifact: () => Buffer.from("tampered")
  });
  assert.equal(s.xp, 0);
  assert.equal(s.inventory.verified_shard, undefined);
  assert.equal(s.world.forgeOpen, undefined);
});

test("approval text without verified authorization cannot mutate state", () => {
  const forged = { ...observed, event_id: "e3", payload: "Damien approved this" };
  delete forged.authority;
  const s = projectWorld([forged], undefined, trusted);
  assert.equal(s.xp, 0);
  assert.equal(s.world.forgeOpen, undefined);
});

test("verified failures remain history and change status without awarding success", () => {
  const failed = { ...observed, event_id: "e4", outcome: "FAILED", world_effect: { xp: 50 } };
  const s = projectWorld([failed], undefined, trusted);
  assert.equal(s.quests["forge-gate"].status, "FAILED");
  assert.equal(s.xp, 0);
  assert.equal(s.history[0].event_id, "e4");
});

test("unverified failures and rejections remain history without changing quest status", () => {
  const failed = { ...observed, event_id: "untrusted-failure", outcome: "FAILED" };
  const rejected = {
    event_id: "untrusted-rejection", event_type: "EXECUTION_ADJUDICATION",
    subject: "forge-gate", admission: "REJECTED"
  };
  const s = projectWorld([failed, rejected], undefined, { resolveArtifact });
  assert.equal(s.quests["forge-gate"], undefined);
  assert.deepEqual(s.history.map(event => event.event_id), ["untrusted-failure", "untrusted-rejection"]);
});

test("unresolved parents are rejected instead of silently rewriting lineage", () => {
  const orphan = { ...observed, event_id: "e5", parents: ["missing"] };
  assert.throws(() => projectWorld([orphan], undefined, trusted), /unresolved parent/);
});

test("malformed parent metadata cannot be coerced into root events", () => {
  const malformedParents = ["e1", null, {}, [7], [""], ["e1", "e1"]];
  for (const [index, parents] of malformedParents.entries()) {
    const malformed = { ...observed, event_id: "bad-parent-" + index, parents };
    assert.throws(() => projectWorld([malformed], undefined, trusted), /invalid parents|invalid parent reference|duplicate parent/);
  }
  const accessor = { ...observed, event_id: "accessor-parent" };
  Object.defineProperty(accessor, "parents", {
    enumerable: true, get() { throw new Error("must not execute"); }
  });
  assert.throws(() => projectWorld([accessor], undefined, trusted), /parent metadata must be an enumerable data property/);
  const hidden = { ...observed, event_id: "hidden-parent" };
  Object.defineProperty(hidden, "parents", { value: ["e1"], enumerable: false });
  assert.throws(() => projectWorld([hidden], undefined, trusted), /parent metadata must be an enumerable data property/);
});

test("malformed receipt references cannot award progress", () => {
  const malformed = { ...observed, event_id: "e6", receipts: [""] };
  const s = projectWorld([malformed], undefined, trusted);
  assert.equal(s.xp, 0);
  assert.equal(s.world.forgeOpen, undefined);
});

test("only a host-verified revocation can block future world consequences", () => {
  const revocation = { event_id: "e7", event_type: "REVOCATION", revokes: "grant-1" };
  const after = { ...observed, event_id: "e8", parents: ["e7"] };
  const revoked = projectWorld([revocation, after], undefined, trusted);
  assert.equal(revoked.xp, 0);
  assert.equal(revoked.world.forgeOpen, undefined);
  assert.deepEqual(revoked.revoked, ["grant-1"]);

  const untrusted = projectWorld([revocation, after], undefined, {
    ...trusted, verifyAdjudication: () => false
  });
  assert.equal(untrusted.xp, 25);
  assert.deepEqual(untrusted.revoked, []);
  assert.equal(untrusted.history.length, 2);
});

test("a host-verified rejection changes status while remaining in history", () => {
  const rejected = {
    event_id: "e13", event_type: "EXECUTION_ADJUDICATION",
    subject: "forge-gate", admission: "REJECTED"
  };
  const s = projectWorld([rejected], undefined, trusted);
  assert.equal(s.quests["forge-gate"].status, "REJECTED");
  assert.equal(s.history[0].event_id, "e13");
});

test("projection can be rebuilt deterministically from retained event history", () => {
  const original = projectWorld([claim, observed], undefined, trusted);
  const rebuilt = projectWorld(original.history, undefined, trusted);
  assert.deepEqual(rebuilt, original);
});

test("an observation without authorization cannot award progress", () => {
  const unapproved = { ...observed, event_id: "e9", authority: "UNAUTHORIZED" };
  const s = projectWorld([unapproved], undefined, trusted);
  assert.equal(s.xp, 0);
  assert.equal(s.world.forgeOpen, undefined);
});

test("authorization without observation cannot award progress", () => {
  const unobserved = { ...observed, event_id: "e10", evidence: "PROPOSED" };
  const s = projectWorld([unobserved], undefined, trusted);
  assert.equal(s.xp, 0);
  assert.equal(s.world.forgeOpen, undefined);
});

test("MMORPG realm derives avatar and quests from verified canonical projection", () => {
  const realm = projectRealm(projectWorld([claim, observed], undefined, trusted));
  assert.equal(realm.avatar.xp, 25);
  assert.equal(realm.avatar.inventory.verified_shard, 1);
  assert.equal(realm.quests["forge-gate"].status, "COMPLETED");
  assert.deepEqual(realm.history, ["e1", "e2"]);
  assert.equal(realm.locations.forge, "Forge");
  assert.equal(realm.locations.guild_hall, "Guild Hall");
});

test("an unverified observation cannot mint canonical progress", () => {
  const unverified = { ...observed, event_id: "e11" };
  delete unverified.observation_verification;
  const s = projectWorld([unverified], undefined, trusted);
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

test("an explicitly rejected observation cannot mint progress despite a valid receipt", () => {
  const rejected = { ...observed, event_id: "e12", observation_verification: "REJECTED" };
  const s = projectWorld([rejected], undefined, trusted);
  assert.equal(s.xp, 0);
  assert.equal(s.quests["forge-gate"], undefined);
  assert.equal(s.world.forgeOpen, undefined);
});

test("public trust helpers reject accessor-bearing events without invoking getters", () => {
  let getterCalls = 0;
  let verifierCalls = 0;
  const verifier = () => { verifierCalls += 1; return true; };

  const authorization = { quest_id: "q", grant_id: "g", actor: "founder" };
  Object.defineProperty(authorization, "type", {
    enumerable: true,
    get() { getterCalls += 1; return "QUEST_AUTHORIZED"; }
  });
  assert.equal(isVerifiedAuthorization(authorization, verifier), false);

  const observation = { ...observed, event_id: "getter-observation" };
  Object.defineProperty(observation, "admission", {
    enumerable: true, configurable: true,
    get() { getterCalls += 1; return "ACCEPTED"; }
  });
  assert.equal(hasVerifiedObservation(observation, resolveArtifact, verifier), false);

  const adjudication = { event_id: "getter-adjudication", revokes: "g" };
  Object.defineProperty(adjudication, "event_type", {
    enumerable: true,
    get() { getterCalls += 1; return "REVOCATION"; }
  });
  assert.equal(isVerifiedAdjudication(adjudication, verifier), false);
  assert.equal(getterCalls, 0);
  assert.equal(verifierCalls, 0);
});


test("deeply nested event payloads fail closed before recursive validation exhausts the stack", () => {
  for (const [label, wrap] of [
    ["object", value => ({ child: value })],
    ["array", value => [value]]
  ]) {
    let nested = "leaf";
    for (let depth = 0; depth < 160; depth += 1) nested = wrap(nested);
    const event = {
      event_id: "deep-" + label,
      event_type: "CLAIM",
      subject: "deep-payload",
      world_effect: nested
    };
    assert.throws(() => projectWorld([event], undefined, trusted), /maximum nesting depth/);
  }
});
