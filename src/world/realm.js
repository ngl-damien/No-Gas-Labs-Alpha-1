import { isSafeEventPayload, validatedEventList } from "./project.js";

export const locations = Object.freeze({
  guild_hall: "Guild Hall",
  forge: "Forge",
  evidence_archive: "Evidence Archive",
  decision_chamber: "Decision Chamber",
  town_square: "TownSquare",
  academy: "Polymath Academy",
  moonshot_field: "Moonshot Field",
  publication_house: "Publication House"
});

export const routes = Object.freeze({
  guild_hall: Object.freeze(["decision_chamber", "town_square", "academy"]),
  decision_chamber: Object.freeze(["guild_hall", "forge", "evidence_archive"]),
  forge: Object.freeze(["decision_chamber", "evidence_archive", "moonshot_field"]),
  evidence_archive: Object.freeze(["forge", "decision_chamber", "publication_house"]),
  town_square: Object.freeze(["guild_hall", "publication_house"]),
  publication_house: Object.freeze(["town_square", "evidence_archive"]),
  academy: Object.freeze(["guild_hall", "moonshot_field"]),
  moonshot_field: Object.freeze(["academy", "forge"])
});

export function canTravel(from, to) {
  return Boolean(locations[from] && locations[to] && routes[from]?.includes(to));
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function classifyEvent(event) {
  if (event.event_type === "LOCATION_OBSERVATION") return "evidence_archive";
  if (event.event_type === "REVOCATION") return "decision_chamber";
  if (event.outcome === "FAILED" || event.evidence === "REFUTED" || event.admission === "REJECTED") {
    return "evidence_archive";
  }
  if (event.event_type === "PUBLICATION" || event.event_type === "SATIRE") return "publication_house";
  if (event.event_type === "MOONSHOT") return "moonshot_field";
  if (event.event_type === "LEARNING" || event.event_type === "SKILL_EVIDENCE") return "academy";
  if (event.event_type === "PUBLIC_COMMENT" || event.event_type === "PARTICIPATION") return "town_square";
  if (event.event_type === "CLAIM" || event.event_type === "PROPOSAL") return "guild_hall";
  if (event.authority === "AUTHORIZED" && event.execution !== "EXECUTED") return "decision_chamber";
  if (event.execution === "EXECUTED") return "forge";
  return "evidence_archive";
}

function validatedRealmState(state) {
  // Validate descriptors and the entire data graph before any ordinary property
  // reads, spreads, mapping, or cloning can invoke an attacker-supplied getter.
  if (!isPlainRecord(state) || !isSafeEventPayload(state)) {
    throw new Error("invalid realm projection state");
  }

  const history = validatedEventList(state.history ?? [], "realm event");
  const xp = state.xp ?? 0;
  if (!Number.isSafeInteger(xp) || xp < 0) throw new Error("invalid realm XP");

  const inventory = state.inventory ?? {};
  if (!isPlainRecord(inventory)) throw new Error("invalid realm inventory");
  for (const amount of Object.values(inventory)) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("invalid realm inventory amount");
  }

  const quests = state.quests ?? {};
  if (!isPlainRecord(quests)) throw new Error("invalid realm quests");
  for (const quest of Object.values(quests)) {
    if (!isPlainRecord(quest) || typeof quest.status !== "string" || !quest.status ||
        typeof quest.source_event !== "string" || !quest.source_event) {
      throw new Error("invalid realm quest record");
    }
  }

  const audit = validatedEventList(state.revocation_audit ?? [], "realm revocation audit");
  for (const entry of audit) {
    if (!isPlainRecord(entry) ||
        typeof entry.event_id !== "string" || !entry.event_id ||
        typeof entry.grant_id !== "string" || !entry.grant_id ||
        !["global", "quest"].includes(entry.scope) ||
        (entry.scope === "global" && entry.quest_id !== null) ||
        (entry.scope === "quest" && (typeof entry.quest_id !== "string" || !entry.quest_id))) {
      throw new Error("invalid realm revocation audit entry");
    }
  }

  return { history, xp, inventory, quests, audit };
}

export function projectRealm(state) {
  const { history, xp, inventory, quests, audit } = validatedRealmState(state);
  const institutions = Object.fromEntries(
    Object.keys(locations).map(id => [id, { event_ids: [], exits: [...routes[id]] }])
  );

  for (const event of history) {
    institutions[classifyEvent(event)].event_ids.push(event.event_id);
  }

  return {
    locations,
    institutions,
    avatar: { xp, inventory: structuredClone(inventory) },
    // A realm is a read model: nested records must not alias canonical state.
    quests: structuredClone(quests),
    history: history.map(event => event.event_id),
    // Preserve scope and event identity for the realm's evidence/audit view.
    revocation_audit: audit.map(entry => ({
      event_id: entry.event_id,
      grant_id: entry.grant_id,
      scope: entry.scope,
      quest_id: entry.quest_id
    }))
  };
}
