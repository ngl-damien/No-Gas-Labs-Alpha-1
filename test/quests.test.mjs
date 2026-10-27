import test from 'node:test';
import assert from 'node:assert/strict';
import {getQuest,getQuestTrail} from '../game/quests.mjs';

const founder={id:'f-1',name:'Founder',role:'founder'};
const witness={id:'w-1',name:'Witness',role:'witness'};
const other={id:'other',name:'Other',role:'witness'};
const base=()=>({creations:[],discoveries:[],contributions:[],reports:[],xp:0});
const discovery=(id,locationId)=>({id,locationId,actor:witness});
const note=(id,actor)=>({id,actor,creationId:'c-1',version:1,text:'Observed'});
const report=(id,actor)=>({id,actor,creationId:'c-1',version:1,text:'Needs a test'});
const creation={id:'c-1',title:'A real place',version:1};

test('Witness quests map real guide discoveries and do not invent work when the world is empty',()=>{
  const world=base();
  assert.equal(getQuest(world,witness).id,'witness-discover');
  world.discoveries=[discovery('d1','relay')];
  assert.equal(getQuest(world,witness).id,'witness-map');
  assert.match(getQuest(world,witness).copy,/1 of four/);
  world.discoveries.push(discovery('d2','river'),discovery('d3','overlook'),discovery('d4','ruins'));
  const waiting=getQuest(world,witness);
  assert.equal(waiting.id,'witness-await-work');
  assert.match(waiting.copy,/no creation is published/i);
  assert.equal(world.xp,0);
});

test('Witness contribution and report objectives only advance from that Witness\'s records',()=>{
  const world=base();world.creations=[creation];
  world.contributions=[note('n-other',other)];
  assert.equal(getQuest(world,witness).id,'witness-discover');
  world.discoveries=[discovery('d1','river')];
  assert.equal(getQuest(world,witness).id,'witness-note');
  world.contributions.push(note('n-witness',witness));
  assert.equal(getQuest(world,witness).id,'witness-report');
  world.reports=[report('r-witness',witness)];
  assert.equal(getQuest(world,witness).id,'witness-return');
});

test('Founder objectives route to the actual next activity, including the second-place transition',()=>{
  const world=base();
  assert.deepEqual([getQuest(world,founder).id,getQuest(world,founder).action],['founder-create','workbench']);
  world.creations=[creation];
  assert.deepEqual([getQuest(world,founder).id,getQuest(world,founder).action],['founder-discover','places']);
  world.discoveries=[{id:'d1',locationId:'river',actor:founder}];
  assert.deepEqual([getQuest(world,founder).id,getQuest(world,founder).action],['founder-note','places']);
  world.contributions=[note('n-founder',founder)];
  assert.deepEqual([getQuest(world,founder).id,getQuest(world,founder).action],['founder-create-second','workbench']);
  world.creations.push({...creation,id:'c-2'});
  assert.equal(getQuest(world,founder).id,'founder-connect');
});

test('quest projection is deterministic and never mutates canonical world state',()=>{
  const world=base();world.creations=[creation];world.discoveries=[{id:'d1',locationId:'river',actor:founder}];
  const before=structuredClone(world);
  const first=getQuest(world,founder),second=getQuest(world,founder);
  assert.deepEqual(first,second);
  assert.deepEqual(world,before);
});


function trailFixture() {
  return { creations: [], events: [], discoveries: [], contributions: [], reports: [] };
}
const at1 = '2026-10-26T10:00:00.000Z';
const at2 = '2026-10-26T10:05:00.000Z';
const publishedV1 = { id: 'c-1', title: 'A retained place', version: 1, publishedAt: at1 };
const publishedV2 = { id: 'c-1', title: 'A retained place', version: 2, publishedAt: at2, versions: [publishedV1] };

test('objective trail advances only from retained events matching real records and retained versions', () => {
  const world = trailFixture();
  world.creations = [{ ...publishedV2, versions: [publishedV1] }];
  world.events = [
    { id: 'publish-v1', type: 'publish', actor: founder, at: at1, creationId: 'c-1', version: 1 },
    { id: 'publish-v2', type: 'publish', actor: founder, at: at2, creationId: 'c-1', version: 2 },
    { id: 'discover-river', type: 'discover', actor: founder, at: at1, locationId: 'river' },
    { id: 'field-note', type: 'contribute', actor: founder, at: at2, creationId: 'c-1', version: 1 },
  ];
  world.discoveries = [{ id: 'd-1', locationId: 'river', actor: founder, at: at1 }];
  world.contributions = [{ id: 'n-1', creationId: 'c-1', version: 1, actor: founder, at: at2, text: 'Observed' }];
  const trail = getQuestTrail(world, founder);
  assert.deepEqual(trail.find(item => item.id === 'founder-first-place').evidenceIds, ['publish-v1']);
  assert.equal(trail.find(item => item.id === 'founder-first-place').complete, true);
  assert.equal(trail.find(item => item.id === 'founder-second-place').progress, 1);
  assert.equal(trail.find(item => item.id === 'founder-preserve-version').complete, true);
  assert.equal(trail.find(item => item.id === 'founder-walk-institution').complete, true);
  assert.equal(trail.find(item => item.id === 'founder-field-note').complete, true);
});

