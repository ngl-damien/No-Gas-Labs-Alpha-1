import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import gate_runner
import ngl


class GateRunnerTests(unittest.TestCase):
    def test_file_regex_and_json_typed_operations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "data.json").write_text('{"meta":{"state":"ready"}}', encoding="utf-8")
            (root / "source.py").write_text("# invariant-core\n", encoding="utf-8")
            spec = {"checks": [
                {"id": "file", "type": "file_exists", "path": "source.py", "weight": 20},
                {"id": "regex", "type": "regex_match", "path": "source.py", "pattern": "invariant-core", "weight": 20},
                {"id": "not-regex", "type": "not_regex_match", "path": "source.py", "pattern": "bad", "weight": 20},
                {"id": "json", "type": "json_field", "path": "data.json", "field": "meta.state", "equals": "ready", "weight": 40},
            ]}
            result = gate_runner.evaluate_gate(spec, root)
            self.assertEqual(result["decision"], "completed")
            self.assertEqual(result["epistemic_label"], "EXECUTION_OBSERVED")

    def test_rejects_arbitrary_command_field_and_unknown_operation(self):
        with self.assertRaisesRegex(ValueError, "invalid fields"):
            gate_runner.validate_spec({"checks": [{"id": "x", "type": "file_exists", "path": "x", "weight": 100, "cmd": "touch pwned"}]})
        with self.assertRaisesRegex(ValueError, "unsupported operation"):
            gate_runner.validate_spec({"checks": [{"id": "x", "type": "command", "cmd": "echo bad", "weight": 100}]})

    def test_rejects_nested_quantifier_and_path_escape(self):
        for pattern in ("(a+)+$", "(a|aa)+$"):
            with self.subTest(pattern=pattern), self.assertRaisesRegex(ValueError, "quantified groups"):
                gate_runner.validate_spec({"checks": [{"id": "x", "type": "regex_match", "path": "x", "pattern": pattern, "weight": 100}]})
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "escapes workdir"):
                gate_runner._safe_resolve(Path(tmp), "../secret")

    def test_unknown_failed_attempt_and_not_run_block_aggregate_observation(self):
        for status, label in (("UNKNOWN", "UNKNOWN"), ("NOT_RUN", "NOT_RUN"), ("FAILED_ATTEMPT", "FAILED_ATTEMPT")):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as tmp:
                check = {"id": "x", "type": "file_exists", "path": "present", "weight": 100}
                (Path(tmp) / "present").write_text("ok", encoding="utf-8")
                original = gate_runner.run_check
                try:
                    gate_runner.run_check = lambda c, w, s=status, l=label: {"id": c["id"], "weight": c["weight"], "type": c["type"], "status": s, "epistemic_label": l, "detail": "injected test state"}
                    result = gate_runner.evaluate_gate({"checks": [check]}, Path(tmp))
                finally:
                    gate_runner.run_check = original
                self.assertNotEqual(result["epistemic_label"], "EXECUTION_OBSERVED")
                self.assertNotEqual(result["decision"], "completed")

    def test_validator_and_fixed_unittest_registry(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            valid = {"checks": [{"id": "x", "type": "file_exists", "path": "x", "weight": 100}]}
            (root / "valid.json").write_text(json.dumps(valid), encoding="utf-8")
            result = gate_runner.run_check({"id": "v", "type": "validator_run", "validator_id": "gate-spec", "path": "valid.json", "weight": 100}, root)
            self.assertEqual(result["status"], "PASS")
        with self.assertRaisesRegex(ValueError, "not allowlisted"):
            gate_runner.validate_spec({"checks": [{"id": "u", "type": "unittest_run", "test_id": "../../evil", "weight": 100}]})
        self.assertEqual(gate_runner.UNITTESTS["ngl-invariant-core"][1:4], ["-m", "unittest", "discover"])


class LedgerAndClosureTests(unittest.TestCase):
    def test_unanchored_and_expected_head_verification(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = Path(tmp) / "ledger.jsonl"
            entry = ngl.append_event(ledger, "test", "EVENT", "USER_STATED", {"x": 1})
            self.assertEqual(ngl.verify_chain(ledger)["status"], "UNANCHORED")
            self.assertEqual(ngl.verify_chain(ledger, expected_head=entry["entry_hash"])["status"], "CHAIN_INTACT")
            self.assertEqual(ngl.verify_chain(ledger, expected_head="f" * 64)["status"], "TAMPER_DETECTED")

    def test_external_anchor_ref_requires_head_match(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ledger_dir = root / "ledger-store"
            ledger_dir.mkdir()
            ledger = ledger_dir / "ledger.jsonl"
            entry = ngl.append_event(ledger, "test", "EVENT", "USER_STATED", {})
            anchor = root / "anchor.json"
            anchor.write_text(json.dumps({"head_hash": entry["entry_hash"], "count": 1}), encoding="utf-8")
            self.assertEqual(ngl.verify_chain(ledger, anchor_ref=anchor)["status"], "CHAIN_INTACT")
            inside_anchor = ledger_dir / "anchor.json"
            inside_anchor.write_text(anchor.read_text(encoding="utf-8"), encoding="utf-8")
            self.assertEqual(ngl.verify_chain(ledger, anchor_ref=inside_anchor)["status"], "UNANCHORED")
            anchor.write_text(json.dumps({"head_hash": entry["entry_hash"], "count": 2}), encoding="utf-8")
            self.assertEqual(ngl.verify_chain(ledger, anchor_ref=anchor)["status"], "TAMPER_DETECTED")

    def test_truncation_is_detected_by_external_anchor(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = Path(tmp) / "ledger.jsonl"
            first = ngl.append_event(ledger, "test", "A", "ARTIFACT_OBSERVED", {})
            final = ngl.append_event(ledger, "test", "B", "ARTIFACT_OBSERVED", {})
            ledger.write_text(ledger.read_text(encoding="utf-8").splitlines()[0] + "\n", encoding="utf-8")
            self.assertEqual(ngl.verify_chain(ledger, expected_head=final["entry_hash"])["status"], "TAMPER_DETECTED")
            self.assertNotEqual(first["entry_hash"], final["entry_hash"])

    def test_closure_requires_anchored_completed_gate_scheduler_and_payloop(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ledger = root / "m.jsonl"
            ngl.append_event(ledger, "mppt", "GATE_EVALUATION", "EXECUTION_OBSERVED", {"decision": "completed"})
            head = ngl._verify_internal(ledger)["head_hash"]
            scheduler = root / "scheduler.json"
            scheduler.write_text(json.dumps({"ready": True, "owner": "worker-a", "blockers": []}), encoding="utf-8")
            pay = root / "pay.json"
            pay.write_text(json.dumps({"artifact_sha256": "a" * 64}), encoding="utf-8")
            closed = ngl._closure(ledger, head, None, scheduler, "S0", pay)
            self.assertEqual(closed["decision"], "completed")
            self.assertEqual(ngl._closure(ledger, None, None, scheduler, "S0", pay)["decision"], "blocked")
            scheduler.write_text(json.dumps({"ready": False, "owner": "worker-a", "blockers": ["collision"]}), encoding="utf-8")
            self.assertEqual(ngl._closure(ledger, head, None, scheduler, "S0", pay)["decision"], "blocked")
            scheduler.write_text(json.dumps({"ready": True, "owner": "worker-a", "blockers": []}), encoding="utf-8")
            pay.write_text(json.dumps({"artifact_sha256": "a" * 64}), encoding="utf-8")
            self.assertEqual(ngl._closure(ledger, head, None, scheduler, "S4", pay)["decision"], "blocked")


if __name__ == "__main__":
    unittest.main()
