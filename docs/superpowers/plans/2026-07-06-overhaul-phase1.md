# G5000 UI Overhaul — Phase 1: Token Layer & Three Themes, App-Wide

**Branch:** `ui-overhaul`
**Date:** 2026-07-06
**Spec:** `docs/design/g5000-ui-overhaul-proposal.md` §4 (4.1 theme architecture, 4.2 color roles + hex, 4.3 typography, 4.5 radius/elevation, 4.8 Tailwind-v4 notes)
**Constraints:** `docs/design/overhaul-keep-list.md` (law — no regressions)

## Goal

Three token-only themes on `<html data-theme="day|night|sun">` (default `day`), plus a **compat
bridge** so EVERY screen — including not-yet-rebuilt ones — re-themes without editing components.
DAY must reproduce the current hex values **exactly** (zero visual regression in the default theme).
The bridge is a temporary Phase-1..6 scaffold, deleted in Phase 7; semantic utility classes are the
end state.

## Non-negotiables (hold across every task)

- **Tokens only.** No layout change, no behavior change, no component branches on theme
  (`if (night)` is banned — a missing role, not a code path).
- **Keep-list holds.** In particular during retheme: MOB hold-with-progress interaction; race audible
  schedule; WindDial port/stbd correctness; StalenessShroud; `__above-wind__` sentinel; ImageSource
  (not CanvasSource) for map rasters; AIS threat float + per-vessel mute; offline-honest empty states.
- **Ship-able at phase end.** `tsc -b` clean, `vitest run` at baseline (~7 known failures per
  `g5000/CLAUDE.md`), `npm run build --workspace @g5000/web` succeeds, Pi-deployable.
- **`lint:overhaul` must DROP.** Baseline is ~420 violations (hex + tiny-text) across 485 files.
  Migrating tsx hex to tokens + removing fossils reduces it substantially; the 12 IALA/IHO buoy
  colors in `EncBuoyLayer.tsx` are the accepted floor — do NOT tokenize them.
- **Do NOT `git commit`.** The orchestrator commits after a visual spot-check.

## Verification (run after each task; all must pass before moving on)

```bash
npx tsc -b                                   # typecheck
npx vitest run                               # ~7 baseline failures OK; any NEW failure blocks
npm run build --workspace @g5000/web         # next build --webpack
node scripts/lint-overhaul.mjs               # count must be ≤ prior task's count
```

## Token reference (exact hex — from proposal §4.2; SCOUT is authoritative for derived/missing)

Follow the **proposal ink names** `ink-value / ink / ink-2 / ink-3 / ink-4` (NOT ink-muted/ink-dim).
Full role list, per-theme hex, and the derived/missing-token rules (SUN accent-hi/accent-ink derive
from `#92400E`; NIGHT hue-banned roles map live→danger-steady, demo/replay→ink steps, info omitted;
SUN derived flow/now-line/live) are enumerated in the SCOUT `tokens` block accompanying this plan and
in proposal §4.2 tables. Sequential ramp canonical stops = `WindOverlay` FILL_STOPS (legend derives).

---

## Task 1 — Token layer + compat bridge in `globals.css` (CRUX)

**The whole feature rides on this file. DAY must equal the current hex exactly.**

**Files:**

- `packages/web/src/app/globals.css` (rewrite the token section; keep `@import 'tailwindcss'`, 18px
  root, and the `.fc-slider` skin structure)

**Do:**

1. **Raw token vars.** Define every semantic role from §4.2 as `--<token>` custom properties in three
   scoped blocks:
   - `:root, [data-theme='day'] { … }` — DAY hex. Canvas `#0b0e14`, ink `#cdd6f4`, surface `#0f172a`,
     etc. These MUST reproduce the current defaults (zero regression).
   - `[data-theme='night'] { … }` — NIGHT hex. Strict all-red, luminance-capped ≤~35% except the
     danger-invert block; hue forbidden (no green/blue/yellow, including dials). Map hue-banned roles
     per SCOUT (live→danger-steady, demo/replay→ink steps, omit info, port/stbd are same red-family —
     distinguished by glyph+shape downstream, not by these tokens).
   - `[data-theme='sun'] { … }` — SUN hex. Warm-paper `#f0ede3`, black-on-light ink `#10141d`. Derive
     accent-hi/accent-ink from accent `#92400e`; derive flow-flood→info, flow-ebb→warn-strong,
     flow-slack→ink-3, now-line→ink, stale→ink-4, live→ok.
     Include: surfaces (canvas/surface/surface-raised/surface-sunken), hairlines (hairline/-strong),
     ink 1–5, accent family (accent/-hi/-ink/on-accent/focus), status (ok/-strong, warn/-strong/on-warn,
     danger/-strong/-surface, info/-strong), marine (port/stbd), state chips (live/stale/demo/replay),
     series-1..8, seq-1..6, flow-flood/-slack/-ebb, chart semantics (now-line/own-boat/route-active/
     route-alt/track/ais-normal), scrim, and `--map-filter` (DAY/SUN `none`, NIGHT sepia recipe).
