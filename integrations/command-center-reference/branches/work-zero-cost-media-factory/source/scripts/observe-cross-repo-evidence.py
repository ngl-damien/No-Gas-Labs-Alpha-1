#!/usr/bin/env python3
import json, pathlib, subprocess, sys

registry_path=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else "ngl/institution/evidence-sources.json")
workspace=pathlib.Path(sys.argv[2] if len(sys.argv)>2 else ".ngl-evidence")
registry=json.loads(registry_path.read_text())
observations=[]

for s in registry["sources"]:
    if s["repository"]=="No-Gas-Labs-Official/Store":
        observations.append({"source_id":s["id"],"status":"UNRESOLVED","reason":"private source is not fetched by this zero-secret observer"})
        continue
    local=workspace/s["repository"].split("/")[-1]
    path=local/s["path"]
    if not path.exists():
        observations.append({"source_id":s["id"],"status":"UNRESOLVED","reason":"source path absent"})
        continue
    actual=subprocess.check_output(["git","-C",str(local),"hash-object",s["path"]],text=True).strip()
    if actual != s["blob_sha"]:
        observations.append({"source_id":s["id"],"status":"CONTRADICTORY","expected_blob_sha":s["blob_sha"],"observed_blob_sha":actual})
        continue
    observations.append({
      "source_id":s["id"],
      "status":"OBSERVED",
      "basis":"independent checkout path exists and git blob hash matches pinned registry value",
      "blob_sha":actual,
      "admissible_for":s["admissible_for"],
      "not_admissible_for":s["not_admissible_for"]
    })

print(json.dumps({"schema":"ngl.cross-repo-observation.v0","observations":observations},indent=2))
if any(o["status"]=="CONTRADICTORY" for o in observations):
    raise SystemExit(2)
