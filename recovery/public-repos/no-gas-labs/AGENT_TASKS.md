# AGENT SWARM TASKS — Pick Up And Execute
## Each task is self-contained. No dependencies on other tasks.

---

## TASK-001: Merge Empire OS + Sovereign Seed into Unified Product
**Priority:** P0  
**Complexity:** High  
**Est. Time:** 4-6 hours

**Goal:** Combine `empire-os.html` and `ngl-sovereign.html` into one file. The world builder becomes a zone within the command center.

**What exists:**
- `src/empire-os.html` (43KB) — 6 zones: Dashboard, AI Council, Podcast, Marketplace, Audience, Modules
- `src/ngl-sovereign.html` (65KB) — 6 zones: Throne, Oracle, Fountain, Culling, Forge, Console

**What to build:**
- Single file called `ngl-unified.html`
- Bottom nav has 7 items: Dashboard, World, Council, Pipeline, Market, Audience, Modules
- "World" zone = the entire sovereign seed world (grid, combat, crafting, dialogue)
- When user says "build me a calculator" in Console, the calculator appears as a new zone tab
- All state shared between both products
- Keep under 120KB total

**Acceptance Criteria:**
- [ ] Opens on Android Chrome without errors
- [ ] All 12+ zones accessible via bottom nav
- [ ] State persists across zone switches (localStorage)
- [ ] Works offline (airplane mode test)
- [ ] PWA installable (Add to Home Screen)

**Output:** `src/ngl-unified.html`

---

## TASK-002: GitHub API Integration for Live Module Registry
**Priority:** P0  
**Complexity:** Medium  
**Est. Time:** 2-3 hours

**Goal:** Show real repo stats in the Module Registry instead of static data.

**What exists:**
- Module Registry in `empire-os.html` shows 86 repos with static status
- GitHub PAT: [OWNER PROVIDES THIS — DO NOT COMMIT TO REPO]

**What to build:**
- On Dashboard load, fetch real repo data from GitHub API
- Show: last commit date, actual file count, language, repo size
- Cache results in localStorage (refresh every 5 minutes)
- Show "LIVE" indicator when data is fresh
- Handle API rate limits gracefully (60 req/hour without auth, 5000 with)

**API Endpoints:**
- `GET https://api.github.com/users/No-Gas-Labs-Official/repos?per_page=100`
- `GET https://api.github.com/repos/No-Gas-Labs-Official/{repo}/commits?per_page=1`

**Acceptance Criteria:**
- [ ] Dashboard shows real commit dates for top 10 repos
- [ ] Module Registry shows accurate file counts
- [ ] Works with API rate limits (caches, handles 403)
- [ ] Falls back to static data if API fails

**Output:** Updated `src/empire-os.html` with GitHub API integration

---

## TASK-003: Module Activation Workflow
**Priority:** P0  
**Complexity:** High  
**Est. Time:** 4-6 hours

**Goal:** Click a scaffolded module → AI Council generates implementation → new "organ" appears in the world.

**What exists:**
- Module Registry shows 26 SHELL modules and 8 SPEC modules
- AI Council can debate and respond to prompts
- Mutation log tracks changes

**What to build:**
- When user clicks a SHELL module, show "ACTIVATE" button
- On activate: send module name + description to AI Council
- Council generates implementation code (HTML/CSS/JS)
- Generated code appears as a new zone/organ in the world
- Mutation logged with timestamp
- Module status changes from SHELL → REAL

**Flow:**
```
User clicks "sui-flash-loan-protocol" (SHELL)
→ Shows description: "Sui blockchain flash loan system"
→ User clicks ACTIVATE
→ Console shows: "The Council debates implementation..."
→ 4 AIs respond with code suggestions
→ Consensus synthesized
→ New zone "Flash Loans" appears in world
→ Mutation logged: "Activated sui-flash-loan-protocol via Council consensus"
```

**Acceptance Criteria:**
- [ ] Any SHELL module can be activated
- [ ] Activation triggers real AI Council debate
- [ ] Generated feature appears as usable zone
- [ ] Mutation logged with timestamp
- [ ] Module status updates in registry

**Output:** Updated `src/empire-os.html` with activation workflow

---

## TASK-004: Guardian Relationship System
**Priority:** P1  
**Complexity:** Medium  
**Est. Time:** 3-4 hours

**Goal:** Track relationship level (0-100) with each guardian. Higher levels unlock content.

