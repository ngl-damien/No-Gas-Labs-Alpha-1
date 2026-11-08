# Hourly Worker Heartbeat Protocol

Purpose: distinguish a registered/scheduled worker from a worker that actually started and completed a run. GitHub Actions does not launch ChatGPT scheduled tasks; this protocol records evidence when either ChatGPT worker executes.

## Required behavior on every invocation

For the worker's own file under `docs/operations/hourly-agents/heartbeats/`:

1. At start, replace the file with `state: running`, a fresh UTC `started_at`, a unique `invocation_id`, and the current known `head_commit`. Preserve the worker ID and name.
2. At finish, update the same file with `state: completed`, `heartbeat_at`, `completed_at`, an outcome (`success`, `no_change`, `blocked`, or `failed`), a concise summary, verification performed, and blocker (empty string when none).
3. If interrupted, the last `running` record remains visible and becomes stale. Never fabricate a completion.
4. Commit the heartbeat update to this repository. A narrative report or PR title is not a heartbeat.
5. Do not claim a run unless its heartbeat commit exists. The commit author/committer alone does not prove which ChatGPT task ran; the worker ID in the record is the attribution claim, and the durable commit is the evidence trail.

## Freshness

The monitor runs every 20 minutes. A heartbeat older than 90 minutes is reported stale. A running record older than 90 minutes is an abandoned/stuck invocation. The threshold allows for degraded free-tier scheduling and Actions queue delays; it is an observability threshold, not proof that the ChatGPT scheduler fired.

## Identity preservation

- `6ac6c77de7ac81918e446a49ea330eb6` — NGL Repository Stutter-Step Loop
- `6ac307e1e9bc8191ae21d22f94743802` — Independent Forensic Audit + Build NGL MMORPG

Do not delete, rotate, or replace either worker ID. The monitor reports GitHub evidence only; it cannot wake, repair, or authenticate a ChatGPT scheduled task.
