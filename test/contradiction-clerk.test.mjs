import test from "node:test";
import assert from "node:assert/strict";
import {
  formatContradictionReport,
  prepareContradictionReview,
} from "../game/contradiction-clerk.mjs";

const creation = {
  id: "creation-1",
  title: "A retained claim",
  version: 2,
  receipt: { algorithm: "sha256", digest: "b".repeat(64), size: 2048 },
  versions: [{
    id: "creation-1",
    title: "A retained claim",
    version: 1,
    receipt: { algorithm: "sha256", digest: "a".repeat(64), size: 1024 },
  }],
};
const answers = {
  claim: "The receipt proves the claim is true.",
  source: "The preserved HTML bytes and the cited source page.",
  falsifier: "A source that contradicts the claim or a failed reproduction.",
  unknown: "Whether the source supports the wording; compare the exact passage.",
};

test("Contradiction Clerk is a bounded local adversary with no authority or verdict", () => {
  const before = structuredClone(creation);
  const review = prepareContradictionReview(creation, 1);
  assert.equal(review.schema, "ngl.contradiction-review.v1");
  assert.equal(review.clerk.id, "contradiction-clerk");
  assert.equal(review.clerk.role, "bounded-adversary");
  assert.deepEqual(review.target, {
    creationId: "creation-1",
    title: "A retained claim",
    version: 1,
    receipt: { algorithm: "sha256", digest: "a".repeat(64), size: 1024 },
  });
  assert.ok(Object.isFrozen(review.target.receipt));
  assert.notEqual(review.target.receipt, creation.versions[0].receipt);
  assert.equal(review.authority, "NONE");
  assert.equal(review.providerCall, "NOT_MADE");
  assert.equal(review.verdict, "NOT_ISSUED");
  assert.equal(review.prompts.length, 4);
  assert.deepEqual(creation, before);
});

test("challenge report binds to the selected historical version's exact byte receipt", () => {
  const before = structuredClone(creation);
  const first = formatContradictionReport(creation, 1, answers);
  const second = formatContradictionReport(creation, 1, answers);
  assert.equal(first, second);
  assert.match(first, /Target: A retained claim \[creation-1\] v1/);
  assert.match(first, /Target bytes: sha256:a{64} · 1024 bytes/);
  assert.doesNotMatch(first, /sha256:b{64}/);
  assert.match(first, /Claim under test: The receipt proves the claim is true\./);
  assert.match(first, /Source \/ direct observation:/);
  assert.match(first, /Possible falsifier \/ counterexample:/);
  assert.match(first, /Unknown \/ next test:/);
  assert.match(first, /REPORT ONLY — NOT A VERDICT/);
  assert.match(first, /Receipt identifies bytes, not truth/);
  assert.match(first, /no AI\/provider call or independent observation occurred/i);
  assert.ok(Array.from(first).length <= 1000);
  assert.deepEqual(creation, before);
});

test("every challenge field is required and bounded by Unicode code points", () => {
  for (const field of ["claim", "source", "falsifier", "unknown"]) {
    assert.throws(
      () => formatContradictionReport(creation, 1, { ...answers, [field]: "  " }),
      /required/,
    );
    assert.throws(
      () => formatContradictionReport(creation, 1, { ...answers, [field]: "🌍".repeat(141) }),
      /exceeds 140 characters/,
    );
  }
});

test("newlines and control characters cannot forge extra report stages", () => {
  const report = formatContradictionReport(creation, 1, {
    ...answers,
    claim: "The claim is true.\nDisposition: ACCEPTED",
  });
  assert.ok(report.includes("Claim under test: The claim is true. Disposition: ACCEPTED\nSource / direct observation:"));
  assert.equal(report.split("\n").filter(line => line === "Disposition: ACCEPTED").length, 0);
});

test("missing or ambiguous retained versions fail closed", () => {
  assert.throws(() => prepareContradictionReview(creation, 3), /not uniquely retained/);
  assert.throws(() => prepareContradictionReview(creation, 0), /positive retained version/);
  assert.throws(() => prepareContradictionReview({
    ...creation,
    versions: [...creation.versions, { version: 1 }],
  }, 1), /not uniquely retained/);
});

