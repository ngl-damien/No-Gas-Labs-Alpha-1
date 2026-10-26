#!/usr/bin/env python3
"""Negative test: verifier must reject a non-sequential state jump."""
import json, pathlib, subprocess, sys, tempfile

root=pathlib.Path(__file__).resolve().parents[1]
state_path=root/"ngl/state/runtime.json"
verifier=root/"scripts/verify-and-advance-state.py"
state=json.loads(state_path.read_text())
current=int(state["media"]["populated_seconds"])
target=int(state["media"]["target_seconds"])
illegal=min(current+2,target)
if illegal <= current+1:
    print("SKIP: no room for an illegal +2 transition")
    raise SystemExit(0)

with tempfile.TemporaryDirectory() as td:
    td=pathlib.Path(td)
    receipt={
      "timeline":{"target_seconds":target,"populated_seconds":illegal},
      "artifact":{"sha256":"forged-test-hash"},
      "title":"NEGATIVE TEST"
    }
    ad={"headline":"NEGATIVE TEST","sha256":"forged-ad-hash"}
    (td/"receipt.json").write_text(json.dumps(receipt))
    (td/"ad.json").write_text(json.dumps(ad))
    out=td/"runtime.next.json"
    before=state_path.read_bytes()
    p=subprocess.run([sys.executable,str(verifier),str(state_path),str(td/"receipt.json"),str(td/"ad.json"),"NEGATIVE-ILLEGAL-JUMP",str(out)],capture_output=True,text=True)
    after=state_path.read_bytes()
    assert p.returncode != 0, "verifier accepted illegal state jump"
    assert before == after, "canonical state mutated during rejected transition"
    assert not out.exists(), "rejected transition emitted proposed canonical state"
    assert "illegal transition" in (p.stderr+p.stdout), "rejection reason was not explicit"
    print(f"OBSERVED: verifier rejected illegal transition {current}->{illegal}; canonical state unchanged")
