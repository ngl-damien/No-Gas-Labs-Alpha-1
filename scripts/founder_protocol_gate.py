#!/usr/bin/env python3
"""Fail-closed Founder-facing pull request and continuity gate."""

from datetime import datetime, timezone
import json
import os
import subprocess
import sys

EFFECTIVE_AT = datetime(2026, 11, 28, tzinfo=timezone.utc)
REQUIRED_SECTIONS = (
    "## Founder-facing outcome",
    "## Evidence and verification",
    "## What remains / limitations",
    "## Next action",
    "## Above-and-Beyond self-audit",
    "## Preflight and continuity",
)
RELAY_PATH = "docs/operations/UNIVERSAL_INSTITUTIONAL_CONTINUITY_RELAY.md"


def parse_timestamp(value):
    if not isinstance(value, str) or not value:
        raise ValueError("pull request created_at is missing")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("pull request created_at is invalid") from error
    if parsed.tzinfo is None:
        raise ValueError("pull request created_at must include a timezone")
    return parsed.astimezone(timezone.utc)


def evaluate_pull_request(pull, changed_paths):
    """Return pass, fail, or grandfathered without performing I/O."""
    try:
        created_at = parse_timestamp(pull.get("created_at"))
    except ValueError as error:
        return {"status": "fail", "failures": [str(error)]}

    if created_at < EFFECTIVE_AT:
        return {"status": "grandfathered", "failures": []}

    body = pull.get("body") or ""
    missing_sections = [
        heading for heading in REQUIRED_SECTIONS if heading not in body
    ]
    failures = []
    if missing_sections:
        failures.append(
            "missing required Founder-facing sections: "
            + ", ".join(missing_sections)
        )
    if RELAY_PATH not in set(changed_paths):
        failures.append(
            "the append-only continuity relay was not updated in this pull request"
        )
    return {
        "status": "fail" if failures else "pass",
        "failures": failures,
        "missing_sections": missing_sections,
        "relay_updated": RELAY_PATH in set(changed_paths),
    }


def changed_pull_request_paths(pull):
    base_sha = pull["base"]["sha"]
    head_sha = pull["head"]["sha"]
    number = str(pull["number"])
    subprocess.run(
        ["git", "fetch", "origin", base_sha, "--depth=1"],
        check=True,
    )
    subprocess.run(
        [
            "git",
            "fetch",
            "origin",
            "refs/pull/" + number + "/head:refs/remotes/origin/pr-" + number,
        ],
        check=True,
    )
    return subprocess.check_output(
        ["git", "diff", "--name-only", base_sha + "..." + head_sha],
        text=True,
    ).splitlines()


def main():
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    if not event_path:
        print("No GitHub event payload; pull-request enforcement is not applicable.")
        return 0
    with open(event_path, encoding="utf-8") as stream:
        event = json.load(stream)
    pull = event.get("pull_request")
    if not pull:
        print("Push/manual run: pull-request record check is not applicable.")
        return 0

    paths = changed_pull_request_paths(pull)
    result = evaluate_pull_request(pull, paths)
    if result["status"] == "grandfathered":
        print("Existing PR predates 2026-11-28 UTC; grandfathered.")
        return 0
    if result["status"] != "pass":
        print("FAIL CLOSED: Founder-facing PR record is incomplete.")
        for failure in result["failures"]:
            print(" - " + failure)
        return 1
    print("Founder-facing PR record and continuity relay update are present.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (KeyError, OSError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        print("Founder Protocol Gate could not verify the pull request: " + str(error))
        raise SystemExit(1)
