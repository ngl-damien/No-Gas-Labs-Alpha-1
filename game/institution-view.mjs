import { projectChronicle } from "./chronicle.mjs";
import { isStrictTimestamp } from "./timestamps.mjs";
import { projectCollaboratorPackets } from "./collaborator-contracts.mjs";
import { createAdversaryChallengeDraft } from "./collaborator-response.mjs";
import { projectCollaboratorResponseWorldObjects } from "./collaborator-world-objects.mjs";
import { assertNoDuplicateJsonObjectKeys } from "./strict-json.mjs";

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

const MAX_ADVERSARY_REVIEW_DRAFTS = 12;

function ownDataValue(value, key) {
 try {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && descriptor.enumerable === true && Object.hasOwn(descriptor, "value")
   ? descriptor.value : undefined;
 } catch { return undefined; }
}

function ownDataRecord(value) {
 try {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== "string" ||
      key === "__proto__" || key === "prototype" || key === "constructor")) return null;
  const record = Object.create(null);
  for (const key of keys) {
   const descriptor = descriptors[key];
   if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) return null;
   record[key] = descriptor.value;
  }
  return record;
 } catch { return null; }
}

function denseSnapshotValues(value, maximum) {
 try {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, "value")
   ? lengthDescriptor.value : null;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum ||
      Reflect.ownKeys(descriptors).length !== length + 1) return null;
  const values = [];
  for (let index = 0; index < length; index += 1) {
   const descriptor = descriptors[String(index)];
   if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) return null;
   values.push(descriptor.value);
  }
  return values;
 } catch { return null; }
}

/**
 * Rebuild editable Adversary drafts only from a retained, source-bound folio.
 * This is a display projection: it never appends an event or awards progress.
 */
export function projectAdversaryReviewDrafts(world) {
 const unavailable = () => Object.freeze({
  available: false, drafts: Object.freeze([]), omittedCount: 0, unavailableCount: 0
 });
 if (!isInspectableWorldSnapshot(world)) return unavailable();
 const id = ownDataValue(world, "id");
 const revision = ownDataValue(world, "revision");
 const events = denseSnapshotValues(ownDataValue(world, "events"), 100_000);
 const creations = denseSnapshotValues(ownDataValue(world, "creations"), 20_000);
 if (!events || !creations) return unavailable();

 const snapshotWorld = { id, revision, events, creations };
 const eligible = projectCollaboratorResponseWorldObjects(snapshotWorld)
  .filter(response => response.roleId === "adversary" &&
   response.validationStatus === "valid-for-human-review");
 const selected = eligible.slice(-MAX_ADVERSARY_REVIEW_DRAFTS);
 const omittedCount = Math.max(0, eligible.length - selected.length);
 const drafts = [];
 let unavailableCount = 0;

 for (const response of selected.reverse()) {
  const eventIndex = events.findIndex(event => ownDataValue(event, "id") === response.eventId);
  if (eventIndex < 0) { unavailableCount += 1; continue; }
  const responseEvent = events[eventIndex];
  const packetJson = ownDataValue(responseEvent, "packetJson");
  const responseText = ownDataValue(responseEvent, "responseText");
  if (typeof packetJson !== "string" || typeof responseText !== "string") {
   unavailableCount += 1;
   continue;
  }

  let payload;
  try {
   assertNoDuplicateJsonObjectKeys(packetJson, { label: "ADVERSARY_PACKET", maxDepth: 8 });
   payload = JSON.parse(packetJson);
  } catch {
   unavailableCount += 1;
   continue;
  }
  const sourceSnapshot = ownDataValue(payload, "sourceSnapshot");
  const sourceRevision = ownDataValue(sourceSnapshot, "revision");
  const suppliedEventCount = ownDataValue(sourceSnapshot, "suppliedEventCount");
  if (ownDataValue(sourceSnapshot, "status") !== "identified" ||
      ownDataValue(sourceSnapshot, "worldId") !== id ||
      !Number.isSafeInteger(sourceRevision) || sourceRevision < 0 ||
      sourceRevision >= revision || suppliedEventCount !== eventIndex) {
   unavailableCount += 1;
   continue;
  }

  const priorEvents = events.slice(0, eventIndex);
  const packetEvents = response.actorRole === "founder"
   ? priorEvents
   : priorEvents.filter(source => {
     const record = ownDataRecord(source);
     return record && !["draft", "repair"].includes(record.type);
    });
  const packet = projectCollaboratorPackets({
   id, revision: sourceRevision, events: packetEvents, creations
  }).find(candidate => candidate.id === "adversary" &&
   candidate.available === true && candidate.moonshotId === response.moonshotId);
  if (!packet || packet.packetJson !== packetJson) {
   unavailableCount += 1;
   continue;
  }

  const draft = createAdversaryChallengeDraft(packet, responseText, snapshotWorld);
  if (!draft.valid) {
   unavailableCount += 1;
   continue;
  }
  drafts.push(Object.freeze({ responseId: response.responseId, eventId: response.eventId, draft }));
 }

 return Object.freeze({
  available: true,
  drafts: Object.freeze(drafts),
  omittedCount,
  unavailableCount
 });
}

