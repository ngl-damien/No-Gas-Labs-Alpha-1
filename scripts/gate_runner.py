"""Safe, typed gate operations for the NGL invariant kernel.

Gate documents are declarative data. No operation accepts a command or executable.
"""
from __future__ import annotations

import json
import os
import re
import selectors
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_PATTERN_CHARS = 256
MAX_OUTPUT_CHARS = 16_384
TIMEOUT_SECONDS = 30
OPERATIONS = {
    "file_exists": {"id", "type", "path", "weight"},
    "regex_match": {"id", "type", "path", "pattern", "weight"},
    "not_regex_match": {"id", "type", "path", "pattern", "weight"},
    "json_field": {"id", "type", "path", "field", "weight", "equals"},
    "unittest_run": {"id", "type", "test_id", "weight"},
    "validator_run": {"id", "type", "validator_id", "path", "weight"},
}
# These identifiers map to fixed invocations. No spec field can supply argv.
UNITTESTS = {
    "ngl-invariant-core": [sys.executable, "-m", "unittest", "discover", "-s", "test", "-p", "test_ngl.py"],
}
VALIDATORS = {
    "gate-spec": "builtin-gate-spec-validator",
}


def _safe_resolve(workdir: Path, rel_path: str) -> Path:
    root = workdir.resolve()
    if not isinstance(rel_path, str) or not rel_path or "\x00" in rel_path:
        raise ValueError("path must be a non-empty relative path")
    target = (root / rel_path).resolve()
    if target != root and root not in target.parents:
        raise ValueError(f"Path escapes workdir: {rel_path}")
    return target


def _read_capped(target: Path) -> str:
    size = target.stat().st_size
    if size > MAX_FILE_BYTES:
        raise ValueError("File exceeds 5MB cap")
    return target.read_text(encoding="utf-8")


def validate_spec(spec: dict[str, Any]) -> None:
    if not isinstance(spec, dict) or set(spec) != {"checks"} or not isinstance(spec["checks"], list) or not spec["checks"]:
        raise ValueError("spec must contain only a non-empty checks array")
    total = 0
    ids: set[str] = set()
    for check in spec["checks"]:
        if not isinstance(check, dict):
            raise ValueError("each check must be an object")
        op = check.get("type")
        if op not in OPERATIONS:
            raise ValueError(f"unsupported operation: {op!r}")
        if set(check) != OPERATIONS[op]:
            raise ValueError(f"invalid fields for {op}: expected {sorted(OPERATIONS[op])}")
        if not isinstance(check["id"], str) or not check["id"] or check["id"] in ids:
            raise ValueError("check ids must be unique non-empty strings")
        ids.add(check["id"])
        weight = check["weight"]
        if isinstance(weight, bool) or not isinstance(weight, int) or weight <= 0:
            raise ValueError("check weight must be a positive integer")
        total += weight
        if op in ("file_exists", "regex_match", "not_regex_match", "json_field"):
            if not isinstance(check["path"], str) or not check["path"]:
                raise ValueError(f"{op} requires a non-empty relative path")
        if op in ("regex_match", "not_regex_match"):
            pattern = check["pattern"]
            if not isinstance(pattern, str) or len(pattern) > MAX_PATTERN_CHARS:
                raise ValueError("pattern must be a string no longer than 256 characters")
            # Reject quantified groups (including ambiguous alternatives) to limit ReDoS risk.
            if re.search(r"\)[+*{]", pattern):
                raise ValueError("quantified groups are not allowed")
            re.compile(pattern)
        if op == "json_field":
            if not isinstance(check["field"], str) or not check["field"] or ".." in check["field"].split("."):
                raise ValueError("field must be a non-empty dotted object path")
        if op == "unittest_run" and check["test_id"] not in UNITTESTS:
            raise ValueError("test_id is not allowlisted")
        if op == "validator_run" and check["validator_id"] not in VALIDATORS:
            raise ValueError("validator_id is not allowlisted")
    if total != 100:
        raise ValueError("check weights must sum to 100")


def _result(check: dict[str, Any], status: str, label: str, detail: str) -> dict[str, Any]:
    return {"id": check.get("id", "UNKNOWN"), "weight": check.get("weight", 0), "type": check.get("type", ""), "status": status, "epistemic_label": label, "detail": detail[:MAX_OUTPUT_CHARS]}


