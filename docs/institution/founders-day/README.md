# Inaugural Founders Day and ten-minute Founder Gate

**October 18, 2026 · Carter Lake, Iowa · America/Chicago.** Prepared at the Founder's request. No operational review has been activated in this execution.

The dedicated `/founder-gate` page presents the ceremony, historical qualification evidence, private Founder review, ten-minute countdown, three decisions, print support and a truthful downloadable commemorative record. `CEREMONY.md` contains the full programme, inaugural reading, optional Founder response and closing words. These are prepared words, not an assertion of a ceremony already performed.

`npm run build` also produces `dist/founders-day.html`: a self-contained, network-disabled commemorative preview. It can print and download a prepared record; it cannot authenticate, activate a review or record a protected decision. `dist/founders-day-ceremony.pdf` is a print artifact generated separately with the full reading expanded. Private keys, sessions and live decision stores are absent from both.

## Decision and clock

The ten-minute interval applies to the qualification decision requested here. It does not rewrite the earlier 24-hour policy for the first machinery-improvement decision. The existing decision core captures each proposal's immutable policy. New decisions must select their own intended policy explicitly.

The server starts exactly 600,000 ms when the authenticated Founder activates this qualification at its configured HTTPS origin. Reading, reopening and duplicate activation never start another window or reset the deadline. Expiry rejects later choices and never supplies default approval. The choices are:

- APPROVE: authorize controlled external specialist review only.
- DEFER: require further hardening.
- REJECT: reject the present qualification.

Approval records a disposition; it does not publish, deploy, certify, invite reviewers or promote source. The ceremony record can preserve a server-recorded disposition without claiming attendance, spoken words or independent witnesses.

## Operational service

The CLI loads only the fixed qualification proposal and the exact report bytes bound by its SHA-256 receipt. Optional direct TLS uses operator-configured `NGL_TLS_CERT_FILE` and `NGL_TLS_KEY_FILE`; `NGL_FOUNDER_GATE_ORIGIN` must be the exact HTTPS origin. TLS is validated before runtime initialization. Secure cookies and same-origin checks use the actual encrypted socket; arbitrary forwarding headers are not trusted. A reverse proxy that terminates TLS before forwarding plain HTTP does not satisfy this implementation's activation check.

HTTP and unconfigured origins cannot activate or decide the qualification. Generic decision create/choose routes cannot bypass the reserved Gate ID. Witnesses receive no evaluation bytes or private review fields. The page never stores a Founder key, hides authentication on an unavailable address, clears private content after logout/demotion, and disables choices when the address cannot record them.

This environment exposes no page-publishing/deployment capability, public ingress address or configured hosting identity. No external HTTPS Gate URL, actual Founder session or operational clock is claimed. The existing local HTTP runtime and a standalone preview cannot complete Directive001's real Founder completion token. No credentials should be supplied in chat.

## Executed verification

- `npm run verify`: **335/335 Node tests**, **47/47 Python tests**, build and institutional exercise. The isolated copied repository passed **277/277** selected tests with unchanged source integrity.
- `test/founder-gate-service.test.mjs`: fourteen focused cases, including exact ten-minute expiry, restart, repeat activation, replay/revision controls, mismatched historical policy, private redaction, bounded fixed-file loading and actual UTF-8 BOM receipt preservation. No ten-minute production clock was used as a fixture.
- `test/founder-gate-http.test.mjs`: real HTTP refusal and native HTTPS activation/disposition against a disposable service. A self-signed fixture certificate was explicitly trusted and hostname-checked; verification was not disabled. A fixture SAN error was corrected rather than bypassed.
- Independent internal review reproduced a generic-route HTTPS bypass and unavailable-but-enabled controls. The reserved route regression failed before the guard and passed after it; readiness now disables the actual action buttons. Internal AI review is not external certification.
- `python3 scripts/verify-founders-day-browser.py`: four actual Chromium journeys covering 390px/1440px portable previews, prepared JSON download, no extra portable network requests, no overflow, local HTTP clock refusal, private evidence and logout clearing. The initial harness incorrectly used Playwright's unsupported fieldset disabled check; the DOM and native buttons were disabled. The corrected harness checks all three actual buttons.

Historical qualification counts on the commemorative page remain 318/47/eight for that preserved run. They are deliberately not relabeled as the new 335-test run.

Raw outputs, browser receipts and screenshots are preserved in `evidence/`. The selected public source ZIP includes page sources and the preview, not private runtime or Git history. Standalone artifact fingerprints identify bytes, not ceremony performance or independent approval.
