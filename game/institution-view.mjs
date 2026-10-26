const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
import { projectDissentDocket } from './dissent-docket.mjs';

export function renderDissentDocket(container, world, {onOpenReport} = {}) {
 const reports=projectDissentDocket(world);
 container.append(el('h3','FIELD DISSENT & FAILURE REPORTS'));
 container.append(el('p',`${reports.length} retained report(s). Reports are attributed to a specific published version; this read-only docket does not verify, adjudicate, dismiss or reward them.`));
 if(reports.length===0){container.append(el('p','No field reports have been recorded in this world yet.'));return;}
 for(const report of reports){
  const card=el('article');card.className='field-card';card.dataset.recordType='FIELD_REPORT';card.dataset.reportId=report.id;card.dataset.status=report.status;
  card.append(el('h3',`${report.status} · ${report.creationTitle} v${report.version??'?'}`));
  card.append(el('p',report.text));
  const parsed=Date.parse(report.at);const when=Number.isFinite(parsed)?new Date(parsed).toLocaleString():String(report.at||'time unavailable');
  card.append(el('p',`Filed under display name ${report.actorName} · actor ID ${report.actorId || 'unavailable'} · ${when}`));
  card.append(el('p','A preserved report is not a verified finding, adjudication or truth claim.'));
  if(report.inspectable&&typeof onOpenReport==='function'){
   const inspect=el('button','Inspect exact version →');inspect.type='button';inspect.dataset.action='inspect-report-version';inspect.dataset.creationId=report.creationId;inspect.dataset.version=String(report.version);inspect.onclick=()=>onOpenReport(report);card.append(inspect);
  }else{
   const warning=el('p',report.limitation||'The referenced version cannot be opened from this docket.');warning.className='evidence-warning';card.append(warning);
  }
  container.append(card);
 }
}

function renderKernelHistory(container,kernel){
 const events=Array.isArray(kernel?.events)?kernel.events:[];
 const accepted=Array.isArray(kernel?.accepted)?kernel.accepted:[];
 container.append(el('h3','CANONICAL WORK RECEIPTS'));
 container.append(el('p',`Kernel revision ${Number.isInteger(kernel?.revision)?kernel.revision:'unknown'} · ${events.length} retained stage events. These records show local byte preservation only; they do not prove truth, usefulness, independent human review, demand, revenue or public deployment.`));
 if(Number.isInteger(kernel?.eventCount)&&kernel.eventCount!==events.length){
  const mismatch=el('p',`Record count mismatch: service reports ${kernel.eventCount} events but delivered ${events.length}. Treat this view as incomplete until reconciled.`);
  mismatch.className='evidence-warning';container.append(mismatch);
 }
 if(events.length===0){container.append(el('p','No canonical work events are recorded in this shared world yet.'));return;}
 const acceptedByWork=new Map(accepted.filter(w=>typeof w?.workId==='string').map(w=>[w.workId,w]));
 const histories=new Map();
 let ungroupedEventCount=0;
 for(const event of events){
  if(typeof event?.workId!=='string'||!event.workId){ungroupedEventCount++;continue;}
  if(!histories.has(event.workId))histories.set(event.workId,[]);
  histories.get(event.workId).push(event);
 }
 if(ungroupedEventCount>0){const warning=el('p',`${ungroupedEventCount} retained event(s) have no valid work ID and were omitted from grouped histories.`);warning.className='evidence-warning';container.append(warning);}
 const acceptedWithoutHistory=accepted.filter(work=>typeof work?.workId==='string'&&!histories.has(work.workId)).length;
 if(acceptedWithoutHistory>0){const warning=el('p',`${acceptedWithoutHistory} accepted work record(s) have no retained event history.`);warning.className='evidence-warning';container.append(warning);}
 for(const [workId,stages]of histories){
  const work=acceptedByWork.get(workId);
  const claim=stages.find(e=>e.type==='claim');
  const adjudication=[...stages].reverse().find(e=>e.type==='adjudicate');
  const subject=work?.subject||claim?.subject||stages.find(e=>e.subject)?.subject;
  const action=work?.action||claim?.action||'Unspecified action';
  const disposition=work?.stage==='accepted'?'ACCEPTED':adjudication?.decision==='reject'?'REJECTED':'NOT ACCEPTED';
  const card=el('article');card.className='field-card';card.dataset.recordType='KERNEL_WORK';card.dataset.workId=workId;
  card.append(el('h3',`${action} · ${subject?.id||'unknown subject'} v${subject?.version??'?'}`));
  card.append(el('p',`Disposition: ${disposition} · Work: ${workId}`));
  if(work)card.append(el('p',`Executor: ${work.executorId||'unknown'} · Observer: ${work.observerId||'unknown'} · Adjudicator: ${work.adjudicatedBy||'unknown'}`));
  const receipts=Array.isArray(work?.outputs)?work.outputs:[];
  for(const receipt of receipts)card.append(el('small',`${receipt?.algorithm||'sha256'} · ${receipt?.digest||'digest unavailable'} · ${Number.isInteger(receipt?.size)?receipt.size+' bytes':'size unavailable'}`));
  const timeline=el('ol');timeline.className='kernel-timeline';
  for(const event of stages){
   let detail=`${String(event.type||'unknown').toUpperCase()} · actor ${String(event.actor||'unknown')} · ${String(event.at||'time unavailable')}`;
   if(event.type==='observe')detail+=` · observation ${event.passed===true?'passed':event.passed===false?'failed':'not recorded'}`;
   if(event.type==='adjudicate')detail+=` · decision ${String(event.decision||'not recorded')}`;
   timeline.append(el('li',detail));
  }
  card.append(timeline);container.append(card);
 }
 if(histories.size===0)container.append(el('p','The service returned kernel events without work IDs; they cannot be grouped into work receipts.'));
}

