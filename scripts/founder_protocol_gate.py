#!/usr/bin/env python3
"""Fail-closed Founder-facing pull request and continuity gate."""
from datetime import datetime, timezone
import json, os, re, subprocess, sys

EFFECTIVE_AT = datetime(2026, 11, 28, tzinfo=timezone.utc)
REQUIRED_SECTIONS = (
    "## Founder-facing outcome", "## Evidence and verification",
    "## What remains / limitations", "## Next action",
    "## Above-and-Beyond self-audit", "## Preflight and continuity",
)
RELAY_PATH = "docs/operations/UNIVERSAL_INSTITUTIONAL_CONTINUITY_RELAY.md"
PLACEHOLDER_ONLY_LINE = re.compile(
    r"^(?:todo|tbd|n/?a|none|pending|placeholder|fill(?:\s+in)?(?:\s+this)?|to\s+be\s+(?:completed|filled\s+in|determined)|not\s+yet\s+available)(?:\s*[:—-].*)?$",
    re.IGNORECASE,
)
FENCE_OPEN = re.compile(r"^ {0,3}([\x60]{3,}|~{3,})(.*)$")

def strip_fenced_code_blocks(markdown):
    """Remove fenced code before interpreting PR headings or section evidence."""
    output, fence_char, fence_length = [], None, 0
    for line in markdown.splitlines():
        if fence_char is None:
            match = FENCE_OPEN.match(line)
            if match:
                marker, info = match.group(1), match.group(2)
                if marker[0] == "\x60" and "\x60" in info:
                    output.append(line)
                    continue
                fence_char, fence_length = marker[0], len(marker)
                output.append("")
                continue
            output.append(line)
            continue
        closing = re.match(
            r"^ {0,3}(" + re.escape(fence_char) + r"{" + str(fence_length) + r",})[ \t]*$",
            line,
        )
        if closing:
            fence_char, fence_length = None, 0
        output.append("")
    return "\n".join(output)

def section_has_substantive_content(section_text):
    without_comments = re.sub(r"(?s)<!--.*?-->", "", section_text)
    lines = [line.strip() for line in without_comments.splitlines() if line.strip()]
    if not lines:
        return False
    for line in lines:
        normalized = re.sub(r"^(?:[-*+]\s+|>\s*)+", "", line)
        normalized = normalized.strip(" \t*_~#")
        normalized = re.sub(r"[.!?]+$", "", normalized).strip()
        if not PLACEHOLDER_ONLY_LINE.fullmatch(normalized):
            return True
    return False

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

def missing_or_empty_sections(body):
    if not isinstance(body, str):
        body = ""
    body = strip_fenced_code_blocks(body)
    failures = []
    for heading in REQUIRED_SECTIONS:
        match = re.search(r"(?m)^" + re.escape(heading) + r"[ \t]*$", body)
        if match is None:
            failures.append(heading)
            continue
        next_heading = re.search(r"(?m)^##\s+", body[match.end():])
        end = match.end() + next_heading.start() if next_heading else len(body)
        if not section_has_substantive_content(body[match.end():end]):
            failures.append(heading)
    return failures

def relay_history_is_append_only(base_content, head_content):
    if base_content is None:
        return isinstance(head_content, bytes) and len(head_content) > 0
    return isinstance(head_content, bytes) and len(head_content) > len(base_content) and head_content.startswith(base_content)

def git_file_at_revision(revision):
    pathspec = revision + ":" + RELAY_PATH
    exists = subprocess.run(["git", "cat-file", "-e", pathspec], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    if exists.returncode == 1:
        return None
    if exists.returncode != 0:
        raise subprocess.CalledProcessError(exists.returncode, exists.args)
    return subprocess.check_output(["git", "show", pathspec])

def evaluate_pull_request(pull, changed_paths, relay_history_valid=None):
    try:
        created_at = parse_timestamp(pull.get("created_at"))
    except ValueError as error:
        return {"status": "fail", "failures": [str(error)]}
    if created_at < EFFECTIVE_AT:
        return {"status": "grandfathered", "failures": []}
    missing_sections = missing_or_empty_sections(pull.get("body") or "")
    failures = []
    if missing_sections:
        failures.append("missing or empty required Founder-facing sections: " + ", ".join(missing_sections))
    relay_updated = RELAY_PATH in set(changed_paths)
    if not relay_updated:
        failures.append("the append-only continuity relay was not updated in this pull request")
    elif relay_history_valid is not True:
        failures.append("the continuity relay must preserve all base bytes and append new content")
    return {"status": "fail" if failures else "pass", "failures": failures, "missing_sections": missing_sections, "relay_updated": relay_updated}

def changed_pull_request_paths(pull):
    base_sha, head_sha, number = pull["base"]["sha"], pull["head"]["sha"], str(pull["number"])
    subprocess.run(["git", "fetch", "origin", base_sha], check=True)
    subprocess.run(["git", "fetch", "origin", "refs/pull/" + number + "/head:refs/remotes/origin/pr-" + number], check=True)
    return subprocess.check_output(["git", "diff", "--name-only", base_sha + "..." + head_sha], text=True).splitlines()

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
    base_sha, head_sha = pull["base"]["sha"], pull["head"]["sha"]
    relay_history_valid = relay_history_is_append_only(git_file_at_revision(base_sha), git_file_at_revision(head_sha))
    result = evaluate_pull_request(pull, paths, relay_history_valid)
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
