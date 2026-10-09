# Field Capsule 002 — NGL Evidence Contract

**Experimental.** A matching SHA-256 digest establishes content consistency, not authenticity, consent, time, or physical presence.

## Implementation

- `src/location/schema.js`: pure JavaScript validation.
- `src/location/capsule.js`: Node verifier and canonical SHA-256 digest.
- `src/location/evidence.js`: only well-formed, unverified observations appear in the Quest Journal.
- `src/world/project.js`: location-labelled events do not change world progression.
- `tools/verify-location-capsule.mjs`: independent command-line verification.
- `location/field-capsule.html`: portable browser interface.

## Reproduce

Run `npm test`. For a downloaded capsule run `node tools/verify-location-capsule.mjs <capsule.json>`.

## Limits

A browser observation may be inaccurate or simulated. A newly generated digest can match fabricated content. GPS does not establish Founder authority, complete quests, or award XP. The field interface does not automatically transmit or store readings, but exported files may contain coordinates.

**Not yet demonstrated:** publicly hosted HTTPS interface, real-device permission flow, independent hardware attestation, private encrypted vault, or production Founder authorization for non-location events.
