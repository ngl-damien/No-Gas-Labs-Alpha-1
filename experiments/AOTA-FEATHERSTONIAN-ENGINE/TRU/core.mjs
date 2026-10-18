/* T.R.U. Temporal Evidence Kernel 0.1 — offline, dependency-free.
   This kernel does not certify truth, identity, execution, or authorization. */
export const STATES = ['HYPOTHESIS','BUILT','TESTED','OBSERVED','EXTERNALLY_CORROBORATED'];
export const ACTIONS = ['PROMOTE','REJECT','DEFER'];
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])) : value;
export const canonical = value => JSON.stringify(stable(value));
export const sha256 = async value => {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : canonical(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
};
export function assertCase(c) {
 if (!c || typeof c !== 'object' || Array.isArray(c)) throw Error('Case must be an object');
 if (c.schema !== 'tru.case.v1') throw Error('Unknown case schema');
 if (!Array.isArray(c.events) || !Array.isArray(c.candidates) || !Array.isArray(c.evidence)) throw Error('Missing data arrays');
 if (c.events.length > 500 || c.evidence.length > 500 || c.candidates.length > 30) throw Error('Case exceeds safety limits');
 const ids = new Set();
 for (const list of [c.events,c.candidates,c.evidence]) for (const x of list) {
   if (!x || typeof x.id !== 'string' || !/^[a-zA-Z0-9._:-]{1,80}$/.test(x.id) || ids.has(x.id)) throw Error('Invalid or duplicate identifier');
   ids.add(x.id);
 }
 for(const ev of c.events) {
   if(!Number.isFinite(Date.parse(ev.at)) || typeof ev.description !== 'string' || ev.description.length>2000) throw Error('Invalid temporal event');
   if(!['OBSERVED','REPORTED','INFERRED','SIMULATED','FICTIONAL'].includes(ev.mode)) throw Error('Unknown temporal evidence mode');
 }
 for(const e of c.evidence) {
   if(!['artifact','test_receipt','runtime_receipt','external_receipt','assertion'].includes(e.kind)) throw Error('Unknown evidence kind');
   if(typeof e.description !== 'string' || e.description.length > 2000) throw Error('Invalid evidence description');
   if(!['UNVERIFIED','LOCAL_INTEGRITY','AUTHENTICATED','INDEPENDENT'].includes(e.assurance)) throw Error('Invalid assurance');
   if(e.digest != null && !/^[0-9a-f]{64}$/i.test(e.digest)) throw Error('Invalid evidence digest');
 }
 for(const cand of c.candidates) {
   if(typeof cand.name!=='string' || cand.name.length>120 || !Array.isArray(cand.testResults) || cand.testResults.length>100) throw Error('Invalid candidate');
   for(const t of cand.testResults) if(typeof t.name!=='string' || !['PASS','FAIL','UNKNOWN'].includes(t.outcome)) throw Error('Invalid test result');
 }
 return c;
}
export function assess(c) {
 assertCase(c);
 const issues=[]; const ev=c.evidence;
 const events=[...c.events].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 const duplicateDigests=new Map();
 for(const e of ev) if(e.digest) {const arr=duplicateDigests.get(e.digest)||[];arr.push(e.id);duplicateDigests.set(e.digest,arr)}
 for(const [digest,ids] of duplicateDigests) if(ids.length>1) issues.push({severity:'CAUTION',text:`Identical payload digest in ${ids.join(', ')}; independent evidence is not established.`});
 if(events.some(x=>x.mode==='FICTIONAL')) issues.push({severity:'BOUNDARY',text:'Fictional timeline events are narrative claims, not operational observations.'});
 if(events.some(x=>x.mode==='SIMULATED')) issues.push({severity:'BOUNDARY',text:'Simulated events cannot certify future real-world outcomes.'});
 if(ev.some(x=>x.assurance==='LOCAL_INTEGRITY')) issues.push({severity:'CAUTION',text:'Local SHA-256 matching verifies bytes only, not execution, witness independence, or authenticity.'});
 const referenced=new Set((c.candidates||[]).flatMap(x=>x.evidenceIds||[]));
 for(const id of referenced) if(!ev.some(e=>e.id===id)) issues.push({severity:'ERROR',text:`Missing evidence reference: ${id}`});
 const scored=c.candidates.map(x=>{
  const pass=x.testResults.filter(t=>t.outcome==='PASS').length,fail=x.testResults.filter(t=>t.outcome==='FAIL').length,unknown=x.testResults.filter(t=>t.outcome==='UNKNOWN').length;
  const links=(x.evidenceIds||[]).map(id=>ev.find(e=>e.id===id)).filter(Boolean);
  const independent=links.filter(e=>e.assurance==='INDEPENDENT').length;
  return {...x,pass,fail,unknown,independent,recordedEvidence:links.length,confidence:fail>0?'REJECTABLE':unknown>0||independent===0?'INCONCLUSIVE':'REVIEWABLE'};
 });
 const incumbent=scored.find(x=>x.role==='INCUMBENT');
 const candidates=scored.filter(x=>x.role==='CANDIDATE');
 if(!incumbent) issues.push({severity:'ERROR',text:'No incumbent: temporal comparison lacks a baseline.'});
 const decisions=candidates.map(x=>{
  let recommendation='INCONCLUSIVE',reason='Insufficient independent evidence or unresolved results.';
  if(x.fail>0){recommendation='REJECT';reason='Candidate has recorded test failures.'}
  else if(incumbent && x.pass<incumbent.pass){recommendation='INCONCLUSIVE';reason='Candidate has fewer passing test cases than the incumbent.'}
  else if(incumbent && x.independent>0 && x.unknown===0 && x.pass>0){recommendation='REVIEW';reason='No recorded failures, complete reported tests, and at least one independently labeled receipt; independent authentication still requires verification.'}
  return {id:x.id,name:x.name,recommendation,reason};
 });
 return {events,scored,decisions,issues,stats:{events:events.length,evidence:ev.length,candidates:candidates.length,contradictions:issues.filter(x=>x.severity!=='BOUNDARY').length}};
}
export function makeDecisionPacket(c,candidateId,deadline) {
 const assessment=assess(c), candidate=assessment.scored.find(x=>x.id===candidateId && x.role==='CANDIDATE');
 if(!candidate) throw Error('Unknown candidate');
 if(!Number.isFinite(Date.parse(deadline))) throw Error('Invalid deadline');
 return {schema:'tru.founder-decision-packet.v1',decisionId:`decision:${c.caseId}:${candidateId}`,caseId:c.caseId,candidateId,deadline, generatedAt:new Date().toISOString(),recommendation:assessment.decisions.find(x=>x.id===candidateId),evidenceIds:candidate.evidenceIds||[],riskFlags:assessment.issues,rollback:c.rollback||'UNSPECIFIED',authorization:'REQUIRED — NOT GRANTED',gateStatus:'LOCAL_PACKET_ONLY — NOT AUTHENTICATED',options:ACTIONS};
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
