import test from "node:test";
import assert from "node:assert/strict";
import { hashState } from "../src/world/spine.js";

test("state hashes are independent of ordinary object key insertion order", () => {
  assert.equal(hashState({ a: 1, b: { c: true, d: null } }), hashState({ b: { d: null, c: true }, a: 1 }));
});

test("state hashing rejects values that JSON serialization would collapse or omit", () => {
  assert.throws(() => hashState([undefined]), /JSON-compatible/);
  assert.throws(() => hashState([NaN]), /finite JSON-compatible/);
  assert.throws(() => hashState([Infinity]), /finite JSON-compatible/);
  assert.throws(() => hashState({ omitted: undefined }), /JSON-compatible/);
});

test("state hashing rejects cycles rather than recursing or aliasing them", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => hashState(cyclic), /cyclic values/);
});

test("state hashing rejects sparse, decorated, hidden-property and accessor arrays", () => {
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => hashState(sparse), /sparse or decorated arrays/);

  const decorated = [1];
  decorated.extra = true;
  assert.throws(() => hashState(decorated), /sparse or decorated arrays/);

  const hidden = [1];
  Object.defineProperty(hidden, "hidden", { value: 2 });
  assert.throws(() => hashState(hidden), /sparse or decorated arrays/);

  const accessor = [];
  Object.defineProperty(accessor, "0", { enumerable: true, configurable: true, get() { return 1; } });
  accessor.length = 1;
  assert.throws(() => hashState(accessor), /accessor properties/);
});

test("state hashing safely includes own prototype-sensitive data keys", () => {
  const safe = {};
  Object.defineProperty(safe, "__proto__", {
    value: { retained: true },
    enumerable: true,
    configurable: true,
    writable: true
  });
  assert.notEqual(hashState(safe), hashState({}));
  assert.doesNotThrow(() => hashState(safe));
});

test("state hashing rejects accessors and non-plain objects", () => {
  const accessor = {};
  Object.defineProperty(accessor, "x", { enumerable: true, get() { return 1; } });
  assert.throws(() => hashState(accessor), /accessor properties/);
  assert.throws(() => hashState(new Date()), /plain JSON objects/);
});
