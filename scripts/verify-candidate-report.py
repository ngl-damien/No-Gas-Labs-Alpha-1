#!/usr/bin/env python3
"""Independent, read-only verifier for Experiment 001 candidate evaluation reports.

This is a separate Python implementation of the bounded AST and exact integer
polynomial checks. It does not verify signatures, establish Founder identity,
install capabilities, or mutate institutional state.
"""
import errno
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path

MAX_INPUT = 1_000_000
MAX_CONSTANT = 1_000_000
MAX_SAFE_INTEGER = 2**53 - 1
MAX_AST_DEPTH = 12
MAX_AST_NODES = 63
MAX_PROOF_DEGREE = 32
MAX_COEFFICIENT_BITS = 4096
MAX_RANGE_EVALUATIONS = 4096
MAX_RECEIPT_BYTES = 64 * 1024
MAX_REPORT_BYTES = 2 * 1024 * 1024
MAX_JSON_DEPTH = 16

LIMITS = {
    "maxAstDepth": MAX_AST_DEPTH,
    "maxAstNodes": MAX_AST_NODES,
    "maxPolynomialDegree": MAX_PROOF_DEGREE,
    "maxCoefficientBits": MAX_COEFFICIENT_BITS,
    "maxSafeInteger": MAX_SAFE_INTEGER,
}
AUTHORITY_KEYS = (
    "taskSpecificationSignatureVerified",
    "founderInstallApprovalVerified",
    "capabilityInstalled",
    "canonicalStateChanged",
)
AUTHORITY_FALSE = {key: False for key in AUTHORITY_KEYS}
RECEIPT_KEYS = {
    "schema", "taskSpecificationDigest", "taskSpecification", "program",
    "proof", "trust", "instruction",
}
SPEC_KEYS = {
    "schema", "id", "inputMin", "inputMax", "proofMethod", "limits",
    "targetCoefficients",
}
PROGRAM_BINARY = {"add", "subtract", "multiply", "min", "max"}
PROGRAM_UNARY = {"negate", "abs"}


class VerificationError(Exception):
    """A stable, machine-readable verification failure."""


def fail(code):
    raise VerificationError(code)


def require_exact_keys(value, expected, code):
    if not isinstance(value, dict) or set(value.keys()) != set(expected):
        fail(code)


