import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildComponent} from '../src/production/component-package.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function readProfile(path) {
  const limit = 4 * 1024 * 1024;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({bigint:true});
    if (!before.isFile()) throw Error('Component profile must be a regular file');
    if (before.size > BigInt(limit)) throw Error('Profile exceeds 4 MiB size limit');
    const chunks = []; let position = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, limit + 1 - position));
      const {bytesRead} = await handle.read(buffer,0,buffer.length,position);
      if (!bytesRead) break;
      chunks.push(buffer.subarray(0,bytesRead)); position += bytesRead;
      if (position > limit) throw Error('Profile exceeds 4 MiB size limit');
    }
    const after = await handle.stat({bigint:true});
    if (position !== Number(before.size) || ['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'].some(key => before[key] !== after[key])) throw Error('Component profile changed during reading');
    return Buffer.concat(chunks,position);
  } finally { await handle.close(); }
}

const usage = 'Usage: node scripts/package-component.mjs --profile PATH --out NEW_DIR [--root REPO]';
try {
  const args = process.argv.slice(2), options = new Map();
  for (let i=0; i<args.length; i+=2) {
    if (!['--profile','--out','--root'].includes(args[i]) || options.has(args[i]) || !args[i+1] || args[i+1].startsWith('--')) throw Error(usage);
    options.set(args[i],args[i+1]);
  }
  if (!options.has('--profile') || !options.has('--out')) throw Error(usage);
  const profileBytes = await readProfile(resolve(options.get('--profile')));
  let profile;
  try { profile = JSON.parse(profileBytes.toString('utf8')); }
  catch { throw Error('Component profile must be valid JSON'); }
  const result = await buildComponent({rootDir:resolve(options.get('--root') ?? ROOT), profile, outDir:resolve(options.get('--out'))});
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error.message); process.exitCode = 1;
}
