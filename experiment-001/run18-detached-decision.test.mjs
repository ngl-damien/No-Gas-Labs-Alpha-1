import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openInstitution, challenge } from "./institutional-cycle.mjs";

test("signed decision bytes are detached from later caller mutations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ngl-authority-regression-"));
  const previousPin = process.env.NGL_FOUNDER_ED25519_SPKI_SHA256;
  try {
    const key = generateKeyPairSync("ed25519");
    process.env.NGL_FOUNDER_ED25519_SPKI_SHA256 = createHash("sha256")
      .update(key.publicKey.export({ type: "spki", format: "der" }))
      .digest("hex");
    const institution = await openInstitution(dir, key.publicKey);
    const decision = { kind: "INSTALL", id: "approved", strategy: "square", proof: challenge("square") };
    const signature = sign(null, Buffer.from(JSON.stringify(institution.proposal(decision))), key.privateKey).toString("base64");
    await institution.commit(decision, signature);
    decision.id = "unapproved";
    decision.proof.passed = 0;
    assert.equal(institution.snapshot().records[0].decision.id, "approved");
    assert.equal(institution.snapshot().capabilities.approved.strategy, "square");
    assert.equal((await openInstitution(dir, key.publicKey)).snapshot().records[0].decision.id, "approved");
  } finally {
    if (previousPin === undefined) delete process.env.NGL_FOUNDER_ED25519_SPKI_SHA256;
    else process.env.NGL_FOUNDER_ED25519_SPKI_SHA256 = previousPin;
    await rm(dir, { recursive: true, force: true });
  }
});
