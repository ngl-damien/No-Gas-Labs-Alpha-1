import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, createHash, sign, randomUUID } from "node:crypto";
import { writeFileSync, readFileSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import {
  makeDecisionPayload,
  decisionDigest,
  verifyFounderDecision,
  authorizationEvent,
  loadTrustAnchor,
  linkReceipt,
  newNonce,
} from "../src/authority/decision.js";

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
    assert.throws(() => authorizationEvent({ signed, payload }), /FOUNDER_TRUST_ROOT_UNCONFIGURED/);
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
