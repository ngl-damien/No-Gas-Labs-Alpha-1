import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

function canonical(v){if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";if(v&&typeof v==="object")return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";return JSON.stringify(v)}
export const decisionDigest=payload=>createHash("sha256").update(canonical(payload)).digest("hex");

export function makeDecisionPayload({proposal,quest,capabilities,outputs,acceptance,expires_at}) {
  if (!proposal?.event_id||proposal.type!=="PROPOSAL") throw new Error("proposal required");
  if (!quest?.quest_id||proposal.quest_id!==quest.quest_id) throw new Error("quest binding mismatch");
  if (![capabilities,outputs,acceptance].every(Array.isArray)) throw new Error("decision scope arrays required");
  if (!expires_at||!Number.isFinite(Date.parse(expires_at))) throw new Error("valid expiry required");
  return Object.freeze({schema:"ngl.founder-decision.v1",proposal_id:proposal.event_id,quest_id:quest.quest_id,capabilities:[...capabilities],outputs:[...outputs],acceptance:[...acceptance],expires_at});
}

export function verifyFounderDecision({signed,payload,public_key_jwk,expected_fingerprint,now=Date.now()}) {
  if (!signed||signed.payload_sha256!==decisionDigest(payload)) return Object.freeze({valid:false,reason:"PAYLOAD_DIGEST_MISMATCH"});
  if (signed.key_fingerprint!==expected_fingerprint) return Object.freeze({valid:false,reason:"KEY_NOT_ENROLLED"});
  if (now>=Date.parse(payload.expires_at)) return Object.freeze({valid:false,reason:"DECISION_EXPIRED"});
  try {
    const key=createPublicKey({key:public_key_jwk,format:"jwk"});
    const ok=verifySignature("sha256",Buffer.from(canonical(payload)),key,Buffer.from(signed.signature,"base64url"));
    return Object.freeze({valid:ok,reason:ok?null:"SIGNATURE_INVALID"});
  } catch { return Object.freeze({valid:false,reason:"SIGNATURE_INVALID"}); }
}

export function authorizationEvent({signed,payload,public_key_jwk,expected_fingerprint,now=Date.now()}) {
  const verification=verifyFounderDecision({signed,payload,public_key_jwk,expected_fingerprint,now});
  if (!verification.valid) throw new Error(`verified Founder decision required: ${verification.reason}`);
  return Object.freeze({event_id:`authorize:${payload.proposal_id}:${signed.payload_sha256}`,type:"QUEST_AUTHORIZED",quest_id:payload.quest_id,proposal_id:payload.proposal_id,grant_id:signed.payload_sha256,actor:"founder",capabilities:payload.capabilities,outputs:payload.outputs,acceptance:payload.acceptance,expires_at:payload.expires_at,key_fingerprint:signed.key_fingerprint});
}
