# Enabling NOAA vector charts on /chart

This document describes the two realistic paths for adding NOAA **vector** chart data to g5000's `/chart`, alongside the NOAA raster overlay we already ship via `EncLayer`. It is a how-to plus a recommendation, not a spec.

## What "NOAA vector charts" actually means

NOAA's authoritative chart data is published in **S-57**, the IHO Transfer Standard for Digital Hydrographic Data. An S-57 dataset is a set of "cells" — `.000` binary files — each covering a named geographic area at one of six **usage bands**:

| Band | Name | Typical scale | Typical use |
|---|---|---|---|
| 1 | Overview | < 1 : 1,500,000 | Ocean planning |
| 2 | General | 1 : 350,000 – 1,500,000 | Coastal overview |
| 3 | Coastal | 1 : 90,000 – 350,000 | Coastwise navigation |
| 4 | Approach | 1 : 22,000 – 90,000 | Approaches |
| 5 | Harbour | 1 : 4,000 – 22,000 | Harbour and pilotage |
| 6 | Berthing | > 1 : 4,000 | Docking |

A cell file name encodes the producer (`US…`), the band digit (1–6), and a producer-area code. `US5RI21M.000` is a harbour-band cell covering part of Rhode Island. NOAA publishes weekly updates.

NOAA distributes this same data through **four delivery surfaces**, two raster and two vector:

| Surface | Format | What we use today |
|---|---|---|
| Maritime Chart Service (MCS) rendered tiles | Raster PNG, S-52-symbolised server-side | **Yes — `EncLayer.tsx`** via `/api/enc-tiles` |
| NOAA NCDS / Marine Chart Services cached raster | Raster PNG, pre-rendered | (same proxy can hit this) |
| **ENC Direct ArcGIS feature services** | **Vector — Esri features, also returns GeoJSON** | No |
| **S-57 cell downloads** | **Vector — raw `.000` binary** | No |

The first two are pixels. The latter two are features and are what "NOAA vector charts" means in this doc.

## Why bother adding vector

Three things vector gives us that the raster overlay cannot:

1. **Click-to-identify.** Tapping a buoy returns its S-57 attributes — light characteristic, colour pattern, name, position accuracy, charted depth.
2. **Restyling.** Day / dusk / night palettes, depth shading by draft, hide/show classes by zoom. Raster is baked at the server.
3. **Offline coverage.** S-57 cells are small — a single harbour cell is sub-megabyte. The 810 MB bundle for all of US waters fits trivially on a Pi. Our current raster path needs working internet for the first request of every tile (cache fills over time, but pre-warming a whole passage area of raster tiles is gigabytes).

What vector does **not** give us cheaply: ECDIS-quality symbology. The full IHO S-52 presentation library is hundreds of pages of rules describing how to render every S-57 object class in every condition. Replicating it is the bulk of building a "real" ECDIS. Most yacht apps either ship a simplified subset or punt on it entirely; we should do the same — see _What we won't do_ at the end.

## Path A — Online vector via NOAA ENC Direct (ArcGIS)

Easiest enable. NOAA hosts the same S-57 data behind an ArcGIS REST API at `gis.charttools.noaa.gov`. Six MapServer endpoints, one per usage band:

- `https://gis.charttools.noaa.gov/arcgis/rest/services/encdirect/enc_overview/MapServer`
- `…/encdirect/enc_general/MapServer`
- `…/encdirect/enc_coastal/MapServer`
- `…/encdirect/enc_approach/MapServer`
- `…/encdirect/enc_harbour/MapServer`
- `…/encdirect/enc_berthing/MapServer`

Each MapServer exposes 100–200 sub-layers. Layers are organised as group layers (the named S-57 object classes like `AidsToNavigationP`, `Depth_Area`, `Soundings`) with point/line/area sub-layers under them — only the leaf sub-layers are queryable, not the group layers.

### Verified query shape

```
GET /arcgis/rest/services/encdirect/enc_coastal/MapServer/{layerId}/query
  ?where=1=1
  &geometry={lonMin},{latMin},{lonMax},{latMax}
  &geometryType=esriGeometryEnvelope
  &inSR=4326
  &spatialRel=esriSpatialRelIntersects
  &outFields=*
  &returnGeometry=true
  &outSR=4326
  &resultRecordCount=1000
  &f=geojson
```

Returns a `FeatureCollection` with `geometry` in WGS84 lon/lat and `properties` containing S-57 attributes (`OBJL`, `BOYSHP`, `COLOUR`, `COLPAT`, `OBJNAM`, …). Verified against `enc_coastal` layer 6 (Coastal Safe-Water Buoy) — one feature returned for the Narragansett Bay entrance buoy near `41 23.000n 71 23.358w`.

### Quirks to plan around

