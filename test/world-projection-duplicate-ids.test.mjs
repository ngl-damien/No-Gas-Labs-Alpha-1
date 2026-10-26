import test from "node:test";
import assert from "node:assert/strict";
import { projectWorld } from "../src/world/project.js";

const claim = Object.freeze({
  event_id: "claim-immutable-1",
  event_type: "CLAIM",
  subject: "forge-gate"
});

test("identical event replay remains idempotent", () => {
  const state = projectWorld([claim, { subject: "forge-gate", event_type: "CLAIM", event_id: "claim-immutable-1" }]);
  assert.equal(state.history.length, 1);
  assert.equal(state.quests["forge-gate"].status, "PROPOSED");
});

test("reusing an event ID with a changed payload fails closed in one batch", () => {
  const conflicting = { ...claim, subject: "different-quest" };
  assert.throws(
    () => projectWorld([claim, conflicting]),
    /conflicting duplicate event_id: claim-immutable-1/
  );
});

test("reusing an event ID with a changed payload fails closed across replay batches", () => {
  const first = projectWorld([claim]);
  const conflicting = { ...claim, world_effect: { xp: 999 } };
  assert.throws(
    () => projectWorld([conflicting], first),
    /conflicting duplicate event_id: claim-immutable-1/
  );
});

test("a seen event ID without a retained payload cannot silently suppress new content", () => {
  const seed = { ...projectWorld([claim]), history: [], seen: ["claim-immutable-1"] };
  assert.throws(
    () => projectWorld([{ ...claim, subject: "other" }], seed),
    /duplicate event_id has no retained payload: claim-immutable-1/
  );
});

test("retained history cannot contain conflicting or duplicate event IDs", () => {
  const seed = {
    ...projectWorld([claim]),
    history: [claim, { ...claim, subject: "conflict" }]
  };
  assert.throws(
    () => projectWorld([], seed),
    /duplicate event_id in retained history: claim-immutable-1/
  );
});


test("new event payloads reject hidden own properties before history snapshotting", () => {
  const effect = { xp: 1 };
  Object.defineProperty(effect, "hidden", { value: 2, enumerable: false });
  assert.throws(
    () => projectWorld([{ ...claim, event_id: "hidden-payload", world_effect: effect }]),
    /non-JSON object in event payload/
  );
});

test("new event payloads reject sparse arrays with inherited indices", () => {
  const sparse = new Array(1);
  Object.setPrototypeOf(sparse, ["shadow"]);
  assert.throws(
    () => projectWorld([{ ...claim, event_id: "sparse-payload", world_effect: { items: sparse } }]),
    /non-JSON array in event payload/
  );
});

test("event payload validation rejects accessors without invoking them", () => {
  let getterCalls = 0;
  const nested = {};
  Object.defineProperty(nested, "value", {
    enumerable: true,
    get() {
      getterCalls++;
      return "surprise";
    }
  });
  assert.throws(
    () => projectWorld([{ ...claim, event_id: "accessor-payload", world_effect: { nested } }]),
    /non-JSON object field in event payload/
  );
  assert.equal(getterCalls, 0);
});