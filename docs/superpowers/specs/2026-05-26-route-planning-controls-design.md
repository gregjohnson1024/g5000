# Route planning controls, auto-motor, dual-model compare & playback

**Date:** 2026-05-26
**Status:** design (approved in brainstorming)

## Summary

Three related additions to the chart route planner and a new Settings/Planning
section:

1. **Adjustable planning parameters** — frontier size, isochrone (step) length,
   heading fan, horizon, and a land-check toggle. Global defaults live in
   Settings; the chart Route planner can override them per plan.
2. **Auto-motor** — a per-plan speed policy ("when polar speed < X kn, motor at
   Y kn"), evaluated per step. Replaces the existing "Motor only" checkbox
   (set X very high to force always-motor).
3. **Dual-model compare + route playback** — plan GFS and ECMWF together, draw
   each route colour-coded, and scrub a time control that walks a ghost boat
   along each route with a per-route SOG/COG/HDG/BSP readout. Isochrones are
   dropped.

This supersedes the isochrone fan/animation added in `71baf8f` — that capture
and reveal animation is removed.

## Non-goals

- No new persisted "plan" entities; routes stay in chart state/localStorage as
  today (now keyed by model).
- No styling of motoring vs sailing route segments (the data supports it later;
  not in scope).
- No live re-simulation against wind during playback — playback replays the
  already-planned legs (decided in brainstorming).
- No change to the `/routes` page or its RouteBuilder flow.

## 1. Planning parameters (Settings defaults + per-plan overrides)

### Data

Add a `planning` block to the settings JSON (served by the existing
`/api/settings` GET/PUT, persisted via `lib/persistence` to `settings.json`):

```ts
planning: {
  stepMinutes: number;        // default 30 — "isochrone length" (time between isochrones)
  pruneBucketDeg: number;     // default 2  — "frontier size" (smaller = denser frontier, slower/finer)
  headingFanDeg: number;      // default 90 — search fan half-width
  headingResolutionDeg: number; // default 5 — headings tried per fan
  maxHours: number;           // default 168 — horizon cap
  avoidLand: boolean;         // default true — land check
  autoMotor: {
    enabled: boolean;         // default false
    minSailKt: number;        // default 3  — motor when polar speed below this
    motorKt: number;          // default 5  — speed to motor at
  };
}
```

All speeds are stored in **knots** (user-facing); converted to m/s at the API
boundary (the engine works in m/s, matching the existing `motorSpeed`).

### Settings UI

New **Planning** section in `app/settings/page.tsx`: number inputs for the five
numeric params, a land-check toggle, the auto-motor sub-group (enable + X + Y),
and a "Reset to defaults" button. Each control carries a one-line hint (e.g.
"Frontier size (°) — smaller explores more, slower"). Reads on mount via
`GET /api/settings`, writes via `PUT /api/settings` (merging into the existing
settings object so other keys are preserved).

### API merge

`/api/route/plan` resolves planning options in this order (later wins):

1. engine defaults (`DEFAULTS` in `plan.ts`)
2. `settings.planning` (loaded from `/api/settings` storage)
3. per-request `options` (chart overrides)

The handler currently **forces** `captureIsochrones: true` (line ~77) — change
that to honour the option, default **false** (isochrones are dropped, see §3).

### Chart overrides

The Route planner panel gains a collapsible **Advanced** disclosure, pre-filled
from `settings.planning`, exposing the high-value per-plan overrides: land-check
toggle, frontier size (`pruneBucketDeg`), step length (`stepMinutes`), and
`maxHours`. These are sent in the plan request `options`. Other params
(headingFanDeg/Resolution) are Settings-only.

## 2. Auto-motor

### Engine

Add to `PlanOptions` (`packages/routing/src/types.ts`):

```ts
autoMotor?: { minSail: number; motor: number }; // m/s
```

In `propagate()` (`plan.ts`), after computing `bsp`:

```ts
const bsp0 = o.motor ? o.motorSpeed : interpolatePolarSpeed(...);
const bsp = o.autoMotor && bsp0 < o.autoMotor.minSail ? o.autoMotor.motor : bsp0;
```

Config is per-plan (one `minSail`, one `motor`); evaluation is per step because
wind varies along the route — this is what lets the boat sail the windy stretch
and motor only the calm patch. The existing pure-`motor` option is **kept** (the
synthetic test harness uses it to bypass the polar) but is no longer exposed in
the chart UI.

To make COG available to the playback readout, also add `cog` (radians, ground
course) to `RouteLeg` — `propagate()` already computes `groundBearing`; store it.

### Chart UI

Replace the "Motor (ignore polar, use fixed speed)" checkbox + speed input with
a single **Auto-motor** control: an enable toggle + "motor when slower than
**X** kn, at **Y** kn", pre-filled from `settings.planning.autoMotor`. When
enabled, the plan request sends `autoMotor` (converted to m/s). Forcing
always-motor = set X high. Pure sailing = auto-motor off.

## 3. Dual-model compare + route playback

### Model selection & planning

The wind-model control becomes a **multi-select** (GFS, ECMWF), default **both**.
On Plan, fire one `/api/route/plan` per selected model **in parallel**; store a
`Record<model, Route>`. Each model's wind may need a cold fetch (ECMWF
especially) — surface per-model loading/error state.

