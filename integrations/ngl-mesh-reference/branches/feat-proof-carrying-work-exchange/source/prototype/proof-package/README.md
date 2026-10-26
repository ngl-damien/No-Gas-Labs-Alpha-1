# Proof-package CLI

This dependency-free Python 3.11 prototype turns a bounded evidence folder into a deterministic proof package and now carries the commercial experiment through four evidence-gated states:

`BUYER_INTEREST -> ACCEPTED_DELIVERY -> EVIDENCE_RECEIPT -> ACTUAL_PAYMENT`

The package starts at `UNVERIFIED`. A state cannot be skipped, and every externally asserted state requires evidence. Model output and connector responses remain non-authorizing. Revenue is not assertable until the package reaches `ACTUAL_PAYMENT` with hashed payment evidence and a positive amount.

## Create a bounded job

```bash
python3 prototype/proof-package/proof_package.py create ./sample-evidence \
  --job "Repository due-diligence packet" \
  --criterion "Every material finding has evidence" \
  --criterion "Unresolved conflicts are listed" \
  --out ./demo-output
```

This creates `demo-output/proof-package.json` with source hashes, acceptance criteria, pending human acceptance, pending payment evidence, and commercial state `UNVERIFIED`.

## Advance only with evidence

### 1. Buyer interest

```bash
python3 prototype/proof-package/proof_package.py advance ./demo-output/proof-package.json \
  --to BUYER_INTEREST \
  --actor "buyer-or-role" \
  --evidence ./evidence/buyer-interest.txt
```

### 2. Accepted delivery

```bash
python3 prototype/proof-package/proof_package.py advance ./demo-output/proof-package.json \
  --to ACCEPTED_DELIVERY \
  --actor "buyer-or-reviewer" \
  --evidence ./evidence/acceptance.txt \
  --note "Accepted against the written criteria"
```

### 3. Evidence receipt

```bash
python3 prototype/proof-package/proof_package.py advance ./demo-output/proof-package.json \
  --to EVIDENCE_RECEIPT \
  --actor "buyer-or-reviewer"
```

Mesh generates `acceptance-receipt.json`, binds it to the accepted-delivery event and source manifest, hashes it, and appends it to the event chain.

### 4. Actual payment

```bash
python3 prototype/proof-package/proof_package.py advance ./demo-output/proof-package.json \
  --to ACTUAL_PAYMENT \
  --actor "operator" \
  --evidence ./evidence/payment-receipt.txt \
  --amount 25 \
  --currency USD
```

Only this transition sets `commercial.claims.revenue_assertable` to `true`.

## Inspect current state

```bash
python3 prototype/proof-package/proof_package.py status ./demo-output/proof-package.json
```

The status output reports the current state, next permitted state, event-chain hashes, and whether revenue is assertable.

## Tests

```bash
python3 -m unittest prototype/proof-package/test_proof_package.py
```

The tests cover skipped-state rejection, missing evidence, premature revenue claims, positive payment requirements, acceptance-receipt generation, and the complete four-state path.

## Trust boundary

This prototype does not prove that a business claim is true merely because a file exists. It proves only what its evidence-gated protocol can support. Interest is not acceptance. Acceptance is not payment. A payment promise is not payment. Revenue remains unassertable until actual payment evidence is attached and hashed.
