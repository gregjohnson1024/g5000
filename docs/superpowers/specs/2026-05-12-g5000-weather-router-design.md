# Weather Router (GRIB loader + isochrone passage planner) — Design

**Date:** 2026-05-12
**Status:** Drafted, awaiting user review
**Scope:** New Mac-side app for passage planning and departure-window scanning, deeply integrated with the g5000 autopilot for live polar + position.

## 1. Problem

The user owns a cruising catamaran. The g5000 monorepo currently produces:

- An onboard **autopilot-server** running on an RPi.
- A **sail wardrobe** with per-config polars, edited in the helm web UI.
- Live channels for GPS, true wind, boat speed, etc.

What's missing is the _planning_ counterpart: a Mac-side application that

1. Fetches weather (wind) and surface-current GRIBs.
2. Runs an isochrone router against the active boat polar to compute optimal
   routes from A→B.
3. Scans a window of possible departure times to identify the best.
4. Shows the result on a chart, with a per-leg timeline, exportable to GPX.

The router must reuse — not duplicate — g5000's `PolarTable` data model and
polar interpolation math, so the same polar that drives target-BSP at the
helm drives routing decisions ashore or aboard.

## 2. Goals

- Compute an isochrone route across multi-day GRIB forecasts, given start,
  end, departure time, and the active polar.
- Compare GFS and ECMWF model routes side-by-side as a confidence signal.
- Optionally factor in surface currents (RTOFS) — toggleable, since the
  Gulf-Stream-style decision of "with vs against" is itself instructive.
- Scan a departure window (e.g., "next 7 days, 3-hour steps") and surface the
  best departure as a calendar heat-map.
- Run live on the boat _and_ offline ashore. Live = subscribe to g5000 for
  position + polar; offline = cached polar + manual start.

### Non-goals (v1)

- Wave/seas-aware routing (WAVEWATCH III layer).
- Squall avoidance, gust modeling.
- Engine-on motoring-through-calms routing.
- Currents at depth or tidal-stream routing (RTOFS is surface only).
- Routing on the RPi (Mac only; computation lives where the chart sits).

## 3. Repo and runtime layout

### 3.1 Single monorepo

All code lives in the existing `g5000` repo. The user's `~/code/g5000_weather/`
directory becomes a **git worktree** of `g5000/` checked out to a `router`
branch:

```
g5000/             ← main checkout, autopilot work
g5000_weather/     ← worktree of g5000, router work
                     (same git history, independent files)
```

This means two Claude sessions can operate concurrently without `npm install`,
`tsc -b`, `package-lock.json` or `.code-review-graph/` races. Created via
`git worktree add ../g5000_weather router`.

### 3.2 Packages added to g5000

| Package              | Kind     | Depends on                                                       | Purpose                                             |
| -------------------- | -------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `packages/grib`      | pure lib | (wraps `wgrib2`)                                                 | Fetch & parse GRIB2 wind and current → typed fields |
| `packages/coastline` | pure lib | (GSHHG shapefiles)                                               | Point-in-polygon & segment-crosses-land queries     |
| `packages/routing`   | pure lib | `@g5000/db`, `@g5000/compute`, `@g5000/grib`, `@g5000/coastline` | Isochrone router, pure functions                    |
| `apps/router`        | Next.js  | all of the above                                                 | UI + API route handlers                             |

### 3.3 Tiny additions in existing `g5000/packages/web`

- `app/api/position/route.ts` — SSE stream of `{ lat, lon, sog, cog, t }`.
- `app/api/wardrobe/active/route.ts` — JSON GET of the active `SailConfig`
  (including its polar).

Both endpoints are ≤50 lines each, mirror existing route-handler patterns
(see `app/api/config/polars/route.ts`), and do not modify autopilot behavior.

### 3.4 Runtime topology

