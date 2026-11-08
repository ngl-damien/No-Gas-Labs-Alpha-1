import test from 'node:test';
import assert from 'node:assert/strict';
import {isWalkable,findRoute,stepPlayer,WorldView,PLACES,institutionActivityCount} from '../game/world-view.mjs';

function makeView(t) {
  let modalOpen=false;
  const document={hidden:false,body:{classList:{contains:name=>name==='modal-open'&&modalOpen}},getElementById:()=>null,
    addEventListener:()=>{},removeEventListener:()=>{}};
  const windowListeners=new Map();
  const globals={document,devicePixelRatio:1,
    addEventListener:(name,listener)=>windowListeners.set(name,listener),
    removeEventListener:(name,listener)=>{if(windowListeners.get(name)===listener)windowListeners.delete(name);},
    requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{},
    ResizeObserver:class{observe(){}disconnect(){}}};
  const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  Object.assign(globalThis,globals);
  const interactions=[],positions=[],discoveries=[];
  const canvas={getContext:()=>({}),getBoundingClientRect:()=>({width:1000,height:700}),addEventListener:()=>{},removeEventListener:()=>{}};
  const view=new WorldView(canvas,{onInteract:place=>interactions.push(place),onDiscover:locationId=>discoveries.push(locationId),onPosition:position=>positions.push(position)});
  t.after(()=>{view.destroy();for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  return {view,interactions,positions,discoveries,document,dispatchWindow:name=>windowListeners.get(name)?.(),setModalOpen:value=>{modalOpen=value;}};
}

test('rehydrated guide discoveries use composite actor identity and remain independently discoverable',t=>{
  const {view,discoveries}=makeView(t);
  const witness={id:'actor-a',role:'witness'};
  const founder={id:'actor-b',role:'founder'};
  const sameIdFounder={id:'actor-a',role:'founder'};
  const world={creations:[],discoveries:[
    {id:'discovery-a-river',locationId:'river',actor:witness},
    {id:'discovery-b-overlook',locationId:'overlook',actor:founder},
    {id:'discovery-a-founder-ruins',locationId:'ruins',actor:sameIdFounder},
    {id:'discovery-a-unknown',locationId:'not-a-guide',actor:witness}
  ]};
  view.setWorld(world,null,witness);
  assert.deepEqual([...view.discovered],['river']);
  view.setPlayer({id:witness.id,x:910,y:665});
  view.update(.045,45);
  assert.deepEqual(discoveries,[],'a retained visit must not be submitted again after re-entry');

  view.setWorld(world,null,founder);
  assert.deepEqual([...view.discovered],['overlook'],'another actor receives only their own retained discoveries');
  view.setPlayer({id:founder.id,x:910,y:665});
  view.update(.045,90);
  assert.deepEqual(discoveries,['river'],'another actor must still discover the same guide independently');

  view.setWorld(world,null,sameIdFounder);
  assert.deepEqual([...view.discovered],['ruins'],
    'the same pseudonymous ID under a different role must not inherit the Witness discovery');
  view.setPlayer({id:sameIdFounder.id,x:910,y:665});
  view.update(.045,135);
  assert.deepEqual(discoveries,['river','river'],
    'a same-ID/different-role actor can independently discover the location');
});

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
  const {view,interactions,positions}=makeView(t);
  view.goTo('workbench');
  view.setInput({x:1,y:0});
  view.update(.045,45);
  view.setInput({x:0,y:0});
  view.update(.045,90);
  assert.deepEqual(interactions,[]);
  assert.equal(positions.length,1,'releasing touch movement immediately reports the final location');
  assert.ok(positions[0].x>180,'the reported location is the moved player position');
});


