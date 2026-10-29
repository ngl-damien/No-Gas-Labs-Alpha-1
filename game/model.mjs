import {createArtifact} from './artifacts.mjs';
import {isStrictTimestamp} from './timestamps.mjs';
const encoder=new TextEncoder();
const kinds=new Set(['comic','loom','observatory','custom']);
const challengeTypes=new Set(['missing-evidence','methodology','contradiction','reproducibility','scope','other']);
const knownPlaces=new Set(['relay','river','overlook','ruins']);
const slots=[{x:540,y:610},{x:480,y:395},{x:1120,y:560},{x:1190,y:390},{x:1050,y:830},{x:380,y:800},{x:650,y:825},{x:1450,y:590},{x:270,y:310},{x:1400,y:180},{x:1100,y:190},{x:530,y:180}];
const clone=value=>structuredClone(value);
const uid=prefix=>`${prefix}-${globalThis.crypto.randomUUID()}`;
const fail=(code,message,status=400)=>{throw Object.assign(new Error(message),{code,status})};
const date=now=>new Date(now??Date.now()).toISOString();
function text(value,max,label,{empty=false}={}){if(typeof value!=='string'||(!empty&&!value.trim()))fail('INVALID_INPUT',`${label} is required.`);if(Array.from(value).length>max)fail('TOO_LARGE',`${label} exceeds ${max} characters.`,413);return value.trim();}
function actorFor(actor){if(!actor||typeof actor.id!=='string'||!actor.id||!['founder','witness'].includes(actor.role))fail('INVALID_ACTOR','A valid actor is required.',403);return {id:actor.id,name:text(actor.name||'Witness',80,'Name'),role:actor.role};}
async function receipt(html){const bytes=encoder.encode(html);const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);return {algorithm:'sha256',digest:Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join(''),size:bytes.length};}
function event(world,type,actor,at,detail={},requestMeta){const meta=requestMeta?{requestId:requestMeta.requestId,actionFingerprint:requestMeta.actionFingerprint,actionResult:clone(requestMeta.actionResult)}:{};world.events.push({id:uid('event'),type,actor:clone(actor),at,...detail,...meta,semantics:'Game projection only; XP and buildings do not assert external truth, demand, AI execution or institutional authority.'});}
export function createWorld({id=uid('world'),founderName='Damien Featherstone',now}={}) {const at=date(now);return {schema:'ngl.world.v2',id,founderName,revision:0,xp:0,createdAt:at,updatedAt:at,creations:[],drafts:[],events:[],contributions:[],reports:[],discoveries:[],methods:[]};}
export async function applyAction(original,action,actor,{now,requestId,actionFingerprint}={}) {
  const who=actorFor(actor);if(!action||typeof action.type!=='string')fail('INVALID_ACTION','Choose an action.');
  if(['draft','publish','repair'].includes(action.type)&&who.role!=='founder')fail('FORBIDDEN','Only an authenticated Founder can draft, repair or publish.',403);
  if(requestId!==undefined&&(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)||typeof actionFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(actionFingerprint)))fail('INVALID_REQUEST_RECEIPT','A bounded request ID and SHA-256 action fingerprint are required.');if(requestId===undefined&&actionFingerprint!==undefined)fail('INVALID_REQUEST_RECEIPT','An action fingerprint requires a request ID.');
  const world=clone(original),at=date(now);const previousAt=Date.parse(original?.updatedAt);if(!isStrictTimestamp(original?.updatedAt)||!Number.isFinite(previousAt)||Date.parse(at)<previousAt)fail('INVALID_CHRONOLOGY','Action time cannot precede the current world update time.',409);let result={};const requestMeta=requestId===undefined?null:{requestId,actionFingerprint};const recordEvent=(type,detail)=>event(world,type,who,at,detail,requestMeta?{...requestMeta,actionResult:result}:undefined);
  const creation=()=>{const c=world.creations.find(c=>c.id===action.creationId);if(!c)fail('NOT_FOUND','Creation not found.',404);if(action.version!==undefined&&action.version!==c.version&&!c.versions.some(v=>v.version===action.version))fail('STALE_VERSION','That published version does not exist.',409);return c;};
  switch(action.type){
    case 'draft':{
      if(!kinds.has(action.kind))fail('INVALID_KIND','Choose a known recipe.');
      if(world.creations.length>=12)fail('WORLD_FULL','This world holds twelve creations.',409);
      if(world.drafts.length>=24)fail('DRAFT_LIMIT','Finish an existing draft first.',409);
      const title=text(action.title,80,'Title'),intent=text(action.intent??'',2000,'Intent',{empty:true});
      if(action.html!==undefined&&typeof action.html!=='string')fail('INVALID_INPUT','HTML must be text.');
      if(encoder.encode(action.html||'').length>131072)fail('TOO_LARGE','Custom HTML exceeds 128 KiB.',413);
      const built=createArtifact({kind:action.kind,title,intent,html:action.html});
      const draft={id:uid('draft'),creationId:null,baseVersion:0,kind:action.kind,title,intent,html:built.html,receipt:await receipt(built.html),version:1,position:clone(slots[world.creations.length]),checks:built.checks,createdAt:at};
      world.drafts.push(draft);result={draftId:draft.id};recordEvent('draft',{draftId:draft.id});break;
    }
    case 'publish':{
      const index=world.drafts.findIndex(d=>d.id===action.draftId);if(index<0)fail('STALE_DRAFT','That draft is no longer available.',409);
      const d=world.drafts[index],existing=d.creationId?world.creations.find(c=>c.id===d.creationId):null;
      const base=existing?.version??0;if(action.expectedVersion!==base||d.baseVersion!==base)fail('STALE_VERSION','This draft was based on a different version. Repair the current version.',409);
      if(!d.checks.length||d.checks.some(c=>!c.passed))fail('CHECKS_FAILED','The draft checks must pass before publication.',409);
      const exact=await receipt(d.html);if(exact.digest!==d.receipt.digest||exact.size!==d.receipt.size)fail('INVALID_RECEIPT','Draft bytes changed.',409);
      if(!existing&&world.creations.length>=12)fail('WORLD_FULL','This world holds twelve creations.',409);
      const id=existing?.id??uid('creation');
      const previous=existing?clone(existing):null;if(previous)delete previous.versions;
      const published={...d,id,version:base+1,position:existing?.position??clone(slots[world.creations.length]),publishedAt:at,versions:existing?[...existing.versions,previous]:[]};delete published.creationId;delete published.baseVersion;delete published.createdAt;
      if(existing)world.creations[world.creations.indexOf(existing)]=published;else world.creations.push(published);
      world.drafts.splice(index,1);world.xp+=100;
      if(existing)world.methods.push({id:uid('method'),creationId:id,version:published.version,title:`Repair ${published.title} · v${published.version}`,description:published.intent||'Publish a checked revision while preserving the prior version and its exact bytes.',actor:who,at,semantics:'Earned game method: a retained, checked repair; no external truth or authority claim.'});
      result={creationId:id,version:published.version};recordEvent('publish',{creationId:id,version:published.version,reward:100});break;
    }
    case 'repair':{
      const c=creation();if(action.expectedVersion!==c.version)fail('STALE_VERSION','Repair the current published version.',409);
      if(world.drafts.length>=24)fail('DRAFT_LIMIT','Finish an existing draft first.',409);
      const intent=action.intent===undefined?c.intent:text(action.intent,2000,'Intent',{empty:true});
      if(action.html!==undefined&&typeof action.html!=='string')fail('INVALID_INPUT','HTML must be text.');
      if(encoder.encode(action.html||'').length>131072)fail('TOO_LARGE','Custom HTML exceeds 128 KiB.',413);
      const built=createArtifact({kind:c.kind,title:c.title,intent,html:action.html??(c.kind==='custom'?undefined:'') ,version:c.version+1});
      // A custom repair preserves the existing portable document until an explicitly supplied replacement is drafted.
      const html=c.kind==='custom'&&action.html===undefined?c.html:built.html;
      const draft={id:uid('draft'),creationId:c.id,baseVersion:c.version,kind:c.kind,title:c.title,intent,html,receipt:await receipt(html),version:c.version+1,position:clone(c.position),checks:built.checks,createdAt:at};world.drafts.push(draft);result={draftId:draft.id};recordEvent('repair',{creationId:c.id,draftId:draft.id,baseVersion:c.version});break;
    }
    case 'contribute':case 'report':{
      const c=creation();if(!Number.isInteger(action.version)||action.version<1)fail('INVALID_VERSION','Select a published version.');
      const isReport=action.type==='report';const entry={id:uid(isReport?'report':'note'),creationId:c.id,version:action.version,text:text(action.text,isReport?1000:500,isReport?'Report':'Contribution'),actor:who,at};world[isReport?'reports':'contributions'].push(entry);result={id:entry.id};recordEvent(action.type,{creationId:c.id,version:action.version});break;
    }
    case 'study':{
      if(!Number.isSafeInteger(action.version)||action.version<1)fail('INVALID_VERSION','Select a retained published version.');
      const c=creation();
      const version=c.version===action.version?c:c.versions.find(v=>v.version===action.version);
      if(!version||!isStrictTimestamp(version.publishedAt)||Date.parse(version.publishedAt)>Date.parse(at))fail('STALE_VERSION','That study version is not retained at the study time.',409);
      const question=text(action.question,500,'Study question');
      const attempt=text(action.attempt,1000,'Your explanation');
      const nextCheck=text(action.nextCheck,500,'Next check');
      const studyId=uid('study');
      result={studyId};
      recordEvent('study',{studyId,creationId:c.id,version:action.version,question,attempt,nextCheck});
      break;
    }
    case 'review-study':{
      const studyId=text(action.studyId,128,'Study note ID');
      const matches=world.events.filter(e=>e.type==='study'&&e.studyId===studyId);
      if(matches.length!==1)fail('NOT_FOUND','A unique retained study note is required before reviewing it.',404);
      const source=matches[0];
      if(source.actor.id!==who.id||source.actor.role!==who.role)fail('FORBIDDEN','Only the study note author can review their own next check.',403);
      if(Date.parse(source.at)>=Date.parse(at))fail('INVALID_CHRONOLOGY','A retrieval review must follow its source study note.',409);
      if(world.events.some(e=>e.type==='study-reviewed'&&e.studyId===studyId))fail('STUDY_ALREADY_REVIEWED','This study note already has a retained review; create a new note for another practice cycle.',409);
      const retained=world.creations.find(item=>item.id===source.creationId);
      const version=retained&&(retained.version===source.version?retained:retained.versions.find(item=>item.version===source.version));
      if(!version||!isStrictTimestamp(version.publishedAt)||Date.parse(version.publishedAt)>Date.parse(at))fail('STALE_VERSION','The reviewed source version is no longer available at the review time.',409);
      const response=text(action.response,1000,'Retrieval response');
      const reflection=text(action.reflection,1000,'Reflection');
      const reviewId=uid('study-review');
      result={reviewId};
      recordEvent('study-reviewed',{reviewId,studyId,creationId:source.creationId,version:source.version,response,reflection});
      break;
    }
    case 'propose-moonshot':{
      const title=text(action.title,80,'Moonshot title');
      const hypothesis=text(action.hypothesis,1000,'Hypothesis');
      const falsifier=text(action.falsifier,1000,'Falsification condition');
      const evidenceNeeded=text(action.evidenceNeeded,1000,'Evidence needed');
      const hasSourceId=action.sourceCreationId!==undefined&&action.sourceCreationId!==null;
      const hasSourceVersion=action.sourceVersion!==undefined&&action.sourceVersion!==null;
      if(hasSourceId!==hasSourceVersion)fail('INVALID_SOURCE','Choose both a source artifact and version, or neither.');
      let sourceCreationId=null,sourceVersion=null;
      if(hasSourceId){
        if(typeof action.sourceCreationId!=='string'||!action.sourceCreationId.trim()||!Number.isSafeInteger(action.sourceVersion)||action.sourceVersion<1)fail('INVALID_SOURCE','Source artifact and version must be valid.');
        const source=world.creations.find(c=>c.id===action.sourceCreationId);
        if(!source)fail('NOT_FOUND','Source artifact not found.',404);
        const version=source.version===action.sourceVersion?source:source.versions.find(v=>v.version===action.sourceVersion);
        if(!version)fail('STALE_VERSION','That source version is not retained.',409);
        if(!isStrictTimestamp(version.publishedAt)||Date.parse(version.publishedAt)>Date.parse(at))fail('STALE_VERSION','That source version was not published at the proposal time.',409);
        sourceCreationId=source.id;sourceVersion=action.sourceVersion;
      }
      const moonshotId=uid('moonshot');
      result={moonshotId};
      recordEvent('moonshot-proposed',{moonshotId,title,hypothesis,falsifier,evidenceNeeded,sourceCreationId,sourceVersion});
      break;
    }
    case 'report-experiment':{
      const moonshotId=text(action.moonshotId,128,'Moonshot ID');
      const proposals=world.events.filter(e=>e.type==='moonshot-proposed'&&e.moonshotId===moonshotId);
      if(proposals.length!==1||!isStrictTimestamp(proposals[0].at)||Date.parse(proposals[0].at)>Date.parse(at))fail('NOT_FOUND','A unique earlier retained moonshot proposal is required before reporting an attempt.',404);
      const procedure=text(action.procedure,1000,'Procedure');
      const observation=text(action.observation,1000,'Observation');
      const reportedOutcome=action.reportedOutcome;
      if(!['supports','contradicts','inconclusive','failed'].includes(reportedOutcome))fail('INVALID_OUTCOME','Choose a bounded self-reported outcome.');
      const hasEvidenceId=action.evidenceCreationId!==undefined&&action.evidenceCreationId!==null;
      const hasEvidenceVersion=action.evidenceVersion!==undefined&&action.evidenceVersion!==null;
      if(hasEvidenceId!==hasEvidenceVersion)fail('INVALID_EVIDENCE','Choose both a retained evidence artifact and version, or neither.');
      let evidenceCreationId=null,evidenceVersion=null;
      if(hasEvidenceId){
        if(typeof action.evidenceCreationId!=='string'||!action.evidenceCreationId.trim()||!Number.isSafeInteger(action.evidenceVersion)||action.evidenceVersion<1)fail('INVALID_EVIDENCE','Evidence artifact and version must be valid.');
        const source=world.creations.find(c=>c.id===action.evidenceCreationId);
        if(!source)fail('NOT_FOUND','Evidence artifact not found.',404);
        const version=source.version===action.evidenceVersion?source:source.versions.find(v=>v.version===action.evidenceVersion);
        if(!version||!isStrictTimestamp(version.publishedAt)||Date.parse(version.publishedAt)>Date.parse(at))fail('STALE_VERSION','That evidence version is not retained at the report time.',409);
        evidenceCreationId=source.id;evidenceVersion=action.evidenceVersion;
      }
      const reportId=uid('experiment-report');
      result={reportId};
      recordEvent('experiment-reported',{reportId,moonshotId,procedure,observation,reportedOutcome,evidenceCreationId,evidenceVersion});
      break;
    }
    case 'challenge-experiment-report':{
      const reportId=text(action.reportId,128,'Experiment report ID');
      const matches=world.events.filter(e=>e.type==='experiment-reported'&&e.reportId===reportId);
      if(matches.length!==1||Date.parse(matches[0].at)>Date.parse(at))fail('NOT_FOUND','A retained earlier experiment report is required before challenging it.',404);
      const report=matches[0];
      if(report.actor.id===who.id)fail('SELF_CHALLENGE','A different actor ID must challenge this report.',409);
      if(!challengeTypes.has(action.challengeType))fail('INVALID_CHALLENGE_TYPE','Choose a bounded challenge category.');
      const challengeText=text(action.challengeText,1000,'Challenge text');
      const hasEvidenceId=action.evidenceCreationId!==undefined&&action.evidenceCreationId!==null;
      const hasEvidenceVersion=action.evidenceVersion!==undefined&&action.evidenceVersion!==null;
      if(hasEvidenceId!==hasEvidenceVersion)fail('INVALID_EVIDENCE','Choose both a retained challenge-evidence artifact and version, or neither.');
      let evidenceCreationId=null,evidenceVersion=null;
      if(hasEvidenceId){
        if(typeof action.evidenceCreationId!=='string'||!action.evidenceCreationId.trim()||!Number.isSafeInteger(action.evidenceVersion)||action.evidenceVersion<1)fail('INVALID_EVIDENCE','Challenge evidence artifact and version must be valid.');
        const source=world.creations.find(c=>c.id===action.evidenceCreationId);
        if(!source)fail('NOT_FOUND','Challenge evidence artifact not found.',404);
        const version=source.version===action.evidenceVersion?source:source.versions.find(v=>v.version===action.evidenceVersion);
        if(!version||!isStrictTimestamp(version.publishedAt)||Date.parse(version.publishedAt)>Date.parse(at))fail('STALE_VERSION','That challenge evidence version is not retained at the challenge time.',409);
        evidenceCreationId=source.id;evidenceVersion=action.evidenceVersion;
      }
      const challengeId=uid('experiment-challenge');
      result={challengeId};
      recordEvent('experiment-challenged',{challengeId,reportId,moonshotId:report.moonshotId,challengeType:action.challengeType,challengeText,evidenceCreationId,evidenceVersion});
      break;
    }
    case 'discover':{
      if(!knownPlaces.has(action.locationId))fail('INVALID_LOCATION','That place is not on this map.');
      if(world.discoveries.some(d=>d.actor.id===who.id&&d.locationId===action.locationId)){result={discovered:false};recordEvent('discover',{locationId:action.locationId,repeat:true});break;}
      const d={id:uid('discovery'),locationId:action.locationId,actor:who,at};world.discoveries.push(d);result={discovered:true};recordEvent('discover',{locationId:action.locationId});break;
    }
    default:fail('INVALID_ACTION','Unknown world action.');
  }
  world.revision++;world.updatedAt=at;return {world,result};
}
export function publicWorld(world,actor){const copy=clone(world);if(actor?.role!=='founder'){copy.drafts=[];copy.events=copy.events.filter(e=>!['draft','repair'].includes(e.type));}return copy;}
export async function validateWorld(raw) {
  const invalid=message=>fail('INVALID_WORLD',message);
  try{if(encoder.encode(JSON.stringify(raw)).length>32*1024*1024)invalid('World import exceeds 32 MiB.');}catch(error){if(error.code)throw error;invalid('World must be serializable JSON.');}
  if(!raw||raw.schema!=='ngl.world.v2'||typeof raw.id!=='string'||typeof raw.founderName!=='string'||!Number.isInteger(raw.revision)||raw.revision<0)invalid('Unsupported or malformed world.');
  for(const key of ['creations','drafts','events','contributions','reports','discoveries','methods'])if(!Array.isArray(raw[key]))invalid(`Missing ${key}.`);
  const createdAt=Date.parse(raw.createdAt),updatedAt=Date.parse(raw.updatedAt);if(raw.creations.length>12||raw.drafts.length>24||!isStrictTimestamp(raw.createdAt)||!isStrictTimestamp(raw.updatedAt)||!Number.isFinite(createdAt)||!Number.isFinite(updatedAt)||createdAt>updatedAt)invalid('Invalid world bounds.');
  const ids=new Set(),requestIds=new Set();const unique=id=>{if(typeof id!=='string'||!id||ids.has(id))invalid('Duplicate or missing identity.');ids.add(id)};
  const checkArtifact=async a=>{
    if(!a||!kinds.has(a.kind)||typeof a.title!=='string'||Array.from(a.title).length>80||typeof a.intent!=='string'||Array.from(a.intent).length>2000||typeof a.html!=='string'||encoder.encode(a.html).length>4*1024*1024||!Number.isInteger(a.version)||a.version<1||!a.position||!Number.isFinite(a.position.x)||!Number.isFinite(a.position.y)||a.position.x<80||a.position.x>1520||a.position.y<80||a.position.y>920||!Array.isArray(a.checks)||!a.checks.length||a.checks.some(c=>typeof c.id!=='string'||c.passed!==true))invalid('Malformed creation.');
    const exact=await receipt(a.html);if(a.receipt?.algorithm!=='sha256'||a.receipt.digest!==exact.digest||a.receipt.size!==exact.size)fail('INVALID_RECEIPT','Artifact bytes do not match their receipt.');
  };
  for(const c of raw.creations){unique(c.id);await checkArtifact(c);if(!Array.isArray(c.versions)||c.versions.length!==c.version-1)invalid('Incomplete version history.');for(let i=0;i<c.versions.length;i++){const v=c.versions[i];if(v.id!==c.id||v.version!==i+1||v.versions!==undefined)invalid('Invalid flat version history.');await checkArtifact(v)}}
  for(const d of raw.drafts){unique(d.id);await checkArtifact(d);if(!Number.isInteger(d.baseVersion)||d.baseVersion<0||d.version!==d.baseVersion+1)invalid('Invalid draft base.');if(d.creationId&&!raw.creations.some(c=>c.id===d.creationId))invalid('Orphan draft.');}
  if(raw.xp!==raw.creations.reduce((sum,c)=>sum+c.version*100,0))invalid('Game rewards do not match published versions.');
  let previousEventAt=createdAt;for(const e of raw.events){unique(e.id);actorFor(e.actor);const eventAt=Date.parse(e.at);if(typeof e.type!=='string'||!isStrictTimestamp(e.at)||!Number.isFinite(eventAt)||eventAt<previousEventAt||typeof e.semantics!=='string')invalid('Malformed event chronology.');previousEventAt=eventAt;if(e.repeat!==undefined&&e.type==='discover'&&typeof e.repeat!=='boolean')invalid('Malformed repeat-discovery event.');const receiptFields=['requestId','actionFingerprint','actionResult'],present=receiptFields.filter(key=>Object.hasOwn(e,key));if(present.length&&present.length!==receiptFields.length)invalid('Incomplete idempotency receipt.');if(present.length===receiptFields.length){if(typeof e.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(e.requestId)||requestIds.has(e.requestId)||typeof e.actionFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(e.actionFingerprint))invalid('Malformed or repeated idempotency receipt.');requestIds.add(e.requestId);const r=e.actionResult;if(!r||typeof r!=='object'||Array.isArray(r))invalid('Malformed idempotency result.');const keys=Object.keys(r).sort().join(',');const expected={draft:'draftId',repair:'draftId',publish:'creationId,version',contribute:'id',report:'id',study:'studyId','study-reviewed':'reviewId',discover:'discovered','moonshot-proposed':'moonshotId','experiment-reported':'reportId','experiment-challenged':'challengeId'}[e.type];if(!expected||keys!==expected)invalid('Idempotency result does not match the event type.');if((e.type==='draft'||e.type==='repair')&&r.draftId!==e.draftId)invalid('Idempotency draft result mismatch.');if(e.type==='publish'&&(r.creationId!==e.creationId||r.version!==e.version))invalid('Idempotency publication result mismatch.');if(e.type==='moonshot-proposed'&&r.moonshotId!==e.moonshotId)invalid('Idempotency moonshot result mismatch.');if(e.type==='experiment-reported'&&r.reportId!==e.reportId)invalid('Idempotency experiment report result mismatch.');if(e.type==='experiment-challenged'&&r.challengeId!==e.challengeId)invalid('Idempotency experiment challenge result mismatch.');if(e.type==='study'&&r.studyId!==e.studyId)invalid('Idempotency study result mismatch.');if(e.type==='study-reviewed'&&r.reviewId!==e.reviewId)invalid('Idempotency study review result mismatch.');if((e.type==='contribute'||e.type==='report')&&(typeof r.id!=='string'||!raw[e.type==='report'?'reports':'contributions'].some(n=>n.id===r.id&&n.creationId===e.creationId&&n.version===e.version&&n.at===e.at&&n.actor.id===e.actor.id)))invalid('Idempotency contribution result mismatch.');if(e.type==='discover'&&(typeof r.discovered!=='boolean'||(e.repeat===true&&r.discovered)||(e.repeat===true&&!raw.discoveries.some(d=>d.locationId===e.locationId&&d.actor.id===e.actor.id&&Date.parse(d.at)<=Date.parse(e.at)))||(e.repeat!==true&&!r.discovered)))invalid('Idempotency discovery result mismatch.');}}
  if(raw.events.length?updatedAt!==previousEventAt:updatedAt!==createdAt)invalid('World timestamps do not match retained event history.');
  for(const creation of raw.creations)for(const version of [...creation.versions,creation]){const publishedAt=Date.parse(version.publishedAt);const publications=raw.events.filter(e=>e.type==='publish'&&e.creationId===version.id&&e.version===version.version);if(!isStrictTimestamp(version.publishedAt)||!Number.isFinite(publishedAt)||publications.length!==1||!isStrictTimestamp(publications[0].at)||Date.parse(publications[0].at)!==publishedAt)invalid('Published version timestamp does not match retained publication history.');}
  for(const e of raw.events)if(e.type==='moonshot-proposed'){
    unique(e.moonshotId);
    if(typeof e.title!=='string'||!e.title.trim()||Array.from(e.title).length>80||
       typeof e.hypothesis!=='string'||!e.hypothesis.trim()||Array.from(e.hypothesis).length>1000||
       typeof e.falsifier!=='string'||!e.falsifier.trim()||Array.from(e.falsifier).length>1000||
       typeof e.evidenceNeeded!=='string'||!e.evidenceNeeded.trim()||Array.from(e.evidenceNeeded).length>1000)invalid('Malformed moonshot proposal.');
    if(!(e.sourceCreationId===null&&e.sourceVersion===null)){
      if(typeof e.sourceCreationId!=='string'||!e.sourceCreationId.trim()||!Number.isSafeInteger(e.sourceVersion)||e.sourceVersion<1)invalid('Malformed moonshot source reference.');
      const source=raw.creations.find(c=>c.id===e.sourceCreationId);
      const version=source&&(source.version===e.sourceVersion?source:source.versions.find(v=>v.version===e.sourceVersion));
      if(!version||!isStrictTimestamp(version.publishedAt)||Date.parse(version.publishedAt)>Date.parse(e.at))invalid('Malformed moonshot source reference.');
    }
  }
  const reportIds=new Set(),experimentReports=new Map(),challengeIds=new Set();
  const allowedReportedOutcomes=new Set(['supports','contradicts','inconclusive','failed']);
  const allowedExperimentKeys=new Set(['id','type','actor','at','semantics','reportId','moonshotId','procedure','observation','reportedOutcome','evidenceCreationId','evidenceVersion','requestId','actionFingerprint','actionResult']);
  for(const e of raw.events)if(e.type==='experiment-reported'){
    if(Object.keys(e).some(key=>!allowedExperimentKeys.has(key)))invalid('Experiment report contains unsupported canonical fields.');
    unique(e.reportId);
    if(reportIds.has(e.reportId))invalid('Duplicate experiment report identity.');
    reportIds.add(e.reportId);
    experimentReports.set(e.reportId,e);
    if(typeof e.reportId!=='string'||!e.reportId||typeof e.moonshotId!=='string'||!e.moonshotId||
       typeof e.procedure!=='string'||!e.procedure.trim()||Array.from(e.procedure).length>1000||
       typeof e.observation!=='string'||!e.observation.trim()||Array.from(e.observation).length>1000||
       !allowedReportedOutcomes.has(e.reportedOutcome))invalid('Malformed experiment report.');
    const reportIndex=raw.events.indexOf(e);
    const proposals=raw.events.slice(0,reportIndex).filter(proposal=>proposal.type==='moonshot-proposed'&&proposal.moonshotId===e.moonshotId&&Date.parse(proposal.at)<=Date.parse(e.at));
    if(proposals.length!==1)invalid('Experiment report must reference one earlier retained moonshot proposal.');
    const hasEvidenceId=typeof e.evidenceCreationId==='string'&&e.evidenceCreationId.length>0;
    const hasEvidenceVersion=Number.isSafeInteger(e.evidenceVersion)&&e.evidenceVersion>0;
    if(hasEvidenceId!==hasEvidenceVersion)invalid('Experiment evidence reference is incomplete.');
    if(!hasEvidenceId){
      if(e.evidenceCreationId!==null||e.evidenceVersion!==null)invalid('Unlinked experiment evidence must be explicitly null.');
    }else{
      const source=raw.creations.find(c=>c.id===e.evidenceCreationId);
      const version=source&&(source.version===e.evidenceVersion?source:source.versions.find(v=>v.version===e.evidenceVersion));
      if(!version||!isStrictTimestamp(version.publishedAt)||Date.parse(version.publishedAt)>Date.parse(e.at))invalid('Experiment evidence version is not retained at the report time.');
    }
  }
  const allowedChallengeKeys=new Set(['id','type','actor','at','semantics','challengeId','reportId','moonshotId','challengeType','challengeText','evidenceCreationId','evidenceVersion','requestId','actionFingerprint','actionResult']);
  for(let index=0;index<raw.events.length;index++){
    const e=raw.events[index];if(e.type!=='experiment-challenged')continue;
    if(Object.keys(e).some(key=>!allowedChallengeKeys.has(key)))invalid('Experiment challenge contains unsupported canonical fields.');
    unique(e.challengeId);
    if(challengeIds.has(e.challengeId)||typeof e.challengeId!=='string'||!e.challengeId||typeof e.reportId!=='string'||!e.reportId||typeof e.moonshotId!=='string'||!e.moonshotId||!challengeTypes.has(e.challengeType)||typeof e.challengeText!=='string'||!e.challengeText.trim()||Array.from(e.challengeText).length>1000)invalid('Malformed or repeated experiment challenge.');
    challengeIds.add(e.challengeId);
    const report=experimentReports.get(e.reportId),reportIndex=raw.events.findIndex(item=>item.type==='experiment-reported'&&item.reportId===e.reportId);
    if(!report||reportIndex<0||reportIndex>=index||report.moonshotId!==e.moonshotId||report.actor.id===e.actor.id||Date.parse(report.at)>Date.parse(e.at))invalid('Experiment challenge must target an earlier report from a different actor.');
    const hasEvidenceId=typeof e.evidenceCreationId==='string'&&e.evidenceCreationId.length>0;
    const hasEvidenceVersion=Number.isSafeInteger(e.evidenceVersion)&&e.evidenceVersion>0;
    if(hasEvidenceId!==hasEvidenceVersion)invalid('Experiment challenge evidence reference is incomplete.');
    if(!hasEvidenceId){
      if(e.evidenceCreationId!==undefined&&e.evidenceCreationId!==null)invalid('Unlinked challenge evidence must be explicitly null.');
      if(e.evidenceVersion!==undefined&&e.evidenceVersion!==null)invalid('Unlinked challenge evidence version must be explicitly null.');
    }else{
      const source=raw.creations.find(c=>c.id===e.evidenceCreationId);
      const version=source&&(source.version===e.evidenceVersion?source:source.versions.find(v=>v.version===e.evidenceVersion));
      if(!version||!isStrictTimestamp(version.publishedAt)||Date.parse(version.publishedAt)>Date.parse(e.at))invalid('Experiment challenge evidence version is not retained at the challenge time.');
    }
  }
  const allowedStudyKeys=new Set(['id','type','actor','at','semantics','studyId','creationId','version','question','attempt','nextCheck','requestId','actionFingerprint','actionResult']);
  for(const e of raw.events)if(e.type==='study'){
    if(Object.keys(e).some(key=>!allowedStudyKeys.has(key)))invalid('Study note contains unsupported canonical fields.');
    unique(e.studyId);
    if(typeof e.studyId!=='string'||!e.studyId||typeof e.creationId!=='string'||!e.creationId||
       !Number.isSafeInteger(e.version)||e.version<1||
       typeof e.question!=='string'||!e.question.trim()||Array.from(e.question).length>500||
       typeof e.attempt!=='string'||!e.attempt.trim()||Array.from(e.attempt).length>1000||
       typeof e.nextCheck!=='string'||!e.nextCheck.trim()||Array.from(e.nextCheck).length>500)invalid('Malformed Academy study note.');
    const source=raw.creations.find(c=>c.id===e.creationId);
    const versions=source?[...source.versions,source].filter(v=>v.version===e.version):[];
    const publicationEvents=raw.events.filter(p=>p.type==='publish'&&p.creationId===e.creationId&&p.version===e.version);
    if(versions.length!==1||!isStrictTimestamp(versions[0].publishedAt)||
       Date.parse(versions[0].publishedAt)>Date.parse(e.at)||publicationEvents.length!==1||
       Date.parse(publicationEvents[0].at)>Date.parse(e.at))invalid('Study note must bind to one earlier retained published version.');
  }
  const allowedStudyReviewKeys=new Set(['id','type','actor','at','semantics','reviewId','studyId','creationId','version','response','reflection','requestId','actionFingerprint','actionResult']);
  const reviewedStudyIds=new Set();
  for(const e of raw.events)if(e.type==='study-reviewed'){
    if(Object.keys(e).some(key=>!allowedStudyReviewKeys.has(key)))invalid('Study review contains unsupported canonical fields.');
    unique(e.reviewId);
    if(typeof e.reviewId!=='string'||!e.reviewId||typeof e.studyId!=='string'||!e.studyId||
       typeof e.creationId!=='string'||!e.creationId||!Number.isSafeInteger(e.version)||e.version<1||
       typeof e.response!=='string'||!e.response.trim()||Array.from(e.response).length>1000||
       typeof e.reflection!=='string'||!e.reflection.trim()||Array.from(e.reflection).length>1000||
       reviewedStudyIds.has(e.studyId))invalid('Malformed or repeated Academy study review.');
    reviewedStudyIds.add(e.studyId);
    const sourceEvents=raw.events.filter(s=>s.type==='study'&&s.studyId===e.studyId);
    const source=sourceEvents[0],sourceIndex=raw.events.indexOf(source),reviewIndex=raw.events.indexOf(e);
    if(sourceEvents.length!==1||sourceIndex<0||sourceIndex>=reviewIndex||
       source.actor?.id!==e.actor?.id||source.actor?.role!==e.actor?.role||
       source.creationId!==e.creationId||source.version!==e.version||
       !isStrictTimestamp(source.at)||Date.parse(source.at)>=Date.parse(e.at))invalid('Study review must follow its author’s matching source note.');
    const reviewSource=raw.creations.find(c=>c.id===e.creationId);
    const reviewVersions=reviewSource?[...reviewSource.versions,reviewSource].filter(v=>v.version===e.version):[];
    const reviewPublications=raw.events.filter(p=>p.type==='publish'&&p.creationId===e.creationId&&p.version===e.version);
    if(reviewVersions.length!==1||!isStrictTimestamp(reviewVersions[0].publishedAt)||
       Date.parse(reviewVersions[0].publishedAt)>Date.parse(e.at)||reviewPublications.length!==1||
       Date.parse(reviewPublications[0].at)>Date.parse(e.at))invalid('Study review must retain its exact earlier published source version.');
  }
  for(const key of ['contributions','reports'])for(const n of raw[key]){unique(n.id);actorFor(n.actor);const c=raw.creations.find(c=>c.id===n.creationId);if(!c||!Number.isInteger(n.version)||n.version<1||n.version>c.version||typeof n.text!=='string'||!n.text.trim()||Array.from(n.text).length>(key==='reports'?1000:500)||!isStrictTimestamp(n.at))invalid('Malformed attributed note.');}
  const discoveries=new Set();for(const d of raw.discoveries){unique(d.id);actorFor(d.actor);const key=`${d.actor.id}:${d.locationId}`;if(!knownPlaces.has(d.locationId)||discoveries.has(key))invalid('Invalid discovery.');discoveries.add(key);}
  for(const method of raw.methods){unique(method.id);actorFor(method.actor);const c=raw.creations.find(c=>c.id===method.creationId);if(!c||method.version<2||method.version>c.version||typeof method.title!=='string'||typeof method.description!=='string'||!isStrictTimestamp(method.at))invalid('Invalid earned game method.');}
  return clone(raw);
}
