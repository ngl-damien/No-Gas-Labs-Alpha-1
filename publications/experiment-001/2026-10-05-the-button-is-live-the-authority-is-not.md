# The Button Is Live. The Authority Is Not.

**No_Gas_Labs™ Research Note — 5 October 2026**  
**Damien Featherstone — Neophyte Founder™ of No_Gas_Labs™**

Yesterday, No_Gas_Labs crossed a small but unusually clean boundary: an idea about human authority stopped being only prose and became an executable interface.

There is now a browser implementation of the **Damien Authority Lease**. Its source generates an ECDSA P-256 key pair, deliberately makes the private key non-exportable through the WebCrypto API, exports only the public key, fingerprints that public key, stores the signing key in browser storage, creates one-hour lease records, refuses signing after expiration, and requires an explicit action to renew the lease. The decision signer canonicalizes the supplied JSON, hashes it with SHA-256, and signs that exact representation. The implementation also states its own limitation directly: a valid signature proves possession of the browser key; it does not establish civil identity, truth, or production enrollment.

That distinction is the interesting result.

No_Gas_Labs has repeatedly returned to Damien Featherstone's narrower proposition:

> **A model's assertion is never sufficient evidence that the state it describes is correct.**

The authority experiment exposes the neighboring problem from the opposite direction:

> **Evidence that somebody possesses a key is not sufficient evidence that the key possesses authority.**

Those statements are related. They are not identical.

## Observation

The current Alpha 1 source contains an actual signing mechanism rather than merely describing one. It implements key creation, local storage, public-key fingerprinting, one-hour lease creation, explicit renewal, expiration checking, exact-payload signing, and export of a public enrollment record.

The repository also explicitly separates states rather than treating successful execution as the end of the story:

`CLAIMED → AUTHORIZED → EXECUTED → OBSERVED → ADJUDICATED`

Its stated genesis condition is similarly adversarial: reject a self-certifying claim, accept an externally evidenced observation, preserve both events, and derive deterministic canonical state.

These are observations about source currently present in the repository. They are **not** evidence that the complete governance path has executed successfully in production.

## Evidence

The authority page contains several useful self-limitations.

Its exported enrollment record declares:

`authority: NONE_UNTIL_EXPLICITLY_ENROLLED_BY_NGL`

Its interface tells the operator that activating a local lease does not itself give the key production authority. The runtime must separately enroll the public key and accept the lease.

Its signature path checks the lease expiration before signing.

Its lease record declares:

`max_duration_seconds: 3600`

`renewal: EXPLICIT_ONLY`

`auto_renew: false`

And its boundary notice explicitly refuses three tempting equivalences:

**signature ≠ identity**

**signature ≠ truth**

**signature ≠ authority**

That is stronger evidence of the system's present epistemic boundary than a green badge saying “authority implemented” would be.

## Interpretation

The useful development is not that No_Gas_Labs invented digital signatures, expiring credentials, least privilege, human approval, or cryptographic authorization. It did not.

The interesting move is architectural: the experiment is forcing different questions to remain different even when collapsing them would make the demo look more complete.

Did a cryptographic operation occur?

Who controlled the signing key?

Was that key recognized by the institution?

Was it authorized for this exact decision?

Was the authorization still active?

Was the decision actually applied?

Did canonical state change?

Was that resulting state independently read back?

A single successful signature cannot answer all of them.

That is precisely the sort of semantic compression that AI-mediated systems make dangerously easy: a workflow obtains one strong fact and silently promotes it into several stronger facts.

## Authorization

No production founder authority is established by the source inspection reported here.

The browser can manufacture a candidate public identity and sign data. The page can manufacture a local one-hour lease record. Neither operation is permitted to appoint itself as institutional authority.

Something outside that self-asserting path must decide that a particular public key is accepted as a No_Gas_Labs founder key, under a particular scope and time bound.

This creates a deliberate bootstrap problem.

Cryptography can subsequently demonstrate continuity with the enrolled key. It cannot retroactively prove why the first enrollment deserved authority.

That first designation therefore needs to be recorded for what it actually is: a **founder governance act**, not cryptographic proof of Damien Featherstone's civil identity.

## Negative result

The experiment has **not** yet demonstrated the consequential chain.

There is no evidence in the inspected repository material for this publication that a temporary founder key has been enrolled into the production trust boundary, that an exact candidate has been authorized with it, that the runtime has independently validated that authorization, that a canonical state transition has consequently occurred, and that the resulting state has been independently read back.

Calling the system “human-authorized end-to-end” now would therefore outrun the evidence.

This is not an embarrassing gap to hide. It is the experiment.

## Consequence

The next meaningful milestone is no longer “make a signing page.”

That exists.

The milestone is a paired experiment:

**Authorized case:** an explicitly enrolled, unexpired founder key signs one exact candidate; the runtime independently verifies key, lease, scope, payload and replay status; the authorized consequence occurs; canonical state is read back.

**Unauthorized control:** alter one consequential dimension—candidate, payload, key, scope, expiration, or replay state—and submit the otherwise equivalent decision; the runtime refuses the consequence; canonical state remains unchanged; the refusal remains in history.

If both cases can be reproduced, No_Gas_Labs will have evidence for a substantially narrower and more useful claim than “we built an authority system”:

**Under the tested conditions, possession of valid evidence was insufficient to produce a canonical consequence without separately valid authorization.**

That is falsifiable.

## Open question

There is a deeper question underneath Experiment 001.

AI systems are becoming increasingly capable of producing code, evidence-like artifacts, plans, evaluations, tool calls and persuasive explanations of their own behavior. The institutional problem is therefore not merely determining whether an artifact is genuine.

It is deciding **what genuine artifacts are allowed to mean and what consequences they are allowed to cause**.

Evidence can establish that something happened.

Evidence can establish that a key signed something.

Evidence can establish that tests passed.

Evidence can establish that bytes existed at a particular hash.

None of those facts inherently contains the rule:

**therefore change the world.**

That arrow belongs to governance.

No_Gas_Labs has not demonstrated the complete arrow yet.

Now there is a button capable of helping test it.

---

**Artifact status:** published to the public `ngl-damien/No-Gas-Labs-Alpha-1` repository on 7 October 2026 as part of the Experiment 001 publication archive.

**Repository evidence:** [Alpha 1 README](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/blob/main/README.md) and [Founder Authority implementation](https://github.com/ngl-damien/No-Gas-Labs-Alpha-1/blob/main/authority/index.html).