### Drawing (colour-coded, no isochrones)

- Remove isochrone capture (`captureIsochrones` defaults false), and remove
  `attachIsochronesUpTo` usage + the reveal-animation effect added in `71baf8f`.
  `attachRoute` is called with `showIsochrones: false` (or the isochrone code
  paths are deleted).
- Draw each model's route as its own MapLibre line layer, colour-coded:
  **GFS = amber (`#f59e0b`), ECMWF = cyan (`#22d3ee`)**. Layer ids
  `route-gfs` / `route-ecmwf`. A small legend maps colour → model.
- Clearing the route removes all model layers and ghost boats.
- Fit-to-route frames the union of the drawn routes.

### Playback

A new **PlaybackScrubber** component, shown only when ≥1 route is loaded:

- Time range = `[min(route.start), max(route.end)]` across loaded routes.
- Controls: play/pause, speed (1× / 4× / 16×), and a draggable scrubber; current
  time shown in the page's UTC/Local mode.
- On each tick (driven by `requestAnimationFrame` against wall-clock × speed):
  - for each route, find the active leg at time `T` and interpolate position →
    place a **ghost boat marker** (colour-keyed), oriented to leg `heading`;
  - update that route's **details box** (see below);
  - drive the wind overlay to the forecast hour nearest `T` (for whichever model
    layer the user currently has displayed — playback sets the *hour*, not the
    *model*).
- When `T` passes a route's `end`, its ghost parks at the destination.
- Stopping playback / clearing routes hides the scrubber and ghosts and restores
  the live view.

### Per-route details boxes

In the right sidebar, one box per loaded route, colour-keyed to its line,
showing at time `T`: **SOG** (`sogGround`), **COG** (`cog`), **HDG** (`heading`),
**BSP** (`bsp`) — all from the active leg, formatted (kn, °T). Boxes update as
the scrubber moves; when paused they hold the current value.

## Components & files

| File | Change |
| --- | --- |
| `packages/routing/src/types.ts` | add `autoMotor` to `PlanOptions`; add `cog` to `RouteLeg` |
| `packages/routing/src/plan.ts` | apply auto-motor floor in `propagate`; store `cog` |
| `packages/web/src/app/api/route/plan/route.ts` | merge settings.planning defaults; honour `captureIsochrones` (default false); accept `autoMotor` (m/s) |
| `packages/web/src/app/settings/page.tsx` | new Planning section |
| `packages/web/src/app/chart/RoutePlanPanel.tsx` | multi-model select, auto-motor control, Advanced overrides; fire N plans; store routes by model |
| `packages/web/src/components/PlanControls.tsx` | rework: multi-model, auto-motor, advanced params (or fold into RoutePlanPanel) |
| `packages/web/src/app/chart/page.tsx` | routes-by-model state; colour-coded draw; remove isochrone animation; mount PlaybackScrubber + details boxes |
| `packages/web/src/components/RoutePolyline.tsx` | drop isochrone draw/animation helpers |
| `packages/web/src/app/chart/PlaybackScrubber.tsx` | **new** — time control + tick loop |
| `packages/web/src/app/chart/RouteDetailsBox.tsx` | **new** — per-route SOG/COG/HDG/BSP readout |
| `packages/web/src/lib/route-playback.ts` | **new** — pure helpers: interpolate position + leg state at time T; map T → forecast hour |

## Testing

- **Engine (vitest):** auto-motor floor — a leg whose polar speed < `minSail`
  reports `bsp == motor`; above it reports the polar speed; with `autoMotor`
  unset, behaviour is unchanged. `cog` is populated and equals `heading` when
  currents are off.
- **route-playback lib (vitest):** position interpolation at a time between two
  leg timestamps lands proportionally between their positions; before
  `route.start` clamps to start, after `route.end` clamps to destination; leg
  state lookup returns the correct leg's SOG/COG/HDG/BSP.
- **Settings merge:** a plan request with partial `options` merges over
  `settings.planning` over engine defaults (unit test the merge helper).
- **Manual (browser):** plan both models on an open-ocean leg with land-check
  off; confirm two colour-coded routes, a legend, scrubbing moves both ghosts
  with live SOG/COG/HDG/BSP, and auto-motor with a high X produces a
  straight-line motor route.

## Risks / notes

- **Planning latency doubles** with two models, plus cold ECMWF wind fetch. The
  ~15 s/route compute floor (frontier × fan × land-checks) stands; turning
  land-check off and coarsening frontier size are the user's levers. Show clear
  per-model progress.
- Dropping isochrones removes the only "planning in progress" visual; the plan
  is now opaque until the route(s) return. Acceptable per brainstorming.
- ECMWF wind may be uncached for the overlay even when the route used it — the
  overlay model follows the layers control, independent of which models were
  planned (pre-existing behaviour, called out for clarity).
