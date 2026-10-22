# Meteor Commission — executable integration contract

Principal: Damien Featherstone, Neophyte Founder™. Horizon: October 17, 2027.
Authorization: the user explicitly commissions autonomous implementation, tests, branches and commits; no additional design approval rounds. No public deployment, provider charges or fabricated agents. This design extends the prior playable-world and Caveman Launchpad requests. Original constitutional invariants and historical files remain intact.

## Observed baseline, October 17, 2026

Checkout: `ngl-damien/No-Gas-Labs-Alpha-1`, branch `work`, HEAD `facee282ae0c0a56031e7bf00a038eac3ebe4926`, initially clean. Node24.19.0/npm11.9.0; 59 tests pass. The legacy reducers verify bytes but are not a complete identity/transition/authority boundary. Browser authority/location prototypes, recovery trees and product archives exist. Prior uncommitted RPG work described in the conversation is absent in this restored instance; that historical report does not establish current implementation. No enrolled external AI credentials or callable external AI providers were exposed. Python Playwright and `/usr/bin/chromium` are available for real browser checks.

## Architecture and alternatives

Minimum real: a local persistent world and launch rehearsal, without external providers. Orthogonal: a signed file courier and bounded executable Forge, usable independently of any UI or model vendor. Selected synthesis: integrate both with a strict institutional kernel and a mobile playable client. External-provider adapters remain capability contracts until authenticated transport and actual execution can be tested. No claim of25 independent Council seats, demand, revenue, deployment or human-baseline acceleration follows from this build.

## Boundaries and ownership

- Kernel: `src/institution/kernel.mjs`, `src/institution/ledger.mjs`, associated tests. New strict API; legacy semantics unchanged. Deterministic five-stage transitions, exact authority scope, verified bytes, idempotency and durable tamper-evident persistence.
- Courier: `src/institution/courier.mjs`, `scripts/courier.mjs`, associated tests. Provider-neutral durable dispatch and signed acknowledgment/response envelopes, explicit failure and dissent. A signature authenticates an enrolled key, not a human or a true statement.
- Forge: `src/forge/runner.mjs`, `scripts/forge.mjs`, associated tests. Bounded actual child processes, disjoint copied workspaces, structured commands, time/output limits, source/output hashes, real failure states, candidate comparison. Process isolation is not an adversarial OS sandbox. No automatic constitutional changes or integration.
- Playable frontend: `game/index.html`, `game/styles.css`, `game/client.mjs`, `game/world-view.mjs`, `game/model.mjs`, `game/artifacts.mjs`, associated tests. Root owns `game/launchpad.mjs`, server, assets, packaging, docs, root package.json and integration.
- Root integration: local HTTP/SSE server, authenticated Founder sessions, protected drafts, browser journeys, packaging, recovery and measured evidence report. Each worker edits only its owned paths, no other agents or commits. Root integrates and commits after review.

## Browser domain API (locked)

`createWorld({id,founderName,now}={})` returns plain JSON `{schema:'ngl.world.v2',id,founderName,revision,xp,createdAt,updatedAt,creations:[],drafts:[],events:[],contributions:[],reports:[],discoveries:[],methods:[]}`.

`applyAction(world,action,actor,{now}={})` is async immutable and returns `{world,result}`. Actor `{id,name,role:'founder'|'witness'}` is established by the caller; the shared server owns trust. Domain functions use Web Crypto, no Node imports.

