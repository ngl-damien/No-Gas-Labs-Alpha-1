import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  formatContradictionReport,
  prepareContradictionReview
} from '../game/contradiction-clerk.mjs';

const publishedAt = '2026-11-04T12:00:00.000Z';

function retainedVersion({
  id = 'creation-1',
  title = 'Source Observatory',
  version = 1,
  html = '<main>Research record</main>',
  at = publishedAt,
  receiptSize
} = {}) {
  const size = new TextEncoder().encode(html).byteLength;
  return {
    id,
    title,
    version,
    html,
    publishedAt: at,
    receipt: {
      algorithm: 'sha256',
      digest: createHash('sha256').update(html, 'utf8').digest('hex'),
      size: receiptSize ?? size
    }
  };
}

function currentCreation(options = {}) {
  const { versions = [], ...versionOptions } = options;
  return { ...retainedVersion(versionOptions), versions };
}

function challengeAnswers(overrides = {}) {
  return {
    claim: 'The receipt proves the claim is true.',
    source: 'An inspectable source page and retained artifact.',
    falsifier: 'A reproducible counterexample or contradictory source.',
    unknown: 'Whether the source supports the exact wording.',
    ...overrides
  };
}

test('the Clerk binds a challenge to a strictly published current version without authority', () => {
  const creation = currentCreation();
  const review = prepareContradictionReview(creation, 1);

  assert.equal(review.schema, 'ngl.contradiction-review.v1');
  assert.equal(review.clerk.id, 'contradiction-clerk');
  assert.equal(review.clerk.role, 'bounded-adversary');
  assert.equal(review.target.creationId, creation.id);
  assert.equal(review.target.version, creation.version);
  assert.equal(review.target.publishedAt, creation.publishedAt);
  assert.deepEqual(review.target.receipt, creation.receipt);
  assert.equal(review.authority, 'NONE');
  assert.equal(review.providerCall, 'NOT_MADE');
  assert.equal(review.verdict, 'NOT_ISSUED');
  assert.deepEqual(review.prompts.map(prompt => prompt.id), [
    'claim', 'source', 'falsifier', 'unknown'
  ]);
  assert.ok(Object.isFrozen(review));
  assert.ok(Object.isFrozen(review.target));
  assert.ok(Object.isFrozen(review.target.receipt));
  assert.ok(Object.isFrozen(review.prompts));
  assert.ok(review.prompts.every(Object.isFrozen));
});

test('the Clerk selects an exact retained historical version rather than the current version', () => {
  const previous = retainedVersion({
    id: 'creation-1',
    title: 'Original research note',
    version: 1,
    html: '<p>original bytes</p>',
    at: '2026-11-03T10:00:00.000Z'
  });
  const current = retainedVersion({
    id: 'creation-1',
    title: 'Revised research note',
    version: 2,
    html: '<p>revised bytes</p>',
    at: '2026-11-04T10:00:00.000Z'
  });
  const creation = { ...current, versions: [previous] };

  const review = prepareContradictionReview(creation, 1);
  assert.equal(review.target.title, previous.title);
  assert.equal(review.target.version, 1);
  assert.equal(review.target.publishedAt, previous.publishedAt);
  assert.equal(review.target.receipt.digest, previous.receipt.digest);
});

test('the Clerk rejects non-ISO publication dates instead of treating drafts as published targets', () => {
  const creation = currentCreation({ at: '2026-11-04' });
  assert.throws(
    () => prepareContradictionReview(creation, 1),
    /strictly timestamped publication/
  );
});

test('the Clerk requires retained HTML bytes and a matching UTF-8 byte count', () => {
  const missingHtml = currentCreation();
  delete missingHtml.html;
  assert.throws(
    () => prepareContradictionReview(missingHtml, 1),
    /no retained HTML bytes/
  );

  const html = '<p>🧪</p>';
  const actualBytes = new TextEncoder().encode(html).byteLength;
  const mismatched = currentCreation({ html, receiptSize: actualBytes - 1 });
  assert.throws(
    () => prepareContradictionReview(mismatched, 1),
    /receipt size does not match retained HTML bytes/
  );
});

test('the Clerk rejects malformed receipts and version histories', () => {
  const badReceipt = currentCreation();
  badReceipt.receipt.algorithm = 'md5';
  assert.throws(
    () => prepareContradictionReview(badReceipt, 1),
    /valid SHA-256 byte receipt/
  );

  const previous = retainedVersion({ id: 'different-creation', version: 1 });
  const current = retainedVersion({ id: 'creation-1', version: 2 });
  const malformedHistory = { ...current, versions: [previous] };
  assert.throws(
    () => prepareContradictionReview(malformedHistory, 2),
    /not uniquely retained/
  );
});

test('the Clerk does not execute accessor-backed retained metadata', () => {
  const creation = currentCreation();
  let getterCalls = 0;
  Object.defineProperty(creation, 'id', {
    configurable: true,
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'creation-1';
    }
  });

  assert.throws(
    () => prepareContradictionReview(creation, 1),
    /creation ID must be text/
  );
  assert.equal(getterCalls, 0);
});

test('maximum valid challenge answers always fit the server report limit', () => {
  const html = 'x'.repeat(1_002_151);
  const creation = currentCreation({
    id: 'i'.repeat(80),
    title: 'T'.repeat(80),
    html
  });
  const report = formatContradictionReport(creation, 1, challengeAnswers({
    claim: 'c'.repeat(140),
    source: 's'.repeat(140),
    falsifier: 'f'.repeat(140),
    unknown: 'u'.repeat(140)
  }));

  assert.ok(Array.from(report).length <= 1000);
  assert.ok(report.includes('Target: ' + 'T'.repeat(59) + '… [' + creation.id + '] v1'));
  assert.ok(report.includes('SHA-256 ' + creation.receipt.digest + ' · 1002151B'));
  assert.ok(report.includes('REPORT ONLY — NOT A VERDICT.'));
  assert.ok(report.includes('no AI/provider call or independent observation occurred'));
  assert.ok(report.includes('Claim: ' + 'c'.repeat(140)));
  assert.ok(report.includes('Unknown: ' + 'u'.repeat(140)));
});

test('the Clerk normalizes whitespace and control characters in each submitted field', () => {
  const report = formatContradictionReport(currentCreation(), 1, challengeAnswers({
    claim: '  claim\nunder test  ',
    source: 'source\u0000 page'
  }));
  assert.ok(report.includes('Claim: claim under test'));
  assert.ok(report.includes('Source: source page'));
});

test('the Clerk rejects missing, extra, inherited and accessor-backed answers', () => {
  const creation = currentCreation();
  assert.throws(
    () => formatContradictionReport(creation, 1, {
      claim: 'claim',
      source: 'source',
      falsifier: 'falsifier'
    }),
    /exactly the required fields/
  );
  assert.throws(
    () => formatContradictionReport(creation, 1, {
      ...challengeAnswers(),
      extra: 'not allowed'
    }),
    /exactly the required fields/
  );

  const inherited = Object.assign(Object.create({ inherited: true }), challengeAnswers());
  assert.throws(
    () => formatContradictionReport(creation, 1, inherited),
    /plain object/
  );

  let getterCalls = 0;
  const accessorAnswers = {
    source: 'source',
    falsifier: 'falsifier',
    unknown: 'unknown'
  };
  Object.defineProperty(accessorAnswers, 'claim', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'claim';
    }
  });
  assert.throws(
    () => formatContradictionReport(creation, 1, accessorAnswers),
    /own data fields/
  );
  assert.equal(getterCalls, 0);
});
