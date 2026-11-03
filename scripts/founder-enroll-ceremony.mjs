#!/usr/bin/env node
/**
 * Founder enrollment ceremony — run on Founder's device only.
 * Generates ECDSA P-256 keypair. Prints public JWK + fingerprint for docs/authority/founder.pub.json.
 * Private key written ONLY if --write-private-path is given (local secure storage); default is print-once.
 */
import { generateKeyPairSync, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" });
const fingerprint = createHash("sha256")
  .update(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }))
  .digest("hex");

const anchor = {
  schema: "ngl.founder-trust-anchor.v1",
  status: "ENROLLED",
  enrolled: true,
  mode: "PRODUCTION",
  public_key_jwk: jwk,
  fingerprint,
  enrolled_at: new Date().toISOString(),
};

console.log(JSON.stringify(anchor, null, 2));
console.log("\n# Write the JSON above to docs/authority/founder.pub.json and commit.");
console.log("# fingerprint:", fingerprint);

const privFlag = process.argv.indexOf("--write-private-path");
if (privFlag !== -1 && process.argv[privFlag + 1]) {
  const priv = privateKey.export({ format: "jwk" });
  writeFileSync(process.argv[privFlag + 1], JSON.stringify(priv, null, 2), { mode: 0o600 });
  console.log("# private JWK written (mode 0600) — keep offline, never commit");
} else {
  console.log("# private key not written to disk (pass --write-private-path <file> on Founder device only)");
}
