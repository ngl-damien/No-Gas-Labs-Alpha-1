#!/usr/bin/env python3
"""Validate and report evidence-backed heartbeats for the two protected workers."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HEARTBEATS = ROOT / "docs/operations/hourly-agents/heartbeats"
MAX_AGE_MINUTES = 90
EXPECTED = {
    "6ac6c77de7ac81918e446a49ea330eb6": "NGL Repository Stutter-Step Loop",
    "6ac307e1e9bc8191ae21d22f94743802": "Independent Forensic Audit + Build NGL MMORPG",
}
ALLOWED_STATES = {"awaiting-first-heartbeat", "running", "completed"}
ALLOWED_OUTCOMES = {"success", "no_change", "blocked", "failed"}

def parse_time(value, field):
    if not isinstance(value, str) or not value:
        raise ValueError(f"{field} must be a non-empty ISO-8601 timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc)

def main():
    now = datetime.now(timezone.utc)
    problems = []
    print(f"Hourly worker heartbeat audit — {now.isoformat()}")
    for worker_id, expected_name in EXPECTED.items():
        path = HEARTBEATS / f"{worker_id}.json"
        if not path.is_file():
            problems.append(f"MISSING FILE: {worker_id} ({expected_name})")
            continue
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
            if record.get("worker_id") != worker_id:
                raise ValueError("worker_id does not match filename/registry")
            if record.get("worker_name") != expected_name:
                raise ValueError("worker_name does not match registry")
            state = record.get("state")
            if state not in ALLOWED_STATES:
                raise ValueError(f"unsupported state: {state!r}")
            if state == "awaiting-first-heartbeat":
                problems.append(f"NO HEARTBEAT YET: {worker_id} ({expected_name})")
                print(f"NO HEARTBEAT YET | {worker_id} | awaiting first worker-authored record")
                continue
            if not record.get("invocation_id"):
                raise ValueError("invocation_id is required")
            started = parse_time(record.get("started_at"), "started_at")
            last = parse_time(record.get("heartbeat_at"), "heartbeat_at")
            if last < started:
                raise ValueError("heartbeat_at precedes started_at")
            if state == "completed":
                if record.get("outcome") not in ALLOWED_OUTCOMES:
                    raise ValueError("completed heartbeat needs a valid outcome")
                completed = parse_time(record.get("completed_at"), "completed_at")
                if completed < started or last < completed:
                    raise ValueError("completion/heartbeat timestamps are inconsistent")
                if not isinstance(record.get("summary"), str) or not record["summary"].strip():
                    raise ValueError("completed heartbeat needs a non-empty summary")
                if not isinstance(record.get("verification"), list):
                    raise ValueError("verification must be an array")
            age = (now - last).total_seconds() / 60
            status = "FRESH" if age <= MAX_AGE_MINUTES else "STALE"
            print(f"{status} | {worker_id} | {state} | {age:.1f}m old | {record.get('outcome') or 'in progress'}")
            if status == "STALE":
                problems.append(f"STALE HEARTBEAT: {worker_id} ({age:.1f} minutes old)")
        except Exception as exc:
            problems.append(f"INVALID HEARTBEAT: {worker_id}: {exc}")
    if problems:
        print("\nALERTS:")
        for problem in problems:
            print(f"- {problem}")
        # A red monitor is intentional: absence/staleness is operationally visible.
        return 1
    print("\nAll registered worker heartbeats are valid and fresh.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