export function hasDistinctChallengeActorId(reportActorId, viewerId) {
 return typeof reportActorId === "string" && reportActorId.length > 0 &&
  typeof viewerId === "string" && viewerId.length > 0 && reportActorId !== viewerId;
}

function renderAdversaryReviewDrafts(container, world, onOpenChallenge, viewer) {
 const projection = projectAdversaryReviewDrafts(world);
 if (!projection.available ||
     (!projection.drafts.length && projection.omittedCount === 0 && projection.unavailableCount === 0)) return;

 container.append(el("h3", "ADVERSARY · HUMAN REVIEW DRAFTS"));
 container.append(el("p", "The Adversary NPC can propose falsifiable dissent from a retained report. These drafts are editable, source-bound prompts for a human; they are not challenges, evidence, verdicts, approvals or rewards."));
 if (projection.unavailableCount > 0) {
  warning(container, `${projection.unavailableCount} retained Adversary response(s) no longer bind to the current report and challenge history. No draft was generated; the original response remains in the Chronicle.`);
 }
 if (projection.omittedCount > 0) {
  container.append(el("p", `${projection.omittedCount} older valid Adversary draft(s) are omitted from this bounded view; their retained folios remain in the archive.`));
 }

 for (const entry of projection.drafts) {
  const draft = entry.draft;
  const card = el("article");
  card.className = "field-card adversary-review-card";
  card.dataset.recordType = "ADVERSARY_DRAFT";
  card.dataset.responseId = entry.responseId;
  card.append(el("h3", `Challenge draft · ${draft.challengeType.replaceAll("-", " ")}`));
  card.append(el("p", "human review only · not submitted to the Chronicle."));
  card.append(el("p", `Moonshot ${draft.moonshotId} · report ${draft.reportId} · target event ${draft.targetEventId}`));
  card.append(el("p", `Source snapshot revision ${draft.sourceSnapshot.revision} · ${draft.sourceSnapshot.suppliedEventCount} supplied event records`));
  card.append(el("p", `Adversary distinctness assessment (unverified): ${draft.distinctnessAssessment}`));
  if (draft.duplicateOfEventIds.length) {
   card.append(el("p", `Prior challenge references: ${draft.duplicateOfEventIds.join(" · ")}`));
  }
  if (draft.counterexample) card.append(el("p", `Possible counterexample (unverified): ${draft.counterexample}`));
  if (draft.evidenceNeeded.length) {
   card.append(el("p", "Evidence still needed (not attached):"));
   const list = el("ul");
   for (const item of draft.evidenceNeeded) list.append(el("li", item));
   card.append(list);
  }
  if (draft.unknowns.length) {
   card.append(el("p", "Unknowns retained by the draft:"));
   const list = el("ul");
   for (const item of draft.unknowns) list.append(el("li", item));
   card.append(list);
  }
  if (draft.omittedCount > 0) {
   warning(card, `The source packet omitted ${draft.omittedCount} eligible event(s); ${draft.omittedEventIds.length} omitted IDs are listed${draft.omittedEventIdListTruncated ? " and that list is truncated" : ""}.`);
  }
  if (draft.truncatedFields.length) {
   warning(card, `Source text was clipped in: ${draft.truncatedFields.join(", ")}. Full source is required before exhaustive review.`);
  }

  const editor = el("textarea");
  editor.className = "adversary-draft-editor";
  editor.value = draft.challengeText;
  editor.rows = 5;
  editor.maxLength = 1000;
  editor.setAttribute("aria-label", `Editable challenge draft for report ${draft.reportId}`);
  editor.dataset.adversaryDraftText = entry.responseId;
  card.append(editor);
  const select = el("button", "Select draft text");
  select.type = "button";
  select.className = "secondary-button";
  select.dataset.adversaryDraftSelect = entry.responseId;
  select.onclick = () => { editor.focus(); editor.select(); };
  card.append(select);
  if (typeof onOpenChallenge === "function") {
   const matchingReports = (Array.isArray(world.events) ? world.events : []).filter(event =>
    event?.type === "experiment-reported" &&
    event.id === draft.targetEventId &&
    event.reportId === draft.reportId &&
    event.moonshotId === draft.moonshotId
   );
   if (matchingReports.length === 1 && hasDistinctChallengeActorId(matchingReports[0].actor?.id, viewer?.id)) {
    const review = el("button", "Review challenge in Moonshot Field →");
    review.type = "button";
    review.className = "list-button";
    review.dataset.adversaryDraftReview = entry.responseId;
    review.onclick = () => onOpenChallenge({
     reportId: draft.reportId,
     targetEventId: draft.targetEventId,
     moonshotId: draft.moonshotId,
     challengeType: draft.challengeType,
     challengeText: editor.value
    });
    card.append(review);
   }
  }
  card.append(el("p", "Edit the draft, then open its exact retained report in the Moonshot Field. You must review and submit the challenge yourself. The game kernel requires a different actor ID from the report author. No event, XP, evidence, approval or authority is created until you submit the separate challenge action."));
  container.append(card);
 }
}

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

