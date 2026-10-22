# NGL Stutter-Step Checkpoint

Main: 7b5085b5f1686290569d564ff20774e313a69aea. PR #16 is draft; issue #17 remains open. Immediately before this checkpoint refresh, PR #16 head was 9adee4d8951092b8c9dca1692f683ff6ef23498f; Actions verify 39818485899 and Genesis Evidence Invariant 39818485900 passed on that SHA.

This run fast-forwarded PR #16 from 5266589731d8267fbb3ab29394143b1cd6abbad1 to 6f43c78ad8daffac04789ab0d11571a5aa278655 without force or merge. The candidate now contains detached Ed25519 INSTALL approval and signed REUSE receipts. New signer/test source edits were blocked, so no separate signer or cross-process test landed; full acceptance remains open.

Next: finish manual approval and cross-process persistence tests; design rollback detection; review linked-app signing-state migration before changing stored keys; reassess PRs #13–#15 and #14. Keep PR #16 draft; no merge or deployment authorized.
