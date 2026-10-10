// NGL Commission Evidence Gate v1 — evaluates GitHub-observed code/CI state,
// not human approval, actual deployment, physical presence, revenue or novelty.
const sha = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const executable = path => /^(src\/|test\/|tools\/|location\/|\.github\/workflows\/)/.test(path);

export function assessPullRequest({ pr, files, checks, requiredChecks = ["world-projection"] }) {
  const failures = [];
  const head = pr?.head?.sha;
  const base = pr?.base?.sha;
  if (!sha(head) || !sha(base)) failures.push("INVALID_COMMIT_IDENTITY");
  if (head === base) failures.push("NO_COMMIT_DELTA");
  if (pr?.state !== "open") failures.push("NOT_OPEN");
  if (pr?.draft !== false) failures.push("DRAFT_OR_UNKNOWN");
  if (!Number.isSafeInteger(pr?.changed_files) || pr.changed_files < 1 ||
      !Array.isArray(files) || files.length !== pr.changed_files ||
      !files.some(f => typeof f.filename === "string" && Number.isSafeInteger(f.changes) && f.changes > 0)) {
    failures.push("CHANGESET_NOT_CONFIRMED");
  }
  if (!Array.isArray(files) || !files.some(f => executable(f.filename || "") && f.changes > 0)) {
    failures.push("NO_EXECUTABLE_SOURCE_OR_TEST_DELTA");
  }
  const runs = checks?.check_runs;
  if (!Array.isArray(runs) || !Number.isSafeInteger(checks?.total_count) ||
      checks.total_count !== runs.length || runs.length === 0) {
    failures.push("CHECKS_MISSING_OR_INCOMPLETE");
  } else {
    if (runs.some(r => r.head_sha !== head)) failures.push("CHECK_SHA_MISMATCH");
    if (runs.some(r => r.status !== "completed" || r.conclusion !== "success")) failures.push("CHECK_NOT_SUCCESSFUL");
    for (const name of requiredChecks) {
      if (!runs.some(r => r.name === name && r.head_sha === head &&
          r.status === "completed" && r.conclusion === "success")) {
        failures.push("REQUIRED_CHECK_MISSING:" + name);
      }
    }
  }
  return Object.freeze({
    schema: "ngl.commission-gate.v1",
    verdict: failures.length ? "NOT_DEMONSTRATED" : "CODE_AND_CI_OBSERVED",
    failures,
    subject: { repository: pr?.base?.repo?.full_name ?? null, pull_request: pr?.number ?? null,
      head_sha: head ?? null, base_sha: base ?? null, changed_files: pr?.changed_files ?? null },
    observed_checks: Array.isArray(runs) ? runs.map(r => ({
      name: r.name, head_sha: r.head_sha, status: r.status, conclusion: r.conclusion,
      url: r.html_url ?? null
    })) : [],
    limits: {
      founder_approval: "NOT_ESTABLISHED", deployed: "NOT_ESTABLISHED",
      buyer_payment: "NOT_ESTABLISHED", originality: "NOT_ESTABLISHED",
      code_correctness: "NOT_ESTABLISHED", source: "GitHub API observations, not a cryptographic attestation"
    }
  });
}

export function assessBranchHeads({base,head}) {
  if (!sha(base?.commit?.sha) || !sha(head?.commit?.sha)) {
    return Object.freeze({verdict:"NOT_DEMONSTRATED",reason:"INVALID_BRANCH_HEAD"});
  }
  if (base.commit.sha === head.commit.sha) {
    return Object.freeze({verdict:"NO_DELTA",reason:"BRANCH_POINTS_TO_BASE_COMMIT",sha:head.commit.sha});
  }
  return Object.freeze({verdict:"UNREVIEWED_DELTA",reason:"DIFFERENT_HEADS_ARE_NOT_PROOF_OF_CODE_CHANGE_OR_CI",base_sha:base.commit.sha,head_sha:head.commit.sha});
}
