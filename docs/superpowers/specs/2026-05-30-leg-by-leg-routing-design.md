# Leg-by-leg routing through intermediate waypoints

**Date:** 2026-05-30
**Status:** design (approved in brainstorming)
**Issue:** #21 (routing enhancements — leg-by-leg item)

## Summary

Today the isochronic-fan router plans a single origin → destination leg
(`plan()` in `packages/routing/src/plan.ts`). This adds **leg-by-leg routing**:
plan a path that must pass through an ordered list of intermediate waypoints,
chaining each segment's departure to the previous segment's arrival ETA so wind
is sampled at the time the boat actually reaches each leg.

Two motivations:

1. General multi-waypoint passages (origin → A → B → destination).
2. A pragmatic manual workaround for the unbuilt enclosed-water/bay-entry
   problem (#21 item 2): route via a waypoint at a bay mouth (e.g. into
   Narragansett Bay) instead of relying on the destination-biased fan to find
   it. The current Bermuda → Bristol passage is the live case.

The new logic is a thin orchestrator over the existing, well-tested `plan()`
primitive — `plan()` itself does not change.

## Non-goals

- **Per-leg options.** All segments share one set of options (polar, motor /
  auto-motor, currents, fan/step knobs) for v1. Per-leg motor (sail offshore,
  motor into the bay) is the obvious v2 and is called out where the seam is, but
  is not built here.
