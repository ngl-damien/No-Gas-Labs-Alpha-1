import {createWorld,applyAction,publicWorld,validateWorld} from './model.mjs';
import {getQuest,getQuestTrail,getLocationAction} from './quests.mjs';
import {projectCharacter} from './character-sheet.mjs';
import {WorldView,PLACES} from './world-view.mjs';
import {rehearseLaunch,makeLaunchPage} from './launchpad.mjs';
import {renderEvidenceArchive,renderInstitution} from './institution-view.mjs';
import {prepareContradictionReview,formatContradictionReport} from './contradiction-clerk.mjs';

let institutionRequestGeneration=0,evidenceArchiveGeneration=0;
async function openInstitution(locationId = null) {
  const contexts = {
    'town-square': ['The institution at work.', 'PROJECTS · EVIDENCE · FOUNDER GATE'],
    guild_hall: ['Guild Hall', 'COUNCIL · CAPABILITIES · EVIDENCE'],
    decision_chamber: ['Decision Chamber', 'HUMAN GATE · DECISIONS'],
  };
  const context = contexts[locationId] || contexts['town-square'];
  const content = showSheet(context[0], context[1]);
  if (mode !== 'shared') {
    content.append(paragraph('Project receipts and authenticated decisions are available in the shared service. Private game progress does not establish institutional work.'));
    return;
  }
  const requestGeneration = ++institutionRequestGeneration;
  const principalId = viewer.id;
  const principalRole = viewer.role;
  const [projects, gate, stateResult, institutionResult] = await Promise.all([
    request('/api/projects'),
    request('/api/decisions'),
    request('/api/state').then(data => ({ data })).catch(() => ({ data: null })),
    request('/api/institution').then(data => ({ data })).catch(() => ({ data: null })),
  ]);
  if (requestGeneration !== institutionRequestGeneration || mode !== 'shared' ||
      viewer.id !== principalId || viewer.role !== principalRole || $('sheet').hidden ||
      content !== $('sheet-content') || $('sheet-kicker').textContent !== context[1]) return;
  renderInstitution(content, projects, gate, {
    founder: viewer.role === 'founder',
    world: stateResult.data?.world,
    kernel: institutionResult.data?.kernel,
    kernelUnavailable: !institutionResult.data?.kernel,
    onOpenArtifact: (id, version) => openCreation(id, version),
    onChoice: guarded(async (decision, action) => {
      await request('/api/decisions/choose', {
        decisionId: decision.id,
        expectedRevision: decision.revision,
        requestId: crypto.randomUUID(),
        action,
      });
      await openInstitution();
    }),
  });
}

function openInstitutionLocation(id) {
  if (id === 'guild_hall') return openGuildHall();
  if (id === 'forge') return openForge();
  if (id === 'evidence_archive') return openEvidenceArchive();
  if (id === 'decision_chamber' || id === 'town-square') return openInstitution(id);
  if (id === 'academy') return openAcademy();
  if (id === 'moonshot_field') return openMoonshotField();
  if (id === 'publication_house') return openPublicationHouse();
  return openGuide(id);
}

