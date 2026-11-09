import test from 'node:test';
import assert from 'node:assert/strict';
import {readPrivatePlayerPosition,writePrivatePlayerPosition} from '../game/player-position.mjs';

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
