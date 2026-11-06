import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWorld, applyAction, publicWorld, validateWorld} from '../game/model.mjs';
import {isStrictTimestamp} from '../game/timestamps.mjs';
import {sourceObservationRequestMaterial} from '../game/research-records.mjs';
import {projectCollaboratorPackets} from '../game/collaborator-contracts.mjs';
import {projectCharacter} from '../game/character-sheet.mjs';

const founder={id:'founder-1',name:'Damien',role:'founder'};
const witness={id:'witness-1',name:'River reader',role:'witness'};
const now='2026-10-17T12:00:00.000Z';
async function publish(world, kind='loom') {
  const draft=await applyAction(world,{type:'draft',kind,title:'A living loom 🧶',intent:'Make marks audible.'},founder,{now});
  return applyAction(draft.world,{type:'publish',draftId:draft.result.draftId,expectedVersion:0},founder,{now});
}
function textReceipt(value) {
  const bytes=new TextEncoder().encode(value);
  return {algorithm:'sha256',digest:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
}
test('private drafts stay private; immutable publication has verified bytes and game-only XP',async()=>{
  const original=createWorld({id:'test-world',now});
  const drafted=await applyAction(original,{type:'draft',kind:'loom',title:'Secret loom',intent:'Listen.'},founder,{now});
  assert.equal(original.drafts.length,0);
  assert.equal(publicWorld(drafted.world,witness).drafts.length,0);
  assert.equal(publicWorld(drafted.world,founder).drafts.length,1);
  await assert.rejects(applyAction(drafted.world,{type:'publish',draftId:drafted.result.draftId,expectedVersion:0},witness),e=>e.code==='FORBIDDEN'&&e.status===403);
  const published=await applyAction(drafted.world,{type:'publish',draftId:drafted.result.draftId,expectedVersion:0},founder,{now});
  assert.equal(published.world.xp,100);
  assert.equal(published.world.creations[0].version,1);
  assert.equal(published.world.creations[0].receipt.size,new TextEncoder().encode(published.world.creations[0].html).length);
  assert.equal(await validateWorld(published.world).then(()=>true),true);
  assert.match(published.world.events[0].semantics,/game/i);
  await assert.rejects(applyAction(published.world,{type:'publish',draftId:drafted.result.draftId,expectedVersion:0},founder),e=>e.status===409);
});
test('repair retains verified v1, stale publication fails and v2 earns only one game reward',async()=>{
  const first=await publish(createWorld({now}));
  const id=first.result.creationId;
  const repaired=await applyAction(first.world,{type:'repair',creationId:id,expectedVersion:1,intent:'Add another voice.'},founder,{now});
  assert.equal(repaired.world.creations[0].html,first.world.creations[0].html);
  await assert.rejects(applyAction(repaired.world,{type:'publish',draftId:repaired.result.draftId,expectedVersion:0},founder),e=>e.code==='STALE_VERSION');
  const second=await applyAction(repaired.world,{type:'publish',draftId:repaired.result.draftId,expectedVersion:1},founder,{now});
  assert.equal(second.world.creations[0].versions.length,1);
  assert.equal(second.world.creations[0].versions[0].version,1);
  assert.equal(second.world.creations[0].version,2);
  assert.equal(second.world.xp,200);
  assert.equal(second.world.methods.length,1);
  assert.equal(second.world.methods[0].version,2);
  assert.equal(second.world.methods[0].actor.id,founder.id);
  const tampered=structuredClone(second.world);tampered.creations[0].versions[0].html+='!';
  await assert.rejects(validateWorld(tampered),e=>e.code==='INVALID_RECEIPT');
});
test('Unicode notes/reports/discoveries are attributed, bounded and never manufacture XP',async()=>{
  const first=await publish(createWorld({now}));const creation=first.world.creations[0];
  const noted=await applyAction(first.world,{type:'contribute',creationId:creation.id,version:1,text:'𓂀 café <script>京都 🐚'},witness,{now});
  assert.equal(noted.world.contributions[0].text,'𓂀 café <script>京都 🐚');
  assert.equal(noted.world.contributions[0].actor.id,witness.id);
  const reported=await applyAction(noted.world,{type:'report',creationId:creation.id,version:1,text:'The method is unclear.'},witness,{now});
  assert.equal(reported.world.reports[0].version,1);
  const d1=await applyAction(reported.world,{type:'discover',locationId:'river'},witness,{now});
  const d2=await applyAction(d1.world,{type:'discover',locationId:'river'},witness,{now});
  assert.equal(d2.world.discoveries.length,1);assert.equal(d2.world.xp,100);
  await assert.rejects(applyAction(d2.world,{type:'discover',locationId:'imaginary'},witness),e=>e.status===400);
  await assert.rejects(applyAction(d2.world,{type:'contribute',creationId:creation.id,version:99,text:'stale'},witness),e=>e.code==='STALE_VERSION');
});
test('imports reject tampered bytes, invalid reward totals and oversized custom documents',async()=>{
  const {world}=await publish(createWorld({now}),'comic');
  const tampered=structuredClone(world);tampered.creations[0].html+='\n';
  await assert.rejects(validateWorld(tampered),e=>e.code==='INVALID_RECEIPT');
  const xp=structuredClone(world);xp.xp=999;await assert.rejects(validateWorld(xp));
  await assert.rejects(applyAction(world,{type:'draft',kind:'custom',title:'Big',intent:'',html:'🐚'.repeat(40000)},founder),e=>e.code==='TOO_LARGE');
  await assert.rejects(applyAction(world,{type:'repair',creationId:world.creations[0].id,expectedVersion:1,html:'🐚'.repeat(40000)},founder),e=>e.code==='TOO_LARGE');
});

test('shared request receipts survive validation and repeated discoveries remain non-rewarding history',async()=>{
  const start=createWorld({id:'retry-world',now});
  const first=await applyAction(start,{type:'discover',locationId:'river'},witness,{now,requestId:'request-discover-1',actionFingerprint:'a'.repeat(64)});
  assert.deepEqual(first.result,{discovered:true});
  assert.equal(first.world.events[0].requestId,'request-discover-1');
  assert.deepEqual(first.world.events[0].actionResult,{discovered:true});
  const repeated=await applyAction(first.world,{type:'discover',locationId:'river'},witness,{now:'2026-10-17T12:00:01.000Z',requestId:'request-discover-2',actionFingerprint:'b'.repeat(64)});
  assert.deepEqual(repeated.result,{discovered:false});
  assert.equal(repeated.world.discoveries.length,1);
  assert.equal(repeated.world.xp,0);
  assert.equal(repeated.world.events.length,2);
  assert.equal(repeated.world.events[1].repeat,true);
  assert.deepEqual(repeated.world.events[1].actionResult,{discovered:false});
  assert.equal(await validateWorld(repeated.world).then(()=>true),true);
  const duplicate=structuredClone(repeated.world);duplicate.events[1].requestId=duplicate.events[0].requestId;
  await assert.rejects(validateWorld(duplicate),e=>e.code==='INVALID_WORLD');
});

test('strict timestamp validation rejects loose dates and preserves valid offset timestamps', () => {
  assert.equal(isStrictTimestamp('2026-10-28T17:00:00.000Z'), true);
  assert.equal(isStrictTimestamp('2026-10-27T00:30:00-02:00'), true);
  for (const value of [
    '1', '2026-10-28', '2026-10-28T17:00:00.000',
    '2026-02-30T17:00:00.000Z', '2026-13-01T17:00:00.000Z',
    '2026-10-28T25:00:00Z', 'October 28, 2026'
  ]) assert.equal(isStrictTimestamp(value), false, value);
});

test('world validation rejects loose root and event timestamps even when Date.parse orders them', async () => {
  const start = createWorld({id:'strict-time-world', now});
  const malformedRoot = structuredClone(start);
  malformedRoot.createdAt = '2026-10-17';
  malformedRoot.updatedAt = '2026-10-17';
  await assert.rejects(validateWorld(malformedRoot), error => error.code === 'INVALID_WORLD');

  const discovered = await applyAction(start, {type:'discover', locationId:'river'}, witness, {now:'2026-10-17T12:00:01.000Z'});
  const malformedEvent = structuredClone(discovered.world);
  malformedEvent.events[0].at = '2026-10-18';
  malformedEvent.discoveries[0].at = malformedEvent.events[0].at;
  malformedEvent.updatedAt = malformedEvent.events[0].at;
  await assert.rejects(validateWorld(malformedEvent), error => error.code === 'INVALID_WORLD');
});


test('large interleaved Moonshot history preserves exact proposal/report pairing', async () => {
  const world = createWorld({ id: 'indexed-history-world', now: '2026-10-01T00:00:00.000Z' });
  const actor = { id: 'history-witness', name: 'History witness', role: 'witness' };
  const events = [];
  const origin = Date.parse(world.createdAt);
  for (let index = 0; index < 1200; index += 1) {
    const moonshotId = `moonshot-${index}`;
    const proposalAt = new Date(origin + index * 2000 + 1).toISOString();
    const reportAt = new Date(origin + index * 2000 + 1001).toISOString();
    events.push({
      id: `proposal-event-${index}`, type: 'moonshot-proposed', actor, at: proposalAt,
      semantics: 'Research proposal only; not executed.', moonshotId,
      title: 'Bounded proposal', hypothesis: 'A falsifiable hypothesis',
      falsifier: 'An observable counterexample', evidenceNeeded: 'A retained source',
      sourceCreationId: null, sourceVersion: null
    });
    events.push({
      id: `report-event-${index}`, type: 'experiment-reported', actor, at: reportAt,
      semantics: 'Self-reported attempt; not adjudicated.', reportId: `report-${index}`,
      moonshotId, procedure: 'Repeat the stated procedure', observation: 'Record what occurred',
      reportedOutcome: 'inconclusive', evidenceCreationId: null, evidenceVersion: null
    });
  }
  world.events = events;
  world.revision = events.length;
  world.updatedAt = events.at(-1).at;
  assert.equal(await validateWorld(world).then(() => true), true);
});

test('Source Observatory notes are actor-attributed, version-bound, idempotent and non-rewarding',async()=>{
  const start=createWorld({id:'source-observation-world',now});
  const draft=await applyAction(start,{type:'draft',kind:'observatory',title:'Source Observatory',intent:'Record a falsifiable claim with its source.'},founder,{now});
  const published=await applyAction(draft.world,{type:'publish',draftId:draft.result.draftId,expectedVersion:0},founder,{now:'2026-10-17T12:00:01.000Z'});
  const creationId=published.result.creationId;
  const note={claim:'The model says the bridge is open.',sourceKind:'model-assertion',source:'A model response; no external source retrieved.',falsifier:'Independent inspection finds it closed.',uncertainty:'No independent observation yet.',nextTest:'Inspect the primary source directly.'};
  const digest=createHash('sha256').update(sourceObservationRequestMaterial({actorId:founder.id,actorRole:founder.role,creationId,version:1,...note})).digest('hex');
  const observationId='source-observation-'+digest;
  const action={type:'record-source-observation',creationId,version:1,observationId,...note};
  const recorded=await applyAction(published.world,action,founder,{now:'2026-10-17T12:00:02.000Z',requestId:observationId,actionFingerprint:'c'.repeat(64)});
  assert.deepEqual(recorded.result,{observationId,duplicate:false});
  assert.equal(recorded.world.xp,published.world.xp);
  const event=recorded.world.events.at(-1);
  assert.equal(event.type,'source-observation-recorded');
  assert.equal(event.actor.id,founder.id);
  assert.equal(event.actor.role,'founder');
  assert.equal(event.bindingMode,'USER_SELECTED');
  assert.equal(event.sourceRetrieval,'NOT_PERFORMED');
  assert.equal(event.independentVerification,'NOT_PERFORMED');
  assert.equal(event.modelAssertions,'LEADS_ONLY');
  assert.equal(event.execution,'NOT_EXECUTED');
  assert.equal(event.requestId,observationId);
  assert.deepEqual(event.actionResult,{observationId,duplicate:false});
  await validateWorld(recorded.world);
  const revision=recorded.world.revision;
  const duplicate=await applyAction(recorded.world,action,founder,{now:'2026-10-17T12:00:03.000Z'});
  assert.deepEqual(duplicate.result,{observationId,duplicate:true});
  assert.equal(duplicate.world,recorded.world);
  assert.equal(duplicate.world.revision,revision);
  assert.equal(duplicate.world.events.filter(item=>item.type==='source-observation-recorded').length,1);
  const tampered=structuredClone(recorded.world);
  tampered.events.at(-1).bindingMode='INDEPENDENTLY_VERIFIED';
  await assert.rejects(validateWorld(tampered));
  await assert.rejects(applyAction(recorded.world,{...action,observationId:'source-observation-'+'0'.repeat(64)},founder,{now:'2026-10-17T12:00:04.000Z'}),error=>error.code==='INVALID_SOURCE_OBSERVATION_ID');
  await assert.rejects(applyAction(recorded.world,{...action,version:2},founder,{now:'2026-10-17T12:00:04.000Z'}),error=>error.code==='STALE_VERSION');
  await assert.rejects(applyAction(recorded.world,{...action,sourceKind:'authority'},founder,{now:'2026-10-17T12:00:04.000Z'}),error=>error.code==='INVALID_SOURCE_KIND');
});


test('world imports revalidate collaborator source records and response bytes instead of trusting recomputable receipts',async()=>{
  const start=createWorld({id:'collaborator-import-world',now});
  const proposal=await applyAction(start,{
    type:'propose-moonshot',title:'Bounded import test',hypothesis:'A retained report can be checked.',
    falsifier:'A source record does not match the packet.',evidenceNeeded:'The exact earlier event bytes.'
  },witness,{now:'2026-10-17T12:00:01.000Z'});
  const report=await applyAction(proposal.world,{
    type:'report-experiment',moonshotId:proposal.result.moonshotId,
    procedure:'Run one bounded attempt.',observation:'The expected result did not occur.',
    reportedOutcome:'failed'
  },witness,{now:'2026-10-17T12:00:02.000Z'});
  const packet=projectCollaboratorPackets(publicWorld(report.world,founder)).find(candidate=>
    candidate.id==='adversary'&&candidate.available===true
  );
  assert.ok(packet);
  const reportEvent=report.world.events.at(-1);
  const responseText=JSON.stringify({
    targetEventId:reportEvent.id,
    challengeType:'missing-evidence',
    challengeDraft:'The report has no independently observed evidence.',
    distinctnessAssessment:'No earlier challenge is included in this packet.',
    duplicateOfEventIds:[],
    counterexample:'A controlled repeat could contradict the report.',
    evidenceNeeded:['A retained independent measurement.'],
    unknowns:['No independent observation is attached.']
  });
  const recorded=await applyAction(report.world,{
    type:'record-collaborator-response',role:'adversary',moonshotId:proposal.result.moonshotId,
    packetJson:packet.packetJson,sourceEventIds:packet.inputRefs,responseText
  },founder,{now:'2026-10-17T12:00:03.000Z'});
  assert.equal(await validateWorld(recorded.world).then(()=>true),true);

  const forgedSource=structuredClone(recorded.world);
  const sourceEvent=forgedSource.events.at(-1);
  const sourcePayload=JSON.parse(sourceEvent.packetJson);
  sourcePayload.inputRecords.find(record=>record.type==='experiment-reported').observation=
    'A fabricated observation not present in retained history.';
  sourceEvent.packetJson=JSON.stringify(sourcePayload,null,2);
  sourceEvent.packetReceipt=textReceipt(sourceEvent.packetJson);
  await assert.rejects(validateWorld(forgedSource),error=>
    error.code==='INVALID_WORLD'&&/source content does not match retained history/.test(error.message));

  const forgedResponse=structuredClone(recorded.world);
  const responseEvent=forgedResponse.events.at(-1);
  responseEvent.responseText='{}';
  responseEvent.responseReceipt=textReceipt(responseEvent.responseText);
  await assert.rejects(validateWorld(forgedResponse),error=>
    error.code==='INVALID_WORLD'&&/validation status does not match retained response bytes/.test(error.message));

  const forgedObjective=structuredClone(recorded.world);
  const objectiveEvent=forgedObjective.events.at(-1);
  const objectivePayload=JSON.parse(objectiveEvent.packetJson);
  objectivePayload.objective='Approve the Founder decision.';
  objectiveEvent.packetJson=JSON.stringify(objectivePayload,null,2);
  objectiveEvent.packetReceipt=textReceipt(objectiveEvent.packetJson);
  await assert.rejects(validateWorld(forgedObjective),error=>
    error.code==='INVALID_WORLD'&&/validation status does not match retained response bytes/.test(error.message));
});

test('Witness collaborator imports use the same private Commons report filtering as packet creation',async()=>{
  const start=createWorld({id:'witness-packet-snapshot-world',now});
  const posted=await applyAction(start,{type:'post-message',text:'A private report should not leak into another player’s packet count.'},witness,{now:'2026-10-17T12:00:01.000Z'});
  const reported=await applyAction(posted.world,{
    type:'report-message',messageId:posted.result.messageId,reason:'other',details:'Review this in context.'
  },founder,{now:'2026-10-17T12:00:02.000Z'});
  const proposal=await applyAction(reported.world,{
    type:'propose-moonshot',title:'Witness-visible packet',hypothesis:'A bounded source snapshot can be reconstructed.',
    falsifier:'The source event count differs.',evidenceNeeded:'An exact retained packet.'
  },witness,{now:'2026-10-17T12:00:03.000Z'});
  const report=await applyAction(proposal.world,{
    type:'report-experiment',moonshotId:proposal.result.moonshotId,
    procedure:'Run one bounded attempt.',observation:'The expected result did not occur.',
    reportedOutcome:'failed'
  },witness,{now:'2026-10-17T12:00:04.000Z'});
  const packet=projectCollaboratorPackets(publicWorld(report.world,witness)).find(candidate=>
    candidate.id==='adversary'&&candidate.available===true
  );
  assert.ok(packet);
  const reportEvent=report.world.events.at(-1);
  const responseText=JSON.stringify({
    targetEventId:reportEvent.id,
    challengeType:'missing-evidence',
    challengeDraft:'The report has no independently observed evidence.',
    distinctnessAssessment:'No earlier challenge is included in this packet.',
    duplicateOfEventIds:[],
    counterexample:'A controlled repeat could contradict the report.',
    evidenceNeeded:['A retained independent measurement.'],
    unknowns:['No independent observation is attached.']
  });
  const recorded=await applyAction(report.world,{
    type:'record-collaborator-response',role:'adversary',moonshotId:proposal.result.moonshotId,
    packetJson:packet.packetJson,sourceEventIds:packet.inputRefs,responseText
  },witness,{now:'2026-10-17T12:00:05.000Z'});
  assert.equal(JSON.parse(packet.packetJson).sourceSnapshot.revision,4);
  assert.equal(JSON.parse(packet.packetJson).sourceSnapshot.suppliedEventCount,3);
  await validateWorld(recorded.world);
});

test('Source Observation challenges preserve attributed dissent without changing the original note, XP, or authority',async()=>{
  const start=createWorld({id:'source-observation-challenge-world',now});
  const draft=await applyAction(start,{type:'draft',kind:'observatory',title:'Source Observatory',intent:'Retain a falsifiable research note.'},founder,{now});
  const published=await applyAction(draft.world,{type:'publish',draftId:draft.result.draftId,expectedVersion:0},founder,{now:'2026-10-17T12:00:01.000Z'});
  const creationId=published.result.creationId;
  const note={claim:'The bridge is open.',sourceKind:'model-assertion',source:'A model response; no source retrieved.',falsifier:'Direct inspection finds the bridge closed.',uncertainty:'No independent observation.',nextTest:'Inspect the primary source.'};
  const digest=createHash('sha256').update(sourceObservationRequestMaterial({actorId:founder.id,actorRole:founder.role,creationId,version:1,...note})).digest('hex');
  const observationId='source-observation-'+digest;
  const recorded=await applyAction(published.world,{type:'record-source-observation',creationId,version:1,observationId,...note},founder,{now:'2026-10-17T12:00:02.000Z',requestId:observationId,actionFingerprint:'c'.repeat(64)});
  const beforeXp=recorded.world.xp;
  const challenged=await applyAction(recorded.world,{type:'challenge-source-observation',observationId,challengeType:'contradiction',challengeText:'The note cites a model assertion but identifies no retrievable primary source.'},witness,{now:'2026-10-17T12:00:03.000Z',requestId:'source-challenge-1',actionFingerprint:'d'.repeat(64)});
  const event=challenged.world.events.at(-1);
  assert.equal(event.type,'source-observation-challenged');
  assert.equal(event.actor.id,witness.id);
  assert.equal(event.actor.role,'witness');
  assert.equal(event.observationId,observationId);
  assert.equal(event.creationId,creationId);
  assert.equal(event.version,1);
  assert.equal(event.challengeType,'contradiction');
  assert.equal(event.challengeText,'The note cites a model assertion but identifies no retrievable primary source.');
  assert.deepEqual(challenged.result,{challengeId:event.challengeId});
  assert.equal(challenged.world.xp,beforeXp);
  assert.equal(challenged.world.events.filter(item=>item.type==='source-observation-recorded').length,1);
  await validateWorld(challenged.world);
  const responseAction={type:'respond-source-observation-challenge',challengeId:event.challengeId,responseText:'The note is a lead only; source retrieval remains outstanding.'};
  const responded=await applyAction(challenged.world,responseAction,founder,{now:'2026-10-17T12:00:04.000Z',requestId:'source-response-1',actionFingerprint:'e'.repeat(64)});
  const response=responded.world.events.at(-1);
  assert.equal(response.type,'source-observation-challenge-responded');
  assert.equal(response.actor.id,founder.id);
  assert.equal(response.challengeId,event.challengeId);
  assert.equal(response.observationId,observationId);
  assert.equal(response.creationId,creationId);
  assert.equal(response.version,1);
  assert.equal(response.responseText,responseAction.responseText);
  assert.deepEqual(response.actionResult,{responseId:response.responseId});
  assert.equal(responded.world.xp,beforeXp);
  assert.equal(responded.world.events.filter(item=>item.type==='source-observation-challenge-responded').length,1);
  await validateWorld(responded.world);
  await assert.rejects(applyAction(challenged.world,responseAction,witness,{now:'2026-10-17T12:00:04.000Z'}),error=>error.code==='FORBIDDEN'&&error.status===403);
  await assert.rejects(applyAction(responded.world,responseAction,founder,{now:'2026-10-17T12:00:05.000Z'}),error=>error.code==='CHALLENGE_ALREADY_ANSWERED'&&error.status===409);
  const tamperedResponse=structuredClone(responded.world);
  tamperedResponse.events.at(-1).actor=witness;
  await assert.rejects(validateWorld(tamperedResponse),error=>error.code==='INVALID_WORLD');
  await assert.rejects(applyAction(challenged.world,{type:'challenge-source-observation',observationId,challengeType:'other',challengeText:'Self-challenge.'},founder,{now:'2026-10-17T12:00:04.000Z'}),error=>error.code==='SELF_CHALLENGE');
  await assert.rejects(applyAction(challenged.world,{type:'challenge-source-observation',observationId:'missing-observation',challengeType:'other',challengeText:'No target.'},witness,{now:'2026-10-17T12:00:04.000Z'}),error=>error.code==='NOT_FOUND');
  const tampered=structuredClone(challenged.world);
  tampered.events.at(-1).version=2;
  await assert.rejects(validateWorld(tampered));

  const proposal=await applyAction(responded.world,{
    type:'propose-moonshot',title:'A bounded test',hypothesis:'A source can be inspected.',
    falsifier:'The source cannot be retrieved.',evidenceNeeded:'A retained primary-source capture.'
  },founder,{now:'2026-10-17T12:00:05.000Z'});
  const report=await applyAction(proposal.world,{
    type:'report-experiment',moonshotId:proposal.result.moonshotId,
    procedure:'Attempt a bounded retrieval.',observation:'The outcome remains inconclusive.',
    reportedOutcome:'inconclusive'
  },founder,{now:'2026-10-17T12:00:06.000Z'});
  const malformed=structuredClone(report.world);
  malformed.events.push({
    id:'cross-kind-challenge-test',type:'experiment-challenged',actor:witness,
    at:'2026-10-17T12:00:07.000Z',semantics:'Attributed challenge; not adjudicated.',
    challengeId:event.challengeId,reportId:report.result.reportId,
    moonshotId:proposal.result.moonshotId,challengeType:'contradiction',
    challengeText:'This challenge must have a unique identity.',
    evidenceCreationId:null,evidenceVersion:null
  });
  malformed.revision+=1;
  malformed.updatedAt='2026-10-17T12:00:07.000Z';
  await assert.rejects(validateWorld(malformed),error=>error.code==='INVALID_WORLD');
});


test('Forge creates actor-owned source-bound field items and reversible equipment without XP',async()=>{
  const discovered=await applyAction(createWorld({id:'forge-inventory-world',now}),{
    type:'discover',locationId:'river'
  },witness,{now});
  const source=discovered.world.events.find(item=>item.type==='discover'&&item.actor.id===witness.id);
  assert.ok(source);
  const beforeXp=discovered.world.xp;
  const forged=await applyAction(discovered.world,{
    type:'forge-field-item',slotId:'scouting',sourceEventId:source.id
  },witness,{now:'2026-10-17T12:00:01.000Z',requestId:'forge-river-item',actionFingerprint:'f'.repeat(64)});
  const forgeEvent=forged.world.events.at(-1);
  assert.equal(forgeEvent.type,'field-item-forged');
  assert.equal(forgeEvent.actor.id,witness.id);
  assert.equal(forgeEvent.slotId,'scouting');
  assert.equal(forgeEvent.sourceEventId,source.id);
  assert.deepEqual(forged.result,{itemId:forgeEvent.itemId,slotId:'scouting',sourceEventId:source.id});
  assert.equal(forged.world.xp,beforeXp,'forging is not XP');
  await validateWorld(forged.world);

  const beforeProjection=structuredClone(forged.world);
  const record=projectCharacter(forged.world,witness);
  assert.deepEqual(forged.world,beforeProjection,'character projection is read-only');
  assert.equal(record.fieldInventory.length,1);
  assert.equal(record.fieldInventory[0].eventId,forgeEvent.id);
  assert.equal(record.fieldInventory[0].sourceEventId,source.id);
  assert.equal(record.fieldInventory[0].ownerId,witness.id);
  assert.equal(record.skills.find(skill=>skill.id==='forger').count,1);
  assert.equal(projectCharacter(forged.world,founder).fieldInventory.length,0,'items never cross actor boundaries');

  const equipped=await applyAction(forged.world,{
    type:'equip-field-item',slotId:'scouting',sourceEventId:forgeEvent.id
  },witness,{now:'2026-10-17T12:00:02.000Z'});
  assert.equal(equipped.world.xp,beforeXp,'equipping is not XP');
  const equippedRecord=projectCharacter(equipped.world,witness);
  assert.equal(equippedRecord.equipment.find(slot=>slot.id==='scouting').source.eventId,forgeEvent.id);
  assert.equal(equippedRecord.skills.find(skill=>skill.id==='armor-bearer').count,1);

  const unequipped=await applyAction(equipped.world,{
    type:'unequip-field-item',slotId:'scouting'
  },witness,{now:'2026-10-17T12:00:03.000Z'});
  const finalRecord=projectCharacter(unequipped.world,witness);
  assert.equal(finalRecord.equipment.find(slot=>slot.id==='scouting').source,null);
  assert.equal(finalRecord.skills.find(skill=>skill.id==='armor-bearer').count,0);
  assert.equal(unequipped.world.xp,beforeXp,'unequipping is not XP');

  await assert.rejects(
    applyAction(discovered.world,{type:'forge-field-item',slotId:'provenance',sourceEventId:source.id},witness,{now:'2026-10-17T12:00:01.000Z'}),
    error=>error.code==='INVALID_FIELD_ITEM_SOURCE'
  );
  await assert.rejects(
    applyAction(discovered.world,{type:'forge-field-item',slotId:'scouting',sourceEventId:source.id},founder,{now:'2026-10-17T12:00:01.000Z'}),
    error=>error.code==='INVALID_FIELD_ITEM_SOURCE'
  );
  await assert.rejects(
    applyAction(forged.world,{type:'forge-field-item',slotId:'scouting',sourceEventId:source.id},witness,{now:'2026-10-17T12:00:04.000Z'}),
    error=>error.code==='FIELD_ITEM_ALREADY_FORGED'
  );
  await assert.rejects(
    applyAction(forged.world,{type:'equip-field-item',slotId:'provenance',sourceEventId:forgeEvent.id},witness,{now:'2026-10-17T12:00:04.000Z'}),
    error=>error.code==='INVALID_EQUIPMENT_SOURCE'
  );
});

test('world validation rejects field-item unequip without an active actor-slot selection',async()=>{
  const discovered=await applyAction(createWorld({id:'forge-unequip-validation-world',now}),{
    type:'discover',locationId:'river'
  },witness,{now});
  const source=discovered.world.events.at(-1);
  const forged=await applyAction(discovered.world,{
    type:'forge-field-item',slotId:'scouting',sourceEventId:source.id
  },witness,{now:'2026-10-17T12:00:01.000Z'});
  const item=forged.world.events.at(-1);
  const equipped=await applyAction(forged.world,{
    type:'equip-field-item',slotId:'scouting',sourceEventId:item.id
  },witness,{now:'2026-10-17T12:00:02.000Z'});

  const repeatedEquip=structuredClone(equipped.world);
  const repeatedEquipEvent=structuredClone(repeatedEquip.events.at(-1));
  repeatedEquipEvent.id='repeated-field-item-equip';
  repeatedEquipEvent.at='2026-10-17T12:00:03.000Z';
  repeatedEquip.events.push(repeatedEquipEvent);
  repeatedEquip.revision=repeatedEquip.events.length;
  repeatedEquip.updatedAt=repeatedEquipEvent.at;
  await assert.rejects(validateWorld(repeatedEquip),error=>error.code==='INVALID_WORLD',
    'the same field item cannot be equipped twice without an intervening unequip');

  const unequipped=await applyAction(equipped.world,{
    type:'unequip-field-item',slotId:'scouting'
  },witness,{now:'2026-10-17T12:00:03.000Z'});

  const orphaned=structuredClone(unequipped.world);
  orphaned.events=orphaned.events.filter(event=>event.type!=='field-item-equipped');
  orphaned.revision=orphaned.events.length;
  orphaned.updatedAt=orphaned.events.at(-1).at;
  await assert.rejects(validateWorld(orphaned),error=>error.code==='INVALID_WORLD',
    'an unequip event cannot outlive the earlier equipment selection it removes');

  const foreignActor=structuredClone(unequipped.world);
  const foreignEvent=structuredClone(foreignActor.events.at(-1));
  foreignEvent.id='foreign-actor-unequip';
  foreignEvent.actor=founder;
  foreignEvent.at='2026-10-17T12:00:04.000Z';
  foreignActor.events.push(foreignEvent);
  foreignActor.revision=foreignActor.events.length;
  foreignActor.updatedAt=foreignEvent.at;
  await assert.rejects(validateWorld(foreignActor),error=>error.code==='INVALID_WORLD',
    'an actor cannot unequip another actor-slot history');

  const repeated=structuredClone(unequipped.world);
  const repeatedEvent=structuredClone(repeated.events.at(-1));
  repeatedEvent.id='repeated-field-item-unequip';
  repeatedEvent.at='2026-10-17T12:00:04.000Z';
  repeated.events.push(repeatedEvent);
  repeated.revision=repeated.events.length;
  repeated.updatedAt=repeatedEvent.at;
  await assert.rejects(validateWorld(repeated),error=>error.code==='INVALID_WORLD',
    'an already-empty slot cannot be unequipped again');
});

test('Forge transfers require shared mode, recipient acceptance, immutable creator provenance and no XP',async()=>{
  const discovered=await applyAction(createWorld({id:'forge-transfer-world',now}),{
    type:'discover',locationId:'river'
  },witness,{now});
  const source=discovered.world.events.at(-1);
  const forged=await applyAction(discovered.world,{
    type:'forge-field-item',slotId:'scouting',sourceEventId:source.id
  },witness,{now:'2026-10-17T12:00:01.000Z'});
  const forgeEvent=forged.world.events.at(-1),beforeXp=forged.world.xp;
  const offerAction={
    type:'offer-field-item-transfer',itemEventId:forgeEvent.id,
    recipientId:founder.id,recipientRole:founder.role
  };
  await assert.rejects(
    applyAction(forged.world,offerAction,witness,{now:'2026-10-17T12:00:02.000Z'}),
    error=>error.code==='TRANSFER_REQUIRES_SHARED_WORLD'
  );
  await assert.rejects(
    applyAction(forged.world,{...offerAction,recipientId:witness.id,recipientRole:witness.role},witness,{
      now:'2026-10-17T12:00:02.000Z',allowTransfers:true
    }),
    error=>error.code==='TRANSFER_TO_SELF'
  );
  const offered=await applyAction(forged.world,offerAction,witness,{
    now:'2026-10-17T12:00:02.000Z',allowTransfers:true,
    requestId:'field-offer-one',actionFingerprint:'a'.repeat(64)
  });
  const offerEvent=offered.world.events.at(-1);
  assert.equal(offerEvent.type,'field-item-transfer-offered');
  assert.equal(offerEvent.actor.id,witness.id);
  assert.equal(offerEvent.recipientId,founder.id);
  assert.equal(offered.world.xp,beforeXp);
  const senderRecord=projectCharacter(offered.world,witness);
  const recipientRecord=projectCharacter(offered.world,founder);
  assert.equal(senderRecord.fieldInventory.length,1);
  assert.equal(senderRecord.fieldInventory[0].transferOffer.offerId,offerEvent.offerId);
  assert.equal(recipientRecord.fieldInventory.length,0);
  assert.equal(recipientRecord.fieldItemTransferOffers[0].offerId,offerEvent.offerId);
  await assert.rejects(
    applyAction(offered.world,{type:'accept-field-item-transfer',offerId:offerEvent.offerId},witness,{
      now:'2026-10-17T12:00:03.000Z',allowTransfers:true
    }),
    error=>error.code==='FIELD_ITEM_TRANSFER_NOT_ADDRESSED'
  );
  await assert.rejects(
    applyAction(offered.world,{type:'equip-field-item',slotId:'scouting',sourceEventId:forgeEvent.id},witness,{
      now:'2026-10-17T12:00:03.000Z'
    }),
    error=>error.code==='FIELD_ITEM_TRANSFER_PENDING'
  );
  await assert.rejects(
    applyAction(offered.world,{type:'cancel-field-item-transfer',offerId:offerEvent.offerId},founder,{
      now:'2026-10-17T12:00:03.000Z',allowTransfers:true
    }),
    error=>error.code==='FIELD_ITEM_TRANSFER_NOT_CANCELLABLE'
  );
  const cancelled=await applyAction(offered.world,{
    type:'cancel-field-item-transfer',offerId:offerEvent.offerId
  },witness,{
    now:'2026-10-17T12:00:03.000Z',allowTransfers:true,
    requestId:'field-cancel-one',actionFingerprint:'b'.repeat(64)
  });
  await validateWorld(cancelled.world);
  await assert.rejects(
    applyAction(cancelled.world,{type:'accept-field-item-transfer',offerId:offerEvent.offerId},founder,{
      now:'2026-10-17T12:00:04.000Z',allowTransfers:true
    }),
    error=>error.code==='FIELD_ITEM_TRANSFER_NOT_ADDRESSED'
  );
  const offeredAgain=await applyAction(cancelled.world,offerAction,witness,{
    now:'2026-10-17T12:00:04.000Z',allowTransfers:true,
    requestId:'field-offer-two',actionFingerprint:'c'.repeat(64)
  });
  const secondOffer=offeredAgain.world.events.at(-1);
  const accepted=await applyAction(offeredAgain.world,{
    type:'accept-field-item-transfer',offerId:secondOffer.offerId
  },founder,{
    now:'2026-10-17T12:00:05.000Z',allowTransfers:true,
    requestId:'field-accept-one',actionFingerprint:'d'.repeat(64)
  });
  const transferEvent=accepted.world.events.at(-1);
  assert.equal(transferEvent.type,'field-item-transferred');
  assert.equal(transferEvent.actor.id,founder.id);
  assert.equal(transferEvent.fromActorId,witness.id);
  assert.equal(transferEvent.itemEventId,forgeEvent.id);
  assert.equal(accepted.world.xp,beforeXp,'offering and accepting are not XP');
  await validateWorld(accepted.world);
  const witnessAfter=projectCharacter(accepted.world,witness);
  const founderAfter=projectCharacter(accepted.world,founder);
  assert.equal(witnessAfter.fieldInventoryTotal,0);
  assert.equal(founderAfter.fieldInventoryTotal,1);
  assert.equal(founderAfter.fieldInventory[0].creatorId,witness.id);
  assert.equal(founderAfter.fieldInventory[0].ownerId,founder.id);
  assert.equal(founderAfter.fieldInventory[0].sourceEventId,source.id);
  assert.equal(witnessAfter.skills.find(skill=>skill.id==='forger').count,1,
    'the original creator skill remains after transfer');
  assert.equal(founderAfter.skills.find(skill=>skill.id==='forger').count,0,
    'receiving an item does not count as forging');
  assert.equal(founderAfter.fieldItemTransferOffers.length,0);
  const equipped=await applyAction(accepted.world,{
    type:'equip-field-item',slotId:'scouting',sourceEventId:forgeEvent.id
  },founder,{now:'2026-10-17T12:00:06.000Z'});
  await assert.rejects(
    applyAction(equipped.world,{...offerAction,recipientId:witness.id,recipientRole:witness.role},founder,{
      now:'2026-10-17T12:00:07.000Z',allowTransfers:true
    }),
    error=>error.code==='FIELD_ITEM_EQUIPPED'
  );
  const unequipped=await applyAction(equipped.world,{type:'unequip-field-item',slotId:'scouting'},founder,{
    now:'2026-10-17T12:00:07.000Z'
  });
  const returnedOffer=await applyAction(unequipped.world,{
    type:'offer-field-item-transfer',itemEventId:forgeEvent.id,
    recipientId:witness.id,recipientRole:witness.role
  },founder,{now:'2026-10-17T12:00:08.000Z',allowTransfers:true});
  const returned=await applyAction(returnedOffer.world,{
    type:'accept-field-item-transfer',offerId:returnedOffer.result.offerId
  },witness,{now:'2026-10-17T12:00:09.000Z',allowTransfers:true});
  await validateWorld(returned.world);
  const returnedRecord=projectCharacter(returned.world,witness);
  assert.equal(returnedRecord.fieldInventory[0].ownerId,witness.id);
  assert.equal(returnedRecord.fieldInventory[0].creatorId,witness.id);
  assert.equal(returnedRecord.fieldInventory[0].sourceEventId,source.id);
  assert.equal(returned.world.xp,beforeXp,'a complete transfer chain grants no XP');
});


test('Forge transfer acceptance enforces the recipient inventory cap before ownership changes',async()=>{
  let fullWorld=(await publish(createWorld({id:'forge-transfer-capacity-world',now}))).world;
  const creation=fullWorld.creations[0];
  const baseTime=Date.parse(now);
  for(let index=0;index<100;index++){
    const noteAt=new Date(baseTime+1000+index*2000).toISOString();
    const forgeAt=new Date(baseTime+2000+index*2000).toISOString();
    const noted=await applyAction(fullWorld,{
      type:'contribute',creationId:creation.id,version:1,text:'Bounded capacity note '+index
    },founder,{now:noteAt});
    const source=noted.world.events.at(-1);
    const forged=await applyAction(noted.world,{
      type:'forge-field-item',slotId:'observation',sourceEventId:source.id
    },founder,{now:forgeAt});
    fullWorld=forged.world;
  }
  assert.equal(projectCharacter(fullWorld,founder).fieldInventoryTotal,100);
  const discovered=await applyAction(fullWorld,{type:'discover',locationId:'river'},witness,{
    now:new Date(baseTime+202000).toISOString()
  });
  const source=discovered.world.events.at(-1);
  const forged=await applyAction(discovered.world,{
    type:'forge-field-item',slotId:'scouting',sourceEventId:source.id
  },witness,{now:new Date(baseTime+203000).toISOString()});
  const item=forged.world.events.at(-1);
  const offered=await applyAction(forged.world,{
    type:'offer-field-item-transfer',itemEventId:item.id,
    recipientId:founder.id,recipientRole:founder.role
  },witness,{now:new Date(baseTime+204000).toISOString(),allowTransfers:true});
  await validateWorld(offered.world);
  await assert.rejects(
    applyAction(offered.world,{
      type:'accept-field-item-transfer',offerId:offered.result.offerId
    },founder,{now:new Date(baseTime+205000).toISOString(),allowTransfers:true}),
    error=>error.code==='FIELD_INVENTORY_FULL'
  );
  assert.equal(projectCharacter(offered.world,founder).fieldInventoryTotal,100,
    'a rejected acceptance leaves the recipient inventory unchanged');
  assert.equal(projectCharacter(offered.world,witness).fieldInventoryTotal,1,
    'the offerer retains ownership until recipient acceptance commits');
  assert.equal(offered.world.events.filter(event=>event.type==='field-item-transferred').length,0);
});
