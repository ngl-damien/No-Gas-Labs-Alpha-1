# NGL TOTAL HANDOFF PACKAGE v1.0
## For Agent Swarm Execution — Pick Up And Build

**Owner:** Damien Featherstone (The Neophyte_Founder™)  
**Organization:** No-Gas-Labs-Official  
**GitHub:** https://github.com/No-Gas-Labs-Official/no-gas-labs  
**Created:** 2026-06-24  
**Status:** 2 products deployed, 84 modules awaiting activation

---

## CRITICAL CONSTRAINTS (NEVER VIOLATE)

1. **Owner has Android phone ONLY.** Every deliverable must work on mobile Chrome.
2. **Owner is NOT a programmer.** No terminal commands, no build steps, no "npm install."
3. **Owner has $0 budget.** No paid services, no hosting fees, no API subscriptions unless free tier.
4. **Owner CANNOT debug.** If it doesn't work on first open, it doesn't work.
5. **All API keys stored in owner's browser ONLY.** Never hardcode keys. Never log keys.
6. **Everything must work offline** (except AI calls). PWA required for all deliverables.
7. **Single-file preference.** One HTML file > project with build steps. Owner opens file = product works.

---

## THE TWO PRODUCTS (LIVE NOW)

### Product 1: NGL Sovereign Seed (`ngl-sovereign.html`)
**What:** A living world that builds what you speak. RuneScape-inspired RPG with 6 zones.  
**Size:** 65KB single HTML file.  
**Location:** `src/ngl-sovereign.html`  
**Deployed:** https://no-gas-labs-official.github.io/no-gas-labs/

**Features Working:**
- ✅ 6 visual zones (Throne, Oracle, Fountain, Culling, Forge, Console)
- ✅ 4 AI Oracle integration (OpenAI, Claude, Gemini, Grok)
- ✅ Turn-based combat vs 3 Murderous Wizards
- ✅ 4 crafting recipes at Organ Forge
- ✅ Skill tree (10 nodes, 5 branches)
- ✅ 4 quests with stage tracking
- ✅ localStorage auto-save every 30s
- ✅ PWA (Add to Home Screen, works offline)
- ✅ CRT scanline visual effects
- ✅ Mobile-optimized touch controls

**Features NOT Working (Backlog):**
- ⬜ Guardian relationship levels (0-100, changes dialogue)
- ⬜ Video player for Prometheus Protocol MP4
- ⬜ Advanced skill tree (21 nodes from spec)
- ⬜ Equipment system (weapons/armor with stat bonuses)
- ⬜ Procedural dungeon generation
- ⬜ Multiplayer layer (WebSocket)
- ⬜ Audio/sound effects

---

### Product 2: Empire OS (`empire-os.html`)
**What:** Modular command center for 86 GitHub repos. The motherboard.  
**Size:** 43KB single HTML file.  
**Location:** `src/empire-os.html`  
**NOT YET DEPLOYED** (push to GitHub to deploy)

**Features Working:**
- ✅ 6-zone navigation (Dashboard, AI Council, Podcast Pipeline, Marketplace, Audience Builder, Module Registry)
- ✅ Full Module Registry — all 86 repos mapped into 6 families
- ✅ 4 AI Oracle integration (same keys as Product 1)
- ✅ Conversational coding engine (speak → AIs debate → consensus)
- ✅ Twitter thread generator
- ✅ 7-day content calendar
- ✅ 3-tier marketplace ($15 / $150 / $500) with DM templates
- ✅ Podcast pipeline visualization (6 agents)
- ✅ Empire state persistence (localStorage)
- ✅ Export/reset functionality

**Features NOT Working (Backlog):**
- ⬜ GitHub API integration (needs PAT to show real repo stats)
- ⬜ Module activation workflow (click scaffold → AI generates code)
- ⬜ Podcast episode tracker
- ⬜ Client CRM (track leads, sales, follow-ups)
- ⬜ Revenue dashboard (track $15 sales)
- ⬜ Automated audience analytics

---

## COMPLETE FILE INVENTORY

```
handoff/
├── HANDOFF.md              ← YOU ARE HERE
├── src/
│   ├── empire-os.html      ← Product 2: Empire command center (43KB)
│   └── ngl-sovereign.html  ← Product 1: World builder RPG (65KB)
├── docs/
│   ├── EMPIRE_BLUEPRINT.md ← Architecture: 86 repos mapped to 6 families
│   ├── SELL_THIS.md        ← Pricing tiers, DM templates, Twitter threads
│   └── RESILIENCE_REPORT.md ← 10 failure scenarios, 9.5/10 score
└── assets/
    └── (empty — for future sprites, audio, video)
```

**External Assets (in `public/assets/` of deployed version):**
- `wizard-01.png` through `wizard-04.png` — Pixel art guardian sprites
- `poster-recruitment.jpg`, `poster-natalchart.jpg`, `poster-wizardguide.jpg`, `poster-agp.jpg` — Easter egg collectibles
- `prometheus-protocol.mp4` — Video asset (not yet playable in-game)

---

## ARCHITECTURE

### Product 1: NGL Sovereign Seed

