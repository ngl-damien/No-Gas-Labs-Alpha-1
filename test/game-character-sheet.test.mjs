import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCharacter} from '../game/character-sheet.mjs';

const founder={id:'f-1',role:'founder'};
const witness={id:'w-1',role:'witness'};
const t1='2026-10-25T12:00:00.000Z';
const t2='2026-10-25T12:01:00.000Z';
const t3='2026-10-25T12:02:00.000Z';
const event=(id,type,actor,at=t1,detail={})=>({id,type,actor,at,...detail});
const receipt=(version)=>({algorithm:'sha256',digest:String(version).padStart(2,'0')+'a'.repeat(62),size:100+version});
function publishedCreation(id,times) {
  const versions=times.map((publishedAt,index)=>({
    id,version:index+1,publishedAt,receipt:receipt(index+1)
  }));
  return {...versions.at(-1),versions:versions.slice(0,-1),title:id,kind:'observatory'};
}
const publication=(id,actor,creationId,version,at,extra={})=>
  event(id,'publish',actor,at,{creationId,version,reward:100,...extra});

test('character XP and level derive from unique publications matched to retained versions',()=>{
  const world={
    xp:300,
    creations:[publishedCreation('c1',[t1,t2,t3])],
    events:[
      publication('p1',founder,'c1',1,t1),
      publication('p2',founder,'c1',2,t2),
      publication('p3',founder,'c1',3,t3)
    ]
  };
  const before=structuredClone(world);
  const record=projectCharacter(world,founder);
  assert.deepEqual(
    [record.xp,record.worldXp,record.level,record.levelStartXp,record.xpIntoLevel,record.nextLevelXp],
    [300,300,2,300,0,600]
  );
  assert.equal(record.skills.find(skill=>skill.id==='maker').count,3);
  assert.deepEqual(world,before);
});

test('institution-wide XP never leaks into a Witness character level',()=>{
  const world={
    xp:300,
    creations:[publishedCreation('founder-work',[t1,t2,t3])],
    events:[
      publication('p1',founder,'founder-work',1,t1),
      publication('p2',founder,'founder-work',2,t2),
      publication('p3',founder,'founder-work',3,t3),
      event('w-note','contribute',witness,t3,{creationId:'founder-work',version:3})
    ],
    contributions:[{id:'n1',actor:witness,creationId:'founder-work',version:3,text:'A real note.'}]
  };
  const record=projectCharacter(world,witness);
  assert.deepEqual([record.xp,record.worldXp,record.level,record.xpIntoLevel],[0,300,1,0]);
  assert.equal(record.skills.find(skill=>skill.id==='observer').count,1);
  assert.equal(record.skills.find(skill=>skill.id==='maker').count,0);
});

test('ambiguous, duplicated, stale, non-Founder, and malformed publication claims earn no XP',()=>{
  const world={
    xp:700,
    creations:[
      publishedCreation('good',[t1]),
      publishedCreation('ambiguous',[t1]),
      publishedCreation('duplicate-a',[t1]),
      publishedCreation('duplicate-b',[t1]),
      publishedCreation('wrong-time',[t1]),
      publishedCreation('wrong-reward',[t1]),
      publishedCreation('non-founder',[t1])
    ],
    events:[
      publication('good-event',founder,'good',1,t1),
      publication('ambiguous-a',founder,'ambiguous',1,t1),
      publication('ambiguous-b',founder,'ambiguous',1,t1),
      publication('duplicate-id',founder,'duplicate-a',1,t1),
      publication('duplicate-id',founder,'duplicate-b',1,t1),
      publication('wrong-time-event',founder,'wrong-time',1,t2),
      publication('wrong-reward-event',founder,'wrong-reward',1,t1,{reward:200}),
      publication('non-founder-event',witness,'non-founder',1,t1),
      publication('stale-version-event',founder,'good',99,t1),
      event('malformed-event','publish',founder,t1,{creationId:'good',version:1,reward:99})
    ]
  };
  const record=projectCharacter(world,founder);
  assert.equal(record.xp,100);
  assert.equal(record.skills.find(skill=>skill.id==='maker').count,1);
});

