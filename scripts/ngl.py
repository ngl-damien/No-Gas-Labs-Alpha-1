"""NGL Invariant Kernel CLI: mission ledger, typed gates, anchored verification."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
try:
    import fcntl
except ImportError:  # Keep non-ledger CLI commands importable on non-POSIX hosts.
    fcntl = None
import hashlib
import json
import os
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path

import gate_runner

GENESIS = "0" * 64
PAY_EVIDENCE = {
    "S0": ("artifact_sha256",),
    "S1": ("catalog_id",),
    "S2": ("distribution_ref",),
    "S3": ("engagement_ref",),
    "S4": ("transaction_id", "receipt_hash"),
    "S5": ("delivery_ref",),
    "S6": ("usage_ref",),
    "S7": ("second_sale_ref",),
    "S8": ("positive_economics_ref",),
}


def _hash(value: dict) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _validate_ledger_directory(directory_fd: int) -> None:
    metadata = os.fstat(directory_fd)
    if not stat.S_ISDIR(metadata.st_mode):
        raise OSError("mission-ledger parent is not a directory")
    if hasattr(os, "getuid") and metadata.st_uid not in (0, os.getuid()):
        raise OSError("mission-ledger parent directory is not owned by root or the current user")
    if metadata.st_mode & 0o022 and not metadata.st_mode & stat.S_ISVTX:
        raise OSError("mission-ledger parent directory must not be group/world writable without the sticky bit")


def _open_ledger_directory(ledger: Path, *, create: bool = False) -> int:
    if not hasattr(os, "O_DIRECTORY") or not hasattr(os, "O_NOFOLLOW"):
        raise OSError("mission-ledger access requires O_DIRECTORY and O_NOFOLLOW support")
    if not hasattr(os, "supports_dir_fd") or os.open not in os.supports_dir_fd or os.mkdir not in os.supports_dir_fd:
        raise OSError("mission-ledger access requires directory-descriptor operations")
    if not ledger.name or ledger.name in (".", ".."):
        raise OSError("mission-ledger path must name a file")
    parent = ledger.parent
    if ".." in parent.parts:
        raise OSError("mission-ledger parent path must not contain '..' components")

    directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    if ledger.is_absolute():
        directory_fd = os.open(ledger.anchor, directory_flags)
        components = parent.parts[1:]
    else:
        directory_fd = os.open(".", directory_flags)
        components = parent.parts

    try:
        _validate_ledger_directory(directory_fd)
        for component in components:
            if component in ("", "."):
                continue
            try:
                next_fd = os.open(component, directory_flags, dir_fd=directory_fd)
            except FileNotFoundError:
                if not create:
                    raise
                try:
                    os.mkdir(component, 0o700, dir_fd=directory_fd)
                except FileExistsError:
                    pass
                next_fd = os.open(component, directory_flags, dir_fd=directory_fd)
            try:
                _validate_ledger_directory(next_fd)
            except BaseException:
                os.close(next_fd)
                raise
            os.close(directory_fd)
            directory_fd = next_fd
        return directory_fd
    except BaseException:
        os.close(directory_fd)
        raise


def _open_ledger_fd(ledger: Path, flags: int, directory_fd: int | None = None) -> int:
    owns_directory = directory_fd is None
    if owns_directory:
        directory_fd = _open_ledger_directory(ledger)
    try:
        fd = os.open(ledger.name, flags | os.O_NOFOLLOW, 0o600, dir_fd=directory_fd)
        try:
            metadata = os.fstat(fd)
            if not stat.S_ISREG(metadata.st_mode):
                raise OSError("mission-ledger path is not a regular file")
            if metadata.st_nlink != 1:
                raise OSError("mission-ledger file must not have hard-link aliases")
            return fd
        except BaseException:
            os.close(fd)
            raise
    finally:
        if owns_directory:
            os.close(directory_fd)


def _ledger_entries(ledger: Path, ledger_fd: int | None = None) -> list[dict]:
    try:
        if ledger_fd is None:
            try:
                fd = _open_ledger_fd(ledger, os.O_RDONLY)
            except FileNotFoundError:
                return []
        else:
            fd = os.dup(ledger_fd)
        os.lseek(fd, 0, os.SEEK_SET)
        with os.fdopen(fd, "r", encoding="utf-8") as stream:
            entries = []
            for number, line in enumerate(stream, 1):
                if not line.strip():
                    continue
                try:
                    item = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"malformed ledger JSON at line {number}: {exc}") from exc
                if not isinstance(item, dict):
                    raise ValueError(f"ledger entry at line {number} is not an object")
                entries.append(item)
            return entries
    except OSError:
        raise


def _verify_internal(ledger: Path, ledger_fd: int | None = None) -> dict:
    try:
        entries = _ledger_entries(ledger, ledger_fd)
    except (OSError, ValueError) as exc:
        return {"status": "TAMPER_DETECTED", "detail": str(exc)}
    previous = GENESIS
    for seq, entry in enumerate(entries):
        expected = _hash({key: value for key, value in entry.items() if key != "entry_hash"})
        if entry.get("seq") != seq or entry.get("prev_hash") != previous or entry.get("entry_hash") != expected:
            return {"status": "TAMPER_DETECTED", "seq": seq}
        previous = entry["entry_hash"]
    return {"status": "CHAIN_INTACT", "count": len(entries), "head_hash": previous}


@contextmanager
def _ledger_lock(ledger: Path, *, exclusive: bool):
    """Coordinate cooperating readers/writers through one persistent lock inode."""
    if fcntl is None:
        raise OSError("mission-ledger locking requires POSIX fcntl.flock; this operation is unavailable on this platform")
    directory_fd = _open_ledger_directory(ledger, create=True)
    lock_fd = None
    acquired = False
    try:
        lock_fd = os.open(
            ledger.name + ".lock",
            os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW,
            0o600,
            dir_fd=directory_fd,
        )
        metadata = os.fstat(lock_fd)
        if not stat.S_ISREG(metadata.st_mode):
            raise OSError("mission-ledger lock path is not a regular file")
        if metadata.st_mode & 0o077:
            raise OSError("mission-ledger lock file permissions must exclude group and other access")
        if metadata.st_nlink != 1:
            raise OSError("mission-ledger lock file must not have hard-link aliases")
        if hasattr(os, "getuid") and metadata.st_uid != os.getuid():
            raise OSError("mission-ledger lock file is not owned by the current user")
        fcntl.flock(lock_fd, fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
        acquired = True
        yield directory_fd
    finally:
        try:
            if lock_fd is not None:
                try:
                    if acquired:
                        fcntl.flock(lock_fd, fcntl.LOCK_UN)
                finally:
                    os.close(lock_fd)
        finally:
            os.close(directory_fd)


def _verify_chain_unlocked(ledger: Path, expected_head: str | None = None, anchor_ref: Path | None = None, ledger_fd: int | None = None) -> dict:
    if expected_head is not None and anchor_ref is not None:
        raise ValueError("supply only one external anchor source")
    if expected_head is None and anchor_ref is None:
        return {"status": "UNANCHORED", "detail": "verify requires --expected-head or --anchor-ref"}
    internal = _verify_internal(ledger, ledger_fd)
    if internal["status"] != "CHAIN_INTACT":
        return internal
    if expected_head is not None:
        anchored_head = expected_head
        anchor_count = None
    else:
        try:
            anchor_path = anchor_ref.resolve()
            try:
                anchor_path.relative_to(ledger.parent.resolve())
            except ValueError:
                pass
            else:
                return {"status": "UNANCHORED", "detail": "anchor-ref must be outside the ledger directory"}
            data = json.loads(anchor_path.read_text(encoding="utf-8"))
            anchored_head = data["head_hash"]
            anchor_count = data.get("count")
        except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
            return {"status": "UNANCHORED", "detail": f"anchor unreadable or invalid: {exc}"}
    if not isinstance(anchored_head, str) or len(anchored_head) != 64 or any(ch not in "0123456789abcdef" for ch in anchored_head):
        return {"status": "UNANCHORED", "detail": "expected head must be a lowercase SHA-256 hex digest"}
    if internal["head_hash"] != anchored_head:
        return {"status": "TAMPER_DETECTED", "detail": "observed head does not match external anchor", "observed_head": internal["head_hash"], "expected_head": anchored_head}
    if anchor_count is not None and anchor_count != internal["count"]:
        return {"status": "TAMPER_DETECTED", "detail": "observed count does not match external anchor", "observed_count": internal["count"], "expected_count": anchor_count}
    return {**internal, "anchor_source": "expected_head" if expected_head is not None else str(anchor_ref)}


def verify_chain(ledger: Path, expected_head: str | None = None, anchor_ref: Path | None = None) -> dict:
    if expected_head is None and anchor_ref is None:
        return _verify_chain_unlocked(ledger, expected_head, anchor_ref)
    with _ledger_lock(ledger, exclusive=False) as directory_fd:
        try:
            ledger_fd = _open_ledger_fd(ledger, os.O_RDONLY, directory_fd)
        except FileNotFoundError:
            return {"status": "TAMPER_DETECTED", "detail": "anchored ledger file is missing"}
        except OSError as exc:
            return {"status": "TAMPER_DETECTED", "detail": f"ledger descriptor rejected: {exc}"}
        try:
            return _verify_chain_unlocked(ledger, expected_head, anchor_ref, ledger_fd)
        finally:
            os.close(ledger_fd)


def append_event(ledger: Path, actor: str, event_type: str, label: str, payload: dict) -> dict:
    # Verify and append through one validated inode while holding the logical-path lock.
    with _ledger_lock(ledger, exclusive=True) as directory_fd:
        ledger_fd = _open_ledger_fd(ledger, os.O_RDWR | os.O_APPEND | os.O_CREAT, directory_fd)
        try:
            internal = _verify_internal(ledger, ledger_fd)
            if internal["status"] != "CHAIN_INTACT":
                raise RuntimeError("Refusing append to invalid ledger")
            body = {
                "seq": internal["count"],
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "actor": actor,
                "event_type": event_type,
                "epistemic_label": label,
                "prev_hash": internal["head_hash"],
                "payload": payload,
            }
            body["entry_hash"] = _hash(body)
            encoded = (json.dumps(body, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")
            remaining = memoryview(encoded)
            while remaining:
                written = os.write(ledger_fd, remaining)
                if written <= 0:
                    raise OSError("short write while appending mission ledger event")
                remaining = remaining[written:]
            os.fsync(ledger_fd)
            return body
        finally:
            os.close(ledger_fd)


def _anchor_args(parser: argparse.ArgumentParser) -> None:
    group = parser.add_mutually_exclusive_group(required=False)
    group.add_argument("--expected-head")
    group.add_argument("--anchor-ref", type=Path)


def _ledger_path(store: str, mission_id: str) -> Path:
    if not mission_id or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for ch in mission_id):
        raise ValueError("mission id contains unsupported characters")
    return Path(store) / f"{mission_id}.jsonl"


def _load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected JSON object in {path}")
    return value


def _closure(ledger: Path, expected_head: str | None, anchor_ref: Path | None,
             scheduler_preconditions: Path, pay_stage: str, pay_evidence: Path) -> dict:
    # Verify and inspect the terminal event through one opened ledger inode.
    with _ledger_lock(ledger, exclusive=False) as directory_fd:
        try:
            ledger_fd = _open_ledger_fd(ledger, os.O_RDONLY, directory_fd)
        except FileNotFoundError:
            return {"decision": "blocked", "reason": "ledger file is missing"}
        try:
            verification = _verify_chain_unlocked(ledger, expected_head, anchor_ref, ledger_fd)
            if verification["status"] != "CHAIN_INTACT":
                return {"decision": "blocked", "reason": "ledger is not externally anchored and intact", "verification": verification}
            entries = _ledger_entries(ledger, ledger_fd)
            if not entries or entries[-1].get("event_type") != "GATE_EVALUATION" or entries[-1].get("payload", {}).get("decision") != "completed":
                return {"decision": "blocked", "reason": "latest ledger event is not a completed gate evaluation", "verification": verification}
        finally:
            os.close(ledger_fd)
    scheduler = _load_json(scheduler_preconditions)
    if set(scheduler) != {"ready", "owner", "blockers"} or scheduler.get("ready") is not True or not isinstance(scheduler.get("owner"), str) or not scheduler["owner"] or scheduler.get("blockers") != []:
        return {"decision": "blocked", "reason": "scheduler preconditions must have ready=true, a named owner, and no blockers", "verification": verification}
    if pay_stage not in PAY_EVIDENCE:
        raise ValueError("pay stage must be S0 through S8")
    pay = _load_json(pay_evidence)
    required = [field for stage in list(PAY_EVIDENCE)[:int(pay_stage[1:]) + 1] for field in PAY_EVIDENCE[stage]]
    missing = [field for field in required if not isinstance(pay.get(field), str) or not pay[field].strip()]
    if missing:
        return {"decision": "blocked", "reason": "pay-loop evidence missing", "missing": missing, "verification": verification}
    return {
        "decision": "completed",
        "epistemic_label": "EXECUTION_OBSERVED",
        "mission_id": ledger.stem,
        "ledger_status": verification["status"],
        "head_hash": verification["head_hash"],
        "scheduler_preconditions": "ready",
        "pay_loop_stage": pay_stage,
        "pay_loop_evidence_fields": required,
        "closure_is_read_only": True,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="NGL executable invariant kernel")
    parser.add_argument("--store", default=".ngl_ledger")
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init")
    init.add_argument("mission_id")
    init.add_argument("--objective", required=True)
    gate = sub.add_parser("gate")
    gate.add_argument("mission_id")
    gate.add_argument("spec", type=Path)
    gate.add_argument("--workdir", type=Path, default=Path("."))
    verify = sub.add_parser("verify")
    verify.add_argument("mission_id")
    _anchor_args(verify)
    close = sub.add_parser("close")
    close.add_argument("mission_id")
    _anchor_args(close)
    close.add_argument("--scheduler-preconditions", type=Path, required=True)
    close.add_argument("--pay-stage", required=True, choices=list(PAY_EVIDENCE))
    close.add_argument("--pay-evidence", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        ledger = _ledger_path(args.store, args.mission_id)
        if args.command == "init":
            entry = append_event(ledger, "no-gas-labs", "MISSION_INIT", "USER_STATED", {"objective": args.objective})
            print(json.dumps({"status": "initialized", "head_hash": entry["entry_hash"]}, indent=2))
            return 0
        if args.command == "gate":
            spec = json.loads(args.spec.read_text(encoding="utf-8"))
            report = gate_runner.evaluate_gate(spec, args.workdir)
            entry = append_event(ledger, "mppt+neophyte-gate", "GATE_EVALUATION", report["epistemic_label"], report)
            print(json.dumps({"entry_hash": entry["entry_hash"], "gate": report}, indent=2))
            return 0 if report["decision"] == "completed" else 1
        if args.command == "verify":
            report = verify_chain(ledger, args.expected_head, args.anchor_ref)
            print(json.dumps(report, indent=2))
            return 0 if report["status"] == "CHAIN_INTACT" else 1
        if args.command == "close":
            report = _closure(ledger, args.expected_head, args.anchor_ref, args.scheduler_preconditions, args.pay_stage, args.pay_evidence)
            print(json.dumps(report, indent=2))
            return 0 if report["decision"] == "completed" else 1
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "ERROR", "detail": str(exc)}, indent=2), file=sys.stderr)
        return 2
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
