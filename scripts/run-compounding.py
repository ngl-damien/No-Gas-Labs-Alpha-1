"""Paired component-delivery experiment. Python owns acceptance independently of M1.

M0 is the exact Meteor game exporter, not a deliberately weakened imitation.
This measures a new delivery capability, never a speedup between unequal outputs.
"""
import argparse, functools, hashlib, http.server, json, os, re, shutil, subprocess, tempfile, threading, time, zipfile
from pathlib import Path, PurePosixPath

ROOT=Path(__file__).resolve().parents[1]
M0='cab8dfb0d6ae41626db8010ae300210ccd0ca7a2'
SPEC='a9d4389fa9c3431c561311399980d6504f7b530a'
PROFILE_COMMIT='137c9c7'
BASE='experiments/AOTA-FEATHERSTONIAN-ENGINE'
sha=lambda b:hashlib.sha256(b).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
def save(path,value):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
def run(command,cwd,log):
 start=time.monotonic();result=subprocess.run(command,cwd=cwd,capture_output=True,timeout=120)
 log.parent.mkdir(parents=True,exist_ok=True);log.with_suffix('.stdout.log').write_bytes(result.stdout);log.with_suffix('.stderr.log').write_bytes(result.stderr)
 return {'command':command,'exitCode':result.returncode,'wallMs':(time.monotonic()-start)*1000,'stdoutSHA256':sha(result.stdout),'stderrSHA256':sha(result.stderr),'stdout':result.stdout.decode(errors='replace'),'stderr':result.stderr.decode(errors='replace')}
def public_result(result):return {k:v for k,v in result.items() if k not in ('stdout','stderr')}
def inspect(archive,profile,source):
 errors=[];matched=0
 with zipfile.ZipFile(archive) as package:
  names=package.namelist()
  if len(names)!=len(set(names)) or package.testzip() is not None:errors.append('Duplicate name or invalid CRC')
  for item in package.infolist():
   path=PurePosixPath(item.filename)
   if path.is_absolute() or '..' in path.parts or '\\' in item.filename or item.file_size>32*1024*1024 or (item.external_attr>>16)&0o170000==0o120000:raise ValueError('Unsafe ZIP member')
   if any(part.lower() in ('.runtime','.git','.aws','.env','secrets','credentials') for part in path.parts) or path.suffix.lower() in ('.pem','.key'):errors.append('Private ZIP member: '+item.filename)
  manifest=json.loads(package.read('manifest.json'))
  declared=[record.get('target',record.get('path')) for record in manifest['files']]
  if len(declared)!=len(set(declared)) or set(names)!=set(declared)|{'manifest.json'}:errors.append('ZIP membership differs from manifest')
  for record in manifest['files']:
   name=record.get('target',record.get('path'));data=package.read(name)
   if len(data)!=record['size'] or sha(data)!=record['sha256']:errors.append('Manifest mismatch: '+name)
  integrity=not errors
  expected_names={item['target'] for item in profile['files']}|{'manifest.json'}
  if set(names)!=expected_names:errors.append('ZIP membership differs from frozen component profile')
  if manifest.get('schema')=='ngl.component-manifest.v1':
   if manifest.get('id')!=profile['id'] or manifest.get('entryPoint')!=profile['entryPoint'] or manifest.get('totalBytes')!=sum(record['size'] for record in manifest['files']):errors.append('Incorrect component manifest identity or total')
   if {(record.get('source'),record.get('target')) for record in manifest['files']}!={(item['source'],item['target']) for item in profile['files']}:errors.append('Incorrect component source mapping')
  elif set(names)==expected_names:errors.append('Incorrect component manifest schema')
  for item in profile['files']:
   expected=(source/item['source']).read_bytes()
   if item['target'] not in names:errors.append('Missing declared component file: '+item['target'])
   elif package.read(item['target'])!=expected:errors.append('Changed declared component bytes: '+item['target'])
   else:matched+=1
 return {'archiveSHA256':sha(Path(archive).read_bytes()),'archiveBytes':Path(archive).stat().st_size,'integrity':integrity,'requiredFiles':len(profile['files']),'matchedFiles':matched,'errors':errors,'accepted':not errors and matched==len(profile['files'])}
def extract(archive,destination):
 destination.mkdir();
 with zipfile.ZipFile(archive) as package:package.extractall(destination)