const $=id=>document.getElementById(id);
const STORAGE='ngl.common-ground.v2',BACKUP=STORAGE+'.backup',ACTOR=STORAGE+'.actor',PENDING_SHARED_ACTION='ngl.common-ground.pending-shared-action.v1';
const recipes={comic:{title:'The First Field Notes',description:'An actual reader for the recovered No_Gas_Labs comic.',intent:'Open the recovered comic pages and let the source speak in its own ink.'},loom:{title:'A Small Unicode Loom',description:'Turn your own Unicode marks into a Web Audio melody.',intent:'Make a small instrument where every character has a voice.'},observatory:{title:'The Source Observatory',description:'Keep observations beside sources and uncertainty.',intent:'Hold a claim beside its evidence and the question that might undo it.'},custom:{title:'A Request Worth Carrying',description:'Sandbox your own HTML, or carry a portable AI work request.',intent:'Prepare a bounded request with evidence, uncertainty and a testable next step.'}};
const guides={relay:{title:'Carry the question.',name:'The Relay',voice:'An authored note from the relay keeper',body:'A relay is useful because something can leave it. Write a request that another person or tool can understand without this conversation. Give it a boundary, the evidence you have, and a way to tell whether it helped.',practice:'Make a portable request. Carry it to a provider you choose. Until a response actually returns, record “not executed”.',recipe:'custom'},river:{title:'The river remembers bytes.',name:'River of Receipts',voice:'An authored note from the river keeper',body:'A receipt can tell you which bytes crossed this bridge. It cannot tell you whether the words inside are true. Keep the source, keep the uncertainty, and leave enough of the trail for someone else to disagree.',practice:'Make an observatory. Put one claim beside a source and one thing that could change your mind.',recipe:'observatory'},overlook:{title:'Make room for another voice.',name:'The Long View',voice:'An authored note from the lookout',body:'From here the buildings look like a plan. Down on the path, each one is an attempt. A useful institution can keep the attempt, hear a contribution, and repair the part that failed without pretending the first version never happened.',practice:'Publish a creation, add a note, then repair it. Version one stays in the archive. A checked repair earns a game method.',recipe:'loom'},ruins:{title:'Unfinished is a useful state.',name:'The Unfinished',voice:'An authored note left among the stones',body:'These stones are not a failed city full of imaginary inhabitants. They are an invitation to make one small thing that works. A readable page. A playable sound. A question with a source. Start with something you can actually open.',practice:'Give the recovered comic a home. Read a page before making a claim about it.',recipe:'comic'}};
let mode=null,world=createWorld(),viewer={id:'private-founder',name:'Damien',role:'founder'},presence=[],institution=null,stream=null,selectedDraft=null,selectedCreation=null,selectedVersion=null,lastFocus=null,toastTimer,launchReport=null,launchHTML=null,busy=false,savingError=false,activeNoteRenderer=null,portalGeneration=0,portalReadyListener=null;
const node=(tag,attrs={},children=[])=>{const e=document.createElement(tag);for(const [k,v]of Object.entries(attrs)){if(k==='text')e.textContent=v;else if(k==='class')e.className=v;else if(k==='onClick')e.addEventListener('click',v);else if(k==='value')e.value=v;else if(k==='hidden')e.hidden=v;else e.setAttribute(k,v)}for(const child of Array.isArray(children)?children:[children])if(child!==undefined&&child!==null)e.append(typeof child==='string'?document.createTextNode(child):child);return e};
const paragraph=(text,className)=>node('p',{text,class:className||''});
const button=(text,onClick,attrs={})=>node('button',{type:'button',text,onClick,...attrs});
function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?8000:5000)}
function handleError(error){console.error(error);toast(error.message||'That action could not be completed.',true)}
function guarded(fn){return async(...args)=>{try{return await fn(...args)}catch(error){handleError(error)}}}
function download(name,content,type='text/html'){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const link=node('a',{href:url,download:name});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
async function request(path,body){let response;try{response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},credentials:'same-origin',...(body===undefined?{}:{body:JSON.stringify(body)})})}catch{setConnection(false);throw new Error('The shared world is unreachable. Your role has not changed. Reconnect to continue.')}let data;try{data=await response.json()}catch{throw new Error('The shared service did not return a readable response.')}if(!response.ok)throw Object.assign(new Error(data.error?.message||data.message||data.error||`Request failed (${response.status}).`),{code:data.error?.code||data.code,status:response.status});return data}
function stableActionJSON(value){if(Array.isArray(value))return value.map(stableActionJSON);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>[key,stableActionJSON(value[key])]));return value}
function readPendingSharedAction(){let raw;try{raw=localStorage.getItem(PENDING_SHARED_ACTION)}catch{throw new Error('Device storage is unavailable; shared writes are paused because a retry receipt cannot be checked.')}if(!raw)return null;let pending;try{pending=JSON.parse(raw)}catch{throw new Error('The saved shared-action retry receipt is unreadable. Do not clear it until the uncertain action is reconciled.')}if(!pending||typeof pending.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(pending.requestId)||typeof pending.actorId!=='string'||!['founder','witness'].includes(pending.actorRole)||!pending.action||typeof pending.action.type!=='string')throw new Error('The saved shared-action retry receipt is malformed. Preserve it for reconciliation before starting another shared action.');return pending}
function savePendingSharedAction(pending){try{localStorage.setItem(PENDING_SHARED_ACTION,JSON.stringify(pending))}catch{throw new Error('Device storage could not preserve the retry receipt. The shared action was not sent.')}}
function clearPendingSharedAction(requestId){try{const current=readPendingSharedAction();if(current?.requestId===requestId)localStorage.removeItem(PENDING_SHARED_ACTION);return true}catch{throw new Error('The server result was received, but this device could not clear its retry receipt. Retry only that same action until storage is available.')}}
async function submitPendingSharedAction(pending){let dto;try{dto=await request('/api/action',{...pending.action,requestId:pending.requestId})}catch(error){if(error.status&&error.status<500&&error.status!==401&&error.status!==403&&error.code!=='IDEMPOTENCY_CONFLICT')clearPendingSharedAction(pending.requestId);throw error}acceptState(dto);clearPendingSharedAction(pending.requestId);return dto.result||{}}
function setConnection(connected){$('connection-dot').classList.toggle('online',connected);$('connection-dot').classList.toggle('offline',!connected&&mode==='shared');if(mode==='shared'&&!connected)$('mode-label').textContent=`Shared · ${viewer.role==='founder'?'Founder':'Witness'} · reconnecting`;}
function persist(next){try{const existing=localStorage.getItem(STORAGE);if(existing)localStorage.setItem(BACKUP,existing);localStorage.setItem(STORAGE,JSON.stringify(next));savingError=false}catch{savingError=true;throw new Error('Device storage is full or unavailable. The change was not saved. Export your world from the Journal before clearing space.')}}
async function loadPrivate(){for(const key of [STORAGE,BACKUP]){let raw;try{raw=localStorage.getItem(key)}catch{toast('Device storage is unavailable. Export a copy to keep this session.',true);return createWorld()}if(!raw)continue;try{const candidate=await validateWorld(JSON.parse(raw));if(key===BACKUP){try{localStorage.setItem(STORAGE,JSON.stringify(candidate))}catch{toast('The backup is valid but device storage could not restore it. Export a copy.',true)}toast('Recovered the last valid backup. Export a copy from the Journal.');}return candidate}catch{toast('The saved copy did not pass its byte checks. Checking the backup.',true)}}return createWorld()}
function privateActor(){let id;try{id=localStorage.getItem(ACTOR);if(!id){id=crypto.randomUUID();localStorage.setItem(ACTOR,id)}}catch{id=crypto.randomUUID()}return {id,name:'Damien',role:'founder'}}
function acceptState(dto){if(!dto?.world||!dto.viewer)throw new Error('Incomplete shared state.');const demoted=viewer.role==='founder'&&dto.viewer.role!=='founder';world=dto.world;viewer=dto.viewer;view.setPlayer({id:viewer.presenceId||viewer.id});presence=dto.presence||[];institution=dto.institution||institution;setConnection(true);if(viewer.role!=='founder'){selectedDraft=null;if(demoted||(!$('portal').hidden&&$('portal-kicker').textContent==='PRIVATE DRAFT')){closePortal();closeSheet();$('sheet-content').replaceChildren();$('sheet-title').textContent='';$('portal-title').textContent='';$('portal-footer').replaceChildren();}}render();}
async function act(action){if(mode==='shared'){const normalized=JSON.parse(JSON.stringify(action));let pending=readPendingSharedAction();if(pending){if(pending.actorId!==viewer.id||pending.actorRole!==viewer.role)throw new Error('A previous shared action has an uncertain outcome under a different session. Re-authenticate as the original actor and resolve it from the Field Journal before starting another shared action.');if(JSON.stringify(stableActionJSON(pending.action))!==JSON.stringify(stableActionJSON(normalized)))throw new Error('A previous shared action has an uncertain outcome. Open the Field Journal and retry that exact action before starting another shared action.');}else{pending={requestId:crypto.randomUUID(),actorId:viewer.id,actorRole:viewer.role,action:normalized};savePendingSharedAction(pending)}return submitPendingSharedAction(pending)}if(mode!=='private')throw new Error('Enter your world first.');const next=await applyAction(world,action,viewer);persist(next.world);world=next.world;render();return next.result;}
const view=new WorldView($('world'),{onInteract:interaction=>{if(mode){if(interaction.type==='workbench')openWorkshop();else if(interaction.type==='creation')openCreation(interaction.id);else if(interaction.type==='institution')guarded(()=>openInstitutionLocation(interaction.id))();else openGuide(interaction.id)}},onDiscover:guarded(async id=>{if(!mode)return;const result=await act({type:'discover',locationId:id});if(result.discovered)toast(`${guides[id].name} discovered · a new field note, no XP.`)}),onPosition:guarded(async p=>{if(mode==='shared')await request('/api/presence',{x:p.x,y:p.y})})});
view.setWorld(world);
function openCharacterSheet(){const record=projectCharacter(world,viewer);const content=showSheet('Character & field record','GAME STATUS · ACTIVITY LEDGER');content.append(paragraph('A deterministic, read-only projection of this world’s saved records. These counts are game activity, not proof of real-world competence, external truth, human approval or AI execution.'));content.append(node('article',{class:'field-card'},[node('h3',{text:'Level '+record.level}),paragraph(record.xp+' character XP from retained, version-matched publications · '+record.xpIntoLevel+' / '+record.xpPerLevel+' XP toward level '+(record.level+1)+'. '+record.worldXp+' institution-wide XP across the world.')]));content.append(node('h3',{text:'Skills · recorded activity'}));for(const skill of record.skills){content.append(node('article',{class:'field-card'},[node('h3',{text:skill.label}),paragraph(skill.count+' recorded '+skill.record+'.'),paragraph(skill.basis)]));}content.append(node('h3',{text:'World inventory · published places'}));if(!record.inventory.length)content.append(paragraph('No published places yet. Private drafts are not in the world inventory.'));for(const item of record.inventory){const children=[node('h3',{text:item.title}),paragraph(item.kind.toUpperCase()+' · version '+item.version)];if(item.receipt)children.push(node('small',{text:'SHA-256 '+item.receipt.digest+' · '+item.receipt.size+' bytes'}));content.append(node('article',{class:'field-card'},children));}content.append(node('h3',{text:'Recent field trail'}));if(!record.recentActivity.length)content.append(paragraph('No activity events are recorded for this character yet.'));for(const item of record.recentActivity){const date=Number.isFinite(Date.parse(item.at))?new Date(item.at).toLocaleString():item.at;const details=[item.creationId?'creation '+item.creationId:null,item.version!==null?'version '+item.version:null,item.locationId?'location '+item.locationId:null].filter(Boolean).join(' · ');content.append(node('article',{class:'field-card'},[node('h3',{text:item.type.toUpperCase()}),paragraph(date+(details?' · '+details:''))]));}}
function followQuestAction(action){if(!action||typeof action.type!=='string')return;if(action.type==='workbench'&&['comic','loom','observatory','custom'].includes(action.recipe)){openWorkshop(action.recipe);return}if(action.type==='location'&&['relay','river','overlook','ruins','moonshot_field','academy'].includes(action.id)){closeSheet();view.goTo(action.id);return}if(action.type==='creation'&&typeof action.id==='string'&&Number.isInteger(action.version)){openCreation(action.id,action.version)}}
function renderQuestTrail(milestones){const list=$('quest-trail');if(!list)return;list.replaceChildren();for(const item of milestones){const count=item.evidenceIds.length;const row=node('li',{class:'quest-step '+(item.complete?'is-recorded':'is-open'),'data-objective-id':item.id});row.append(node('span',{class:'quest-step-state',text:item.complete?'RECORDED':'OPEN'}));row.append(node('strong',{text:item.title}));row.append(node('small',{text:item.progress+'/'+item.target+' · '+count+' retained event'+(count===1?'':'s')}));if(!item.complete&&item.action)row.append(button('Go do this →',()=>followQuestAction(item.action),{class:'text-button quest-action'}));else if(!item.complete&&item.blockedReason)row.append(node('small',{class:'quest-blocked',text:item.blockedReason}));if(count){const disclosure=node('details',{class:'quest-evidence'});disclosure.append(node('summary',{text:'Inspect retained evidence'}));const entries=node('ul',{class:'quest-evidence-list'});for(const evidence of (item.evidence||[])){const facts=[evidence.type?evidence.type.toUpperCase():null,evidence.actorId?'actor '+evidence.actorId:null,evidence.locationId?'location '+evidence.locationId:null,evidence.creationId?'creation '+evidence.creationId:null,evidence.version!==null&&evidence.version!==undefined?'version '+evidence.version:null,evidence.at?'at '+evidence.at:null].filter(Boolean);const entry=node('li');entry.append(node('span',{text:facts.join(' · ')}));entry.append(node('code',{text:evidence.id}));const retained=world.creations.find(creation=>creation.id===evidence.creationId);if(retained&&Number.isInteger(evidence.version)&&[retained,...(Array.isArray(retained.versions)?retained.versions:[])].some(version=>version.version===evidence.version)){entry.append(button('Open retained version '+evidence.version+' →',()=>openCreation(evidence.creationId,evidence.version),{class:'text-button quest-evidence-open'}));}entries.append(entry);}disclosure.append(entries);row.append(disclosure);}list.append(row);}}
function render(){view.setWorld(world);view.setPresence(presence.filter(p=>p.id!==(viewer.presenceId||viewer.id)));$('creation-count').textContent=world.creations.length;$('xp-count').textContent=world.xp;const character=projectCharacter(world,viewer);$('character-button').textContent=String(character.level);$('character-button').title='Level '+character.level+' · '+character.xp+' character XP';$('character-button').setAttribute('aria-label','Open character record: level '+character.level+', '+character.xp+' character XP');$('mode-label').textContent=mode==='shared'?`Shared world · ${viewer.role==='founder'?'Founder':'Witness'}`:mode==='private'?'Private world · saved on this device':'A world waiting to happen';$('login-button').hidden=mode!=='shared'||viewer.role==='founder';$('logout-button').hidden=mode!=='shared'||viewer.role!=='founder';$('make-button').textContent=viewer.role==='founder'?'＋ Make something':'◇ Witness & explore';const quest=getQuest(world,viewer);$('quest-title').textContent=quest.title;$('quest-copy').textContent=quest.copy;$('quest-button').textContent=quest.button;renderQuestTrail(getQuestTrail(world,viewer));if(activeNoteRenderer&&!$('sheet').hidden)activeNoteRenderer();}
async function startPrivate(){stream?.close();stream=null;mode='private';viewer=privateActor();world=await loadPrivate();presence=[];institution=null;selectedDraft=null;$('doorway').hidden=true;$('play-ui').hidden=false;setConnection(true);render();view.canvas.focus({preventScroll:true})}
async function startShared(){const dto=await request('/api/state');stream?.close();mode='shared';acceptState(dto);$('doorway').hidden=true;$('play-ui').hidden=false;selectedDraft=null;stream=new EventSource('/api/events');stream.addEventListener('world',e=>{try{acceptState(JSON.parse(e.data))}catch(error){handleError(error)}});stream.addEventListener('presence',e=>{try{presence=JSON.parse(e.data);view.setPresence(presence.filter(p=>p.id!==(viewer.presenceId||viewer.id)))}catch{}});stream.onerror=()=>setConnection(false);stream.onopen=()=>setConnection(true);toast('You arrived as '+(viewer.role==='founder'?'Founder.':'Witness. Explore, read, contribute.'));view.canvas.focus({preventScroll:true})}
function showSheet(title,kicker='FIELD NOTES'){institutionRequestGeneration++;activeNoteRenderer=null;if($('sheet').hidden)lastFocus=document.activeElement;$('sheet-title').textContent=title;$('sheet-kicker').textContent=kicker;$('sheet-content').replaceChildren();$('sheet-backdrop').hidden=false;$('sheet').hidden=false;document.body.classList.add('modal-open');$('sheet').scrollTop=0;$('sheet-close').focus({preventScroll:true});return $('sheet-content')}
function closeSheet(){institutionRequestGeneration++;activeNoteRenderer=null;$('sheet').hidden=true;$('sheet-backdrop').hidden=true;if($('portal').hidden){document.body.classList.remove('modal-open');(lastFocus?.isConnected?lastFocus:$('world')).focus({preventScroll:true})}}
function sandboxDocument(html,bootstrap=''){for(const page of globalThis.NGL_ASSETS?.pages||[])if(page.path&&/^\/assets\/comic\/(cover_a|p3|p4|p5|p10|p13)\.jpg$/.test(page.path)&&typeof page.src==='string'&&page.src.startsWith('data:image/jpeg;base64,'))html=html.split(page.path).join(page.src);const localImages=location.protocol==='http:'||location.protocol==='https:'?['cover_a','p3','p4','p5','p10','p13'].map(p=>`${location.origin}/assets/comic/${p}.jpg`).join(' '):'';const policy=`default-src 'none'; connect-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: ${localImages}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;const trustedHead=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">${bootstrap}`;const opening=html.match(/^\s*<!doctype html>\s*<html(?:\s[^>]*)?>\s*<head(?:\s[^>]*)?>/i);return opening?trustedHead+html.slice(opening[0].length):`${trustedHead}</head><body>${html}</body></html>`;}
// Keep the child visible beneath the loading cover while it paints. A parent load
// event does not establish that Chromium has published the child's input surface.
function openPortal({title,html,kicker='A LIVING CREATION',footer=[],stage=false}){
  if($('sheet').hidden)lastFocus=document.activeElement;
  const generation=++portalGeneration,oldFrame=$('artifact-frame'),frame=oldFrame.cloneNode(false);
  oldFrame.onload=null;frame.removeAttribute('srcdoc');
  frame.style.removeProperty('visibility');frame.style.removeProperty('pointer-events');
  frame.removeAttribute('data-ngl-input-ready');frame.setAttribute('aria-busy','true');$('portal').classList.add('portal-loading');
  $('portal-title').textContent=title;$('portal-kicker').textContent=kicker;
  if(portalReadyListener)removeEventListener('message',portalReadyListener);
  portalReadyListener=event=>{
    if(generation!==portalGeneration||event.source!==frame.contentWindow||event.data?.type!=='ngl-portal-painted'||event.data.generation!==generation)return;
    const listener=portalReadyListener;removeEventListener('message',listener);portalReadyListener=null;
    // The child's message proves its own paint, not that the parent has painted
    // the removal of the input-blocking cover. Signal readiness only after one
    // parent frame has removed the cover and a following frame has elapsed.
    requestAnimationFrame(()=>{
      if(generation!==portalGeneration||$('artifact-frame')!==frame)return;
      frame.setAttribute('aria-busy','false');$('portal').classList.remove('portal-loading');
      requestAnimationFrame(()=>{
        if(generation!==portalGeneration||$('artifact-frame')!==frame)return;
        frame.setAttribute('data-ngl-input-ready','true');
      });
    });
  };
  addEventListener('message',portalReadyListener);
  const bootstrap=`<script>addEventListener('load',()=>requestAnimationFrame(()=>requestAnimationFrame(()=>parent.postMessage({type:'ngl-portal-painted',generation:${generation}},'*'))),{once:true})<\/script>`;
  frame.srcdoc=stage?html.replace('</head>',bootstrap+'</head>'):sandboxDocument(html,bootstrap);
  oldFrame.replaceWith(frame);$('portal-footer').replaceChildren(...footer);$('portal').hidden=false;
  document.body.classList.add('modal-open');$('portal-close').focus({preventScroll:true});
}
function closePortal(){portalGeneration++;if(portalReadyListener){removeEventListener('message',portalReadyListener);portalReadyListener=null;}$('portal').hidden=true;$('artifact-frame').onload=null;$('artifact-frame').srcdoc='';if($('sheet').hidden){document.body.classList.remove('modal-open');(lastFocus?.isConnected?lastFocus:$('world')).focus({preventScroll:true})}else $('sheet-close').focus({preventScroll:true})}
function requireFounder(){if(viewer.role==='founder')return true;const content=showSheet('A Witness has a voice.','SHARED WORLD · WITNESS');content.append(paragraph('Explore every published creation, leave a contribution, or report a problem. Only the authenticated Founder can draft, repair and publish here.'),paragraph('A private world is yours to make on this device. Switching mode does not grant authority in the shared world.','form-help'),button('Enter your private world',guarded(async()=>{closeSheet();await startPrivate()}),{class:'primary-button'}),node('div',{class:'button-row'},[button('Founder access',openLogin,{class:'secondary-button'})]));return false}
function field(label,id,input){const fragment=document.createDocumentFragment();fragment.append(node('label',{for:id,text:label}),input);return fragment}
function openWorkshop(recipe='comic',draftId=null){if(!requireFounder())return;selectedDraft=draftId?world.drafts.find(d=>d.id===draftId):null;const content=showSheet(selectedDraft?.creationId?'Make the next version.':'Give an idea a place.','THE MAKING BENCH');content.append(paragraph('Choose an authored recipe. Preview the actual artifact, then publish it into the landscape. Drafts are private.'));
  const form=node('form',{},[]),select=node('select',{id:'recipe-select'});for(const [id,r]of Object.entries(recipes))select.append(node('option',{value:id,text:id==='comic'?'Comic archive':id==='loom'?'Unicode music loom':id==='observatory'?'Source observatory':'Custom HTML / portable AI request'}));select.value=selectedDraft?.kind||recipe;
  const title=node('input',{id:'command-input',maxlength:'80',placeholder:'A name for something useful',value:selectedDraft?.title||'',autocomplete:'off'}),intent=node('textarea',{id:'intent-input',maxlength:'2000',rows:'3',placeholder:recipes[select.value].intent,value:selectedDraft?.intent||''}),html=node('textarea',{id:'custom-html',rows:'6',placeholder:'Optional: paste a small, self-contained HTML experience. Leave empty for a portable AI request.'});
  const customWrap=node('div',{id:'custom-wrap',hidden:select.value!=='custom'},[field('Your HTML · optional, 128 KiB maximum','custom-html',html),paragraph('Runs in an opaque sandbox. Inline interactions work; network requests, embedded frames and form submission are blocked.','form-help')]);
  const description=paragraph(recipes[select.value].description,'form-help');select.onchange=()=>{description.textContent=recipes[select.value].description;intent.placeholder=recipes[select.value].intent;customWrap.hidden=select.value!=='custom';};
  if(selectedDraft){select.disabled=true;title.disabled=true;intent.disabled=true;}
  const draftButton=node('button',{id:'draft-button',class:'primary-button',type:'submit',text:selectedDraft?'Draft is ready':'Create private draft'});
  form.append(field('Choose a recipe','recipe-select',select),description,field('What will you make?','command-input',title),field('What is it for?','intent-input',intent),customWrap,node('div',{class:'button-row'},[draftButton]));content.append(form);
  const draftArea=node('div',{id:'draft-area'});content.append(draftArea,paragraph('Each accepted publication adds 100 WORLD XP to the institution-wide total. The publishing Founder earns 100 character XP when the unique publication event matches a retained version. Notes, discoveries and launch rehearsals earn no XP; neither reward grants institutional authority.','form-help'));
  function showDraft(){draftArea.replaceChildren();if(!selectedDraft)return;draftButton.disabled=true;const d=selectedDraft;const preview=button('Open actual preview',()=>previewDraft(d),{id:'preview-button',class:'secondary-button'}),publish=button(`Publish v${d.version} into the world`,guarded(()=>publishDraft(d)),{id:'publish-button',class:'primary-button'});draftArea.append(node('div',{class:'draft-card'},[node('div',{class:'eyebrow',text:'PRIVATE DRAFT · CHECKED BYTES'}),node('h3',{text:d.title}),paragraph(`${d.checks.filter(c=>c.passed).length}/${d.checks.length} recipe checks · ${d.receipt.size.toLocaleString()} bytes`,'form-help'),node('div',{class:'button-row'},[preview,publish]),paragraph(d.creationId?'The published version remains open. This repair will retain its exact bytes in version history.':'Publication creates an actual building and a playable sandboxed artifact.','form-help')]));}
  form.onsubmit=guarded(async e=>{e.preventDefault();draftButton.disabled=true;try{const result=await act({type:'draft',kind:select.value,title:title.value.trim()||recipes[select.value].title,intent:intent.value.trim()||recipes[select.value].intent,...(select.value==='custom'?{html:html.value}:{})});selectedDraft=world.drafts.find(d=>d.id===result.draftId);showDraft();toast('Private draft created. Preview its real interactions before publishing.')}finally{draftButton.disabled=!!selectedDraft}});showDraft();
}
function previewDraft(draft){openPortal({title:draft.title,html:draft.html,kicker:'PRIVATE DRAFT',footer:[paragraph('Private preview · opaque sandbox · no live AI or network requests.'),button(`Publish v${draft.version}`,guarded(()=>publishDraft(draft)),{id:'portal-publish',class:'primary-button'})]})}
async function publishDraft(draft){if(busy)return;busy=true;try{const result=await act({type:'publish',draftId:draft.id,expectedVersion:draft.baseVersion});selectedDraft=null;closePortal();closeSheet();view.focusCreation(result.creationId);toast(`A new place in the world · v${result.version} · +100 WORLD XP · +100 character XP${result.version>1?' · a method preserved':''}.`)}finally{busy=false}}
function openCreation(id,requestedVersion=null){const creation=world.creations.find(c=>c.id===id);if(!creation)return;const availableVersions=[creation,...[...creation.versions].reverse()];selectedCreation=id;selectedVersion=availableVersions.some(version=>version.version===requestedVersion)?requestedVersion:creation.version;const content=showSheet(creation.title,'A PLACE SOMEONE MADE');content.append(node('span',{class:'pill',text:`${creation.kind} · published v${creation.version}`}),paragraph(creation.intent||'A small, playable creation in the Common Ground.'),node('div',{class:'button-row'},[button('Enter this creation ↗',()=>enterCreation(),{id:'enter-creation',class:'primary-button'})]));
  const version=node('select',{id:'version-select'});for(const v of availableVersions)version.append(node('option',{value:v.version,text:`Version ${v.version}${v.version===creation.version?' · current':' · retained original bytes'}`}));version.value=String(selectedVersion);version.onchange=()=>{selectedVersion=Number(version.value);renderNotes();syncChallengeTarget(true)};content.append(field('Version archive','version-select',version),paragraph('Versions are flat retained documents. A SHA-256 receipt establishes exact bytes, not the truth of any claim inside.','form-help'),node('div',{class:'receipt',text:`SHA-256 ${creation.receipt.digest}\n${creation.receipt.size.toLocaleString()} bytes · v${creation.version}`}));
  const notes=node('div',{id:'creation-notes'}),contribution=node('textarea',{id:'contribution-text',maxlength:'500',rows:'3',placeholder:'A useful response, question or counterexample…'});content.append(node('h3',{class:'section-title',text:'Leave a useful trace'}),field('Contribution · 500 characters','contribution-text',contribution),node('div',{class:'button-row'},[button('Add your contribution',guarded(async()=>{await act({type:'contribute',creationId:id,version:selectedVersion,text:contribution.value});contribution.value='';renderNotes();toast('Contribution preserved with your attribution. No XP awarded.')}),{id:'contribute-button',class:'secondary-button'})]),notes);
  const report=node('textarea',{id:'report-text',maxlength:'1000',rows:'2',placeholder:'What failed, what is unsupported, or what needs care?'});const reportDetails=node('details',{},[node('summary',{text:'Report a problem or unsupported claim'}),field('Report · 1000 characters','report-text',report),node('div',{class:'button-row'},[button('Preserve this report',guarded(async()=>{await act({type:'report',creationId:id,version:selectedVersion,text:report.value});report.value='';renderNotes();toast('Report preserved against that exact version.')}),{id:'report-button',class:'secondary-button'})])]);content.append(reportDetails);
  const challengeDetails=node('details',{id:'contradiction-clerk'},[node('summary',{text:'Ask the Contradiction Clerk to challenge this version'})]);
  challengeDetails.append(paragraph('A fixed local checklist, not an AI collaborator or independent witness. It can preserve a report; it cannot decide truth, authorize work, or award XP.','form-help'));
  const challengeTarget=paragraph('','form-help');
  challengeDetails.append(challengeTarget);
  const challengeForm=node('form',{id:'contradiction-form'});
  const challengeInputs={};
  for(const prompt of prepareContradictionReview(creation,selectedVersion).prompts){
    const input=node('textarea',{id:'contradiction-'+prompt.id,maxlength:String(prompt.maxLength),rows:'2',placeholder:prompt.placeholder});
    challengeInputs[prompt.id]=input;
    challengeForm.append(field(prompt.label,input.id,input),paragraph(prompt.prompt,'form-help'));
  }
  const challengeSubmit=node('button',{id:'contradiction-submit',type:'submit',class:'secondary-button',text:'Preserve structured challenge'});
  challengeForm.append(node('div',{class:'button-row'},[challengeSubmit]));
  challengeForm.onsubmit=guarded(async e=>{
    e.preventDefault();
    const targetVersion=selectedVersion;
    const reportText=formatContradictionReport(creation,targetVersion,Object.fromEntries(Object.entries(challengeInputs).map(([key,input])=>[key,input.value])));
    challengeSubmit.disabled=true;
    try{
      await act({type:'report',creationId:id,version:targetVersion,text:reportText});
      for(const input of Object.values(challengeInputs))input.value='';
      renderNotes();
      toast('Structured challenge preserved against v'+targetVersion+'. It is a report, not a verdict.');
    }finally{challengeSubmit.disabled=false;}
  });
  challengeDetails.append(challengeForm);
  function syncChallengeTarget(clear=false){
    const review=prepareContradictionReview(creation,selectedVersion);
    challengeTarget.textContent='Target: '+review.target.title+' · retained v'+review.target.version+'. The Clerk has no authority and issues no verdict.';
    if(clear)for(const input of Object.values(challengeInputs))input.value='';
  }
  syncChallengeTarget();
  content.append(challengeDetails);
  if(viewer.role==='founder')content.append(node('h3',{class:'section-title',text:'Keep the old. Make the next.'}),paragraph('A repair drafts the next checked version. The current building stays open until you publish; previous bytes stay in the archive.','form-help'),node('div',{class:'button-row'},[button('Repair → draft the next version',guarded(async()=>{const result=await act({type:'repair',creationId:id,expectedVersion:world.creations.find(c=>c.id===id).version});openWorkshop(creation.kind,result.draftId)}),{id:'repair-button',class:'secondary-button'})]));
  function renderNotes(){notes.replaceChildren(node('h3',{class:'section-title',text:`Notes on v${selectedVersion}`}));const entries=[...world.contributions.filter(n=>n.creationId===id&&n.version===selectedVersion).map(n=>({...n,type:'Contribution'})),...world.reports.filter(n=>n.creationId===id&&n.version===selectedVersion).map(n=>({...n,type:'Report'}))];if(!entries.length)notes.append(paragraph('A place for the first real response.','empty-note'));for(const n of entries)notes.append(node('article',{class:'note-entry'},[paragraph(n.text),paragraph(`${n.type} · ${n.actor.name} · ${new Date(n.at).toLocaleDateString()}`,'attribution')]));}activeNoteRenderer=renderNotes;renderNotes();
}
function enterCreation(){const c=world.creations.find(c=>c.id===selectedCreation);if(!c)return;const version=selectedVersion===c.version?c:c.versions.find(v=>v.version===selectedVersion);if(!version)return;openPortal({title:`${c.title} · v${version.version}`,html:version.html,footer:[paragraph(`Published v${version.version} · ${version.receipt.size.toLocaleString()} checked bytes · interactions inside the frame are local to this open artifact.`),button('↓ Save artifact',()=>download(`${c.kind}-v${version.version}.html`,version.html),{id:'download-artifact',class:'secondary-button'})]})}
function openGuide(id){const g=guides[id];if(!g)return;const action=getLocationAction(id,world,viewer);const content=showSheet(g.title,g.name);content.append(paragraph(g.voice,'attribution'),paragraph(g.body),node('div',{class:'field-card'},[node('div',{class:'eyebrow',text:'A PRACTICE TO TRY'}),paragraph(g.practice)]),paragraph('This guide is authored text, not an executing AI agent. Discovery records a visit and grants no XP. Its next action is chosen from the published world state and your role; it cannot grant publishing authority or certify a claim.','form-help'),paragraph(action?.explanation||'No activity is available for this location yet.','form-help'),node('div',{class:'button-row'},[button(action?.label||'Explore another guide →',()=>{if(action?.type==='workbench')openWorkshop(action.recipe);else if(action?.type==='inspect')openCreation(action.creationId);else openPlaces();},{class:'primary-button'})]));}
function openPlaces(){const content=showSheet('Find your way.','PLACES IN THE COMMON GROUND');content.append(paragraph('Choose a destination to walk there. The route uses the bridges and goes around buildings. You can also open any creation from its card.'));for(const place of PLACES)content.append(button('',()=>{closeSheet();view.goTo(place.id)},{class:'list-button','aria-label':`Walk to ${place.name}`,...{}}));const buttons=content.querySelectorAll('.list-button');PLACES.forEach((p,i)=>buttons[i].append(node('span',{},[node('strong',{text:p.name}),node('small',{text:p.type==='workbench'?'Make a private draft, then publish.':p.type==='institution'?(p.purpose||'Institutional function.'):guides[p.id]?.voice||'Walk to this authored guide.'})]),node('span',{class:'arrow',text:'↗'})));if(world.creations.length)content.append(node('h3',{class:'section-title',text:'CREATIONS THAT BECAME PLACES'}));for(const c of world.creations)content.append(button('',()=>openCreation(c.id),{class:'list-button','aria-label':`Open ${c.title}`}));const creationButtons=Array.from(content.querySelectorAll('.list-button')).slice(PLACES.length);world.creations.forEach((c,i)=>creationButtons[i].append(node('span',{},[node('strong',{text:c.title}),node('small',{text:`${c.kind} · v${c.version} · enter, contribute, inspect history`})]),node('span',{class:'arrow',text:'→'})));}
function openGuildHall(){
  if(mode==='shared')return openInstitution('guild_hall');
  const content=showSheet('Guild Hall','BOUNDED COLLABORATORS · PROPOSALS');
  content.append(paragraph('These guide voices are authored prompts, not executing AI agents. They cannot authorize work, certify evidence, or award progress. Use their prompts to frame a concrete next action.'));
  for(const [id,guide] of Object.entries(guides))content.append(node('article',{class:'field-card'},[node('h3',{text:guide.name}),paragraph(guide.practice),button('Open guide →',()=>openGuide(id),{class:'list-button'})]));
}
function openForge(){
  if(viewer.role==='founder')return openWorkshop();
  const content=showSheet('Forge','FOUNDER-GATED CREATION');
  content.append(paragraph('Drafting, repair and publication require an authenticated Founder session. Witnesses can inspect published work and leave attributed contributions or reports.'));
  content.append(button('Browse published work →',()=>openPublicationHouse(),{class:'list-button'}));
}
function openEvidenceArchive(){
  const kicker='REPORTS · CONTRIBUTIONS · DISAGREEMENT';
  const content=showSheet('Evidence Archive',kicker);
  content.append(paragraph('This archive preserves attributed reports and contributions against actual published versions. Receipts identify bytes; they do not establish truth. Reports remain dissent, not automatic verdicts.'));
  const entries=[...world.reports.map(entry=>({...entry,kind:'Report'})),...world.contributions.map(entry=>({...entry,kind:'Contribution'}))].sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  if(!entries.length)content.append(paragraph('No reports or contributions have been retained yet. The empty archive is an honest state, not a failed claim.','empty-note'));
  for(const entry of entries){
    const creation=world.creations.find(item=>item.id===entry.creationId);
    content.append(node('article',{class:'field-card'},[
      node('h3',{text:entry.kind+' · '+(creation?.title||entry.creationId)+' · v'+entry.version}),
      paragraph(entry.text),
      paragraph('By '+(entry.actor?.name||'Unknown')+' · '+entry.at+' · retained record, not a verdict.','attribution'),
      button('Inspect referenced version →',()=>openCreation(entry.creationId,entry.version),{class:'list-button'})
    ]));
  }
  const history=node('section',{class:'evidence-history'});
  content.append(history);
  const generation=++evidenceArchiveGeneration;
  const principalId=viewer.id;
  const principalRole=viewer.role;
  const stillCurrent=()=>generation===evidenceArchiveGeneration&&mode==='shared'&&viewer.id===principalId&&viewer.role===principalRole&&!$('sheet').hidden&&content===$('sheet-content')&&$('sheet-kicker').textContent===kicker;
  const renderHistory=(kernel,kernelUnavailable=false)=>renderEvidenceArchive(history,{
    world,kernel,kernelUnavailable,shared:mode==='shared',
    onOpenArtifact:(id,version)=>openCreation(id,version)
  });
  if(mode!=='shared'){
    renderHistory(null,false);
    return;
  }
  history.append(paragraph('Loading canonical institutional history…','form-help'));
  request('/api/institution').then(result=>{
    if(!stillCurrent())return;
    history.replaceChildren();
    renderHistory(result?.kernel||null,!result?.kernel);
  }).catch(()=>{
    if(!stillCurrent())return;
    history.replaceChildren();
    renderHistory(null,true);
  });
}

