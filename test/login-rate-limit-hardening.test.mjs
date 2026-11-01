import test from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createLoginRateLimiter } from '../game/login-rate-limit.mjs';
import { runPreflight } from '../scripts/validate-agent-governance.mjs';

const isLimited = error => error?.code === 'LOGIN_RATE_LIMITED' &&
  error.status === 429 && Number.isSafeInteger(error.retryAfterSeconds) &&
  error.retryAfterSeconds >= 1;

test('IPv4 and IPv4-mapped IPv6 forms share one failure bucket', () => {
  const limiter = createLoginRateLimiter({ maxFailures: 2, windowMs: 1_000, lockoutMs: 1_000 });
  limiter.assertAllowed('192.0.2.44', 0);
  limiter.failure('192.0.2.44', 0);
  limiter.assertAllowed('::FFFF:192.0.2.44', 1);
  limiter.failure('::FFFF:192.0.2.44', 1);

  assert.throws(() => limiter.assertAllowed('192.0.2.44', 2), isLimited);
  assert.throws(() => limiter.assertAllowed('::ffff:192.0.2.44', 2), isLimited);
});

test('capacity pressure never evicts existing lockouts to admit new peer addresses', () => {
  const limiter = createLoginRateLimiter({ maxFailures: 1, windowMs: 10_000, lockoutMs: 10_000 });
  const peers = Array.from({ length: 1024 }, (_, index) =>
    `198.51.${Math.floor(index / 256)}.${index % 256}`);

  for (const peer of peers) {
    limiter.assertAllowed(peer, 0);
    limiter.failure(peer, 0);
  }

  assert.throws(() => limiter.assertAllowed(peers[0], 1), isLimited,
    'the first peer must retain its lockout after the table fills');
  assert.throws(() => limiter.assertAllowed('203.0.113.250', 1), error =>
    isLimited(error) && error.retryAfterSeconds === 10,
    'an untracked peer must fail closed with a bounded retry delay at capacity');
  assert.throws(() => limiter.failure('203.0.113.250', 1), isLimited,
    'direct failure recording must not bypass the capacity guard');
  assert.throws(() => limiter.assertAllowed(peers[0], 1), isLimited,
    'probing with new addresses must not evict an existing lockout');

  assert.doesNotThrow(() => limiter.assertAllowed('203.0.113.250', 10_001),
    'expired buckets should be pruned so the limiter can recover');
});

test('login lockout uses monotonic time despite wall-clock adjustments', () => {
  const originalNow = Date.now;
  const limiter = createLoginRateLimiter({ maxFailures: 1, windowMs: 1_000, lockoutMs: 1_000 });
  try {
    Date.now = () => 1_000;
    limiter.failure('192.0.2.77');
    Date.now = () => 1_000_000_000;
    assert.throws(() => limiter.assertAllowed('192.0.2.77'), isLimited,
      'a wall-clock jump must not erase a live lockout');
  } finally {
    Date.now = originalNow;
  }
});


test('invalid or regressing monotonic timestamps fail closed without clearing lockouts', () => {
  const limiter = createLoginRateLimiter({ maxFailures: 1, windowMs: 1_000, lockoutMs: 1_000 });
  const peer = '198.51.100.91';
  limiter.failure(peer, 10);

  for (const invalid of [NaN, Infinity, -1, '11', 9]) {
    assert.throws(
      () => limiter.assertAllowed(peer, invalid),
      error => error?.code === 'INVALID_LOGIN_RATE_LIMIT_TIME'
    );
    assert.throws(
      () => limiter.failure(peer, invalid),
      error => error?.code === 'INVALID_LOGIN_RATE_LIMIT_TIME'
    );
  }

  assert.throws(() => limiter.assertAllowed(peer, 11), isLimited,
    'invalid clock inputs must not prune or clear the existing failure bucket');
});

test('failure recording enforces the per-address bound without a prior assertAllowed call', () => {
  const limiter = createLoginRateLimiter({ maxFailures: 2, windowMs: 1_000, lockoutMs: 1_000 });
  const peer = '198.51.100.92';
  limiter.failure(peer, 0);
  limiter.failure(peer, 1);

  assert.throws(() => limiter.failure(peer, 2), isLimited,
    'a direct third failure must be rejected rather than appended to an unbounded array');
  assert.throws(() => limiter.failure(peer, 3), isLimited,
    'repeated direct failure calls must not grow the bucket while it is locked');
  assert.throws(() => limiter.assertAllowed(peer, 4), isLimited);
  assert.doesNotThrow(() => limiter.assertAllowed(peer, 1_001),
    'the bucket should recover after both the window and lockout expire');
});

test('changed limiter source and tests pass scoped preflight with a unique receipt', async () => {
  const receiptPath = '.runtime/agent-runs/login-rate-limit-' + randomUUID() + '.json';
  const result = await runPreflight({
    paths: ['game/login-rate-limit.mjs', 'test/login-rate-limit-hardening.test.mjs'],
    checkpoint: 'docs/operations/REPOSITORY_STUTTER_STEP_RUN_2026-11-01.md',
    receiptPath
  });
  assert.equal(result.status, 'ready', JSON.stringify(result.failures));
  assert.ok(result.files.some(file => file.path === 'game/login-rate-limit.mjs'));
  assert.ok(result.files.some(file => file.path === 'test/login-rate-limit-hardening.test.mjs'));
  assert.ok(result.files.some(file => file.path === 'docs/operations/REPOSITORY_STUTTER_STEP_RUN_2026-11-01.md'));
});
