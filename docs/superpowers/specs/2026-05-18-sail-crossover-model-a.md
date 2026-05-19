# Sail Crossover — Model A (single polar + crossover map)

**Status:** Approved 2026-05-18. Supersedes `2026-05-18-sail-crossover-chart-design.md` (Model "polar per config"), which is preserved as historical reference and will be deleted after this spec ships.

**Issue:** g5000 #3.

## 1. Motivation

The prior sail-crossover design stored a `PolarTable` on every `SailConfig` row. That model has internal contradictions:

- A polar is **already** a sail-selection envelope. A textbook polar assumes "the right sail is up at this wind state", which means the "Code Zero polar at TWS 25 / TWA 35" cell is fictional — nobody flies a Code 0 in 25 kn upwind, so the number stored there has no real-world referent.
- VPP tools (ORC, WinDesign, Maxsurf, etc.) emit **one** polar per boat — already the upper envelope across sail choices. They don't emit "the polar if you insist on this sail."
- Per-config polars duplicate hull and rig data across rows. A 6-sail × 3-reef wardrobe yields 18 polars that are all the same boat with different sail multipliers.
- The crossover question — "which sail is right at (TWS, TWA)?" — does not require per-config polars to answer. It requires a `(TWS, TWA) → configId` lookup.

The right model separates **boat performance** (a single polar, scoped per boat and per mode) from **sail selection** (a separate `CrossoverMap` keyed by `(TWS, TWA) → configId`). The polar comes from v2's `polar_revisions` (already merged on develop). The crossover map is the new artifact this spec introduces.

## 2. Architecture

```
Boat (G5000_BOAT_ID = 'sula')
├── SailWardrobe                       (configs[], activeConfigId, activeMode)
├── PolarRevision rows                 (polar_revisions; per (boatId, mode), versioned)
│   └── resolved via activePolar$ to a single PolarTable
└── CrossoverMap                       (per (boatId, mode); NEW in this spec)
    └── cells: { (twsIdx, twaIdx) → configId }
```

**Three observables drive the feature**, all already live on the bus or in `ConfigStore`:

- `activePolar$` — single `PolarTable` for the active (boat, mode). Already exists.
- `wardrobe$` — `SailWardrobe`. Already exists.
- `crossoverMap$` (NEW) — `CrossoverMap` for the active (boat, mode).

The compute pipeline subscribes to all three and to live wind, publishes a `sail.recommendation` channel. Routing's wardrobe-aware path uses **the same polar for every config** (since the polar is per boat, not per config) — the wardrobe-aware code's job becomes labelling each leg with the recommended `configId` from `crossoverMap`, not picking different polars per leg.

## 3. Data shapes

### 3.1 `CrossoverMap`

```typescript
// packages/db/src/defaults.ts

import type { BoatId, PolarMode } from './defaults'; // already exported

/**
 * Which sail configuration is recommended at each (TWS, TWA) cell of the
 * polar grid. One CrossoverMap per (boatId, mode). Cells that don't appear
 * in the map are "unspecified" — consumers must handle that as "no
 * recommendation" (the recommendation tile shows a neutral message; the
 * chart renders the cell uncoloured).
 *
 * The grid axes MUST match the active polar's `twsBins` and `twaBins`
 * exactly. If the polar is re-binned, the migrator clears the map (or
 * carries forward by nearest-bin if the binning is close — see migration
 * rules below). This avoids stale indices pointing into a different grid.
 */
export interface CrossoverMap {
  boatId: BoatId;
  mode: PolarMode;
  /**
   * Sparse map. Key is "twsIdx,twaIdx" (zero-indexed into the active polar's
   * twsBins × twaBins). Value is a configId from the wardrobe. Cells that
   * are absent mean "no recommendation at this cell".
   */
  cells: Record<string, string>;
  /** UNIX seconds. Updated on every write. */
  updatedAt: number;
}

export const DEFAULT_CROSSOVER_MAP: CrossoverMap = {
  boatId: 'sula',
  mode: 'default',
  cells: {},
  updatedAt: 0,
};
```

Stored in `ConfigStore` as a single JSON row, keyed by `crossover-map-${boatId}-${mode}`. One row per (boat, mode). Multi-mode boats (foiling, planing) get one row per mode and the UI switches based on `wardrobe.activeMode`.

Revisions/lineage **are out of scope for v1.** The polar already has revisions; the crossover map is small and hand-edited and doesn't need them yet. Add revisions later if a use case appears.

### 3.2 `CrossoverSettings`

