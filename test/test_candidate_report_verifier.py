import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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

    def decimalize_numeric_fields(self, source, fields, exponent_fields=()):
        names = "|".join(re.escape(name) for name in sorted(fields))
        pattern = re.compile(
            r'(?P<prefix>"(?P<key>' + names +
            r')"\s*:\s*)(?P<value>-?(?:0|[1-9][0-9]*))(?=\s*[,}])'
        )

        def spell(match):
            suffix = "e0" if match.group("key") in exponent_fields else ".0"
            return match.group("prefix") + match.group("value") + suffix

        return pattern.sub(spell, source)

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

    def test_integral_decimal_and_exponent_tokens_match_node_number_semantics(self):
        numeric_receipt = self.directory / "numeric-receipt.json"
        receipt_source = self.receipt_path.read_text(encoding="utf-8")
        numeric_receipt.write_text(
            self.decimalize_numeric_fields(
                receipt_source,
                {
                    "inputMin", "inputMax", "maxAstDepth", "maxAstNodes",
                    "maxPolynomialDegree", "maxCoefficientBits", "maxSafeInteger", "value",
                },
                exponent_fields={"maxSafeInteger", "value"},
            ),
            encoding="utf-8",
        )

        single_path = None
        for name, arguments in (
            ("single", ["17"]),
            ("range", ["--range", "-3", "3"]),
        ):
            with self.subTest(name=name):
                report_path, _ = self.make_report("numeric-" + name, arguments)
                report_path.write_text(
                    self.decimalize_numeric_fields(
                        report_path.read_text(encoding="utf-8"),
                        {"start", "end", "evaluationCount", "input", "output"},
                        exponent_fields={"end", "output"},
                    ),
                    encoding="utf-8",
                )
                node = self.run_node(
                    EVALUATOR,
                    ["--verify-report", str(numeric_receipt), str(report_path)],
                )
                independent = self.run_verifier(report_path, numeric_receipt)
                self.assertEqual(node.returncode, 0, node.stderr)
                self.assertEqual(independent.returncode, 0, independent.stderr)
                node_receipt = json.loads(node.stdout)
                python_receipt = json.loads(independent.stdout)
                self.assertEqual(python_receipt["implementationHash"], node_receipt["implementationHash"])
                self.assertEqual(python_receipt["reportDigest"], node_receipt["reportDigest"])
                self.assertEqual(python_receipt["resultDigest"], node_receipt["resultDigest"])
                if name == "single":
                    single_path = report_path

        self.assertIsNotNone(single_path)
        invalid_path = self.directory / "nonintegral-number.json"
        original_source = single_path.read_text(encoding="utf-8")
        invalid_source = original_source.replace('"input": 17.0', '"input": 17.5', 1)
        self.assertNotEqual(invalid_source, original_source)
        invalid_path.write_text(invalid_source, encoding="utf-8")
        node_invalid = self.run_node(
            EVALUATOR,
            ["--verify-report", str(numeric_receipt), str(invalid_path)],
        )
        python_invalid = self.run_verifier(invalid_path, numeric_receipt)
        self.assertEqual(node_invalid.returncode, 1)
        self.assertIn("EVALUATION_REPORT_INPUT_INVALID", node_invalid.stderr)
        self.assertEqual(python_invalid.returncode, 1)
        self.assertIn("EVALUATION_REPORT_INPUT_INVALID", python_invalid.stderr)
        self.assertEqual(node_invalid.stdout, "")
        self.assertEqual(python_invalid.stdout, "")

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

    def test_rejects_report_path_replacement_before_open_and_after_read(self):
        module_spec = importlib.util.spec_from_file_location("candidate_report_verifier_under_test", VERIFIER)
        module = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(module)

        for phase, trigger_count in (("before-open", 2), ("after-read", 3)):
            with self.subTest(phase=phase):
                target = self.directory / (phase + "-target.json")
                replacement = self.directory / (phase + "-replacement.json")
                target.write_bytes(b"original report bytes")
                replacement.write_bytes(b"replacement report bytes")
                swapped = False

                if module.DIRECTORY_FD_WALK_SUPPORTED:
                    original_open = os.open
                    original_stat = os.stat
                    final_stat_count = 0

                    def replace_at_open(path, flags, mode=0o777, *, dir_fd=None):
                        nonlocal swapped
                        if (
                            phase == "before-open"
                            and path == target.name
                            and dir_fd is not None
                            and not swapped
                        ):
                            os.replace(replacement, target)
                            swapped = True
                        if dir_fd is None:
                            return original_open(path, flags, mode)
                        return original_open(path, flags, mode, dir_fd=dir_fd)

                    def replace_at_stat(path, *args, **kwargs):
                        nonlocal final_stat_count, swapped
                        if path == target.name and kwargs.get("dir_fd") is not None:
                            final_stat_count += 1
                            if phase == "after-read" and final_stat_count == 2 and not swapped:
                                os.replace(replacement, target)
                                swapped = True
                        return original_stat(path, *args, **kwargs)

                    with patch.object(module.os, "open", side_effect=replace_at_open), patch.object(module.os, "stat", side_effect=replace_at_stat):
                        with self.assertRaises(module.VerificationError) as rejected:
                            module.read_bounded_regular_file(target, 1024, "EVALUATION_REPORT")
                else:
                    absolute_target = target.absolute()
                    original_lstat = os.lstat
                    target_lstat_count = 0

                    def replace_at_boundary(path):
                        nonlocal target_lstat_count, swapped
                        is_target = Path(path) == absolute_target
                        if is_target:
                            target_lstat_count += 1
                            if target_lstat_count == trigger_count and phase == "after-read" and not swapped:
                                os.replace(replacement, target)
                                swapped = True
                        metadata = original_lstat(path)
                        if is_target and target_lstat_count == trigger_count and phase == "before-open" and not swapped:
                            os.replace(replacement, target)
                            swapped = True
                        return metadata

                    with patch.object(module.os, "lstat", side_effect=replace_at_boundary):
                        with self.assertRaises(module.VerificationError) as rejected:
                            module.read_bounded_regular_file(target, 1024, "EVALUATION_REPORT")

                self.assertTrue(swapped, "the fixture must replace the path at the selected read boundary")
                self.assertEqual(str(rejected.exception), "EVALUATION_REPORT_CHANGED_DURING_READ")

    def test_parent_directory_symlink_swap_before_open_cannot_redirect_read(self):
        if not (
            os.name == "posix"
            and os.open in os.supports_dir_fd
            and os.stat in os.supports_dir_fd
            and os.stat in os.supports_follow_symlinks
            and hasattr(os, "O_DIRECTORY")
            and hasattr(os, "O_NOFOLLOW")
        ):
            self.skipTest("directory-descriptor no-follow traversal is unavailable")

        module_spec = importlib.util.spec_from_file_location("candidate_report_verifier_parent_race_before", VERIFIER)
        module = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(module)

        with tempfile.TemporaryDirectory(prefix="ngl-parent-race-root-") as root_name, tempfile.TemporaryDirectory(prefix="ngl-parent-race-outside-") as outside_name:
            root = Path(root_name)
            outside = Path(outside_name)
            parent = root / "reports"
            parent.mkdir()
            target = parent / "report.json"
            target.write_text("inside", encoding="utf-8")
            (outside / "report.json").write_text("outside-secret", encoding="utf-8")
            moved = root / "reports-original"
            original_open = os.open
            original_lstat = os.lstat
            swapped = False

            def swap_parent():
                nonlocal swapped
                os.replace(parent, moved)
                try:
                    os.symlink(outside, parent, target_is_directory=True)
                except OSError as error:
                    self.skipTest("directory symlinks are unavailable: " + str(error))
                swapped = True

            def replace_after_parent_lstat(path):
                metadata = original_lstat(path)
                if Path(path) == parent.absolute() and not swapped:
                    swap_parent()
                return metadata

            def replace_before_open(path, flags, mode=0o777, *, dir_fd=None):
                if not swapped and (
                    (path == "reports" and dir_fd is not None)
                    or (Path(path) == target.absolute() and dir_fd is None)
                ):
                    swap_parent()
                if dir_fd is None:
                    return original_open(path, flags, mode)
                return original_open(path, flags, mode, dir_fd=dir_fd)

            with patch.object(module.os, "lstat", side_effect=replace_after_parent_lstat), patch.object(module.os, "open", side_effect=replace_before_open):
                with self.assertRaises(module.VerificationError) as rejected:
                    module.read_bounded_regular_file(target, 1024, "EVALUATION_REPORT")

            self.assertTrue(swapped, "the parent must be replaced at the selected open boundary")
            self.assertEqual(str(rejected.exception), "EVALUATION_REPORT_NOT_REGULAR")

    def test_parent_directory_symlink_swap_after_open_keeps_read_pinned(self):
        if not (
            os.name == "posix"
            and os.open in os.supports_dir_fd
            and os.stat in os.supports_dir_fd
            and os.stat in os.supports_follow_symlinks
            and hasattr(os, "O_DIRECTORY")
            and hasattr(os, "O_NOFOLLOW")
        ):
            self.skipTest("directory-descriptor no-follow traversal is unavailable")

        module_spec = importlib.util.spec_from_file_location("candidate_report_verifier_parent_race_after", VERIFIER)
        module = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(module)

        with tempfile.TemporaryDirectory(prefix="ngl-parent-race-root-") as root_name, tempfile.TemporaryDirectory(prefix="ngl-parent-race-outside-") as outside_name:
            root = Path(root_name)
            outside = Path(outside_name)
            parent = root / "reports"
            parent.mkdir()
            target = parent / "report.json"
            target.write_text("inside", encoding="utf-8")
            (outside / "report.json").write_text("outside-secret", encoding="utf-8")
            moved = root / "reports-original"
            original_open = os.open
            original_lstat = os.lstat
            swapped = False

            def swap_parent():
                nonlocal swapped
                os.replace(parent, moved)
                try:
                    os.symlink(outside, parent, target_is_directory=True)
                except OSError as error:
                    self.skipTest("directory symlinks are unavailable: " + str(error))
                swapped = True

            def replace_after_parent_lstat(path):
                metadata = original_lstat(path)
                if Path(path) == parent.absolute() and not swapped:
                    swap_parent()
                return metadata

            def replace_after_open(path, flags, mode=0o777, *, dir_fd=None):
                if path == "reports" and dir_fd is not None and not swapped:
                    descriptor = original_open(path, flags, mode, dir_fd=dir_fd)
                    swap_parent()
                    return descriptor
                if Path(path) == target.absolute() and dir_fd is None and not swapped:
                    swap_parent()
                if dir_fd is None:
                    return original_open(path, flags, mode)
                return original_open(path, flags, mode, dir_fd=dir_fd)

            with patch.object(module.os, "lstat", side_effect=replace_after_parent_lstat), patch.object(module.os, "open", side_effect=replace_after_open):
                source = module.read_bounded_regular_file(target, 1024, "EVALUATION_REPORT")

            self.assertTrue(swapped, "the parent must be replaced after its directory descriptor is opened")
            self.assertEqual(source, "inside", "the opened parent descriptor must not be redirected through the replacement symlink")

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
