# no-gas-labs

**Classification:** RUNNABLE (static client)  
**Type:** current implementation — browser UI  
**Not:** backend service, multi-repo orchestrator, or payment processor

## What exists in this repository

| Path | Role |
|------|------|
| `index.html` | Primary single-file client (~66 KB) |
| `ngl-sovereign.html` | Alternate single-file client |
| `empire-os.html` | Alternate single-file client |
| `*.md` | Design / agent / sales prose (not required to open the UI) |
| `.gitignore`, `SECURITY.md`, `CHANGELOG.md` | Repo hygiene |

There is **no** `package.json`, server, or build step in this repository.

## Shortest path: clone → usable artifact

**Option A — hosted (verified HTTP 200, 2026-09-09)**

```text
https://no-gas-labs-official.github.io/no-gas-labs/
```

Open in a mobile or desktop browser. Optional: “Add to Home Screen” on Android/iOS for fullscreen.

**Option B — local file**

```bash
git clone https://github.com/No-Gas-Labs-Official/no-gas-labs.git
cd no-gas-labs
# open index.html in a browser (file:// or any static server)
python3 -m http.server 8080
# then visit http://localhost:8080/
```

## What the client can do (evidence-based)

- Renders a full-screen themed UI from a single HTML file.
- CSP in `index.html` allows outbound calls to OpenAI, Anthropic, Google Generative Language, and xAI APIs. Those calls require **user-supplied API keys** and network access; this repo does not embed keys or host models.
- Offline: the HTML/CSS/JS shell can load from cache or local file; live model calls will not work offline.

## Claims that are *not* implemented in this repo

| Claim often associated with this surface | Reality here |
|------------------------------------------|--------------|
| “86 repositories mapped” / module inventory | Not encoded as data in this tree; other org repos are separate |
| Hosted AI “council” as a service | Only client-side hooks to third-party APIs |
| Payment processing (Venmo/crypto checkout) | Marketing/docs only in markdown; no payment backend in-tree |
| Build pipeline / deployment automation | Static GitHub Pages from HTML files |

Prose files (`EMPERORS_VISION.md`, `SELL_THIS.md`, `AGENT_TASKS.md`, etc.) are **documentation / historical design**. They are not runtime dependencies.

## Verification performed

- Tree: 13 files; three HTML clients + markdown.
- Pages URL returns HTTP 200.
- No Node/Python application entrypoint present.

## Limitations

- Functionality beyond the static UI depends on external APIs and user configuration not shipped here.
- District/council language in older README versions mixed product narrative with implementation; this file separates them.

## Next action

1. Keep Pages deploy as the primary distribution path.  
2. If API features are load-bearing, document required env/key entry UI in the HTML itself.  
3. Do not treat sibling org repositories as part of this package unless linked by code.

---

*Static client. External brains optional. No implied infrastructure.*
