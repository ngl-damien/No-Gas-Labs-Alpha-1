const encoder = new TextEncoder();
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const COMIC = /^\/assets\/comic\/(?:cover_a|p3|p4|p5|p10|p13)\.jpg$/;

const LAUNCH_CHECKS = [
 ['published','Published creations loaded'],
 ['artifact-bytes','Original artifact fingerprints match'],
 ['history','Version history is recoverable'],
 ['local-checks','Declared package checks passed'],
 ['documents','Complete HTML instruments present'],
 ['portable-assets','Known comic artwork packed for offline sharing']
];
const LAUNCH_LIMITATIONS = [
 'This is a technical launch rehearsal, not audience, demand or revenue evidence.',
 'No public post, deployment or external AI request was made.',
 'Original and portable-package hashes identify bytes; neither establishes truth or independent human review.'
];
const MAX_EXHIBIT_COUNT = 256;
const MAX_EXHIBIT_BYTES = 16 * 1024 * 1024;

function normalizeComicReferenceMarkup(html) {
 let normalized=String(html);
 for(let pass=0;pass<3;pass+=1){
  const next=normalized
   .replace(/&sol;/gi,'/')
   .replace(/&bsol;/gi,'/')
   .replace(/&#0*47;?/gi,'/')
   .replace(/&#x0*2f;?/gi,'/')
   .replace(/&#0*92;?/gi,'/')
   .replace(/&#x0*5c;?/gi,'/')
   .replace(/\\0*2f\s?/gi,'/')
   .replace(/\\0*5c\s?/gi,'/')
   .replace(/%([0-9a-f]{2})/gi,(_,hex)=>String.fromCharCode(Number.parseInt(hex,16)))
   .replace(/\\/g,'/');
  if(next===normalized)break;
  normalized=next;
 }
 return normalized;
}

function comicAssetOccurrences(value) {
 const source=String(value), pattern=/(?:https?:\/\/[^"'(),\s<>]*\/assets\/comic\/[^"'(),\s<>]+|\/\/[^"'(),\s<>]*\/assets\/comic\/[^"'(),\s<>]+|(?:\.\.?\/)?\/?assets\/comic\/[^"'(),\s<>]+)/gi;
 return [...source.matchAll(pattern)].map(match=>({path:match[0],index:match.index}));
}
function comicAssetMatches(value) {
 return comicAssetOccurrences(value).map(occurrence=>occurrence.path);
}
async function portableDerivationMatches(sourceHtml,portableHtml) {
 if(typeof sourceHtml!=='string'||typeof portableHtml!=='string')return false;
 const sourceScan=scanComicAssetReferences(sourceHtml);
 if(sourceScan.obfuscated)return sourceHtml===portableHtml;
 let sourceCursor=0,portableCursor=0;
 const replacements=new Map();
 for(const occurrence of comicAssetOccurrences(sourceHtml)){
  const path=occurrence.path,prefix=sourceHtml.slice(sourceCursor,occurrence.index);
  if(!portableHtml.startsWith(prefix,portableCursor))return false;
  portableCursor+=prefix.length;
  let replacement=path;
  if(COMIC.test(path)){
   if(replacements.has(path))replacement=replacements.get(path);
   else{
    if(portableHtml.startsWith(path,portableCursor))replacement=path;
    else{
     const match=/^data:image\/jpeg;base64,[a-z\d+/=]+/i.exec(portableHtml.slice(portableCursor));
     if(!match)return false;
     replacement=match[0];
     // The portable HTML receipt binds these bytes to the page, not to the
     // package artwork. Re-read the current allowlisted asset before accepting
     // an embedded replacement, so a recomputed page digest cannot swap art.
     let currentAsset;
     try{currentAsset=await browserAsset(path);}catch{return false;}
     if(currentAsset!==replacement)return false;
    }
    replacements.set(path,replacement);
   }
  }
  if(!portableHtml.startsWith(replacement,portableCursor))return false;
  portableCursor+=replacement.length;
  sourceCursor=occurrence.index+path.length;
 }
 const suffix=sourceHtml.slice(sourceCursor);
 return portableHtml.startsWith(suffix,portableCursor)&&portableCursor+suffix.length===portableHtml.length;
}
function portableAssetsPassed(sourceHtml,portableHtml) {
 const sourceScan=scanComicAssetReferences(sourceHtml),portableScan=scanComicAssetReferences(portableHtml);
 return !sourceScan.obfuscated&&!portableScan.obfuscated&&portableScan.references.length===0&&
  sourceScan.references.every(path=>COMIC.test(path)&&!portableHtml.includes(path));
}
function sameReceipt(left,right) {
 if(left===right)return true;
 if(!left||!right||typeof left!=='object'||typeof right!=='object'||Array.isArray(left)||Array.isArray(right))return false;
 const leftKeys=Object.keys(left),rightKeys=Object.keys(right);
 return leftKeys.length===rightKeys.length&&leftKeys.every(key=>Object.hasOwn(right,key)&&left[key]===right[key]);
}

function scanComicAssetReferences(html) {
 const source=String(html), normalized=normalizeComicReferenceMarkup(source);
 const rawMatches=comicAssetMatches(source), normalizedMatches=comicAssetMatches(normalized);
 const obfuscated=rawMatches.length!==normalizedMatches.length||
  rawMatches.some((path,index)=>path!==normalizedMatches[index]);
 return {references:[...new Set([...rawMatches,...normalizedMatches])],obfuscated};
}

function announcementFor(creations) {
 return 'I built a world with AI and a browser. This exhibition has '+creations.length+
  ' published creations: '+creations.map(c=>c.title).join(', ')+
  '. Enter, try them, and tell me what breaks. Built by Damien Featherstone / No_Gas_Labs™. Local rehearsal; public hosting is the next release step.';
}

function hasExactKeys(value, required, optional=[]) {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const keys=Object.keys(value);
 return required.every(key=>Object.prototype.hasOwnProperty.call(value,key))&&
  keys.every(key=>required.includes(key)||optional.includes(key));
}

function validReceiptShape(value, expectedSize) {
 return hasExactKeys(value,['algorithm','digest','size'])&&value.algorithm==='sha256'&&
  typeof value.digest==='string'&&/^[a-f0-9]{64}$/.test(value.digest)&&
  Number.isSafeInteger(value.size)&&value.size>=0&&
  (expectedSize===undefined||value.size===expectedSize);
}

async function assertLaunchReport(world,report) {
 const invalid=()=>{throw new Error('Launch rehearsal report is inconsistent; rerun before sharing.');};
 const creations=Array.isArray(world?.creations)?world.creations:[];
 if(!hasExactKeys(report,['schema','title','tagline','createdAt','checks','ready','artifactCount','exhibit','announcement','limitations'])||
  report.schema!=='ngl.launch-rehearsal.v1'||
  typeof report.title!=='string'||report.title.length>120||
  typeof report.tagline!=='string'||report.tagline.length>240||
  typeof report.createdAt!=='string'||
  !Number.isFinite(Date.parse(report.createdAt))||
  new Date(report.createdAt).toISOString()!==report.createdAt||
  typeof report.ready!=='boolean'||
  !Number.isSafeInteger(report.artifactCount)||report.artifactCount<0||report.artifactCount>MAX_EXHIBIT_COUNT||
  report.artifactCount!==creations.length||
  !Array.isArray(report.exhibit)||report.exhibit.length!==creations.length||
  !Array.isArray(report.checks)||report.checks.length!==LAUNCH_CHECKS.length||
  typeof report.announcement!=='string'||
  !Array.isArray(report.limitations)||
  report.limitations.length!==LAUNCH_LIMITATIONS.length||
  !report.limitations.every((value,index)=>value===LAUNCH_LIMITATIONS[index]))invalid();

 const records=creations.flatMap(creation=>[...(Array.isArray(creation?.versions)?creation.versions:[]),creation]);
 const byteChecks=await Promise.all(records.map(validBytes));
 const history=creations.every(creation=>Number.isSafeInteger(creation?.version)&&creation.version>=1&&
  Array.isArray(creation.versions)&&creation.versions.length===creation.version-1&&
  creation.versions.every((version,index)=>version.id===creation.id&&version.version===index+1));
 const localChecks=creations.length>0&&creations.every(creation=>Array.isArray(creation.checks)&&creation.checks.length>0&&creation.checks.every(check=>check.passed===true));
 const documents=creations.length>0&&creations.every(creation=>typeof creation.html==='string'&&/^\s*<!doctype html>/i.test(creation.html));
 const artifactBytes=records.length>0&&byteChecks.every(Boolean);
 let portable=true;

 const ids=new Set();
 for(let index=0;index<report.exhibit.length;index+=1){
  const entry=report.exhibit[index],creation=creations[index];
  if(!hasExactKeys(entry,['id','title','intent','kind','version','html','originalReceipt','portableReceipt'])||
   typeof entry.id!=='string'||!entry.id.trim()||entry.id.length>2048||ids.has(entry.id)||
   typeof entry.title!=='string'||entry.title.length>120||
   typeof entry.kind!=='string'||!entry.kind.trim()||entry.kind.length>64||
   (entry.intent!==undefined&&(typeof entry.intent!=='string'||entry.intent.length>240))||
   !Number.isSafeInteger(entry.version)||entry.version<1||
   typeof entry.html!=='string'||
   entry.id!==creation?.id||entry.title!==creation?.title||entry.intent!==creation?.intent||
   entry.kind!==creation?.kind||entry.version!==creation?.version||
   !sameReceipt(entry.originalReceipt,creation?.receipt))invalid();
  ids.add(entry.id);

  const sourceHtml=typeof creation.html==='string'?creation.html:'';
  if(!await portableDerivationMatches(sourceHtml,entry.html))invalid();
  if(!portableAssetsPassed(sourceHtml,entry.html))portable=false;

  const size=encoder.encode(entry.html).byteLength;
  if(size>MAX_EXHIBIT_BYTES)invalid();
  const actualReceipt=await receipt(entry.html);
  if(!validReceiptShape(entry.portableReceipt,size)||entry.portableReceipt.digest!==actualReceipt.digest)invalid();
  if(artifactBytes&&!validReceiptShape(entry.originalReceipt,encoder.encode(sourceHtml).byteLength))invalid();
 }

 const published=creations.length>0&&creations.length<=12;
 const expectedChecks=[
  ['published','Published creations loaded',published,creations.length+' current creations; private drafts stay in the workshop.'],
  ['artifact-bytes','Original artifact fingerprints match',artifactBytes,byteChecks.filter(Boolean).length+' / '+records.length+' current and historical packages match their SHA-256 and UTF-8 size.'],
  ['history','Version history is recoverable',history,'Prior versions retain their own bytes; rehearsal awards no XP.'],
  ['local-checks','Declared package checks passed',localChecks,'Packaging checks do not prove that every interaction works.'],
  ['documents','Complete HTML instruments present',documents,'The stage opens actual artifacts in isolated frames.'],
  ['portable-assets','Known comic artwork packed for offline sharing',portable,portable?'The exhibition carries the supplied artwork it needs.':'Some artwork could not be inlined. Reopen on the included server and rehearse again.']
 ];
 for(let index=0;index<expectedChecks.length;index+=1){
  const [id,label,passed,detail]=expectedChecks[index],check=report.checks[index];
  if(!hasExactKeys(check,['id','label','passed','detail'])||
   check.id!==id||check.label!==label||check.passed!==passed||check.detail!==detail)invalid();
 }
 if(report.ready!==expectedChecks.every(check=>check[2])||
  report.announcement!==announcementFor(report.exhibit))invalid();
}

async function receipt(html) {
 const bytes=encoder.encode(html), digest=await crypto.subtle.digest('SHA-256',bytes);
 return {algorithm:'sha256',digest:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join(''),size:bytes.byteLength};
}
async function validBytes(artifact) {
 if(typeof artifact?.html!=='string'||!validReceiptShape(artifact.receipt))return false;
 const actual=await receipt(artifact.html);
 return actual.digest===artifact.receipt.digest&&actual.size===artifact.receipt.size;
}
async function browserAsset(path) {
 const embedded=globalThis.NGL_ASSETS?.pages?.find(page=>page.path===path);
 if(embedded?.src?.startsWith('data:image/jpeg;base64,'))return embedded.src;
 if(typeof location==='undefined'||location.protocol==='file:')return null;
 const response=await fetch(path,{credentials:'omit'});
 if(!response.ok)throw new Error(`Could not pack ${path}`);
 const bytes=new Uint8Array(await response.arrayBuffer());
 let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return `data:image/jpeg;base64,${btoa(binary)}`;
}

/** Local technical rehearsal. It measures package facts, never demand, reach or external acceptance. */
export async function rehearseLaunch(world,{title='Made from almost nothing.',tagline='One Founder. AI as labor. A world you can actually enter.',now,loadAsset=browserAsset}={}) {
 const creations=Array.isArray(world?.creations)?world.creations:[], records=creations.flatMap(c=>[...(Array.isArray(c.versions)?c.versions:[]),c]);
 const byteChecks=await Promise.all(records.map(validBytes));
 const history=creations.every(c=>Number.isSafeInteger(c.version)&&c.version>=1&&Array.isArray(c.versions)&&c.versions.length===c.version-1&&c.versions.every((v,i)=>v.id===c.id&&v.version===i+1));
 const checks=[
  {id:'published',label:'Published creations loaded',passed:creations.length>0&&creations.length<=12,detail:`${creations.length} current creations; private drafts stay in the workshop.`},
  {id:'artifact-bytes',label:'Original artifact fingerprints match',passed:records.length>0&&byteChecks.every(Boolean),detail:`${byteChecks.filter(Boolean).length} / ${records.length} current and historical packages match their SHA-256 and UTF-8 size.`},
  {id:'history',label:'Version history is recoverable',passed:history,detail:'Prior versions retain their own bytes; rehearsal awards no XP.'},
  {id:'local-checks',label:'Declared package checks passed',passed:creations.length>0&&creations.every(c=>Array.isArray(c.checks)&&c.checks.length>0&&c.checks.every(x=>x.passed===true)),detail:'Packaging checks do not prove that every interaction works.'},
  {id:'documents',label:'Complete HTML instruments present',passed:creations.length>0&&creations.every(c=>typeof c.html==='string'&&/^\s*<!doctype html>/i.test(c.html)),detail:'The stage opens actual artifacts in isolated frames.'}
 ];
 const exhibit=[], cache=new Map();let portable=true;
 for(const c of creations){
  let html=c.html||'';
  const scan=scanComicAssetReferences(html);
  if(scan.obfuscated)portable=false;
  for(const path of scan.references){
   if(scan.obfuscated||!COMIC.test(path)){portable=false;continue;}
   try{
    if(!cache.has(path))cache.set(path,await loadAsset(path));
    const data=cache.get(path);
    if(typeof data!=='string'||!/^data:image\/jpeg;base64,[a-z\d+/=]+$/i.test(data)){portable=false;continue;}
    html=html.split(path).join(data);
   }catch{portable=false;}
  }
  exhibit.push({id:c.id,title:c.title,intent:c.intent,kind:c.kind,version:c.version,html,originalReceipt:c.receipt,portableReceipt:await receipt(html)});
 }
 checks.push({id:'portable-assets',label:'Known comic artwork packed for offline sharing',passed:portable,detail:portable?'The exhibition carries the supplied artwork it needs.':'Some artwork could not be inlined. Reopen on the included server and rehearse again.'});
 const ready=checks.every(c=>c.passed),createdAt=now||new Date().toISOString();
 return {schema:'ngl.launch-rehearsal.v1',title:String(title).slice(0,120),tagline:String(tagline).slice(0,240),createdAt,checks,ready,artifactCount:creations.length,exhibit,
  announcement:announcementFor(exhibit),
  limitations:[...LAUNCH_LIMITATIONS]};
}

/** A portable public exhibition; only explicitly selected published artifacts enter this document. */
export async function makeLaunchPage(world,report) {
 if(report?.schema!=='ngl.launch-rehearsal.v1')throw new Error('Run a launch rehearsal first.');await assertLaunchReport(world,report);
 const exhibit=report.exhibit||[];
 const cards=exhibit.map((c,i)=>`<article><div class="number">0${i+1} / ${escapeHTML(c.kind)} / V${c.version}</div><h2>${escapeHTML(c.title)}</h2><p>${escapeHTML(c.intent)}</p><details><summary>Enter this creation ↗</summary><template><iframe title="${escapeHTML(c.title)}" sandbox="allow-scripts allow-forms allow-downloads" srcdoc="${escapeHTML(c.html)}"></iframe></template></details><small>Original ${escapeHTML(c.originalReceipt?.digest||'unknown')}<br>Portable ${escapeHTML(c.portableReceipt?.digest||'unknown')}</small></article>`).join('');
 const checkList=report.checks.map(c=>`<li class="${c.passed?'pass':'fail'}">${c.passed?'✓':'×'} ${escapeHTML(c.label)} <span>${escapeHTML(c.detail)}</span></li>`).join('');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-src 'self' about: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"><title>${escapeHTML(report.title)} · No_Gas_Labs</title><style>
 :root{font:17px/1.6 system-ui,sans-serif;color:#252c2a;background:#efe4c5}*{box-sizing:border-box}body{margin:0}header{padding:6vw;min-height:70vh;display:flex;flex-direction:column;justify-content:center;border-bottom:4px solid}header:before{content:'NO_GAS_LABS™ / THE PUBLIC WORKS';font-size:.72rem;letter-spacing:.24em;color:#176e69}h1{font:clamp(3.4rem,10vw,8rem)/.93 Georgia,serif;max-width:1000px;margin:.5em 0;letter-spacing:-.055em}h1 em{color:#ad4935}header p{max-width:620px;font-size:1.3rem}header a,summary{display:block;cursor:pointer;width:fit-content;background:#e9a833;border:2px solid #252c2a;padding:12px 20px;color:inherit;font-weight:700;text-decoration:none;box-shadow:4px 4px #252c2a}main{padding:5vw;max-width:1500px;margin:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:35px}article{padding:28px;border:2px solid;background:#fff8e3;box-shadow:8px 8px #3c7974}h2{font:2rem/1.1 Georgia,serif;overflow-wrap:anywhere}.number{letter-spacing:.12em;text-transform:uppercase;font-size:.72rem;color:#a54b38}iframe{display:block;width:100%;height:70vh;margin-top:20px;border:2px solid;background:#fff}small{display:block;font:10px/1.7 monospace;overflow-wrap:anywhere;margin-top:25px}section{padding:5vw;background:#273d3a;color:#f1e7ca}section h2{font-size:2.7rem}ul{padding:0;list-style:none}li{margin:15px 0;padding-bottom:15px;border-bottom:1px solid #ffffff33}li span{display:block;font-size:.85rem;opacity:.8}.pass{color:#c0e8c5}.fail{color:#ffb496}footer{padding:30px 5vw;font-size:.8rem}button{padding:12px;font:inherit;border:2px solid;background:#e9a833;cursor:pointer}textarea{width:100%;min-height:150px;font:inherit;padding:15px}a:focus-visible,summary:focus-visible,button:focus-visible{outline:4px solid #c75339;outline-offset:4px}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
 </style></head><body><header><h1>${escapeHTML(report.title)}</h1><p>${escapeHTML(report.tagline)}</p><a href="#works">Enter the exhibition ↗</a><p style="font-size:.8rem">${escapeHTML(world?.founderName||'Damien Featherstone')} · ${exhibit.length} published creations · self-contained rehearsal edition</p></header><main id="works">${cards||'<p>The first work is still waiting to be made.</p>'}</main><section><div class="number">THE RECEIPT / LOCAL TECHNICAL REHEARSAL</div><h2>${report.ready?'Ready to show a human.':'The rehearsal found work to do.'}</h2><ul>${checkList}</ul><p>${escapeHTML(report.limitations.join(' '))}</p><label for="announcement">An announcement grounded in this exhibit</label><textarea id="announcement" readonly>${escapeHTML(report.announcement)}</textarea><button id="copy" type="button">Select announcement</button></section><footer>Damien Featherstone · Neophyte Founder™ · No_Gas_Labs™ / Generated ${escapeHTML(report.createdAt)}. Witness feedback is an input for the next version.</footer><script>for(const details of document.querySelectorAll('details'))details.addEventListener('toggle',()=>{const template=details.querySelector('template');if(details.open&&template)template.replaceWith(template.content.cloneNode(true))});document.getElementById('copy').addEventListener('click',()=>document.getElementById('announcement').select());</script></body></html>`;
}