export function renderInstitution(container,projects,gate,{founder=false,onChoice,kernel,kernelUnavailable=false}={}){
 container.append(el('p','Real project records, archived contradictions and scoped decisions. These records do not award game XP.'));
 if(kernelUnavailable){container.append(el('h3','CANONICAL WORK RECEIPTS'));const warning=el('p','Canonical work receipts could not be loaded from the shared service. Project and decision records remain available; the missing kernel history is not being treated as empty.');warning.className='evidence-warning';container.append(warning);}else renderKernelHistory(container,kernel);
 for(const [name,rows]of [['PROJECTS',projects.projects],['ACCOMPLISHMENTS',projects.accomplishments],['DISPUTES',projects.disputes],['DECISION STATUS',projects.decisions]]){container.append(el('h3',name));if(!rows.length)container.append(el('p','No retained record is installed.'));for(const row of rows){const card=el('article');card.className='field-card';card.dataset.recordType=name;card.append(el('h3',row.title||row.statement),el('p',row.status||row.disposition),el('small',row.evidenceDigest?`Evidence SHA-256 · ${row.evidenceDigest}`:''));if(row.limitation)card.append(el('p',row.limitation));container.append(card);}}
 container.append(el('h3','FOUNDER GATE'),el('p',founder?'Founder session authenticated. Approval records the displayed disposition; it does not promote code.':'Witness view: private evaluation bytes and controls are withheld.'));
 if(!gate.policy)container.append(el('p','No operational review policy is activated. The first 24-hour clock has not started.'));
 for(const d of gate.decisions||[]){const card=el('article');card.className='field-card';card.dataset.decisionId=d.id;card.append(el('h3',d.title),el('p',`Status: ${d.status} · Expires: ${d.expiresAt}`));if(founder){card.append(el('p',d.proposedEffect),el('p',`Rollback: ${d.rollback}`));for(const risk of d.risks||[])card.append(el('p',`Risk: ${risk}`));if(d.evaluation){const detail=el('details');detail.append(el('summary','Retained evaluation bytes'),el('pre',d.evaluation.bytes));card.append(detail);}if(d.status==='PENDING')for(const action of ['APPROVE','REJECT','DEFER']){const b=el('button',action);b.type='button';b.dataset.gateAction=action;b.onclick=()=>onChoice(d,action);card.append(b);}}container.append(card);}
 container.append(el('p',`External Witness participation: ${projects.witnessParticipation}. Persistent resident accounts remain unimplemented.`));
}