function openAcademy(){
  const content=showSheet('Polymath Academy','FUNDAMENTAL KNOWLEDGE · STUDY');
  content.append(paragraph('Study published work and compare its claims with its retained sources. A study note records your question, your own explanation, and the next check. It is activity evidence, not proof of correctness or mastery; it awards no XP.'));
  const works=[...(Array.isArray(world.creations)?world.creations:[])].reverse();
  if(!works.length){
    content.append(paragraph('No published study objects are available yet. The Founder can make the first artifact at the Forge.','empty-note'));
    if(viewer.role==='founder')content.append(button('Visit the Forge →',()=>{closeSheet();view.goTo('forge')},{class:'list-button'}));
  }
  for(const creation of works)content.append(node('article',{class:'field-card'},[
    node('h3',{text:creation.title}),
    paragraph(creation.kind+' · published v'+creation.version+' · '+creation.receipt.size+' retained bytes'),
    button('Open source →',()=>openCreation(creation.id,creation.version),{class:'list-button'}),
    button('Record study note →',()=>openStudyNote(creation.id,creation.version),{class:'list-button'})
  ]));
  const notes=(Array.isArray(world.events)?world.events:[]).filter(event=>event?.type==='study').slice().reverse().slice(0,8);
  content.append(node('h3',{class:'section-title',text:'RETAINED STUDY NOTES'}));
  if(!notes.length)content.append(paragraph('No study notes retained yet. The first note should identify an exact source version and what remains to check.','empty-note'));
  const reviews=(Array.isArray(world.events)?world.events:[]).filter(event=>event?.type==='study-reviewed').slice().reverse().slice(0,8);
  for(const note of notes){
    const source=(Array.isArray(world.creations)?world.creations:[]).find(item=>item.id===note.creationId);
    const review=reviews.find(item=>item.studyId===note.studyId&&item.actor?.id===note.actor?.id&&item.actor?.role===note.actor?.role);
    const children=[
      node('h3',{text:(source?.title||'Source unavailable')+' · v'+note.version}),
      paragraph('Question: '+note.question),
      paragraph('Attempt: '+note.attempt),
      paragraph('Next check: '+note.nextCheck),
      paragraph((note.actor?.name||'Unknown actor')+' · '+note.at+' · recorded practice, not mastery.','attribution')
    ];
    if(note.actor?.id===viewer.id&&note.actor?.role===viewer.role&&!review)
      children.push(button('Review next check →',()=>openStudyReview(note),{class:'list-button'}));
    if(review)children.push(paragraph('A retrieval review is retained for this note; its response remains self-reported.','form-help'));
    children.push(button('Inspect retained source version →',()=>openCreation(note.creationId,note.version),{class:'list-button'}));
    content.append(node('article',{class:'field-card'},children));
  }
  content.append(node('h3',{class:'section-title',text:'RETAINED RETRIEVAL REVIEWS'}));
  if(!reviews.length)content.append(paragraph('No retrieval reviews retained yet. A review must follow your own source-bound study note.','empty-note'));
  for(const review of reviews){
    const source=(Array.isArray(world.creations)?world.creations:[]).find(item=>item.id===review.creationId);
    content.append(node('article',{class:'field-card'},[
      node('h3',{text:(source?.title||'Source unavailable')+' · v'+review.version}),
      paragraph('Response: '+review.response),
      paragraph('Reflection: '+review.reflection),
      paragraph((review.actor?.name||'Unknown actor')+' · '+review.at+' · self-reported retrieval practice, not mastery.','attribution'),
      button('Inspect reviewed source version →',()=>openCreation(review.creationId,review.version),{class:'list-button'})
    ]));
  }
}
function openStudyNote(creationId,versionNumber){
  const creation=(Array.isArray(world.creations)?world.creations:[]).find(item=>item.id===creationId);
  const version=creation&&(creation.version===versionNumber?creation:(Array.isArray(creation.versions)?creation.versions:[]).find(item=>item.version===versionNumber));
  if(!creation||!version){toast('That published study version is unavailable. Refresh the world before recording a note.',true);openAcademy();return;}
  const content=showSheet('Record a study note','POLYMATH ACADEMY · SOURCE-BOUND PRACTICE');
  content.append(paragraph('Source: '+creation.title+' · v'+versionNumber+' · '+version.receipt.size+' retained bytes.'));
  content.append(paragraph('Write what you are trying to understand, your own explanation, and the next check that could expose a gap. This record is self-authored; it does not certify mastery, correctness, or external knowledge.'));
  const form=node('form',{class:'field-card'},[]);
  const question=node('textarea',{id:'academy-study-question',maxlength:'500',rows:'3',placeholder:'What question are you studying?',required:'required'});
  const attempt=node('textarea',{id:'academy-study-attempt',maxlength:'1000',rows:'4',placeholder:'Explain the idea in your own words. Mark uncertainty instead of bluffing.',required:'required'});
  const nextCheck=node('textarea',{id:'academy-study-next-check',maxlength:'500',rows:'3',placeholder:'What source, counterexample, exercise, or observation would test your explanation?',required:'required'});
  const submit=node('button',{id:'academy-study-submit',class:'primary-button',type:'submit',text:'Retain study note'});
  form.append(
    field('Study question','academy-study-question',question),
    field('Your explanation · uncertainty allowed','academy-study-attempt',attempt),
    field('Next check','academy-study-next-check',nextCheck),
    paragraph('A retained note counts as Scholar activity only. It awards no XP and cannot certify skill or truth.','form-help'),
    node('div',{class:'button-row'},[submit])
  );
  content.append(form);
  form.onsubmit=guarded(async event=>{
    event.preventDefault();
    submit.disabled=true;
    try{
      await act({
        type:'study',creationId,version:versionNumber,
        question:question.value.trim(),attempt:attempt.value.trim(),nextCheck:nextCheck.value.trim()
      });
      toast('Study note retained · exact source version bound · Scholar activity only · no XP or mastery awarded.');
      openAcademy();
    }finally{submit.disabled=false;}
  });
}
function openStudyReview(note){
  const content=showSheet('Review your next check','POLYMATH ACADEMY · RETRIEVAL PRACTICE');
  content.append(paragraph('Return to the next check you wrote for this earlier note. Answer from memory first if useful, then record what remains uncertain. This is a later self-report, not a correctness score, external observation, or mastery certificate.'));
  content.append(paragraph('Original next check: '+note.nextCheck,'field-card'));
  content.append(paragraph('Source: '+note.creationId+' · retained v'+note.version+'.'));
  const form=node('form',{class:'field-card'},[]);
  const response=node('textarea',{id:'academy-review-response',maxlength:'1000',rows:'4',placeholder:'Your response to the earlier next check',required:'required'});
  const reflection=node('textarea',{id:'academy-review-reflection',maxlength:'1000',rows:'3',placeholder:'What changed, what was missing, or what remains uncertain?',required:'required'});
  const submit=node('button',{id:'academy-review-submit',class:'primary-button',type:'submit',text:'Retain retrieval review'});
  form.append(
    field('Response to the next check','academy-review-response',response),
    field('Reflection and remaining uncertainty','academy-review-reflection',reflection),
    paragraph('One review is allowed per study note. Start a new source-bound study note for another practice cycle. No XP or mastery is awarded.','form-help'),
    node('div',{class:'button-row'},[submit])
  );
  content.append(form);
  form.onsubmit=guarded(async event=>{
    event.preventDefault();
    submit.disabled=true;
    try{
      await act({type:'review-study',studyId:note.studyId,response:response.value.trim(),reflection:reflection.value.trim()});
      toast('Retrieval review retained · source-bound · self-reported · no XP or mastery awarded.');
      openAcademy();
    }finally{submit.disabled=false;}
  });
}
function openExperimentReport(proposal){
  const content=showSheet('Record an attempt.','MOONSHOT FIELD · EXPERIMENT REPORT');
  content.append(paragraph('Retain what was tried and what was observed. The outcome is your report, not an adjudication. Failed attempts and contradictions stay visible. A linked artifact identifies retained bytes only; this form does not verify execution, truth, or success.'));
  const form=node('form',{class:'field-card'},[]);
  const procedure=node('textarea',{id:'experiment-procedure',maxlength:'1000',rows:'3',placeholder:'What procedure or method did you actually try?',required:'required'});
  const observation=node('textarea',{id:'experiment-observation',maxlength:'1000',rows:'3',placeholder:'What did you observe, including failures or contradictions?',required:'required'});
  const outcome=node('select',{id:'experiment-outcome',required:'required'},[
    node('option',{value:'',text:'Choose a reported outcome'}),
    node('option',{value:'supports',text:'Supports hypothesis · self-reported'}),
    node('option',{value:'contradicts',text:'Contradicts hypothesis · self-reported'}),
    node('option',{value:'inconclusive',text:'Inconclusive · self-reported'}),
    node('option',{value:'failed',text:'Attempt failed · self-reported'})
  ]);
  const evidenceSource=node('select',{id:'experiment-evidence-source'},[]);
  evidenceSource.append(node('option',{value:'',text:'No retained artifact linked'}));
  for(const creation of (Array.isArray(world.creations)?world.creations:[])){
    evidenceSource.append(node('option',{value:creation.id,text:creation.title+' · current v'+creation.version}));
  }
  const evidenceVersion=node('select',{id:'experiment-evidence-version'});
  const syncEvidenceVersions=()=>{
    evidenceVersion.replaceChildren();
    const creation=(Array.isArray(world.creations)?world.creations:[]).find(item=>item.id===evidenceSource.value);
    if(!creation){
      evidenceVersion.append(node('option',{value:'',text:'No evidence version'}));
      evidenceVersion.disabled=true;
      return;
    }
    const versions=[...(Array.isArray(creation.versions)?creation.versions:[]),creation]
      .filter(version=>Number.isInteger(version.version))
      .sort((left,right)=>left.version-right.version);
    for(const version of versions)evidenceVersion.append(node('option',{value:String(version.version),text:(version.version===creation.version?'Current':'Retained')+' version '+version.version}));
    evidenceVersion.value=String(creation.version);
    evidenceVersion.disabled=false;
  };
  evidenceSource.onchange=syncEvidenceVersions;
  syncEvidenceVersions();
  const submit=node('button',{id:'report-experiment',class:'primary-button',type:'submit',text:'Retain experiment report'});
  form.append(
    field('Procedure','experiment-procedure',procedure),
    field('Observed result or failure','experiment-observation',observation),
    field('Reported outcome · not adjudicated','experiment-outcome',outcome),
    field('Optional retained evidence artifact','experiment-evidence-source',evidenceSource),
    field('Evidence version','experiment-evidence-version',evidenceVersion),
    paragraph('This creates an attributed report event only. It awards no XP and does not mark the hypothesis true or false.','form-help'),
    node('div',{class:'button-row'},[submit])
  );
  content.append(form);
  form.onsubmit=guarded(async event=>{
    event.preventDefault();
    submit.disabled=true;
    try{
      const selected=(Array.isArray(world.creations)?world.creations:[]).find(creation=>creation.id===evidenceSource.value);
      await act({
        type:'report-experiment',
        moonshotId:proposal.moonshotId,
        procedure:procedure.value.trim(),
        observation:observation.value.trim(),
        reportedOutcome:outcome.value,
        evidenceCreationId:selected?.id??null,
        evidenceVersion:selected?Number(evidenceVersion.value):null
      });
      toast('Experiment report retained · self-reported · not adjudicated · no XP awarded.');
      openMoonshotField();
    }finally{submit.disabled=false;}
  });
}
function openExperimentChallenge(report){
  const content=showSheet('Challenge experiment report','RETAINED DISSENT · NOT ADJUDICATION');
  content.append(paragraph('Challenge the report’s evidence, method, scope or reproducibility. This appends an attributed counterargument without deleting or rewriting the report. It does not establish truth, independently verify the challenge, authorize work, or award XP.'));
  const form=node('form',{class:'field-card'},[]);
  const challengeType=node('select',{id:'experiment-challenge-type',required:'required'},[
    node('option',{value:'',text:'Choose a challenge category'}),
    node('option',{value:'missing-evidence',text:'Missing or insufficient evidence'}),
    node('option',{value:'methodology',text:'Methodology concern'}),
    node('option',{value:'contradiction',text:'Contradiction or counterexample'}),
    node('option',{value:'reproducibility',text:'Reproducibility concern'}),
    node('option',{value:'scope',text:'Scope or applicability concern'}),
    node('option',{value:'other',text:'Other challenge'})
  ]);
  const challengeText=node('textarea',{id:'experiment-challenge-text',maxlength:'1000',rows:'4',placeholder:'State the specific gap, counterexample, or reason this report should not be accepted as verified.'});
  const evidenceSource=node('select',{id:'experiment-challenge-evidence-source'},[]);
  evidenceSource.append(node('option',{value:'',text:'No retained artifact linked'}));
  for(const creation of (Array.isArray(world.creations)?world.creations:[])){
    evidenceSource.append(node('option',{value:creation.id,text:creation.title+' · current v'+creation.version}));
  }
  const evidenceVersion=node('select',{id:'experiment-challenge-evidence-version'});
  const syncEvidenceVersions=()=>{
    evidenceVersion.replaceChildren();
    const creation=(Array.isArray(world.creations)?world.creations:[]).find(item=>item.id===evidenceSource.value);
    if(!creation){
      evidenceVersion.append(node('option',{value:'',text:'No evidence version'}));
      evidenceVersion.disabled=true;
      return;
    }
    const versions=[...(Array.isArray(creation.versions)?creation.versions:[]),creation]
      .filter(version=>Number.isInteger(version.version))
      .sort((left,right)=>left.version-right.version);
    for(const version of versions)evidenceVersion.append(node('option',{value:String(version.version),text:(version.version===creation.version?'Current':'Retained')+' version '+version.version}));
    evidenceVersion.value=String(creation.version);
    evidenceVersion.disabled=false;
  };
  evidenceSource.onchange=syncEvidenceVersions;
  syncEvidenceVersions();
  const submit=node('button',{id:'challenge-experiment-report',class:'primary-button',type:'submit',text:'Preserve challenge'});
  form.append(
    field('Challenge category','experiment-challenge-type',challengeType),
    field('Challenge / counterargument','experiment-challenge-text',challengeText),
    field('Optional retained evidence artifact','experiment-challenge-evidence-source',evidenceSource),
    field('Evidence version','experiment-challenge-evidence-version',evidenceVersion),
    paragraph('A linked artifact identifies retained bytes only. A different actor ID is service attribution, not proof of a different real-world person or independent witness.','form-help'),
    node('div',{class:'button-row'},[submit])
  );
  content.append(form);
  form.onsubmit=guarded(async event=>{
    event.preventDefault();
    submit.disabled=true;
    try{
      await act({
        type:'challenge-experiment-report',
        reportId:report.reportId,
        challengeType:challengeType.value,
        challengeText:challengeText.value.trim(),
        evidenceCreationId:((Array.isArray(world.creations)?world.creations:[]).find(creation=>creation.id===evidenceSource.value))?.id??null,
        evidenceVersion:evidenceSource.value?Number(evidenceVersion.value):null
      });
      toast('Challenge retained · dissent preserved · not adjudicated · no XP awarded.');
      openMoonshotField();
    }finally{submit.disabled=false;}
  });
}
function openMoonshotField(){
  const content=showSheet('Moonshot Field','BOUNDED RESEARCH · PROPOSALS ARE NOT RESULTS');
  content.append(paragraph('Create a bounded research proposal with a hypothesis, a falsification condition, and the evidence needed. Founder and Witness can propose. Saving retains the question; it does not execute an experiment, award XP, establish truth, or authorize world changes.'));
  const form=node('form',{class:'field-card'},[]);
  const title=node('input',{id:'moonshot-title',maxlength:'80',placeholder:'A concise question to investigate',autocomplete:'off'});
  const hypothesis=node('textarea',{id:'moonshot-hypothesis',maxlength:'1000',rows:'3',placeholder:'What do you predict, and under which conditions?'});
  const falsifier=node('textarea',{id:'moonshot-falsifier',maxlength:'1000',rows:'3',placeholder:'What observable result would count against the hypothesis?'});
  const evidence=node('textarea',{id:'moonshot-evidence',maxlength:'1000',rows:'3',placeholder:'What source, artifact, measurement, or independent observation is needed?'});
  const source=node('select',{id:'moonshot-source'});
  source.append(node('option',{value:'',text:'Standalone question — no artifact linked'}));
  for(const creation of (Array.isArray(world.creations)?world.creations:[])){
    source.append(node('option',{value:creation.id,text:creation.title+' · current v'+creation.version}));
  }
  const sourceVersion=node('select',{id:'moonshot-source-version'});
  const syncSourceVersions=()=>{
    sourceVersion.replaceChildren();
    const creation=(Array.isArray(world.creations)?world.creations:[]).find(item=>item.id===source.value);
    if(!creation){
      sourceVersion.append(node('option',{value:'',text:'No source version'}));
      sourceVersion.disabled=true;
      return;
    }
    const versions=[...(Array.isArray(creation.versions)?creation.versions:[]),creation]
      .filter(version=>Number.isInteger(version.version))
      .sort((left,right)=>left.version-right.version);
    for(const version of versions){
      sourceVersion.append(node('option',{value:String(version.version),text:(version.version===creation.version?'Current':'Retained')+' version '+version.version}));
    }
    sourceVersion.value=String(creation.version);
    sourceVersion.disabled=false;
  };
  source.onchange=syncSourceVersions;
  syncSourceVersions();
  const submit=node('button',{id:'propose-moonshot',class:'primary-button',type:'submit',text:'Retain moonshot proposal'});
  form.append(
    field('Proposal title','moonshot-title',title),
    field('Hypothesis','moonshot-hypothesis',hypothesis),
    field('Falsification condition','moonshot-falsifier',falsifier),
    field('Evidence required','moonshot-evidence',evidence),
    field('Optional source artifact','moonshot-source',source),
    field('Source version','moonshot-source-version',sourceVersion),
    paragraph('A proposal is not an experiment result. Failed, refuted, or contradictory evidence must be recorded separately; no outcome is inferred here.','form-help'),
    node('div',{class:'button-row'},[submit])
  );
  content.append(form);
  form.onsubmit=guarded(async event=>{
    event.preventDefault();
    submit.disabled=true;
    try{
      const selected=(Array.isArray(world.creations)?world.creations:[]).find(creation=>creation.id===source.value);
      await act({
        type:'propose-moonshot',
        title:title.value.trim(),
        hypothesis:hypothesis.value.trim(),
        falsifier:falsifier.value.trim(),
        evidenceNeeded:evidence.value.trim(),
        sourceCreationId:selected?.id??null,
        sourceVersion:selected?Number(sourceVersion.value):null
      });
      toast('Moonshot proposal retained · not executed · no XP awarded.');
      openMoonshotField();
    }finally{submit.disabled=false;}
  });
  const proposals=(Array.isArray(world.events)?world.events:[]).filter(event=>event?.type==='moonshot-proposed');
  if(!proposals.length)content.append(paragraph('No moonshot proposals are retained yet. Your first objective is to make one falsifiable and name the evidence that could resolve it.','empty-note'));
  for(const proposal of [...proposals].reverse()){
    const card=node('article',{class:'field-card'},[
      node('h3',{text:proposal.title||'Untitled moonshot proposal'}),
      node('span',{class:'pill',text:'PROPOSED · NOT EXECUTED'}),
      paragraph('Hypothesis: '+proposal.hypothesis),
      paragraph('Falsification condition: '+proposal.falsifier),
      paragraph('Evidence required: '+proposal.evidenceNeeded),
      paragraph('Submitted by '+(proposal.actor?.name||proposal.actor?.id||'unknown actor')+' · '+(proposal.at||'time unavailable'),'form-help')
    ]);
    const sourceExists=proposal.sourceCreationId&&Number.isInteger(proposal.sourceVersion)&&
      (Array.isArray(world.creations)?world.creations:[]).some(creation=>creation.id===proposal.sourceCreationId&&
        (creation.version===proposal.sourceVersion||(Array.isArray(creation.versions)&&creation.versions.some(version=>version.version===proposal.sourceVersion))));
    if(sourceExists)card.append(button('Inspect linked source v'+proposal.sourceVersion+' →',()=>openCreation(proposal.sourceCreationId,proposal.sourceVersion),{class:'list-button'}));
    else if(proposal.sourceCreationId)card.append(paragraph('Linked source version is unavailable in this snapshot; the proposal remains visible without an invented target.','evidence-warning'));
    card.append(button('Record an experiment attempt →',()=>openExperimentReport(proposal),{class:'list-button'}));
    const reports=(Array.isArray(world.events)?world.events:[]).filter(event=>event?.type==='experiment-reported'&&event.moonshotId===proposal.moonshotId);
    for(const report of reports){
      const reportCard=node('div',{class:'field-card'},[
        node('h4',{text:'Experiment report'}),
        node('span',{class:'pill',text:'SELF-REPORTED · NOT ADJUDICATED'}),
        paragraph('Procedure: '+(report.procedure||'not recorded')),
        paragraph('Observation: '+(report.observation||'not recorded')),
        paragraph('Reported outcome: '+(report.reportedOutcome||'not supplied')),
        paragraph('Submitted by '+(report.actor?.name||report.actor?.id||'unknown actor')+' · '+(report.at||'time unavailable'),'form-help')
      ]);
      const evidenceCreation=(Array.isArray(world.creations)?world.creations:[]).find(creation=>creation.id===report.evidenceCreationId);
      const evidenceExists=evidenceCreation&&Number.isInteger(report.evidenceVersion)&&
        (evidenceCreation.version===report.evidenceVersion||(Array.isArray(evidenceCreation.versions)&&evidenceCreation.versions.some(version=>version.version===report.evidenceVersion)));
      if(evidenceExists)reportCard.append(button('Inspect retained evidence v'+report.evidenceVersion+' →',()=>openCreation(report.evidenceCreationId,report.evidenceVersion),{class:'list-button'}));
      else if(report.evidenceCreationId)reportCard.append(paragraph('The linked evidence version is unavailable in this snapshot.','evidence-warning'));
      else reportCard.append(paragraph('No retained artifact is linked; this report has not been independently supported.','evidence-warning'));
      const challenges=(Array.isArray(world.events)?world.events:[]).filter(event=>event?.type==='experiment-challenged'&&event.reportId===report.reportId);
      for(const challenge of challenges){
        const challengeCard=node('div',{class:'field-card'},[
          node('h4',{text:'Retained challenge'}),
          node('span',{class:'pill',text:'DISSENT · NOT ADJUDICATED'}),
          paragraph('Challenge category: '+String(challenge.challengeType||'other').replaceAll('-',' ')),
          paragraph('Counterargument: '+(challenge.challengeText||'not recorded')),
          paragraph('Submitted by '+(challenge.actor?.name||challenge.actor?.id||'unknown actor')+' · '+(challenge.at||'time unavailable'),'form-help')
        ]);
        if(challenge.evidenceCreationId){
          const evidenceExists=(Array.isArray(world.creations)?world.creations:[]).some(creation=>creation.id===challenge.evidenceCreationId&&(creation.version===challenge.evidenceVersion||(Array.isArray(creation.versions)&&creation.versions.some(version=>version.version===challenge.evidenceVersion))));
          if(evidenceExists)challengeCard.append(button('Inspect challenge evidence v'+challenge.evidenceVersion+' →',()=>openCreation(challenge.evidenceCreationId,challenge.evidenceVersion),{class:'list-button'}));
          else challengeCard.append(paragraph('The linked challenge-evidence version is unavailable in this snapshot.','evidence-warning'));
        }else challengeCard.append(paragraph('No retained artifact is linked to this challenge.','evidence-warning'));
        reportCard.append(challengeCard);
      }
      if(report.actor?.id!==viewer.id)reportCard.append(button('Challenge this report →',()=>openExperimentChallenge(report),{class:'list-button'}));
      card.append(reportCard);
    }
    content.append(card);
  }
  if(viewer.role==='founder'&&!(Array.isArray(world.creations)?world.creations:[]).some(creation=>creation.kind==='observatory')){
    content.append(button('Build a source observatory →',()=>openWorkshop('observatory'),{class:'list-button'}));
  }
}
function openPublicationHouse(kindFilter=null){
  const content=showSheet('Publication House','PUBLISHED ARTIFACTS · PRESERVED VERSIONS');
  content.append(paragraph('Only retained published artifacts appear here. Publication means a version was preserved by this service; it is not a truth verdict.'));
  const works=[...world.creations].filter(creation=>!kindFilter||creation.kind===kindFilter).reverse();
  if(!works.length)content.append(paragraph(kindFilter?'No published '+kindFilter+' artifacts are present yet.':'No published artifacts are present yet.','empty-note'));
  for(const creation of works)content.append(button(creation.title+' · '+creation.kind+' · v'+creation.version,()=>openCreation(creation.id,creation.version),{class:'list-button'}));
}
function openJournal(){const content=showSheet('Keep the trail.','THE FIELD JOURNAL');content.append(paragraph(mode==='shared'?`Shared world · ${viewer.role==='founder'?'authenticated Founder':'Witness'} · ${viewer.name}`:'Private world · this device · local saves and backup'),node('div',{class:'journal-summary'},[node('span',{},[node('strong',{text:world.creations.length}),node('small',{text:'PLACES MADE'})]),node('span',{},[node('strong',{text:world.xp}),node('small',{text:'WORLD XP'})]),node('span',{},[node('strong',{text:world.methods.length}),node('small',{text:'METHODS EARNED'})])]),paragraph('Every accepted published version adds 100 WORLD XP to this institution-wide total. Character XP is derived separately from unique Founder publication events matched to retained versions. Neither total proves external truth, competence, provider execution or authority.','form-help'));
  if(world.drafts.length&&viewer.role==='founder'){content.append(node('h3',{class:'section-title',text:'PRIVATE DRAFTS'}));for(const d of world.drafts)content.append(button(d.title+` · draft v${d.version} →`,()=>openWorkshop(d.kind,d.id),{class:'list-button'}));}
  let pendingAction=null;try{pendingAction=readPendingSharedAction()}catch(error){content.append(node('h3',{class:'section-title',text:'SHARED ACTION RECOVERY'}),paragraph(error.message,'evidence-warning'))}if(pendingAction){content.append(node('h3',{class:'section-title',text:'SHARED ACTION RECOVERY'}),paragraph('A shared write may have committed even if its response was lost. The request ID and exact action are saved on this device; retrying reuses that ID so the server can return the original result without creating a duplicate.','form-help'),node('article',{class:'field-card'},[node('h3',{text:'Pending action · '+pendingAction.action.type.toUpperCase()}),paragraph('Request ID · '+pendingAction.requestId),paragraph('Original actor · '+pendingAction.actorId+' ('+pendingAction.actorRole+')')]));if(mode==='shared'&&pendingAction.actorId===viewer.id&&pendingAction.actorRole===viewer.role)content.append(button('Retry the exact pending action safely',guarded(async()=>{const result=await submitPendingSharedAction(pendingAction);closeSheet();toast('Shared action outcome recovered. The same request ID was reused; no duplicate was created.') }),{class:'primary-button',id:'retry-pending-shared-action'}));else content.append(paragraph('This session does not match the original actor. The action will not be replayed under a different identity or role.','evidence-warning'))}  content.append(node('h3',{class:'section-title',text:'YOUR DISCOVERIES'}));const discoveries=world.discoveries.filter(d=>d.actor.id===viewer.id);if(!discoveries.length)content.append(paragraph('Four authored field notes wait across the grounds.','empty-note'));for(const d of discoveries)content.append(button(guides[d.locationId].name+' →',()=>openGuide(d.locationId),{class:'list-button'}));
  content.append(node('h3',{class:'section-title',text:'METHODS EARNED BY REPAIR'}));if(!world.methods.length)content.append(paragraph('Publish a checked second version and preserve the first to earn a game method.','empty-note'));for(const method of world.methods)content.append(node('article',{class:'field-card'},[node('h3',{text:method.title}),paragraph(method.description),paragraph('An earned game practice, not a claim of external validation.','attribution')]));
  content.append(node('h3',{class:'section-title',text:'PRESERVE YOUR WORLD'}),paragraph(mode==='private'?'A successful save retains the previous copy as a backup. Exports include your private drafts. Imports are validated and replace only your private world.':'Shared exports are filtered to your current role. Imports can only open a private world; they never grant shared authority.','form-help'));
  const file=node('input',{id:'import-world',type:'file',accept:'.json,application/json'});file.onchange=guarded(async()=>{if(!file.files[0])return;if(file.files[0].size>32*1024*1024)throw new Error('World import exceeds 32 MiB.');const raw=JSON.parse(await file.files[0].text());const imported=await validateWorld(raw.world||raw);persist(imported);stream?.close();stream=null;mode='private';viewer=privateActor();world=imported;presence=[];selectedDraft=null;closeSheet();render();toast('Verified world imported privately. Shared authority was not changed.');});content.append(node('div',{class:'button-row'},[button('↓ Export world JSON',guarded(async()=>{const dto=mode==='shared'?await request('/api/export'):world;download('no-gas-labs-world.json',JSON.stringify(dto.world||dto,null,2),'application/json');toast('World export prepared with your current role’s visibility.')}),{id:'export-world',class:'secondary-button'})]),field('Import a saved world · opens privately','import-world',file));
  if(mode==='private')content.append(node('div',{class:'button-row'},[button('Recover previous local backup',guarded(async()=>{const raw=localStorage.getItem(BACKUP);if(!raw)throw new Error('There is no saved backup yet.');const recovered=await validateWorld(JSON.parse(raw));persist(recovered);world=recovered;render();openJournal();toast('Previous valid save recovered. Your replaced save is now the backup.')}),{id:'recover-backup',class:'secondary-button'})]));
  content.append(button('Projects, evidence and Founder Gate →',guarded(openInstitution),{id:'institution-projects',class:'list-button'}));
  if(institution){const details=node('details',{class:'institution-details'},[node('summary',{text:'Actual institutional instruments · kernel / courier / Forge'}),paragraph('Read-only capability evidence reported by the local service. This does not turn world XP into canonical authority.','form-help'),node('pre',{text:JSON.stringify(institution,null,2)})]);content.append(node('h3',{class:'section-title',text:'INSTITUTIONAL INSTRUMENTS'}),details)}
  content.append(node('h3',{class:'section-title',text:'CHANGE YOUR VIEW'}),node('div',{class:'button-row'},[button(mode==='shared'?'Open private world':'Enter shared world',guarded(async()=>{closeSheet();if(mode==='shared')await startPrivate();else await startShared()}),{class:'secondary-button'})]));
}
function openLogin(){const content=showSheet('Founder access.','SHARED WORLD · AUTHENTICATED SESSION');content.append(paragraph('Use the Founder key configured for this local service. It stays out of world exports and is never saved by this client.'));const key=node('input',{id:'founder-key',type:'password',autocomplete:'off',placeholder:'Local Founder key'});const name=node('input',{id:'founder-name',value:'Damien',maxlength:'80',autocomplete:'nickname'});const form=node('form',{},[field('Founder name','founder-name',name),field('Founder key','founder-key',key),node('div',{class:'button-row'},[node('button',{id:'verify-founder',type:'submit',class:'primary-button',text:'Verify Founder access'})])]);form.onsubmit=guarded(async e=>{e.preventDefault();const dto=await request('/api/login',{key:key.value,name:name.value});key.value='';if(mode!=='shared'){mode='shared';$('doorway').hidden=true;$('play-ui').hidden=false;}acceptState(dto);closeSheet();await startShared();toast('Founder session verified by the local service.');});content.append(form,paragraph('Opening a private save or changing browser data cannot authorize shared publication.','form-help'));key.focus({preventScroll:true});}
async function launch(){if(busy)return;busy=true;const launchButton=$('caveman-launch');launchButton.disabled=true;try{if(!mode)await startPrivate();if(!requireFounder())return;const content=showSheet('Making the stage.','CAVEMAN LAUNCHPAD · LOCAL REHEARSAL');content.append(paragraph('Preparing real playable creations and checking the public exhibition bytes. This can take a moment for the recovered artwork.','status-line'));
    if(!world.creations.length){for(const kind of ['comic','loom','observatory']){const r=recipes[kind];content.append(paragraph(`Making ${r.title}…`,'form-help'));const drafted=await act({type:'draft',kind,title:r.title,intent:r.intent});await act({type:'publish',draftId:drafted.draftId,expectedVersion:0});}}
    launchReport=mode==='shared'?await request('/api/launch',{}):await rehearseLaunch(world,{title:'A world worth making.',tagline:'A small local exhibition from No_Gas_Labs™.'});launchReport=launchReport.report||launchReport;launchHTML=makeLaunchPage(world,launchReport);showLaunchReport();openStage();toast(`${launchReport.checks.filter(c=>c.passed).length}/${launchReport.checks.length} actual rehearsal checks passed. No external posting occurred.`);
  }finally{busy=false;launchButton.disabled=false}}
