# Satellite imagery layer — design

**Date:** 2026-05-23
**Status:** Design (awaiting review)
**Branch:** `worktree-satellite-layer` (branched from `origin/main`; rebase onto `develop` before PR)

## Goal

Add a satellite/aerial imagery raster overlay to the chart page (`/chart`), in the
same shape as the existing NOAA ENC overlay: a same-origin disk-caching tile proxy
plus a thin MapLibre raster layer plus a toggle in `LayersControl`. Unlike NOAA
(US-only), the imagery is **global**, so the supporting cache tooling is built to
**accumulate coverage over time** rather than seed a fixed set of US harbors.

## Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Imagery source | **Esri World Imagery** (keyless ArcGIS tiles) | Global, sharp to ~z19, no API key, standard XYZ. Verified keyless `image/jpeg` 200 at z10 and z17 on 2026-05-23. |
| Why a proxy (not direct upstream) | Same-origin disk-caching proxy | Offshore has no internet → tiles must be pre-warmed and served from disk. Also avoids leaking boat position to Esri on every pan. |
| Layer model | Independent toggle; satellite wins z-order over NOAA when both on | User accepts the both-on overlap; satellite is opaque and sits just under the annotation sentinel. |
| Primary use | Harbor/anchorage detail (z~18–19), cached for offline | Docks, moorings, breakwaters, shoals. |
| Cache growth | Growable region list + global low-zoom base + disk-budget guard | Curated breadth at low zoom, targeted depth where it matters, never silently fill the SD card. |
| Global base depth | z0–7 (~22k tiles, a few hundred MB) | Worldwide context everywhere; regions add depth on top. |
| Disk cap | 8 GB, no auto-delete | Tailored to the Pi (29 GB card, 14 GB free, whole router cache is 457 MB today). Leaves the card ~76% full when full; eviction only on explicit prune. |
| Prune interface | Admin UI on `/settings` **and** CLI, sharing one lib | UI for at-the-helm cache management; CLI for headless/ssh. Single prune implementation. |
| "Unused" definition | Tiles not **viewed** in N days (LRU by mtime) | Proxy bumps tile mtime on each disk HIT, so mtime = last-served time; prune evicts least-recently-viewed. |

## Licensing caveat (read before relying on the offline cache)

Esri's ArcGIS Online basemap terms restrict **bulk/persistent caching** without an
appropriate paid license. Small-scale personal pre-warming of a few harbor/coastal
bounding boxes (and a low-zoom global base) is well below the threshold of typical
enforcement, but it is **not explicitly licensed**.

Mitigation is architectural: the proxy is **source-agnostic**. The Esri URL lives in
exactly one place (the `sat-tiles` route's upstream template, mirrored in the seed
script). Swapping to **Sentinel-2 cloudless / EOX** — which *is* openly licensed for
caching and redistribution — is a one-line upstream-URL change, with no change to the
layer component, the `LayersControl` row, the cache layout, or the seed scripts. EOX
trades resolution (~10 m, cloud-free composite) for an unambiguous license; it is the
documented fallback if Esri usage ever becomes a problem.

## Architecture

Mirrors the NOAA ENC overlay (`docs/superpowers/specs/2026-05-19-noaa-enc-overlay-design.md`)
at every layer. Data flow:

```
sat-seed.ts (pre-warm) ─┐
                        ├─► ~/.g5000-router/sat-cache/{z}/{x}/{y}.jpg
MapLibre raster source ─┤        ▲
  /api/sat-tiles/...  ──┘        │ (disk HIT)
                                 │
        /api/sat-tiles route ────┘ on MISS → fetch Esri, write disk, stream
```

### Upstream tile scheme (Esri World Imagery)

```
https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}
```

- **ArcGIS row/col order**: `y` (row) **before** `x` (col) in the path. Same as NOAA.
- **No zoom offset.** Esri World Imagery uses standard web-mercator zoom directly
  (`{z}` as-is), unlike NOAA's `noaa_z = std_z − 2`.
