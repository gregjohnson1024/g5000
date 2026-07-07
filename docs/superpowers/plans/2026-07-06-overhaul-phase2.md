# G5000 UI Overhaul — Phase 2: Shell & Information Architecture

**Branch:** `ui-overhaul`
**Status:** PLAN (ready to execute). Do NOT git commit — the orchestrator commits after a route-smoke.
**Depends on:** Phase 0 (`usePoll`, `SseStoreProvider`) and Phase 1 (token system + `ThemeController` with its TEMPORARY switcher chip) — both shipped.

## Source of truth

- Proposal §5 (Tier-0 Shell), §6 (IA tree + redirect table), §7.1 (shell behavior):
  `docs/design/g5000-ui-overhaul-proposal.md`
- Hard constraints: `docs/design/overhaul-keep-list.md`

## Phase-2 goal (the §9 gate)

> NavShell (AppBar-as-readout: sections, AlarmLane, UTC, link LED, theme chip, bell, MOB cell;
> SectionTabs; phone TabBar); 6-section route tree + full redirect table; one alarm store feeding
> bell+lane+audio; SectionSuggestor dots; Lucide swap in shell; keyboard map.
> **Gate: every legacy URL lands correctly; alarm fires with zero layout shift; old pages render inside
> the new shell untouched.**

## Invariants (must hold at end of every task)

- App builds: `npm run build --workspace @g5000/web`. Typecheck: `tsc -b`. Tests: `vitest run`
  (~7 known-baseline failures OK — see CLAUDE.md; any _other_ failure is a regression).
- Every one of the 35 legacy URLs 3xx-redirects to its new home; every new URL renders.
- `/alerts`, `/mast`, `/chart`, `/anchor` do NOT move (chart/anchor only change SectionTabs visibility).
- AlarmLane is a **pre-reserved fixed AppBar cell** — zero reflow when an alarm fires.
- MOB shell cell keeps the **hold-with-progress** interaction (reuse `components/MobButton.tsx`), not a bare click.
- UTC discipline on the clock; `role`/`aria-pressed`/`aria-current` habits preserved.
- Settings-gated Tide/Currents gate as **tabs INSIDE Conditions** — the section row never pops post-hydration.
- One accent (amber): active section chip + active tab underline only.
- `next/link` for all shell nav. Lucide icons in the SHELL ONLY (do not sweep per-screen).
- Do not remove `serverExternalPackages` in `next.config.ts`; only append `redirects()`.

## Grounding notes (verified against the tree)

- Current nav: `packages/web/src/app/Navbar.tsx` — single flex-wrap `<nav>`, 17 `TOP_LEVEL` tabs +
  `SETTINGS_GROUPS` dropdown + inline `<svg>` bell (lines 276-289) + `▾` chevron (line 216) +
  `usePoll('/api/alarms', 2000)` for the badge. `hiddenHrefs` prop drives `/ais` removal via
  `G5000_HIDE_AIS`. `CANADIAN_TIDE_HREFS` gates `/tide`+`/currents` behind
  `settings.canadianTideCurrents` (fetched in `useEffect`).
- Mounted in `packages/web/src/app/layout.tsx` body, inside `SseStoreProvider`, order:
  `StorageMigrationGate → ThemeController → AlarmBanner → AlarmAudio → Navbar → {children}`.
  `export const dynamic = 'force-dynamic'`.
- `AlarmBanner.tsx` — `usePoll('/api/alarms', 2000)`, sticky top banner, `⚠` (line 56) + `🔊`/`🔇`
  (line 66) emoji, dispatches `AUDIO_TOGGLE_EVENT`.
- `AlarmAudio.tsx` — **its own raw `fetch` + `setInterval(2000)` loop** (lines 84-105), NOT on
  `usePoll` — the rogue third poll of `/api/alarms`. Exports `AUDIO_ENABLED_KEY`,
  `AUDIO_TOGGLE_EVENT`. Klaxon/chirp + AudioContext-arm-on-gesture + `localStorage 'alarms:audio-enabled'`
  MUST be preserved.
