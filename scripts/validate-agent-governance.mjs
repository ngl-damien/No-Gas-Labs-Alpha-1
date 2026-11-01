import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { writeFile, mkdir, realpath, stat, lstat, open } from 'node:fs/promises';
import { dirname, basename, resolve, relative, posix, isAbsolute, win32, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const VENDOR_POINTERS = ['CLAUDE.md', 'GEMINI.md', 'CODEX.md', '.github/copilot-instructions.md'];
const ENTRY_MARKERS = ['RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md', 'First repository operation:', 'Second repository operation:', 'Discard any pre-read observations'];
const PROTOCOL_MARKERS = ['Required loop on every run', 'Shared work coordination rules', 'Evidence and state rules', 'Founder authority remains with Damien', 'MMORPG completion gates and delivery priority'];

function insideRoot(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}
function sameFileSnapshot(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.nlink === right.nlink &&
    left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
export const MAX_PREFLIGHT_FILE_BYTES = 16 * 1024 * 1024;
const PREFLIGHT_READ_CHUNK_BYTES = 64 * 1024;

export async function readBoundedHandle(handle, maxBytes = MAX_PREFLIGHT_FILE_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_PREFLIGHT_FILE_BYTES) {
    throw new TypeError('preflight byte limit must be a non-negative safe integer within the configured maximum');
  }
  const chunks = [];
  let total = 0;
  let position = 0;
  while (total <= maxBytes) {
    const remaining = maxBytes + 1 - total;
    const buffer = Buffer.allocUnsafe(Math.min(PREFLIGHT_READ_CHUNK_BYTES, remaining));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    chunks.push(buffer.subarray(0, bytesRead));
    total += bytesRead;
    position += bytesRead;
  }
  if (total > maxBytes) return { tooLarge: true, total };
  return { tooLarge: false, total, bytes: Buffer.concat(chunks, total) };
}

export function reconcileInspectedFileRecord(existing, relativePath, kind, bytes) {
  const candidate = {
    path: relativePath,
    kind,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength
  };
  if (!existing) return { record: candidate, changed: false };
  if (existing.sha256 !== candidate.sha256 || existing.bytes !== candidate.bytes) {
    return { record: existing, changed: true };
  }
  // A file can be both a scoped target and a trusted governance input.
  // Preserve its stronger semantic classification (for example, the
  // canonical checkpoint) rather than letting target enumeration mask it.
  if (kind !== 'target') existing.kind = kind;
  return { record: existing, changed: false };
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\\')) return false;
  const first = value.charCodeAt(0);
  const hasWindowsDrivePrefix = value.length >= 2 &&
    ((first >= 65 && first <= 90) || (first >= 97 && first <= 122)) && value[1] === ':';
  return !posix.isAbsolute(value) && !isAbsolute(value) && !win32.isAbsolute(value) &&
    !hasWindowsDrivePrefix && value.split('/').every(part => part !== '..' && part !== '.' && part !== '');
}
function protocolFromEntry(entry) {
  const match = entry.match(/\(([^)\n]*RALPH[^)\n]*PROTOCOL[^)\n]*)\)/i);
  return match?.[1].replace(/^\.\//, '') ?? null;
}