```
Single HTML file (65KB)
├── CSS (15KB) — CRT effects, zone themes, pixel borders, animations
├── HTML (8KB) — 6 zones, HUD, dialogue overlay, combat overlay
└── JavaScript (42KB)
    ├── State Management (Zustand-like pattern via localStorage)
    │   ├── Player (level, XP, HP, tokens, location)
    │   ├── Inventory (materials, items, quantities)
    │   ├── Skills (10-node tree with prerequisites)
    │   ├── Quests (4 quests, stage-based progression)
    │   ├── World (8×8 grid, fog-of-war, cell discovery)
    │   └── NPCs (4 guardians, 3 enemies with dialogue)
    ├── Game Systems
    │   ├── Movement (WASD / Arrow keys / Touch)
    │   ├── Combat (turn-based d20, 3 enemy types)
    │   ├── Crafting (4 recipes, material costs)
    │   ├── Dialogue (choice-based branching)
    │   └── XP/Leveling (formula: xpNext = floor(xpNext × 1.5))
    ├── API Integration
    │   ├── callOracle() — async fetch to 4 endpoints
    │   ├── processSovereignCommand() — debate + consensus
    │   └── Error handling (timeout, 401, 429, network fail)
    └── Persistence (localStorage auto-save)
```

### Product 2: Empire OS

```
Single HTML file (43KB)
├── CSS (12KB) — 6 zone themes, module cards, pipeline visualization
├── HTML (6KB) — 6 zones, bottom nav, notification system
└── JavaScript (25KB)
    ├── State Management
    │   ├── Player (level, XP, tokens)
    │   ├── API Keys (4 oracle endpoints, encrypted in localStorage)
    │   ├── Empire Log (timestamped actions)
    │   └── Stats (oracle calls, items sold, clients, threads)
    ├── Module Registry (86 repos in 6 families)
    │   ├── Family 1: Core Products (3 repos, all REAL)
    │   ├── Family 2: Intelligence System (3 repos, all REAL)
    │   ├── Family 3: AI Agents — Podcast Pipeline (8 repos, SPECS)
    │   ├── Family 4: Featherstone Protocol (18 repos, DUPLICATES)
    │   ├── Family 5: Scaffolded Modules (26 repos, SHELLS)
    │   └── Family 6: Governance & Infra (10 repos, SHELLS)
    ├── Revenue Systems
    │   ├── Marketplace (3 pricing tiers)
    │   ├── Client Funnel (DM template + payment flow)
    │   └── Content Calendar (7-day schedule)
    └── Audience Builder
        ├── Twitter Thread Generator (3 templates, topic input)
        ├── Content Calendar (Day 1-7 pre-planned)
        └── Growth Tactics (daily/weekly habits)
```

---

## PRIORITY BACKLOG (WHAT TO BUILD NEXT)

### P0 — CRITICAL (Do First)

1. **Merge Products** — Combine `empire-os.html` and `ngl-sovereign.html` into one unified file. The world builder should be a zone within the command center. When user says "build me a calculator" in the Console, the calculator appears as a new zone in the world.

2. **GitHub API Integration** — Add real-time repo stats to the Module Registry using the GitHub PAT. Show: last commit date, file count, language, size. This makes the dashboard feel alive.

3. **Module Activation Workflow** — When user clicks a SHELL module, trigger the AI Council to generate implementation code. The generated code becomes a new "organ" (working feature) in the world. Log the mutation.

### P1 — HIGH (Do After P0)

4. **Guardian Relationship System** — Track relationship level (0-100) with each guardian. Higher levels unlock new dialogue, quests, and crafting recipes. Relationship increases through conversation and completing quests.

5. **Podcast Episode Tracker** — Add actual episode management to the Podcast Pipeline zone. Track: episode status (idea → recording → editing → published), guest info, publish date, platform links.

6. **Client CRM** — Simple lead tracker. Fields: name, source (Twitter/DM/referral), status (lead → contacted → paid → onboarded), notes, follow-up date. Stored in localStorage.

7. **Revenue Dashboard** — Track $15 sales. Input sales manually ( Venmo/Cash App screenshots → parse amount). Show: total revenue, sales this week, conversion rate, top source.

### P2 — MEDIUM (Do After P1)

8. **Video Player** — Make the Prometheus Protocol MP4 playable in-game. Add as a collectible artifact that triggers a video modal. Used for quest completion.

9. **Audio System** — 8-bit sound effects for combat, item pickup, level-up. Use Web Audio API. Toggle on/off in settings.

10. **Advanced Skill Tree** — Expand from 10 nodes to 21 nodes (full spec in `src/data/skills.ts` of React scaffold). Add: Acronym Immunity, Stair Climbing, Delivery Mastery, Authenticity Shield, The Show Me Stance (ultimate).

### P3 — NICE TO HAVE

11. **Procedural Quests** — Random quest generator: "Defeat [N] [enemy type] in [terrain] for [reward]"
12. **Multiplayer** — WebSocket room for shared world exploration
13. **Equipment System** — Weapons/armor with stat bonuses, visual indicators
14. **Save Slots** — 3 localStorage save slots

---

## DEVELOPMENT ENVIRONMENT

