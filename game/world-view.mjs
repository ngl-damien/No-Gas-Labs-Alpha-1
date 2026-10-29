import { isStrictTimestamp } from './timestamps.mjs';

export const WORLD_WIDTH=1600,WORLD_HEIGHT=1000;
export const PLACES=[
 {id:'workbench',name:'The Making Bench',x:325,y:645,type:'workbench',purpose:'Make a draft, check it, and publish only by explicit Founder action.'},
 {id:'relay',name:'The Relay',x:670,y:330,type:'discovery'},
 {id:'river',name:'River of Receipts',x:910,y:665,type:'discovery'},
 {id:'overlook',name:'The Long View',x:1310,y:310,type:'discovery'},
 {id:'ruins',name:'The Unfinished',x:1280,y:810,type:'discovery'},
 {id:'town-square',name:'TownSquare · Institution Records',x:1040,y:440,type:'institution',purpose:'Projects, evidence, disputes and scoped decisions.',glyph:'T',color:'#356e62'},
 {id:'guild_hall',name:'Guild Hall',x:230,y:170,type:'institution',purpose:'Review retained work and the limits of collaborator authority.',glyph:'G',color:'#356e62'},
 {id:'forge',name:'Forge',x:350,y:520,type:'institution',purpose:'Draft, repair, check and publish real artifacts.',glyph:'F',color:'#c76a35'},
 {id:'evidence_archive',name:'Evidence Archive',x:990,y:170,type:'institution',purpose:'Retain attributed reports, contributions and version references.',glyph:'E',color:'#6b805d'},
 {id:'decision_chamber',name:'Decision Chamber',x:780,y:180,type:'institution',purpose:'Human-gated decisions and scoped authority.',glyph:'D',color:'#29443d'},
 {id:'academy',name:'Polymath Academy',x:180,y:430,type:'institution',purpose:'Study published work; visits do not certify mastery.',glyph:'A',color:'#7c876a'},
 {id:'moonshot_field',name:'Moonshot Field',x:1460,y:430,type:'institution',purpose:'Draft testable research questions; proposals are not results.',glyph:'M',color:'#356e62'},
 {id:'publication_house',name:'Publication House',x:250,y:870,type:'institution',purpose:'Browse published artifacts and preserved versions.',glyph:'P',color:'#c76a35'}
];
const INSTITUTION_EVENT_MATCHERS=Object.freeze({
 guild_hall:event=>event?.type==='proposal'||event?.type==='claim'||event?.event_type==='PROPOSAL'||event?.event_type==='CLAIM',
 forge:event=>event?.type==='draft'||event?.type==='repair'||event?.execution==='EXECUTED',
 evidence_archive:event=>event?.type==='report'||event?.event_type==='LOCATION_OBSERVATION'||event?.event_type==='EXECUTION_ADJUDICATION'||event?.evidence==='REFUTED'||event?.admission==='REJECTED'||event?.outcome==='FAILED',
 decision_chamber:event=>event?.type==='decision'||event?.type==='revocation'||event?.event_type==='REVOCATION'||(event?.authority==='AUTHORIZED'&&event?.execution!=='EXECUTED'),
 'town-square':event=>event?.type==='contribute'||event?.event_type==='PUBLIC_COMMENT'||event?.event_type==='PARTICIPATION',
 academy:event=>event?.type==='study'||event?.type==='study-reviewed'||event?.type==='learning'||event?.type==='skill-evidence'||event?.event_type==='LEARNING'||event?.event_type==='SKILL_EVIDENCE',
 moonshot_field:event=>event?.type==='experiment'||event?.type==='moonshot'||event?.type==='moonshot-proposed'||event?.type==='experiment-reported'||event?.event_type==='MOONSHOT',
 publication_house:event=>event?.type==='publish'||event?.event_type==='PUBLICATION'||event?.event_type==='SATIRE'
});
/**
 * Count identifiable activity records at an institution without treating a label,
 * duplicate event ID, or accessor-backed object as a canonical progress signal.
 * Supports Alpha 1's `id` and recovered donor events' `event_id` schemas.
 * Counts are navigational context only; they do not verify truth or grant rewards.
 */
const MAX_WORLD_EVENT_SCAN=100_000;
function ownDataValue(object,key){
 if(!object||(typeof object!=='object'&&typeof object!=='function'))return undefined;
 try{
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
 }catch{return undefined;}
}
function isArraySafely(value){try{return Array.isArray(value)}catch{return false}}
function computeInstitutionActivityCounts(world){
 const activity=Object.create(null);
 for(const id of Object.keys(INSTITUTION_EVENT_MATCHERS))activity[id]=0;
 const worldEvents=ownDataValue(world,'events');
 const worldHistory=ownDataValue(world,'history');
 const events=isArraySafely(worldEvents)?worldEvents:isArraySafely(worldHistory)?worldHistory:[];
 const eventCount=ownDataValue(events,'length');
 if(!Number.isSafeInteger(eventCount)||eventCount<0||eventCount>MAX_WORLD_EVENT_SCAN)return activity;
 const identified=[];
 const identityCounts=new Map();
 for(let index=0;index<eventCount;index++){
  const event=ownDataValue(events,String(index));
  if(!event||typeof event!=='object')continue;
  let isEventArray;
  try{isEventArray=Array.isArray(event)}catch{continue}
  if(isEventArray)continue;
  let descriptors;
  try{descriptors=Object.getOwnPropertyDescriptors(event)}catch{continue}
  if(!descriptors)continue;
  const current=descriptors.id,legacy=descriptors.event_id;
  if((current&&(!Object.hasOwn(current,'value')||typeof current.value!=='string'))||
     (legacy&&(!Object.hasOwn(legacy,'value')||typeof legacy.value!=='string')))continue;
  if(current&&legacy&&current.value!==legacy.value)continue;
  const identity=current?current.value:legacy?.value;
  if(typeof identity!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(identity))continue;
  identityCounts.set(identity,(identityCounts.get(identity)||0)+1);
  const safe=Object.values(descriptors).every(descriptor=>Object.hasOwn(descriptor,'value'));
  const snapshot=safe?Object.fromEntries(Object.entries(descriptors).map(([key,descriptor])=>[key,descriptor.value])):null;
  identified.push({identity,event:snapshot,safe});
 }
 for(const {identity,event,safe} of identified){
  if(!safe||identityCounts.get(identity)!==1)continue;
  for(const [id,matches] of Object.entries(INSTITUTION_EVENT_MATCHERS)){
   if(matches(event))activity[id]+=1;
  }
 }
 return activity;
}
export function institutionActivityCount(id,world){
 if(!Object.hasOwn(INSTITUTION_EVENT_MATCHERS,id))return 0;
 return computeInstitutionActivityCounts(world)[id]??0;
}

