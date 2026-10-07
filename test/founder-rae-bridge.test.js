import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,randomBytes} from "node:crypto";
import {makeRaeBridgePayload,verifyFounderRaeBridge} from "../src/authority/rae-bridge.js";
import {decisionDigest} from "../src/authority/decision.js";

const canonical=v=>Array.isArray(v)?"["+v.map(canonical).join(",")+"]":v&&typeof v==="object"?"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}":JSON.stringify(v);
const founderKeys=generateKeyPairSync("ec",{namedCurve:"P-256"});
const raeKeys=generateKeyPairSync("ed25519");
const fingerprint="founder-key-1";
const founder_payload={schema:"ngl.founder-decision.v1",proposal_id:"commission:founder-rae-bridge",quest_id:"founder-rae-bridge",capabilities:["artifact.read"],outputs:["receipt-000001"],acceptance:["execute-once","reject-replay"],expires_at:"2099-01-01T00:00:00.000Z"};
const founder_signed={payload_sha256:decisionDigest(founder_payload),key_fingerprint:fingerprint,signature:sign("sha256",Buffer.from(canonical(founder_payload)),founderKeys.privateKey).toString("base64url")};
const body=makeRaeBridgePayload({founder_payload,rae_plan_id:"1".repeat(64),rae_control_surface_id:"2".repeat(64),rae_capabilities:["artifact.read"],nonce:randomBytes(16).toString("hex"),not_before:0,expires_at:1000});
const grant={body,signature:sign(null,Buffer.from(canonical(body)),raeKeys.privateKey).toString("base64")};
const args={founder_signed,founder_payload,founder_public_key_jwk:founderKeys.publicKey.export({format:"jwk"}),expected_fingerprint:fingerprint,rae_grant:grant,rae_public_key:raeKeys.publicKey.export({type:"spki",format:"pem"}),now:1};

test("verified Founder ruling binds exact RAE authorization",()=>assert.equal(verifyFounderRaeBridge(args).valid,true));
test("different Founder ruling cannot inherit grant",()=>{const p={...founder_payload,outputs:["other"]};assert.equal(verifyFounderRaeBridge({...args,founder_payload:p}).valid,false)});
test("RAE capability cannot exceed Founder scope",()=>assert.throws(()=>makeRaeBridgePayload({...body,founder_payload,rae_plan_id:"1".repeat(64),rae_control_surface_id:"2".repeat(64),rae_capabilities:["trusted-code.execute"]}),/exceeds Founder/));
test("tampered RAE grant fails",()=>{const bad={...grant,body:{...grant.body,plan_id:"3".repeat(64)}};assert.equal(verifyFounderRaeBridge({...args,rae_grant:bad}).valid,false)});
test("RAE grant cannot outlive Founder ruling",()=>assert.throws(()=>makeRaeBridgePayload({founder_payload,rae_plan_id:"1".repeat(64),rae_control_surface_id:"2".repeat(64),rae_capabilities:["artifact.read"],nonce:"a".repeat(32),not_before:0,expires_at:Date.parse("2100-01-01")}),/outlive Founder/));