2. **Radius tokens** (§4.5): `--r-control:6px; --r-panel:8px; --r-sheet:12px; --r-badge:999px; --r0:0`.
3. **`@theme inline` block** exposing semantic utilities AND the compat bridge:
   - Semantic: `--color-canvas: var(--canvas)`, `--color-surface: var(--surface)`,
     `--color-ink: var(--ink)`, `--color-ink-2: var(--ink-2)`, `--color-hairline: var(--hairline)`,
     `--color-accent-ink: var(--accent-ink)`, … one per role, plus radius `--radius-*` if convenient.
   - **Compat bridge — redefine the in-use Tailwind color vars** so existing `bg-slate-900` /
     `text-slate-400` / `border-slate-800` / `bg-amber-600` etc. repoint to semantic tokens and flip
     with the theme automatically. Repoint per the SCOUT `bridgeMap` census: slate-950→surface-sunken,
     slate-900→surface, slate-800→surface-raised, slate-700→hairline-strong, slate-500→ink-3,
     slate-400/300→ink-2, slate-200→ink, slate-100→ink-value; zinc-*→same surface/ink roles (kills the
     zinc fork); amber-600→accent, amber-500→accent-hi, amber-700→accent-strong, amber-400/300→accent-ink,
     amber-900→accent-dim-bg, amber-200/100/50→accent-ink-light; gray-*→ink/surface roles; status
     families emerald/green→ok/stbd, rose/red→port/danger, sky/cyan/blue→info, yellow→warn,
     violet/purple→replay/series-5. Because these are DAY-equal by construction, the default theme is
     visually unchanged.
   - **Do NOT override `--color-black` or `--color-white`.** `bg-black` compiles to literal `#000` and
     scrims/overlays depend on it; `bg-white` fossils are handled as explicit swaps in Task 3, not via
     the bridge.
4. **`body`**: change `background:#0b0e14` → `var(--canvas)`, `color:#cdd6f4` → `var(--ink)`. Set
   `color-scheme` per theme (dark for day/night, light for sun) — e.g. a `color-scheme` declaration in
   each `[data-theme]` block. Remove the hardcoded `color-scheme:dark` from `:root` (or make it the
   day default and override in sun).
5. **`.fc-slider`**: keep the skin; repoint the two hex fossils `#ffffff`→`var(--ink-value)` and
   `#334155`→`var(--hairline-strong)`.
6. Keep `font-size:18px` on root (the one existing correct token) and the font-family stack.

**Acceptance:**

- With no `data-theme` attribute (or `data-theme="day"`), the rendered page is pixel-identical to
  current `main` (DAY = current hex exactly). Spot-check by computed style: `--canvas` resolves to
  `#0b0e14`, `bg-slate-900` → `#0f172a`, `bg-amber-600` → `#d97706`, body bg = `#0b0e14`.
- Setting `document.documentElement.dataset.theme = 'night'` flips canvas to `#000000`, ink to red
  family, and `bg-slate-900`/`bg-amber-600` follow — with NO component edits.
- Setting `'sun'` flips to warm paper, black-on-light, `color-scheme: light`.
- `--color-black` / `--color-white` are untouched (scrims intact).
- `tsc -b`, `vitest run` (baseline), `npm run build --workspace @g5000/web` all pass.

---

## Task 2 — ThemeController + boat-wide sync wiring

**Client applier + DisplayConfig field + SSE event + POST route. Mirror the existing night-mode
plumbing exactly.**

**Files:**

