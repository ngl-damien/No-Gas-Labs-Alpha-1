import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath, stat } from 'node:fs/promises';
import { dirname, basename, resolve, relative, posix, isAbsolute, win32, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const VENDOR_POINTERS = ['CLAUDE.md', 'GEMINI.md', 'CODEX.md', '.github/copilot-instructions.md'];
const ENTRY_MARKERS = ['RALPH_SHARED_HOURLY_SCHEDULER_PROTOCOL.md', 'First repository operation:', 'Second repository operation:', 'Discard any pre-read observations'];
const PROTOCOL_MARKERS = ['Required loop on every run', 'Shared work coordination rules', 'Evidence and state rules', 'Founder authority remains with Damien', 'MMORPG completion gates and delivery priority'];

function insideRoot(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
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
  const seen = new Set();

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
      const actualPath = await realpath(absolutePath);
      if (!insideRoot(rootPath, actualPath)) {
        failures.push({ path: relativePath, reason: 'resolved path escapes repository root through a symlink' });
        return null;
      }
      const bytes = await readFile(actualPath);
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
      if (!seen.has(relativePath)) {
        files.push({ path: relativePath, kind, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength });
        seen.add(relativePath);
      }
      return content;
    } catch (error) {
      if (required || error.code !== 'ENOENT') failures.push({ path: relativePath, reason: 'cannot read (' + (error.code ?? error.message) + ')' });
      return null;
    }
  }

  const entryText = await inspect(entry, 'root-instructions');
  const inferredProtocol = entryText ? protocolFromEntry(entryText) : null;
  const protocolPath = protocol ?? (inferredProtocol && !/^https?:\/\//i.test(inferredProtocol) ? inferredProtocol : null);
  if (!protocolPath) failures.push({ path: entry, reason: 'no local canonical protocol path resolved; for a remote protocol URL, pass --protocol pointing to a locally pinned copy' });
  if (entryText && !/(STOP:\s*Read this file before|Before any work)/i.test(entryText)) {
    failures.push({ path: entry, reason: 'root instructions must explicitly require reading them before repository work' });
  }
  if (entryText) for (const marker of ENTRY_MARKERS) {
    if (!entryText.includes(marker)) failures.push({ path: entry, reason: 'missing mandatory instruction marker: ' + marker });
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

  let checkpointRecord = null;
  if (normalizedTargets.length && !checkpoint) {
    failures.push({ path: '(checkpoint)', reason: 'targeted work requires --checkpoint pointing to the latest durable checkpoint' });
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
    entry,
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
