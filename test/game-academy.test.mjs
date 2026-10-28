import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, applyAction, validateWorld } from '../game/model.mjs';
import { projectChronicle } from '../game/chronicle.mjs';
import { projectCharacter } from '../game/character-sheet.mjs';
import { getQuestTrail } from '../game/quests.mjs';
import { institutionActivityCount } from '../game/world-view.mjs';

const founder={id:'damien',name:'Damien',role:'founder'};
const witness={id:'academy-witness-1',name:'Witness',role:'witness'};
async function publishedSource(){
  const initial=createWorld({id:'academy-study-world',founderName:'Damien',now:'2026-10-28T00:00:00.000Z'});
  const draft=await applyAction(initial,{type:'draft',kind:'observatory',title:'Study source',intent:'A retained artifact whose claims still need independent checking.'},founder,{now:'2026-10-28T00:00:01.000Z'});
  return applyAction(draft.world,{type:'publish',draftId:draft.result.draftId,expectedVersion:0},founder,{now:'2026-10-28T00:00:02.000Z'});
}
test('Polymath Academy retains a source-bound study note without awarding XP or mastery',async()=>{
  const published=await publishedSource();
  const before=getQuestTrail(published.world,witness).find(item=>item.id==='witness-academy-study-note');
  assert.equal(before.complete,false);
  assert.deepEqual(before.action,{type:'location',id:'academy'});
  const studied=await applyAction(published.world,{type:'study',creationId:published.result.creationId,version:1,question:'What does the retained receipt establish?',attempt:'It identifies the bytes, not whether the claim inside is true.',nextCheck:'Find an independent source and a possible counterexample.'},witness,{now:'2026-10-28T00:00:03.000Z',requestId:'academy-study-model-001',actionFingerprint:'b'.repeat(64)});
  const valid=await validateWorld(studied.world),event=valid.events.at(-1);
  assert.equal(event.type,'study');assert.equal(event.actor.id,witness.id);assert.equal(event.creationId,published.result.creationId);assert.equal(event.version,1);
  assert.equal(valid.xp,published.world.xp);assert.equal(event.outcome,undefined);assert.equal(event.status,undefined);assert.equal(institutionActivityCount('academy',valid),1);
  const entry=projectChronicle({world:valid}).entries.find(item=>item.eventType==='study');
  assert.ok(entry);assert.equal(entry.category,'POLYMATH ACADEMY');assert.match(entry.summary,/does not certify correctness or mastery/i);assert.match(entry.detail,/Question: What does the retained receipt establish/);assert.equal(entry.targetAvailable,true);
  const character=projectCharacter(valid,witness);assert.equal(character.xp,0);assert.equal(character.skills.find(skill=>skill.id==='scholar').count,1);
  const witnessQuest=getQuestTrail(valid,witness).find(item=>item.id==='witness-academy-study-note');
  const founderQuest=getQuestTrail(valid,founder).find(item=>item.id==='founder-academy-study-note');
  assert.equal(witnessQuest.complete,true);assert.deepEqual(witnessQuest.evidenceIds,[event.id]);assert.equal(witnessQuest.evidence[0].creationId,published.result.creationId);assert.equal(witnessQuest.evidence[0].version,1);assert.equal(founderQuest.complete,false);
});
test('Academy refuses blank study fields and stale versions without changing the world',async()=>{
  const published=await publishedSource(),before=structuredClone(published.world);
  const base={type:'study',creationId:published.result.creationId,question:'A real question',attempt:'An attempt in my own words',nextCheck:'A next check'};
  await assert.rejects(applyAction(published.world,{...base,version:99},witness,{now:'2026-10-28T00:00:03.000Z'}),error=>error.code==='STALE_VERSION');
  await assert.rejects(applyAction(published.world,{...base,version:1,question:'   '},witness,{now:'2026-10-28T00:00:03.000Z'}),error=>error.code==='INVALID_INPUT');
  assert.deepEqual(published.world,before);
});
test('duplicate study identities cannot complete the Academy quest or inflate Scholar activity',async()=>{
  const published=await publishedSource();
  const studied=await applyAction(published.world,{type:'study',creationId:published.result.creationId,version:1,question:'What remains uncertain?',attempt:'The claim needs another source.',nextCheck:'Compare an independent observation.'},witness,{now:'2026-10-28T00:00:03.000Z'});
  const ambiguous=structuredClone(studied.world);ambiguous.events.push({...ambiguous.events.at(-1),id:'second-study-event-with-same-study-id',at:'2026-10-28T00:00:04.000Z'});
  const quest=getQuestTrail(ambiguous,witness).find(item=>item.id==='witness-academy-study-note');
  assert.equal(quest.complete,false);assert.equal(projectCharacter(ambiguous,witness).skills.find(skill=>skill.id==='scholar').count,0);
  await assert.rejects(validateWorld(ambiguous),error=>error.code==='INVALID_WORLD');
});
