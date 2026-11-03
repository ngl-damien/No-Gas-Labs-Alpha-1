import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, createHash, sign, randomUUID } from "node:crypto";
import { existsSync, readdirSync, writeFileSync, readFileSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import {
  makeDecisionPayload,
  decisionDigest,
  verifyFounderDecision,
  authorizationEvent,
  loadTrustAnchor,
  linkReceipt,
  newNonce,
} from "../src/authority/decision.js";
import { inspectWriterLock } from "../src/institution/lock-inspector.mjs";

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }))
    .digest("hex");
  return { publicKey, privateKey, jwk, fingerprint };
}

function signPayload(privateKey, payload, fingerprint) {
  return {
    payload_sha256: decisionDigest(payload),
    key_fingerprint: fingerprint,
    signature: sign("sha256", Buffer.from(canonical(payload)), privateKey).toString("base64url"),
    nonce: newNonce(),
  };
}

function withEnvironment(values, callback) {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
  try { return callback(); }
  finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const proposal = { event_id: "prop-1", type: "PROPOSAL", quest_id: "q-1" };
const quest = { quest_id: "q-1" };
const future = new Date(Date.now() + 3_600_000).toISOString();

function createAuthorizationFixture(dir) {
  const modulePath = path.join(dir, "src", "authority", "decision.js");
  const trustPath = path.join(dir, "docs", "authority", "founder.pub.json");
  const dataDirectory = path.join(dir, "data");
  mkdirSync(path.dirname(modulePath), { recursive: true, mode: 0o700 });
  mkdirSync(path.dirname(trustPath), { recursive: true, mode: 0o700 });
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const source = readFileSync(new URL("../src/authority/decision.js", import.meta.url), "utf8");
  writeFileSync(modulePath, source, { mode: 0o600 });
  const kp = keyPair();
  const payload = makeDecisionPayload({
    proposal,
    quest,
    capabilities: ["read"],
    outputs: ["test-output"],
    acceptance: ["verify"],
    expires_at: future,
  });
  writeFileSync(trustPath, JSON.stringify({
    schema: "ngl.founder-trust-anchor.v1",
    status: "ENROLLED",
    enrolled: true,
    mode: "PRODUCTION",
    public_key_jwk: kp.jwk,
    fingerprint: kp.fingerprint,
  }), { mode: 0o600 });
  return {
    moduleUrl: pathToFileURL(modulePath).href,
    trustPath,
    dataDirectory,
    nonceLedgerPath: path.join(dataDirectory, "founder-nonces.json"),
    payload,
    sign: () => signPayload(kp.privateKey, payload, kp.fingerprint),
  };
}

function startAuthorizationWorker(fixture, signed) {
  const source = [
    "import { authorizationEvent } from " + JSON.stringify(fixture.moduleUrl) + ";",
    "import { createInterface } from 'node:readline';",
    "console.log('READY');",
    "for await (const line of createInterface({ input: process.stdin })) {",
    "  if (line !== 'go') continue;",
    "  try {",
    "    const event = authorizationEvent({ signed: JSON.parse(process.env.TEST_SIGNED), payload: JSON.parse(process.env.TEST_PAYLOAD) });",
    "    console.log('AUTHORIZED:' + event.event_id);",
    "  } catch (error) {",
    "    console.log('ERROR:' + (error && error.message ? error.message : String(error)));",
    "  }",
    "  break;",
    "}",
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    env: {
      ...process.env,
      NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
      NGL_FOUNDER_NONCE_LEDGER_PATH: fixture.nonceLedgerPath,
      TEST_SIGNED: JSON.stringify(signed),
      TEST_PAYLOAD: JSON.stringify(fixture.payload),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => {});
  const reader = createInterface({ input: child.stdout });
  const lines = [];
  const waiters = [];
  reader.on("line", line => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else lines.push(line);
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr += chunk; });
  const exit = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
  const nextLine = () => lines.length
    ? Promise.resolve(lines.shift())
    : new Promise((resolve, reject) => {
        waiters.push(resolve);
        child.once("error", reject);
      });
  return { child, nextLine, exit, get stderr() { return stderr; } };
}

function startCrashWorker(fixture, signed, crashPoint, markerPath) {
  const source = [
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const ledgerPath = process.env.NGL_FOUNDER_NONCE_LEDGER_PATH;",
    "const markerPath = process.env.TEST_MARKER_PATH;",
    "if (process.env.TEST_CRASH_POINT === 'before-rename') {",
    "  const originalRenameSync = fs.renameSync;",
    "  fs.renameSync = (from, to) => {",
    "    if (to === ledgerPath) {",
    "      fs.writeFileSync(markerPath, 'before-rename', { mode: 0o600 });",
    "      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);",
    "      throw new Error('crash barrier expired');",
    "    }",
    "    return originalRenameSync(from, to);",
    "  };",
    "} else {",
    "  const originalFsyncSync = fs.fsyncSync;",
    "  let directorySyncs = 0;",
    "  fs.fsyncSync = descriptor => {",
    "    if (fs.fstatSync(descriptor).isDirectory()) {",
    "      directorySyncs += 1;",
    "      if (directorySyncs === 2) {",
    "        fs.writeFileSync(markerPath, 'after-rename-before-directory-sync', { mode: 0o600 });",
    "        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);",
    "        throw new Error('crash barrier expired');",
    "      }",
    "    }",
    "    return originalFsyncSync(descriptor);",
    "  };",
    "}",
    "syncBuiltinESMExports();",
    "const { authorizationEvent } = await import(" + JSON.stringify(fixture.moduleUrl) + ");",
    "authorizationEvent({ signed: JSON.parse(process.env.TEST_SIGNED), payload: JSON.parse(process.env.TEST_PAYLOAD) });",
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    env: {
      ...process.env,
      NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
      NGL_FOUNDER_NONCE_LEDGER_PATH: fixture.nonceLedgerPath,
      TEST_SIGNED: JSON.stringify(signed),
      TEST_PAYLOAD: JSON.stringify(fixture.payload),
      TEST_CRASH_POINT: crashPoint,
      TEST_MARKER_PATH: markerPath,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr += chunk; });
  const exit = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
  return { child, exit, get stderr() { return stderr; } };
}

async function waitForMarker(markerPath, worker, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (existsSync(markerPath)) return;
    if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
      throw new Error(label + " exited before reaching the fault boundary: " + worker.stderr);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(label + " did not reach the fault boundary: " + worker.stderr);
}


test("valid decision verifies cryptographically against the matching P-256 key", () => {
  const kp = keyPair();
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: ["read"], outputs: ["nail"], acceptance: ["verify"], expires_at: future,
  });
  const signed = signPayload(kp.privateKey, payload, kp.fingerprint);
  const result = verifyFounderDecision({
    signed, payload, public_key_jwk: kp.jwk, expected_fingerprint: kp.fingerprint,
  });
  assert.equal(result.valid, true);
});

