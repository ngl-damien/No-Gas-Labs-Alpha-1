# NGL Universal Node Contract — executable reference

This directory is a dependency-free Java reference implementation of the abstraction NGL Relay needs before adding more providers.

The key change is semantic: an NGL node is **not** defined as `prompt -> completion`. A node is a capability-bearing execution peer that consumes canonical artifact references and emits provenance-linked execution records. That allows remote LLMs, local models, public evidence APIs, deterministic tools, training jobs, and evaluators to coexist behind one NGL-owned contract.

## Compile and run

```bash
javac -d out src/ngl/mesh/NodeContract.java src/ngl/mesh/NodeContractSelfTest.java
java -cp out ngl.mesh.NodeContractSelfTest
```

Expected output:

```text
PASS 5/5 NGL node-contract invariants
```

## Invariants exercised

1. Non-chat evidence nodes can route by capability.
2. A successful provider call cannot grant authority.
3. Cross-node fallback requires an explicit human-authorization artifact.
4. Failures must preserve an error artifact.
5. Unhealthy nodes cannot silently participate in routing.

This is a reference contract, not an assertion that the recovered Android source already implements these types. Integrating it into the APK requires mapping existing `CognitionNode`, `MethodologyEngine`, `CaseStore`, and `Artifact` semantics rather than replacing them blindly.
