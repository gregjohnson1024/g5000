# G5000 UI Overhaul — Phase 6: Work surfaces & consolidation

Branch: `ui-overhaul`. Executable plan for Phase 6 of the overhaul described in
`docs/design/g5000-ui-overhaul-proposal.md` (§5 Tier-2 + supporting architecture, §7.8–§7.11)
and constrained by `docs/design/overhaul-keep-list.md`.

Prior phases delivered: design tokens + 3 themes (globals.css `--series-*`, `--seq-*`,
`--flow-*`, `--now-line`, night overrides); NavShell + 6-section IA with new paths; Tier-1
primitives under `packages/web/src/components/ui/` (Panel, InstrumentTile, StatusChip, Button,
IconButton, HoldButton, SegmentedControl, Dialog, ConfirmDialog, Toast, BottomSheet, CellGrid,
StalenessShroud, Takeout). `components/ui/index.ts` is the barrel — every new primitive exports
from there.

**Not yet built (this phase builds them):** the whole Tier-2 chart library
(`TimeSeriesPanel`, `StripChart`, `HeatmapGrid`, `RampLegend`, `DataTable`/`RecordList`), the
Field family (`TextField`/`NumberField`/`CoordField`/`SelectField`/`Slider`/`Checkbox`), the
shared `SaveBar`, and `CaptureWizard`. There is **no** `components/charts/` directory yet —
create it for the Tier-2 chart primitives; the Field family + SaveBar + DataTable are Tier-1/Tier-2
form/table primitives and go in `components/ui/`.

## Hard constraints (keep-list law — do not regress)

- **Canonical-ramp law:** every legend derives from the SAME stops the render uses. `RampLegend`
  reads `HeatmapGrid`'s stops; generalize `WindLegend`↔`FILL_STOPS`. Legend and cells can never drift.
- **Threat-pin invariant (safety):** when generalizing `DataTable` from `TargetsTable`, preserve
  verbatim — threats float to top regardless of sort column/direction; stale targets excluded from
  threat set; null sorts to bottom; per-vessel mute with CPA-snapshot re-arm.
- **trips StatCard + day-grouped feed** grammar survives the Logbook rebuild.
- **`/damping` dirty-tracked save** behavior preserved; damping keeps its own per-resource
  `/api/config/damping` endpoint — do NOT reroute it through `/api/settings`.
- **UTC everywhere / mono / tabular numerals;** tides+currents `Time (local)` → UTC `z` when healed.
- **Offline-honest empty states** (`—` in a reserved slot, honest reason line — never a fake 0).
- **Stable per-source session colors** (PLOT_PALETTE → `--series-1..8`).
- **Night = hue-banned:** charts collapse to red steps + line styles; read tokens at render
  (`getComputedStyle`/`cssVar()`) so theme swaps repaint — existing heatmaps already do this.
- **Tokens only** — a raw hex/`slate-*`/`rose-*` literal fails `lint:overhaul` review.
- **Bundling trap:** chart primitives stay presentational — NO imports of `@g5000/compute/race`
  or `@g5000/grib` (race lives at the `/race` subpath because `laylines → grib → node:path` breaks
  `next build --webpack`). Keep primitives import-clean.

## Verification (every task; and final gate)

From repo root:

```
npx tsc -b
npx vitest run                 # ~4–7 known-baseline failures OK (coastline gitignored,
                               # ConfigStore-dependent route tests, wgrib2 missing)
npx prettier --check .
npm run build --workspace @g5000/web
npm run lint:overhaul
```

Do NOT `git commit` and do NOT `git stash` — the orchestrator commits after verify + smoke.
Any test failure beyond the known baseline is a regression and blocks.

---

## Task ordering rationale

Primitives first (Task 1), because every downstream task consumes them. Then the section
migrations that depend only on the primitives (Conditions → StripChart; Voyage → DataTable;
Boat hub). Forms + the settings PATCH (Task 5) depend on the Field family + SaveBar from Task 1.
Performance re-skin (Task 6) and CaptureWizard (Task 7) are last — Performance is a light
re-token, CaptureWizard is conditional on the scout-confirmed duplication.

---

## Task 1 — Tier-2 chart + table primitives (TimeSeriesPanel, StripChart, HeatmapGrid, RampLegend, DataTable/RecordList, Field family, SaveBar)

