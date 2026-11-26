import json
import multiprocessing
import os
from queue import Empty
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import gate_runner
import ngl


def _append_after_barrier(ledger_path, barrier, queue, index):
    try:
        barrier.wait(timeout=10)
        entry = ngl.append_event(Path(ledger_path), f"worker-{index}", "CONCURRENT", "ARTIFACT_OBSERVED", {"worker": index})
        queue.put(("ok", entry["seq"]))
    except Exception as exc:
        queue.put(("error", repr(exc)))


def _verify_after_lock(ledger_path, expected_head, started, queue):
    started.set()
    queue.put(ngl.verify_chain(Path(ledger_path), expected_head=expected_head)["status"])


def _closure_after_lock(ledger_path, expected_head, scheduler_path, pay_path, started, queue):
    started.set()
    result = ngl._closure(
        Path(ledger_path), expected_head, None, Path(scheduler_path), "S0", Path(pay_path)
    )
    queue.put(result["decision"])


def _shared_reader_barrier(ledger_path, barrier, queue, index):
    try:
        with ngl._ledger_lock(Path(ledger_path), exclusive=False):
            barrier.wait(timeout=5)
            queue.put(("ok", index))
    except Exception as exc:
        queue.put(("error", repr(exc)))


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


POSIX_FLOCK_AND_FORK = ngl.fcntl is not None and hasattr(ngl.os, "O_NOFOLLOW") and "fork" in multiprocessing.get_all_start_methods()


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

    @unittest.skipUnless(POSIX_FLOCK_AND_FORK, "requires POSIX flock and fork multiprocessing")
    def test_verifier_waits_for_exclusive_writer_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = Path(tmp) / "mission.jsonl"
            entry = ngl.append_event(ledger, "test", "EVENT", "USER_STATED", {})
            context = multiprocessing.get_context("fork")
            queue = context.Queue()
            started = context.Event()
            with ngl._ledger_lock(ledger, exclusive=True):
                worker = context.Process(target=_verify_after_lock, args=(str(ledger), entry["entry_hash"], started, queue))
                worker.start()
                self.assertTrue(started.wait(timeout=2))
                with self.assertRaises(Empty):
                    queue.get(timeout=0.2)
            worker.join(timeout=5)
            self.assertEqual(worker.exitcode, 0)
            self.assertEqual(queue.get(timeout=2), "CHAIN_INTACT")

    @unittest.skipUnless(POSIX_FLOCK_AND_FORK, "requires POSIX flock and fork multiprocessing")
    def test_closure_verifies_and_reads_terminal_event_under_one_shared_snapshot_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ledger = root / "mission.jsonl"
            ngl.append_event(ledger, "mppt", "GATE_EVALUATION", "EXECUTION_OBSERVED", {"decision": "completed"})
            head = ngl._verify_internal(ledger)["head_hash"]
            scheduler = root / "scheduler.json"
            scheduler.write_text(json.dumps({"ready": True, "owner": "worker-a", "blockers": []}), encoding="utf-8")
            pay = root / "pay.json"
            pay.write_text(json.dumps({"artifact_sha256": "a" * 64}), encoding="utf-8")
            context = multiprocessing.get_context("fork")
            queue = context.Queue()
            started = context.Event()
            with ngl._ledger_lock(ledger, exclusive=True):
                worker = context.Process(target=_closure_after_lock, args=(str(ledger), head, str(scheduler), str(pay), started, queue))
                worker.start()
                self.assertTrue(started.wait(timeout=2))
                with self.assertRaises(Empty):
                    queue.get(timeout=0.2)
            worker.join(timeout=5)
            self.assertEqual(worker.exitcode, 0)
            self.assertEqual(queue.get(timeout=2), "completed")

    @unittest.skipUnless(POSIX_FLOCK_AND_FORK, "requires POSIX flock and fork multiprocessing")
    def test_shared_reader_locks_allow_concurrent_readers(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = Path(tmp) / "mission.jsonl"
            context = multiprocessing.get_context("fork")
            barrier = context.Barrier(2)
            queue = context.Queue()
            workers = [
                context.Process(target=_shared_reader_barrier, args=(str(ledger), barrier, queue, index))
                for index in range(2)
            ]
            for worker in workers:
                worker.start()
            for worker in workers:
                worker.join(timeout=8)
            for worker in workers:
                if worker.is_alive():
                    worker.terminate()
                    worker.join()
            self.assertTrue(all(worker.exitcode == 0 for worker in workers))
            results = [queue.get(timeout=2) for _ in workers]
            self.assertEqual(sorted(results), [("ok", 0), ("ok", 1)])

    def test_missing_posix_flock_fails_ledger_operations_without_breaking_module_import(self):
        original = ngl.fcntl
        try:
            ngl.fcntl = None
            with tempfile.TemporaryDirectory() as tmp:
                with self.assertRaisesRegex(OSError, "requires POSIX fcntl.flock"):
                    ngl.append_event(Path(tmp) / "mission.jsonl", "test", "EVENT", "USER_STATED", {})
                # The independent gate evaluator remains importable and usable.
                root = Path(tmp)
                (root / "present.txt").write_text("available", encoding="utf-8")
                result = gate_runner.evaluate_gate({"checks": [{"id": "present", "type": "file_exists", "path": "present.txt", "weight": 100}]}, root)
                self.assertEqual(result["decision"], "completed")
        finally:
            ngl.fcntl = original

    @unittest.skipUnless(POSIX_FLOCK_AND_FORK, "requires POSIX flock, O_NOFOLLOW, and fork multiprocessing")
    def test_symlinked_lock_path_is_rejected_without_touching_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ledger = root / "mission.jsonl"
            target = root / "unrelated.txt"
            target.write_text("preserve", encoding="utf-8")
            (root / "mission.jsonl.lock").symlink_to(target)
            with self.assertRaises(OSError):
                ngl.append_event(ledger, "test", "EVENT", "USER_STATED", {})
            self.assertEqual(target.read_text(encoding="utf-8"), "preserve")
            self.assertFalse(ledger.exists())

    @unittest.skipUnless(POSIX_FLOCK_AND_FORK, "requires POSIX flock, O_NOFOLLOW, and fork multiprocessing")
    def test_group_or_world_accessible_lock_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ledger = root / "mission.jsonl"
            lock = root / "mission.jsonl.lock"
            lock.write_text("", encoding="utf-8")
            lock.chmod(0o666)
            with self.assertRaisesRegex(OSError, "permissions"):
                ngl.append_event(ledger, "test", "EVENT", "USER_STATED", {})
            self.assertFalse(ledger.exists())

    @unittest.skipUnless(POSIX_FLOCK_AND_FORK, "requires POSIX flock and fork multiprocessing")
    def test_lock_file_owned_by_another_uid_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ledger = root / "mission.jsonl"
            lock = root / "mission.jsonl.lock"
            lock.write_text("", encoding="utf-8")
            lock.chmod(0o600)
            current_uid = os.getuid()
            with patch.object(ngl, "_validate_ledger_directory"), \
                 patch.object(ngl.os, "getuid", return_value=current_uid + 1):
                with self.assertRaisesRegex(OSError, "not owned by the current user"):
                    ngl.append_event(ledger, "test", "EVENT", "USER_STATED", {})
            self.assertFalse(ledger.exists())

    @unittest.skipUnless(POSIX_FLOCK_AND_FORK, "requires POSIX flock, O_NOFOLLOW, and fork multiprocessing")
    def test_hard_linked_lock_file_is_rejected_without_touching_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ledger = root / "mission.jsonl"
            target = root / "unrelated.txt"
            target.write_text("preserve", encoding="utf-8")
            target.chmod(0o600)
            os.link(target, root / "mission.jsonl.lock")
            with self.assertRaisesRegex(OSError, "hard-link aliases"):
                ngl.append_event(ledger, "test", "EVENT", "USER_STATED", {})
            self.assertEqual(target.read_text(encoding="utf-8"), "preserve")
            self.assertFalse(ledger.exists())

    @unittest.skipUnless(POSIX_FLOCK_AND_FORK, "requires POSIX flock and O_NOFOLLOW")
    def test_symlinked_ledger_is_rejected_for_append_and_verify(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "unrelated.jsonl"
            target.write_text("preserve\\n", encoding="utf-8")
            ledger = root / "mission.jsonl"
            ledger.symlink_to(target)
            with self.assertRaises(OSError):
                ngl.append_event(ledger, "test", "EVENT", "USER_STATED", {})
            self.assertEqual(ngl.verify_chain(ledger, expected_head="0" * 64)["status"], "TAMPER_DETECTED")
            self.assertEqual(target.read_text(encoding="utf-8"), "preserve\\n")

    @unittest.skipUnless(POSIX_FLOCK_AND_FORK, "requires POSIX flock and O_NOFOLLOW")
    def test_hard_linked_ledger_is_rejected_without_touching_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "unrelated.jsonl"
            target.write_text("", encoding="utf-8")
            ledger = root / "mission.jsonl"
            os.link(target, ledger)
            with self.assertRaises(OSError):
                ngl.append_event(ledger, "test", "EVENT", "USER_STATED", {})
            self.assertEqual(target.read_text(encoding="utf-8"), "")
            self.assertEqual(ngl._verify_internal(ledger)["status"], "TAMPER_DETECTED")


    def test_concurrent_process_appends_preserve_one_contiguous_hash_chain(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = Path(tmp) / "mission.jsonl"
            context = multiprocessing.get_context("fork")
            count = 8
            barrier = context.Barrier(count)
            queue = context.Queue()
            workers = [
                context.Process(target=_append_after_barrier, args=(str(ledger), barrier, queue, index))
                for index in range(count)
            ]
            for worker in workers:
                worker.start()
            for worker in workers:
                worker.join(timeout=15)
            for worker in workers:
                if worker.is_alive():
                    worker.terminate()
                    worker.join()
            self.assertTrue(all(worker.exitcode == 0 for worker in workers))
            results = [queue.get(timeout=3) for _ in range(count)]
            self.assertTrue(all(result[0] == "ok" for result in results), results)
            self.assertEqual(sorted(result[1] for result in results), list(range(count)))
            verified = ngl._verify_internal(ledger)
            self.assertEqual(verified["status"], "CHAIN_INTACT")
            self.assertEqual(verified["count"], count)

    @unittest.skipUnless(POSIX_FLOCK_AND_FORK, "requires POSIX flock and O_NOFOLLOW")
    def test_lock_descriptor_is_closed_when_unlock_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = Path(tmp) / "mission.jsonl"
            real_close = os.close
            real_directory = ngl._open_ledger_directory
            directory_fds = []
            lock_fds = []

            def tracked_directory(*args, **kwargs):
                fd = real_directory(*args, **kwargs)
                directory_fds.append(fd)
                return fd

            def fail_unlock(fd, operation):
                if operation == ngl.fcntl.LOCK_UN:
                    lock_fds.append(fd)
                    raise OSError("injected unlock failure")

            with patch.object(ngl, "_open_ledger_directory", side_effect=tracked_directory), \
                 patch.object(ngl.fcntl, "flock", side_effect=fail_unlock), \
                 patch.object(ngl.os, "close", wraps=real_close) as close_spy:
                with self.assertRaisesRegex(OSError, "injected unlock failure"):
                    with ngl._ledger_lock(ledger, exclusive=True):
                        pass
                self.assertEqual(len(directory_fds), 1)
                self.assertEqual(len(lock_fds), 1)
                self.assertGreaterEqual(close_spy.call_count, 2)
                for fd in directory_fds + lock_fds:
                    with self.assertRaises(OSError):
                        os.fstat(fd)

    @unittest.skipUnless(POSIX_FLOCK_AND_FORK, "requires POSIX flock and O_NOFOLLOW")
    def test_lock_descriptor_is_closed_when_lock_acquisition_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = Path(tmp) / "mission.jsonl"
            real_close = os.close
            real_directory = ngl._open_ledger_directory
            directory_fds = []
            lock_fds = []

            def tracked_directory(*args, **kwargs):
                fd = real_directory(*args, **kwargs)
                directory_fds.append(fd)
                return fd

            def fail_acquire(fd, operation):
                lock_fds.append(fd)
                raise OSError("injected lock acquisition failure")

            with patch.object(ngl, "_open_ledger_directory", side_effect=tracked_directory), \
                 patch.object(ngl.fcntl, "flock", side_effect=fail_acquire), \
                 patch.object(ngl.os, "close", wraps=real_close) as close_spy:
                with self.assertRaisesRegex(OSError, "injected lock acquisition failure"):
                    with ngl._ledger_lock(ledger, exclusive=True):
                        pass
                self.assertEqual(len(directory_fds), 1)
                self.assertEqual(len(lock_fds), 1)
                self.assertGreaterEqual(close_spy.call_count, 2)
                for fd in directory_fds + lock_fds:
                    with self.assertRaises(OSError):
                        os.fstat(fd)

    def test_writer_lock_is_released_when_serialization_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            ledger = Path(tmp) / "mission.jsonl"
            with self.assertRaises(TypeError):
                ngl.append_event(ledger, "test", "BAD", "ARTIFACT_OBSERVED", {"not_json": object()})
            entry = ngl.append_event(ledger, "test", "GOOD", "ARTIFACT_OBSERVED", {"ok": True})
            self.assertEqual(entry["seq"], 0)
            self.assertEqual(ngl._verify_internal(ledger)["status"], "CHAIN_INTACT")


    @unittest.skipUnless(
        ngl.fcntl is not None
        and hasattr(os, "O_DIRECTORY")
        and hasattr(os, "O_NOFOLLOW")
        and os.open in os.supports_dir_fd
        and os.mkdir in os.supports_dir_fd,
        "requires POSIX directory-descriptor and no-follow support",
    )
    def test_symlinked_ledger_parent_is_rejected_without_creating_entries(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "real"
            target.mkdir()
            alias = root / "alias"
            alias.symlink_to(target, target_is_directory=True)
            ledger = alias / "mission.jsonl"

            with self.assertRaises(OSError):
                ngl.append_event(ledger, "test", "EVENT", "USER_STATED", {})

            self.assertFalse((target / "mission.jsonl.lock").exists())
            self.assertFalse((target / "mission.jsonl").exists())

    @unittest.skipUnless(
        ngl.fcntl is not None
        and hasattr(os, "O_DIRECTORY")
        and hasattr(os, "O_NOFOLLOW")
        and os.open in os.supports_dir_fd
        and os.mkdir in os.supports_dir_fd,
        "requires POSIX directory-descriptor and no-follow support",
    )
    def test_group_or_world_writable_nonsticky_ledger_parent_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp) / "shared"
            parent.mkdir()
            parent.chmod(0o777)
            ledger = parent / "mission.jsonl"

            try:
                with self.assertRaisesRegex(OSError, "group/world writable"):
                    ngl.append_event(ledger, "test", "EVENT", "USER_STATED", {})
                self.assertFalse((parent / "mission.jsonl.lock").exists())
                self.assertFalse(ledger.exists())
            finally:
                parent.chmod(0o700)

    @unittest.skipUnless(
        ngl.fcntl is not None
        and hasattr(os, "O_DIRECTORY")
        and hasattr(os, "O_NOFOLLOW")
        and os.open in os.supports_dir_fd
        and os.mkdir in os.supports_dir_fd,
        "requires POSIX directory-descriptor and no-follow support",
    )
    def test_parent_path_with_dotdot_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            nested = root / "nested"
            nested.mkdir()
            ledger = nested / ".." / "mission.jsonl"

            with self.assertRaisesRegex(OSError, "must not contain '..'"):
                ngl.append_event(ledger, "test", "EVENT", "USER_STATED", {})

            self.assertFalse((root / "mission.jsonl.lock").exists())
            self.assertFalse((root / "mission.jsonl").exists())


if __name__ == "__main__":
    unittest.main()