def browser_entry(directory):
 from playwright.sync_api import sync_playwright,expect
 class Quiet(http.server.SimpleHTTPRequestHandler):
  def log_message(self,*args):pass
 server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(directory)))
 thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();started=time.monotonic();errors=[]
 try:
  with sync_playwright() as playwright:
   browser=playwright.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
   page=browser.new_page(viewport={'width':390,'height':844});page.on('pageerror',lambda error:errors.append(str(error)))
   response=page.goto(f'http://127.0.0.1:{server.server_port}/index.html');assert response.status==200
   expect(page.locator('#digest')).to_contain_text('Local case SHA-256:')
   page.locator('#file').set_input_files(str(directory/'examples/real-lineage.case.json'))
   expect(page.locator('#timeline .item')).to_have_count(3)
   expect(page.locator('#digest')).to_contain_text('Local case SHA-256:');expect(page.locator('#error')).to_be_empty()
   assert not errors,errors
   with page.expect_download() as download:page.locator('#export').click()
   exported=json.loads(Path(download.value.path()).read_text());assert exported==json.loads((directory/'examples/real-lineage.case.json').read_text())
   result={'passed':True,'entryPoint':'index.html over loopback HTTP from the extracted ZIP','viewport':390,'checks':['HTTP 200','module executed and digest rendered','real lineage imported: three events','exported case exact equality','no page errors'],'wallMs':(time.monotonic()-started)*1000}
   browser.close();return result
 finally:server.shutdown();server.server_close();thread.join()
