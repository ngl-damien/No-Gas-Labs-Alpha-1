import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrderedPositionWriter,createPositionWriteDeadline,isPositionRevisionConflict,readPrivatePlayerPosition,shouldApplyServerPosition,writePrivatePlayerPosition} from '../game/player-position.mjs';

function storage(initial={}){
  const values=new Map(Object.entries(initial));
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),values};
}
const key='ngl.common-ground.player-position.v1';


test('a stalled position transport is aborted at its deadline even when the transport ignores abort',async()=>{
  let fireDeadline,clearCalled=false,signal,releaseTransport;
  const writeWithDeadline=createPositionWriteDeadline((_position,options)=>{
    signal=options.signal;
    return new Promise(resolve=>{releaseTransport=resolve;});
  },{
    timeoutMs:25,
    schedule(callback){fireDeadline=callback;return 'position-deadline';},
    cancel(handle){assert.equal(handle,'position-deadline');clearCalled=true;}
  });

  const pending=writeWithDeadline({x:10,y:20});
  await Promise.resolve();
  assert.equal(typeof fireDeadline,'function');
  fireDeadline();

  await assert.rejects(pending,error=>error.code==='POSITION_WRITE_TIMEOUT');
  assert.equal(signal.aborted,true);
  assert.equal(clearCalled,true);
  releaseTransport({accepted:true});
});

test('a position transport that finishes before its deadline passes through and clears the timer',async()=>{
  let signal,clearCalled=false;
  const writeWithDeadline=createPositionWriteDeadline(async(_position,options)=>{
    signal=options.signal;
    return {position:{x:30,y:40}};
  },{
    timeoutMs:25,
    schedule(){return 'position-deadline';},
    cancel(handle){assert.equal(handle,'position-deadline');clearCalled=true;}
  });

  assert.deepEqual(await writeWithDeadline({x:30,y:40}),{position:{x:30,y:40}});
  assert.equal(signal.aborted,false);
  assert.equal(clearCalled,true);
});

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
  assert.deepEqual(writes,[{x:10,y:20}]);

  releases.shift()();
  assert.deepEqual(await first,{accepted:{x:10,y:20}});

  const second=writer({id:'actor-1',x:30,y:40});
  assert.deepEqual(writes,[{x:10,y:20},{x:30,y:40}]);
  releases.shift()();
  assert.deepEqual(await second,{accepted:{x:30,y:40}});

  const third=writer({x:50,y:60});
  assert.deepEqual(writes,[{x:10,y:20},{x:30,y:40},{x:50,y:60}]);
  releases.shift()();
  assert.deepEqual(await third,{accepted:{x:50,y:60}});
  assert.equal(maximumActive,1);
});

