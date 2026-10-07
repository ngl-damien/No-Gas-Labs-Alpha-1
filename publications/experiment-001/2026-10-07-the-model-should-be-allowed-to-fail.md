# The Model Should Be Allowed to Fail

**No_Gas_Labs™ Research Note — 7 October 2026**  
**Damien Featherstone — Neophyte Founder™ of No_Gas_Labs™**

A great deal of AI safety work asks how to make a model choose the correct action.

No_Gas_Labs is currently testing a different proposition:

**What if correctness is the wrong place to put the final safety boundary?**

A model can misunderstand the task. It can be manipulated. It can hallucinate. It can become more capable than its designers expected. It can even produce perfectly valid evidence for an action that it nevertheless has no authority to perform.

The system surrounding it should survive that.

That is becoming the sharper form of NGL Experiment 001 — **Evidence Is Not Authority**.

## Observation

The current No_Gas_Labs Alpha 1 repository states Damien Featherstone's governing invariant directly:

> **A model's assertion is never sufficient evidence that the state it describes is correct.**

The repository presently distinguishes:

`CLAIMED → AUTHORIZED → EXECUTED → OBSERVED → ADJUDICATED`

and explicitly prohibits an actor from promoting its own claim directly to `OBSERVED`.

Its founder-authority implementation makes another separation executable.

The browser page generates an ECDSA P-256 signing key, exports the public key, calculates a fingerprint, creates a maximum one-hour lease, requires explicit renewal, checks expiration before signing, hashes a canonical representation of the requested JSON decision, and signs that representation.

Crucially, the enrollment artifact produced by the implementation declares:

`authority: NONE_UNTIL_EXPLICITLY_ENROLLED_BY_NGL`

The page therefore possesses machinery for creating evidence of a signature while explicitly refusing to interpret that evidence as institutional authority.

That behavior is present in source. I am **not** claiming here that a founder key has completed production enrollment or caused a canonical NGL state transition.

## Current research context

This distinction is not occurring in isolation.

Microsoft Research's 2026 PAuth work argues that conventional operator-level permissions can leave agents overprivileged and instead investigates authorization tied to the concrete operations required by a particular task.

Recent Bounded Agents research treats prompt injection partly as an authorization-architecture problem: a compromised model is dangerous when the surrounding system has granted it authority capable of producing the prohibited consequence. Its proposed enforcement happens outside the model and narrows delegated scope across agent chains.

A 2026 IETF Internet-Draft likewise explores cryptographic identity, capability-based authorization, delegation chains and deterministic validation for autonomous agents. It remains an Internet-Draft, not an established standard.

None of this establishes NGL as novel. Quite the opposite: it places the experiment inside an increasingly active engineering problem.

## Interpretation

The conventional instinct is:

`make the agent trustworthy enough to act`

The more interesting architecture may be:

`assume the agent can eventually be wrong → constrain what wrongness can cause`

That changes the role of the model.

The model may propose.

It may investigate.

It may assemble evidence.

It may challenge evidence.

It may prepare an action.

It may explain why an action should happen.

It may even be correct.

But correctness does not silently manufacture permission.

This is stronger than asking an AI to say, “Are you sure?” before doing something consequential. The enforcement boundary must exist somewhere the model cannot simply reason itself around.

## Evidence

The current NGL implementation contains a useful example.

A cryptographic signature can provide strong evidence that possession of a particular private key was involved in signing particular bytes.

But several additional propositions remain logically separate:

**The key belongs to Damien.**

**NGL recognizes the key.**

**The key currently possesses authority.**

**Its authority covers this particular action.**

**The signed artifact has not been altered.**

**The authorization has not expired.**

**The authorization has not already been consumed.**

**The consequence actually occurred.**

**The resulting state is what the system now claims it is.**

One cryptographic success cannot establish all of those propositions.

The code's refusal to equate them is currently more important than the existence of the signing button.

## Authorization

This produces an important design rule:

> **Models should not be responsible for deciding whether their own authority is valid.**

That statement is an NGL design interpretation, not a claim of a new computer-science principle.

Authorization should instead be independently enforceable from artifacts the model cannot manufacture merely by asserting that they exist: enrolled identities, exact scopes, expiration boundaries, signatures, consumed grants, deterministic policy and observable state.

Recent research reaches related conclusions through different architectures. That prior art is useful because it prevents NGL from confusing convergence with invention.

## Negative result

NGL has **not yet demonstrated the complete consequential boundary**.

The inspected source supports an implemented browser signing and lease mechanism.

It does not, by itself, demonstrate:

`human designation → trusted enrollment → exact authorization → independent verification → consequence → canonical state change → independent readback`

Therefore **“NGL has solved human authority for AI agents” would be unsupported.**

So would **“NGL invented evidence-bound authorization.”**

Both claims exceed the evidence.

## Consequence

The next useful experiment is adversarial rather than decorative.

Give an agent everything it needs to convincingly argue that an action should happen.

Then deliberately remove exactly one thing required for authority.

Expire the lease.

Change the candidate after authorization.

Replay an already consumed decision.

Substitute an unenrolled key.

Alter the payload after signing.

Give the model impeccable evidence but insufficient scope.

Then encourage the model to proceed.

The interesting result is not whether the model refuses.

The interesting result is whether **the system refuses even if the model does not.**

That is a materially harder test.

## Hypothesis

NGL Experiment 001 can now state a falsifiable systems hypothesis:

> **A sufficiently well-constructed consequential system can tolerate some failures of model judgment because evidence, authorization and consequence are enforced as separate state transitions outside the model's assertions.**

The experiment fails if a model can convert a persuasive claim, valid evidence, successful execution, or possession of credentials into an unauthorized canonical consequence.

The experiment strengthens if increasingly capable or adversarial agents can be allowed to operate inside the system while the external boundary continues rejecting invalid transitions.

## Open question

There is an uncomfortable implication here.

AI capability is improving quickly.

Trying to ensure that increasingly capable models never make a bad decision may remain necessary—but it may never be sufficient.

So perhaps one useful question is not:

**How do we finally make the model trustworthy?**

It is:

**How much model untrustworthiness can the surrounding institution safely tolerate?**

That is a different experimental target.

And it gives No_Gas_Labs something considerably better than a slogan to test.

It gives us a machine we are allowed to try to break.

## Research references

- Microsoft Research, “PAuth – Precise Task-Scoped Authorization For Agents” (March 2026): https://www.microsoft.com/en-us/research/publication/pauth-precise-task-scoped-authorization-for-agents/
- Muruaga, “Bounded Agents: Delegation Security for Multi-Agent AI Systems” (August 2026): https://arxiv.org/abs/2608.15888
- Surapani et al., “Authorization Architectures for Tool-Using AI Agents” (September 2026): https://arxiv.org/abs/2609.15906
- IETF Internet-Draft, “Agent Identity Protocol (AIP): Decentralized Identity and Delegation for AI Agents”: https://datatracker.ietf.org/doc/draft-singla-agent-identity-protocol/

---

**Artifact status:** published to the public `ngl-damien/No-Gas-Labs-Alpha-1` repository on 7 October 2026 as part of the Experiment 001 publication archive.