**Files (new):**

- `packages/web/src/components/charts/TimeSeriesPanel.tsx`
- `packages/web/src/components/charts/StripChart.tsx`
- `packages/web/src/components/charts/HeatmapGrid.tsx`
- `packages/web/src/components/charts/RampLegend.tsx`
- `packages/web/src/components/charts/ramp.ts` (shared `--seq-*` sequential + signed/diverging ramp; `cssVar()` reader; stop model shared by grid + legend)
- `packages/web/src/components/charts/plot-scale.ts` (shared `xOf`/`yOf`/`ptsToPolyline`/tick generator — collapses the math duplicated 3× across MultiSourcePlot/tides/currents)
- `packages/web/src/components/charts/index.ts` (barrel)
- `packages/web/src/components/ui/DataTable.tsx` (+ `RecordList.tsx` compact/phone variant)
- `packages/web/src/components/ui/data-table-sort.ts` (pure sort+pin helper, unit-testable)
- `packages/web/src/components/ui/fields/{TextField,NumberField,CoordField,SelectField,Slider,Checkbox}.tsx` + `fields/index.ts`
- `packages/web/src/components/ui/SaveBar.tsx`
- `packages/web/src/components/ui/use-dirty-save.ts` (dirty-tracking hook generalized from `/damping`)

**Files (edit):** `packages/web/src/components/ui/index.ts` (export DataTable/RecordList/Field
family/SaveBar/use-dirty-save).

**Files (seed — read, do not delete yet):** `components/MultiSourcePlot.tsx`,
`components/WindShiftPlot.tsx`, `app/conditions/tides/page.tsx`, `app/conditions/currents/page.tsx`,
`components/WindowHeatmap.tsx`, `components/WindLegend.tsx`, `app/boat/polars/PolarHeatmap.tsx`,
`app/boat/setup/cal/wind/CalHeatmap.tsx`, `app/ais/TargetsTable.tsx`, `app/boat/setup/damping/page.tsx`,
`lib/coords.ts`.

**Brief:**

- `TimeSeriesPanel` (chassis = MultiSourcePlot): keep `PlotSeries{id,label,color,points}`, stable
  per-source colors mapped to `--series-1..8`, single-sample dot fallback, now-line, mono legend with
  latest value. FIX three things: (1) responsive viewBox — retire hardcoded `WIDTH=600/HEIGHT=80`, add
  a `minHeight`/12px SVG floor; (2) **real y-axis ticks (3)** + an optional `domain?: [min,max]` prop
  for FIXED per-row domains (default remains auto-fit but the fixed domain is the drama-killer); (3)
  retokenize all raw slate classes → tokens. `WindShiftPlot` becomes a 1-series `TimeSeriesPanel` with
  a fixed ±domain (do not delete WindShiftPlot in this task — migrate its one consumer in a later task
  or here if trivial; leaving it is fine as long as the primitive exists).
- `StripChart`: ONE component for both conditions strip charts — curve + now-line + event markers +
  pin button + source badge + tap-scrub. Parameterized so tides (pin exists) and currents (add pin +
  source badge) both render from it. Uses `--flow-*` for event dots and `--now-line` for the now-line
  (NOT `--flow-ebb`). Times formatted UTC `z` (the primitive must not emit `toLocaleString`).
- `HeatmapGrid` + `RampLegend`: one ramp module. `sequential` mode → `--seq-1..6`; `diverging`/signed
  mode for CalHeatmap's ±data. `RampLegend` derives its stops from the SAME stop array the grid renders
  (canonical-ramp law — generalize WindLegend's FILL_STOPS). Cells support tap-inspect (replaces
  `title=` tooltips); grid supports read-only AND editable (cell slot) so PolarHeatmap's +/- bin
  editing + CalHeatmap live-edit ride on top. Read tokens via `getComputedStyle` so night repaints.
- `DataTable` (seed = TargetsTable): sortable (per-column ▲▼, null-sorts-to-bottom), pinned rows
  (generic `pinPredicate` so threats-float-to-top is one instance), sticky header, units-in-header-once,
  mono right-aligned numerics, 36px `pointer:fine` / 44px touch rows, row→detail-sheet (BottomSheet) on
  phone. `data-table-sort.ts` is the pure sort+pin fn with unit tests. `RecordList` = the card/phone
  variant. Retokenize; keep any `title=`-carried info as visible text.