- **Automatic enclosed-water detection** (#21 item 2). This spec gives the
  *manual* tool (route via a bay-mouth waypoint); auto-detecting that a
  destination sits inside enclosed water is a separate spec.
- **Waypoint-order optimization.** The sequence is honoured as given; we do not
  reorder it to minimize ETA.
- **Cross-segment isochrone sharing.** Each segment is an independent fan that
  restarts at its waypoint. Waypoints are hard constraints, so there is nothing
  to share.
- **Changes to saved-route CRUD.** We only *read* saved routes; the `/routes`
  page and `RouteBuilder` are untouched.
- **Re-planning during playback.** Unchanged from today — playback replays the
  computed legs.

## 1. Engine — `planVia` orchestrator (`packages/routing`)

A new exported function composes `plan()` over consecutive waypoint pairs:

```ts
// The planned path is [input.start, ...intermediates, input.end].
// intermediates: [] makes this identical to plan(input) (the degenerate case).
export function planVia(input: PlanInput, intermediates: LatLon[]): Route;
```

`PlanInput` is reused unchanged (`start`, `end`, `departure`, `wind`, `polar`,
`coastline`, `currents`, `options`). The full ordered path is
`[start, ...intermediates, end]` (≥2 points).

### Algorithm

For each consecutive pair `(path[i], path[i+1])`:

1. Call `plan()` with `start = path[i]`, `end = path[i+1]`, `departure = ETA of
   the previous segment` (first segment uses `input.departure`), and the
   segment's `maxHours` set to the **remaining** time budget (see below).
2. Append the segment's legs to the accumulated legs, **dropping the duplicated
   waypoint vertex** between consecutive segments (segment i+1's synthetic start
   leg coincides with segment i's final leg). The exact leg-slice index is an
   implementation detail to pin against `plan()`'s synthetic start/finish leg
   structure under TDD.
3. Add the segment's `distance` to the running total.
4. If the segment is `incomplete`, stop: return the legs accumulated so far
   (including the partial segment), `incomplete: true`, the segment's `reason`,
   and `incompleteVia` = the failed path-segment index.
5. Otherwise set `departure = segment.end` and decrement the remaining budget by
   the segment's elapsed time.

Return a single `Route`: concatenated `legs`, `start = input.departure`,
`end = last segment's arrival`, `distance = Σ segment distances`, and the same
`model` / `usedCurrents` / `polarId` the segments carry.

### Chaining semantics (the pinned decisions)

- **ETA chain.** Each segment departs at the previous segment's arrival, so the
  wind/current fields are sampled at the real arrival time.
- **`maxHours` is a total budget**, decremented across segments — a 3-leg plan
  does not get `maxHours` per leg. When the remaining budget reaches zero
  mid-segment, that segment returns `incomplete` with reason
  `exceeded_max_hours`.
- **Forecast horizon bounds the whole chain.** The chained ETAs must stay inside
  the loaded wind/current window (~120 h). A segment that would run past it
  comes back `incomplete` (`no_wind`).
- **Options are uniform** across all segments in v1.

### Type change

Add one optional, additive field to `Route` (single-leg consumers ignore it):

```ts
/** Path-segment index (0 = start→first waypoint) that failed to complete.
 *  Set only when incomplete on a multi-leg plan. */
incompleteVia?: number;
```

## 2. API — `/api/route/plan` accepts `via`

`packages/web/src/app/api/route/plan/route.ts` gains an optional ordered
intermediate-waypoint list:

```ts
via?: { lat: number; lon: number }[];   // intermediates, between start and end
```

- `via` present and non-empty → call `planVia(input, via)`.
- absent/empty → today's `plan(input)` path (fully backward-compatible).

The bbox that loads wind/currents must enclose **all** points. Generalize the
current `bboxAround(start, end)` to take the full point array
`[start, ...via, end]` (same 2° buffer). `via` entries are validated as
`{lat, lon}` numbers; an invalid entry is a 400.

Options resolution (`resolvePlanOptions`) is unchanged — the same resolved
options apply to every segment.

## 3. UI — chart plan panel (both sources)

The plan panel (`RoutePlanPanel.tsx` + `PlanControls.tsx`) gains a small mode
switch for *where the ordered waypoints come from*:

- **Saved route** — a dropdown of saved routes from `GET /api/routes`
  (`{ id, name, waypointIds }`). The panel resolves `waypointIds` → coordinates
  via the loaded waypoints list, producing `[start, ...intermediates, end]`.
  Start/End pickers are hidden in this mode (the route defines them). A route
  with fewer than 2 resolvable waypoints is disabled with a hint.
- **Pick waypoints** — the current Start/End pickers, plus an ordered,
  reorderable list of intermediate waypoints with "+ add waypoint". Reuse the
  existing move-up/down ordering from `app/routes/reorder.ts` rather than
  reinventing it.

Both modes build the same request shape (`start`, `end`, `via`) and POST to
`/api/route/plan`. `PlanParams` (in `PlanControls.tsx`) gains `via?:
{lat,lon}[]`; `RoutePlanPanel.onPlan` threads it into the fetch body. The
existing GFS/ECMWF fan-out (one POST per model) is unchanged — each model call
does the full multi-leg chain.

### Rendering

The concatenated `Route` draws as one polyline, so `RoutePolyline`,
`RouteTimeline`, `RouteWindLayer`, `PlaybackScrubber`, and GPX export consume it
unchanged. Waypoint vertices MAY be marked with small dots (nice-to-have, not
required for v1). The summary line keeps showing total distance + duration;
per-waypoint ETA badges are an optional follow-up.

## 4. Testing

Engine unit tests (`packages/routing`, alongside `plan.test.ts`):

- **Degenerate:** `planVia(input, [])` returns a `Route` equal to `plan(input)`
  (same legs, distance, end).
- **ETA continuity:** a two-segment chain has segment-2's first real leg
  departing at segment-1's arrival time.
- **Distance additivity:** total `distance` == Σ per-segment distances; vertex
  dedup does not double-count or drop length.
- **Total budget:** `maxHours` is enforced across the chain, not per segment;
  a chain that exceeds it returns `incomplete` / `exceeded_max_hours` with the
  correct `incompleteVia`.
- **Incomplete propagation:** a land-blocked / no-wind middle segment returns
  the partial route with `incompleteVia` = that segment's index.

API test: a request with `via` widens the bbox to enclose the intermediates and
round-trips a multi-leg `Route`; an invalid `via` entry returns 400.

## 5. Build / deploy notes

`packages/routing` is in the Pi rebuild chain already (CLAUDE.md §Deployment).
`packages/web/src/app/api/route/plan/route.ts` imports from `@g5000/routing`, so
`routing/dist` must be rebuilt before `next build` resolves the new `planVia`
export — the same stale-dist trap documented for `plan`. No new packages, no
schema migration (saved routes already exist; we only read them).

## Implementation order

1. `planVia` + engine types + unit tests (TDD) in `packages/routing`.
2. Rebuild `routing/dist`; extend `/api/route/plan` (`via`, bbox widening) +
   API test.
3. Plan-panel UI: mode switch, saved-route resolver, ad-hoc intermediate list.
4. Optional polish: waypoint dots, per-waypoint ETA badges.
