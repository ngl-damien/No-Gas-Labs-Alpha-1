import { createHash } from "node:crypto";
import {
  copyFile, lstat, mkdir, readFile, rename, rm, writeFile
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const requiredJourneys = [
  "desktop", "phone", "two-session-shared", "one-button-320",
  "one-button-412", "standalone-exact-bytes", "shared-restart"
];
const screenshotNames = [
  "desktop.png", "phone.png", "shared-desktop.png", "shared-phone.png",
  "one-button-320-world.png", "one-button-412-stage.png"
];

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);

async function readRegularFile(path, optional = false) {
  try {
    const info = await lstat(path);
    if (!info.isFile()) throw new Error(`Evidence input is not a regular file: ${basename(path)}`);
    const bytes = await readFile(path);
    return { bytes, sha256: sha256(bytes), size: bytes.byteLength };
  } catch (error) {
    if (optional && error.code === "ENOENT") return null;
    throw error;
  }
}

function parseJson(source, label) {
  try {
    return JSON.parse(source.bytes.toString("utf8"));
  } catch {
    throw new Error(`Invalid JSON evidence input: ${label}`);
  }
}

async function writeAtomically(destination, bytes) {
  const temporary = `${destination}.tmp-${process.pid}-${sha256(bytes).slice(0, 10)}`;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Validate and preserve one evidence set.
 * All source validation happens before the evidence archive is modified.
 * The manifest records content identity, never machine-specific absolute paths.
 */
export async function preserveEvidence({
  verificationDir, browserDir, throughputFile, destination = join(repositoryRoot, "docs/meteor/evidence")
}) {
  if (!verificationDir || !browserDir || !throughputFile) {
    throw new Error("verificationDir, browserDir and throughputFile are required");
  }

  const inputs = {
    verification: await readRegularFile(join(resolve(verificationDir), "report.json")),
    testOutput: await readRegularFile(join(resolve(verificationDir), "tests.stdout.log")),
    exercise: await readRegularFile(join(resolve(verificationDir), "exercise/exercise.json")),
    browser: await readRegularFile(join(resolve(browserDir), "results.json")),
    throughput: await readRegularFile(resolve(throughputFile))
  };
  const verification = parseJson(inputs.verification, "report.json");
  const exercise = parseJson(inputs.exercise, "exercise.json");
  const browser = parseJson(inputs.browser, "results.json");
  const throughput = parseJson(inputs.throughput, "throughput report");

  if (!isRecord(verification) || verification.passed !== true) {
    throw new Error("Verification report is not a passing result");
  }
  if (!isRecord(exercise) || exercise.courier?.status !== "RESPONDED" ||
      exercise.repository?.integrity?.passed !== true) {
    throw new Error("Institutional exercise is incomplete or repository integrity did not pass");
  }
  if (!isRecord(throughput)) throw new Error("Throughput report must be a JSON object");
  if (!Array.isArray(browser)) throw new Error("Browser results must be a JSON array");

  for (const journey of requiredJourneys) {
    const matches = browser.filter(result => result?.journey === journey && result?.passed === true);
    if (matches.length !== 1) {
      throw new Error(`Required browser journey must have exactly one passing record: ${journey}`);
    }
  }
  if (!browser.filter(result => result?.status !== "blocked").every(result => result?.passed === true)) {
    throw new Error("A non-blocked browser journey failed");
  }

  const testOutput = inputs.testOutput.bytes.toString("utf8");
  const count = /(?:ℹ|#)\s*tests\s+(\d+)/.exec(testOutput)?.[1];
  if (!count || Number(count) < 1) throw new Error("Actual non-zero test count missing from test output");
  const repositoryTestCount = exercise.repository.tests?.tests;
  if (!Number.isSafeInteger(repositoryTestCount) || repositoryTestCount !== Number(count)) {
    throw new Error("Institutional exercise test count does not match captured test output");
  }

  const screenshots = {};
  for (const name of screenshotNames) {
    const source = await readRegularFile(join(resolve(browserDir), name), true);
    if (source) screenshots[name] = source;
  }

  const inputManifest = Object.fromEntries(
    Object.entries(inputs).map(([name, source]) => [name, {
      sha256: source.sha256, size_bytes: source.size
    }])
  );
  const runId = sha256(Buffer.from(JSON.stringify(inputManifest))).slice(0, 20);
  const records = {
    "verification.json": Buffer.from(JSON.stringify({
      ...verification,
      tests: Number(count),
      testOutputSHA256: inputs.testOutput.sha256
    }, null, 2) + "\n"),
    "institutional-exercise.json": Buffer.from(JSON.stringify(exercise, null, 2) + "\n"),
    "browser.json": Buffer.from(JSON.stringify(browser, null, 2) + "\n"),
    "throughput.json": Buffer.from(JSON.stringify(throughput, null, 2) + "\n"),
    "test-output.txt": inputs.testOutput.bytes,
    ...Object.fromEntries(Object.entries(screenshots).map(([name, value]) => [name, value.bytes]))
  };
  const outputManifest = Object.fromEntries(
    Object.entries(records).map(([name, bytes]) => [name, {
      sha256: sha256(bytes), size_bytes: bytes.byteLength
    }])
  );
  const manifest = {
    schema: "ngl.commission-evidence-ingest.v2",
    run_id: runId,
    recorded_at: new Date().toISOString(),
    validation: {
      verification_passed: true,
      institutional_exercise_responded: true,
      repository_integrity_passed: true,
      required_browser_journeys_passed: requiredJourneys,
      non_zero_test_count: Number(count)
    },
    inputs: inputManifest,
    outputs: outputManifest,
    note: "Content hashes and byte lengths are recorded. Machine-specific source paths are intentionally omitted."
  };
  records["ingest-manifest.json"] = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");

  const target = resolve(destination);
  await mkdir(target, { recursive: true });
  // Validation and serialization are complete before the first archive write.
  for (const [name, bytes] of Object.entries(records)) {
    await writeAtomically(join(target, name), bytes);
  }

  return {
    destination: target,
    runId,
    tests: Number(count),
    verificationWallMs: verification.wallMs ?? null,
    repositoryTests: exercise.repository.tests?.tests ?? null,
    browserJourneys: browser.length,
    filesPreserved: Object.keys(records).length
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    throw new Error("Usage: node scripts/preserve-evidence.mjs verification-dir browser-dir throughput-report");
  }
  const result = await preserveEvidence({
    verificationDir: args[0],
    browserDir: args[1],
    throughputFile: args[2]
  });
  console.log(JSON.stringify(result));
}
