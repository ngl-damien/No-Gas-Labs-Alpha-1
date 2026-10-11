import test from "node:test";
import assert from "node:assert/strict";
import {auditBranchHeads,reviewQueue} from "../src/evidence/branch-custody.js";
const sha=x=>x.repeat(40);
const sample=[
  {name:"main",commit:{sha:sha("a")}},
  {name:"experiment/empty",commit:{sha:sha("a")}},
  {name:"security/one",commit:{sha:sha("b")}},
  {name:"security/alias",commit:{sha:sha("b")}},
  {name:"research/two",commit:{sha:sha("c")}}
];
test("detects aliases and default-head branches",()=>{
  const a=auditBranchHeads(sample);
  assert.deepEqual(a.counts,{branches:5,unique_heads:3,same_head_as_default:2,distinct_nondefault_heads:2});
  assert.equal(a.branches.find(x=>x.name==="experiment/empty").status,"SAME_HEAD_AS_DEFAULT");
  assert.equal(a.aliases.length,2);
});
test("does not claim that a different head is a validated advancement",()=>{
  const a=auditBranchHeads(sample);
  assert.equal(a.branches.find(x=>x.name==="security/one").status,"DIFFERENT_HEAD_UNREVIEWED");
  assert.equal(reviewQueue(a).length,2);
  assert.ok(reviewQueue(a)[0].required_evidence.includes("exact-head CI"));
});
test("rejects duplicate names, missing main, and malformed commit identifiers",()=>{
  assert.throws(()=>auditBranchHeads([...sample,sample[0]]));
  assert.throws(()=>auditBranchHeads(sample.slice(1)));
  assert.throws(()=>auditBranchHeads([{name:"main",commit:{sha:"not-a-sha"}}]));
});
test("empty, truncated or corrupted inventory cannot be represented as complete",()=>{
  assert.throws(()=>auditBranchHeads([]));
  assert.throws(()=>auditBranchHeads([{name:"main"}]));
});
test("queue limit and deduplication are enforced",()=>{
  const a=auditBranchHeads(sample);
  assert.equal(reviewQueue(a,1).length,1);
  assert.throws(()=>reviewQueue(a,0));
});
