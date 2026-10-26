import json, pathlib, sys
root=pathlib.Path(__file__).resolve().parents[1]
reg=json.loads((root/"ngl/capabilities/registry.json").read_text())
ledger=json.loads((root/"ngl/state/uncertainty-ledger.json").read_text())
assert reg["hard_constraint"]["maximum_required_cost_usd"] == 0
assert all(c["cost_usd"] == 0 for c in reg["capabilities"])
assert sum(ledger["counts"].values()) >= 1
valid={"CLAIM","UNRESOLVED","OBSERVED","SUPPORTED","FALSIFIED","CONTRADICTORY"}
for e in ledger["entries"]: assert e["state"] in valid
print("NGL protocol scaffold validated; this validates structure, not capability claims.")
