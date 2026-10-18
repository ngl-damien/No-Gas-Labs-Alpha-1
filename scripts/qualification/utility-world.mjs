/** Internal AI qualification: local utility delivery and world/evidence boundaries.
 * Never opens operational state/keys. All HTTP state uses /tmp and a fake key.
 * Default records observations; --require-safe makes known unsafe outcomes fail.
 */
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {projectProjection} from '../../src/institution/project-projection.mjs';
import {projectWorld} from '../../src/world/project.js';
import {makeReceipt} from '../../src/evidence/content-addressed.js';
import {createGameServer} from '../../game/server.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const args=process.argv.slice(2), outArg=args.indexOf('--out');
const output=outArg<0?join(root,'docs/institution/qualification/evidence/utility-world.json'):resolve(args[outArg+1]);
const reportPath='docs/institution/compounding/evidence/experiment.json';
const originalBytes=await readFile(join(root,reportPath)), report=JSON.parse(originalBytes);
const sourcePaths=['src/institution/project-projection.mjs','src/world/project.js','game/server.mjs','scripts/run-compounding.py','scripts/qualification/utility-world.mjs',reportPath,'docs/institution/compounding/task-a.profile.json','docs/institution/compounding/task-b.profile.json'];
const sourceReceipts=await Promise.all(sourcePaths.map(async path=>{const bytes=await readFile(join(root,path));return {path,sha256:hash(bytes),size:bytes.length};}));
const evidence={schema:'ngl.qualification.utility-world.v1',recordedAt:new Date().toISOString(),reviewer:'Internal AI qualification worker; no independent human certification',baseline:'3d8485a7a5bf592dbc30d64691848f63e54b2211',observedHead:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),sourceReceipts,scope:{realKeysRead:false,customerDataRead:false,externalProviderCalls:0,externalMessages:0,deployment:false,providerSpendAuthorized:false,fixtureStorage:'OS temporary directory, removed in finally'},projection:{},legacyWorld:{},runtime:{},delivery:{}};

const projectionCases=[
 ['accepted-string-false',task=>{task.m1.accepted='false';}],
 ['accepted-number-one',task=>{task.m1.accepted=1;}],
 ['accepted-true-zero-tests',task=>{task.m1.accepted=true;task.m1.tests.count=0;}],
 ['accepted-true-failed-tests',task=>{task.m1.accepted=true;task.m1.tests.exitCode=1;}],
 ['accepted-true-failed-entry',task=>{task.m1.accepted=true;task.m1.entryPoint.exitCode=1;task.m1.entryPoint.passed=false;}],
 ['accepted-true-integrity-false',task=>{task.m1.accepted=true;task.m1.integrity=false;task.m1.errors=['synthetic ZIP integrity failure'];}],
 ['accepted-true-build-failed',task=>{task.m1.accepted=true;task.m1.build.exitCode=1;}],
 ['accepted-true-file-coverage-short',task=>{task.m1.accepted=true;task.m1.matchedFiles=0;}]
];
evidence.projection.valid=projectProjection(report);
evidence.projection.negative=projectionCases.map(([name,mutate])=>{
 const clone=structuredClone(report);mutate(clone.tasks.A);
 try{const result=projectProjection(clone);return {name,fixture:{task:'A',m1:clone.tasks.A.m1},rejected:false,accomplishment:result.accomplishments[0],unsafeLocalTested:result.accomplishments[0]?.status==='LOCALLY_TESTED'};}
 catch(error){return {name,fixture:{task:'A',m1:clone.tasks.A.m1},rejected:true,error:error.message,unsafeLocalTested:false};}
});
const artifact=Buffer.from('synthetic arbitrary bytes; not an execution or independent observation');
const event={event_id:'qualification-local-reward',event_type:'SYSTEM_EVENT',subject:'qualification-fixture',admission:'ACCEPTED',authority:'AUTHORIZED',execution:'EXECUTED',evidence:'OBSERVED',outcome:'SUCCEEDED',receipts:[makeReceipt(artifact)],world_effect:{xp:999,world:{forgeOpen:true}}};
evidence.legacyWorld.event=event;
evidence.legacyWorld.negative=[undefined,'UNVERIFIED'].map(verification=>{
 const input={...event,...(verification?{observation_verification:verification}:{})};
 const state=projectWorld([input],undefined,{resolveArtifact:()=>artifact});
 return {verification:verification??'ABSENT',xp:state.xp,status:state.quests['qualification-fixture']?.status,world:state.world,unsafeReward:state.xp>0};
});
evidence.legacyWorld.control={noResolverXP:projectWorld([event]).xp,changedBytesXP:projectWorld([event],undefined,{resolveArtifact:()=>Buffer.from('changed')}).xp};
assert.equal(evidence.legacyWorld.control.noResolverXP,0);assert.equal(evidence.legacyWorld.control.changedBytesXP,0);

