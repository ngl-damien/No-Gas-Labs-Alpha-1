"""AOTA evidence gate v0.2. Local artifacts, not external attestation. Python >=3.9."""
import argparse, hashlib, json
from pathlib import Path

LEVELS = ('PLANNED','BUILT','VERIFIED','OPERATIONAL','EXTERNALLY_CONFIRMED')
REQUIRED = {'PLANNED':set(), 'BUILT':{'source'}, 'VERIFIED':{'source','test'},
            'OPERATIONAL':{'source','test','runtime'},
            'EXTERNALLY_CONFIRMED':{'source','test','runtime','external'}}

def audit(claims, evidence_root):
    root = Path(evidence_root).resolve(strict=True)
    records = {c['id']:c for c in claims}
    if len(records) != len(claims): raise ValueError('duplicate ids')
    visiting, visited, ordered = set(), set(), []
    def visit(key):
        if key in visiting: raise ValueError('dependency cycle')
        if key in visited: return
        if key not in records: raise ValueError('unknown dependency '+key)
        visiting.add(key)
        for dep in records[key].get('dependencies',[]): visit(dep)
        visiting.remove(key); visited.add(key); ordered.append(key)
    for key in records: visit(key)
    results={}
    for key in ordered:
        claim=records[key]
        declared=claim['declared']
        if declared not in LEVELS: raise ValueError('invalid state '+str(declared))
        valid=set(); checks=[]
        for e in claim.get('evidence',[]):
            rel=Path(e.get('path',''))
            ok=False; reason='invalid path'
            if rel.as_posix() not in ('','.') and not rel.is_absolute() and '..' not in rel.parts:
                path=(root/rel).resolve()
                if path.is_relative_to(root) and path.is_file():
                    actual=hashlib.sha256(path.read_bytes()).hexdigest()
                    ok=(actual==e.get('sha256','').lower())
                    reason='sha256 match' if ok else 'sha256 mismatch'
                else: reason='missing, unsafe or non-file artifact'
            if ok and e.get('kind') in ('source','test','runtime','external'):
                valid.add(e['kind'])
            checks.append({'kind':e.get('kind'), 'path':e.get('path'), 'digest_matches':ok, 'reason':reason})
        possible=max(i for i,s in enumerate(LEVELS) if REQUIRED[s]<=valid)
        own=min(LEVELS.index(declared),possible)
        deps=claim.get('dependencies',[])
        final=min([own]+[LEVELS.index(results[d]['ceiling']) for d in deps])
        results[key]={'declared':declared,'ceiling':LEVELS[final],
                      'missing_verified_kinds':sorted(REQUIRED[declared]-valid),
                      'dependencies':deps,'artifact_checks':checks}
    return {'schema':'ngl.aota.local-artifact-ceiling.v2',
            'warning':'Digest match proves only local byte integrity; not execution, independence, identity, or truth.',
            'results':results}

if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('claims'); p.add_argument('--root',default='.')
    args=p.parse_args()
    print(json.dumps(audit(json.loads(Path(args.claims).read_text())['claims'],args.root),indent=2))
