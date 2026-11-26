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

    def test_verifier_rejects_nonstandard_json_numeric_constants_without_raising(self):
        for constant in ("NaN", "Infinity", "-Infinity"):
            with self.subTest(constant=constant), tempfile.TemporaryDirectory() as tmp:
                ledger = Path(tmp) / "mission.jsonl"
                ledger.write_text(
                    '{"seq":0,"prev_hash":"' + ngl.GENESIS +
                    '","event_type":"EVENT","payload":{"measurement":' + constant +
                    '},"entry_hash":"' + "0" * 64 + '"}\\n',
                    encoding="utf-8",
                )
                result = ngl.verify_chain(ledger, expected_head=ngl.GENESIS)
                self.assertEqual(result["status"], "TAMPER_DETECTED")
                self.assertIn("non-standard JSON constant", result["detail"])

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
