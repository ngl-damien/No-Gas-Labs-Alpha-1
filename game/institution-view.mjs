import { projectChronicle } from "./chronicle.mjs";
import { isStrictTimestamp } from "./timestamps.mjs";

// Validate the envelope required to inspect a world snapshot. This is a
// display-safety check, not a claim that the snapshot is canonical or true.
// The shared Witness view intentionally omits private draft events, so the
// full private-world validator is not applicable here.
function denseSnapshotArray(value) {
 try {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isSafeInteger(length) || length < 0) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) return false;
  for (let index = 0; index < length; index += 1) {
   const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
   if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return false;
  }
  return keys.every(key => key === "length" ||
   (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key) && Number(key) < length));
 } catch { return false; }
}

export function isInspectableWorldSnapshot(value) {
 try {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const field = key => {
   const descriptor = Object.getOwnPropertyDescriptor(value, key);
   return descriptor && descriptor.enumerable && Object.hasOwn(descriptor, "value")
    ? descriptor.value : undefined;
  };
  const schema = field("schema"), id = field("id"), founderName = field("founderName");
  const revision = field("revision"), xp = field("xp");
  const createdAt = field("createdAt"), updatedAt = field("updatedAt");
  if (schema !== "ngl.world.v2" || typeof id !== "string" || !id.trim() ||
      typeof founderName !== "string" || !Number.isSafeInteger(revision) || revision < 0 ||
      !Number.isSafeInteger(xp) || xp < 0 ||
      !isStrictTimestamp(createdAt) || !isStrictTimestamp(updatedAt) ||
      Date.parse(createdAt) > Date.parse(updatedAt)) return false;
  for (const key of ["creations", "drafts", "events", "contributions", "reports", "discoveries", "methods"]) {
   if (!denseSnapshotArray(field(key))) return false;
  }
  return field("creations").length <= 12 && field("drafts").length <= 24;
 } catch { return false; }
}

// Prefer a well-shaped response; otherwise retain the last inspectable session
// snapshot as stale/read-only. Missing or malformed data is never rendered as
// a fresh empty register.
export function selectWorldSnapshot(candidate, fallback) {
 const fresh = isInspectableWorldSnapshot(candidate);
 const retained = fresh ? candidate : isInspectableWorldSnapshot(fallback) ? fallback : null;
 return Object.freeze({ world: retained, stale: !fresh, unavailable: !retained });
}

const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};

function renderKernelHistory(container,kernel){
 const events=Array.isArray(kernel?.events)?kernel.events:[];
 const accepted=Array.isArray(kernel?.accepted)?kernel.accepted:[];
 container.append(el('h3','CANONICAL WORK RECEIPTS'));
 container.append(el('p',`Kernel revision ${Number.isInteger(kernel?.revision)?kernel.revision:'unknown'} · ${events.length} retained stage events. These records show local byte preservation only; they do not prove truth, usefulness, independent human review, demand, revenue or public deployment.`));
 if(Number.isInteger(kernel?.eventCount)&&kernel.eventCount!==events.length){
  const mismatch=el('p',`Record count mismatch: service reports ${kernel.eventCount} events but delivered ${events.length}. Treat this view as incomplete until reconciled.`);
  mismatch.className='evidence-warning';container.append(mismatch);
 }
 if(events.length===0){container.append(el('p','No canonical work events are recorded in this shared world yet.'));return;}
 const acceptedByWork=new Map(accepted.filter(w=>typeof w?.workId==='string').map(w=>[w.workId,w]));
 const histories=new Map();
 let ungroupedEventCount=0;
 for(const event of events){
  if(typeof event?.workId!=='string'||!event.workId){ungroupedEventCount++;continue;}
  if(!histories.has(event.workId))histories.set(event.workId,[]);
  histories.get(event.workId).push(event);
 }
 if(ungroupedEventCount>0){const warning=el('p',`${ungroupedEventCount} retained event(s) have no valid work ID and were omitted from grouped histories.`);warning.className='evidence-warning';container.append(warning);}
 const acceptedWithoutHistory=accepted.filter(work=>typeof work?.workId==='string'&&!histories.has(work.workId)).length;
 if(acceptedWithoutHistory>0){const warning=el('p',`${acceptedWithoutHistory} accepted work record(s) have no retained event history.`);warning.className='evidence-warning';container.append(warning);}
 for(const [workId,stages]of histories){
  const work=acceptedByWork.get(workId);
  const claim=stages.find(e=>e.type==='claim');
  const adjudication=[...stages].reverse().find(e=>e.type==='adjudicate');
  const subject=work?.subject||claim?.subject||stages.find(e=>e.subject)?.subject;
  const action=work?.action||claim?.action||'Unspecified action';
  const disposition=work?.stage==='accepted'?'ACCEPTED':adjudication?.decision==='reject'?'REJECTED':'NOT ACCEPTED';
  const card=el('article');card.className='field-card';card.dataset.recordType='KERNEL_WORK';card.dataset.workId=workId;
  card.append(el('h3',`${action} · ${subject?.id||'unknown subject'} v${subject?.version??'?'}`));
  card.append(el('p',`Disposition: ${disposition} · Work: ${workId}`));
  if(work)card.append(el('p',`Executor: ${work.executorId||'unknown'} · Observer: ${work.observerId||'unknown'} · Adjudicator: ${work.adjudicatedBy||'unknown'}`));
  const receipts=Array.isArray(work?.outputs)?work.outputs:[];
  for(const receipt of receipts)card.append(el('small',`${receipt?.algorithm||'sha256'} · ${receipt?.digest||'digest unavailable'} · ${Number.isInteger(receipt?.size)?receipt.size+' bytes':'size unavailable'}`));
  const timeline=el('ol');timeline.className='kernel-timeline';
  for(const event of stages){
   let detail=`${String(event.type||'unknown').toUpperCase()} · actor ${String(event.actor||'unknown')} · ${String(event.at||'time unavailable')}`;
   if(event.type==='observe')detail+=` · observation ${event.passed===true?'passed':event.passed===false?'failed':'not recorded'}`;
   if(event.type==='adjudicate')detail+=` · decision ${String(event.decision||'not recorded')}`;
   timeline.append(el('li',detail));
  }
  card.append(timeline);container.append(card);
 }
 if(histories.size===0)container.append(el('p','The service returned kernel events without work IDs; they cannot be grouped into work receipts.'));
}

