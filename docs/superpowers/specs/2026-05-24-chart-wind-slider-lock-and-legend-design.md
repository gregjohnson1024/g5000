# Chart wind slider — "lock to current time" toggle + colour-bar legend

**Date:** 2026-05-24
**Status:** Approved design, pre-implementation

## Context

The `/chart` model time-slider lets you scrub through forecast hours for the
GFS/ECMWF wind overlay. Two gaps:

1. There's no way to keep the view pinned to *now* — after scrubbing, the slider
   stays where you left it and doesn't advance as time passes, so the displayed
   wind drifts out of date without the user noticing.
2. The wind-speed colour fill has no legend, so the colours carry no quantitative
   meaning to the viewer.

This adds a sticky "lock to current time" toggle and a discrete colour-bar legend.
Scope is the slider panel and the wind overlay's colour scale only.

## A. "Lock to current time" toggle

- New boolean UI state `windLockNow`, persisted to `localStorage['chart:windLockNow']`,
  default `true` (mirrors the existing `chart:follow` pattern).
- A small toggle button in the slider control row (beside the ←/→ hour buttons),
  visually highlighted when active.
- **Locked behaviour:** `windHours` is forced to the cached forecast hour whose
  valid time is nearest *now* — `argmin |runAt + h·3600 − now|` over the visible
  hour list. Recomputed on each manifest poll (~30 s) and render, so it advances
  with the wall clock and as fresh hours land.
- **Implementation point:** extend the existing auto-snap in `page.tsx` (~724-729).
  Locked → snap target = nearest-to-now hour; unlocked → current behaviour (keep
  `windHours` if present in the list, else `list[0]`).
- **Unlock on manual navigation:** dragging the slider, or pressing ←/→, sets
  `windLockNow = false` (sticky-with-gesture-exit, exactly like the Follow toggle).
  Tapping the toggle re-locks and immediately jumps to now.

## B. Colour-bar legend (discrete, knots)

- Extract `FILL_STOPS` from `WindOverlay.tsx` into a new shared module
  `lib/wind-scale.ts` (single source of truth). `WindOverlay` imports it — no
  behaviour change to the overlay. Stops (knots): 0, 5, 10, 15, 20, 25, 30, 35,
  45, 60.
- New `<WindLegend/>` component: a horizontal **stepped** colour bar (one swatch
  per bin — matches how the fill is actually drawn) with knot threshold labels and
  a `kn` unit label.
- Mounted in the right-hand model panel, shown only when a wind model overlay
  (GFS/ECMWF) is active (`mv.isWindModel`).

## Files

- `packages/web/src/lib/wind-scale.ts` — new; exports `FILL_STOPS`.
- `packages/web/src/components/WindLegend.tsx` — new; the stepped legend.
- `packages/web/src/components/WindOverlay.tsx` — import `FILL_STOPS` from the shared module.
- `packages/web/src/app/chart/page.tsx` — `windLockNow` state + localStorage; toggle
  button; locked-snap logic; unlock on drag/←/→; mount `<WindLegend/>`.

## Out of scope

- The latent "overlay ignores ROI bbox" issue (`/api/forecast/grid` returns the
  most-recent grid for `(model, hour)` regardless of bbox).
- Changing the fill colours or thresholds themselves.

## Verification

- Toggle starts on; slider sits at the nearest-now hour and re-centres after a
  manifest tick. Dragging unlocks; re-tapping re-locks and jumps to now. State
  survives reload.
- Legend shows the stepped knot scale, only when GFS/ECMWF is selected.
- `npm run typecheck`, `prettier --check`, and `next build` pass.