- `packages/db/src/defaults.ts` — add `theme` to `DisplayConfig` + `DEFAULT_DISPLAY_CONFIG`
- `apps/g5000/src/mast/service.ts` — expose `theme$` observable + `getTheme()`
- `packages/mast/src/types.ts` — add `theme$` / `getTheme()` to the `MastRuntime` interface
- `packages/web/src/app/api/mast/theme/route.ts` — NEW (copy `night-mode/route.ts`)
- `packages/web/src/app/api/mast/stream/route.ts` — emit initial `theme` event + subscribe `theme$`
- `packages/web/src/components/ThemeController.tsx` — NEW client component (applier + minimal switcher)
- `packages/web/src/lib/storage.ts` — add `['theme', 'g5000:theme']` to `LEGACY_KEY_MAP`
- `packages/web/src/app/layout.tsx` — mount `<ThemeController/>` inside `SseStoreProvider`

**Do:**

1. **DisplayConfig.** Add `theme: 'day' | 'night' | 'sun'` (define a `Theme` type export) to
   `DisplayConfig`; default `'day'` in `DEFAULT_DISPLAY_CONFIG`. Keep `nightMode` boolean untouched —
   it still drives the physical Chipsee mast; the `theme` enum is the app-wide 3-way.
2. **Mast runtime.** In `apps/g5000/src/mast/service.ts`, add `get theme$(): Observable<Theme>`
   (`configStore.displayConfig$.pipe(map(c => c.theme))`) and `getTheme(): Theme`, mirroring the
   existing `nightMode$` / `getNightMode()`. Declare both on the `MastRuntime` interface in
   `packages/mast/src/types.ts`.
3. **POST route.** Copy `api/mast/night-mode/route.ts` → `api/mast/theme/route.ts`: GET returns
   `{ ok, theme }`; POST validates `theme ∈ {'day','night','sun'}`, calls
   `setDisplayConfig({ ...getDisplayConfig(), theme })`.
4. **SSE.** In `api/mast/stream/route.ts`, add `send('theme', mastRuntime.getTheme())` to the initial
   burst and a `mastRuntime.theme$.subscribe(t => send('theme', t))` subscription (unsubscribe on
   abort, same pattern as `nightModeSub`).
5. **ThemeController** (`'use client'`): on mount, apply theme to `<html data-theme>` from — in
   priority order — the persisted `storageGet('theme')` value, else `'day'`. Open an
   `EventSource('/api/mast/stream')` (mirror `use-mast-control.ts`), listen for the `theme` event, and
   on receipt apply `data-theme` + `storageSet('theme', t)` so the boat-wide value wins and persists.
   Expose `setTheme(t)` which optimistically applies + persists + `POST /api/mast/theme`. Include a
   **minimal temporary 3-way switcher** (a small fixed-position chip cycling DAY→NIGHT→SUN) so themes
   are testable now; the full AppBar theme chip lands in Phase 2 — leave a comment saying so.
   suncalc may _suggest_ night via a one-time civil-twilight toast but MUST NEVER auto-switch
   (keep-list §"System proposes, sailor disposes"); implementing the suggestion toast is optional in
   Phase 1 — if skipped, note it. Persist via the `g5000:` storage helper; add the `['theme',...]`
   entry to `LEGACY_KEY_MAP` (no legacy key exists, so it is a no-op that keeps the census honest).
6. **Mount** `<ThemeController/>` in `app/layout.tsx` inside `<SseStoreProvider>` (alongside
   `StorageMigrationGate`). To avoid a first-paint flash, either apply the persisted theme in an inline
   pre-hydration script in `<head>` or accept the default-day flash (document the choice).

**Acceptance:**

