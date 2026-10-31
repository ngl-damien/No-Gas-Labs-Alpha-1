import { projectLocationEvidence } from "../location/evidence.js";
import { hasVerifiedObservation, isVerifiedAdjudication, isVerifiedAuthorization, validatedEventList } from "../world/project.js";

export const QUEST_STATUS = Object.freeze({
  OPEN: "OPEN", AUTHORIZED: "AUTHORIZED", IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED", FAILED: "FAILED", REVOKED: "REVOKED"
});

function frozenStringList(values, label, { allowEmptyList = true } = {}) {
  if (!Array.isArray(values) || Object.getPrototypeOf(values) !== Array.prototype ||
      Object.keys(values).length !== values.length ||
      Reflect.ownKeys(values).length !== values.length + 1) {
    throw new Error(label);
  }
  const copy = [];
  for (let index = 0; index < values.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
    if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor) ||
        typeof descriptor.value !== "string" || !descriptor.value) {
      throw new Error(label);
    }
    copy.push(descriptor.value);
  }
  if (!allowEmptyList && copy.length === 0) throw new Error(label);
  return Object.freeze(copy);
}

export function defineQuest({ quest_id, title, objective, acceptance, capabilities = [] }) {
  if (![quest_id, title, objective].every(value => typeof value === "string" && value.length)) {
    throw new Error("quest identity required");
  }
  const frozenAcceptance = frozenStringList(acceptance, "acceptance conditions required", { allowEmptyList: false });
  const frozenCapabilities = frozenStringList(capabilities, "capabilities must be a dense string array");
  return Object.freeze({
    schema: "ngl.quest.v1", quest_id, title, objective,
    acceptance: frozenAcceptance, capabilities: frozenCapabilities
  });
}

// Quest status is a projection of host-verified grants and observations. Labels
// and acceptance_satisfied arrays in untrusted events are only claims.
export function projectQuest(quest, events = [], options = {}) {
  const { resolveArtifact, verifyObservation, verifyAuthorization, verifyAdjudication } = options;
  const eventList = validatedEventList(events, "quest event");
  const revokedGrants = new Set();
  const questGrantIds = new Set();
  const relevant = [];
  const executions = [];
  const succeeded = [];
  let latestExecutionOutcome = null;

  // Replay revocations in event order, matching the world reducer. A verified
  // revocation blocks later executions using that grant, but never erases an
  // earlier verified outcome from the append-only history.
  for (const event of eventList) {
    if (event.event_type === "REVOCATION") {
      // Legacy revocations without quest_id remain grant-wide. Once a revocation
      // declares a quest scope, it must not revoke a grant in another quest just
      // because its subject field happens to name that quest.
      if (event.quest_id !== undefined && event.quest_id !== quest.quest_id) continue;
      if (isVerifiedAdjudication(event, verifyAdjudication)) {
        revokedGrants.add(event.revokes);
      }
      continue;
    }

    // An explicit quest_id is authoritative. The subject fallback is for
    // older execution records that do not carry quest_id; it must never pull an
    // event explicitly scoped to another quest into this projection.
    const targetQuest = event.quest_id === undefined ? event.subject : event.quest_id;
    if (targetQuest !== quest.quest_id) continue;
    relevant.push(event);

    const grantId = typeof event.grant_id === "string" && event.grant_id.length > 0
      ? event.grant_id : null;
    const verifiedAuthorization = isVerifiedAuthorization(event, verifyAuthorization);
    if (verifiedAuthorization && grantId) questGrantIds.add(grantId);

    if (event.event_type !== "EXECUTION_ADJUDICATION" ||
        event.admission !== "ACCEPTED" ||
        !hasVerifiedObservation(event, resolveArtifact, verifyObservation) ||
        !verifiedAuthorization ||
        !grantId ||
        revokedGrants.has(grantId)) continue;

    executions.push(event);
    if (event.outcome === "SUCCEEDED") {
      succeeded.push(event);
      latestExecutionOutcome = "SUCCEEDED";
    } else if (event.outcome === "FAILED") {
      latestExecutionOutcome = "FAILED";
    }
  }

  const authorized = [...questGrantIds].some(grantId => !revokedGrants.has(grantId));
  const revoked = [...questGrantIds].some(grantId => revokedGrants.has(grantId));
  const satisfied = new Set(succeeded.flatMap(event =>
    Array.isArray(event.acceptance_satisfied) ? event.acceptance_satisfied : []
  ));
  const complete = quest.acceptance.every(id => satisfied.has(id));
  // A verified retry may supersede the current attempt status, but it never
  // removes an earlier failure from the append-only event history or execution
  // list. A fully completed quest remains completed; a revoked grant with no
  // active replacement remains revoked.
  const status = complete ? QUEST_STATUS.COMPLETED
    : revoked && !authorized ? QUEST_STATUS.REVOKED
    : latestExecutionOutcome === "FAILED" ? QUEST_STATUS.FAILED
    : latestExecutionOutcome === "SUCCEEDED" ? QUEST_STATUS.IN_PROGRESS
    : authorized ? QUEST_STATUS.AUTHORIZED
    : QUEST_STATUS.OPEN;
  const location_observations = projectLocationEvidence(relevant, quest.quest_id);
  return Object.freeze({
    quest, status, authorized, revoked, location_observations,
    acceptance: Object.freeze(quest.acceptance.map(id =>
      Object.freeze({ id, satisfied: satisfied.has(id) })
    )),
    executions: Object.freeze(executions.map(event => event.event_id)),
    execution_outcomes: Object.freeze(executions.map(event => Object.freeze({
      event_id: event.event_id,
      outcome: event.outcome
    })))
  });
}

export function authorizeQuest({ quest, grant_id, actor = "founder" }) {
  if (!grant_id) throw new Error("grant_id required");
  return Object.freeze({
    event_id: "authorize:" + quest.quest_id + ":" + grant_id,
    type: "QUEST_AUTHORIZED", quest_id: quest.quest_id, grant_id, actor
  });
}
