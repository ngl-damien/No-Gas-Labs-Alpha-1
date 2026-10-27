import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginRateLimiter } from '../game/login-rate-limit.mjs';

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