test("wrong fingerprint or a mismatched public key cannot verify", () => {
  const kp = keyPair();
  const other = keyPair();
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: ["read"], outputs: ["nail"], acceptance: ["verify"], expires_at: future,
  });
  const signed = signPayload(kp.privateKey, payload, kp.fingerprint);
  assert.equal(verifyFounderDecision({
    signed, payload, public_key_jwk: kp.jwk, expected_fingerprint: other.fingerprint,
  }).reason, "KEY_NOT_ENROLLED");
  assert.equal(verifyFounderDecision({
    signed, payload, public_key_jwk: other.jwk, expected_fingerprint: kp.fingerprint,
  }).reason, "KEY_NOT_ENROLLED");
});

test("payload tampering fails digest verification", () => {
  const kp = keyPair();
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: ["read"], outputs: ["nail"], acceptance: ["verify"], expires_at: future,
  });
  const signed = signPayload(kp.privateKey, payload, kp.fingerprint);
  const tampered = { ...payload, capabilities: ["root"] };
  assert.equal(verifyFounderDecision({
    signed, payload: tampered, public_key_jwk: kp.jwk, expected_fingerprint: kp.fingerprint,
  }).reason, "PAYLOAD_DIGEST_MISMATCH");
});

test("expired decisions fail closed", () => {
  const kp = keyPair();
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: ["read"], outputs: ["nail"], acceptance: ["verify"],
    expires_at: new Date(Date.now() - 1_000).toISOString(),
  });
  const signed = signPayload(kp.privateKey, payload, kp.fingerprint);
  assert.equal(verifyFounderDecision({
    signed, payload, public_key_jwk: kp.jwk, expected_fingerprint: kp.fingerprint,
  }).reason, "DECISION_EXPIRED");
});

