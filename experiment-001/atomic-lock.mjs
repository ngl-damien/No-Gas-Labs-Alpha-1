import { randomUUID } from 'node:crypto';
import { link, lstat, open, unlink } from 'node:fs/promises';

/**
 * Publish a complete private lock record without exposing a partially written
 * canonical pathname. Hard-link publication is deliberately fail-closed on
 * filesystems that do not support it; no direct-write fallback is attempted.
 *
 * The caller owns the returned inode and must release it using its existing
 * identity check. The release check remains best-effort, not atomic
 * compare-and-unlink.
 */
export async function publishAtomicLock(lockPath, contents) {
  if (typeof lockPath !== 'string' || !lockPath || typeof contents !== 'string' || !contents) {
    throw new TypeError('LOCK_PATH_AND_CONTENTS_REQUIRED');
  }

  const temporaryPath = `${lockPath}.tmp-${randomUUID()}`;
  let handle;
  let published = false;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    const staged = await handle.stat();
    await handle.close();
    handle = null;

    try {
      await link(temporaryPath, lockPath);
    } catch (error) {
      if (error.code === 'EEXIST') {
        const locked = new Error('LEDGER_LOCKED');
        locked.code = 'LEDGER_LOCKED';
        throw locked;
      }
      throw error;
    }
    published = true;

    const current = await lstat(lockPath);
    if (current.isSymbolicLink() || !current.isFile() ||
        current.dev !== staged.dev || current.ino !== staged.ino) {
      throw new Error('LEDGER_LOCK_OWNERSHIP_LOST');
    }

    let leftover = null;
    try { await unlink(temporaryPath); }
    catch (error) { if (error.code !== 'ENOENT') leftover = temporaryPath; }
    return { identity: { dev: staged.dev, ino: staged.ino }, temporaryPath: leftover };
  } catch (error) {
    if (!published) {
      await unlink(temporaryPath).catch(() => {});
    } else {
      // If post-publication identity verification failed, remove only our
      // private temporary name. Never unlink the canonical path on uncertainty.
      await unlink(temporaryPath).catch(() => {});
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}
