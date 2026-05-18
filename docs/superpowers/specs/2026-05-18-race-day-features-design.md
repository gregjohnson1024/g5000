# Race-Day Features (Cluster A) — Design

**Date:** 2026-05-18
**Status:** Draft
**Scope:** Seven race-day features split out from issue #2 / now tracked in issue #8: race timer / countdown with audible warnings, start-line ping (port + starboard ends → live Distance-to-Line, Time-to-Line, bias angle), laylines on chart (polars + current applied), VMC to active mark, TBS / TWA-target / BSP-%-of-polar tiles on `/helm`, wind-shift plot, OCS (over-early) prediction.

## 1. Context & goal

Sula races. The boat already publishes the bus channels these features need: `nav.gps.position`, `nav.gps.cog`, `nav.gps.sog`, the `wind.true.*` family (when a masthead is wired — see §1.1), an active polar revision (`@g5000/compute/polars`), and a live Copernicus current grid (`@g5000/grib`). None of this is surfaced to a tactician on race day. H5000's "Sailsteer" gives you laylines and a start-line page; g5000 today gives you nothing race-specific.

Goal: ship the seven features as a single coherent surface — one new `/race` page (timer + line ping + active-mark selector), one new compute pipeline that fans out a `race.*` channel family, chart layers for the line and the laylines, and a re-enabled wind-tile block + race-tile group on `/helm`. Persistent across restarts so the boat can step away from the screen between races.

Where g5000 can credibly beat H5000 is layline accuracy: B&G derives set/drift from a single bus channel (instantaneous current at the boat); we have a gridded current field and can integrate current along the projected layline path. That is the standout claim from the seven items, and the design makes it deliberately optional (`integrateCurrent` setting) so the simpler no-current laylines remain available for comparison.

### 1.1 Wind sensor caveat

As of 2026-05-18, Sula has **no operational wind sensor** — the `/helm` page intentionally hides TWS/TWA/AWA/VMG/%-polar tiles with the comment _"Re-add when masthead is wired"_ (`packages/web/src/app/helm/page.tsx:94`). All wind-dependent surfaces in this spec (laylines, line bias, TWA-target, TBS, %-polar, wind-shift plot) will publish nothing on the live boat until the masthead returns. They are verifiable end-to-end via:

- `DEMO_MODE=1` (demo source injects synthetic `wind.true.*` directly), and
- `REPLAY=path/to/session.jsonl.gz` against any pre-2026 session captured when the masthead was alive.

Wind-free features (race timer, line geometry / DTL / TTL, VMC, OCS predictor) work today on the live boat with no caveats.

The pipeline degrades gracefully: predicates check for the presence of their inputs each tick and simply skip publishing if any are missing. The UI displays `—` for missing values; chart layers render nothing. No errors, no warnings — silence is the correct behaviour for a feature that needs an input it isn't getting.

## 2. Existing state

