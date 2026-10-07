import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { decisionDigest, verifyFounderDecision } from "./decision.js";

function canonical(v){if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";if(v&&typeof v==="object")return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";return JSON.stringify(v)}
const sha=v=>createHash("sha256").update(canonical(v)).digest("hex");

export function makeRaeBridgePayload({founder_payload,rae_plan_id,rae_control_surface_id,rae_capabilities,nonce,not_before,expires_at}) {
  if (!founder_payload || founder_payload.schema!=="ngl.founder-decision.v1") throw new Error("Founder payload required");
  if (![rae_plan_id,rae_control_surface_id].every(v=>/^[a-f0-9]{64}$/.test(v))) throw new Error("RAE ids required");
  if (!Array.isArray(rae_capabilities)||!rae_capabilities.length) throw new Error("RAE capabilities required");
  if (!/^[a-f0-9]{32}$/.test(nonce)) throw new Error("RAE nonce required");
  if (![not_before,expires_at].every(Number.isSafeInteger)||not_before>=expires_at) throw new Error("valid RAE window required");
  const founder_expiry=Date.parse(founder_payload.expires_at);
  if (!Number.isFinite(founder_expiry)||expires_at>founder_expiry) throw new Error("RAE grant cannot outlive Founder decision");
  for(const capability of rae_capabilities) if(!founder_payload.capabilities.includes(capability)) throw new Error("RAE capability exceeds Founder decision");
  return Object.freeze({version:1,decision:"AUTHORIZE",plan_id:rae_plan_id,control_surface_id:rae_control_surface_id,capabilities:[...rae_capabilities],nonce,not_before,expires_at,founder_decision_sha256:decisionDigest(founder_payload)});
}

export function verifyFounderRaeBridge({founder_signed,founder_payload,founder_public_key_jwk,expected_fingerprint,rae_grant,rae_public_key,now=Date.now()}) {
  const founder=verifyFounderDecision({signed:founder_signed,payload:founder_payload,public_key_jwk:founder_public_key_jwk,expected_fingerprint,now});
  if(!founder.valid)return Object.freeze({valid:false,reason:"FOUNDER_"+founder.reason});
  const b=rae_grant?.body;
  if(!b||b.founder_decision_sha256!==decisionDigest(founder_payload))return Object.freeze({valid:false,reason:"FOUNDER_BINDING_MISMATCH"});
  if(b.expires_at>Date.parse(founder_payload.expires_at)||now<b.not_before||now>=b.expires_at)return Object.freeze({valid:false,reason:"RAE_WINDOW_INVALID"});
  if(b.capabilities.some(c=>!founder_payload.capabilities.includes(c)))return Object.freeze({valid:false,reason:"CAPABILITY_ESCALATION"});
  try {
    const key=createPublicKey(rae_public_key);
    const ok=verifySignature(null,Buffer.from(canonical(b)),key,Buffer.from(rae_grant.signature,"base64"));
    return Object.freeze({valid:ok,reason:ok?null:"RAE_SIGNATURE_INVALID",authorization_id:ok?sha(rae_grant):null});
  } catch { return Object.freeze({valid:false,reason:"RAE_SIGNATURE_INVALID"}); }
}
