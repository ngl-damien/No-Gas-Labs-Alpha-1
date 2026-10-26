import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCharacter} from '../game/character-sheet.mjs';

const founder={id:'f-1',role:'founder'};
const witness={id:'w-1',role:'witness'};
const event=(id,type,actor,at='2026-10-25T12:00:00.000Z')=>({id,type,actor,at});

test('game level is a deterministic projection of game XP, not a new reward',()=>{
  const world={xp:299,events:[]};
  const before=structuredClone(world);
  assert.deepEqual(
    [projectCharacter(world,founder).level,projectCharacter(world,founder).xpIntoLevel,projectCharacter(world,founder).nextLevelXp],
    [1,299,300]
  );
  world.xp=300;
  assert.deepEqual(
    [projectCharacter(world,founder).level,projectCharacter(world,founder).xpIntoLevel,projectCharacter(world,founder).nextLevelXp],
    [2,0,600]
  );
  assert.equal(before.xp,299);
});

test('skill records count only demonstrated activity attributed to the active character',()=>{
  const world={
    xp:100,
    events:[
      event('p1','publish',founder),
      event('d1','draft',founder),
      event('p2','publish',witness),
      event('r1','report',founder)
    ],
    discoveries:[{id:'d1',actor:founder},{id:'d2',actor:witness}],
    contributions:[{id:'n1',actor:founder},{id:'n2',actor:witness}],
    reports:[{id:'r1',actor:founder}],
    methods:[{id:'m1',actor:witness}]
  };
  const record=projectCharacter(world,founder);
  assert.deepEqual(record.skills.map(skill=>[skill.id,skill.count]),[
    ['maker',1],['explorer',1],['observer',1],['challenger',1],['restorer',0]
  ]);
  assert.equal(record.xp,100);
});

test('published places are inventory; drafts and other players\' activity are not silently added',()=>{
  const world={
    xp:0,
    creations:[{id:'c1',title:'River Notes',kind:'observatory',version:2,receipt:{digest:'abc',size:12}}],
    drafts:[{id:'d1',title:'Private draft'}],
    events:[event('p1','publish',founder),event('p2','publish',witness)]
  };
  const before=structuredClone(world);
  const record=projectCharacter(world,founder);
  assert.deepEqual(record.inventory,[{
    id:'c1',title:'River Notes',kind:'observatory',version:2,receipt:{digest:'abc',size:12}
  }]);
  assert.deepEqual(record.recentActivity.map(item=>item.type),['publish']);
  assert.deepEqual(world,before);
});

test('missing records fail closed to empty activity without inventing skill or XP',()=>{
  const record=projectCharacter({},founder);
  assert.equal(record.level,1);
  assert.equal(record.xp,0);
  assert.ok(record.skills.every(skill=>skill.count===0));
  assert.deepEqual(record.inventory,[]);
  assert.deepEqual(record.recentActivity,[]);
});