test('shared position writer coalesces a slow backlog to the newest coordinate',async()=>{
  const writes=[];
  const releases=[];
  const writer=createOrderedPositionWriter(async position=>{
    writes.push(position);
    await new Promise(resolve=>releases.push(resolve));
    return {accepted:position};
  });

  const first=writer({x:10,y:20});
  const queued=[];
  for(let index=0;index<1000;index+=1)queued.push(writer({x:11+index,y:20}));

  assert.deepEqual(writes,[{x:10,y:20}],
    'only the in-flight write is sent while the transport is blocked');
  const superseded=await Promise.all(queued.slice(0,-1));
  assert.equal(superseded.length,999);
  assert.ok(superseded.every(result=>result?.superseded===true),
    'every intermediate pending snapshot is explicitly superseded');

  releases.shift()();
  assert.deepEqual(await first,{accepted:{x:10,y:20}});
  assert.deepEqual(writes,[{x:10,y:20},{x:1010,y:20}],
    'the newest pending coordinate follows the in-flight write; 999 stale snapshots are not sent');

  releases.shift()();
  assert.deepEqual(await queued.at(-1),{accepted:{x:1010,y:20}});
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


test('only the exact server position-revision conflict is classified as recoverable',()=>{
  const conflict=Object.assign(new Error('stale accepted position'),{status:409,code:'POSITION_REVISION_CONFLICT'});
  assert.equal(isPositionRevisionConflict(conflict),true);
  for(const error of [
    Object.assign(new Error('movement rejected'),{status:409,code:'MOVEMENT_TOO_FAST'}),
    Object.assign(new Error('service unavailable'),{status:503,code:'POSITION_REVISION_CONFLICT'}),
    Object.assign(new Error('missing status'),{code:'POSITION_REVISION_CONFLICT'}),
    Object.assign(new Error('missing code'),{status:409}),
    new Error('message-only conflict'),
    null,
    'POSITION_REVISION_CONFLICT'
  ])assert.equal(isPositionRevisionConflict(error),false);
  const inherited=Object.create({status:409,code:'POSITION_REVISION_CONFLICT'});
  assert.equal(isPositionRevisionConflict(inherited),false);
  const accessor={};
  Object.defineProperty(accessor,'status',{get(){throw new Error('must not execute')}});
  Object.defineProperty(accessor,'code',{value:'POSITION_REVISION_CONFLICT'});
  assert.equal(isPositionRevisionConflict(accessor),false);
});

test('offline pause cancels queued snapshots and waits for the in-flight write before reconciliation',async()=>{
  const writes=[];
  const releases=[];
  const writer=createOrderedPositionWriter(async position=>{
    writes.push(position);
    await new Promise(resolve=>releases.push(resolve));
    return {accepted:position};
  });

  const inFlight=writer({x:10,y:20});
  const queued=writer({x:30,y:40});
  let idleResolved=false;
  const idle=writer.whenIdle().then(()=>{idleResolved=true;});

  assert.deepEqual(writes,[{x:10,y:20}]);
  assert.equal(writer.cancelPending(),1);
  assert.deepEqual(await queued,{superseded:true});
  await Promise.resolve();
  assert.equal(idleResolved,false,'reconciliation must wait for the in-flight request to settle');

  releases.shift()();
  assert.deepEqual(await inFlight,{accepted:{x:10,y:20}});
  await idle;
  assert.equal(idleResolved,true);
  assert.deepEqual(writes,[{x:10,y:20}],'the queued stale coordinate must never reach transport');

  const fresh=writer({x:50,y:60});
  assert.deepEqual(writes,[{x:10,y:20},{x:50,y:60}],
    'a fresh coordinate is allowed after the accepted-position stream is reconciled');
  releases.shift()();
  assert.deepEqual(await fresh,{accepted:{x:50,y:60}});
  await writer.whenIdle();
});

test('a new presence session uses its own server position even while the previous actor was moving',()=>{
  assert.equal(shouldApplyServerPosition({
    previousSessionId:'presence-old',
    nextSessionId:'presence-new',
    moving:true,
    routeActive:true
  }),true,'a new session must not inherit the previous session route gate');
  assert.equal(shouldApplyServerPosition({
    previousSessionId:'presence-old',
    nextSessionId:'presence-old',
    moving:true,
    routeActive:true
  }),false,'same-session movement keeps the existing route position');
  assert.equal(shouldApplyServerPosition({
    previousSessionId:'presence-old',
    nextSessionId:'presence-old',
    moving:false,
    routeActive:false
  }),true,'an idle same-session view accepts the server position');
  assert.equal(shouldApplyServerPosition({
    previousSessionId:'presence-old',
    nextSessionId:'presence-new',
    staleSnapshot:true,
    moving:true,
    routeActive:true
  }),false,'a stale position snapshot remains rejected even across an identity change');
  assert.equal(shouldApplyServerPosition({
    previousSessionId:'presence-old',
    nextSessionId:'presence-old',
    forcePosition:true,
    moving:true,
    routeActive:true
  }),true,'an explicit forced reconciliation remains supported');
});
