#!/usr/bin/env python3
"""Create and advance an evidence-gated proof package for bounded work."""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA = "ngl.proof-package.v2"
INITIAL_STATE = "UNVERIFIED"
TRANSITIONS = {
    INITIAL_STATE: "BUYER_INTEREST",
    "BUYER_INTEREST": "ACCEPTED_DELIVERY",
    "ACCEPTED_DELIVERY": "EVIDENCE_RECEIPT",
    "EVIDENCE_RECEIPT": "ACTUAL_PAYMENT",
}
COMMERCIAL_STATES = tuple(TRANSITIONS.values())


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def evidence_record(path: Path, kind: str) -> dict[str, Any]:
    if not path.is_file():
        raise ValueError(f"evidence file does not exist: {path}")
    return {
        "kind": kind,
        "path": str(path),
        "sha256": sha256(path),
        "bytes": path.stat().st_size,
    }


def revenue_claim(state: str, payment: dict[str, Any] | None = None) -> dict[str, Any]:
    assertable = state == "ACTUAL_PAYMENT"
    claim = {
        "revenue_assertable": assertable,
        "basis": (
            "actual payment evidence attached"
            if assertable
            else "payment state not independently evidenced"
        ),
    }
    if assertable and payment:
        claim["amount_received"] = payment["amount"]
        claim["currency"] = payment["currency"]
    return claim