def js_json(value):
    # All hashed normalized values use only canonical ASCII keys/strings and
    # integers, so compact insertion-ordered JSON matches JSON.stringify.
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def sha256_text(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def read_bounded_regular_file(path, limit, label):
    raw_path = os.fspath(path)
    if not isinstance(raw_path, str) or not raw_path or "\x00" in raw_path:
        fail(label + "_PATH_INVALID")
    absolute = Path(os.path.abspath(raw_path))
    parts = absolute.parts
    if len(parts) < 2:
        fail(label + "_NOT_REGULAR")

    # POSIX directory descriptors pin every parent component. O_NOFOLLOW on
    # the final file alone is insufficient: a parent can become a symlink
    # between lstat(path_component) and open(full_path).
    directory_fd_walk = (
        os.name == "posix"
        and os.open in os.supports_dir_fd
        and os.stat in os.supports_dir_fd
        and os.stat in os.supports_follow_symlinks
        and hasattr(os, "O_DIRECTORY")
        and hasattr(os, "O_NOFOLLOW")
    )
    directory_descriptors = []
    directory_descriptor = None
    descriptor = None

    try:
        if directory_fd_walk:
            directory_flags = (
                os.O_RDONLY
                | os.O_DIRECTORY
                | os.O_NOFOLLOW
                | getattr(os, "O_CLOEXEC", 0)
            )
            try:
                directory_descriptor = os.open(absolute.anchor, directory_flags)
                directory_descriptors.append(directory_descriptor)
                for part in parts[1:-1]:
                    try:
                        next_descriptor = os.open(
                            part, directory_flags, dir_fd=directory_descriptor
                        )
                    except OSError as error:
                        if error.errno in (errno.ELOOP, errno.ENOTDIR):
                            fail(label + "_NOT_REGULAR")
                        if error.errno == errno.ENOENT:
                            fail(label + "_NOT_FOUND")
                        raise
                    directory_descriptors.append(next_descriptor)
                    if not stat.S_ISDIR(os.fstat(next_descriptor).st_mode):
                        fail(label + "_NOT_REGULAR")
                    directory_descriptor = next_descriptor
            except VerificationError:
                raise
            except FileNotFoundError:
                fail(label + "_NOT_FOUND")
            except OSError as error:
                if error.errno in (errno.ELOOP, errno.ENOTDIR):
                    fail(label + "_NOT_REGULAR")
                if error.errno == errno.ENOENT:
                    fail(label + "_NOT_FOUND")
                fail(label + "_READ_FAILED")

            filename = parts[-1]
            try:
                before = os.stat(
                    filename, dir_fd=directory_descriptor, follow_symlinks=False
                )
            except FileNotFoundError:
                fail(label + "_NOT_FOUND")
            except OSError as error:
                if error.errno in (errno.ELOOP, errno.ENOTDIR):
                    fail(label + "_NOT_REGULAR")
                fail(label + "_READ_FAILED")
        else:
            # Best-effort compatibility path for platforms without POSIX
            # dir_fd/O_NOFOLLOW support. It detects ordinary symlinks and
            # replacement, but cannot make parent-path inspection atomic.
            current = Path(absolute.anchor)
            try:
                for part in parts[1:]:
                    current = current / part
                    info = os.lstat(current)
                    if stat.S_ISLNK(info.st_mode):
                        fail(label + "_NOT_REGULAR")
                    if current != absolute and not stat.S_ISDIR(info.st_mode):
                        fail(label + "_NOT_REGULAR")
                before = os.lstat(absolute)
            except FileNotFoundError:
                fail(label + "_NOT_FOUND")
            except VerificationError:
                raise
            except (OSError, ValueError):
                fail(label + "_READ_FAILED")
            filename = parts[-1]

        if stat.S_ISLNK(before.st_mode) or not stat.S_ISREG(before.st_mode):
            fail(label + "_NOT_REGULAR")
        if before.st_size > limit:
            fail(label + "_FILE_TOO_LARGE")

        flags = (
            os.O_RDONLY
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_NONBLOCK", 0)
            | getattr(os, "O_CLOEXEC", 0)
        )
        try:
            if directory_fd_walk:
                descriptor = os.open(filename, flags, dir_fd=directory_descriptor)
            else:
                descriptor = os.open(str(absolute), flags)
        except FileNotFoundError:
            fail(label + "_CHANGED_DURING_READ")
        except OSError as error:
            if error.errno in (errno.ELOOP, errno.ENOTDIR, errno.ENOENT):
                fail(label + "_CHANGED_DURING_READ")
            fail(label + "_READ_FAILED")

        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode):
            fail(label + "_NOT_REGULAR")
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            fail(label + "_CHANGED_DURING_READ")
        stable_fields = ("st_size", "st_mtime_ns", "st_ctime_ns")
        if any(getattr(opened, field) != getattr(before, field) for field in stable_fields):
            fail(label + "_CHANGED_DURING_READ")
        if opened.st_size > limit:
            fail(label + "_FILE_TOO_LARGE")

        chunks = []
        total = 0
        while total <= limit:
            chunk = os.read(descriptor, min(65536, limit + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > limit:
                fail(label + "_FILE_TOO_LARGE")

        try:
            if directory_fd_walk:
                after = os.stat(
                    filename, dir_fd=directory_descriptor, follow_symlinks=False
                )
            else:
                after = os.lstat(absolute)
        except (FileNotFoundError, OSError):
            fail(label + "_CHANGED_DURING_READ")
        opened_after = os.fstat(descriptor)
        identity = (opened.st_dev, opened.st_ino)
        if stat.S_ISLNK(after.st_mode) or not stat.S_ISREG(after.st_mode):
            fail(label + "_CHANGED_DURING_READ")
        if (after.st_dev, after.st_ino) != identity or (opened_after.st_dev, opened_after.st_ino) != identity:
            fail(label + "_CHANGED_DURING_READ")
        if any(getattr(after, field) != getattr(opened, field) for field in stable_fields):
            fail(label + "_CHANGED_DURING_READ")
        if any(getattr(opened_after, field) != getattr(opened, field) for field in stable_fields):
            fail(label + "_CHANGED_DURING_READ")
        if total != opened.st_size:
            fail(label + "_CHANGED_DURING_READ")
        source = b"".join(chunks)
    except VerificationError:
        raise
    except FileNotFoundError:
        fail(label + "_NOT_FOUND")
    except OSError as error:
        if error.errno in (errno.ELOOP, errno.ENOTDIR):
            fail(label + "_NOT_REGULAR")
        fail(label + "_READ_FAILED")
    finally:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass
        for opened_directory in reversed(directory_descriptors):
            try:
                os.close(opened_directory)
            except OSError:
                pass

    try:
        return source.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        fail(label + "_INVALID_UTF8")

def parse_json(source, label):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                fail(label + "_DUPLICATE_JSON_KEY")
            result[key] = value
        return result

    def reject_constant(_value):
        fail(label + "_JSON_INVALID")

    try:
        value = json.loads(source, object_pairs_hook=pairs, parse_constant=reject_constant)
    except VerificationError:
        raise
    except (json.JSONDecodeError, RecursionError, ValueError):
        fail(label + "_JSON_INVALID")

    stack = [(value, 0)]
    while stack:
        current, depth = stack.pop()
        if depth > MAX_JSON_DEPTH:
            fail(label + "_JSON_TOO_DEEP")
        if isinstance(current, dict):
            stack.extend((item, depth + 1) for item in current.values())
        elif isinstance(current, list):
            stack.extend((item, depth + 1) for item in current)
    return value


def exact_int(value):
    return type(value) is int


def coefficient(value):
    if not isinstance(value, str) or len(value) > 1235 or not re.fullmatch(r"(0|-?[1-9][0-9]*)", value):
        fail("SYNTHESIS_RECEIPT_INVALID")
    parsed = int(value)
    if abs(parsed).bit_length() > MAX_COEFFICIENT_BITS:
        fail("SYNTHESIS_RECEIPT_INVALID")
    return parsed


def bounded_polynomial_magnitude(coefficients):
    power = 1
    bound = 0
    for value in coefficients:
        bound += abs(value) * power
        if bound > MAX_SAFE_INTEGER:
            fail("CANDIDATE_PROOF_INTERMEDIATE_OUT_OF_BOUNDS")
        power *= MAX_INPUT
    return bound


def validate_specification(value):
    require_exact_keys(value, SPEC_KEYS, "SYNTHESIS_RECEIPT_INVALID")
    if (
        value["schema"] != "ngl.candidate-task-spec.v1"
        or not isinstance(value["id"], str)
        or not re.fullmatch(r"ngl\.experiment-001\.task:[a-z0-9][a-z0-9._-]{0,63}:v[1-9][0-9]{0,3}", value["id"])
        or not exact_int(value["inputMin"])
        or value["inputMin"] != -MAX_INPUT
        or not exact_int(value["inputMax"])
        or value["inputMax"] != MAX_INPUT
        or value["proofMethod"] != "exact-integer-polynomial-normal-form"
    ):
        fail("SYNTHESIS_RECEIPT_INVALID")

    require_exact_keys(value["limits"], set(LIMITS.keys()), "SYNTHESIS_RECEIPT_INVALID")
    if value["limits"] != LIMITS or any(not exact_int(v) for v in value["limits"].values()):
        fail("SYNTHESIS_RECEIPT_INVALID")
    raw_coefficients = value["targetCoefficients"]
    if not isinstance(raw_coefficients, list) or not 1 <= len(raw_coefficients) <= MAX_PROOF_DEGREE + 1:
        fail("SYNTHESIS_RECEIPT_INVALID")
    parsed = [coefficient(item) for item in raw_coefficients]
    if len(parsed) > 1 and parsed[-1] == 0:
        fail("SYNTHESIS_RECEIPT_INVALID")
    bounded_polynomial_magnitude(parsed)

    normalized = {
        "schema": value["schema"],
        "id": value["id"],
        "inputMin": value["inputMin"],
        "inputMax": value["inputMax"],
        "proofMethod": value["proofMethod"],
        "limits": dict(LIMITS),
        "targetCoefficients": list(raw_coefficients),
    }
    digest = sha256_text("ngl-experiment-001:candidate-task-spec:v1\n" + js_json(normalized))
    return normalized, parsed, digest


def validate_program(value):
    count = 0

    def visit(node, depth):
        nonlocal count
        count += 1
        if depth > MAX_AST_DEPTH or count > MAX_AST_NODES:
            fail("CANDIDATE_PROGRAM_LIMIT_EXCEEDED")
        if not isinstance(node, dict) or not isinstance(node.get("op"), str):
            fail("CANDIDATE_PROGRAM_INVALID")
        op = node["op"]
        if op == "input":
            require_exact_keys(node, {"op"}, "CANDIDATE_PROGRAM_INVALID")
            return {"op": op}
        if op == "const":
            require_exact_keys(node, {"op", "value"}, "CANDIDATE_PROGRAM_INVALID")
            number = node["value"]
            if not exact_int(number) or abs(number) > MAX_CONSTANT or abs(number) > MAX_SAFE_INTEGER:
                fail("CANDIDATE_PROGRAM_INVALID")
            return {"op": op, "value": number}
        if op in PROGRAM_UNARY:
            require_exact_keys(node, {"op", "arg"}, "CANDIDATE_PROGRAM_INVALID")
            return {"op": op, "arg": visit(node["arg"], depth + 1)}
        if op in PROGRAM_BINARY:
            require_exact_keys(node, {"op", "left", "right"}, "CANDIDATE_PROGRAM_INVALID")
            return {
                "op": op,
                "left": visit(node["left"], depth + 1),
                "right": visit(node["right"], depth + 1),
            }
        fail("CANDIDATE_PROGRAM_INVALID")

    return visit(value, 0)


def analyze_polynomial(program):
    maximum_bound = 0

    def trim(values):
        while len(values) > 1 and values[-1] == 0:
            values.pop()
        return values

    def visit(node):
        nonlocal maximum_bound
        op = node["op"]
        if op == "input":
            values = [0, 1]
        elif op == "const":
            values = [node["value"]]
        elif op == "negate":
            values = [-item for item in visit(node["arg"])]
        elif op in ("add", "subtract"):
            left = visit(node["left"])
            right = visit(node["right"])
            length = max(len(left), len(right))
            sign = 1 if op == "add" else -1
            values = [(left[index] if index < len(left) else 0) + sign * (right[index] if index < len(right) else 0) for index in range(length)]
        elif op == "multiply":
            left = visit(node["left"])
            right = visit(node["right"])
            values = [0] * (len(left) + len(right) - 1)
            for left_index, left_value in enumerate(left):
                for right_index, right_value in enumerate(right):
                    values[left_index + right_index] += left_value * right_value
        else:
            fail("CANDIDATE_PROOF_UNSUPPORTED_OPERATOR")

        trim(values)
        if len(values) - 1 > MAX_PROOF_DEGREE or any(abs(item).bit_length() > MAX_COEFFICIENT_BITS for item in values):
            fail("CANDIDATE_PROOF_LIMIT_EXCEEDED")
        bound = bounded_polynomial_magnitude(values)
        maximum_bound = max(maximum_bound, bound)
        return values

    return visit(program), maximum_bound


def verify_synthesis_receipt(receipt):
    require_exact_keys(receipt, RECEIPT_KEYS, "SYNTHESIS_RECEIPT_INVALID")
    if (
        receipt["schema"] != "ngl.candidate-program-synthesis.v1"
        or not isinstance(receipt["taskSpecificationDigest"], str)
        or not re.fullmatch(r"[a-f0-9]{64}", receipt["taskSpecificationDigest"])
        or not isinstance(receipt["instruction"], str)
        or len(receipt["instruction"]) > 512
    ):
        fail("SYNTHESIS_RECEIPT_INVALID")

    specification, target, spec_digest = validate_specification(receipt["taskSpecification"])
    if spec_digest != receipt["taskSpecificationDigest"]:
        fail("SYNTHESIS_RECEIPT_DIGEST_MISMATCH")
    program = validate_program(receipt["program"])
    coefficients, maximum_bound = analyze_polynomial(program)
    target_strings = [str(item) for item in target]
    coefficient_strings = [str(item) for item in coefficients]
    proof = {
        "schema": "ngl.candidate-program-proof.v3",
        "taskSpecificationId": specification["id"],
        "taskSpecificationDigest": spec_digest,
        "method": specification["proofMethod"],
        "inputMin": specification["inputMin"],
        "inputMax": specification["inputMax"],
        "limits": dict(LIMITS),
        "coefficients": coefficient_strings,
        "targetCoefficients": target_strings,
        "maxIntermediateAbsoluteBound": str(maximum_bound),
        "matchesTask": coefficients == target,
    }
    if proof["matchesTask"] is not True or receipt["proof"] != proof:
        fail("SYNTHESIS_PROOF_MISMATCH")

    trust = receipt["trust"]
    require_exact_keys(
        trust,
        {
            "taskSpecificationSignatureRequiredForInstall",
            "founderInstallApprovalRequired",
            "signaturesCreated",
        },
        "SYNTHESIS_RECEIPT_INVALID",
    )
    if (
        trust["taskSpecificationSignatureRequiredForInstall"] is not True
        or trust["founderInstallApprovalRequired"] is not True
        or trust["signaturesCreated"] is not False
    ):
        fail("SYNTHESIS_RECEIPT_INVALID")

    implementation_identity = (
        "ngl-experiment-001:candidate-program:v5\n"
        + js_json(program)
        + "\n"
        + spec_digest
    )
    implementation_hash = sha256_text(implementation_identity)
    return specification, target, program, spec_digest, implementation_hash


def evaluate_program(program, input_value):
    def visit(node):
        op = node["op"]
        if op == "input":
            return input_value
        if op == "const":
            return node["value"]
        if op == "negate":
            result = -visit(node["arg"])
        elif op == "abs":
            result = abs(visit(node["arg"]))
        else:
            left = visit(node["left"])
            right = visit(node["right"])
            if op == "add":
                result = left + right
            elif op == "subtract":
                result = left - right
            elif op == "multiply":
                result = left * right
            elif op == "min":
                result = min(left, right)
            elif op == "max":
                result = max(left, right)
            else:
                fail("CANDIDATE_PROGRAM_INVALID")
        if abs(result) > MAX_SAFE_INTEGER:
            fail("CANDIDATE_RESULT_OUT_OF_BOUNDS")
        return result

    return visit(program)


def evaluate_target(coefficients, input_value):
    result = 0
    for item in reversed(coefficients):
        result = result * input_value + item
    return result


def validate_input(value, specification, code):
    if not exact_int(value) or abs(value) > MAX_SAFE_INTEGER:
        fail(code)
    if value < specification["inputMin"] or value > specification["inputMax"]:
        fail(code)
    return value


def verify_authority(value):
    require_exact_keys(value, set(AUTHORITY_KEYS), "EVALUATION_REPORT_INVALID")
    if any(value[key] is not False for key in AUTHORITY_KEYS):
        fail("EVALUATION_REPORT_AUTHORITY_INVALID")


def expected_row(program, target, input_value):
    output = evaluate_program(program, input_value)
    expected = evaluate_target(target, input_value)
    if output != expected or abs(output) > MAX_SAFE_INTEGER:
        fail("EVALUATION_REPORT_MISMATCH")
    return {"input": input_value, "output": output, "expectedOutput": str(expected)}


def verify_report(specification, target, program, spec_digest, implementation_hash, report):
    if not isinstance(report, dict):
        fail("EVALUATION_REPORT_INVALID")
    if (
        report.get("taskSpecificationId") != specification["id"]
        or report.get("taskSpecificationDigest") != spec_digest
        or report.get("implementationHash") != implementation_hash
    ):
        fail("EVALUATION_REPORT_CONTEXT_MISMATCH")
    if report.get("proofVerified") is not True or report.get("evaluationMatchesTarget") is not True:
        fail("EVALUATION_REPORT_INVALID")
    verify_authority(report.get("authority"))

    common = {
        "taskSpecificationId": specification["id"],
        "taskSpecificationDigest": spec_digest,
        "implementationHash": implementation_hash,
    }

    if report.get("schema") == "ngl.candidate-program-evaluation.v1":
        keys = {
            "schema", "taskSpecificationId", "taskSpecificationDigest", "implementationHash",
            "input", "output", "expectedOutput", "proofVerified", "evaluationMatchesTarget", "authority",
        }
        require_exact_keys(report, keys, "EVALUATION_REPORT_INVALID")
        input_value = validate_input(report["input"], specification, "EVALUATION_REPORT_INPUT_INVALID")
        expected = expected_row(program, target, input_value)
        if not exact_int(report["output"]) or not isinstance(report["expectedOutput"], str):
            fail("EVALUATION_REPORT_MISMATCH")
        actual = {"input": report["input"], "output": report["output"], "expectedOutput": report["expectedOutput"]}
        if actual != expected:
            fail("EVALUATION_REPORT_MISMATCH")
        normalized = {
            "schema": "ngl.candidate-program-evaluation.v1",
            **common,
            **expected,
            "proofVerified": True,
            "evaluationMatchesTarget": True,
            "authority": dict(AUTHORITY_FALSE),
        }
        count = 1
        result_digest = None
        digest_domain = "ngl.candidate-program-evaluation-report:v1\n"
    elif report.get("schema") == "ngl.candidate-program-evaluation-range.v1":
        keys = {
            "schema", "taskSpecificationId", "taskSpecificationDigest", "implementationHash",
            "range", "evaluationCount", "evaluations", "proofVerified", "evaluationMatchesTarget",
            "authority", "resultDigest",
        }
        require_exact_keys(report, keys, "EVALUATION_REPORT_INVALID")
        require_exact_keys(report["range"], {"start", "end"}, "EVALUATION_REPORT_RANGE_INVALID")
        start = validate_input(report["range"]["start"], specification, "EVALUATION_REPORT_RANGE_INVALID")
        end = validate_input(report["range"]["end"], specification, "EVALUATION_REPORT_RANGE_INVALID")
        if start > end:
            fail("EVALUATION_REPORT_RANGE_INVALID")
        count = end - start + 1
        if count > MAX_RANGE_EVALUATIONS:
            fail("EVALUATION_REPORT_RANGE_TOO_LARGE")
        rows = report["evaluations"]
        if not exact_int(report["evaluationCount"]) or report["evaluationCount"] != count or not isinstance(rows, list) or len(rows) != count:
            fail("EVALUATION_REPORT_RANGE_INVALID")
        evaluations = []
        for index, row in enumerate(rows):
            require_exact_keys(row, {"input", "output", "expectedOutput"}, "EVALUATION_REPORT_INVALID")
            if not exact_int(row["input"]) or not exact_int(row["output"]) or not isinstance(row["expectedOutput"], str):
                fail("EVALUATION_REPORT_INVALID")
            expected = expected_row(program, target, start + index)
            if row != expected:
                if row.get("input") != start + index:
                    fail("EVALUATION_REPORT_RANGE_INVALID")
                fail("EVALUATION_REPORT_MISMATCH")
            evaluations.append(expected)
        unsigned = {
            "schema": "ngl.candidate-program-evaluation-range.v1",
            **common,
            "range": {"start": start, "end": end},
            "evaluationCount": count,
            "evaluations": evaluations,
            "proofVerified": True,
            "evaluationMatchesTarget": True,
            "authority": dict(AUTHORITY_FALSE),
        }
        result_digest = sha256_text(
            "ngl.candidate-program-evaluation-range:v1\n" + js_json(unsigned)
        )
        if report["resultDigest"] != result_digest:
            fail("EVALUATION_REPORT_DIGEST_MISMATCH")
        normalized = {**unsigned, "resultDigest": result_digest}
        digest_domain = "ngl.candidate-program-evaluation-report:v1\n"
    else:
        fail("EVALUATION_REPORT_SCHEMA_UNSUPPORTED")

    report_digest = sha256_text(digest_domain + js_json(normalized))
    return {
        "schema": "ngl.candidate-program-independent-verification.v1",
        "reportSchema": normalized["schema"],
        "taskSpecificationId": specification["id"],
        "taskSpecificationDigest": spec_digest,
        "implementationHash": implementation_hash,
        "evaluationCount": count,
        "reportDigest": report_digest,
        "resultDigest": result_digest,
        "verificationMethod": "python-stdlib-independent-ast-and-polynomial-replay",
        "verified": True,
        "authority": dict(AUTHORITY_FALSE),
    }


def verify_files(receipt_path, report_path):
    receipt_source = read_bounded_regular_file(receipt_path, MAX_RECEIPT_BYTES, "SYNTHESIS_RECEIPT")
    receipt = parse_json(receipt_source, "SYNTHESIS_RECEIPT")
    specification, target, program, spec_digest, implementation_hash = verify_synthesis_receipt(receipt)
    report_source = read_bounded_regular_file(report_path, MAX_REPORT_BYTES, "EVALUATION_REPORT")
    report = parse_json(report_source, "EVALUATION_REPORT")
    return verify_report(specification, target, program, spec_digest, implementation_hash, report)


def main(argv):
    if len(argv) != 2:
        sys.stderr.write(
            "Usage: python3 scripts/verify-candidate-report.py <synthesis-receipt.json> <evaluation-report.json>\n"
        )
        return 2
    try:
        result = verify_files(argv[0], argv[1])
        sys.stdout.write(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
        return 0
    except VerificationError as error:
        sys.stderr.write(str(error) + "\n")
        return 1
    except Exception:
        # Keep the CLI fail-closed and do not leak a traceback or file contents.
        sys.stderr.write("CANDIDATE_REPORT_VERIFICATION_FAILED\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