- **Group layers are not queryable** — layer 0 of every MapServer is a Group Layer (`type: "Group Layer"`, `geometryType: null`). Calling `/query` against it returns HTTP 400. Pick the leaf feature layers (typed `Feature Layer` with a non-null `geometryType`) for actual queries. Iterate the MapServer's `?f=json` once at boot to learn the leaf layer ids.
- **Result limits.** ArcGIS MapServer Query has a default `maxRecordCount` of 1000–2000. For dense layers (soundings) you'll exceed it in a typical viewport. Either paginate with `resultOffset` or split the bbox.
- **Coordinate format.** Esri envelopes take `xmin,ymin,xmax,ymax` as a comma-joined string; `geometryType=esriGeometryEnvelope` is required so the server doesn't try to parse it as a polygon. JSON-encoded envelope objects also work but the comma form is shorter.
- **CORS.** ArcGIS REST is CORS-enabled, so a browser-side fetch works in development. In production we route through a same-origin proxy anyway (see the architectural fit below).
- **Rate limiting.** No published limit, but the service backs a government website. A single yacht panning around the chart will not be an issue. A misconfigured loop pulling thousands of bbox queries per minute will get throttled.

### Architectural fit in g5000

g5000 already has a same-origin proxy convention for chart data (`/api/tiles`, `/api/enc-tiles`, `/api/seamark-tiles`). Add a sibling for the vector queries:

- `packages/web/src/app/api/enc-features/route.ts` — accepts `?band=coastal&class=buoy_lateral&bbox=lonMin,latMin,lonMax,latMax`, fans out to the matching ArcGIS layer ids, normalises the GeoJSON, and serves it.
- Layer-id catalogue baked into the route handler (small map from class name → ` { coastal: 5, approach: 7, … }`). Built once by querying each MapServer's `?f=json` and committed; refreshes are manual.
- Memory or disk cache by `(band, class, bbox-quantised, week)` so panning back over a viewed area is instant. Same `~/.g5000-router/` root as the other caches; sub-directory `enc-features-cache`.

On the client, one new component per logical group of feature classes (`<EncBuoyLayer/>`, `<EncDepthContoursLayer/>`, etc.) that:

1. Watches `map.on('moveend')` for the current bbox + zoom.
2. Picks the appropriate usage band by zoom (Overview ≤ z6, General z6–9, Coastal z9–11, Approach z11–13, Harbour z13–15, Berthing z15+ — tunable).
3. Fetches `/api/enc-features?…`.
4. Updates a MapLibre GeoJSON source with the response.
5. Adds layers with the existing `__above-wind__` `beforeId` sentinel so they sit beneath wind/AIS/route as before.

Symbology lives in those layer components — `circle` paint for buoys keyed off the `COLOUR` attribute (S-57 colour codes 1–13 → MapLibre palette), `line-color` keyed off `VALDCO` for depth contours, etc. Plain MapLibre paint expressions; no S-52 engine.

### Trade-offs

**Good for**: shore-side route planning, fast development iteration, click-to-identify on individual features, restyling experiments without re-rendering anything server-side.

**Bad for**: offshore. The moment Sula loses internet, every feature query 404s and the layer goes blank. Cache lifetime extends what we've already panned over, but panning to a new area on the same passage is dead. This is the same failure mode as the raster path, except raster tiles cache as a contiguous image grid while features cache as bbox-keyed JSON, which is finickier to pre-warm.

## Path B — Offline vector via S-57 → vector-tile bundle

Operationally correct answer for a boat that goes offshore. Pull NOAA's full ENC distribution, convert once, serve as Mapbox Vector Tiles from a same-origin route. No internet at runtime.

### Source

NOAA distributes ENC cells as ZIP archives at `https://charts.noaa.gov/ENCs/`:

- **Full bundle**: `https://charts.noaa.gov/ENCs/All_ENCs.zip` — `~810 MB` as of 2026-05-21, weekly updates. Contains every US ENC cell.
- **Per-cell**: `https://www.charts.noaa.gov/ENCs/{CELL}.zip` (e.g. `US5RI21M.zip` for Narragansett Bay — `~395 KB`). Useful if you want a specific cruising area without the whole 810 MB.
- **Index**: `https://charts.noaa.gov/ENCs/ENCProdCat.xml` — XML catalogue listing every cell with its bounds and current edition number. Use it to drive incremental updates.

### Pipeline

One-shot, on a development machine (not on the Pi — the conversion is RAM- and CPU-hungry):

```bash
# 1. Pull the bundle
wget https://charts.noaa.gov/ENCs/All_ENCs.zip
unzip All_ENCs.zip -d ./encs

# 2. Convert every cell to GeoJSON, one file per S-57 layer class.
#    Requires GDAL ≥ 3 with the S57 driver (default on Homebrew gdal).
for cell in $(find ./encs -name '*.000'); do
  ogr2ogr -f GeoJSONSeq -append \
    -t_srs EPSG:4326 \
    -nln "$layer" \
    ./geojson/${layer}.geojsonl \
    "$cell" "$layer"
done
# (loop over the S-57 layer names you care about — DEPARE, DEPCNT,
#  SOUNDG, BUAARE, COALNE, BOYLAT, BOYSAW, LIGHTS, NAVLNE, etc.)

# 3. Build a single MBTiles archive with tippecanoe.
tippecanoe -o noaa-encs.mbtiles \
  --layer DEPARE -L DEPARE:./geojson/DEPARE.geojsonl \
  --layer DEPCNT -L DEPCNT:./geojson/DEPCNT.geojsonl \
  --layer SOUNDG -L SOUNDG:./geojson/SOUNDG.geojsonl \
  --layer LIGHTS -L LIGHTS:./geojson/LIGHTS.geojsonl \
  …
  -Z 4 -z 16 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping
```