test('skills count activity attributed to the active character',()=>{
  const world={
    xp:200,
    creations:[publishedCreation('founder-place',[t1]),publishedCreation('witness-place',[t2])],
    events:[
      publication('p1',founder,'founder-place',1,t1),
      event('d1','draft',founder,t1),
      publication('p2',witness,'witness-place',1,t2),
      event('r1','report',founder,t2,{creationId:'founder-place',version:1})
    ],
    discoveries:[{id:'d-founder',actor:founder,locationId:'river'},{id:'d-witness',actor:witness,locationId:'relay'}],
    contributions:[{id:'n-founder',actor:founder,creationId:'founder-place',version:1,text:'Note.'},{id:'n-witness',actor:witness,creationId:'founder-place',version:1,text:'Other note.'}],
    reports:[{id:'r-founder',actor:founder,creationId:'founder-place',version:1,text:'Question.'}],
    methods:[{id:'m-witness',actor:witness,creationId:'witness-place',version:1,title:'Repair',description:'',at:t2}]
  };
  const record=projectCharacter(world,founder);
  assert.deepEqual(record.skills.map(skill=>[skill.id,skill.count]),[
    ['maker',1],['explorer',1],['observer',1],['challenger',1],['restorer',0]
  ]);
  assert.equal(record.xp,100);
});

test('published places are world inventory; drafts and other players’ activity are not added to the character trail',()=>{
  const world={
    xp:200,
    creations:[{
      ...publishedCreation('c1',[t1,t2]),
      receipt:{algorithm:'sha256',digest:'b'.repeat(64),size:12}
    }],
    drafts:[{id:'d1',title:'Private draft'}],
    events:[
      publication('p1',founder,'c1',1,t1),
      event('p2','contribute',witness,t2,{creationId:'c1',version:2})
    ]
  };
  const before=structuredClone(world);
  const record=projectCharacter(world,founder);
  assert.deepEqual(record.inventory,[{
    id:'c1',title:'c1',kind:'observatory',version:2,receipt:{digest:'b'.repeat(64),size:12}
  }]);
  assert.deepEqual(record.recentActivity.map(item=>item.type),['publish']);
  assert.equal(record.xp,100);
  assert.equal(record.worldXp,200);
  assert.deepEqual(world,before);
});

test('missing or malformed records fail closed to empty activity without inventing XP',()=>{
  const record=projectCharacter({},founder);
  assert.equal(record.level,1);
  assert.equal(record.xp,0);
  assert.equal(record.worldXp,0);
  assert.ok(record.skills.every(skill=>skill.count===0));
  assert.deepEqual(record.inventory,[]);
  assert.deepEqual(record.recentActivity,[]);
});

test('character activity fails closed when actor role is missing or unsupported', () => {
  const sharedId = 'reused-actor-id';
  const world = {
    xp: 200,
    creations: [
      publishedCreation('founder-work', [t1]),
      publishedCreation('witness-work', [t2])
    ],
    events: [
      publication('founder-pub', { id: sharedId, role: 'founder' }, 'founder-work', 1, t1),
      event('witness-note', 'contribute', { id: sharedId, role: 'witness' }, t2, {
        creationId: 'witness-work', version: 1
      })
    ],
    discoveries: [
      { id: 'founder-discovery', actor: { id: sharedId, role: 'founder' }, locationId: 'river' },
      { id: 'witness-discovery', actor: { id: sharedId, role: 'witness' }, locationId: 'relay' }
    ]
  };

  const ambiguous = projectCharacter(world, { id: sharedId });
  assert.equal(ambiguous.xp, 0);
  assert.ok(ambiguous.skills.every(skill => skill.count === 0));
  assert.deepEqual(ambiguous.recentActivity, []);

  const unsupported = projectCharacter(world, { id: sharedId, role: 'administrator' });
  assert.equal(unsupported.xp, 0);
  assert.ok(unsupported.skills.every(skill => skill.count === 0));
  assert.deepEqual(unsupported.recentActivity, []);

  const founderRecord = projectCharacter(world, { id: sharedId, role: 'founder' });
  assert.equal(founderRecord.xp, 100);
  assert.equal(founderRecord.skills.find(skill => skill.id === 'explorer').count, 1);

  const witnessRecord = projectCharacter(world, { id: sharedId, role: 'witness' });
  assert.equal(witnessRecord.xp, 0);
  assert.equal(witnessRecord.skills.find(skill => skill.id === 'explorer').count, 1);
});

