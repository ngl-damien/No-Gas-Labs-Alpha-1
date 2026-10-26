#!/usr/bin/env python3
"""The validator must reject unsupported promotion into authoritative state."""
import json, pathlib, subprocess, sys, tempfile

root=pathlib.Path(__file__).resolve().parents[1]
graph=root/"ngl/institution/state-graph.json"
validator=root/"scripts/validate-institution-state.py"
g=json.loads(graph.read_text())
target=next(n for n in g["nodes"] if n["id"]=="claim:self-building-institution")
target["state"]="OBSERVED"
target["evidence"]=[]

with tempfile.TemporaryDirectory() as td:
    bad=pathlib.Path(td)/"forged.json"
    bad.write_text(json.dumps(g))
    p=subprocess.run([sys.executable,str(validator),str(bad)],capture_output=True,text=True)
    assert p.returncode != 0, "validator accepted unsupported authoritative promotion"
    msg=p.stdout+p.stderr
    assert "authoritative node lacks evidence" in msg, "rejection reason was not explicit"
    print("OBSERVED: unsupported promotion to OBSERVED was rejected")