def _run_fixed(argv: list[str], workdir: Path, check: dict[str, Any], op: str) -> dict[str, Any]:
    process = None
    captured = bytearray()
    try:
        process = subprocess.Popen(argv, shell=False, cwd=str(workdir.resolve()), stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, env={"PATH": "/usr/bin:/bin", "PYTHONUTF8": "1"})
        assert process.stdout is not None
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            deadline = time.monotonic() + TIMEOUT_SECONDS
            while selector.get_map():
                if time.monotonic() >= deadline:
                    process.kill()
                    process.wait()
                    output = captured.decode("utf-8", errors="replace")
                    return _result(check, "FAILED_ATTEMPT", "FAILED_ATTEMPT", f"{op} timed out after {TIMEOUT_SECONDS}s; {output}")
                for key, _ in selector.select(timeout=min(0.1, max(0, deadline - time.monotonic()))):
                    chunk = os.read(key.fileobj.fileno(), 4096)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    room = max(0, MAX_OUTPUT_CHARS - len(captured))
                    if room:
                        captured.extend(chunk[:room])
            returncode = process.wait(timeout=max(0.1, deadline - time.monotonic()))
    except (OSError, subprocess.SubprocessError) as exc:
        if process is not None and process.poll() is None:
            process.kill()
            process.wait()
        return _result(check, "FAILED_ATTEMPT", "FAILED_ATTEMPT", f"{op} launch failed: {exc}")
    output = captured.decode("utf-8", errors="replace")
    if returncode:
        return _result(check, "FAILED", "EXECUTION_OBSERVED", f"{op} exit_code={returncode}; {output}")
    return _result(check, "PASS", "EXECUTION_OBSERVED", f"{op} exit_code=0; {output}")


def run_check(check: dict[str, Any], workdir: Path) -> dict[str, Any]:
    op = check["type"]
    try:
        if op == "file_exists":
            path = _safe_resolve(workdir, check["path"])
            passed = path.is_file()
            return _result(check, "PASS" if passed else "FAIL", "ARTIFACT_OBSERVED", f"exists={passed} ({check['path']})")
        if op in ("regex_match", "not_regex_match"):
            path = _safe_resolve(workdir, check["path"])
            if not path.is_file():
                return _result(check, "FAIL", "ARTIFACT_OBSERVED", f"missing file: {check['path']}")
            matched = re.search(check["pattern"], _read_capped(path), re.MULTILINE) is not None
            passed = matched if op == "regex_match" else not matched
            return _result(check, "PASS" if passed else "FAIL", "ARTIFACT_OBSERVED", f"matched={matched} in {check['path']}")
        if op == "json_field":
            path = _safe_resolve(workdir, check["path"])
            data = json.loads(_read_capped(path))
            value: Any = data
            for part in check["field"].split("."):
                if not isinstance(value, dict) or part not in value:
                    return _result(check, "FAIL", "ARTIFACT_OBSERVED", f"missing JSON field: {check['field']}")
                value = value[part]
            passed = value == check["equals"]
            return _result(check, "PASS" if passed else "FAIL", "ARTIFACT_OBSERVED", f"field={check['field']} equals_expected={passed}")
        if op == "unittest_run":
            return _run_fixed(UNITTESTS[check["test_id"]], workdir, check, "unittest")
        if op == "validator_run":
            path = _safe_resolve(workdir, check["path"])
            candidate = json.loads(_read_capped(path))
            validate_spec(candidate)
            return _result(check, "PASS", "EXECUTION_OBSERVED", f"validator={check['validator_id']} valid_spec={path.name}")
    except (ValueError, OSError, UnicodeError, json.JSONDecodeError, re.error) as exc:
        return _result(check, "FAILED_ATTEMPT", "FAILED_ATTEMPT", f"operation error: {exc}")
    return _result(check, "UNKNOWN", "UNKNOWN", f"unrecognized operation: {op!r}")


def evaluate_gate(spec: dict[str, Any], workdir: Path) -> dict[str, Any]:
    validate_spec(spec)
    results = [run_check(check, workdir) for check in spec["checks"]]
    score = sum(result["weight"] for result in results if result["status"] == "PASS")
    complete = score == 100 and all(result["status"] == "PASS" for result in results)
    blocked = any(result["status"] in {"UNKNOWN", "NOT_RUN", "FAILED_ATTEMPT"} for result in results)
    epistemic_label = "EXECUTION_OBSERVED" if complete and not blocked else "UNKNOWN" if blocked else "CONTRADICTED"
    return {
        "score": score,
        "decision": "completed" if complete else "blocked",
        "epistemic_label": epistemic_label,
        "checks": results,
    }