function renderChronicle(container, chronicle, onOpenArtifact, options = {}) {
 const heading = options.heading || "TOWNSQUARE · WORLD CHRONICLE";
 const intro = options.intro || "A read-only timeline of retained world events and institutional work. Reports and failed checks remain visible. Local byte checks identify bytes; they do not establish truth or independent human review.";
 const emptyMessage = options.emptyMessage || "No retained world or institutional events are recorded in this snapshot.";
 container.append(el('h3', heading));
 container.append(el('p', intro));
 if(chronicle.malformed>0){const warning=el('p',String(chronicle.malformed)+' malformed retained event slot(s) remain visible for investigation.');warning.className='evidence-warning';container.append(warning);}
 if(chronicle.entries.length===0){container.append(el('p',emptyMessage));return;}
 for(const entry of chronicle.entries){
  const card=el('article');card.className='field-card';card.dataset.recordType='WORLD_EVENT';card.dataset.eventId=entry.id;card.dataset.eventSource=entry.source;
  card.append(el('h3',entry.title));
  card.append(el('p',entry.category+' · '+entry.eventType.toUpperCase()+' · '+entry.actor+' · '+(entry.at||'time unavailable')));
  card.append(el('p',entry.summary));
  if(entry.detail)card.append(el('p',entry.detail));
  if(entry.warning){const warning=el('p',entry.warning);warning.className='evidence-warning';card.append(warning);}
  if(entry.targetAvailable&&entry.creationId&&Number.isInteger(entry.version)&&typeof onOpenArtifact==='function'){
   const inspect=el('button','Inspect '+entry.targetTitle+' · v'+entry.version);inspect.type='button';inspect.dataset.chronicleTarget=entry.creationId;inspect.dataset.chronicleVersion=String(entry.version);inspect.onclick=()=>onOpenArtifact(entry.creationId,entry.version);card.append(inspect);
  }
  container.append(card);
 }
}

export function renderEvidenceArchive(container,{world={},kernel=null,kernelUnavailable=false,shared=false,onOpenArtifact}={}){
 if(shared&&kernelUnavailable){
  const warning=el('p','Canonical institutional history could not be loaded. The missing history is not being treated as empty; retry when the shared service is reachable.');
  warning.className='evidence-warning';container.append(warning);
 }
 if(shared&&kernel&&Array.isArray(kernel.events)&&Number.isInteger(kernel.eventCount)&&kernel.eventCount!==kernel.events.length){
  const warning=el('p','Institutional history count mismatch: the service reports '+kernel.eventCount+' events but delivered '+kernel.events.length+'. Treat this snapshot as incomplete until reconciled.');
  warning.className='evidence-warning';container.append(warning);
 }
 const chronicle=projectChronicle({world,kernel});
 const entries=chronicle.entries.filter(entry=>{
  if(entry.source==='kernel')return shared;
  return entry.source==='world'&&!['report','contribute'].includes(entry.eventType);
 });
 renderChronicle(container,{entries,malformed:chronicle.malformed},onOpenArtifact,{
  heading:shared?'CANONICAL INSTITUTIONAL HISTORY':'LOCAL WORLD HISTORY',
  intro:shared
   ?'Retained institutional work stages appear beside world events. Failed byte checks, rejected decisions and revocations remain inspectable; none is silently converted into success or truth.'
   :'Retained local world events are shown separately from the reports and contributions above. A saved event records activity, not external truth or authority.',
  emptyMessage:shared
   ?'No retained institutional or world events are recorded in this snapshot.'
   :'No retained world events are recorded in this local snapshot.'
 });
}

