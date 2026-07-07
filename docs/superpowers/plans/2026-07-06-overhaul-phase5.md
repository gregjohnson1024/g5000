# UI Overhaul — Phase 5: Chart flagship

Branch: `ui-overhaul`. Migration-plan gate (proposal §7.4/§7.5): the Chart becomes the
flagship — a full-bleed map with a right-side **LayerDock** of lenses (Layers / AIS / Route)
that collapses to a **BottomSheet** on phone; `/ais` is absorbed as the AIS lens; on-map chrome
moves to a **CornerSlots** system; hover/tap **InspectPanel** brings rich inspection to touch;
manual **layer presets**; and the dead Phase-1 `--map-filter` token finally red-shifts the
rasters in NIGHT.

**Do NOT git commit** — the orchestrator commits after verify + smoke.

## ABSOLUTE HARD CONSTRAINT (keep-list, `docs/design/overhaul-keep-list.md` L7-20 — law)

`packages/web/src/components/Map.tsx` is **READ-ONLY this entire phase.** You add chrome
_around_ the map (siblings in the left grid cell of `chart/page.tsx`); you never edit the map
engine. Specifically these must NOT regress:

- 500ms/8px long-press gesture engine + click-swallow + `e.originalEvent` user-vs-programmatic
  discrimination.
- 3° bearing dead-band (`wrapBearingDelta`, in `chart/use-chart-camera.ts`).
- `__above-wind__` z-order sentinel: overlays add with `beforeId: '__above-wind__'`; annotation
  layers append. No `moveLayer`.
- Tile-proxy pattern + `maxzoom` caps for every raster (`/api/tiles`, `/api/enc-tiles`,
  `/api/sat-tiles`, `/api/seamark-tiles`).
- Radar/live raster = `ImageSource` + `updateImage`, **not** `CanvasSource` (`RadarOverlay.tsx`).
- Do NOT gate `add*` on `map.isStyleLoaded()`.
- AIS: threats float to top; per-vessel mute with CPA-snapshot auto-re-arm; stale-target
  exclusion. Preserve **verbatim** — do not re-derive the mute/threat logic.
- MOB already left the map into the shell (Phase 2). Do NOT re-add it to the map. Delete the
  on-map `<MobButton>`; keep the `<MobLayer>` marker.

**Tokens only** — no new raw hex, no `slate-`/`zinc-`/`emerald-`/`rose-`/`amber-`/`sky-`/`teal-`
utilities. Use `--surface`/`--surface-raised`/`--surface-sunken`, `--ink`/`--ink-2`/`--ink-3`/
`--ink-4`, `--ink-value`, `--hairline`/`--hairline-strong`, `--accent`/`--accent-ink`/
`--on-accent`, `--danger`, `--route-active`, `--scrim`, `--focus`. UTC everywhere; mono/tabular
numerals; NM scale; 3-digit bearings; compact DMM (`lib/coords`).

## Current state (scouted — trust this over assumptions)

- `chart/page.tsx` (1486 lines) is `<main className="grid grid-cols-[1fr_360px] ...">`. Left
  cell = `<div className="relative">` holding `<Map>` + all layer components + absolutely
  positioned chrome. Right cell = `<aside className="p-4 border-l border-slate-800 ...">`
  holding `StatusBadge`/`TzToggle`, `LiveValues`, `RadarControls` (gated on `layers.radar`),
  `AnchorCard`, `RoutePlanPanel`, playback/weather/route-details, and the wind-timeline/legend
  block. **This `<aside>` is the fixed 360px sidebar the dock replaces.**
- On-map chrome to relocate/replace: `<ChartToolbar>` (TR, `top-2 right-2 z-10`, wraps
  `LayersControl` popover + `AnnotationDropper` + waypoint-drop toggle); `<ChartFollowControl>`
  (TL, `top-3 left-3 z-10`); `<MobButton className="absolute left-3 top-[100px] z-10">` (the
  hand-measured magic number — DELETE); inline `CursorReadout` (`fixed bottom-3 right-3 z-30`,
  hover-only, no pin — the InspectPanel seed); `<OffscreenVesselIndicator>` (edge pill).
  MapLibre `ScaleControl` is added `'bottom-left'` **inside Map.tsx** (untouchable — BL slot
  must not collide with it).