const WORLD_OBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const boundedWorldText = (value, max) => typeof value === 'string' &&
  value.trim().length > 0 && Array.from(value).length <= max;

/**
 * Project retained, unambiguous moonshot proposals into navigable world objects.
 * This is presentation-only: proposals remain self-reported questions, not results,
 * rewards, evidence of execution, or authorization.
 */
const RESEARCH_ROLES = new Set(['founder', 'witness']);
const RESEARCH_OUTCOMES = new Set(['supports', 'contradicts', 'inconclusive', 'failed']);
const RESEARCH_CHALLENGE_TYPES = new Set(['missing-evidence', 'methodology', 'contradiction', 'reproducibility', 'scope', 'other']);

function unsafeOwnAccessor(object, key) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return Boolean(descriptor && !Object.hasOwn(descriptor, 'value'));
  } catch {
    return true;
  }
}

function indexRetainedResearchVersions(world) {
  const index = new Map();
  const creations = ownDataValue(world, 'creations');
  if (!isArraySafely(creations)) return index;
  const creationCount = ownDataValue(creations, 'length');
  if (!Number.isSafeInteger(creationCount) || creationCount < 0 || creationCount > MAX_WORLD_EVENT_SCAN) return index;
  let totalVersions = 0;
  const add = (item, creationId) => {
    if (!item || typeof item !== 'object') return;
    const itemId = ownDataValue(item, 'id');
    const version = ownDataValue(item, 'version');
    if (itemId !== creationId || !Number.isSafeInteger(version) || version < 1) return;
    const publishedAt = ownDataValue(item, 'publishedAt');
    const publishedAtMs = isStrictTimestamp(publishedAt) ? Date.parse(publishedAt) : NaN;
    const key = creationId + '\0' + version;
    const previous = index.get(key);
    index.set(key, {
      count: (previous?.count || 0) + 1,
      publishedAtMs: previous ? previous.publishedAtMs : (Number.isFinite(publishedAtMs) ? publishedAtMs : NaN),
    });
  };

  for (let indexPosition = 0; indexPosition < creationCount; indexPosition += 1) {
    if (unsafeOwnAccessor(creations, String(indexPosition))) return new Map();
    const creation = ownDataValue(creations, String(indexPosition));
    if (!creation || typeof creation !== 'object') continue;
    if (unsafeOwnAccessor(creation, 'id')) return new Map();
    const creationId = ownDataValue(creation, 'id');
    if (typeof creationId !== 'string' || !creationId) continue;
    if (unsafeOwnAccessor(creation, 'version') || unsafeOwnAccessor(creation, 'publishedAt') ||
        unsafeOwnAccessor(creation, 'versions')) return new Map();
    const versions = ownDataValue(creation, 'versions');
    if (versions !== undefined && versions !== null && !isArraySafely(versions)) return new Map();
    const versionItems = [];
    if (isArraySafely(versions)) {
      const versionCount = ownDataValue(versions, 'length');
      if (!Number.isSafeInteger(versionCount) || versionCount < 0 || versionCount > MAX_WORLD_EVENT_SCAN) return new Map();
      totalVersions += versionCount;
      if (totalVersions > MAX_WORLD_EVENT_SCAN) return new Map();
      for (let versionIndex = 0; versionIndex < versionCount; versionIndex += 1) {
        if (unsafeOwnAccessor(versions, String(versionIndex))) return new Map();
        const versionItem = ownDataValue(versions, String(versionIndex));
        if (versionItem && typeof versionItem === 'object' &&
            (unsafeOwnAccessor(versionItem, 'id') || unsafeOwnAccessor(versionItem, 'version') ||
             unsafeOwnAccessor(versionItem, 'publishedAt'))) return new Map();
        versionItems.push(versionItem);
      }
    }
    add(creation, creationId);
    for (const versionItem of versionItems) add(versionItem, creationId);
  }
  return index;
}

function validOptionalResearchEvidence(evidenceIndex, event, atMs) {
  const creationId = ownDataValue(event, 'evidenceCreationId');
  const version = ownDataValue(event, 'evidenceVersion');
  const hasId = typeof creationId === 'string' && creationId.length > 0;
  const hasVersion = Number.isSafeInteger(version) && version > 0;
  if (!hasId && !hasVersion) {
    return (creationId === null || creationId === undefined) &&
      (version === null || version === undefined);
  }
  if (!hasId || !hasVersion || !WORLD_OBJECT_ID.test(creationId)) return false;
  const retained = evidenceIndex.get(creationId + '\0' + version);
  return Boolean(retained && retained.count === 1 &&
    Number.isFinite(retained.publishedAtMs) && retained.publishedAtMs <= atMs);
}

/**
 * Project retained moonshot proposals into navigable objects whose small status
 * is derived only from unambiguous, correctly ordered retained report/challenge
 * events. Counts describe self-reports and dissent, never verified execution,
 * truth, rewards, progress authority, or adjudication.
 */