function validProjectSnapshot(projects) {
 return Boolean(projects && typeof projects === 'object' &&
  ['projects','accomplishments','disputes','decisions'].every(key => Array.isArray(projects[key])) &&
  Number.isSafeInteger(projects.witnessParticipation) && projects.witnessParticipation >= 0);
}

function validDecisionSnapshot(gate) {
 return Boolean(gate && typeof gate === 'object' && Array.isArray(gate.decisions) &&
  Object.hasOwn(gate, 'policy') &&
  (gate.policy === null || (typeof gate.policy === 'object' && !Array.isArray(gate.policy))));
}

function warning(container, message) {
 const item = el('p', message);
 item.className = 'evidence-warning';
 container.append(item);
}

export function renderInstitution(container,projects,gate,{
 founder=false,onChoice,kernel,kernelUnavailable=false,world,onOpenArtifact,
 projectsUnavailable=false,decisionsUnavailable=false,worldSnapshotStale=false,worldUnavailable=false
}={}) {
 container.append(el('p','Real project records, archived contradictions and scoped decisions. These records do not award game XP.'));
 if(worldSnapshotStale)warning(container,'Live world state could not be refreshed. The Chronicle below is the last snapshot received by this session; it may be stale. It is read-only and does not authorize decisions.');
 if(worldUnavailable)warning(container,'No world snapshot is available. The missing history is not being treated as an empty world.');
 else renderChronicle(container,projectChronicle({world,kernel}),onOpenArtifact);
 if(kernelUnavailable){
  container.append(el('h3','CANONICAL WORK RECEIPTS'));
  warning(container,'Canonical work receipts could not be loaded from the shared service. Other available records remain inspectable; the missing kernel history is not being treated as empty.');
 }else renderKernelHistory(container,kernel);

 const hasProjects=!projectsUnavailable&&validProjectSnapshot(projects);
 if(!hasProjects){
  container.append(el('h3','PROJECT REGISTERS'));
  warning(container,'Project, accomplishment, dispute and decision-status registers are unavailable or malformed. No empty register is inferred from missing data.');
  for(const name of ['PROJECTS','ACCOMPLISHMENTS','DISPUTES','DECISION STATUS']){
   container.append(el('h3',name),el('p','Unavailable · reconnect to inspect this register.'));
  }
  container.append(el('p','External Witness participation: unavailable · the project service did not provide a complete snapshot.'));
 }else{
  for(const [name,rows]of [['PROJECTS',projects.projects],['ACCOMPLISHMENTS',projects.accomplishments],['DISPUTES',projects.disputes],['DECISION STATUS',projects.decisions]]){
   container.append(el('h3',name));
   if(!rows.length)container.append(el('p','No retained record is installed.'));
   for(const row of rows){
    const card=el('article');card.className='field-card';card.dataset.recordType=name;
    card.append(el('h3',row.title||row.statement),el('p',row.status||row.disposition),el('small',row.evidenceDigest?`Evidence SHA-256 · ${row.evidenceDigest}`:'')); 
    if(row.limitation)card.append(el('p',row.limitation));
    container.append(card);
   }
  }
  container.append(el('p',`External Witness participation: ${projects.witnessParticipation}. Persistent resident accounts remain unimplemented.`));
 }

 container.append(el('h3','FOUNDER GATE'));
 if(decisionsUnavailable||!validDecisionSnapshot(gate)){
  warning(container,'Decision ledger unavailable or malformed. No policy, decision count, disposition or approval is inferred; reconnect before taking a consequential action.');
  return;
 }
 container.append(el('p',founder?'Founder session authenticated. Approval records the displayed disposition; it does not promote code.':'Witness view: private evaluation bytes and controls are withheld.'));
 if(!gate.policy)container.append(el('p','No operational review policy is activated. The first 24-hour clock has not started.'));
 for(const d of gate.decisions){
  const card=el('article');card.className='field-card';card.dataset.decisionId=d.id;
  card.append(el('h3',d.title),el('p',`Status: ${d.status} · Expires: ${d.expiresAt}`));
  if(founder){
   card.append(el('p',d.proposedEffect),el('p',`Rollback: ${d.rollback}`));
   for(const risk of d.risks||[])card.append(el('p',`Risk: ${risk}`));
   if(d.evaluation){const detail=el('details');detail.append(el('summary','Retained evaluation bytes'),el('pre',d.evaluation.bytes));card.append(detail);}
   if(d.status==='PENDING')for(const action of ['APPROVE','REJECT','DEFER']){
    const b=el('button',action);b.type='button';b.dataset.gateAction=action;b.onclick=()=>onChoice?.(d,action);card.append(b);
   }
  }
  container.append(card);
 }
}