- **`Bus`** (`packages/core/src/bus.ts`): pub/sub used everywhere; pattern-matching subscribers. New `race.*` channels follow the existing dotted-name pattern.
- **`Channels`** (`packages/core/src/channels.ts`): canonical names. Currently has groups `Wind`, `Boat`, `Nav`, `Motion`, `Autopilot`, `Electrical`. This spec adds a `Race` group.
- **`ConfigStore`** (`packages/db/src/schema.ts`): every config table is `(id, value JSON)`. Pattern reused for the new `race_state` table.
- **`@g5000/compute/polars/math.ts`**: already has `interpolatePolarSpeed(polar, tws, twaAbs)`, `vmgFor(bsp, twa)`, `optimalTwaForVmg(polar, tws, 'upwind' | 'downwind')`. Sufficient primitives for TBS / TWA-target / %-polar / layline TWA selection without new polar code.
- **Active polar revision** (issue #1, recently merged): a single active polar revision per boat is queryable via the existing `polar_revisions` table and `getActivePolar()` accessor. The race pipeline depends on that resolver.
- **`@g5000/grib`**: `interpolateCurrentField(field, lat, lon)` exposes current u/v at a position. Used today by `<CurrentOverlay>` on the chart. Layline current integration reuses this.
- **`@g5000/compute/current/math.ts`**: helpers for composing through-water vectors with current vectors. Reused for layline projection.
- **`/api/waypoints`** + `marks-and-routes/page.tsx`: waypoint CRUD exists; the `activeMarkWaypointId` field on `RaceState` references a waypoint id from this table.
- **`<AudibleAlarm>`** (`packages/web/src/components/AudibleAlarm.tsx`): polls `/api/alarms` every 1.5 s and beeps based on severity. The race timer **does not** route through this — it needs sub-second precision at -3 / -2 / -1 / GO, which polling can't provide. A separate `<RaceAudible>` component drives its own oscillator from a local timer (see §4 "Audible timer").
- **`/api/stream`** SSE: how the UI receives bus updates. New `race.*` channels publish through the same SSE topic as everything else; no new transport.
- **No "active race" concept exists.** No race-state singleton, no race-timer state machine, no line ping endpoints. All new.

## 3. Files manifest

### Create

| File                                                | Purpose                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/race-state.ts`                   | `RaceState` interface + `RaceStateConfig` shape + `setSharedRaceState` / `getSharedRaceState` globalThis-singleton accessors. Mirrors the AlertsRegistry / AlarmsRegistry pattern.                                                                                                                                             |
| `packages/core/src/race-state.test.ts`              | Unit tests for state transitions (idle → pre-start → started → finished), line-ping mutations, settings merge.                                                                                                                                                                                                                 |
| `packages/compute/src/race/index.ts`                | `startRaceComputePipeline(bus, raceState, polarRef, currentFieldRef)` — boots all predicates, returns disposer.                                                                                                                                                                                                                |
| `packages/compute/src/race/line-geometry.ts`        | DTL (signed perp m), TTL (s at current SOG component), line bearing, line bias vs TWD. Pure functions.                                                                                                                                                                                                                         |
| `packages/compute/src/race/line-geometry.test.ts`   | Fixture inputs → expected outputs. Property tests via fast-check: DTL = 0 when on line; sign flips on crossing; TTL = DTL / (SOG · cos(α)).                                                                                                                                                                                    |
| `packages/compute/src/race/laylines.ts`             | `projectLayline(pos, twa, tws, polar, currentField, distanceNm, integrateCurrent)` → polyline. Subdivide projection into N segments (cap = 20); at each midpoint sample current via `interpolateCurrentField`, compose with through-water vector, accumulate.                                                                  |
| `packages/compute/src/race/laylines.test.ts`        | Tests with constant-current and zero-current fixtures; verify projection length ≈ requested NM; verify current bends the polyline as expected.                                                                                                                                                                                 |
| `packages/compute/src/race/vmc.ts`                  | `vmc(sog, cog, bearingToMark) = sog · cos(cog − bearing)`. Pure scalar; no wind input.                                                                                                                                                                                                                                         |
| `packages/compute/src/race/vmc.test.ts`             | Cases: heading directly at mark (vmc = sog), perpendicular (vmc = 0), reverse course (vmc = -sog), negative bearing wraparound.                                                                                                                                                                                                |
| `packages/compute/src/race/ocs-predictor.ts`        | `predictOcs(pos, cog, sog, line, startMs, lookAheadSec)` → boolean. Project boat forward by `lookAheadSec` along COG/SOG vector; return true if projected segment crosses the line before `startMs`. Degrade (return null) when SOG < 0.5 kn or COG-concentration < 0.7.                                                       |
| `packages/compute/src/race/ocs-predictor.test.ts`   | Crossing geometries, degradation thresholds.                                                                                                                                                                                                                                                                                   |
| `packages/compute/src/race/wind-shift.ts`           | Maintains two rolling-median TWD windows (5 min baseline, 30 s current). Publishes signed shift each sample; flags `windShift.event` channel when persistent (>60 s) shift exceeds `shiftThresholdDeg`. Rolling-median impl uses an indexed deque (existing `rolling-window` lib pattern from SOG/COG stats).                  |
| `packages/compute/src/race/wind-shift.test.ts`      | Fed scripted TWD streams; assert median values + event firing.                                                                                                                                                                                                                                                                 |
| `packages/compute/src/race/polar-targets.ts`        | Subscribes to `wind.true.{angle,speed}` and the active polar; publishes `race.targetSpeed` (TBS), `race.targetTwa` (via `optimalTwaForVmg`), `race.percentPolar` (BSP / TBS · 100).                                                                                                                                            |
| `packages/compute/src/race/polar-targets.test.ts`   | Fixture polar + wind → expected channel values.                                                                                                                                                                                                                                                                                |
| `packages/db/src/race-state.ts`                     | `RaceStateConfig` type + `loadRaceState` / `saveRaceState` / `mutateRaceState(fn)` ConfigStore helpers. Defaults file lives here.                                                                                                                                                                                              |
| `packages/db/src/race-state.test.ts`                | Round-trip persistence; default merge for missing settings keys.                                                                                                                                                                                                                                                               |
| `packages/web/src/app/race/page.tsx`                | New `/race` page. Layout: countdown clock (top), line-ping panel (middle), active-mark selector + settings (bottom).                                                                                                                                                                                                           |
| `packages/web/src/app/race/RaceTimer.tsx`           | Countdown clock client component. Big mm:ss display; **Sync to gun** / **+1 min** / **-1 min** / **Reset** buttons. State sourced from `RaceState.timer`.                                                                                                                                                                      |
| `packages/web/src/app/race/RaceAudible.tsx`         | Drives Web Audio API beeps off a local high-resolution timer keyed on `RaceState.timer.startMs`. Pattern: minute-boundary beep at -5/-4/-3/-2/-1 min, short beep at -30/-20/-10 s, sub-second 100 ms beeps at -5/-4/-3/-2/-1 s, longer GO beep at 0. Mute toggle local to this component, separate from the AudibleAlarm mute. |
| `packages/web/src/app/race/LinePingPanel.tsx`       | Two big buttons (Ping Port, Ping Stbd) + Clear Line (destructive, confirm modal). Shows current ping coords below each button.                                                                                                                                                                                                 |
| `packages/web/src/app/race/ActiveMarkSelector.tsx`  | Dropdown of waypoints from `/api/waypoints` + clear option. Writes to `RaceState.activeMarkWaypointId`.                                                                                                                                                                                                                        |
| `packages/web/src/app/api/race/state/route.ts`      | `GET` (full RaceStateConfig) / `PUT` (settings only — line + timer have dedicated endpoints to keep audit clean).                                                                                                                                                                                                              |
| `packages/web/src/app/api/race/line/route.ts`       | `POST {action: 'ping', end: 'port' \| 'stbd'}` (grabs current `nav.gps.position`) / `POST {action: 'clear'}`.                                                                                                                                                                                                                  |
| `packages/web/src/app/api/race/timer/route.ts`      | `POST {action: 'start', offsetSec?: number}` (sets startMs = now + offsetSec, default 300) / `POST {action: 'sync', adjustSec: number}` (shifts startMs by ±sec) / `POST {action: 'reset'}`.                                                                                                                                   |
| `packages/web/src/app/api/race/state/route.test.ts` | Endpoint smoke tests with a stub ConfigStore.                                                                                                                                                                                                                                                                                  |
| `packages/web/src/components/StartLineLayer.tsx`    | Chart layer: renders the start line as a segment between port and stbd pings; bias triangle from line midpoint pointing at favored end if `race.line.bias` is known.                                                                                                                                                           |
| `packages/web/src/components/LaylinesLayer.tsx`     | Chart layer: polyline overlays for port and starboard laylines from the boat position. SSE-driven.                                                                                                                                                                                                                             |
| `packages/web/src/components/RaceTiles.tsx`         | Compound helm tile: DTL / TTL / Bias / OCS / VMC. SSE-driven. Greys individual fields whose source channels haven't published.                                                                                                                                                                                                 |
| `packages/web/src/app/helm/RaceMiniTimer.tsx`       | Small countdown chip mounted on `/helm`. Read-only — no buttons. Polls the same `/api/race/state` GET endpoint at 1 Hz.                                                                                                                                                                                                        |
| `packages/web/src/components/WindShiftPlot.tsx`     | Rolling 30-min sparkline of signed shift vs baseline. Mounted on `/race` page initially; can be added to `/helm` later if useful.                                                                                                                                                                                              |
| `packages/web/src/components/WindShiftPlot.test.ts` | Renders with fixture data; verifies axis range.                                                                                                                                                                                                                                                                                |

### Modify

| File                                  | Change                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/channels.ts`       | Add `Race` group with `LineDistancePort`, `LineDistanceStbd`, `LineDistanceToLine`, `LineTimeToLine`, `LineBias`, `LineOcsPredicted`, `Vmc`, `TargetSpeed`, `TargetTwa`, `PercentPolar`, `WindShiftBias`, `WindShiftEvent`, `LaylinePort`, `LaylineStbd`.                                                                                                         |
| `packages/db/src/schema.ts`           | Add `race_state` JSON-blob table (single row, id = `'singleton'`).                                                                                                                                                                                                                                                                                                |
| `apps/autopilot-server/src/index.ts`  | After polar pipeline starts: instantiate `RaceState` singleton from `loadRaceState()`, register on globalThis, call `startRaceComputePipeline(...)`, stash disposer for graceful shutdown.                                                                                                                                                                        |
| `packages/web/src/app/helm/page.tsx`  | (a) Re-enable the hidden wind tile block (TWS, TWA, AWA, VMG) — but only render each tile when its channel publishes; the existing scalar/sample helpers already return `null` when absent so this is a removal of the conditional, not new rendering logic. (b) Mount `<RaceMiniTimer>` in the page header. (c) Mount `<RaceTiles>` near the bottom of the grid. |
| `packages/web/src/app/chart/page.tsx` | Mount `<StartLineLayer>` and `<LaylinesLayer>` between the existing `<CurrentOverlay>` and `<WaypointsLayer>` (so they render above current contours but under waypoints).                                                                                                                                                                                        |
| `packages/web/src/app/Navbar.tsx`     | Add `/race` link.                                                                                                                                                                                                                                                                                                                                                 |

### No change

- `packages/core/src/alerts.ts`, `packages/core/src/alarms.ts` — race countdown is NOT routed through the alarm system. Race timing is high-frequency and time-critical; alarms are low-frequency state. Different concerns, different transports.
- `@g5000/grib` interpolation API — already does what laylines need.
- `@g5000/compute/polars/math.ts` — primitives reused as-is.

## 4. Architecture

### Data flow

```
RaceState (globalThis singleton, persisted: race_state JSON blob)
  │
  └──► startRaceComputePipeline(bus, raceState, polarRef, currentFieldRef)
            │
            ├── line-geometry        ─ subscribes nav.gps.{position,cog,sog}
            │                          + reads RaceState.line
            │                          → publishes race.line.{distancePort, distanceStbd,
            │                                                  distanceToLine, timeToLine}
            │                          (+ race.line.bias when wind.true.direction present)
            │
            ├── ocs-predictor        ─ subscribes nav.gps.{position,cog,sog} + cog-stats
            │                          + reads RaceState.line + RaceState.timer.startMs
            │                          → publishes race.line.ocsPredicted
            │
            ├── vmc                  ─ subscribes nav.gps.{cog,sog,position}
            │                          + reads RaceState.activeMarkWaypointId
            │                          → publishes race.vmc
            │
            ├── polar-targets        ─ subscribes wind.true.{angle,speed}
            │                          + reads polarRef
            │                          → publishes race.{targetSpeed, targetTwa, percentPolar}
            │
            ├── wind-shift           ─ subscribes wind.true.direction
            │                          + reads RaceState.settings.shiftThresholdDeg
            │                          → publishes race.windShift.{bias, event}
            │
            └── laylines             ─ subscribes wind.true.{angle,speed,direction}
                                         + nav.gps.position
                                         + reads polarRef, currentFieldRef,
                                                 RaceState.settings.{laylineDistanceNm, integrateCurrent}
                                       → publishes race.laylines.{port, stbd}
                                       (rate-limited to 1 Hz)

Bus (race.*)  ──►  SSE /api/stream  ──►  RaceTiles / RaceMiniTimer / WindShiftPlot
                                          StartLineLayer / LaylinesLayer

User actions (mutations):
   /race page  ──►  POST /api/race/timer    ──►  RaceState.timer.* update + persist
                ──►  POST /api/race/line     ──►  RaceState.line.* update + persist
                ──►  PUT  /api/race/state    ──►  RaceState.settings update + persist
```

### Pipeline contract

Each predicate exports a single function:

```ts
export function startXxxPredicate(
  bus: Bus,
  raceState: RaceState,
  // optional refs depending on predicate
  polarRef?: { current: PolarTable | null },
  currentFieldRef?: { current: CurrentField | null },
): { dispose(): void };
```

The predicate subscribes to its input channels, on each sample reads the latest `raceState.*` fields and the polar / current refs, performs its computation, and publishes derived channels via `bus.publish(...)`. Missing inputs → skip the publish for that tick (do not publish stale or zero values; the UI distinguishes "no data" from "zero" and `bus.publish(undefined)` would be wrong).

Hot-reload: `RaceState` mutations (line ping, timer start, settings change) happen on the singleton object in place; predicates read the live values each tick so changes are picked up without restarting subscriptions. Same pattern as `AlarmsRegistry`'s `configRef`.

### RaceState lifecycle

```ts
type TimerState = 'idle' | 'pre-start' | 'started' | 'finished';

interface RaceStateConfig {
  timer: {
    startMs: number | null; // epoch ms of the gun
    state: TimerState;
  };
  line: {
    port?: { lat: number; lon: number; pingedAt: string }; // ISO
    stbd?: { lat: number; lon: number; pingedAt: string };
    /** 'port' or 'stbd' — which side of the line was the boat on when the
     *  second ping was taken; defines the sign of DTL going forward.
     *  Computed by the /api/race/line POST handler on second ping. */
    preStartSide?: 'port' | 'stbd';
  };
  activeMarkWaypointId?: string;
  settings: {
    shiftThresholdDeg: number; // default 7
    ocsLookAheadSec: number; // default 10
    laylineDistanceNm: number; // default 5
    integrateCurrent: boolean; // default true
  };
}
```

State transitions (driven by `/api/race/timer`):

```
idle ── start ──► pre-start ── (now >= startMs) ──► started ── (60 min elapsed) ──► finished
  ▲                  │                                  │
  └────── reset ─────┴───────────── reset ──────────────┘
```

Transition timestamps are driven by a 1 Hz interval inside `startRaceComputePipeline` (re-evaluates `RaceState.timer.state` based on `Date.now()` vs `startMs`). `pre-start → started` and `started → finished` happen automatically; `idle → pre-start` requires a user action; `→ idle` requires an explicit reset.

The 60-minute auto-`finished` window is a guard against forgotten state — most races end well inside that. After `finished`, line and active-mark are kept (you might immediately start another race on the same course); only `timer.startMs` is nulled.

### Line geometry

The start line is a great-circle segment between `line.port` and `line.stbd`. Conventions:

- **Line bearing** = initial-bearing from port to stbd, normalised to `[0, 360)` degrees.
- **Distance to line (DTL)** = signed perpendicular distance from boat to line. Positive = boat is on the pre-start side of the line. The "pre-start side" is determined at line-ping time as: the side the boat is currently on when both ends are pinged (assumption: you ping while approaching from the pre-start side). Stored on `RaceState.line.preStartSide` (computed on second ping). Sign flips when the boat crosses the line.
- **Time to line (TTL)** = `DTL / (SOG · cos(α))` where α is the angle between COG and the line normal. If `SOG · cos(α) <= 0` (boat moving away or parallel to line), TTL is `+Infinity` and the channel publishes `null`.
- **Line bias** = signed angle between line bearing and the perpendicular to TWD (so 0° = perfectly square line; positive = port end favored, negative = stbd end favored). Convention: positive bias means the port end is closer to the wind, so starting from port gains the most upwind progress on the first leg. Requires `wind.true.direction`; not published otherwise.
- **Distance to each end** is straight haversine — useful for the helm tile and as sanity-check for the user.

### Layline projection

`projectLayline(pos, twa, tws, polar, currentField, distanceNm, integrateCurrent)`:

1. Look up boat speed at `(tws, |twa|)` via `interpolatePolarSpeed`.
2. Convert TWD ± optimal-TWA into a heading. This is the through-water heading; if `integrateCurrent = false` we just project a great-circle from `pos` along this heading for `distanceNm` and return a two-point polyline.
3. If `integrateCurrent = true`:
   a. Subdivide the projection into `N = min(20, ceil(distanceNm / 0.25))` segments (so a 5-nm layline is 20 segments of 0.25 nm each).
   b. At each segment, sample `currentField` at the midpoint of the projected (no-current) segment. Compose the boat through-water vector with the current vector to get the boat-over-ground vector for that segment. Recompute the segment endpoint.
   c. Carry the new endpoint forward as the start of the next segment.
   d. Return the polyline of N+1 points.

Both upwind and downwind laylines are computed: port-tack layline uses optimal-TWA in the upwind direction projected on the port-of-wind side; stbd-tack mirrors. The "downwind" laylines (when sailing back from a windward mark) are not the v1 use case — the v1 race is a windward start — but the math primitive is symmetric; we'll wire the upwind pair in v1 and revisit downwind when the use case appears.

Recomputation rate: subscribe to `wind.true.*` and `nav.gps.position` and pass through RxJS `sampleTime(1000)` — at most once per second. Polar lookup + 20 current-grid samples + 20 vector composites is microseconds; the UI updates at this rate.

### OCS predictor

```ts
function predictOcs(
  pos: Position,
  cog: number, // radians
  sog: number, // m/s
  cogConcentration: number, // 0-1 from cog-stats
  line: LineConfig,
  startMs: number | null,
  lookAheadSec: number,
): boolean | null {
  if (startMs === null) return null;
  if (sog < 0.514) return null; // < 0.5 kn — too slow to predict
  if (cogConcentration < 0.7) return null; // COG too noisy
  if (!line.port || !line.stbd) return null;

  const secsUntilStart = (startMs - Date.now()) / 1000;
  if (secsUntilStart <= 0) return false; // race is on; not "OCS"
  if (secsUntilStart > lookAheadSec) return false; // can't predict that far

  // Project boat position forward by lookAheadSec at current vector.
  const projectedPos = projectGreatCircle(pos, cog, sog * lookAheadSec);
  // Did the segment (pos, projectedPos) cross the line segment (port, stbd)?
  return segmentsIntersect(pos, projectedPos, line.port, line.stbd);
}
```

Published as `race.line.ocsPredicted: boolean | null`. UI tile renders "OCS" in red when true, "OK" in green when false, dash when null.

### Wind-shift detector

Maintains two rolling-median windows over `wind.true.direction`:

- **Baseline:** 5-minute window. Updates on every sample. Slow-moving reference for "the wind we've been getting".
- **Current:** 30-second window. Fast follower.

On each `wind.true.direction` sample:

1. Insert into both windows.
2. Compute `shift = circularDiff(currentMedian, baselineMedian)`, normalised to `[-180, +180]` degrees. Signed: positive = TWD has shifted clockwise relative to baseline.
3. Publish `race.windShift.bias` = `shift` (continuous channel).
4. Track persistence: if `|shift| > shiftThresholdDeg`, increment a counter; if it stays above threshold for ≥60 seconds, publish a one-shot `race.windShift.event` with `{ direction: 'header' | 'lift', deg: shift }` keyed to the current tack. (Header / lift requires knowing your current tack; we infer tack from `boat.heading.true` vs `wind.true.direction`: starboard tack = wind coming over starboard side, i.e. `circularDiff(TWD − HDG)` is in `(0, π)` — equivalently TWD points to the boat's right of HDG. If heading is missing, fire the event as `{ direction: 'shift', deg: shift }` and let the UI render direction-agnostic.)

Rolling-median impl uses the same indexed-deque pattern as `apps/autopilot-server/src/cog-stats.ts` (which we proved against the 15-min COG average). For a 5-minute window of 2 Hz wind samples that's 600 elements — trivially fast.

### Audible timer

`<RaceAudible>` (mounted on `/race`) drives Web Audio API beeps off a local 100 ms `setInterval` that:

1. Reads `RaceState.timer.startMs` once per tick.
2. Computes `secsToGun = (startMs - Date.now()) / 1000`.
3. Checks if `secsToGun` has crossed any of the trigger thresholds since last tick.
4. For each crossed trigger, schedules an oscillator beep via the same warmed `AudioContext` pattern used by `<AudibleAlarm>`.

Trigger schedule:

| Threshold               | Tone                           |
| ----------------------- | ------------------------------ |
| 300 s (-5 min)          | 200 ms, 660 Hz square          |
| 240 s (-4 min)          | 200 ms, 660 Hz square          |
| 180 s (-3 min)          | 200 ms, 660 Hz square          |
| 120 s (-2 min)          | 200 ms, 660 Hz square          |
| 60 s (-1 min)           | 400 ms, 660 Hz square          |
| 30 s                    | 100 ms, 880 Hz sine            |
| 20 s                    | 100 ms, 880 Hz sine            |
| 10 s                    | 100 ms, 880 Hz sine            |
| 5 s, 4 s, 3 s, 2 s, 1 s | 80 ms, 880 Hz sine             |
| 0 s                     | 600 ms, 1320 Hz sine (the gun) |

Sub-second precision is achieved by running the timer at 100 ms cadence and recording last-fired thresholds — even if a tick skips slightly, we'll catch any threshold within ±100 ms (acceptable for race timing).

This is **separate from `<AudibleAlarm>`**:

- `<AudibleAlarm>` is mounted on `/helm`, polls `/api/alarms` every 1.5 s, beeps on safety alarms (MOB, anchor, shallow). Sub-second precision is irrelevant for safety alarms; polling is fine.
- `<RaceAudible>` is mounted on `/race`, runs from a local timer with no server polling, beeps on countdown thresholds. Sub-second precision is essential.

Two components, two mute toggles (in two different `localStorage` keys: `g5000.audible-alarm.muted` and `g5000.race-audible.muted`). Both are independently essential and should not silence each other.

### Active mark for VMC

`RaceState.activeMarkWaypointId` references a row in the `waypoints` table. The VMC predicate looks up the waypoint at boot and on each `RaceState` mutation; recomputes bearing from current position to mark each `nav.gps.position` sample; publishes `race.vmc = sog · cos(cog - bearing)`.

If `activeMarkWaypointId` is unset or the referenced waypoint doesn't exist, `race.vmc` is not published. The helm tile shows `—`.

Outside a race, the user typically wants this off (the helm has SOG already). Selector on `/race` includes a "None" option that clears the field.

### Persistence

Single new table:

```ts
// race_state — JSON-blob, same shape as other config tables.
// Single row, id = 'singleton'.
{
  id: 'singleton',
  value: RaceStateConfig  // full JSON of the type above
}
```

`loadRaceState()` returns a `RaceStateConfig` with defaults merged in for missing fields (so adding settings keys later doesn't break old persisted state).

On autopilot-server boot:

1. `loadRaceState()` from ConfigStore.
2. Check: if `timer.startMs !== null && now - startMs > 3600_000` (more than 1 h ago), reset `timer.state = 'idle'` and `timer.startMs = null`. Saves user from a stale race timer surviving from yesterday.
3. Construct `RaceState` singleton, register on globalThis.
4. Call `startRaceComputePipeline(...)`. The 1 Hz timer-state interval picks up immediately and transitions `pre-start → started` etc. as appropriate.

## 5. Test strategy

- **Unit (per math module):** `line-geometry`, `vmc`, `ocs-predictor`, `wind-shift`, `polar-targets`, `laylines`. Fixture-driven; property-tested via fast-check where geometry permits (e.g., line-geometry: DTL is zero on the line; sign flips on crossing; bias of perfectly-square line is zero regardless of TWD if line ⟂ TWD).
- **Unit (RaceState):** transition matrix; line-ping mutations; settings merge with defaults; serialise / deserialise round-trip.
- **Unit (RaceTimer / RaceAudible components):** use `vi.useFakeTimers()` to verify beep firings at exact millisecond offsets from a synthetic `startMs`. Mock `AudioContext`.
- **Integration (replay-driven):** a fixture session `.jsonl.gz` containing (a) synthesized position drift toward a known line geometry, (b) a wind-shift sequence, (c) a real-ish polar context. Boot the autopilot-server in `REPLAY=` mode with a pre-populated `race_state` (line pings + activeMarkWaypointId pre-set), assert that `race.*` channels publish expected values at expected sample boundaries.
- **API smoke (route.test.ts):** GET / POST / PUT each endpoint with a stub ConfigStore; verify response shape and side-effects on RaceState.

Coverage target: same bar as safety-alarms — every math module ≥90 % line coverage; every component has a render + basic-interaction test.

## 6. Out of scope

Deferred to follow-up issues:

- **Race series scoring / regatta management.** Per-race result entry, ratings, scoring systems. Big surface; not race-day. Could go in cluster H or its own issue.
- **Fleet positioning** via AIS-of-known-racers. Needs a "racer list" config + AIS MMSI filtering + chart-rendering of competitor track lines. Big spec; file as separate issue.
- **"Favored end" recommendations** beyond displaying the bias number (e.g., "tactical pin-end start recommended, hooked-into 5° lift, gain projected 12 boat lengths").
- **Polar-tuning during race** (in-flight polar calibration based on observed speed vs target). Cluster D territory.
- **Sail crossover overlay** — separate issue #3.
- **Per-race history log files** (JSONL of every race-tile state per sample) — would be nice for post-race review but requires a `/race/replay` UI to consume; defer to a "race debrief" issue.
- **Multi-helmsman / fleet account separation** — single-user app today; pretend the entire boat is one user.

## 7. Open questions

None — all design decisions resolved during brainstorming. Specifically:

- **Audible scope.** Separate `<RaceAudible>` on `/race`, not routed through `AudibleAlarm`. Different precision requirements.
- **Active mark sourcing.** `RaceState.activeMarkWaypointId` → reference to `waypoints` table. Avoids overloading a yet-to-exist "active plan" concept (deferred from safety-alarms spec).
- **Wind-shift algorithm.** Rolling median (5-min baseline vs 30-s current). Transparent and robust; no Kalman.
- **Layline current integration.** Optional via setting (`integrateCurrent: boolean`, default true). Off-by-default fallback gives a sanity comparison.
- **Recompute cadence for laylines.** RxJS `sample(1000ms)` — at most 1 Hz updates. Wind samples often come in at 2-5 Hz; rendering at 1 Hz is the right trade.
- **OCS lookhead.** Default 10 s; configurable in settings. 10 s is roughly the time it takes a 35-foot boat at 6 kn to cover its own length, so it's a useful "are you about to be early?" horizon without false-firing on every momentary surge.
- **Start state on restart.** Auto-clear `timer.startMs` if more than 1 h old; keep `line` and `activeMarkWaypointId`.

## 8. Risks

- **No wind sensor → live blank for half the features.** Mitigated by demo + replay verification end-to-end; UI displays `—` and chart layers stay empty. The race-day value on the live boat today is timer + line + VMC + OCS, which is still substantial. Wind-dependent features light up automatically when the masthead returns.
- **AudioContext autoplay policy.** Same risk as `<AudibleAlarm>`. Mitigated by warming the AudioContext on first user interaction with the `/race` page (the user pressing **Start Timer** is the gesture). Document in CLAUDE.md alongside the existing AudibleAlarm note.
- **Layline polyline cost** if `laylineDistanceNm` is cranked up (e.g., 50 nm) — the segment cap of 20 keeps per-segment length acceptable but at 50 nm each segment is 2.5 nm and the current-integration approximation degrades. Mitigation: settings UI caps `laylineDistanceNm` at 15 nm with a tooltip explaining why.
- **Wind-shift false positives during a tack.** A tack itself looks like a 180° shift in apparent wind, but TWD should be invariant under a tack. Reality: TWD jitters during a tack because of mast-flexion / instrument-lag. Mitigation: the 60-s persistence requirement masks any transient. We may also want to suppress shift events while `rate-of-turn > 5°/s`; deferred to a v1.1 tweak if v1 shows the false-positive rate is meaningful.
- **OCS predictor in light air.** Below 0.5 kn SOG, predictor returns null. Users in drifting conditions get no OCS prediction; the line-bias and DTL tiles still work. Acceptable trade — predicting a crossing 10 s out with 0.3-kn SOG is meaningless anyway.
- **Race-state persistence cross-contaminating boats.** If we ever support multiple boats per autopilot instance (`G5000_BOAT_ID`), `race_state` needs to be keyed by boat id. Today it's not — single-row table. Defer to whenever the multi-boat migration happens; same scope as the other config-table migrations called out in CLAUDE.md.

## 9. Success criteria

- Race timer fires audible beeps at all scheduled thresholds within ±150 ms of nominal (verified in vitest with fake timers).
- `/race` page lets the user start a 5-minute countdown, ping both line ends, select an active mark, and see line bias (in demo / replay only), DTL, TTL, OCS, and VMC update live.
- Chart shows the start line as a segment between the two pings; bias triangle (when wind present) points at the favored end.
- Chart shows port + stbd laylines (when wind + polar present) that bend visibly through current integration when run against a session with a non-zero current field.
- `/helm` re-shows the wind tiles (when wind present) and surfaces a mini countdown chip + the race tile group (DTL / TTL / Bias / OCS / VMC).
- Wind shift plot shows a 30-min sparkline; flagged events appear within 60 s ± 5 s of the underlying TWD sample crossing threshold.
- Full race state survives autopilot-server restart; resumes scoring within one sample of boot.
- All wind-free features (timer, DTL, TTL, VMC, OCS) work on the live boat with no wind sensor attached.
