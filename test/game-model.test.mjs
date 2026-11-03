import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWorld, applyAction, publicWorld, validateWorld} from '../game/model.mjs';
import {isStrictTimestamp} from '../game/timestamps.mjs';
import {sourceObservationRequestMaterial} from '../game/research-records.mjs';

const founder={id:'founder-1',name:'Damien',role:'founder'};
const witness={id:'witness-1',name:'River reader',role:'witness'};
const now='2026-10-17T12:00:00.000Z';
async function publish(world, kind='loom') {
  const draft=await applyAction(world,{type:'draft',kind,title:'A living loom 🧶',intent:'Make marks audible.'},founder,{now});
  return applyAction(draft.world,{type:'publish',draftId:draft.result.draftId,expectedVersion:0},founder,{now});
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
  await assert.rejects(applyAction(challenged.world,{type:'challenge-source-observation',observationId,challengeType:'other',challengeText:'Self-challenge.'},founder,{now:'2026-10-17T12:00:04.000Z'}),error=>error.code==='SELF_CHALLENGE');
  await assert.rejects(applyAction(challenged.world,{type:'challenge-source-observation',observationId:'missing-observation',challengeType:'other',challengeText:'No target.'},witness,{now:'2026-10-17T12:00:04.000Z'}),error=>error.code==='NOT_FOUND');
  const tampered=structuredClone(challenged.world);
  tampered.events.at(-1).version=2;
  await assert.rejects(validateWorld(tampered));

  const proposal=await applyAction(challenged.world,{
    type:'propose-moonshot',title:'A bounded test',hypothesis:'A source can be inspected.',
    falsifier:'The source cannot be retrieved.',evidenceNeeded:'A retained primary-source capture.'
  },founder,{now:'2026-10-17T12:00:04.000Z'});
  const report=await applyAction(proposal.world,{
    type:'report-experiment',moonshotId:proposal.result.moonshotId,
    procedure:'Attempt a bounded retrieval.',observation:'The outcome remains inconclusive.',
    reportedOutcome:'inconclusive'
  },founder,{now:'2026-10-17T12:00:05.000Z'});
  const malformed=structuredClone(report.world);
  malformed.events.push({
    id:'cross-kind-challenge-test',type:'experiment-challenged',actor:witness,
    at:'2026-10-17T12:00:06.000Z',semantics:'Attributed challenge; not adjudicated.',
    challengeId:event.challengeId,reportId:report.result.reportId,
    moonshotId:proposal.result.moonshotId,challengeType:'contradiction',
    challengeText:'This challenge must have a unique identity.',
    evidenceCreationId:null,evidenceVersion:null
  });
  malformed.revision+=1;
  malformed.updatedAt='2026-10-17T12:00:06.000Z';
  await assert.rejects(validateWorld(malformed),error=>error.code==='INVALID_WORLD');
});
