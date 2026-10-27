import test from 'node:test';
import assert from 'node:assert/strict';
import {isWalkable,findRoute,stepPlayer,WorldView,PLACES,institutionActivityCount} from '../game/world-view.mjs';

function makeView(t) {
  const globals={document:{body:{classList:{contains:()=>false}}},devicePixelRatio:1,
    addEventListener:()=>{},removeEventListener:()=>{},requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{},
    ResizeObserver:class{observe(){}disconnect(){}}};
  const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  Object.assign(globalThis,globals);
  const interactions=[];
  const canvas={getContext:()=>({}),getBoundingClientRect:()=>({width:1000,height:700}),addEventListener:()=>{},removeEventListener:()=>{}};
  const view=new WorldView(canvas,{onInteract:place=>interactions.push(place)});
  t.after(()=>{view.destroy();for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  return {view,interactions};
}

test('keyboard movement cancels a pending destination without opening it',t=>{
  const {view,interactions}=makeView(t);
  view.goTo('workbench');
  view.onKeyDown({key:'d',preventDefault(){}});
  const before=view.getPlayer();
  for(let i=0;i<5;i++)view.update(.045,i*45);
  assert.ok(view.getPlayer().x>before.x,'manual movement still moves the player');
  assert.deepEqual(interactions,[],'abandoned route must not count as arrival');
});

test('touch movement cancels a pending destination without opening it',t=>{
  const {view,interactions}=makeView(t);
  view.goTo('workbench');
  view.setInput({x:1,y:0});
  view.update(.045,45);
  view.setInput({x:0,y:0});
  view.update(.045,90);
  assert.deepEqual(interactions,[]);
});

test('restoring player coordinates cancels an old arrival target',t=>{
  const {view,interactions}=makeView(t);
  view.goTo('workbench');
  view.setPlayer({x:200,y:640});
  view.update(.045,45);
  assert.deepEqual(interactions,[]);
});

test('an uninterrupted route still interacts once when it reaches its destination',t=>{
  const {view,interactions}=makeView(t);
  view.setPlayer({x:280,y:700});
  view.goTo('workbench');
  view.setInput({x:0,y:0});
  for(let i=0;i<100;i++)view.update(.045,i*45);
  assert.deepEqual(interactions,[{type:'workbench',id:'workbench'}]);
});
test('TownSquare is an accessible institutional destination rather than a fabricated game achievement',t=>{
 const {view,interactions}=makeView(t);view.setPlayer({x:1000,y:500});view.goTo('town-square');
 for(let i=0;i<80;i++)view.update(.045,i*45);
 assert.deepEqual(interactions,[{type:'institution',id:'town-square'}]);
});
test('the playable map exposes all eight institutional functions as real destinations',()=>{
 const expected=['guild_hall','forge','evidence_archive','decision_chamber','town-square','academy','moonshot_field','publication_house'].sort();
 const institutions=PLACES.filter(place=>place.type==='institution');
 assert.deepEqual(institutions.map(place=>place.id).sort(),expected);
 assert.ok(institutions.every(place=>typeof place.purpose==='string'&&place.purpose.length>20));
 assert.ok(institutions.every(place=>Number.isFinite(place.x)&&Number.isFinite(place.y)));
});
test('institution activity labels are deterministic projections of retained event records',()=>{
 const world={events:[
  {type:'proposal'},{type:'draft'},{type:'repair'},{type:'report'},{type:'decision'},
  {type:'contribute'},{type:'learning'},{type:'experiment'},{type:'publish'}
 ]};
 assert.equal(institutionActivityCount('guild_hall',world),1);
 assert.equal(institutionActivityCount('forge',world),2);
 assert.equal(institutionActivityCount('evidence_archive',world),1);
 assert.equal(institutionActivityCount('decision_chamber',world),1);
 assert.equal(institutionActivityCount('town-square',world),1);
 assert.equal(institutionActivityCount('academy',world),1);
 assert.equal(institutionActivityCount('moonshot_field',world),1);
 assert.equal(institutionActivityCount('publication_house',world),1);
 assert.equal(institutionActivityCount('unknown',world),0);
 assert.equal(institutionActivityCount('forge',{events:[]}),0);
 const donorHistory={history:[{event_type:'PROPOSAL'},{event_type:'MOONSHOT'},{admission:'REJECTED'},{outcome:'FAILED'}]};
 assert.equal(institutionActivityCount('guild_hall',donorHistory),1,'recovered proposal events remain visible');
 assert.equal(institutionActivityCount('moonshot_field',donorHistory),1,'recovered moonshot events remain visible');
 assert.equal(institutionActivityCount('evidence_archive',donorHistory),2,'rejections and failures remain visible in the archive');
});
test('institutional destinations dispatch their own location identity',t=>{
 const {view,interactions}=makeView(t);
 const place=PLACES.find(item=>item.id==='evidence_archive');
 view.setPlayer({x:place.x,y:place.y+50});
 view.goTo(place.id);
 for(let i=0;i<30;i++)view.update(.045,i*45);
 assert.deepEqual(interactions,[{type:'institution',id:'evidence_archive'}]);
});
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


test('an unreachable named destination cannot dispatch an arrival',t=>{
  const {view,interactions}=makeView(t);
  const wall=Array.from({length:11},(_,index)=>({id:'wall-'+index,position:{x:100+index*140,y:500}}));
  view.setWorld({creations:wall});
  const start=view.getPlayer();
  view.goTo('relay');
  view.update(.045,45);
  assert.deepEqual(view.getPlayer(),start,'an unreachable route must not teleport or move the player');
  assert.deepEqual(interactions,[],'an unreachable route is not arrival evidence');
  assert.equal(view.target,null,'the impossible target is cleared');
});

test('an unknown destination cancels a previous route instead of preserving stale intent',t=>{
  const {view,interactions}=makeView(t);
  view.goTo('relay');
  assert.equal(view.target,'relay');
  view.goTo('not-a-place');
  assert.equal(view.target,null);
  assert.deepEqual(view.route,[]);
  for(let i=0;i<10;i++)view.update(.045,i*45);
  assert.deepEqual(interactions,[]);
});