const directory=await mkdtemp(join(tmpdir(),'ngl-qualification-utility-'));
let server;
try{
 server=await createGameServer({dataDir:join(directory,'service'),founderKey:'synthetic-qualification-key-never-used-in-production',institutionReport:report});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const base=`http://127.0.0.1:${server.address().port}`;
 function client(){let cookie='';return async(path,body)=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json',origin:base})},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return {status:response.status,body:await response.json()};};}
 const witness=client(),founder=client();
 const first=await witness('/api/state');assert.equal(first.body.viewer.role,'witness');
 const noRole=await witness('/api/action',{type:'draft',kind:'custom',title:'fixture',html:'<!doctype html><html><body>fixture</body></html>'});
 const forged=await witness('/api/action',{type:'draft',role:'founder',kind:'comic',title:'fixture'});
 const policy=await witness('/api/decisions/policy',{});
 const projects=await witness('/api/projects');
 assert.equal(noRole.status,403);assert.equal(forged.status,400);assert.equal(policy.status,403);assert.equal(first.body.world.xp,0);assert.equal(first.body.institution.kernel.accepted.length,0);
 const login=await founder('/api/login',{key:'synthetic-qualification-key-never-used-in-production'});assert.equal(login.status,200);
 const draft=await founder('/api/action',{type:'draft',kind:'custom',title:'Synthetic local preservation',intent:'Fixture only; no external utility claim',html:'<!doctype html><html><body><p id="fixture">local fixture bytes</p></body></html>'});
 const hidden=await witness('/api/state');assert.equal(JSON.stringify(hidden.body).includes('Synthetic local preservation'),false);
 const published=await founder('/api/action',{type:'publish',draftId:draft.body.result.draftId,expectedVersion:0});assert.equal(published.status,200);
 const institution=published.body.institution;
 assert.equal(institution.kernel.accepted[0].action,'preserve-artifact-bytes');assert.equal(institution.capabilities.externalProviders.configured,false);
 const notes=await witness('/api/action',{type:'contribute',creationId:published.body.result.creationId,version:1,text:'Synthetic role test, not a real external Witness review'});assert.equal(notes.status,200);assert.equal(notes.body.world.xp,100);
 const logout=await founder('/api/logout',{});assert.equal(logout.body.viewer.role,'witness');
 const afterLogout=await founder('/api/action',{type:'draft',kind:'comic',title:'must reject'});assert.equal(afterLogout.status,403);
 evidence.runtime={initialRole:first.body.viewer.role,reportOnlyXP:first.body.world.xp,reportOnlyAcceptedKernelWorks:first.body.institution.kernel.accepted.length,witnessDraft:noRole.status,forgedRole:forged.status,witnessPolicy:policy.status,privateDraftHidden:true,publishedAction:institution.kernel.accepted[0].action,publishedXP:published.body.world.xp,contributionXP:notes.body.world.xp,afterLogoutDraft:afterLogout.status,externalProviders:institution.capabilities.externalProviders,witnessParticipation:projects.body.witnessParticipation,roles:projects.body.roles,limitations:institution.limitations,independentWitnessesCreated:0};
}finally{if(server)await server.closeGame();await rm(directory,{recursive:true,force:true});}

// Imported evaluator inspects only the two explicit public component archives.
// It cannot run main(), copy operational state, use real keys, or contact providers.
const python=String.raw`
import sys, json, hashlib, tempfile, subprocess, importlib.util, zipfile, io, re, time
from pathlib import Path
sys.dont_write_bytecode=True
root=Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('qualification_delivery',root/'scripts/run-compounding.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
sha=lambda b:hashlib.sha256(b).hexdigest()
report=json.loads((root/'docs/institution/compounding/evidence/experiment.json').read_text());output={}
def run(command,cwd):
 start=time.monotonic();r=subprocess.run(command,cwd=cwd,capture_output=True,timeout=60)
 return {'exitCode':r.returncode,'wallMs':(time.monotonic()-start)*1000,'stdoutSHA256':sha(r.stdout),'stderrSHA256':sha(r.stderr),'stdout':r.stdout.decode(errors='replace'),'stderr':r.stderr.decode(errors='replace')}
with tempfile.TemporaryDirectory(prefix='ngl-qualification-delivery-') as scratch:
 scratch=Path(scratch)
 for key in ['A','B']:
  profile_path=root/f'docs/institution/compounding/task-{key.lower()}.profile.json';profile=json.loads(profile_path.read_text());archive=root/report['tasks'][key]['artifact'];origin='retained dist archive'
  if not archive.exists() or sys.argv[2]=='rebuild':
   built=run(['node',str(root/'scripts/package-component.mjs'),'--profile',str(profile_path),'--out',str(scratch/f'{key}-rebuilt'),'--root',str(root)],root);assert built['exitCode']==0,built
   archive=Path(json.loads(built['stdout'])['archivePath']);origin='fresh temporary build'
  inspection=h.inspect(archive,profile,root)
  assert inspection['accepted'],inspection
  assert sha(archive.read_bytes())==report['tasks'][key]['m1']['archiveSHA256'],'Retained delivery digest differs'
  dest=scratch/key;dest.mkdir()
  with zipfile.ZipFile(archive) as z:z.extractall(dest)
  cwd=dest/'experiments/AOTA-FEATHERSTONIAN-ENGINE'/('TRU' if key=='B' else '')
  tests=run(['python3','-m','unittest','-v','test_engine.py'] if key=='A' else ['node','--test','test.mjs'],cwd)
  match=re.search(r'Ran (\d+) tests?',tests['stderr']) if key=='A' else re.search(r'[\u2139#]\s*tests\s+(\d+)',tests['stdout']);count=int(match.group(1)) if match else 0
  assert tests['exitCode']==0 and count>0,tests
  tests['count']=count;tests.pop('stdout');tests.pop('stderr')
  # Coherent manifest/CRC rewrite must still fail comparison to frozen source.
  tampered=scratch/f'{key}-changed.zip'
  with zipfile.ZipFile(archive) as z:
   members={name:z.read(name) for name in z.namelist()}
  changed=profile['entryPoint'];members[changed]+=b'\n# synthetic changed bytes\n'
  manifest=json.loads(members['manifest.json'])
  for item in manifest['files']:
   if item.get('target',item.get('path'))==changed:item['size']=len(members[changed]);item['sha256']=sha(members[changed])
  manifest['totalBytes']=sum(x['size'] for x in manifest['files']);members['manifest.json']=json.dumps(manifest).encode()
  with zipfile.ZipFile(tampered,'w',zipfile.ZIP_DEFLATED) as z:
   for name,data in members.items():z.writestr(name,data)
  negative=h.inspect(tampered,profile,root);assert not negative['accepted'] and negative['integrity'],negative
  result={'archive':report['tasks'][key]['artifact'],'archiveOrigin':origin,'inspection':inspection,'tests':tests,'coherentManifestRewrite':negative}
  if key=='A':
   entry=run(['python3','engine.py','example_claims.json','--root','.'],cwd);assert entry['exitCode']==0
   result['entryPoint']={**{k:v for k,v in entry.items() if k not in ['stdout','stderr']},'report':json.loads(entry['stdout'])}
   (cwd/'malformed.json').write_text('{"claims":[NaN]}');bad=run(['python3','engine.py','malformed.json','--root','.'],cwd);assert bad['exitCode']!=0;result['malformedInput']={k:v for k,v in bad.items() if k!='stdout'}
  else:
   result['browserEntry']=h.browser_entry(cwd);assert result['browserEntry']['passed']
  output[key]=result
print(json.dumps(output))
`;
const delivered=spawnSync('python3',['-c',python,root,args.includes('--rebuild-delivery')?'rebuild':'retained'],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
if(delivered.status!==0)throw new Error(`Public delivery validation failed: ${delivered.stderr}`);
evidence.delivery=JSON.parse(delivered.stdout);
evidence.cost={providerCallsInThisHarness:0,totalInstitutionOperatingCost:'UNKNOWN',paidModelTokens:'NOT_MEASURED',hostAndStorageCost:'NOT_MEASURED',humanReviewAndSupportCost:'NOT_MEASURED',revenue:'NO_EXTERNAL_REVENUE_EVIDENCE_INSPECTED',limitation:'No additional provider call in this harness does not imply zero total cost, positive margin, demand, or market viability.'};
evidence.gates={A:{utility:'Local component delivery extends the actual M0 exporter coverage; no comparative economic or customer outcome.',world:'Report-only projection adds records without XP or kernel acceptance; negative semantic failures reproduced.'},B:{utility:'NOT_ESTABLISHED: needs authorized actual users, task acceptance, measured costs and operating requirements.',world:'NOT_ESTABLISHED: imported-report truthfulness and legacy admission issues remain; no independent human review.'},C:{utility:'PARTIAL: coherent ZIP mutation detected, failures retained; no provider outage/budget/support recovery exercise.',world:'PARTIAL: local role denial and logout observed; report semantics and legacy projection require disposition and recovery evidence.'}};
evidence.limitations=['Tests exercise local artifacts and synthetic participants; no customer, revenue, market, independent Witness, or external specialist review is fabricated.','Legacy projectWorld is not the current game service strict kernel. No exposed remote route to label-driven legacy rewards was demonstrated.','Imported report digests identify bytes, not truth or authenticated execution. Strict validation cannot defeat a coherent false report from its trusted operator.','Preserved script imports the current checkout. Source receipts identify the observed implementation; reruns after repair produce new observations and must use a separate --out path to preserve baseline failures.'];
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(evidence,null,2)+'\n');
const unsafeProjection=evidence.projection.negative.filter(r=>r.unsafeLocalTested).length,unsafeLegacy=evidence.legacyWorld.negative.filter(r=>r.unsafeReward).length;
console.log(JSON.stringify({output,projectionFalseAccomplishments:unsafeProjection,legacyUnverifiedRewards:unsafeLegacy,deliveredTests:{A:evidence.delivery.A.tests.count,B:evidence.delivery.B.tests.count},browserEntry:evidence.delivery.B.browserEntry.passed,roleChecks:'passed',certification:'not established'}));
if(args.includes('--require-safe')&&(unsafeProjection||unsafeLegacy))process.exitCode=1;