export function projectMoonshotWorldObjects(world) {
  const events = ownDataValue(world, 'events');
  if (!isArraySafely(events)) return Object.freeze([]);
  const eventCount = ownDataValue(events, 'length');
  if (!Number.isSafeInteger(eventCount) || eventCount < 0 || eventCount > MAX_WORLD_EVENT_SCAN) return Object.freeze([]);
  const eventList = [];
  for (let index = 0; index < eventCount; index += 1) eventList.push(ownDataValue(events, String(index)));
  const evidenceIndex = indexRetainedResearchVersions(world);

  const eventIdCounts = new Map();
  const moonshotIdCounts = new Map();
  const reportIdCounts = new Map();
  const challengeIdCounts = new Map();
  for (const event of eventList) {
    if (!event || typeof event !== 'object') continue;
    const id = ownDataValue(event, 'id');
    const type = ownDataValue(event, 'type');
    if (typeof id === 'string' && id.length) eventIdCounts.set(id, (eventIdCounts.get(id) || 0) + 1);
    if (type === 'moonshot-proposed') {
      const moonshotId = ownDataValue(event, 'moonshotId');
      if (typeof moonshotId === 'string' && moonshotId.length) moonshotIdCounts.set(moonshotId, (moonshotIdCounts.get(moonshotId) || 0) + 1);
    } else if (type === 'experiment-reported') {
      const reportId = ownDataValue(event, 'reportId');
      if (typeof reportId === 'string' && reportId.length) reportIdCounts.set(reportId, (reportIdCounts.get(reportId) || 0) + 1);
    } else if (type === 'experiment-challenged') {
      const challengeId = ownDataValue(event, 'challengeId');
      if (typeof challengeId === 'string' && challengeId.length) challengeIdCounts.set(challengeId, (challengeIdCounts.get(challengeId) || 0) + 1);
    }
  }

  const retained = [];
  const proposalById = new Map();
  for (let index = 0; index < eventList.length; index += 1) {
    const event = eventList[index];
    if (!event || typeof event !== 'object' || ownDataValue(event, 'type') !== 'moonshot-proposed') continue;
    const eventId = ownDataValue(event, 'id');
    const moonshotId = ownDataValue(event, 'moonshotId');
    const actor = ownDataValue(event, 'actor');
    const actorId = ownDataValue(actor, 'id');
    const actorRole = ownDataValue(actor, 'role');
    const at = ownDataValue(event, 'at');
    const atMs = isStrictTimestamp(at) ? Date.parse(at) : NaN;
    const title = ownDataValue(event, 'title');
    const hypothesis = ownDataValue(event, 'hypothesis');
    const falsifier = ownDataValue(event, 'falsifier');
    const evidenceNeeded = ownDataValue(event, 'evidenceNeeded');
    if (typeof eventId !== 'string' || !WORLD_OBJECT_ID.test(eventId) ||
        eventIdCounts.get(eventId) !== 1 ||
        typeof moonshotId !== 'string' || !WORLD_OBJECT_ID.test(moonshotId) ||
        moonshotIdCounts.get(moonshotId) !== 1 ||
        typeof actorId !== 'string' || !actorId.trim() ||
        !RESEARCH_ROLES.has(actorRole) ||
        typeof at !== 'string' || !Number.isFinite(atMs) ||
        !boundedWorldText(title, 80) ||
        !boundedWorldText(hypothesis, 1000) ||
        !boundedWorldText(falsifier, 1000) ||
        !boundedWorldText(evidenceNeeded, 1000)) continue;
    const proposal = { eventId, moonshotId, title, actorId, actorRole, at, atMs, index };
    retained.push(proposal);
    proposalById.set(moonshotId, proposal);
  }

  const validReports = [];
  for (let index = 0; index < eventList.length; index += 1) {
    const event = eventList[index];
    if (!event || typeof event !== 'object' || ownDataValue(event, 'type') !== 'experiment-reported') continue;
    const eventId = ownDataValue(event, 'id');
    const reportId = ownDataValue(event, 'reportId');
    const moonshotId = ownDataValue(event, 'moonshotId');
    const proposal = proposalById.get(moonshotId);
    const actor = ownDataValue(event, 'actor');
    const actorId = ownDataValue(actor, 'id');
    const actorRole = ownDataValue(actor, 'role');
    const at = ownDataValue(event, 'at');
    const atMs = isStrictTimestamp(at) ? Date.parse(at) : NaN;
    const procedure = ownDataValue(event, 'procedure');
    const observation = ownDataValue(event, 'observation');
    const outcome = ownDataValue(event, 'reportedOutcome');
    if (typeof eventId !== 'string' || !WORLD_OBJECT_ID.test(eventId) || eventIdCounts.get(eventId) !== 1 ||
        typeof reportId !== 'string' || !WORLD_OBJECT_ID.test(reportId) || reportIdCounts.get(reportId) !== 1 ||
        !proposal || index <= proposal.index || !Number.isFinite(atMs) || atMs < proposal.atMs ||
        typeof actorId !== 'string' || !actorId.trim() || !RESEARCH_ROLES.has(actorRole) ||
        !boundedWorldText(procedure, 1000) || !boundedWorldText(observation, 1000) ||
        !RESEARCH_OUTCOMES.has(outcome) || !validOptionalResearchEvidence(evidenceIndex, event, atMs)) continue;
    validReports.push({
      eventId, reportId, moonshotId, actorId, actorRole, at, atMs, index,
      procedure, observation, reportedOutcome: outcome,
      evidenceCreationId: ownDataValue(event, 'evidenceCreationId') ?? null,
      evidenceVersion: ownDataValue(event, 'evidenceVersion') ?? null,
    });
  }

  const reportById = new Map(validReports.map(report => [report.reportId, report]));
  const validChallenges = [];
  const attemptCounts = new Map(retained.map(proposal => [proposal.moonshotId, 0]));
  const challengeCounts = new Map(retained.map(proposal => [proposal.moonshotId, 0]));
  for (const report of validReports) attemptCounts.set(report.moonshotId, attemptCounts.get(report.moonshotId) + 1);

  for (let index = 0; index < eventList.length; index += 1) {
    const event = eventList[index];
    if (!event || typeof event !== 'object' || ownDataValue(event, 'type') !== 'experiment-challenged') continue;
    const eventId = ownDataValue(event, 'id');
    const challengeId = ownDataValue(event, 'challengeId');
    const reportId = ownDataValue(event, 'reportId');
    const moonshotId = ownDataValue(event, 'moonshotId');
    const report = reportById.get(reportId);
    const actor = ownDataValue(event, 'actor');
    const actorId = ownDataValue(actor, 'id');
    const actorRole = ownDataValue(actor, 'role');
    const at = ownDataValue(event, 'at');
    const atMs = isStrictTimestamp(at) ? Date.parse(at) : NaN;
    const challengeType = ownDataValue(event, 'challengeType');
    const challengeText = ownDataValue(event, 'challengeText');
    if (typeof eventId !== 'string' || !WORLD_OBJECT_ID.test(eventId) || eventIdCounts.get(eventId) !== 1 ||
        typeof challengeId !== 'string' || !WORLD_OBJECT_ID.test(challengeId) || challengeIdCounts.get(challengeId) !== 1 ||
        !report || report.moonshotId !== moonshotId || report.actorId === actorId ||
        index <= report.index || !Number.isFinite(atMs) || atMs < report.atMs ||
        typeof actorId !== 'string' || !actorId.trim() || !RESEARCH_ROLES.has(actorRole) ||
        !RESEARCH_CHALLENGE_TYPES.has(challengeType) || !boundedWorldText(challengeText, 1000) ||
        !validOptionalResearchEvidence(evidenceIndex, event, atMs)) continue;
    challengeCounts.set(moonshotId, challengeCounts.get(moonshotId) + 1);
    validChallenges.push({
      eventId, challengeId, reportId, moonshotId, actorId, actorRole, at, atMs, index,
      challengeType, challengeText,
    });
  }

  const activityByMoonshot = new Map(retained.map(proposal => [proposal.moonshotId, []]));
  const activityRecords = [
    ...validReports.map(report => ({
      ...report,
      recordType: 'experiment-reported',
      activityId: report.reportId,
      title: 'Attempt · ' + report.reportedOutcome,
      summary: report.observation,
    })),
    ...validChallenges.map(challenge => ({
      ...challenge,
      recordType: 'experiment-challenged',
      activityId: challenge.challengeId,
      title: 'Dissent · ' + challenge.challengeType.replaceAll('-', ' '),
      summary: challenge.challengeText,
    })),
  ].sort((left, right) => left.index - right.index);
  const GRID_COLUMNS = 14, GRID_ROWS = 18, GRID_CAPACITY = GRID_COLUMNS * GRID_ROWS;
  const occupiedSlots = new Set();
  const activityHash = value => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };
  for (const activity of activityRecords) {
    const id = 'research-activity:' + activity.eventId;
    let slot = activityHash(id) % GRID_CAPACITY;
    let probes = 0;
    while (occupiedSlots.has(slot) && probes < GRID_CAPACITY) {
      slot = (slot + 1) % GRID_CAPACITY;
      probes += 1;
    }
    const mapVisible = !occupiedSlots.has(slot);
    if (mapVisible) occupiedSlots.add(slot);
    const activityObject = Object.freeze({
      id,
      type: 'research-activity',
      activityId: activity.activityId,
      recordType: activity.recordType,
      eventId: activity.eventId,
      moonshotId: activity.moonshotId,
      title: activity.title,
      summary: activity.summary,
      actorId: activity.actorId,
      actorRole: activity.actorRole,
      at: activity.at,
      reportedOutcome: activity.recordType === 'experiment-reported' ? activity.reportedOutcome : null,
      challengeType: activity.recordType === 'experiment-challenged' ? activity.challengeType : null,
      x: mapVisible ? 1110 + (slot % GRID_COLUMNS) * 34 : null,
      y: mapVisible ? 610 + Math.floor(slot / GRID_COLUMNS) * 19 : null,
      mapVisible,
    });
    activityByMoonshot.get(activity.moonshotId)?.push(activityObject);
  }

  return Object.freeze(retained.map((proposal, index) => Object.freeze({
    id: 'moonshot-object:' + proposal.moonshotId,
    type: 'research-object',
    moonshotId: proposal.moonshotId,
    eventId: proposal.eventId,
    title: proposal.title,
    actorId: proposal.actorId,
    actorRole: proposal.actorRole,
    at: proposal.at,
    attemptCount: attemptCounts.get(proposal.moonshotId) || 0,
    challengeCount: challengeCounts.get(proposal.moonshotId) || 0,
    activityObjects: Object.freeze([...(activityByMoonshot.get(proposal.moonshotId) || [])]),
    x: 1320 + (index % 4) * 54,
    y: 520 + Math.floor(index / 4) * 50,
  })));
}

