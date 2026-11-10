import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrderedPositionWriter,readPrivatePlayerPosition,writePrivatePlayerPosition} from '../game/player-position.mjs';

function storage(initial={}){
  const values=new Map(Object.entries(initial));
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),values};
}
const key='ngl.common-ground.player-position.v1';

test('private player position round-trips bounded world coordinates',()=>{
  const store=storage();
  assert.equal(writePrivatePlayerPosition({x:425.5,y:730},store),true);
  assert.deepEqual(readPrivatePlayerPosition(store),{x:425.5,y:730});
});

test('a transient player ID is accepted in memory but never persisted',()=>{
  const store=storage();
  assert.equal(writePrivatePlayerPosition({id:'actor-1',x:425.5,y:730},store),true);
  const saved=JSON.parse(store.values.get(key));
  assert.deepEqual(Object.keys(saved).sort(),['schema','x','y']);
  assert.deepEqual(readPrivatePlayerPosition(store),{x:425.5,y:730});
});

test('malformed, old-schema, extra-field and out-of-world positions are ignored',()=>{
  for(const value of [
    '{','null','[]',
    JSON.stringify({schema:'old',x:10,y:20}),
    JSON.stringify({schema:'ngl.player-position.v1',x:-1,y:20}),
    JSON.stringify({schema:'ngl.player-position.v1',x:20,y:1001}),
    JSON.stringify({schema:'ngl.player-position.v1',x:'20',y:30}),
    JSON.stringify({schema:'ngl.player-position.v1',x:20,y:30,id:'should-not-persist'}),
    JSON.stringify({schema:'ngl.player-position.v1',x:20,y:30,extra:true})
  ])assert.equal(readPrivatePlayerPosition(storage({[key]:value})),null);
});

test('writes reject non-finite, out-of-bounds, extra and accessor coordinates without overwriting saved position',()=>{
  const store=storage();
  assert.equal(writePrivatePlayerPosition({x:200,y:300},store),true);
  const accessor={y:3};
  Object.defineProperty(accessor,'x',{enumerable:true,get(){throw new Error('must not execute')}})
  for(const value of [
    {x:NaN,y:3},{x:Infinity,y:3},{x:3,y:-1},{x:1601,y:3},
    {x:4,y:5,id:42},{x:4,y:5,extra:true},accessor,
    Object.create({x:4}),null,[],{id:'x'.repeat(81),x:4,y:5}
  ])assert.equal(writePrivatePlayerPosition(value,store),false);
  assert.deepEqual(readPrivatePlayerPosition(store),{x:200,y:300});
});

test('unavailable storage fails safely without throwing',()=>{
  const broken={getItem(){throw new Error('blocked')},setItem(){throw new Error('blocked')}};
  assert.equal(readPrivatePlayerPosition(broken),null);
  assert.equal(writePrivatePlayerPosition({x:10,y:10},broken),false);
});


test('shared position writes are serialized in invocation order without overlap',async()=>{
  const writes=[];
  const releases=[];
  let active=0;
  let maximumActive=0;
  const writer=createOrderedPositionWriter(async position=>{
    active+=1;
    maximumActive=Math.max(maximumActive,active);
    writes.push(position);
    await new Promise(resolve=>releases.push(resolve));
    active-=1;
    return {accepted:position};
  });

  const first=writer({id:'actor-1',x:10,y:20});
  const second=writer({id:'actor-1',x:30,y:40});
  const third=writer({x:50,y:60});
  assert.deepEqual(writes,[{x:10,y:20}]);

  releases.shift()();
  assert.deepEqual(await first,{accepted:{x:10,y:20}});
  assert.deepEqual(writes,[{x:10,y:20},{x:30,y:40}]);

  releases.shift()();
  assert.deepEqual(await second,{accepted:{x:30,y:40}});
  assert.deepEqual(writes,[{x:10,y:20},{x:30,y:40},{x:50,y:60}]);

  releases.shift()();
  assert.deepEqual(await third,{accepted:{x:50,y:60}});
  assert.equal(maximumActive,1);
});

test('a failed shared position write rejects queued stale coordinates and permits a later resync write',async()=>{
  const writes=[];
  let failFirst=true;
  const writer=createOrderedPositionWriter(async position=>{
    writes.push(position);
    if(failFirst){
      failFirst=false;
      throw new Error('offline');
    }
    return {accepted:position};
  });

  const first=writer({x:10,y:20});
  const stale=writer({x:30,y:40});
  await assert.rejects(first,/offline/);
  await assert.rejects(stale,/offline/);
  assert.deepEqual(writes,[{x:10,y:20}]);

  assert.deepEqual(await writer({x:50,y:60}),{accepted:{x:50,y:60}});
  assert.deepEqual(writes,[{x:10,y:20},{x:50,y:60}]);
});

test('shared position writer rejects malformed or accessor coordinates without executing getters',async()=>{
  const writes=[];
  const writer=createOrderedPositionWriter(async position=>{
    writes.push(position);
    return position;
  });
  let getterCalled=false;
  const accessor={y:20};
  Object.defineProperty(accessor,'x',{
    enumerable:true,
    get(){getterCalled=true;throw new Error('must not execute')}
  });

  await assert.rejects(writer(accessor),/finite bounded own coordinates/);
  assert.equal(getterCalled,false);
  assert.deepEqual(writes,[]);
});
