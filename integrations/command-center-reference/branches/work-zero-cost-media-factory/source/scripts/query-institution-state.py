#!/usr/bin/env python3
import json, pathlib, sys

path=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else "ngl/institution/state-graph.json")
mode=sys.argv[2] if len(sys.argv)>2 else "summary"
g=json.loads(path.read_text())
nodes=g["nodes"]
auth={"OBSERVED","SUPPORTED"}

def emit(x):
    print(json.dumps(x,indent=2,sort_keys=True))

if mode=="known":
    emit([n for n in nodes if n["state"] in auth])
elif mode=="claims":
    emit([n for n in nodes if n["type"]=="CLAIM" and n["state"] not in auth])
elif mode=="actors":
    emit([n for n in nodes if n["type"]=="CAPABILITY" and n.get("authority")])
elif mode=="next":
    blockers=[n for n in nodes if n["type"]=="CLAIM" and n["state"] not in auth]
    emit({
      "policy":"Only actions whose prerequisites are OBSERVED or SUPPORTED may advance authoritative state.",
      "unproven_claims":[n["id"] for n in blockers],
      "recommended_focus":"Attach independently checkable evidence to one unresolved institutional claim rather than promoting it by assertion."
    })
else:
    emit({
      "schema":g["schema"],
      "known_count":sum(n["state"] in auth for n in nodes),
      "unproven_claim_count":sum(n["type"]=="CLAIM" and n["state"] not in auth for n in nodes),
      "authorized_capabilities":[n["id"] for n in nodes if n["type"]=="CAPABILITY" and n.get("authority")],
      "principal":g["sovereignty"]["principal"]
    })
