# Evidence → Authority → Consequence experiment

Status: **implemented test harness; execution still requires the pinned recovered-source archive, reference APK, and RAE report inputs.**

This experiment asks one question:

> Can independently produced evidence cross into Relay, become a prerequisite for a consequential state change, and still remain distinct from the authority that permits that change?

## Trust chain

1. `RaeEvidenceBridge` independently checks the pinned reference APK identity.
2. It imports the RAE report as a `SYSTEM_EVENT` and explicitly grants no authority.
3. `EvidenceAuthorizedTransition` retrieves that exact persisted evidence artifact.
4. A separate Ed25519 operator key signs a canonical grant bound to:
   - case ID;
   - evidence artifact ID;
   - evidence artifact hash;
   - one fixed action;
   - nonce;
   - expiry.
5. Only then may the integration append one child `SYSTEM_EVENT`.
6. The append does not advance methodology stage and does not create a human decision.

The operator key is deliberately external to the evidence producer. Evidence cannot sign its own grant.

## Fixed consequential action

The only implemented action is:

`append:verified-evidence-ack-v1`

It appends an acknowledgment event whose parent is the imported RAE evidence. This is intentionally less powerful than changing methodology stage or human-decision state because those semantics are not justified by the recovered interface evidence available in this repository.

## Falsification cases

`EvidenceAuthorizedTransitionTest` attempts to establish both positive and negative observations:

- evidence import alone changes neither methodology stage nor human decision;
- a different/self-selected Ed25519 key cannot authorize against the operator trust root;
- a correctly signed evidence-bound grant permits one append;
- replay of that grant is rejected;
- signing against a different evidence hash is rejected;
- a revoked nonce is rejected;
- an expired grant is rejected;
- the authorized consequence persists across CaseStore restart;
- recovered CaseStore audit remains clean.

## Run

Use the same explicit external inputs required by the existing Relay bridge:

```sh
python3 integration/relay/verify_bridge.py recovered-source.zip reference.apk rae-report.json
```

The verifier compiles recovered Relay core source plus both integration experiments, runs the recovered core suites, runs the existing evidence-import suite, then runs the evidence-authority transition suite.

## Evidence boundary

A green run would establish the behavior of this particular harness against the supplied inputs. It would **not** establish:

- that all RAE claims are semantically true;
- that Ed25519 operator authority is the correct governance policy for Relay;
- that methodology stage or human decisions should ever be machine-mutated;
- that replay/revocation files are independently protected against whole-history rollback;
- that this is a production security boundary.

The authority state is local filesystem state. An attacker capable of rolling back or replacing that entire state directory can defeat its historical replay/revocation memory. Independent anchoring remains a separate problem.
