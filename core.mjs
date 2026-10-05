import { verifyEvidence } from "./evidence.mjs";

export const STATES = Object.freeze(["CLAIMED","AUTHORIZED","EXECUTED","OBSERVED","ADJUDICATED"]);

export function reduce(history, { resolveEvidence } = {}) {
  const canonical = new Map();
  const ledger = [];

  for (const raw of history) {
    const event = Object.freeze({ ...raw });
    let accepted = true;
    let reason = null;

    if (!event.id || !STATES.includes(event.state)) {
      accepted = false;
      reason = "INVALID_EVENT";
    } else if (event.state === "OBSERVED") {
      if (!event.evidence?.digest) {
        accepted = false;
        reason = "EVIDENCE_REQUIRED";
      } else if (typeof resolveEvidence !== "function") {
        accepted = false;
        reason = "EVIDENCE_RESOLVER_REQUIRED";
      } else {
        const bytes = resolveEvidence(event.evidence, event);
        if (bytes == null || verifyEvidence(event.evidence, bytes) !== true) {
          accepted = false;
          reason = "EVIDENCE_NOT_VERIFIED";
        }
      }
    }

    ledger.push(Object.freeze({ event, accepted, reason }));
    if (accepted) canonical.set(event.subject, event);
  }

  return Object.freeze({
    canonical: Object.freeze(Object.fromEntries([...canonical].sort(([a],[b]) => a.localeCompare(b)))),
    ledger: Object.freeze(ledger)
  });
}
