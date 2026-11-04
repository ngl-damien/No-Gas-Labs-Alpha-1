import {readFile,writeFile,mkdir,readdir,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,join,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const inside=(root,path)=>{const r=relative(root,path);return !r||r!=='..'&&!r.startsWith('..'+sep)&&!r.startsWith(sep)};
const exists=async path=>{try{await realpath(path);return true}catch(e){if(e.code==='ENOENT')return false;throw e}};
const jsonJS=value=>JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
function crc32(bytes){let n=0xffffffff;for(const byte of bytes){n^=byte;for(let i=0;i<8;i++)n=(n>>>1)^(n&1?0xedb88320:0)}return(n^0xffffffff)>>>0}
function zip(files){const records=[],directory=[];let offset=0;for(const[name,bytes]of[...files].sort(([a],[b])=>a.localeCompare(b))){const n=Buffer.from(name),compressed=deflateRawSync(bytes),crc=crc32(bytes),h=Buffer.alloc(30),d=Buffer.alloc(46);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt16LE(0x21,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(compressed.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(n.length,26);d.writeUInt32LE(0x02014b50);d.writeUInt16LE(20,4);d.writeUInt16LE(20,6);d.writeUInt16LE(0x800,8);d.writeUInt16LE(8,10);d.writeUInt16LE(0x21,14);d.writeUInt32LE(crc,16);d.writeUInt32LE(compressed.length,20);d.writeUInt32LE(bytes.length,24);d.writeUInt16LE(n.length,28);d.writeUInt32LE(offset,42);records.push(h,n,compressed);directory.push(d,n);offset+=h.length+n.length+compressed.length}const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.size,8);end.writeUInt16LE(files.size,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...records,central,end])}

/** A public-source allowlist; this intentionally does not recursively archive the repository. */
export async function buildGame({rootDir=ROOT,outDir=join(rootDir,'dist')}={}){
 rootDir=await realpath(rootDir);const game=await realpath(join(rootDir,'game')),files=new Map(),cache=new Map();
 async function add(path,name=relative(rootDir,path).split(sep).join('/')){const actual=await realpath(path);if(!inside(rootDir,actual)||name.split('/').includes('..')||!name||name.startsWith('/'))throw Error('Distribution path escapes repository');const bytes=await readFile(actual);files.set(name,bytes);return bytes}
 async function browserPath(path){const actual=await realpath(path);if(!inside(game,actual))throw Error('Browser module escapes game source');return actual}
 async function bundle(path,stack=[]){path=await browserPath(path);if(!['.mjs','.js'].includes(extname(path)))throw Error('Unsupported browser module');if(stack.includes(path))throw Error('Cyclic browser module graph');if(cache.has(path))return cache.get(path);let source=(await add(path)).toString();if(/\bimport\s*\(/.test(source))throw Error('Dynamic module imports not supported in standalone');const matches=[...source.matchAll(/\b(?:import\s+(?:[^'";]*?\s+from\s*)?|export\s+[^'";]*?\s+from\s*)(['"])([^'"\r\n]+)\1/g)];for(const m of matches.reverse()){if(!m[2].startsWith('./')&&!m[2].startsWith('../'))throw Error('Unsupported browser module specifier');const url=await bundle(resolve(dirname(path),m[2]),[...stack,path]),index=m.index+m[0].lastIndexOf(m[2]);source=source.slice(0,index)+url+source.slice(index+m[2].length)}const url='data:text/javascript;base64,'+Buffer.from(source).toString('base64');cache.set(path,url);return url}
 const assets={pages:[]};
 for(const stem of ['cover_a','p3','p4','p5','p10','p13']){const path=join(game,'assets/comic',stem+'.jpg');if(await exists(path)){const bytes=await add(await browserPath(path));assets.pages.push({path:`/assets/comic/${stem}.jpg`,src:'data:image/jpeg;base64,'+bytes.toString('base64'),title:stem==='cover_a'?'America’s Got Problems · No_Gas_Labs':`Original comic · ${stem}`})}}
 let html=(await add(join(game,'index.html'))).toString(),css=(await add(join(game,'styles.css'))).toString();
 const style=/<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["'](?:\.\/|\/)?styles\.css["'])[^>]*>/i,entry=/<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["'](?:\.\/|\/)?client\.mjs["'])[^>]*>\s*<\/script>/i;
 if(!style.test(html)||!entry.test(html))throw Error('Expected stylesheet and module entry tags');
 const manifestLink=/<link\b(?=[^>]*\brel=["']manifest["'])(?=[^>]*\bhref=["'](?:\.\/|\/)?manifest\.webmanifest["'])[^>]*>/i;
 // The standalone file has no service-worker origin or sibling manifest.
 html=html.replace(manifestLink,'');
 const url=await bundle(join(game,'client.mjs'));
 html=html.replace(style,()=>`<style>${css.replace(/<\/style/gi,'<\\/style')}</style>`).replace(entry,()=>`<script>globalThis.NGL_ASSETS=${jsonJS(assets)};</script><script type="module" src="${url}"></script>`);
 // The downloadable workshop must retain its boundary when no HTTP server supplies headers.
 const policy="default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data:; media-src data: blob:; frame-src 'self' about: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
 html=html.replace(/<head\b[^>]*>/i,match=>`${match}<meta http-equiv="Content-Security-Policy" content="${policy}">`);
 files.set('play.html',Buffer.from(html));
 if(await exists(join(game,'model.mjs'))&&await exists(join(game,'launchpad.mjs'))){
  const {buildExhibition}=await import('./build-exhibit.mjs');
  const exhibit=await buildExhibition({rootDir,outDir});
  files.set('exhibition.html',await readFile(exhibit.htmlPath));files.set('launch-checks.json',await readFile(exhibit.summaryPath));
 }
 for(const name of ['README.md','package.json','.gitignore','core.mjs','evidence.mjs','genesis.test.mjs','reconstitution/known-weakness-origin-label.test.mjs','game/server.mjs','game/service-store.mjs']){const p=join(rootDir,name);if(await exists(p))await add(p,name)}
 // JSON runtime envelopes are not executable source. Only selected or newly generated JSON metadata is included.
 const allowed=/\.(mjs|js|html|css|md|py)$/;
 async function tree(dir){if(!await exists(dir))return;for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.name.startsWith('.')||/^(?:node_modules|__pycache__|dist|runtime|data|state|secrets?|credentials?)$/i.test(entry.name))continue;const path=join(dir,entry.name);if(entry.isDirectory())await tree(path);else if(entry.isFile()&&allowed.test(entry.name)&&!/(?:\.key|\.pem|\.env|keypair|secret)/i.test(entry.name))await add(path)}}
 for(const name of ['src','test','fixtures','scripts','docs/meteor','docs/institution/compounding','experiments/AOTA-FEATHERSTONIAN-ENGINE'])await tree(join(rootDir,name));
 for(const name of ['experiments/AOTA-FEATHERSTONIAN-ENGINE/example_claims.json','experiments/AOTA-FEATHERSTONIAN-ENGINE/TRU/examples/real-lineage.case.json','docs/institution/compounding/task-a.profile.json','docs/institution/compounding/task-b.profile.json','docs/institution/compounding/STATE.json','docs/institution/compounding/evidence/experiment.json','docs/institution/compounding/evidence/continuity.json','docs/institution/compounding/evidence/task-a-execution.json','docs/institution/compounding/evidence/task-b-execution.json','docs/institution/compounding/evidence/verification.json','docs/institution/compounding/evidence/browser.json']){const p=join(rootDir,name);if(await exists(p))await add(p);}
 // Individually reviewed public experiment receipts; never archive arbitrary runtime logs.
 for(const name of ['baseline.json','baseline-aota.stdout.log','baseline-aota.stderr.log','baseline-tru.stdout.log','baseline-tru.stderr.log','experiment-initial.json','browser-initial.json','legacy-browser.json','verification-initial-failure.json','forge-repository-execution.json','verification-tests.stdout.log','verification-tests.stderr.log','verification-python-inspector.stdout.log','verification-python-inspector.stderr.log','verification-package.stdout.log','verification-institutional-exercise.stdout.log','startup-config.json','witness-phone-records.png','founder-desktop-private-evaluation.png','witness-phone-redacted-gate.png','restarted-founder-desktop.png','founder-phone-private-evaluation.png','world-desktop.png']){const p=join(rootDir,'docs/institution/compounding/evidence',name);if(await exists(p))await add(p);}
 // Only these root-generated evidence records are public release material, never arbitrary JSON envelopes.
 for(const name of ['verification.json','institutional-exercise.json','browser.json','throughput.json','evidence-index.json','frame-investigation.json','failed-stage-320.png','test-output.txt','desktop.png','phone.png','shared-desktop.png','shared-phone.png','one-button-320-world.png','one-button-412-stage.png']){const path=join(rootDir,'docs/meteor/evidence',name);if(await exists(path))await add(path);}
 const manifest={schema:'ngl.distribution.v1',note:'SHA-256 identifies bytes, not truth, authorship or external acceptance.',files:[...files].sort(([a],[b])=>a.localeCompare(b)).map(([path,bytes])=>({path,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}))};
 files.set('manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
 await mkdir(outDir,{recursive:true});const htmlPath=resolve(outDir,'play.html'),zipPath=resolve(outDir,'no-gas-labs-meteor.zip');
 await writeFile(htmlPath,html);await writeFile(zipPath,zip(files));await writeFile(resolve(outDir,'manifest.json'),files.get('manifest.json'));
 return{htmlPath,zipPath,fileCount:files.size};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const r=await buildGame();console.log(JSON.stringify(r))}
