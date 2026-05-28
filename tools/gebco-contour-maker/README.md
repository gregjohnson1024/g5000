# gebco-contour-maker

A repeatable, **offline** pipeline that turns the global GEBCO bathymetry grid
into a single **PMTiles** vector-tile file of depth-contour LINES, with
user-configurable contour levels and a zoom strategy that keeps the tiles small
and legible.

It is built for [g5000](../../README.md) — a sailing-instrumentation web app
that runs on a Raspberry Pi on a boat with no offshore internet. Bathymetry is
static, so we compute the contours once on shore and ship one self-contained
file. See [`INTEGRATION.md`](./INTEGRATION.md) for wiring it into the chart.

> **NOT FOR NAVIGATION.** GEBCO is an interpolated ~450 m grid that smooths out
> shoals, wrecks and isolated dangers. These contours are for situational
> awareness only. This caveat is baked into the PMTiles metadata and must stay
> visible wherever the layer is shown.

## Why this exists

g5000 currently fetches depth contours on demand from the GMRT GridServer per
map viewport. That has three problems this pipeline eliminates:

1. coverage is a clamped rectangle around the viewport, not global;
2. it needs live internet;
3. contour lines close along the grid edge as artifacts.

A precomputed global contour set served as vector tiles fixes all three.

## Prerequisites

```sh
brew install gdal tippecanoe pmtiles   # GDAL 3.x, tippecanoe 2.x, go-pmtiles
python3 --version                       # 3.11+ (standard library only)
```

`tippecanoe` writes PMTiles natively; `pmtiles` is used to inspect the result
and `tippecanoe-decode` (ships with tippecanoe) to verify tiles.

## Quick start

```sh
cd tools/gebco-contour-maker

make test            # pure-Python unit tests for the level/rank logic
make smoke           # full pipeline on a small region — NO 7.5 GB download

make acquire         # one-time: download the GEBCO global grid (~7.5 GB)
make                 # build data/build/world.pmtiles from the global grid
make report          # print the PMTiles header + size
make summary         # show the expanded level/rank table
```

`make smoke` is the fastest way to see the whole thing work: it pulls a ~5°×5°
GeoTIFF around Bermuda from the GMRT GridServer (GEBCO-based, same sign
convention, no auth) and runs every stage on it.

## Configuration — one file drives everything

Everything about *which* contours to draw and *how* they're zoom-gated lives in
[`config/levels.json`](./config/levels.json). Edit it and re-run `make`; no
script changes needed.

### Contour levels

```json
"levels": [
  { "fromM": 0,    "toM": 1000,  "stepM": 20  },
  { "fromM": 1000, "toM": 11000, "stepM": 200 }
]
```

Positive metres. Each rule yields `fromM + k·stepM` for `k = 1, 2, …` up to and
including `toM` (so `fromM` is exclusive, `toM` inclusive). The default ships
the 0–1000 m range every 20 m and the deep range every 200 m — 100 levels.

### Zoom strategy (`ranks`)

Each level is assigned a `rank` and, from it, a per-feature **minzoom**, so
coarse isobaths show when zoomed out and the dense 20 m set only appears when
zoomed in. The `ranks` array is an ordered ladder; **first match wins**, and the
trailing `"match": "default"` rule must stay last.

| rank  | matches                          | minzoom |
| ----- | -------------------------------- | ------- |
| basin | every 1000 m                     | 0       |
| major | 100 & 200 m shelf lines          | 3       |
| deep  | every 200 m (not already above)  | 5       |
| shelf | every 100 m (not already above)  | 6       |
| fine  | everything else (the 20 m set)   | 8       |

The `basin` tier sits at minzoom 0 so the 1000 m ocean-basin isobaths stay
visible at a whole-world view; the denser tiers are gated higher to keep low
zooms legible.

### Build knobs (`build`)

| key                  | default | meaning                                                     |
| -------------------- | ------- | ----------------------------------------------------------- |
| `fullArcsec`         | 15      | native GEBCO resolution; the fine set is contoured here     |
| `coarseArcsec`       | 60      | downsampled grid for the coarse tiers                       |
| `coarseForMinzoomLE` | 6       | levels with minzoom ≤ this use the coarse grid              |
| `maxzoom`            | 11      | tippecanoe max zoom (contours overzoom cleanly beyond)      |
| `simplification`     | 4       | tippecanoe line simplification                              |

## How it works

