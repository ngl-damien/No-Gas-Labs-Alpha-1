import { createHash, timingSafeEqual } from "node:crypto";

const hex64=v=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const normalize=v=>String(v??"").normalize("NFKC").trim().toLowerCase();
const digest=(salt,answer)=>createHash("sha256").update("ngl-founder-recovery-v1\0").update(salt).update("\0").update(normalize(answer)).digest("hex");

export function createRecoveryPolicy({policy_id,threshold,challenges}) {
  if(typeof policy_id!=="string"||!policy_id)throw new Error("policy_id required");
  if(!Number.isSafeInteger(threshold)||threshold<2)throw new Error("threshold must be >=2");
  if(!Array.isArray(challenges)||challenges.length<threshold)throw new Error("insufficient challenges");
  const ids=new Set();
  for(const c of challenges){
    if(typeof c?.challenge_id!=="string"||!c.challenge_id||ids.has(c.challenge_id))throw new Error("unique challenge_id required");
    ids.add(c.challenge_id);
    if(typeof c.prompt!=="string"||c.prompt.length<8)throw new Error("challenge prompt required");
    if(typeof c.salt!=="string"||c.salt.length<16)throw new Error("salt required");
    if(!hex64(c.answer_commitment))throw new Error("answer commitment required");
  }
  return Object.freeze({schema:"ngl.founder-recovery-policy.v1",policy_id,threshold,challenges:challenges.map(c=>Object.freeze({...c}))});
}

export function answerCommitment({salt,answer}) {
  if(typeof salt!=="string"||salt.length<16)throw new Error("salt required");
  return digest(salt,answer);
}

export function verifyRecoveryAnswers({policy,responses}) {
  if(policy?.schema!=="ngl.founder-recovery-policy.v1")return Object.freeze({valid:false,reason:"POLICY_INVALID",matched:0});
  if(!Array.isArray(responses))return Object.freeze({valid:false,reason:"RESPONSES_INVALID",matched:0});
  const byId=new Map(policy.challenges.map(c=>[c.challenge_id,c]));
  const seen=new Set(); let matched=0;
  for(const r of responses){
    if(typeof r?.challenge_id!=="string"||seen.has(r.challenge_id))continue;
    seen.add(r.challenge_id);
    const c=byId.get(r.challenge_id); if(!c)continue;
    const got=Buffer.from(digest(c.salt,r.answer),"hex"), exp=Buffer.from(c.answer_commitment,"hex");
    if(got.length===exp.length&&timingSafeEqual(got,exp))matched++;
  }
  return Object.freeze({valid:matched>=policy.threshold,reason:matched>=policy.threshold?null:"QUORUM_NOT_MET",matched,required:policy.threshold});
}

export function recoveryAuthorization({policy,verification,new_key_fingerprint,ceremony_id}) {
  if(!verification?.valid)throw new Error("verified recovery quorum required");
  if(typeof new_key_fingerprint!=="string"||!new_key_fingerprint)throw new Error("new key fingerprint required");
  if(typeof ceremony_id!=="string"||!ceremony_id)throw new Error("ceremony_id required");
  return Object.freeze({schema:"ngl.founder-recovery-authorization.v1",ceremony_id,policy_id:policy.policy_id,matched:verification.matched,required:verification.required,new_key_fingerprint,claim:"AUTHENTICATED_AS_NGL_FOUNDER"});
}