**Preferred Stack:** Single HTML files with embedded CSS/JS. No build tools. No frameworks. No npm.

**If you MUST use a framework:** Use the React scaffold at `/mnt/agents/output/app/` (already initialized with Vite + Tailwind + shadcn/ui + Zustand). But the final deliverable must still be a single HTML file the owner can open on Android.

**To convert React → Single HTML:** Use Vite build, then inline all assets using `vite-plugin-singlefile` or manual inlining.

**Asset Pipeline:**
- Images: Convert to base64 and inline, or place in `public/assets/`
- Audio: Use Web Audio API (synthesize sounds, no external files)
- Video: Reference external URL or use base64 for short clips
- Fonts: Use Google Fonts CDN imports

---

## DEPLOYMENT

**Primary:** GitHub Pages  
**Repo:** No-Gas-Labs-Official/no-gas-labs  
**URL:** https://no-gas-labs-official.github.io/no-gas-labs/  
**Branch:** main (root directory)

**To deploy:**
1. Commit changes to `/tmp/no-gas-labs/` (cloned repo)
2. `git push origin main`
3. Wait 2-3 minutes for GitHub Pages to rebuild

**GitHub PAT:** [OWNER PROVIDES THIS — DO NOT COMMIT TO REPO]  
**Username:** No-Gas-Labs-Official

**Android Install:**
1. Open deployed URL in Chrome
2. Tap "Add to Home Screen"
3. App installs as standalone PWA
4. Works offline (cached by service worker)

---

## GITHUB REPOSITORIES (86 Total)

### PUBLIC (7 repos)
| Repo | Role | Action |
|------|------|--------|
| `no-gas-labs` | **DEPLOYMENT TARGET** — Products live here | Keep, this is home |
| `culling-of-murderous-wizards` | Interactive comic — best creative work | Keep, link from product |
| `ngl001-def4us28` | NGL lore bible | Keep, canonical reference |
| `no-gas-labs-command-center` | Full-stack TypeScript (26MB, abandoned) | Revive as backend |
| `ai-guild-hardened-v0.2` | Mobile ops intelligence (59K LOC) | Revive as backend |
| `TaskAgile` | Task management (143 files) | Integrate as module |
| `ai-guild-hardened-v0.2` | AI Guild protocol | Revive as foundation |

### PRIVATE (79 repos)
All 79 private repos are described in the Module Registry within `empire-os.html`. The 18 `featherstone-*` repos are duplicates of the 8 podcast agent repos and can be archived. The 26 scaffolded repos from Feb 19 should be activated one by one via the AI Council.

---

## USER PERSONA

**Name:** Damien Featherstone  
**Title:** The Neophyte_Founder™  
**Brand:** No_Gas_Labs™  
**Tagline:** No Gas. Just Go.™  
**Background:** 24 years on the margins. Built from a phone and the refusal to quit.  
**Products:**
- The Culling of Murderous Wizards (40-page digital comic)
- America's Got Problems (pilot program / podcast)
- NGL-001 Artifact (canonical manifesto)
- The Primordial Engine (this product)

**Target Audience:**
- Analysts, builders, question-askers, late bloomers
- People who want tools built but can't code
- Creatives tired of performative expertise
- The "unofficial initiates"

---

## ACCEPTANCE CRITERIA (Every Deliverable Must Pass)

Before submitting any work:

1. **Open the HTML file in Chrome on Android.** It must work. No errors.
2. **Turn on airplane mode.** All non-AI features must still work.
3. **Add to Home Screen.** Icon appears. Opens full-screen.
4. **Kill the app and reopen.** State is preserved (localStorage).
5. **Tap every button.** Nothing crashes. Every navigation works.
6. **Portrait and landscape.** Layout doesn't break.
7. **No console errors** (check via chrome://inspect if possible).

---

## BRAND COLORS (Use These Exact Values)

```
--black: #0a0a0a          (background)
--charcoal: #141414        (panels)
--cyan: #00e5ff            (primary accent)
--orange: #ff8c00          (secondary accent)
--gold: #ffd700            (throne/accent)
--purple: #ab47bc          (oracle chamber)
--red: #ff4444             (combat/damage)
--green: #4caf50           (success)
--text: #e0f7fa           (main text)
--text-dim: #78909c        (secondary text)
```

**Fonts:** VT323 (pixel headings), Share Tech Mono (body)  
**Style:** CRT scanlines, pixel borders, dark fantasy RPG aesthetic  
**Tone:** Honest, irreverent, bright-not-gritty. The paper itself feels like it's smiling.

---

## HOW TO PICK UP THIS HANDOFF

1. Read `HANDOFF.md` (this file) — 5 minutes
2. Open `src/empire-os.html` and `src/ngl-sovereign.html` in browser — 2 minutes
3. Pick a P0 task from the backlog above
4. Build it as a single HTML file or modify the existing files
5. Test on Android Chrome (use chrome://inspect for debugging)
6. Commit to `/tmp/no-gas-labs/` and `git push origin main`
7. Update this HANDOFF.md with what you built and what's next

---

*No Gas. Just Go.*  
*Built from a phone and the refusal to quit.*
