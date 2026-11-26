"""Strict JSON serialization regressions for the mission ledger."""
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import ngl


class StrictLedgerJsonTests(unittest.TestCase):
    def test_hash_rejects_non_finite_json_numbers(self):
        for value in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    ngl._hash({"payload": {"measurement": value}})

    def test_append_rejects_non_finite_payload_without_persisting_record(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = Path(tmp) / "mission.jsonl"
            with self.assertRaises(ValueError):
                ngl.append_event(
                    ledger, "test", "MEASUREMENT", "ARTIFACT_OBSERVED",
                    {"measurement": float("nan")},
                )
            self.assertEqual(ledger.read_bytes(), b"")
            entry = ngl.append_event(
                ledger, "test", "MEASUREMENT", "ARTIFACT_OBSERVED",
                {"measurement": 1.25},
            )
            self.assertEqual(entry["seq"], 0)
            self.assertEqual(ngl.verify_chain(ledger, expected_head=entry["entry_hash"])["status"], "CHAIN_INTACT")


if __name__ == "__main__":
    unittest.main()
