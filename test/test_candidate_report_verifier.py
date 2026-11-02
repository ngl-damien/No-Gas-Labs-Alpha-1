import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SYNTHESIZER = ROOT / "scripts" / "synthesize-candidate-task.mjs"
EVALUATOR = ROOT / "scripts" / "evaluate-candidate-task.mjs"
VERIFIER = ROOT / "scripts" / "verify-candidate-report.py"


def task_specification():
    return {
        "schema": "ngl.candidate-task-spec.v1",
        "id": "ngl.experiment-001.task:quadratic-3x2-plus-2x-minus-5:v1",
        "inputMin": -1_000_000,
        "inputMax": 1_000_000,
        "proofMethod": "exact-integer-polynomial-normal-form",
        "limits": {
            "maxAstDepth": 12,
            "maxAstNodes": 63,
            "maxPolynomialDegree": 32,
            "maxCoefficientBits": 4096,
            "maxSafeInteger": 9_007_199_254_740_991,
        },
        "targetCoefficients": ["-5", "2", "3"],
    }


class IndependentCandidateReportVerifierTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ngl-independent-candidate-verifier-")
        self.directory = Path(self.temporary.name)
        self.specification_path = self.directory / "task-specification.json"
        self.receipt_path = self.directory / "synthesis-receipt.json"
        self.specification_path.write_text(json.dumps(task_specification(), indent=2) + "\n", encoding="utf-8")
        synthesized = self.run_node(SYNTHESIZER, [str(self.specification_path)])
        self.assertEqual(synthesized.returncode, 0, synthesized.stderr)
        self.receipt_path.write_text(synthesized.stdout, encoding="utf-8")
        self.receipt = json.loads(synthesized.stdout)

    def tearDown(self):
        self.temporary.cleanup()

    def run_node(self, script, args):
        return subprocess.run(
            ["node", str(script), *args],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )

    def run_verifier(self, report_path, receipt_path=None):
        return subprocess.run(
            [sys.executable, str(VERIFIER), str(receipt_path or self.receipt_path), str(report_path)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )

    def make_report(self, name, evaluation_args):
        evaluated = self.run_node(EVALUATOR, [str(self.receipt_path), *evaluation_args])
        self.assertEqual(evaluated.returncode, 0, evaluated.stderr)
        report_path = self.directory / (name + ".json")
        report_path.write_text(evaluated.stdout, encoding="utf-8")
        return report_path, json.loads(evaluated.stdout)

    def test_single_and_range_reports_match_node_receipts_and_are_deterministic(self):
        scenarios = [
            ("single", ["17"], 1),
            ("range", ["--range", "-3", "3"], 7),
            ("minimum-input", ["-1000000"], 1),
            ("maximum-input", ["1000000"], 1),
            ("lower-edge-range", ["--range", "-1000000", "-999999"], 2),
            ("upper-edge-range", ["--range", "999999", "1000000"], 2),
        ]
        for name, arguments, expected_count in scenarios:
            with self.subTest(name=name):
                report_path, report = self.make_report(name, arguments)
                node = self.run_node(EVALUATOR, ["--verify-report", str(self.receipt_path), str(report_path)])
                python_first = self.run_verifier(report_path)
                python_second = self.run_verifier(report_path)
                self.assertEqual(node.returncode, 0, node.stderr)
                self.assertEqual(python_first.returncode, 0, python_first.stderr)
                self.assertEqual(python_second.returncode, 0, python_second.stderr)
                self.assertEqual(python_first.stdout, python_second.stdout)

                node_receipt = json.loads(node.stdout)
                independent = json.loads(python_first.stdout)
                self.assertEqual(independent["schema"], "ngl.candidate-program-independent-verification.v1")
                self.assertEqual(independent["reportSchema"], report["schema"])
                self.assertEqual(independent["evaluationCount"], expected_count)
                self.assertEqual(independent["implementationHash"], node_receipt["implementationHash"])
                self.assertEqual(independent["reportDigest"], node_receipt["reportDigest"])
                self.assertEqual(independent["resultDigest"], node_receipt["resultDigest"])
                self.assertEqual(independent["verificationMethod"], "python-stdlib-independent-ast-and-polynomial-replay")
                self.assertIs(independent["verified"], True)
                self.assertEqual(independent["authority"], {
                    "taskSpecificationSignatureVerified": False,
                    "founderInstallApprovalVerified": False,
                    "capabilityInstalled": False,
                    "canonicalStateChanged": False,
                })

    def test_rejects_report_tampering_and_context_substitution(self):
        _, original = self.make_report("range-original", ["--range", "-3", "3"])
        cases = [
            ("changed output", "EVALUATION_REPORT_MISMATCH", lambda value: value["evaluations"][0].__setitem__("output", value["evaluations"][0]["output"] + 1)),
            ("wrong task context", "EVALUATION_REPORT_CONTEXT_MISMATCH", lambda value: value.__setitem__("taskSpecificationDigest", "0" * 64)),
            ("forged authority", "EVALUATION_REPORT_AUTHORITY_INVALID", lambda value: value["authority"].__setitem__("capabilityInstalled", True)),
            ("incomplete range", "EVALUATION_REPORT_RANGE_INVALID", lambda value: value["evaluations"].pop()),
            ("noncontiguous row", "EVALUATION_REPORT_RANGE_INVALID", lambda value: value["evaluations"][1].__setitem__("input", value["evaluations"][1]["input"] + 1)),
            ("changed result digest", "EVALUATION_REPORT_DIGEST_MISMATCH", lambda value: value.__setitem__("resultDigest", "0" * 64)),
            ("unexpected field", "EVALUATION_REPORT_INVALID", lambda value: value.__setitem__("untrustedFounderApproval", True)),
        ]
        for index, (name, code, mutate) in enumerate(cases):
            with self.subTest(name=name):
                altered = json.loads(json.dumps(original))
                mutate(altered)
                path = self.directory / ("tampered-" + str(index) + ".json")
                path.write_text(json.dumps(altered), encoding="utf-8")
                result = self.run_verifier(path)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn(code, result.stderr)
                self.assertEqual(result.stdout, "")

    def test_boolean_is_not_accepted_as_an_integer_output(self):
        report_path, _ = self.make_report("single-zero", ["1"])
        report = json.loads(report_path.read_text(encoding="utf-8"))
        self.assertEqual(report["output"], 0)
        report["output"] = False
        report_path.write_text(json.dumps(report), encoding="utf-8")
        result = self.run_verifier(report_path)
        self.assertEqual(result.returncode, 1)
        self.assertIn("EVALUATION_REPORT_MISMATCH", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_rejects_duplicate_json_keys_before_replay(self):
        report_path, report = self.make_report("duplicate", ["--range", "-3", "3"])
        source = report_path.read_text(encoding="utf-8")
        marker = '"schema": "ngl.candidate-program-evaluation-range.v1"'
        self.assertIn(marker, source)
        report_path.write_text(source.replace(marker, '"schema": "untrusted",\n  ' + marker, 1), encoding="utf-8")
        result = self.run_verifier(report_path)
        self.assertEqual(result.returncode, 1)
        self.assertIn("EVALUATION_REPORT_DUPLICATE_JSON_KEY", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_rejects_tampered_synthesis_proof(self):
        altered = json.loads(json.dumps(self.receipt))
        altered["proof"]["matchesTask"] = False
        path = self.directory / "tampered-receipt.json"
        path.write_text(json.dumps(altered), encoding="utf-8")
        report_path, _ = self.make_report("valid-for-tampered-receipt", ["17"])
        result = self.run_verifier(report_path, path)
        self.assertEqual(result.returncode, 1)
        self.assertIn("SYNTHESIS_PROOF_MISMATCH", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_rejects_symlink_and_oversized_report_files(self):
        report_path, _ = self.make_report("symlink-target", ["17"])
        link_path = self.directory / "report-link.json"
        try:
            link_path.symlink_to(report_path)
        except (OSError, NotImplementedError):
            self.skipTest("symbolic links are unavailable in this environment")
        linked = self.run_verifier(link_path)
        self.assertEqual(linked.returncode, 1)
        self.assertIn("EVALUATION_REPORT_NOT_REGULAR", linked.stderr)
        self.assertEqual(linked.stdout, "")

        oversized = self.directory / "oversized.json"
        oversized.write_text(" " * (2 * 1024 * 1024 + 1), encoding="utf-8")
        rejected = self.run_verifier(oversized)
        self.assertEqual(rejected.returncode, 1)
        self.assertIn("EVALUATION_REPORT_FILE_TOO_LARGE", rejected.stderr)
        self.assertEqual(rejected.stdout, "")

    def test_rejects_non_regular_invalid_utf8_and_excessively_deep_report_files(self):
        directory_report = self.directory / "report-directory"
        directory_report.mkdir()
        directory_result = self.run_verifier(directory_report)
        self.assertEqual(directory_result.returncode, 1)
        self.assertIn("EVALUATION_REPORT_NOT_REGULAR", directory_result.stderr)
        self.assertEqual(directory_result.stdout, "")

        invalid_utf8 = self.directory / "invalid-utf8.json"
        invalid_utf8.write_bytes(b"\xff")
        invalid_result = self.run_verifier(invalid_utf8)
        self.assertEqual(invalid_result.returncode, 1)
        self.assertIn("EVALUATION_REPORT_INVALID_UTF8", invalid_result.stderr)
        self.assertEqual(invalid_result.stdout, "")

        deep_report = self.directory / "deep-report.json"
        deep_report.write_text("[" * 17 + "0" + "]" * 17, encoding="utf-8")
        deep_result = self.run_verifier(deep_report)
        self.assertEqual(deep_result.returncode, 1)
        self.assertIn("EVALUATION_REPORT_JSON_TOO_DEEP", deep_result.stderr)
        self.assertEqual(deep_result.stdout, "")

        if hasattr(os, "mkfifo"):
            fifo_report = self.directory / "fifo-report.json"
            os.mkfifo(fifo_report)
            fifo_result = self.run_verifier(fifo_report)
            self.assertEqual(fifo_result.returncode, 1)
            self.assertIn("EVALUATION_REPORT_NOT_REGULAR", fifo_result.stderr)
            self.assertEqual(fifo_result.stdout, "")

    def test_duplicate_receipt_keys_and_bad_cli_arguments_fail_closed(self):
        report_path, _ = self.make_report("valid", ["17"])
        source = self.receipt_path.read_text(encoding="utf-8")
        marker = '"schema": "ngl.candidate-program-synthesis.v1"'
        duplicate_receipt = self.directory / "duplicate-receipt.json"
        duplicate_receipt.write_text(source.replace(marker, '"schema": "untrusted",\n  ' + marker, 1), encoding="utf-8")
        rejected = self.run_verifier(report_path, duplicate_receipt)
        self.assertEqual(rejected.returncode, 1)
        self.assertIn("SYNTHESIS_RECEIPT_DUPLICATE_JSON_KEY", rejected.stderr)
        self.assertEqual(rejected.stdout, "")

        usage = subprocess.run(
            [sys.executable, str(VERIFIER)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        self.assertEqual(usage.returncode, 2)
        self.assertRegex(usage.stderr, re.compile(r"^Usage:"))
        self.assertEqual(usage.stdout, "")


if __name__ == "__main__":
    unittest.main(verbosity=2)