- `/api/alarms` GET → `{ active: AlarmRow[], all }`; `AlarmRow = {id, severity:'CRITICAL'|'WARN'|'INFO', label}`.
  Severity rank CRITICAL=3/WARN=2/INFO=1 duplicated in Navbar + AlarmBanner. POST fires manual alarms
  (mob → CRITICAL) with silence-based Navico clearing (keep-list — preserve).
- `SseStoreProvider.tsx` exposes `{ channels, connected, lastSampleAt }` via `SseStoreContext`.
  The link LED reads `connected` (no `useSseStore` selector hook exists yet — add or read context directly).
- `ThemeController.tsx` — reads `Theme` from `@g5000/mast`, applies `data-theme`, SSE-syncs via
  `/api/mast/stream` `theme` events, `setTheme(t)` POSTs `/api/mast/theme`. The TEMP fixed bottom-right
  chip (lines ~85-127) MUST be removed; its `setTheme` + SSE-sync logic is reused by the AppBar ThemeChip.
- `MobButton.tsx` (`components/`) — 800ms hold, POST `/api/alarms {id:'mob',action:'fire'}`, red sweep.
  Takes `livePos` (nullable). There's ALSO a `helm/MobButton.tsx` — leave both; the shell cell uses
  `components/MobButton.tsx`.
- `next.config.ts` has NO `redirects()`/`rewrites()` yet — add `async redirects()`.
- `page.tsx` (root) `redirect('/helm')` → change to `redirect('/sail')`.
- `lucide-react` is NOT a dependency yet — add it (Task 6).
- No tsconfig path alias (no `baseUrl`/`paths`) — all cross-dir imports are relative. **Moving a page
  one directory deeper adds one `../` to every up-escaping import.** Sibling `./Foo` imports are unaffected.
- Boat-state signal sources (Task 5): SOG from SSE store channel `nav.gps.sog`; race-armed from
  `/api/race/timer` (or `/api/race/state`); active route from `localStorage 'chart:planState'`
  (`{ routes }`); anchor-watch armed — implementer to locate (settings key or bus channel; if not
  cheaply derivable, ship the other three dots and leave anchor as a documented TODO — do NOT invent a fake source).

---

## Task order

Tasks run in order. Tasks 2a–2f (route moves) are independent per-section and may run in any order
among themselves, but all must land before Task 3. Each task ends green (typecheck + web build).

---

### Task 1 — NavShell components (AppBar + SectionTabs + phone TabBar), wired to EXISTING URLs

**Goal:** Replace `Navbar.tsx` with a `NavShell` that renders the 6-section AppBar, the SectionTabs
row, and the phone bottom TabBar — but pointing at the CURRENT legacy URLs so the app still renders
before any page moves. This isolates shell layout from route moves.

**Files:**

- CREATE `packages/web/src/app/NavShell.tsx` (client) — the Tier-0 shell. Contains:
  - `AppBar` (~48px, `bg-surface-sunken` / token equivalent): brand "G5000" (`next/link` → `/`) ·
    6 section chips [SAIL, CHART, ANCHOR, CONDITIONS, VOYAGE, BOAT] (active = accent chip via
    `aria-current`; ≥44px targets) · a **pre-reserved AlarmLane cell** (fixed min-width slot, always
    in the DOM; empty when no alarm; when a WARN/INFO alarm is active shows label + ACK affordance;
    tap → `/alerts`) · UTC clock (`HH:MM:SSz`, `tabular-nums`, updates each second) · a **link LED**
    (reads `connected` from `SseStoreContext`: `● LIVE` / `○ LINK LOST`) · a ThemeChip slot ·
    the AlertsBell slot · a **MOB cell** (renders `components/MobButton.tsx`).
    - Task 1 stubs ThemeChip / bell / MOB with the SIMPLEST working versions: ThemeChip may TEMPORARILY
      keep calling into ThemeController's logic (final wiring in Task 3/Task 6); bell can reuse the
      existing inline svg for now (Lucide swap is Task 6); MOB renders `<MobButton livePos={null} />`.
    - AlarmLane in Task 1 may read `usePoll('/api/alarms', 2000)` directly; it is migrated to the
      single alarm store in Task 4. (Do NOT add a _fourth_ poller permanently — Task 4 folds it in.)
  - `SectionTabs` (~40px underline row): sub-nav for the active section. **HIDDEN on `/chart`,
    ABSENT on `/anchor`** (both render no row). Active tab = accent underline (`aria-current`).
  - Phone bottom `TabBar` (6 items, ≥56px targets, `min-h-[56px]`) — shown at narrow widths via
    Tailwind responsive classes (e.g. `md:hidden` for the TabBar, `hidden md:flex` for AppBar section
    chips), so wrapped rows never appear on phones. AppBar collapses to a slim top strip on phone
    (section label · alarm lane · clock · MOB) per §7.1.