def main():
 started=time.monotonic()
 parser=argparse.ArgumentParser();parser.add_argument('--out');args=parser.parse_args();(ROOT/'.runtime').mkdir(exist_ok=True)
 out=Path(args.out).resolve() if args.out else Path(tempfile.mkdtemp(prefix='transfer-',dir=ROOT/'.runtime'))
 if args.out:out.mkdir()
 head=git('rev-parse','HEAD').decode().strip();source=out/'source';source.mkdir();profiles={}
 harness={'path':'scripts/run-compounding.py','sha256':sha(Path(__file__).read_bytes()),'python':subprocess.check_output(['python3','--version']).decode().strip(),'node':subprocess.check_output(['node','--version']).decode().strip(),'platform':os.uname().sysname}
 for key in ['A','B']:
  path=f'docs/institution/compounding/task-{key.lower()}.profile.json';raw=git('show',f'{PROFILE_COMMIT}:{path}');profiles[key]=json.loads(raw);(out/f'profile-{key}.json').write_bytes(raw)
 # Only known public game assets, machinery and declared component files are copied.
 paths=set(git('ls-tree','-r','--name-only',head,'game').decode().splitlines())
 paths.update(['src/production/component-package.mjs','scripts/package-component.mjs'])
 for profile in profiles.values():paths.update(item['source'] for item in profile['files'])
 source_records=[]
 for path in sorted(paths):
  data=git('show',f'{head}:{path}');target=source/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);source_records.append({'path':path,'sha256':sha(data),'size':len(data)})
 source_digest=sha(json.dumps(source_records,sort_keys=True,separators=(',',':')).encode());save(out/'source-manifest.json',source_records)
 old=out/'m0-tool';(old/'scripts').mkdir(parents=True)
 for name in ['build-game.mjs','build-exhibit.mjs']:(old/'scripts'/name).write_bytes(git('show',f'{M0}:scripts/{name}'))
 old_result=run(['node','--input-type=module','-e',"const {buildGame}=await import(process.argv[3]);console.log(JSON.stringify(await buildGame({rootDir:process.argv[1],outDir:process.argv[2]})))",str(source),str(out/'m0-game'),(old/'scripts/build-game.mjs').as_uri()],ROOT,out/'m0-build')
 if old_result['exitCode']:raise RuntimeError('Actual M0 exporter failed; do not manufacture a comparison: '+old_result['stderr'])
 old_archive=out/'m0-game/no-gas-labs-meteor.zip';tasks={};deliveries=ROOT/'dist/compounding';deliveries.mkdir(parents=True,exist_ok=True)
 for key,profile in profiles.items():
  label='task-'+key.lower();candidate=run(['node',str(source/'scripts/package-component.mjs'),'--profile',str(out/f'profile-{key}.json'),'--out',str(out/label),'--root',str(source)],ROOT,out/(label+'-build'))
  if candidate['exitCode']:raise RuntimeError('M1 component export failed: '+candidate['stderr'])
  artifact=Path(json.loads(candidate['stdout'])['archivePath']);m0=inspect(old_archive,profile,source);m1=inspect(artifact,profile,source)
  m1['build']=public_result(candidate)
  destination=out/(label+'-extracted');extract(artifact,destination)
  cwd=destination/BASE/('TRU' if key=='B' else '')
  checks=run(['python3','-m','unittest','-v','test_engine.py'] if key=='A' else ['node','--test','test.mjs'],cwd,out/(label+'-tests'))
  count=re.search(r'Ran (\d+) tests?',checks['stderr']) if key=='A' else re.search(r'[ℹ#]\s*tests\s+(\d+)',checks['stdout'])
  m1['tests']={**public_result(checks),'count':int(count.group(1)) if count else 0}
  smoke=run(['python3','engine.py','example_claims.json','--root','.'] if key=='A' else ['node','--input-type=module','-e',"import{readFile}from'node:fs/promises';import{assertCase,assess}from'./core.mjs';const c=assertCase(JSON.parse(await readFile('examples/real-lineage.case.json','utf8')));console.log(JSON.stringify({caseId:c.caseId,eventCount:assess(c).events.length,authorization:'NOT_GRANTED'}))"],cwd,out/(label+'-entry'))
  m1['entryPoint']=public_result(smoke);m1['accepted']=m1['accepted'] and checks['exitCode']==0 and m1['tests']['count']>0 and smoke['exitCode']==0
  if key=='B':m1['kernelSmoke']=m1.pop('entryPoint');m1['entryPoint']=browser_entry(cwd);m1['accepted']=m1['accepted'] and m1['entryPoint']['passed']
  save(ROOT/f'docs/institution/compounding/evidence/{label}-execution.json',{'tests':checks,'entryPoint':smoke})
  m0['componentChecks']='NOT_RUN: declared component files absent; M0 retains its original game-export capability.'
  final=deliveries/(profile['id']+'.zip');shutil.copyfile(artifact,final)
  tasks[key]={'title':'AOTA local evidence inspector' if key=='A' else 'T.R.U. temporal evidence workbench','requiredFiles':len(profile['files']),'profileSHA256':sha((out/f'profile-{key}.json').read_bytes()),'m0':m0,'m1':m1,'artifact':str(final.relative_to(ROOT))}
 # Mutation with a valid CRC must still be rejected by the independent parent.
 profile=profiles['B'];tampered=out/'tampered.zip'
 with zipfile.ZipFile(deliveries/(profile['id']+'.zip')) as original,zipfile.ZipFile(tampered,'w',zipfile.ZIP_DEFLATED) as changed:
  for name in original.namelist():changed.writestr(name,original.read(name)+(b'\nTAMPERED' if name==profile['entryPoint'] else b''))
 negative=inspect(tampered,profile,source)
 if negative['accepted']:raise RuntimeError('Independent evaluator accepted tampered bytes')
 injected=out/'injected.zip'
 with zipfile.ZipFile(deliveries/(profile['id']+'.zip')) as original,zipfile.ZipFile(injected,'w',zipfile.ZIP_DEFLATED) as changed:
  for name in original.namelist():changed.writestr(name,original.read(name))
  changed.writestr('.runtime/secret','synthetic undeclared canary, not a secret')
 injected_result=inspect(injected,profile,source)
 if injected_result['accepted']:raise RuntimeError('Independent evaluator accepted undeclared private member')
 for record in source_records:
  if sha((source/record['path']).read_bytes())!=record['sha256']:raise RuntimeError('Frozen source changed during comparison')
 report={'schema':'ngl.compounding-experiment.v1','id':'alpha1-transfer-20261018','recordedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'harness':harness,'wallMs':(time.monotonic()-started)*1000,'source':{'commit':head,'specification':SPEC,'profileFreeze':PROFILE_COMMIT,'snapshotDigest':source_digest,'M0':M0},'classification':'TRANSFER_OBSERVED_COMPONENT_DELIVERY' if all(t['m1']['accepted'] and t['m0']['integrity'] and not t['m0']['accepted'] for t in tasks.values()) else 'INCONCLUSIVE','criterion':'Exact required-file coverage plus actual extracted component tests and entry points, without integrity regression. Capability expansion; unequal outputs are not a speed comparison.','tasks':tasks,'negative':{'tamperedZIPRejected':not negative['accepted'],'errors':negative['errors'],'undeclaredPrivateMemberRejected':not injected_result['accepted'],'injectedErrors':injected_result['errors']},'sourceIntegrity':True,'baselineExporterExecution':public_result(old_result),'founderBurden':{'baselineHumanInterventions':None,'observedPolicyResponses':1,'policyResponse':'24 hours, starting only after authenticated HTTPS reachability and evidence readiness','automatedPackagingInvocations':2,'conclusion':'INCONCLUSIVE: automated steps are not an observed before/after human-intervention baseline.'},'governance':{'operationalDecisionCreated':False,'reviewWindowHours':24,'clockStarted':False,'promotion':'NOT_AUTHORIZED_AUTOMATICALLY'},'contradictions':[{'statement':'The imported Python source defined 21 tests but could not be imported because of a syntax error.','disposition':'Original import retained in Git; repaired executable tested separately.'},{'statement':'Original T.R.U. input labels and PASS counts could suggest review despite missing comparable evidence.','disposition':'Repaired schema/comparison boundaries; local imported labels remain untrusted.'}],'limitations':['M0 was a game/source exporter, not a generic component exporter; this demonstrates a new declared operation, not a defect in its original purpose.','Task B profile was frozen before machinery implementation; worker isolation was procedural, not a hostile-process security boundary.','A single transfer is not sustained institutional growth.','No live HTTPS Gate, external users, cloud restoration or human-burden reduction is established.']}
 save(out/'experiment.json',report);save(ROOT/'docs/institution/compounding/evidence/experiment.json',report);save(deliveries/'experiment.json',report)
 print(json.dumps({'report':str(out/'experiment.json'),'classification':report['classification'],'tasks':{k:{'M0':v['m0']['accepted'],'M1':v['m1']['accepted'],'tests':v['m1']['tests']['count']} for k,v in tasks.items()}}))
if __name__=='__main__':main()