def build_package(source_dir: Path, output_dir: Path, job: str, criteria: list[str]) -> Path:
    files = sorted(p for p in source_dir.rglob("*") if p.is_file())
    evidence = [
        {
            "path": str(p.relative_to(source_dir)),
            "sha256": sha256(p),
            "bytes": p.stat().st_size,
        }
        for p in files
    ]
    package = {
        "schema": SCHEMA,
        "job": job,
        "acceptance_criteria": criteria,
        "created_at": utc_now(),
        "evidence": evidence,
        "checks": [
            {"name": "source_inventory", "status": "passed", "detail": f"{len(files)} file(s) hashed"},
            {"name": "human_acceptance", "status": "pending", "detail": "Awaiting reviewer decision"},
            {"name": "payment_evidence", "status": "pending", "detail": "No payment evidence attached"},
        ],
        "authority": {
            "model_proposals_authorize": False,
            "connector_responses_authorize": False,
            "commercial_state_requires_evidence": True,
        },
        "acceptance": {"status": "pending", "reviewer": None, "notes": None},
        "commercial": {
            "state": INITIAL_STATE,
            "events": [],
            "acceptance_receipt": None,
            "payment": None,
            "claims": revenue_claim(INITIAL_STATE),
        },
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / "proof-package.json"
    target.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
    return target


def load_package(path: Path) -> dict[str, Any]:
    package = json.loads(path.read_text(encoding="utf-8"))
    if package.get("schema") not in {SCHEMA, "ngl.proof-package.v1"}:
        raise ValueError(f"unsupported schema: {package.get('schema')}")
    if package.get("schema") == "ngl.proof-package.v1":
        package["schema"] = SCHEMA
        package["commercial"] = {
            "state": INITIAL_STATE,
            "events": [],
            "acceptance_receipt": None,
            "payment": None,
            "claims": revenue_claim(INITIAL_STATE),
        }
        package.setdefault("checks", []).append(
            {"name": "payment_evidence", "status": "pending", "detail": "No payment evidence attached"}
        )
        package.setdefault("authority", {})["commercial_state_requires_evidence"] = True
    return package


def save_package(path: Path, package: dict[str, Any]) -> None:
    path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")


def append_event(
    package: dict[str, Any],
    *,
    state: str,
    actor: str,
    evidence: dict[str, Any],
    note: str | None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    events = package["commercial"]["events"]
    event = {
        "sequence": len(events) + 1,
        "state": state,
        "recorded_at": utc_now(),
        "actor": actor,
        "evidence": evidence,
        "note": note,
        "previous_event_sha256": events[-1]["event_sha256"] if events else None,
    }
    if extra:
        event.update(extra)
    event["event_sha256"] = canonical_sha256(event)
    events.append(event)
    return event


def make_acceptance_receipt(package: dict[str, Any], actor: str, note: str | None) -> dict[str, Any]:
    accepted_event = next(
        (e for e in reversed(package["commercial"]["events"]) if e["state"] == "ACCEPTED_DELIVERY"),
        None,
    )
    if accepted_event is None:
        raise ValueError("cannot issue receipt without accepted delivery")
    receipt_body = {
        "schema": "ngl.acceptance-receipt.v1",
        "job": package["job"],
        "acceptance_criteria": package["acceptance_criteria"],
        "accepted_delivery_event_sha256": accepted_event["event_sha256"],
        "source_manifest_sha256": canonical_sha256(package["evidence"]),
        "reviewer": actor,
        "notes": note,
        "unresolved": [
            check for check in package.get("checks", []) if check.get("status") in {"failed", "pending"}
        ],
    }
    return {**receipt_body, "receipt_sha256": canonical_sha256(receipt_body)}


def advance(
    package_path: Path,
    target_state: str,
    actor: str,
    evidence_path: Path | None,
    note: str | None,
    amount: str | None = None,
    currency: str | None = None,
) -> dict[str, Any]:
    package = load_package(package_path)
    current = package["commercial"]["state"]
    expected = TRANSITIONS.get(current)
    if target_state != expected:
        raise ValueError(f"invalid transition {current} -> {target_state}; expected {expected}")

    if not actor.strip():
        raise ValueError("actor is required")

    if target_state == "EVIDENCE_RECEIPT":
        receipt = make_acceptance_receipt(package, actor, note)
        receipt_path = package_path.parent / "acceptance-receipt.json"
        receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        evidence = evidence_record(receipt_path, "acceptance_receipt")
        package["commercial"]["acceptance_receipt"] = {
            "path": str(receipt_path),
            "sha256": evidence["sha256"],
            "receipt_sha256": receipt["receipt_sha256"],
        }
    else:
        if evidence_path is None:
            raise ValueError(f"{target_state} requires an evidence file")
        kind = {
            "BUYER_INTEREST": "buyer_interest",
            "ACCEPTED_DELIVERY": "buyer_acceptance",
            "ACTUAL_PAYMENT": "payment",
        }[target_state]
        evidence = evidence_record(evidence_path, kind)

    extra: dict[str, Any] = {}
    if target_state == "ACTUAL_PAYMENT":
        if amount is None or currency is None:
            raise ValueError("ACTUAL_PAYMENT requires --amount and --currency")
        try:
            numeric_amount = float(amount)
        except ValueError as exc:
            raise ValueError("--amount must be numeric") from exc
        if numeric_amount <= 0:
            raise ValueError("--amount must be greater than zero")
        extra["payment"] = {"amount": amount, "currency": currency.upper()}
        package["commercial"]["payment"] = {
            **extra["payment"],
            "evidence": evidence,
        }

    event = append_event(
        package,
        state=target_state,
        actor=actor,
        evidence=evidence,
        note=note,
        extra=extra or None,
    )
    package["commercial"]["state"] = target_state
    package["commercial"]["claims"] = revenue_claim(target_state, extra.get("payment"))

    if target_state == "ACCEPTED_DELIVERY":
        package["acceptance"] = {"status": "accepted", "reviewer": actor, "notes": note}
        for check in package.get("checks", []):
            if check.get("name") == "human_acceptance":
                check.update({"status": "passed", "detail": f"Accepted by {actor}"})
    elif target_state == "ACTUAL_PAYMENT":
        for check in package.get("checks", []):
            if check.get("name") == "payment_evidence":
                check.update({"status": "passed", "detail": "Payment evidence attached and hashed"})

    save_package(package_path, package)
    return event


def status(package_path: Path) -> dict[str, Any]:
    package = load_package(package_path)
    commercial = package["commercial"]
    return {
        "job": package["job"],
        "state": commercial["state"],
        "next_state": TRANSITIONS.get(commercial["state"]),
        "revenue_assertable": commercial["claims"]["revenue_assertable"],
        "events": [
            {"sequence": e["sequence"], "state": e["state"], "event_sha256": e["event_sha256"]}
            for e in commercial["events"]
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Create and advance NGL proof-carrying work packages")
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create", help="create a proof package")
    create.add_argument("source", type=Path)
    create.add_argument("--out", type=Path, default=Path("proof-package"))
    create.add_argument("--job", required=True)
    create.add_argument("--criterion", action="append", default=[])

    advance_parser = subparsers.add_parser("advance", help="advance one evidence-gated commercial state")
    advance_parser.add_argument("package", type=Path)
    advance_parser.add_argument("--to", required=True, choices=COMMERCIAL_STATES)
    advance_parser.add_argument("--actor", required=True)
    advance_parser.add_argument("--evidence", type=Path)
    advance_parser.add_argument("--note")
    advance_parser.add_argument("--amount")
    advance_parser.add_argument("--currency")

    status_parser = subparsers.add_parser("status", help="show commercial evidence state")
    status_parser.add_argument("package", type=Path)

    args = parser.parse_args()

    if args.command == "create":
        print(f"created {build_package(args.source, args.out, args.job, args.criterion)}")
    elif args.command == "advance":
        event = advance(
            args.package,
            args.to,
            args.actor,
            args.evidence,
            args.note,
            args.amount,
            args.currency,
        )
        print(json.dumps(event, indent=2))
    elif args.command == "status":
        print(json.dumps(status(args.package), indent=2))


if __name__ == "__main__":
    main()
