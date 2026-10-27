# Canonical JSON own-property integrity — mainline transplant

Date: 2026-10-26 UTC

## Defect

The canonical serializer used enumerable string keys to build signed/canonical JSON. Non-enumerable own properties on otherwise plain objects or arrays were omitted rather than rejected. That creates a lossy representation: the in-memory value can contain data that the canonical bytes do not represent.

## Change

Transplanted onto current mainline commit `a1079a03786acb6941d91a150928c3a40a6750f8`:

- `src/institution/kernel.mjs` now checks all own keys on arrays and plain objects, rejecting hidden own properties rather than silently omitting them.
- `test/institution-kernel.test.mjs` adds regressions for non-enumerable object and array properties and a control for an ordinary dense JSON array.

Existing checks for symbols, accessors, unsafe keys, sparse arrays, non-finite numbers, cycles and non-plain objects remain in place.

## Verification boundary

This branch was created directly from the observed mainline commit above. GitHub Actions must verify the final branch head; no local test run is claimed. The serializer's unit tests demonstrate rejection of the tested JavaScript shapes, not production key custody or independently controlled trust.

## Limits

This change does not wire observation or authorization attestations into the live server, provision trust roots, establish the truth of artifact contents, or grant authority. It is a canonicalization-integrity hardening only.
