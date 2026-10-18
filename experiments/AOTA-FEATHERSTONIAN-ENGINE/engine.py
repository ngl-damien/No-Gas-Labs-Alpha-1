"""NGL AOTA local evidence inventory. Untrusted labels; no execution attestation.
Python >=3.9. Not a Founder Gate or an authorization system.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

LEVELS = ("PLANNED", "BUILT", "VERIFIED", "OPERATIONAL", "EXTERNALLY_CONFIRMED")
KINDS = ("source", "test", "runtime", "external")
REQUIRED = {
    "PLANNED": set(),
    "BUILT": {"source"},
    "VERIFIED": {"source", "test"},
    "OPERATIONAL": {"source", "test", "runtime"},
    "EXTERNALLY_CONFIRMED": set(KINDS),
}
MAX_ARTIFACT_BYTES = 16 * 1024 * 1024
SHA256_RE = re.compile(r"[0-9a-fA-F]{64}\\Z")


def _artifact_check(root, evidence):
    if not isinstance(evidence, dict):
        return {"kind": None, "path": None, "digest_matches": False, "reason": "invalid evidence record"}, None
    kind, name, expected = evidence.get("kind"), evidence.get("path"), evidence.get("sha256")
    check = {"kind": kind, "path": name, "digest_matches": False, "reason": "invalid evidence"}
    if kind not in KINDS:
        check["reason"] = "unknown evidence kind"
        return check, None
    if not isinstance(name, str) or not name or "\\x00" in name:
        check["reason"] = "invalid path"
        return check, None
    if not isinstance(expected, str) or not SHA256_RE.fullmatch(expected):
        check["reason"] = "invalid sha256"
        return check, None
    rel = Path(name)
    if rel.is_absolute() or ".." in rel.parts or str(rel) in ("", "."):
        check["reason"] = "unsafe path"
        return check, None
    path = root / rel
    try:
        # Reject every symlink in the path, not just a symlink final artifact.
        current = root
        for part in rel.parts:
            current = current / part
            if current.is_symlink():
                check["reason"] = "symlink disallowed"
                return check, None
        resolved = path.resolve(strict=True)
        if not resolved.is_relative_to(root) or not resolved.is_file():
            check["reason"] = "missing, unsafe or non-file artifact"
            return check, None
        if not resolved.is_file():\n            check["reason"] = "not a regular file"\n            return check, None\n        if resolved.stat().st_size > MAX_ARTIFACT_BYTES:
            check["reason"] = "artifact too large"
            return check, None
        data = resolved.read_bytes()
        if len(data) > MAX_ARTIFACT_BYTES:
            check["reason"] = "artifact too large"
            return check, None
    except (OSError, RuntimeError):
        check["reason"] = "missing or unreadable artifact"
        return check, None
    actual = hashlib.sha256(data).hexdigest()
    check["digest_matches"] = actual == expected.lower()
    check["reason"] = "sha256 match (local bytes only)" if check["digest_matches"] else "sha256 mismatch"
    return check, (str(resolved), actual) if check["digest_matches"] else None


def audit(claims, evidence_root):
    root = Path(evidence_root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("evidence root must be a directory")
    if not isinstance(claims, list):
        raise ValueError("claims must be a list")
    records = {}
    for claim in claims:
        if not isinstance(claim, dict) or not isinstance(claim.get("id"), str) or not claim["id"]:
            raise ValueError("invalid claim id")
        if claim["id"] in records:
            raise ValueError("duplicate ids")
        if claim.get("declared") not in LEVELS:
            raise ValueError("invalid state")
        if not isinstance(claim.get("dependencies", []), list) or not all(isinstance(x, str) for x in claim.get("dependencies", [])):
            raise ValueError("invalid dependencies")
        if not isinstance(claim.get("evidence", []), list):
            raise ValueError("invalid evidence list")
        records[claim["id"]] = claim

    visiting, visited, ordered = set(), set(), []
    def visit(key):
        if key in visiting:
            raise ValueError("dependency cycle")
        if key in visited:
            return
        if key not in records:
            raise ValueError("unknown dependency " + key)
        visiting.add(key)
        for dep in records[key].get("dependencies", []):
            visit(dep)
        visiting.remove(key)
        visited.add(key)
        ordered.append(key)
    for key in records:
        visit(key)

    results = {}
    for key in ordered:
        claim = records[key]
        valid, checks, seen_artifacts = set(), [], set()
        for evidence in claim.get("evidence", []):
            check, artifact = _artifact_check(root, evidence)
            if artifact is not None:
                if artifact[0] in seen_artifacts or artifact[1] in seen_artifacts:
                    check["reason"] = "duplicate artifact cannot satisfy another evidence kind"
                else:
                    seen_artifacts.update(artifact)
                    valid.add(evidence["kind"])
            checks.append(check)
        possible = max(i for i, state in enumerate(LEVELS) if REQUIRED[state] <= valid)
        own = min(LEVELS.index(claim["declared"]), possible)
        deps = claim.get("dependencies", [])
        final = min([own] + [LEVELS.index(results[d]["ceiling"]) for d in deps])
        results[key] = {
            "declared": claim["declared"],
            "ceiling": LEVELS[final],
            "missing_verified_kinds": sorted(REQUIRED[claim["declared"]] - valid),
            "dependencies": deps,
            "artifact_checks": checks,
        }
    return {
        "schema": "ngl.aota.local-artifact-ceiling.v3",
        "warning": "Untrusted labels. Digest match proves local byte integrity only; not test execution, witness independence, authorization, or truth. Symlink races remain possible.",
        "results": results,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("claims")
    parser.add_argument("--root", default=".")
    args = parser.parse_args()
    data = json.loads(Path(args.claims).read_text(encoding="utf-8"))
    print(json.dumps(audit(data["claims"], args.root), indent=2))
