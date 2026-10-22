import {constants} from 'node:fs';
import {open, lstat, mkdir, writeFile, unlink, rmdir} from 'node:fs/promises';
import {resolve, dirname, basename, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_FILE = 8 * 1024 * 1024, MAX_TOTAL = 32 * 1024 * 1024;
const DIR_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const FILE_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const anchor = (handle, name = '') => `/proc/self/fd/${handle.fd}${name ? '/' + name : ''}`;
const same = (a, b, keys) => keys.every(key => a[key] === b[key]);
const IDENTITY = ['dev', 'ino', 'mode'];
const SNAPSHOT = [...IDENTITY, 'nlink', 'size', 'mtimeNs', 'ctimeNs'];

function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error(`Invalid profile ${label}`);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => !keys.includes(key)) ||
      keys.some(key => !Object.hasOwn(value, key))) throw Error(`Unknown or missing profile field in ${label}`);
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.hasOwn(descriptor, 'value')) throw Error(`Profile accessors are not supported: ${label}`);
  }
}

function publicPath(value) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 1024 || value !== value.normalize('NFC') ||
      /[\\\x00-\x1f\x7f<>:"|?*]/u.test(value) || value.startsWith('/')) throw Error('Invalid relative public path');
  const segments = value.split('/');
  for (const part of segments) {
    if (!part || part === '.' || part === '..' || /[.\s]$/u.test(part) || Buffer.byteLength(part) > 255 ||
        /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)) throw Error('Invalid relative path segment');
    if (/^(?:\.(?:git|runtime|ssh|aws|azure|gnupg|codex|agents|docker)|runtime|private|secrets?|credentials?|node_modules)$/i.test(part) ||
        /^\.env(?:\.|$)/i.test(part) || /^(?:\.npmrc|\.netrc|\.pypirc|\.git-credentials|id_(?:rsa|dsa|ecdsa|ed25519))$/i.test(part) ||
        /(?:^|[._-])(?:secret|secrets|credential|credentials|keypair|saved[._-]state)(?:[._-]|$)/i.test(part) ||
        /\.(?:key|p12|pfx|jks|keystore)$/i.test(part)) throw Error('Private credential or runtime path is not exportable');
  }
  return value;
}

function validateProfile(input) {
  object(input, ['schema', 'id', 'files', 'entryPoint'], 'root');
  if (input.schema !== 'ngl.component-profile.v1') throw Error('Unsupported component profile schema');
  if (typeof input.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(input.id)) throw Error('Invalid component profile id');
  if (!Array.isArray(input.files) || input.files.length === 0 || input.files.length > 4096) throw Error('Profile files must contain 1 to 4096 entries');
  const sources = new Set(), targets = new Set(['manifest.json']);
  const files = input.files.map(entry => {
    object(entry, ['source', 'target'], 'file entry');
    const source = publicPath(entry.source), target = publicPath(entry.target);
    const sourceKey = source.toLowerCase(), targetKey = target.toLowerCase();
    if (sources.has(sourceKey)) throw Error('Duplicate source or source case alias');
    if (targets.has(targetKey) || [...targets].some(name => name.startsWith(targetKey + '/') || targetKey.startsWith(name + '/'))) throw Error('Duplicate, reserved or colliding target path');
    sources.add(sourceKey); targets.add(targetKey);
    return {source, target};
  });
  const entryPoint = publicPath(input.entryPoint);
  if (!files.some(file => file.target === entryPoint)) throw Error('Profile entryPoint must name an exact declared target');
  return {schema: input.schema, id: input.id, entryPoint, files};
}

async function checkedStat(parent, name) {
  const stat = await lstat(anchor(parent, name), {bigint: true});
  if (stat.isSymbolicLink()) throw Error('Symlink path components are not supported');
  return stat;
}

