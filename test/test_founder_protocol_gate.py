import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.founder_protocol_gate import (
    RELAY_PATH, REQUIRED_SECTIONS, evaluate_pull_request,
    missing_or_empty_sections, relay_history_is_append_only,
)


class FounderPullRequestGateTests(unittest.TestCase):
    def setUp(self):
        self.pull = {
            "created_at": "2026-11-28T00:00:01Z",
            "body": "\n\n".join(
                heading + "\nSubstantive evidence-backed content."
                for heading in REQUIRED_SECTIONS
            ),
        }
        self.paths = [RELAY_PATH, "src/example.mjs"]

    def test_complete_new_pr_record_and_relay_pass(self):
        result = evaluate_pull_request(self.pull, self.paths, relay_history_valid=True)
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["failures"], [])

    def test_relay_history_evidence_is_required_fail_closed(self):
        result = evaluate_pull_request(self.pull, self.paths)
        self.assertEqual(result["status"], "fail")
        self.assertTrue(any("preserve all base bytes" in item for item in result["failures"]))

    def test_missing_founder_facing_sections_fail_closed(self):
        pull = dict(self.pull, body="## Summary\nSome code changed.")
        result = evaluate_pull_request(pull, self.paths)
        self.assertEqual(result["status"], "fail")
        self.assertEqual(len(result["missing_sections"]), len(REQUIRED_SECTIONS))

    def test_empty_headings_fail_closed(self):
        body = "\n\n".join(REQUIRED_SECTIONS)
        result = evaluate_pull_request(dict(self.pull, body=body), self.paths)
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["missing_sections"], list(REQUIRED_SECTIONS))

    def test_whitespace_only_sections_fail_closed(self):
        body = "\n\n".join(heading + "\n  \t " for heading in REQUIRED_SECTIONS)
        self.assertEqual(missing_or_empty_sections(body), list(REQUIRED_SECTIONS))

    def test_html_comment_placeholder_is_not_substantive_content(self):
        body = "\n\n".join(heading + "\n<!-- TODO: fill this section -->" for heading in REQUIRED_SECTIONS)
        self.assertEqual(missing_or_empty_sections(body), list(REQUIRED_SECTIONS))

    def test_content_in_one_section_does_not_fill_the_next_section(self):
        body = REQUIRED_SECTIONS[0] + "\nOnly the first section has content.\n" + "\n".join(REQUIRED_SECTIONS[1:])
        self.assertEqual(missing_or_empty_sections(body), list(REQUIRED_SECTIONS[1:]))

    def test_placeholder_only_sections_fail_closed(self):
        placeholders = ("TODO", "TBD", "N/A", "None", "Pending", "Placeholder",
                        "TODO: fill this in", "- TBD", "> N/A")
        for placeholder in placeholders:
            with self.subTest(placeholder=placeholder):
                body = "\n\n".join(heading + "\n" + placeholder for heading in REQUIRED_SECTIONS)
                self.assertEqual(missing_or_empty_sections(body), list(REQUIRED_SECTIONS))

    def test_substantive_content_after_placeholder_is_accepted(self):
        body = "\n\n".join(
            heading + "\nTODO: replace this note.\nObserved exact-head test result: PASS."
            for heading in REQUIRED_SECTIONS
        )
        self.assertEqual(missing_or_empty_sections(body), [])

    def test_missing_relay_update_fails_closed(self):
        result = evaluate_pull_request(self.pull, ["src/example.mjs"])
        self.assertEqual(result["status"], "fail")

    def test_missing_both_record_and_relay_reports_both_failures(self):
        result = evaluate_pull_request(dict(self.pull, body=""), [])
        self.assertEqual(result["status"], "fail")
        self.assertEqual(len(result["failures"]), 2)

    def test_existing_pr_before_effective_date_is_grandfathered(self):
        pull = dict(self.pull, created_at="2026-11-27T23:59:59Z", body="")
        result = evaluate_pull_request(pull, [])
        self.assertEqual(result["status"], "grandfathered")

    def test_missing_or_timezone_free_created_at_fails_closed(self):
        for value in (None, "", "2026-11-28T00:00:00"):
            with self.subTest(value=value):
                result = evaluate_pull_request(dict(self.pull, created_at=value), self.paths)
                self.assertEqual(result["status"], "fail")

    def test_effective_date_boundary_uses_utc_instant_not_local_date(self):
        cases = (
            ("2026-11-27T17:59:59-06:00", "grandfathered"),
            ("2026-11-27T18:00:00-06:00", "fail"),
            ("2026-11-28T00:00:01Z", "fail"),
        )
        for created_at, expected in cases:
            with self.subTest(created_at=created_at):
                result = evaluate_pull_request(dict(self.pull, created_at=created_at), self.paths)
                self.assertEqual(result["status"], expected)

    def test_relay_initial_creation_requires_nonempty_content(self):
        self.assertTrue(relay_history_is_append_only(None, b"initial relay\n"))
        self.assertFalse(relay_history_is_append_only(None, b""))
        self.assertFalse(relay_history_is_append_only(None, None))

    def test_relay_true_append_preserves_all_previous_bytes(self):
        base = b"# Relay\nprior checkpoint\n"
        self.assertTrue(relay_history_is_append_only(base, base + b"next checkpoint\n"))

    def test_relay_truncation_and_rewrite_are_rejected(self):
        base = b"# Relay\nprior checkpoint\n"
        self.assertFalse(relay_history_is_append_only(base, base[:-1]))
        self.assertFalse(relay_history_is_append_only(base, b"# Relay\nreplacement\n"))
        self.assertFalse(relay_history_is_append_only(base, None))

    def test_relay_unchanged_content_is_not_an_append(self):
        base = b"# Relay\nprior checkpoint\n"
        self.assertFalse(relay_history_is_append_only(base, base))

    def test_changed_relay_path_fails_when_history_is_not_preserved(self):
        result = evaluate_pull_request(self.pull, self.paths, relay_history_valid=False)
        self.assertEqual(result["status"], "fail")

    def test_headings_inside_backtick_fence_do_not_satisfy_sections(self):
        fence = chr(96) * 3
        body = "\n".join([fence + "markdown"] +
                         [heading + "\nApparently complete evidence." for heading in REQUIRED_SECTIONS] +
                         [fence])
        self.assertEqual(missing_or_empty_sections(body), list(REQUIRED_SECTIONS))

    def test_headings_inside_tilde_fence_do_not_satisfy_sections(self):
        fence = "~" * 4
        body = "\n".join([fence + "md"] +
                         [heading + "\nApparently complete evidence." for heading in REQUIRED_SECTIONS] +
                         [fence])
        self.assertEqual(missing_or_empty_sections(body), list(REQUIRED_SECTIONS))

    def test_unclosed_fence_fails_closed_for_remaining_sections(self):
        body = REQUIRED_SECTIONS[0] + "\nReal first section.\n" + chr(96) * 3 + "markdown\n"
        body += "\n".join(heading + "\nFake evidence." for heading in REQUIRED_SECTIONS[1:])
        self.assertEqual(missing_or_empty_sections(body), list(REQUIRED_SECTIONS[1:]))

    def test_real_sections_with_fenced_examples_remain_valid(self):
        fence = chr(96) * 3
        body = "\n\n".join(
            heading + "\nActual evidence recorded here.\n" + fence +
            "text\n" + heading + "\nExample only.\n" + fence + "\n"
            for heading in REQUIRED_SECTIONS
        )
        self.assertEqual(missing_or_empty_sections(body), [])


if __name__ == "__main__":
    unittest.main()
