# UI Overhaul — Phase 4: Glance surfaces

Branch: `ui-overhaul`. Migration-plan gate (proposal §9): _night sail acceptance —
helm / race / autopilot / anchor / mast fully usable in NIGHT._ App builds, passes the
known-baseline test set (~4–7 env failures OK — any OTHER failure is a regression), and
every route resolves at phase end.

**Do NOT git commit** — the orchestrator commits after verify + smoke.

## What Phase 4 rebuilds

The Tier-1 primitives (`components/ui/`) landed in Phase 3: `Panel`, `InstrumentTile`
(with built-in `StalenessShroud`, `d1`–`d4`, `SEVERITY_TEXT` + `SEVERITY_EDGE`),
`StatusChip`, `Button`/`IconButton`/`HoldButton`, `SegmentedControl`, `Dialog`/`ConfirmDialog`,
`Toast`, `Takeover`. **Use these — do not reinvent them.** Phase 4 adds ONE new Tier-2
primitive (`CellGrid`) and rebuilds the four glance surfaces (Helm, Race, Autopilot, Anchor)
plus the Mast kiosk onto the primitive/token grammar, and wires a per-station instrument
`scale` multiplier through `DisplayConfig` exactly the way Phase 1 wired `theme`.

## Hard constraints (keep-list — law; do not regress)

- **Zero-reflow / fixed slots:** every value keeps its slot; render `—` when absent. The one
  offender is `PerformanceGroup` (`{sample && <Tile/>}` collapses the grid) — fix it to
  always-render-with-`—`, mirroring `NavigatingGroup`. `CellGrid` must not introduce reflow.
- **Helm CoreStrip + task-tabs IA** stays (do NOT re-architect the 3-group set — that would
  touch `helm-group.ts` + `helm-group.test.ts` + `use-helm-group.ts` together; out of scope).
- **Race:** audible schedule (`RaceAudible`) + sync-to-gun optimistic snap (`RaceTimer`) kept
  verbatim; Reset stays guarded (already `ConfirmDialog`; add `HoldButton` per proposal 7.2).
- **Autopilot defense-in-depth:** env gate → capability gate → confirm → cooldown → ack log
  kept verbatim; listen-only note preserved. Ack log must render **UTC** (currently local — a
  convention violation to fix).
- **Anchor:** card grammar + bottom drawer (snap/peek) preserved; light-touch retokenize ONLY,
  **no layout change**; `WindDial` port/stbd correctness + dial geometry untouched. Anchor
  breach → Takeover escalation is OUT of scope (deliverable is light-touch).
- **Mast:** physical `nightMode` boolean untouched (`mast-night` stays the all-red kiosk
  state); the JS fit-to-cell sizing (`Tile.tsx` ResizeObserver) stays SEPARATE from `d1`–`d4`;
  scale multiplies ONLY `d1`–`d4`, never mast `Tile.tsx`.
- **Tokens only** — no new raw hex, no `slate-`/`emerald-`/`rose-`/`amber-` utilities.
  `StalenessShroud` on every live value. UTC everywhere; mono/tabular numerals; NM scale;
  3-digit bearings; compact DMM lat/lon.

## Cross-package / stale-dist risk (highest)

Task 6 edits `DisplayConfig` (`packages/db`) and `MastRuntime` (`packages/mast`) — composite
refs. Per CLAUDE.md, **after editing types run `tsc -b`**; if a dist looks stale after a branch
swap, `rm -rf packages/<name>/dist && npx tsc -b packages/<name> --force`. `packages/web`
imports these via compiled `dist/*.d.ts`; a stale `db/dist` or `mast/dist` makes `next build`
fail with confusing `Type X not assignable to Y` and a failed `next build` wipes
`.next/BUILD_ID` (= Pi outage). Pi rebuild chain: `tsc -b core mast db compute bridge grib
routing coastline → g5000 app → web → restart`.

---

## Tasks (execute in order)

### Task 1 — CellGrid primitive (Tier-2)

