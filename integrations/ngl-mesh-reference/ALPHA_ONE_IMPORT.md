# Alpha One import record: NGL Mesh

Source: https://github.com/ngl-damien/ngl-mesh
Source tree SHA: `be43452a2133ba920a3814e19d7812e5c964117d`.

The files in this directory are copied from the source repository into Alpha One with paths retained beneath `integrations/ngl-mesh-reference/`. Source blob SHA values are recorded in the assimilation plan's repository history and source repository. This is a source-preserving import, not a claim of runtime integration.

The Java experiments import `ngl.relay.core.Artifact` and `CaseStore`; those dependencies are not included here. The tests must not be represented as passing until the required dependency is recovered and the test suite is executed. The Python verification script should be reviewed and run independently.

This import is intentionally kept as a reference module until an Alpha One adapter is defined and its authorization, replay, expiry, revocation and fail-closed behavior are verified. Do not copy signing keys or secrets into this tree.