- Field family: one recipe (sunken well, `--hairline` border, `r-control`, 44px, focus ring; label
  above, caption below, danger-colored error caption). `CoordField` lifts `lib/coords`
  `parseCoordinate`/`parseLatLon` verbatim (paste-anything DMM). `SelectField` = custom popover
  (native `<select>` retires). `Slider` replaces `.fc-slider`. `Checkbox`/`Radio` 24px custom.
- `SaveBar` + `use-dirty-save`: generalize `/damping`'s dirty-tracking (draft-vs-cfg state, `dirty`
  memo, Save disabled unless dirty, reload-after-save) into a sticky bottom SaveBar with a dirty-count
  and a route-leave guard. SaveBar is transport-agnostic (caller supplies the save fn) — Task 5 wires
  the `/api/settings` PATCH batching; damping stays on its own endpoint.

**Acceptance:**

- New files compile under `tsc -b` and export from their barrels; nothing consumes them yet
  (introduce-then-migrate) — build + baseline tests stay green.
- Unit test `data-table-sort.test.ts`: threats pin to top irrespective of sort column/direction;
  stale targets excluded from pin; null sorts to bottom. Unit test `ramp.test.ts`: `RampLegend` stop
  array === `HeatmapGrid` render stop array for both sequential and diverging modes (canonical-ramp).
  Unit test for `TimeSeriesPanel` fixed-domain: a series spanning ±0.1 with `domain={[-5,5]}` renders
  within ~1% of the y-axis (flatline, not full-height). Unit test `use-dirty-save.test.ts`: dirty count
  transitions and Save-disabled-when-clean.
- `lint:overhaul` clean on all new files (zero raw hex / `slate-*` / `title=`-only info /
  `window.confirm|alert`).

---

## Task 2 — Conditions section onto StripChart + shared forecast cache; retokenize

**Files (edit):**

- `packages/web/src/app/conditions/tides/page.tsx`
- `packages/web/src/app/conditions/currents/page.tsx`
- `packages/web/src/app/conditions/page.tsx` (Forecast)
- `packages/web/src/app/conditions/models/page.tsx` (GRIB/Models)
- `packages/web/src/app/conditions/windows/page.tsx`
- (likely) a small `packages/web/src/app/conditions/forecast-cache.ts` or a route that both Forecast
  and Models read for unified cache state.

**Brief:**

- Heal the drifted tide/current twins: both render from the single `StripChart` (Task 1). Add the pin
  button + source badge to currents (tides already has Pin via `POST /api/tide/pin`). Convert all
  `Time (local)`/`toLocaleString` to UTC `z`. now-line uses `--now-line`, event dots `--flow-*`. Both
  stay gated on `settings.canadianTideCurrents`. Retokenize the day-grouped event tables onto `DataTable`
  (or keep as a plain table but retokenized — a full DataTable migration of the event table is optional;
  the strip chart heal is the mandatory part). Station picker `<select>` → `SelectField`.
- Shared forecast cache state (§7.8 "no more mutual unawareness"): Forecast reads
  `/api/forecast/manifest`; Models lists `GRIB_CACHE`. Unify so both read one cache-state source and the
  existing `BroadcastChannel('forecast-cache')` signal refreshes BOTH pages. Retokenize Forecast's
  cache-manager tables/buttons onto `Panel` + `DataTable` + `Button`; give Forecast's long table a
  scroll container + sticky header (DataTable provides this). Models page (server component) retokenized.
- Windows: retokenize; native inputs/select/checkbox → Field family; keep `WindowHeatmap` but move it
  onto `HeatmapGrid` + `RampLegend` (mandatory legend, tap-inspect replaces `title=`); `onPick` continues
  to hand off to the chart (prefer the `chart:planState` handoff over `window.location.href`, but a
  navigate is acceptable if planState wiring is out of scope — note whichever is chosen).

**Acceptance:**

- `/conditions`, `/conditions/tides`, `/conditions/currents`, `/conditions/models`, `/conditions/windows`
  all resolve in `next build` and render without console errors in smoke.