test('keyboard movement reports the final player position as soon as movement stops',t=>{
  const {view,positions}=makeView(t);
  view.onKeyDown({key:'d',preventDefault(){}});
  view.update(.045,45);
  view.onKeyUp({key:'d'});
  view.update(.045,90);
  assert.equal(positions.length,1);
  assert.ok(positions[0].x>180);
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

test('mobile focus and visibility interruptions pause and resume a route without discarding its destination',t=>{
  const {view,interactions,positions,document,dispatchWindow}=makeView(t);
  view.setPlayer({x:1180,y:245});
  view.goTo('source_observatory');
  const route=[...view.route];
  assert.ok(route.length>0,'the Observatory destination has a real route');

  dispatchWindow('blur');
  assert.equal(view.paused,true,'window blur pauses movement');
  assert.equal(view.target,'source_observatory','window blur preserves the chosen destination');
  assert.deepEqual(view.route,route,'window blur preserves the remaining route');
  assert.ok(positions.length>=1,'the current position is persisted before pausing');

  dispatchWindow('focus');
  assert.equal(view.paused,false,'window focus resumes the world');
  assert.equal(view.target,'source_observatory');
  assert.deepEqual(view.route,route);

  document.hidden=true;
  view.onVisibilityChange();
  assert.equal(view.paused,true,'backgrounding pauses movement without discarding the destination');
  assert.deepEqual(view.route,route);
  document.hidden=false;
  view.onVisibilityChange();
  assert.equal(view.paused,false,'returning to the visible world resumes the route');

  for(let i=0;i<20;i++)view.update(.045,i*45);
  assert.deepEqual(interactions,[{type:'institution',id:'source_observatory'}],
    'resumed navigation still dispatches exactly one real arrival interaction');
});

test('an institutional modal still cancels a pending destination',t=>{
  const {view,setModalOpen}=makeView(t);
  view.setPlayer({x:1180,y:245});
  view.goTo('source_observatory');
  assert.ok(view.route.length>0);
  setModalOpen(true);
  view.syncLifecycle();
  assert.equal(view.paused,true);
  assert.deepEqual(view.route,[],'a modal interruption cancels stale navigation intent');
  assert.equal(view.target,null);
});
test('TownSquare is an accessible institutional destination rather than a fabricated game achievement',t=>{
 const {view,interactions}=makeView(t);view.setPlayer({x:1000,y:500});view.goTo('town-square');
 for(let i=0;i<80;i++)view.update(.045,i*45);
 assert.deepEqual(interactions,[{type:'institution',id:'town-square'}]);
});
test('Source Observatory is an accessible research workbench destination, not a fabricated achievement',t=>{
 const {view,interactions}=makeView(t);view.setPlayer({x:1180,y:245});view.goTo('source_observatory');
 for(let i=0;i<80;i++)view.update(.045,i*45);
 assert.deepEqual(interactions,[{type:'institution',id:'source_observatory'}]);
});
test('the playable map exposes every institutional function as a real destination',()=>{
 const expected=['guild_hall','council_chamber','forge','evidence_archive','source_observatory','decision_chamber','town-square','quest_board','academy','moonshot_field','publication_house'].sort();
 const institutions=PLACES.filter(place=>place.type==='institution');
 assert.deepEqual(institutions.map(place=>place.id).sort(),expected);
 assert.ok(institutions.every(place=>typeof place.purpose==='string'&&place.purpose.length>20));
 assert.ok(institutions.every(place=>Number.isFinite(place.x)&&Number.isFinite(place.y)));
 const council=institutions.find(place=>place.id==='council_chamber');
 assert.match(council.purpose,/deliberation only, never consensus or authority/);
 const archive=institutions.find(place=>place.id==='evidence_archive');
 assert.match(archive.purpose,/Source Observatory notes, challenges, author responses/);
 const observatory=institutions.find(place=>place.id==='source_observatory');
 assert.match(observatory.purpose,/falsifiable, actor-attributed research notes/);
});
test('institution activity labels are deterministic projections of uniquely identified event records',()=>{
 const world={events:[
  {id:'e-proposal',type:'proposal'},{id:'e-draft',type:'draft'},{id:'e-repair',type:'repair'},
  {id:'e-report',type:'report'},{id:'e-decision',type:'decision'},{id:'e-contribute',type:'contribute'},
  {id:'e-learning',type:'learning'},{id:'e-experiment',type:'experiment'},{id:'e-publish',type:'publish'},
  {id:'e-source-note',type:'source-observation-recorded'},
  {id:'e-source-challenge',type:'source-observation-challenged'},
  {id:'e-source-response',type:'source-observation-challenge-responded'}
 ]};
 assert.equal(institutionActivityCount('guild_hall',world),1);
 assert.equal(institutionActivityCount('forge',world),3,'Forge includes publication as the final artifact-lifecycle step');
 assert.equal(institutionActivityCount('evidence_archive',world),6,'archive includes contributions, reports, publications and all retained Source Observatory activity');
 assert.equal(institutionActivityCount('source_observatory',world),3,'the workbench counts only retained Source Observation notes, challenges and responses');
 assert.equal(institutionActivityCount('decision_chamber',world),1);
 assert.equal(institutionActivityCount('town-square',world),2,'TownSquare includes contributions and public reports');
 assert.equal(institutionActivityCount('academy',world),1);
 assert.equal(institutionActivityCount('moonshot_field',world),1);
 assert.equal(institutionActivityCount('publication_house',world),1);
 assert.equal(institutionActivityCount('unknown',world),0);
 assert.equal(institutionActivityCount('forge',{events:[]}),0);
 const duplicateSourceEvent={id:'same-source-event',type:'source-observation-recorded'};
 const ambiguousSourceHistory={events:[duplicateSourceEvent,{...duplicateSourceEvent,type:'source-observation-challenged'},{id:'unique-source-response',type:'source-observation-challenge-responded'}]};
 assert.equal(institutionActivityCount('evidence_archive',ambiguousSourceHistory),1,
  'duplicate source-event identities remain ambiguous and cannot inflate the Archive count');
 assert.equal(institutionActivityCount('source_observatory',ambiguousSourceHistory),1,
  'the workbench uses the same unique-event rule as the Archive');
 const donorHistory={history:[
  {event_id:'d-proposal',event_type:'PROPOSAL'},{event_id:'d-moonshot',event_type:'MOONSHOT'},
  {event_id:'d-rejected',admission:'REJECTED'},{event_id:'d-failed',outcome:'FAILED'}
 ]};
 assert.equal(institutionActivityCount('guild_hall',donorHistory),1,'recovered proposal events remain visible');
 assert.equal(institutionActivityCount('moonshot_field',donorHistory),1,'recovered moonshot events remain visible');
 assert.equal(institutionActivityCount('evidence_archive',donorHistory),2,'rejections and failures remain visible in the archive');
 assert.equal(institutionActivityCount('town-square',{events:[{type:'contribute'}]}),0,'unidentified claims do not inflate visible activity');
});

test('Council Chamber activity counts only unique retained collaborator-response attempts',()=>{
 const response={id:'council-response-1',type:'collaborator-response-recorded'};
 assert.equal(institutionActivityCount('council_chamber',{events:[response]}),1);
 assert.equal(institutionActivityCount('council_chamber',{events:[response,{...response,role:'adversary'}]}),0,
  'ambiguous duplicate event identities must not inflate the Council Chamber count');
 assert.equal(institutionActivityCount('council_chamber',{events:[{type:'collaborator-response-recorded'}]}),0,
  'unidentified response claims are not retained activity');
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


test('active destination is replanned when a new creation changes walkability',t=>{
  const {view,interactions}=makeView(t);
  view.goTo('forge');
  assert.equal(view.target,'forge');
  view.setWorld({creations:[{id:'new-obstacle',position:{x:260,y:600}}]});
  assert.equal(view.target,'forge','a still-reachable destination keeps its intent');
  assert.ok(view.route.length>0,'the route is recomputed around the new obstacle');
  assert.ok(view.route.every(point=>isWalkable(point.x,point.y,view.world.creations)),'the replacement route respects current collision geometry');
  for(let i=0;i<100;i++)view.update(.045,i*45);
  assert.deepEqual(interactions,[{type:'institution',id:'forge'}],'the reachable destination opens exactly once');
});


test('every institutional landmark is reachable and dispatches exactly once from spawn',t=>{
  const {view,interactions}=makeView(t);
  const institutions=PLACES.filter(place=>place.type==='institution');
  assert.equal(institutions.length,11);
  for(const place of institutions){
    view.setPlayer({x:180,y:640});
    view.setWorld({creations:[]});
    view.goTo(place.id);
    for(let i=0;i<500;i++)view.update(.045,i*45);
    assert.deepEqual(interactions,[{type:'institution',id:place.id}],place.id+' must be reachable and dispatch exactly once');
    interactions.length=0;
  }
});


test('world activity counts refresh when a new world projection is supplied', t => {
  const { view } = makeView(t);

  view.setWorld({
    events: [
      { id: 'contribution-1', type: 'contribute' },
      { id: 'report-1', type: 'report' },
    ],
  });
  assert.equal(view.institutionCounts['town-square'], 2);
  assert.equal(view.institutionCounts.evidence_archive, 2);

  view.setWorld({
    history: [{ event_id: 'donor-comment-1', event_type: 'PUBLIC_COMMENT' }],
  });
  assert.equal(view.institutionCounts['town-square'], 1);
  assert.equal(view.institutionCounts.evidence_archive, 0);
});


function makeLifecycleView(t, { entryVisible = false } = {}) {
  let modalOpen = false;
  let nextFrameId = 0;
  const frames = new Map();
  const documentListeners = new Map();
  const mutationObservers = [];
  const views = [];
  const doorway = { hidden: !entryVisible };
  const document = {
    hidden: false,
    body: { classList: { contains: name => name === 'modal-open' && modalOpen } },
    getElementById: id => id === 'doorway' ? doorway : null,
    addEventListener: (name, listener) => {
      const listeners = documentListeners.get(name) || new Set();
      listeners.add(listener);
      documentListeners.set(name, listeners);
    },
    removeEventListener: (name, listener) => {
      const listeners = documentListeners.get(name);
      listeners?.delete(listener);
      if (listeners?.size === 0) documentListeners.delete(name);
    }
  };
  const globals = {
    document,
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: callback => {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: id => frames.delete(id),
    ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        this.targets = [];
        mutationObservers.push(this);
      }
      observe(target, options) {
        this.targets.push({ target, options });
      }
      disconnect() {
        this.disconnected = true;
      }
    }
  };
  const previous = new Map(Object.keys(globals).map(key => [
    key, Object.getOwnPropertyDescriptor(globalThis, key),
  ]));
  Object.assign(globalThis, globals);
  t.after(() => {
    for (const view of views.reverse()) view.destroy();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  const canvas = {
    getContext: () => ({}),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700 }),
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    removeAttribute: () => {},
    focus: () => {}
  };
  const positions = [];
  const view = new WorldView(canvas, { onPosition: position => positions.push(position) });
  views.push(view);
  return {
    view,
    positions,
    frames,
    document,
    doorway,
    documentListeners,
    mutationObservers,
    setModalOpen(value) {
      modalOpen = value;
      for (const observer of mutationObservers) {
        const observesBodyClass = observer.targets.some(({ target, options }) =>
          target === document.body && options.attributeFilter?.includes('class'));
        if (!observer.disconnected && observesBodyClass) observer.callback();
      }
    },
    setDoorwayVisible(value) {
      doorway.hidden = !value;
      for (const observer of mutationObservers) {
        const observesDoorwayHidden = observer.targets.some(({ target, options }) =>
          target === doorway && options.attributeFilter?.includes('hidden'));
        if (!observer.disconnected && observesDoorwayHidden) observer.callback();
      }
    },
    dispatchVisibility() {
      for (const listener of documentListeners.get('visibilitychange') || []) listener();
    }
  };
}

test('world rendering stays idle behind the entry doorway until the player enters', t => {
  const fixture = makeLifecycleView(t, { entryVisible: true });
  const { view, frames } = fixture;

  assert.equal(view.paused, true);
  assert.ok(fixture.mutationObservers.some(observer => observer.targets.some(({ target, options }) =>
    target === fixture.doorway && options.attributeFilter?.includes('hidden'))),
  'the lifecycle observer must watch the entry doorway hidden attribute');
  assert.equal(frames.size, 0, 'the entry screen must not run a hidden world animation loop');

  fixture.setDoorwayVisible(false);
  assert.equal(view.paused, false);
  assert.equal(frames.size, 1, 'entering the world starts exactly one frame loop');

  fixture.setDoorwayVisible(true);
  assert.equal(view.paused, true);
  assert.equal(frames.size, 0, 'showing the entry screen pauses the world again');

  fixture.document.hidden = true;
  fixture.dispatchVisibility();
  fixture.setDoorwayVisible(false);
  assert.equal(view.paused, true, 'hiding the doorway cannot resume a background WebView');

  fixture.document.hidden = false;
  fixture.dispatchVisibility();
  assert.equal(view.paused, false);
  assert.equal(frames.size, 1, 'the world resumes only when both the doorway is closed and the WebView is visible');

  view.destroy();
  assert.ok(fixture.mutationObservers.every(observer => observer.disconnected));
});

test('world animation pauses behind sheets and in the background without stale-frame duplication', t => {
  const fixture = makeLifecycleView(t);
  const { view, frames, positions } = fixture;
  assert.equal(view.paused, false);
  assert.equal(frames.size, 1, 'a visible world schedules one animation frame');

  let staleUpdates = 0;
  let staleRenders = 0;
  view.update = () => { staleUpdates += 1; };
  view.render = () => { staleRenders += 1; };
  const firstFrameId = view.animation;
  const staleFrame = frames.get(firstFrameId);
  view.moving = true;
  view.keys.add('d');
  view.input = { x: 1, y: 0 };
  view.route = [{ x: 250, y: 250 }];
  view.target = 'relay';

  fixture.setModalOpen(true);
  assert.equal(view.paused, true);
  assert.equal(view.animation, null);
  assert.equal(frames.size, 0, 'an open sheet cancels the world render loop');
  assert.equal(view.moving, false);
  assert.equal(view.keys.size, 0);
  assert.deepEqual(view.input, { x: 0, y: 0 });
  assert.deepEqual(view.route, []);
  assert.equal(positions.length, 1, 'pausing persists the last player position once');

  staleFrame(16);
  assert.equal(frames.size, 0, 'a stale callback cannot restart a paused world');

  fixture.setModalOpen(false);
  assert.equal(view.paused, false);
  assert.equal(frames.size, 1, 'closing the sheet resumes exactly one frame');
  const resumedFrameId = view.animation;
  fixture.setModalOpen(false);
  assert.equal(view.animation, resumedFrameId, 'repeated visibility signals do not duplicate frames');
  assert.equal(frames.size, 1);

  staleFrame(32);
  assert.equal(view.animation, resumedFrameId, 'an obsolete callback after resume cannot replace the new frame');
  assert.equal(frames.size, 1, 'an obsolete callback after resume cannot create a second loop');
  assert.equal(staleUpdates, 0, 'an obsolete callback after resume cannot advance the world');
  assert.equal(staleRenders, 0, 'an obsolete callback after resume cannot render another frame');

  fixture.document.hidden = true;
  fixture.dispatchVisibility();
  assert.equal(view.paused, true);
  assert.equal(view.animation, null);
  assert.equal(frames.size, 0, 'backgrounding the WebView pauses rendering');

  fixture.setModalOpen(true);
  fixture.setModalOpen(false);
  assert.equal(view.paused, true, 'closing a sheet cannot resume a still-hidden WebView');
  assert.equal(frames.size, 0);

  fixture.document.hidden = false;
  fixture.dispatchVisibility();
  assert.equal(view.paused, false);
  assert.equal(frames.size, 1, 'returning to a visible WebView resumes one frame');

  view.destroy();
  assert.equal(frames.size, 0);
  assert.ok(fixture.mutationObservers.every(observer => observer.disconnected));
  assert.equal(fixture.documentListeners.get('visibilitychange')?.size ?? 0, 0);
});


test('idle world renders on invalidation and keeps animation frames only while moving', t => {
  const fixture = makeLifecycleView(t);
  const { view, frames } = fixture;
  view.camera = view.cameraTarget();
  let updates = 0;
  let renders = 0;
  const frameDeltas = [];
  view.update = dt => { updates += 1; frameDeltas.push(dt); view.moving = false; };
  view.render = () => { renders += 1; };

  const runFrame = now => {
    const entry = frames.entries().next().value;
    assert.ok(entry, 'a requested redraw should have one pending frame');
    const [id, callback] = entry;
    frames.delete(id);
    callback(now);
  };

  assert.equal(frames.size, 1, 'entering a visible world schedules its initial draw');
  runFrame(16);
  assert.equal(updates, 1);
  assert.ok(Math.abs(frameDeltas[0] - 1 / 60) < 0.0001,
    'the first frame after an idle interval uses a fresh frame delta');
  assert.equal(renders, 1);
  assert.equal(frames.size, 0, 'an unchanged world must not keep a continuous requestAnimationFrame loop');

  view.setPresence([{ id: 'witness', x: 20, y: 30 }]);
  assert.equal(frames.size, 1, 'a presence update wakes one redraw');
  runFrame(32);
  assert.equal(frames.size, 0);

  view.setWorld({ creations: [] });
  assert.equal(frames.size, 1, 'a new world projection wakes one redraw');
  runFrame(48);
  assert.equal(frames.size, 0);

  view.resize();
  assert.equal(frames.size, 1, 'a viewport resize wakes one redraw');
  runFrame(64);
  assert.equal(frames.size, 0);

  let movementFrames = 0;
  view.update = () => {
    movementFrames += 1;
    view.moving = movementFrames < 3;
  };
  view.setInput({ x: 1, y: 0 });
  assert.equal(frames.size, 1, 'touch input wakes the renderer');
  runFrame(80);
  assert.equal(frames.size, 1, 'actual movement keeps the next frame scheduled');
  runFrame(96);
  assert.equal(frames.size, 1, 'the renderer continues while movement remains active');
  runFrame(112);
  assert.equal(frames.size, 0, 'the renderer sleeps as soon as movement stops');
  assert.equal(movementFrames, 3);
  assert.equal(view.previous, undefined, 'sleeping clears the old timestamp');

  view.update = dt => { frameDeltas.push(dt); view.moving = false; };
  view.setInput({ x: 1, y: 0 });
  runFrame(10000);
  assert.ok(Math.abs(frameDeltas.at(-1) - 1 / 60) < 0.0001,
    'a later input does not inherit time spent idle');
  assert.equal(frames.size, 0);
});

test('camera easing is the only idle animation and stops when the viewport settles', t => {
  const fixture = makeLifecycleView(t);
  const { view, frames } = fixture;
  view.camera = { x: 0, y: 0 };
  let renders = 0;
  view.render = () => { renders += 1; };

  let now = 16;
  let steps = 0;
  while (frames.size && steps < 200) {
    const entry = frames.entries().next().value;
    const [id, callback] = entry;
    frames.delete(id);
    callback(now);
    now += 16;
    steps += 1;
  }

  const desired = view.cameraTarget();
  assert.ok(steps > 1, 'camera easing needs more than the initial draw');
  assert.ok(steps < 200, 'camera easing must converge rather than spin indefinitely');
  assert.equal(frames.size, 0);
  assert.ok(Math.abs(view.camera.x - desired.x) <= 0.1);
  assert.ok(Math.abs(view.camera.y - desired.y) <= 0.1);
  assert.equal(renders, steps);
});