// Descriptor anchors avoid resolving a checked directory name again during file access.
// Fail closed on platforms without Linux procfs instead of weakening this boundary.
async function directories(path, base) {
  if (process.platform !== 'linux' || constants.O_NOFOLLOW === undefined || constants.O_DIRECTORY === undefined) throw Error('Secure component export requires Linux procfs and O_NOFOLLOW');
  const handles = [], links = [];
  try {
    let current = base;
    if (!current) { current = await open('/', DIR_FLAGS); handles.push(current); }
    for (const name of path.split(sep).filter(name => name && name !== '.')) {
      const before = await checkedStat(current, name);
      if (!before.isDirectory()) throw Error('Path component is not a directory');
      const next = await open(anchor(current, name), DIR_FLAGS); handles.push(next);
      if (!same(before, await next.stat({bigint:true}), IDENTITY)) throw Error('Directory path changed during export');
      links.push({parent:current, name, stat:before}); current = next;
    }
    return {
      handle: current,
      async check() {
        for (const link of links) if (!same(link.stat, await checkedStat(link.parent, link.name), IDENTITY)) throw Error('Directory path changed during export');
      },
      async close() { for (const handle of handles.reverse()) await handle.close(); },
    };
  } catch (error) {
    for (const handle of handles.reverse()) await handle.close();
    throw error;
  }
}

function regular(stat) {
  if (!stat.isFile()) throw Error('Selected source must be a regular file');
  if (stat.nlink !== 1n) throw Error('Hardlink aliases are not exportable (link count must be one)');
  if (stat.size > BigInt(MAX_FILE)) throw Error('Source exceeds 8 MiB size limit');
}

async function readBounded(handle) {
  const parts = []; let position = 0;
  for (;;) {
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_FILE + 1 - position));
    const {bytesRead} = await handle.read(buffer, 0, buffer.length, position);
    if (!bytesRead) break;
    parts.push(buffer.subarray(0, bytesRead)); position += bytesRead;
    if (position > MAX_FILE) throw Error('Source exceeds 8 MiB size limit');
  }
  return Buffer.concat(parts, position);
}

async function readSource(root, item) {
  const name = basename(item.source), dirs = await directories(dirname(item.source), root.handle);
  let handle;
  try {
    const before = await checkedStat(dirs.handle, name); regular(before);
    handle = await open(anchor(dirs.handle, name), FILE_FLAGS);
    const opened = await handle.stat({bigint:true}); regular(opened);
    if (!same(before, opened, SNAPSHOT)) throw Error('Source changed while opening');
    const bytes = await readBounded(handle);
    if (bytes.length !== Number(before.size) || !same(before, await handle.stat({bigint:true}), SNAPSHOT)) throw Error('Source mutation detected during read');
    if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i.test(bytes.toString('utf8'))) throw Error('PEM private key material is not exportable');
    await dirs.check();
    if (!same(before, await checkedStat(dirs.handle, name), SNAPSHOT)) throw Error('Source path changed during read');
    return {bytes, stat:before};
  } finally { await handle?.close(); await dirs.close(); }
}