- Tides and currents render from the SAME `StripChart` component (grep confirms both import it; the
  duplicated SVG scaffolding is gone). No `Time (local)`/`toLocaleString` remains in either page.
- Currents has a pin button + source badge. now-line no longer uses `--flow-ebb`.
- Editing/refreshing the forecast cache on `/conditions` reflects on `/conditions/models` via the
  BroadcastChannel (manual smoke note is sufficient).
- `lint:overhaul` clean on all five pages.

---

## Task 3 — Voyage Plan + Logbook onto DataTable/RecordList

**Files (edit):**

- `packages/web/src/app/voyage/plan/page.tsx`
- `packages/web/src/app/voyage/logbook/page.tsx` + `packages/web/src/app/voyage/logbook/client-view.tsx`
- `packages/web/src/app/voyage/page.tsx` (fix the dead `/tracks` link → `/voyage/logbook`; fold its
  passage-log sparkline into `TimeSeriesPanel`)

**Brief:**

- Plan: rebuild the hand-rolled waypoints `<table>` on `DataTable`. Keep add-form paste via
  `lib/coords` (now via `CoordField`), per-row edit, GPX import, existing `ConfirmDialog`. **Verify the
  "routes merged in Phase 2" claim** — this page is waypoints-only with GPX-imported-but-unmanaged
  routes. If routes-as-first-class does NOT exist, do the minimal honest thing: keep waypoints on
  DataTable and add a NOTE to the plan/PR that routes-as-workspace is not yet real (do not silently
  claim it). Retokenize raw slate.