const riverX=y=>856+Math.sin(y/155)*34;
const bridge=y=>(y>=326&&y<=396)||(y>=682&&y<=754);
export function isWalkable(x,y,buildings=[]) {
  if(x<24||y<28||x>1576||y>972)return false;
  if(Math.abs(x-riverX(y))<69&&!bridge(y))return false;
  return !buildings.some(c=>Math.abs(x-c.position.x)<74&&y>c.position.y-67&&y<c.position.y+49);
}
export function stepPlayer(player,input,distance,buildings=[]) {
  const len=Math.hypot(input.x,input.y);if(!len)return {...player};
  let {x,y}=player;const steps=Math.ceil(distance/6),dx=input.x/len*distance/steps,dy=input.y/len*distance/steps;
  for(let i=0;i<steps;i++){if(isWalkable(x+dx,y,buildings))x+=dx;if(isWalkable(x,y+dy,buildings))y+=dy;}
  return {x,y};
}
export function findRoute(start,target,buildings=[]) {
  const cell=20,cols=80,rows=50,key=(x,y)=>y*cols+x;
  const from={x:Math.max(2,Math.min(78,Math.round(start.x/cell))),y:Math.max(2,Math.min(48,Math.round(start.y/cell)))},to={x:Math.max(2,Math.min(78,Math.round(target.x/cell))),y:Math.max(2,Math.min(48,Math.round(target.y/cell)))};
  if(!isWalkable(from.x*cell,from.y*cell,buildings)){let closest=null;for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++){const x=from.x+dx,y=from.y+dy,distance=Math.hypot(x*cell-start.x,y*cell-start.y);if(isWalkable(x*cell,y*cell,buildings)&&(!closest||distance<closest.distance))closest={x,y,distance};}if(!closest)return [];from.x=closest.x;from.y=closest.y;}
  if(!isWalkable(to.x*cell,to.y*cell,buildings)){let best=null;for(let radius=1;radius<9&&!best;radius++)for(let dx=-radius;dx<=radius;dx++)for(let dy=-radius;dy<=radius;dy++)if(Math.abs(dx)===radius||Math.abs(dy)===radius){const x=to.x+dx,y=to.y+dy;if(isWalkable(x*cell,y*cell,buildings)&&(!best||Math.hypot(x*cell-target.x,y*cell-target.y)<best.distance))best={x,y,distance:Math.hypot(x*cell-target.x,y*cell-target.y)}}if(!best)return [];to.x=best.x;to.y=best.y;}
  const first=key(from.x,from.y),goal=key(to.x,to.y),queue=[first],visited=new Map([[first,null]]);let cursor=0;
  while(cursor<queue.length){const current=queue[cursor++];if(current===goal)break;const x=current%cols,y=Math.floor(current/cols);const dirs=[[1,0],[-1,0],[0,1],[0,-1]].sort((a,b)=>(Math.abs(x+a[0]-to.x)+Math.abs(y+a[1]-to.y))-(Math.abs(x+b[0]-to.x)+Math.abs(y+b[1]-to.y)));for(const [dx,dy] of dirs){const nx=x+dx,ny=y+dy,n=key(nx,ny);if(nx<1||nx>=cols||ny<1||ny>=rows||visited.has(n)||!isWalkable(nx*cell,ny*cell,buildings))continue;visited.set(n,current);queue.push(n)}}
  if(!visited.has(goal))return [];
  const points=[];let node=goal;while(node!==null){points.push({x:(node%cols)*cell,y:Math.floor(node/cols)*cell});node=visited.get(node)}points.reverse();
  // Keep the first grid step: skipping corners can cut across real water or buildings.
  return [{x:start.x,y:start.y},...points];
}
const seeded=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v)};
const palette={ink:'#29443d',teal:'#356e62',water:'#7da99a',paper:'#eee7ce',orange:'#d97638',red:'#af5138',gold:'#c4a252',grass:'#d5d9ae'};
export class WorldView {
  constructor(canvas,{onInteract=()=>{},onDiscover=()=>{},onPosition=()=>{}}={}) {
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.callbacks={onInteract,onDiscover,onPosition};this.player={x:180,y:640};this.world={creations:[],discoveries:[]};this.institutionCounts=computeInstitutionActivityCounts(this.world);this.researchObjects=projectMoonshotWorldObjects(this.world);this.researchActivityObjects=this.researchObjects.flatMap(object=>object.activityObjects||[]);this.routeObstacleSignature='[]';this.presence=[];this.keys=new Set();this.input={x:0,y:0};this.route=[];this.camera={x:700,y:500};this.time=0;this.lastPosition=0;this.discovered=new Set();this.reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.onKeyDown=e=>{if(e.target?.closest?.('input,textarea,select,[contenteditable="true"]')||document.body.classList.contains('modal-open'))return;const k=e.key.toLowerCase();if(['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d','e',' '].includes(k)){e.preventDefault();if(k==='e'||k===' '){if(!e.repeat)this.interact();return}this.keys.add(k);this.cancelRoute()}};
    this.onKeyUp=e=>this.keys.delete(e.key.toLowerCase());this.onBlur=()=>{this.keys.clear();this.input={x:0,y:0}};
    this.onPointer=e=>{const rect=canvas.getBoundingClientRect();const target={x:(e.clientX-rect.left-this.width/2)/this.zoom+this.camera.x,y:(e.clientY-rect.top-this.height/2)/this.zoom+this.camera.y};this.goTo(target);canvas.focus({preventScroll:true})};
    addEventListener('keydown',this.onKeyDown);addEventListener('keyup',this.onKeyUp);addEventListener('blur',this.onBlur);canvas.addEventListener('pointerdown',this.onPointer);this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);this.resize();this.frame=now=>{if(this.destroyed)return;const dt=Math.min((now-(this.previous??now))/1000,.045);this.previous=now;this.update(dt,now);this.render();this.animation=requestAnimationFrame(this.frame)};this.animation=requestAnimationFrame(this.frame);
  }
  resize(){const rect=this.canvas.getBoundingClientRect();this.width=rect.width;this.height=rect.height;this.dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.round(rect.width*this.dpr);this.canvas.height=Math.round(rect.height*this.dpr);this.zoom=this.width<600?.78:Math.max(.64,Math.min(.92,this.width/1500));}
  setWorld(world){const next=world||{creations:[]};this.world=next;this.institutionCounts=computeInstitutionActivityCounts(next);this.researchObjects=projectMoonshotWorldObjects(next);this.researchActivityObjects=this.researchObjects.flatMap(object=>object.activityObjects||[]);const signature=JSON.stringify({creations:(Array.isArray(next.creations)?next.creations:[]).map(c=>[String(c?.id??''),c?.position?.x,c?.position?.y]).sort((a,b)=>a[0].localeCompare(b[0])),researchObjects:this.researchObjects.map(object=>[object.id,object.x,object.y]),researchActivityObjects:this.researchActivityObjects.filter(object=>object.mapVisible).map(object=>[object.id,object.x,object.y])});const changed=signature!==this.routeObstacleSignature;this.routeObstacleSignature=signature;if(changed&&this.target)this.goTo(this.target);}
  setPresence(presence){this.presence=Array.isArray(presence)?presence:[];}
  drawTownSquare(){const c=this.ctx;c.save();c.translate(1040,440);this.ellipse(0,18,72,22,'#395a3b22');c.fillStyle='#f8efd4';c.strokeStyle='#356e62';c.lineWidth=2;c.fillRect(-56,-44,112,62);c.strokeRect(-56,-44,112,62);for(let n=0;n<3;n++){c.fillStyle=['#ce7443','#c4a252','#356e62'][n];c.fillRect(-45+n*34,-34,26,36);this.text(['P','E','D'][n],-32+n*34,-10,14,'#fff8e8');}this.text('TOWNSQUARE',0,47,12);this.text('projects · evidence · decisions',0,64,10,'#687756');this.text(this.institutionCounts['town-square']+' unique records',0,77,9,'#687756');c.restore();}
  drawInstitution(place){const c=this.ctx;c.save();c.translate(place.x,place.y);this.ellipse(0,22,62,17,'#395a3b22');c.fillStyle='#f8efd4';c.strokeStyle='#4e624a';c.lineWidth=2;c.beginPath();c.moveTo(-43,-25);c.lineTo(0,-53);c.lineTo(43,-25);c.lineTo(39,20);c.lineTo(-39,20);c.closePath();c.fill();c.stroke();c.fillStyle=place.color||'#356e62';c.fillRect(-30,-20,60,31);this.text(place.glyph||'I',0,3,20,'#f8efd4');c.fillStyle='#f8efd4';for(let x=-22;x<=14;x+=18)c.fillRect(x,11,10,9);this.text(place.name.toUpperCase(),0,40,9,'#687756');this.text(this.institutionCounts[place.id]+' records',0,53,9,'#687756');c.restore();}
  setPlayer(player){if(player?.id)this.player.id=player.id;if(Number.isFinite(player?.x)&&Number.isFinite(player?.y)){this.player={...this.player,x:player.x,y:player.y};this.cancelRoute();}}
  getPlayer(){return {...this.player};}
  setInput(input){this.input={x:input?.x||0,y:input?.y||0};if(this.input.x||this.input.y)this.cancelRoute();}
  cancelRoute(){this.route=[];this.target=null;}
  focusCreation(id){this.goTo(id);}
  goTo(id){let target=id;if(typeof id==='string'){const creation=this.world.creations?.find(c=>c.id===id);const place=PLACES.find(p=>p.id===id);const researchObject=this.researchObjects.find(object=>object.id===id);const researchActivityObject=this.researchActivityObjects.find(object=>object.id===id);if(creation)target={x:creation.position.x,y:creation.position.y+90};else if(place)target={x:place.x,y:place.y+50};else if(researchObject)target={x:researchObject.x,y:researchObject.y+28};else if(researchActivityObject?.mapVisible)target={x:researchActivityObject.x,y:researchActivityObject.y+18};else {this.cancelRoute();return}}const route=findRoute(this.player,target,this.world.creations);if(!route.length){this.cancelRoute();return}this.route=route;this.route.shift();this.target=typeof id==='string'?id:null;}
  nearest(){const options=[...PLACES,...(this.world.creations||[]).map(c=>({id:c.id,x:c.position.x,y:c.position.y+25,type:'creation',name:c.title})),...this.researchObjects.map(object=>({id:object.id,moonshotId:object.moonshotId,x:object.x,y:object.y+20,type:'research-object',name:object.title})),...this.researchActivityObjects.filter(object=>object.mapVisible).map(object=>({id:object.id,moonshotId:object.moonshotId,activityId:object.activityId,recordType:object.recordType,x:object.x,y:object.y+10,type:'research-activity',name:object.title}))];return options.map(p=>({...p,distance:Math.hypot(p.x-this.player.x,p.y-this.player.y)})).sort((a,b)=>a.distance-b.distance)[0];}
  interact(){const nearest=this.nearest();if(nearest&&nearest.distance<160){if(nearest.type==='discovery')this.callbacks.onDiscover(nearest.id);const interaction=nearest.type==='research-object'?{type:'research-object',id:nearest.moonshotId}:nearest.type==='research-activity'?{type:'research-activity',moonshotId:nearest.moonshotId,activityId:nearest.activityId,recordType:nearest.recordType}:{type:nearest.type,id:nearest.id};this.callbacks.onInteract(interaction);}else this.goTo('workbench');}
  update(dt,now){this.time=now/1000;if(document.body.classList.contains('modal-open')){this.keys.clear();this.input={x:0,y:0};this.route=[];this.target=null;this.moving=false;return;}const keyboard={x:(this.keys.has('d')||this.keys.has('arrowright')?1:0)-(this.keys.has('a')||this.keys.has('arrowleft')?1:0),y:(this.keys.has('s')||this.keys.has('arrowdown')?1:0)-(this.keys.has('w')||this.keys.has('arrowup')?1:0)};let direction={x:keyboard.x+this.input.x,y:keyboard.y+this.input.y};if(this.route.length&&!direction.x&&!direction.y){const target=this.route[0],distance=Math.hypot(target.x-this.player.x,target.y-this.player.y);if(distance<5)this.route.shift();else direction={x:target.x-this.player.x,y:target.y-this.player.y};}
    const before=this.player;this.player={...this.player,...stepPlayer(this.player,direction,Math.min(175*dt,this.route.length?Math.hypot(this.route[0].x-this.player.x,this.route[0].y-this.player.y):Infinity),this.world.creations)};this.moving=Math.hypot(this.player.x-before.x,this.player.y-before.y)>.1;
    if(this.target&&!this.route.length){const id=this.target;this.target=null;const researchObject=this.researchObjects.find(object=>object.id===id);const researchActivityObject=this.researchActivityObjects.find(object=>object.id===id);const p=PLACES.find(p=>p.id===id);if(researchActivityObject?.mapVisible)this.callbacks.onInteract({type:'research-activity',moonshotId:researchActivityObject.moonshotId,activityId:researchActivityObject.activityId,recordType:researchActivityObject.recordType});else if(researchObject)this.callbacks.onInteract({type:'research-object',id:researchObject.moonshotId});else if(p?.type==='discovery'){this.callbacks.onDiscover(id);this.callbacks.onInteract({type:'discovery',id})}else this.callbacks.onInteract({type:p?p.type:'creation',id});}
    for(const place of PLACES.filter(p=>p.type==='discovery'))if(Math.hypot(place.x-this.player.x,place.y-this.player.y)<90&&!this.discovered.has(place.id)){this.discovered.add(place.id);this.callbacks.onDiscover(place.id)}
    const visibleWidth=this.width/this.zoom,visibleHeight=this.height/this.zoom;const desired={x:Math.max(visibleWidth/2,Math.min(1600-visibleWidth/2,this.player.x+100)),y:Math.max(visibleHeight/2,Math.min(1000-visibleHeight/2,this.player.y-50))};const easing=this.reduced?1:Math.min(1,dt*5);this.camera.x+=(desired.x-this.camera.x)*easing;this.camera.y+=(desired.y-this.camera.y)*easing;
    if(now-this.lastPosition>1500&&this.moving){this.lastPosition=now;this.callbacks.onPosition(this.getPlayer());}
  }
  line(points,color=palette.ink,width=2,dash=[]){const c=this.ctx;c.beginPath();c.strokeStyle=color;c.lineWidth=width;c.setLineDash(dash);points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();c.setLineDash([])}
  ellipse(x,y,rx,ry,fill,stroke){const c=this.ctx;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);if(fill){c.fillStyle=fill;c.fill()}if(stroke){c.strokeStyle=stroke;c.lineWidth=1.5;c.stroke()}}
  text(value,x,y,size=13,color=palette.ink,font='Georgia'){const c=this.ctx;c.font=`${size}px ${font}`;c.fillStyle=color;c.textAlign='center';c.fillText(value,x,y)}
  tree(x,y,size=1){const c=this.ctx;c.save();c.translate(x,y);c.scale(size,size);this.ellipse(0,7,22,6,'#395a3b18');this.line([[0,8],[1,-34]],'#6f7552',3);c.fillStyle='#aebd89';c.strokeStyle='#6b805d';c.lineWidth=1.3;for(let n=0;n<3;n++){c.beginPath();c.moveTo(-21+n*4,-13-n*17);c.quadraticCurveTo(-8,-35-n*15,0,-53-n*14);c.quadraticCurveTo(12,-32-n*15,22-n*4,-13-n*17);c.closePath();c.fill();c.stroke()}this.line([[0,-18],[0,-62]],'#6b805d',1);c.restore()}
  rock(x,y,s=1){const c=this.ctx;c.save();c.translate(x,y);c.scale(s,s);c.beginPath();c.moveTo(-15,0);c.lineTo(-13,-13);c.lineTo(2,-22);c.lineTo(16,-8);c.lineTo(13,3);c.closePath();c.fillStyle='#c6c5a7';c.fill();c.strokeStyle='#8d9675';c.lineWidth=1.2;c.stroke();this.line([[-13,-13],[0,-9],[2,-22]],'#8d9675',1);c.restore()}
  path(points,width=24){const c=this.ctx;c.lineCap='round';c.lineJoin='round';this.line(points,'#b7ac7c44',width+5);this.line(points,'#e6d9ae',width);this.line(points,'#d0bd8b',1.4,[3,14]);}
  drawLandscape(){const c=this.ctx;c.fillStyle=palette.paper;c.fillRect(0,0,1600,1000);for(let i=0;i<15;i++){const x=seeded(i+66)*1600,y=seeded(i+211)*1000;this.ellipse(x,y,95+seeded(i)*170,45+seeded(i+5)*60,i%3?'#cbd2a444':'#ddcd9a44');}for(let i=0;i<560;i++){const x=seeded(i+1200)*1600,y=seeded(i+2700)*1000;if(Math.abs(x-riverX(y))<90)continue;this.line([[x-2,y+3],[x,y],[x+2,y+3]],'#71815925',.8)}
    this.path([[85,730],[180,640],[325,675],[540,710],[690,720],[850,720],[1050,720],[1130,625],[1280,600],[1480,620]],27);this.path([[325,675],[350,510],[430,425],[670,380],[850,360],[1025,360],[1160,320],[1310,350]],23);this.path([[1050,720],[1120,820],[1280,850],[1440,820]],18);this.path([[180,640],[150,450],[240,300],[480,260],[670,330]],15);
    c.beginPath();for(let y=-30;y<=1030;y+=15){const x=riverX(y)-58;if(y===-30)c.moveTo(x,y);else c.lineTo(x,y)}for(let y=1030;y>=-30;y-=15)c.lineTo(riverX(y)+58,y);c.closePath();c.fillStyle='#8db0a0';c.fill();c.strokeStyle='#5e8a77';c.lineWidth=3;c.stroke();for(let i=0;i<100;i++){const y=seeded(i+700)*1000,x=riverX(y)+(seeded(i+800)-.5)*90;this.line([[x-5,y],[x+8,y]],'#e5edde88',1.5)}
    for(const y of [360,720]){const x=riverX(y);c.fillStyle='#d4b682';c.strokeStyle='#695f43';c.lineWidth=2;c.fillRect(x-84,y-25,168,50);c.strokeRect(x-84,y-25,168,50);for(let n=-75;n<85;n+=14)this.line([[x+n,y-24],[x+n+2,y+24]],'#8c7950',1);this.line([[x-87,y-30],[x+87,y-30]],'#715d3d',3);this.line([[x-87,y+31],[x+87,y+31]],'#715d3d',3);for(const side of [-1,1])for(const offset of [-80,0,80])this.line([[x+offset,y+side*31],[x+offset,y+side*31-14]],'#715d3d',3)}
    for(let i=0;i<100;i++){const x=40+seeded(i+33)*1520,y=70+seeded(i+119)*840;if(Math.abs(x-riverX(y))<105||Math.hypot(x-325,y-645)<125||PLACES.some(p=>Math.hypot(p.x-x,p.y-y)<100)||(this.world.creations||[]).some(b=>Math.hypot(b.position.x-x,b.position.y-y)<105))continue;if(i%7===0)this.rock(x,y,.5+seeded(i));else this.tree(x,y,.5+seeded(i+222)*.55)}
    // Hand-inked map border and quiet cartographic details.
    this.line([[30,28],[1570,28],[1570,972],[30,972],[30,28]],'#9c9b7066',1.5,[3,7]);this.text('THE COMMON GROUND',460,100,21,'#7c825c');this.text('an institution, made by walking and making',460,122,12,'#838468');this.drawTownSquare();this.text('FAR BANK',1240,100,17,'#96916a');this.text('R I V E R  O F  R E C E I P T S',919,520,10,'#346656','system-ui');
    c.save();c.translate(1490,110);this.line([[0,-28],[0,28]],'#65755b',1.3);this.line([[-20,0],[20,0]],'#65755b',1.3);c.fillStyle='#65755b';c.beginPath();c.moveTo(0,-27);c.lineTo(-6,0);c.lineTo(6,0);c.closePath();c.fill();this.text('N',0,-37,11,'#65755b');c.restore();
  }
  drawMoonshotObject(object){const c=this.ctx;c.save();c.translate(object.x,object.y);this.ellipse(0,13,23,7,'#395a3b22');c.fillStyle='#fff7e0';c.strokeStyle='#b88b4e';c.lineWidth=1.5;c.beginPath();c.moveTo(-18,-17);c.lineTo(12,-17);c.lineTo(18,-11);c.lineTo(18,12);c.lineTo(-18,12);c.closePath();c.fill();c.stroke();this.line([[-10,-7],[10,-7]],'#b88b4e',1);this.line([[-10,0],[7,0]],'#8c9873',1);this.text('M',0,9,11,'#356e62');const title=Array.from(object.title);this.text(title.length>12?title.slice(0,11).join('')+'…':object.title,0,29,8,'#687756','system-ui');this.text('R'+object.attemptCount+' · C'+object.challengeCount,0,39,7,'#9a6a37','system-ui');c.restore()}
  drawResearchActivityObject(object){const c=this.ctx;c.save();c.translate(object.x,object.y);const dissent=object.recordType==='experiment-challenged';this.ellipse(0,8,11,4,'#395a3b22');c.fillStyle=dissent?'#f4dfd2':'#e5ead6';c.strokeStyle=dissent?'#af5138':'#356e62';c.lineWidth=1.4;c.beginPath();c.roundRect(-8,-8,16,16,3);c.fill();c.stroke();this.text(dissent?'D':'A',0,4,9,dissent?'#8b3e2e':'#29443d','system-ui');const title=Array.from(object.title||'');this.text(title.length>12?title.slice(0,11).join('')+'…':title.join(''),0,20,7,'#687756','system-ui');c.restore()}
  drawWorkbench(){const c=this.ctx;c.save();c.translate(325,645);this.ellipse(0,24,65,19,'#444b2620');for(const x of [-37,34])this.line([[x,5],[x-3,36]],'#67543b',7);c.fillStyle='#bc9e68';c.strokeStyle=palette.ink;c.lineWidth=2;c.beginPath();c.moveTo(-60,-17);c.lineTo(35,-30);c.lineTo(62,-3);c.lineTo(-36,12);c.closePath();c.fill();c.stroke();c.fillStyle='#f6efdb';c.fillRect(-20,-31,37,24);this.line([[-14,-25],[9,-25]],'#9a9876',1);this.line([[-14,-19],[3,-19]],'#9a9876',1);this.line([[26,-24],[39,-43]],'#aa532f',4);c.fillStyle='#d6803f';c.fillRect(-45,-30,10,16);this.text('THE MAKING BENCH',0,67,12);this.text('ideas become places',0,84,10,'#7b8162');c.restore()}
  drawPlaces(){const c=this.ctx;for(const place of PLACES.filter(p=>p.type==='discovery')){const{x,y,id}=place;c.save();c.translate(x,y);this.ellipse(0,25,43,12,'#44532b14');if(id==='relay'){this.line([[0,20],[0,-76]],'#646e4a',5);this.line([[-26,-55],[25,-55]],'#646e4a',4);c.fillStyle='#ce7443';c.beginPath();c.moveTo(3,-78);c.quadraticCurveTo(44,-88,42,-53);c.quadraticCurveTo(18,-68,3,-53);c.closePath();c.fill();this.line([[-12,20],[-7,4],[8,4],[16,20]],'#887951',2)}else if(id==='river'){for(let i=0;i<3;i++)this.rock(i*16-16,i*3,.7);this.line([[6,-10],[6,-58]],'#586a4c',3);c.fillStyle='#e9d39a';c.fillRect(7,-59,35,22);this.text('≡',24,-43,18,'#746f50')}else if(id==='overlook'){for(let n=0;n<4;n++)this.line([[-44+n*10,28-n*11],[44-n*10,28-n*11]],'#a5a27a',8);this.line([[-22,-10],[-22,-51],[21,-51],[21,-10]],'#797e5b',5);this.line([[-30,-51],[29,-51]],'#797e5b',8);this.line([[8,-48],[8,-72],[45,-70]],'#5b7566',4);this.ellipse(47,-69,9,8,'#c7be85','#5b7566')}else{for(const [bx,h] of [[-29,41],[-5,28],[28,53]]){c.fillStyle='#bfc1a0';c.strokeStyle='#8e9877';c.lineWidth=1.5;c.fillRect(bx-9,17-h,18,h);c.strokeRect(bx-9,17-h,18,h);this.line([[bx-10,17-h],[bx+4,10-h],[bx+10,17-h]],'#7d886a',2)}this.line([[-42,26],[42,26]],'#9ca17a',5)}this.text(place.name.toUpperCase(),0,57,11,'#687756');c.restore()}for(const place of PLACES.filter(p=>p.type==='institution'&&p.id!=='town-square'))this.drawInstitution(place);}
  drawBuilding(creation){const c=this.ctx,{x,y}=creation.position;const colors={comic:'#b85e42',loom:'#447e70',observatory:'#ad9252',custom:'#6d7185'},roof=colors[creation.kind];c.save();c.translate(x,y);this.ellipse(3,26,76,24,'#374b2b22');c.fillStyle='#f8efd4';c.strokeStyle='#4e624a';c.lineWidth=2;c.beginPath();c.moveTo(-53,-22);c.lineTo(43,-22);c.lineTo(54,28);c.lineTo(-48,28);c.closePath();c.fill();c.stroke();c.fillStyle=roof;c.beginPath();c.moveTo(-67,-21);c.lineTo(-8,-76);c.quadraticCurveTo(8,-55,65,-23);c.lineTo(56,-10);c.quadraticCurveTo(0,-21,-61,-9);c.closePath();c.fill();c.stroke();for(let i=0;i<5;i++)this.line([[-45+i*19,-24],[-8,-66]],'#fff0c933',1);c.fillStyle='#374e42';c.beginPath();c.roundRect(-12,-3,23,32,[11,11,0,0]);c.fill();c.fillStyle='#b6c5a1';c.fillRect(-37,-2,15,15);c.strokeRect(-37,-2,15,15);c.fillRect(24,-2,15,15);c.strokeRect(24,-2,15,15);c.fillStyle='#f4e4b3';c.fillRect(-43,37,86,23);c.strokeStyle='#a19268';c.lineWidth=1;c.strokeRect(-43,37,86,23);const title=Array.from(creation.title);this.text(title.length>20?title.slice(0,19).join('')+'…':creation.title,0,52,11,'#364d40');this.text(`${creation.kind.toUpperCase()} · v${creation.version}`,0,76,9,'#6e785d','system-ui');const symbol={comic:'▤',loom:'♫',observatory:'✧',custom:'◇'}[creation.kind];this.text(symbol,0,-32,26,'#fff0d1');c.restore()}
  drawPlayer(player,other=false){const c=this.ctx;c.save();c.translate(player.x,player.y);this.ellipse(0,9,13,5,'#354a3a33');const bob=!this.reduced&&this.moving&&!other?Math.sin(this.time*16)*1.5:0;c.translate(0,bob);this.line([[-4,0],[-5,8]],'#3c4b43',4);this.line([[5,0],[7,8]],'#3c4b43',4);c.fillStyle=other?'#6e8c76':'#385e58';c.beginPath();c.roundRect(-9,-20,18,23,5);c.fill();this.ellipse(0,-26,9,10,'#e2b68b','#675d42');this.ellipse(0,-33,11,8,other?'#819a75':palette.orange,'#7d6541');c.fillStyle=other?'#819a75':'#e38942';c.fillRect(-11,-33,22,5);this.ellipse(0,-42,4,4,other?'#819a75':palette.orange);this.line([[-9,-17],[-14,-8]],'#c7a17b',4);this.line([[9,-17],[13,-8]],'#c7a17b',4);if(!other){this.ellipse(0,-52,3,3,'#fff4ce');this.text('YOU',0,27,9,'#35574d','system-ui')}else if(player.name)this.text(String(player.name).slice(0,24),0,27,10,'#546c53');c.restore()}
  render(){const c=this.ctx;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.clearRect(0,0,this.width,this.height);c.save();c.translate(this.width/2-this.camera.x*this.zoom,this.height/2-this.camera.y*this.zoom);c.scale(this.zoom,this.zoom);this.drawLandscape();if(this.route.length){this.line([[this.player.x,this.player.y],...this.route.map(p=>[p.x,p.y])],'#b56a3e99',2,[4,7]);const p=this.route.at(-1);this.ellipse(p.x,p.y,8,4,undefined,'#b56a3e')}
    this.drawPlaces();this.drawWorkbench();const objects=[...(this.world.creations||[]).map(creation=>({y:creation.position.y,draw:()=>this.drawBuilding(creation)})),...this.researchObjects.map(object=>({y:object.y,draw:()=>this.drawMoonshotObject(object)})),...this.researchActivityObjects.filter(object=>object.mapVisible).map(object=>({y:object.y,draw:()=>this.drawResearchActivityObject(object)})),...this.presence.filter(p=>p.id!==this.player.id&&Number.isFinite(p.x)&&Number.isFinite(p.y)).map(p=>({y:p.y,draw:()=>this.drawPlayer(p,true)})),{y:this.player.y,draw:()=>this.drawPlayer(this.player)}];objects.sort((a,b)=>a.y-b.y).forEach(o=>o.draw());
    const near=this.nearest();if(near?.distance<145&&!document.body.classList.contains('modal-open')){const label=near.type==='workbench'?'E · Make something':near.type==='creation'?'E · Enter creation':near.type==='research-activity'?'E · Inspect research record':near.type==='research-object'?'E · Inspect moonshot':'E · Discover';const x=this.player.x,y=this.player.y-76;c.font='11px system-ui';const w=c.measureText(label).width+22;c.fillStyle='#fff8e8ed';c.strokeStyle='#9f9e78';c.lineWidth=1;c.beginPath();c.roundRect(x-w/2,y-12,w,24,12);c.fill();c.stroke();this.text(label,x,y+4,11,'#3d5c4c','system-ui')}c.restore();
    const vignette=c.createRadialGradient(this.width/2,this.height/2,this.width*.2,this.width/2,this.height/2,Math.max(this.width,this.height)*.7);vignette.addColorStop(0,'#786f3600');vignette.addColorStop(1,'#786f3618');c.fillStyle=vignette;c.fillRect(0,0,this.width,this.height);
  }
  destroy(){this.destroyed=true;cancelAnimationFrame(this.animation);this.resizeObserver.disconnect();removeEventListener('keydown',this.onKeyDown);removeEventListener('keyup',this.onKeyUp);removeEventListener('blur',this.onBlur);this.canvas.removeEventListener('pointerdown',this.onPointer);}
}
