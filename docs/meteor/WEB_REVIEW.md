# Meteor web and packaging review

Independent review, October 17, 2026. Scope: browser trust boundaries, role demotion, private import/save failure, exhibition frames, and downloadable source/game packaging. The review used disposable local HTTP servers, temporary worlds and an intentionally fake Founder key. It read no actual credential files, contacted no external service and incurred no provider cost. The root integration worker owns the full acceptance run; this review did not repeat the full suite.

## Findings and closure

| Priority | Finding | Status and verification |
| --- | --- | --- |
| P1 | A valid private import could supply HTML with its own correct SHA-256 receipt but no CSP. The original standalone game trusted that document's policy, allowing its script to fetch a separate local collector despite the preview's network-denial promise. An opaque iframe alone does not deny network access. | Closed. The package now supplies its own CSP; client previews add a trusted document policy independently of imported bytes. Fresh Chromium preview and actual nested exhibition-frame probes both report `blocked:Failed to fetch`, with **zero collector requests**. A fresh source server independently records **zero requests** when an imported script attempts a credentialed same-origin `/api/state?source-probe-marker` fetch; the script executes and catches the policy failure. All three frames throw `SecurityError` on `parent.document` access. Stored imported HTML and its original receipt remain unchanged. |
| P2 | Role demotion cleared the selected draft but could leave an already-open private workshop's title/intent in its DOM. | Closed. In two pages sharing one cookie context, logging out in the second page makes the first a Witness, hides its private sheet and removes the draft title/intent/HTML controls and content. The automatic SSE reconnection subsequently returns a healthy Witness state. |
| P2 | The private-import handler closed the shared SSE connection before attempting local persistence. A quota failure could therefore leave the user in shared mode without updates. | Closed. Persistence now precedes the mode/stream transition. With `Storage.prototype.setItem` deliberately throwing `QuotaExceededError`, the import reports a clear save failure, retains Witness mode, and receives the next real publication through the existing stream: server and client creation counts both move from 1 to 2. |
| P2 | The source packager's recursive public-source trees could include a configured runtime envelope such as `src/runtime/service.json` and a credential JSON fixture. | Closed. A separate packaging reviewer reproduced this using fixture markers only. A fresh build excludes the paths and markers; runtime/credential directories and general JSON envelopes are excluded. |
| P2 | Extracted source could rebuild and serve the game, but its Forge demo failed because the ZIP has no `.git` directory and the demo did not enable the supported public-source snapshot fallback. | Closed. A fresh extracted archive's real Forge demo exits 0 with `passing`, `failed` and `timed_out` results. |
| P2 | A source-generated comic world imported into the standalone game retained `/assets/comic/*.jpg` references. Its preview failed to load artwork and its launch rehearsal could not use the JPEGs already embedded in `NGL_ASSETS`. | Closed. The failure was reproduced with `naturalWidth=0`, the missing-page notice and 5/6 rehearsal checks. Fresh package Chromium retesting now shows a data-URL image with **naturalWidth=700**, no missing-page notice and **6/6** rehearsal checks. Stored original comic HTML remains unchanged; embedded assets are resolved for presentation and portable exhibition packaging. The frontend owner's separate real-browser retest also verifies Next reaches 2/6 and a downloaded re-export preserves both original HTML and receipt exactly, with no post-document HTTP requests or JavaScript errors. |

## Reproduction details

For the import boundary probe, create and publish one custom artifact through the domain API, then replace its document with this test HTML and recompute its SHA-256/UTF-8-size receipt:

```html
<!doctype html><html><body><h1>Imported probe</h1><script>
fetch('http://127.0.0.1:COLLECTOR_PORT/probe?marker=public-test-marker')
  .then(r => r.text()).then(t => document.body.dataset.result = t)
  .catch(e => document.body.dataset.result = 'blocked:' + e.message);
</script></body></html>
```

The collector is a disposable local HTTP server that records received paths and returns a fixed test string with `Access-Control-Allow-Origin: *`. Import the world through the Journal, enter the creation, then run Launchpad and enter that same creation inside the exhibition. Before the fix, the collector received the marker and the direct iframe displayed the response. After the fix, both actual frame paths block the fetch before any collector request. This proves the observed request boundary; it makes no claim of an adversarial OS sandbox.

For the source-save transfer probe, create and publish a comic without the standalone `NGL_ASSETS` global, export its valid JSON, then import it through the bundled game's Journal. Inspect the real reader image and run Launchpad. The failure is independent of image-server availability because the packaged shell deliberately denies network access and already contains the required images as data URLs.

The package reviewer separately verified fresh ZIP CRCs and every manifest size/hash, rebuilt the extracted source, and made real local requests to its index, state and public comic asset. The seven focused packaging/launchpad tests passed before the final exclusion/Forge corrections; those two original failure reproductions were then rerun successfully against a fresh archive.

## Execution limits

The available `/usr/bin/chromium` rejects direct `file://` navigation with `net::ERR_BLOCKED_BY_ADMINISTRATOR`. That policy was not bypassed. Standalone checks therefore served the **unchanged generated `play.html` bytes** over a disposable loopback HTTP server, without adding a CSP header. Direct file opening remains unverified in this managed browser. The source-save image failure and its correction were both observed under this equivalent package-byte check. No material finding remains open in this review's tested scope.
