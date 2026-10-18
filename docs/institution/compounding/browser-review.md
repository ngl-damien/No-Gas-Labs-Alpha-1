# Institution browser acceptance

The bounded runner uses actual system Chromium through Python Playwright against
`createGameServer`, bound to loopback with a fresh temporary data directory and an
explicit fake Founder key. It does not read a configured Founder key or activate
the operational review clock.

Run after the source and the paired experiment report are frozen:

```sh
python3 scripts/verify-institution-browser.py \
  --report docs/institution/compounding/evidence/experiment.json \
  --out /tmp/ngl-institution-browser-actual
```

`--synthetic` explicitly labels report-fixture runs. A synthetic report run is
only harness development evidence; the supplied real experiment report must be
tested separately. The Gate policy and proposal remain synthetic fixtures even
when the displayed project report is the actual paired experiment report. The
fixture interval of 86,400,000 ms does not start Damien's authorized operational
24-hour clock, which requires verified HTTPS reachability and evidence readiness.

The runner checks:

- A fresh Witness reaches one project, two accomplishments, the retained
  disputes and an awaiting operational decision through Journal. Installed
  records award no XP, kernel acceptance or Founder authority, and the default
  Gate has no policy or proposal.
- The accessible Places button walks to TownSquare. Actual presence requests
  show movement from the spawn area to the far bank before the same institution
  view opens; an open sheet alone is insufficient evidence of arrival.
  Because presence is sent only while moving and at most once per 1.5 seconds,
  the runner waits out that throttle after automatic arrival and samples one
  native keyboard nudge near the destination, then opens through native interact.
- A fake-key authenticated Founder creates a disposable policy and a proposal
  through the actual HTTP routes. The retained evaluation includes the supplied
  report bytes with a real SHA-256 receipt. All three native choice buttons are
  available; clicking DEFER records DEFERRED and does not promote source.
- A separate Witness sees neither private evaluation fields nor controls, and
  all three write routes return 403. Logging out on one page demotes another
  page sharing the cookie and removes its expanded private evaluation DOM.
- A stop and restart of only the runner's server retains the exact decision,
  while a formerly authenticated cookie returns as Witness. A fresh Founder
  login can review the retained DEFERRED decision.
- Desktop and 390px layouts have screenshots, no document or sheet horizontal
  overflow, no uncaught JavaScript errors and no external network requests.
  The runner records report/source hashes and fails if they change mid-run.

## Initial observed defect

The first synthetic Chromium run found real horizontal overflow in the fresh
390px Witness institution sheet: document width 390px, sheet client width 374px,
sheet scroll width 449px. The plain SHA-256 text exceeded its card. The retained
private evaluation also used an unstyled `pre`, outside the existing wrapping
selector. The application owner received the concrete reproduction and
`/tmp/ngl-institution-browser-synthetic/failed-witness-phone.png`; the browser
worker did not modify application source.

The application owner fixed wrapping in `game/styles.css`. The subsequent full
synthetic report run passed **8 of 8 journeys**, with zero uncaught JavaScript
errors, zero external requests and unchanged hashes for the eight recorded source
files. At 390px the sheet client and scroll widths were both 374px; at desktop
they were both 448px. The arrival probe observed `(1042.9, 504.8)`, approximately
65px from the TownSquare marker. Native DEFER retained revision 2, and the exact
decision and evaluation receipt survived restart. The prior authenticated cookie
was actually sent after restart and returned Witness state with Gate writes
denied as `403/FORBIDDEN` before a new fake-key login.

Synthetic-only evidence: `/tmp/ngl-institution-browser-synthetic-fixed2/results.json`
and five screenshots in the same directory. The tested harness SHA-256 is
`3bf905657aad90a3af9309cf5022699d2f3a53edd0a7c2eae4a12c81e9d2c02c`.
Those results do not establish actual accomplishments; the actual retained
experiment report still requires its own run.

Local browser acceptance does not establish
a deployed HTTPS Gate, independent Witness participation, persistent residents,
cloud restoration, or reduced human intervention.

## Actual retained experiment acceptance

The frozen harness ran against the actual `experiment.json` from source `907ce814f023ef3bd40ea57bfa536914bb67e27b`: **8/8 journeys passed**, report SHA-256 `421e4a6dd878a6b7bb1e5ebe7248223374601a171e6a169974ea8af8395fc307`, no page errors or external requests, all source hashes unchanged. Final results and five screenshots are in `evidence/`. Gate credentials, policy and proposal were disposable fixtures; the operational clock remains stopped. The existing Meteor browser runner separately passed seven journeys with the direct-file navigation check still policy-blocked.
