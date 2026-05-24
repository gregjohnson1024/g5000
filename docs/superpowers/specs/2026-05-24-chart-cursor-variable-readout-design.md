# Chart cursor readout — show the displayed model variable under the cursor

**Date:** 2026-05-24
**Status:** Approved design, pre-implementation

## Context

The bottom-right cursor readout on `/chart` shows the lat/lon under the mouse
plus range + bearing from the live boat fix. When a model overlay is visible,
the colours convey a field but the user can't read an exact value. This adds the
displayed variable's speed and direction at the cursor position.

## Behaviour

When a model overlay is active and its grid is loaded, the cursor readout gains
one line for the variable under the cursor, interpolated from the displayed grid:

- Wind (GFS/ECMWF): `Wind 14.2 kn · from 245°`
- Current (CMEMS): `Current 0.8 kn · set 110°`

Shown only when the cursor is within the grid's coverage; otherwise the line is
omitted. Units = knots; bearings are 3-digit true degrees (matches app convention).

## Design

- **`lib/grid-sample.ts`** (new, unit-tested): `sampleUV(grid, lat, lon)` —
  bilinear interpolation of `u`/`v` over the 4 surrounding grid points. Returns
  `null` when the point is outside `[lats[0], lats[last]] × [lons[0], lons[last]]`
  or any surrounding corner is non-finite. `WindGrid` and `CurrentGrid` share the
  `{ lats[], lons[], u[][], v[][] }` shape, so one helper serves both.
- **Lift the current grid** to `page.tsx` (`setCurrentGrid` from `CurrentOverlay`'s
  existing `onLoaded`), mirroring the already-lifted `windGrid`.
- **`CursorReadout`** takes the active grid + kind (`'wind' | 'current'`) + cursor.
  Speed = `hypot(u,v) · MS_TO_KN`. Bearing: wind = **from** = `atan2(-u,-v)`;
  current = **set/toward** = `atan2(u,v)`; both normalised to 0–360° true.

## Files

- `packages/web/src/lib/grid-sample.ts` — new; `sampleUV`.
- `packages/web/src/lib/grid-sample.test.ts` — new; bilinear + out-of-bounds + NaN.
- `packages/web/src/app/chart/page.tsx` — `currentGrid` state; pass active
  grid + kind to `CursorReadout`; render the variable line.

## Out of scope

- Pressure (isobar) value at the cursor.
- The latent "overlay ignores ROI bbox" issue.

## Verification

- Hover over a wind overlay → line shows plausible kn + from-bearing; off the grid
  → line hidden. Switch to CMEMS → shows current kn + set-bearing.
- `sampleUV` unit tests (interior interpolation, edges, out-of-bounds, NaN corner).
- `npm run typecheck`, `prettier --check`, `next build` pass.