```
RPi (boat LAN)                           Mac (helm/saloon)
┌──────────────────────────┐             ┌──────────────────────────┐
│ g5000 autopilot-server   │   HTTP/SSE  │ apps/router (Next.js)    │
│   /api/position    ──────┼─────────────┼──→ live position stream  │
│   /api/wardrobe/active   │             │   active polar (cached)  │
└──────────────────────────┘             │                          │
                                         │   ↑ user                 │
NOAA NOMADS  ─── HTTPS ──────────────────┼──→ GFS wind GRIB         │
ECMWF AWS S3 ─── HTTPS ──────────────────┼──→ ECMWF wind GRIB       │
NOAA NOMADS  ─── HTTPS ──────────────────┼──→ RTOFS current GRIB    │
                                         │                          │
                                         │ packages/routing         │
                                         │   isochrone evaluator    │
                                         └──────────────────────────┘
```

Offline mode: same picture without the RPi half. Status badge flips to
`Offline 🌐`. The router reads its cached last polar from disk and the user
keys in start manually.

The dependency direction is strictly **autopilot ← router**: the autopilot
runs fine if the router app never exists. The router degrades gracefully if
the autopilot is unreachable. The only coupling between them is two HTTP
endpoints and one shared TypeScript type (`PolarTable` from `@g5000/db`).

## 4. Data flow

### 4.1 Flow A — Plan a single passage

1. Browser opens `apps/router` at `localhost:3000`.
2. App pings `g5000/api/wardrobe/active`:
   - Online → caches polar JSON to disk, opens SSE for `/api/position`,
     badge = `Live: g5000 onboard ✓`.
   - Offline → loads most-recent cached polar; badge = `Offline 🌐`.
3. User picks start (defaults to live position when available).
4. User picks destination (map click or saved waypoint).
5. User picks departure time (default: now).
6. User picks wind model(s): GFS, ECMWF, or both.
7. User toggles "Use currents in routing" (defaults to off; "Show current"
   overlay is independent).
8. App ensures GRIBs are loaded for the route bbox + horizon:
   - For each selected wind model, fetch + parse (or use cache) →
     `WindField`.
   - If "Show current" or "Use currents in routing" is on, fetch RTOFS →
     `CurrentField`.
9. App runs `packages/routing.plan()` per selected wind model, producing one
   `Route` each.
10. Map renders routes (one polyline per model), with isochrones, wind barbs
    at hover, time-of-arrival markers along track. Right pane shows TWS/TWA
    /BSP/heading per leg, ETA, distance, model + run time.
11. Export GPX or save plan to `~/.g5000-router/plans/{id}.json`.

### 4.2 Flow B — Departure-window scan

Same engine, repeated:

1. User picks start, end, window-start, window-duration (e.g. 7 days), and
   step (e.g. 3 h).
2. App ensures GRIBs cover the full window.
3. For each candidate departure `t_d`, run `plan()` → record summary
   `{ eta, mean_tws, max_tws, total_distance, time_above_30kn,
time_with_twa<40°, incomplete }`.
4. Render as a calendar heat-map: rows = days, columns = hours-of-day, cell
   color = ETA (or roughness, switchable).
5. Click a cell → drill into that specific route in Flow A's view.

7-day × 3-hour window = 56 routes. Each is sub-second; total well under a
minute on the user's Mac.

### 4.3 Cross-package data shapes

