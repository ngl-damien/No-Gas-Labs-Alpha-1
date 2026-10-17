# Creation frame lifecycle verification

On 2026-10-17, the saved `22c5511` candidate still lost the first Loom Play click during the unchanged `basic()` comic-preview → publication → Loom-preview journey. A plain run passed 3/3 phone trials (390 × 844) and 1/3 desktop trials (1440 × 1000). Both desktop failures left the initial status text unchanged. A second run using low-overhead event arrays passed 6/6 phone and 2/6 desktop trials.

The failing event trace locates the boundary: the child accepted the score input, then 47 ms later trusted pointerdown/click events with the correct Play coordinates reached the **parent iframe element**. No child pointer event arrived. The parent already reported `aria-busy=false`, visible, and `pointer-events:auto`. The handler and score rendering worked; the first click did not enter the child. Console-heavy instrumentation passed all six trials and was unsuitable as the primary reproduction because it changed timing.

An independent route-only probe ran the exact saved candidate and unchanged `basic()`: 3/4 desktop trials passed. Removing only the iframe visibility/pointer disabling passed 4/4. This supports a Chromium frame input-surface/compositing problem when opening a hidden, non-hittable frame; it does not establish a Chromium engine defect across browsers.

## Change

- Retain a fresh opaque sandboxed iframe per opening, but let it render beneath the loading cover without visibility or pointer-event toggles.
- Insert the preview bootstrap after its trusted CSP, and the same hook into the generated exhibition's head. After child load and two child animation frames, it posts readiness. The parent accepts only the current frame's `contentWindow` and opening generation, then removes the cover. Close/reopen removes the previous listener and invalidates the generation. This message controls presentation readiness; it grants no application authority.
- Cover the complete child area while keeping the portal header, close button, and footer above the cover. Fixed 95 px / 65 px cover offsets could leave part of a differently sized frame exposed.
- Preserve the existing world renderer behavior that clears walking routes and movement while a modal is open. No additional renderer change was needed.

The iframe remains opaque (`allow-same-origin` is absent), the trusted network-denying preview CSP is unchanged, and no `unsafe-eval` permission or readiness sleep was added. The original Play assertion remains exact.

## Results

All browser checks used installed Python Playwright with real `/usr/bin/chromium` against a disposable `createGameServer` using the existing fake fixture key. No external provider was called.

| Check | Result |
| --- | --- |
| Unchanged `basic()` after child readiness change | 3/3 phone, 3/3 desktop passed; no page errors |
| Fresh unchanged `basic()` repeat after complete loading cover | 3/3 phone, 3/3 desktop passed; no page errors |
| Native phone touch Play | 3/3 passed; trusted touchstart/touchend, pointerType `touch`, exact `Playing 8 Unicode notes.` and eight rendered codepoints |
| Native phone touch after complete loading cover | 1/1 passed with the same trusted events and assertions |
| Pending bench route while editing modal, phone and desktop | 2/2 passed: title, input value and input focus stayed intact for 3 seconds; cancelled route did not reopen a panel during 1.5 seconds after close |
| Source one-button launchpad at 320 px | Passed: three artifacts, six checks, nested comic image decoded, stage download and save reload, no page errors |
| Independent held-child readiness probe | Wrong-source and wrong-generation messages retained the cover; valid child signal released it. Parent DOM access threw `SecurityError`; opaque sandbox and network-denying policy retained. |
| `node --check game/client.mjs`, `git diff --check` | Passed |

The three-second and post-close observations test route/focus retention; they are not waits used to make the Play interaction succeed. Play uses the browser's normal actionability checks without a retry or extra test delay.

Raw disposable evidence is in `/tmp/ngl-frame-baseline-results.json`, `/tmp/ngl-frame-probe-array/`, `/tmp/ngl-frame-matrix-final/`, `/tmp/ngl-frame-touch-modal/`, `/tmp/ngl-frame-touch-final/`, and `/tmp/ngl-frame-stage-check/`. The helper scripts import `basic()`, `draft()`, and server lifecycle functions from the unchanged acceptance script. These finite trials show the reported failure no longer reproduced in the tested Chromium contexts; they do not prove behavior on physical devices or other browser engines. The parent task owns the complete browser acceptance, rebuild, integrated Node verification, and evidence preservation.
