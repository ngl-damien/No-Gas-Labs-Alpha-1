# NGL-126 — SUPPRESSWITNESS (research manifest)

**Experiment:** Offline cross-platform marketing suppression examination. **Date:** 2026-10-10 UTC.

**Problem:** An opt-out recorded in one email platform may not propagate to another. Mailchimp documents that audience suppression lists are not global across separate audiences; SendGrid distinguishes global and group unsubscribes.

**Mechanism:** Normalize consent events, sent/planned message records, and declared export coverage; reconstruct scoped consent chronology; flag post-opt-out sends and suppressed planned recipients; issue SHA-256 consistency receipts with row witnesses. Input provenance and legal compliance are **not** established by these receipts.

**Local artifact:** NGL_126_SUPPRESSWITNESS_v1.zip, SHA-256 `5357804bba87813cf9cd582281848a5fa8c14debfd9468894ba22af84c1b24a9` (35 entries). Produced and archived in NGL Catalog; **not** represented here as publicly released executable.

**Internal tests:** 49 named Node.js tests + 500 generated controls, 320 independent Python scenarios, 24 Chromium desktop/mobile checks; synthetic HOLD/REVIEW/BOUNDED controls. Actual device file opening and real-customer usage unverified.

**Sources:**
- https://mailchimp.com/help/import-suppression-lists/
- https://support.sendgrid.com/hc/en-us/articles/9521401569691-Activate-Global-Group-Unsubscribe-Links
- https://www.reddit.com/r/ProductManagement/comments/hmgr91
- https://optout.listarmor.com/pricing/

**Commercial hypothesis:** $39 one-time. **Sales, revenue, customer usage:** none evidenced. Market gate conditional; quality gate internal pass within defined scope; evidence gate commercial HOLD.

**Owner:** No_Gas_Labs™. This is an experiment manifest, not a compliance guarantee or an assertion of public software publication.