```ts
type WindField = {
  lats: number[]; // degrees, ascending
  lons: number[]; // degrees, ascending (handles dateline)
  times: number[]; // unix seconds, ascending
  u: number[][][]; // [t][lat][lon] m/s east-component
  v: number[][][]; // [t][lat][lon] m/s north-component
  source: 'GFS' | 'ECMWF';
  runTime: number; // unix seconds, when the model run was issued
};

type CurrentField = Omit<WindField, 'source'> & { source: 'RTOFS' };

type LatLon = { lat: number; lon: number };

type RouteLeg = {
  t: number; // unix seconds at start of leg
  lat: number;
  lon: number;
  heading: number; // radians true, water-frame
  twa: number; // radians, |twa|
  tws: number; // m/s
  bsp: number; // m/s, through-water
  sogGround: number; // m/s, over-ground (differs from bsp when currents on)
};

type Route = {
  legs: RouteLeg[];
  start: number; // unix seconds
  end: number; // unix seconds
  distance: number; // meters, integrated along-track over-ground
  model: 'GFS' | 'ECMWF';
  usedCurrents: boolean;
  polarId: string; // wardrobe entry used
  incomplete?: boolean;
  reason?: 'exceeded_max_hours' | 'no_wind' | 'land_blocked';
};
```

`PolarTable` is the existing type from `@g5000/db/defaults.ts`; we do not
redeclare it.

## 5. Components

### 5.1 `packages/grib`

**Public surface:**

- `fetchGfs(bbox, hours): Promise<WindField>` — NOAA NOMADS subset API, gets
  `u10`/`v10`/`mslp` for the bbox over the requested forecast hours.
- `fetchEcmwf(bbox, hours): Promise<WindField>` — ECMWF Open Data on AWS S3.
  Uses ECMWF's index (`.idx`) files to `Range`-GET only the matching messages.
- `fetchRtofs(bbox, hours): Promise<CurrentField>` — NOAA NOMADS, gets
  `UOGRD`/`VOGRD` (surface current u/v).
- `parseGrib2(input: Buffer | string): WindField | CurrentField` — wraps
  `wgrib2 -json` (system binary, installed via `brew install wgrib2`).
  Fallback for environments without `wgrib2`: pure-JS `grib2-simple`.
- `interpolateWind(field, lat, lon, t): { u: number; v: number }` —
  trilinear over (lat, lon, time). Errors if `(lat, lon, t)` is outside the
  field bounds (no silent extrapolation).
- `interpolateCurrent(...)` — same signature.

**Cache layout:**

```
~/.g5000-router/grib-cache/
  gfs/{runTime}/{bbox-hash}/u10.grb2
  gfs/{runTime}/{bbox-hash}/v10.grb2
  ecmwf/{runTime}/{bbox-hash}/...
  rtofs/{runTime}/{bbox-hash}/...
```

Content-addressable; per-bbox so disjoint passages don't invalidate each
other's cache. Eviction policy in v1: simple "delete runs older than 7 days"
on app start.

**Validation:** every fetched GRIB message has its CRC checked; corrupted
messages trigger one re-request, then surface `{ kind: 'parse_failed', … }`.

### 5.2 `packages/coastline`

**Public surface:**

