import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink, link, open, readdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
const exporter = await import('../src/production/component-package.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
async function build(options) {
  assert.equal(typeof exporter.buildComponent, 'function', 'component exporter must be implemented');
  return exporter.buildComponent(options);
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const profile = (files = [{source: 'public/main.mjs', target: 'lib/main.mjs'}]) => ({
  schema: 'ngl.component-profile.v1', id: 'example-component', entryPoint: files[0].target, files,
});
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ngl-component-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await mkdir(join(dir, 'public'));
  await writeFile(join(dir, 'public/main.mjs'), 'export const example = 42;\n');
  return {rootDir: dir, profile: profile(), outDir: join(dir, 'export')};
}
// This reader starts from the ZIP central directory, not the exporter's local-header writer.
function unzip(bytes) {
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  const count = bytes.readUInt16LE(end + 10), entries = new Map();
  let at = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    assert.equal(bytes.readUInt32LE(at), 0x02014b50);
    const method = bytes.readUInt16LE(at + 10), size = bytes.readUInt32LE(at + 20);
    const nameSize = bytes.readUInt16LE(at + 28), extra = bytes.readUInt16LE(at + 30), comment = bytes.readUInt16LE(at + 32);
    const name = bytes.subarray(at + 46, at + 46 + nameSize).toString();
    const local = bytes.readUInt32LE(at + 42);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const raw = bytes.subarray(start, start + size);
    const payload = method === 8 ? inflateRawSync(raw) : raw;
    assert.equal(payload.length, bytes.readUInt32LE(at + 24));
    assert.ok(!entries.has(name)); entries.set(name, payload);
    at += 46 + nameSize + extra + comment;
  }
  assert.equal(at, end);
  return entries;
}

test('exports exactly declared public bytes, including JSON, with matching SHA-256 manifest', async t => {
  const options = await fixture(t);
  await writeFile(join(options.rootDir, 'public/example.json'), '{"claim":"fixture"}\n');
  await writeFile(join(options.rootDir, 'public/unselected.mjs'), 'DO_NOT_PACKAGE');
  options.profile.files.push({source: 'public/example.json', target: 'data/example.json'});
  const result = await build(options);
  const entries = unzip(await readFile(result.archivePath));
  assert.deepEqual([...entries.keys()].sort(), ['data/example.json', 'lib/main.mjs', 'manifest.json']);
  const manifestBytes = await readFile(result.manifestPath);
  assert.deepEqual(entries.get('manifest.json'), manifestBytes);
  assert.deepEqual(JSON.parse(manifestBytes), result.manifest);
  assert.equal(result.manifest.schema, 'ngl.component-manifest.v1');
  assert.equal(result.manifest.id, options.profile.id);
  assert.equal(result.manifest.entryPoint, 'lib/main.mjs');
  let total = 0;
  for (const item of result.manifest.files) {
    const source = await readFile(join(options.rootDir, item.source));
    assert.deepEqual(entries.get(item.target), source);
    assert.equal(item.size, source.length); assert.equal(item.sha256, hash(source));
    total += source.length;
  }
  assert.equal(result.manifest.totalBytes, total);
});

test('strict profile rejects unknown schema, fields, malformed entries and missing entry points', async t => {
  const options = await fixture(t);
  for (const bad of [
    {...profile(), schema: 'ngl.component-profile.v2'}, {...profile(), shell: 'echo unsafe'},
    {...profile(), files: [{...profile().files[0], public: true}]}, {...profile(), files: []},
    {...profile(), entryPoint: 'missing.mjs'}, {...profile(), id: '../escape'},
    {...profile(), files: 'public/main.mjs'}, {...profile(), files: [null]},
    {...profile(), entryPoint: 1}, {...profile(), id: ''},
  ]) await assert.rejects(build({...options, profile: bad}), /profile|schema|field|entry|id|files/i);
});

test('rejects traversal, absolute paths, NUL, backslash and ambiguous segments in either path', async t => {
  const options = await fixture(t);
  for (const name of ['../private', '/etc/passwd', 'public/../main.mjs', 'public\\main.mjs', 'public/\0x', 'C:/private', './public/main.mjs', 'public//main.mjs', 'public/']) {
    for (const key of ['source', 'target']) {
      const entry = {...profile().files[0], [key]: name};
      await assert.rejects(build({...options, profile: {...profile([entry]), entryPoint: entry.target}}), /path|relative|segment|escape/i);
    }
  }
});