- `LayersState` (exported from `chart/LayersControl.tsx`): `{ osm, enc, satellite, buoys, bathy,
ais, aisCog, tideStations, currentStations, radar: boolean; model: ChartModel }`.
  `ChartModel = 'none'|'gfs'|'ecmwf'|'hrrr'|'cmems'`. State owned in `page.tsx`, hydrated from
  `localStorage['chart:layers']` in the SSR-safe two-effect dance, validated against the model
  list. **The toggle-key union is duplicated 3×** (LayersControl props, ChartToolbar props,
  page handler) — collapse to ONE exported `LayerToggleKey` type in this phase.
- `?lens=ais` deep-link: `next.config.ts` redirects `/ais → /chart?lens=ais` (permanent), but
  `page.tsx` only reads `searchParams.get('plan')` — **nothing consumes `lens` yet.** Must add.
- AIS lens source lives in `packages/web/src/app/ais/`: `page.tsx` (server, gated on
  `G5000_HIDE_AIS`), `client-view.tsx` (ALL logic — polls `/api/ais/targets` every 2s, own-boat
  via `useSse`, `computeCpa`/`isThreat`/`targetsWithCpa` memo, mute snapshot state, threshold
  edit via GET/PUT `/api/ais/alarm-config`), `TargetsTable.tsx` (the keep-list table:
  threats-float-to-top, per-vessel mute with `mutedAt*0.9` re-arm, STALE 60s / DROP 5min),
  `RadarScope.tsx` (SVG scope — accepted loss per §7.5), `use-threat-audio.ts` (klaxon).
- **AIS threats → AlarmStore is ALREADY WIRED server-side** — `packages/compute/src/alarms/
cpa-monitor.ts` (`startCpaMonitor`, id `ais-cpa`) runs in the boot alarms pipeline
  (`packages/compute/src/alarms/index.ts`), projecting every fresh target vs own GPS every 2s
  into the shared `AlarmsRegistry` → `/api/alarms` → `AlarmStore.tsx` `useAlarms()` → NavShell
  lane/bell + banner + audio. **Deliverable 2 is keep-don't-break, NOT build.** `POST /api/alarms`
  only permits a manual `mob` fire, so the lens must NOT fire alarms client-side.
- **No `BottomSheet` primitive exists** in `components/ui/`. The pattern to reuse/generalize is
  `app/anchor/drawer.tsx`: fixed-bottom, slide-up content panel, bottom tab bar, `localStorage`
  tab, SSR-safe two-state hydration (`activeTab=null` on server → hydrate in effect). It already
  uses tokens (`bg-surface-sunken`, `border-hairline`, `text-accent-ink`).
- `SegmentedControl` (`components/ui/SegmentedControl.tsx`, `role=radio`, `md`/`sm`) is the right
  primitive for the Layers / AIS / Route lens tab bar.
- `--map-filter` is defined on all 3 theme roots in `globals.css` (`:root`/day L113 = `none`,
  `[data-theme='night']` L242 = `brightness(.4) sepia(.9) saturate(2.4) hue-rotate(-30deg)`,
  `[data-theme='sun']` L370 = `none`) but **no element consumes it.** There is **no `--s3` /
  inset spacing token yet** — this phase introduces one.

## Design decisions (locked — do not re-litigate mid-execution)

1. **LayerDock lives in `page.tsx`'s right grid cell** on Pi/desktop (replace the `<aside>`; keep
   the `grid-cols-[1fr_360px]` at ≥ a breakpoint) and becomes a fixed-bottom BottomSheet on
   phone (`grid-cols-1` + sheet). Choose the breakpoint with Tailwind `lg:` (the Pi chart is a
   wide display; phone ≈ 390px). One component (`LayerDock`) renders both; the dock body is
   identical, only the shell (side panel vs. bottom sheet) differs.