Output: a single `noaa-encs.mbtiles` file. Expect a few GB for the full US dataset depending on tippecanoe drop settings; well under a gig if you only build a passage region.

Copy the MBTiles to the Pi under `~/.g5000-router/enc-vector-tiles/noaa-encs.mbtiles`.

### Serving

New route `packages/web/src/app/api/enc-vector-tiles/[z]/[x]/[y]/route.ts`:

- Opens the MBTiles file (SQLite, single read-only connection at module scope).
- Each request: `SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?` — note MBTiles uses **TMS** Y, so `tile_row = (1 << z) - 1 - y` to translate from MapLibre XYZ.
- Response headers: `content-type: application/x-protobuf`, `content-encoding: gzip` (MBTiles already stores gzipped PBFs), `cache-control: public, max-age=2592000`.
- 204 No Content for any tile outside the MBTiles' `minzoom`/`maxzoom` range or for a row that returns no rows.

`better-sqlite3` is already a dependency (used by `ConfigStore`) and serves this fine. The same-origin proxy pattern matches the existing `/api/tiles` and `/api/enc-tiles` shape; no new infrastructure.

### MapLibre source

```ts
map.addSource('noaa-vector', {
  type: 'vector',
  tiles: ['/api/enc-vector-tiles/{z}/{x}/{y}.pbf'],
  minzoom: 4,
  maxzoom: 16,
  attribution: 'NOAA / Office of Coast Survey',
});
```

Then add layers per S-57 class with paint expressions reading the S-57 attributes promoted into properties during the ogr2ogr step. Same `beforeId: '__above-wind__'` discipline as the raster layers.

### Trade-offs

**Good for**: offshore reliability, sub-second tile rendering once on the Pi, smooth styling control, the whole cruising area pre-loaded before leaving the dock.

**Bad for**: build complexity. Tippecanoe is fast but the cell extraction loop touches every `.000` file and burns through CPU. Updates are a re-run of the pipeline, not a `git pull`. We become responsible for re-running the build every NOAA weekly release (or letting the dataset go stale, which is the actually-likely outcome).

## Recommended path for Sula

Both, in this order:

1. **Path A first**, scoped tight — buoys / lights / depth contours / restricted areas. Limits to the four classes that change identification behaviour. Shore-side route planning is the main payoff. Two weeks of work end-to-end.
2. **Path B later**, once the on-chart vector look has been tuned in Path A. The bundle build is a self-contained Make target that runs on the Mac. Pi hosting is read-only and small.

This ordering matches the existing playbook for chart layers in this repo: build a same-origin proxy, mount under the `__above-wind__` sentinel, iterate styling against live data, then promote a chosen subset to a disk-resident dataset for offline use. The seamark and ENC-raster overlays both followed it.

If a passage south of Bermuda comes up before vector is wired in: this whole exercise is US-waters-only. UKHO ENCs and Bahamas-area paper-equivalent vectors are not in this scope. The current NOAA-raster layer already returns empty south of the Florida Straits, and the vector services do the same.

## What we won't do

- **Full S-52 ECDIS symbology.** The presentation library is hundreds of pages of conditional rendering rules driven by mariner-selected category. A vector-symbolised ECDIS is its own product. We render a simplified, sailor-readable subset and call it done.
- **S-101 product format.** NOAA's S-101 program is publicly committed and ongoing, but the canonical present-day vector source is still S-57. Watch the transition; don't try to lead it.
- **On-demand cell extraction.** Tippecanoe in production, per-request, is a non-starter on a Pi. Convert once, ship the MBTiles.
- **Custom S-57 parser.** GDAL's S-57 driver is the reference implementation. Anything we write would be worse and slower.
- **Replacing the raster overlay.** The rendered MCS tiles look correct out of the box. Vector adds capability; it doesn't replace the raster — both can co-exist as separate toggleable layers, same as the OSM basemap is independent of any overlay.

## Sanity checks before committing to a path

Three quick experiments worth running before writing any production code, in order of cost:

1. **`curl` the ENC Direct query above against the Newport bbox.** Confirm you get the buoy we already verified, that the GeoJSON shape is what MapLibre wants, and that adjacent layer ids return sensible counts. Five minutes.
2. **Wire a one-off `<EncBuoyLayer/>` component on `/chart`** that hits a single hard-coded layer id and bbox, with no proxy. Just enough to see real S-57 features on the map and confirm the symbology direction looks right. Half a day.
3. **Download a single harbour cell (`US5RI21M.zip`, ~400 KB)** and run `ogr2ogr -f GeoJSON … US5RI21M.000` against it. Inspect the layers and attributes. Decide whether the full Path B pipeline is something we want to own. One hour.

Steps 1 and 3 are pure reconnaissance and inform the Path A vs Path B decision before any chart-page code changes. Step 2 is a throwaway proof-of-concept that proves vector renders on top of our existing layer stack.