test('rejects duplicate sources, targets, case aliases and file-directory ZIP collisions', async t => {
  const options = await fixture(t);
  await writeFile(join(options.rootDir, 'public/other.mjs'), 'other');
  for (const entries of [
    [{source:'public/main.mjs',target:'a'}, {source:'public/main.mjs',target:'b'}],
    [{source:'public/main.mjs',target:'a'}, {source:'public/other.mjs',target:'a'}],
    [{source:'public/main.mjs',target:'A'}, {source:'public/other.mjs',target:'a'}],
    [{source:'public/main.mjs',target:'a'}, {source:'public/other.mjs',target:'a/b'}],
    [{source:'public/main.mjs',target:'manifest.json'}],
  ]) await assert.rejects(build({...options, profile:profile(entries)}), /duplicate|collision|reserved|alias/i);
});

test('rejects known credential and runtime paths rather than trusting declarations', async t => {
  const options = await fixture(t);
  for (const name of ['.runtime/operator.json', 'public/runtime/state.json', '.git/config', '.ssh/id_ed25519', '.aws/credentials', '.env', '.env.production', 'public/secrets.json', 'public/credentials.json', 'public/operator.key', 'public/saved-state.json', 'public/.npmrc']) {
    await mkdir(join(options.rootDir, name, '..'), {recursive:true});
    await writeFile(join(options.rootDir, name), 'PRIVATE_FIXTURE');
    await assert.rejects(build({...options, profile:profile([{source:name,target:'safe.json'}])}), /private|credential|runtime|sensitive/i);
  }
});

test('rejects PEM private-key material even under a public JSON filename', async t => {
  const options = await fixture(t);
  for (const label of ['PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY', 'ENCRYPTED PRIVATE KEY', 'OPENSSH PRIVATE KEY']) {
    await writeFile(join(options.rootDir, 'public/main.mjs'), JSON.stringify({text:`-----BEGIN ${label}-----\nfixture\n-----END ${label}-----`}));
    await assert.rejects(build(options), /private.key|private key|PEM|sensitive/i);
  }
});

test('rejects leaf and directory symlinks, including links to a file inside the root', async t => {
  const options = await fixture(t);
  await symlink('main.mjs', join(options.rootDir, 'public/alias.mjs'));
  await symlink('public', join(options.rootDir, 'alias'));
  for (const source of ['public/alias.mjs', 'alias/main.mjs']) {
    await assert.rejects(build({...options, profile:profile([{source,target:'main.mjs'}])}), /symlink|symbolic/i);
  }
});

test('rejects hardlink aliases to private or public files', async t => {
  const options = await fixture(t);
  await mkdir(join(options.rootDir, '.runtime'));
  await writeFile(join(options.rootDir, '.runtime/operator.json'), 'PRIVATE_ALIAS');
  await link(join(options.rootDir, '.runtime/operator.json'), join(options.rootDir, 'public/alias.json'));
  await assert.rejects(build({...options,profile:profile([{source:'public/alias.json',target:'safe.json'}])}), /hardlink|link count|alias/i);
  await link(join(options.rootDir, 'public/main.mjs'), join(options.rootDir, 'public/copy.mjs'));
  await assert.rejects(build(options), /hardlink|link count|alias/i);
});

test('rejects directories and nonregular source files', async t => {
  const options = await fixture(t);
  await assert.rejects(build({...options, profile:profile([{source:'public',target:'source'}])}), /regular|file/i);
  const fifo = join(options.rootDir, 'public/pipe');
  await run('/usr/bin/mkfifo', [fifo]);
  await assert.rejects(build({...options, profile:profile([{source:'public/pipe',target:'source'}])}), /regular|file/i);
});

test('enforces 8 MiB per source and 32 MiB total limits', async t => {
  const options = await fixture(t);
  await writeFile(join(options.rootDir, 'public/main.mjs'), Buffer.alloc(8 * 1024 * 1024 + 1));
  await assert.rejects(build(options), /size|limit|large|MiB/i);
  const files = [];
  for (let i=0; i<5; i++) {
    const source = `public/part${i}.bin`;
    await writeFile(join(options.rootDir, source), Buffer.alloc(7 * 1024 * 1024));
    files.push({source,target:source});
  }
  await assert.rejects(build({...options, profile:profile(files)}), /total|limit|large|MiB/i);
});

test('requires a fresh output directory and leaves existing contents untouched', async t => {
  const options = await fixture(t);
  await mkdir(options.outDir);
  await writeFile(join(options.outDir, 'sentinel'), 'PRESERVE');
  await assert.rejects(build(options), /exist|fresh|output/i);
  assert.equal(await readFile(join(options.outDir, 'sentinel'), 'utf8'), 'PRESERVE');
  await assert.rejects(build({...options, outDir:join(options.rootDir,'public')}), /exist|fresh|output/i);
  assert.equal(await readFile(join(options.rootDir,'public/main.mjs'),'utf8'), 'export const example = 42;\n');
});

