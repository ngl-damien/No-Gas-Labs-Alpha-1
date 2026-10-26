#!/usr/bin/env python3
"""Negative and positive tests for the proof-carrying commercial state machine."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from proof_package import advance, build_package, load_package


class CommercialStateMachineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        (self.source / "input.txt").write_text("source evidence\n", encoding="utf-8")
        self.out = self.root / "out"
        self.package_path = build_package(
            self.source,
            self.out,
            "Repository due-diligence packet",
            ["Every material finding has evidence", "Unresolved conflicts are listed"],
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def evidence(self, name: str, body: str) -> Path:
        path = self.root / name
        path.write_text(body, encoding="utf-8")
        return path

    def test_revenue_is_not_assertable_at_creation(self) -> None:
        package = load_package(self.package_path)
        self.assertEqual(package["commercial"]["state"], "UNVERIFIED")
        self.assertFalse(package["commercial"]["claims"]["revenue_assertable"])

    def test_cannot_skip_buyer_interest(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid transition"):
            advance(
                self.package_path,
                "ACCEPTED_DELIVERY",
                "buyer",
                self.evidence("acceptance.txt", "accepted"),
                None,
            )

    def test_evidence_is_required_for_interest(self) -> None:
        with self.assertRaisesRegex(ValueError, "requires an evidence file"):
            advance(self.package_path, "BUYER_INTEREST", "buyer", None, None)

    def test_revenue_remains_false_through_receipt(self) -> None:
        advance(
            self.package_path,
            "BUYER_INTEREST",
            "buyer",
            self.evidence("interest.txt", "Please quote this bounded job."),
            None,
        )
        advance(
            self.package_path,
            "ACCEPTED_DELIVERY",
            "buyer",
            self.evidence("acceptance.txt", "Accepted against the written criteria."),
            "Buyer accepted delivery",
        )
        advance(self.package_path, "EVIDENCE_RECEIPT", "buyer", None, None)

        package = load_package(self.package_path)
        self.assertEqual(package["commercial"]["state"], "EVIDENCE_RECEIPT")
        self.assertFalse(package["commercial"]["claims"]["revenue_assertable"])
        self.assertTrue((self.out / "acceptance-receipt.json").is_file())

    def test_payment_requires_positive_amount_and_evidence(self) -> None:
        advance(
            self.package_path,
            "BUYER_INTEREST",
            "buyer",
            self.evidence("interest.txt", "Interested"),
            None,
        )
        advance(
            self.package_path,
            "ACCEPTED_DELIVERY",
            "buyer",
            self.evidence("acceptance.txt", "Accepted"),
            None,
        )
        advance(self.package_path, "EVIDENCE_RECEIPT", "buyer", None, None)

        with self.assertRaisesRegex(ValueError, "requires an evidence file"):
            advance(self.package_path, "ACTUAL_PAYMENT", "operator", None, None, "25", "USD")

        payment = self.evidence("payment.txt", "transaction receipt")
        with self.assertRaisesRegex(ValueError, "greater than zero"):
            advance(self.package_path, "ACTUAL_PAYMENT", "operator", payment, None, "0", "USD")

    def test_full_path_allows_revenue_claim_only_after_payment(self) -> None:
        first = advance(
            self.package_path,
            "BUYER_INTEREST",
            "buyer",
            self.evidence("interest.txt", "Interested"),
            None,
        )
        second = advance(
            self.package_path,
            "ACCEPTED_DELIVERY",
            "buyer",
            self.evidence("acceptance.txt", "Accepted"),
            None,
        )
        third = advance(self.package_path, "EVIDENCE_RECEIPT", "buyer", None, None)
        fourth = advance(
            self.package_path,
            "ACTUAL_PAYMENT",
            "operator",
            self.evidence("payment.txt", "transaction receipt"),
            "Funds received",
            "25",
            "USD",
        )

        self.assertIsNone(first["previous_event_sha256"])
        self.assertEqual(second["previous_event_sha256"], first["event_sha256"])
        self.assertEqual(third["previous_event_sha256"], second["event_sha256"])
        self.assertEqual(fourth["previous_event_sha256"], third["event_sha256"])

        package = json.loads(self.package_path.read_text(encoding="utf-8"))
        self.assertEqual(package["commercial"]["state"], "ACTUAL_PAYMENT")
        self.assertTrue(package["commercial"]["claims"]["revenue_assertable"])
        self.assertEqual(package["commercial"]["claims"]["amount_received"], "25")
        self.assertEqual(package["commercial"]["claims"]["currency"], "USD")


if __name__ == "__main__":
    unittest.main()
