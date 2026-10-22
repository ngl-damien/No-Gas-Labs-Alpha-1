import hashlib, json, os, subprocess, sys, tempfile, unittest
from unittest.mock import patch
from pathlib import Path
from engine import audit
class GateTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
  self.root.joinpath('proof.txt').write_text('hello')
  self.root.joinpath('test.txt').write_text('test executed? no, merely a file')
  self.digest=hashlib.sha256(b'hello').hexdigest()
  self.test_digest=hashlib.sha256(b'test executed? no, merely a file').hexdigest()
 def tearDown(self): self.tmp.cleanup()
 def claim(self,state='VERIFIED',evidence=None,dependencies=None,id='a'):
  return {'id':id,'declared':state,'evidence':evidence or [],'dependencies':dependencies or []}
 def proof(self,kind='source',digest=None,path='proof.txt'):
  return {'kind':kind,'path':path,'sha256':digest or self.digest}
 def test_source_only_caps_verified(self):
  x=audit([self.claim(evidence=[self.proof()])],self.root)
  self.assertEqual(x['results']['a']['ceiling'],'BUILT')
 def test_matching_evidence(self):
  x=audit([self.claim(evidence=[self.proof('source'),self.proof('test',digest=self.test_digest,path='test.txt')])],self.root)
  self.assertEqual(x['results']['a']['ceiling'],'VERIFIED')
 def test_tampering(self):
  x=audit([self.claim(evidence=[self.proof(digest='0'*64)])],self.root)
  self.assertEqual(x['results']['a']['ceiling'],'PLANNED')
 def test_parent_traversal(self):
  x=audit([self.claim(evidence=[self.proof(path='../proof.txt')])],self.root)
  self.assertEqual(x['results']['a']['ceiling'],'PLANNED')
 def test_absolute_path(self):
  x=audit([self.claim(evidence=[self.proof(path=str(self.root/'proof.txt'))])],self.root)
  self.assertEqual(x['results']['a']['ceiling'],'PLANNED')
 def test_missing(self):
  x=audit([self.claim(evidence=[self.proof(path='absent')])],self.root)
  self.assertEqual(x['results']['a']['ceiling'],'PLANNED')
 def test_dependency_caps(self):
  claims=[self.claim('BUILT',[self.proof()],id='a'),self.claim('VERIFIED',[self.proof('source'),self.proof('test',digest=self.test_digest,path='test.txt')],['a'],id='b')]
  self.assertEqual(audit(claims,self.root)['results']['b']['ceiling'],'BUILT')
 def test_cycle(self):
  with self.assertRaisesRegex(ValueError,'cycle'): audit([self.claim(dependencies=['b'],id='a'),self.claim(dependencies=['a'],id='b')],self.root)
 def test_unknown_dependency(self):
  with self.assertRaisesRegex(ValueError,'unknown'): audit([self.claim(dependencies=['missing'])],self.root)
 def test_duplicate_id(self):
  with self.assertRaisesRegex(ValueError,'duplicate'): audit([self.claim(),self.claim()],self.root)
 def test_same_file_cannot_satisfy_two_kinds(self):
  result=audit([self.claim(evidence=[self.proof('source'),self.proof('test')])],self.root)
  self.assertEqual(result['results']['a']['ceiling'],'BUILT')
  self.assertIn('duplicate artifact',result['results']['a']['artifact_checks'][1]['reason'])
 def test_invalid_sha256(self):
  result=audit([self.claim(evidence=[self.proof(digest='nonsense')])],self.root)
  self.assertEqual(result['results']['a']['ceiling'],'PLANNED')
 def test_unknown_kind(self):
  result=audit([self.claim(evidence=[self.proof('magic')])],self.root)
  self.assertEqual(result['results']['a']['ceiling'],'PLANNED')
 def test_invalid_claim_shape(self):
  with self.assertRaisesRegex(ValueError,'invalid claim id'): audit([{'declared':'BUILT'}],self.root)
 def test_invalid_evidence_shape(self):
  result=audit([self.claim(evidence=['not a dict'])],self.root)
  self.assertEqual(result['results']['a']['ceiling'],'PLANNED')
 def test_symlink_rejected(self):
  link=self.root/'linked.txt'
  try: link.symlink_to(self.root/'proof.txt')
  except (OSError,NotImplementedError): self.skipTest('symlinks unavailable')
  result=audit([self.claim(evidence=[self.proof(path='linked.txt')])],self.root)
  self.assertEqual(result['results']['a']['ceiling'],'PLANNED')
 def test_large_artifact(self):
  (self.root/'large.bin').write_bytes(b'x'*(16*1024*1024+1))
  result=audit([self.claim(evidence=[self.proof(path='large.bin')])],self.root)
  self.assertEqual(result['results']['a']['ceiling'],'PLANNED')
 def test_distinct_files_still_do_not_prove_execution(self):
  result=audit([self.claim(evidence=[self.proof('source'),self.proof('test',digest=self.test_digest,path='test.txt')])],self.root)
  self.assertEqual(result['results']['a']['ceiling'],'VERIFIED')
  self.assertIn('local byte integrity',audit([self.claim()],self.root)['warning'])
 def test_identical_bytes_separate_files_rejected(self):
  (self.root/'copy.txt').write_bytes(b'hello')
  result=audit([self.claim(evidence=[self.proof('source'),self.proof('test',path='copy.txt')])],self.root)
  self.assertEqual(result['results']['a']['ceiling'],'BUILT')
 def test_nul_path_rejected(self):
  result=audit([self.claim(evidence=[self.proof(path='bad\\x00file')])],self.root)
  self.assertEqual(result['results']['a']['ceiling'],'PLANNED')
 def test_valid_sha256_regex(self):
  result=audit([self.claim(state='BUILT',evidence=[self.proof()])],self.root)
  self.assertEqual(result['results']['a']['ceiling'],'BUILT')
 def test_real_nul_path_returns_invalid_path(self):
  result=audit([self.claim(evidence=[self.proof(path='bad\x00file')])],self.root)
  self.assertEqual(result['results']['a']['artifact_checks'][0]['reason'],'invalid path')
 def test_sha256_requires_exact_hex_without_suffix(self):
  for digest in [self.digest+'\n',self.digest+'\\Z','g'*64,self.digest[:-1]]:
   with self.subTest(digest=digest):
    result=audit([self.claim(evidence=[self.proof(digest=digest)])],self.root)
    self.assertEqual(result['results']['a']['artifact_checks'][0]['reason'],'invalid sha256')
 def test_uppercase_sha256_accepted(self):
  result=audit([self.claim('BUILT',[self.proof(digest=self.digest.upper())])],self.root)
  self.assertEqual(result['results']['a']['ceiling'],'BUILT')
 def test_hardlink_cannot_supply_a_second_kind(self):
  os.link(self.root/'proof.txt',self.root/'alias.txt')
  result=audit([self.claim(evidence=[self.proof(),self.proof('test',path='alias.txt')])],self.root)
  self.assertEqual(result['results']['a']['ceiling'],'BUILT')
  self.assertIn('duplicate artifact',result['results']['a']['artifact_checks'][1]['reason'])
 def test_parent_directory_symlink_rejected(self):
  (self.root/'real').mkdir(); (self.root/'real'/'proof.txt').write_bytes(b'hello')
  (self.root/'alias').symlink_to(self.root/'real',target_is_directory=True)
  result=audit([self.claim(evidence=[self.proof(path='alias/proof.txt')])],self.root)
  self.assertIn('symlink',result['results']['a']['artifact_checks'][0]['reason'])
 def test_unsafe_portable_paths(self):
  for name in ['.', './proof.txt','sub/../proof.txt','a//proof.txt','C:\\proof.txt','proof.txt\\x00','']:
   with self.subTest(path=name):
    result=audit([self.claim(evidence=[self.proof(path=name)])],self.root)
    self.assertEqual(result['results']['a']['ceiling'],'PLANNED')
 def test_fifo_artifact_does_not_block(self):
  if not hasattr(os,'mkfifo'): self.skipTest('FIFO unavailable')
  os.mkfifo(self.root/'pipe')
  manifest=self.root/'claims.json'; manifest.write_text(json.dumps({'claims':[self.claim(evidence=[self.proof(path='pipe')])]}))
  result=self.run_cli(manifest)
  self.assertEqual(result.returncode,0,result.stderr)
  self.assertEqual(json.loads(result.stdout)['results']['a']['ceiling'],'PLANNED')
 def test_directory_artifact_rejected(self):
  (self.root/'directory').mkdir()
  result=audit([self.claim(evidence=[self.proof(path='directory')])],self.root)
  self.assertEqual(result['results']['a']['ceiling'],'PLANNED')
 def test_changed_file_fails_even_if_read_bytes_match_declared_digest(self):
  # Intercept one real read solely to deterministically schedule a real filesystem mutation.
  read=os.read; mutated=False
  def read_then_append(fd,size):
   nonlocal mutated
   data=read(fd,size)
   if not mutated:
    mutated=True
    with (self.root/'proof.txt').open('ab') as stream: stream.write(b'!')
   return data
  digest=hashlib.sha256(b'hello!').hexdigest()
  with patch('engine.os.read',side_effect=read_then_append):
   result=audit([self.claim('BUILT',[self.proof(digest=digest)])],self.root)
  self.assertEqual(result['results']['a']['ceiling'],'PLANNED')
  self.assertIn('changed while reading',result['results']['a']['artifact_checks'][0]['reason'])
 def test_root_must_be_directory(self):
  with self.assertRaisesRegex(ValueError,'directory'): audit([],self.root/'proof.txt')
 def test_claim_count_bounded(self):
  claims=[self.claim('PLANNED',id=str(i)) for i in range(1001)]
  with self.assertRaisesRegex(ValueError,'too many claims'): audit(claims,self.root)
 def test_evidence_count_bounded(self):
  with self.assertRaisesRegex(ValueError,'too many evidence'): audit([self.claim(evidence=[self.proof()]*257)],self.root)
 def test_dependency_depth_bounded(self):
  claims=[self.claim('PLANNED',dependencies=[str(i+1)] if i<129 else [],id=str(i)) for i in range(130)]
  with self.assertRaisesRegex(ValueError,'dependency depth'): audit(claims,self.root)
 def test_dependency_depth_limit_does_not_depend_on_input_order(self):
  claims=[self.claim('PLANNED',dependencies=[str(i+1)] if i<129 else [],id=str(i)) for i in range(130)]
  with self.assertRaisesRegex(ValueError,'dependency depth'): audit(list(reversed(claims)),self.root)
 def test_invalid_state_type_is_a_validation_error(self):
  with self.assertRaisesRegex(ValueError,'invalid state'): audit([self.claim(state=[])],self.root)
 def run_cli(self,manifest,*extra):
  return subprocess.run([sys.executable,str(Path(__file__).with_name('engine.py')),str(manifest),'--root',str(self.root),*extra],capture_output=True,text=True,timeout=5)
 def test_cli_malformed_input_errors_without_traceback(self):
  malformed=['[]','{}','{"claims": {}}','{"claims": [], "claims": []}','{"claims": [NaN]}','{"claims":']
  for text in malformed:
   with self.subTest(text=text):
    manifest=self.root/'bad.json'; manifest.write_text(text)
    result=self.run_cli(manifest)
    self.assertEqual(result.returncode,2)
    self.assertNotIn('Traceback',result.stderr)
    self.assertEqual(result.stdout,'')
 def test_cli_manifest_size_is_bounded(self):
  manifest=self.root/'large.json'
  with manifest.open('wb') as stream: stream.truncate(1024*1024+1)
  result=self.run_cli(manifest)
  self.assertEqual(result.returncode,2)
  self.assertIn('manifest too large',result.stderr)
  self.assertNotIn('Traceback',result.stderr)
 def test_cli_invalid_utf8_is_a_clean_error(self):
  manifest=self.root/'bad.json'; manifest.write_bytes(b'\xff')
  result=self.run_cli(manifest)
  self.assertEqual(result.returncode,2)
  self.assertNotIn('Traceback',result.stderr)
 def test_cli_overflowed_json_number_is_rejected(self):
  manifest=self.root/'overflow.json'
  manifest.write_text('{"claims":[{"id":"overflow","declared":"PLANNED","evidence":[{"kind":1e309,"path":"missing","sha256":"'+'0'*64+'"}]}]}')
  result=self.run_cli(manifest)
  self.assertEqual(result.returncode,2)
  self.assertEqual(result.stdout,'')
  self.assertNotIn('Traceback',result.stderr)
 def test_direct_api_rejects_nonfinite_input_before_echoing_it(self):
  for value in [float('inf'),float('-inf'),float('nan')]:
   with self.subTest(value=value):
    evidence={'kind':value,'path':'proof.txt','sha256':self.digest}
    with self.assertRaisesRegex(ValueError,'finite JSON'): audit([self.claim(evidence=[evidence])],self.root)
 def test_cli_deep_invalid_fields_are_clean_bounded_errors(self):
  for field in ['kind','path']:
   for depth in [80,991]:
    with self.subTest(field=field,depth=depth):
     nested='['*depth+'"x"'+']'*depth
     evidence='{"kind":'+(nested if field=='kind' else '"source"')+',"path":'+(nested if field=='path' else '"missing"')+',"sha256":"'+'0'*64+'"}'
     manifest=self.root/'deep.json'; manifest.write_text('{"claims":[{"id":"deep","declared":"PLANNED","evidence":['+evidence+']}]}')
     result=self.run_cli(manifest)
     self.assertEqual(result.returncode,2)
     self.assertEqual(result.stdout,'')
     self.assertNotIn('Traceback',result.stderr)
 def test_invalid_field_objects_are_not_echoed_in_report(self):
  evidence={'kind':{'arbitrary':'\U0001f30d'},'path':['do-not-echo'],'sha256':self.digest}
  result=audit([self.claim(evidence=[evidence])],self.root)
  check=result['results']['a']['artifact_checks'][0]
  self.assertIsNone(check['kind'])
  self.assertIsNone(check['path'])
 def test_cli_missing_root_is_a_clean_error(self):
  manifest=self.root/'empty.json'; manifest.write_text('{"claims": []}')
  result=self.run_cli(manifest,'--root',str(self.root/'absent'))
  self.assertEqual(result.returncode,2)
  self.assertNotIn('Traceback',result.stderr)
 def test_cli_manifest_symlink_rejected(self):
  manifest=self.root/'claims.json'; manifest.write_text('{"claims": []}')
  link=self.root/'linked.json'; link.symlink_to(manifest)
  result=self.run_cli(link)
  self.assertEqual(result.returncode,2)
  self.assertNotIn('Traceback',result.stderr)
 def test_cli_fifo_manifest_does_not_block(self):
  if not hasattr(os,'mkfifo'): self.skipTest('FIFO unavailable')
  os.mkfifo(self.root/'manifest.pipe')
  result=self.run_cli(self.root/'manifest.pipe')
  self.assertEqual(result.returncode,2)
  self.assertIn('not a regular file',result.stderr)
 def test_cli_example_uses_actual_source_bytes(self):
  component=Path(__file__).resolve().parent
  result=subprocess.run([sys.executable,str(component/'engine.py'),str(component/'example_claims.json'),'--root',str(component)],capture_output=True,text=True,timeout=5)
  self.assertEqual(result.returncode,0,result.stderr)
  report=json.loads(result.stdout)
  self.assertEqual(report['results']['local-inspector-source']['ceiling'],'BUILT')
  self.assertIn('not test execution',report['warning'])
if __name__=='__main__': unittest.main()