- CREATE `packages/web/src/app/nav-sections.ts` — the section model: an array of
  `{ id, label, href, tabs: {label, href}[] }` for SAIL/CHART/ANCHOR/CONDITIONS/VOYAGE/BOAT. In Task 1
  the `href`/`tabs.href` values point at the **current** legacy URLs (e.g. SAIL→`/helm`,
  SAIL▸Race→`/race`, CONDITIONS→`/forecast`, VOYAGE→`/passage`, BOAT→`/settings`, etc). Task 3
  repoints these to the new canonical URLs. Include an `activeSection(pathname)` longest-prefix helper
  (port `bestMatchHref` logic) and preserve `hiddenHrefs` handling for `/ais`.
- EDIT `packages/web/src/app/layout.tsx` — replace `<Navbar hiddenHrefs={hiddenHrefs} />` with
  `<NavShell hiddenHrefs={hiddenHrefs} />`. Keep everything else (SseStoreProvider wrapper, dynamic).
- KEEP `Navbar.tsx` on disk for now (referenced by nothing after this edit) OR delete it — deleting is
  cleaner; if deleted, grep for any other importer first (`grep -rn "Navbar" packages/web/src`).

**Acceptance:**

- `npm run build --workspace @g5000/web` succeeds; `tsc -b` clean.
- App renders with the new AppBar + SectionTabs + phone TabBar; all 6 sections navigate to the
  (still-legacy) pages; active section/tab highlight correctly via `aria-current`.
- AlarmLane cell is present in the DOM even with zero alarms; firing a WARN alarm does not shift the
  clock/LED/bell to the right (verify the reserved slot has fixed width — inspect or reason from the CSS).
