import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld, applyAction, publicWorld, validateWorld} from '../game/model.mjs';
import { validatePayload } from '../game/server.mjs';
import { projectResearchRecords } from '../game/research-records.mjs';
import {isStrictTimestamp} from '../game/timestamps.mjs';
import {projectCharacter} from '../game/character-sheet.mjs';
import {projectInstitutionRecordWorldObjects} from '../game/institution-record-objects.mjs';
import {PLACES} from '../game/world-view.mjs';

const founder={id:'founder-1',name:'Damien',role:'founder'};
const witness={id:'witness-1',name:'River reader',role:'witness'};
const now='2026-10-17T12:00:00.000Z';
async function publish(world, kind='loom', actor=founder) {
  const draft=await applyAction(world,{type:'draft',kind,title:'A living loom 🧶',intent:'Make marks audible.'},actor,{now});
  return applyAction(draft.world,{type:'publish',draftId:draft.result.draftId,expectedVersion:0},actor,{now});
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


test('Forge creates an actor-owned field item from one earlier retained source and equips that item without XP',async()=>{
  const discovered=await applyAction(createWorld({now}),{type:'discover',locationId:'river'},witness,{now});
  const source=discovered.world.events.find(event=>event.type==='discover'&&event.locationId==='river');
  const forged=await applyAction(discovered.world,{type:'forge-field-item',slotId:'scouting',sourceEventId:source.id},witness,{now:'2026-10-17T12:00:01.000Z'});
  const forgeEvent=forged.world.events.at(-1);
  assert.equal(forgeEvent.type,'field-item-forged');
  assert.deepEqual(forged.result,{itemId:forgeEvent.itemId,slotId:'scouting',sourceEventId:source.id});
  assert.equal(forged.world.xp,0,'forging a representation of existing work cannot award XP');
  await assert.doesNotReject(validateWorld(forged.world));

  const record=projectCharacter(forged.world,witness);
  const item=record.fieldInventory[0];
  assert.equal(record.fieldInventoryTotal,1);
  assert.equal(record.fieldInventoryOmittedCount,0);
  assert.equal(item.kind,'forged-field-item');
  assert.equal(item.eventId,forgeEvent.id);
  assert.equal(item.sourceEventId,source.id);
  assert.equal(item.ownerId,witness.id);
  assert.equal(record.skills.find(skill=>skill.id==='forger').count,1);
  const scouting=record.equipment.find(slot=>slot.id==='scouting');
  assert.equal(scouting.source.eventId,source.id,'forging does not silently equip an item');
  assert.ok(scouting.choices.some(choice=>choice.eventId===forgeEvent.id&&choice.kind==='forged-field-item'));

  const worldObjects=projectInstitutionRecordWorldObjects({world:forged.world,places:PLACES,isWalkable:()=>true});
  const forgeObject=worldObjects.objects.find(object=>object.entryId===forgeEvent.id);
  assert.equal(forgeObject.locationId,'forge','the Forge retains its own playable institutional record');

  const equipped=await applyAction(forged.world,{type:'equip-field-item',slotId:'scouting',sourceEventId:forgeEvent.id},witness,{now:'2026-10-17T12:00:02.000Z'});
  const equippedSlot=projectCharacter(equipped.world,witness).equipment.find(slot=>slot.id==='scouting');
  assert.equal(equippedSlot.mode,'pinned');
  assert.equal(equippedSlot.source.eventId,forgeEvent.id);
  assert.equal(equippedSlot.source.kind,'forged-field-item');
  assert.equal(equipped.world.xp,0,'equipping the forged item cannot award XP');
  await assert.doesNotReject(validateWorld(equipped.world));
});

test('Forge rejects wrong-slot, missing, foreign, reused and chained sources and rejects ambiguous imported ownership',async()=>{
  const discovered=await applyAction(createWorld({now}),{type:'discover',locationId:'river'},witness,{now});
  const source=discovered.world.events.find(event=>event.type==='discover');
  await assert.rejects(
    applyAction(discovered.world,{type:'forge-field-item',slotId:'provenance',sourceEventId:source.id},witness,{now}),
    error=>error.code==='INVALID_FIELD_ITEM_SOURCE'
  );
  await assert.rejects(
    applyAction(discovered.world,{type:'forge-field-item',slotId:'scouting',sourceEventId:source.id},founder,{now}),
    error=>error.code==='INVALID_FIELD_ITEM_SOURCE'
  );
  await assert.rejects(
    applyAction(discovered.world,{type:'forge-field-item',slotId:'scouting',sourceEventId:'missing-source'},witness,{now}),
    error=>error.code==='INVALID_FIELD_ITEM_SOURCE'
  );

  const forged=await applyAction(discovered.world,{type:'forge-field-item',slotId:'scouting',sourceEventId:source.id},witness,{now:'2026-10-17T12:00:01.000Z'});
  const forgeEvent=forged.world.events.at(-1);
  await assert.rejects(
    applyAction(forged.world,{type:'forge-field-item',slotId:'scouting',sourceEventId:source.id},witness,{now:'2026-10-17T12:00:02.000Z'}),
    error=>error.code==='FIELD_ITEM_ALREADY_FORGED'
  );
  await assert.rejects(
    applyAction(forged.world,{type:'forge-field-item',slotId:'scouting',sourceEventId:forgeEvent.id},witness,{now:'2026-10-17T12:00:02.000Z'}),
    error=>error.code==='INVALID_FIELD_ITEM_SOURCE'
  );

  const mismatched=structuredClone(forged.world);
  mismatched.events.at(-1).slotId='provenance';
  await assert.rejects(validateWorld(mismatched),error=>error.code==='INVALID_WORLD');

  const ambiguous=structuredClone(forged.world);
  ambiguous.events.push({
    ...forgeEvent,
    id:'field-forge-duplicate-event',
    itemId:'field-item-duplicate',
    at:'2026-10-17T12:00:02.000Z'
  });
  ambiguous.revision=ambiguous.events.length;
  ambiguous.updatedAt=ambiguous.events.at(-1).at;
  await assert.rejects(validateWorld(ambiguous),error=>error.code==='INVALID_WORLD');
});

test('field loadout choices are actor-owned, append-only, reversible, and XP-neutral',async()=>{
  const discovered=await applyAction(createWorld({now}),{type:'discover',locationId:'river'},witness,{now});
  const firstSource=discovered.world.events.find(event=>event.type==='discover'&&event.locationId==='river');
  const pinned=await applyAction(discovered.world,{type:'equip-field-item',slotId:'scouting',sourceEventId:firstSource.id},witness,{now,requestId:'field-equip-river',actionFingerprint:'a'.repeat(64)});
  assert.equal(pinned.world.events.at(-1).type,'field-item-equipped');
  assert.deepEqual(pinned.result,{slotId:'scouting',sourceEventId:firstSource.id});
  assert.equal(pinned.world.xp,0,'equipping cannot award XP');
  await assert.doesNotReject(validateWorld(pinned.world));
  let slot=projectCharacter(pinned.world,witness).equipment.find(item=>item.id==='scouting');
  assert.equal(slot.mode,'pinned');
  assert.equal(slot.source.eventId,firstSource.id);
  assert.ok(Object.isFrozen(slot.choices));

  const later=await applyAction(pinned.world,{type:'discover',locationId:'relay'},witness,{now});
  const secondSource=later.world.events.find(event=>event.type==='discover'&&event.locationId==='relay');
  slot=projectCharacter(later.world,witness).equipment.find(item=>item.id==='scouting');
  assert.equal(slot.source.eventId,firstSource.id,'a pinned source survives newer qualifying activity');
  assert.equal(slot.mode,'pinned');

  const reset=await applyAction(later.world,{type:'equip-field-item',slotId:'scouting',sourceEventId:null},witness,{now});
  slot=projectCharacter(reset.world,witness).equipment.find(item=>item.id==='scouting');
  assert.equal(slot.mode,'automatic');
  assert.equal(slot.source.eventId,secondSource.id,'reset returns to the newest qualifying source');
  assert.equal(reset.world.xp,0);
  await assert.doesNotReject(validateWorld(reset.world));

  const cleared=await applyAction(reset.world,{type:'unequip-field-item',slotId:'scouting'},witness,{
    now:'2026-10-17T12:00:01.000Z',requestId:'field-unequip-river',actionFingerprint:'c'.repeat(64)
  });
  assert.equal(cleared.world.events.at(-1).type,'field-item-unequipped');
  assert.deepEqual(cleared.result,{slotId:'scouting'});
  assert.equal(cleared.world.xp,0,'unequipping cannot award XP');
  slot=projectCharacter(cleared.world,witness).equipment.find(item=>item.id==='scouting');
  assert.equal(slot.mode,'unequipped');
  assert.equal(slot.status,'empty');
  assert.equal(slot.source,null);
  await assert.doesNotReject(validateWorld(cleared.world));

  const afterClearDiscovery=await applyAction(cleared.world,{type:'discover',locationId:'overlook'},witness,{now:'2026-10-17T12:00:02.000Z'});
  const laterSource=afterClearDiscovery.world.events.find(event=>event.type==='discover'&&event.locationId==='overlook');
  slot=projectCharacter(afterClearDiscovery.world,witness).equipment.find(item=>item.id==='scouting');
  assert.equal(slot.mode,'unequipped','new activity does not silently re-equip a cleared slot');
  assert.equal(slot.source,null);

  const autoAgain=await applyAction(afterClearDiscovery.world,{type:'equip-field-item',slotId:'scouting',sourceEventId:null},witness,{now:'2026-10-17T12:00:03.000Z'});
  slot=projectCharacter(autoAgain.world,witness).equipment.find(item=>item.id==='scouting');
  assert.equal(slot.mode,'automatic');
  assert.equal(slot.source.eventId,laterSource.id,'automatic selection resumes only after an explicit reset');
  await assert.doesNotReject(validateWorld(autoAgain.world));
});

test('field loadout rejects wrong slots, missing sources, cross-actor sources, and forged imported references',async()=>{
  const discovered=await applyAction(createWorld({now}),{type:'discover',locationId:'river'},witness,{now});
  const source=discovered.world.events.find(event=>event.type==='discover');
  await assert.rejects(applyAction(discovered.world,{type:'equip-field-item',slotId:'provenance',sourceEventId:source.id},witness,{now}),error=>error.code==='INVALID_EQUIPMENT_SOURCE');
  await assert.rejects(applyAction(discovered.world,{type:'equip-field-item',slotId:'scouting',sourceEventId:source.id},founder,{now}),error=>error.code==='INVALID_EQUIPMENT_SOURCE');
  await assert.rejects(applyAction(discovered.world,{type:'equip-field-item',slotId:'unknown',sourceEventId:null},witness,{now}),error=>error.code==='INVALID_EQUIPMENT_SLOT');
  await assert.rejects(applyAction(discovered.world,{type:'unequip-field-item',slotId:'unknown'},witness,{now}),error=>error.code==='INVALID_EQUIPMENT_SLOT');
  await assert.rejects(applyAction(discovered.world,{type:'equip-field-item',slotId:'scouting'},witness,{now}),error=>error.code==='INVALID_EQUIPMENT_SOURCE');
  const pinned=await applyAction(discovered.world,{type:'equip-field-item',slotId:'scouting',sourceEventId:source.id},witness,{now,requestId:'field-equip-tamper',actionFingerprint:'b'.repeat(64)});
  const forged=structuredClone(pinned.world);
  forged.events.at(-1).sourceEventId='missing-source';
  forged.events.at(-1).actionResult.sourceEventId='missing-source';
  await assert.rejects(validateWorld(forged),error=>error.code==='INVALID_WORLD');
  const forgedSlot=structuredClone(pinned.world);
  forgedSlot.events.at(-1).slotId='provenance';
  forgedSlot.events.at(-1).actionResult.slotId='provenance';
  await assert.rejects(validateWorld(forgedSlot),error=>error.code==='INVALID_WORLD');
  const forgedActor=structuredClone(pinned.world);
  forgedActor.events.at(-1).actor={...founder};
  await assert.rejects(validateWorld(forgedActor),error=>error.code==='INVALID_WORLD');
});

test('each actor may challenge a retained report once while independent actors preserve separate dissent', async () => {
  const secondWitness = { id: 'witness-2', name: 'Second witness', role: 'witness' };
  const start = createWorld({ id: 'contradiction-encounter-world', now });
  const proposal = await applyAction(start, {
    type: 'propose-moonshot', title: 'A bounded encounter',
    hypothesis: 'The retained report is reproducible.',
    falsifier: 'An independent repeat produces a counterexample.',
    evidenceNeeded: 'A retained procedure and observation.'
  }, witness, { now });
  const report = await applyAction(proposal.world, {
    type: 'report-experiment', moonshotId: proposal.result.moonshotId,
    procedure: 'Repeat the stated comparison.',
    observation: 'The required settings were not retained.',
    reportedOutcome: 'inconclusive',
    evidenceCreationId: null, evidenceVersion: null
  }, witness, { now: '2026-10-17T12:00:01.000Z' });
  const challenge = {
    type: 'challenge-experiment-report', reportId: report.result.reportId,
    challengeType: 'missing-evidence',
    challengeText: 'The report omits the settings needed to reproduce the attempt.',
    evidenceCreationId: null, evidenceVersion: null
  };
  await assert.rejects(
    applyAction(report.world, challenge, { ...witness, role: 'founder' }, {
      now: '2026-10-17T12:00:02.000Z'
    }),
    error => error.code === 'SELF_CHALLENGE' && error.status === 409
  );
  const first = await applyAction(report.world, challenge, founder, {
    now: '2026-10-17T12:00:02.000Z'
  });
  await assert.rejects(
    applyAction(first.world, {
      ...challenge, challengeType: 'methodology',
      challengeText: 'A second challenge against the same report.'
    }, founder, { now: '2026-10-17T12:00:03.000Z' }),
    error => error.code === 'REPORT_ALREADY_CHALLENGED' && error.status === 409
  );

  const independent = await applyAction(first.world, {
    ...challenge, challengeType: 'reproducibility',
    challengeText: 'A separate actor cannot reproduce the retained attempt.'
  }, secondWitness, { now: '2026-10-17T12:00:03.000Z' });
  const challenges = independent.world.events.filter(event => event.type === 'experiment-challenged');
  assert.equal(challenges.length, 2);
  assert.deepEqual(challenges.map(event => event.actor.id), [founder.id, secondWitness.id]);
  assert.equal(await validateWorld(independent.world).then(() => true), true);
  assert.equal(projectCharacter(independent.world, founder).questXp, 25);
  assert.equal(projectCharacter(independent.world, secondWitness).questXp, 25);
  assert.ok(challenges.every(event => event.outcome === undefined && event.status === undefined),
    'separate challenges preserve dissent without manufacturing a verdict');
});

test('Founder challenge dispositions bind immutable source events without granting truth or XP', async () => {
  const founder = { id: 'damien', name: 'Damien', role: 'founder' };
  const start = createWorld({ id: 'challenge-review-world', now });
  const proposal = await applyAction(start, {
    type: 'propose-moonshot',
    title: 'Can the observation be reproduced?',
    hypothesis: 'The observation repeats under the stated conditions.',
    falsifier: 'A controlled repeat fails to reproduce it.',
    evidenceNeeded: 'The procedure and a retained observation.'
  }, witness, { now });
  const report = await applyAction(proposal.world, {
    type: 'report-experiment',
    moonshotId: proposal.result.moonshotId,
    procedure: 'Repeat the stated comparison.',
    observation: 'The control settings were unavailable.',
    reportedOutcome: 'inconclusive',
    evidenceCreationId: null,
    evidenceVersion: null
  }, witness, { now: '2026-10-17T12:00:01.000Z' });
  const challenge = await applyAction(report.world, {
    type: 'challenge-experiment-report',
    reportId: report.result.reportId,
    challengeType: 'missing-evidence',
    challengeText: 'The report omits the control settings needed for reproduction.',
    evidenceCreationId: null,
    evidenceVersion: null
  }, founder, { now: '2026-10-17T12:00:02.000Z' });
  const reportEvent = report.world.events.at(-1);
  const challengeEvent = challenge.world.events.at(-1);
  const reviewAction = {
    type: 'review-experiment-challenge',
    reportId: report.result.reportId,
    challengeId: challenge.result.challengeId,
    disposition: 'request-evidence',
    rationale: 'Retain the control settings and repeat the comparison before drawing a conclusion.'
  };

  await assert.rejects(
    applyAction(challenge.world, { ...reviewAction, reportId: 'missing-report' }, founder, {
      now: '2026-10-17T12:00:03.000Z'
    }),
    error => error.code === 'CHALLENGE_REVIEW_TARGET_UNAVAILABLE' && error.status === 409
  );

  const before = projectCharacter(challenge.world, founder);
  const reviewed = await applyAction(challenge.world, reviewAction, founder, {
    now: '2026-10-17T12:00:03.000Z',
    requestId: 'challenge-review-model-001',
    actionFingerprint: 'a'.repeat(64)
  });
  const reviewEvent = reviewed.world.events.at(-1);
  assert.equal(reviewEvent.type, 'experiment-challenge-reviewed');
  assert.equal(reviewEvent.actor.id, founder.id);
  assert.equal(reviewEvent.actor.role, 'founder');
  assert.deepEqual(reviewEvent.sourceEventIds, [reportEvent.id, challengeEvent.id]);
  assert.equal(reviewEvent.disposition, 'request-evidence');
  const reviewProjection = projectResearchRecords(reviewed.world.events, reviewed.world.creations)
    .find(record => record.type === 'experiment-challenge-reviewed');
  assert.ok(reviewProjection, 'the retained review must remain in the research projection');
  assert.equal(reviewProjection._projection.proposalStatus, 'linked', JSON.stringify(reviewProjection._projection));
  assert.equal(reviewProjection._projection.targetChallengeStatus, 'linked', JSON.stringify(reviewProjection._projection));
  assert.equal(reviewProjection.actor.id, founder.id);
  assert.equal(reviewProjection.actor.role, founder.role);
  const eventsBeforeValidation = JSON.stringify(reviewed.world.events);
  await validatePayload({
    world: reviewed.world,
    institutionalEvents: [],
    artifacts: {},
    publicationBindings: []
  });
  assert.equal(JSON.stringify(reviewed.world.events), eventsBeforeValidation,
    'validation must not rewrite retained game history');
  assert.equal(reviewEvent.outcome, undefined);
  assert.equal(reviewEvent.status, undefined);
  assert.equal(reviewed.world.xp, challenge.world.xp);
  const after = projectCharacter(reviewed.world, founder);
  assert.deepEqual(
    [after.xp, after.publicationXp, after.questXp],
    [before.xp, before.publicationXp, before.questXp],
    'a next-step disposition is not an XP-bearing experiment outcome'
  );
  assert.equal(after.skills.find(skill => skill.id === 'deliberator').count, 1);
  assert.equal(after.fieldSatchel.filter(item => item.kind === 'challenge-review').length, 1);
  assert.equal(after.fieldSatchel.find(item => item.kind === 'challenge-review').eventId, reviewEvent.id);
  assert.equal(projectCharacter(reviewed.world, witness).fieldSatchel.filter(item => item.kind === 'challenge-review').length, 0);
  assert.deepEqual(
    after.fieldSatchel.find(item => item.kind === 'challenge-review').action,
    { type: 'location', id: 'decision_chamber' }
  );
  assert.equal(projectCharacter(reviewed.world, witness).skills.find(skill => skill.id === 'deliberator').count, 0);
  assert.equal(await validateWorld(reviewed.world).then(() => true), true);

  await assert.rejects(
    applyAction(reviewed.world, reviewAction, founder, { now: '2026-10-17T12:00:04.000Z' }),
    error => error.code === 'CHALLENGE_ALREADY_REVIEWED' && error.status === 409
  );
  const tampered = structuredClone(reviewed.world);
  tampered.events.at(-1).sourceEventIds[0] = 'not-the-report-event';
  await assert.rejects(validateWorld(tampered));
});



async function reviewedMoonshot(disposition = 'request-evidence', founderActor = founder) {
  const published = await publish(createWorld({ now }), 'observatory', founderActor);
  const proposal = await applyAction(published.world, {
    type: 'propose-moonshot',
    title: 'Can the control comparison be repeated?',
    hypothesis: 'The observation repeats under the stated controls.',
    falsifier: 'A controlled repeat fails to reproduce it.',
    evidenceNeeded: 'A retained procedure and exact observation.'
  }, witness, { now: '2026-10-17T12:00:01.000Z' });
  const report = await applyAction(proposal.world, {
    type: 'report-experiment',
    moonshotId: proposal.result.moonshotId,
    procedure: 'Repeat the stated comparison.',
    observation: 'The control settings were not retained.',
    reportedOutcome: 'inconclusive',
    evidenceCreationId: null,
    evidenceVersion: null
  }, witness, { now: '2026-10-17T12:00:02.000Z' });
  const challenge = await applyAction(report.world, {
    type: 'challenge-experiment-report',
    reportId: report.result.reportId,
    challengeType: 'missing-evidence',
    challengeText: 'The report does not retain the control settings needed for reproduction.',
    evidenceCreationId: null,
    evidenceVersion: null
  }, founderActor, { now: '2026-10-17T12:00:03.000Z' });
  const reviewed = await applyAction(challenge.world, {
    type: 'review-experiment-challenge',
    reportId: report.result.reportId,
    challengeId: challenge.result.challengeId,
    disposition,
    rationale: 'Repeat the comparison and preserve the requested source version.'
  }, founderActor, { now: '2026-10-17T12:00:04.000Z' });
  return {
    founder: founderActor,
    world: reviewed.world,
    moonshotId: proposal.result.moonshotId,
    reviewId: reviewed.result.reviewId,
    creationId: published.result.creationId
  };
}

test('an actionable Founder disposition accepts one later source-linked follow-up without certifying its claim', async () => {
  const serverFounder = { id: 'damien', name: 'Damien', role: 'founder' };
  const source = await reviewedMoonshot('request-evidence', serverFounder);
  const beforeWitness = projectCharacter(source.world, witness);
  const beforeFounder = projectCharacter(source.world, source.founder);
  const beforeWorldXp = source.world.xp;
  const followed = await applyAction(source.world, {
    type: 'report-experiment',
    moonshotId: source.moonshotId,
    procedure: 'Repeat the comparison with the retained control settings.',
    observation: 'The second attempt remained inconclusive; the record is preserved for further review.',
    reportedOutcome: 'inconclusive',
    evidenceCreationId: source.creationId,
    evidenceVersion: 1,
    followUpReviewId: source.reviewId
  }, witness, { now: '2026-10-17T12:00:05.000Z' });
  const event = followed.world.events.at(-1);
  assert.equal(event.type, 'experiment-reported');
  assert.equal(event.followUpReviewId, source.reviewId);
  assert.equal(event.actor.id, witness.id);
  assert.equal(event.outcome, undefined);
  assert.equal(event.status, undefined);
  assert.equal(followed.world.xp, beforeWorldXp, 'a report cannot mint institutional world XP');
  const afterWitness = projectCharacter(followed.world, witness);
  const afterFounder = projectCharacter(followed.world, source.founder);
  assert.equal(afterWitness.questXp - beforeWitness.questXp, 25, 'only the reporting actor receives report-activity XP');
  assert.equal(afterFounder.questXp - beforeFounder.questXp, 0, 'the other actor receives no XP for a shared report');
  assert.equal(afterWitness.worldXp, beforeWitness.worldXp);
  assert.equal(afterFounder.worldXp, beforeFounder.worldXp);
  const satchel = afterWitness.fieldSatchel.find(item => item.eventId === event.id);
  assert.equal(satchel.followUpReviewId, source.reviewId);
  assert.match(satchel.summary, new RegExp(source.reviewId));
  const record = projectResearchRecords(followed.world.events, followed.world.creations)
    .find(item => item.id === event.id);
  assert.equal(record._projection.proposalStatus, 'linked');
  assert.equal(record._projection.evidenceStatus, 'linked');
  assert.equal(await validateWorld(followed.world).then(() => true), true);
  // This model-only fixture has no matching kernel publication envelope; the server integration test validates persisted payloads.
});

test('follow-up references reject unknown, mismatched, backdated, duplicate and non-actionable dispositions', async () => {
  const source = await reviewedMoonshot('investigate');
  const baseAction = {
    type: 'report-experiment',
    moonshotId: source.moonshotId,
    procedure: 'Repeat the bounded comparison.',
    observation: 'The next attempt did not resolve the contradiction.',
    reportedOutcome: 'failed',
    evidenceCreationId: null,
    evidenceVersion: null,
    followUpReviewId: source.reviewId
  };
  await assert.rejects(
    applyAction(source.world, { ...baseAction, followUpReviewId: 'missing-review' }, witness, {
      now: '2026-10-17T12:00:05.000Z'
    }),
    error => error.code === 'FOLLOW_UP_REVIEW_UNAVAILABLE' && error.status === 409
  );

  const secondProposal = await applyAction(source.world, {
    type: 'propose-moonshot',
    title: 'A different question',
    hypothesis: 'A second bounded effect occurs.',
    falsifier: 'The second effect is absent under its stated condition.',
    evidenceNeeded: 'A separate retained observation.'
  }, witness, { now: '2026-10-17T12:00:05.000Z' });
  await assert.rejects(
    applyAction(secondProposal.world, { ...baseAction, moonshotId: secondProposal.result.moonshotId }, witness, {
      now: '2026-10-17T12:00:06.000Z'
    }),
    error => error.code === 'FOLLOW_UP_REVIEW_MISMATCH' && error.status === 409
  );

  await assert.rejects(
    applyAction(source.world, baseAction, witness, { now: '2026-10-17T12:00:03.500Z' }),
    error => error.code === 'INVALID_CHRONOLOGY' && error.status === 409
  );

  const first = await applyAction(source.world, baseAction, witness, { now: '2026-10-17T12:00:05.000Z' });
  await assert.rejects(
    applyAction(first.world, baseAction, witness, { now: '2026-10-17T12:00:06.000Z' }),
    error => error.code === 'FOLLOW_UP_ALREADY_RECORDED' && error.status === 409
  );

  const deferred = await reviewedMoonshot('defer');
  await assert.rejects(
    applyAction(deferred.world, { ...baseAction, moonshotId: deferred.moonshotId, followUpReviewId: deferred.reviewId }, witness, {
      now: '2026-10-17T12:00:05.000Z'
    }),
    error => error.code === 'FOLLOW_UP_REVIEW_NOT_ACTIONABLE' && error.status === 409
  );

  const requested = await reviewedMoonshot('request-evidence');
  await assert.rejects(
    applyAction(requested.world, { ...baseAction, moonshotId: requested.moonshotId, followUpReviewId: requested.reviewId }, witness, {
      now: '2026-10-17T12:00:05.000Z'
    }),
    error => error.code === 'FOLLOW_UP_EVIDENCE_REQUIRED' && error.status === 409
  );
});

test('stored follow-up history rejects backdated and duplicate review references', async () => {
  const source = await reviewedMoonshot('request-evidence');
  const followed = await applyAction(source.world, {
    type: 'report-experiment',
    moonshotId: source.moonshotId,
    procedure: 'Repeat with the retained control settings.',
    observation: 'The second attempt failed to reproduce the first.',
    reportedOutcome: 'failed',
    evidenceCreationId: source.creationId,
    evidenceVersion: 1,
    followUpReviewId: source.reviewId
  }, witness, { now: '2026-10-17T12:00:05.000Z' });

  const backdated = structuredClone(followed.world);
  backdated.events.at(-1).at = '2026-10-17T12:00:03.500Z';
  backdated.updatedAt = backdated.events.at(-1).at;
  await assert.rejects(validateWorld(backdated));

  const duplicated = structuredClone(followed.world);
  const original = duplicated.events.at(-1);
  duplicated.events.push({
    ...structuredClone(original),
    id: 'event-follow-up-duplicate',
    reportId: 'experiment-report-duplicate',
    at: '2026-10-17T12:00:06.000Z'
  });
  duplicated.revision = duplicated.events.length;
  duplicated.updatedAt = duplicated.events.at(-1).at;
  await assert.rejects(validateWorld(duplicated));
});
