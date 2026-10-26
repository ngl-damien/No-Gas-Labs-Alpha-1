#!/usr/bin/env python3
import json, pathlib, sys

path=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else "ngl/institution/state-graph.json")
g=json.loads(path.read_text())
nodes=g["nodes"]
edges=g["edges"]
ids=[n["id"] for n in nodes]
assert len(ids)==len(set(ids)), "duplicate node id"
by_id={n["id"]:n for n in nodes}
for e in edges:
    assert e["from"] in by_id, f"edge from missing node: {e}"
    assert e["to"] in by_id, f"edge to missing node: {e}"

authoritative={"OBSERVED","SUPPORTED"}
non_authoritative={"DECLARED","UNRESOLVED","FALSIFIED","CONTRADICTORY"}
for n in nodes:
    state=n["state"]
    assert state in set(g["epistemic_states"]), f"unknown epistemic state: {state}"
    if state in authoritative:
        assert n.get("evidence"), f"authoritative node lacks evidence: {n['id']}"
    if n["type"]=="CLAIM":
        assert not n.get("authority"), f"claim may not grant authority: {n['id']}"

# Prevent laundering weak state through graph edges.
for e in edges:
    source=by_id[e["from"]]
    if e["relation"] in {"AUTHORIZES","PROVES","SUPPORTS"}:
        assert source["state"] in authoritative, (
            f"non-authoritative source cannot {e['relation']}: "
            f"{source['id']} ({source['state']})"
        )

known=[n["id"] for n in nodes if n["state"] in authoritative]
claims=[n["id"] for n in nodes if n["type"]=="CLAIM" and n["state"] not in authoritative]
actors=[n["id"] for n in nodes if n["type"]=="CAPABILITY" and n.get("authority")]

print(json.dumps({
  "schema":g["schema"],
  "status":"OBSERVED",
  "known":known,
  "unproven_claims":claims,
  "authorized_capabilities":actors,
  "node_count":len(nodes),
  "edge_count":len(edges)
},indent=2))
