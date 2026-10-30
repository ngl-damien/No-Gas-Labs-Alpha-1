import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preserveEvidence } from "../scripts/preserve-evidence.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ngl-evidence-ingest-"));
  const verificationDir = join(root, "verification");
  const browserDir = join(root, "browser");
  const destination = join(root, "archive");
  await mkdir(join(verificationDir, "exercise"), { recursive: true });
  await mkdir(browserDir, { recursive: true });
  await writeFile(join(verificationDir, "report.json"), JSON.stringify({ passed: true, wallMs: 12 }));
  await writeFile(join(verificationDir, "tests.stdout.log"), "ℹ tests 3\n");
  await writeFile(join(verificationDir, "exercise/exercise.json"), JSON.stringify({
    courier: { status: "RESPONDED" },
    repository: { integrity: { passed: true }, tests: { tests: 3 } }
  }));
  const journeys = [
    "desktop", "phone", "two-session-shared", "one-button-320",
    "one-button-412", "standalone-exact-bytes", "shared-restart"
  ].map(journey => ({ journey, passed: true, status: "passed" }));
  await writeFile(join(browserDir, "results.json"), JSON.stringify(journeys));
  const throughputFile = join(root, "throughput.json");
  await writeFile(throughputFile, JSON.stringify({ elapsedMs: 12 }));
  return { root, verificationDir, browserDir, destination, throughputFile };
}

test("preserves validated evidence and emits path-free content hashes", async () => {
  const f = await fixture();
  try {
    const result = await preserveEvidence(f);
    assert.equal(result.tests, 3);
    assert.equal(result.filesPreserved, 6);
    const manifest = JSON.parse(await readFile(join(f.destination, "ingest-manifest.json"), "utf8"));
    assert.equal(manifest.schema, "ngl.commission-evidence-ingest.v2");
    assert.equal(manifest.validation.non_zero_test_count, 3);
    assert.equal(typeof manifest.inputs.verification.sha256, "string");
    assert.equal(manifest.sourcePaths, undefined);
    assert.equal(manifest.inputs.verification.path, undefined);
    assert.ok((await readdir(f.destination)).includes("test-output.txt"));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("rejects duplicate required journey records before changing the archive", async () => {
  const f = await fixture();
  try {
    await mkdir(f.destination, { recursive: true });
    await writeFile(join(f.destination, "sentinel.txt"), "keep");
    const resultsPath = join(f.browserDir, "results.json");
    const journeys = JSON.parse(await readFile(resultsPath, "utf8"));
    journeys.push({ ...journeys[0] });
    await writeFile(resultsPath, JSON.stringify(journeys));
    await assert.rejects(() => preserveEvidence(f), /exactly one passing record/);
    assert.equal(await readFile(join(f.destination, "sentinel.txt"), "utf8"), "keep");
    assert.deepEqual(await readdir(f.destination), ["sentinel.txt"]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("rejects non-passing verification before writing any evidence", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.verificationDir, "report.json"), JSON.stringify({ passed: false }));
    await assert.rejects(() => preserveEvidence(f), /not a passing result/);
    await assert.rejects(() => readdir(f.destination));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
