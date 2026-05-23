# Chart model layers + cleanup — design

**Date:** 2026-05-23
**Status:** approved (design); implementation plan to follow

## Goal

Simplify the `/chart` view:

1. Remove the interactive **load-a-plan widgets** (keep `?plan=<id>` display).
2. Remove the **Gulf Stream boundary drawing**.
3. Replace the **"Model display: visible" checkbox + GFS/ECMWF/CMEMS `<select>`**
   with a single mutually-exclusive model-layer selector (**None | GFS | ECMWF
   | CMEMS**, default None) living in `LayersControl`.

## Background / current state

All in `packages/web/src/app/chart/page.tsx` unless noted.

- **Load-a-plan UI:** `SavedPlanLoader` dropdown component (defined ~859–917,
  mounted ~784); plan-info sidebar panel (ETA/distance/model/incomplete,
  ~786–795); `RouteTimeline` leg table (`packages/web/src/components/RouteTimeline.tsx`,
  mounted ~796); the `?plan=<id>` URL loader (~408–429); `route` state (~212);
  `attachRoute`/`RoutePolyline` (~219–223); `chart:planState` persistence
  (~325–347); error line (~785).
- **Gulf Stream:** `<GulfStreamLayer/>` mounted ~468; fetches
  `/api/gulf-stream/north-wall`.
- **Model display:** `windOn` boolean checkbox "Model display: visible"
  (~66, UI ~554–563) gates `ForecastRoi` (~466 `hidden={!windOn}`),
  `WindOverlay` (~483 `hidden={!windOn || displayModel === 'CMEMS'}`),
  `CurrentOverlay` (~501 `hidden={!windOn || displayModel !== 'CMEMS'}`).
  `displayModel: 'GFS'|'ECMWF'|'CMEMS'` (~101) is chosen via a `<select>`
  (~565–592); selecting GFS/ECMWF also syncs `windModel: 'gfs'|'ecmwf'` (~63).
- **Data sources:** `WindOverlay` fetches `/api/forecast/grid?model=<gfs|ecmwf>&hour=N`;
  `CurrentOverlay` fetches `/api/current/grid?day=N` (source CMEMS); the
  forecast-hour timeline + `/api/forecast/manifest` poll (~249–296, slider
  ~646–752) drive wind hours; "Refresh CMEMS" button (~600–638) POSTs
  `/api/current/refresh`.
- **LayersControl** (`packages/web/src/app/chart/LayersControl.tsx`): popover
  with toggles `{ osm, enc, buoys, tileGrid }` + a "Refresh NOAA" button +
  count badge. Persisted under `chart:layers`. Page wires `state`/`onToggle`/
  `onRefreshNoaa` (~523–527).
- **localStorage:** `chart:settings` = `{ windOn, windModel, windHours,
displayModel, showIsochrones }`; `chart:layers` = `{ osm, enc, buoys,
tileGrid }`.
- **Z-order:** `WindOverlay`/`CurrentOverlay` add with `beforeId='__above-wind__'`;
  overlays are always mounted and toggle via a `hidden` prop that empties their
  GeoJSON sources.

## Decisions (from brainstorming)

1. **Plan removal = widgets only.** Remove `SavedPlanLoader`, the plan-info
   sidebar panel, and `RouteTimeline`. KEEP the `?plan=` URL loader, `route`
   state, `attachRoute`/`RoutePolyline`, `chart:planState`, and the loader
   error line. A deep-linked plan still draws; no UI picks one.
2. **Gulf Stream:** unmount `<GulfStreamLayer/>`; leave the component file and
   `/api/gulf-stream/north-wall` in the tree, unmounted (one-line revert,
   matching the Seamark/Laylines preserved-but-unmounted convention).
3. **Model layer:** one mutually-exclusive control **None | GFS | ECMWF |
   CMEMS**, default **None**, in `LayersControl`. Replaces both `windOn` and
   the `displayModel` `<select>`.

## Changes

### A. Remove load-a-plan widgets

