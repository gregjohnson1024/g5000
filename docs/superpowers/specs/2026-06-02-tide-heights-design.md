# UK tide heights — ADMIRALTY UK Tidal API integration

**Date:** 2026-06-02
**Status:** design (approved in brainstorming)
**Scope:** First of three UK/EU data integrations (tide heights). Tidal currents (Copernicus NWS) and Met Office DataHub weather are separate, later specs.

## Summary

Add astronomical **tide-height** data to g5000 from the **UKHO ADMIRALTY UK Tidal API** (free "Discovery" tier — 607 UK stations, today + 6 days), surfaced two ways:

1. **Ambient (bus):** a `TideService` publishes decomposed `tide.*` channels for the **active station** (nearest to the boat, or a manually pinned port), so tide height-now / next HW-LW appears as a `/helm` tile and a selectable mast tile — reusing the existing display surfaces.
2. **Planning (`/tide` page):** a tide table + height-vs-time curve for any selected UK port, with a pin/un-pin control.

The pure tidal math (curve interpolation, nearest-station, next-event, rising/falling/stand) lives in a new **`@g5000/tide`** package shared by both the bus service and the web page, so they compute identically. The Admiralty key is server-side only (`ADMIRALTY_TIDAL_API_KEY`); the feature is graceful-off when it's unset.

This spec covers tide **heights** only — not tidal streams/currents (a separate Copernicus NWS spec).

## Goals

- `TideService` on the RxJS bus publishing `tide.*` for the active station; helm tile + mast-selectable.
- A `/tide` planning page: station picker, 7-day HW/LW table, derived height curve, height-now marker, pin control.
- Active station = **nearest to `nav.gps.position`** (haversine, with hysteresis) unless a station is **pinned** (ConfigStore).
- One shared, unit-tested curve implementation used by both surfaces.
- Server-side key handling; quota-safe caching; graceful-off when unconfigured.

## Non-goals

- **No tidal streams / currents** — that is the Copernicus NWS spec (separate). `tide.state` here is a _height_ concept (rising/falling/stand), explicitly **not** current "slack".
- **No under-keel-clearance use.** The curve is an approximation (see below), not the Admiralty spring/neap curve-factor method; the UI labels it as such.
- **No paid tiers** in v1 — Discovery free tier only (7-day horizon). Foundation/Premium are out of scope.
- **No observed sea level** (NTSLF/BODC) — predictions only.
- No new React component-test harness (the web package has none; pure logic is unit-tested, JSX is build-verified).

## External dependency & Phase 0

- **Requires a free ADMIRALTY Discovery API key** (UKHO account registration — a user action). Stored as env var `ADMIRALTY_TIDAL_API_KEY`, read server-side only.
- **Phase 0 (live probe) is DEFERRED until the key exists.** The deep-research pass hit Azure HTTP 503s and reconstructed the endpoint shapes from search snippets + the gov.uk catalogue + third-party wrappers (PyPI `ukhotides`), so the shapes below are _documented-but-not-live-verified_. We therefore:
  - Build the Admiralty parser **isolated** (one module) and **fixture-tested**, so a real-shape correction is a one-file change.
  - Once the key is set, run one live call to `/Stations` and `/TidalEvents`, diff against the fixtures, adjust the parser if needed, and confirm the Discovery quota.

## Documented API shape (to verify in Phase 0)

- **Base:** `https://admiraltyapi.azure-api.net/uktidalapi/api/V1`
- **Auth:** header `Ocp-Apim-Subscription-Key: <ADMIRALTY_TIDAL_API_KEY>`
- `GET /Stations` → list of stations; each has an id, name, and coordinates (GeoJSON-style `geometry.coordinates [lon, lat]` per the documented shape). ~607 stations. **Static** — fetch once, cache ~weekly.
- `GET /Stations/{stationId}/TidalEvents?duration=N` (N = 1..7, default 7 = today + 6 days) → array of events: `EventType` (`"HighWater"|"LowWater"`), `DateTime` (ISO 8601, UTC), `Height` (metres above Chart Datum), plus `IsApproximateTime`/`IsApproximateHeight` booleans.
- Errors: 401 (bad key), 429 (quota), 503 (transient). Discovery quota reportedly ~10k calls/month (verify Phase 0).

## Architecture

