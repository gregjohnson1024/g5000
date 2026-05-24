# Make the chart wind overlay ROI-aware

**Date:** 2026-05-24
**Status:** Approved design (option A), pre-implementation

## Context

`/chart`'s wind overlay fetches its grid via `GET /api/forecast/grid?model=&hour=`,
which returns the most-recently-cached grid for `(model, hour)` **regardless of
bbox**. The slider/banner, however, derive `availableHours` from the manifest
**filtered to the current ROI box**. So when the user draws a box that hasn't
been fetched, the banner correctly says "No GFS forecast cached" while the overlay
still draws an overlapping grid from a *different* previously-fetched region —
a confusing contradiction (overlay shows wind, banner says nothing cached).

Fix: make the overlay request data for the ROI box, so "overlay shows wind" ⟺
"slider has data" ⟺ "this box is fetched."

## Design

- **`GET /api/forecast/grid`** gains optional bbox params
  (`latMin/latMax/lonMin/lonMax`). When present, it returns the most-recent
  cached grid whose **key bbox** matches the requested bbox within 0.01° (the
  same tolerance the slider's `availableHours` filter uses), for `(model, hour)`;
  `404 {error:'not cached'}` if none. Without bbox params, behaviour is unchanged
  (any bbox) for backward-compat. Matching uses the cache **key** bbox (parsed as
  the manifest route already does), not the grid's snapped extent.
- **`page.tsx`** lifts `forecastBbox` to state from the `/api/settings` it already
  polls (set only when the value actually changes, so identity stays stable), adds
  it to the wind-overlay refresh-key deps, and passes it to `WindOverlay`.
- **`WindOverlay`** accepts an optional `bbox` prop and appends it to the
  `/api/forecast/grid` request. When the ROI is unfetched → 404 → `windGrid` stays
  null → overlay draws nothing, matching the banner.

## Scope

- **Wind only** (GFS/ECMWF + ROI). CMEMS currents are fetched as a whole region
  and have no ROI box, so `CurrentOverlay` is unchanged.

## Files

- `packages/web/src/app/api/forecast/grid/route.ts` — optional bbox filter.
- `packages/web/src/app/chart/page.tsx` — `forecastBbox` state; pass to `WindOverlay`;
  add to refresh-key deps.
- `packages/web/src/components/WindOverlay.tsx` — `bbox` prop → request param.

## Verification

- Draw a fresh box → overlay draws nothing and banner says "No … cached" (consistent).
  Click ↻ → after fetch, overlay fills and slider populates.
- `GET /api/forecast/grid?model=gfs&hour=12&latMin=…` returns a grid only for a
  fetched box; 404 for an unfetched one.
- `npm run typecheck`, `prettier --check`, `next build` pass.
