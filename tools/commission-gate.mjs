#!/usr/bin/env node
// Read-only GitHub verification. Node 20+, no dependencies, no write permissions.
import { assessPullRequest, assessBranchHeads } from "../src/evidence/commission-gate.js";

const args = process.argv.slice(2);
function arg(flag, fallback) {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : args[i + 1];
}
const repo = arg("--repo", "ngl-damien/No-Gas-Labs-Alpha-1");
const number = arg("--pr", null);
const branch = arg("--branch", null);
const base = arg("--base", "main");
if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || (!!number === !!branch) ||
    (number && !/^[1-9]\d*$/.test(number))) {
  console.error("Usage: node tools/commission-gate.mjs --repo owner/repo (--pr N | --branch name) [--base main]");
  process.exit(1);
}
const root = "https://api.github.com/repos/" + repo;
const headers = {"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"};
if (process.env.GITHUB_TOKEN) headers.Authorization = "Bearer " + process.env.GITHUB_TOKEN;
async function get(path) {
  const res = await fetch(root + path, {headers,signal:AbortSignal.timeout(15000)});
  if (!res.ok) throw new Error("GitHub HTTP " + res.status + " for " + path);
  return res.json();
}
async function pages(path) {
  const rows = [];
  for (let page=1; page<=20; page++) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await get(path + separator + "per_page=100&page=" + page);
    if (!Array.isArray(batch)) throw new Error("expected paginated array");
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
  throw new Error("pagination exceeded 2000 entries");
}
try {
  let result;
  if (number) {
    const pr = await get("/pulls/" + number);
    const files = await pages("/pulls/" + number + "/files");
    const first = await get("/commits/" + pr.head.sha + "/check-runs?per_page=100&page=1");
    if (!Array.isArray(first.check_runs)) throw new Error("missing check runs");
    const runs = [...first.check_runs];
    for (let page=2; runs.length < first.total_count && page<=20; page++) {
      const next = await get("/commits/" + pr.head.sha + "/check-runs?per_page=100&page=" + page);
      if (!next.check_runs?.length) break;
      runs.push(...next.check_runs);
    }
    result = assessPullRequest({pr,files,checks:{total_count:first.total_count,check_runs:runs}});
  } else {
    const [baseRef,headRef] = await Promise.all([
      get("/branches/" + encodeURIComponent(base)),
      get("/branches/" + encodeURIComponent(branch))
    ]);
    result = assessBranchHeads({base:baseRef,head:headRef});
  }
  console.log(JSON.stringify({...result,checked_at:new Date().toISOString()},null,2));
  process.exit(result.verdict === "CODE_AND_CI_OBSERVED" ? 0 : 2);
} catch (error) {
  console.error(JSON.stringify({verdict:"UNAVAILABLE",reason:String(error?.message || error)}));
  process.exit(1);
}