```
packages/tide/                      NEW PACKAGE @g5000/tide (pure, unit-tested)
  src/types.ts                      Station, TidalEvent, TideState
  src/curve.ts                      interpolateHeight, heightNow, tideState
  src/nearest.ts                    nearestStation (haversine + hysteresis)
  src/next-event.ts                 nextEvent (first future HW/LW)
  src/index.ts                      barrel

apps/g5000/src/tide/
  admiralty-client.ts               server-side HTTP client (key from env); listStations, getTidalEvents
apps/g5000/src/tide-subsystem.ts    startTideSubsystem({bus,store}) — wired at boot like race/groove

packages/core/src/channels.ts       add Tide.* channel constants
packages/db/src/{defaults,schema,config-store}.ts   TideConfig (pinnedStationId, defaultStationId, station-list cache)

packages/web/src/app/api/tide/
  stations/route.ts                 GET cached station list
  events/route.ts                   GET cached events for a stationId
  active/route.ts                   GET active station + pin state
  pin/route.ts                      POST { stationId | null } → ConfigStore
packages/web/src/app/tide/page.tsx  the planning page
packages/web/src/app/.../mast/format.ts   teach formatter the new units
```

**Data flow:** N2K GPS → bus `nav.gps.position` → `TideService` nearest-station calc (hysteresis). Admiralty HTTP (daily, active station) → rolling events cache → interpolation tick (~30–60 s) → bus `tide.*` → helm tile + mast tile. The `/tide` page reads via `/api/tide/*` (server-side key, cached).

**Two decoupled cadences:** API fetch = **daily** per active station + station list **weekly**; bus publish = **interpolation tick every ~30–60 s** off cached events (no API call).

**Graceful-off:** if `ADMIRALTY_TIDAL_API_KEY` is unset, `TideService` logs once and publishes nothing; `/api/tide/*` returns a clear "tide API not configured" response; the page shows that state. Mirrors other optional features.

## Bus channels (decomposed — no compound values; registered in `Channels` → `knownChannelSet()` → mast-selectable)

| Channel                | Kind / unit | Meaning                                                                 |
| ---------------------- | ----------- | ----------------------------------------------------------------------- |
| `tide.station`         | enum        | Active station name                                                     |
| `tide.heightNow`       | scalar, m   | Height above Chart Datum now (suppressed/null when no bracketing pair)  |
| `tide.state`           | enum        | `rising` \| `falling` \| `stand` (height concept — NOT current "slack") |
| `tide.nextEventType`   | enum        | `HW` \| `LW`                                                            |
| `tide.nextEventInSec`  | scalar, s   | Countdown to next event                                                 |
| `tide.nextEventHeight` | scalar, m   | Height of next event (above CD)                                         |

## Curve math (`@g5000/tide/curve.ts`)

Piecewise cosine between **consecutive** events A→B (times `tA<tB`, heights `hA,hB`); uses each segment's _actual_ Δt because events are irregular (double-tide ports like the Solent especially):

```
interpolateHeight(tA,hA,tB,hB,t) = (hA+hB)/2 + (hA−hB)/2 · cos(π·(t−tA)/(tB−tA))   for tA ≤ t ≤ tB
```

Valid for HW→LW and LW→HW segments alike.

- `heightNow(events, nowMs)`: find the pair bracketing `now` (`tA ≤ now < tB`), interpolate. **Returns null when no bracketing pair exists.**
- `tideState(events, nowMs, standWindowMs=20*60_000)`: `rising` if `hB>hA`, `falling` if `hB<hA`; `stand` when `now` is within `standWindow` of either bracketing event (dh/dt≈0).

**Boundary case (must-handle):** `heightNow` needs the event _before_ `now`; a naive "today+6 d" fetch lacks it in the early hours. `TideService` keeps a **rolling cache that retains the most recent past event** across daily fetches. On cold start before any past event exists, `heightNow = null` until the first bracket forms.

**Honesty:** this is an **approximation**, not the Admiralty spring/neap curve-factor method. The page labels it "approximate — not for under-keel clearance."

## Station selection (`@g5000/tide/nearest.ts` + service)

