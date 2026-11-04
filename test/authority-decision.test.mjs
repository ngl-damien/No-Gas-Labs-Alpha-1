import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, createHash, sign, randomUUID } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
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
  const nonceLedgerPath = path.join(dataDirectory, "founder-nonces.json");
  writeFileSync(nonceLedgerPath, canonical({
    schema: "ngl.founder-nonce-ledger.v1",
    nonces: [],
  }), { mode: 0o600 });
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
    nonceLedgerPath,
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

test("trust-anchor loader rejects a path swapped to a symlink during descriptor read", () => {
  const dir = path.join(tmpdir(), "ngl-auth-trust-race-" + process.pid + "-" + randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const trustPath = path.join(dir, "founder.pub.json");
  const replacementPath = path.join(dir, "replacement.pub.json");
  const anchorFor = kp => ({
    schema: "ngl.founder-trust-anchor.v1",
    status: "ENROLLED",
    enrolled: true,
    mode: "PRODUCTION",
    public_key_jwk: kp.jwk,
    fingerprint: kp.fingerprint,
  });
  writeFileSync(trustPath, JSON.stringify(anchorFor(keyPair())), { mode: 0o600 });
  writeFileSync(replacementPath, JSON.stringify(anchorFor(keyPair())), { mode: 0o600 });

  const originalReadSync = fs.readSync;
  let swapped = false;
  fs.readSync = (descriptor, buffer, offset, length, position) => {
    if (!swapped) {
      swapped = true;
      unlinkSync(trustPath);
      fs.symlinkSync(replacementPath, trustPath);
    }
    return originalReadSync(descriptor, buffer, offset, length, position);
  };
  syncBuiltinESMExports();
  try {
    const trust = loadTrustAnchor(trustPath);
    assert.equal(swapped, true);
    assert.equal(trust.enrolled, false);
    assert.equal(trust.reason, "MALFORMED_TRUST_ANCHOR");
  } finally {
    fs.readSync = originalReadSync;
    syncBuiltinESMExports();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("trust-anchor loader bounds descriptor reads when the file grows after its initial stat", () => {
  const dir = path.join(tmpdir(), "ngl-auth-trust-size-race-" + process.pid + "-" + randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const trustPath = path.join(dir, "founder.pub.json");
  const kp = keyPair();
  writeFileSync(trustPath, JSON.stringify({
    schema: "ngl.founder-trust-anchor.v1",
    status: "ENROLLED",
    enrolled: true,
    mode: "PRODUCTION",
    public_key_jwk: kp.jwk,
    fingerprint: kp.fingerprint,
  }), { mode: 0o600 });

  const originalReadSync = fs.readSync;
  let appended = false;
  let requestedBytes = 0;
  let returnedBytes = 0;
  fs.readSync = (descriptor, buffer, offset, length, position) => {
    requestedBytes += length;
    if (!appended) {
      appended = true;
      fs.appendFileSync(trustPath, "x".repeat(20_000));
    }
    const count = originalReadSync(descriptor, buffer, offset, length, position);
    returnedBytes += count;
    return count;
  };
  syncBuiltinESMExports();
  try {
    const trust = loadTrustAnchor(trustPath);
    assert.equal(appended, true);
    assert.equal(trust.enrolled, false);
    assert.equal(trust.reason, "MALFORMED_TRUST_ANCHOR");
    assert.ok(requestedBytes <= 16_385, "requested read capacity must remain bounded to max plus one byte");
    assert.ok(returnedBytes <= 16_385, "actual bytes read must remain bounded to max plus one byte");
  } finally {
    fs.readSync = originalReadSync;
    syncBuiltinESMExports();
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
    writeFileSync(nonceLedgerPath, canonical({
      schema: "ngl.founder-nonce-ledger.v1",
      nonces: [],
    }), { mode: 0o600 });
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

test("nonce-ledger reads remain bounded if the file grows after its initial stat", () => {
  const dir = path.join(tmpdir(), "ngl-auth-ledger-size-race-" + process.pid + "-" + randomUUID());
  const fixture = createAuthorizationFixture(dir);
  const maxBytes = 4 * 1024 * 1024;
  writeFileSync(fixture.nonceLedgerPath, canonical({
    schema: "ngl.founder-nonce-ledger.v1",
    nonces: [],
  }), { mode: 0o600 });
  const ledgerStat = fs.lstatSync(fixture.nonceLedgerPath);
  const signed = fixture.sign();

  const originalReadSync = fs.readSync;
  let appended = false;
  let requestedBytes = 0;
  let returnedBytes = 0;
  fs.readSync = (descriptor, buffer, offset, length, position) => {
    const opened = fs.fstatSync(descriptor);
    if (opened.dev === ledgerStat.dev && opened.ino === ledgerStat.ino) {
      requestedBytes += length;
      if (!appended) {
        appended = true;
        fs.appendFileSync(fixture.nonceLedgerPath, "x".repeat(maxBytes + 100));
      }
      const count = originalReadSync(descriptor, buffer, offset, length, position);
      returnedBytes += count;
      return count;
    }
    return originalReadSync(descriptor, buffer, offset, length, position);
  };
  syncBuiltinESMExports();
  try {
    withEnvironment({
      NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
      NGL_FOUNDER_NONCE_LEDGER_PATH: fixture.nonceLedgerPath,
    }, () => {
      assert.throws(
        () => authorizationEvent({ signed, payload: fixture.payload }),
        /FOUNDER_NONCE_LEDGER_UNAVAILABLE/
      );
    });
    assert.equal(appended, true);
    assert.ok(requestedBytes <= maxBytes + 1, "requested ledger read capacity must remain capped at 4 MiB plus one byte");
    assert.ok(returnedBytes <= maxBytes + 1, "actual ledger bytes read must remain capped at 4 MiB plus one byte");
    assert.equal(existsSync(path.join(fixture.dataDirectory, ".founder-nonce.lock")), false,
      "a rejected over-limit ledger must release its owned lock");
  } finally {
    fs.readSync = originalReadSync;
    syncBuiltinESMExports();
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


test("nonce writer cleanup retains a same-inode lock rewrite after a precommit ledger failure", () => {
  const dir = path.join(tmpdir(), "ngl-auth-writer-lock-cleanup-rewrite-" + randomUUID());
  const fixture = createAuthorizationFixture(dir);
  const signed = fixture.sign();
  const lockPath = path.join(fixture.dataDirectory, ".founder-nonce.lock");
  const invalidLedger = Buffer.from('{"schema":"wrong","nonces":[]}');
  const replacementOpenedAt = "2002-02-02T00:00:00.000Z";
  writeFileSync(fixture.nonceLedgerPath, invalidLedger, { mode: 0o600 });
  const originalLstat = fs.lstatSync;
  let rewritten = false;

  fs.lstatSync = (candidate, ...args) => {
    const observed = originalLstat(candidate, ...args);
    if (!rewritten && candidate === fixture.nonceLedgerPath) {
      rewritten = true;
      writeFileSync(lockPath, canonical({
        schema: "ngl.ledger-lock.v1",
        pid: process.pid,
        openedAt: replacementOpenedAt,
      }), { mode: 0o600 });
    }
    return observed;
  };
  syncBuiltinESMExports();

  try {
    withEnvironment({
      NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
      NGL_FOUNDER_NONCE_LEDGER_PATH: fixture.nonceLedgerPath,
    }, () => {
      assert.throws(
        () => authorizationEvent({ signed, payload: fixture.payload }),
        /FOUNDER_NONCE_LEDGER_TAMPERED/
      );
    });
    assert.equal(rewritten, true, "the rewrite must occur while the writer handles the precommit ledger read");
    assert.equal(existsSync(lockPath), true, "failure cleanup must retain a changed owner receipt");
    const retained = JSON.parse(readFileSync(lockPath, "utf8"));
    assert.equal(retained.pid, process.pid);
    assert.equal(retained.openedAt, replacementOpenedAt);
    assert.deepEqual(readFileSync(fixture.nonceLedgerPath), invalidLedger);
    assert.deepEqual(readdirSync(fixture.dataDirectory).sort(), [".founder-nonce.lock", "founder-nonces.json"]);
  } finally {
    fs.lstatSync = originalLstat;
    syncBuiltinESMExports();
    rmSync(dir, { recursive: true, force: true });
  }
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

test("nonce writer retains a same-inode owner-lock rewrite instead of unlinking it during release", () => {
  const dir = path.join(tmpdir(), "ngl-auth-writer-lock-rewrite-" + randomUUID());
  const fixture = createAuthorizationFixture(dir);
  const signed = fixture.sign();
  const lockPath = path.join(fixture.dataDirectory, ".founder-nonce.lock");
  const replacementOpenedAt = "2001-01-01T00:00:00.000Z";
  const originalLstat = fs.lstatSync;
  let rewritten = false;
  let lockPathLstatCalls = 0;

  fs.lstatSync = (candidate, ...args) => {
    const observed = originalLstat(candidate, ...args);
    if (candidate === lockPath) {
      lockPathLstatCalls += 1;
      if (!rewritten && lockPathLstatCalls === 3) {
        rewritten = true;
        writeFileSync(lockPath, canonical({
          schema: "ngl.ledger-lock.v1",
          pid: process.pid,
          openedAt: replacementOpenedAt,
        }), { mode: 0o600 });
      }
    }
    return observed;
  };
  syncBuiltinESMExports();

  try {
    withEnvironment({
      NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
      NGL_FOUNDER_NONCE_LEDGER_PATH: fixture.nonceLedgerPath,
    }, () => {
      assert.throws(
        () => authorizationEvent({ signed, payload: fixture.payload }),
        /FOUNDER_NONCE_LEDGER_LOCK_CHANGED/
      );
    });
    assert.equal(rewritten, true, "the rewrite must occur at the release check, after pre-commit ownership validation");
    assert.equal(lockPathLstatCalls, 3, "two pre-commit pathname checks must precede the release check");
    const retained = JSON.parse(readFileSync(lockPath, "utf8"));
    assert.equal(retained.pid, process.pid);
    assert.equal(retained.openedAt, replacementOpenedAt);
    const ledger = JSON.parse(readFileSync(fixture.nonceLedgerPath, "utf8"));
    assert.deepEqual(ledger.nonces, [signed.nonce], "the nonce remains committed even though lock release is uncertain");
    assert.deepEqual(readdirSync(fixture.dataDirectory).sort(), [".founder-nonce.lock", "founder-nonces.json"]);
  } finally {
    fs.lstatSync = originalLstat;
    syncBuiltinESMExports();
    rmSync(dir, { recursive: true, force: true });
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
    assert.deepEqual(JSON.parse(readFileSync(fixture.nonceLedgerPath, "utf8")).nonces, [],
      "pre-rename process death leaves the initialized empty ledger unchanged");

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


test("host trust anchor rejects a private leaf below a writable non-sticky ancestor", () => {
  const dir = path.join(tmpdir(), "ngl-auth-trust-writable-parent-" + process.pid + "-" + randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const fixture = createAuthorizationFixture(dir);
  const signed = fixture.sign();
  fs.chmodSync(dir, 0o777);
  try {
    withEnvironment({
      NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
      NGL_FOUNDER_NONCE_LEDGER_PATH: fixture.nonceLedgerPath,
    }, () => assert.throws(
      () => authorizationEvent({ signed, payload: fixture.payload }),
      /FOUNDER_TRUST_ROOT_UNSAFE/
    ));
  } finally {
    fs.chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Founder nonce ledger rejects a private leaf below a writable non-sticky ancestor", () => {
  const dir = path.join(tmpdir(), "ngl-auth-ledger-writable-parent-" + process.pid + "-" + randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const fixture = createAuthorizationFixture(dir);
  const signed = fixture.sign();
  const unsafeParent = path.join(dir, "unsafe-parent");
  const privateDirectory = path.join(unsafeParent, "private");
  mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(unsafeParent, 0o777);
  try {
    withEnvironment({
      NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
      NGL_FOUNDER_NONCE_LEDGER_PATH: path.join(privateDirectory, "founder-nonces.json"),
    }, () => assert.throws(
      () => authorizationEvent({ signed, payload: fixture.payload }),
      /FOUNDER_NONCE_LEDGER_UNSAFE/
    ));
  } finally {
    fs.chmodSync(unsafeParent, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});


test("nonce ledger path rejects both reserved lock filenames before creating state", () => {
  const dir = path.join(tmpdir(), "ngl-auth-reserved-ledger-path-" + process.pid + "-" + randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    const fixture = createAuthorizationFixture(dir);
    const signed = fixture.sign();
    unlinkSync(fixture.nonceLedgerPath);
    const ownerLockPath = path.join(fixture.dataDirectory, ".founder-nonce.lock");
    const recoveryLeasePath = path.join(fixture.dataDirectory, ".founder-nonce-recovery.lock");
    const temporaryLedgerPath = path.join(fixture.dataDirectory, ".founder-nonce-" + randomUUID() + ".tmp");

    for (const ledgerPath of [ownerLockPath, recoveryLeasePath, temporaryLedgerPath]) {
      withEnvironment({
        NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
        NGL_FOUNDER_NONCE_LEDGER_PATH: ledgerPath,
      }, () => assert.throws(
        () => authorizationEvent({ signed, payload: fixture.payload }),
        /FOUNDER_NONCE_LEDGER_PATH_INVALID/
      ));
      assert.equal(existsSync(ownerLockPath), false, "invalid paths must not acquire the owner lock");
      assert.equal(existsSync(recoveryLeasePath), false, "invalid paths must not create a ledger at the recovery-lease name");
      assert.equal(existsSync(temporaryLedgerPath), false, "invalid paths must not create a ledger in the temporary-file namespace");
      assert.deepEqual(readdirSync(fixture.dataDirectory), []);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test("a pre-existing recovery lease blocks nonce writes before lock acquisition", () => {
  const dir = path.join(tmpdir(), "ngl-auth-recovery-lease-existing-" + process.pid + "-" + randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    const fixture = createAuthorizationFixture(dir);
    const signed = fixture.sign();
    const recoveryLeasePath = path.join(fixture.dataDirectory, ".founder-nonce-recovery.lock");
    writeFileSync(recoveryLeasePath, canonical({
      schema: "ngl.founder-nonce-recovery.v1",
      pid: process.pid,
      openedAt: new Date().toISOString(),
    }), { mode: 0o600 });

    withEnvironment({
      NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
      NGL_FOUNDER_NONCE_LEDGER_PATH: fixture.nonceLedgerPath,
    }, () => assert.throws(
      () => authorizationEvent({ signed, payload: fixture.payload }),
      /FOUNDER_NONCE_RECOVERY_IN_PROGRESS/
    ));

    assert.equal(existsSync(path.join(fixture.dataDirectory, ".founder-nonce.lock")), false);
    assert.deepEqual(JSON.parse(readFileSync(fixture.nonceLedgerPath, "utf8")).nonces, [],
      "a recovery lease must not mutate the initialized ledger");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a recovery lease appearing after writer lock creation fences nonce mutation and releases only the writer lock", () => {
  const dir = path.join(tmpdir(), "ngl-auth-recovery-lease-race-" + process.pid + "-" + randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    const fixture = createAuthorizationFixture(dir);
    const signed = fixture.sign();
    const recoveryLeasePath = path.join(fixture.dataDirectory, ".founder-nonce-recovery.lock");
    const childSource = [
      "import fs from 'node:fs';",
      "import { syncBuiltinESMExports } from 'node:module';",
      "const originalOpenSync = fs.openSync;",
      "let injected = false;",
      "fs.openSync = (target, ...args) => {",
      "  const descriptor = originalOpenSync(target, ...args);",
      "  if (!injected && String(target).endsWith('.founder-nonce.lock')) {",
      "    injected = true;",
      "    const lease = originalOpenSync(process.env.TEST_RECOVERY_LEASE, 'wx', 0o600);",
      "    fs.writeFileSync(lease, JSON.stringify({ schema: 'ngl.founder-nonce-recovery.v1', pid: process.pid, openedAt: new Date().toISOString() }));",
      "    fs.fsyncSync(lease);",
      "    fs.closeSync(lease);",
      "  }",
      "  return descriptor;",
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
        TEST_RECOVERY_LEASE: recoveryLeasePath,
        TEST_SIGNED: JSON.stringify(signed),
        TEST_PAYLOAD: JSON.stringify(fixture.payload),
      },
    });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /ERROR:FOUNDER_NONCE_RECOVERY_IN_PROGRESS/);
    assert.deepEqual(JSON.parse(readFileSync(fixture.nonceLedgerPath, "utf8")).nonces, [],
      "a racing recovery lease must leave the initialized ledger unchanged");
    assert.equal(existsSync(path.join(fixture.dataDirectory, ".founder-nonce.lock")), false);
    assert.equal(existsSync(recoveryLeasePath), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test("nonce writer refuses to publish after its owner lock disappears before ledger rename", () => {
  const dir = path.join(tmpdir(), "ngl-auth-missing-writer-lock-precommit-" + process.pid + "-" + randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    const fixture = createAuthorizationFixture(dir);
    const signed = fixture.sign();
    const lockPath = path.join(fixture.dataDirectory, ".founder-nonce.lock");
    const originalFsyncSync = fs.fsyncSync;
    let fileSyncs = 0;
    let removed = false;
    fs.fsyncSync = descriptor => {
      if (fs.fstatSync(descriptor).isFile()) {
        fileSyncs += 1;
        if (fileSyncs === 2) {
          removed = true;
          unlinkSync(lockPath);
        }
      }
      return originalFsyncSync(descriptor);
    };
    syncBuiltinESMExports();
    try {
      withEnvironment({
        NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
        NGL_FOUNDER_NONCE_LEDGER_PATH: fixture.nonceLedgerPath,
      }, () => {
        assert.throws(
          () => authorizationEvent({ signed, payload: fixture.payload }),
          /FOUNDER_NONCE_LEDGER_LOCK_CHANGED/
        );
      });
      assert.equal(fileSyncs, 2, "the lock is removed after its receipt and temporary ledger file are fsynced");
      assert.equal(removed, true, "the test must remove the owner lock at the pre-rename boundary");
      assert.deepEqual(JSON.parse(readFileSync(fixture.nonceLedgerPath, "utf8")).nonces, [],
        "a nonce must not be committed after ownership of the writer lock is lost");
      assert.equal(readdirSync(fixture.dataDirectory).some(name => /^\.founder-nonce-.*\.tmp$/.test(name)), false,
        "the uncommitted temporary ledger file must be cleaned up");
    } finally {
      fs.fsyncSync = originalFsyncSync;
      syncBuiltinESMExports();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test("nonce authorization reports uncertainty when its owner lock disappears during ledger rename", () => {
  const dir = path.join(tmpdir(), "ngl-auth-missing-writer-lock-postcheck-" + process.pid + "-" + randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    const fixture = createAuthorizationFixture(dir);
    const signed = fixture.sign();
    const lockPath = path.join(fixture.dataDirectory, ".founder-nonce.lock");
    const originalRenameSync = fs.renameSync;
    let removed = false;
    fs.renameSync = (from, to) => {
      if (!removed && to === fixture.nonceLedgerPath) {
        removed = true;
        unlinkSync(lockPath);
      }
      return originalRenameSync(from, to);
    };
    syncBuiltinESMExports();
    try {
      withEnvironment({
        NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
        NGL_FOUNDER_NONCE_LEDGER_PATH: fixture.nonceLedgerPath,
      }, () => {
        assert.throws(
          () => authorizationEvent({ signed, payload: fixture.payload }),
          /FOUNDER_NONCE_LEDGER_LOCK_CHANGED/
        );
      });
      assert.equal(removed, true, "the test must remove the owner lock after pre-rename validation");
      const ledger = JSON.parse(readFileSync(fixture.nonceLedgerPath, "utf8"));
      assert.deepEqual(ledger.nonces, [signed.nonce],
        "the nonce commit is durable even though lock release is uncertain");
      assert.equal(existsSync(lockPath), false, "the externally removed lock must not be recreated or mistaken for owned");
    } finally {
      fs.renameSync = originalRenameSync;
      syncBuiltinESMExports();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing nonce ledger fails closed instead of resetting consumed replay history", () => {
  const dir = path.join(tmpdir(), "ngl-auth-missing-ledger-replay-" + randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    const fixture = createAuthorizationFixture(dir);
    const signed = fixture.sign();
    const environment = {
      NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
      NGL_FOUNDER_NONCE_LEDGER_PATH: fixture.nonceLedgerPath,
    };

    const first = withEnvironment(environment, () =>
      authorizationEvent({ signed, payload: fixture.payload }));
    assert.equal(first.type, "QUEST_AUTHORIZED");
    const committed = readFileSync(fixture.nonceLedgerPath);
    assert.deepEqual(JSON.parse(committed.toString("utf8")).nonces, [signed.nonce]);

    unlinkSync(fixture.nonceLedgerPath);
    withEnvironment(environment, () => {
      assert.throws(
        () => authorizationEvent({ signed, payload: fixture.payload }),
        /FOUNDER_NONCE_LEDGER_ABSENT/
      );
    });
    assert.equal(existsSync(fixture.nonceLedgerPath), false,
      "authorization must not recreate an absent replay ledger");
    assert.equal(existsSync(path.join(fixture.dataDirectory, ".founder-nonce.lock")), false,
      "the failed writer must release only its own lock");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nonce writer cannot authorize through a replacement ledger directory at commit", () => {
  const dir = path.join(tmpdir(), "ngl-auth-directory-swap-" + randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    const fixture = createAuthorizationFixture(dir);
    const signed = fixture.sign();
    const movedDirectory = path.join(dir, "data-original");
    const replacementStaging = path.join(dir, "data-replacement-staging");
    const replacementDirectory = path.join(dir, "data-replacement");
    mkdirSync(replacementStaging, { mode: 0o700 });
    fs.chmodSync(replacementStaging, 0o700);
    const originalOpenSync = fs.openSync;
    const originalRenameSync = fs.renameSync;
    const linkedNames = new Set();
    let swapped = false;
    let firstEvent = null;
    let firstError = null;
    let replayEvent = null;

    fs.openSync = (target, ...args) => {
      const descriptor = originalOpenSync(target, ...args);
      const name = path.basename(String(target));
      if ((name === ".founder-nonce.lock" || (name.startsWith(".founder-nonce-") && name.endsWith(".tmp"))) &&
          !linkedNames.has(name)) {
        fs.linkSync(target, path.join(replacementStaging, name));
        linkedNames.add(name);
      }
      return descriptor;
    };
    fs.renameSync = (from, to) => {
      if (!swapped && path.basename(to) === "founder-nonces.json") {
        swapped = true;
        originalRenameSync(fixture.dataDirectory, movedDirectory);
        originalRenameSync(replacementStaging, fixture.dataDirectory);
      }
      return originalRenameSync(from, to);
    };
    syncBuiltinESMExports();

    try {
      withEnvironment({
        NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
        NGL_FOUNDER_NONCE_LEDGER_PATH: fixture.nonceLedgerPath,
      }, () => {
        try {
          firstEvent = authorizationEvent({ signed, payload: fixture.payload });
        } catch (error) {
          firstError = error;
        }
      });
    } finally {
      fs.openSync = originalOpenSync;
      fs.renameSync = originalRenameSync;
      syncBuiltinESMExports();
      if (swapped) {
        if (existsSync(fixture.dataDirectory)) {
          originalRenameSync(fixture.dataDirectory, replacementDirectory);
        }
        if (existsSync(movedDirectory)) {
          originalRenameSync(movedDirectory, fixture.dataDirectory);
        }
      }
    }

    assert.equal(swapped, true, "the directory replacement must occur at the ledger commit boundary");
    if (firstEvent) {
      assert.equal(firstEvent.type, "QUEST_AUTHORIZED");
      assert.deepEqual(
        JSON.parse(readFileSync(path.join(replacementDirectory, "founder-nonces.json"), "utf8")).nonces,
        [signed.nonce],
        "the vulnerable writer commits replay history into the replacement directory"
      );
      assert.deepEqual(JSON.parse(readFileSync(fixture.nonceLedgerPath, "utf8")).nonces, [],
        "the original configured directory retains its pre-commit replay history");
      const originalLockPath = path.join(fixture.dataDirectory, ".founder-nonce.lock");
      assert.equal(existsSync(originalLockPath), true,
        "the original owner lock remains after the replacement hard link is released");
      unlinkSync(originalLockPath);
      replayEvent = withEnvironment({
        NGL_FOUNDER_TRUST_ANCHOR_PATH: fixture.trustPath,
        NGL_FOUNDER_NONCE_LEDGER_PATH: fixture.nonceLedgerPath,
      }, () => authorizationEvent({ signed, payload: fixture.payload }));
    }

    assert.equal(replayEvent, null,
      "the same signed nonce must not be authorized again after the configured directory is replaced");
    assert.equal(firstEvent, null, "directory replacement must not produce an authorization event");
    assert.ok(firstError, "directory replacement must fail closed");
    assert.match(firstError.message, /FOUNDER_NONCE_LEDGER_DIRECTORY_CHANGED/);
    assert.equal(existsSync(path.join(replacementDirectory, "founder-nonces.json")), false,
      "the replacement directory must never receive the canonical nonce ledger");
    assert.equal(existsSync(path.join(fixture.dataDirectory, ".founder-nonce.lock")), true,
      "the pinned original directory retains its owner lock for inspection");
    const originalLedger = JSON.parse(readFileSync(fixture.nonceLedgerPath, "utf8"));
    assert.ok(
      originalLedger.nonces.length === 0 ||
      (originalLedger.nonces.length === 1 && originalLedger.nonces[0] === signed.nonce),
      "nonce history may remain unchanged or be committed to the pinned original directory, never redirected"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