function announcement(){return launchReport?.announcement||`I made a small playable No_Gas_Labs exhibition with ${world.creations.length} published creation${world.creations.length===1?'':'s'}. The local launch rehearsal passed ${launchReport.checks.filter(c=>c.passed).length}/${launchReport.checks.length} checks. It is a local artifact ready to share by choice; no live AI execution, public deployment, demand or revenue is claimed.`;}
function showLaunchReport(){const content=showSheet(launchReport.ready?'The stage is ready.':'A stage worth checking.','CAVEMAN LAUNCHPAD · REHEARSAL');content.append(paragraph(`${launchReport.artifactCount} real published creations. ${launchReport.checks.filter(c=>c.passed).length}/${launchReport.checks.length} checks passed. No external posting has occurred.`),node('ul',{class:'check-list'},launchReport.checks.map(check=>node('li',{class:check.passed?'':'failed'},[node('span',{class:'check-symbol',text:check.passed?'✓':'!'}),node('span',{},[node('span',{text:check.label}),node('small',{text:typeof check.detail==='string'?check.detail:JSON.stringify(check.detail??'')})])]))),node('div',{class:'button-row'},[button('Open the exhibition ↗',openStage,{id:'open-stage',class:'primary-button'}),button('↓ Download stage HTML',()=>download('no-gas-labs-exhibition.html',launchHTML),{id:'download-launch',class:'secondary-button'})]));const copy=node('textarea',{id:'launch-announcement',class:'announcement',readonly:'',rows:'6',value:announcement()});content.append(field('A fact-based announcement · copy and share by choice','launch-announcement',copy),node('div',{class:'button-row'},[button('Copy announcement',guarded(async()=>{try{await navigator.clipboard.writeText(copy.value);toast('Announcement copied. No message was posted.')}catch{copy.focus();copy.select();toast('Announcement selected. Use your device’s Copy action.')}}),{id:'copy-announcement',class:'secondary-button'})]));for(const limitation of launchReport.limitations||[])content.append(paragraph(limitation,'launch-claim'));}
function openStage(){openPortal({title:'Your local exhibition.',html:launchHTML,stage:true,kicker:'CAVEMAN LAUNCHPAD · REHEARSAL STAGE',footer:[paragraph(`${launchReport.artifactCount} playable creations · checked local artifact · you choose when and where to share.`),button('↓ Download stage',()=>download('no-gas-labs-exhibition.html',launchHTML),{id:'download-stage',class:'primary-button'}),button('View actual checks',()=>{closePortal();showLaunchReport()},{class:'secondary-button'})]})}

