import { projectLocationEvidence } from "../location/evidence.js";
import { hasVerifiedObservation, isVerifiedAuthorization } from "../world/project.js";

export const QUEST_STATUS = Object.freeze({
  OPEN: "OPEN", AUTHORIZED: "AUTHORIZED", IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED", FAILED: "FAILED"
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
    schema: "ngl.quest.v1", quest_id, title, objective,
    acceptance: [...acceptance], capabilities: [...capabilities]
  });
}

// Quest status is a projection of host-verified grants and observations. Labels
// and acceptance_satisfied arrays in untrusted events are only claims.
export function projectQuest(quest, events = [], options = {}) {
  const { resolveArtifact, verifyObservation, verifyAuthorization } = options;
  const relevant = events.filter(event =>
    event?.quest_id === quest.quest_id || event?.subject === quest.quest_id
  );
  const authorized = relevant.some(event => isVerifiedAuthorization(event, verifyAuthorization));
  const executions = relevant.filter(event =>
    event?.event_type === "EXECUTION_ADJUDICATION" &&
    event.admission === "ACCEPTED" &&
    hasVerifiedObservation(event, resolveArtifact, verifyObservation) &&
    isVerifiedAuthorization(event, verifyAuthorization)
  );
  const succeeded = executions.filter(event => event.outcome === "SUCCEEDED");
  const failed = executions.filter(event => event.outcome === "FAILED");
  const satisfied = new Set(succeeded.flatMap(event =>
    Array.isArray(event.acceptance_satisfied) ? event.acceptance_satisfied : []
  ));
  const complete = quest.acceptance.every(id => satisfied.has(id));
  const status = complete ? QUEST_STATUS.COMPLETED
    : failed.length && authorized ? QUEST_STATUS.FAILED
    : succeeded.length ? QUEST_STATUS.IN_PROGRESS
    : authorized ? QUEST_STATUS.AUTHORIZED
    : QUEST_STATUS.OPEN;
  const location_observations = projectLocationEvidence(relevant, quest.quest_id);
  return Object.freeze({
    quest, status, authorized, location_observations,
    acceptance: Object.freeze(quest.acceptance.map(id =>
      Object.freeze({ id, satisfied: satisfied.has(id) })
    )),
    executions: Object.freeze(executions.map(event => event.event_id))
  });
}

export function authorizeQuest({ quest, grant_id, actor = "founder" }) {
  if (!grant_id) throw new Error("grant_id required");
  return Object.freeze({
    event_id: "authorize:" + quest.quest_id + ":" + grant_id,
    type: "QUEST_AUTHORIZED", quest_id: quest.quest_id, grant_id, actor
  });
}
