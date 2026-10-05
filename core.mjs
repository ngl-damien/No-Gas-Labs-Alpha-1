export const STATES = Object.freeze(["CLAIMED","AUTHORIZED","EXECUTED","OBSERVED","ADJUDICATED"]);

export function reduce(history, { verifyEvidence } = {}) {
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
      if (!event.evidence || typeof event.evidence.ref !== "string" || !event.evidence.ref.trim()) {
        accepted = false;
        reason = "EVIDENCE_REQUIRED";
      } else if (typeof verifyEvidence !== "function") {
        accepted = false;
        reason = "VERIFIER_REQUIRED";
      } else if (verifyEvidence(event.evidence, event) !== true) {
        accepted = false;
        reason = "EVIDENCE_NOT_VERIFIED";
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
