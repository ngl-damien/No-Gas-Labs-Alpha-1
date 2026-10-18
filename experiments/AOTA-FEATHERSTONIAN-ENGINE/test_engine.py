import hashlib, tempfile, unittest
from pathlib import Path
from engine import audit
class GateTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
  self.root.joinpath('proof.txt').write_text('hello')
  self.digest=hashlib.sha256(b'hello').hexdigest()
 def tearDown(self): self.tmp.cleanup()
 def claim(self,state='VERIFIED',evidence=None,dependencies=None,id='a'):
  return {'id':id,'declared':state,'evidence':evidence or [],'dependencies':dependencies or []}
 def proof(self,kind='source',digest=None,path='proof.txt'):
  return {'kind':kind,'path':path,'sha256':digest or self.digest}
 def test_source_only_caps_verified(self):
  x=audit([self.claim(evidence=[self.proof()])],self.root)
  self.assertEqual(x['results']['a']['ceiling'],'BUILT')
 def test_matching_evidence(self):
  x=audit([self.claim(evidence=[self.proof('source'),self.proof('test')])],self.root)
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
  claims=[self.claim('BUILT',[self.proof()],id='a'),self.claim('VERIFIED',[self.proof('source'),self.proof('test')],['a'],id='b')]
  self.assertEqual(audit(claims,self.root)['results']['b']['ceiling'],'BUILT')
 def test_cycle(self):
  with self.assertRaisesRegex(ValueError,'cycle'): audit([self.claim(dependencies=['b'],id='a'),self.claim(dependencies=['a'],id='b')],self.root)
 def test_unknown_dependency(self):
  with self.assertRaisesRegex(ValueError,'unknown'): audit([self.claim(dependencies=['missing'])],self.root)
 def test_duplicate_id(self):
  with self.assertRaisesRegex(ValueError,'duplicate'): audit([self.claim(),self.claim()],self.root)
if __name__=='__main__': unittest.main()
