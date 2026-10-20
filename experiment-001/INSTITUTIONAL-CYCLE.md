# Experiment 001 — Bounded institutional cycle (candidate)

**Hypothesis:** A scheduled or independent later process can recover an installed capability and reuse it from a persisted evidence ledger without a human relaying the previous run's transcript.

**Objective:** Solve a deterministic square-function challenge with competing proposals, reject the losing candidate using independently specified counterexamples, install the winner under a signed decision, reopen the ledger in a fresh process, reuse the capability, and reject replay and tampering.

Run locally with Node.js 18+: `node --test experiment-001/institutional-cycle.test.mjs`.

This is a deliberately small **integration experiment**, not a breakthrough claim. A successful test would prove only the bounded state-retention/reuse mechanism, not autonomous model coordination, external publication, secure identity, or independent AI discovery.

## Hard limits / stop conditions

- The two strategies are deterministic examples, **not independent AI agents**. The proof is four fixed counterexamples, not a general theorem.
- HMAC authorization depends on a single trusted issuer key; it is **not founder authentication** or human consent.
- The hash chain is not externally anchored or signed. An attacker able to rewrite all records could recalculate hashes; it only catches inconsistent edits.
- Writes assume **one process and one writer**. There is no cross-process lock, no directory fsync, no crash-safe recovery from a failed rename, and no multi-process transaction guarantee.
- A caller can sign arbitrary decisions if it possesses the key. The experiment does not secure key custody.
- Do not merge until exact-head CI or independently reproduced local tests pass, and a reviewer challenges the threat model.
- Do not award in-world XP or commercial claims based on this experiment.

## Next experiment

Replace the two hardcoded proposals with separate provider-generated candidate artifacts and independent test generation, use a founder-controlled approval gate and a durable database transaction, and demonstrate that a separate scheduled invocation can locate and reuse the verified capability. Capture hashes, test logs, reviewer identity and negative results.
