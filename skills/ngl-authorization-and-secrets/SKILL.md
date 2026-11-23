---
name: ngl-authorization-and-secrets
description: Review Founder authorization, agent permissions, credentials, secret handling, privileged actions, and separation of duties across NGL systems.
---

# NGL Authorization and Secrets

## Purpose
Ensure every consequential action is performed by an authorized actor with the minimum required privilege, while credentials remain protected.

## Non-negotiable rules
- Agents are assistants and contributors, not institutional authorities.
- No model assertion, role label, local fixture, or self-issued token establishes Founder authority.
- Never request, print, commit, or place private keys, passwords, recovery codes, or live tokens in logs.
- Separate identity, authentication, authorization, and evidence of execution.
- Default to least privilege and deny-by-default for consequential actions.

## Procedure
1. Inventory actors, identities, credentials, permissions, scopes, privileged APIs, and external side effects.
2. Identify the authoritative authorization source and how it is protected from the requesting actor.
3. Map each consequential action to the required permission, scope, approval, and audit event.
4. Check that authorization is validated server-side at the time of action, not merely in the UI or agent prompt.
5. Review key generation, storage, rotation, revocation, backup, and recovery without exposing secret values.
6. Test expired, revoked, malformed, wrong-scope, replayed, and unauthorized credentials using disposable fixtures.
7. Confirm that local/demo/test identities cannot cross into real shared or production authority.
8. Verify that failure and dissent are retained in the audit trail without leaking secrets.

## Acceptance criteria
A pass requires server-enforced least privilege, explicit authorization for consequential operations, safe secret lifecycle handling, and negative tests demonstrating that unauthorized actors cannot perform protected actions.

## Output
Produce an actor/action/permission matrix, secret-lifecycle review, authorization test results, and a list of unresolved authority assumptions.

## Stop conditions
Stop before using live credentials, enrolling an identity, rotating or revoking keys, publishing externally, spending funds, deleting data, or changing protected state without explicit Founder authorization.