**New:** `packages/web/src/components/ui/CellGrid.tsx`; export from
`packages/web/src/components/ui/index.ts`. **New test:**
`packages/web/src/components/ui/CellGrid.test.tsx`.

The glance-surface container from proposal 7.1: a hairline-divided, `gap-0` grid of
`InstrumentTile` cells inside a rounded `Panel`. Each cell keeps its 3px severity left-edge
(already on `InstrumentTile` via `SEVERITY_EDGE`) and a whole-cell hit target; responsive
column count. Cells are `r0` (square corners) inside the rounded Panel — the Panel supplies the
outer `--r-panel` radius; hairline dividers separate cells.

API (compose, don't reinvent): render an array of cells where each cell is an `InstrumentTile`
(or accepts `InstrumentTileProps`-shaped items) plus an optional `href`/`onClick` for the
whole-cell hit target. Prefer:

```
<CellGrid label?="CORE" cols={{ base: 3, md: 6 }}>{cells}</CellGrid>
```

where the grid draws hairlines via `divide`/`border` tokens (`border-hairline`), `gap-0`, and
overflow-clips to the Panel radius (`overflow-hidden` + `[border-radius:var(--r-panel)]`).
`label` is optional (Panel header voice); when present, wrap in / reuse `Panel` chrome so the
CORE strip can carry a heading. Do NOT let cells collapse — the `—` slot-stable behaviour is
already in `InstrumentTile`; `CellGrid` just must not gate cells on presence.

**Acceptance:** `CellGrid.test.tsx` asserts: N children render as N cells; container is
`gap-0` with hairline dividers (assert class presence); a cell with a click/href handler exposes
a whole-cell hit target (role/aria or wrapping button/link); severity edge on a child cell is
preserved. `npm run typecheck`, `vitest run` for the new file green. Tokens only.

---

### Task 2 — Rebuild Helm on CellGrid + SegmentedControl + fixed slots

**Files:**

- `packages/web/src/app/sail/CoreStrip.tsx` (wrap the 6 tiles in `CellGrid`)
- `packages/web/src/app/sail/page.tsx` (swap `HelmTabs` → `SegmentedControl`; retokenize
  header + sails strip)
- `packages/web/src/app/sail/HelmTabs.tsx` (delete OR reduce to a thin `SegmentedControl`
  wrapper mapping `HELM_GROUPS` → segments)
- `packages/web/src/app/sail/groups/PerformanceGroup.tsx` (fix the reflow: every tile fixed-slot)
- `packages/web/src/app/sail/groups/StartingGroup.tsx`,
  `packages/web/src/app/sail/groups/NavigatingGroup.tsx` (put group tiles on `CellGrid`;
  Navigating is already fixed-slot — keep it as the exemplar)

Details:

- **CoreStrip** already renders 6 `HelmTile` (= `InstrumentTile`) at `small`/`d3` with `tMs`
  wired. Replace the plain `grid grid-cols-3 md:grid-cols-6 gap-3` wrapper with `CellGrid`
  (`cols={{ base: 3, md: 6 }}`, optional `label="CORE"`). Keep the T-vs-M heading logic and all
  `tMs` staleness. Depth already can carry the 3px severity edge — leave the existing
  severity plumbing (proposal 7.1 shows Depth shoaling edge; do not add new severity thresholds
  unless already present).
- **HelmTabs → SegmentedControl:** map `HELM_GROUPS` (`starting`/`navigating`/`performance`)
  to `segments=[{value,label}]` with the existing `LABEL` map; `role=radio`, 44px `md` size,
  accent fill on selected — all already in `SegmentedControl`. Keep `useHelmGroup()` +
  `STORAGE_KEY` unchanged. Do NOT change the group set (keep-list-safe reading; the proposal's
  NAVIGATE/PERFORMANCE/WIND/ENGINE re-architecture is explicitly out of scope).
- **PerformanceGroup reflow fix (the one keep-list violation):** every conditionally-rendered
  tile (`{twa && …}`, `{aws && …}`, `{awa && …}`, `{tbsSample && …}`, `{tTwaSample && …}`,
  `{pctPolar !== null && …}`) becomes always-rendered, passing `value={fmt(sample)}` which is
  `—` when the sample is absent (mirror how `NavigatingGroup`/`StartingGroup` already do it).
  Render the group tiles on `CellGrid` (`cols={{ base: 2, md: 3 }}`). Keep `SailRecommendationTile`
  in its fixed slot. Keep the existing severity logic (In groove / VMG eff) and the
  `RAD_TO_DEG` import from `lib/units`.
- **page.tsx:** header `text-slate-300`/`text-slate-500` → `text-ink-2`/`text-ink-3`; the sails
  wardrobe strip's `bg-slate-900 border-slate-800` + `text-slate-*` → tokens
  (`bg-surface border-hairline`, `text-ink-*`). Keep `AlertsPanel`, `AudibleAlarm`,
  `AnnotationDropper`, `RaceMiniTimer` mounted as-is. StartingGroup stays on Helm (proposal's
  merge-into-Race is silent for phase 4; keeping it here is keep-list-safe).

**Acceptance:** `npm run typecheck` + `vitest run` (helm-group.test.ts still green — the union
is unchanged). `npm run build --workspace @g5000/web` succeeds. Manually confirm the 6-slot CORE
strip renders as a hairline wall; the 3 task tabs render via `SegmentedControl` with
`aria-checked` on the active tab; PerformanceGroup shows `—` for absent wind channels with NO
tile collapse (fixed slots). No `slate-`/`emerald-` classes remain in the touched files
(`grep` clean). `lint:overhaul` passes.

---

### Task 3 — Race on the CellGrid + InstrumentTile grammar

**Files:**

- `packages/web/src/app/sail/race/page.tsx` (page chrome → tokens; layout unchanged)
- `packages/web/src/app/sail/race/RaceTimer.tsx` (timer numeral → `InstrumentTile` `d1`,
  container → `Panel`, buttons → `Button`; **keep sync-to-gun optimistic snap + ConfirmDialog
  verbatim**; add `HoldButton` to Reset per proposal 7.2)
- `packages/web/src/app/sail/race/RaceAudible.tsx` (retokenize mute button — remove
  `bg-gray-200`; **keep the audible schedule verbatim**)
- `packages/web/src/app/sail/race/LinePingPanel.tsx` (retokenize → `Panel`/`InstrumentTile`/
  `Button`; confirm port/stbd correctness; delete the local comma `fmtCoord` fork → use
  `lib/coords`)
- `packages/web/src/app/sail/race/ActiveMarkSelector.tsx`,
  `packages/web/src/app/sail/race/RaceSettings.tsx` (retokenize → `Panel`/`Field`/`Button`)
- `packages/web/src/components/WindShiftPlot.tsx` (retokenize slate/emerald chrome → tokens;
  keep plot geometry)

Details:

- **RaceTimer:** the `text-7xl font-mono` timer → `InstrumentTile size="d1"` (Pi station scale
  makes it ~93px). Outer `bg-slate-900 border-slate-800 rounded p-6` → `Panel`. Start
  (`bg-emerald-700`) → `Button variant="primary"` (or `success` if it exists); sync/+min/+s
  (`bg-slate-700/800`) → `Button`. **Reset:** already `ConfirmDialog`-guarded — additionally make
  the trigger a `HoldButton` (proposal 7.2). The 1s poll of `/api/race/state`, the 100ms tick
  while `startMs` is set, and the sync-to-gun local `setTimer` + `POST {action:'sync'}` optimistic
  snap are **kept byte-identical**.
- **LinePingPanel:** verify port/stbd is correct (`--port`/`--stbd` tokens, filled/hollow by
  shape not hue for NIGHT); delete its local comma `fmtCoord` and import the shared formatter
  from `lib/coords` (compact DMM, paste-anything).
- **page.tsx:** `h1 text-slate-300` → `text-ink-2`; keep the
  `grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mx-auto` layout and the col-span-2 placements.

**Acceptance:** `typecheck` + `vitest run` green (any race timer tests still pass — the snap
logic is unchanged). `build --workspace @g5000/web` succeeds. `grep` for `slate-`/`emerald-`/
`bg-gray-200` in the touched race files is clean. Manually: timer reads at `d1`; Start/sync/±
are `Button`; Reset requires a hold + confirm naming nothing destructive is lost; LinePingPanel
port/stbd labels match the geometry. `lint:overhaul` passes.

---

### Task 4 — Autopilot on the grammar (defense-in-depth verbatim)

**Files:**

- `packages/web/src/app/sail/autopilot/readonly-view.tsx` (extract local `RAD_TO_DEG` → import
  from `lib/units`; group the readout tiles into a `CellGrid`/`Panel`; retokenize header)
- `packages/web/src/app/sail/autopilot/control-panel.tsx` (retokenize amber/slate → `Button` +
  tokens; confirm modal → real `Dialog` with focus-trap + Escape; Engage/Disengage → `HoldButton`;
  ack log → **UTC**; **keep the env → capability → confirm → cooldown → ack chain verbatim**)
- `packages/web/src/app/sail/autopilot/page.tsx` (server component — leave the env gate + gating
  of `<ControlPanel/>` untouched; retokenize any chrome only)

Details:

- **readonly-view:** replace the local `const RAD_TO_DEG = 180 / Math.PI` with
  `import { RAD_TO_DEG } from '../../../lib/units'`. The tiles are already `InstrumentTile` with
  `tMs`/StalenessShroud + `text-ink-*` — group Mode / Target heading / Target track / Vessel
  heading / Heading error / Rudder into a `CellGrid` (or a `Panel`-wrapped grid) for the glance
  grammar; keep every `tMs` and the listen-only note verbatim.
- **control-panel:** the bespoke `fixed inset-0` confirm modal → the `Dialog` primitive (focus
  trap + Escape, proposal 7.3). Mode/course buttons (`bg-slate-800…`) → `Button`; the amber
  warning banner → tokens (`bg-accent-dim-bg`/`text-accent-ink` or a Panel `variant`). Make the
  ENABLE(AUTO)/DISABLE(STBY) engage/disengage actions `HoldButton` (proposal 7.3). Ack-log rows
  currently render `d.getHours()/getMinutes()/getSeconds()` (local) → render **UTC**
  (`getUTCHours` etc. or the shared UTC formatter). The whole
  `buttonEnabled`/capture-gate/`confirmAndSend`/`cooldownUntil`/2s ack-poll chain and the
  `channelsRef` pattern are **kept byte-identical** — only presentation changes.

**Acceptance:** `typecheck` + `vitest run` green. `build --workspace @g5000/web` succeeds.
Confirm the defense-in-depth chain still gates: buttons disabled without capture codes / during
cooldown; confirm is now a `Dialog` (Escape closes it, focus trapped); engage/disengage require
a hold; the ack log timestamps read UTC. `grep` for `slate-`/`amber-9`/local `RAD_TO_DEG` in the
touched files is clean. Listen-only note intact. `lint:overhaul` passes.

---

### Task 5 — Anchor primitive/token polish (light, NO layout change)

**Files (retokenize only — do not move anything):**

- `packages/web/src/app/anchor/page.tsx` (header text → `text-ink-*`; **keep the
  `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3` grid + WindDial col-span-2 exactly**)
- `packages/web/src/app/anchor/panels/DepthPanel.tsx` (hand-rolled card → `Panel`; big numeral
  → `InstrumentTile` `d3`/`d4`; keep the under-keel vs total depth-offset derivation)
- `packages/web/src/app/anchor/panels/PositionPanel.tsx`,
  `NearbyVesselsPanel.tsx`, `TodayNowPanel.tsx`, `SystemsPanel.tsx` (raw cards → `Panel`/
  `InstrumentTile`)
- `packages/web/src/app/anchor/panels/AnchorWatchPanel.tsx` (armed/disarmed → `StatusChip`;
  **keep rode/scope calc + breach logic**; breach → Takeover is OUT of scope)
- `packages/web/src/app/anchor/panels/WindDial.tsx` (retokenize surrounding chrome ONLY;
  **do not touch dial geometry / port-stbd hue-by-shape**)
- `packages/web/src/app/anchor/drawer.tsx` (retokenize chrome; **keep drawer structure +
  snap/peek verbatim**)
- `packages/web/src/app/anchor/tabs/*` — `ForecastGraphTab`, `ForecastTableTab`, `TidesTab`,
  `RadarTab`, `SkyTab`, `SolarTab`, `AcLoadsTab` (raw slate/emerald → tokens; `RadarTab` offline
  state + `AcLoadsTab` `connected:false` state → token empty-state grammar, e.g. `Panel`
  `emptyState` with an honest reason string)

This is a full-surface but LIGHT-TOUCH retokenize: swap raw
`slate-`/`emerald-`/`rose-`/`amber-` classes for tokens and lift hand-rolled cards onto
`Panel`/`InstrumentTile`/`StatusChip` **without changing the layout, the drawer, or any
calc/breach logic**.

**Acceptance:** `typecheck` + `vitest run` green. `build --workspace @g5000/web` succeeds.
`grep -rE 'slate-|emerald-|rose-|amber-[0-9]' packages/web/src/app/anchor` is clean (or only
comments remain). The anchor grid + WindDial col-span + drawer snap/peek are visually unchanged;
DepthPanel still shows under-keel vs total; AnchorWatch arm/disarm reads via `StatusChip`;
RadarTab/AcLoadsTab offline/`connected:false` states use the token empty-state grammar with an
honest reason. `lint:overhaul` passes.

---

### Task 6 — Mast tokens + DisplayConfig station-scale + theme sync

**A. Retokenize the mast kiosk onto theme tokens (keep `nightMode` boolean):**

- `packages/web/src/app/mast/mast.css` — map `--mast-bg`/`--mast-fg`/`--mast-muted`/`--mast-green`/
  `--mast-amber`/`--mast-red` onto the app theme tokens (`--canvas`/`--ink`/`--ink-3`/`--ok`/
  `--accent`/`--danger` from `globals.css`) where possible. **`.mast-root.mast-night` stays the
  strict all-red kiosk override** (do not fold it into the theme system — it is the physical
  night boolean). Keep the `container-type: size` + `cqmin` fit-to-cell sizing untouched.
- `packages/web/src/app/mast/Tile.tsx` — keep the JS ResizeObserver fit (`FILL_W`/`FILL_H`)
  SEPARATE from `d1`–`d4`; only swap any raw colors to the `--mast-*` vars (which now resolve to
  theme tokens). Do NOT apply `--instrument-scale` to mast Tile.

**B. DisplayConfig `scale` multiplier (mirror the Phase-1 `theme` wiring EXACTLY):**

1. `packages/db/src/defaults.ts` — add `scale: number` to `DisplayConfig`; add `scale: 1.0` to
   `DEFAULT_DISPLAY_CONFIG`.
2. `packages/mast/src/types.ts` — add to `MastRuntime`:
   `readonly scale$: Observable<number>; getScale(): number;` (mirror `theme$`/`getTheme`).
3. `apps/g5000/src/mast/service.ts` — add
   `get scale$() { return this.configStore.displayConfig$.pipe(map((c) => c.scale)); }` and
   `getScale() { return this.configStore.getDisplayConfig().scale; }` (mirror the `theme` block).
4. `packages/web/src/app/api/mast/stream/route.ts` — `send('scale', mastRuntime.getScale())` on
   connect + `const scaleSub = mastRuntime.scale$.subscribe((s) => send('scale', s));` +
   `scaleSub.unsubscribe()` in the abort handler (mirror the `theme` block).
5. **New:** `packages/web/src/app/api/mast/scale/route.ts` — mirror
   `api/mast/theme/route.ts`: `GET` returns `{ ok, scale }`; `POST` validates against an allowed
   set `{1.0, 1.15, 1.6}` (or clamps into range) then
   `setDisplayConfig({ ...current, scale })`.
6. Client SSE sync: extend the theme-sync path to also handle `'scale'`. The cleanest mirror is
   `lib/theme-store.tsx` (add an `applyScale(scale)` that sets `--instrument-scale` on
   `document.documentElement` + persists to `storageSet('instrumentScale', …)`) and
   `components/ThemeController.tsx` (add an `es.addEventListener('scale', …)` that calls
   `applyScale`). Also add a pre-hydration inline read in `app/layout.tsx` (mirror the
   `data-theme` script) so the CSS var is set before hydration and the CellGrid doesn't shift on
   cold load.
7. **UI control:** add a `scale` `SegmentedControl` (phone 1.0 / Pi helm 1.15 / mast Chipsee 1.6)
   to `packages/web/src/app/boat/setup/displays/page.tsx` alongside brightness / nightMode /
   dayBaseColor — load via `GET /api/mast/scale`, save via `POST /api/mast/scale`.

**C. Apply scale to `d1`–`d4` ONLY (shared `InstrumentTile`):**

- `packages/web/src/components/ui/InstrumentTile.tsx` — convert the hardcoded `SIZE_CLASS` /
  `UNIT_SIZE_CLASS` arbitrary values (`text-[3.5rem]`, `text-[1.4rem]`, …) to `calc()` off the
  var, e.g. `text-[calc(3.5rem*var(--instrument-scale,1))]` and
  `text-[calc(1.4rem*var(--instrument-scale,1))]`. Do NOT scale the label
  (`text-[0.667rem]`), the `sub`, or units-in-header — only the display numeral tiers `d1`–`d4`.
  Default `var(--instrument-scale, 1)` so unset = 1.0 (no visual change on any surface).

Order within the task: edit the type files (db, mast) FIRST, then **run `tsc -b`** so the
composite dist rebuilds before `packages/web` consumes the new `MastRuntime`/`DisplayConfig`
`.d.ts` (avoid the stale-dist trap). If dist looks stale after a branch swap,
`rm -rf packages/db/dist packages/mast/dist && npx tsc -b packages/db packages/mast --force`.

**Acceptance:** `npm run typecheck` (whole build) green — confirms the cross-package
`scale$`/`getScale`/`DisplayConfig.scale` types line up and `packages/web` resolves them via
dist. `vitest run` green (baseline). `build --workspace @g5000/web` succeeds. `GET /api/mast/scale`
returns the stored scale; `POST` with `1.15` persists and the SSE pushes `scale` to all clients;
`--instrument-scale` appears on `<html>`; a `d2` tile visibly grows at 1.15/1.6 while its label
and units-in-header do NOT scale; mast `Tile.tsx` numerals (JS fit) are unaffected; the physical
`nightMode` all-red state still renders. Mast retokenize: no raw non-`--mast-*` hex left in
`mast.css` except the `mast-night` red family. `lint:overhaul` passes.

---

## Final verification (all tasks)

1. `npm run typecheck` — green.
2. `npm run test` (`vitest run`) — only the known ~4–7 baseline env failures; any other failure
   is a regression to fix before handing off.
3. `npm run lint` (`prettier --check .`) + `npm run lint:overhaul` — green.
4. `npm run build --workspace @g5000/web` — succeeds (proves `.next/BUILD_ID` is written and no
   stale-dist type error).
5. Every route resolves: `/sail`, `/sail/race`, `/sail/autopilot`, `/anchor`, `/mast`,
   `/boat/setup/displays`.
6. Keep-list spot check: race sync-to-gun + audible unchanged; AP env→capability→confirm→
   cooldown→ack chain + listen-only note unchanged; anchor drawer + WindDial port/stbd unchanged;
   physical mast nightMode untouched; StalenessShroud on every live value; tokens only.
