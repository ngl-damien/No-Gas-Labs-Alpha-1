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
  versions: [{ id: "creation-1", title: "A retained claim", version: 1 }],
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
  });
  assert.equal(review.authority, "NONE");
  assert.equal(review.providerCall, "NOT_MADE");
  assert.equal(review.verdict, "NOT_ISSUED");
  assert.equal(review.prompts.length, 4);
  assert.deepEqual(creation, before);
});

test("structured challenge report is deterministic and explicitly not an adjudication", () => {
  const before = structuredClone(creation);
  const first = formatContradictionReport(creation, 1, answers);
  const second = formatContradictionReport(creation, 1, answers);
  assert.equal(first, second);
  assert.match(first, /Target: A retained claim \[creation-1\] v1/);
  assert.match(first, /Claim under test: The receipt proves the claim is true\./);
  assert.match(first, /Source \/ direct observation:/);
  assert.match(first, /Possible falsifier \/ counterexample:/);
  assert.match(first, /Unknown \/ next test:/);
  assert.match(first, /REPORT ONLY — NOT A VERDICT/);
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

test("missing or ambiguous retained versions fail closed", () => {
  assert.throws(() => prepareContradictionReview(creation, 3), /not uniquely retained/);
  assert.throws(() => prepareContradictionReview(creation, 0), /positive retained version/);
  assert.throws(() => prepareContradictionReview({
    ...creation,
    versions: [...creation.versions, { version: 1 }],
  }, 1), /not uniquely retained/);
});

test("oversized structured report is rejected before it can be submitted", () => {
  const longAnswers = Object.fromEntries(
    Object.keys(answers).map(key => [key, "x".repeat(140)]),
  );
  const longCreation = { ...creation, title: "T".repeat(80) };
  assert.throws(
    () => formatContradictionReport(longCreation, 1, longAnswers),
    /report limit/,
  );
});
