import {createArtifact} from './artifacts.mjs';
import {isStrictTimestamp} from './timestamps.mjs';
import {SOURCE_OBSERVATION_SOURCE_KINDS,sourceObservationRequestMaterial,projectResearchRecords} from './research-records.mjs';
import {projectCollaboratorPackets,isExactCollaboratorSourceRecord} from './collaborator-contracts.mjs';
import {validateCollaboratorResponse,validateCollaboratorResponseSnapshot} from './collaborator-response.mjs';
import {projectCharacter,FIELD_EQUIPMENT_SLOTS,MAX_FIELD_INVENTORY_ITEMS} from './character-sheet.mjs';
import {COMMONS_CHANNEL,COMMONS_MESSAGE_LIMIT,COMMONS_POSTS_PER_MINUTE,COMMONS_REPORTS_PER_MINUTE,COMMONS_RATE_WINDOW_MS,COMMONS_REASONS,COMMONS_DISPOSITIONS,hiddenCommonsMessageIds,projectPlayerGuilds,normalizePlayerGuildName,playerGuildNameKey,PLAYER_GUILD_NAME_LIMIT,PLAYER_GUILD_CHARTER_LIMIT,PLAYER_GUILD_MEMBER_LIMIT,PLAYER_GUILD_LIMIT} from './social.mjs';
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
export async function applyAction(original,action,actor,{now,requestId,actionFingerprint,allowTransfers=false}={}) {
  const who=actorFor(actor);if(!action||typeof action.type!=='string')fail('INVALID_ACTION','Choose an action.');
  if(['draft','publish','repair','moderate-message'].includes(action.type)&&who.role!=='founder')fail('FORBIDDEN','Only an authenticated Founder can draft, repair, publish or moderate Commons messages.',403);
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
    case 'record-source-observation':{
      const creationId=text(action.creationId,128,'Source Observatory ID');
      if(!Number.isSafeInteger(action.version)||action.version<1)fail('INVALID_VERSION','Select a positive retained Observatory version.');
      const sourceCreation=world.creations.find(item=>item.id===creationId);
      if(!sourceCreation||sourceCreation.kind!=='observatory')fail('INVALID_SOURCE_OBSERVATORY','Source observations must bind to a published Source Observatory.',409);
      const versions=[...(sourceCreation.versions||[]),sourceCreation].filter(item=>item.version===action.version);
      const publicationEvents=world.events.filter(item=>item.type==='publish'&&item.creationId===creationId&&item.version===action.version);
      if(versions.length!==1||(versions[0].kind??sourceCreation.kind)!=='observatory'||!isStrictTimestamp(versions[0].publishedAt)||
         publicationEvents.length!==1||publicationEvents[0].at!==versions[0].publishedAt||
         Date.parse(publicationEvents[0].at)>Date.parse(at))fail('STALE_VERSION','The selected Observatory version is not uniquely retained and published before this note.',409);
      const observationId=text(action.observationId,128,'Source observation identity');
      if(!/^source-observation-[a-f0-9]{64}$/.test(observationId))fail('INVALID_SOURCE_OBSERVATION_ID','Source observation identity must be a normalized SHA-256 identifier.');
      if(requestMeta?.requestId&&requestMeta.requestId!==observationId)fail('INVALID_SOURCE_OBSERVATION_ID','The transport request ID must match the normalized observation identity.');
      const claim=text(action.claim,500,'Claim');
      const sourceKind=text(action.sourceKind,32,'Source class');
      if(!SOURCE_OBSERVATION_SOURCE_KINDS.includes(sourceKind))fail('INVALID_SOURCE_KIND','Choose a known self-classified source kind.');
      const source=text(action.source,500,'Source or attribution');
      const optional=value=>value===undefined||value===null?null:text(value,500,'Optional source observation field');
      const falsifier=optional(action.falsifier),uncertainty=optional(action.uncertainty),nextTest=optional(action.nextTest);
      if(!globalThis.crypto?.subtle)fail('CRYPTO_UNAVAILABLE','Web Crypto SHA-256 is required to record a Source Observation.');
      const identityMaterial=sourceObservationRequestMaterial({actorId:who.id,actorRole:who.role,creationId,version:action.version,claim,sourceKind,source,falsifier,uncertainty,nextTest});
      const identityBytes=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(identityMaterial));
      const identityDigest=Array.from(new Uint8Array(identityBytes),value=>value.toString(16).padStart(2,'0')).join('');
      if(observationId!=='source-observation-'+identityDigest)fail('INVALID_SOURCE_OBSERVATION_ID','Source observation identity does not match the authenticated actor, selected version and normalized note content.');
      const normalizedRecordDigest=observationId.slice('source-observation-'.length);
      const existing=world.events.filter(item=>item.type==='source-observation-recorded'&&item.observationId===observationId);
      if(existing.length){
        const previous=existing[0];
        const same=existing.length===1&&previous.actor.id===who.id&&previous.actor.role===who.role&&
          previous.creationId===creationId&&previous.version===action.version&&previous.claim===claim&&
          previous.sourceKind===sourceKind&&previous.source===source&&previous.falsifier===falsifier&&
          previous.uncertainty===uncertainty&&previous.nextTest===nextTest&&
          previous.normalizedRecordDigest===normalizedRecordDigest;
        if(!same)fail('SOURCE_OBSERVATION_ID_CONFLICT','This normalized observation identity is already bound to different actor or note content.',409);
        return {world:original,result:{observationId,duplicate:true}};
      }
      result={observationId,duplicate:false};
      recordEvent('source-observation-recorded',{
        observationId,creationId,version:action.version,claim,sourceKind,source,falsifier,uncertainty,nextTest,
        originSchema:'ngl.source-observatory.v2',bindingMode:'USER_SELECTED',
        sourceRetrieval:'NOT_PERFORMED',independentVerification:'NOT_PERFORMED',
        modelAssertions:'LEADS_ONLY',execution:'NOT_EXECUTED',normalizedRecordDigest
      });
      break;
    }
    case 'challenge-source-observation':{
      const observationId=text(action.observationId,128,'Source observation ID');
      const matches=world.events.filter(item=>item.type==='source-observation-recorded'&&item.observationId===observationId);
      if(matches.length!==1||!isStrictTimestamp(matches[0].at)||Date.parse(matches[0].at)>Date.parse(at))fail('NOT_FOUND','A unique earlier retained source observation is required before challenging it.',404);
      const observation=matches[0];
      if(observation.actor.id===who.id)fail('SELF_CHALLENGE','A different actor ID must challenge this source observation.',409);
      if(!challengeTypes.has(action.challengeType))fail('INVALID_CHALLENGE_TYPE','Choose a bounded challenge category.');
      const challengeText=text(action.challengeText,1000,'Challenge text');
      const challengeId=uid('source-observation-challenge');
      result={challengeId};
      recordEvent('source-observation-challenged',{challengeId,observationId,creationId:observation.creationId,version:observation.version,challengeType:action.challengeType,challengeText});
      break;
    }
    case 'respond-source-observation-challenge':{
      const challengeId=text(action.challengeId,128,'Source observation challenge ID');
      const challenges=world.events.filter(item=>item.type==='source-observation-challenged'&&item.challengeId===challengeId);
      if(challenges.length!==1)fail('NOT_FOUND','A unique retained Source Observation challenge is required before responding.',404);
      const challenge=challenges[0];
      if(Date.parse(challenge.at)>=Date.parse(at))fail('INVALID_CHRONOLOGY','A response must follow its retained challenge.',409);
      const observations=world.events.filter(item=>item.type==='source-observation-recorded'&&item.observationId===challenge.observationId);
      if(observations.length!==1)fail('NOT_FOUND','The challenged Source Observation is unavailable or ambiguous.',404);
      const source=observations[0];
      if(source.actor.id!==who.id||source.actor.role!==who.role)fail('FORBIDDEN','Only the original Source Observation author can respond to this challenge.',403);
      if(challenge.creationId!==source.creationId||challenge.version!==source.version)fail('INVALID_CHALLENGE_TARGET','The challenge no longer matches the exact retained observation version.',409);
      if(world.events.some(item=>item.type==='source-observation-challenge-responded'&&item.challengeId===challengeId))fail('CHALLENGE_ALREADY_ANSWERED','This challenge already has a retained author response.',409);
      const responseText=text(action.responseText,1000,'Response');
      const responseId=uid('source-observation-response');
      result={responseId};
      recordEvent('source-observation-challenge-responded',{responseId,challengeId,observationId:source.observationId,creationId:source.creationId,version:source.version,responseText});
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
    case 'record-collaborator-response':{
      const role=text(action.role,32,'Collaborator role');
      if(!['archivist','adversary','synthesizer','tutor'].includes(role))fail('INVALID_COLLABORATOR_ROLE','Choose a bounded Guild Hall role.');
      const moonshotId=text(action.moonshotId,128,'Moonshot ID');
      if(typeof action.packetJson!=='string'||encoder.encode(action.packetJson).length>64*1024)fail('INVALID_COLLABORATOR_PACKET','The exact hand-off packet is required and must remain within 64 KiB.');
      if(!Array.isArray(action.sourceEventIds)||action.sourceEventIds.length<1||action.sourceEventIds.length>8)fail('INVALID_COLLABORATOR_SOURCES','The packet must identify between one and eight source events.');
      const sourceEventIds=action.sourceEventIds.map(id=>text(id,128,'Source event ID'));
      if(new Set(sourceEventIds).size!==sourceEventIds.length)fail('INVALID_COLLABORATOR_SOURCES','Source event IDs must be unique.');
      if(typeof action.responseText!=='string'||!action.responseText.trim())fail('INVALID_COLLABORATOR_RESPONSE','The exact external response is required.');
      if(encoder.encode(action.responseText).length>64*1024)fail('TOO_LARGE','Collaborator response exceeds 64 KiB.',413);
      const packet=projectCollaboratorPackets(publicWorld(original,who)).find(candidate=>candidate.id===role&&candidate.available===true&&candidate.moonshotId===moonshotId&&candidate.packetJson===action.packetJson);
      if(!packet)fail('STALE_COLLABORATOR_PACKET','The source-bound packet no longer matches this world. Reopen Guild Hall and prepare a fresh packet.',409);
      if(JSON.stringify(packet.inputRefs)!==JSON.stringify(sourceEventIds))fail('INVALID_COLLABORATOR_SOURCES','Source event IDs do not match the exact hand-off packet.');
      const checked=validateCollaboratorResponse(packet,action.responseText);
      const packetReceipt=await receipt(packet.packetJson),responseReceipt=await receipt(action.responseText);
      const responseId=uid('collaborator-response');
      result={responseId,validationStatus:checked.status};
      recordEvent('collaborator-response-recorded',{responseId,role,moonshotId,sourceEventIds,packetJson:packet.packetJson,packetReceipt,responseText:action.responseText,responseReceipt,validationStatus:checked.status,validationReason:checked.reason,validator:'ngl.collaborator-response.v1'});
      break;
    }

    case 'forge-field-item':{
      const slotId=text(action.slotId,32,'Equipment slot');
      const slot=FIELD_EQUIPMENT_SLOTS.find(candidate=>candidate.id===slotId);
      if(!slot||action.slotId!==slotId)fail('INVALID_FIELD_ITEM_SLOT','Choose a known field-equipment slot.');
      const sourceEventId=text(action.sourceEventId,128,'Source event ID');
      if(action.sourceEventId!==sourceEventId)fail('INVALID_FIELD_ITEM_SOURCE','Choose one retained source event.');
      const record=projectCharacter(original,who);
      const choice=record.fieldItemSources?.[slotId]?.find(candidate=>candidate.eventId===sourceEventId);
      const source=original.events.find(candidate=>candidate?.id===sourceEventId);
      if(!source||!choice||!slot.sourceTypes.includes(source.type)||
        source.actor?.id!==who.id||source.actor?.role!==who.role)
        fail('INVALID_FIELD_ITEM_SOURCE','Forge only from an eligible earlier source owned by this actor.',409);
      if(original.events.some(event=>event?.type==='field-item-forged'&&event.actor?.id===who.id&&
        event.actor?.role===who.role&&event.sourceEventId===sourceEventId))
        fail('FIELD_ITEM_ALREADY_FORGED','This retained source has already been forged into a field item.',409);
      const forgedCount=original.events.filter(event=>event?.type==='field-item-forged'&&
        event.actor?.id===who.id&&event.actor?.role===who.role).length;
      if(forgedCount>=MAX_FIELD_INVENTORY_ITEMS)
        fail('FIELD_INVENTORY_FULL','This character has reached the bounded field-item inventory limit.',409);
      const itemId=uid('field-item');
      result={itemId,slotId,sourceEventId};
      recordEvent('field-item-forged',{itemId,slotId,sourceEventId});
      break;
    }
    case 'equip-field-item':{
      const slotId=text(action.slotId,32,'Equipment slot');
      const slot=FIELD_EQUIPMENT_SLOTS.find(candidate=>candidate.id===slotId);
      if(!slot||action.slotId!==slotId)fail('INVALID_EQUIPMENT_SLOT','Choose a known field-equipment slot.');
      const sourceEventId=text(action.sourceEventId,128,'Field-item event ID');
      if(action.sourceEventId!==sourceEventId)fail('INVALID_EQUIPMENT_SOURCE','Choose one retained forged item.');
      const record=projectCharacter(original,who);
      const item=record.fieldInventory.find(candidate=>candidate.eventId===sourceEventId&&candidate.slotId===slotId);
      if(!item)fail('INVALID_EQUIPMENT_SOURCE','Equip only a forged item owned by this actor in its matching slot.',409);
      if(record.fieldItemTransferOffers.some(offer=>offer.status==='offered'&&offer.itemId===item.itemId))
        fail('FIELD_ITEM_TRANSFER_PENDING','Cancel the active transfer offer before equipping this item.',409);
      if(record.equipment.find(candidate=>candidate.id===slotId)?.source?.eventId===sourceEventId)
        fail('ALREADY_EQUIPPED','This field item is already equipped.',409);
      result={slotId,sourceEventId};
      recordEvent('field-item-equipped',{slotId,sourceEventId});
      break;
    }
    case 'unequip-field-item':{
      const slotId=text(action.slotId,32,'Equipment slot');
      if(!FIELD_EQUIPMENT_SLOTS.some(candidate=>candidate.id===slotId)||action.slotId!==slotId)
        fail('INVALID_EQUIPMENT_SLOT','Choose a known field-equipment slot.');
      const record=projectCharacter(original,who);
      if(!record.equipment.find(candidate=>candidate.id===slotId)?.source)
        fail('EMPTY_EQUIPMENT_SLOT','There is no equipped field item in this slot.',409);
      result={slotId};
      recordEvent('field-item-unequipped',{slotId});
      break;
    }
    case 'offer-field-item-transfer':{
      if(!allowTransfers)fail('TRANSFER_REQUIRES_SHARED_WORLD','Player-to-player transfers require the shared authoritative world.',409);
      const itemEventId=text(action.itemEventId,128,'Field-item event ID');
      const recipientId=text(action.recipientId,128,'Recipient actor ID');
      const recipientRole=text(action.recipientRole,16,'Recipient role');
      if(!['founder','witness'].includes(recipientRole))fail('INVALID_TRANSFER_RECIPIENT','Choose a valid Founder or Witness recipient.');
      if(action.itemEventId!==itemEventId||action.recipientId!==recipientId||action.recipientRole!==recipientRole)
        fail('INVALID_TRANSFER_RECIPIENT','Transfer fields must be exact bounded identifiers.');
      if(recipientId===who.id&&recipientRole===who.role)fail('TRANSFER_TO_SELF','A field item cannot be offered to its current owner.',409);
      const record=projectCharacter(original,who);
      const item=record.fieldInventory.find(candidate=>candidate.eventId===itemEventId);
      if(!item)fail('FIELD_ITEM_NOT_OWNED','Offer only a field item currently owned by this actor.',409);
      if(record.equipment.find(candidate=>candidate.id===item.slotId)?.source?.eventId===itemEventId)
        fail('FIELD_ITEM_EQUIPPED','Unequip the field item before offering it to another player.',409);
      if(record.fieldItemTransferOffers.some(offer=>offer.status==='offered'&&offer.itemId===item.itemId))
        fail('FIELD_ITEM_TRANSFER_PENDING','This field item already has an active transfer offer.',409);
      const offerId=uid('field-item-offer');
      result={offerId};
      recordEvent('field-item-transfer-offered',{offerId,itemId:item.itemId,itemEventId,recipientId,recipientRole});
      break;
    }
    case 'cancel-field-item-transfer':{
      if(!allowTransfers)fail('TRANSFER_REQUIRES_SHARED_WORLD','Player-to-player transfers require the shared authoritative world.',409);
      const offerId=text(action.offerId,128,'Transfer offer ID');
      if(action.offerId!==offerId)fail('INVALID_TRANSFER_OFFER','Choose one retained transfer offer.');
      const record=projectCharacter(original,who);
      const offer=record.fieldItemTransferOffers.find(candidate=>candidate.offerId===offerId&&
        candidate.fromActorId===who.id&&candidate.fromActorRole===who.role);
      if(!offer)fail('FIELD_ITEM_TRANSFER_NOT_CANCELLABLE','Only the current item owner can cancel an active offer.',409);
      result={offerId};
      recordEvent('field-item-transfer-cancelled',{offerId});
      break;
    }
    case 'accept-field-item-transfer':{
      if(!allowTransfers)fail('TRANSFER_REQUIRES_SHARED_WORLD','Player-to-player transfers require the shared authoritative world.',409);
      const offerId=text(action.offerId,128,'Transfer offer ID');
      if(action.offerId!==offerId)fail('INVALID_TRANSFER_OFFER','Choose one retained transfer offer.');
      const record=projectCharacter(original,who);
      const offer=record.fieldItemTransferOffers.find(candidate=>candidate.offerId===offerId&&
        candidate.recipientId===who.id&&candidate.recipientRole===who.role);
      if(!offer)fail('FIELD_ITEM_TRANSFER_NOT_ADDRESSED','Only the designated recipient can accept this active offer.',409);
      if(record.fieldInventoryTotal>=MAX_FIELD_INVENTORY_ITEMS)
        fail('FIELD_INVENTORY_FULL','The recipient must make room in the bounded field-item inventory before accepting.',409);
      result={itemId:offer.itemId,offerId};
      recordEvent('field-item-transferred',{
        offerId,itemId:offer.itemId,itemEventId:offer.itemEventId,
        fromActorId:offer.fromActorId,fromActorRole:offer.fromActorRole
      });
      break;
    }
    case 'post-message':{
      const message=text(action.text,COMMONS_MESSAGE_LIMIT,'Message');
      const cutoff=Date.parse(at)-COMMONS_RATE_WINDOW_MS;
      let recent=0;
      for(let index=world.events.length-1;index>=0;index--){
        const candidate=world.events[index],candidateAt=Date.parse(candidate.at);
        if(Number.isFinite(candidateAt)&&candidateAt<=cutoff)break;
        if(candidate.type==='message-posted'&&candidate.actor?.id===who.id&&candidate.actor?.role===who.role)recent++;
      }
      if(recent>=COMMONS_POSTS_PER_MINUTE)fail('COMMONS_RATE_LIMITED','Five Commons posts per minute are allowed per actor.',429);
      const messageId=uid('message');
      result={messageId};
      recordEvent('message-posted',{messageId,channel:COMMONS_CHANNEL,text:message});
      break;
    }
    case 'report-message':{
      const messageId=text(action.messageId,128,'Message ID');
      const matches=world.events.filter(e=>e.type==='message-posted'&&e.messageId===messageId);
      if(matches.length!==1||Date.parse(matches[0].at)>Date.parse(at))fail('NOT_FOUND','A retained earlier Commons message is required.',404);
      const source=matches[0];
      if(source.actor.id===who.id)fail('SELF_REPORT','You cannot report your own message.',409);
      if(!COMMONS_REASONS.includes(action.reason))fail('INVALID_MESSAGE_REASON','Choose a bounded report reason.');
      const details=text(action.details,500,'Report details');
      let latest=null;
      for(let index=world.events.length-1;index>=0;index--){const e=world.events[index];if(e.type==='message-moderated'&&e.messageId===messageId){latest=e;break;}}
      if(latest?.disposition==='hide')fail('MESSAGE_HIDDEN','A hidden message cannot receive new reports.',409);
      if(world.events.some(e=>e.type==='message-reported'&&e.messageId===messageId&&e.actor?.id===who.id&&e.actor?.role===who.role))fail('MESSAGE_ALREADY_REPORTED','This actor already reported that message.',409);
      const currentAt=Date.parse(at),cutoff=currentAt-COMMONS_RATE_WINDOW_MS;
      let recentReports=0;
      for(let index=world.events.length-1;index>=0;index--){
        const candidate=world.events[index],candidateAt=Date.parse(candidate.at);
        if(!Number.isFinite(candidateAt)||candidateAt>currentAt)continue;
        if(candidateAt<=cutoff)break;
        if(candidate.type==='message-reported'&&candidate.actor?.id===who.id&&candidate.actor?.role===who.role)recentReports++;
      }
      if(recentReports>=COMMONS_REPORTS_PER_MINUTE)fail('COMMONS_REPORT_RATE_LIMITED',`${COMMONS_REPORTS_PER_MINUTE} Commons reports per minute are allowed per actor.`,429);
      const reportId=uid('message-report');
      result={reportId};
      recordEvent('message-reported',{reportId,messageId,reason:action.reason,details});
      break;
    }
    case 'moderate-message':{
      const messageId=text(action.messageId,128,'Message ID');
      const matches=world.events.filter(e=>e.type==='message-posted'&&e.messageId===messageId);
      if(matches.length!==1||Date.parse(matches[0].at)>Date.parse(at))fail('NOT_FOUND','A retained earlier Commons message is required.',404);
      if(!COMMONS_DISPOSITIONS.includes(action.disposition))fail('INVALID_MESSAGE_DISPOSITION','Choose hide or restore.');
      if(!COMMONS_REASONS.includes(action.reason))fail('INVALID_MESSAGE_REASON','Choose a bounded moderation reason.');
      let latest=null,latestIndex=-1;
      for(let index=world.events.length-1;index>=0;index--){const e=world.events[index];if(e.type==='message-moderated'&&e.messageId===messageId){latest=e;latestIndex=index;break;}}
      if(action.disposition==='hide'){
        if(latest?.disposition==='hide')fail('MESSAGE_ALREADY_HIDDEN','This message is already hidden.',409);
        const pending=world.events.some((e,index)=>index>latestIndex&&e.type==='message-reported'&&e.messageId===messageId);
        if(!pending)fail('MESSAGE_NOT_REPORTED','A pending player report is required before hiding a message.',409);
      }else if(latest?.disposition!=='hide')fail('MESSAGE_NOT_HIDDEN','Only a hidden message can be restored.',409);
      const moderationId=uid('message-moderation');
      result={moderationId,disposition:action.disposition};
      recordEvent('message-moderated',{moderationId,messageId,disposition:action.disposition,reason:action.reason});
      break;
    }
    case 'create-guild':{
      const name=normalizePlayerGuildName(text(action.name,PLAYER_GUILD_NAME_LIMIT,'Guild name'));
      if(!name||Array.from(name).length>PLAYER_GUILD_NAME_LIMIT)fail('INVALID_GUILD_NAME','Guild name is empty or too long.');
      const charter=text(action.charter,PLAYER_GUILD_CHARTER_LIMIT,'Guild charter');
      const projection=projectPlayerGuilds(original,who);
      if(projection.viewerGuildId)fail('GUILD_MEMBERSHIP_EXISTS','Leave your current guild before founding another.',409);
      if(projection.guilds.length>=PLAYER_GUILD_LIMIT)fail('GUILD_LIMIT','The world has reached its active player-guild limit.',409);
      if(projection.guilds.some(guild=>playerGuildNameKey(guild.name)===playerGuildNameKey(name)))fail('GUILD_NAME_TAKEN','An active guild already uses that name.',409);
      const guildId=uid('guild');
      result={guildId};
      recordEvent('guild-created',{guildId,name,charter});
      break;
    }
    case 'join-guild':{
      const guildId=text(action.guildId,128,'Guild ID');
      const projection=projectPlayerGuilds(original,who);
      if(projection.viewerGuildId)fail('GUILD_MEMBERSHIP_EXISTS','Leave your current guild before joining another.',409);
      const guild=projection.guilds.find(candidate=>candidate.id===guildId);
      if(!guild)fail('GUILD_NOT_FOUND','That player guild is not open.',404);
      if(guild.memberCount>=PLAYER_GUILD_MEMBER_LIMIT)fail('GUILD_MEMBER_LIMIT','That guild has reached its member limit.',409);
      result={guildId};
      recordEvent('guild-joined',{guildId});
      break;
    }
    case 'leave-guild':{
      const guildId=text(action.guildId,128,'Guild ID');
      const projection=projectPlayerGuilds(original,who);
      if(projection.viewerGuildId!==guildId)fail('GUILD_NOT_MEMBER','You are not a member of that guild.',409);
      if(projection.viewerIsLeader)fail('GUILD_LEADER_CANNOT_LEAVE','The leader cannot leave while holding the leadership role.',409);
      result={guildId};
      recordEvent('guild-left',{guildId});
      break;
    }
    case 'disband-guild':{
      const guildId=text(action.guildId,128,'Guild ID');
      const projection=projectPlayerGuilds(original,who);
      if(projection.viewerGuildId!==guildId||!projection.viewerIsLeader)fail('FORBIDDEN','Only the guild leader may close this guild.',403);
      const guild=projection.guilds.find(candidate=>candidate.id===guildId);
      if(!guild||guild.memberCount!==1)fail('GUILD_NOT_EMPTY','Other members must leave before the leader can close the guild.',409);
      result={guildId};
      recordEvent('guild-disbanded',{guildId});
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
export function publicWorld(world,actor){
  const copy=clone(world);
  if(actor?.role!=='founder'){
    copy.drafts=[];
    const hidden=hiddenCommonsMessageIds(copy);
    copy.events=copy.events
      .filter(e=>!['draft','repair'].includes(e.type)&&(e.type!=='message-reported'||e.actor?.id===actor?.id))
      .map(e=>{
        if(e.type!=='message-posted'||!hidden.has(e.messageId))return e;
        const safe={...e,text:'[Message hidden by human moderation.]'};
        delete safe.actionFingerprint;
        return safe;
      });
  }
  return copy;
}
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
  // Index retained history once. Validation below is intentionally linear in event count:
  // a bounded 32 MiB world must not trigger a full-history scan for every report or study.
  const eventPositions=new Map(),eventById=new Map(),publicationsByVersion=new Map(),proposalsByMoonshot=new Map(),studiesById=new Map();
  const historyKey=(...parts)=>JSON.stringify(parts);
  const addHistory=(map,key,value)=>{const list=map.get(key)||[];list.push(value);map.set(key,list);};
  for(let index=0;index<raw.events.length;index++){
    const e=raw.events[index];if(!e||typeof e!=='object')continue;
    eventPositions.set(e,index);
    if(typeof e.id==='string')eventById.set(e.id,e);
    if(e.type==='publish')addHistory(publicationsByVersion,historyKey(e.creationId,e.version),e);
    if(e.type==='moonshot-proposed')addHistory(proposalsByMoonshot,e.moonshotId,{event:e,index});
    if(e.type==='study')addHistory(studiesById,e.studyId,e);
  }
  let previousEventAt=createdAt;for(const e of raw.events){unique(e.id);actorFor(e.actor);const eventAt=Date.parse(e.at);if(typeof e.type!=='string'||!isStrictTimestamp(e.at)||!Number.isFinite(eventAt)||eventAt<previousEventAt||typeof e.semantics!=='string')invalid('Malformed event chronology.');previousEventAt=eventAt;if(e.repeat!==undefined&&e.type==='discover'&&typeof e.repeat!=='boolean')invalid('Malformed repeat-discovery event.');const receiptFields=['requestId','actionFingerprint','actionResult'],present=receiptFields.filter(key=>Object.hasOwn(e,key));if(present.length&&present.length!==receiptFields.length)invalid('Incomplete idempotency receipt.');if(present.length===receiptFields.length){if(typeof e.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(e.requestId)||requestIds.has(e.requestId)||typeof e.actionFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(e.actionFingerprint))invalid('Malformed or repeated idempotency receipt.');requestIds.add(e.requestId);const r=e.actionResult;if(!r||typeof r!=='object'||Array.isArray(r))invalid('Malformed idempotency result.');const keys=Object.keys(r).sort().join(',');const expected={draft:'draftId',repair:'draftId',publish:'creationId,version',contribute:'id',report:'id',study:'studyId','study-reviewed':'reviewId',discover:'discovered','moonshot-proposed':'moonshotId','experiment-reported':'reportId','experiment-challenged':'challengeId','collaborator-response-recorded':'responseId,validationStatus','field-item-forged':'itemId,slotId,sourceEventId','field-item-equipped':'slotId,sourceEventId','field-item-unequipped':'slotId','field-item-transfer-offered':'offerId','field-item-transfer-cancelled':'offerId','field-item-transferred':'itemId,offerId','source-observation-recorded':'duplicate,observationId','source-observation-challenged':'challengeId','source-observation-challenge-responded':'responseId','message-posted':'messageId','message-reported':'reportId','message-moderated':'disposition,moderationId','guild-created':'guildId','guild-joined':'guildId','guild-left':'guildId','guild-disbanded':'guildId'}[e.type];if(!expected||keys!==expected)invalid('Idempotency result does not match the event type.');if((e.type==='draft'||e.type==='repair')&&r.draftId!==e.draftId)invalid('Idempotency draft result mismatch.');if(e.type==='publish'&&(r.creationId!==e.creationId||r.version!==e.version))invalid('Idempotency publication result mismatch.');if(e.type==='moonshot-proposed'&&r.moonshotId!==e.moonshotId)invalid('Idempotency moonshot result mismatch.');if(e.type==='experiment-reported'&&r.reportId!==e.reportId)invalid('Idempotency experiment report result mismatch.');if(e.type==='experiment-challenged'&&r.challengeId!==e.challengeId)invalid('Idempotency experiment challenge result mismatch.');if(e.type==='source-observation-challenged'&&r.challengeId!==e.challengeId)invalid('Idempotency source-observation challenge result mismatch.');if(e.type==='source-observation-challenge-responded'&&r.responseId!==e.responseId)invalid('Idempotency source-observation response result mismatch.');if(e.type==='study'&&r.studyId!==e.studyId)invalid('Idempotency study result mismatch.');if(e.type==='study-reviewed'&&r.reviewId!==e.reviewId)invalid('Idempotency study review result mismatch.');if(e.type==='collaborator-response-recorded'&&(r.responseId!==e.responseId||r.validationStatus!==e.validationStatus))invalid('Idempotency collaborator archive result mismatch.');if(e.type==='field-item-forged'&&(r.itemId!==e.itemId||r.slotId!==e.slotId||r.sourceEventId!==e.sourceEventId))invalid('Idempotency field-item forge result mismatch.');if(e.type==='field-item-equipped'&&(r.slotId!==e.slotId||r.sourceEventId!==e.sourceEventId))invalid('Idempotency field-equipment result mismatch.');if(e.type==='field-item-unequipped'&&r.slotId!==e.slotId)invalid('Idempotency field-unequip result mismatch.');if(e.type==='field-item-transfer-offered'&&r.offerId!==e.offerId)invalid('Idempotency transfer-offer result mismatch.');if(e.type==='field-item-transfer-cancelled'&&r.offerId!==e.offerId)invalid('Idempotency transfer-cancel result mismatch.');if(e.type==='field-item-transferred'&&(r.itemId!==e.itemId||r.offerId!==e.offerId))invalid('Idempotency field-item transfer result mismatch.');if(e.type==='message-posted'&&r.messageId!==e.messageId)invalid('Idempotency Commons post result mismatch.');if(e.type==='message-reported'&&r.reportId!==e.reportId)invalid('Idempotency Commons report result mismatch.');if(e.type==='message-moderated'&&(r.moderationId!==e.moderationId||r.disposition!==e.disposition))invalid('Idempotency Commons moderation result mismatch.');if(e.type.startsWith('guild-')&&r.guildId!==e.guildId)invalid('Idempotency player-guild result mismatch.');if((e.type==='contribute'||e.type==='report')&&(typeof r.id!=='string'||!raw[e.type==='report'?'reports':'contributions'].some(n=>n.id===r.id&&n.creationId===e.creationId&&n.version===e.version&&n.at===e.at&&n.actor.id===e.actor.id)))invalid('Idempotency contribution result mismatch.');if(e.type==='discover'&&(typeof r.discovered!=='boolean'||(e.repeat===true&&r.discovered)||(e.repeat===true&&!raw.discoveries.some(d=>d.locationId===e.locationId&&d.actor.id===e.actor.id&&Date.parse(d.at)<=Date.parse(e.at)))||(e.repeat!==true&&!r.discovered)))invalid('Idempotency discovery result mismatch.');}}
  if(raw.events.length?updatedAt!==previousEventAt:updatedAt!==createdAt)invalid('World timestamps do not match retained event history.');
  const allowedCommonsPostKeys=new Set(['id','type','actor','at','semantics','messageId','channel','text','requestId','actionFingerprint','actionResult']);
  const allowedCommonsReportKeys=new Set(['id','type','actor','at','semantics','reportId','messageId','reason','details','requestId','actionFingerprint','actionResult']);
  const allowedCommonsModerationKeys=new Set(['id','type','actor','at','semantics','moderationId','messageId','disposition','reason','requestId','actionFingerprint','actionResult']);
  const commonsPosts=new Map(),commonsReportsByMessage=new Map(),commonsReportKeys=new Set(),commonsLatestModeration=new Map(),commonsTimesByActor=new Map();
  const validCommonsId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
  for(let index=0;index<raw.events.length;index++){
    const e=raw.events[index];
    if(e.type==='message-posted'){
      if(Object.keys(e).some(key=>!allowedCommonsPostKeys.has(key)))invalid('Commons post contains unsupported fields.');
      unique(e.messageId);
      if(!validCommonsId(e.messageId)||e.channel!==COMMONS_CHANNEL||typeof e.text!=='string'||!e.text.trim()||Array.from(e.text).length>COMMONS_MESSAGE_LIMIT)invalid('Malformed Commons message.');
      const actorKey=JSON.stringify([e.actor.id,e.actor.role]),times=commonsTimesByActor.get(actorKey)||[],eventAt=Date.parse(e.at);
      while(times.length&&times[0]<=eventAt-COMMONS_RATE_WINDOW_MS)times.shift();
      if(times.length>=COMMONS_POSTS_PER_MINUTE)invalid('Commons post rate limit exceeded in retained history.');
      times.push(eventAt);commonsTimesByActor.set(actorKey,times);
      commonsPosts.set(e.messageId,{event:e,index});
    }else if(e.type==='message-reported'){
      if(Object.keys(e).some(key=>!allowedCommonsReportKeys.has(key)))invalid('Commons report contains unsupported fields.');
      unique(e.reportId);
      const source=commonsPosts.get(e.messageId);
      if(!validCommonsId(e.reportId)||!validCommonsId(e.messageId)||!source||source.index>=index||source.event.actor.id===e.actor.id||
         !COMMONS_REASONS.includes(e.reason)||typeof e.details!=='string'||!e.details.trim()||Array.from(e.details).length>500||
         (commonsLatestModeration.get(e.messageId)?.event.disposition==='hide'))invalid('Malformed Commons report.');
      const reportKey=JSON.stringify([e.messageId,e.actor.id,e.actor.role]);
      if(commonsReportKeys.has(reportKey))invalid('Duplicate actor report for one Commons message.');
      commonsReportKeys.add(reportKey);
      const list=commonsReportsByMessage.get(e.messageId)||[];
      list.push({event:e,index});commonsReportsByMessage.set(e.messageId,list);
    }else if(e.type==='message-moderated'){
      if(Object.keys(e).some(key=>!allowedCommonsModerationKeys.has(key)))invalid('Commons moderation contains unsupported fields.');
      unique(e.moderationId);
      const source=commonsPosts.get(e.messageId),latest=commonsLatestModeration.get(e.messageId);
      if(!validCommonsId(e.moderationId)||!validCommonsId(e.messageId)||!source||source.index>=index||e.actor.role!=='founder'||
         !COMMONS_DISPOSITIONS.includes(e.disposition)||!COMMONS_REASONS.includes(e.reason))invalid('Malformed Commons moderation event.');
      const latestIndex=latest?.index??-1;
      const hasPendingReport=(commonsReportsByMessage.get(e.messageId)||[]).some(report=>report.index>latestIndex);
      if(e.disposition==='hide'&&(latest?.event.disposition==='hide'||!hasPendingReport))invalid('Commons hide requires a pending report and a visible message.');
      if(e.disposition==='restore'&&latest?.event.disposition!=='hide')invalid('Commons restore requires a prior hide.');
      commonsLatestModeration.set(e.messageId,{event:e,index});
    }
  }

  for(const creation of raw.creations)for(const version of [...creation.versions,creation]){const publishedAt=Date.parse(version.publishedAt);const publications=publicationsByVersion.get(historyKey(version.id,version.version))||[];if(!isStrictTimestamp(version.publishedAt)||!Number.isFinite(publishedAt)||publications.length!==1||!isStrictTimestamp(publications[0].at)||Date.parse(publications[0].at)!==publishedAt)invalid('Published version timestamp does not match retained publication history.');}
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
    const reportIndex=eventPositions.get(e);
    const proposals=(proposalsByMoonshot.get(e.moonshotId)||[]).filter(proposal=>proposal.index<reportIndex&&Date.parse(proposal.event.at)<=Date.parse(e.at));
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
  const sourceObservationIds=new Set(),sourceObservationById=new Map(),sourceObservationChallengeIds=new Set(),sourceObservationChallengeById=new Map();
  const allowedSourceObservationKeys=new Set(['id','type','actor','at','semantics','observationId','creationId','version','claim','sourceKind','source','falsifier','uncertainty','nextTest','originSchema','bindingMode','sourceRetrieval','independentVerification','modelAssertions','execution','normalizedRecordDigest','requestId','actionFingerprint','actionResult']);
  for(const e of raw.events)if(e.type==='source-observation-recorded'){
    if(Object.keys(e).some(key=>!allowedSourceObservationKeys.has(key)))invalid('Source observation contains unsupported canonical fields.');
    unique(e.observationId);
    const digest=typeof e.observationId==='string'&&e.observationId.startsWith('source-observation-')?e.observationId.slice('source-observation-'.length):'';
    if(typeof e.observationId!=='string'||!/^source-observation-[a-f0-9]{64}$/.test(e.observationId)||sourceObservationIds.has(e.observationId)||
       typeof e.creationId!=='string'||!e.creationId||!Number.isSafeInteger(e.version)||e.version<1||
       typeof e.claim!=='string'||!e.claim.trim()||Array.from(e.claim).length>500||
       !SOURCE_OBSERVATION_SOURCE_KINDS.includes(e.sourceKind)||typeof e.source!=='string'||!e.source.trim()||Array.from(e.source).length>500||
       ![e.falsifier,e.uncertainty,e.nextTest].every(value=>value===null||(typeof value==='string'&&value.trim()&&Array.from(value).length<=500))||
       e.originSchema!=='ngl.source-observatory.v2'||e.bindingMode!=='USER_SELECTED'||
       e.sourceRetrieval!=='NOT_PERFORMED'||e.independentVerification!=='NOT_PERFORMED'||e.modelAssertions!=='LEADS_ONLY'||e.execution!=='NOT_EXECUTED'||
       !/^[a-f0-9]{64}$/.test(e.normalizedRecordDigest)||e.normalizedRecordDigest!==digest||
       (e.requestId!==undefined&&e.requestId!==e.observationId)||
       (e.actionResult!==undefined&&(!e.actionResult||Object.keys(e.actionResult).sort().join(',')!=='duplicate,observationId'||e.actionResult.duplicate!==false||e.actionResult.observationId!==e.observationId)))invalid('Malformed or repeated Source Observatory observation.');
    const source=raw.creations.find(item=>item.id===e.creationId);
    const versions=source?[...(source.versions||[]),source].filter(item=>item.version===e.version):[];
    const publications=publicationsByVersion.get(historyKey(e.creationId,e.version))||[];
    if(!source||source.kind!=='observatory'||versions.length!==1||(versions[0].kind??source.kind)!=='observatory'||
       !isStrictTimestamp(versions[0].publishedAt)||publications.length!==1||
       publications[0].at!==versions[0].publishedAt||eventPositions.get(publications[0])>=eventPositions.get(e)||
       Date.parse(versions[0].publishedAt)>Date.parse(e.at))invalid('Source observation must bind to one earlier retained Source Observatory publication.');
    sourceObservationIds.add(e.observationId);
    sourceObservationById.set(e.observationId,e);
  }
  const allowedSourceObservationChallengeKeys=new Set(['id','type','actor','at','semantics','challengeId','observationId','creationId','version','challengeType','challengeText','requestId','actionFingerprint','actionResult']);
  for(let index=0;index<raw.events.length;index++){
    const e=raw.events[index];if(e.type!=='source-observation-challenged')continue;
    if(Object.keys(e).some(key=>!allowedSourceObservationChallengeKeys.has(key)))invalid('Source observation challenge contains unsupported canonical fields.');
    unique(e.challengeId);
    const target=sourceObservationById.get(e.observationId),targetIndex=target?eventPositions.get(target):-1;
    if(typeof e.challengeId!=='string'||!e.challengeId||sourceObservationChallengeIds.has(e.challengeId)||challengeIds.has(e.challengeId)||
       typeof e.observationId!=='string'||!e.observationId||!target||
       typeof e.creationId!=='string'||e.creationId!==target.creationId||
       !Number.isSafeInteger(e.version)||e.version!==target.version||
       !challengeTypes.has(e.challengeType)||typeof e.challengeText!=='string'||!e.challengeText.trim()||Array.from(e.challengeText).length>1000||
       target.actor.id===e.actor.id||targetIndex<0||targetIndex>=index||Date.parse(target.at)>Date.parse(e.at)||
       (e.actionResult!==undefined&&(!e.actionResult||Object.keys(e.actionResult).sort().join(',')!=='challengeId'||e.actionResult.challengeId!==e.challengeId)))invalid('Malformed source-observation challenge or target is not an earlier note from another actor.');
    sourceObservationChallengeIds.add(e.challengeId);
    challengeIds.add(e.challengeId);
    sourceObservationChallengeById.set(e.challengeId,e);
  }
  const allowedSourceObservationResponseKeys=new Set(['id','type','actor','at','semantics','responseId','challengeId','observationId','creationId','version','responseText','requestId','actionFingerprint','actionResult']);
  const sourceObservationResponseIds=new Set(),respondedSourceObservationChallengeIds=new Set();
  for(let index=0;index<raw.events.length;index++){
    const e=raw.events[index];if(e.type!=='source-observation-challenge-responded')continue;
    if(Object.keys(e).some(key=>!allowedSourceObservationResponseKeys.has(key)))invalid('Source observation response contains unsupported canonical fields.');
    unique(e.responseId);
    const challenge=sourceObservationChallengeById.get(e.challengeId);
    const target=sourceObservationById.get(e.observationId);
    const challengeIndex=challenge?eventPositions.get(challenge):-1;
    const targetIndex=target?eventPositions.get(target):-1;
    if(typeof e.responseId!=='string'||!e.responseId||sourceObservationResponseIds.has(e.responseId)||
       typeof e.challengeId!=='string'||!challenge||respondedSourceObservationChallengeIds.has(e.challengeId)||
       typeof e.observationId!=='string'||!target||challenge.observationId!==e.observationId||
       typeof e.creationId!=='string'||e.creationId!==target.creationId||e.creationId!==challenge.creationId||
       !Number.isSafeInteger(e.version)||e.version!==target.version||e.version!==challenge.version||
       e.actor.id!==target.actor.id||e.actor.role!==target.actor.role||
       typeof e.responseText!=='string'||!e.responseText.trim()||Array.from(e.responseText).length>1000||
       targetIndex<0||challengeIndex<=targetIndex||index<=challengeIndex||
       !isStrictTimestamp(e.at)||Date.parse(challenge.at)>=Date.parse(e.at)||Date.parse(target.at)>=Date.parse(e.at)||
       (e.actionResult!==undefined&&(!e.actionResult||Object.keys(e.actionResult).sort().join(',')!=='responseId'||e.actionResult.responseId!==e.responseId)))invalid('Malformed Source Observation response or response is not by the original author after the exact challenge.');
    sourceObservationResponseIds.add(e.responseId);
    respondedSourceObservationChallengeIds.add(e.challengeId);
  }
  const allowedChallengeKeys=new Set(['id','type','actor','at','semantics','challengeId','reportId','moonshotId','challengeType','challengeText','evidenceCreationId','evidenceVersion','requestId','actionFingerprint','actionResult']);
  for(let index=0;index<raw.events.length;index++){
    const e=raw.events[index];if(e.type!=='experiment-challenged')continue;
    if(Object.keys(e).some(key=>!allowedChallengeKeys.has(key)))invalid('Experiment challenge contains unsupported canonical fields.');
    unique(e.challengeId);
    if(challengeIds.has(e.challengeId)||typeof e.challengeId!=='string'||!e.challengeId||typeof e.reportId!=='string'||!e.reportId||typeof e.moonshotId!=='string'||!e.moonshotId||!challengeTypes.has(e.challengeType)||typeof e.challengeText!=='string'||!e.challengeText.trim()||Array.from(e.challengeText).length>1000)invalid('Malformed or repeated experiment challenge.');
    challengeIds.add(e.challengeId);
    const report=experimentReports.get(e.reportId),reportIndex=report?eventPositions.get(report):-1;
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
    const publicationEvents=publicationsByVersion.get(historyKey(e.creationId,e.version))||[];
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
    const sourceEvents=studiesById.get(e.studyId)||[];
    const source=sourceEvents[0],sourceIndex=source?eventPositions.get(source):-1,reviewIndex=eventPositions.get(e);
    if(sourceEvents.length!==1||sourceIndex<0||sourceIndex>=reviewIndex||
       source.actor?.id!==e.actor?.id||source.actor?.role!==e.actor?.role||
       source.creationId!==e.creationId||source.version!==e.version||
       !isStrictTimestamp(source.at)||Date.parse(source.at)>=Date.parse(e.at))invalid('Study review must follow its author’s matching source note.');
    const reviewSource=raw.creations.find(c=>c.id===e.creationId);
    const reviewVersions=reviewSource?[...reviewSource.versions,reviewSource].filter(v=>v.version===e.version):[];
    const reviewPublications=publicationsByVersion.get(historyKey(e.creationId,e.version))||[];
    if(reviewVersions.length!==1||!isStrictTimestamp(reviewVersions[0].publishedAt)||
       Date.parse(reviewVersions[0].publishedAt)>Date.parse(e.at)||reviewPublications.length!==1||
       Date.parse(reviewPublications[0].at)>Date.parse(e.at))invalid('Study review must retain its exact earlier published source version.');
  }
  const projectedResearchByEventId=new Map();
  if(raw.events.some(event=>event?.type==='collaborator-response-recorded')){
    let projectedResearch;
    try{projectedResearch=projectResearchRecords(raw.events,raw.creations);}catch{invalid('Research history cannot be projected for collaborator validation.');}
    for(const record of projectedResearch)if(typeof record?.id==='string')projectedResearchByEventId.set(record.id,record);
  }
  const collaboratorResponseIds=new Set();
  for(let index=0;index<raw.events.length;index++){
    const e=raw.events[index];if(e.type!=='collaborator-response-recorded')continue;
    const allowed=new Set(['id','type','actor','at','semantics','responseId','role','moonshotId','sourceEventIds','packetJson','packetReceipt','responseText','responseReceipt','validationStatus','validationReason','validator','requestId','actionFingerprint','actionResult']);
    if(Object.keys(e).some(key=>!allowed.has(key)))invalid('Collaborator archive contains unsupported fields.');
    unique(e.responseId);
    if(collaboratorResponseIds.has(e.responseId)||!['archivist','adversary','synthesizer','tutor'].includes(e.role)||typeof e.moonshotId!=='string'||!e.moonshotId||
       !Array.isArray(e.sourceEventIds)||e.sourceEventIds.length<1||e.sourceEventIds.length>8||
       e.sourceEventIds.some(id=>typeof id!=='string'||!id||Array.from(id).length>128)||new Set(e.sourceEventIds).size!==e.sourceEventIds.length||
       typeof e.packetJson!=='string'||encoder.encode(e.packetJson).length>64*1024||
       typeof e.responseText!=='string'||!e.responseText.trim()||encoder.encode(e.responseText).length>64*1024||
       !['valid-for-human-review','rejected'].includes(e.validationStatus)||
       (e.validationStatus==='valid-for-human-review'&&e.validationReason!==null)||
       (e.validationStatus==='rejected'&&(typeof e.validationReason!=='string'||!e.validationReason||Array.from(e.validationReason).length>128))||
       e.validator!=='ngl.collaborator-response.v1')invalid('Malformed or repeated collaborator archive.');
    collaboratorResponseIds.add(e.responseId);
    const receiptShape=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='algorithm,digest,size';
    if(!receiptShape(e.packetReceipt)||!receiptShape(e.responseReceipt))invalid('Collaborator archive receipt shape is invalid.');
    const packetReceipt=await receipt(e.packetJson),responseReceipt=await receipt(e.responseText);
    if(e.packetReceipt.algorithm!=='sha256'||e.packetReceipt.digest!==packetReceipt.digest||e.packetReceipt.size!==packetReceipt.size||
       e.responseReceipt.algorithm!=='sha256'||e.responseReceipt.digest!==responseReceipt.digest||e.responseReceipt.size!==responseReceipt.size)invalid('Collaborator archive byte receipt mismatch.');
    let payload;try{payload=JSON.parse(e.packetJson)}catch{invalid('Collaborator packet JSON is malformed.');}
    const packetIndex=index,sourceSnapshot=payload?.sourceSnapshot;
    if(payload?.protocol!=='ngl.bounded-collaborator-packet.v1'||payload.role!==e.role||payload.targetMoonshotId!==e.moonshotId||
       payload.authority!=='advisory-only'||payload.mayWriteCanonicalState!==false||payload.mayGrantAuthority!==false||
       payload.mayAwardProgress!==false||payload.mayCertifyTruthOrExecution!==false||
       sourceSnapshot?.status!=='identified'||sourceSnapshot.worldId!==raw.id||sourceSnapshot.revision!==packetIndex||sourceSnapshot.suppliedEventCount!==raw.events.slice(0,packetIndex).filter(source=>e.actor.role==='founder'||(!['draft','repair'].includes(source.type)&&(source.type!=='message-reported'||source.actor?.id===e.actor.id))).length||
       !Array.isArray(payload.inputRefs)||JSON.stringify(payload.inputRefs)!==JSON.stringify(e.sourceEventIds)||
       !Array.isArray(payload.inputRecords)||payload.inputRecords.length!==e.sourceEventIds.length||
       !Array.isArray(payload.omittedEventIds)||payload.omittedEventIds.length>64||payload.omittedEventIds.some(id=>typeof id!=='string'||!id||Array.from(id).length>128||e.sourceEventIds.includes(id))||new Set(payload.omittedEventIds).size!==payload.omittedEventIds.length||!Number.isSafeInteger(payload.omittedCount)||payload.omittedCount<0||payload.omittedCount<payload.omittedEventIds.length||
       payload.omittedEventIdListTruncated!==(payload.omittedCount>payload.omittedEventIds.length))invalid('Collaborator packet identity or authority boundary mismatch.');
    for(let sourceIndex=0;sourceIndex<e.sourceEventIds.length;sourceIndex++){
      const source=eventById.get(e.sourceEventIds[sourceIndex]),record=payload.inputRecords[sourceIndex];
      if(!source||eventPositions.get(source)>=packetIndex||record?.eventId!==source.id||record?.type!==source.type||record?.at!==source.at||
         record?.actor?.id!==source.actor?.id||record?.actor?.role!==source.actor?.role||record?.moonshotId!==source.moonshotId||source.moonshotId!==e.moonshotId)
        invalid('Collaborator packet source reference is not an earlier matching world event.');
      const projectedSource=projectedResearchByEventId.get(source.id);
      if(projectedSource?._projection?.index!==eventPositions.get(source)||!isExactCollaboratorSourceRecord(record,projectedSource))
        invalid('Collaborator packet source content does not match retained history.');
    }
    const checked=validateCollaboratorResponseSnapshot({
      packetJson:e.packetJson,role:e.role,moonshotId:e.moonshotId,
      sourceEventIds:e.sourceEventIds,responseText:e.responseText
    });
    if(checked.status!==e.validationStatus||checked.reason!==e.validationReason)
      invalid('Collaborator archive validation status does not match retained response bytes.');
  }
  for(const key of ['contributions','reports'])for(const n of raw[key]){unique(n.id);actorFor(n.actor);const c=raw.creations.find(c=>c.id===n.creationId);if(!c||!Number.isInteger(n.version)||n.version<1||n.version>c.version||typeof n.text!=='string'||!n.text.trim()||Array.from(n.text).length>(key==='reports'?1000:500)||!isStrictTimestamp(n.at))invalid('Malformed attributed note.');}
  const discoveries=new Set();for(const d of raw.discoveries){unique(d.id);actorFor(d.actor);const key=`${d.actor.id}:${d.locationId}`;if(!knownPlaces.has(d.locationId)||discoveries.has(key))invalid('Invalid discovery.');discoveries.add(key);}
  for(const method of raw.methods){unique(method.id);actorFor(method.actor);const c=raw.creations.find(c=>c.id===method.creationId);if(!c||method.version<2||method.version>c.version||typeof method.title!=='string'||typeof method.description!=='string'||!isStrictTimestamp(method.at))invalid('Invalid earned game method.');}
  try{projectPlayerGuilds(raw);}catch{invalid('Malformed player-guild history.');}
  for(const e of raw.events)if(e.type==='guild-created')unique(e.guildId);

  const allowedFieldForgeKeys=new Set(['id','type','actor','at','semantics','itemId','slotId','sourceEventId','requestId','actionFingerprint','actionResult']);
  const allowedFieldEquipKeys=new Set(['id','type','actor','at','semantics','slotId','sourceEventId','requestId','actionFingerprint','actionResult']);
  const allowedFieldUnequipKeys=new Set(['id','type','actor','at','semantics','slotId','requestId','actionFingerprint','actionResult']);
  const allowedFieldOfferKeys=new Set(['id','type','actor','at','semantics','offerId','itemId','itemEventId','recipientId','recipientRole','requestId','actionFingerprint','actionResult']);
  const allowedFieldCancelKeys=new Set(['id','type','actor','at','semantics','offerId','requestId','actionFingerprint','actionResult']);
  const allowedFieldTransferKeys=new Set(['id','type','actor','at','semantics','offerId','itemId','itemEventId','fromActorId','fromActorRole','requestId','actionFingerprint','actionResult']);
  const forgedItemIds=new Set(),forgedSourceKeys=new Set(),forgedCountsByActor=new Map();
  const fieldItemById=new Map(),fieldItemOwners=new Map(),fieldItemCountsByActor=new Map();
  const transferOffersById=new Map(),activeTransferOfferByItem=new Map();
  const sameActor=(left,right)=>left?.id===right?.id&&left?.role===right?.role;
  // Replay equipment as an actor/slot state machine. Imported histories must
  // obey the same transitions as applyAction(), not merely name a valid slot.
  const equippedByActorSlot=new Map();
  const characterCache=new Map();
  const characterFor=actor=>{
    const key=historyKey(actor?.id,actor?.role);
    if(!characterCache.has(key))characterCache.set(key,projectCharacter(raw,actor));
    return characterCache.get(key);
  };
  for(let index=0;index<raw.events.length;index++){
    const e=raw.events[index];
    if(e.type==='field-item-forged'){
      if(Object.keys(e).some(key=>!allowedFieldForgeKeys.has(key)))invalid('Field-item forge event contains unsupported canonical fields.');
      const slot=FIELD_EQUIPMENT_SLOTS.find(candidate=>candidate.id===e.slotId);
      const source=eventById.get(e.sourceEventId),sourceIndex=source?eventPositions.get(source):-1;
      const actorKey=historyKey(e.actor?.id,e.actor?.role),sourceKey=historyKey(actorKey,e.sourceEventId);
      const count=forgedCountsByActor.get(actorKey)||0;
      const sourceChoice=slot?characterFor(e.actor).fieldItemSources?.[slot.id]?.find(item=>item.eventId===e.sourceEventId):null;
      if(typeof e.itemId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(e.itemId)||
        forgedItemIds.has(e.itemId)||typeof e.sourceEventId!=='string'||!e.sourceEventId||e.sourceEventId.length>128||
        forgedSourceKeys.has(sourceKey)||count>=MAX_FIELD_INVENTORY_ITEMS||!slot||!source||!Number.isInteger(sourceIndex)||
        sourceIndex>=index||source.actor?.id!==e.actor?.id||source.actor?.role!==e.actor?.role||
        !slot.sourceTypes.includes(source.type)||!sourceChoice||!isStrictTimestamp(source.at)||!isStrictTimestamp(e.at)||
        Date.parse(source.at)>Date.parse(e.at))
        invalid('Field-item forge must bind one earlier eligible source owned by the same actor.');
      unique(e.itemId);forgedItemIds.add(e.itemId);forgedSourceKeys.add(sourceKey);forgedCountsByActor.set(actorKey,count+1);
      fieldItemById.set(e.itemId,e);fieldItemOwners.set(e.itemId,{id:e.actor.id,role:e.actor.role});
      fieldItemCountsByActor.set(actorKey,(fieldItemCountsByActor.get(actorKey)||0)+1);
    }else if(e.type==='field-item-equipped'){
      if(Object.keys(e).some(key=>!allowedFieldEquipKeys.has(key)))invalid('Field-equipment event contains unsupported canonical fields.');
      const slot=FIELD_EQUIPMENT_SLOTS.find(candidate=>candidate.id===e.slotId);
      const source=eventById.get(e.sourceEventId),sourceIndex=source?eventPositions.get(source):-1;
      const item=slot&&source?.type==='field-item-forged'?fieldItemById.get(source.itemId):null;
      const owner=item?fieldItemOwners.get(item.itemId):null;
      const actorSlotKey=JSON.stringify([e.actor?.id,e.actor?.role,e.slotId]);
      if(!slot||typeof e.sourceEventId!=='string'||!source||source.type!=='field-item-forged'||
        !Number.isInteger(sourceIndex)||sourceIndex>=index||source.slotId!==e.slotId||!item||
        !sameActor(owner,e.actor)||activeTransferOfferByItem.has(item.itemId)||
        equippedByActorSlot.get(actorSlotKey)===e.sourceEventId)
        invalid('Field-equipment selection must reference an earlier forged item currently owned by this actor in its matching slot, with no active transfer offer, and cannot repeat the active selection.');
      // Selecting another valid item replaces the prior item in that slot;
      // the exact same item must be unequipped before it can be selected again.
      equippedByActorSlot.set(actorSlotKey,e.sourceEventId);
    }else if(e.type==='field-item-unequipped'){
      const actorSlotKey=JSON.stringify([e.actor?.id,e.actor?.role,e.slotId]);
      if(Object.keys(e).some(key=>!allowedFieldUnequipKeys.has(key))||
        !FIELD_EQUIPMENT_SLOTS.some(candidate=>candidate.id===e.slotId)||
        !equippedByActorSlot.has(actorSlotKey))
        invalid('Field-item unequip must remove an earlier active selection for this actor and slot.');
      equippedByActorSlot.delete(actorSlotKey);
    }else if(e.type==='field-item-transfer-offered'){
      if(Object.keys(e).some(key=>!allowedFieldOfferKeys.has(key)))invalid('Field-item transfer offer contains unsupported canonical fields.');
      const item=fieldItemById.get(e.itemId),owner=fieldItemOwners.get(e.itemId);
      const recipient={id:e.recipientId,role:e.recipientRole};
      const actorSlotKey=JSON.stringify([e.actor?.id,e.actor?.role,item?.slotId]);
      if(typeof e.offerId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(e.offerId)||
        transferOffersById.has(e.offerId)||!item||item.id!==e.itemEventId||!sameActor(owner,e.actor)||
        typeof e.recipientId!=='string'||!e.recipientId||e.recipientId.trim()!==e.recipientId||e.recipientId.length>128||
        !['founder','witness'].includes(e.recipientRole)||sameActor(e.actor,recipient)||
        activeTransferOfferByItem.has(e.itemId)||equippedByActorSlot.get(actorSlotKey)===item.id)
        invalid('A transfer offer must be created by the current owner for another valid actor, on an unequipped item with no active offer.');
      unique(e.offerId);
      transferOffersById.set(e.offerId,{offerId:e.offerId,event:e,itemId:e.itemId,itemEventId:e.itemEventId,status:'offered'});
      activeTransferOfferByItem.set(e.itemId,e.offerId);
    }else if(e.type==='field-item-transfer-cancelled'){
      if(Object.keys(e).some(key=>!allowedFieldCancelKeys.has(key)))invalid('Field-item transfer cancellation contains unsupported canonical fields.');
      const offer=transferOffersById.get(e.offerId),owner=offer&&fieldItemOwners.get(offer.itemId);
      const cancelReason=!offer?'offer-missing':
        offer.status!=='offered'?'offer-not-active':
        activeTransferOfferByItem.get(offer.itemId)!==offer.offerId?'active-offer-mismatch':
        !sameActor(e.actor,offer.event.actor)?'actor-not-offerer':
        !sameActor(owner,e.actor)?'actor-not-current-owner':null;
      if(cancelReason)
        invalid(`Only the current item owner can cancel one active retained transfer offer (${cancelReason}).`);
      offer.status='cancelled';
      activeTransferOfferByItem.delete(offer.itemId);
    }else if(e.type==='field-item-transferred'){
      if(Object.keys(e).some(key=>!allowedFieldTransferKeys.has(key)))invalid('Field-item transfer event contains unsupported canonical fields.');
      const offer=transferOffersById.get(e.offerId),item=fieldItemById.get(e.itemId);
      const owner=fieldItemOwners.get(e.itemId);
      const fromKey=historyKey(offer?.event.actor?.id,offer?.event.actor?.role);
      const toKey=historyKey(e.actor?.id,e.actor?.role);
      const fromCount=fieldItemCountsByActor.get(fromKey)||0,toCount=fieldItemCountsByActor.get(toKey)||0;
      const actorSlotKey=JSON.stringify([owner?.id,owner?.role,item?.slotId]);
      if(!offer||offer.status!=='offered'||activeTransferOfferByItem.get(offer.itemId)!==offer.offerId||
        !item||offer.itemId!==e.itemId||offer.itemEventId!==e.itemEventId||item.id!==e.itemEventId||
        !sameActor(owner,offer.event.actor)||e.fromActorId!==owner?.id||e.fromActorRole!==owner?.role||
        e.actor?.id!==offer.event.recipientId||e.actor?.role!==offer.event.recipientRole||
        !['founder','witness'].includes(e.fromActorRole)||typeof e.fromActorId!=='string'||
        e.fromActorId.trim()!==e.fromActorId||e.fromActorId.length>128||
        equippedByActorSlot.get(actorSlotKey)===item.id||toCount>=MAX_FIELD_INVENTORY_ITEMS)
        invalid('A transfer must be accepted by its designated recipient while the item is still unequipped, owned by the offerer, and the recipient has capacity.');
      fieldItemOwners.set(e.itemId,{id:e.actor.id,role:e.actor.role});
      fieldItemCountsByActor.set(fromKey,Math.max(0,fromCount-1));
      fieldItemCountsByActor.set(toKey,toCount+1);
      offer.status='accepted';
      activeTransferOfferByItem.delete(offer.itemId);
    }
  }
  return clone(raw);
}
