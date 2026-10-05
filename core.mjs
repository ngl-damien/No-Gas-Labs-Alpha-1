export const STATES = Object.freeze(["CLAIMED","AUTHORIZED","EXECUTED","OBSERVED","ADJUDICATED"]);

export function reduce(history) {
  const canonical = new Map();
  const ledger = [];

  for (const raw of history) {
    const event = Object.freeze({ ...raw });
    let accepted = true;
    let reason = null;

    if (!event.id || !STATES.includes(event.state)) {
      accepted = false; reason = "INVALID_EVENT";
    } else if (event.state === "OBSERVED") {
      if (!event.evidence || event.evidence.origin === event.actor) {
        accepted = false; reason = "SELF_CERTIFICATION_FORBIDDEN";
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
