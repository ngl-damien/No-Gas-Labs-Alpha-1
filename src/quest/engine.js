import { projectLocationEvidence } from "../location/evidence.js";
import {
  hasVerifiedObservation,
  isVerifiedAdjudication,
  isVerifiedAuthorization
} from "../world/project.js";

export const QUEST_STATUS = Object.freeze({
  OPEN: "OPEN",
  AUTHORIZED: "AUTHORIZED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  REJECTED: "REJECTED"
});

export function defineQuest({ quest_id, title, objective, acceptance, capabilities = [] }) {
  if (![quest_id, title, objective].every(value => typeof value === "string" && value.length)) {
    throw new Error("quest identity required");
  }
  if (!Array.isArray(acceptance) || acceptance.length === 0 ||
      acceptance.some(value => typeof value !== "string" || !value)) {
    throw new Error("acceptance conditions required");
  }
  return Object.freeze({
    schema: "ngl.quest.v1",
    quest_id,
    title,
    objective,
    acceptance: [...acceptance],
    capabilities: [...capabilities]
  });
}

export function projectQuest(quest, events = [], {
  resolveArtifact,
  verifyObservation,
  verifyAdjudication,
  verifyAuthorization
} = {}) {
  const relevant = events.filter(event =>
    event?.quest_id === quest.quest_id || event?.subject === quest.quest_id
  );
  const authorizationEvents = relevant.filter(event =>
    event.type === "QUEST_AUTHORIZED" && event.quest_id === quest.quest_id
  );
  const verifiedAuthorizations = authorizationEvents.filter(event =>
    isVerifiedAuthorization(event, verifyAuthorization)
  );
  const authorizedGrants = new Set(verifiedAuthorizations.map(event => event.grant_id));
  const authorized = authorizedGrants.size > 0;

  // Keep raw accepted execution claims visible. Only a matching, host-authorized
  // grant plus byte-checked, independently observed evidence can satisfy a quest.
  const executions = relevant.filter(event =>
    event.event_type === "EXECUTION_ADJUDICATION" && event.admission === "ACCEPTED"
  );
  const verifiedExecutions = executions.filter(event =>
    authorizedGrants.has(event.grant_id) &&
    hasVerifiedObservation(event, resolveArtifact, verifyObservation) &&
    isVerifiedAuthorization(event, verifyAuthorization)
  );
  const succeeded = verifiedExecutions.filter(event =>
    event.outcome === "SUCCEEDED" && event.evidence === "OBSERVED"
  );
  const failed = verifiedExecutions.filter(event =>
    event.outcome === "FAILED" || event.evidence === "REFUTED"
  );
  const rejections = relevant.filter(event =>
    event.event_type === "EXECUTION_ADJUDICATION" && event.admission === "REJECTED"
  );
  const verifiedRejections = rejections.filter(event =>
    isVerifiedAdjudication(event, verifyAdjudication)
  );
  const satisfied = new Set(succeeded.flatMap(event =>
    Array.isArray(event.acceptance_satisfied) ? event.acceptance_satisfied : []
  ));
  const complete = authorized && quest.acceptance.every(condition => satisfied.has(condition));
  const status = complete ? QUEST_STATUS.COMPLETED
    : verifiedRejections.length ? QUEST_STATUS.REJECTED
    : failed.length && authorized ? QUEST_STATUS.FAILED
    : succeeded.length && authorized ? QUEST_STATUS.IN_PROGRESS
    : authorized ? QUEST_STATUS.AUTHORIZED
    : QUEST_STATUS.OPEN;
  const location_observations = projectLocationEvidence(relevant, quest.quest_id);

  return Object.freeze({
    quest,
    status,
    authorized,
    location_observations,
    acceptance: Object.freeze(quest.acceptance.map(id =>
      Object.freeze({ id, satisfied: satisfied.has(id) })
    )),
    authorization_events: Object.freeze(authorizationEvents.map(event => event.event_id)),
    verified_authorizations: Object.freeze(verifiedAuthorizations.map(event => event.event_id)),
    executions: Object.freeze(executions.map(event => event.event_id)),
    verified_executions: Object.freeze(verifiedExecutions.map(event => event.event_id)),
    rejections: Object.freeze(rejections.map(event => event.event_id)),
    verified_rejections: Object.freeze(verifiedRejections.map(event => event.event_id))
  });
}

export function authorizeQuest({ quest, grant_id, actor = "founder" }) {
  if (typeof grant_id !== "string" || !grant_id.trim()) throw new Error("grant_id required");
  if (actor !== "founder") throw new Error("quest authorization requires founder actor");
  // This is a proposed event shape, not authority by itself. projectQuest accepts
  // it only when a separately host-controlled verifyAuthorization callback agrees.
  return Object.freeze({
    event_id: "authorize:" + quest.quest_id + ":" + grant_id,
    type: "QUEST_AUTHORIZED",
    quest_id: quest.quest_id,
    grant_id,
    actor
  });
}
