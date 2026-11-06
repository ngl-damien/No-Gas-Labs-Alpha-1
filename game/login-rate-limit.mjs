import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';

const DEFAULT_LOGIN_RATE_LIMIT = Object.freeze({ maxFailures: 5, windowMs: 60_000, lockoutMs: 60_000 });
const MAX_TRACKED_LOGIN_ADDRESSES = 1024;

// This limiter is a bounded, process-local defense against repeated credential guessing.
// It deliberately keys on the socket peer rather than caller-controlled forwarding headers.
export function createLoginRateLimiter(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['maxFailures', 'windowMs', 'lockoutMs'].includes(key))) {
    throw new Error('INVALID_LOGIN_RATE_LIMIT_CONFIG');
  }
  const config = { ...DEFAULT_LOGIN_RATE_LIMIT, ...options };
  if (!Number.isSafeInteger(config.maxFailures) || config.maxFailures < 1 || config.maxFailures > 100 ||
      !Number.isSafeInteger(config.windowMs) || config.windowMs < 10 || config.windowMs > 3_600_000 ||
      !Number.isSafeInteger(config.lockoutMs) || config.lockoutMs < 10 || config.lockoutMs > 3_600_000) {
    throw new Error('INVALID_LOGIN_RATE_LIMIT_CONFIG');
  }

  const attempts = new Map();
  let lastNow = -Infinity;
  function checkedNow(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value < lastNow) {
      throw Object.assign(new Error('Login rate-limit clock must be finite, non-negative, and monotonic'), {
        code: 'INVALID_LOGIN_RATE_LIMIT_TIME'
      });
    }
    lastNow = value;
    return value;
  }
  const addressKey = address => {
    if (typeof address !== 'string' || address.length === 0 || address.length > 256) return 'unknown';
    // Node can represent the same IPv4 peer as either 192.0.2.1 or
    // ::ffff:192.0.2.1 on dual-stack listeners. Keep those forms in one bucket.
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
    return mapped && isIP(mapped[1]) === 4 ? mapped[1] : address;
  };

  function prune(now) {
    for (const [address, state] of attempts) {
      state.failures = state.failures.filter(at => now - at < config.windowMs);
      if (state.blockedUntil <= now && state.failures.length === 0) attempts.delete(address);
    }
  }

  function rateLimited(state, now) {
    const oldestFailureExpiresAt = state.failures.length >= config.maxFailures
      ? state.failures[0] + config.windowMs
      : 0;
    const retryUntil = Math.max(state.blockedUntil, oldestFailureExpiresAt);
    const retryAfterSeconds = Math.max(1, Math.ceil((retryUntil - now) / 1000));
    throw Object.assign(new Error('Too many failed Founder login attempts. Retry after the indicated delay.'), {
      code: 'LOGIN_RATE_LIMITED', status: 429, retryAfterSeconds
    });
  }

  function capacityLimited(now) {
    // Do not evict an existing peer's lockout to admit a new address. A flood of
    // unique addresses must not erase earlier lockouts and reopen their buckets.
    // Fail closed until the earliest tracked bucket naturally expires or succeeds.
    let nextAvailableAt = Infinity;
    for (const state of attempts.values()) {
      const latestFailureExpiresAt = state.failures.length
        ? Math.max(...state.failures) + config.windowMs
        : 0;
      nextAvailableAt = Math.min(nextAvailableAt, Math.max(state.blockedUntil, latestFailureExpiresAt));
    }
    if (!Number.isFinite(nextAvailableAt)) nextAvailableAt = now + config.lockoutMs;
    throw Object.assign(new Error('Too many failed Founder login attempts. Retry after the indicated delay.'), {
      code: 'LOGIN_RATE_LIMITED', status: 429,
      retryAfterSeconds: Math.max(1, Math.ceil((nextAvailableAt - now) / 1000))
    });
  }

  return {
    assertAllowed(address, now = performance.now()) {
      const time = checkedNow(now);
      const key = addressKey(address);
      prune(time);
      const state = attempts.get(key);
      if (!state && attempts.size >= MAX_TRACKED_LOGIN_ADDRESSES) capacityLimited(time);
      if (!state) return;
      if (state.blockedUntil > time) rateLimited(state, time);
      if (state.failures.length >= config.maxFailures) {
        state.blockedUntil = Math.max(state.blockedUntil, time + config.lockoutMs, state.failures[0] + config.windowMs);
        rateLimited(state, time);
      }
    },
    failure(address, now = performance.now()) {
      const time = checkedNow(now);
      const key = addressKey(address);
      prune(time);
      let state = attempts.get(key);
      if (!state && attempts.size >= MAX_TRACKED_LOGIN_ADDRESSES) capacityLimited(time);
      if (!state) state = { failures: [], blockedUntil: 0 };
      if (state.blockedUntil > time) rateLimited(state, time);
      if (state.failures.length >= config.maxFailures) {
        state.blockedUntil = Math.max(state.blockedUntil, time + config.lockoutMs, state.failures[0] + config.windowMs);
        rateLimited(state, time);
      }
      state.failures.push(time);
      if (state.failures.length >= config.maxFailures) {
        state.blockedUntil = Math.max(time + config.lockoutMs, state.failures[0] + config.windowMs);
      }
      attempts.delete(key);
      attempts.set(key, state);
      prune(time);
    },
    success(address) {
      attempts.delete(addressKey(address));
    }
  };
}