const CRC_TABLE = Array.from({length:256}, (_, value) => {
  for (let bit=0; bit<8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const records = [], central = []; let offset = 0;
  for (const [name, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const filename = Buffer.from(name), compressed = deflateRawSync(bytes), crc = crc32(bytes);
    const local = Buffer.alloc(30), directory = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(0x800,6);
    local.writeUInt16LE(8,8); local.writeUInt16LE(0x21,12); local.writeUInt32LE(crc,14);
    local.writeUInt32LE(compressed.length,18); local.writeUInt32LE(bytes.length,22); local.writeUInt16LE(filename.length,26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20,4); directory.writeUInt16LE(20,6);
    directory.writeUInt16LE(0x800,8); directory.writeUInt16LE(8,10); directory.writeUInt16LE(0x21,14);
    directory.writeUInt32LE(crc,16); directory.writeUInt32LE(compressed.length,20); directory.writeUInt32LE(bytes.length,24);
    directory.writeUInt16LE(filename.length,28); directory.writeUInt32LE(offset,42);
    records.push(local, filename, compressed); central.push(directory, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size,8); end.writeUInt16LE(files.size,10);
  end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...records, directory, end]);
}

/** Export exactly the declared, literal public files; never follow imports or execute payloads. */
export async function buildComponent({rootDir=ROOT, profile:input, outDir} = {}) {
  const profile = validateProfile(input);
  if (typeof rootDir !== 'string' || !rootDir || rootDir.includes('\0') || typeof outDir !== 'string' || !outDir || /[\\\0]/.test(outDir)) throw Error('A root path and fresh output directory are required');
  rootDir = resolve(rootDir); outDir = resolve(rootDir, outDir);
  for (const item of profile.files) {
    const source = resolve(rootDir, item.source), fromOutput = relative(outDir, source);
    if (!fromOutput || (!fromOutput.startsWith('..' + sep) && fromOutput !== '..' && !fromOutput.startsWith(sep))) throw Error('Output directory cannot contain selected source paths');
  }
  const root = await directories(rootDir);
  let outputParent, output, created = false, success = false, outputStat;
  const archiveName = `${profile.id}.zip`;
  try {
    outputParent = await directories(dirname(outDir));
    try { await checkedStat(outputParent.handle, basename(outDir)); throw Error('Output directory must be fresh and must not exist'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const payload = new Map(), records = [], initial = [];
    let totalBytes = 0;
    for (const item of profile.files) {
      const {bytes, stat} = await readSource(root, item);
      totalBytes += bytes.length;
      if (totalBytes > MAX_TOTAL) throw Error('Payload total exceeds 32 MiB limit');
      const sha256 = digest(bytes);
      payload.set(item.target, bytes); initial.push(stat);
      records.push({...item, size:bytes.length, sha256});
    }
    // Reread after gathering the entire payload: changes to an earlier source also fail closed.
    for (let i=0; i<profile.files.length; i++) {
      const {bytes, stat} = await readSource(root, profile.files[i]);
      if (!same(initial[i], stat, SNAPSHOT) || digest(bytes) !== records[i].sha256) throw Error('Source mutation detected during final verification');
    }
    await root.check(); await outputParent.check();
    const manifest = {schema:'ngl.component-manifest.v1', id:profile.id, entryPoint:profile.entryPoint, totalBytes, files:records};
    const manifestBytes = Buffer.from(JSON.stringify(manifest,null,2) + '\n');
    payload.set('manifest.json', manifestBytes);
    const archiveBytes = zip(payload);
    await mkdir(anchor(outputParent.handle, basename(outDir)), {mode:0o700}); created = true;
    const createdStat = await checkedStat(outputParent.handle, basename(outDir));
    output = await open(anchor(outputParent.handle, basename(outDir)), DIR_FLAGS);
    outputStat = await output.stat({bigint:true});
    if (!same(createdStat, outputStat, IDENTITY) || (outputStat.mode & 0o777n) !== 0o700n || outputStat.uid !== BigInt(process.getuid())) throw Error('Output directory changed during creation');
    await writeFile(anchor(output, archiveName), archiveBytes, {flag:'wx',mode:0o600});
    await writeFile(anchor(output, 'manifest.json'), manifestBytes, {flag:'wx',mode:0o600});
    await root.check(); await outputParent.check();
    if (!same(outputStat, await checkedStat(outputParent.handle, basename(outDir)), IDENTITY)) throw Error('Output directory changed during publication');
    success = true;
    return {archivePath:resolve(outDir,archiveName), manifestPath:resolve(outDir,'manifest.json'), manifest};
  } finally {
    if (created && !success && output) {
      for (const name of [archiveName,'manifest.json']) await unlink(anchor(output,name)).catch(() => {});
      if (outputStat && same(outputStat, await lstat(anchor(outputParent.handle,basename(outDir)),{bigint:true}).catch(() => ({})), IDENTITY)) await rmdir(anchor(outputParent.handle,basename(outDir))).catch(() => {});
    }
    await output?.close(); await outputParent?.close(); await root.close();
  }
}
