const encoder = new TextEncoder();
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const COMIC = /^\/assets\/comic\/(?:cover_a|p3|p4|p5|p10|p13)\.jpg$/;
async function receipt(html) {
 const bytes=encoder.encode(html), digest=await crypto.subtle.digest('SHA-256',bytes);
 return {algorithm:'sha256',digest:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join(''),size:bytes.byteLength};
}
async function validBytes(artifact) {
 if(typeof artifact?.html!=='string'||artifact.receipt?.algorithm!=='sha256')return false;
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
  const paths=[...new Set(html.match(/\/assets\/comic\/[\w.-]+\.jpg/g)||[])];
  for(const path of paths){
   if(!COMIC.test(path)){portable=false;continue;}
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
  announcement:`I built a world with AI and a browser. This exhibition has ${creations.length} published creations: ${creations.map(c=>c.title).join(', ')}. Enter, try them, and tell me what breaks. Built by Damien Featherstone / No_Gas_Labs™. Local rehearsal; public hosting is the next release step.`,
  limitations:['This is a technical launch rehearsal, not audience, demand or revenue evidence.','No public post, deployment or external AI request was made.','Original and portable-package hashes identify bytes; neither establishes truth or independent human review.']};
}

/** A portable public exhibition; only explicitly selected published artifacts enter this document. */
export function makeLaunchPage(world,report) {
 if(report?.schema!=='ngl.launch-rehearsal.v1')throw new Error('Run a launch rehearsal first.');
 const exhibit=report.exhibit||[];
 const cards=exhibit.map((c,i)=>`<article><div class="number">0${i+1} / ${escapeHTML(c.kind)} / V${c.version}</div><h2>${escapeHTML(c.title)}</h2><p>${escapeHTML(c.intent)}</p><details><summary>Enter this creation ↗</summary><template><iframe title="${escapeHTML(c.title)}" sandbox="allow-scripts allow-forms allow-downloads" srcdoc="${escapeHTML(c.html)}"></iframe></template></details><small>Original ${escapeHTML(c.originalReceipt?.digest||'unknown')}<br>Portable ${escapeHTML(c.portableReceipt?.digest||'unknown')}</small></article>`).join('');
 const checkList=report.checks.map(c=>`<li class="${c.passed?'pass':'fail'}">${c.passed?'✓':'×'} ${escapeHTML(c.label)} <span>${escapeHTML(c.detail)}</span></li>`).join('');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-src 'self' about: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"><title>${escapeHTML(report.title)} · No_Gas_Labs</title><style>
 :root{font:17px/1.6 system-ui,sans-serif;color:#252c2a;background:#efe4c5}*{box-sizing:border-box}body{margin:0}header{padding:6vw;min-height:70vh;display:flex;flex-direction:column;justify-content:center;border-bottom:4px solid}header:before{content:'NO_GAS_LABS™ / THE PUBLIC WORKS';font-size:.72rem;letter-spacing:.24em;color:#176e69}h1{font:clamp(3.4rem,10vw,8rem)/.93 Georgia,serif;max-width:1000px;margin:.5em 0;letter-spacing:-.055em}h1 em{color:#ad4935}header p{max-width:620px;font-size:1.3rem}header a,summary{display:block;cursor:pointer;width:fit-content;background:#e9a833;border:2px solid #252c2a;padding:12px 20px;color:inherit;font-weight:700;text-decoration:none;box-shadow:4px 4px #252c2a}main{padding:5vw;max-width:1500px;margin:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:35px}article{padding:28px;border:2px solid;background:#fff8e3;box-shadow:8px 8px #3c7974}h2{font:2rem/1.1 Georgia,serif;overflow-wrap:anywhere}.number{letter-spacing:.12em;text-transform:uppercase;font-size:.72rem;color:#a54b38}iframe{display:block;width:100%;height:70vh;margin-top:20px;border:2px solid;background:#fff}small{display:block;font:10px/1.7 monospace;overflow-wrap:anywhere;margin-top:25px}section{padding:5vw;background:#273d3a;color:#f1e7ca}section h2{font-size:2.7rem}ul{padding:0;list-style:none}li{margin:15px 0;padding-bottom:15px;border-bottom:1px solid #ffffff33}li span{display:block;font-size:.85rem;opacity:.8}.pass{color:#c0e8c5}.fail{color:#ffb496}footer{padding:30px 5vw;font-size:.8rem}button{padding:12px;font:inherit;border:2px solid;background:#e9a833;cursor:pointer}textarea{width:100%;min-height:150px;font:inherit;padding:15px}a:focus-visible,summary:focus-visible,button:focus-visible{outline:4px solid #c75339;outline-offset:4px}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
 </style></head><body><header><h1>${escapeHTML(report.title)}</h1><p>${escapeHTML(report.tagline)}</p><a href="#works">Enter the exhibition ↗</a><p style="font-size:.8rem">${escapeHTML(world?.founderName||'Damien Featherstone')} · ${exhibit.length} published creations · self-contained rehearsal edition</p></header><main id="works">${cards||'<p>The first work is still waiting to be made.</p>'}</main><section><div class="number">THE RECEIPT / LOCAL TECHNICAL REHEARSAL</div><h2>${report.ready?'Ready to show a human.':'The rehearsal found work to do.'}</h2><ul>${checkList}</ul><p>${escapeHTML(report.limitations.join(' '))}</p><label for="announcement">An announcement grounded in this exhibit</label><textarea id="announcement" readonly>${escapeHTML(report.announcement)}</textarea><button id="copy" type="button">Select announcement</button></section><footer>Damien Featherstone · Neophyte Founder™ · No_Gas_Labs™ / Generated ${escapeHTML(report.createdAt)}. Witness feedback is an input for the next version.</footer><script>for(const details of document.querySelectorAll('details'))details.addEventListener('toggle',()=>{const template=details.querySelector('template');if(details.open&&template)template.replaceWith(template.content.cloneNode(true))});document.getElementById('copy').addEventListener('click',()=>document.getElementById('announcement').select());</script></body></html>`;
}