```typescript
// packages/db/src/defaults.ts

/**
 * Per-boat user settings for the crossover feature. Stored alongside the
 * map in ConfigStore as a separate JSON row, keyed by
 * `crossover-settings-${boatId}`. Mode-agnostic (settings apply across all
 * modes for now).
 */
export interface CrossoverSettings {
  /** Live recommendation fires "change sail" only when the winning config
   *  in the crossover map differs from the active config AND the active
   *  cell's TWS/TWA has been stable for at least this many seconds.
   *  Hysteresis is time-based, not speed-based, because the polar is the
   *  same for every config — there is no "speed delta" to compare. */
  recommendationStableSeconds: number;
  /** Crossover chart X-axis (TWS) upper bound in knots. Lower is always 0. */
  chartTwsMaxKn: number;
  /** Crossover chart Y-axis (TWA) lower bound in degrees. */
  chartTwaMinDeg: number;
  /** Crossover chart Y-axis (TWA) upper bound in degrees. */
  chartTwaMaxDeg: number;
  /** Forecast-timeline sample interval (minutes). */
  forecastIntervalMinutes: number;
  /** Forecast-timeline duration along the route (hours). */
  forecastDurationHours: number;
}

export const DEFAULT_CROSSOVER_SETTINGS: CrossoverSettings = {
  recommendationStableSeconds: 30,
  chartTwsMaxKn: 30,
  chartTwaMinDeg: 30,
  chartTwaMaxDeg: 180,
  forecastIntervalMinutes: 30,
  forecastDurationHours: 12,
};
```

Note: hysteresis on Model A is **time-based** (cell must be stable), not speed-based. On the prior "polar per config" design, hysteresis was a percent-speed-margin because the recommendation came from `argmax(bsp)` across configs and you could compare boat speeds. On Model A the recommendation comes from a lookup, so the only way to debounce is time.

### 3.3 No changes to v2 schema

`SailConfig`, `SailWardrobe`, `PolarRevision`, and `polar_revisions` are unchanged from current develop. This spec adds two new ConfigStore rows (`crossover-map-*`, `crossover-settings-*`) and does not migrate or rewrite anything that's already shipped.

The legacy `WardrobeSettings` field from `issue-3-sail-crossover` branch is **discarded** — those settings move into `CrossoverSettings`.

## 4. Compute pipeline

`packages/compute/src/sail-crossover/pipeline.ts`:

```typescript
import { Observable, combineLatest } from 'rxjs';
import { Channels, type Bus } from '@g5000/core';
import type { ConfigStore } from '@g5000/db';
import {
  type CrossoverMap,
  type CrossoverSettings,
  type SailWardrobe,
  type PolarTable,
} from '@g5000/db/defaults';

export interface SailRecommendation {
  /** configId from the wardrobe, or null if no recommendation. */
  recommendedConfigId: string | null;
  /** Currently active config from the wardrobe. */
  activeConfigId: string;
  /** Active (TWS, TWA) cell as polar-grid indices, for debugging. */
  cellTwsIdx: number;
  cellTwaIdx: number;
  /** UNIX seconds when this recommendedConfigId was first observed.
   *  Resets to "now" when the recommendation flips to a different config. */
  enteredAt: number;
  /** Echoed from CrossoverSettings so UI consumers can compute
   *  `shouldChange = recommended && recommended !== active &&
   *  (Date.now()/1000 - enteredAt) >= stableSeconds` themselves. */
  stableSeconds: number;
}

export function startSailCrossoverPipeline(args: { bus: Bus; store: ConfigStore }): () => void {
  /* … */
}
```

Algorithm:

1. `combineLatest(activePolar$, sails$, crossoverMap$, crossoverSettings$, wind$)`.
2. Snap `(tws, twa)` to `(twsIdx, twaIdx)` using the polar's bin centres (nearest bin, both axes; symmetric TWA folded into `[0, π]`).
3. Look up `crossoverMap.cells["${twsIdx},${twaIdx}"]` → `recommendedConfigId` (may be undefined).
4. Track `enteredAt` locally: when `recommendedConfigId` differs from the prior tick's value, reset `enteredAt = now`. Otherwise carry forward.
5. Publish `{ recommendedConfigId, activeConfigId, cellTwsIdx, cellTwaIdx, enteredAt, stableSeconds }` to `Channels.SAIL_RECOMMENDATION` (`'sail.recommendation'` — add this constant in core).

**`shouldChange` is consumer-side**, computed in the helm tile and recommendation panel from `enteredAt` and `stableSeconds`. The pipeline does not emit the boolean. This avoids a class of RxJS bugs where a stable wind doesn't re-fire the pipeline so the in-pipeline maturation timer never trips.