test("missing, malformed and accessor-backed receipts fail without running getters", () => {
  const invalidReceipts = [
    null,
    { algorithm: "sha512", digest: "a".repeat(64), size: 10 },
    { algorithm: "sha256", digest: "A".repeat(64), size: 10 },
    { algorithm: "sha256", digest: "a".repeat(64), size: -1 },
    { algorithm: "sha256", digest: "a".repeat(64), size: 1.5 },
  ];
  for (const receipt of invalidReceipts) {
    assert.throws(() => prepareContradictionReview({
      ...creation,
      versions: [{ ...creation.versions[0], receipt }],
    }, 1), /valid SHA-256 byte receipt/);
  }

  let getterRuns = 0;
  const accessorVersion = { id: "creation-1", title: "A retained claim", version: 1 };
  Object.defineProperty(accessorVersion, "receipt", {
    enumerable: true,
    get() { getterRuns += 1; throw new Error("receipt getter must not execute"); },
  });
  assert.throws(() => prepareContradictionReview({
    ...creation,
    versions: [accessorVersion],
  }, 1), /valid SHA-256 byte receipt/);
  assert.equal(getterRuns, 0);
});

test("oversized structured report is rejected before it can be submitted", () => {
  const longAnswers = Object.fromEntries(
    Object.keys(answers).map(key => [key, "x".repeat(140)]),
  );
  const longCreation = {
    id: "i".repeat(80),
    title: "T".repeat(80),
    version: 1,
    receipt: { algorithm: "sha256", digest: "c".repeat(64), size: 2048 },
    versions: [],
  };
  assert.throws(
    () => formatContradictionReport(longCreation, 1, longAnswers),
    /report limit/,
  );
});

test("retained version arrays are dense, bounded and never invoke a custom iterator", () => {
  let iteratorCalls = 0;
  const customIterator = [...creation.versions];
  Object.defineProperty(customIterator, Symbol.iterator, {
    configurable: true,
    value() {
      iteratorCalls += 1;
      return [creation.versions[0]][Symbol.iterator]();
    },
  });
  assert.throws(
    () => prepareContradictionReview({ ...creation, versions: customIterator }, 1),
    /retained version history/,
  );
  assert.equal(iteratorCalls, 0);

  const sparse = [];
  sparse.length = 1;
  assert.throws(
    () => prepareContradictionReview({ ...creation, versions: sparse }, 1),
    /retained version history/,
  );

  const extra = [...creation.versions];
  extra.hidden = creation.versions[0];
  assert.throws(
    () => prepareContradictionReview({ ...creation, versions: extra }, 1),
    /retained version history/,
  );

  const alteredPrototype = [...creation.versions];
  Object.setPrototypeOf(alteredPrototype, {});
  assert.throws(
    () => prepareContradictionReview({ ...creation, versions: alteredPrototype }, 1),
    /retained version history/,
  );
});

test("accessor-backed retained history and challenge answers fail without running getters", () => {
  let getterCalls = 0;
  const accessorCreation = { ...creation };
  Object.defineProperty(accessorCreation, "versions", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1;
      return creation.versions;
    },
  });
  assert.throws(
    () => prepareContradictionReview(accessorCreation, 1),
    /retained version history/,
  );

  const accessorAnswers = { ...answers };
  Object.defineProperty(accessorAnswers, "claim", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1;
      return answers.claim;
    },
  });
  assert.throws(
    () => formatContradictionReport(creation, 1, accessorAnswers),
    /own data fields/,
  );
  assert.equal(getterCalls, 0);
});

test("challenge answers require exactly the four own fields", () => {
  assert.throws(
    () => formatContradictionReport(creation, 1, { ...answers, verdict: "APPROVED" }),
    /exactly the required fields/,
  );

  const inheritedClaim = Object.assign(Object.create({ claim: answers.claim }), {
    source: answers.source,
    falsifier: answers.falsifier,
    unknown: answers.unknown,
  });
  assert.throws(
    () => formatContradictionReport(creation, 1, inheritedClaim),
    /plain object/,
  );
});