export async function runPreflight({ root = process.cwd(), entry = 'AGENTS.md', protocol = null, paths = [], checkpoint = null, receiptPath = null } = {}) {
  const rootPath = await realpath(resolve(root));
  const files = [];
  const failures = [];
  const warnings = [];
  const seen = new Map();

  async function inspect(relativePath, kind, required = true) {
    if (!safeRelativePath(relativePath)) {
      failures.push({ path: String(relativePath), reason: 'unsafe or invalid repository-relative path' });
      return null;
    }
    const absolutePath = resolve(rootPath, relativePath);
    if (!insideRoot(rootPath, absolutePath)) {
      failures.push({ path: relativePath, reason: 'path escapes repository root' });
      return null;
    }
    try {
      if (['root-instructions', 'shared-protocol', 'nested-instructions', 'durable-checkpoint'].includes(kind)) {
        const label = kind === 'durable-checkpoint' ? 'durable checkpoint' : 'trusted instruction';
        const segments = relativePath.split('/');
        for (let index = 1; index <= segments.length; index += 1) {
          const component = segments.slice(0, index).join('/');
          const metadata = await lstat(resolve(rootPath, component));
          if (metadata.isSymbolicLink()) {
            failures.push({ path: component, reason: label + ' path must not traverse a symlink' });
            return null;
          }
          const expectedType = index === segments.length ? metadata.isFile() : metadata.isDirectory();
          if (!expectedType) {
            failures.push({
              path: component,
              reason: index === segments.length
                ? label + ' must be a regular file'
                : 'trusted governance parent must be a directory'
            });
            return null;
          }
        }
      }
      const actualPath = await realpath(absolutePath);
      if (!insideRoot(rootPath, actualPath)) {
        failures.push({ path: relativePath, reason: 'resolved path escapes repository root through a symlink' });
        return null;
      }
      // Open the resolved file non-blocking and pin the descriptor before reading.
      // A FIFO/device must not hang a preflight, and a path replaced during the
      // realpath/open/read window must not make the receipt describe different bytes.
      const initialMetadata = await stat(actualPath, { bigint: true });
      if (!initialMetadata.isFile()) {
        failures.push({ path: relativePath, reason: 'target must be a regular file' });
        return null;
      }
      // A hard link can make an in-repository path refer to an inode that also
      // names a file outside the checkout. Refuse shared inodes so the receipt
      // cannot silently fingerprint out-of-tree bytes as repository content.
      if (initialMetadata.nlink !== 1n) {
        failures.push({ path: relativePath, reason: 'file has multiple hard links; preflight only accepts singly-linked repository files' });
        return null;
      }
      if (initialMetadata.size > BigInt(MAX_PREFLIGHT_FILE_BYTES)) {
        failures.push({ path: relativePath, reason: 'file exceeds the ' + MAX_PREFLIGHT_FILE_BYTES + ' byte preflight size limit' });
        return null;
      }
      const flags = fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0) | (fsConstants.O_NOFOLLOW ?? 0);
      const handle = await open(actualPath, flags);
      let bytes;
      try {
        const openedMetadata = await handle.stat({ bigint: true });
        if (!sameFileSnapshot(initialMetadata, openedMetadata)) {
          failures.push({ path: relativePath, reason: 'file changed while opening for preflight inspection' });
          return null;
        }
        if (!openedMetadata.isFile()) {
          failures.push({ path: relativePath, reason: 'target must be a regular file' });
          return null;
        }
        if (openedMetadata.size > BigInt(MAX_PREFLIGHT_FILE_BYTES)) {
          failures.push({ path: relativePath, reason: 'file exceeds the ' + MAX_PREFLIGHT_FILE_BYTES + ' byte preflight size limit' });
          return null;
        }
        const openedPath = await realpath(absolutePath);
        if (!insideRoot(rootPath, openedPath)) {
          failures.push({ path: relativePath, reason: 'resolved path escapes repository root during open' });
          return null;
        }
        const openedPathMetadata = await stat(openedPath, { bigint: true });
        if (!sameFileSnapshot(openedMetadata, openedPathMetadata)) {
          failures.push({ path: relativePath, reason: 'file changed while opening for preflight inspection' });
          return null;
        }
        const readResult = await readBoundedHandle(handle);
        if (readResult.tooLarge) {
          failures.push({ path: relativePath, reason: 'file exceeds the ' + MAX_PREFLIGHT_FILE_BYTES + ' byte preflight size limit while reading' });
          return null;
        }
        bytes = readResult.bytes;
        const readMetadata = await handle.stat({ bigint: true });
        const finalPath = await realpath(absolutePath);
        if (!insideRoot(rootPath, finalPath)) {
          failures.push({ path: relativePath, reason: 'resolved path escapes repository root during read' });
          return null;
        }
        const finalPathMetadata = await stat(finalPath, { bigint: true });
        if (BigInt(readResult.total) !== openedMetadata.size ||
            !sameFileSnapshot(openedMetadata, readMetadata) || !sameFileSnapshot(readMetadata, finalPathMetadata)) {
          failures.push({ path: relativePath, reason: 'file changed during preflight inspection' });
          return null;
        }
      } finally {
        await handle.close();
      }
      let content;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        failures.push({ path: relativePath, reason: 'file is not valid UTF-8' });
        return null;
      }
      if (!content.trim()) {
        failures.push({ path: relativePath, reason: 'file is empty' });
        return null;
      }
      const existing = seen.get(relativePath);
      const reconciled = reconcileInspectedFileRecord(existing, relativePath, kind, bytes);
      if (reconciled.changed) {
        failures.push({ path: relativePath, reason: 'file changed between preflight inspections' });
        return null;
      }
      if (!existing) {
        files.push(reconciled.record);
        seen.set(relativePath, reconciled.record);
      }
      return content;
    } catch (error) {
      if (required || error.code !== 'ENOENT') failures.push({ path: relativePath, reason: 'cannot read (' + (error.code ?? error.message) + ')' });
      return null;
    }
  }

  // Governance inputs are anchored to the repository root contract, not caller-selected decoys.
  if (entry !== 'AGENTS.md') {
    failures.push({ path: String(entry), reason: 'root instruction entry must be the repository root AGENTS.md; alternate entry paths are not permitted' });
  }
  const entryText = await inspect('AGENTS.md', 'root-instructions');
  const inferredProtocol = entryText ? protocolFromEntry(entryText) : null;
  const inferredProtocolIsRemote = typeof inferredProtocol === 'string' && /^https?:\/\//i.test(inferredProtocol);
  const protocolPath = inferredProtocolIsRemote ? protocol : inferredProtocol;
  if (!protocolPath) failures.push({ path: 'AGENTS.md', reason: 'no local canonical protocol path resolved; for a remote protocol URL, pass --protocol pointing to a locally pinned copy' });
  if (inferredProtocol && !inferredProtocolIsRemote && protocol && protocol !== inferredProtocol) {
    failures.push({ path: protocol, reason: 'explicit --protocol cannot override the local canonical protocol declared by root AGENTS.md' });
  }
  if (entryText && !/(STOP:\s*Read this file before|Before any work)/i.test(entryText)) {
    failures.push({ path: 'AGENTS.md', reason: 'root instructions must explicitly require reading them before repository work' });
  }
  if (entryText) for (const marker of ENTRY_MARKERS) {
    if (!entryText.includes(marker)) failures.push({ path: 'AGENTS.md', reason: 'missing mandatory instruction marker: ' + marker });
  }

  const protocolText = protocolPath ? await inspect(protocolPath, 'shared-protocol') : null;
  if (protocolText) for (const marker of PROTOCOL_MARKERS) {
    if (!protocolText.includes(marker)) failures.push({ path: protocolPath, reason: 'missing mandatory protocol section: ' + marker });
  }

  for (const vendorPath of VENDOR_POINTERS) {
    const vendorText = await inspect(vendorPath, 'vendor-pointer', true);
    if (vendorText && (!vendorText.includes('AGENTS.md') || !vendorText.includes('RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md'))) {
      failures.push({ path: vendorPath, reason: 'vendor instructions must point to root AGENTS.md and the shared protocol' });
    }
  }

  const normalizedTargets = [];
  for (const target of paths) {
    if (!safeRelativePath(target)) {
      failures.push({ path: String(target), reason: 'target must be a safe repository-relative path' });
      continue;
    }
    normalizedTargets.push(target);
    // Fingerprint each requested target, not just its ancestor instructions.
    // Missing, unreadable, or invalid-UTF-8 targets must block a ready receipt.
    await inspect(target, 'target');
    const parts = target.split('/');
    for (let index = 1; index <= parts.length; index += 1) {
      const prefix = parts.slice(0, index).join('/');
      try {
        const resolvedPrefix = await realpath(resolve(rootPath, prefix));
        if (!insideRoot(rootPath, resolvedPrefix)) {
          failures.push({ path: prefix, reason: 'target path escapes repository root through a symlink' });
          break;
        }
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
          failures.push({ path: prefix, reason: 'cannot resolve target path (' + (error.code ?? error.message) + ')' });
          break;
        }
      }
    }
    const directories = [];
    for (let index = 1; index < parts.length; index += 1) directories.push(parts.slice(0, index).join('/'));
    try {
      if ((await stat(resolve(rootPath, target))).isDirectory()) directories.push(target);
    } catch {}
    if (parts.at(-1) === 'AGENTS.md') directories.push(parts.slice(0, -1).join('/'));
    for (const directory of directories) if (directory) await inspect(directory + '/AGENTS.md', 'nested-instructions', false);
  }

  const canonicalCheckpointMatch = entryText ? /--checkpoint\s+([^\s]+)/.exec(entryText) : null;
  const canonicalCheckpointPath = canonicalCheckpointMatch?.[1] ?? null;
  if (!canonicalCheckpointPath && (normalizedTargets.length || checkpoint)) {
    warnings.push('Root AGENTS.md does not declare a canonical --checkpoint path; the supplied checkpoint cannot be pinned to the root contract.');
  }
  if (normalizedTargets.length && !checkpoint) {
    failures.push({ path: '(checkpoint)', reason: 'targeted work requires --checkpoint pointing to the latest durable checkpoint' });
  }
  let checkpointRecord = null;
  if (checkpoint && canonicalCheckpointPath && checkpoint !== canonicalCheckpointPath) {
    failures.push({ path: checkpoint, reason: 'checkpoint path must match the canonical --checkpoint declared by root AGENTS.md' });
  } else if (checkpoint) {
    await inspect(checkpoint, 'durable-checkpoint');
    checkpointRecord = files.find(file => file.path === checkpoint) ?? null;
  }
  if (!normalizedTargets.length) warnings.push('No target paths supplied: root-instruction validation only; this does not authorize edits to any path.');

  const result = {
    schema: 'ngl.agent-preflight.v1',
    generatedAt: new Date().toISOString(),
    repositoryRoot: rootPath,
    status: failures.length ? 'blocked' : 'ready',
    entry: 'AGENTS.md',
    protocol: protocolPath,
    targets: normalizedTargets,
    checkpoint: checkpointRecord?.path ?? null,
    files,
    warnings,
    failures
  };

  if (receiptPath) {
    if (!safeRelativePath(receiptPath)) {
      result.failures.push({ path: receiptPath, reason: 'receipt path must be repository-relative and cannot escape the root' });
      result.status = 'blocked';
    } else {
      try {
        const destination = resolve(rootPath, receiptPath);
        if (!insideRoot(rootPath, destination)) throw new Error('receipt path escapes repository root');
        const segments = dirname(receiptPath) === '.' ? [] : dirname(receiptPath).split('/');
        let realParent = rootPath;
        for (const segment of segments) {
          const candidate = resolve(realParent, segment);
          let resolvedDirectory;
          try {
            resolvedDirectory = await realpath(candidate);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            await mkdir(candidate);
            resolvedDirectory = await realpath(candidate);
          }
          if (!insideRoot(rootPath, resolvedDirectory)) throw new Error('receipt directory escapes repository root through a symlink');
          if (!(await stat(resolvedDirectory)).isDirectory()) throw new Error('receipt parent is not a directory');
          realParent = resolvedDirectory;
        }
        await writeFile(resolve(realParent, basename(destination)), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
      } catch (error) {
        result.failures.push({ path: receiptPath, reason: 'cannot write receipt (' + (error.code ?? error.message) + ')' });
        result.status = 'blocked';
      }
    }
  }
  return result;
}

function parseArgs(argv) {
  const options = { paths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (['--entry', '--protocol', '--path', '--checkpoint', '--receipt', '--root'].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(arg + ' requires a value');
      index += 1;
      if (arg === '--path') options.paths.push(value);
      else if (arg === '--root') options.root = value;
      else if (arg === '--entry') options.entry = value;
      else if (arg === '--protocol') options.protocol = value;
      else if (arg === '--checkpoint') options.checkpoint = value;
      else if (arg === '--receipt') options.receiptPath = value;
    } else throw new Error('unknown argument: ' + arg);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/validate-agent-governance.mjs [--path <target>]... --checkpoint <latest-checkpoint> [--receipt <output>] [--entry <path>] [--protocol <path>]');
    return;
  }
  const result = await runPreflight(options);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'ready') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error('Agent preflight failed:', error.message); process.exitCode = 1; });
}
