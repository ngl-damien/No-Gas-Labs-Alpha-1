const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const js = value => JSON.stringify(value).replace(/</g,'\\u003c');
const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; media-src data:; connect-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const style = `:root{color-scheme:light;font-family:Georgia,serif;color:#233d3a;background:#faf3df}*{box-sizing:border-box}body{margin:0;padding:clamp(16px,5vw,42px);min-height:100vh}header{border-bottom:2px solid #233d3a;padding-bottom:17px;margin-bottom:23px}.eyebrow{font:700 11px system-ui;letter-spacing:2px;text-transform:uppercase;color:#97662f}h1{font-size:clamp(29px,6vw,48px);line-height:1.05;margin:9px 0 12px}p{line-height:1.6;max-width:65ch}.intent{color:#5e6c61}button,input,textarea{font:inherit}button{background:#245e57;color:#fff6df;border:1px solid #183e39;border-radius:4px;padding:11px 17px;cursor:pointer;box-shadow:2px 3px 0 #c9b899}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #d56635;outline-offset:3px}button:disabled{opacity:.45;cursor:default}input,textarea{width:100%;padding:12px;border:1px solid #acb4a2;background:#fffaf0;border-radius:4px;color:#233d3a}label{display:block;margin:18px 0 7px;font:600 12px system-ui;letter-spacing:1px}nav,.controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.note,footer{font:12px/1.6 system-ui;color:#677166}footer{border-top:1px solid #cabc9e;margin-top:30px;padding-top:15px}.card{background:#fffaf0;border:1px solid #c8b99a;border-radius:7px;padding:20px;margin:15px 0}.status{font:12px system-ui;color:#9b4b29;min-height:1.5em}a{color:#245e57}`;
function documentFor(title,intent,body,script='') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>${esc(title)}</title><style>${style}</style></head><body><header><div class="eyebrow">No_Gas_Labs™ · playable creation</div><h1>${esc(title)}</h1><p class="intent">${esc(intent)}</p></header>${body}<footer>A locally authored artifact. Interactions run inside this sandbox. No live AI, network requests, demand or real-world claims are implied.</footer>${script?`<script>${script}\n;document.documentElement.dataset.nglReady='true';</script>`:''}</body></html>`;
}
function comic(title,intent) {
  const configured=globalThis.NGL_ASSETS?.pages;
  const originals=[{src:'/assets/comic/cover_a.jpg',label:'Cover A'},...['3','4','5','10','13'].map(n=>({src:`/assets/comic/p${n}.jpg`,label:`Original page ${n}`}))];
  const pages=(Array.isArray(configured)&&configured.length?configured:originals).map((p,i)=>typeof p==='string'?{src:p,label:i===0?'Cover':`Recovered page ${i}`} : {src:p.src||p.url,label:p.label||p.title||`Page ${i+1}`});
  const body=`<p class="note">From Damien Featherstone’s recovered No_Gas_Labs comic pages. Browse the actual artwork; missing pages remain visibly unavailable.</p><div class="controls"><button id="previous">← Previous</button><span id="page-count" aria-live="polite"></span><button id="next">Next →</button><button id="zoom">Enlarge</button></div><figure style="margin:22px auto;max-width:760px"><img id="page" alt="" style="width:100%;height:auto;border:1px solid #c8b99a;border-radius:5px;background:#efe4c9"><figcaption id="caption" class="note"></figcaption><p id="missing" hidden>That recovered page is unavailable in this copy. The reader still works; use an exhibition export that includes the original images.</p></figure><details><summary>Reading the archive</summary><p>These pages are source artifacts, not proof of the claims a character makes. A publication here creates a versioned game building; its receipt verifies the document bytes.</p></details>`;
  return documentFor(title,intent,body,`const pages=${js(pages)};let index=0,large=false;const q=id=>document.getElementById(id);function render(){const p=pages[index];q('missing').hidden=true;q('page').src=p.src;q('page').alt=p.label+' · original No_Gas_Labs comic artwork';q('caption').textContent=p.label;q('page-count').textContent=(index+1)+' / '+pages.length;q('previous').disabled=index===0;q('next').disabled=index===pages.length-1}q('page').onerror=()=>{q('missing').hidden=false};q('previous').onclick=()=>{index--;render()};q('next').onclick=()=>{index++;render()};q('zoom').onclick=()=>{large=!large;q('page').parentElement.style.maxWidth=large?'1400px':'760px';q('zoom').textContent=large?'Fit page':'Enlarge'};render();`);
}
function loom(title,intent) {
  const body=`<p>Turn a string of marks into a small piece of music. Every Unicode character chooses its own pitch. Add your words, then listen.</p><label for="score">Your score</label><textarea id="score" rows="3">No_Gas_Labs 🐚 → ∞</textarea><div class="controls" style="margin-top:15px"><button id="play">▶ Play the loom</button><button id="stop">Stop</button><button id="save">↓ Save score</button></div><div id="threads" class="card" style="font-size:29px;letter-spacing:7px;overflow-wrap:anywhere;min-height:120px" aria-hidden="true"></div><p id="status" class="status" role="status">Sound begins only when you press Play.</p>`;
  return documentFor(title,intent,body,`let context,timers=[];const q=id=>document.getElementById(id);const chars=()=>Array.from(q('score').value).slice(0,120);function render(){q('threads').replaceChildren(...chars().map(c=>{const s=document.createElement('span');s.textContent=c;s.style.color=['#ba562e','#25665e','#9c822c'][c.codePointAt(0)%3];return s}))}function stop(){timers.forEach(clearTimeout);timers=[];if(context){context.close();context=null}q('status').textContent='The loom is quiet.'}q('score').oninput=render;q('play').onclick=async()=>{stop();const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio){q('status').textContent='Web Audio is unavailable in this browser.';return}context=new Audio();await context.resume();const notes=chars();q('status').textContent='Playing '+notes.length+' Unicode notes.';notes.forEach((c,i)=>{const o=context.createOscillator(),g=context.createGain(),t=context.currentTime+i*.19;o.type='sine';o.frequency.value=130.81*Math.pow(2,(c.codePointAt(0)%24)/12);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.15,t+.015);g.gain.exponentialRampToValueAtTime(.001,t+.3);o.connect(g);g.connect(context.destination);o.start(t);o.stop(t+.32);timers.push(setTimeout(()=>{const spans=q('threads').children;for(let n=0;n<spans.length;n++)spans[n].style.background=n===i?'#eed099':''},i*190))});timers.push(setTimeout(()=>{q('status').textContent='The last thread has sounded.'},notes.length*190+350))};q('stop').onclick=stop;q('save').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({schema:'ngl.unicode-score.v1',score:q('score').value,method:'codePoint modulo 24; 130.81 Hz equal temperament; 190ms spacing'},null,2)],{type:'application/json'}));a.download='unicode-loom-score.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};render();`);
}
function observatory(title,intent) {
  const body=`<p>A place to hold a falsifiable claim beside its source, possible counterexample, uncertainty and next test. This is a local notebook: it does not fetch URLs, inspect files, call a model or adjudicate claims. Notes remain local to this open artifact. Download a backup before leaving; reopen the published Observatory and restore that file to continue. Publishing the blank template does not publish later notes.</p><div id="observations" aria-live="polite"></div><section class="card"><label for="claim">Claim under test</label><textarea id="claim" maxlength="1000" rows="2" placeholder="State one specific, falsifiable claim." required></textarea><label for="source-kind">Source class · author-selected</label><select id="source-kind"><option value="unspecified">Not classified</option><option value="direct-observation">Direct observation</option><option value="primary-source">Primary source / document</option><option value="secondary-source">Secondary source / analysis</option><option value="tool-output">Tool output / execution receipt</option><option value="user-report">User-reported</option><option value="model-assertion">Model assertion (lead only; not evidence)</option></select><label for="source">Source / attribution</label><input id="source" maxlength="1000" placeholder="Document, author, URL, page or observation reference" required><label for="falsifier">Possible falsifier / counterexample</label><textarea id="falsifier" maxlength="1000" rows="2" placeholder="What observation would weaken or disprove the claim?"></textarea><label for="uncertainty">Unknowns / uncertainty</label><textarea id="uncertainty" maxlength="1000" rows="2" placeholder="What remains unresolved or disputed?"></textarea><label for="next-test">Next discriminating test</label><textarea id="next-test" maxlength="1000" rows="2" placeholder="What small, observable test could resolve part of this?"></textarea><p class="note">A model assertion is a lead only, never sufficient evidence. A receipt can identify bytes without establishing the truth of their contents. Blank fields remain explicitly unrecorded.</p><div class="controls" style="margin-top:18px"><button id="add-observation">+ Add observation</button><button id="download">↓ Download evidence notes</button></div><label for="backup-file">Restore a downloaded notebook</label><input id="backup-file" type="file" accept="application/json,.json"><button id="restore" type="button">+ Add notes from backup</button><p class="note">Restoration appends to the open notebook; it never replaces current notes. Imported entries remain author-entered local notes, not canonical world events.</p><p id="status" class="status" role="status"></p></section>`;
  const script=`const q=id=>document.getElementById(id);
const MAX_OBSERVATIONS=100,MAX_FIELD_CHARACTERS=500;
const sourceKindLabels=Object.freeze({
  unspecified:'Not classified',
  'direct-observation':'Direct observation',
  'primary-source':'Primary source / document',
  'secondary-source':'Secondary source / analysis',
  'tool-output':'Tool output / execution receipt',
  'user-report':'User-reported',
  'model-assertion':'Model assertion (lead only; not evidence)'
});
const observations=[];
const restoredObservations=new WeakSet();
const MAX_IMPORT_BYTES=2*1024*1024;
let restoringBackup=false;
function exactKeys(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const actual=Object.keys(value).sort(),expected=[...keys].sort();
  return actual.length===expected.length&&actual.every((key,index)=>key===expected[index]);
}
function requiredBackupText(value){
  return typeof value==='string'&&value.length>0&&value.trim()===value&&bounded(value);
}
function optionalBackupText(value){
  if(value===null)return null;
  return requiredBackupText(value)?value:undefined;
}
function restoreBackup(value){
  if(!exactKeys(value,['schema','assurance','observations'])||value.schema!=='ngl.source-observatory.v2')return null;
  if(!exactKeys(value.assurance,['sourceRetrieval','independentVerification','modelAssertions','execution']))return null;
  if(value.assurance.sourceRetrieval!=='NOT_PERFORMED'||
     value.assurance.independentVerification!=='NOT_PERFORMED'||
     value.assurance.modelAssertions!=='LEADS_ONLY'||
     value.assurance.execution!=='NOT_EXECUTED')return null;
  if(!Array.isArray(value.observations)||value.observations.length<1||value.observations.length>MAX_OBSERVATIONS)return null;
  const restored=[];
  for(const item of value.observations){
    if(!exactKeys(item,['claim','source','sourceKind','falsifier','uncertainty','nextTest'])||
       !requiredBackupText(item.claim)||!requiredBackupText(item.source)||
       typeof item.sourceKind!=='string'||!Object.hasOwn(sourceKindLabels,item.sourceKind))return null;
    const falsifier=optionalBackupText(item.falsifier);
    const uncertainty=optionalBackupText(item.uncertainty);
    const nextTest=optionalBackupText(item.nextTest);
    if(falsifier===undefined||uncertainty===undefined||nextTest===undefined)return null;
    restored.push({claim:item.claim,source:item.source,sourceKind:item.sourceKind,falsifier,uncertainty,nextTest});
  }
  return restored;
}
function bounded(value){return typeof value==='string'&&Array.from(value).length<=MAX_FIELD_CHARACTERS}
function render(){
  if(!observations.length){
    const empty=document.createElement('p');
    empty.className='note';
    empty.textContent='No observations recorded. The Observatory does not invent a starter claim or source.';
    q('observations').replaceChildren(empty);
    return;
  }
  q('observations').replaceChildren(...observations.map((item,index)=>{
    const card=document.createElement('article');card.className='card';
    const heading=document.createElement('h2');heading.textContent=(index+1)+'. '+item.claim;
    const kind=document.createElement('p');kind.className='note';kind.textContent='Source class: '+sourceKindLabels[item.sourceKind]+' · author-selected';
    const source=document.createElement('p');source.textContent='Source: '+item.source;
    const falsifier=document.createElement('p');falsifier.textContent='Possible falsifier: '+(item.falsifier||'Not recorded');
    const uncertainty=document.createElement('p');uncertainty.textContent='Unknown / uncertainty: '+(item.uncertainty||'Not recorded');
    const nextTest=document.createElement('p');nextTest.textContent='Next test: '+(item.nextTest||'Not recorded');
    const attribution=document.createElement('p');attribution.className='note';attribution.textContent=restoredObservations.has(item)
      ?'Restored from a user-selected backup · original authorship not independently verified'
      :'Entered in this open artifact · not independently verified';
    card.append(heading,kind,source,falsifier,uncertainty,nextTest,attribution);
    if(item.sourceKind==='model-assertion'||item.sourceKind==='tool-output'){
      const warning=document.createElement('p');warning.className='status';
      warning.textContent=item.sourceKind==='model-assertion'
        ?'Model assertion: lead only, not evidence.'
        :'Tool output: attributed output, not independent verification or a truth verdict.';
      card.append(warning);
    }
    return card;
  }));
}
q('add-observation').onclick=()=>{
  const claim=q('claim').value.trim(),source=q('source').value.trim();
  const falsifier=q('falsifier').value.trim(),uncertainty=q('uncertainty').value.trim(),nextTest=q('next-test').value.trim();
  const values=[claim,source,falsifier,uncertainty,nextTest];
  if(!claim||!source){q('status').textContent='A claim and its source or attribution are required. Other fields may remain blank.';return}
  if(values.some(value=>!bounded(value))){q('status').textContent='Each field is limited to 500 Unicode code points.';return}
  if(observations.length>=MAX_OBSERVATIONS){q('status').textContent='The local notebook holds at most 100 observations. Download it before starting another.';return}
  const sourceKind=q('source-kind').value;
  if(!Object.hasOwn(sourceKindLabels,sourceKind)){q('status').textContent='Choose a listed source class.';return}
  observations.push({
    claim,source,sourceKind,
    falsifier:falsifier||null,
    uncertainty:uncertainty||null,
    nextTest:nextTest||null
  });
  for(const id of ['claim','source','falsifier','uncertainty','next-test'])q(id).value='';
  q('source-kind').value='unspecified';
  q('status').textContent='Observation added to this open artifact. No source was fetched or independently verified.';
  render();
};
q('download').onclick=()=>{
  const notes={
    schema:'ngl.source-observatory.v2',
    assurance:{
      sourceRetrieval:'NOT_PERFORMED',
      independentVerification:'NOT_PERFORMED',
      modelAssertions:'LEADS_ONLY',
      execution:'NOT_EXECUTED'
    },
    observations:observations.map(item=>({...item}))
  };
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(notes,null,2)],{type:'application/json'}));
  a.download='source-observatory.json';a.click();
  q('status').textContent='Evidence notes downloaded. No source was retrieved, verified or adjudicated.';
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
q('restore').onclick=async()=>{
  if(restoringBackup)return;
  restoringBackup=true;
  q('restore').disabled=true;
  try{
    const file=q('backup-file').files?.[0];
  if(!file){q('status').textContent='Choose a previously downloaded Source Observatory JSON backup first.';return}
  if(!Number.isSafeInteger(file.size)||file.size<0||file.size>MAX_IMPORT_BYTES){
    q('status').textContent='Backup file must be no larger than 2 MiB. No notes were imported.';return;
  }
  let raw;
  try{
    if(typeof file.text!=='function')throw new Error('File text reading is unavailable');
    raw=await file.text();
  }catch{
    q('status').textContent='The selected backup could not be read. Existing notes were left unchanged.';return;
  }
  if(typeof raw!=='string'||new Blob([raw]).size>MAX_IMPORT_BYTES){
    q('status').textContent='Backup content exceeds 2 MiB. Existing notes were left unchanged.';return;
  }
  let parsed;
  try{parsed=JSON.parse(raw)}catch{
    q('status').textContent='The selected file is not valid JSON. Existing notes were left unchanged.';return;
  }
  const restored=restoreBackup(parsed);
  if(!restored){
    q('status').textContent='Backup schema or assurance is not supported. Existing notes were left unchanged.';return;
  }
  if(observations.length+restored.length>MAX_OBSERVATIONS){
    q('status').textContent='Import would exceed the 100-observation limit. Existing notes were left unchanged.';return;
  }
  restored.forEach(item=>restoredObservations.add(item));
  observations.push(...restored);
  q('backup-file').value='';
  render();
    q('status').textContent='Added '+restored.length+' local observation(s). Source retrieval and independent verification remain NOT_PERFORMED; imported notes are not canonical events, evidence, XP or approval.';
  }finally{
    restoringBackup=false;
    q('restore').disabled=false;
  }
};
render();`;
  return documentFor(title,intent,body,script);
}
function custom(title,intent,html) {
  if(html?.trim())return documentFor(title,intent,`<section>${html}</section>`);
  return documentFor(title,intent,`<p>This is a portable AI work request, ready to carry to a provider you choose. It does not contact or claim to run an AI.</p><label for="request">Your request</label><textarea id="request" rows="7">${esc(intent||'Explore a useful, falsifiable improvement to this institution. State assumptions, source evidence, uncertainty and a testable next step.')}</textarea><button id="download" style="margin-top:18px">↓ Carry this request</button><p id="status" class="status" role="status"></p>`,`document.getElementById('download').onclick=()=>{const request={schema:'ngl.portable-request.v1',title:${js(title)},request:document.getElementById('request').value,constraints:['No fabricated execution or citations','State uncertainty','Return a reviewable proposal; no authority to publish'],execution:'Not executed; portable request only'};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(request,null,2)],{type:'application/json'}));a.download='portable-ai-request.json';a.click();document.getElementById('status').textContent='Request prepared. No provider was contacted.';setTimeout(()=>URL.revokeObjectURL(a.href),1000)};`);
}
export function createArtifact({kind,title,intent='',html='',version=1}) {
  const maker={comic,loom,observatory,custom}[kind];
  if(!maker)throw Object.assign(new Error('Unknown creation recipe.'),{code:'INVALID_KIND',status:400});
  const output=maker(title,intent,html,version);
  return {html:output,checks:[{id:'document',label:'Complete playable HTML document',passed:output.startsWith('<!doctype html>')},{id:'sandbox-policy',label:'No network requests or form submission',passed:output.includes("connect-src 'none'")&&output.includes("form-action 'none'")},{id:'authored',label:'Authored recipe; no live AI claim',passed:true}]};
}
