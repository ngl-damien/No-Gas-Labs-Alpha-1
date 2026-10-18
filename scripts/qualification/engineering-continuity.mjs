// Internal AI qualification probes. No live runtime data or credential files are read.
import {mkdtemp,mkdir,readFile,writeFile,rm,cp,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';

const checkout=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const baseline=process.argv[2]??'3d8485a7a5bf592dbc30d64691848f63e54b2211';
const output=resolve(process.argv[3]??join(checkout,'docs/institution/qualification/evidence/engineering-continuity.json'));
const mode=process.argv[4]??'baseline';
if(!['baseline','candidate'].includes(mode))throw Error('Mode must be baseline or candidate');
const temp=await mkdtemp(join(tmpdir(),'ngl-qualification-engineering-'));
const source=join(temp,'source');
const report={schema:'ngl.qualification.engineering-continuity.v1',observedAt:new Date().toISOString(),reviewer:'INTERNAL_AI',baseline,environment:{node:process.version,platform:process.platform,arch:process.arch},scope:'Disposable same-host source extraction and fake-key stores; not fresh-cloud restoration, independent human review, or certification.',probes:[],limitations:['No power-loss, media-loss, remote backup or fresh-cloud restoration was executed.','A filesystem owner remains trusted; these probes simulate operator omission and local corruption, not an external attack.','Hashes identify bytes; they do not authenticate authorship or authority.']};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const command=(bin,args,cwd=source,timeout=120000)=>{const r=spawnSync(bin,args,{cwd,encoding:'utf8',timeout,maxBuffer:16*1024*1024});return{command:[bin,...args],status:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout??'',stderr:r.stderr??''};};
const add=(id,claim,observation)=>report.probes.push({id,claim,...observation});
function unzip(bytes){const files=new Map();let at=0;while(bytes.readUInt32LE(at)===0x04034b50){const method=bytes.readUInt16LE(at+8),size=bytes.readUInt32LE(at+18),n=bytes.readUInt16LE(at+26),extra=bytes.readUInt16LE(at+28),name=bytes.subarray(at+30,at+30+n).toString(),start=at+30+n+extra,raw=bytes.subarray(start,start+size);if(name.startsWith('/')||name.split('/').includes('..'))throw Error('Unsafe archive member');files.set(name,method===8?inflateRawSync(raw):raw);at=start+size;}if(bytes.readUInt32LE(at)!==0x02014b50)throw Error('Missing ZIP central directory');return files;}
try{
 await mkdir(source);
 const archive=join(temp,'source.tar');
 execFileSync('git',['archive','--format=tar','--output',archive,baseline],{cwd:checkout});
 execFileSync('tar',['-xf',archive,'-C',source]);
 report.source={mode:'Git tracked source archive',commit:execFileSync('git',['rev-parse',baseline],{cwd:checkout,encoding:'utf8'}).trim(),archiveSha256:sha(await readFile(archive))};
 report.phase=mode;
 if(mode==='candidate'){
  report.source.workingTreeOverlay=[];
  for(const path of ['game/server.mjs','game/runtime-layout.mjs','scripts/build-game.mjs','test/runtime-layout.test.mjs']){const content=await readFile(join(checkout,path));await mkdir(dirname(join(source,path)),{recursive:true});await writeFile(join(source,path),content);report.source.workingTreeOverlay.push({path,sha256:sha(content)});}
 }
 const recovery=join(source,'scripts/recover-institution.mjs');
 add('Q-ENG-P01','The retained canonical continuity record and focused controls run on this runtime.',{recovery:command(process.execPath,[recovery]),focused:command(process.execPath,['--test','test/institution-continuity.test.mjs','test/game-package.test.mjs','test/game-decisions.test.mjs'])});
 const packageHash=sha(await readFile(join(source,'package.json')));
 const malformed={schema:'ngl.institution-continuity.v1',principal:'Damien Featherstone',references:[{path:'package.json',sha256:packageHash}],assignments:[null],authority:true,nextAction:true,rollback:true,machinery:{M0:true,M1:true},openFailures:[],taskB:true,founderDecision:true};
 const malformedPath=join(temp,'malformed-continuity.json');await writeFile(malformedPath,JSON.stringify(malformed));
 add('Q-ENG-P02','Recovery rejects non-actionable responsibility, authority, rollback and Founder-decision shapes.',{finding:'Q-ENG-002',input:malformed,result:command(process.execPath,[recovery,malformedPath])});
 const changed={...malformed,references:[{path:'package.json',sha256:'0'.repeat(64)}]};await writeFile(malformedPath,JSON.stringify(changed));
 add('Q-ENG-P03','A changed referenced byte digest is rejected.',{result:command(process.execPath,[recovery,malformedPath])});
 const {buildGame}=await import(pathToFileURL(join(source,'scripts/build-game.mjs')));
 const built=await buildGame({rootDir:source,outDir:join(temp,'build-one')});
 const again=await buildGame({rootDir:source,outDir:join(temp,'build-two')});
 const bytes=await readFile(built.zipPath),files=unzip(bytes),manifest=JSON.parse(files.get('manifest.json'));
 const mismatches=manifest.files.filter(x=>!files.has(x.path)||files.get(x.path).length!==x.size||sha(files.get(x.path))!==x.sha256);
 const secondFiles=unzip(await readFile(again.zipPath));
 const changedMembers=[...files].filter(([name,content])=>!secondFiles.has(name)||!content.equals(secondFiles.get(name))).map(([name,content])=>({path:name,firstSha256:sha(content),secondSha256:secondFiles.has(name)?sha(secondFiles.get(name)):null}));
 add('Q-ENG-P04','Two source builds produce identical ZIP bytes with matching member hashes.',{finding:'Q-ENG-003',fileCount:files.size,zipSha256:sha(bytes),secondZipSha256:sha(await readFile(again.zipPath)),manifestMismatches:mismatches,changedMembers,generatedSummaries:{first:JSON.parse(files.get('launch-checks.json')),second:JSON.parse(secondFiles.get('launch-checks.json'))}});
 const extracted=join(temp,'extracted');await mkdir(extracted);
 for(const[name,content]of files){const target=join(extracted,name);await mkdir(dirname(target),{recursive:true});await writeFile(target,content);}
 add('Q-ENG-P05','The actual distributed source runs its documented recovery and real Node/Python tests.',{recovery:command(process.execPath,['scripts/recover-institution.mjs'],extracted),nodeTests:command(process.execPath,['--test'],extracted),pythonTests:command('python3',['-m','unittest','-v','test_engine.py'],join(extracted,'experiments/AOTA-FEATHERSTONIAN-ENGINE'))});
 const {createGameServer}=await import(pathToFileURL(join(source,'game/server.mjs')));
 const {artifactReceipt}=await import(pathToFileURL(join(source,'src/institution/kernel.mjs')));
 const key='EXPLICITLY_FAKE_QUALIFICATION_FOUNDER_KEY';
 async function host(dataDir){const server=await createGameServer({dataDir,founderKey:key});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;let cookie='';return {server,async request(path,value){const r=await fetch(origin+path,{method:value===undefined?'GET':'POST',headers:{cookie,...(value===undefined?{}:{'content-type':'application/json',origin})},...(value===undefined?{}:{body:JSON.stringify(value)})});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const body=await r.json();if(r.status!==200)throw Error(`Fixture prerequisite failed ${path}: ${r.status} ${JSON.stringify(body)}`);return {status:r.status,body};}};}
 const original=join(temp,'original-store');let h=await host(original);
 try{
  await h.request('/api/login',{key});
  const draft=await h.request('/api/action',{type:'draft',kind:'custom',title:'Continuity marker',intent:'Disposable fixture',html:'<h1>EXPLICITLY_FAKE_CONTINUITY_MARKER</h1>'});
  await h.request('/api/action',{type:'publish',draftId:draft.body.result.draftId,expectedVersion:0});
  await h.request('/api/decisions/policy',{id:'qualification-fixture',reviewWindowMs:86400000,basis:'EXPLICITLY_FAKE policy, no operational activation'});
  const text='EXPLICITLY_FAKE_EVALUATION';
  await h.request('/api/decisions/proposals',{id:'qualification-fixture-review',title:'Disposable fixture',evaluation:{bytes:text,receipt:artifactReceipt(text)},risks:['Fixture only'],rollback:'Delete disposable fixture',proposedEffect:'No source promotion'});
  await h.request('/api/decisions/choose',{decisionId:'qualification-fixture-review',expectedRevision:1,requestId:'qualification-fixture-choice',action:'REJECT'});
  report.storeBefore={world:(await h.request('/api/state')).body.world,decisions:(await h.request('/api/decisions')).body};
  if(report.storeBefore.world.revision!==2||report.storeBefore.world.creations.length!==1||report.storeBefore.decisions.decisions[0]?.status!=='REJECTED')throw Error('Populated-store preconditions failed');
 }finally{await h.server.closeGame();}
 // Copy all public simulation data, then omit exactly one store while stopped.
 for(const omitted of ['decisions/decisions.json','service.json']){
  const restored=join(temp,omitted.startsWith('decisions')?'missing-decisions':'missing-world');await cp(original,restored,{recursive:true});await rm(join(restored,omitted));
  let reopened;const id=omitted.startsWith('decisions')?'Q-ENG-P06':'Q-ENG-P07',claim='A partially restored previously populated institution must detect omitted durable stores rather than initialize replacement history.',before={worldRevision:report.storeBefore.world.revision,creations:report.storeBefore.world.creations.length,decisionRevision:report.storeBefore.decisions.revision,decisionCount:report.storeBefore.decisions.decisions.length,decisionStatus:report.storeBefore.decisions.decisions[0]?.status};
  try{reopened=await host(restored);await reopened.request('/api/login',{key});const world=(await reopened.request('/api/state')).body.world,decisions=(await reopened.request('/api/decisions')).body;add(id,claim,{finding:'Q-ENG-001',omitted,startup:'SUCCEEDED',before,after:{worldRevision:world.revision,creations:world.creations.length,decisionRevision:decisions.revision,decisionCount:decisions.decisions.length,decisionStatus:decisions.decisions[0]?.status??null},replacementWritten:(await stat(join(restored,omitted))).isFile()});}
  catch(error){add(id,claim,{finding:'Q-ENG-001',omitted,startup:'REJECTED',before,code:error.code??null,message:error.message,replacementWritten:await stat(join(restored,omitted)).then(s=>s.isFile(),()=>false)});}
  finally{await reopened?.server.closeGame();}
 }
 const corrupt=join(temp,'corrupt-decisions');await cp(original,corrupt,{recursive:true});await writeFile(join(corrupt,'decisions/decisions.json'),'INVALID_EXPLICITLY_FAKE_JSON');let rejected;
 try{h=await host(corrupt);rejected={startup:'SUCCEEDED'};await h.server.closeGame();}catch(error){rejected={startup:'REJECTED',code:error.code,message:error.message};}
 add('Q-ENG-P08','Present but corrupt decision bytes fail closed; the server does not substitute empty history.',rejected);
 const corruptWorld=join(temp,'corrupt-world');await cp(original,corruptWorld,{recursive:true});const envelope=JSON.parse(await readFile(join(corruptWorld,'service.json'),'utf8'));envelope.digest='0'.repeat(64);await writeFile(join(corruptWorld,'service.json'),JSON.stringify(envelope));
 try{h=await host(corruptWorld);rejected={startup:'SUCCEEDED'};await h.server.closeGame();}catch(error){rejected={startup:'REJECTED',code:error.code??null,message:error.message};}
 add('Q-ENG-P10','Present but inconsistent world envelope bytes fail closed.',rejected);
 // A complete same-host stopped-store copy is the control for the omission experiment.
 const complete=join(temp,'complete-copy');await cp(original,complete,{recursive:true});h=await host(complete);
 try{await h.request('/api/login',{key});const world=(await h.request('/api/state')).body.world,decisions=(await h.request('/api/decisions')).body;add('Q-ENG-P09','A complete stopped-store copy preserves the two independent histories.',{sameHostOnly:true,worldRevision:world.revision,creations:world.creations.length,decisionRevision:decisions.revision,decisionCount:decisions.decisions.length,decisionStatus:decisions.decisions[0]?.status});}finally{await h.server.closeGame();}
 if(mode==='candidate'){
  const invalid=join(temp,'failed-first-start');let first,second;
  try{const failed=await createGameServer({dataDir:invalid,founderKey:'short'});await failed.closeGame();first={startup:'SUCCEEDED'};}catch(error){first={startup:'REJECTED',code:error.code??null,message:error.message};}
  try{const retried=await createGameServer({dataDir:invalid,founderKey:key});await retried.closeGame();second={startup:'SUCCEEDED'};}catch(error){second={startup:'REJECTED',code:error.code??null,message:error.message};}
  add('Q-ENG-P11','A failed initial configuration attempt can be retried after correcting the key without manual store recovery.',{first,second,anchorPresent:await stat(join(invalid,'runtime-layout.json')).then(s=>s.isFile(),()=>false)});
 }
 delete report.storeBefore;
 report.harnessSha256=sha(await readFile(fileURLToPath(import.meta.url)));
 const absenceContained=['Q-ENG-P06','Q-ENG-P07'].every(id=>report.probes.find(p=>p.id===id)?.code==='INCOMPLETE_RUNTIME');
 report.findings=[{id:'Q-ENG-001',classification:'REPRODUCED',severity:'HIGH',status:absenceContained?'ORIGINAL_OMISSION_CONTAINED_IN_CANDIDATE':'OPEN',probes:['Q-ENG-P06','Q-ENG-P07']},{id:'Q-ENG-002',classification:'REPRODUCED',severity:'MEDIUM',status:'OPEN',probes:['Q-ENG-P02']},{id:'Q-ENG-003',classification:'REPRODUCED',severity:'LOW',status:'OPEN_REPRODUCIBILITY_LIMITATION',probes:['Q-ENG-P04']}];
 report.qualificationPassed=false;
 report.executed=true;
}catch(error){report.harnessError={message:error.message,stack:error.stack};process.exitCode=1;}
finally{await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');await rm(temp,{recursive:true,force:true});}
console.log(JSON.stringify({output,executed:report.executed??false,qualificationPassed:report.qualificationPassed??false,findings:report.findings,probes:report.probes.map(({id,result,nodeTests,recovery,focused,pythonTests})=>({id,...(result?{exit:result.status}:{}),...(nodeTests?{nodeTestsExit:nodeTests.status}:{}),...(pythonTests?{pythonTestsExit:pythonTests.status}:{}),...(recovery?{recoveryExit:recovery.status}:{}),...(focused?{focusedExit:focused.status}:{})})),harnessError:report.harnessError??null}));
