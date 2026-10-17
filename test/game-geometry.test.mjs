import test from 'node:test';
import assert from 'node:assert/strict';
import {isWalkable,findRoute,stepPlayer} from '../game/world-view.mjs';
test('river is real collision with two walkable bridges and bounded world',()=>{
  assert.equal(isWalkable(850,450,[]),false);
  assert.equal(isWalkable(850,360,[]),true);
  assert.equal(isWalkable(850,720,[]),true);
  assert.equal(isWalkable(-10,500,[]),false);
  assert.equal(isWalkable(1601,500,[]),false);
});
test('a route between banks crosses a bridge without entering water',()=>{
  const route=findRoute({x:700,y:500},{x:1040,y:500},[]);
  assert.ok(route.length>2);
  for(const p of route)assert.equal(isWalkable(p.x,p.y,[]),true);
  assert.ok(route.some(p=>p.x>800&&p.x<930&&(p.y<400||p.y>680)));
});
test('new creations physically block movement and routes go around them',()=>{
  const buildings=[{id:'c',position:{x:550,y:600}}];
  assert.equal(isWalkable(550,600,buildings),false);
  const route=findRoute({x:430,y:600},{x:680,y:600},buildings);
  assert.ok(route.length>2);
  assert.ok(route.every(p=>isWalkable(p.x,p.y,buildings)));
  assert.deepEqual(stepPlayer({x:475,y:600},{x:1,y:0},10,buildings),{x:475,y:600});
});
test('routing from a bank edge never rounds the player into water',()=>{
  const start={x:790,y:450};assert.equal(isWalkable(start.x,start.y),true);
  const route=findRoute(start,{x:1000,y:450},[]);
  assert.ok(route.length>2);
  assert.ok(route.every(p=>isWalkable(p.x,p.y,[])));
});
