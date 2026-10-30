/**
 * Cross-tab coordination for shared-world writes.
 *
 * Use ifAvailable rather than queueing: a queued identical action could acquire
 * a fresh request ID after the first action completes. A busy tab must retry
 * after the active receipt is resolved; it must not overwrite that receipt.
 */
export const SHARED_ACTION_LOCK_NAME = 'ngl.common-ground.shared-action.v1';

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function withSharedActionLock(lockManager, operation) {
  if (!lockManager || typeof lockManager.request !== 'function') {
    throw failure(
      'SHARED_ACTION_LOCK_UNAVAILABLE',
      'This browser cannot safely coordinate shared writes across tabs. Shared writes are paused; the saved retry receipt, if any, remains untouched.'
    );
  }
  if (typeof operation !== 'function') throw new TypeError('A lock-protected operation is required.');
  return lockManager.request(
    SHARED_ACTION_LOCK_NAME,
    { mode: 'exclusive', ifAvailable: true },
    async lock => {
      if (!lock) {
        throw failure(
          'SHARED_ACTION_BUSY',
          'Another tab is handling a shared action. Wait for it to finish before trying again. No new action was sent.'
        );
      }
      return operation();
    }
  );
}

function stableActionJSON(value) {
  if (Array.isArray(value)) return value.map(stableActionJSON);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter(key => value[key] !== undefined)
        .sort()
        .map(key => [key, stableActionJSON(value[key])])
    );
  }
  return value;
}

/**
 * Reserve the one device-local recovery receipt and submit while holding the
 * origin-wide lock. A failed/uncertain response leaves the original receipt
 * in place, so another tab cannot replace it with a different action.
 */
export async function runSerializedSharedAction({
  lockManager,
  action,
  actor,
  readPending,
  savePending,
  submit,
  createRequestId
}) {
  if (!actor || typeof actor.id !== 'string' || !actor.id ||
      !['founder', 'witness'].includes(actor.role)) {
    throw new Error('A valid shared-world actor is required.');
  }
  if (typeof readPending !== 'function' || typeof savePending !== 'function' ||
      typeof submit !== 'function' || typeof createRequestId !== 'function') {
    throw new TypeError('Shared-action recovery requires read, save, submit and request-ID functions.');
  }
  const normalized = JSON.parse(JSON.stringify(action));
  return withSharedActionLock(lockManager, async () => {
    const pending = readPending();
    if (pending) {
      if (pending.actorId !== actor.id || pending.actorRole !== actor.role) {
        throw new Error('A previous shared action has an uncertain outcome under a different session. Re-authenticate as the original actor and resolve it from the Field Journal before starting another shared action.');
      }
      if (JSON.stringify(stableActionJSON(pending.action)) !==
          JSON.stringify(stableActionJSON(normalized))) {
        throw new Error('A previous shared action has an uncertain outcome. Open the Field Journal and retry that exact action before starting another shared action.');
      }
      return submit(pending);
    }
    const receipt = {
      requestId: createRequestId(),
      actorId: actor.id,
      actorRole: actor.role,
      action: normalized
    };
    savePending(receipt);
    return submit(receipt);
  });
}