2. **Lens tabs = `SegmentedControl`** with values `layers | ais | route`, `size="sm"`. Active lens
   is React state seeded from `searchParams.get('lens')` (only `ais` recognized; anything else →
   `layers`), persisted to `localStorage['chart:lens']`.
3. **`--map-filter` scope = WHOLE-CANVAS container filter** (simplest; explicitly chosen per §7.4).
   MapLibre paints rasters + vector overlays into ONE GL canvas, so wrapping the `<Map>` div in a
   `filter: var(--map-filter)` container red-shifts vector overlays too. §7.4 accepts this
   ("rasters via `--map-filter` red-shift; threat stays red") because threat/route/own-boat are
   token/DOM-coloured DOM chrome, NOT canvas paint — wait, they ARE canvas layers. The accepted
   consequence: in NIGHT the whole map (incl. route/threat vector layers) red-shifts uniformly,
   which is the desired all-red night discipline. Inert in DAY/SUN (`none`). Applied by styling
   the wrapper `<div>` **in page.tsx**, never in Map.tsx.
4. **CornerSlots = one `--s3` inset token** (new; e.g. `12px`, defined once in `globals.css`
   `:root` and inherited by all themes — it's spacing, not colour) driving TL/TR/BL/BR anchored
   containers that stack their children and push each other. BL must clear MapLibre's built-in
   ScaleControl (add a bottom offset so our BL scale/content sits above it, or leave BL empty and
   let the native ScaleControl own BL — decide in Task 4; the native control already renders the
   NM scale, so our "BL scale" slot may simply be a no-op we reserve, not a re-implementation).
5. **Presets are USER-invoked only** — a named `Partial<LayersState>` applied on click, an active-
   preset pill, and reset-to-default. NO automatic per-mode switching (keep-list: "system
   proposes, sailor disposes"). Store the active preset name in `localStorage['chart:activePreset']`;
   it's a label only — the source of truth stays `chart:layers`.

## Deliverables → ordered tasks

Order matters: the dock shell (T1) must exist before AIS/Route lens content (T2/T3) mounts into
it; CornerSlots (T4) is independent of the dock but T1 removes the old TR/TL chrome it replaces;
InspectPanel (T5) sits in the BR slot from T4; presets (T6) live inside the Layers lens from T1;
the NIGHT filter (T7) is a self-contained wrapper change. Ship after each task (build + tests +
`/chart` renders).

---

### Task 1 — LayerDock shell (dock ⇄ BottomSheet) + Layers lens

**Files:**

- NEW `packages/web/src/components/ui/BottomSheet.tsx` — extract/generalize the anchor drawer
  pattern into a reusable Tier-1 primitive (fixed-bottom, slide-up body, snap/peek, SSR-safe
  hydration, token-styled). Keep `app/anchor/drawer.tsx` working (either refactor it to consume
  the new primitive, or leave it and just extract the reusable shell — do NOT regress `/anchor`).
- NEW `packages/web/src/app/chart/LayerDock.tsx` — the dock container: on `lg:` renders in the
  right grid cell as a 360px side panel; below `lg:` renders as a `<BottomSheet>`. Header =
  `<SegmentedControl aria-label="Chart lens" size="sm">` with `layers|ais|route`. Body switches
  on active lens. Owns the active-lens state (seeded from `?lens`, persisted to
  `localStorage['chart:lens']`).
- NEW `packages/web/src/app/chart/lenses/LayersLens.tsx` — the Layers lens body: the SAME toggle
  set as `LayersControl` (osm/enc/satellite/buoys/bathy + safety-depth input, ais/aisCog,
  tideStations/currentStations gated on `showTideCurrents`, radar) as token-styled rows, plus the
  mutually-exclusive model radio (None/GFS/ECMWF/HRRR/CMEMS, `role=radio`/`aria-checked`). Reuse
  the row/model-row semantics from `LayersControl.tsx` but retokenize (kill the `zinc-*`). The
  preset picker (Task 6) mounts at the top of this lens later.
- EDIT `packages/web/src/app/chart/LayersControl.tsx` — export a single `LayerToggleKey` union
  type; keep the component for now if convenient but the dock uses `LayersLens`. Collapse the
  3×-duplicated key union: `LayersLens`, `LayerDock`, and the `page.tsx` handler all import
  `LayerToggleKey` from here (or from `model-layer.ts`) instead of re-typing it.
- EDIT `packages/web/src/app/chart/page.tsx` — read `searchParams.get('lens')`; replace the
  `<aside>` sidebar with `<LayerDock>`; change the outer grid to `lg:grid-cols-[1fr_360px]` +
  `grid-cols-1` (or equivalent) so phone gets a full-bleed map + BottomSheet. Pass the existing
  `layers`/`onToggleLayer`/`onSelectModel`/`safetyDepthM`/`onSafetyDepthM`/`showTideCurrents`
  props through. Remove `<ChartToolbar>` (its LayersControl popover is absorbed by the Layers
  lens; the waypoint-drop toggle + `AnnotationDropper` move to the TR CornerSlot in Task 4 — for
  THIS task, keep them mounted at their current absolute position so nothing is lost between
  tasks). Keep the wind-timeline/legend/route-weather/playback blocks by moving them into the
  Route lens (Task 3) OR temporarily into the Layers lens footer — do not drop them.

**Acceptance:** `/chart` renders with a right-side dock on wide viewport and a bottom sheet on a
narrow viewport (verify by resizing). Layers lens toggles every layer the old popover did
(osm/enc/satellite/buoys/bathy/safety-depth/ais/aisCog/tide/current/radar) and the model radio is
mutually exclusive (None/GFS/ECMWF/HRRR/CMEMS, exactly one `aria-checked`). `chart:layers` still
persists and re-hydrates. `chart:lens` persists the active lens. `?lens=ais` opens on the AIS tab
(placeholder acceptable until Task 2). `/anchor` drawer still works. `tsc -b` + `vitest run`
(~7 baseline fails OK) + `prettier --check` + `npm run build --workspace @g5000/web` green.

---

### Task 2 — AIS lens (absorb the targets table) + threats → AlarmStore (keep-don't-break)

**Files:**

- NEW `packages/web/src/app/chart/lenses/AisLens.tsx` — the AIS lens body. Lift the AIS logic out
  of `app/ais/client-view.tsx` (poll `/api/ais/targets` every 2s, own-boat from `useSse`,
  `computeCpa`/`isThreat`/`targetsWithCpa` memo, mute snapshot + `mutedAt*0.9` auto-re-arm, STALE
  60s / DROP 5min, threshold GET/PUT `/api/ais/alarm-config`, range select persisted to
  `ais:rangeNm`). **Preserve the keep-list behaviour verbatim** — copy the logic, don't rewrite
  it. Render the targets table (reuse/adapt `TargetsTable.tsx`) with: threats floating to top;
  per-vessel mute; STALE exclusion. Two §7.5 refinements: (a) **units in the column HEADER** (NM
  on Range/CPA, min on TCPA, kn on SOG) not repeated in every cell; (b) the mute re-arm rule as
  **visible text** on the row/sheet ("muted ≥{nm} nm") — NOT a `title=` tooltip.
- Do NOT re-render `RadarScope` in the dock (accepted loss per §7.5 — dock-at-full replaces it).
  Do NOT port the klaxon Arm/Test audio chrome into the dock unless it fits cleanly; the global
  AlarmStore already carries threat state app-wide — but if you drop `useThreatAudio`, note it,
  don't silently lose per-tab audio the user relied on. Prefer keeping `Arm audio`/`Test` in the
  lens header.
- EDIT `packages/web/src/app/chart/LayerDock.tsx` — mount `<AisLens>` for the `ais` lens.
- Consider extracting the shared AIS logic into a hook (`app/ais/use-ais-targets.ts` or similar)
  consumed by BOTH the old `client-view.tsx` and the new `AisLens` so there is ONE source of
  truth for the safety-critical CPA/mute code — reduces the risk of the two copies drifting.
- Do NOT touch `packages/compute/src/alarms/cpa-monitor.ts` or the boot pipeline. Do NOT add a
  client-side `POST /api/alarms` fire. The lens edits thresholds via `/api/ais/alarm-config`
  (same server config the monitor reads), so tightening CPA/TCPA in the lens correctly changes
  what the global alarm fires on — verify that path still works end-to-end.

**Acceptance:** `/chart?lens=ais` shows the AIS targets table in the dock: threats pinned to top,
per-vessel mute with visible "muted ≥{nm} nm" re-arm text, stale targets dim/excluded from the
klaxon. Units are in the column headers. Editing CPA/TCPA thresholds in the lens PUTs to
`/api/ais/alarm-config`; a CPA breach still raises a shell alarm (NavShell bell/lane, from the
existing server monitor) — confirmed unchanged. `app/ais/page.tsx` may stay (still gated on
`G5000_HIDE_AIS`; `/ais` continues to redirect to `/chart?lens=ais`). Build/tests/lint green.

---

### Task 3 — Route lens (route-plan controls into the dock)

**Files:**

- NEW `packages/web/src/app/chart/lenses/RouteLens.tsx` — the Route lens body. Move
  `<RoutePlanPanel>` and its dependents out of the old `<aside>` into this lens:
  `RoutePlanPanel`, the `PlaybackScrubber` + `RouteWeatherPanel` + `RouteDetailsBox` block (shown
  when `Object.keys(routes).length > 0`), and the wind-timeline / wind-legend / CMEMS-status /
  HRRR-domain-warning / "Fit to forecast region" block. Also relocate `AnchorCard` and
  `LiveValues` + `StatusBadge` (drop the `TzToggle` per proposal §7.7 UTC-everywhere — or keep it
  if removing it is out of scope for this phase; if kept, do not add new local-time surfaces).
  Keep every prop wired exactly as page.tsx currently passes it.
- EDIT `packages/web/src/app/chart/LayerDock.tsx` — mount `<RouteLens>` for the `route` lens.
- EDIT `packages/web/src/app/chart/page.tsx` — pass the route-plan props (`routePlan`, `routes`,
  `waypoints`, `tz`, `routeColorMode`, `hasMotoring`, `showIsochrones`, `showRouteWind`,
  playback/wind state and setters, `windGrid`, `currentGrid`, forecast bbox, etc.) into the dock
  → RouteLens. This is a plumbing task; no new behaviour.

**Acceptance:** Route planning works entirely from the Route lens: append/clear/route waypoints,
color-mode toggle, isochrones/route-wind toggles, playback scrubber + route weather + route
details when a route exists, wind timeline + legend when a wind model is active, "Fit to forecast
region" button. Nothing from the old sidebar is lost. Build/tests/lint green.

---

### Task 4 — CornerSlots (kill `top-[100px]`) + delete on-map MOB

**Files:**

- NEW `packages/web/src/app/chart/CornerSlots.tsx` — a slot system anchored to the map cell's
  four corners driven by ONE `--s3` inset token. TL = follow/orientation stack
  (`ChartFollowControl`); TR = tool rail (`AnnotationDropper` + waypoint-drop toggle, and
  whatever else was in `ChartToolbar` besides the now-absorbed LayersControl); BL = scale
  (reserve/no-op deferring to MapLibre's native `ScaleControl` which Map.tsx adds `bottom-left`
  — do NOT collide with it; if reserving, offset our content up so it clears the native
  control); BR = InspectPanel host (Task 5 fills it). Slots stack their children and push each
  other; NO hand-measured pixel offsets — everything derives from `--s3`.
- NEW `--s3` token in `packages/web/src/app/globals.css` `:root` (spacing, theme-agnostic; e.g.
  `--s3: 12px`). It is inherited by all three theme roots.
- EDIT `packages/web/src/app/chart/page.tsx` — replace the absolutely-positioned `ChartFollowControl`
  (`top-3 left-3`) and the TR `ChartToolbar` leftovers with `<CornerSlots>` children. **DELETE the
  `<MobButton className="absolute left-3 top-[100px] z-10">`** (the magic-number offender; MOB is
  in the shell per keep-list). **KEEP `<MobLayer>`** (the on-map marker). `OffscreenVesselIndicator`
  stays (edge-anchored, not a corner slot).
- Optionally DELETE `packages/web/src/app/chart/ChartToolbar.tsx` once its two remaining children
  (AnnotationDropper + waypoint toggle) live in the TR slot, and `chart/ChartFollowControl.tsx`
  keeps its internals (stateless) but loses its own `absolute top-3 left-3` wrapper (the slot
  positions it now).

**Acceptance:** No `top-[100px]` (or any hand-measured corner magic number) remains in the chart
tree — `grep -rn "top-\[100px\]" packages/web/src/app/chart` returns nothing. Follow/orientation
sit TL, tool rail TR, InspectPanel host BR, all offset by the single `--s3` inset; slots push
their own children (verify TL still reads correctly with 2 stacked buttons). The on-map MOB button
is gone; the MOB marker and the shell MOB control are unaffected. MapLibre's native BL scale is
not overlapped. Build/tests/lint green.

---

### Task 5 — InspectPanel: hover preview → tap-to-pin with actions

**Files:**

- NEW `packages/web/src/app/chart/InspectPanel.tsx` — evolve the inline `CursorReadout` into a
  pinnable panel in the BR CornerSlot. **Hover** (pointer:fine, e.g. Pi mouse) previews the live
  cursor readout (compact DMM lat/lon via `lib/coords` + sampled wind/current via
  `formatCursorUv`/`sampleUV` + nearest-isobath depth via `nearestContourDepth` + range/bearing
  from boat) — same content as today. **Click/tap PINS** the readout at that lat/lon with a close
  (✕) and two actions: **Drop mark** (→ `dropWaypointAt({lat,lon})`) and **Route here** (→
  `dropWaypointAt(...).then(id => routePlan.setEnd(id))`) — reuse the exact handlers the
  `ChartContextMenu` already wires (`onAddHere`/`onRouteToHere`) so touch reaches the same rich
  inspection the right-click menu gives mouse users. Pinned panel is `pointer-events-auto` (so its
  buttons are clickable); the hover preview stays `pointer-events-none`.
- EDIT `packages/web/src/app/chart/page.tsx` — replace the inline `CursorReadout` render with
  `<InspectPanel>` in the BR slot; wire it to `cursorLatLon`, `livePos`, `mapInstance`,
  `windGrid`, `currentGrid`, and the drop/route handlers. Add a map click/tap → pin path that does
  NOT fight the keep-list gesture engine: the long-press engine already swallows the click after a
  long-press, and `onClick` is currently consumed by `waypointDropActive` — pin on a plain
  click only when waypoint-drop is inactive, OR pin from the existing `onContextMenu`/tap. Do NOT
  edit Map.tsx; use its existing `onClick`/`onContextMenu` props.
- Delete the now-unused inline `CursorReadout` function from `page.tsx` (keep the
  `formatCursorUv` + `nearestContourDepth` helpers — move them into `InspectPanel.tsx` or a small
  `lib/` module if that's cleaner; they must keep working).

**Acceptance:** On mouse hover the BR panel previews cursor lat/lon (compact DMM) + wind/current +
nearest depth + range/bearing (unchanged content). Click/tap pins it with a ✕ and **Drop mark** /
**Route here** buttons that create a waypoint / route to that point (same result as the right-click
menu). The keep-list gesture engine is untouched (Map.tsx unchanged); long-press still drops a
waypoint; waypoint-drop mode still works. Build/tests/lint green.

---

### Task 6 — Manual layer presets (Layers lens)

**Files:**

- NEW `packages/web/src/app/chart/presets.ts` — define `CHART_PRESETS: Record<'default'|'race'|
'anchor'|'passage', Partial<LayersState>>` plus a `DEFAULT_LAYERS` baseline. A preset is a
  partial patch applied over current layers (e.g. Race = model 'gfs' + ais on + aisCog on; Anchor
  = radar on + minimal overlays; Passage = model 'gfs' + bathy off + buoys on — pick sensible
  marine defaults, document each inline). Export a `resetLayers()` that returns `DEFAULT_LAYERS`.
- NEW/ EDIT preset picker inside `packages/web/src/app/chart/lenses/LayersLens.tsx` — a small
  `SegmentedControl` or button group at the top of the Layers lens (Default / Race / Anchor /
  Passage), an explicit **active-preset pill**, and a **reset-to-default** control. Applying a
  preset calls `onApplyPreset(name)`; USER-invoked only — NEVER auto-applied on mode change.
- EDIT `packages/web/src/app/chart/page.tsx` — add `activePreset` state persisted to
  `localStorage['chart:activePreset']` (label only; `chart:layers` stays the source of truth). An
  `applyPreset(name)` handler merges the preset patch into `layers` (via `setLayers`) and sets the
  pill; any manual toggle afterwards clears the pill to "custom" (so the pill never lies about
  what's actually on).

**Acceptance:** The Layers lens shows a Default / Race / Anchor / Passage picker + an active-preset
pill + reset. Clicking a preset applies its layer patch (visible on the map + reflected in the
toggles) and shows the pill; toggling any layer manually clears the pill to custom; reset returns
to `DEFAULT_LAYERS`. Nothing switches automatically. `chart:activePreset` persists. Build/tests/
lint green.

---

### Task 7 — Map NIGHT `--map-filter` application

**Files:**

- EDIT `packages/web/src/app/chart/page.tsx` — wrap the `<Map>` (the left-cell `<div
className="relative">`, or a dedicated inner div that contains ONLY the map, not the DOM chrome)
  with `style={{ filter: 'var(--map-filter)' }}`. **Whole-canvas** approach (decision 3): the
  filter applies to the single MapLibre GL canvas; it is `none` in DAY/SUN and the NIGHT red-shift
  only in NIGHT. Do NOT apply the filter to the CornerSlots/dock/InspectPanel DOM chrome — those
  are already theme-tokened and must not be double-filtered; put the filter on a wrapper that
  contains the map canvas but NOT the absolutely-positioned chrome (e.g. a sibling map wrapper
  behind the chrome), so tokened DOM stays crisp.
- Do NOT touch `Map.tsx`, `globals.css` filter definitions (already correct from Phase 1), or
  `ThemeController.tsx`.

**Acceptance:** In DAY and SUN the map is pixel-identical to before this task (filter resolves to
`none`). Switching the app theme to NIGHT red-shifts the OSM/NOAA/SAT rasters (and, per the
accepted whole-canvas consequence, the vector overlays in the same canvas). CornerSlots, the dock,
and InspectPanel DOM chrome are NOT filtered (they follow the theme tokens directly). `Map.tsx` is
untouched. Build/tests/lint green; `/chart` renders in all three themes.

---

## Phase-end verification (run before declaring done)

```
npx tsc -b
npx vitest run                 # ~7 known-baseline env failures OK; any OTHER failure blocks
npx prettier --check .
npm run build --workspace @g5000/web
npm run lint:overhaul
```

Then smoke `/chart`: dock ⇄ bottom-sheet on resize; Layers/AIS/Route lenses; `?lens=ais` deep
link; preset picker; InspectPanel hover + tap-to-pin Drop mark / Route here; theme → NIGHT
red-shifts the map only. Confirm Map.tsx has ZERO diff for the whole phase
(`git diff --stat packages/web/src/components/Map.tsx` empty). **Do NOT git commit** — orchestrator
commits after verify + smoke.