- **Pinned** station (ConfigStore `tide.pinnedStationId`) takes precedence; set/cleared via the `/tide` page.
- Else **nearest**: `nearestStation(stations, pos)` = min haversine to `nav.gps.position`.
- **Hysteresis:** `nearestStation(stations, pos, current)` switches away from `current` only if a candidate is closer by ≥ `SWITCH_MARGIN_KM` (default 2 km); the service also re-evaluates at most every ~30 s / after the boat moves ≥ ~0.5 km, so GPS jitter at a Voronoi boundary doesn't flap the station (and thrash daily fetches).
- **No GPS:** fall back to `tide.defaultStationId` if set, else publish nothing.

## `/api/tide/*` routes (server-side key; cached; quota-safe)

- `GET /api/tide/stations` → cached station list `[{id,name,lat,lon}]`.
- `GET /api/tide/events?stationId=…` → cached per (station, day) events.
- `GET /api/tide/active` → `{ stationId, name, pinned: boolean }`.
- `POST /api/tide/pin` `{ stationId | null }` → set/clear `tide.pinnedStationId`.

Caching keeps the page's port-browsing and the service's daily fetch well under the Discovery quota.

## `/tide` page

Station picker (search the 607 list + a "nearest" shortcut using boat position); 7-day HW/LW table (times local, heights m above CD); SVG height curve (shared `curve.ts`) with a live "now" marker showing height-now + rising/falling/stand; pin/un-pin control showing current pin state. Labels: "heights above Chart Datum", "approximate curve — not for under-keel clearance", 7-day horizon note. Never requests `duration>7`.

## ConfigStore (`tideConfig`, single-row JSON like `grooveSettings`)

```ts
interface TideConfig {
  pinnedStationId: string | null; // null = nearest-auto
  defaultStationId: string | null; // no-GPS fallback
  stationsCache: { fetchedAtMs: number; stations: Station[] } | null; // weekly-refreshed static list
}
```

## Testing (repo's pure-logic vitest convention; clocks injected via a `nowMs` param)

- `@g5000/tide`:
  - `curve.test.ts` — `interpolateHeight` endpoints (`t=tA→hA`, `t=tB→hB`) and midpoint (`(hA+hB)/2`), HW-first & LW-first, irregular Δt; `heightNow` bracketing incl. no-bracket → null; `tideState` rising/falling/stand window.
  - `nearest.test.ts` — min haversine; hysteresis (no switch within margin, switch beyond margin); no-GPS path.
  - `next-event.test.ts` — first future event; across-day boundary; none-remaining → null.
- `admiralty-client` — parse test against a **Phase-0-captured fixture** (stations + events); 401/429/503 handling (throw/typed error, no crash).
- `TideService` — feed a cached event list + a fake `nowMs` → assert published `tide.*`; nearest switching with hysteresis on position updates; graceful-off when key unset (no channels).
- ConfigStore — `tideConfig` seed + round-trip persists across reopen (mirrors the groove settings test).
- Mast — `tide.*` present in `knownChannelSet()`; formatter renders m / countdown / enum (a `format.test.ts` case).
- JSX page — `tsc --noEmit` + `next build`; manual DEMO_MODE smoke (no component harness).

## Edge cases

- Key unset → graceful-off (channels suppressed; routes/page show "not configured").
- 429/503 → keep cached data, log, retry next cadence; page shows stale-with-timestamp.
- No GPS + no default → no active station; channels suppressed; page still usable via manual select.
- Station with no events in the window → `heightNow = null`.
- Double-tide ports → the actual-Δt piecewise curve handles irregular spacing.
- All API times are UTC ISO; display local; countdowns in seconds (UI formats).

## Files (anticipated; the plan refines)

Create: `packages/tide/*`, `apps/g5000/src/tide/admiralty-client.ts`, `apps/g5000/src/tide-subsystem.ts`, `packages/web/src/app/api/tide/{stations,events,active,pin}/route.ts`, `packages/web/src/app/tide/page.tsx`.
Modify: `packages/core/src/channels.ts` (Tide.\*), `packages/db/src/{defaults,schema,config-store}.ts` (TideConfig), `apps/g5000/src/index.ts` (start subsystem), the mast formatter, root `tsconfig`/composite refs + `apps/g5000` predev build list (add the new package — the "missing-package-from-tsc-b" foot-gun).
Out of scope: tidal currents, weather GRIB, paid tiers, observed sea level.
