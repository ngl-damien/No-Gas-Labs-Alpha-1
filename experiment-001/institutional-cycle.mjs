import { mkdir, readFile, writeFile, rename, open } from "node:fs/promises";
import { join } from "node:path";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Experimental bounded institution, not a general autonomous agent or trusted identity provider.
// A single process owns the directory. Do not run concurrent writers or use as production storage.
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const mac = (key, value) => createHmac("sha256", key).update(JSON.stringify(value)).digest("hex");
const initial = () => ({version:1, sequence:0, previous:"GENESIS", records:[], capabilities:{}, used:[]});
export function signDecision(key, decision) { return mac(key, decision); }
export function challenge(strategy) {
  const cases = [{n:2,out:4},{n:3,out:9},{n:5,out:25},{n:-4,out:16}];
  const implementation = strategy === "square" ? n => n*n : strategy === "double" ? n => 2*n : null;
  const failed = cases.filter(c => !implementation || implementation(c.n) !== c.out).map(c => c.n);
  return {total:cases.length, passed:cases.length-failed.length, failed};
}
export function competition() {
  return ["double","square"].map(strategy => ({strategy, result:challenge(strategy)}));
}
function apply(state, record) {
  if (record.sequence !== state.sequence+1 || record.previous !== state.previous) throw Error("BROKEN_CHAIN");
  if (record.hash !== hash({sequence:record.sequence, previous:record.previous, decision:record.decision})) throw Error("BAD_RECORD_HASH");
  const d=record.decision;
  if (d.kind === "INSTALL") {
    if (state.capabilities[d.id]) throw Error("ALREADY_INSTALLED");
    const proof=challenge(d.strategy);
    if (proof.total < 2 || proof.passed !== proof.total || JSON.stringify(proof) !== JSON.stringify(d.proof)) throw Error("PROOF_REJECTED");
    state.capabilities[d.id]={strategy:d.strategy,proof,installedAt:record.sequence};
  } else if (d.kind === "REUSE") {
    if (!state.capabilities[d.id]) throw Error("CAPABILITY_NOT_FOUND");
    if (typeof d.nonce !== "string" || !d.nonce || state.used.includes(d.nonce)) throw Error("REPLAY");
    state.used.push(d.nonce);
  } else throw Error("UNKNOWN_DECISION");
  state.records.push(record);
  state.sequence=record.sequence;
  state.previous=record.hash;
  return state;
}
export async function openInstitution(directory, key) {
  if (typeof key !== "string" || key.length < 16) throw Error("KEY_REQUIRED");
  await mkdir(directory,{recursive:true});
  const path=join(directory,"institution.json");
  let state;
  try { state=JSON.parse(await readFile(path,"utf8")); }
  catch(e) { if(e.code !== "ENOENT") throw e; state=initial(); }
  if (!Array.isArray(state.records)) throw Error("INVALID_LEDGER");
  const replay=initial();
  for(const record of state.records) apply(replay,record);
  if(JSON.stringify(replay)!==JSON.stringify(state)) throw Error("LEDGER_MISMATCH");
  return {
    snapshot:()=>structuredClone(state),
    async commit(decision, signature) {
      if(typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature) ||
         !timingSafeEqual(Buffer.from(mac(key,decision),"hex"),Buffer.from(signature,"hex"))) throw Error("UNAUTHORIZED");
      const next=structuredClone(state);
      const record={sequence:next.sequence+1,previous:next.previous,decision};
      record.hash=hash(record);
      apply(next,record);
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
export async function demonstrate(directory,key) {
  const proposals=competition();
  const winner=proposals.find(p=>p.result.passed===p.result.total);
  if(!winner) throw Error("NO_WINNER");
  const institution=await openInstitution(directory,key);
  if(!institution.snapshot().capabilities["square-v1"]) {
    const decision={kind:"INSTALL",id:"square-v1",strategy:winner.strategy,proof:winner.result};
    await institution.commit(decision,signDecision(key,decision));
  }
  return {proposals,capability:institution.snapshot().capabilities["square-v1"]};
}