Out-of-grid cells (TWS above the polar's max bin) snap to the top bin. TWA below the polar's min bin clamps to the min. Symmetric TWA in (-π, 0) is folded to (0, π) before lookup (the polar is symmetric, so is the map).

## 5. Crossover chart authoring UX

`/sails` page hosts the chart. The chart is **editable**:

- The polar's TWS bins are the X axis (in knots, capped at `chartTwsMaxKn`).
- The polar's TWA bins are the Y axis (in degrees, range `[chartTwaMinDeg, chartTwaMaxDeg]`).
- Each cell is a `<rect>` in an SVG grid. Background colour comes from `getConfigColor(configId)` (a stable hash of the configId → hex; already on the sail-crossover branch and salvageable).
- A palette below the chart shows the wardrobe's configs as colour swatches + names. Click a swatch to make it the "paint" config.
- Click a cell to assign it the paint config. Click again to clear (cycle: assign → clear).
- A "Clear all" button wipes the map.
- A "Snapshot" indicator (cell count) sits below the palette.

**Deferred to a follow-up:** drag-to-paint multi-cell regions, and a live operating-point marker overlay (current TWS/TWA from the bus drawn as a ring). Both are pure-UI niceties on top of the same data flow; ship without them and file as follow-ups if the manual paint UX is too tedious in practice.

Writes go through `POST /api/crossover-map` with the full updated map (small payload, single-user app, simpler than a diff API).

## 6. Routing integration

`packages/routing/src/plan.ts`'s wardrobe-aware path no longer picks different polars per leg. The polar is constant per (boat, mode); the per-leg work is:

1. Use the single resolved polar (passed in as `input.polar`, same as the non-wardrobe path).
2. At each leg, snap the leg's (TWS, TWA) to a cell.
3. Look up `crossoverMap.cells[…]` → leg's recommended `configId`.
4. Decorate the leg with `recommendedConfigId` (string) in the output.

`PlanInput`:

```typescript
export interface PlanInput {
  // … existing fields …
  /** Active polar for this boat+mode. Always provided by the API caller. */
  polar: PolarTable;
  polarId: string;
  /** Optional: when set, the planner decorates each leg with the
   *  recommended configId from the crossover map. */
  crossover?: {
    map: CrossoverMap;
    wardrobe: SailWardrobe; // needed only to validate configIds exist
  };
}
```

The `wardrobe` and the legacy per-config polar argmax are removed from `PlanInput`. This is a breaking change to the wardrobe-aware route, but the wardrobe-aware route hasn't shipped to `main` yet (it's on the sail-crossover branch only), so there is no compatibility constraint.

## 7. Sail timeline

`packages/routing/src/sail-timeline.ts` becomes a thin post-process over the planner's output: walk the legs, collect `recommendedConfigId` per leg, run **short-run absorption** (a configId that holds for less than the absorption threshold gets folded into its neighbours so we don't recommend 3 sail changes in 20 minutes). The absorption logic is salvageable from the issue-3-sail-crossover branch — it's pure-function and orthogonal to the polar-per-config question.

```typescript
export interface SailTimelineSegment {
  fromLegIdx: number;
  toLegIdx: number;
  configId: string; // routing decorates legs that fall on a painted cell
  startTime: number;
  endTime: number;
  durationHours: number;
}

/** Operates on the planner's already-decorated legs[].configId. The planner
 *  performs the crossover lookup per leg (Task 10); the timeline just
 *  merges runs and absorbs short ones. */
export function computeSailTimeline(legs: RouteLeg[]): SailTimelineSegment[];
```

Legs that fall on an unpainted cell carry no `configId` and contribute no segment to the timeline (they appear as gaps).

The `ForecastTimeline` UI component (already on the issue-3 branch) reads `plan.sailTimeline` from the last saved route plan and renders it as a horizontal coloured-band strip aligned to the route's time axis. Salvageable as-is.

## 8. UI inventory

| File                                                   | New / Modified / Salvaged                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| `packages/web/src/app/sails/page.tsx`                  | Modified — replace prior CrossoverChart wiring with Model-A wiring |
| `packages/web/src/app/sails/CrossoverChart.tsx`        | Rewritten — editable map (was heatmap)                             |
| `packages/web/src/app/sails/RecommendationPanel.tsx`   | Salvaged — SSE-driven, just consume new payload shape              |
| `packages/web/src/app/sails/ForecastTimeline.tsx`      | Salvaged — reads `plan.sailTimeline`                               |
| `packages/web/src/app/sails/SettingsDrawer.tsx`        | Modified — new settings keys                                       |
| `packages/web/src/app/helm/SailRecommendationTile.tsx` | Salvaged                                                           |
| `packages/web/src/lib/config-color.ts`                 | Salvaged unchanged                                                 |
| `packages/web/src/app/api/crossover-map/route.ts`      | NEW — GET/POST `CrossoverMap`                                      |
| `packages/web/src/app/api/crossover-settings/route.ts` | NEW — GET/POST `CrossoverSettings`                                 |
| `packages/web/src/app/api/route/plan/route.ts`         | Modified — drop wardrobe arg, add crossover arg                    |
| `packages/web/src/components/PlanControls.tsx`         | Modified — send crossover (not wardrobe) payload                   |

