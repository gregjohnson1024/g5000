# Chart overlays for tide & tidal-current stations (graphical selection)

**Date:** 2026-06-03
**Status:** design (approved in brainstorming)
**Builds on:** the `/tide` (multi-source tide heights) and `/currents` (CHS tidal-current) features, their `/api/tide/*` and `/api/currents/*` routes, and the MapLibre chart at `packages/web/src/app/chart/`. Adds map markers so the user can find and select stations graphically instead of only via each page's dropdown picker.

## Summary

Overlay clickable icons for **tide stations** and **tidal-current stations** on the chart. Each is a toggle in the chart's Layers control (default **off**, persisted). Tapping a station opens an on-chart popup with a **live summary** (tide: height-now + next HW/LW; current: set/drift-now + next slack/max) and an **"Open" button** that deep-links into `/tide` or `/currents` with that station pre-selected. Dense tide stations are handled with MapLibre **clustering**.

Nothing about the existing tide/current pipelines, the gridded `CurrentOverlay`/`WindOverlay`, or the planning pages' core behavior changes — this is an additive chart surface plus a query-param entry point on the two pages.

## Verified chart architecture (explored 2026-06-03)

- **Renderer:** MapLibre GL. Main map wrapper `packages/web/src/components/Map.tsx`; chart page `packages/web/src/app/chart/page.tsx`.
- **Overlay pattern:** React components that own MapLibre GeoJSON **sources + layers** (not DOM canvas). `CurrentOverlay.tsx` / `WindOverlay.tsx` (grids), `AisTargets.tsx` / `WaypointsLayer.tsx` (discrete points).
- **Clickable points (canonical = `AisTargets.tsx`):** a `circle` layer + `map.on('click', LAYER_ID, handler)`; popups are DOM via `new maplibregl.Popup().setDOMContent(node).addTo(map)`; cursor swapped on `mouseenter`/`mouseleave`.
- **Projection:** MapLibre built-ins `map.project([lon,lat])` / `map.unproject([x,y])`; `map.getBounds()`/`getZoom()` for viewport.
- **Layers UI:** `packages/web/src/app/chart/LayersControl.tsx` — `LayersState` (`osm, enc, satellite, buoys, bathy, ais, aisCog, model`) persisted to localStorage `chart:layers` in `page.tsx`. New toggles slot into the "Misc" section.
- **Z-order:** markers added with `beforeId: '__above-wind__'` sit above the wind/current grids; waypoints/AIS are added without `beforeId` so they stay on top.
- **No glyphs URL in the style** — AIS/waypoint name labels are DOM `Marker`s, not symbol `text-field`. Custom **icon images** (`map.addImage`) need no glyphs; only `text-field` (e.g. a numeric cluster count) would. See "Clustering" for how this is handled.
- **Station APIs already exist:** `GET /api/tide/stations` → `{ ok, sources: { [sourceId]: Station[] } }`; `GET /api/currents/stations` → `{ ok, stations: Station[] }`. `Station = { id, name, lat, lon }`. Lists are server-cached. Summary data: `GET /api/tide/events?stationId=&source=` and `GET /api/currents/predictions?stationId=`.

## Architecture

One reusable, kind-parameterized overlay (the two station kinds are 90% identical), one pure summary module, two Layers toggles, and a query-param entry point on each page.

```
packages/web/src/components/
  StationsOverlay.tsx        kind='tide'|'current' MapLibre overlay: clustered source,
                             cluster + unclustered layers, tap→popup→deep-link
packages/web/src/lib/
  station-summary.ts         PURE: predictions/events → popup summary fields (+ tests)
packages/web/src/app/chart/
  LayersControl.tsx          + tideStations / currentStations toggles
  page.tsx                   + two booleans (localStorage), render two <StationsOverlay>
packages/web/src/app/tide/page.tsx       read ?source=&station= → pre-select
packages/web/src/app/currents/page.tsx   read ?station= → pre-select
```

### `StationsOverlay.tsx` (kind-parameterized)

- Props: `{ map: maplibregl.Map; kind: 'tide' | 'current'; visible: boolean }`.
- **Data:** when first made visible, fetch the kind's station list once (tide flattens `sources` into features carrying `sourceId`; current has no source). Build a GeoJSON `FeatureCollection` of `Point`s with properties `{ id, name, kind, sourceId? }`. Source created with `cluster: true`, a sensible `clusterRadius`/`clusterMaxZoom`.
- **Icons:** per-kind custom image registered via `map.addImage` from a small canvas drawn once — **tide = cyan droplet, current = magenta double-arrow** — so kinds are visually distinct and need no glyphs. Markers are **static** (no per-marker live data).
- **Layers** (ids namespaced by kind, e.g. `stations-tide-*`):
  - cluster `circle` layer (radius/colour stepped on `point_count`) filtered to `has 'point_count'`;
  - unclustered `symbol` layer (`icon-image` = the kind icon) filtered to `!has 'point_count'`.
- **Interaction:**
  - tap a cluster → `getClusterExpansionZoom` then `easeTo` the cluster centre (splits it);
  - tap a station → build the popup (below);
  - `mouseenter`/`mouseleave` swap the cursor (desktop niceness; harmless on touch).
- **Visibility:** `visible=false` sets all the kind's layers to `visibility:none` (kept, not destroyed) so toggling is instant after the first load. Cleanup removes layers/source/listeners on unmount.

