import { projectChronicle } from "./chronicle.mjs";
import { getActiveQuest, getQuestTrail } from "./quests.mjs";
import { projectSourceObservationRecords, sameResearchActor } from "./research-records.mjs";

const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};

const CHARTER_IDENTITY_EQUATION = 'The-NEOPHYTE_FOUNDER + idea + multiple AI collaborators + adversarial_contempt + hardening + human-gate + synthesis + possibilities + abilities + provenance + agents + polymathy-training/fundamental-knowledge';

const uniqueActivityIds = (...objectives) => [...new Set(objectives.flatMap(objective =>
  Array.isArray(objective?.evidenceIds) ? objective.evidenceIds : []
))].filter(id => typeof id === 'string' && id.trim());

const hasRecordedActivity = objective =>
  objective?.complete === true && Array.isArray(objective.evidenceIds) && objective.evidenceIds.length > 0;

function charterStage(id, title, status, description, boundary, locationId, locationName, evidenceIds = [], relatedOnly = false) {
  return Object.freeze({
    id, title, status, description, boundary, locationId, locationName,
    evidenceIds: Object.freeze([...new Set(evidenceIds)]),
    relatedOnly
  });
}

/**
 * Read-only crosswalk from the proposed Institutional Charter to the current
 * actor's retained game activity. Status labels describe records or missing
 * game mechanisms; they never certify truth, mastery, approval, or release.
 */