test('objective trail refuses aggregate records without a matching retained event', () => {
  const world = trailFixture();
  world.creations = [{ ...publishedV1, versions: [] }];
  world.discoveries = [{ id: 'd-unproven', locationId: 'river', actor: founder, at: at1 }];
  world.contributions = [{ id: 'n-unproven', creationId: 'c-1', version: 1, actor: founder, at: at2, text: 'Not in event history' }];
  world.events = [{ id: 'publish-v1', type: 'publish', actor: founder, at: at1, creationId: 'c-1', version: 1 }];
  const trail = getQuestTrail(world, founder);
  assert.equal(trail.find(item => item.id === 'founder-walk-institution').progress, 0);
  assert.equal(trail.find(item => item.id === 'founder-field-note').progress, 0);
});

test('duplicate event metadata cannot be arbitrarily attached to one field note', () => {
  const world = trailFixture();
  world.creations = [{ ...publishedV1, versions: [] }];
  world.contributions = [{ id: 'n-1', creationId: 'c-1', version: 1, actor: founder, at: at2, text: 'Observed' }];
  world.events = [
    { id: 'note-a', type: 'contribute', actor: founder, at: at2, creationId: 'c-1', version: 1 },
    { id: 'note-b', type: 'contribute', actor: founder, at: at2, creationId: 'c-1', version: 1 },
  ];
  assert.equal(getQuestTrail(world, founder).find(item => item.id === 'founder-field-note').progress, 0);
});

test('witness objective evidence is actor-scoped and published work is not attributed to the witness', () => {
  const world = trailFixture();
  world.creations = [{ ...publishedV1, versions: [] }];
  world.events = [
    { id: 'publish-v1', type: 'publish', actor: founder, at: at1, creationId: 'c-1', version: 1 },
    { id: 'founder-note', type: 'contribute', actor: founder, at: at2, creationId: 'c-1', version: 1 },
    { id: 'witness-report', type: 'report', actor: witness, at: at2, creationId: 'c-1', version: 1 },
  ];
  world.contributions = [{ id: 'n-founder', creationId: 'c-1', version: 1, actor: founder, at: at2, text: 'Founder note' }];
  world.reports = [{ id: 'r-witness', creationId: 'c-1', version: 1, actor: witness, at: at2, text: 'Test it' }];
  const trail = getQuestTrail(world, witness);
  assert.equal(trail.find(item => item.id === 'witness-work-available').complete, true);
  assert.equal(trail.find(item => item.id === 'witness-field-note').complete, false);
  assert.deepEqual(trail.find(item => item.id === 'witness-version-report').evidenceIds, ['witness-report']);
});

test('objective trail is deterministic, read-only, and exposes only real event IDs', () => {
  const world = trailFixture();
  world.creations = [{ ...publishedV1, versions: [] }];
  world.events = [{ id: 'publish-v1', type: 'publish', actor: founder, at: at1, creationId: 'c-1', version: 1 }];
  const before = structuredClone(world);
  assert.deepEqual(getQuestTrail(world, founder), getQuestTrail(structuredClone(world), founder));
  assert.deepEqual(world, before);
  assert.deepEqual(getQuestTrail(world, founder).find(item => item.id === 'founder-first-place').evidenceIds, ['publish-v1']);
});


test('reused event IDs cannot support conflicting publication and discovery claims', () => {
  const world = trailFixture();
  world.creations = [{ ...publishedV1, versions: [] }];
  world.events = [
    { id: 'reused-event', type: 'publish', actor: founder, at: at1, creationId: 'c-1', version: 1 },
    { id: 'reused-event', type: 'discover', actor: founder, at: at1, locationId: 'river' },
  ];
  world.discoveries = [{ id: 'd-1', locationId: 'river', actor: founder, at: at1 }];
  const trail = getQuestTrail(world, founder);
  assert.equal(trail.find(item => item.id === 'founder-first-place').progress, 0);
  assert.equal(trail.find(item => item.id === 'founder-walk-institution').progress, 0);
});