## 9. Storage

Two new ConfigStore rows (one per (boat, mode) for the map; one per boat for the settings). No new SQL tables. No migrations needed because nothing in shipped storage changes.

The `polar_revisions` table from v2 is untouched. The `wardrobe` row from v2 is untouched.

## 10. Channels constants

Add to `packages/core/src/channels.ts`:

```typescript
export const Channels = {
  // … existing …
  SAIL_RECOMMENDATION: 'sail.recommendation',
} as const;
```

The pipeline publishes a single `SailRecommendation` payload to this channel. SSE subscribers (the helm tile and `/sails` page) read it.

## 11. Out of scope

- Crossover-map revisions/lineage.
- Auto-generated crossover maps from imported VPP data (a future feature; the user authors by hand for now).
- Per-config polar deltas / multipliers (Model C; not pursued).
- Per-config wind-range envelopes (Model B; not pursued).
- The "settings" page in Navbar is `Sails`; no new top-level page.
- Multi-boat — single active boat (`G5000_BOAT_ID`) is assumed throughout, same as v2.

## 12. Risks

- **Polar re-binning invalidates the map.** Mitigation: on polar revision swap, if the new revision's `twsBins`/`twaBins` differ in length from the prior revision, clear the map (with a one-time UI banner explaining the wipe). If lengths match, carry forward — bin centres can drift slightly. Document this in the polar-import path.
- **The user authors a map that recommends a config that doesn't exist in the wardrobe.** Mitigation: validate on every write; the GET handler also filters dangling configIds at read time.
- **Symmetric TWA folding.** The polar grid is `twaBins ∈ [0, π]` (port and starboard are symmetric). The map is too. If we ever stop assuming symmetric polars (e.g. asymmetric foiling cats), the map needs to grow. Out of scope for v1.

## 13. Testing strategy

- **Pure-function tests** (`packages/compute/src/sail-crossover/`): cell snapping, map lookup, hysteresis state machine, symmetric TWA folding, out-of-grid clamping.
- **Pipeline tests** (`pipeline.test.ts`): bus integration, debounce behaviour, observable join correctness.
- **DB tests** (`packages/db/src/crossover-map.test.ts`): round-trip, dangling-config filtering, polar-rebinning clear behaviour.
- **API route tests**: GET/POST shape, validation error paths.
- **Routing tests** (`packages/routing/src/sail-timeline.test.ts`): short-run absorption, no-recommendation cells passed through as `null`.
- **UI integration**: `/sails` page mount + paint + save round-trip, SSE recommendation render. Browser-driven smoke is via `chrome-devtools-mcp` against `npm run dev`.

## 14. Acceptance criteria

1. On `develop` + this spec's implementation, opening `/sails` shows a paintable grid. Painting cells and saving persists to ConfigStore. Reloading shows the same map.
2. `/helm` page shows the `SailRecommendationTile`. With the wardrobe's active config painted on the active (TWS, TWA) cell of the map, the tile shows "Active: <name>" with no recommendation banner. With a different config painted at that cell and held for ≥ `recommendationStableSeconds`, the tile shows "Recommended: <name> → tap to switch".
3. Generating a route plan from `/chart` produces a saved plan whose `sailTimeline` is populated and renders in `ForecastTimeline` on `/sails`.
4. All v2 polar functionality (`/api/polar/revisions`, `/api/polar/active`, `/api/wardrobe/active`) continues to work; no regressions.
5. `npm test` passes; `npm run typecheck` passes (modulo the documented apps/router stale ref).
6. `git diff develop..HEAD --stat` shows no changes to `polar_revisions`-related files except the channel constants file and the routing path that consumes `activePolar$`.

## 15. Promotion

When this ships, delete `docs/superpowers/specs/2026-05-18-sail-crossover-chart-design.md` and `docs/superpowers/plans/2026-05-18-sail-crossover-chart.md` (the prior Model "polar per config" docs). The `issue-3-sail-crossover` branch can be deleted from `origin` once Model A is on `develop`.
