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
  const addressKey = address => typeof address === 'string' && address.length > 0 && address.length <= 256 ? address : 'unknown';

  function prune(now) {
    for (const [address, state] of attempts) {
      state.failures = state.failures.filter(at => now - at < config.windowMs);
      if (state.blockedUntil <= now && state.failures.length === 0) attempts.delete(address);
    }
    while (attempts.size > MAX_TRACKED_LOGIN_ADDRESSES) attempts.delete(attempts.keys().next().value);
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

  return {
    assertAllowed(address, now = Date.now()) {
      const key = addressKey(address);
      prune(now);
      const state = attempts.get(key);
      if (!state) return;
      if (state.blockedUntil > now) rateLimited(state, now);
      if (state.failures.length >= config.maxFailures) {
        state.blockedUntil = Math.max(state.blockedUntil, now + config.lockoutMs, state.failures[0] + config.windowMs);
        rateLimited(state, now);
      }
    },
    failure(address, now = Date.now()) {
      const key = addressKey(address);
      prune(now);
      const state = attempts.get(key) || { failures: [], blockedUntil: 0 };
      state.failures.push(now);
      if (state.failures.length >= config.maxFailures) {
        state.blockedUntil = Math.max(now + config.lockoutMs, state.failures[0] + config.windowMs);
      }
      attempts.delete(key);
      attempts.set(key, state);
      prune(now);
    },
    success(address) {
      attempts.delete(addressKey(address));
    }
  };
}