- Cycling the temp switcher flips the whole app between DAY/NIGHT/SUN with no per-screen edits (rides
  Task 1's bridge). `<html>` gains `data-theme="night"` etc.
- `POST /api/mast/theme {"theme":"night"}` returns `{ok:true,theme:"night"}` and persists into
  `config.db`; a second browser/tab connected to `/api/mast/stream` receives the `theme` event and
  flips (boat-wide sync).
- Reload preserves the last theme (persisted via `g5000:theme`).
- `nightMode` boolean is unchanged; the physical mast is unaffected.
- `getDisplayConfig()` round-trips `theme`; `config-store` tests still pass (update the DisplayConfig
  test fixture if it asserts an exact object shape).
- `tsc -b` clean (new interface members implemented), build + vitest baseline pass.

---

## Task 3 — Delete light-theme fossils + unify canvas forks

**Retheme every light/inverted fossil to tokens; collapse the ~5 page-canvas forks onto the canvas
token. Tokens only — preserve all interactions.**

**Files (fossils, per SCOUT):**

- `packages/web/src/app/sails/page.tsx` — bare `border` inputs, `text-blue-500` add-link,
  `text-red-500` delete, `text-gray-500`, untokened h1 → surface/ink/hairline/accent/danger
- `packages/web/src/app/sails/crossover/page.tsx` — bare `border` select, `text-gray-500/400`,
  `bg-blue-100` active row (~line 111) → tokens
- `packages/web/src/app/sails/CategoryRecommendation.tsx` — `bg-gray-100` pill (~line 64) →
  surface-raised
- `packages/web/src/app/sails/SailOverlayChart.tsx` + `SailRegionEditor.tsx` — audit for light SVG
  grid/bg; retheme any found
- `packages/web/src/app/helm/MobButton.tsx` — WHITE MOB confirm modal `bg-white`/`text-gray-600`/
  `bg-gray-200` cancel → surface-raised/ink/scrim. **KEEP the hold-with-progress interaction (keep-list).**
- `packages/web/src/app/race/RaceAudible.tsx` (~line 126) — `bg-gray-200 text-gray-800` mute button →
  surface-raised/ink. **KEEP the audible schedule (keep-list).**
- `packages/web/src/components/AudibleAlarm.tsx` (~line 107) — `bg-gray-200 text-gray-800` mute →
  surface-raised/ink
- `packages/web/src/app/tracker/page.tsx` (~line 39) — WHITE PredictWind iframe wrapper `bg-white` →
  surface/canvas
- `packages/web/src/app/helm/AlertsPanel.tsx` (~line 108) — `bg-slate-100 text-slate-900
hover:bg-white` inverted-white active state (night hazard) → accent/surface

**Files (canvas forks → `bg-canvas`, per SCOUT):**

- `packages/web/src/app/helm/page.tsx:38` · `app/race/page.tsx:12` · `app/anchor/page.tsx:62` ·
  `app/passage/page.tsx:222` · `app/tracker/page.tsx:12` · `app/sniff/page.tsx:190` — `bg-black` →
  `bg-canvas` (explicit swap: `bg-black` is a literal, NOT bridged)
- `packages/web/src/app/wind-diag/page.tsx:227` — `bg-slate-950` rides the bridge to surface-sunken;
  switch to `bg-canvas` for parity if a page canvas is intended

**Do:**

- Replace each fossil's light/inverted utilities with the semantic token utility exposed in Task 1
  (`bg-surface`, `bg-surface-raised`, `text-ink`, `text-ink-2`, `border-hairline`, `text-accent-ink`,
  `text-danger`, `bg-scrim`, etc.). No layout/spacing/behavior change.
- Swap the six `bg-black` page mains to `bg-canvas`.
- Leave `components/Map.tsx:85` `__bg-black__` chart-void layer as a literal (noted, not a page fork).
- Verify each keep-list interaction still works by reading the surrounding logic (MOB progress ring,
  race mute schedule, AlertsPanel active state semantics).

**Acceptance:**

- No `bg-white` / `bg-gray-1xx` / `bg-blue-100` / inverted `bg-slate-100 text-slate-900` remain in the
  listed files (`grep` clean).
- All six page mains use `bg-canvas`; each page still renders on a canvas-colored background in DAY
  identical to before, and flips in NIGHT/SUN.
- MOB hold-with-progress, race audible schedule, and AlertsPanel active state are behaviorally
  unchanged.
- `lint:overhaul` count strictly lower than after Task 2.
- Build + vitest baseline + tsc pass.

---

## Task 4 — Migrate hardcoded SVG hex/rgb literals to tokens

**The ~30 SVG-embedded literals cannot ride the class bridge (they are `fill="#..."` / canvas
`fillStyle`), so hand-migrate per the SCOUT `svgHex` inventory. Keep marine-correct port/stbd as their
tokens; keep the IALA/IHO buoy colors as literals.**

**Approach:** read a CSS var at render via `getComputedStyle(document.documentElement)
.getPropertyValue('--<token>')` (for canvas/JS-drawn layers), or use `currentColor` / a token utility
class where the element is styleable by CSS. For MapLibre paint literals, resolve the token to a hex
string at layer-add time (and re-resolve on a `styledata`/theme change if cheap). Where a layer is a
pure SVG marker, prefer `currentColor` + a parent token class.

**Files (per SCOUT `svgHex` — non-exhaustive, follow the inventory):**

- `MultiSourcePlot.tsx` PLOT_PALETTE → `--series-1..8` (this is the canonical series source)
- `WaypointsLayer.tsx`, `RoutePolyline.tsx`, `StartLineLayer.tsx`, `LaylinesLayer.tsx`,
  `MobLayer.tsx`, `LiveBoatMarker.tsx`, `CogExtension.tsx` — stbd/danger/accent-ink/ok/ink-value/canvas
- `CurrentOverlay.tsx`, `BathyLayer.tsx`, `WindOverlay.tsx` — seq ramp / info + danger (WindOverlay
  FILL_STOPS is the canonical ramp SOURCE — legend derives from it)
- `AnchorWatchLayer.tsx`, `AisTargets.tsx`, `RangeRings.tsx`, `StationsOverlay.tsx`,
  `TrackOverlay.tsx`, `DriftArrow.tsx` — route-alt/danger/ink-2/ink-3/surface/scrim/info/replay
- `ForecastGraphTab.tsx`, `ForecastTableTab.tsx`, `TidesTab.tsx`, `currents/page.tsx`, `tide/page.tsx`
  — axis ink-3/ink-2, info, flow-ebb, ok, danger, accent-ink, hairline, surface
- `chart/page.tsx` + `PlaybackScrubber.tsx` — route-alt / accent-hi (route color modes)
- `CalHeatmap.tsx`, `PolarHeatmap.tsx`, `PolarPlot.tsx` (rgb() literals) — hairline/ink-value/surface/
  accent-hi/stbd/ink/port/info
- `passage/page.tsx`, `helm/SailRecommendationTile.tsx`, `RouteWindLayer/IsochroneLayer/RangeRings`,
  `RouteWeatherPanel.tsx`, `WindShiftPlot.tsx`, `WindowHeatmap.tsx`, `TileGridOverlay.tsx`,
  `RouteConnector.tsx` — accent-ink/ok/info/ink-\*/hairline-strong/ink-value

**Explicit exceptions (do NOT tokenize — flag and leave):**

- `EncBuoyLayer.tsx` — 12 IALA/IHO nautical-chart-standard buoy colors. Accepted spec exception; the
  `lint:overhaul` floor. Add a comment marking them intentional.
- `mast/page.tsx:53` `#fff` — governed by mast `DisplayConfig` day-base-color, not the web theme.
- `Map.tsx:85` `#000000` chart-void — leave literal.

**Do:**

- Migrate each literal to the matching token per the inventory. Marine port/stbd keep their dedicated
  `--port` / `--stbd` tokens (distinct from danger/ok even when near in hue — keep-list marine law).
- For NIGHT correctness, tokens auto-resolve to red-family; no per-theme branch in the component.
- Where a value is a halo/outline against the canvas, map `#000000`/`#0b0e14` → `--canvas`.

**Acceptance:**

- Every listed SVG/canvas literal resolves via a token; `grep` for raw `#` hex in the migrated `.tsx`
  files returns only the three explicit exceptions (EncBuoyLayer, mast/page, Map.tsx).
- WindDial and chart overlays render correctly in DAY (visually identical) and flip appropriately in
  NIGHT/SUN (spot-check the chart + a plot tab).
- WindOverlay legend still derives from FILL_STOPS (canonical-ramp law); no legend/render drift.
- `lint:overhaul` count strictly lower than after Task 3 and materially below the ~420 baseline.
- Build + vitest baseline + tsc pass; Pi-deployable.

---

## Ordering rationale

1→2→3→4 is a strict dependency chain: the token layer + bridge (Task 1) must exist before anything can
reference tokens or be tested; the ThemeController (Task 2) makes the themes switchable so Tasks 3–4
can be verified in all three themes; fossils/canvas forks (Task 3) and SVG literals (Task 4) are
independent retheme sweeps that both consume the Task-1 utilities and can be validated with the Task-2
switcher. Each task ends green and Pi-deployable.
