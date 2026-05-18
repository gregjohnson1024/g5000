# Sail-Crossover Chart — Design

> **Issue:** [#3 — Build a sail-selection (cross-over) chart](https://github.com/gregjohnson1024/g5000/issues/3)
> **Branch:** `issue-3-sail-crossover` (off `develop`)
> **Worktree:** `.worktrees/issue-3-sail-crossover/`

## Goal

Tell the operator which sail configuration is best for the current and forecasted wind, integrated with the existing routing engine.

Issue text: *"Be able to store on a per-boat basis and tie into the routing and live polar display to show recommendations for current (forecast) state."*

The feature has four user-visible pieces, all in scope:

1. **Crossover chart** — heatmap on `/sails` showing which sail config wins at each (TWS, TWA).
2. **Live recommendation** — panel on `/sails` plus a compact badge on `/helm`, driven by live wind.
3. **Forecast timeline** — horizontal timeline on `/sails` previewing which config to fly along the planned route, sampled from cached GFS/ECMWF wind.
4. **Wardrobe-aware routing** — `/api/route/plan` accepts a wardrobe and picks the fastest config per node; the returned route carries a `sailTimeline`.

## Settled decisions

| Question | Decision | Rationale |
|---|---|---|
| Crossover semantics at boundaries | **Hysteresis band**: chart sharp (argmax); recommendation only fires past N% gain (default 3%). | Real-world honest — no swapping sails for 0.2 kn. |
| Router sail selection | **Derive best + post-process**: argmax per node, merge same-config runs after the fan converges. | Simplest router math; thrash handled in presentation. |
| UI placement | **All on `/sails`** (chart + live + forecast), compact badge on `/helm`. | Keeps wardrobe + chart together; helm uncluttered. |
| Sail "envelope" data model | **Derived from per-config polars** — no separate envelope storage. | Existing `SailConfig.polar` is enough; argmax computes the envelope. |
| Schema changes | **None.** Existing `SailWardrobe { configs[], activeConfigId }` (from the May-10 plan) is the foundation. | Already gives each config its own polar. |

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│  packages/db (no schema changes)                                │
│  SailWardrobe { configs[], activeConfigId } — already on disk   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
   ┌───────────────────────┼────────────────────────┐
   ▼                       ▼                        ▼
┌─────────────┐  ┌──────────────────────┐  ┌──────────────────┐
│ Crossover   │  │ Live recommendation  │  │ Wardrobe-aware   │
│ grid        │  │ (RxJS pipeline,      │  │ routing          │
│ (pure fn)   │  │  publishes to bus)   │  │ (plan() change)  │
└──────┬──────┘  └──────────┬───────────┘  └─────────┬────────┘
       │                    │                        │
       ▼                    ▼                        ▼
   /sails chart       /helm badge +             /sails forecast
                      /sails recommendation     timeline
                      panel
```

## Data model

### Existing (no changes)

```ts
// packages/db/src/defaults.ts (already defined by the May-10 plan)
interface SailConfig {
  id: string;
  name: string;
  mainState?: string;
  headsail?: string;
  downwindSail?: string;
  notes?: string;
  polar: PolarTable;
}

interface SailWardrobe {
  configs: SailConfig[];
  activeConfigId: string;
}
```

### New — wardrobe settings

Stored as a new field in `SailWardrobe`:

```ts
interface SailWardrobe {
  configs: SailConfig[];
  activeConfigId: string;
  /** New. Defaults applied on read if absent. */
  settings?: WardrobeSettings;
}

interface WardrobeSettings {
  /** Live recommendation fires "change recommended" only when the
   *  winning config is this much faster than active. Default 3. */
  hysteresisPercent: number;
  /** Crossover chart x-axis (TWS) upper bound. Default 30. */
  chartTwsMaxKn: number;
  /** Crossover chart y-axis (TWA) lower bound. Default 30. */
  chartTwaMinDeg: number;
  /** Crossover chart y-axis (TWA) upper bound. Default 180. */
  chartTwaMaxDeg: number;
  /** Forecast timeline sample interval. Default 30. */
  forecastIntervalMinutes: number;
  /** Forecast timeline duration along the route. Default 12. */
  forecastDurationHours: number;
}

const DEFAULT_WARDROBE_SETTINGS: WardrobeSettings = {
  hysteresisPercent: 3,
  chartTwsMaxKn: 30,
  chartTwaMinDeg: 30,
  chartTwaMaxDeg: 180,
  forecastIntervalMinutes: 30,
  forecastDurationHours: 12,
};
```

ConfigStore exposes `wardrobeSettings$` derived from `sails$`, applying defaults on missing fields so older wardrobe records load cleanly.

## Compute layer

New module: `packages/compute/src/sail-crossover/`.

### `computeCrossoverGrid` — pure function

```ts
interface CrossoverCell {
  winningConfigId: string | null;     // null when no config covers
  winningSpeedKn: number | null;
  runnerUpConfigId: string | null;
  runnerUpSpeedKn: number | null;
}

interface CrossoverGrid {
  twsBins: number[];                   // ascending
  twaBins: number[];                   // ascending
  cells: CrossoverCell[][];            // cells[twsIdx][twaIdx]
}

function computeCrossoverGrid(
  wardrobe: SailWardrobe,
  settings: WardrobeSettings,
  opts?: { twsStepKn?: number; twaStepDeg?: number },
): CrossoverGrid;
```

Defaults: `twsStepKn = 1`, `twaStepDeg = 5`. With the default chart axes that's a 31 × 31 grid ≈ 1000 cells × 5 configs = 5000 polar lookups — well below 10 ms even with naive interpolation.

Implementation: for each (TWS, TWA) bin, interpolate each config's polar (existing `interpolatePolarSpeed(polar, tws, twa) → kn`); take argmax; record runner-up. Sharp boundaries (no hysteresis here — that's a presentation concern).

### `startSailRecommendationPipeline` — RxJS pipeline

```ts
interface SailRecommendation {
  recommendedConfigId: string | null;
  recommendedSpeedKn: number | null;
  activeConfigId: string;
  activeSpeedKn: number | null;
  gapPercent: number;                  // (rec - active) / active * 100
  shouldChange: boolean;               // gap > hysteresis AND rec != active
  /** When true, returned values are from the last known-good sample
   *  (live wind has gone stale > 30s ago). Display dimmed. */
  stale: boolean;
}

function startSailRecommendationPipeline(opts: {
  bus: Bus;
  configStore: ConfigStore;
}): () => Promise<void>;
```

Subscribes to `wind.true.speed` + `wind.true.angle`, combines with `wardrobe$` + `wardrobeSettings$`. For each combined sample:

1. Interpolate every config's polar at (TWS, TWA).
2. Argmax → recommended config + speed.
3. Lookup active config's speed at the same (TWS, TWA).
4. Compute `gapPercent` and `shouldChange`.
5. Publish to `wardrobe.recommendation` on the bus.

Throttled with `auditTime(500ms)` — live-wind can fire 10×/sec; the panel doesn't need that. Stale detection: if no fresh wind sample in 30s, emits the last known-good `SailRecommendation` with `stale: true`.

Started in `apps/autopilot-server/src/index.ts` after the bridge is up. Stop function tracked in the existing teardown chain.

## Routing integration

`packages/routing/src/plan.ts` API expansion (additive, non-breaking):

```ts
// before
interface PlanInput {
  polar: PolarTable;
  wind: WindField;
  ...
}

// after — either polar OR wardrobe; not both
interface PlanInput {
  polar?: PolarTable;       // legacy single-polar
  wardrobe?: SailWardrobe;  // wardrobe-aware mode
  wind: WindField;
  ...
}
```

**Behaviour:**
- `wardrobe` set → wardrobe-aware mode. Each node picks `argmax(config => interpolatePolarSpeed(config.polar, tws, twa))`; records `configId` on the resulting leg.
- `polar` set, `wardrobe` not → existing single-polar mode (unchanged).
- Both set → wardrobe wins, polar ignored, server logs a warning.
- Neither → existing error.

**Leg extension:**

```ts
interface RouteLeg {
  t: number;
  lat: number;
  lon: number;
  heading: number;
  twa: number;
  tws: number;
  bsp: number;
  sogGround: number;
  /** New. Present only in wardrobe-aware routes. */
  configId?: string;
}
```

**Post-process: `sailTimeline`.**

```ts
interface SailTimelineSegment {
  fromLegIdx: number;
  toLegIdx: number;
  configId: string;
  startTime: number;        // unix sec, from leg[fromLegIdx].t
  endTime: number;
  durationHours: number;
}

interface Route {
  ...
  /** Present only in wardrobe-aware routes. Adjacent same-config runs
   *  are merged; runs shorter than 15 min are absorbed into neighbours. */
  sailTimeline?: SailTimelineSegment[];
}
```

The 15-minute absorption is hard-coded in the post-process function. Promote to a setting if real-world routes show problems.

**Pruner edge case (documented for future work).** The isochronic-fan pruner keeps the faster node at each bucket of (heading, time). With a wardrobe, two nodes at near-identical (lat, lon, t) but different `configId` are now first-class candidates; the slower one might be globally optimal if it avoids a future sail change. The current design keeps the existing pruner unchanged (argmax-per-node, lose the slow branch) on the assumption that argmax-per-node already finds local optima. A property test (Section: Testing) enforces "wardrobe is never slower than active-only," which is a global invariant the simple pruner respects. If the test ever fails, we revisit the pruner.

## Forecast preview

Lives in the route-plan response — no separate API.

When the active route's `sailTimeline` is present, the `/sails` page walks the timeline + samples wind from the existing GFS/ECMWF cache (via `@g5000/grib`'s `interpolateWind`) at each segment boundary. The chart already has the configs; the forecast preview just lays the existing timeline on a horizontal scrolling strip.

Sampled at `forecastIntervalMinutes`, capped at `forecastDurationHours`. If the route is longer than 12 h, the timeline scrolls horizontally.

When no active route exists (no plan saved, or planning hasn't been run with a wardrobe), the panel shows: *"Plan a route on /chart with the wardrobe enabled to see forecasted sail recommendations."*

## UI

### `/sails` page — three new panels above the existing config list

**Panel 1: Live recommendation (top).**

Reads `wardrobe.recommendation` via SSE. Three states:

| State | Border | Content |
|---|---|---|
| In sync (recommended === active) | Slate | "Sail: [name] — recommended" |
| Different but under hysteresis | Amber | "Sail: [active]. [Recommended] would be +N% faster (under threshold)" |
| Past hysteresis | Red | "Change recommended: [active] → [recommended] (+N% / +M sec/NM)" |
| Stale (no wind > 30s) | Grey | "Stale wind — last known: [active vs recommended]" |
| No wind ever | Grey | "Waiting for live wind…" |

Live wind values (TWS, TWA) shown below the recommendation in a small monospace line.

**Panel 2: Crossover chart.**

SVG heatmap reusing the existing `PolarPlot.tsx` component patterns (axes, projection). X-axis = TWS (0–`chartTwsMaxKn`), Y-axis = TWA (`chartTwaMinDeg`–`chartTwaMaxDeg`, mirrored for port/stbd visually). Each cell filled with the winning config's color, **derived at render time from a stable hash of `configId`** — no schema change. A `getConfigColor(configId): string` helper in the web package owns the hash. Promoting to a persisted `SailConfig.color` field is captured under *Out of scope* for a future issue.

Hover/tap reveals:
```
TWS 14 kn · TWA 95°
A2 — 7.1 kn (winner)
J1 — 6.8 kn (runner-up)
```

Live operating point (current TWS, TWA) drawn as a moving marker.

**Panel 2 settings drawer** (collapsible above the chart): TWS max, TWA range, hysteresis. Writes back to `wardrobe.settings`.

**Panel 3: Forecast timeline.**

Horizontal scrollable strip. Each segment is a colored block sized proportionally to `durationHours`. Block contents: config name, start time, duration.

```
[ A2 ──── 2.5h ─ ][ J1 ─── 1.5h ][ A3 ───── 3h ───── ][ ... ]
00:00          02:30        04:00              07:00
```

Click on a segment → navigates to `/chart?focus=<lat>,<lon>` (a feature on `/chart` that may exist or may need a small follow-up; not in scope here).

Behind the timeline strip, a small text line: *"Based on [GFS|ECMWF] forecast from [issue time]. Re-plan from /chart to refresh."*

### `/helm` badge

New compact tile (matches the existing tile aesthetic — same dimensions as the "Active sails" tile from the May-10 plan).

```
┌─────────────────────┐
│ SAIL                │
│ [config name]       │
│ ▲ change (if past)  │
└─────────────────────┘
```

- Border: slate when recommended === active; amber when different but under hysteresis; red + small triangle when past hysteresis.
- Tap → `/sails`.
- Stale state: dim color, "stale" badge.
- No-wind state: greyed out, "—".

The existing "Active sails: X [change]" indicator from the May-10 plan is unchanged. This is an *additional* tile sitting next to it.

## Testing

| File | What it covers |
|---|---|
| `packages/compute/src/sail-crossover/compute.test.ts` | `computeCrossoverGrid` with synthetic wardrobes. Single-config (winner is always that config). Two-config crossover (boundary cell asserts correct winner). Uncovered region (sentinel). Edge of TWS range (no off-by-one). |
| `packages/compute/src/sail-crossover/pipeline.test.ts` | `startSailRecommendationPipeline` against a synthetic bus. Wind change tracks winner. Hysteresis suppresses `shouldChange`. Pipeline clean teardown. No publish before first wind sample. Stale state after 30s of silence. |
| `packages/routing/src/plan.wardrobe.test.ts` | fast-check property: `wardrobeRoute.totalTime <= activeOnlyRoute.totalTime` for any (wardrobe, wind, start, end). Determinism: same inputs → same `sailTimeline`. Thrash suppression: hand-crafted wind oscillation produces no <15-min segments. |
| `packages/web/src/app/sails/page.test.tsx` | Renders cleanly with: no wardrobe, no live wind, no active route, all three present. No interactive-flow tests — manual verification covers click/tap. |

The `wardrobe.recommendation` channel is consumed by the UI over the **existing** `/api/stream` SSE bridge (same as every other bus channel). No new HTTP endpoint is introduced for this feature — eliminating one moving part vs the May-10 plan's `/api/sails/active` pattern. The `/api/sails` GET/PUT wardrobe and `/api/sails/active` PUT endpoints (from the May-10 plan) are unchanged.

The existing `packages/routing/test/integration/bermuda-newport.test.ts` gets a one-line change to pass `wardrobe` instead of `polar`. No new boat-integration tests — the property test plus the existing integration are sufficient coverage.

## Error handling

| Failure | Behaviour |
|---|---|
| Wardrobe has no active config | Recommendation pipeline publishes `null`. /helm badge greys out. /sails chart shows "wardrobe incomplete — visit config editor". Routing with wardrobe throws clear error at plan-time. |
| Active config's polar is empty | Same as above. |
| Live wind missing > 30s | Recommendation pipeline publishes `stale: true` with last known-good values. /helm badge shows "stale" indicator. |
| Plan API called with both `polar` and `wardrobe` | Server logs warning. Wardrobe wins. Documented in route handler. |
| Forecast cache empty when computing timeline | Timeline panel shows "no forecast available — refresh from /forecast". No timeline rendered. |

## Rollout

- No feature flag.
- No env var.
- No migration: the existing wardrobe always has at least a "Default" config (from the May-10 plan's migration), so the recommendation pipeline always has something to recommend.
- The /sails page changes are additive; existing config-list + per-config editor preserved.
- Old `polar`-style routes saved to disk keep loading. Re-planning produces wardrobe-aware routes from then on.

## Out of scope (deliberately, for future issues)

- Per-config `changeCostSeconds` modeling and budget-style routing (covered by the "derive + post-process" decision; revisit if real-world plans show too many sail changes).
- Real-time wind-forecast preview at the boat's *current* position when no route exists. The timeline is route-gated.
- Sail-state telemetry from N2K (a real sensor that says "A2 is up"). The active config is operator-set manually via the existing /sails active-config picker.
- Per-sail polar curves on the existing live polar plot. The crossover chart is the comparison view; the live polar plot keeps showing only the active config.
- Pruner upgrade to consider sail-state in branch selection (see "Pruner edge case" in Routing integration).
- Persisting per-config colors (`SailConfig.color` field). v1 derives colors from a stable hash of `configId` for both the chart and the helm badge — the operator can't override. A user-facing color-picker in the /sails config editor is a future issue.

## Implementation phases (for the executable plan)

These aren't part of this spec — listed so the implementation plan can split them cleanly:

1. **Data + compute** — `computeCrossoverGrid` + tests. No UI yet.
2. **Live recommendation pipeline** — RxJS, publishes to bus. Pipeline tests.
3. **/api/sails/recommendation** + API tests.
4. **/sails page panels** — chart + recommendation + (route gated) forecast timeline.
5. **/helm badge.**
6. **Wardrobe-aware routing** — `plan()` API expansion + property tests + `sailTimeline` post-process.
7. **Forecast timeline implementation** — depends on (6).