- Founder `draft {kind:'comic'|'loom'|'observatory'|'custom',title,intent,html?}` returns `draftId`.
- Founder `publish {draftId,expectedVersion}` returns `creationId,version`. New expectedVersion0. Receipt SHA256,size exactly matches HTML; checks must pass; duplicate/stale publication rejected;100XP defined game reward per accepted version only.
- Founder `repair {creationId,expectedVersion,intent?}` returns next private draft; old versions retained flat.
- Either `contribute {creationId,version,text}`, `report {creationId,version,text}`, `discover {locationId}`. Unicode preserved, textContent in host. Known discovery IDs relay,river,overlook,ruins; dedup by actor.
- `{code,status}` errors. Custom import max131072 UTF8 bytes; title80,intent2000,contribution500,report1000. Max12 creations. No XP from notes, reports, discoveries or launch simulations.
- Artifacts have `id,kind,title,intent,html,receipt:{algorithm:'sha256',digest,size},version,position:{x,y},checks`; drafts also creationId,baseVersion; publications also versions[],publishedAt. Every event has unique id, type, actor, at and explicit game-only semantics. World is a game projection; canonical institutional kernel history remains distinct.
- `publicWorld(world,actor)` omits drafts for Witness. `validateWorld(raw)` async checks schema, shapes and exact bytes incl history; browser persistence imports are private, never authority grants.
- `game/artifacts.mjs` exports `createArtifact({kind,title,intent,html,version}) -> {html,checks}`. Original assets root may place `/assets/comic/...` later; recipes should work without network (authored fallback graphic comic acceptable, not falsely attributed to an uploaded comic).

## WorldView API (locked)

`new WorldView(canvas,{onInteract,onDiscover,onPosition})`. Methods setWorld, setPresence, setPlayer, getPlayer, goTo(id|{x,y}), interact, setInput({x,y}), focusCreation(id), destroy. Renderer owns keyboard, collision and tap walking; don't cancel existing route for nongeometric world updates. Callback `{type:'workbench'|'creation'|'discovery',id}`; discovery persistence only via onDiscover. World1600×1000 spawn180,640. Workbench325,645; relay670,330; river910,665; overlook1310,310; ruins1280,810. Amber/teal/vermilion ink/parchment, orange beanie, real river/bridges, creations change terrain. No fabricated visitors. Phone320/390/412, keyboard/reduced motion and accessible Places list.

## HTTP API (locked)

`GET /api/state -> {world,viewer,presence,mode:'shared',institution}`. `POST /api/login {key,name?}`, `/api/logout {}`, `/api/action <action>`, `/api/presence {x,y,name?}`. Actions return state DTO plus result. `GET /api/events` SSE world event full viewer-specific DTO; presence event array. `GET /api/artifacts/:id?version=N` published only. `GET /api/export` viewer-filtered DTO. `GET /api/institution` sanitized capabilities and actual kernel/courier/Forge summaries. `POST /api/launch` Founder-only actual local checks, never public posting or machine command from a request. New/unknown sessions Witness. Credentials outside public static allowlist, never exports/packages. Shared offline mode never becomes Founder. Atomic state writes, malformed/oversize/cross-origin requests rejected. Private mode localStorage, backups, import/export, clear quota errors.

## Caveman Launchpad API (root implementation)

`import {rehearseLaunch,makeLaunchPage} from './launchpad.mjs'`.
`rehearseLaunch(world,{title?,tagline?}={})` async -> `{schema:'ngl.launch-rehearsal.v1',title,tagline,createdAt,checks:[{id,label,passed,detail}],ready,artifactCount,receipt?,limitations:[...]}`. Checks actual artifact bytes, no drafts in public export, retained history integrity, playable outputs. No estimated demand or invented counts.
`makeLaunchPage(world,report) -> string` standalone shareable exhibition HTML containing published creations in opaque sandbox frames; escapes untrusted strings. One large button auto-loads an authored starter exhibit when empty in private mode via real draft/publish actions, performs rehearsal and opens the stage; exports launch HTML and a fact-based copy-ready announcement. UI says rehearsal, not already published.

## Acceptance and engineering loop

Meaningful RED→GREEN tests before mechanisms. Execute all original59 tests plus additions; attack role escalation, self-observation, stale/idempotent writes, tampering, traversal, signatures and expiry. Real two-browser world/contribution/privacy/restart; actual iframe buttons/downloads; private reload/export/import; actual standalonefile opening. Forge compare actual passing/failing/timed-out candidates and wall-clock verification cost; no human-hour or3600× claim. Commit evidence/reproduction instructions and source; no runtimekeys/state, no generated secrets in package. One-command startup and verification pipeline; export source archive + standalone launch/game. Final report distinguishes what ran, what remains unavailable, and Founder-only publication authority.