export function renderEvidenceArchive(container,{world={},kernel=null,kernelUnavailable=false,shared=false,onOpenArtifact,onOpenChallenge,viewer,collaboratorResponseObjects=null}={}){
 if(shared&&kernelUnavailable){
  const warning=el('p','Canonical institutional history could not be loaded. The missing history is not being treated as empty; retry when the shared service is reachable.');
  warning.className='evidence-warning';container.append(warning);
 }
 if(shared&&kernel&&Array.isArray(kernel.events)&&Number.isInteger(kernel.eventCount)&&kernel.eventCount!==kernel.events.length){
  const warning=el('p','Institutional history count mismatch: the service reports '+kernel.eventCount+' events but delivered '+kernel.events.length+'. Treat this snapshot as incomplete until reconciled.');
  warning.className='evidence-warning';container.append(warning);
 }
 const chronicle=projectChronicle({world,kernel,collaboratorResponseObjects});
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
 renderAdversaryReviewDrafts(container, world, onOpenChallenge, viewer);
}

function validProjectSnapshot(projects) {
 return Boolean(projects && typeof projects === 'object' &&
  ['projects','accomplishments','disputes','decisions'].every(key => Array.isArray(projects[key])) &&
  Number.isSafeInteger(projects.witnessParticipation) && projects.witnessParticipation >= 0);
}


function warning(container, message) {
 const item = el('p', message);
 item.className = 'evidence-warning';
 container.append(item);
}

export function renderInstitution(container,projects,gate,{
 founder=false,onChoice,kernel,kernelUnavailable=false,world,onOpenArtifact,
 projectsUnavailable=false,decisionsUnavailable=false,worldSnapshotStale=false,worldUnavailable=false,
 decisionPresentation='full',decisionProjection=null,collaboratorResponseObjects=null
}={}) {
 container.append(el('p','Real project records, archived contradictions and scoped decisions. These records do not award game XP.'));
 if(worldSnapshotStale)warning(container,'Live world state could not be refreshed. The Chronicle below is the last snapshot received by this session; it may be stale. It is read-only and does not authorize decisions.');
 if(worldUnavailable)warning(container,'No world snapshot is available. The missing history is not being treated as an empty world.');
 else renderChronicle(container,projectChronicle({world,kernel,collaboratorResponseObjects}),onOpenArtifact);
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

 const presentation = ['hidden', 'summary', 'full'].includes(decisionPresentation)
  ? decisionPresentation : 'full';
 if(presentation!=='hidden'){
  const projection=decisionProjection;
  container.append(el('h3',presentation==='full'?'FOUNDER GATE':'DECISION SERVICE · STATUS'));
  if(decisionsUnavailable||!projection||projection.available!==true){
   warning(container,'Decision ledger unavailable or malformed. No policy, decision count, disposition or approval is inferred; reconnect before taking a consequential action.');
   return;
  }
  if(!projection.policy)container.append(el('p','No operational review policy is activated. No review window is running.'));
  if(projection.decisionCount===0)container.append(el('p','No retained decision proposals are recorded.','empty-note'));
  if(presentation==='summary'){
   container.append(el('p',founder
    ?'Status-only decision register. Disposition controls are available only in the Decision Chamber.'
    :'Status-only decision register. Private evaluation bytes and disposition controls are withheld.'));
   for(const decision of projection.decisions){
    const card=el('article');card.className='field-card';card.dataset.decisionId=decision.id;card.tabIndex=-1;
    card.append(el('h3',decision.title),el('p',`Status: ${decision.status} · Expires: ${decision.expiresAt}`));
    if(decision.disposition)card.append(el('p',`Recorded disposition: ${decision.disposition.action} · account ${decision.disposition.actorId} · ${decision.disposition.decidedAt}`));
    container.append(card);
   }
  }else{
   container.append(el('p',founder
    ?'Founder session authenticated. A disposition records the displayed decision; it does not promote code.'
    :'Witness view: private evaluation bytes and controls are withheld.'));
   const rawById=new Map(gate.decisions.map(decision=>[decision.id,decision]));
   for(const summary of projection.decisions){
    const d=rawById.get(summary.id);
    if(!d)continue;
    const card=el('article');card.className='field-card';card.dataset.decisionId=d.id;card.tabIndex=-1;
    card.append(el('h3',summary.title),el('p',`Status: ${summary.status} · Expires: ${summary.expiresAt}`));
    if(founder){
     card.append(el('p',d.proposedEffect),el('p',`Rollback: ${d.rollback}`));
     for(const risk of d.risks||[])card.append(el('p',`Risk: ${risk}`));
     if(d.evaluation){const detail=el('details');detail.append(el('summary','Retained evaluation bytes'),el('pre',d.evaluation.bytes));card.append(detail);}
     if(summary.status==='PENDING')for(const action of ['APPROVE','REJECT','DEFER']){
      const b=el('button',action);b.type='button';b.dataset.gateAction=action;b.onclick=()=>onChoice?.(d,action);card.append(b);
     }
    }
    container.append(card);
   }
  }
  if(projection.omittedDecisionCount)container.append(el('p',`${projection.omittedDecisionCount} older decision record(s) remain in the service and are not shown in this bounded view.`));
 }
}