- Delete the `SavedPlanLoader` component definition and its mount.
- Delete the plan-info sidebar panel (ETA/distance/model/incomplete).
- Delete the `RouteTimeline` mount (leave `RouteTimeline.tsx` + `SavedPlanLoader`
  source in tree, unmounted).
- KEEP: `?plan=` loader, `route`/`setRoute`, `attachRoute`/`RoutePolyline`,
  `chart:planState` read/write, and the `{error && …}` line (the loader still
  uses `setError`).

### B. Remove Gulf Stream drawing

- Remove the `<GulfStreamLayer/>` mount and its import. Leave
  `GulfStreamLayer.tsx` and the `/api/gulf-stream/north-wall` route in place.

### C. Model-layer selector (the core change)

- **State:** introduce `model: 'none' | 'gfs' | 'ecmwf' | 'cmems'` as a field of
  the `chart:layers` `LayersState`. Remove `windOn` and `displayModel` (and the
  separate `windModel`) state. The wind-overlay model and the forecast-hour
  timeline derive from `model` when it is `'gfs'`/`'ecmwf'`.
- **LayersControl:** add a labeled mutually-exclusive radio group "Model overlay"
  with options None / GFS / ECMWF / CMEMS. Wire via a new
  `onSelectModel(model)` callback (or extend `onToggle` to handle the radio).
  Include the active model (when not None) in the enabled-layer badge count.
- **Gating** (overlays stay always-mounted; toggle `hidden`):
  - `WindOverlay`: `hidden = model !== 'gfs' && model !== 'ecmwf'`; pass
    `model={model}` (gfs/ecmwf) when shown.
  - `CurrentOverlay`: `hidden = model !== 'cmems'`.
  - `ForecastRoi`: `hidden = model !== 'gfs' && model !== 'ecmwf'` (was `!windOn`).
  - Forecast-hour timeline slider + `/api/forecast/manifest` poll: active only
    when `model` is `gfs`/`ecmwf` (otherwise idle/hidden — don't poll when no
    wind model is selected).
  - "Refresh CMEMS" button: shown only when `model === 'cmems'`.
  - `None`: no model overlay, no ROI, no timeline, no manifest poll — clean
    basemap.
- **Remove** the old sidebar "Model display" checkbox and the `<select>`.

### D. Persistence

- `chart:layers` becomes `{ osm, enc, buoys, tileGrid, model }`, default
  `model: 'none'`. Hydrate/persist alongside the existing layer fields.
- Drop `windOn`/`displayModel` from `chart:settings` writes. `windHours` and
  `showIsochrones` stay. Leftover old keys in a user's storage are ignored
  harmlessly (no migration needed).

## Testing

The chart is React/MapLibre UI with little pure logic. Extract the
`model → { windHidden, currentHidden, roiHidden, windModel }` derivation into a
small pure helper and unit-test it (None/GFS/ECMWF/CMEMS cases). Otherwise
verify via dev-server smoke:

- `/chart` → 200.
- Selecting GFS/ECMWF shows the wind overlay (+ ROI + timeline); CMEMS shows the
  current overlay (+ Refresh CMEMS button); None shows a clean basemap.
- Gulf Stream boundary no longer renders.
- No `SavedPlanLoader` / plan-info / RouteTimeline widgets; `?plan=<id>` still
  draws a route.

## Out of scope

- Deleting `GulfStreamLayer.tsx` / `SavedPlanLoader` / `RouteTimeline.tsx` files
  (kept unmounted).
- Any change to the routing engine, `/api/route/plan`, `/api/forecast/*`, or
  `/api/current/*` endpoints.
- Leg-by-leg routing, tags, the future chart-based route/waypoint builder.

## Risks / notes

- Removing the `windOn`/`displayModel` state requires cleaning every reference
  (timeline, ROI, overlays, the manifest poll, persistence). Lean on typecheck
  to catch dangling references — same discipline as the chart display-only
  cleanup.
- Don't start the `/api/forecast/manifest` poll when `model` is `none`/`cmems`
  — it should only run for wind models, to avoid needless polling.