test('rejects output symlink components and selected source collisions', async t => {
  const options = await fixture(t);
  await mkdir(join(options.rootDir, 'exports'));
  await symlink('exports', join(options.rootDir, 'redirect'));
  await assert.rejects(build({...options,outDir:join(options.rootDir,'redirect/new')}), /symlink|symbolic/i);
  await assert.rejects(build({...options,outDir:join(options.rootDir,'public/main.mjs/child')}), /output|directory|ENOTDIR/i);
});

test('failed output validation closes all directory descriptors', async t => {
  const options = await fixture(t);
  await symlink('public', join(options.rootDir, 'redirect'));
  const before = (await readdir('/proc/self/fd')).length;
  for (let i=0; i<3; i++) await assert.rejects(build({...options,outDir:join(options.rootDir,'redirect/new')}), /symlink|symbolic/i);
  assert.equal((await readdir('/proc/self/fd')).length, before);
});

test('detects source mutation between reading bytes and final verification', async t => {
  const options = await fixture(t), source = join(options.rootDir, 'public/main.mjs');
  await writeFile(source, Buffer.alloc(128 * 1024, 65));
  const handle = await open(source, 'r'), proto = Object.getPrototypeOf(handle), original = proto.read;
  await handle.close();
  let changed = false;
  t.mock.method(proto, 'read', async function (...args) {
    const result = await original.apply(this, args);
    if (!changed) {
      changed = true;
      await writeFile(source, Buffer.alloc(128 * 1024, 66));
    }
    return result;
  });
  await assert.rejects(build(options), /chang|mutat|unstable/i);
  assert.equal(changed, true, 'actual file reads must encounter the mutation');
  await assert.rejects(readFile(join(options.outDir, 'manifest.json')), /ENOENT/);
});

test('CLI accepts profile and fresh output paths and prints the API result as JSON', async t => {
  const options = await fixture(t), profilePath = join(options.rootDir, 'component.profile.json');
  await writeFile(profilePath, JSON.stringify(options.profile));
  const {stdout} = await run(process.execPath, [resolve('scripts/package-component.mjs'), '--root',options.rootDir,'--profile',profilePath,'--out',options.outDir]);
  const result = JSON.parse(stdout);
  assert.deepEqual(JSON.parse(await readFile(result.manifestPath,'utf8')), result.manifest);
  assert.equal(unzip(await readFile(result.archivePath)).get('lib/main.mjs').toString(), 'export const example = 42;\n');
  for (const args of [[], ['--profile',profilePath,'--out',join(options.rootDir,'other'),'--exec','echo'], ['--profile',profilePath,'--profile',profilePath,'--out',join(options.rootDir,'other')]]) {
    await assert.rejects(run(process.execPath, [resolve('scripts/package-component.mjs'), ...args]));
  }
});

test('CLI rejects malformed profiles without echoing their content', async t => {
  const options = await fixture(t), profilePath = join(options.rootDir, 'invalid.profile.json');
  await writeFile(profilePath, 'SECRET_PROFILE_FIXTURE_CONTENT');
  try {
    await run(process.execPath, [resolve('scripts/package-component.mjs'),'--profile',profilePath,'--out',options.outDir]);
    assert.fail('invalid JSON must fail');
  } catch (error) {
    assert.equal(error.code, 1);
    assert.ok(!error.stderr.includes('SECRET_'), 'parse errors must not echo profile bytes');
    assert.match(error.stderr, /profile|JSON/i);
  }
});

test('CLI rejects nonregular profiles promptly and caps profile bytes at 4 MiB', async t => {
  const options = await fixture(t), profilePath = join(options.rootDir, 'profile.pipe');
  await run('/usr/bin/mkfifo', [profilePath]);
  try {
    await run(process.execPath, [resolve('scripts/package-component.mjs'),'--profile',profilePath,'--out',options.outDir], {timeout:500});
    assert.fail('FIFO profile must fail');
  } catch (error) {
    assert.equal(error.killed, false, 'profile FIFO must be rejected without waiting for a writer');
    assert.match(error.stderr, /regular|profile/i);
  }
  const largePath = join(options.rootDir, 'large.profile.json');
  await writeFile(largePath, Buffer.alloc(4 * 1024 * 1024 + 1, 32));
  await assert.rejects(run(process.execPath,[resolve('scripts/package-component.mjs'),'--profile',largePath,'--out',options.outDir]), error => {
    assert.match(error.stderr,/4 MiB|size limit/i); return true;
  });
});
