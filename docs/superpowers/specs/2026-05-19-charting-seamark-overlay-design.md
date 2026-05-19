# OpenSeaMap seamark overlay on /chart

**Issue:** [#11](https://github.com/gregjohnson1024/g5000/issues/11) — Cluster E, sub-task E2.
**Status:** Approved, ready for plan.
**Date:** 2026-05-19.

## Summary

Render OpenSeaMap seamark raster tiles as a transparent overlay on `/chart`. On by default. Toggleable via a small layers popover anchored top-right of the chart canvas, designed to host future overlay toggles (ENC, ROI, etc.) without further structural change. State persisted in `localStorage`. Tiles served through a same-origin proxy that caches PNGs to disk under `~/.g5000-router/seamark-cache/`.

## Why

`/chart` currently shows OSM coastline polygon, AIS targets, range rings, route plan, current overlay, and the boat. There is no working chart underneath — no buoys, no lit aids, no harbour limits, no soundings. OSM coastline gives a shoreline only. ENC vector charts (sub-task E3) are the long-term answer but are weeks of work (S-57 → MVT pipeline, styling, tile serving). The OpenSeaMap raster `seamark` overlay is a one-day fix that adds the operational chart layer mariners actually need: buoys with light characteristic, harbour limits, restricted areas, anchorages, depth contours.

This spec covers sub-task **E2** only. Sub-task E1 (picture-in-picture) was dropped from the cluster. Sub-task E3 (ENC) is deferred.

## Data source

**Upstream:** `https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png`

- PNG raster, transparent background, designed as an overlay.
- CC-BY-SA. Attribution shown via MapLibre's default attribution control.
- No auth, no API key.
- Zoom range 0–18. Detail starts at zoom ~10; lower zoom returns mostly empty tiles.

## Architecture

### Same-origin tile proxy

New route handler at `packages/web/src/app/api/seamark-tiles/[z]/[x]/[y]/route.ts`, modeled directly on the existing `packages/web/src/app/api/tiles/[z]/[x]/[y]/route.ts`:

- Upstream URL: `https://tiles.openseamap.org/seamark/${z}/${x}/${y}.png`.
- Cache location: `${G5000_ROUTER_ROOT}/seamark-cache/{z}/{x}/{y}.png`. Default root `~/.g5000-router/seamark-cache/`.
- Behaviour:
  - First request for a `(z, x, y)`: fetch upstream, write atomically to disk, stream response.
  - Subsequent requests: stream from disk, no upstream call.
  - Non-200 upstream responses are **not** cached. The route returns the upstream status to the client unchanged. (Matches existing OSM proxy.)
  - Filesystem errors are logged and the route falls back to a transparent pass-through fetch.
- No eviction / size cap. Cache is bounded by what the user has browsed. Same policy as the existing OSM proxy.

### MapLibre integration

In `packages/web/src/app/chart/page.tsx`:

- Add source `osm-seamark`:
  ```
  type: 'raster',
  tiles: ['/api/seamark-tiles/{z}/{x}/{y}'],
  tileSize: 256,
  attribution: '© OpenSeaMap (CC-BY-SA)',
  ```
- Add layer `osm-seamark-layer` of type `raster`, inserted with a `beforeId` chosen so it sits **above** the coastline polygon and **below** AIS targets, route plan, and range rings. Concretely: place above the existing coastline layer id, before whichever layer currently anchors the AIS/route group.
- Visibility driven by React state via `map.setLayoutProperty('osm-seamark-layer', 'visibility', visible ? 'visible' : 'none')`. Layer is always added; visibility flips by attribute.

### Layers popover

New component at `packages/web/src/app/chart/LayersControl.tsx`:

- Anchored top-right of the map canvas (absolute-positioned div over the MapLibre container).
- Trigger: a small square button with a "stacked layers" glyph.
- Behaviour: click opens a popover (~140 px wide) with a vertical list of labelled checkboxes.
- v1 has one row: **Seamarks**.
- Click-outside or button-toggle dismisses.
- Props: `state: LayersState`, `onToggle: (key: keyof LayersState) => void`, where `LayersState` is an interface exported from the same file (v1: `{ seamarks: boolean }`). Caller owns state.
- Designed to accept additional rows later by extending an internal config array — no structural changes needed for E3 (ENC), ROI overlay, current overlay toggle, etc.

### Persistence

- localStorage key: `chart:layers`.
- Value shape: `{ seamarks: boolean }` (object, not bare boolean — extensible without migration).
- Read on mount. If key absent or unparseable, default to `{ seamarks: true }` (on by default for new installs).
- Write on every toggle.
- Existing chart localStorage keys (`chart:camera`, `chart:settings`, `chart:planState`) are unchanged.

### Component split

- `LayersControl.tsx` is its own file rather than inlined in `page.tsx`. `page.tsx` is already 1033 lines; keeping new UI in its own ~80-line module avoids further bloat and matches the project's pattern of small, focused components (cf. existing `<RangeRingsLayer/>`-style helpers).

## File scope

| File | Action | Approx LOC |
|---|---|---|
| `packages/web/src/app/api/seamark-tiles/[z]/[x]/[y]/route.ts` | new | ~80 |
| `packages/web/src/app/api/seamark-tiles/[z]/[x]/[y]/route.test.ts` | new — written from scratch; the OSM proxy has no existing test to mirror | ~60 |
| `packages/web/src/app/chart/LayersControl.tsx` | new | ~80 |
| `packages/web/src/app/chart/page.tsx` | modified — add source/layer, mount `<LayersControl/>`, wire localStorage | ~30 added |

No package boundary changes. No new dependencies. No schema or config-DB changes. No bus channels. No compute. No backend autopilot-server work.

## Testing

### Automated

- Vitest for `seamark-tiles/route.ts`:
  - First-call path: mock global `fetch` to return a PNG buffer, assert the route returns the buffer and writes to the cache directory.
  - Cached path: pre-seed the cache directory with a known PNG, assert the route streams from disk and does **not** call `fetch`.
  - Non-200 upstream: route returns the upstream status; cache file is not written.
- (Skip a React-level test for the popover; mounting MapLibre in JSDOM is more pain than the test is worth. Manual verification covers it.)

### Manual

1. Fresh profile (clear `chart:layers` localStorage). Load `/chart`. Confirm seamarks visible without toggling.
2. Open layers popover. Toggle Seamarks off. Refresh. Confirm still off.
3. Toggle back on. Pan/zoom around Newport harbour (zoom 13+). Confirm lit buoys and harbour limits render.
4. Check `~/.g5000-router/seamark-cache/` after browsing — expect `.png` files appearing under `{z}/{x}/{y}` paths.
5. Offline test: warm the cache on shore wifi, kill the network, reload `/chart`. Confirm cached seamarks still render.
6. Z-order sanity: confirm AIS targets, route plan, and range rings draw **above** seamarks; coastline polygon draws **below**.

## Non-goals (deferred)

- Click-to-identify (tap a buoy → name + light characteristic). Raster doesn't carry attributes. Requires Overpass / vector source. Defer to a separate ticket — does not block this work.
- Filter by seamark type (just buoys, just lights). Same reason — raster.
- Cache eviction / size cap. Existing OSM proxy doesn't evict either; add later if disk fills.
- ENC vector charts (E3) — separate sub-ticket, but the layers popover is built to host it.

## Risk

Low. New endpoint is a near-clone of one running in production. Layer is one transparent raster overlay. No bus traffic, no DB, no compute. Worst case: upstream tile server unreachable → blank seamarks → rest of chart unaffected.