- SectionTabs row is not rendered on `/chart` and `/anchor`.
- Settings-gated Tide/Currents are NOT yet inside Conditions (that's Task 3) — acceptable for Task 1
  as long as the section row doesn't pop; if Conditions tabs include tide/currents here, gate them the
  same way Navbar did (default-hidden until settings resolves).

---

### Task 2a — Route move: SAIL section (helm, race, autopilot)

**Goal:** Move the SAIL pages into the section tree via `git mv` and fix relative imports.

**Moves (git mv the whole directory, keeping colocated non-page files together):**

- `app/helm/` → `app/sail/` (helm becomes the SAIL default at `/sail`). Colocated: `CoreStrip.tsx`,
  `HelmTile.tsx`, `HelmTabs.tsx`, `MobButton.tsx`, `PositionTile.tsx`, `AlertsPanel.tsx`,
  `RaceMiniTimer.tsx`, `SailRecommendationTile.tsx`, `groups/`, `use-*.ts`, `*.test.ts`.
  **Depth-NEUTRAL** (still one level under `app/`) — sibling `./` imports survive; up-escaping
  `../../` imports UNCHANGED.
- `app/race/` → `app/sail/race/` — **breaks depth** (now 2 levels). Fix all up-escaping imports:
  `../../lib|hooks|components|...` → `../../../...`. Sibling `./` unaffected. (~scout: race had 5
  up-escaping imports; helm colocated files under `groups/` already use `../../../`.)
- `app/autopilot/` → `app/sail/autopilot/` — **breaks depth**. Same fix (~4 up-escaping imports).
- `/mast` STAYS (bare kiosk) — do not move.

**How to fix imports:** after each `git mv`, run `tsc -b`; the compiler lists every unresolved
relative import. Add one `../` to each up-escaping path. Re-run until clean. Do NOT touch `./` imports.

**Acceptance:**

- `tsc -b` clean; `npm run build --workspace @g5000/web` succeeds.
- `/sail`, `/sail/race`, `/sail/autopilot` all render (legacy `/helm` etc still exist until Task 3 adds
  redirects — that's fine; both can coexist since the dirs moved, so `/helm` now 404s — acceptable
  mid-Task; Task 3's redirects restore them).
- No sibling-import breakage (colocated components resolve).

---

### Task 2b — Route move: CONDITIONS section (forecast, tide, currents, grib, window)

**Moves:**

- `app/forecast/` → `app/conditions/` (Forecast = CONDITIONS default at `/conditions`). **Depth-NEUTRAL.**
- `app/tide/` → `app/conditions/tides/` — breaks depth; fix up-imports.
- `app/currents/` → `app/conditions/currents/` — breaks depth; fix up-imports.
- `app/grib/` → `app/conditions/models/` — breaks depth; fix up-imports.
- `app/window/` → `app/conditions/windows/` — breaks depth; fix up-imports.

**Acceptance:** `tsc -b` + web build green; `/conditions`, `/conditions/tides`,
`/conditions/currents`, `/conditions/models`, `/conditions/windows` all render.

---

### Task 2c — Route move: VOYAGE section (passage, tracker, waypoints, routes, marks-and-routes, tracks, trips, log)

**Moves (note the 3→1 and 3→1 unifications — pick ONE destination page, redirect the others in Task 3):**

- `app/passage/` → `app/voyage/` (Passage = VOYAGE default at `/voyage`). **Depth-NEUTRAL.**
- `app/tracker/` → `app/voyage/tracker/` — breaks depth (~scout: tracker had 0 up-escaping imports, likely trivial).
- **Plan (unify waypoints+routes+marks-and-routes → `/voyage/plan`):** choose the richest existing page
  as the destination. Recommended: `git mv app/marks-and-routes/ app/voyage/plan/` if it already unifies
  waypoints+routes; otherwise `git mv app/waypoints/ app/voyage/plan/`. Then DELETE the two unused
  source page dirs (`git rm -r`) — their URLs will 308 to `/voyage/plan` in Task 3. Phase-2 minimum is
  ONE real page rendering at `/voyage/plan` + all three legacy URLs redirecting; content-merge of the
  other two is a later phase. Document which page was chosen in a code comment.
- **Logbook (unify tracks+trips+log → `/voyage/logbook`):** choose the richest (recommended `trips`,
  per proposal "trips' StatCard grammar wins"): `git mv app/trips/ app/voyage/logbook/`, then
  `git rm -r app/tracks app/log`. One page renders at `/voyage/logbook`; the other two URLs 308 in Task 3.

**Acceptance:** `tsc -b` + web build green; `/voyage`, `/voyage/tracker`, `/voyage/plan`,
`/voyage/logbook` all render. Deleted source dirs are gone (their redirects come in Task 3).

---

### Task 2d — Route move: BOAT section — Performance + Setup (polars, sails, crossover, settings, boat, mast-config, damping, calibration)

**Moves:**

- Performance: `app/polars/` → `app/boat/polars/`; `app/sails/` → `app/boat/sails/`;
  `app/sails/crossover/` → `app/boat/crossover/` (crossover is currently NESTED under sails — move it
  OUT to `boat/crossover`; watch that moving `sails/` first doesn't drag `crossover/` — handle order:
  move crossover to a temp/target first, then sails). Fix up-imports (~sails 5).
- Setup: `app/settings/` → `app/boat/setup/` (Settings = the Setup landing at `/boat/setup`);
  `app/boat/` → `app/boat/setup/profile/` — **CAUTION: `app/boat/` is both the NEW section root AND an
  existing page.** Resolve by: create the new `app/boat/` section hub in Task 3 (BOAT hub landing);
  here, move the EXISTING boat page to `app/boat/setup/profile/`. Do the settings move first so
  `app/boat/` is free, then move old boat page content in. Sequence carefully with `git mv` to a temp
  name if needed.
  `app/mast-config/` → `app/boat/setup/displays/`; `app/damping/` → `app/boat/setup/damping/`;
  `app/calibration/wind|bsp|compass/` → `app/boat/setup/cal/wind|bsp|compass/` (calibration already
  nests per-leaf; move the whole `app/calibration/` → `app/boat/setup/cal/`). Fix up-imports
  (~calibration 6).

**Acceptance:** `tsc -b` + web build green; `/boat/polars`, `/boat/sails`, `/boat/crossover`,
`/boat/setup`, `/boat/setup/profile`, `/boat/setup/displays`, `/boat/setup/damping`,
`/boat/setup/cal/{wind,bsp,compass}` all render. The old `/sails/crossover` nesting is gone.

---

### Task 2e — Route move: BOAT ▸ Diagnostics (wind-diag, devices, sensors, sniff, inspect, sessions, logs)

**Moves (all break depth — fix up-imports each):**

- `app/wind-diag/` → `app/boat/diag/wind/` (~4 up-imports).
- `app/devices/` → `app/boat/diag/devices/`.
- `app/sensors/` → `app/boat/diag/sensors/` (~8 up-imports — highest in this set; watch `sensors/*` colocated).
- `app/sniff/` → `app/boat/diag/sniff/`.
- `app/inspect/` → `app/boat/diag/inspect/`.
- `app/sessions/` → `app/boat/diag/sessions/`.
- `app/logs/` → `app/boat/diag/logs/`.

**Acceptance:** `tsc -b` + web build green; `/boat/diag/{wind,devices,sensors,sniff,inspect,sessions,logs}`
all render.

---

### Task 2f — next.config redirects + root redirect + AIS lens + Conditions gating hook

**Goal:** Every legacy URL 308-redirects to its new home; root goes to `/sail`; `/ais` folds into chart.

**Files:**

- EDIT `packages/web/next.config.ts` — APPEND an `async redirects()` returning `{ permanent: true }`
  (HTTP 308) entries for ALL 35 pairs from the scout `redirectPairs`. Keep `serverExternalPackages`,
  `experimental.externalDir`, `reactStrictMode` intact. Order most-specific BEFORE parent
  (`/sails/crossover` before `/sails`; per-leaf `/calibration/*` before nothing since it's per-leaf).
  Note: `/ais` → `/chart?lens=ais` (destination may carry a query; source may not).
- EDIT `packages/web/src/app/page.tsx` — `redirect('/helm')` → `redirect('/sail')`.
- The three unified redirects (waypoints/routes/marks-and-routes → `/voyage/plan`;
  tracks/trips/log → `/voyage/logbook`) must all be present. Whichever source dir became the
  destination page has NO self-redirect (it renders); the other two redirect to it.

**Redirect table (all `permanent: true`):**

```
/helm → /sail
/race → /sail/race
/autopilot → /sail/autopilot
/ais → /chart?lens=ais
/forecast → /conditions
/tide → /conditions/tides
/currents → /conditions/currents
/grib → /conditions/models
/window → /conditions/windows
/passage → /voyage
/tracker → /voyage/tracker
/waypoints → /voyage/plan
/routes → /voyage/plan
/marks-and-routes → /voyage/plan
/tracks → /voyage/logbook
/trips → /voyage/logbook
/log → /voyage/logbook
/polars → /boat/polars
/sails → /boat/sails
/sails/crossover → /boat/crossover
/settings → /boat/setup
/boat → /boat/setup/profile        (NOTE: only if /boat is not the new hub — see below)
/mast-config → /boat/setup/displays
/damping → /boat/setup/damping
/calibration/wind → /boat/setup/cal/wind
/calibration/bsp → /boat/setup/cal/bsp
/calibration/compass → /boat/setup/cal/compass
/wind-diag → /boat/diag/wind
/devices → /boat/diag/devices
/sensors → /boat/diag/sensors
/sniff → /boat/diag/sniff
/inspect → /boat/diag/inspect
/sessions → /boat/diag/sessions
/logs → /boat/diag/logs
```

**`/boat` special case:** `/boat` is now the BOAT SECTION ROOT (a real hub landing — created here or in
Task 3). The old `/boat` profile page moved to `/boat/setup/profile` in Task 2d. So do NOT add a
redirect that would shadow the section root; instead ensure `/boat` renders the hub. If the hub isn't
built yet, `/boat` may temporarily redirect to `/boat/setup` (not `/boat/setup/profile`) — but the
former `/boat` _page_ content lives at `/boat/setup/profile`. Add a minimal `app/boat/page.tsx` hub
(even a stub card index) so `/boat` resolves without a redirect loop. `/alerts` and `/mast` get NO redirect.

**Acceptance:**

- `npm run build --workspace @g5000/web` succeeds.
- Route-smoke (implementer runs `next start` or dev and curls, or reasons from config): every legacy
  URL returns 308 to its listed destination; every new URL (the 6 section roots + all sub-tabs) returns 200.
- `/` redirects to `/sail`. `/boat` resolves (hub or redirect to `/boat/setup`, no loop). `/alerts` and
  `/mast` unchanged.

---

### Task 3 — Point NavShell at the new canonical URLs + settings-gate inside Conditions

**Goal:** Now that pages live at their new homes, repoint the shell's section model and make the
Tide/Currents gate live as tabs inside Conditions (never popping the section row).

**Files:**

- EDIT `packages/web/src/app/nav-sections.ts` — repoint every `href` and `tabs[].href` to the new
  canonical URLs:
  - SAIL `/sail` · tabs: Helm `/sail`, Race `/sail/race`, Autopilot `/sail/autopilot`, Mast `/mast`.
  - CHART `/chart` · no SectionTabs (dock is the sub-nav).
  - ANCHOR `/anchor` · SectionTabs ABSENT.
  - CONDITIONS `/conditions` · tabs: Forecast `/conditions`, Tides `/conditions/tides` (gated),
    Currents `/conditions/currents` (gated), Models `/conditions/models`, Windows `/conditions/windows`.
  - VOYAGE `/voyage` · tabs: Passage `/voyage`, Plan `/voyage/plan`, Logbook `/voyage/logbook`,
    Tracker `/voyage/tracker`.
  - BOAT `/boat` · tabs: Polars `/boat/polars`, Sails `/boat/sails`, Crossover `/boat/crossover`,
    Setup `/boat/setup`, Diagnostics `/boat/diag/wind` (or a Diag sub-landing). (Keep the tab set
    ≤ what fits; nested Setup/Diag pages remain reachable ≤2 taps.)
- EDIT `packages/web/src/app/NavShell.tsx` — the Conditions SectionTabs must fetch
  `settings.canadianTideCurrents` (reuse Navbar's pattern: default hidden until resolved, so no pop)
  and hide the Tides/Currents tabs when false. **Gate happens INSIDE the Conditions tab row only** —
  the 6 section chips never change. Verify no post-hydration layout shift on the section row.

**Acceptance:**

- `tsc -b` + web build green.
- Every section chip and sub-tab navigates to the correct new URL; `aria-current` correct.
- With `canadianTideCurrents=false`, Conditions shows Forecast/Models/Windows only; the section chip
  row is identical to when it's true (no pop). Toggling the setting shows/hides the two tabs without
  reflowing the section chips.

---

### Task 4 — ONE alarm store feeding bell + AlarmLane + AlarmAudio

**Goal:** A single shared alarm source over `usePoll('/api/alarms', 2000)` feeding the bell badge, the
AppBar AlarmLane, AND the audio — killing the rogue `AlarmAudio` private fetch loop and the
Navbar/AlarmBanner double-poll. Preserve severity ranking + silence-based Navico clearing.

**Files:**

- CREATE `packages/web/src/components/AlarmStore.tsx` (client context/provider) — wraps ONE
  `usePoll<{ active: AlarmRow[] }>('/api/alarms', 2000)`; exposes `{ active, topSeverity, count }`
  via context + a `useAlarms()` hook. Severity rank CRITICAL=3/WARN=2/INFO=1 defined ONCE here
  (remove the duplicated copies in NavShell/AlarmBanner). `AlarmRow = {id, severity, label}`.
- EDIT `packages/web/src/app/layout.tsx` — mount `<AlarmStore>` high enough that NavShell, AlarmBanner,
  AlarmAudio, and the bell all read it (wrap them, inside `SseStoreProvider`). Since NavShell renders
  the AlarmLane + bell, AlarmStore must be an ancestor of NavShell.
- EDIT `packages/web/src/components/AlarmAudio.tsx` — DELETE its private `fetch` + `setInterval` loop
  (lines ~84-105); derive `mode` from `useAlarms()` instead. KEEP the klaxon/chirp, AudioContext-arm,
  and `AUDIO_ENABLED_KEY`/`AUDIO_TOGGLE_EVENT` toggle logic verbatim.
- EDIT `packages/web/src/app/NavShell.tsx` — AlarmLane + bell read `useAlarms()` instead of a local
  `usePoll`. (Removes the temporary Task-1 poller.)
- EDIT `packages/web/src/components/AlarmBanner.tsx` — read `useAlarms()` instead of its own `usePoll`.
  (AlarmBanner may stay as the sticky banner OR be superseded by the AlarmLane; per §7.12 the AlarmLane
  is the warn surface. Minimum for Phase 2: no double-poll. If AlarmBanner is kept, it must not add a
  second poll. Recommended: keep AlarmBanner for now, just cut it over to the store — the full
  banner→lane consolidation is a later phase. Do not regress the mute-toggle behavior.)

**Acceptance:**

- `tsc -b` + web build green; `vitest run` no new failures.
- Exactly ONE poll of `/api/alarms` app-wide (verify by reasoning: all consumers now call `useAlarms()`
  which shares the single `usePoll` key). No component still calls `fetch('/api/alarms')` on an interval
  or a second `usePoll('/api/alarms')`.
- Bell badge, AlarmLane, and audio all respond to the same alarm; severity ranking preserved; mute
  toggle still works; silence-based Navico clearing unaffected (server-side; untouched).

---

### Task 5 — Boat-state SUGGESTION DOTS (+ one-time dismissible toast)

**Goal:** Light a small dot on a section chip when boat state suggests it. NEVER auto-navigate, never
auto-switch theme.

**Signals → section:**

- Anchor-watch armed → dot on ANCHOR. (Source: locate the anchor-watch armed state — settings key or
  bus channel. If not cheaply available, ship the other dots and leave a documented TODO; do NOT fake it.)
- Race timer armed → dot on SAIL. (Source: `/api/race/timer` or `/api/race/state` via `usePoll`.)
- Underway = SOG > 2.5 kt sustained (~90s) → dot on SAIL. (Source: `nav.gps.sog` from `SseStoreContext`;
  debounce with a rolling check so a momentary spike doesn't flip it.)
- Active route → dot on VOYAGE. (Source: `localStorage 'chart:planState'` → `{ routes }` non-empty.)

**Files:**

- CREATE `packages/web/src/app/use-boat-state.ts` (client hook) — returns
  `{ sail: boolean, anchor: boolean, voyage: boolean }` (which sections have a suggestion), derived from
  the signals above. Pure-ish; reads SSE context + `usePoll` + localStorage. Include the SOG debounce.
- CREATE (optional) `packages/web/src/app/SectionSuggestor.tsx` OR fold the toast into NavShell — a
  one-time dismissible toast offering "Jump to ANCHOR?" etc. Dismissal persisted per-signal in
  `localStorage` (e.g. `g5000:suggest-dismissed:<signal>`) so it doesn't nag. The toast NEVER navigates
  on its own; the user taps to go.
- EDIT `packages/web/src/app/NavShell.tsx` — render a dot indicator on the SAIL/ANCHOR/VOYAGE chips
  (and the phone TabBar items) when `use-boat-state` flags them. Dot is a small accent/token mark,
  `aria-label` extended (e.g. "SAIL (suggested)").

**Acceptance:**

- `tsc -b` + web build green.
- With a non-empty `chart:planState.routes`, a dot appears on VOYAGE; clearing it removes the dot.
- Simulated/real SOG > 2.5 kt sustained lights SAIL; race-armed lights SAIL; anchor-armed lights ANCHOR
  (or documented TODO). No auto-navigation, no theme change ever. Toast is dismissible and stays dismissed.

---

### Task 6 — Lucide icons in the SHELL only + remove temp ThemeController chip

**Goal:** Swap the shell's bespoke SVGs/emoji for `lucide-react` (currentColor, so they re-theme), add
the dep, wire the real AppBar ThemeChip, and remove the temporary Phase-1 switcher.

**Files:**

- EDIT `packages/web/package.json` — add `lucide-react` to dependencies. Run install so the lockfile
  updates (`npm install lucide-react --workspace @g5000/web`).
- EDIT `packages/web/src/app/NavShell.tsx`:
  - Bell → `Bell` from lucide (keep severity color classes + badge).
  - Any chevron → `ChevronDown`.
  - ThemeChip → a real control: `Sun` (day) / `Moon` (night) / `SunMedium`-or-similar (sun) glyph
    cycling DAY→NIGHT→SUN. It must reuse ThemeController's `setTheme` + SSE-sync logic. Extract that
    logic so both can share it — RECOMMENDED: refactor `ThemeController.tsx` to expose a `useTheme()`
    hook (or a small `theme-controller.ts` with `setTheme`/current-theme + the SSE listener) that the
    AppBar ThemeChip consumes. `ThemeController` keeps owning the SSE subscription + `data-theme` apply.
  - Link LED / MOB glyphs may use lucide where an icon is wanted (currentColor).
- EDIT `packages/web/src/components/ThemeController.tsx` — REMOVE the temporary fixed bottom-right
  3-way chip (the returned `<div>`, lines ~85-127). ThemeController now renders `null` (or nothing
  visible) and only owns persistence + SSE sync + `setTheme` (exposed for the AppBar chip). Keep the
  pre-hydration inline script in `layout.tsx` intact.
- EDIT `packages/web/src/components/AlarmBanner.tsx` — swap `⚠` (line 56) → lucide `AlertTriangle`;
  `🔊`/`🔇` (line 66) → `Volume2`/`VolumeX`. (AlarmBanner is shell-adjacent; swapping its emoji is
  in-scope per the scout's shellIcons list.)
- DO NOT sweep per-screen emoji/SVGs elsewhere — shell only.

**Acceptance:**

- `tsc -b` + web build green; `lucide-react` resolves.
- The temporary bottom-right theme chip is GONE; the AppBar ThemeChip cycles DAY/NIGHT/SUN, persists,
  and boat-syncs (SSE) exactly as before.
- Bell, chevron, alarm-triangle, and mute icons render via lucide with `currentColor` and re-color
  under `data-theme='night'` / `'sun'`.

---

## Final phase gate (orchestrator runs the route-smoke)

- `tsc -b` clean; `npm run build --workspace @g5000/web` succeeds; `vitest run` at ~baseline
  (~7 known failures, no new ones); `prettier --check .` clean (`npm run lint`).
- Every one of the 35 legacy URLs returns 3xx to its listed new home.
- Every new URL renders (6 section roots + all sub-tabs + `/mast` + `/alerts`).
- Firing an alarm produces zero layout shift (AlarmLane reserved).
- Exactly one `/api/alarms` poll app-wide.
- No auto-navigation / auto-theme from suggestion dots.
- Do NOT git commit — hand back to the orchestrator.

```

```