```
GEBCO grid ──► gdalwarp ──► coarse grid (60") ─► gdal_contour (coarse levels) ─┐
            └────────────────────────────────► gdal_contour (fine 20 m levels)─┤
                                                                               ▼
                                              cat ─► tag_contours.py ─► tagged.geojsonl
                                              (depth + rank + tippecanoe.minzoom)
                                                                               │
                                                                  tippecanoe ──▼── world.pmtiles
```

1. **Acquire** (`scripts/acquire.sh`) — download the GEBCO global grid once;
   verify its sha256 (pin one in config to enable the check).
2. **Multi-resolution contour** — the coarse tiers are contoured on a grid
   downsampled to `coarseArcsec`; only the fine 20 m set uses the full grid.
   This bounds runtime **without chunking the world**, so there are no
   chunk-edge seam artifacts (the trade-off the spec lists as the alternative).
   *Land exclusion is implicit:* we pass only **negative** levels to
   `gdal_contour -fl`, so no contour is ever drawn over terrain (elevation > 0).
3. **Tag** (`scripts/tag_contours.py`) — stream the merged GeoJSONSeq, convert
   signed elevation → positive `depth`, attach `rank`, and set a per-feature
   `tippecanoe.minzoom`. Line-oriented, so memory stays bounded at global scale.
4. **Tile** — `tippecanoe` → one PMTiles file. Per-feature minzoom drops each
   contour below its tier's zoom; `--drop-densest-as-needed` keeps tiles under
   the size limit. The `GEBCO 2024 Grid` attribution is written into the
   PMTiles header — the only durable place for it.

`scripts/gebco_levels.py` is the single source of truth for the level/rank
logic and is import-tested; the Makefile and the tagger both read from it.

## Runtime & size expectations

Measured on an Apple-silicon Mac (GDAL 3.13, tippecanoe 2.79), full global run:

| stage                              | time    |
| ---------------------------------- | ------- |
| download + unzip (4.3 GB → 7 GB)   | ~31 min |
| build (warp → contour → tag → tile)| ~29 min |
| **total**                          | **~60 min** |

Output: **1.5 GB** PMTiles, z0–11, global (−180…180, −81…85), 2.5 M tiles, with
`GEBCO 2024 Grid` in the header metadata — comfortably inside the spec's
few-hundred-MB-to-~2 GB target. The coarse contour pass is ~45 s; the
full-resolution 20 m pass over all 86,400 × 43,200 cells dominates the build but
is still minutes, not hours, on modern hardware. The Makefile is incremental: a
re-run after editing only deep levels won't recompute the fine grid unless its
inputs changed.

For reference, the Bermuda smoke region (5°×5°, deep-ocean heavy) produces a
**791 KB** PMTiles at z0–11.

### Smoke-test verification (zoom gating)

Decoding the smoke PMTiles confirms each tier appears exactly at its configured
minzoom:

| zoom | ranks present                       |
| ---- | ----------------------------------- |
| z3   | major                               |
| z5   | major, deep                         |
| z6   | major, deep, shelf                  |
| z8   | major, deep, shelf, **fine** (20 m) |

## Gotchas

- **Sign convention.** GEBCO stores *elevation*; seabed is negative. We contour
  on the negative side and present `depth` as positive metres.
- **Land.** Excluded by only ever requesting negative contour levels.
- **Antimeridian.** Contours crossing ±180° are handled by gdal_contour +
  tippecanoe, but a 5°×5° smoke region can't exercise it — **verify visually
  around the dateline after a global run.**
- **Attribution.** GEBCO requires credit. `GEBCO 2024 Grid` is written to the
  PMTiles metadata; surface it in any UI that shows the layer.
- **Multi-resolution nesting.** Coarse and fine contours come from different
  grid resolutions, so in very steep terrain a 100 m line (coarse) and the
  adjacent 80/120 m lines (fine) may not perfectly nest. Acceptable for
  situational awareness; documented here so it isn't mistaken for a bug.

## Layout

```
config/levels.json      the one editable config (levels + ranks + build knobs)
scripts/gebco_levels.py expand levels, assign rank/minzoom, depth<->elevation
scripts/tag_contours.py stream-tag GeoJSONSeq with depth/rank/minzoom
scripts/acquire.sh      download + checksum the GEBCO global grid
scripts/smoke.sh        small-region end-to-end test (no big download)
tests/                  pure-Python unit tests (no GDAL needed)
Makefile                the pipeline orchestrator
INTEGRATION.md          how to wire the PMTiles into the g5000 chart
data/                   grids + build outputs (gitignored)
```
