"""NGL AOTA local evidence inventory. Untrusted labels; no execution attestation.
Python >=3.9. Not a Founder Gate or an authorization system.
"""
import argparse
import hashlib
import json
import os
import re
import stat
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
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_CLAIMS = 1000
MAX_EVIDENCE = 256
MAX_DEPENDENCY_DEPTH = 128
MAX_JSON_DEPTH = 64
SHA256_RE = re.compile(r"[0-9a-fA-F]{64}")


def _read_regular(fd, limit, label):
    """Bound actual reads, and reject detected changes to the opened inode."""
    before = os.fstat(fd)
    if not stat.S_ISREG(before.st_mode):
        raise ValueError("not a regular file")
    if before.st_size > limit:
        raise ValueError(label + " too large")
    chunks, total = [], 0
    while True:
        chunk = os.read(fd, min(64 * 1024, limit + 1 - total))
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise ValueError(label + " too large")
        chunks.append(chunk)
    after = os.fstat(fd)
    fields = ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns", "st_ctime_ns")
    if total != before.st_size or any(getattr(before, key) != getattr(after, key) for key in fields):
        raise ValueError(label + " changed while reading")
    return b"".join(chunks), (before.st_dev, before.st_ino)


def _read_artifact(root_fd, parts):
    """Walk relative to held descriptors; never follow a component symlink."""
    parent = os.dup(root_fd)
    try:
        for index, part in enumerate(parts):
            info = os.stat(part, dir_fd=parent, follow_symlinks=False)
            if stat.S_ISLNK(info.st_mode):
                raise ValueError("symlink disallowed")
            if index < len(parts) - 1:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
                os.close(parent)
                parent = child
            else:
                # O_NONBLOCK prevents a substituted FIFO/device from hanging before fstat.
                fd = os.open(part, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
                try:
                    return _read_regular(fd, MAX_ARTIFACT_BYTES, "artifact")
                finally:
                    os.close(fd)
    finally:
        os.close(parent)


def _artifact_check(root_fd, evidence):
    if not isinstance(evidence, dict):
        return {"kind": None, "path": None, "digest_matches": False, "reason": "invalid evidence record"}, None
    kind, name, expected = evidence.get("kind"), evidence.get("path"), evidence.get("sha256")
    check = {"kind": kind if isinstance(kind, str) else None,
             "path": name if isinstance(name, str) else None,
             "digest_matches": False, "reason": "invalid evidence"}
    if kind not in KINDS:
        check["reason"] = "unknown evidence kind"
        return check, None
    if not isinstance(name, str) or not name or len(name) > 4096 or "\x00" in name:
        check["reason"] = "invalid path"
        return check, None
    if not isinstance(expected, str) or not SHA256_RE.fullmatch(expected):
        check["reason"] = "invalid sha256"
        return check, None
    parts = name.split("/")
    if name.startswith("/") or "\\" in name or ":" in name or any(part in ("", ".", "..") for part in parts):
        check["reason"] = "unsafe path"
        return check, None
    try:
        data, inode = _read_artifact(root_fd, parts)
    except ValueError as error:
        check["reason"] = str(error)
        return check, None
    except (OSError, RuntimeError):
        check["reason"] = "missing or unreadable artifact"
        return check, None
    actual = hashlib.sha256(data).hexdigest()
    check["digest_matches"] = actual == expected.lower()
    check["reason"] = "sha256 match (local bytes only)" if check["digest_matches"] else "sha256 mismatch"
    return check, (inode, actual) if check["digest_matches"] else None


def audit(claims, evidence_root):
    root = Path(evidence_root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("evidence root must be a directory")
    if not isinstance(claims, list):
        raise ValueError("claims must be a list")
    if len(claims) > MAX_CLAIMS:
        raise ValueError("too many claims")
    pending = [(claims, 0)]
    while pending:
        value, depth = pending.pop()
        if depth > MAX_JSON_DEPTH:
            raise ValueError("JSON nesting exceeds " + str(MAX_JSON_DEPTH))
        if isinstance(value, dict):
            pending.extend((child, depth + 1) for child in value.values())
        elif isinstance(value, (list, tuple)):
            pending.extend((child, depth + 1) for child in value)
    try:
        # Validate even unknown/echoed fields. JSON exponent overflow (1e309)
        # otherwise becomes float infinity without invoking parse_constant.
        for _ in json.JSONEncoder(allow_nan=False).iterencode(claims):
            pass
    except (TypeError, ValueError, RecursionError) as error:
        raise ValueError("claims must contain only finite JSON values") from error
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY") or os.open not in os.supports_dir_fd:
        raise ValueError("platform requires no-follow directory descriptor support")
    records = {}
    for claim in claims:
        if not isinstance(claim, dict) or not isinstance(claim.get("id"), str) or not claim["id"] or len(claim["id"]) > 256 or "\x00" in claim["id"]:
            raise ValueError("invalid claim id")
        if claim["id"] in records:
            raise ValueError("duplicate ids")
        if claim.get("declared") not in LEVELS:
            raise ValueError("invalid state")
        if not isinstance(claim.get("dependencies", []), list) or not all(isinstance(x, str) for x in claim.get("dependencies", [])):
            raise ValueError("invalid dependencies")
        if not isinstance(claim.get("evidence", []), list):
            raise ValueError("invalid evidence list")
        if len(claim.get("evidence", [])) > MAX_EVIDENCE:
            raise ValueError("too many evidence records")
        records[claim["id"]] = claim

    visiting, visited, ordered, depths = set(), set(), [], {}
    def visit(key, depth=0):
        if depth > MAX_DEPENDENCY_DEPTH:
            raise ValueError("dependency depth exceeded")
        if key in visiting:
            raise ValueError("dependency cycle")
        if key in visited:
            return
        if key not in records:
            raise ValueError("unknown dependency " + key)
        visiting.add(key)
        for dep in records[key].get("dependencies", []):
            visit(dep, depth + 1)
        depths[key] = max([0] + [depths[dep] + 1 for dep in records[key].get("dependencies", [])])
        if depths[key] > MAX_DEPENDENCY_DEPTH:
            raise ValueError("dependency depth exceeded")
        visiting.remove(key)
        visited.add(key)
        ordered.append(key)
    for key in records:
        visit(key)

    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        return _audit_ordered(records, ordered, root_fd)
    finally:
        os.close(root_fd)


def _audit_ordered(records, ordered, root_fd):
    results = {}
    for key in ordered:
        claim = records[key]
        valid, checks, seen_artifacts = set(), [], set()
        for evidence in claim.get("evidence", []):
            check, artifact = _artifact_check(root_fd, evidence)
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
        "warning": "Untrusted labels. Digest match proves local byte integrity only; not test execution, witness independence, authorization, or truth. Descriptor traversal rejects symlinks, but a filesystem owner can still mutate evidence; detected read changes fail closed. No authenticated provenance or cross-file snapshot is established.",
        "results": results,
    }


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _invalid_constant(value):
    raise ValueError("invalid JSON constant " + value)


def load_claims(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        data, _ = _read_regular(fd, MAX_MANIFEST_BYTES, "manifest")
    finally:
        os.close(fd)
    document = json.loads(data.decode("utf-8"), object_pairs_hook=_unique_object, parse_constant=_invalid_constant)
    if not isinstance(document, dict) or set(document) != {"claims"}:
        raise ValueError("manifest must contain only a claims list")
    return document["claims"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("claims")
    parser.add_argument("--root", default=".")
    args = parser.parse_args()
    try:
        report = audit(load_claims(args.claims), args.root)
        output = json.dumps(report, indent=2, allow_nan=False)
    except (OSError, ValueError, RecursionError, RuntimeError) as error:
        parser.error(str(error))
    print(output)


if __name__ == "__main__":
    main()
