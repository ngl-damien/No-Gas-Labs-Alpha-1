import { constants as fsConstants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertNoDuplicateJsonObjectKeys } from '../strict-json.mjs';

const MAX_LOCK_BYTES = 4096;
const KNOWN_LOCK_SCHEMAS = new Set([
  'ngl.service-lock.v1',
  'ngl.ledger-lock.v1',
  'ngl.decisions-lock.v1',
  'ngl.courier-lock.v1'
]);
const WARNING = 'Read-only diagnostic. A PID probe is advisory only: PID reuse, namespaces, permissions, and races can mislead. This report never authorizes lock deletion; stop the owner and use an explicitly offline recovery procedure.';

function report(status, path, details = {}) {
  return { status, path, ...details, safeToRemove: false, warning: WARNING };
}

function fileSummary(stat) {
  return {
    device: stat.dev,
    inode: stat.ino,
    size: stat.size,
    mode: (stat.mode & 0o777).toString(8).padStart(3, '0'),
    uid: stat.uid
  };
}

function sameSnapshot(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.mode === b.mode &&
    a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

function unsafeReason(stat) {
  if (stat.isSymbolicLink()) return 'symlink';
  if (!stat.isFile()) return 'not-a-regular-file';
  if ((stat.mode & 0o077) !== 0) return 'permissions-too-broad';
  let getuid;
  try { getuid = process.getuid; }
  catch { return 'owner-verification-failed'; }
  if (typeof getuid !== 'function') return 'owner-verification-failed';
  let currentUid;
  try { currentUid = getuid.call(process); }
  catch { return 'owner-verification-failed'; }
  if (!Number.isSafeInteger(currentUid) || currentUid < 0) return 'owner-verification-failed';
  if (stat.uid !== currentUid) return 'owner-mismatch';
  if (stat.size > MAX_LOCK_BYTES) return 'size-limit';
  return null;
}

function probePid(pid) {
  try {
    process.kill(pid, 0);
    return 'possibly-alive';
  } catch (error) {
    if (error.code === 'ESRCH') return 'not-found';
    if (error.code === 'EPERM') return 'inaccessible';
    return 'unknown';
  }
}

/**
 * Inspect a transient writer-lock file without modifying it.
 * The result deliberately never authorizes automatic stale-lock recovery.
 */
export async function inspectWriterLock(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new TypeError('A writer-lock file path is required');
  }
  const path = resolve(filePath);
  let before;
  try {
    before = await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return report('missing', path, { reason: 'no-lock-at-inspection-time' });
    throw error;
  }

  const initialUnsafe = unsafeReason(before);
  if (initialUnsafe) return report('unsafe', path, { reason: initialUnsafe, file: fileSummary(before) });

  let handle;
  try {
    try {
      handle = await open(path, fsConstants.O_RDONLY |
        (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0));
    } catch (error) {
      if (error.code === 'ENOENT') return report('changed', path, { reason: 'lock-disappeared-before-open' });
      if (error.code === 'ELOOP') return report('unsafe', path, { reason: 'symlink-at-open' });
      throw error;
    }

    const opened = await handle.stat();
    const openedUnsafe = unsafeReason(opened);
    if (openedUnsafe) return report('unsafe', path, { reason: openedUnsafe, file: fileSummary(opened) });
    if (!sameSnapshot(before, opened)) {
      return report('changed', path, { reason: 'lock-changed-before-read', file: fileSummary(opened) });
    }

    const chunks = [];
    let total = 0;
    let position = 0;
    while (total <= MAX_LOCK_BYTES) {
      const buffer = Buffer.allocUnsafe(Math.min(1024, MAX_LOCK_BYTES + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      total += bytesRead;
      position += bytesRead;
    }
    if (total > MAX_LOCK_BYTES) {
      return report('unsafe', path, { reason: 'size-limit-during-read', file: fileSummary(opened) });
    }

    let after;
    try {
      after = await lstat(path);
    } catch (error) {
      if (error.code === 'ENOENT') return report('changed', path, { reason: 'lock-disappeared-during-read' });
      throw error;
    }
    const afterHandle = await handle.stat();
    const afterUnsafe = unsafeReason(after);
    if (afterUnsafe) return report('unsafe', path, { reason: afterUnsafe, file: fileSummary(after) });
    if (!sameSnapshot(opened, after) || !sameSnapshot(opened, afterHandle)) {
      return report('changed', path, { reason: 'lock-changed-during-read', file: fileSummary(after) });
    }

    const bytes = Buffer.concat(chunks, total);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) {
      return report('malformed', path, { reason: 'invalid-utf8', file: fileSummary(after) });
    }
    const trimmed = text.trim();
    if (!trimmed) return report('malformed', path, { reason: 'empty-lock-file', file: fileSummary(after) });

    if (trimmed.startsWith('{')) {
      let value;
      try {
        assertNoDuplicateJsonObjectKeys(text, { label: 'LOCK' });
        value = JSON.parse(text);
      } catch (error) {
        const reason = error?.message === 'LOCK_DUPLICATE_JSON_KEY'
          ? 'duplicate-json-key'
          : 'invalid-json-lock-metadata';
        return report('malformed', path, { reason, file: fileSummary(after) });
      }
      if (value && typeof value === 'object' && !Array.isArray(value) &&
          Number.isSafeInteger(value.pid) && value.pid > 0 &&
          typeof value.openedAt === 'string' && Number.isFinite(Date.parse(value.openedAt))) {
        if (Object.hasOwn(value, 'schema') &&
            (typeof value.schema !== 'string' || !KNOWN_LOCK_SCHEMAS.has(value.schema))) {
          return report('present', path, {
            format: 'unrecognized-json',
            reason: 'unsupported-lock-schema',
            file: fileSummary(after)
          });
        }
        // The synchronous PID probe can give another process time to replace
        // the lock path. Revalidate both the pathname and the opened inode
        // after probing so the owner receipt describes one stable observation.
        const processProbe = probePid(value.pid);
        let afterProbe;
        try {
          afterProbe = await lstat(path);
        } catch (error) {
          if (error.code === 'ENOENT') {
            return report('changed', path, { reason: 'lock-disappeared-during-owner-probe' });
          }
          throw error;
        }
        const afterProbeHandle = await handle.stat();
        const afterProbeUnsafe = unsafeReason(afterProbe);
        if (afterProbeUnsafe) {
          return report('unsafe', path, { reason: afterProbeUnsafe, file: fileSummary(afterProbe) });
        }
        if (!sameSnapshot(opened, afterProbe) || !sameSnapshot(opened, afterProbeHandle)) {
          return report('changed', path, {
            reason: 'lock-changed-during-owner-probe',
            file: fileSummary(afterProbe)
          });
        }

        const owner = { pid: value.pid, openedAt: value.openedAt, processProbe };
        if (typeof value.schema === 'string') owner.schema = value.schema;
        return report('present', path, { format: 'owner-metadata', owner, file: fileSummary(afterProbe) });
      }
      return report('present', path, {
        format: 'unrecognized-json',
        reason: 'json-does-not-contain-valid-owner-metadata',
        file: fileSummary(after)
      });
    }

    // Older service/decision lock files used opaque random tokens. Never echo them.
    return report('present', path, { format: 'opaque-token', file: fileSummary(after) });
  } finally {
    await handle?.close().catch(() => {});
  }
}
