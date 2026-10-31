import test from 'node:test';
import assert from 'node:assert/strict';
import {isWalkable,findRoute,stepPlayer,WorldView,PLACES,GUILD_NPCS,institutionActivityCount} from '../game/world-view.mjs';
import {COLLABORATOR_ROLES} from '../game/collaborator-contracts.mjs';
import {projectCollaboratorResponseWorldObjects} from '../game/collaborator-world-objects.mjs';
import {createWorld} from '../game/model.mjs';
import {getActiveQuest,getQuestTrail} from '../game/quests.mjs';

function makeView(t) {
  const globals={document:{body:{classList:{contains:()=>false}}},devicePixelRatio:1,
    addEventListener:()=>{},removeEventListener:()=>{},requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{},
    ResizeObserver:class{observe(){}disconnect(){}}};
  const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  Object.assign(globalThis,globals);
  const interactions=[],positions=[],discoveries=[],attributes=new Map();
  const canvas={getContext:()=>({}),getBoundingClientRect:()=>({left:0,top:0,width:1000,height:700}),addEventListener:()=>{},removeEventListener:()=>{},setAttribute:(key,value)=>attributes.set(key,String(value)),getAttribute:key=>attributes.get(key)??null,removeAttribute:key=>attributes.delete(key),focus:()=>{}};
  const view=new WorldView(canvas,{onInteract:place=>interactions.push(place),onDiscover:id=>discoveries.push(id),onPosition:position=>positions.push(position)});
  t.after(()=>{view.destroy();for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  return {view,interactions,positions,discoveries,canvas};
}

test('the map pennant projects the next actor-scoped Questkeeper objective without changing the world',t=>{
 const world=createWorld({id:'quest-map-world',now:'2026-10-31T12:40:00.000Z'});
 const fixtures=[
  {viewer:{id:'founder-map',role:'founder'},target:'workbench',destination:'The Making Bench'},
  {viewer:{id:'witness-map',role:'witness'},target:'relay',destination:'The Relay'}
 ];
 for(const fixture of fixtures){
  const before=structuredClone(world),trail=getQuestTrail(world,fixture.viewer),quest=getActiveQuest(world,fixture.viewer,trail);
  const action=quest.action==='trail'?quest.nextAction:trail.find(item=>!item.complete)?.action||null;
  const {view,canvas}=makeView(t);
  view.setWorld(world);view.setQuestAction(action,quest.title);
  assert.equal(view.questMarker?.targetId,fixture.target);
  assert.equal(canvas.getAttribute('data-quest-marker'),'visible');
  assert.equal(canvas.getAttribute('data-quest-target-id'),fixture.target);
  assert.equal(canvas.getAttribute('data-quest-title'),quest.title);
  assert.equal(canvas.getAttribute('data-quest-destination'),fixture.destination);
  assert.match(canvas.getAttribute('aria-label'),new RegExp(fixture.destination));
  assert.deepEqual(world,before,'map projection must not mutate retained world state');
  view.setQuestAction(null,'');
  assert.equal(view.questMarker,null);
  assert.equal(canvas.getAttribute('data-quest-target-id'),null);
  assert.match(canvas.getAttribute('aria-label'),/^The Common Ground\./);
 }
});

test('tapping the active quest pennant routes to the real destination but does not itself record discovery',t=>{
 const world=createWorld({id:'quest-map-route-world',now:'2026-10-31T12:40:00.000Z'});
 const viewer={id:'witness-map-route',role:'witness'},trail=getQuestTrail(world,viewer),quest=getActiveQuest(world,viewer,trail);
 const action=quest.action==='trail'?quest.nextAction:trail.find(item=>!item.complete)?.action||null;
 const {view,canvas,discoveries,interactions}=makeView(t);
 view.setWorld(world);view.setQuestAction(action,quest.title);view.setPlayer({x:650,y:330});
 const marker=view.questMarker,rect=canvas.getBoundingClientRect();
 const pointer={clientX:rect.left+view.width/2+(marker.x-view.camera.x)*view.zoom,
  clientY:rect.top+view.height/2+(marker.y-view.camera.y)*view.zoom};
 view.onPointer(pointer);
 assert.equal(view.target,'relay');
 assert.deepEqual(discoveries,[],'the marker tap is navigation, not discovery');
 assert.deepEqual(interactions,[]);
 assert.deepEqual(world.events,[]);
 for(let step=0;step<60&&(view.route.length||view.target);step++)view.update(.045,step*45);
 assert.deepEqual(discoveries,['relay'],'discovery occurs only after the player physically approaches the location');
 assert.deepEqual(interactions,[{type:'discovery',id:'relay'}]);
 assert.deepEqual(world.events,[],'the map renderer dispatches activity but never appends canonical events');
});

test('quest pennants resolve retained creations and only map-visible research or collaborator records',t=>{
 const world=createWorld({id:'quest-map-objects-world',now:'2026-10-31T12:40:00.000Z'});
 world.creations.push({id:'retained-place',title:'A retained place',kind:'comic',version:1,position:{x:700,y:520}});
 const {view}=makeView(t);view.setWorld(world);
 view.setQuestAction({type:'creation',id:'retained-place',version:1},'Leave a field note');
 assert.equal(view.questMarker?.targetId,'retained-place');
 assert.equal(view.questMarker?.destination,'A retained place');
 view.researchObjects=[{id:'moonshot-object',moonshotId:'moonshot-1',title:'A falsifiable question',x:900,y:400}];
 view.setQuestAction({type:'research-object',id:'moonshot-object',moonshotId:'moonshot-1'},'Record an experiment attempt');
 assert.equal(view.questMarker?.targetId,'moonshot-object');
 assert.equal(view.questMarker?.targetType,'research-object');
 view.researchActivityObjects=[{id:'attempt-object',moonshotId:'moonshot-1',activityId:'report-1',title:'Attempt report',x:980,y:440,mapVisible:true}];
 view.setQuestAction({type:'research-activity',id:'attempt-object',moonshotId:'moonshot-1',activityId:'report-1'},'Link a retained artifact');
 assert.equal(view.questMarker?.targetId,'attempt-object');
 assert.equal(view.questMarker?.targetType,'research-activity');
 view.researchActivityObjects[0].mapVisible=false;
 assert.equal(view.setQuestAction({type:'research-activity',id:'attempt-object',moonshotId:'moonshot-1',activityId:'report-1'},'Link a retained artifact'),null);
 view.collaboratorResponseObjects=[{id:'response-object',responseId:'response-1',name:'Rejected response',x:220,y:220,mapVisible:true}];
 view.setQuestAction({type:'collaborator-response',id:'response-1'},'Preserve a bounded response');
 assert.equal(view.questMarker?.targetId,'response-object');
 assert.equal(view.questMarker?.targetType,'collaborator-response');
 view.collaboratorResponseObjects[0].mapVisible=false;
 assert.equal(view.setQuestAction({type:'collaborator-response',id:'response-1'},'Preserve a bounded response'),null);
 assert.deepEqual(world.events,[],'map object projection must not create research, response, or progress events');
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
test('TownSquare is an accessible institutional destination rather than a fabricated game achievement',t=>{
 const {view,interactions}=makeView(t);view.setPlayer({x:1000,y:500});view.goTo('town-square');
 for(let i=0;i<80;i++)view.update(.045,i*45);
 assert.deepEqual(interactions,[{type:'institution',id:'town-square'}]);
});
test('the playable map exposes all nine institutional functions as real destinations',()=>{
 const expected=['guild_hall','forge','evidence_archive','decision_chamber','town-square','commons','academy','moonshot_field','publication_house'].sort();
 const institutions=PLACES.filter(place=>place.type==='institution');
 assert.deepEqual(institutions.map(place=>place.id).sort(),expected);
 assert.ok(institutions.every(place=>typeof place.purpose==='string'&&place.purpose.length>20));
 assert.ok(institutions.every(place=>Number.isFinite(place.x)&&Number.isFinite(place.y)));
});

test('Guild Hall NPCs are the exact bounded collaborator roles and stay within the playable map',()=>{
 assert.deepEqual(GUILD_NPCS.map(npc=>npc.roleId),COLLABORATOR_ROLES.map(role=>role.id));
 assert.equal(new Set(GUILD_NPCS.map(npc=>npc.id)).size,GUILD_NPCS.length);
 assert.ok(GUILD_NPCS.every(npc=>npc.id==='guild-npc-'+npc.roleId&&npc.name&&npc.objective));
 assert.ok(GUILD_NPCS.every(npc=>npc.x>24&&npc.x<1576&&npc.y>28&&npc.y<972));
});

test('each Guild Hall NPC is a reachable map destination and dispatches only its own role',t=>{
 const {view,interactions}=makeView(t);
 for(const npc of GUILD_NPCS){
  view.setPlayer({x:180,y:640});
  view.setWorld({creations:[]});
  view.goTo(npc.id);
  assert.equal(view.target,npc.id,npc.name+' route should be accepted');
  for(let step=0;step<500&&!interactions.length;step++)view.update(.045,step*45);
  assert.deepEqual(interactions,[{type:'collaborator',id:npc.id,roleId:npc.roleId}],npc.name+' must open its own bounded role');
  interactions.length=0;
 }
});

test('a nearby Guild Hall NPC can be spoken to without recording discovery or progress',t=>{
 const {view,interactions}=makeView(t);
 const npc=GUILD_NPCS[0];
 view.setPlayer({x:npc.x,y:npc.y+10});
 view.interact(npc.id,'collaborator');
 assert.deepEqual(interactions,[{type:'collaborator',id:npc.id,roleId:npc.roleId}]);
 assert.deepEqual(view.world,{creations:[],discoveries:[]});
});

test('institution activity labels are deterministic projections of uniquely identified event records',()=>{
 const world={events:[
  {id:'e-proposal',type:'proposal'},{id:'e-draft',type:'draft'},{id:'e-repair',type:'repair'},
  {id:'e-report',type:'report'},{id:'e-decision',type:'decision'},{id:'e-contribute',type:'contribute'},
  {id:'e-learning',type:'learning'},{id:'e-experiment',type:'experiment'},{id:'e-publish',type:'publish'},{id:'e-commons-post',type:'message-posted'},{id:'e-commons-report',type:'message-reported'},{id:'e-commons-mod',type:'message-moderated'}
 ]};
 assert.equal(institutionActivityCount('guild_hall',world),1);
 assert.equal(institutionActivityCount('forge',world),3,'Forge includes publication as the final artifact-lifecycle step');
 assert.equal(institutionActivityCount('evidence_archive',world),3,'archive includes contributions, reports and retained publications');
 assert.equal(institutionActivityCount('decision_chamber',world),1);
 assert.equal(institutionActivityCount('town-square',world),2,'TownSquare includes contributions and public reports');
 assert.equal(institutionActivityCount('commons',world),3,'The Commons counts retained posts, reports, and moderation decisions.');
 assert.equal(institutionActivityCount('academy',world),1);
 assert.equal(institutionActivityCount('moonshot_field',world),1);
 assert.equal(institutionActivityCount('publication_house',world),1);
 assert.equal(institutionActivityCount('unknown',world),0);
 assert.equal(institutionActivityCount('forge',{events:[]}),0);
 const donorHistory={history:[
  {event_id:'d-proposal',event_type:'PROPOSAL'},{event_id:'d-moonshot',event_type:'MOONSHOT'},
  {event_id:'d-rejected',admission:'REJECTED'},{event_id:'d-failed',outcome:'FAILED'}
 ]};
 assert.equal(institutionActivityCount('guild_hall',donorHistory),1,'recovered proposal events remain visible');
 assert.equal(institutionActivityCount('moonshot_field',donorHistory),1,'recovered moonshot events remain visible');
 assert.equal(institutionActivityCount('evidence_archive',donorHistory),2,'rejections and failures remain visible in the archive');
 assert.equal(institutionActivityCount('town-square',{events:[{type:'contribute'}]}),0,'unidentified claims do not inflate visible activity');
});
test('institutional destinations dispatch their own location identity',t=>{
 const {view,interactions}=makeView(t);
 const place=PLACES.find(item=>item.id==='evidence_archive');
 view.setPlayer({x:place.x,y:place.y+50});
 view.goTo(place.id);
 for(let i=0;i<30;i++)view.update(.045,i*45);
 assert.deepEqual(interactions,[{type:'institution',id:'evidence_archive'}]);
});
test('fixed institutional buildings are physical obstacles with reachable front approaches',()=>{
  const landmarks=[...PLACES.filter(place=>place.type==='institution'),PLACES.find(place=>place.id==='workbench')];
  for(const place of landmarks){
    assert.equal(isWalkable(place.x,place.y,[]),false,place.name+' footprint must block movement');
    assert.equal(isWalkable(place.x,place.y+50,[]),true,place.name+' front approach must remain walkable');
    const route=findRoute({x:180,y:640},{x:place.x,y:place.y+50},[]);
    assert.ok(route.length>1,place.name+' must remain reachable from spawn');
    assert.ok(route.every(point=>isWalkable(point.x,point.y,[])),place.name+' route must avoid water and buildings');
  }
});

test('restoring a legacy position inside a fixed landmark rehomes to a safe tile',t=>{
  const {view}=makeView(t);
  view.setPlayer({x:230,y:170});
  const recovered=view.getPlayer();
  assert.notDeepEqual(recovered,{x:230,y:170});
  assert.equal(isWalkable(recovered.x,recovered.y,[]),true);
});

test('a newly published building cannot trap a player at the previous position',t=>{
  const {view}=makeView(t);
  view.setPlayer({x:550,y:600});
  view.setWorld({creations:[{id:'new-building',position:{x:550,y:600}}]});
  const recovered=view.getPlayer();
  assert.notDeepEqual(recovered,{x:550,y:600});
  assert.equal(isWalkable(recovered.x,recovered.y,view.world.creations),true);
});

test('non-finite map positions and route targets fail closed',()=>{
  assert.equal(isWalkable(NaN,200,[]),false);
  assert.equal(isWalkable(200,Infinity,[]),false);
  assert.deepEqual(findRoute({x:NaN,y:200},{x:300,y:300},[]),[]);
  assert.deepEqual(findRoute({x:200,y:200},{x:300,y:Infinity},[]),[]);
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
  assert.equal(institutions.length,9);
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


test('map only reuses a Relay projection sealed to the exact world snapshot', t => {
  const {view} = makeView(t);
  const world = { id: 'map-projection-world', revision: 0, creations: [], events: [] };
  const foreignWorld = { id: 'other-map-world', revision: 0, creations: [], events: [] };
  const foreignProjection = projectCollaboratorResponseWorldObjects(foreignWorld);
  const forgedProjection = Object.freeze([{ id: 'forged-folio', mapVisible: true, x: 610, y: 205 }]);

  view.setWorld(world, null, foreignProjection);
  assert.deepEqual(view.collaboratorResponseObjects, [], 'a projection from another world is recomputed, not replayed');
  view.setWorld(world, null, forgedProjection);
  assert.deepEqual(view.collaboratorResponseObjects, [], 'a caller-created array cannot add a map object');
  const ownProjection = projectCollaboratorResponseWorldObjects(world);
  view.setWorld(world, null, ownProjection);
  assert.strictEqual(view.collaboratorResponseObjects, ownProjection, 'the same-snapshot projection is reused');
});
