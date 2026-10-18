import hashlib, tempfile, unittest
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
if __name__=='__main__': unittest.main()