$('start-private').onclick=guarded(startPrivate);$('start-shared').onclick=guarded(startShared);$('caveman-launch').onclick=guarded(launch);$('launch-shortcut').onclick=guarded(launch);$('make-button').onclick=()=>openWorkshop();$('places-button').onclick=openPlaces;$('journal-button').onclick=openJournal;$('home-button').onclick=e=>{e.preventDefault();if(mode)openJournal()};$('quest-button').onclick=()=>{const quest=getQuest(world,viewer);if(quest.action==='workbench')view.goTo('workbench');else openPlaces()};$('character-button').onclick=openCharacterSheet;$('interact-button').onclick=()=>view.interact();$('sheet-close').onclick=closeSheet;$('sheet-backdrop').onclick=closeSheet;$('portal-close').onclick=closePortal;$('login-button').onclick=openLogin;$('logout-button').onclick=guarded(async()=>{const dto=await request('/api/logout',{});closePortal();closeSheet();selectedDraft=null;acceptState(dto);await startShared();toast('Logged out. The shared world is now shown as Witness.');});
for(const pad of document.querySelectorAll('#movement-pad button')){const stop=()=>view.setInput({x:0,y:0});pad.addEventListener('pointerdown',e=>{e.preventDefault();pad.setPointerCapture(e.pointerId);view.setInput({x:Number(pad.dataset.dx||0),y:Number(pad.dataset.dy||0)})});pad.addEventListener('pointerup',stop);pad.addEventListener('pointercancel',stop);pad.addEventListener('lostpointercapture',stop)}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('portal').hidden){e.preventDefault();closePortal()}else if(!$('sheet').hidden){e.preventDefault();closeSheet()}}if(e.key==='Tab'&&document.body.classList.contains('modal-open')){const modal=!$('portal').hidden?$('portal'):$('sheet');const elements=[...modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],iframe,[tabindex="0"]')].filter(el=>!el.hidden&&el.getClientRects().length);const first=elements[0],last=elements.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}});
addEventListener('pagehide',()=>stream?.close());
