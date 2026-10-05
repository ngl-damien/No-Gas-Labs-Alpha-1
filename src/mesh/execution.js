import { makeReceipt, verifyReceipt } from "../evidence/content-addressed.js";

export function createExecutionRequest({ request_id, quest_id, grant_id, capability, input_receipts = [] }) {
  if (![request_id, quest_id, grant_id, capability].every(v => typeof v === "string" && v.length)) {
    throw new Error("execution request requires request_id, quest_id, grant_id, capability");
  }
  return Object.freeze({ schema:"ngl.execution-request.v1", request_id, quest_id, grant_id, capability, input_receipts:[...input_receipts] });
}

export function recordExecution({ request, executor_id, outcome, artifacts = [] }) {
  if (request?.schema !== "ngl.execution-request.v1") throw new Error("invalid execution request");
  if (typeof executor_id !== "string" || !executor_id) throw new Error("executor_id required");
  if (!["SUCCEEDED","FAILED"].includes(outcome)) throw new Error("invalid outcome");
  return Object.freeze({
    schema:"ngl.execution-result.v1",
    request_id:request.request_id, quest_id:request.quest_id, grant_id:request.grant_id,
    executor_id, claimed_outcome:outcome,
    artifacts:artifacts.map(bytes => ({ receipt:makeReceipt(bytes), bytes }))
  });
}

export function adjudicateExecution({ request, result, resolveArtifact }) {
  if (request?.request_id !== result?.request_id || request?.grant_id !== result?.grant_id) {
    return Object.freeze({ status:"REJECTED", reason:"REQUEST_BINDING_MISMATCH" });
  }
  if (result.claimed_outcome !== "SUCCEEDED") {
    return Object.freeze({ status:"ACCEPTED", observed_outcome:"FAILED", receipts:[] });
  }
  if (!Array.isArray(result.artifacts) || result.artifacts.length === 0) {
    return Object.freeze({ status:"REJECTED", reason:"ARTIFACT_REQUIRED" });
  }
  const receipts=result.artifacts.map(a=>a.receipt);
  if (!receipts.every(r=>verifyReceipt(r, resolveArtifact))) {
    return Object.freeze({ status:"REJECTED", reason:"EVIDENCE_NOT_VERIFIED" });
  }
  return Object.freeze({ status:"ACCEPTED", observed_outcome:"SUCCEEDED", receipts });
}

export function toWorldEvent({ event_id, request, adjudication, world_effect = {} }) {
  if (adjudication?.status !== "ACCEPTED") throw new Error("only accepted adjudication can project");
  return Object.freeze({
    event_id, event_type:"EXECUTION_ADJUDICATION", subject:request.quest_id,
    grant_id:request.grant_id, admission:"ACCEPTED", authority:"AUTHORIZED",
    execution:"EXECUTED", evidence:"OBSERVED", outcome:adjudication.observed_outcome,
    receipts:adjudication.receipts, world_effect
  });
}
