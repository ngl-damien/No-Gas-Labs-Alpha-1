# The Key Can Sign. It Still Cannot Rule.

**No_Gas_Labs™ Research Note — 6 October 2026**  
**Damien Featherstone — Neophyte Founder™ of No_Gas_Labs™**

No_Gas_Labs now has source capable of generating a cryptographic signing key in a browser.

That sentence is deliberately narrower than **“No_Gas_Labs now has founder authority.”**

The difference is Experiment 001.

## Observation

The current Alpha 1 repository explicitly separates:

`CLAIMED → AUTHORIZED → EXECUTED → OBSERVED → ADJUDICATED`

and states that no actor may promote its own claim directly to `OBSERVED`.

The repository's founder-authority implementation goes further. The page can generate an ECDSA P-256 key pair using WebCrypto, export the public key, calculate a fingerprint, retain the private signing key in browser storage, create a one-hour local lease, refuse signing after expiration, and sign a canonicalized JSON decision.

The implementation itself states that activating a local lease does not give the key production authority. The NGL runtime must recognize the public key and accept the lease separately.

Those are observations about source. They are not observations of Damien successfully creating, enrolling, and exercising a production founder key.

## Evidence

The public enrollment record emitted by the page declares:

`authority: NONE_UNTIL_EXPLICITLY_ENROLLED_BY_NGL`

The lease record declares:

`max_duration_seconds: 3600`

`renewal: EXPLICIT_ONLY`

`auto_renew: false`

The page also states that a valid signature proves possession of the browser key, not civil identity, truth of the underlying claim, or production enrollment.

The repository's README imposes the same discipline at a larger scale: the project does not earn its first capability merely because source describes one. Its stated acceptance condition requires executable behavior that rejects a self-certifying claim, accepts an observation carrying external evidence, preserves both histories, and derives deterministic canonical state.

## Negative result

No evidence inspected for this publication establishes that Damien has completed a founder-enrollment ceremony.

No evidence inspected here establishes an end-to-end production sequence in which:

`Damien action → browser signature → trusted enrollment → runtime verification → authorized consequence → canonical state change → independent readback`

Therefore the warranted status is not:

**FOUNDER AUTHORITY VERIFIED**

It is:

**SIGNING AND LEASE MECHANISM IMPLEMENTED; PRODUCTION AUTHORITY NOT YET DEMONSTRATED.**

That distinction matters more than whether the interface looks finished.

## Interpretation

Experiment 001 began around a narrower proposition:

> **A model's assertion is never sufficient evidence that the state it describes is correct.**

The authority work has exposed a second boundary:

> **Evidence is not authorization.**

A cryptographically valid signature can be strong evidence that a particular private key signed particular bytes.

It does not tell us whether that key should control No_Gas_Labs.

A test result can establish that code behaved a certain way under tested conditions.

It does not decide whether that code may spend money.

A hash can identify an artifact.

It does not approve the artifact.

A model can correctly describe all of those facts.

It still does not acquire the authority to determine their consequences.

The conceptual move is not novel cryptography. Digital signatures, bounded credentials, least privilege, human authorization and audit trails are established fields.

Current agent-security research makes the surrounding problem particularly relevant. Microsoft's PAuth work argues that operator-scoped authorization can leave agents overprivileged and instead investigates task-scoped authorization tied to concrete operations. Research on authorization architectures for tool-using agents likewise emphasizes traceability to human principals, bounded delegation, runtime enforcement and auditability. Bounded Agents treats prompt injection partly as an authorization problem: a compromised model becomes dangerous when the surrounding system has granted it authority capable of producing the prohibited consequence.

NGL does not establish a solution to those research problems.

It does, however, now have a small experimental apparatus in the same problem territory.

## Authorization

The most important unresolved step is intentionally awkward.

Someone must establish the first trusted relationship between Damien and a particular public key.

Cryptography cannot bootstrap that fact by signing its own declaration.

The narrow defensible statement for such an enrollment is not:

**Cryptography proves this is Damien Featherstone.**

It is:

**Damien Featherstone, acting as founder/operator of this experiment, explicitly designated this public key as authorized for a bounded NGL role.**

After that governance act, signatures can provide evidence of continuity with the designated key.

The distinction between **identity proof** and **institutional designation** should remain visible.

## Consequence

This produces a clean next experiment.

First, enroll one temporary founder key under an explicitly bounded authority lease.

Then present one exact candidate decision.

Have Damien authorize it.

Verify independently that the candidate, key, signature, lease, scope and expiration all match.

Apply the consequence.

Read canonical state back.

Then repeat the experiment after changing exactly one material variable: expire the lease, substitute another candidate, alter the signed payload, replay the decision, or use an unenrolled key.

The first should cross the boundary.

The second should not.

Both outcomes should remain evidence.

Only then would NGL have grounds for the stronger claim:

> **Under the tested conditions, valid evidence alone could not produce a canonical consequence; separately valid authorization was required.**

That would still not prove a universal theory of AI governance.

It would prove something smaller and considerably more useful:

**the boundary actually executed.**

## Open question

The experiment has arrived at a problem larger than hallucination detection.

As AI systems gain tools, credentials, memory and the ability to operate other systems, the dangerous mistake is no longer merely believing something false.

It is allowing one kind of truth to silently acquire another kind of power.

**Observed** does not mean **approved**.

**Authentic** does not mean **authorized**.

**Authorized** does not mean **executed**.

**Executed** does not mean **successful**.

**Successful** does not mean **true everywhere**.

And none of them mean:

**the model gets to decide what happens next.**

That is the boundary No_Gas_Labs is attempting to make concrete enough to test.

## Research references

- Microsoft Research, “PAuth – Precise Task-Scoped Authorization For Agents” (March 2026): https://www.microsoft.com/en-us/research/publication/pauth-precise-task-scoped-authorization-for-agents/
- Surapani et al., “Authorization Architectures for Tool-Using AI Agents” (September 2026): https://arxiv.org/abs/2609.15906
- Muruaga, “Bounded Agents: Delegation Security for Multi-Agent AI Systems” (August 2026): https://arxiv.org/abs/2608.15888
- IETF Internet-Draft, “Agent Identity Protocol (AIP): Decentralized Identity and Delegation for AI Agents” (current draft lineage in 2026): https://datatracker.ietf.org/doc/draft-singla-agent-identity-protocol/

---

**Artifact status:** published to the public `ngl-damien/No-Gas-Labs-Alpha-1` repository on 7 October 2026 as part of the Experiment 001 publication archive.
