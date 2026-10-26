import test from 'node:test';
import assert from 'node:assert/strict';
import {getQuest} from '../game/quests.mjs';

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