- Logbook: today it is trips-only. §7.9 wants tracks + trips + log as ONE day-grouped feed with a kind
  filter. (a) Add a **kind filter** (`track | trip | log`) that pulls in tracks (`app/api/tracks`) and
  the passage log alongside trips; (b) keep the day-grouping (UTC start day) and the **StatCard grammar
  verbatim**; (c) merge `MODE_BADGE`/`POS_COLOR` maps into `StatusChip`; (d) put the record rows on
  `DataTable`/`RecordList`; (e) keep the record-naming `ConfirmDialog` and give destructive rows 44px
  targets separated from Edit. If the tracks/passage-log feed merge proves larger than a re-skin,
  ship the trips rebuild + StatusChip + DataTable and flag the full three-source feed as a follow-up
  in the PR (scout risk #6) — but the kind filter scaffolding + StatusChip merge are in-scope minimums.

**Acceptance:**

- `/voyage`, `/voyage/plan`, `/voyage/logbook` resolve in `next build`; no dead `/tracks` link remains.
- Plan waypoints and Logbook records both render on `DataTable`/`RecordList` (grep confirms import;
  hand-rolled `<table>` gone).
- Logbook keeps StatCard summary + UTC day-grouping; `MODE_BADGE`/`POS_COLOR` replaced by `StatusChip`;
  delete confirm names the record (not an id); Edit/Delete are 44px-separated.
- Kind filter present (even if the tracks/log data source merge is staged — the control + trip path work).
- `lint:overhaul` clean.

---

## Task 4 — Boat hub status lines

**Files (edit):** `packages/web/src/app/boat/page.tsx`
**Files (new, optional):** `packages/web/src/app/boat/boat-status.ts` (client hook/helper deriving
status strings from existing APIs) or a `use-boat-status.ts`.

**Brief:** Replace the static `CARDS[]` link index with a grouped, status-tinted card index (Panel +
tokens). Groups per §7.11: **Performance** (polars/sails/crossover), **Setup** (setup/profile/displays/
damping/cal*), **Diagnostics** (diag/*). Each card carries a live status line derived from existing APIs:

- "wind cal Nd old" ← `/api/config/aws-awa` (+ bsp/compass equivalents); if the cal table carries no
  timestamp, derive age from the ConfigStore write time. Honest `—` when unknown.
- "N devices silent" ← `/api/devices` (`DevicesResponse`) reusing `app/boat/diag/sensors/freshness.ts`
  - `group-sources.ts` which already compute silent/stale sources.
- "N sessions today" ← the sessions API behind `app/boat/diag/sessions/page.tsx`.
- live link/staleness ← the SSE store (`useSse`).
  Cards status-tinted (the `/settings` status-tinted container idea). Fetch client-side; degrade to `—`
  offline (offline-honest).

**Acceptance:**

- `/boat` resolves and renders three grouped card sections with a status line per card. Status lines
  read from the named APIs (grep confirms the fetches); unknown/offline shows `—`, never a fake 0.
- No raw slate / hardcoded color; `lint:overhaul` clean.

---

## Task 5 — Forms → Field + SaveBar; `/api/settings` per-key PATCH (clobber kill)

**Files (edit):**

- `packages/web/src/app/api/settings/route.ts` (add `PATCH`)
- `packages/web/src/app/boat/setup/page.tsx` (all 5 sections)
- `packages/web/src/app/boat/setup/cal/bsp/page.tsx`, `.../cal/compass/page.tsx`, `.../cal/wind/*`
  (number inputs / cell editors → Field family; SaveBar where staged)
- `packages/web/src/app/boat/setup/profile/page.tsx`, `.../displays/page.tsx` (grep for `method:'PUT'`)
- `packages/web/src/components/ForecastRoi.tsx` (`persistBbox` — lives on `/chart`, easy to miss —
  switch to PATCH)
- Read-merge-write callers to simplify to PATCH: `boat/setup/page.tsx` PlanningSection.save,
  TideCurrentsSection.apply, AnchorDashboardSection.save, EmporiaAcSection.save.
  **Files (new):** `packages/web/src/app/api/settings/route.test.ts` (PATCH-merge unit test).

**Brief:**

- Add a key-level `PATCH` to `/api/settings` that MERGES the body onto stored `settings.json` (shallow
  top-level-key merge is sufficient — each client owns a distinct top-level key: `planning`,
  `anchorDashboard`, `emporiaConfig`, `forecastBbox`, `canadianTideCurrents`). Keep `GET`/`PUT` for
  back-compat. This kills the two-client read-merge-write clobber (PUT replaces the whole file today).
- Migrate the settings-file forms onto the Field family; wire the staged forms through the shared
  `SaveBar` (Task 1), which batches dirty keys into ONE PATCH. Instant-apply switches
  (SocketCAN toggle, source-mode radio, TideCurrents checkbox) keep the instant-apply + AppliedTick
  contract — identical control types must not behave oppositely (two save contracts, both visible).
- Do NOT reroute `/api/config/*` (aws-awa, bsp, boat, compass-deviation, **damping**, polars,
  source-priority, reset-calibrations) — they are already per-resource; the PATCH work is ONLY for the
  file-based `/api/settings`. Damping keeps its dirty-tracked save on its own endpoint.
- Simplify the four verified read-merge-write sites + `ForecastRoi.persistBbox` to PATCH only their key.

**Acceptance:**

- `route.test.ts`: `PATCH {planning:{...}}` leaves `anchorDashboard`/`forecastBbox`/etc. intact
  (merge, not replace); `GET` after PATCH shows both keys. `PUT` still whole-file replaces (back-compat).
- Settings forms render Field-family controls + a sticky SaveBar with dirty-count + route-leave guard;
  a staged save issues a single PATCH (grep confirms `method:'PATCH'` in migrated callers; no remaining
  GET-then-PUT read-merge-write in the four named sites or ForecastRoi).
- Instant-apply switches still apply instantly with an AppliedTick. `/damping` untouched at the endpoint
  level (still POSTs `/api/config/damping`).
- `/boat/setup` + cal pages resolve in build; `lint:overhaul` clean.

---

## Task 6 — Performance section re-skin (polars / sails / crossover)

**Files (edit):**

- `packages/web/src/app/boat/polars/page.tsx` + `PolarHeatmap.tsx`
- `packages/web/src/app/boat/sails/page.tsx`
- `packages/web/src/app/boat/crossover/page.tsx`
- `packages/web/src/components/PolarPlot.tsx` (re-token only)
- `packages/web/src/components/SailOverlayChart.tsx` (collapse hand-rolled axis-label/tick code into
  the chart chassis where it duplicates TimeSeriesPanel's axis code; re-token)

**Brief:** Light re-skin onto tokens + `Panel`. Retire `alert()` (crossover line ~38, sails ~44) →
`Dialog`. Inline underline tabs → `SegmentedControl`/`Tabs`. `PolarHeatmap` moves its color fn +
tooltips + legend onto `HeatmapGrid` + `RampLegend` (keep the +/- bin add/remove + `CellInput`
editing; only color/legend/tap-inspect consolidate; replace double-click-to-edit with an explicit edit
affordance; `alert()/confirm()` → `Dialog`/`ConfirmDialog`). `PolarPlot` stays bespoke — re-token only.
`SailOverlayChart`'s duplicated tick/axis-label code (the §7.10 duplication) collapses into the chart
chassis.

**Acceptance:**

- `/boat/polars`, `/boat/sails`, `/boat/crossover` resolve in build. No `alert()`/`confirm()`/`prompt()`
  remains (grep clean). Tabs are `SegmentedControl`/`Tabs`; pages wrapped in `Panel`.
- PolarHeatmap renders via `HeatmapGrid`+`RampLegend` with a visible legend and an explicit edit
  affordance; bin add/remove still works.
- `lint:overhaul` clean on all three pages + touched components.

---

## Task 7 — CaptureWizard (extract the duplicated 5-second capture state machine)

**Files (new):** `packages/web/src/components/ui/CaptureWizard.tsx`
(+ `capture-wizard.test.ts` for the state machine).
**Files (edit):**

- `packages/web/src/app/boat/setup/cal/bsp/page.tsx`
- `packages/web/src/app/boat/setup/cal/compass/page.tsx`
- (verify) `packages/web/src/app/boat/setup/cal/wind/TackTestWizard.tsx` +
  `.../cal/wind/TwdRunCard.tsx`

**Brief:** The scout confirmed a REAL duplication: bsp and compass cal pages hand-roll the same
`idle → capturing{startedAt} → reviewing{...} → applied` machine — a 5000ms timed average of two
channels (`useChannelHistory`), snap to nearest bin, review card with Apply/Discard, apply via a
`PUT /api/config/*`, then "Applied" + capture-again. Extract ONE `CaptureWizard` parameterized by:
channels to average, duration, a `compute(samples) → {binIdx, newValue, reviewRows}` fn, and an apply
callback. UI provides progress + cancel + review + apply/discard. Migrate bsp (multiplier = sog/bsp)
and compass (deviation from hdg−cog) onto it. **Verify** whether the wind `TackTestWizard` reduces to
the same primitive or is a 2-step composite (paired port/stbd runs) — if it composes cleanly, migrate;
if not, leave it and note why. If the scout's duplication turns out not to be real once read closely
(it is, per scout), skip and document — but the expectation is: build it.

Note (NOT a Phase-6 line item, record for a follow-up): "3 bin-table editors → one BinTableEditor"
(§7.11) — bsp/compass row editors + cal grids — is deferred.

**Acceptance:**

- `capture-wizard.test.ts`: the state machine transitions idle→capturing→reviewing→applied and
  cancel returns to idle; the compute fn is invoked with the averaged samples.
- bsp + compass cal pages both render via `CaptureWizard` (grep confirms import; the two hand-rolled
  machines are gone). `/boat/setup/cal/bsp` and `.../compass` resolve in build and still PUT their
  respective `/api/config/*` endpoints.
- Wind tack-test migration done OR explicitly noted as a composite that stays.
- `lint:overhaul` clean.

---

## Final gate (whole phase)

- `npx tsc -b` clean.
- `npx vitest run` — only the known-baseline failures (coastline gitignored, ConfigStore-dependent
  route tests, wgrib2 missing); the new unit tests (data-table-sort, ramp, capture-wizard, settings
  PATCH, use-dirty-save) pass.
- `npx prettier --check .` clean.
- `npm run build --workspace @g5000/web` succeeds and **every route resolves**:
  `/conditions{,/tides,/currents,/models,/windows}`, `/voyage{,/plan,/logbook,/tracker}`, `/boat`,
  `/boat/setup{,/profile,/displays,/damping,/cal/{wind,bsp,compass}}`, `/boat/{polars,sails,crossover}`.
- `npm run lint:overhaul` clean.
- Keep-list invariants spot-checked: canonical-ramp (legend==render stops), threat-pin verbatim,
  trips StatCard + day-grouping, `/damping` dirty save on its own endpoint, UTC/mono/tabular,
  offline-honest `—`, stable per-source colors, night hue-ban.

Do NOT commit or stash — orchestrator commits after verify + smoke.