export function projectCharterCodex(world, viewer) {
  const unavailable = reason => Object.freeze({
    available: false, reason, readOnly: true, xpDelta: 0, worldMutation: false,
    identityEquation: CHARTER_IDENTITY_EQUATION, doctrine: 'AOTA — All Of The Above.',
    scope: 'Missing or incomplete history is not treated as an empty world.',
    nextObjective: null, stages: Object.freeze([])
  });

  if (!Array.isArray(world?.events) || !Array.isArray(world?.creations)) {
    return unavailable('The current world snapshot lacks a complete event and creation list. The Codex is unavailable; missing history is not treated as empty.');
  }
  if (world.events.length > 100_000 || world.creations.length > 20_000) {
    return unavailable('The current world snapshot exceeds the bounded projection limit. No lifecycle status is inferred from a partial snapshot.');
  }
  if (typeof viewer?.id !== 'string' || !viewer.id || !['founder', 'witness'].includes(viewer.role)) {
    return unavailable('A valid Founder or Witness session is required to project actor-scoped activity.');
  }

  let trail;
  let sourceRecords;
  let nextObjective;
  try {
    trail = getQuestTrail(world, viewer);
    sourceRecords = projectSourceObservationRecords(world.events, world.creations)
      .filter(record => record?.projectionStatus === 'linked' && sameResearchActor(record.actor, viewer));
    nextObjective = getActiveQuest(world, viewer, trail);
  } catch {
    return unavailable('The retained quest or research history could not be projected safely. No lifecycle status is inferred.');
  }

  if (!Array.isArray(trail) || !Array.isArray(sourceRecords)) {
    return unavailable('The retained quest or research projection is incomplete. No lifecycle status is inferred.');
  }

  const objective = suffix => trail.find(item => item?.id === viewer.role + '-' + suffix) || null;
  const study = objective('academy-study-note');
  const studyReview = objective('academy-study-review');
  const sourceObservation = objective('source-observation');
  const moonshot = objective('moonshot-proposal');
  const publication = objective(viewer.role === 'founder' ? 'first-place' : 'work-available');
  const experiment = objective('experiment-report');
  const sourceChallenge = objective('source-observation-challenge');
  const sourceResponse = objective('source-observation-response');
  const experimentChallenge = objective('challenge-experiment-report');
  const preserveVersion = objective('preserve-version');

  const falsifiableNotes = sourceRecords.filter(record =>
    typeof record.falsifier === 'string' && record.falsifier.trim() &&
    typeof record.nextTest === 'string' && record.nextTest.trim()
  );
  const incomingSourceChallenges = sourceRecords.flatMap(record =>
    Array.isArray(record.challenges) ? record.challenges : []
  );
  const challengeIds = [...new Set([
    ...uniqueActivityIds(sourceChallenge, experimentChallenge),
    ...incomingSourceChallenges.map(challenge => challenge?.id)
  ])].filter(id => typeof id === 'string' && id.trim());
  const responseIds = [...new Set([
    ...uniqueActivityIds(sourceResponse),
    ...incomingSourceChallenges.flatMap(challenge =>
      Array.isArray(challenge?.responses) ? challenge.responses.map(response => response?.id) : []
    )
  ])].filter(id => typeof id === 'string' && id.trim());
  const attributionIds = uniqueActivityIds(publication, sourceObservation, study);
  const hasEarlierVersion = world.creations.some(creation =>
    Array.isArray(creation?.versions) && creation.versions.some(version =>
      Number.isSafeInteger(version?.version) && Number.isSafeInteger(creation.version) &&
      version.version > 0 && version.version < creation.version
    )
  );

  const stages = [
    charterStage(
      'inherit', '1. Inherit — establish the state of knowledge',
      hasRecordedActivity(study)
        ? hasRecordedActivity(studyReview) ? 'STUDY + REVIEW ACTIVITY RECORDED' : 'STUDY ACTIVITY RECORDED'
        : 'NOT RECORDED',
      'The Academy records a question, the player’s explanation, and a next check against one retained artifact version.',
      'Study notes and retrieval reviews are self-reported practice. They do not prove correctness, source quality, or mastery.',
      'academy', 'Polymath Academy', uniqueActivityIds(study, studyReview)
    ),
    charterStage(
      'investigate', '2. Investigate — map existing solutions and rights',
      hasRecordedActivity(sourceObservation) ? 'SOURCE NOTE RECORDED · RETRIEVAL NOT PERFORMED' : 'NOT RECORDED',
      'The Source Observatory binds an author-entered observation to one exact retained publication version.',
      'The source class is author-selected. Source retrieval and independent verification remain NOT_PERFORMED; model assertions remain LEADS_ONLY.',
      'source_observatory', 'Source Observatory', uniqueActivityIds(sourceObservation)
    ),
    charterStage(
      'identify-gap', '3. Identify the gap — define the problem',
      falsifiableNotes.length ? 'FALSIFIER + NEXT TEST DECLARED · NOT VALIDATED'
        : sourceRecords.length ? 'SOURCE NOTE ONLY · NO LINKED FALSIFIER + NEXT TEST' : 'NOT RECORDED',
      'A player can state a possible falsifier and a next discriminating test in a source-bound note.',
      'Those fields are author-entered proposals. They do not establish that an unmet need exists or that the test was performed.',
      'source_observatory', 'Source Observatory',
      falsifiableNotes.length ? falsifiableNotes.map(record => record.id) : uniqueActivityIds(sourceObservation)
    ),
    charterStage(
      'hypothesize', '4. Hypothesize — make the proposition falsifiable',
      hasRecordedActivity(moonshot) ? 'HYPOTHESIS PROPOSAL RECORDED' : 'NOT RECORDED',
      'Moonshot Field retains a proposition with a possible falsifier and requested evidence.',
      'A retained proposal is a hypothesis, not a demonstrated result or an approved project.',
      'moonshot_field', 'Moonshot Field', uniqueActivityIds(moonshot)
    ),
    charterStage(
      'design', '5. Design — specify the candidate',
      hasRecordedActivity(moonshot) ? 'PARTIAL · PROPOSAL INPUTS ONLY' : 'NOT RECORDED',
      'The current Moonshot proposal captures a bounded research question and evidence needs.',
      'A full architecture, threat assumptions, dependencies, resource envelope, baseline, evaluation method, and rollback path are not represented by this proposal alone.',
      'moonshot_field', 'Moonshot Field', uniqueActivityIds(moonshot), true
    ),
    charterStage(
      'prototype', '6. Prototype — make the idea executable',
      hasRecordedActivity(publication) ? 'IN-WORLD ARTIFACT PUBLISHED' : 'NOT RECORDED',
      'The Forge can create and publish a checked artifact as a walkable in-world object.',
      'In-world publication is not proof of a tested, reliable, safe, or externally usable product.',
      'forge', 'Forge', uniqueActivityIds(publication)
    ),
    charterStage(
      'experiment', '7. Experiment — compare under controlled conditions',
      hasRecordedActivity(experiment) ? 'ATTEMPT REPORTED · SELF-REPORTED' : 'NOT RECORDED',
      'Moonshot Field retains an attributed attempt, reported outcome, and optional exact artifact-version link.',
      'A report or artifact link does not prove execution, controlled comparison, observation, or hypothesis truth.',
      'moonshot_field', 'Moonshot Field', uniqueActivityIds(experiment)
    ),
    charterStage(
      'verify', '8. Verify — challenge and reproduce',
      challengeIds.length && responseIds.length ? 'CHALLENGE + AUTHOR RESPONSE RETAINED'
        : challengeIds.length ? 'CHALLENGE RETAINED · NOT VERIFICATION' : 'NOT RECORDED',
      'The Evidence Archive preserves challenges, dissent, and any original-author response beside the linked record.',
      'A challenge is not independent replication, adjudication, truth, approval, or authority. Session actor IDs do not prove distinct humans.',
      'evidence_archive', 'Evidence Archive', [...challengeIds, ...responseIds], true
    ),
    charterStage(
      'contribution', '9. Establish contribution and protect it responsibly',
      attributionIds.length ? 'PARTIAL · ATTRIBUTION ONLY' : 'NOT REPRESENTED IN PLAYER-WORLD STATE',
      'The game can retain actor-attributed publications, study notes, and source-version references.',
      'Prior-art, freedom-to-operate, IP ownership, licensing, and qualified legal review are not represented as an in-world gate.',
      'evidence_archive', 'Evidence Archive', attributionIds, true
    ),
    charterStage(
      'engineer-for-use', '10. Engineer for use',
      'NOT REPRESENTED IN PLAYER-WORLD STATE',
      'This stage requires a real engineering acceptance path beyond crafting an in-game item.',
      'Build, safety, security, accessibility, interoperability, operations, scale, and recovery acceptance are not inferred from the Forge or from browser/emulator checks.',
      'forge', 'Forge', [], true
    ),
    charterStage(
      'deploy-share-commercialize', '11. Deploy, share, and commercialize',
      'NOT REPRESENTED IN PLAYER-WORLD STATE',
      'Publication House represents in-world publication and circulation only.',
      'External deployment, adoption, public impact, contracts, licensing, and revenue require separate evidence and authorization; none is inferred from an in-game publication.',
      'publication_house', 'Publication House', [], true
    ),
    charterStage(
      'preserve-transfer', '12. Preserve and transfer',
      hasRecordedActivity(preserveVersion) ? 'PARTIAL · EARLIER VERSION RETAINED'
        : hasEarlierVersion || world.events.length > 0 ? 'PARTIAL · CHRONICLE / VERSION HISTORY'
          : 'NOT RECORDED',
      'The game retains append-only activity history and exact published versions; the offline notebook has an explicit local backup/restore path.',
      'A complete archival transfer package covering source materials, data rights, protocols, failures, decisions, licenses, and recovery instructions is not represented by these mechanisms alone.',
      'evidence_archive', 'Evidence Archive',
      uniqueActivityIds(preserveVersion), true
    )
  ];

  return Object.freeze({
    available: true,
    readOnly: true,
    xpDelta: 0,
    worldMutation: false,
    identityEquation: CHARTER_IDENTITY_EQUATION,
    doctrine: 'AOTA — All Of The Above is the scope rule; chronology orders dependent work without forcing false choices. A model’s assertion is never sufficient evidence.',
    scope: 'This is a read-only crosswalk from the proposed Institutional Charter to this session’s retained game activity. It does not inspect external CI, legal rights, source retrieval, external deployment, adoption, revenue, or real-world human identity. Statuses describe activity or missing in-world mechanisms—not approval, mastery, truth, or release.',
    nextObjective: nextObjective && typeof nextObjective.title === 'string'
      ? Object.freeze({
          title: nextObjective.title,
          copy: typeof nextObjective.copy === 'string' ? nextObjective.copy : '',
          button: typeof nextObjective.button === 'string' ? nextObjective.button : 'Go to this objective →',
          nextAction: nextObjective.nextAction && typeof nextObjective.nextAction === 'object'
            ? Object.freeze({ ...nextObjective.nextAction })
            : typeof nextObjective.action === 'string'
              ? Object.freeze({ type: 'quest-route', action: nextObjective.action }) : null
        })
      : null,
    stages: Object.freeze(stages)
  });
}

