# CHS tidal-current station predictions

**Date:** 2026-06-03
**Status:** design (approved in brainstorming)
**Builds on:** the `@g5000/tide` package (CHS client + `Station`). Adds tidal-current _predictions_ at CHS current stations. Heights/multi-source-tides are unaffected.

## Summary

Add **tidal-current predictions** (set & drift over time) for Canadian waters from the CHS IWLS API, as a self-contained **`/currents` planning page**. Pick a CHS current-prediction station, see drift (speed) over the next ~48 h with slack / max-flood / max-ebb events, set & drift "now", and the direction. CHS is open (no key). Point-based; no chart overlay, no bus, no ConfigStore.

This is distinct from the existing gridded Copernicus ocean-current chart overlay (`CurrentOverlay`) and the sensor-derived set/drift (`compute/current`) — a new `/currents` surface; nothing existing changes.

## Verified CHS shapes (live probe, 2026-06-03)

- `GET https://api-sine.dfo-mpo.gc.ca/api/v1/stations` → array; current-prediction stations are those whose `timeSeries` includes **both** `wcsp1` (speed) **and** `wcdp1` (direction). ~30 such stations (e.g. Big Bras d'Or `5cebf1e03d0f4a073c4bbeaa`, Calamity Point).
- `GET /stations/{id}/data?time-series-code=wcsp1&from={ISO}&to={ISO}` → quarter-hourly `{ eventDate (ISO Z), value, qcFlagCode, reviewed, timeSeriesId }`. `value` = current speed.
- `…time-series-code=wcdp1…` → same shape; `value` = current direction in **degrees true** (e.g. 54.0).
- `…time-series-code=wcp1-events…` → turning points `{ eventDate, value (speed), qualifier, … }` with `qualifier ∈ { SLACK, EXTREMA_FLOOD, EXTREMA_EBB }` (slack `value` = 0.0). Sample (Big Bras d'Or): `EXTREMA_EBB 3.5 @ 20:49`, `SLACK 0 @ 00:49`, `EXTREMA_FLOOD 2.3 @ 03:37`.
- `wcsp1` and `wcdp1` share identical `eventDate` timestamps (both quarter-hourly), so they zip 1:1.

**Units:** the metadata exposes no unit field. CHS publishes currents in **knots** (their current tables/atlases), and the probe values (~2–3.5 at known tidal gates) fit knots. So `value` for `wcsp1`/`wcp1-events` is treated as **knots**. Phase-0 (live, runnable) should sanity-check this; the parser keeps the raw value and the page labels "kn" — a correction is one line if CHS turns out to use m/s.

## Architecture

All new pure/fetch code lives in `@g5000/tide` (the CHS marine-data package; reuses the CHS-fetch idiom + the `Station` type, stays pure — parsers + `currentNow` are pure, fetchers use `fetch` with no key).

```
packages/tide/src/
  chs-currents.ts        parseChsCurrentSeries, parseChsCurrentEvents (pure) + chsListCurrentStations,
                         chsGetCurrentPredictions, chsGetCurrentEvents (fetchers, no key)
  current-prediction.ts  types + currentNow() + nextCurrentEvent() (pure)
  index.ts               export the above
packages/web/src/app/api/currents/
  stations/route.ts      GET → cached current-station list
  predictions/route.ts   GET ?stationId= → cached {predictions, events}
packages/web/src/app/currents/page.tsx   the planning page
```

**No** ConfigStore, **no** bus channels, **no** multi-source abstraction (CHS is the only open current-prediction API; Admiralty tidal diamonds aren't an API). Stateless: the page fetches stations + the selected station's predictions on demand; the routes cache per process.

## Types & pure logic (`current-prediction.ts`)

```ts
export interface CurrentPrediction {
  timeMs: number;
  speedKn: number;
  dirDeg: number;
} // drift, set(°true)
export type CurrentEventKind = 'slack' | 'flood' | 'ebb';
export interface CurrentEvent {
  timeMs: number;
  speedKn: number;
  kind: CurrentEventKind;
}

/** Interpolate set & drift at nowMs from the (ascending) prediction series.
 *  Linear speed; CIRCULAR direction (wrap-safe across 0/360). Null when no bracketing pair. */
export function currentNow(
  predictions: ReadonlyArray<CurrentPrediction>,
  nowMs: number,
): { speedKn: number; dirDeg: number } | null;

/** First current event strictly after nowMs, or null. */
export function nextCurrentEvent(
  events: ReadonlyArray<CurrentEvent>,
  nowMs: number,
): CurrentEvent | null;
```

Circular direction interpolation: convert both endpoints to unit vectors, lerp, `atan2` → degrees in [0,360). (Avoids the 350°→10° = 180° bug.)

## Parsers & fetchers (`chs-currents.ts`)

- `parseChsCurrentStations(json)`: keep stations with `timeSeries` containing **both** `wcsp1` and `wcdp1`; map `{id, officialName→name, latitude→lat, longitude→lon}`. Skips missing fields / non-array.
- `parseChsCurrentSeries(speedJson, dirJson)`: parse each `{eventDate,value}` array; **inner-join by `eventDate`** (keep only timestamps present in BOTH) → `CurrentPrediction[]` sorted ascending. Drops unmatched timestamps.
- `parseChsCurrentEvents(json)`: `{eventDate, value, qualifier}` → `CurrentEvent[]`: `SLACK→slack`, `EXTREMA_FLOOD→flood`, `EXTREMA_EBB→ebb` (skip unknown qualifiers), sorted ascending.
- `chsListCurrentStations()` → `GET /stations` → `parseChsCurrentStations`.
- `chsGetCurrentPredictions(stationId, hours)` → fetch `wcsp1` + `wcdp1` (from now to now+hours), `parseChsCurrentSeries`.
- `chsGetCurrentEvents(stationId, hours)` → fetch `wcp1-events`, `parseChsCurrentEvents`.
- All fetchers reuse a CHS `get` helper + throw `TideApiError` on `!ok` (no key). Default window 48 h.

## API routes (`/api/currents/*`, server-side, CHS open)

- `GET /api/currents/stations` → `{ ok: true, stations: Station[] }`. The `/stations` fetch is large (1570 entries); cache the filtered current-station list in a module-level variable with a ~1-week TTL.
- `GET /api/currents/predictions?stationId=…` → `{ ok: true, predictions: CurrentPrediction[], events: CurrentEvent[] }` over 48 h; cache per `(stationId, UTC day)` in a module `Map`. Missing `stationId` → 400; CHS fetch error → 502.

## `/currents` page

Client component, mirrors the `/tide` page idiom:

- **Station picker** — filter + select over the ~30 current stations (search by name).
- **Drift-over-time SVG graph** — speed (kn) vs time over 48 h, with a vertical **now** marker and `wcp1-events` overlaid as labelled markers (slack at troughs, max-flood/max-ebb at peaks).
- **Now readout** — `currentNow(predictions, Date.now())` → e.g. "Set 054° · Drift 2.6 kn · flooding" (phase = the kind of the surrounding events: between slack→max is building, after max is easing; simplest: label by the `nextCurrentEvent` kind — heading toward flood/ebb/slack). `"—"` when no bracketing pair.
- **Events table** — slack / max-flood / max-ebb times + speeds (the key tidal-gate planning info).
- Labels: knots (per the units note), °true, local times, "predictions · 48 h", and a one-line note that this is distinct from the chart's ocean-current overlay.
- Error/empty state if `/api/currents/stations` fails (CHS is open, so this is just an outage path).

## Testing (repo pure-logic vitest; real probe fixtures)

- `chs-currents.test.ts`:
  - `parseChsCurrentStations` — keeps `wcsp1`+`wcdp1` stations, skips others/bad-coords, `[]` for non-array.
  - `parseChsCurrentSeries` — inner-join by `eventDate` (matched → `{timeMs,speedKn,dirDeg}`; an unmatched timestamp in one series is dropped), sorted.
  - `parseChsCurrentEvents` — `SLACK/EXTREMA_FLOOD/EXTREMA_EBB → slack/flood/ebb`, slack speed 0, skip unknown, sorted.
- `current-prediction.test.ts`:
  - `currentNow` — linear speed interp; **circular direction** (350°,10° at the midpoint → 0°, not 180°); null when unbracketed/empty.
  - `nextCurrentEvent` — first future event; null when none.
- Page: `cd packages/web && npx tsc --noEmit` + `npm run build` (`/currents` in manifest); manual DEMO_MODE smoke recommended, not performed.

## Edge cases

- `wcsp1`/`wcdp1` timestamp misalignment → inner-join only (no NaN/holes).
- Direction wrap at 0/360 → circular interpolation.
- CHS 429/5xx → route 502; page shows error/retry.
- Sparse stations far from the boat → fine (planning page; user picks a station).
- Slack `value` 0 → `kind:'slack'`; the speed graph dips to 0 there.
- All times UTC; display local.

## Files (anticipated; the plan refines)

Create: `packages/tide/src/{chs-currents.ts, current-prediction.ts}` (+ tests), `packages/web/src/app/api/currents/{stations,predictions}/route.ts`, `packages/web/src/app/currents/page.tsx`. Modify: `packages/tide/src/index.ts` (exports). Unchanged: everything tide-heights/multi-source, the gridded `CurrentOverlay`, `compute/current`, ConfigStore, the bus.
