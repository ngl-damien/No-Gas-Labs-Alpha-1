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
test('Polymath Academy grants source-bound activity XP without awarding mastery',async()=>{
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
  const character=projectCharacter(valid,witness);assert.deepEqual([character.xp,character.publicationXp,character.questXp],[25,0,25]);assert.equal(character.skills.find(skill=>skill.id==='scholar').count,1);
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

test('Academy retrieval review grants actor-scoped activity XP without mastery',async()=>{
  const published=await publishedSource();
  const studied=await applyAction(published.world,{type:'study',creationId:published.result.creationId,version:1,question:'What does the receipt prove?',attempt:'Only byte identity, not truth.',nextCheck:'Name one independent observation that could challenge the claim.'},witness,{now:'2026-10-28T00:00:03.000Z'});
  const source=studied.world.events.at(-1);
  const before=getQuestTrail(studied.world,witness).find(item=>item.id==='witness-academy-study-review');
  assert.equal(before.complete,false);
  assert.deepEqual(before.action,{type:'location',id:'academy'});
  const reviewed=await applyAction(studied.world,{type:'review-study',studyId:source.studyId,response:'I need an observation produced outside the original claim.',reflection:'I still need to locate and inspect that observation.'},witness,{now:'2026-10-28T00:00:04.000Z',requestId:'academy-review-model-001',actionFingerprint:'c'.repeat(64)});
  const valid=await validateWorld(reviewed.world),event=valid.events.at(-1);
  assert.equal(event.type,'study-reviewed');
  assert.equal(event.actor.id,witness.id);
  assert.equal(event.studyId,source.studyId);
  assert.equal(event.creationId,source.creationId);
  assert.equal(event.version,source.version);
  assert.equal(event.response,'I need an observation produced outside the original claim.');
  assert.equal(valid.xp,studied.world.xp);
  assert.equal(event.outcome,undefined);
  assert.equal(event.approved,undefined);
  assert.equal(institutionActivityCount('academy',valid),2);
  const entry=projectChronicle({world:valid}).entries.find(item=>item.eventType==='study-reviewed');
  assert.ok(entry);
  assert.equal(entry.category,'POLYMATH ACADEMY');
  assert.match(entry.summary,/self-reported practice/i);
  assert.equal(entry.targetAvailable,true);
  const character=projectCharacter(valid,witness);
  assert.deepEqual([character.xp,character.publicationXp,character.questXp],[50,0,50]);
  assert.equal(character.skills.find(skill=>skill.id==='retriever').count,1);
  assert.equal(getQuestTrail(valid,witness).find(item=>item.id==='witness-academy-study-review').complete,true);
  assert.equal(getQuestTrail(valid,founder).find(item=>item.id==='founder-academy-study-review').complete,false);
  await assert.rejects(applyAction(valid,{type:'review-study',studyId:source.studyId,response:'Repeat',reflection:'Repeat'},witness,{now:'2026-10-28T00:00:05.000Z'}),error=>error.code==='STUDY_ALREADY_REVIEWED');
});
test('Academy retrieval review rejects unknown notes and another actor cannot review a Witness note',async()=>{
  const published=await publishedSource();
  const studied=await applyAction(published.world,{type:'study',creationId:published.result.creationId,version:1,question:'What is unknown?',attempt:'The source is not an independent observation.',nextCheck:'Find a separate observation.'},witness,{now:'2026-10-28T00:00:03.000Z'});
  const source=studied.world.events.at(-1);
  await assert.rejects(applyAction(studied.world,{type:'review-study',studyId:'missing-study',response:'An answer',reflection:'Still unsure'},witness,{now:'2026-10-28T00:00:04.000Z'}),error=>error.code==='NOT_FOUND');
  await assert.rejects(applyAction(studied.world,{type:'review-study',studyId:source.studyId,response:'An answer',reflection:'Still unsure'},founder,{now:'2026-10-28T00:00:04.000Z'}),error=>error.code==='FORBIDDEN');
  const reviewed=await applyAction(studied.world,{type:'review-study',studyId:source.studyId,response:'An answer',reflection:'Still unsure'},witness,{now:'2026-10-28T00:00:04.000Z'});
  const tampered=structuredClone(reviewed.world);
  tampered.events.push({...tampered.events.at(-1),id:'duplicate-review-event',reviewId:'duplicate-review-id',at:'2026-10-28T00:00:05.000Z'});
  tampered.revision=tampered.events.length;
  tampered.updatedAt=tampered.events.at(-1).at;
  await assert.rejects(validateWorld(tampered),error=>error.code==='INVALID_WORLD');
});