- **Content type is `image/jpeg`**, not PNG.
- Global coverage; sharp to ~z19 worldwide (z23 in some metros).

## Components

### 1. NEW — `packages/web/src/app/api/sat-tiles/[z]/[x]/[y]/route.ts`

Near-clone of `enc-tiles/[z]/[x]/[y]/route.ts`. Differences:

- Upstream URL per the scheme above; **no `−2` offset**.
- `MIN_Z = 0`, `MAX_Z = 19`. Below/above the band → MapLibre's source `minzoom`/`maxzoom`
  handles it (overzoom past 19); the route still guards coords.
- **Content-type passthrough**: serve the upstream `content-type` (`image/jpeg`) for
  real tiles. The error/timeout fallback stays the 67-byte transparent **PNG** (MapLibre
  decodes each tile by its own content-type, so a mixed-format fallback is fine).
- Disk path: `${G5000_ROUTER_ROOT}/sat-cache/{z}/{x}/{y}.jpg`. Coord-validation regex
  accepts an optional `.jpg` suffix on `y` (mirrors enc-tiles' `.png` handling); strip
  and re-add `.jpg` for the disk path.
- Same `x-cache: HIT|MISS|EMPTY|TIMEOUT|UPSTREAM-5XX` semantics,
  `access-control-allow-origin: *`, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.
- `User-Agent: g5000-marine-router/1.0 (https://g5000.sulabassana.net)`.
- **Freshness TTL = 365 days** (not NOAA's 30). Satellite imagery is effectively
  static and offshore can't refetch, so a long TTL avoids treating good cached tiles
  as stale.
- **Bump mtime on disk HIT** (best-effort, fire-and-forget `utimes`): makes a tile's
  mtime its *last-served* time, so the prune guard's "unused" = "not viewed recently"
  (true LRU). A frequently-viewed tile never expires; an unviewed tile keeps its
  original fetch time and becomes a prune candidate. Do not block the response on the
  `utimes` write.

### 2. NEW — `packages/web/src/components/SatelliteLayer.tsx`

Clone of `EncLayer.tsx`:

- `SOURCE_ID = 'esri-satellite'`, `LAYER_ID = 'esri-satellite-layer'`.
- Raster source: `tiles: ['/api/sat-tiles/{z}/{x}/{y}']`, `tileSize: 256`,
  `minzoom: 0`, `maxzoom: 19`, `attribution: 'Esri, Maxar, Earthstar Geographics'`.
- Added with `beforeId: '__above-wind__'` so it stays below the annotation sentinel.
- Same `ensure()` + `map.on('styledata', ensure)` retry pattern; do **not** gate on
  `map.isStyleLoaded()`; wrap in `try/catch`.
- Visibility flipped from the `visible` prop via `setLayoutProperty`.
- Export `refreshSatTiles(map)` mirroring `refreshEncTiles` (cache-busting `?v=` param).

### 3. EDIT — `packages/web/src/app/chart/LayersControl.tsx`

- Add `satellite: boolean` to `LayersState`.
- Add a `<Row label="Satellite" pressed={state.satellite} onClick={() => onToggle('satellite')} />`.
- Include `state.satellite` in the `onCount` tally.
- Add an optional `onRefreshSatellite?: () => void` prop and a `↻ Refresh satellite tiles`
  button gated on `onRefreshSatellite && state.satellite` (mirrors the NOAA refresh button).
- It is already a popover (rows: OSM / NOAA / Buoys / Tile-grid); no structural rework.

### 4. EDIT — `packages/web/src/app/chart/page.tsx`

- Add `satellite: false` to the default `LayersState` and to the `chart:layers`
  hydration parse (`satellite: parsed.satellite ?? false`).
- Mount `<SatelliteLayer map={mapInstance} visible={layers.satellite} />`
  **immediately after `<EncLayer …/>`** (see Z-order below).
- Wire `onRefreshSatellite={() => refreshSatTiles(mapInstance)}` into `<LayersControl>`.

### Z-order (subtle — document and preserve)

Both `EncLayer` and `SatelliteLayer` insert with `beforeId='__above-wind__'`. Final
stacking is decided by **JSX mount order**: rendering `<EncLayer>` then `<SatelliteLayer>`
makes satellite insert directly under the sentinel, **on top of NOAA**, below all
annotations (AIS, route, range rings, boat marker). This matches "satellite wins when
both on." **Do not reorder these two components** without re-checking the stack.

## Cache tooling

All scripts write into the single `~/.g5000-router/sat-cache/{z}/{x}/{y}.jpg` layout the
proxy reads, and are idempotent (skip tiles fresh within the proxy's 365-day TTL,
resumable on Ctrl-C).

### `scripts/sat-seed.ts`

Subcommands:

- **`regions`** — reads `~/.g5000-router/sat-seed-regions.json`:
  ```json
  [
    { "name": "Bermuda",        "bbox": [-64.95, 32.20, -64.60, 32.45], "maxZoom": 17 },
    { "name": "Narragansett-Bay","bbox": [-71.45, 41.45, -71.20, 41.75], "maxZoom": 18 }
  ]
  ```
  Seeds each region `MIN_Z..region.maxZoom`. If the file is absent on first run, write
  this starter file (current cruising area pre-filled) and exit with a message telling
  the user to edit and rerun. Growth = append entries, rerun.
- **`global`** — worldwide base, default `--max-zoom=7` (~22k tiles), **hardcapped at z9**
  to prevent an accidental multi-million-tile sweep.

Shared flags: `--concurrency` (default 8), `--max-zoom` override. Reuses the
`lonToTileX`/`latToTileY`/`tilesForBbox`/`runPool` helpers from `prewarm-noaa-tiles.ts`
(copy, not import — the NOAA script is standalone; keep `sat-seed.ts` standalone too).
Differences from the NOAA prewarm: no `−2` offset; stores `.jpg`; `image/jpeg` upstream;
**budget guard** (below).

### NEW — `packages/web/src/lib/sat-cache.ts` (shared core)

The single source of truth for cache stats and pruning, imported by both the admin API
routes and the CLI. No duplication of the risky eviction logic.

- `CAP_BYTES = 8 * 1024 ** 3` (8 GB), `PROTECT_MAX_ZOOM = 8`.
- `readCacheStats(root)` → `{ totalBytes, tileCount, capBytes, byZoom: { [z]: { bytes, tiles } } }`.
  Walks `sat-cache/`; top-level dir name = zoom level.
- `pruneCache(root, { maxBytes?, olderThanDays? })` → `{ removedTiles, removedBytes, totalBytesAfter }`.
  Candidate set = tiles at **z > `PROTECT_MAX_ZOOM`** (never evict the global/regional
  base). If `olderThanDays` is set, evict candidates whose mtime is older than that
  threshold ("unused"). Otherwise evict oldest-mtime candidates until `totalBytes ≤ maxBytes`.
  Both modes can combine. Deletes only when called.

### `scripts/sat-cache.ts` (CLI)

Thin wrapper over the shared lib for headless/ssh use:

- **`report`** — prints `readCacheStats` (total, cap, by-zoom). Warns when total is over /
  within 10% of the cap. (No per-region breakdown: the cache is keyed by tile, not region;
  reverse-mapping every tile to a bbox is not worth the cost.)
- **`prune [--max-gb=N] [--older-than-days=N]`** — calls `pruneCache`. Default `--max-gb=8`.

> Import note: the CLI imports the lib by relative path; `npx tsx` resolves TS across the
> repo. If that proves awkward at build time, the fallback is to keep the lib in
> `packages/web` and have the CLI shell out to the API — but direct import is preferred.

### NEW — admin API (backs the UI)

- **`GET /api/sat-cache`** → `readCacheStats(ROOT/sat-cache)`. Cheap; the settings page
  fetches it on load and after a prune.
- **`POST /api/sat-cache/prune`** with `{ maxGb?: number, olderThanDays?: number }` →
  `pruneCache(...)`, returns the removal summary. `runtime = 'nodejs'`.

### NEW — admin UI (section in `packages/web/src/app/settings/page.tsx`)

A "Satellite tile cache" panel alongside the existing source-mode / forecast-bbox /
SocketCAN sections:

- **Usage readout**: total size vs the 8 GB cap as a small progress bar, plus the
  per-zoom breakdown (z, size, tile count) from `GET /api/sat-cache`.
- **Prune unused tiles**: a number input "remove tiles not viewed in ___ days" (default
  90) and a **Prune** button → `POST /api/sat-cache/prune { olderThanDays }`. On success,
  show "Freed N MB (M tiles)" and refresh the readout.
- **Prune to cap**: a secondary button shown only when over budget →
  `POST /api/sat-cache/prune { maxGb: 8 }`.
- Follows the page's existing busy/status/error state pattern; never auto-runs — every
  deletion is an explicit button press.

### Budget enforcement without deletion

`sat-seed.ts` checks cache size (via `readCacheStats`) before each zoom level; if it would
cross the 8 GB cap it **stops and instructs** the user to prune (UI or CLI) or pass
`--max-gb` to override. Seeding never deletes. This lets the cache "grow slowly" while
guaranteeing the SD card is never silently filled.

## Testing

- **Unit-test `sat-tiles` route** (`route.test.ts`): coord-validation (good/bad z/x/y,
  optional `.jpg`), disk HIT path, MISS→fetch→write (mock `fetch`), error/timeout →
  transparent-PNG fallback, content-type passthrough for a JPEG tile, and **mtime bump on
  HIT** (assert the file's mtime advances after a served HIT). (No existing enc-tiles route
  test — this is net-new and worth having as the proxy is the riskiest piece.)
- **Unit-test `lib/sat-cache.ts`** against a temp cache dir with crafted files/mtimes:
  `readCacheStats` totals and per-zoom rollup; `pruneCache` (a) never deletes z ≤ 8,
  (b) `olderThanDays` removes only stale-mtime tiles, (c) `maxBytes` evicts oldest-first
  until under budget. This is the riskiest logic (it deletes files) — cover it well.
- **Admin API**: a small route test for `POST /api/sat-cache/prune` delegating to the lib
  (mock the lib, assert it's called with the parsed body).
- **`SatelliteLayer`** and the **settings UI panel**: no unit test (MapLibre / page-level
  React are hard to unit-test, matching `EncLayer`'s convention). Verified manually
  in-browser: toggle satellite on, imagery renders, z-order vs NOAA correct, offline serve
  after seeding; settings panel shows usage and a prune frees space.
- **Scripts**: smoke-run `sat-seed global --max-zoom=3` (tiny) and `sat-cache report`
  against a temp cache root.
- Existing baseline failures (coastline, ConfigStore route tests, GRIB integration) are
  unaffected.

## Out of scope

- Track/route corridor auto-seeding (considered, deferred).
- Per-region cache-size reporting.
- A systemd timer for periodic prune (manual for now; could mirror
  `g5000-forecast-refresh.timer` later).
- Sentinel-2/EOX integration (documented as the fallback source; not built now).

## Deployment notes

- New runtime route (`/api/sat-tiles`) ships inside `packages/web` — no new package, so
  the `tsc -b` rebuild chain is unchanged.
- `serverExternalPackages` in `next.config.ts` is unaffected.
- Rebase `worktree-satellite-layer` onto `develop` before opening the PR (worktree was
  cut from `origin/main`, which is behind `develop`'s boat-state work; no chart-code
  conflict expected).
- Pre-warm runs on the **Mac on shore wifi** (or the Pi when it has internet); the cache
  dir is disk-persistent so it survives offshore. The Pi reads the same `sat-cache/`
  layout with zero code difference.
