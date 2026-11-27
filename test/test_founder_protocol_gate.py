import unittest

from scripts.founder_protocol_gate import (
    RELAY_PATH,
    REQUIRED_SECTIONS,
    evaluate_pull_request,
)


class FounderPullRequestGateTests(unittest.TestCase):
    def setUp(self):
        self.pull = {
            "created_at": "2026-11-28T00:00:01Z",
            "body": "\n".join(REQUIRED_SECTIONS),
        }
        self.paths = [RELAY_PATH, "src/example.mjs"]

    def test_complete_new_pr_record_and_relay_pass(self):
        result = evaluate_pull_request(self.pull, self.paths)
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["failures"], [])

    def test_missing_founder_facing_sections_fail_closed(self):
        pull = dict(self.pull, body="## Summary\nSome code changed.")
        result = evaluate_pull_request(pull, self.paths)
        self.assertEqual(result["status"], "fail")
        self.assertEqual(len(result["missing_sections"]), len(REQUIRED_SECTIONS))
        self.assertTrue(any("missing required Founder-facing sections" in item
                            for item in result["failures"]))

    def test_missing_relay_update_fails_closed(self):
        result = evaluate_pull_request(self.pull, ["src/example.mjs"])
        self.assertEqual(result["status"], "fail")
        self.assertTrue(any("continuity relay was not updated" in item
                            for item in result["failures"]))

    def test_missing_both_record_and_relay_reports_both_failures(self):
        pull = dict(self.pull, body="")
        result = evaluate_pull_request(pull, [])
        self.assertEqual(result["status"], "fail")
        self.assertEqual(len(result["failures"]), 2)

    def test_existing_pr_before_effective_date_is_grandfathered(self):
        pull = dict(self.pull, created_at="2026-11-27T23:59:59Z", body="")
        result = evaluate_pull_request(pull, [])
        self.assertEqual(result["status"], "grandfathered")
        self.assertEqual(result["failures"], [])

    def test_missing_or_timezone_free_created_at_fails_closed(self):
        for value in (None, "", "2026-11-28T00:00:00"):
            with self.subTest(value=value):
                pull = dict(self.pull, created_at=value)
                result = evaluate_pull_request(pull, self.paths)
                self.assertEqual(result["status"], "fail")


if __name__ == "__main__":
    unittest.main()
