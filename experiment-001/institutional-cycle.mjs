import { mkdir, readFile, rename, open } from "node:fs/promises";
import { join } from "node:path";
import { createHash, createPublicKey, verify } from "node:crypto";

// Single-writer experiment. Verifier receives only a pinned public key.
// Signing is performed by a separate actor, never by this module.
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const initial = () => ({version:2, sequence:0, previous:"GENESIS", records:[], capabilities:{}, used:[], invocations:[]});
const domain = "NGL-INSTITUTIONAL-CYCLE-v2";
export function challenge(strategy) {
  const cases = [{n:2,out:4},{n:3,out:9},{n:5,out:25},{n:-4,out:16}];
  const implementation = strategy === "square" ? n => n*n : strategy === "double" ? n => 2*n : null;
  const failed = cases.filter(c => !implementation || implementation(c.n) !== c.out).map(c => c.n);
  return {total:cases.length, passed:cases.length-failed.length, failed};
}
export function competition() {
  return ["double","square"].map(strategy => ({strategy, result:challenge(strategy)}));
}
const payload=(sequence,previous,decision)=>({domain,sequence,previous,decision});
function authorized(key,envelope,signature) {
  if (typeof signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) return false;
  const bytes=Buffer.from(signature,"base64");
  return bytes.length===64 && bytes.toString("base64")===signature &&
    verify(null,Buffer.from(JSON.stringify(envelope)),key,bytes);
}
function apply(state,record,key) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw Error("INVALID_RECORD");
  if (record.sequence!==state.sequence+1 || record.previous!==state.previous) throw Error("BROKEN_CHAIN");
  const envelope=payload(record.sequence,record.previous,record.decision);
  if (!authorized(key,envelope,record.signature)) throw Error("UNAUTHORIZED_RECORD");
  if (record.hash!==hash({...envelope,signature:record.signature})) throw Error("BAD_RECORD_HASH");
  const d=record.decision;
  if (!d || typeof d!=="object" || Array.isArray(d)) throw Error("INVALID_DECISION");
  if (d.kind==="INSTALL") {
    if (typeof d.id!=="string" || !d.id || state.capabilities[d.id]) throw Error("ALREADY_INSTALLED");
    const proof=challenge(d.strategy);
    if (proof.total<2 || proof.passed!==proof.total || JSON.stringify(proof)!==JSON.stringify(d.proof)) throw Error("PROOF_REJECTED");
    state.capabilities[d.id]={strategy:d.strategy,proof,installedAt:record.sequence};
  } else if (d.kind==="REUSE") {
    const capability=state.capabilities[d.id];
    if (!capability) throw Error("CAPABILITY_NOT_FOUND");
    if (typeof d.nonce!=="string" || !d.nonce || state.used.includes(d.nonce)) throw Error("REPLAY");
    if (!Number.isSafeInteger(d.input) || Math.abs(d.input)>1000000) throw Error("INVALID_INPUT");
    const output=capability.strategy==="square"?d.input*d.input:capability.strategy==="double"?2*d.input:null;
    if (d.output!==output) throw Error("OUTPUT_MISMATCH");
    state.used.push(d.nonce);
    state.invocations.push({id:d.id,nonce:d.nonce,input:d.input,output});
  } else throw Error("UNKNOWN_DECISION");
  state.records.push(record);
  state.sequence=record.sequence;
  state.previous=record.hash;
  return state;
}
export async function openInstitution(directory,verifierPublicKey) {
  if (!verifierPublicKey) throw Error("PUBLIC_KEY_REQUIRED");
  const key=verifierPublicKey?.type==="public" ? verifierPublicKey : createPublicKey(verifierPublicKey);
  if (key.asymmetricKeyType!=="ed25519") throw Error("ED25519_REQUIRED");
  await mkdir(directory,{recursive:true});
  const path=join(directory,"institution.json");
  let state;
  try {state=JSON.parse(await readFile(path,"utf8"));}
  catch(e) {if(e.code!=="ENOENT") throw e;state=initial();}
  if (!state || state.version!==2 || !Array.isArray(state.records)) throw Error("INVALID_LEDGER");
  const replay=initial();
  for(const record of state.records) apply(replay,record,key);
  if(JSON.stringify(replay)!==JSON.stringify(state)) throw Error("LEDGER_MISMATCH");
  return {
    snapshot:()=>structuredClone(state),
    proposal:decision=>structuredClone(payload(state.sequence+1,state.previous,decision)),
    async commit(decision,signature) {
      // Do not retain a mutable caller-owned decision inside a signed record.
      // The signature must authorize the same detached bytes we persist and replay.
      const detached=structuredClone(decision);
      const envelope=payload(state.sequence+1,state.previous,detached);
      if (!authorized(key,envelope,signature)) throw Error("UNAUTHORIZED");
      const next=structuredClone(state);
      const record={...envelope,signature};
      record.hash=hash(record);
      apply(next,record,key);
      // Detect sequential stale handles before writing; not a concurrent transaction.
      let persisted;
      try { persisted=await readFile(path,"utf8"); }
      catch(e) { if(e.code!=="ENOENT") throw e; persisted=null; }
      if (persisted===null ? state.sequence!==0 : persisted!==JSON.stringify(state)) throw Error("STALE_STATE");
      const temp=path+".tmp";
      const handle=await open(temp,"wx");
      try {await handle.writeFile(JSON.stringify(next));await handle.sync();}
      finally {await handle.close();}
      await rename(temp,path);
      state=next;
      return structuredClone(record);
    }
  };
}
export async function demonstrate(directory,verifierPublicKey,authorize) {
  if (typeof authorize!=="function") throw Error("EXTERNAL_AUTHORIZATION_REQUIRED");
  const proposals=competition();
  const winner=proposals.find(p=>p.result.passed===p.result.total);
  if(!winner) throw Error("NO_WINNER");
  const institution=await openInstitution(directory,verifierPublicKey);
  if(!institution.snapshot().capabilities["square-v1"]) {
    const decision={kind:"INSTALL",id:"square-v1",strategy:winner.strategy,proof:winner.result};
    await institution.commit(decision,await authorize(institution.proposal(decision)));
  }
  return {proposals,capability:institution.snapshot().capabilities["square-v1"]};
}
