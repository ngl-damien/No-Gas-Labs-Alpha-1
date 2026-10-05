import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionRequest, recordExecution, adjudicateExecution, toWorldEvent } from "../src/mesh/execution.js";
import { projectWorld } from "../src/world/project.js";

const request=createExecutionRequest({request_id:"r1",quest_id:"q1",grant_id:"g1",capability:"build"});
const bytes=Buffer.from("built artifact");
const result=recordExecution({request,executor_id:"github-actions",outcome:"SUCCEEDED",artifacts:[bytes]});
const resolve=receipt => receipt.digest===result.artifacts[0].receipt.digest ? bytes : null;

test("executor claim alone cannot create a world consequence",()=>{
  const fake={...result,artifacts:[]};
  const a=adjudicateExecution({request,result:fake,resolveArtifact:resolve});
  assert.equal(a.status,"REJECTED");
});

test("verified artifact can cross adjudication into gameplay",()=>{
  const a=adjudicateExecution({request,result,resolveArtifact:resolve});
  assert.equal(a.status,"ACCEPTED");
  const event=toWorldEvent({event_id:"e1",request,adjudication:a,world_effect:{xp:10,inventory:{execution_receipt:1}}});
  const world=projectWorld([event],undefined,{resolveArtifact:resolve});
  assert.equal(world.xp,10);
  assert.equal(world.inventory.execution_receipt,1);
});

test("mutated bytes defeat executor success claim",()=>{
  const a=adjudicateExecution({request,result,resolveArtifact:()=>Buffer.from("tampered")});
  assert.deepEqual(a,{status:"REJECTED",reason:"EVIDENCE_NOT_VERIFIED"});
});

test("result cannot be laundered into another authorization",()=>{
  const other=createExecutionRequest({request_id:"r2",quest_id:"q1",grant_id:"g2",capability:"build"});
  const a=adjudicateExecution({request:other,result,resolveArtifact:resolve});
  assert.deepEqual(a,{status:"REJECTED",reason:"REQUEST_BINDING_MISMATCH"});
});