**What exists:**
- 4 guardians: Neophyte, Lore Keeper, Trickster, Recycler
- Dialogue system with branching choices
- Quest system with objectives

**What to build:**
- Relationship level per guardian (0-100)
- Increases through: dialogue choices (+5), quest completion (+20), combat assists (+10)
- Decreases through: ignoring guardian (-2/day), failing quests (-10)
- At 25: Unlock guardian's personal quest
- At 50: Guardian gives exclusive crafting recipe
- At 75: Guardian reveals hidden zone
- At 100: Guardian becomes companion in combat
- Visual: Relationship bar next to each guardian in dialogue

**Guardians:**
| ID | Name | Title | Zone |
|----|------|-------|------|
| neophyte | The Neophyte | Founder of No Gas Labs | Throne |
| lorekeeper | The Lore Keeper | Archivist of Echoes | Oracle |
| trickster | The Trickster | Unofficial Initiate | Crystal Caves |
| recycler | The Recycler | Keeper of the Forge | Forge |

**Acceptance Criteria:**
- [ ] Relationship visible in dialogue UI
- [ ] Choices affect relationship score
- [ ] Thresholds trigger unlocks
- [ ] Persistence across sessions
- [ ] Works on Android

**Output:** Updated `src/ngl-sovereign.html` or `src/ngl-unified.html`

---

## TASK-005: Podcast Episode Tracker
**Priority:** P1  
**Complexity:** Low  
**Est. Time:** 2-3 hours

**Goal:** Add actual episode management to the Podcast Pipeline zone.

**What exists:**
- Podcast Pipeline zone with 6-agent workflow visualization
- Static description of each agent's role

**What to build:**
- Episode list with CRUD (Create, Read, Update, Delete)
- Episode fields: title, status (idea/recording/editing/published), guest, date, platforms
- Status pipeline: Idea → Recording → Editing → Scheduled → Published
- Click agent in pipeline → see what episodes are at that stage
- Sample data: 3 "America's Got Problems" episodes pre-loaded

**Sample Episodes:**
```json
[
  {"title":"AGP Pilot: The Interview","status":"published","guest":"Damien Featherstone","date":"2026-06-01","platforms":["spotify","youtube"]},
  {"title":"AGP Ep 2: The System","status":"editing","guest":"TBD","date":"2026-06-15","platforms":[]},
  {"title":"AGP Ep 3: The Streets","status":"idea","guest":"TBD","date":"TBD","platforms":[]}
]
```

**Acceptance Criteria:**
- [ ] Can add/edit/delete episodes
- [ ] Status pipeline visual
- [ ] Episode count per status
- [ ] Persisted in localStorage
- [ ] Works on Android

**Output:** Updated `src/empire-os.html` or `src/ngl-unified.html`

---

## TASK-006: Client CRM (Simple Lead Tracker)
**Priority:** P1  
**Complexity:** Low  
**Est. Time:** 2-3 hours

**Goal:** Track sales leads from first contact to paid client.

**What exists:**
- Marketplace zone with 3 pricing tiers
- DM template for outreach

**What to build:**
- Simple CRM table: Name, Source (Twitter/DM/Referral), Status, Amount, Date, Notes
- Status pipeline: Lead → Contacted → Pitched → Paid → Onboarded
- Quick-add from DM template ("Convert to lead" button)
- Revenue summary: total, this week, this month
- Follow-up reminders (overdue shows red)

**Sample Data:**
```json
[
  {"name":"Alex (Twitter)","source":"twitter","status":"paid","amount":15,"date":"2026-06-20","notes":"Bought The Seed"},
  {"name":"Sam (DM)","source":"dm","status":"contacted","amount":0,"date":"2026-06-22","notes":"Interested in The Grove"}
]
```

**Acceptance Criteria:**
- [ ] Can add/edit/delete leads
- [ ] Revenue dashboard shows totals
- [ ] Follow-up date alerts
- [ ] Persisted in localStorage
- [ ] Works on Android

**Output:** Updated `src/empire-os.html` or `src/ngl-unified.html`

---

## TASK-007: Revenue Dashboard
**Priority:** P1  
**Complexity:** Low  
**Est. Time:** 2 hours

**Goal:** Track actual revenue from $15 sales.

**What exists:**
- Client CRM (from TASK-006) with payment data

