import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const repo = "/workspace/No-Gas-Labs-Alpha-1";
const evidenceUrl = pathToFileURL(`${repo}/src/evidence/content-addressed.js`).href;
const { makeReceipt } = await import(evidenceUrl);
const baseline = execFileSync("git", ["show", "HEAD:src/world/project.js"], {cwd:repo, encoding:"utf8"});
const markerOnly = baseline.replace(
  "e.receipts.every(receipt => verifyReceipt(receipt, resolveArtifact));",
  'e.observation_verification === "VERIFIED";'
);
assert.notEqual(markerOnly, baseline);
const chosen = readFileSync(`${repo}/src/world/project.js`, "utf8");
const artifact = Buffer.from("arbitrary bytes, not evidence of observer identity");
const receipt = makeReceipt(artifact);
const event = {
  event_id:"controlled-case", event_type:"SYSTEM_EVENT", subject:"controlled-quest",
  admission:"ACCEPTED", authority:"AUTHORIZED", execution:"EXECUTED", evidence:"OBSERVED",
  observation_verification:"VERIFIED", outcome:"SUCCEEDED", receipts:[receipt],
  world_effect:{xp:100,inventory:{shard:1},world:{forgeOpen:true}}
};
const cases = [
  {name:"verified plus matching bytes", expected:100},
  {name:"absent marker plus matching bytes", marker:undefined, expected:0},
  {name:"UNVERIFIED plus matching bytes", marker:"UNVERIFIED", expected:0},
  {name:"invalid string plus matching bytes", marker:"verified", expected:0},
  {name:"invalid type plus matching bytes", marker:true, expected:0},
  {name:"VERIFIED without resolver", noResolver:true, expected:0},
  {name:"VERIFIED plus changed bytes", bytes:Buffer.from("changed"), expected:0},
  {name:"VERIFIED plus forged digest", receipt:{...receipt,digest:"f".repeat(64)}, expected:0},
  {name:"VERIFIED plus malformed receipt", receipt:"", expected:0},
  {name:"VERIFIED plus empty receipts", emptyReceipts:true, expected:0},
  {name:"VERIFIED without authority", authority:undefined, expected:0}
];
const output = {
  schema:"ngl.q-world-002-alternatives.v1",
  scope:"Local direct-function comparison; caller fields are trusted labels; matching arbitrary bytes do not establish observer independence or authenticated admission.",
  baseline_commit:execFileSync("git", ["rev-parse", "HEAD"], {cwd:repo,encoding:"utf8"}).trim(),
  variants:[]
};
for (const [name, source] of [["baseline",baseline],["marker-only",markerOnly],["marker-plus-existing-byte-check",chosen]]) {
  const text = source.replace('"../evidence/content-addressed.js"', JSON.stringify(evidenceUrl));
  const {projectWorld} = await import(`data:text/javascript;base64,${Buffer.from(text).toString("base64")}`);
  const observations = cases.map(c => {
    const input = structuredClone(event);
    if (Object.hasOwn(c,"marker")) {
      if (c.marker === undefined) delete input.observation_verification;
      else input.observation_verification = c.marker;
    }
    if (Object.hasOwn(c,"receipt")) input.receipts = [c.receipt];
    if (c.emptyReceipts) input.receipts = [];
    if (Object.hasOwn(c,"authority")) input.authority = c.authority;
    const state = projectWorld([input], undefined, c.noResolver ? {} : {resolveArtifact:()=>c.bytes ?? artifact});
    const matches = state.xp === c.expected;
    if (name === "marker-plus-existing-byte-check") assert.equal(matches,true,c.name);
    return {case:c.name,expected_xp:c.expected,actual_xp:state.xp,inventory:state.inventory,world:state.world,matches};
  });
  output.variants.push({name,correct:observations.filter(o=>o.matches).length,total:observations.length,observations});
}
process.stdout.write(`${JSON.stringify(output,null,2)}\n`);
