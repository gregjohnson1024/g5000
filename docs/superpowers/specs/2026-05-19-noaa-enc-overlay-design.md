# NOAA ENC raster overlay on /chart

**Issue:** [#11](https://github.com/gregjohnson1024/g5000/issues/11) — Cluster E, sub-task E3 (v1, NCDS raster only).
**Status:** Approved, ready for plan.
**Date:** 2026-05-19.

## Summary

Render NOAA's NCDS paper-chart raster tiles as an opaque overlay on `/chart`. **Off by default.** Toggled by a single top-right button on the chart canvas — no popover, no multi-row layers panel. When on, NOAA covers the OSM basemap. When off, plain OSM. Tiles served through a same-origin proxy that caches PNGs to disk under `~/.g5000-router/enc-cache/`. The seamark overlay shipped in E2 is dropped from `/chart` in this work (the component file and proxy stay in the tree, just unmounted).

## Why

The OpenSeaMap seamark overlay (E2) was added on top of OSM but in practice has not been useful enough to keep on the chart. NOAA's NCDS raster service renders the full paper-chart look — depth soundings, contours, light arcs with characteristic, restricted areas, dredged channels, anchorages — and is the operational chart most US mariners are trained on. Public domain, no API key.

This spec is **v1** of E3. ECDIS S-52 symbology, click-to-identify, and offline-by-bbox preload are out of scope.

## Data source

**Upstream service:** `MarineChart_Services/NOAACharts/MapServer` on `gis.charttools.noaa.gov`.

**Upstream tile URL:** `https://gis.charttools.noaa.gov/arcgis/rest/services/MarineChart_Services/NOAACharts/MapServer/tile/{noaa_z}/{y}/{x}`

Three non-obvious traits, all verified by direct probe:

1. **ArcGIS row/col order**, not standard XYZ. The URL is `/tile/{z}/{y}/{x}`, not `/tile/{z}/{x}/{y}`.
2. **Non-standard zoom scale.** NOAA's `z=0` has resolution 39,135.76 m/px — exactly 1/4 the standard XYZ `z=0` (156,543.034 m/px). NOAA's tile grids are co-aligned with standard XYZ at the same resolution, so **`noaa_z = standard_xyz_z − 2`** with identical `(x, y)` values. NOAA covers `noaa_z = 0..16` ↔ `standard_xyz_z = 2..18`.
3. **US waters only.** Bermuda, the Bahamas, Canadian Maritimes return empty tiles. Acceptable for v1 — primary cruising area is US northeast.

## Architecture

### Same-origin tile proxy

New route handler at `packages/web/src/app/api/enc-tiles/[z]/[x]/[y]/route.ts`. Modeled on `/api/seamark-tiles` but with two translation steps:

- **Coord validation.** Same regex as the existing proxies (`z` 1–2 digits, `x`/`y` 1–7 digits, optional `.png` suffix on `y`).
- **Zoom clamp.** If parsed `z < 2` or `z > 18`, serve a tiny transparent 1×1 PNG (HTTP 200). NOAA doesn't cover those zooms, and a 200 with empty content keeps MapLibre's log quiet (404s produce noisy console warnings on every off-coverage tile).
- **Translate.** Compute `noaa_z = z - 2`. Compose upstream URL with `{y}` BEFORE `{x}`:
  `https://gis.charttools.noaa.gov/arcgis/rest/services/MarineChart_Services/NOAACharts/MapServer/tile/${noaa_z}/${y}/${x}`.
- **Cache** on disk at `${G5000_ROUTER_ROOT}/enc-cache/{z}/{x}/{y}.png`. Use the **standard XYZ** coordinates in the cache path — that way the cache key matches what MapLibre asks for, and we never need to recompute the offset on a cache hit.
- 30-day max-age, best-effort async write, transparent passthrough on disk-write failure — same policy as the existing tile/seamark proxies.
- Headers: `content-type: image/png`, `cache-control: public, max-age=2592000`, `x-cache: HIT | MISS | EMPTY` (the new `EMPTY` value identifies the synthesized transparent-clamp tile, useful for debugging).

### MapLibre integration

New component `packages/web/src/components/EncLayer.tsx`:

- Source id `noaa-enc`, type `raster`:
  - `tiles: ['/api/enc-tiles/{z}/{x}/{y}.png']`
  - `tileSize: 256`
  - `minzoom: 2`, `maxzoom: 18` (matches the upstream coverage; MapLibre will refrain from requesting tiles outside this band)
  - `attribution: 'NOAA / Office of Coast Survey'`
- Layer id `noaa-enc-layer`, type `raster`, source `noaa-enc`, inserted with `beforeId='__above-wind__'` (same sentinel pattern as seamarks).
- Same `isStyleLoaded`-free pattern shipped in the seamark fix (drop the gate, wrap addSource/addLayer in `try/catch`, use `styledata` as a retry signal).
- Visibility flipped via `setLayoutProperty` in a separate effect, same shape as `SeamarkLayer`.

### LayersControl rewrite

Replace `packages/web/src/app/chart/LayersControl.tsx` with a single rectangular toggle button — no popover, no row list:

- Anchored top-right of the chart canvas (`absolute top-2 right-2 z-10`).
- Label: `NOAA`.
- Visual state: filled background + light text when on; transparent background + light text border when off. Hover dims slightly.
- `aria-pressed={state.enc}` so screen readers announce on/off.
- Props: `{ state: LayersState; onToggle: (key: keyof LayersState) => void }` — kept identical to the prior popover signature so the chart-page wire-up is a one-line tweak, even though only one key (`enc`) is meaningful in v1.
- `LayersState` becomes `{ enc: boolean }`. The `seamarks` field is dropped from the interface.

### Chart-page wire-up

Three changes to `packages/web/src/app/chart/page.tsx`:

- Drop the `<SeamarkLayer map={mapInstance} visible={layers.seamarks} />` line.
- Update the localStorage initializer to the new shape:
  ```tsx
  const [layers, setLayers] = useState<LayersState>(() => {
    if (typeof window === 'undefined') return { enc: false };
    try {
      const raw = window.localStorage.getItem('chart:layers');
      if (!raw) return { enc: false };
      const parsed = JSON.parse(raw) as Partial<LayersState>;
      return { enc: parsed.enc ?? false };
    } catch {
      return { enc: false };
    }
  });
  ```
  Any pre-existing `{ seamarks: ... }` in localStorage is ignored on first read; the next write replaces it with `{ enc }`. No migration code needed.
- Mount `<EncLayer map={mapInstance} visible={layers.enc} />` next to the other layer components.

### What stays in the tree but unmounted

- `packages/web/src/components/SeamarkLayer.tsx`
- `packages/web/src/app/api/seamark-tiles/[z]/[x]/[y]/route.ts` and its test

Same low-touch revert pattern as the commented-out `<LaylinesLayer/>` line. No request will hit `/api/seamark-tiles` once the mount is removed; the proxy code costs nothing at runtime. Flipping the seamark layer back on is one line of JSX.

The unused `SeamarkLayer` import in `chart/page.tsx` is also removed (lint/tsc would flag it).

## File scope

| File | Action | Approx LOC |
|---|---|---|
| `packages/web/src/app/api/enc-tiles/[z]/[x]/[y]/route.ts` | new — XYZ→NOAA z+y/x translate, disk cache, transparent z-clamp | ~120 |
| `packages/web/src/app/api/enc-tiles/[z]/[x]/[y]/route.test.ts` | new — vitest covering MISS/HIT/EMPTY/bad coords | ~90 |
| `packages/web/src/components/EncLayer.tsx` | new — MapLibre source + raster layer, visibility prop | ~75 |
| `packages/web/src/app/chart/LayersControl.tsx` | rewrite — single button, no popover; LayersState = { enc } | ~60 (down from ~90) |
| `packages/web/src/app/chart/page.tsx` | modified — drop SeamarkLayer + import; update state; mount EncLayer | ~5 changed |

## Testing

### Automated

- Vitest for the new proxy:
  - z=15 cache miss → `fetch` called with `tile/13/{y}/{x}` (NOAA z-2, ArcGIS row/col); response 200 PNG with `x-cache: MISS`; tile written to `enc-cache/15/{x}/{y}.png` (standard XYZ coords in the cache path).
  - z=15 cache hit (pre-seeded) → no `fetch`; `x-cache: HIT`.
  - z=1 → 200 transparent 1×1 PNG, `x-cache: EMPTY`, no fetch.
  - z=20 → 200 transparent 1×1 PNG, `x-cache: EMPTY`, no fetch.
  - bad coords → 400.

### Manual

- Fresh profile, load `/chart`. NOAA button visible top-right, outlined (off). Map shows OSM basemap.
- Click NOAA button → filled. Map switches to NOAA chart rendering. Newport entrance shows soundings, lit buoys with characteristic, harbor limits.
- Refresh page → NOAA stays on (localStorage persists).
- Click NOAA again → outlined; OSM basemap returns.
- Pan to Bermuda → upstream returns empty tiles; the NOAA layer appears blank over Bermuda but does not break the rest of the chart.
- Check `~/.g5000-router/enc-cache/` populates with `{z}/{x}/{y}.png` files after browsing.

## Non-goals

- ECDIS S-52 symbology (dynamic-only upstream; would need a WMS bbox-to-tile shim, separate ticket).
- Click-to-identify (raster).
- Areas outside US waters (NOAA returns empty; this is acceptable for the current cruising area).
- Re-evaluating whether to delete the seamark code long-term — leave the files in place for now.
- Cache eviction / size cap — same policy as existing tile caches.

## Risk

Low. Same shape as the seamark shipper with two extra translation steps (zoom offset, ArcGIS y/x order) and one extra response variant (transparent z-clamp). Worst case: NOAA service is down → NOAA tiles fail to load → rest of chart unaffected → user toggles back to OSM.
