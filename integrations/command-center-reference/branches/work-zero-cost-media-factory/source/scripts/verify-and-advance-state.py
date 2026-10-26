#!/usr/bin/env python3
import json, pathlib, sys, hashlib, datetime

state_path=pathlib.Path(sys.argv[1])
receipt_path=pathlib.Path(sys.argv[2])
ad_path=pathlib.Path(sys.argv[3])
run_id=str(sys.argv[4])
out_path=pathlib.Path(sys.argv[5])

state=json.loads(state_path.read_text())
receipt=json.loads(receipt_path.read_text())
ad=json.loads(ad_path.read_text())

current=int(state["media"]["populated_seconds"])
target=int(state["media"]["target_seconds"])
expected=min(current+1,target)
observed=int(receipt["timeline"]["populated_seconds"])

assert receipt["timeline"]["target_seconds"] == target
assert observed == expected, f"illegal transition: expected {expected}, observed {observed}"
assert receipt["artifact"]["sha256"], "missing artifact hash"
assert ad["headline"] == receipt["title"], "rendered title != generated ad headline"

transition={
  "schema":"ngl.state-transition.v0",
  "experiment_id":state["experiment_id"],
  "run_id":run_id,
  "from_populated_seconds":current,
  "to_populated_seconds":observed,
  "artifact_sha256":receipt["artifact"]["sha256"],
  "ad_copy_sha256":ad["sha256"],
  "status":"OBSERVED",
  "basis":[
    "compiler exit == 0",
    "artifact exists and is non-empty",
    "receipt parsed",
    "observed populated_seconds == prior canonical state + 1"
  ]
}

state["media"]["populated_seconds"]=observed
state["media"]["remaining_seconds"]=target-observed
state["media"]["last_verified_artifact_sha256"]=receipt["artifact"]["sha256"]
state["status"]="COMPLETE" if observed == target else "READY"
state["next_action"]="NONE" if observed == target else "COMPILE_NEXT_SECOND"
state["history"].append(transition)

out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(json.dumps(state,indent=2)+"\n")
(out_path.parent/"transition.json").write_text(json.dumps(transition,indent=2)+"\n")
print(json.dumps(transition,indent=2))