test('objective trail exposes minimal frozen provenance for each counted event', () => {
  const world = trailFixture();
  world.creations = [{ ...publishedV1, versions: [] }];
  world.events = [{ id: 'publish-v1', type: 'publish', actor: founder, at: at1, creationId: 'c-1', version: 1 }];
  const milestone = getQuestTrail(world, founder).find(item => item.id === 'founder-first-place');
  assert.deepEqual(milestone.evidence, [{
    id: 'publish-v1', type: 'publish', at: at1, actorId: 'f-1',
    creationId: 'c-1', version: 1, locationId: null,
  }]);
  assert.equal(Object.isFrozen(milestone.evidence), true);
  assert.equal(Object.isFrozen(milestone.evidence[0]), true);
});


test('quest trail keeps Founder and Witness evidence separate when actor IDs collide', () => {
  const sharedId = 'same-session-id';
  const sameIdFounder = { id: sharedId, name: 'Founder', role: 'founder' };
  const sameIdWitness = { id: sharedId, name: 'Witness', role: 'witness' };
  const world = trailFixture();
  world.creations = [{ ...publishedV1, versions: [] }];
  world.events = [
    { id: 'founder-publish', type: 'publish', actor: sameIdFounder, at: at1, creationId: 'c-1', version: 1 },
    { id: 'founder-discovery', type: 'discover', actor: sameIdFounder, at: at1, locationId: 'river' },
    { id: 'founder-note', type: 'contribute', actor: sameIdFounder, at: at2, creationId: 'c-1', version: 1 },
    { id: 'witness-report', type: 'report', actor: sameIdWitness, at: at2, creationId: 'c-1', version: 1 },
  ];
  world.discoveries = [{ id: 'witness-discovery-record', locationId: 'river', actor: sameIdWitness, at: at1 }];
  world.contributions = [{ id: 'witness-note-record', creationId: 'c-1', version: 1, actor: sameIdWitness, at: at2, text: 'Witness-only note' }];
  world.reports = [{ id: 'witness-report-record', creationId: 'c-1', version: 1, actor: sameIdWitness, at: at2, text: 'Witness report' }];

  const witnessTrail = getQuestTrail(world, sameIdWitness);
  assert.equal(witnessTrail.find(item => item.id === 'witness-work-available').complete, true,
    'publicly retained work remains visible to the Witness');
  assert.equal(witnessTrail.find(item => item.id === 'witness-map-grounds').progress, 0,
    'a Founder discovery event cannot satisfy the Witness discovery record');
  assert.equal(witnessTrail.find(item => item.id === 'witness-field-note').progress, 0,
    'a Founder contribution event cannot satisfy the Witness note record');
  assert.deepEqual(witnessTrail.find(item => item.id === 'witness-version-report').evidenceIds, ['witness-report']);

  const founderTrail = getQuestTrail(world, sameIdFounder);
  assert.deepEqual(founderTrail.find(item => item.id === 'founder-first-place').evidenceIds, ['founder-publish']);
  assert.deepEqual(founderTrail.find(item => item.id === 'founder-walk-institution').evidenceIds, ['founder-discovery']);
  assert.deepEqual(founderTrail.find(item => item.id === 'founder-field-note').evidenceIds, ['founder-note']);
});

test('quest summary ignores activity with the same actor ID but a different role', () => {
  const sharedId = 'same-summary-id';
  const sameIdFounder = { id: sharedId, name: 'Founder', role: 'founder' };
  const sameIdWitness = { id: sharedId, name: 'Witness', role: 'witness' };
  const world = base();
  world.creations = [creation];
  world.discoveries = [{ id: 'founder-discovery', locationId: 'river', actor: sameIdFounder }];
  world.contributions = [{ id: 'witness-note', creationId: 'c-1', version: 1, actor: sameIdWitness, text: 'Witness-only note' }];
  assert.equal(getQuest(world, sameIdFounder).id, 'founder-note');
});

test('quest trail fails closed for a missing or unsupported actor role', () => {
  const world = trailFixture();
  world.events = [{ id: 'publish-v1', type: 'publish', actor: founder, at: at1, creationId: 'c-1', version: 1 }];
  assert.deepEqual(getQuestTrail(world, { id: 'f-1' }), []);
  assert.deepEqual(getQuestTrail(world, { id: 'f-1', role: 'administrator' }), []);
});
