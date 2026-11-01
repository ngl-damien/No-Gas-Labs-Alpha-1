import test from 'node:test';
import assert from 'node:assert/strict';
import {readPrivatePlayerPosition,writePrivatePlayerPosition} from '../game/player-position.mjs';
import {WorldView} from '../game/world-view.mjs';

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

test('malformed, old-schema and out-of-world positions are ignored',()=>{
  for(const value of ['{','null','[]',JSON.stringify({schema:'old',x:10,y:20}),JSON.stringify({schema:'ngl.player-position.v1',x:-1,y:20}),JSON.stringify({schema:'ngl.player-position.v1',x:20,y:1001}),JSON.stringify({schema:'ngl.player-position.v1',x:'20',y:30})]){
    assert.equal(readPrivatePlayerPosition(storage({[key]:value})),null);
  }
});

test('writes reject non-finite and out-of-bounds coordinates without changing saved position',()=>{
  const store=storage();
  assert.equal(writePrivatePlayerPosition({x:200,y:300},store),true);
  for(const value of [{x:NaN,y:3},{x:Infinity,y:3},{x:3,y:-1},{x:1601,y:3},null]){
    assert.equal(writePrivatePlayerPosition(value,store),false);
  }
  assert.deepEqual(readPrivatePlayerPosition(store),{x:200,y:300});
});

test('unavailable storage fails safely without throwing',()=>{
  const broken={getItem(){throw new Error('blocked')},setItem(){throw new Error('blocked')}};
  assert.equal(readPrivatePlayerPosition(broken),null);
  assert.equal(writePrivatePlayerPosition({x:10,y:10},broken),false);
});

test('accessor-backed coordinates are rejected without executing getters',()=>{
  let getterCalls=0;
  const position={y:20};
  Object.defineProperty(position,'x',{enumerable:true,get(){getterCalls+=1;throw new Error('coordinate getter executed');}});
  assert.equal(writePrivatePlayerPosition(position,storage()),false);
  assert.equal(getterCalls,0);
});

test('inherited, hidden, symbol-backed and extra coordinate fields are rejected',()=>{
  const inherited=Object.assign(Object.create({x:10}),{y:20});
  const hidden={x:10,y:20};
  Object.defineProperty(hidden,'note',{value:'not a coordinate',enumerable:false});
  const symbolBacked={x:10,y:20,[Symbol('metadata')]:true};
  for(const value of [inherited,hidden,symbolBacked,{x:10,y:20,z:30},[]]){
    assert.equal(writePrivatePlayerPosition(value,storage()),false);
  }
});

test('saved JSON must contain exactly its schema and two coordinate fields',()=>{
  for(const saved of [
    {schema:'ngl.player-position.v1',x:10,y:20,identity:'damien'},
    {schema:'ngl.player-position.v1',x:10,y:20,authority:'founder'},
    {schema:'ngl.player-position.v1',x:10,y:20,extra:null},
  ]){
    assert.equal(readPrivatePlayerPosition(storage({[key]:JSON.stringify(saved)})),null);
  }
});

test('runtime player identity is accepted as input but never persisted',()=>{
  const store=storage();
  assert.equal(writePrivatePlayerPosition({id:'private-founder',x:425,y:730},store),true);
  const raw=store.values.get(key);
  assert.deepEqual(JSON.parse(raw),{schema:'ngl.player-position.v1',x:425,y:730});
  assert.equal(Object.hasOwn(JSON.parse(raw),'id'),false);
});


function withWorldViewEnvironment(run){
  const names=['document','ResizeObserver','devicePixelRatio','matchMedia','requestAnimationFrame','cancelAnimationFrame','addEventListener','removeEventListener'];
  const previous=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const stubs={
    document:{body:{classList:{contains:()=>false}}},
    ResizeObserver:class{observe(){} disconnect(){}},
    devicePixelRatio:1,
    matchMedia:()=>({matches:false}),
    requestAnimationFrame:()=>1,
    cancelAnimationFrame:()=>{},
    addEventListener:()=>{},
    removeEventListener:()=>{}
  };
  for(const [name,value] of Object.entries(stubs)){
    Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  }
  const canvas={
    getContext:()=>({}),
    getBoundingClientRect:()=>({width:800,height:600}),
    addEventListener:()=>{},
    removeEventListener:()=>{}
  };
  try{return run(canvas)}
  finally{
    for(const name of names){
      const descriptor=previous.get(name);
      if(descriptor)Object.defineProperty(globalThis,name,descriptor);
      else delete globalThis[name];
    }
  }
}

test('last keyboard release synchronously persists the final stopped player position',()=>{
  withWorldViewEnvironment(canvas=>{
    const positions=[];
    const view=new WorldView(canvas,{onPosition:position=>positions.push(position)});
    try{
      view.onKeyDown({key:'d',target:null,repeat:false,preventDefault(){}});
      view.update(0.045,1600);
      assert.equal(positions.length,1,'the periodic moving-position receipt is recorded');
      const lastPeriodicPosition=positions[0];
      view.update(0.045,1650);
      const stoppedPosition=view.getPlayer();
      assert.ok(stoppedPosition.x>lastPeriodicPosition.x,'the live player moved after the last periodic receipt');
      assert.equal(positions.length,1);
      view.onKeyUp({key:'d'});
      assert.equal(positions.length,2,'the final key release writes immediately');
      assert.deepEqual(positions[1],stoppedPosition);
      view.update(0.045,1700);
      assert.equal(positions.length,2,'the next idle frame does not write a duplicate stop receipt');
    }finally{view.destroy()}
  });
});

test('keyboard release waits for other movement sources before persisting',()=>{
  withWorldViewEnvironment(canvas=>{
    const positions=[];
    const view=new WorldView(canvas,{onPosition:position=>positions.push(position)});
    try{
      view.onKeyDown({key:'d',target:null,repeat:false,preventDefault(){}});
      view.onKeyDown({key:'s',target:null,repeat:false,preventDefault(){}});
      view.update(0.045,100);
      view.onKeyUp({key:'d'});
      assert.equal(positions.length,0,'another movement key is still held');
      view.onKeyUp({key:'s'});
      assert.equal(positions.length,1,'the last held movement key persists the stopped position');

      view.setInput({x:1,y:0});
      view.onKeyDown({key:'d',target:null,repeat:false,preventDefault(){}});
      view.update(0.045,150);
      view.onKeyUp({key:'d'});
      assert.equal(positions.length,1,'active pointer movement is not mistaken for a stop');
      view.setInput({x:0,y:0});
      view.update(0.045,200);
      assert.equal(positions.length,2,'pointer release is persisted by the next movement frame');
    }finally{view.destroy()}
  });
});