test("nonce replay is rejected by the low-level verifier when a consumed set is supplied", () => {
  const kp = keyPair();
  const payload = makeDecisionPayload({
    proposal, quest, capabilities: ["read"], outputs: ["nail"], acceptance: ["verify"], expires_at: future,
  });
  const signed = signPayload(kp.privateKey, payload, kp.fingerprint);
  assert.equal(verifyFounderDecision({
    signed, payload, public_key_jwk: kp.jwk, expected_fingerprint: kp.fingerprint,
    consumed_nonces: new Set([signed.nonce]),
  }).reason, "NONCE_REPLAY");
});

test("trust-anchor loader validates the enrolled public key fingerprint", () => {
  const dir = path.join(tmpdir(), "ngl-auth-anchor-" + process.pid);
  mkdirSync(dir, { recursive: true });
  try {
    const kp = keyPair();
    const trustPath = path.join(dir, "founder.pub.json");
    writeFileSync(trustPath, JSON.stringify({
      schema: "ngl.founder-trust-anchor.v1",
      status: "ENROLLED",
      enrolled: true,
      mode: "PRODUCTION",
      public_key_jwk: kp.jwk,
      fingerprint: kp.fingerprint,
    }));
    const trust = loadTrustAnchor(trustPath);
    assert.equal(trust.enrolled, true);
    assert.equal(trust.mode, "PRODUCTION");
    assert.equal(trust.fingerprint, kp.fingerprint);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("trust-anchor loader rejects a fingerprint that does not match its JWK", () => {
  const dir = path.join(tmpdir(), "ngl-auth-mismatch-" + process.pid);
  mkdirSync(dir, { recursive: true });
  try {
    const kp = keyPair();
    const trustPath = path.join(dir, "founder.pub.json");
    writeFileSync(trustPath, JSON.stringify({
      schema: "ngl.founder-trust-anchor.v1",
      status: "ENROLLED",
      enrolled: true,
      mode: "PRODUCTION",
      public_key_jwk: kp.jwk,
      fingerprint: "0".repeat(64),
    }));
    const trust = loadTrustAnchor(trustPath);
    assert.equal(trust.enrolled, false);
    assert.equal(trust.reason, "FINGERPRINT_MISMATCH");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a self-pinned attacker cannot choose the trust path, clock, nonce set or verification result", () => {
  const dir = path.join(tmpdir(), "ngl-auth-self-pin-" + process.pid);
  mkdirSync(dir, { recursive: true });
  try {
    const attacker = keyPair();
    const trustPath = path.join(dir, "attacker.pub.json");
    writeFileSync(trustPath, JSON.stringify({
      schema: "ngl.founder-trust-anchor.v1",
      status: "ENROLLED",
      enrolled: true,
      mode: "PRODUCTION",
      public_key_jwk: attacker.jwk,
      fingerprint: attacker.fingerprint,
    }));
    assert.equal(loadTrustAnchor(trustPath).enrolled, true);
    const payload = makeDecisionPayload({
      proposal, quest, capabilities: ["root"], outputs: ["attacker-output"], acceptance: ["accept"], expires_at: future,
    });
    const signed = signPayload(attacker.privateKey, payload, attacker.fingerprint);
    assert.throws(() => authorizationEvent({
      signed,
      payload,
      trustPath,
      now: 0,
      consumed_nonces: new Set(),
      verification: { valid: true },
    }), /FOUNDER_AUTHORIZATION_INPUT_INVALID/);
    withEnvironment({ NGL_FOUNDER_TRUST_ANCHOR_PATH: null, NGL_FOUNDER_NONCE_LEDGER_PATH: null }, () => {
      assert.throws(() => authorizationEvent({ signed, payload }), /FOUNDER_TRUST_ROOT_UNCONFIGURED/);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("NOT_ENROLLED sentinel fails closed", () => {
  const dir = path.join(tmpdir(), "ngl-auth-ne-" + process.pid);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    const trustPath = path.join(dir, "founder.pub.json");
    writeFileSync(trustPath, JSON.stringify({
      schema: "ngl.founder-trust-anchor.v1",
      status: "NOT_ENROLLED",
      enrolled: false,
      mode: null,
      public_key_jwk: null,
      fingerprint: null,
    }), { mode: 0o600 });
    assert.equal(loadTrustAnchor(trustPath).enrolled, false);
    assert.equal(loadTrustAnchor(trustPath).reason, "NOT_ENROLLED");
    withEnvironment({ NGL_FOUNDER_TRUST_ANCHOR_PATH: trustPath }, () => {
      assert.throws(() => authorizationEvent({
        signed: { payload_sha256: "0".repeat(64), key_fingerprint: "0".repeat(64), signature: "AAAA", nonce: newNonce() },
        payload: { schema: "ngl.founder-decision.v1" },
      }), /FOUNDER_NOT_ENROLLED/);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("accessor-bearing data is rejected without invoking getters", () => {
  let invoked = false;
  const value = {};
  Object.defineProperty(value, "secret", {
    enumerable: true,
    get() { invoked = true; return "not-json-data"; },
  });
  assert.throws(() => decisionDigest(value), /NON_CANONICAL_DECISION_DATA/);
  assert.equal(invoked, false);
  const input = {};
  Object.defineProperty(input, "signed", {
    enumerable: true,
    get() { invoked = true; return {}; },
  });
  Object.defineProperty(input, "payload", { enumerable: true, value: {} });
  assert.throws(() => authorizationEvent(input), /FOUNDER_AUTHORIZATION_INPUT_INVALID/);
  assert.equal(invoked, false);
});

test("cyclic payloads fail closed before canonical serialization", () => {
  const payload = {};
  payload.self = payload;
  assert.throws(() => decisionDigest(payload), /NON_CANONICAL_DECISION_DATA/);
});

test("receipt chain links previous block hashes deterministically", () => {
  const first = linkReceipt({ prevHash: null, payload: { x: 1 }, signed: { s: 1 } });
  const second = linkReceipt({ prevHash: first.blockHash, payload: { x: 2 }, signed: { s: 2 } });
  assert.equal(second.prevHash, first.blockHash);
  assert.notEqual(first.blockHash, second.blockHash);
});


test("trust-anchor enrollment metadata must match the exact schema/status/enrolled tuple and an allowed mode", () => {
  const dir = path.join(tmpdir(), "ngl-auth-metadata-" + process.pid + "-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  try {
    const kp = keyPair();
    const trustPath = path.join(dir, "founder.pub.json");
    const valid = {
      schema: "ngl.founder-trust-anchor.v1",
      status: "ENROLLED",
      enrolled: true,
      mode: "PRODUCTION",
      public_key_jwk: kp.jwk,
      fingerprint: kp.fingerprint,
    };
    const without = key => {
      const value = { ...valid };
      delete value[key];
      return value;
    };
    const malformed = [
      ["null top-level value", null],
      ["array top-level value", []],
      ["missing schema", without("schema")],
      ["unknown schema", { ...valid, schema: "ngl.founder-trust-anchor.v0" }],
      ["missing status", without("status")],
      ["unknown status", { ...valid, status: "ACTIVE" }],
      ["unknown status with enrolled false", { ...valid, status: "ACTIVE", enrolled: false }],
      ["missing enrolled", without("enrolled")],
      ["false enrolled with ENROLLED status", { ...valid, enrolled: false }],
      ["missing mode", without("mode")],
      ["unknown mode", { ...valid, mode: "DEVELOPMENT" }],
      ["NOT_ENROLLED with enrolled true", { ...valid, status: "NOT_ENROLLED" }],
      ["incomplete NOT_ENROLLED sentinel", {
        schema: "ngl.founder-trust-anchor.v1",
        status: "NOT_ENROLLED",
        enrolled: false,
      }],
    ];
    for (const [label, value] of malformed) {
      writeFileSync(trustPath, JSON.stringify(value));
      const trust = loadTrustAnchor(trustPath);
      assert.equal(trust.enrolled, false, label);
      assert.equal(trust.reason, "MALFORMED_TRUST_ANCHOR", label);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TEST_ONLY anchors cannot authorize; PRODUCTION test anchors use a durable cross-process nonce ledger", async () => {
  const dir = path.join(tmpdir(), "ngl-auth-mode-" + process.pid + "-" + randomUUID());
  const modulePath = path.join(dir, "src", "authority", "decision.js");
  const trustPath = path.join(dir, "docs", "authority", "founder.pub.json");
  const dataDirectory = path.join(dir, "data");
  const nonceLedgerPath = path.join(dataDirectory, "founder-nonces.json");
  mkdirSync(path.dirname(modulePath), { recursive: true, mode: 0o700 });
  mkdirSync(path.dirname(trustPath), { recursive: true, mode: 0o700 });
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  try {
    const source = readFileSync(new URL("../src/authority/decision.js", import.meta.url), "utf8");
    writeFileSync(modulePath, source, { mode: 0o600 });
    const isolated = await import(pathToFileURL(modulePath).href + "?mode-test=" + randomUUID());
    const kp = keyPair();
    const payload = isolated.makeDecisionPayload({
      proposal,
      quest,
      capabilities: ["read"],
      outputs: ["test-output"],
      acceptance: ["verify"],
      expires_at: future,
    });
    const signed = signPayload(kp.privateKey, payload, kp.fingerprint);
    const anchor = mode => ({
      schema: "ngl.founder-trust-anchor.v1",
      status: "ENROLLED",
      enrolled: true,
      mode,
      public_key_jwk: kp.jwk,
      fingerprint: kp.fingerprint,
    });
    const environment = {
      NGL_FOUNDER_TRUST_ANCHOR_PATH: trustPath,
      NGL_FOUNDER_NONCE_LEDGER_PATH: nonceLedgerPath,
    };

    writeFileSync(trustPath, JSON.stringify(anchor("TEST_ONLY")), { mode: 0o600 });
    assert.equal(isolated.loadTrustAnchor().mode, "TEST_ONLY");
    withEnvironment(environment, () => {
      assert.throws(
        () => isolated.authorizationEvent({ signed, payload }),
        /FOUNDER_TRUST_MODE_INVALID/
      );
    });

    writeFileSync(trustPath, JSON.stringify(anchor("PRODUCTION")), { mode: 0o600 });
    withEnvironment({ NGL_FOUNDER_TRUST_ANCHOR_PATH: trustPath, NGL_FOUNDER_NONCE_LEDGER_PATH: null }, () => {
      assert.throws(
        () => isolated.authorizationEvent({ signed, payload }),
        /FOUNDER_NONCE_LEDGER_UNCONFIGURED/
      );
    });
    withEnvironment(environment, () => {
      const authorized = isolated.authorizationEvent({ signed, payload });
      assert.equal(authorized.type, "QUEST_AUTHORIZED");
      assert.equal(authorized.trust_mode, "PRODUCTION");
      assert.equal(Object.isFrozen(authorized), true);
      assert.equal(Object.isFrozen(authorized.capabilities), true);
      const saved = JSON.parse(readFileSync(nonceLedgerPath, "utf8"));
      assert.equal(saved.schema, "ngl.founder-nonce-ledger.v1");
      assert.deepEqual(saved.nonces, [signed.nonce]);
      assert.throws(
        () => isolated.authorizationEvent({ signed, payload }),
        /FOUNDER_DECISION_INVALID:NONCE_REPLAY/
      );

      const childSource =
        "import { authorizationEvent } from " + JSON.stringify(pathToFileURL(modulePath).href) + ";\n" +
        "try { authorizationEvent({ signed: JSON.parse(process.env.TEST_SIGNED), payload: JSON.parse(process.env.TEST_PAYLOAD) }); console.log(\"UNEXPECTED_AUTHORIZATION\"); process.exitCode = 1; }\n" +
        "catch (error) { console.log(error.message); process.exitCode = error.message === \"FOUNDER_DECISION_INVALID:NONCE_REPLAY\" ? 0 : 2; }\n";
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", childSource], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, TEST_SIGNED: JSON.stringify(signed), TEST_PAYLOAD: JSON.stringify(payload) },
      });
      assert.equal(child.status, 0, child.stderr);
      assert.match(child.stdout, /FOUNDER_DECISION_INVALID:NONCE_REPLAY/);

      const secondSigned = signPayload(kp.privateKey, payload, kp.fingerprint);
      const lockPath = path.join(dataDirectory, ".founder-nonce.lock");
      writeFileSync(lockPath, canonical({ schema: "ngl.ledger-lock.v1", pid: process.pid, openedAt: new Date().toISOString() }), { mode: 0o600 });
      assert.throws(
        () => isolated.authorizationEvent({ signed: secondSigned, payload }),
        /FOUNDER_NONCE_LEDGER_LOCKED/
      );
      unlinkSync(lockPath);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("trust anchors reject private JWK material and additional non-contract JWK fields", () => {
  const dir = path.join(tmpdir(), "ngl-auth-jwk-shape-" + process.pid + "-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  try {
    const kp = keyPair();
    const trustPath = path.join(dir, "founder.pub.json");
    const base = {
      schema: "ngl.founder-trust-anchor.v1",
      status: "ENROLLED",
      enrolled: true,
      mode: "PRODUCTION",
      public_key_jwk: kp.jwk,
      fingerprint: kp.fingerprint,
    };
    writeFileSync(trustPath, JSON.stringify({
      ...base,
      public_key_jwk: kp.privateKey.export({ format: "jwk" }),
    }));
    assert.equal(loadTrustAnchor(trustPath).reason, "PRIVATE_KEY_IN_TRUST_ANCHOR");

    writeFileSync(trustPath, JSON.stringify({
      ...base,
      public_key_jwk: { ...kp.jwk, alg: "ES256" },
    }));
    assert.equal(loadTrustAnchor(trustPath).reason, "MALFORMED_TRUST_ANCHOR");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test("decision payload snapshots and deeply freezes nested scope arrays", () => {
  const capabilities = ["read"];
  const outputs = ["artifact"];
  const acceptance = ["verify"];
  const payload = makeDecisionPayload({
    proposal,
    quest,
    capabilities,
    outputs,
    acceptance,
    expires_at: future,
  });

  capabilities.push("root");
  outputs[0] = "mutated";
  acceptance.length = 0;

  assert.deepEqual(payload.capabilities, ["read"]);
  assert.deepEqual(payload.outputs, ["artifact"]);
  assert.deepEqual(payload.acceptance, ["verify"]);
  assert.equal(Object.isFrozen(payload), true);
  assert.equal(Object.isFrozen(payload.capabilities), true);
  assert.equal(Object.isFrozen(payload.outputs), true);
  assert.equal(Object.isFrozen(payload.acceptance), true);
  assert.throws(() => payload.capabilities.push("admin"), TypeError);
});


test("concurrent processes serialize durable Founder nonce-ledger writes without losing entries", { timeout: 30000 }, async t => {
  const dir = path.join(tmpdir(), "ngl-auth-concurrency-" + randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fixture = createAuthorizationFixture(dir);
  const signed = Array.from({ length: 4 }, () => fixture.sign());
  const workers = signed.map(item => startAuthorizationWorker(fixture, item));
  const bounded = (promise, label, worker = null) => {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + (worker?.stderr ? ": " + worker.stderr : ""))), 10000);
      }),
    ]).finally(() => clearTimeout(timer));
  };

  try {
    const ready = await Promise.all(workers.map(worker => bounded(worker.nextLine(), "worker readiness", worker)));
    assert.deepEqual(ready, ["READY", "READY", "READY", "READY"]);
    for (const worker of workers) worker.child.stdin.end("go\n");

    const outcomes = await Promise.all(workers.map(worker => bounded(worker.nextLine(), "worker outcome", worker)));
    const exits = await Promise.all(workers.map(worker => bounded(worker.exit, "worker exit", worker)));
    assert.deepEqual(exits.map(item => item.code), [0, 0, 0, 0]);
    const locked = [];
    outcomes.forEach((outcome, index) => {
      if (outcome === "ERROR:FOUNDER_NONCE_LEDGER_LOCKED") locked.push(index);
      else assert.match(outcome, /^AUTHORIZED:/);
    });

    const retrySource = [
      "import { authorizationEvent } from " + JSON.stringify(fixture.moduleUrl) + ";",
      "const event = authorizationEvent({ signed: JSON.parse(process.env.TEST_SIGNED), payload: JSON.parse(process.env.TEST_PAYLOAD) });",
      "console.log('AUTHORIZED:' + event.event_id);",
    ].join("\n");
    for (const index of locked) {
      const retry = spawnSync(process.execPath, ["--input-type=module", "-e", retrySource], {
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
          NGL_FOUNDER_NONCE_LEDGER_PATH: fixture.nonceLedgerPath,
          TEST_SIGNED: JSON.stringify(signed[index]),
          TEST_PAYLOAD: JSON.stringify(fixture.payload),
        },
      });
      assert.equal(retry.status, 0, retry.stderr);
      assert.match(retry.stdout, /^AUTHORIZED:/m);
    }

    const saved = JSON.parse(readFileSync(fixture.nonceLedgerPath, "utf8"));
    assert.equal(saved.schema, "ngl.founder-nonce-ledger.v1");
    assert.deepEqual([...saved.nonces].sort(), signed.map(item => item.nonce).sort());
    assert.equal(new Set(saved.nonces).size, signed.length);
    assert.deepEqual(readdirSync(fixture.dataDirectory).sort(), ["founder-nonces.json"]);
  } finally {
    for (const worker of workers) {
      if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill("SIGKILL");
    }
    await Promise.allSettled(workers.map(worker => worker.exit));
  }
});

test("read-only writer-lock inspector recognizes a stale Founder nonce lock without authorizing deletion", async t => {
  const dir = path.join(tmpdir(), "ngl-auth-lock-inspector-" + randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lockPath = path.join(dir, ".founder-nonce.lock");
  writeFileSync(lockPath, canonical({
    schema: "ngl.ledger-lock.v1",
    pid: 2147483647,
    openedAt: new Date().toISOString(),
  }), { mode: 0o600 });

  const report = await inspectWriterLock(lockPath);
  assert.equal(report.status, "present");
  assert.equal(report.format, "owner-metadata");
  assert.equal(report.owner.schema, "ngl.ledger-lock.v1");
  assert.equal(report.owner.processProbe, "not-found");
  assert.equal(report.safeToRemove, false);
});

test("process death before nonce-ledger rename leaves an inspectable stale lock and uncommitted temporary file", { timeout: 30000 }, async t => {
  const dir = path.join(tmpdir(), "ngl-auth-crash-before-rename-" + randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fixture = createAuthorizationFixture(dir);
  const signed = fixture.sign();
  const markerPath = path.join(dir, "crash-boundary.marker");
  const worker = startCrashWorker(fixture, signed, "before-rename", markerPath);
  const lockPath = path.join(fixture.dataDirectory, ".founder-nonce.lock");

  try {
    await waitForMarker(markerPath, worker, "pre-rename crash worker");
    worker.child.kill("SIGKILL");
    const stopped = await worker.exit;
    assert.equal(stopped.signal, "SIGKILL", worker.stderr);
    assert.equal(readFileSync(markerPath, "utf8"), "before-rename");
    assert.equal(existsSync(fixture.nonceLedgerPath), false);

    const names = readdirSync(fixture.dataDirectory);
    const temporary = names.find(name => name.startsWith(".founder-nonce-") && name.endsWith(".tmp"));
    assert.ok(temporary, "the fsynced temporary ledger remains for offline inspection");
    assert.ok(names.includes(".founder-nonce.lock"), "process death leaves the owner lock in place");
    const inspection = await inspectWriterLock(lockPath);
    assert.equal(inspection.owner.processProbe, "not-found");
    assert.equal(inspection.safeToRemove, false);

    // Test-only offline recovery after independently observing that the child is dead.
    unlinkSync(path.join(fixture.dataDirectory, temporary));
    unlinkSync(lockPath);
    const event = withEnvironment({
      NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
      NGL_FOUNDER_NONCE_LEDGER_PATH: fixture.nonceLedgerPath,
    }, () => authorizationEvent({ signed, payload: fixture.payload }));
    assert.equal(event.type, "QUEST_AUTHORIZED");
    assert.deepEqual(JSON.parse(readFileSync(fixture.nonceLedgerPath, "utf8")).nonces, [signed.nonce]);
  } finally {
    if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill("SIGKILL");
    await Promise.allSettled([worker.exit]);
  }
});

test("process death after nonce-ledger rename retains the nonce and blocks replay after offline lock recovery", { timeout: 30000 }, async t => {
  const dir = path.join(tmpdir(), "ngl-auth-crash-after-rename-" + randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fixture = createAuthorizationFixture(dir);
  const signed = fixture.sign();
  const markerPath = path.join(dir, "crash-boundary.marker");
  const worker = startCrashWorker(fixture, signed, "after-rename", markerPath);
  const lockPath = path.join(fixture.dataDirectory, ".founder-nonce.lock");

  try {
    await waitForMarker(markerPath, worker, "post-rename crash worker");
    worker.child.kill("SIGKILL");
    const stopped = await worker.exit;
    assert.equal(stopped.signal, "SIGKILL", worker.stderr);
    assert.equal(readFileSync(markerPath, "utf8"), "after-rename-before-directory-sync");

    const saved = JSON.parse(readFileSync(fixture.nonceLedgerPath, "utf8"));
    assert.deepEqual(saved.nonces, [signed.nonce], "the atomic rename is visible before directory sync");
    const names = readdirSync(fixture.dataDirectory);
    assert.ok(names.includes(".founder-nonce.lock"), "process death leaves the owner lock in place");
    assert.equal(names.some(name => name.startsWith(".founder-nonce-") && name.endsWith(".tmp")), false);
    const inspection = await inspectWriterLock(lockPath);
    assert.equal(inspection.owner.processProbe, "not-found");
    assert.equal(inspection.safeToRemove, false);

    // Test-only offline recovery after independently observing that the child is dead.
    unlinkSync(lockPath);
    withEnvironment({
      NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
      NGL_FOUNDER_NONCE_LEDGER_PATH: fixture.nonceLedgerPath,
    }, () => assert.throws(
      () => authorizationEvent({ signed, payload: fixture.payload }),
      /FOUNDER_DECISION_INVALID:NONCE_REPLAY/
    ));
    assert.deepEqual(JSON.parse(readFileSync(fixture.nonceLedgerPath, "utf8")).nonces, [signed.nonce]);
    assert.equal(existsSync(lockPath), false);
  } finally {
    if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill("SIGKILL");
    await Promise.allSettled([worker.exit]);
  }
});


test("post-rename directory-sync failure preserves explicit nonce durability uncertainty and fences replay", { timeout: 30000 }, async t => {
  const dir = path.join(tmpdir(), "ngl-auth-durability-uncertain-" + randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fixture = createAuthorizationFixture(dir);
  const signed = fixture.sign();
  const childSource = [
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const originalFsyncSync = fs.fsyncSync;",
    "let directorySyncs = 0;",
    "fs.fsyncSync = descriptor => {",
    "  if (fs.fstatSync(descriptor).isDirectory()) {",
    "    directorySyncs += 1;",
    "    if (directorySyncs === 2) throw Object.assign(new Error('injected post-rename directory sync failure'), { code: 'EIO' });",
    "  }",
    "  return originalFsyncSync(descriptor);",
    "};",
    "syncBuiltinESMExports();",
    "const { authorizationEvent } = await import(" + JSON.stringify(fixture.moduleUrl) + ");",
    "try {",
    "  authorizationEvent({ signed: JSON.parse(process.env.TEST_SIGNED), payload: JSON.parse(process.env.TEST_PAYLOAD) });",
    "  console.log('UNEXPECTED_AUTHORIZATION');",
    "  process.exitCode = 1;",
    "} catch (error) {",
    "  console.log('ERROR:' + (error && error.message ? error.message : String(error)));",
    "}",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", childSource], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      ...process.env,
      NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
      NGL_FOUNDER_NONCE_LEDGER_PATH: fixture.nonceLedgerPath,
      TEST_SIGNED: JSON.stringify(signed),
      TEST_PAYLOAD: JSON.stringify(fixture.payload),
    },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /ERROR:FOUNDER_NONCE_DURABILITY_UNCERTAIN/);

  const lockPath = path.join(fixture.dataDirectory, ".founder-nonce.lock");
  assert.equal(JSON.parse(readFileSync(fixture.nonceLedgerPath, "utf8")).nonces[0], signed.nonce);
  assert.equal(existsSync(lockPath), true, "uncertain directory durability must retain the owner lock");
  const inspection = await inspectWriterLock(lockPath);
  assert.equal(inspection.owner.processProbe, "not-found");
  assert.equal(inspection.safeToRemove, false);

  // Test-only offline recovery after the child exited and the durable ledger was inspected.
  unlinkSync(lockPath);
  withEnvironment({
    NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
    NGL_FOUNDER_NONCE_LEDGER_PATH: fixture.nonceLedgerPath,
  }, () => assert.throws(
    () => authorizationEvent({ signed, payload: fixture.payload }),
    /FOUNDER_DECISION_INVALID:NONCE_REPLAY/
  ));
  assert.deepEqual(JSON.parse(readFileSync(fixture.nonceLedgerPath, "utf8")).nonces, [signed.nonce]);
  assert.equal(existsSync(lockPath), false);
});