- `loadCoastline(level: 'l' | 'i' | 'h'): Coastline` — loads GSHHG shapefile
  (we'll ship `i` and `h`; pre-converted to GeoJSON for runtime speed),
  builds an R-tree for fast spatial queries.
- `intersectsLand(c, lat1, lon1, lat2, lon2): boolean` — R-tree bbox prefilter,
  then exact polygon-segment intersection on candidates.
- `isOnLand(c, lat, lon): boolean` — R-tree bbox prefilter, then point-in-
  polygon.

**Data source:** GSHHG 2.3.7 from
https://www.soest.hawaii.edu/pwessel/gshhg/ — LGPL, multi-resolution,
self-consistent. Used by qtVlm, LuckGrib, OpenCPN, GMT.

**Resolution choices:**

- `i` (intermediate, ~1 km, ~30 MB) — routing land-avoidance.
- `h` (high, ~200 m, ~100 MB) — map display only.

**Distribution:** download script (`pnpm run fetch:coastline` or similar) on
first checkout, target dir excluded from git. Avoids inflating the repo.

### 5.3 `packages/routing`

**Public surface:**

```ts
plan(opts: {
  start: LatLon;
  end: LatLon;
  departure: number;
  wind: WindField;
  polar: PolarTable;
  coastline: Coastline;
  currents?: CurrentField;
  options?: {
    stepMinutes?: number;            // default 30
    headingFanDeg?: number;          // default 90 (±)
    headingResolutionDeg?: number;   // default 5
    maxHours?: number;               // default 168 (1 week)
    avoidLand?: boolean;             // default true
    useCurrents?: boolean;           // default false
    pruneBucketDeg?: number;         // default 2
  };
}): Route;
```

Pure function; no I/O, no global state, no side effects.

**Algorithm — classic isochrone:**

```
frontier ← { start_node }
loop:
  next ← ∅
  for each n in frontier:
    bearingToDest ← greatCircleBearing(n.pos, end)
    for h in fan(bearingToDest, ±headingFan, headingResolution):
      wind   ← interpolateWind(W, n.lat, n.lon, n.t)
      tws    ← hypot(wind.u, wind.v)
      twd    ← atan2(−wind.u, −wind.v)               // wind-from direction
      twa    ← normalize(twd − h)
      bsp    ← interpolatePolarSpeed(polar, tws, |twa|)
      if bsp < 0.1: continue                          // in-irons
      v_water ← (cos h, sin h) · bsp
      v_ground ← useCurrents ? v_water + interpolateCurrent(C, n.lat, n.lon, n.t) : v_water
      newPos ← rhumbStep(n.pos, |v_ground|, atan2(v_ground.y, v_ground.x), step)
      if avoidLand and intersectsLand(coastline, n.pos, newPos): continue
      push next ← { newPos, n.t + step, parent=n, heading=h, twa, tws, bsp, sogGround=|v_ground| }
  frontier ← prune(next, pruneBucketDeg)
  if anyReaches(frontier, end): close route and break
  if elapsed(frontier) > maxHours: return best_partial as incomplete
trace back parent pointers → Route
```

**Pruning:** bucket frontier nodes by bearing-from-start at
`pruneBucketDeg` resolution. Within each bucket, keep only the node
furthest from start (along great-circle distance). This is what makes
isochrone routing tractable; without it, the frontier explodes
exponentially.

**Heading fan:** ±90° from `bearingToDest`, 5° steps → 37 candidates per
node. Adaptive widening to ±135°, then ±180°, if no candidate produces
forward progress (so we tack in pure headwinds).

**Reuse of g5000 code:** `interpolatePolarSpeed` is imported directly
from `@g5000/compute`. Same polar interpolation drives autopilot
target-BSP and routing decisions — they cannot disagree.

**v2-deferred refinements** (architecturally non-breaking):

- Tack-penalty / heading-continuity bonus in fan ranking.
- Per-leg sail-config selection from wardrobe (`Route.legs[i].polarId`).
- Wind shear correction (10 m → masthead via power-law).

### 5.4 `apps/router` (Next.js App Router)

**Pages:**

- `/` — main planner (map left, controls right).
- `/window` — departure-window picker + heat-map.
- `/plans` — saved plans list.
- `/grib` — GRIB cache inspector.
- `/settings` — g5000 host URL, polar fallback path, `wgrib2` path, cache root.

**API route handlers:**

- `GET /api/live/position` — SSE proxy from g5000.
- `GET /api/live/polar` — JSON proxy from g5000.
- `POST /api/grib/fetch` — `{ model, bbox, hours }` → triggers fetch, returns cached info.
- `POST /api/route/plan` — `{ start, end, departure, model, useCurrents }` → `Route`.
- `POST /api/route/window` — `{ start, end, windowStart, windowHours, stepHours, model, useCurrents }` → summary array.
- `GET/POST /api/plans` and `GET /api/plans/[id]` — local-FS storage.

**Local persistence:** flat JSON files under `~/.g5000-router/`:

```
plans/{id}.json
grib-cache/{model}/{runTime}/{bbox-hash}/*.grb2
cached-polar.json
settings.json
```

No SQLite in v1; single-user, no concurrent writes.

**Map:** MapLibre GL JS, OSM raster base + OpenSeaMap nautical overlay.
Wind as canvas-overlay barbs (more readable than particle animation for
planning UI). Currents as small arrows when `Show current` is on.

### 5.5 g5000 endpoint additions

`packages/web/src/app/api/position/route.ts`:

- Opens SSE.
- Subscribes to bus channels `gps.position.lat`, `gps.position.lon`,
  `gps.position.sog`, `gps.position.cog`.
- Emits `{ lat, lon, sog, cog, t }` on every coherent position update
  (rate-limited to ~1 Hz).

`packages/web/src/app/api/wardrobe/active/route.ts`:

- JSON GET; reads first value of `configStore.activeWardrobe$`.
- Returns active `SailConfig` including its full polar.

That is the entire footprint on the autopilot side.

## 6. Error handling

### 6.1 Network / fetch failures

- GRIB source unreachable: structured error
  `{ kind: 'fetch_failed', source, runTime?, retryAfter? }`. UI banner with
  retry. If a cached run <12 h old exists, offer one-click "Use cached run".
- Partial/corrupt GRIB: CRC check fails → one re-request → if still bad,
  `{ kind: 'parse_failed' }`. No silent fallback to wrong data.
- g5000 unreachable: live SSE errors → badge flips to `Offline 🌐`. Router
  keeps working against cached polar. Sticky-visible badge so user knows.
- No cached polar at all on first offline run: prompt to import Expedition
  CSV via existing `parseExpeditionPolar` from `@g5000/compute`.

### 6.2 Algorithmic failures

- Destination not reached within `maxHours`:
  `{ ok: true, route: <best partial>, incomplete: true, reason: 'exceeded_max_hours' }`.
- Start or end on land: caught at API input via `isOnLand`. 400 with
  `{ kind: 'invalid_position', which: 'start' | 'end' }`.
- Wind data doesn't cover bbox/time: `{ kind: 'insufficient_data', need, have }`.
  No silent extrapolation; UI offers re-fetch.
- In-irons across full frontier even with widened fan:
  `{ ok: true, route, incomplete: true, reason: 'no_wind' }`.

### 6.3 Local-FS failures

- `~/.g5000-router/` not writable / disk full: shown as a settings-page
  health indicator. Save failures surface immediately; we never silently
  hold state in memory.

### 6.4 Explicit non-behaviors

- No auto-retry with backoff on every operation. One retry, then surface.
- No silent fallback between wind models. If you asked for ECMWF and it's
  not available, you get the error, not GFS relabeled.
- No "best effort with whatever data we had." Routes always know their
  `model` and `runTime`.

### 6.5 Error shape

All API responses on failure:

```ts
{ ok: false, error: { kind, message, retryable: boolean, ...details } }
```

The UI has one error-banner component that switches on `kind`.

## 7. Testing strategy

Runner: **vitest** (g5000's existing). Drops straight into `npm test`.

### 7.1 Unit tests (most of the suite)

- `packages/grib`: `parseGrib2` against a checked-in 200 KB GFS fixture;
  `interpolateWind` at exact grid points / midpoint / out-of-range; URL-builders
  for NOMADS and ECMWF AWS asserted to known-good strings; no network.
- `packages/coastline`: `isOnLand` and `intersectsLand` against a dozen known
  points and legs, including resolution-dependent cases (small islands present
  at `h`, absent at `l`).
- `packages/routing`: pruning behavior, heading-fan generation, `decompose`
  (u,v) → (tws,twd). `interpolatePolarSpeed` not re-tested (covered by
  `@g5000/compute`).
- `apps/router` API handlers: mocked package functions, assert request →
  response shape and error mapping.

### 7.2 Property-based tests (fast-check)

The workhorse for `packages/routing`:

1. **Uniform wind ⇒ near-great-circle.** Constant wind, random A→B in open
   ocean → mean route bearing within ±15° of great-circle bearing for
   beam-reach conditions.
2. **More wind ⇒ faster (in reaching range).** Double TWS in 60°–120° TWA
   conditions → ETA decreases.
3. **Distance ≥ great-circle.** Route distance ≥ great-circle distance,
   always.
4. **Determinism.** Same inputs → byte-identical `Route`.
5. **Currents reverse.** Same wind, current vectors negated → ETA with
   current < ETA against current; magnitude ≈ ∫ current speed along route.
6. **Coastline forces detour.** Synthetic island on the great-circle path →
   route with `avoidLand=true` is longer and doesn't touch the polygon.

### 7.3 Integration tests

- `plan()` against a real archived GFS GRIB + real `i`-level GSHHG, on one
  known passage (Bermuda → Newport, 4 days). ETA within ±2 h of a hand-validated
  baseline. Regression guard.
- ECMWF AWS fetcher against recorded HTTP fixtures (`nock`). No live S3 in CI.

### 7.4 End-to-end smoke

- Spin up `apps/router` in test mode, POST `/api/route/plan` with a tiny
  synthetic GRIB and a known polar, assert HTTP 200 + `Route` shape. Wiring
  test, not correctness.

### 7.5 g5000-side test additions

- `packages/web/src/app/api/position/route.test.ts` — open SSE, push events
  onto bus, assert frames emitted. Mirrors `app/api/config/polars/route.ts`.
- `packages/web/src/app/api/wardrobe/active/route.test.ts` — GET returns
  active config; correct empty-state response.

### 7.6 Performance budget (asserted)

A perf-benchmark file in `packages/routing/test/perf.bench.ts`:

- Single 3-day passage, 30-min step: target <2 s, hard limit 5 s.
- 7-day window scan (3 h step = 56 routes): target <30 s, hard limit 60 s.
- 5 MB GFS slice parse: target <500 ms.

### 7.7 Not tested

- Live g5000 onboard SSE (passthrough; manual once-test).
- MapLibre rendering output.
- Live network roundtrips to NOAA/ECMWF in CI.

## 8. Implementation order (rough sketch — final plan in plans/)

The implementation plan will be drafted via `superpowers:writing-plans`. As a
hint of the natural sequencing:

1. Worktree setup + branch.
2. `packages/grib` GFS fetch + parse + `interpolateWind`, with unit tests
   and the 200 KB GFS fixture.
3. `packages/coastline` with `i`-level GSHHG and unit tests.
4. `packages/routing` core isochrone (no currents, no land), property
   tests #1–#4.
5. Add land avoidance to routing, property test #6.
6. `apps/router` skeleton: `/`, `/api/route/plan`, hand-coded test polar.
7. g5000 endpoint additions: `/api/position`, `/api/wardrobe/active` + tests.
8. Live mode in `apps/router`: SSE proxy, polar fetch + cache, badge.
9. `packages/grib` ECMWF fetch path.
10. UI: model picker, side-by-side route rendering.
11. `packages/grib` RTOFS fetch + `interpolateCurrent`.
12. Currents in routing engine (optional, behind toggle), property test #5.
13. UI: current overlay + routing toggle.
14. Departure-window scan (`/window` page).
15. Plans persistence + GPX export.
16. Performance budget benchmarks.
17. Integration test (Bermuda → Newport regression).

## 9. Open questions deferred to implementation

- Exact NOAA NOMADS subset API URL format (verify per current docs at impl).
- Whether to ship GSHHG via Git LFS or download script (likely script).
- `wgrib2` invocation details and JSON output schema specifics.
- MapLibre style URL for OSM + OpenSeaMap (verify free tile usage policy).
- Whether `apps/router` should be Next.js dev-mode only, or built/standalone
  for daily use (likely keep dev-mode for v1 simplicity).
