#!/usr/bin/env python3
"""NGL deterministic proprietary copy compiler.

No model/API call is required. Copy is derived from NGL-owned vocabulary,
observed capability state, and the workflow run number. Unsupported claims are
never eligible source material.
"""
import json, pathlib, sys, hashlib

run=int(sys.argv[1]) if len(sys.argv)>1 else 1
out=pathlib.Path(sys.argv[2] if len(sys.argv)>2 else "out")
out.mkdir(parents=True,exist_ok=True)

hooks=[
 "DON'T TRUST THE DEMO. VERIFY IT.",
 "AI CAN GENERATE THE CLAIM. NGL DEMANDS THE RECEIPT.",
 "THE MACHINE SAID IT WORKED. WE ASKED FOR EVIDENCE.",
 "GENERATE RECKLESSLY. VERIFY MERCILESSLY.",
 "A CLAIM IS CHEAP. AN OBSERVATION HAS A HASH."
]
bridges=[
 "No_Gas_Labs turns machine output into inspectable artifacts.",
 "This run separates what was compiled from what was merely claimed.",
 "The artifact can speak. The receipt tells you what it is allowed to say.",
 "We are building leverage without granting the model authority over reality."
]
ctas=[
 "INSPECT THE RECEIPT.",
 "TRY TO FALSIFY IT.",
 "VERIFY THE ARTIFACT.",
 "FOLLOW THE EVIDENCE."
]
i=(run-1)%len(hooks)
copy={
 "schema":"ngl.ad-copy.v1",
 "generator":"NGL deterministic proprietary copy compiler",
 "run":run,
 "proprietary_system":"No_Gas_Labs evidence-bound creative grammar",
 "headline":hooks[i],
 "body":bridges[(run-1)%len(bridges)],
 "cta":ctas[(run-1)%len(ctas)],
 "claim_policy":{
   "allowed":["compiled artifact","evidence receipt","verification invitation"],
   "forbidden_without_evidence":["published","viral","revenue","customer demand","autonomous success"]
 }
}
canonical=json.dumps(copy,sort_keys=True,separators=(",",":")).encode()
copy["sha256"]=hashlib.sha256(canonical).hexdigest()
(out/"ad-copy.json").write_text(json.dumps(copy,indent=2)+"\n")
(out/"ad-title.txt").write_text(copy["headline"]+"\n")
(out/"ad-body.txt").write_text(copy["body"]+" "+copy["cta"]+"\n")
print(json.dumps(copy,indent=2))
