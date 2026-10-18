/* T.R.U. Temporal Evidence Kernel — offline, dependency-free.
   This kernel does not certify truth, identity, execution, or authorization. */
export const STATES = ['HYPOTHESIS','BUILT','TESTED','OBSERVED','EXTERNALLY_CORROBORATED'];
export const ACTIONS = ['PROMOTE','REJECT','DEFER'];
const order = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export const canonical = value => {
 if(Array.isArray(value))return '['+Array.from(value,x=>canonical(x)??'null').join(',')+']';
 if(value && typeof value==='object')return '{'+Object.keys(value).sort(order).flatMap(key=>{const encoded=canonical(value[key]);return encoded===undefined?[]:[JSON.stringify(key)+':'+encoded]}).join(',')+'}';
 return JSON.stringify(value);
};
export const sha256 = async value => {
 const bytes = new TextEncoder().encode(typeof value === 'string' ? value : canonical(value));
 const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
 return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
};
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const identifier = x => typeof x === 'string' && /^[a-zA-Z0-9._:-]{1,80}$/.test(x);
const text = (x,max=2000) => typeof x === 'string' && x.trim().length>0 && x.length<=max;
// Bound extensions too: imported metadata cannot bypass the case size/depth limits.
function boundedJSON(value,depth=0,budget={nodes:0,chars:0}) {
 if(depth>12 || ++budget.nodes>25000) throw Error('Case exceeds structural safety limits');
 if(typeof value==='string') {if(value.length>2000) throw Error('Case string exceeds safety limits');budget.chars+=value.length}
 else if(value===null || typeof value==='boolean' || (typeof value==='number' && Number.isFinite(value))) return;
 else if(Array.isArray(value)) for(const x of value) boundedJSON(x,depth+1,budget);
 else if(object(value) && Object.getPrototypeOf(value)===Object.prototype) for(const [key,x] of Object.entries(value)) {if(key.length>80) throw Error('Case key exceeds safety limits');budget.chars+=key.length;boundedJSON(x,depth+1,budget)}
 else throw Error('Case must contain JSON values');
 if(budget.chars>250000) throw Error('Case exceeds text safety limits');
}
function timestamp(value) {
 if(typeof value!=='string' || value.length>40) return false;
 const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!match || !Number.isFinite(Date.parse(value))) return false;
 const [,year,month,day,hour,minute,second,zone]=match;
 const days=new Date(Date.UTC(Number(year),Number(month),0)).getUTCDate();
 return +month>=1 && +month<=12 && +day>=1 && +day<=days && +hour<24 && +minute<60 && +second<60 && (zone==='Z' || (+zone.slice(1,3)<24 && +zone.slice(4)<60));
}
function references(value,required=false) {
 if(value===undefined && !required) return;
 if(!Array.isArray(value) || value.length>500 || value.some(x=>!identifier(x)) || new Set(value).size!==value.length) throw Error('Invalid evidence references');
}
export function assertCase(c) {
 if(!object(c)) throw Error('Case must be an object');
 boundedJSON(c);
 if(c.schema!=='tru.case.v1') throw Error('Unknown case schema');
 if(!identifier(c.caseId)) throw Error('Invalid case id');
 for(const key of ['title','subtitle']) if(c[key]!==undefined && !text(c[key])) throw Error('Invalid case '+key);
 if(!text(c.rollback)) throw Error('Invalid or missing rollback');
 if(!Array.isArray(c.events) || !Array.isArray(c.candidates) || !Array.isArray(c.evidence)) throw Error('Missing data arrays');
 if(c.events.length>500 || c.evidence.length>500 || c.candidates.length>30) throw Error('Case exceeds safety limits');
 const ids=new Set();
 for(const list of [c.events,c.candidates,c.evidence]) for(const x of list) {
  if(!object(x) || !identifier(x.id) || ids.has(x.id)) throw Error('Invalid or duplicate identifier');
  ids.add(x.id);
 }
 for(const ev of c.events) {
  if(!timestamp(ev.at) || !text(ev.description)) throw Error('Invalid temporal event');
  if(!['OBSERVED','REPORTED','INFERRED','SIMULATED','FICTIONAL'].includes(ev.mode)) throw Error('Unknown temporal evidence mode');
  references(ev.evidenceIds);
 }
 for(const e of c.evidence) {
  if(!['artifact','test_receipt','runtime_receipt','external_receipt','assertion'].includes(e.kind)) throw Error('Unknown evidence kind');
  if(!text(e.description)) throw Error('Invalid evidence description');
  if(!['UNVERIFIED','LOCAL_INTEGRITY','AUTHENTICATED','INDEPENDENT'].includes(e.assurance)) throw Error('Invalid assurance');
  if(e.digest!==undefined && (typeof e.digest!=='string' || !/^[0-9a-f]{64}$/i.test(e.digest))) throw Error('Invalid evidence digest');
 }
 for(const cand of c.candidates) {
  if(!['INCUMBENT','CANDIDATE'].includes(cand.role)) throw Error('Invalid candidate role');
  if(!text(cand.name,120) || !Array.isArray(cand.testResults) || cand.testResults.length>100) throw Error('Invalid candidate');
  references(cand.evidenceIds,true);
  if(cand.workloadId!==undefined && !identifier(cand.workloadId)) throw Error('Invalid workload id');
  const names=new Set(),testIds=new Set();
  for(const t of cand.testResults) {
   if(!object(t) || !text(t.name,200) || !['PASS','FAIL','UNKNOWN'].includes(t.outcome) || (t.id!==undefined && !identifier(t.id))) throw Error('Invalid test result');
   if(names.has(t.name) || (t.id!==undefined && testIds.has(t.id))) throw Error('Duplicate test name or identifier');
   names.add(t.name);if(t.id!==undefined)testIds.add(t.id);
  }
 }
 if(c.candidates.filter(x=>x.role==='INCUMBENT').length>1) throw Error('Multiple incumbent baselines');
 return c;
}
const testIdentity = t => canonical([t.id??null,t.name]);
export function assess(c) {
 assertCase(c);
 const issues=[],ev=c.evidence;
 const events=[...c.events].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||order(a.id,b.id));
 const evidenceById=new Map(ev.map(x=>[x.id,x])),duplicateDigests=new Map();
 for(const e of ev) if(e.digest) {const key=e.digest.toLowerCase(),arr=duplicateDigests.get(key)||[];arr.push(e.id);duplicateDigests.set(key,arr)}
 for(const ids of duplicateDigests.values()) if(ids.length>1) issues.push({severity:'CAUTION',text:`Identical payload digest in ${ids.join(', ')}; independent evidence is not established.`});
 if(events.some(x=>x.mode==='FICTIONAL')) issues.push({severity:'BOUNDARY',text:'Fictional timeline events are narrative claims, not operational observations.'});
 if(events.some(x=>x.mode==='SIMULATED')) issues.push({severity:'BOUNDARY',text:'Simulated events cannot certify future real-world outcomes.'});
 if(ev.some(x=>x.assurance==='LOCAL_INTEGRITY')) issues.push({severity:'CAUTION',text:'Local SHA-256 matching verifies bytes only, not execution, witness independence, or authenticity.'});
 if(ev.some(x=>['INDEPENDENT','AUTHENTICATED'].includes(x.assurance))) issues.push({severity:'CAUTION',text:'Imported INDEPENDENT and AUTHENTICATED assurance values are untrusted labels. No authenticated witness is established by this workbench.'});
 // References remain assessable ERRORs so a broken imported case can be inspected.
 for(const row of [...c.events,...c.candidates]) for(const id of row.evidenceIds||[]) if(!evidenceById.has(id)) issues.push({severity:'ERROR',text:`Missing evidence reference: ${id} (from ${row.id})`});
 const incumbent=c.candidates.find(x=>x.role==='INCUMBENT');
 if(!incumbent) issues.push({severity:'ERROR',text:'No incumbent: temporal comparison lacks a baseline.'});
 const comparisons=new Map();
 for(const candidate of c.candidates.filter(x=>x.role==='CANDIDATE')) {
  let comparable=!!incumbent;
  if(incumbent && (!candidate.workloadId || !incumbent.workloadId || candidate.workloadId!==incumbent.workloadId)) {comparable=false;issues.push({severity:'ERROR',text:`Missing or unequal workload identifiers for ${candidate.id} and incumbent.`})}
  if(incumbent) {
   const a=incumbent.testResults.map(testIdentity).sort(order),b=candidate.testResults.map(testIdentity).sort(order);
   if(a.length===0 || canonical(a)!==canonical(b)) {comparable=false;issues.push({severity:'ERROR',text:`Unequal or empty test identities for ${candidate.id} and incumbent; pass counts cannot establish a comparison.`})}
  }
  comparisons.set(candidate.id,comparable);
 }
 const hasErrors=issues.some(x=>x.severity==='ERROR');
 const scored=c.candidates.map(x=>{
  const pass=x.testResults.filter(t=>t.outcome==='PASS').length,fail=x.testResults.filter(t=>t.outcome==='FAIL').length,unknown=x.testResults.filter(t=>t.outcome==='UNKNOWN').length;
  const links=x.evidenceIds.map(id=>evidenceById.get(id)).filter(Boolean);
  // `independent` means verified witnesses: imported labels never increment it.
  return {...x,pass,fail,unknown,independent:0,independentLabels:links.filter(e=>e.assurance==='INDEPENDENT').length,recordedEvidence:links.length,confidence:fail>0?'REJECTABLE':'INCONCLUSIVE'};
 });
 const candidates=scored.filter(x=>x.role==='CANDIDATE');
 const decisions=candidates.map(x=>({id:x.id,name:x.name,comparable:comparisons.get(x.id),recommendation:x.fail>0?'REJECT':'INCONCLUSIVE',reason:x.fail>0?'Candidate has recorded test failures.':hasErrors?'Structural evidence or comparison errors require correction.':'Reported results remain unverified; imported assurance cannot establish authenticated independent evidence.'}));
 return {events,scored,decisions,issues,stats:{events:events.length,evidence:ev.length,candidates:candidates.length,contradictions:issues.filter(x=>x.severity!=='BOUNDARY').length}};
}
export function makeDecisionPacket(c,candidateId,deadline) {
 const assessment=assess(c),candidate=assessment.scored.find(x=>x.id===candidateId && x.role==='CANDIDATE');
 if(!candidate) throw Error('Unknown candidate');
 if(!timestamp(deadline)) throw Error('Invalid deadline');
 return {schema:'tru.founder-decision-packet.v1',decisionId:`decision:${c.caseId}:${candidateId}`,caseId:c.caseId,candidateId,deadline,generatedAt:new Date().toISOString(),recommendation:assessment.decisions.find(x=>x.id===candidateId),reviewable:false,evidenceIds:[...candidate.evidenceIds],riskFlags:assessment.issues,rollback:c.rollback,authorization:'REQUIRED — NOT GRANTED',gateStatus:'LOCAL_PACKET_ONLY — NOT AUTHENTICATED',options:[...ACTIONS]};
}
export const example={schema:'tru.case.v1',caseId:'TRU-2041-ORIGIN',title:'Temporal Reconnaissance: canon versus executable capabilities',subtitle:'A demonstration separating authored 2041 lore from 2026 engineering claims.',events:[
{id:'t1',at:'2026-09-17T00:00:00Z',mode:'REPORTED',description:'T.R.U. future-history described: activation in 2041, selective observation, future-state artifact extraction.'},
{id:'t2',at:'2026-10-08T00:00:00Z',mode:'REPORTED',description:'Second-term 2040s language introduced; reconcile chronology without declaring equivalence.'},
{id:'t3',at:'2041-01-01T00:00:00Z',mode:'FICTIONAL',description:'T.R.U. activation in the authored timeline; fictional event, not a factual prediction.'}
],evidence:[
{id:'e1',kind:'assertion',assurance:'UNVERIFIED',description:'Conversation-derived authored lore; no primary-source artifact attached.'},
{id:'e2',kind:'artifact',assurance:'LOCAL_INTEGRITY',description:'Local AOTA handoff package exists; code is not an authenticated execution receipt.'},
{id:'e3',kind:'test_receipt',assurance:'UNVERIFIED',description:'Test execution is not established by the presence of test source code.'}
],candidates:[
{id:'inc',name:'Existing local evidence inventory',role:'INCUMBENT',evidenceIds:['e2'],testResults:[{name:'Digest check source exists',outcome:'PASS'},{name:'Independent execution receipt',outcome:'UNKNOWN'},{name:'Founder authorization',outcome:'UNKNOWN'}]},
{id:'cand',name:'Temporal evidence reconciliation workflow',role:'CANDIDATE',evidenceIds:['e1','e2','e3'],testResults:[{name:'Timeline sorted with declared epistemic modes',outcome:'PASS'},{name:'No claim of time travel',outcome:'PASS'},{name:'Authenticated founder decision endpoint',outcome:'UNKNOWN'}]}
],rollback:'Return to existing AOTA handoff; no production state modified.'};
