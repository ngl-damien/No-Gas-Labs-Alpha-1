import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld, applyAction, publicWorld, validateWorld} from '../game/model.mjs';
import {isStrictTimestamp} from '../game/timestamps.mjs';
import {projectCharacter} from '../game/character-sheet.mjs';

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
});

test('field loadout rejects wrong slots, missing sources, cross-actor sources, and forged imported references',async()=>{
  const discovered=await applyAction(createWorld({now}),{type:'discover',locationId:'river'},witness,{now});
  const source=discovered.world.events.find(event=>event.type==='discover');
  await assert.rejects(applyAction(discovered.world,{type:'equip-field-item',slotId:'provenance',sourceEventId:source.id},witness,{now}),error=>error.code==='INVALID_EQUIPMENT_SOURCE');
  await assert.rejects(applyAction(discovered.world,{type:'equip-field-item',slotId:'scouting',sourceEventId:source.id},founder,{now}),error=>error.code==='INVALID_EQUIPMENT_SOURCE');
  await assert.rejects(applyAction(discovered.world,{type:'equip-field-item',slotId:'unknown',sourceEventId:null},witness,{now}),error=>error.code==='INVALID_EQUIPMENT_SLOT');
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