### Popup (built on tap, DOM content)

- Immediately render the station **name** + a "loading…" line + the **Open** button (so the button is usable before data arrives).
- Fetch the kind's summary route for that station, run the response through `station-summary.ts`, then fill the summary line:
  - **tide:** `Height 2.3 m · next HW 14:02 (3.1 m)` (height-now from the same pure curve/snapshot helpers the `/tide` page uses; next event from the events list).
  - **current:** `Set 054° · Drift 2.6 kn · → Max flood 15:10` (`currentNow` + `nextCurrentEvent` from `@g5000/tide`, formatted as on the `/currents` page).
- **Open** button → `router.push`: tide `/tide?source=<sourceId>&station=<id>`, current `/currents?station=<id>`.
- Fetch failure → summary line shows "data unavailable"; the Open button still works.

### `station-summary.ts` (pure — the only new testable logic)

- `summarizeTide(events, nowMs)` → `{ heightNowM: number | null; next: { type: 'HW'|'LW'; timeMs: number; heightM: number } | null }`.
- `summarizeCurrent(predictions, events, nowMs)` → `{ now: { speedKn; dirDeg } | null; next: CurrentEvent | null }`.
- Built from the existing `@g5000/tide` pure helpers (current interpolation + next-event; tide curve/height-now/next-event); this module only composes + shapes them for the popup. No `process.env`, no fetch.

### Layers control + page wiring

- `LayersState` gains `tideStations?: boolean` and `currentStations?: boolean` (both default **off**; absent in old localStorage → off via `?? false`). Two `Row` toggles in the Misc section.
- `chart/page.tsx` holds the two booleans (same localStorage `chart:layers` it already persists) and renders `<StationsOverlay kind="tide" visible={layers.tideStations} .../>` and `kind="current"`.

### Page deep-link entry point

- `/tide` and `/currents` are client pages that currently default-select the first station. On mount they read the query params (`useSearchParams`): if `station` (and, for tide, `source`) is present **and** exists in the fetched list, pre-select it instead of the first; otherwise fall back to today's behaviour. No other page behaviour changes.

## Data flow

1. Toggle on → overlay fetches the station list once (server-cached) → clustered markers drawn. Toggle off → layers hidden (instant re-show later).
2. Tap station → popup opens immediately (name + Open) → summary route fetched for that one station → `station-summary.ts` → summary line filled.
3. Open → navigate to the planning page with the station pre-selected via query params.

## Error handling & edge cases

- Station-list fetch fails or empty (e.g. no `ADMIRALTY_TIDAL_API_KEY` on the Pi → no UK tide stations; CHS still lists Canadian ones) → that overlay renders nothing; toggling it on is harmless, no chart error UI.
- Popup summary fetch fails / empty events → "data unavailable", Open still works.
- Thousands of tide points → MapLibre GPU clustering; the only big payload is the one-time, already-cached list fetch.
- Deep-link `station`/`source` not found in the list → ignore, default-select (covers a stale link or a source unavailable on this deploy).
- Internet required at fetch time (CHS/Admiralty are remote); once fetched the list is cached server-side per process. Marker icons need no network.
- Times UTC internally, displayed local (matches the pages).

## Clustering & the glyphs constraint

- Clusters render as **stepped circle bubbles** (radius + colour by `point_count`) — no `text-field`, so no glyphs dependency. Density reads by bubble size; tap expands. If a glyphs URL is later added to the style, a numeric count label is a one-line add. (The plan verifies whether the style already has glyphs; the feature does not depend on it.)
- Cluster vs unclustered split via the standard `has 'point_count'` / `!has 'point_count'` layer filters.

## Testing

- **Pure (`station-summary.ts`)** — repo vitest convention:
  - `summarizeCurrent` — set/drift-now interp + next event; null when unbracketed/empty; circular-direction case (reuses tested `@g5000/tide` internals).
  - `summarizeTide` — height-now + next HW/LW from an alternating events series; null when empty; classifies next event type correctly.
- **Integration (MapLibre/React)** — not unit-testable here (node-env vitest, no React harness). Gate: `cd packages/web && npx tsc --noEmit` + `npm run build` (chart still builds; `/tide`/`/currents` accept the new params), plus whole-workspace `npx tsc -b` and `npx vitest run`. Manual DEMO/live smoke recommended (toggle each layer, tap a cluster to expand, tap a station, check popup summary + Open deep-link pre-selects) — recommended, not performed by subagents.

## Non-goals

- No live data baked into marker icons (no per-station fetch on render; would be far too heavy). Live data is popup-only, on tap.
- No new station data source; reuse the existing routes.
- No drag/edit of stations (they're read-only reference points, unlike waypoints).
- No numeric cluster labels unless the style already has glyphs (size/colour encoding instead).
- No change to tide/current computation, the gridded overlays, the bus, or ConfigStore.

## Files (anticipated; the plan refines)

Create: `packages/web/src/components/StationsOverlay.tsx`, `packages/web/src/lib/station-summary.ts` (+ test). Modify: `packages/web/src/app/chart/LayersControl.tsx`, `packages/web/src/app/chart/page.tsx`, `packages/web/src/app/tide/page.tsx`, `packages/web/src/app/currents/page.tsx`. Unchanged: the `/api/tide/*` and `/api/currents/*` routes, `@g5000/tide`, the gridded overlays, the bus, ConfigStore.