**What to build:**
- Dashboard card: Total Revenue, Sales This Week, Sales This Month
- Simple chart: 7-day sales bar chart (canvas or CSS)
- Top source: Which channel brings most sales
- Goal tracker: "$100 this month" progress bar
- Manual entry: "Record a sale" form (amount, source, date)

**Acceptance Criteria:**
- [ ] Revenue visible on Dashboard
- [ ] 7-day chart renders
- [ ] Goal tracker shows progress
- [ ] Persisted in localStorage
- [ ] Works on Android

**Output:** Updated `src/empire-os.html` or `src/ngl-unified.html`

---

## TASK-008: Video Player for Prometheus Protocol
**Priority:** P2  
**Complexity:** Low  
**Est. Time:** 1-2 hours

**Goal:** Make the bundled MP4 playable in the world as a collectible artifact.

**What exists:**
- `prometheus-protocol.mp4` in public assets
- Quest "The Prometheus Protocol" requires this video

**What to build:**
- HTML5 video player modal (full-screen overlay)
- Trigger: Find the video artifact in crystal caves OR craft Promethean Engine
- Styled to match CRT aesthetic (scanlines overlay on video)
- Playback controls: play/pause, progress bar, close
- Quest advances when video is watched (tracked via timeupdate event)

**Acceptance Criteria:**
- [ ] Video plays full-screen on Android
- [ ] CRT scanline overlay on video
- [ ] Quest advances after 50% watched
- [ ] Close button returns to world
- [ ] Works offline (video cached)

**Output:** Updated `src/ngl-sovereign.html` or `src/ngl-unified.html`

---

## TASK-009: Audio System (8-Bit Sound Effects)
**Priority:** P2  
**Complexity:** Medium  
**Est. Time:** 3 hours

**Goal:** Add sound effects using Web Audio API (no external files).

**What exists:**
- Sound toggle button in HUD
- No audio currently

**What to build:**
- Web Audio API synthesizer for 8-bit sounds:
  - Combat hit: short noise burst + sine wave
  - Item pickup: ascending arpeggio
  - Level up: triumphant chord
  - Error: low buzz
  - UI click: short tick
- Toggle in settings (on/off/volume)
- All sounds synthesized — no external files needed

**Acceptance Criteria:**
- [ ] Sounds play on Android Chrome
- [ ] Toggle works in settings
- [ ] Volume adjustable
- [ ] No external audio files
- [ ] Works offline

**Output:** Updated `src/ngl-sovereign.html` or `src/ngl-unified.html`

---

## TASK-010: Advanced Skill Tree (21 Nodes)
**Priority:** P2  
**Complexity:** Medium  
**Est. Time:** 3-4 hours

**Goal:** Expand from 10 nodes to the full 21-node skill tree from the spec.

**What exists:**
- 10-node skill tree (root + 3 branches × 3 nodes)
- Skill tree visualization with color-coded branches

**What to build:**
- Add 2 more branches (Character Assassination, Performed Connection)
- Add intermediate nodes: Acronym Immunity, Stair Climbing, Delivery Mastery
- Add ultimate node: "The Show Me Stance" (requires all 5 branch max levels)
- Total: 21 nodes across 5 branches + 1 ultimate
- Full spec is in `/mnt/agents/output/app/src/data/skills.ts`

**Acceptance Criteria:**
- [ ] 21 nodes render correctly
- [ ] Prerequisites work
- [ ] Ultimate unlocks when all 5 branches maxed
- [ ] Visual tree doesn't break on mobile
- [ ] Persisted in localStorage

**Output:** Updated `src/ngl-sovereign.html` or `src/ngl-unified.html`

---

## PARALLEL EXECUTION PLAN

**Wave 1 (Week 1):** Tasks 001, 002, 003  
**Wave 2 (Week 2):** Tasks 004, 005, 006  
**Wave 3 (Week 3):** Tasks 007, 008, 009, 010

**Agents can work in parallel on:**
- Agent A → TASK-001 (unified product)
- Agent B → TASK-002 (GitHub API)
- Agent C → TASK-004 (guardian relationships)
- Agent D → TASK-005 (podcast tracker)

**Each agent:**
1. Reads `HANDOFF.md`
2. Picks a task from this file
3. Builds the feature
4. Tests on Android Chrome
5. Commits to GitHub
6. Updates this file marking task COMPLETE

---

*No Gas. Just Go.*