export function renderCharterCodex(container, { world = {}, viewer = null, onOpenAction } = {}) {
  const projection = projectCharterCodex(world, viewer);
  const codex = el('details');
  codex.className = 'field-card';
  codex.dataset.charterCodex = 'true';
  codex.open = false;
  codex.setAttribute('aria-label', 'AOTA Codex · Institutional Invention Lifecycle');
  codex.append(el('summary', 'AOTA CODEX · INSTITUTIONAL INVENTION LIFECYCLE · 12 STAGES'));
  codex.append(el('p', 'PROPOSED INSTITUTIONAL CHARTER CROSSWALK · READ ONLY'));

  if (!projection.available) {
    codex.open = true;
    const warning = el('p', projection.reason);
    warning.className = 'evidence-warning';
    codex.append(warning);
    container.append(codex);
    return projection;
  }

  const identity = el('p', projection.identityEquation);
  identity.dataset.charterIdentity = 'true';
  codex.append(identity, el('p', projection.doctrine), el('p', projection.scope));

  if (projection.nextObjective) {
    const next = el('article');
    next.className = 'field-card';
    next.dataset.charterNextObjective = 'true';
    next.append(el('h4', 'NEXT PLAYABLE OBJECTIVE'));
    next.append(el('p', projection.nextObjective.title));
    if (projection.nextObjective.copy) next.append(el('p', projection.nextObjective.copy));
    if (projection.nextObjective.nextAction && typeof onOpenAction === 'function') {
      const go = el('button', projection.nextObjective.button);
      go.type = 'button';
      go.dataset.charterNextAction = 'true';
      go.onclick = () => onOpenAction(projection.nextObjective.nextAction);
      next.append(go);
    }
    codex.append(next);
  }

  for (const stage of projection.stages) {
    const card = el('article');
    card.className = 'field-card';
    card.dataset.charterStage = stage.id;
    card.append(el('h4', stage.title));
    const status = el('p', 'STATUS · ' + stage.status);
    status.className = 'status-line';
    card.append(status, el('p', stage.description), el('p', stage.boundary));
    if (stage.evidenceIds.length) {
      card.append(el('small', 'Retained activity IDs · ' + stage.evidenceIds.join(', ')));
    }
    if (stage.locationId && typeof onOpenAction === 'function') {
      const label = stage.relatedOnly ? 'Inspect related room · ' : 'Walk to room · ';
      const action = el('button', label + stage.locationName + ' →');
      action.type = 'button';
      action.dataset.charterStageAction = stage.id;
      action.setAttribute('aria-label', label + stage.locationName + ' for charter stage ' + stage.id);
      action.onclick = () => onOpenAction({ type: 'location', id: stage.locationId });
      card.append(action);
    }
    codex.append(card);
  }

  const footer = el('p', 'Opening this Codex is read-only. It creates no canonical event, quest progress, XP, evidence, approval, or authority.');
  footer.className = 'form-help';
  codex.append(footer);
  container.append(codex);
  return projection;
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


const MAX_SOURCE_OBSERVATION_QUEUE_ITEMS = 50;
const MAX_SOURCE_OBSERVATION_CHALLENGES_PER_RECORD = 20;
const MAX_SOURCE_OBSERVATION_RESPONSES_PER_CHALLENGE = 10;

/**
 * A read-only Evidence Archive research desk. The action queue is derived from
 * uniquely linked history; the register preserves the note, dissent, response,
 * exact version and fixed assurance boundary without creating game state.
 */
function renderSourceObservationResponseQueue(container, world, onOpenArtifact) {
 container.append(el('h3','SOURCE OBSERVATORY · AUTHOR RESPONSE QUEUE'));
 if (!Array.isArray(world?.events) || !Array.isArray(world?.creations)) {
  const warning=el('p','The Source Observation queue is unavailable because this snapshot lacks a complete event and creation list. It is not being treated as empty.');
  warning.className='evidence-warning';
  container.append(warning);
  return;
 }
 if(world.events.length>100_000||world.creations.length>20_000) {
  const warning=el('p','The Source Observation snapshot exceeds the bounded projection limit. No response action is offered and the queue is not treated as empty.');
  warning.className='evidence-warning';
  container.append(warning);
  return;
 }
 let records;
 try { records=projectSourceObservationRecords(world.events,world.creations); }
 catch {
  const warning=el('p','The Source Observation projection could not be read safely. No response action is offered; inspect the retained Chronicle.');
  warning.className='evidence-warning';
  container.append(warning);
  return;
 }
 if(!Array.isArray(records)) {
  const warning=el('p','The Source Observation projection is unavailable. No response action is offered; inspect the retained Chronicle.');
  warning.className='evidence-warning';
  container.append(warning);
  return;
 }
 const linked=records.filter(record=>record?.projectionStatus==='linked');
 const unlinkedCount=records.length-linked.length;
 const pending=[],ambiguous=[];
 let projectedChallengeCount=0,linkedResponseCount=0;
 for(const record of linked) for(const challenge of Array.isArray(record.challenges)?record.challenges:[]) {
  projectedChallengeCount+=1;
  linkedResponseCount+=Array.isArray(challenge.responses)?challenge.responses.length:0;
  const item={record,challenge};
  if(challenge?.responseStatus==='unanswered')pending.push(item);
  else if(challenge?.responseStatus==='ambiguous')ambiguous.push(item);
 }
 let retainedChallengeCount=0;
 for(let index=0;index<world.events.length;index+=1) {
  const event=world.events[index];
  if(event&&typeof event==='object'&&event.type==='source-observation-challenged')retainedChallengeCount+=1;
 }
 const unprojectedChallengeCount=Math.max(0,retainedChallengeCount-projectedChallengeCount);
 const newestFirst=(left,right)=>
  String(right.challenge?.at||'').localeCompare(String(left.challenge?.at||''))||
  String(left.challenge?.challengeId||'').localeCompare(String(right.challenge?.challengeId||''));
 pending.sort(newestFirst);
 ambiguous.sort(newestFirst);
 container.append(el('p',pending.length+' uniquely linked challenge(s) await an author response · '+ambiguous.length+' ambiguous response-history item(s). This is a read-only queue; only the original note author can respond.'));
 if(unlinkedCount>0) {
  const warning=el('p',unlinkedCount+' Source Observation record(s) could not be uniquely linked. They are not actionable here and remain inspectable in the Chronicle.');
  warning.className='evidence-warning';
  container.append(warning);
 }
 if(unprojectedChallengeCount>0) {
  const warning=el('p',unprojectedChallengeCount+' retained challenge event(s) could not be uniquely linked to a valid observation. No response action is offered; inspect the Chronicle.');
  warning.className='evidence-warning';
  container.append(warning);
 }
 if(!pending.length&&!ambiguous.length) {
  const emptyMessage=unlinkedCount===0&&unprojectedChallengeCount===0
   ?'No unanswered Source Observation challenges. The Chronicle keeps every retained challenge and author response.'
   :'No uniquely linked unanswered challenge is actionable in this snapshot. Unlinked or ambiguous history remains in the Chronicle.';
  container.append(el('p',emptyMessage));
 }
 for(const {record,challenge} of pending.slice(0,MAX_SOURCE_OBSERVATION_QUEUE_ITEMS)) {
  const card=el('article');
  card.className='field-card';
  card.dataset.recordType='SOURCE_OBSERVATION_PENDING_CHALLENGE';
  card.dataset.challengeId=challenge.challengeId;
  card.append(el('h3',record.claim));
  card.append(el('p','Source version: '+(record.targetTitle||record.creationId)+' · v'+record.version+' · original author '+(record.actor?.name||record.actor?.id||'unknown')));
  card.append(el('p','Challenge: '+challenge.challengeType+' · '+(challenge.actor?.name||challenge.actor?.id||'unknown actor')+' · '+(challenge.at||'time unavailable')));
  card.append(el('p',challenge.challengeText));
  card.append(el('p','Only the original note author can respond. The challenge remains dissent, not a verdict, independent evidence, or authority.','form-help'));
  if(typeof onOpenArtifact==='function'&&typeof record.creationId==='string'&&Number.isSafeInteger(record.version)) {
   const inspect=el('button','Open source observation · v'+record.version);
   inspect.type='button';
   inspect.dataset.sourceObservationPendingChallenge=challenge.challengeId;
   inspect.dataset.creationId=record.creationId;
   inspect.dataset.version=String(record.version);
   inspect.onclick=()=>onOpenArtifact(record.creationId,record.version);
   card.append(inspect);
  }
  container.append(card);
 }
 if(pending.length>MAX_SOURCE_OBSERVATION_QUEUE_ITEMS) {
  const more=el('p',(pending.length-MAX_SOURCE_OBSERVATION_QUEUE_ITEMS)+' additional unanswered challenge(s) remain in the Chronicle.');
  more.className='form-help';
  container.append(more);
 }
 for(const {record,challenge} of ambiguous.slice(0,MAX_SOURCE_OBSERVATION_QUEUE_ITEMS)) {
  const card=el('article');
  card.className='field-card';
  card.dataset.recordType='SOURCE_OBSERVATION_AMBIGUOUS_RESPONSE';
  card.dataset.sourceObservationAmbiguousChallenge=challenge.challengeId;
  card.append(el('h3',record.claim));
  card.append(el('p','Ambiguous response history · '+record.creationId+' · v'+record.version+' · challenge '+challenge.challengeId));
  card.append(el('p',challenge.challengeText));
  const warning=el('p','Response history is ambiguous. No response is selected or counted; inspect the retained Chronicle rather than creating another response.');
  warning.className='evidence-warning';
  card.append(warning);
  container.append(card);
 }
 if(ambiguous.length>MAX_SOURCE_OBSERVATION_QUEUE_ITEMS) {
  const more=el('p',(ambiguous.length-MAX_SOURCE_OBSERVATION_QUEUE_ITEMS)+' additional ambiguous challenge history item(s) remain in the Chronicle.');
  more.className='form-help';
  container.append(more);
 }

 container.append(el('h3','SOURCE OBSERVATION REGISTER'));
 container.append(el('p',linked.length+' uniquely linked source observation(s) · '+projectedChallengeCount+' linked challenge(s) · '+linkedResponseCount+' projected author response record(s). This is an attributed research register, not a truth or verification ledger.'));
 if(!linked.length) {
  container.append(el('p',records.length
   ?'No Source Observation currently has a unique retained source-version link. Unlinked and malformed history remains in the Chronicle.'
   :'No Source Observation has been retained in this snapshot yet.'));
  return;
 }
 for(const record of linked.slice(0,MAX_SOURCE_OBSERVATION_QUEUE_ITEMS)) {
  const card=el('article');
  card.className='field-card';
  card.dataset.recordType='SOURCE_OBSERVATION_REGISTER';
  card.dataset.sourceObservationRegisterRecord=record.observationId;
  card.append(el('h3',record.claim));
  card.append(el('p','Retained source: '+(record.targetTitle||record.creationId)+' · '+record.creationId+' · v'+record.version+' · author '+(record.actor?.name||record.actor?.id||'unknown')));
  card.append(el('p','Author-selected source class: '+record.sourceKind));
  card.append(el('p','Source / attribution: '+record.source));
  card.append(el('p',record.falsifier?'Possible falsifier: '+record.falsifier:'Possible falsifier: not supplied in this note.'));
  card.append(el('p',record.uncertainty?'Uncertainty: '+record.uncertainty:'Uncertainty: not supplied in this note.'));
  card.append(el('p',record.nextTest?'Next discriminating test: '+record.nextTest:'Next discriminating test: not supplied in this note.'));
  card.append(el('p','Assurance: Source retrieval '+record.sourceRetrieval+' · Independent verification '+record.independentVerification+' · Model assertions '+record.modelAssertions+' · Execution '+record.execution,'form-help'));
  card.append(el('p',record.warning,'evidence-warning'));
  if(typeof onOpenArtifact==='function'&&typeof record.creationId==='string'&&Number.isSafeInteger(record.version)) {
   const inspect=el('button','Open exact source version · v'+record.version);
   inspect.type='button';
   inspect.dataset.sourceObservationRegisterOpen=record.observationId;
   inspect.dataset.creationId=record.creationId;
   inspect.dataset.version=String(record.version);
   inspect.onclick=()=>onOpenArtifact(record.creationId,record.version);
   card.append(inspect);
  }
  const challenges=Array.isArray(record.challenges)?record.challenges:[];
  card.append(el('h4','RETAINED DISSENT & RESPONSES · '+challenges.length));
  if(!challenges.length)card.append(el('p','No challenge is retained against this observation yet.'));
  for(const challenge of challenges.slice(0,MAX_SOURCE_OBSERVATION_CHALLENGES_PER_RECORD)) {
   const item=el('section');
   item.className='field-card';
   item.dataset.sourceObservationRegisterChallenge=challenge.challengeId;
   item.append(el('h4',challenge.challengeType+' · '+(challenge.actor?.name||challenge.actor?.id||'unknown actor')));
   item.append(el('p',challenge.challengeText));
   if(challenge.responseStatus==='answered')item.append(el('p','AUTHOR RESPONSE RETAINED'));
   else if(challenge.responseStatus==='ambiguous')item.append(el('p','AMBIGUOUS RESPONSE HISTORY · no response is selected or counted.','evidence-warning'));
   else item.append(el('p','Awaiting the original note author response.'));
   const responses=Array.isArray(challenge.responses)?challenge.responses:[];
   for(const response of responses.slice(0,MAX_SOURCE_OBSERVATION_RESPONSES_PER_CHALLENGE)) {
    item.append(el('p','Author response · '+(response.actor?.name||response.actor?.id||'unknown actor')+' · '+(response.at||'time unavailable')));
    item.append(el('p',response.responseText));
   }
   if(responses.length>MAX_SOURCE_OBSERVATION_RESPONSES_PER_CHALLENGE) {
    const more=el('p',(responses.length-MAX_SOURCE_OBSERVATION_RESPONSES_PER_CHALLENGE)+' additional response records remain in the Chronicle.');
    more.className='form-help';
    item.append(more);
   }
   card.append(item);
  }
  if(challenges.length>MAX_SOURCE_OBSERVATION_CHALLENGES_PER_RECORD) {
   const more=el('p',(challenges.length-MAX_SOURCE_OBSERVATION_CHALLENGES_PER_RECORD)+' additional challenge records remain in the Chronicle.');
   more.className='form-help';
   card.append(more);
  }
  container.append(card);
 }
 if(linked.length>MAX_SOURCE_OBSERVATION_QUEUE_ITEMS) {
  const more=el('p',(linked.length-MAX_SOURCE_OBSERVATION_QUEUE_ITEMS)+' additional linked observation(s) remain in the Chronicle.');
  more.className='form-help';
  container.append(more);
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
 renderSourceObservationResponseQueue(container,world,onOpenArtifact);
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

export function renderInstitution(container,projects,gate,{founder=false,onChoice,kernel,kernelUnavailable=false,world,onOpenArtifact}={}){
 container.append(el('p','Real project records, archived contradictions and scoped decisions. These records do not award game XP.'));
 renderChronicle(container,projectChronicle({world,kernel}),onOpenArtifact);
 if(kernelUnavailable){container.append(el('h3','CANONICAL WORK RECEIPTS'));const warning=el('p','Canonical work receipts could not be loaded from the shared service. Project and decision records remain available; the missing kernel history is not being treated as empty.');warning.className='evidence-warning';container.append(warning);}else renderKernelHistory(container,kernel);
 for(const [name,rows]of [['PROJECTS',projects.projects],['ACCOMPLISHMENTS',projects.accomplishments],['DISPUTES',projects.disputes],['DECISION STATUS',projects.decisions]]){container.append(el('h3',name));if(!rows.length)container.append(el('p','No retained record is installed.'));for(const row of rows){const card=el('article');card.className='field-card';card.dataset.recordType=name;card.append(el('h3',row.title||row.statement),el('p',row.status||row.disposition),el('small',row.evidenceDigest?`Evidence SHA-256 · ${row.evidenceDigest}`:''));if(row.limitation)card.append(el('p',row.limitation));container.append(card);}}
 const dispositionAuthorization = gate?.dispositionAuthorization;
 const dispositionsAvailable = founder && dispositionAuthorization?.available === true;
 const authorizationCode = typeof dispositionAuthorization?.code === 'string' &&
  /^[A-Z0-9_]{1,80}$/.test(dispositionAuthorization.code)
  ? dispositionAuthorization.code
  : dispositionAuthorization?.available === true ? 'READY' : 'STATUS_UNAVAILABLE';
 const authorizationMessage = typeof dispositionAuthorization?.message === 'string'
  ? dispositionAuthorization.message
  : dispositionAuthorization?.available === true
   ? 'The signed disposition path reports ready; each consequential disposition still requires an authenticated Founder action.'
   : 'Signed Founder decision authorization is not available. APPROVE, REJECT and DEFER are disabled.';
 container.append(el('h3','FOUNDER GATE'),el('p',founder
  ?'Founder session authenticated. Session authentication alone is not signed institutional authorization for consequential dispositions.'
  :'Witness view: private evaluation bytes and controls are withheld.'));
 const readiness=el('section');
 readiness.dataset.gateReadiness=dispositionAuthorization?.available === true ? 'ready' : 'blocked';
 readiness.dataset.gateReadinessCode=authorizationCode;
 readiness.append(el('h4','SIGNED DISPOSITION PATH'));
 readiness.append(el('p','Server status: '+authorizationCode));
 const warning=el('p',authorizationMessage);
 warning.className='evidence-warning';
 warning.dataset.gateReadinessMessage='true';
 if(founder&&!dispositionsAvailable) warning.dataset.decisionAuthorizationBlocked='true';
 else if(!founder) warning.dataset.witnessDispositionControlsWithheld='true';
 readiness.append(warning);
 readiness.append(el('p','This server-reported readiness check is not a decision, evidence, approval, or authority grant.'));
 container.append(readiness);
 if(!gate.policy)container.append(el('p','No operational review policy is activated. The first 24-hour clock has not started.'));
 for(const d of gate.decisions||[]){const card=el('article');card.className='field-card';card.dataset.decisionId=d.id;card.append(el('h3',d.title),el('p',`Status: ${d.status} · Expires: ${d.expiresAt}`));if(founder){card.append(el('p',d.proposedEffect),el('p',`Rollback: ${d.rollback}`));for(const risk of d.risks||[])card.append(el('p',`Risk: ${risk}`));if(d.evaluation){const detail=el('details');detail.append(el('summary','Retained evaluation bytes'),el('pre',d.evaluation.bytes));card.append(detail);}if(d.status==='PENDING'&&dispositionsAvailable)for(const action of ['APPROVE','REJECT','DEFER']){const b=el('button',action);b.type='button';b.dataset.gateAction=action;b.onclick=()=>onChoice(d,action);card.append(b);}}container.append(card);}
 container.append(el('p',`External Witness participation: ${projects.witnessParticipation}. Persistent resident accounts remain unimplemented.`));
}
